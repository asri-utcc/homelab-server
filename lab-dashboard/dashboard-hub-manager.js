'use strict';

/**
 * dashboard-hub-manager.js
 * -----------------------------------------------------------------------------
 * Unified backend manager for Lab Dashboard upgrades:
 *   1. Docker Auto-Discovery (reads container labels + web ports via Docker API)
 *   2. Custom Bookmarks CRUD + Pinned Launcher persistence (atomic JSON writes)
 *   3. Live API Badges (OnePercentBotTrade, Agent Hub, Uptime Kuma, PZEM-01,
 *      AI Chat, Video Studio, Docker, Services)
 *   4. Rueso, Narathiwat Weather Widget (Open-Meteo API with 15-min cache)
 *   5. Opt-in Family / Guest Role helpers (safe-by-default read-only access)
 *
 * Zero npm dependencies — uses Node.js built-ins only.
 */

const http = require('http');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const DEFAULT_LAUNCHER_FILE = path.join(__dirname, 'launcher-config.json');
const DEFAULT_DOCKER_SOCK = process.env.DOCKER_SOCK || '/var/run/docker.sock';
const DEFAULT_TAIL_HOST = process.env.TAIL_HOST || 'homelab.tail285279.ts.net';
const DEFAULT_BOT_HEALTH_URL = process.env.BOT_HEALTH_URL || 'http://127.0.0.1:6015/api/health';

const DEFAULT_PINNED = ['agent-hub', 'video-studio', 'chat', 'energy', 'terminal'];
const LAUNCHER_MAX_PINNED = 12;
const MAX_BOOKMARKS = 60;

const DEFAULT_RUESO_COORDS = Object.freeze({
    name: 'อ.รือเสาะ จ.นราธิวาส',
    lat: 6.3917,
    lon: 101.5186,
    timezone: 'Asia/Bangkok',
});

const DEFAULT_FAMILY_APP_IDS = new Set([
    'homeassistant',
    'energy',
    'video-studio',
    'obsidian',
]);

// Non-HTTP infrastructure ports excluded from automatic port-based Docker discovery
const NON_WEB_PORTS = new Set([
    22, 53, 123, 139, 445, 1883, 2375, 2376, 3306, 5432, 6379, 8883, 27017, 51820,
]);

// Builtin metadata enrichment table (group, emoji, workspace embeddability, family visibility)
const BUILTIN_META = {
    terminal: { group: 'System', emoji: '💻', embed: true, family: false },
    'agent-hub': { group: 'Homelab', emoji: '🛰️', embed: true, family: false },
    'bg-remove': { group: 'AI & Media', emoji: '✂️', embed: true, family: false },
    '3d-vault': { group: 'AI & Media', emoji: '🧊', embed: true, family: false },
    'video-studio': { group: 'AI & Media', emoji: '🎬', embed: true, family: true },
    'lab-browser': { group: 'Homelab', emoji: '🌐', embed: true, family: false },
    chat: { group: 'AI & Media', emoji: '💬', embed: true, family: false },
    energy: { group: 'Smart Home', emoji: '⚡', embed: false, family: true },
    cron: { group: 'System', emoji: '⏰', embed: true, family: false },
    quota: { group: 'AI & Media', emoji: '📊', embed: true, family: false },
    ports: { group: 'System', emoji: '🛡️', embed: false, family: false },
    wireguard: { group: 'Network', emoji: '🔐', embed: true, family: false },
    emqx: { group: 'Smart Home', emoji: '📡', embed: true, family: false },
    cockpit: { group: 'System', emoji: '🖥️', embed: true, family: false },
    portainer: { group: 'Homelab', emoji: '🐳', embed: true, family: false },
    mongo: { group: 'Homelab', emoji: '🍃', embed: true, family: false },
    kuma: { group: 'Homelab', emoji: '📈', embed: true, family: false },
    pm2: { group: 'System', emoji: '⚙️', embed: true, family: false },
    filebrowser: { group: 'Homelab', emoji: '📁', embed: true, family: false },
    obsidian: { group: 'Knowledge', emoji: '📚', embed: true, family: true },
    samba: { group: 'Storage', emoji: '💾', embed: false, family: false },
    homeassistant: { group: 'Smart Home', emoji: '🏠', embed: true, family: true },
    zigbee2mqtt: { group: 'Smart Home', emoji: '💡', embed: true, family: false },
    onepercentbot: { group: 'Finance', emoji: '💹', embed: true, family: false },
};

// Known container name -> builtin app ID mapping to avoid duplicate entries
const CONTAINER_TO_BUILTIN_ID = {
    'lab-uptime-kuma': 'kuma',
    'lab-portainer': 'portainer',
    'lab-homeassistant': 'homeassistant',
    'lab-obsidian': 'obsidian',
    'lab-filebrowser': 'filebrowser',
    'lab-zigbee2mqtt': 'zigbee2mqtt',
    'lab-emqx': 'emqx',
    'lab-wg-easy': 'wireguard',
    'lab-mongo-express': 'mongo',
    'lab-caddy': '_infra',
    'lab-mongodb': '_infra',
    'lab-dockerproxy': '_infra',
    'lab-watchtower': '_infra',
};

const ACTIVE_VIDEO_STATUSES = new Set([
    'queued', 'researching', 'scripting', 'tts', 'rendering',
    'mixing', 'previewing', 'editing', 'running', 'building',
    'downloading', 'extracting', 'analyzing',
]);

const TERMINAL_JOB_STATUSES = new Set([
    'completed', 'done', 'failed', 'error', 'cancelled', 'canceled', 'aborted',
]);

// ── Utility helpers ──────────────────────────────────────────────────────────

function execFileAsync(cmd, args = [], opts = {}) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: opts.timeout || 5000, maxBuffer: 2 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
            resolve({
                code: err ? (err.code ?? 1) : 0,
                stdout: String(stdout || ''),
                stderr: String(stderr || ''),
                err,
            });
        });
    });
}

function defaultDockerReq(socketPath) {
    return function dockerReq(method, apiPath) {
        return new Promise((resolve, reject) => {
            const req = http.request({
                socketPath: socketPath || DEFAULT_DOCKER_SOCK,
                path: apiPath,
                method: method || 'GET',
                headers: { 'Content-Type': 'application/json' },
                timeout: 4000,
            }, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let data = text;
                    try { data = text ? JSON.parse(text) : null; } catch (_) { /* keep raw */ }
                    resolve({ status: res.statusCode, data });
                });
            });
            req.on('timeout', () => req.destroy(new Error('docker socket timeout')));
            req.on('error', reject);
            req.end();
        });
    };
}

function sanitizeText(input, maxLen = 120) {
    return String(input == null ? '' : input)
        .replace(/[\x00-\x1f\x7f]/g, '')
        .trim()
        .slice(0, maxLen);
}

function slugify(input) {
    return String(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}

function parseBool(val, fallback = false) {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') {
        const s = val.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(s)) return true;
        if (['0', 'false', 'no', 'off'].includes(s)) return false;
    }
    return fallback;
}

/**
 * Validates and sanitizes an app/bookmark URL.
 * Allows http://, https://, relative /, anchor #, or SMB \\host\share.
 * Strictly blocks javascript:, data:, vbscript:, file:, etc.
 */
function sanitizeUrl(raw) {
    const s = sanitizeText(raw, 500);
    if (!s) return '';
    if (s.startsWith('/') && !s.startsWith('//')) return s;
    if (s.startsWith('#')) return s;
    if (s.startsWith('\\\\')) return s;
    try {
        const u = new URL(s);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
            return u.toString();
        }
        return '';
    } catch (_) {
        return '';
    }
}

function enrichBuiltinApps(links = []) {
    return (Array.isArray(links) ? links : [])
        .filter((l) => l && l.id && l.url)
        .map((l) => {
            const id = String(l.id).trim();
            const meta = BUILTIN_META[id] || {};
            const embed = l.embed !== undefined ? Boolean(l.embed) : Boolean(meta.embed);
            return {
                id,
                label: String(l.label || id),
                icon: String(l.icon || 'link'),
                emoji: String(l.emoji || meta.emoji || '🔗'),
                url: String(l.url),
                source: 'builtin',
                group: String(l.group || meta.group || 'Homelab'),
                description: String(l.description || ''),
                embed,
                openInWorkspace: l.openInWorkspace !== undefined ? Boolean(l.openInWorkspace) : embed,
                family: l.family !== undefined ? Boolean(l.family) : (meta.family !== undefined ? meta.family : DEFAULT_FAMILY_APP_IDS.has(id)),
            };
        });
}

// ── Docker Auto-Discovery ────────────────────────────────────────────────────

function pickLabel(labels, keys) {
    for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(labels, k) && labels[k] !== '') {
            return String(labels[k]);
        }
    }
    return '';
}

function pickWebPort(ports = []) {
    if (!Array.isArray(ports)) return null;
    const candidates = ports
        .filter((p) => p && Number(p.PublicPort) > 0 && String(p.Type || 'tcp') === 'tcp')
        .map((p) => Number(p.PublicPort))
        .filter((port) => !NON_WEB_PORTS.has(port));
    if (!candidates.length) return null;
    // Prefer common HTTP/dashboard ports if multiple exist
    const preferred = candidates.find((p) => p === 80 || p === 443 || p === 3000 || p === 8080 || p >= 8000);
    return preferred || candidates[0];
}

function parseDockerLabelsToApp(container, opts = {}) {
    if (!container || typeof container !== 'object') return null;
    const tailHost = opts.tailHost || DEFAULT_TAIL_HOST;
    const builtinIdSet = opts.builtinIdSet || new Set();

    const rawName = (Array.isArray(container.Names) && container.Names[0])
        ? container.Names[0].replace(/^\//, '')
        : String(container.name || container.Id || '').slice(0, 48);
    if (!rawName) return null;

    const labels = (container.Labels && typeof container.Labels === 'object') ? container.Labels : {};
    const enableRaw = pickLabel(labels, ['lab.dashboard.enable', 'homepage.enable', 'flame.enable', 'dash.enable']);
    const explicitUrl = pickLabel(labels, ['lab.dashboard.url', 'lab.dashboard.href', 'homepage.href', 'flame.url']);

    // Explicitly opted out
    if (enableRaw && !parseBool(enableRaw, true)) return null;

    const explicitOptIn = (enableRaw && parseBool(enableRaw, false)) || Boolean(explicitUrl);
    const mappedBuiltin = CONTAINER_TO_BUILTIN_ID[rawName];

    // Skip already-known builtin/infra containers unless explicitly opted in via labels
    if (!explicitOptIn) {
        if (mappedBuiltin === '_infra') return null;
        if (mappedBuiltin && builtinIdSet.has(mappedBuiltin)) return null;
        const stripped = rawName.replace(/^lab-/, '');
        if (builtinIdSet.has(stripped) || builtinIdSet.has(rawName)) return null;
    }

    const webPort = pickWebPort(container.Ports);
    let url = explicitUrl ? sanitizeUrl(explicitUrl) : '';
    if (!url && webPort) {
        url = `https://${tailHost}:${webPort}/`;
    }

    // Must have either explicit opt-in or a valid web URL from an exposed web port
    if (!url) return null;
    if (!explicitOptIn && String(container.State || '').toLowerCase() !== 'running') {
        return null;
    }

    const labelName = pickLabel(labels, [
        'lab.dashboard.name',
        'homepage.name',
        'flame.name',
        'org.opencontainers.image.title',
    ]);
    const fallbackName = rawName
        .replace(/^lab-/, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase());

    const slug = slugify(rawName) || slugify(container.Id || 'app');
    const id = `docker-${slug}`;
    const icon = sanitizeText(pickLabel(labels, ['lab.dashboard.icon', 'homepage.icon', 'flame.icon']) || 'box', 32) || 'box';
    const emoji = sanitizeText(pickLabel(labels, ['lab.dashboard.emoji']) || '🐳', 8) || '🐳';
    const group = sanitizeText(pickLabel(labels, ['lab.dashboard.group', 'homepage.group', 'flame.category']) || 'Docker', 40) || 'Docker';
    const description = sanitizeText(
        pickLabel(labels, ['lab.dashboard.description', 'homepage.description', 'org.opencontainers.image.description']),
        180
    );
    const embedRaw = pickLabel(labels, ['lab.dashboard.embed', 'lab.dashboard.workspace']);
    const embed = embedRaw ? parseBool(embedRaw, true) : true;
    const familyRaw = pickLabel(labels, ['lab.dashboard.family']);
    const family = familyRaw ? parseBool(familyRaw, false) : false;

    return {
        id,
        label: sanitizeText(labelName || fallbackName, 80) || rawName,
        icon,
        emoji,
        url,
        source: 'docker',
        group,
        description,
        embed,
        openInWorkspace: embed,
        family,
        containerName: rawName,
        containerState: String(container.State || 'unknown').toLowerCase(),
    };
}

// ── WMO Weather Code Mapping (Thai) ──────────────────────────────────────────

function mapWmoCodeToThai(code, isDay = true) {
    const c = Number(code);
    const day = Boolean(isDay);
    if (c === 0) return { conditionTh: day ? 'ท้องฟ้าแจ่มใส' : 'ท้องฟ้าโปร่ง', emoji: day ? '☀️' : '🌙' };
    if (c === 1) return { conditionTh: 'เมฆบางส่วนเล็กน้อย', emoji: day ? '🌤️' : '🌙' };
    if (c === 2) return { conditionTh: 'มีเมฆบางส่วน', emoji: day ? '⛅' : '☁️' };
    if (c === 3) return { conditionTh: 'มีเมฆมาก', emoji: '☁️' };
    if (c === 45 || c === 48) return { conditionTh: 'มีหมอก', emoji: '🌫️' };
    if (c >= 51 && c <= 55) return { conditionTh: 'ฝนปรอยๆ', emoji: '🌦️' };
    if (c === 56 || c === 57) return { conditionTh: 'ฝนปรอยเย็นจัด', emoji: '🌧️' };
    if (c === 61) return { conditionTh: 'ฝนตกเล็กน้อย', emoji: '🌦️' };
    if (c === 63) return { conditionTh: 'ฝนตกปานกลาง', emoji: '🌧️' };
    if (c === 65) return { conditionTh: 'ฝนตกหนัก', emoji: '🌧️' };
    if (c === 66 || c === 67) return { conditionTh: 'ฝนเย็นจัด', emoji: '🌧️' };
    if (c >= 71 && c <= 77) return { conditionTh: 'หิมะ/ลูกเห็บ', emoji: '❄️' };
    if (c === 80) return { conditionTh: 'ฝนซู่เล็กน้อย', emoji: '🌦️' };
    if (c === 81) return { conditionTh: 'ฝนซู่ปานกลาง', emoji: '🌧️' };
    if (c === 82) return { conditionTh: 'ฝนซู่หนัก', emoji: '⛈️' };
    if (c === 85 || c === 86) return { conditionTh: 'หิมะตกหนัก', emoji: '❄️' };
    if (c === 95) return { conditionTh: 'พายุฝนฟ้าคะนอง', emoji: '⛈️' };
    if (c === 96 || c === 99) return { conditionTh: 'พายุฝนฟ้าคะนองและลูกเห็บ', emoji: '⛈️' };
    return { conditionTh: 'สภาพอากาศทั่วไป', emoji: day ? '🌤️' : '🌙' };
}

// ── Family / Guest Role Helpers ──────────────────────────────────────────────

function resolveRole(session) {
    if (session && String(session.role || '').toLowerCase() === 'family') {
        return 'family';
    }
    return 'admin';
}

function timingSafeTextEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

/**
 * Opt-in Family password verification.
 * Returns false if DASH_FAMILY_PASS is unset, empty, or shorter than 4 chars.
 */
function checkFamilyPassword(password, env = {}) {
    const familyPass = String((env && (env.DASH_FAMILY_PASS || env.FAMILY_AUTH_PASS)) || '').trim();
    if (!familyPass || familyPass.length < 4) return false;
    if (typeof password !== 'string' || !password) return false;
    return timingSafeTextEqual(password, familyPass);
}

const FAMILY_ALLOWED_GET_EXACT = new Set([
    '/',
    '/index.html',
    '/login',
    '/auth',
    '/api/session',
    '/api/launcher',
    '/api/launcher/badges',
    '/api/weather',
    '/api/overview',
    '/api/energy',
    '/api/energy/history',
    '/manifest.json',
    '/sw.js',
    '/favicon.ico',
]);

const FAMILY_ALLOWED_GET_PREFIXES = [
    '/icons/',
    '/homeassistant',
    '/obsidian',
    '/video-studio',
    '/api/gemini/local-file',
    '/api/gemini/local-image',
];

const STATIC_ASSET_EXT_RE = /\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?|json)$/i;

/**
 * Checks whether a Family/Guest session is allowed to access a given HTTP method + path.
 * Strict allowlist: blocks all admin/mutating APIs, terminal, docker, pm2, ports, wireguard, etc.
 */
function isFamilyAllowedRequest(method, pathname) {
    const m = String(method || 'GET').toUpperCase();
    const p = String(pathname || '/');

    if (p === '/api/login' || p === '/api/logout') return true;
    if (m !== 'GET' && m !== 'HEAD') return false;

    if (FAMILY_ALLOWED_GET_EXACT.has(p)) return true;
    if (FAMILY_ALLOWED_GET_PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
    if (!p.startsWith('/api/') && STATIC_ASSET_EXT_RE.test(p)) return true;

    return false;
}

// ── Main Factory ─────────────────────────────────────────────────────────────

function createDashboardHubManager(deps = {}) {
    const launcherFile = deps.launcherFile || DEFAULT_LAUNCHER_FILE;
    const tailHost = deps.tailHost || DEFAULT_TAIL_HOST;
    const botHealthUrl = deps.botHealthUrl || DEFAULT_BOT_HEALTH_URL;
    const weatherCoords = { ...DEFAULT_RUESO_COORDS, ...(deps.weatherCoords || {}) };
    const nowFn = typeof deps.now === 'function' ? deps.now : () => Date.now();
    const fetchFn = typeof deps.fetch === 'function'
        ? deps.fetch
        : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    const dockerReq = typeof deps.dockerReq === 'function'
        ? deps.dockerReq
        : defaultDockerReq(deps.dockerSock || DEFAULT_DOCKER_SOCK);
    const execFn = typeof deps.execFileAsync === 'function' ? deps.execFileAsync : execFileAsync;
    const idGen = typeof deps.generateBookmarkId === 'function'
        ? deps.generateBookmarkId
        : () => `bm_${crypto.randomBytes(5).toString('hex')}`;

    const builtinApps = enrichBuiltinApps(deps.links || []);
    const builtinIdSet = new Set(builtinApps.map((a) => a.id));
    const defaultPinned = Array.isArray(deps.defaultPinned) && deps.defaultPinned.length
        ? deps.defaultPinned.slice(0, LAUNCHER_MAX_PINNED)
        : DEFAULT_PINNED.slice();

    const DISCOVERY_TTL_MS = Number(deps.discoveryTtlMs) || 15_000;
    const BADGES_TTL_MS = Number(deps.badgesTtlMs) || 10_000;
    const BOT_DB_TTL_MS = Number(deps.botDbTtlMs) || 15_000;
    const WEATHER_TTL_MS = Number(deps.weatherTtlMs) || 15 * 60 * 1000;

    let writeQueue = Promise.resolve();
    let discoveryCache = { at: 0, items: null };
    let badgesCache = { at: 0, data: null };
    let botDbCache = { at: 0, data: null };
    let weatherCache = { at: 0, data: null };

    // ── Config Storage (pinned + bookmarks) ──────────────────────────────────

    function sanitizeBookmark(raw, existing = null) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            const err = new Error('Invalid bookmark payload');
            err.statusCode = 400;
            throw err;
        }
        const label = sanitizeText(raw.label !== undefined ? raw.label : (existing && existing.label), 80);
        if (!label) {
            const err = new Error('Bookmark label is required');
            err.statusCode = 400;
            throw err;
        }
        const rawUrl = raw.url !== undefined ? raw.url : (existing && existing.url);
        const url = sanitizeUrl(rawUrl);
        if (!url) {
            const err = new Error('Bookmark URL must start with http://, https://, /, #, or \\\\');
            err.statusCode = 400;
            throw err;
        }
        const icon = sanitizeText(raw.icon !== undefined ? raw.icon : (existing ? existing.icon : 'globe'), 32) || 'globe';
        const emoji = sanitizeText(raw.emoji !== undefined ? raw.emoji : (existing ? existing.emoji : '🔖'), 8) || '🔖';
        const group = sanitizeText(raw.group !== undefined ? raw.group : (existing ? existing.group : 'Custom'), 40) || 'Custom';
        const description = sanitizeText(raw.description !== undefined ? raw.description : (existing ? existing.description : ''), 200);
        const openInWorkspace = raw.openInWorkspace !== undefined
            ? parseBool(raw.openInWorkspace, false)
            : (raw.embed !== undefined ? parseBool(raw.embed, false) : Boolean(existing && existing.openInWorkspace));
        const family = raw.family !== undefined
            ? parseBool(raw.family, false)
            : Boolean(existing && existing.family);

        const nowIso = new Date(nowFn()).toISOString();
        return {
            id: existing ? existing.id : idGen(),
            label,
            url,
            icon,
            emoji,
            group,
            description,
            source: 'bookmark',
            embed: openInWorkspace,
            openInWorkspace,
            family,
            createdAt: (existing && existing.createdAt) || nowIso,
            updatedAt: nowIso,
        };
    }

    async function readConfig() {
        try {
            const raw = await fsp.readFile(launcherFile, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { pinned: defaultPinned.slice(), bookmarks: [] };
            }
            const pinned = Array.isArray(parsed.pinned)
                ? parsed.pinned.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
                : defaultPinned.slice();
            const rawBookmarks = Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [];
            const bookmarks = [];
            const seenBm = new Set();
            for (const bm of rawBookmarks) {
                if (!bm || typeof bm !== 'object' || !bm.id || !bm.label || !bm.url) continue;
                const url = sanitizeUrl(bm.url);
                if (!url) continue;
                const id = sanitizeText(bm.id, 64);
                if (!id || seenBm.has(id)) continue;
                seenBm.add(id);
                bookmarks.push({
                    id,
                    label: sanitizeText(bm.label, 80),
                    url,
                    icon: sanitizeText(bm.icon || 'globe', 32) || 'globe',
                    emoji: sanitizeText(bm.emoji || '🔖', 8) || '🔖',
                    group: sanitizeText(bm.group || 'Custom', 40) || 'Custom',
                    description: sanitizeText(bm.description || '', 200),
                    source: 'bookmark',
                    embed: Boolean(bm.openInWorkspace ?? bm.embed),
                    openInWorkspace: Boolean(bm.openInWorkspace ?? bm.embed),
                    family: Boolean(bm.family),
                    createdAt: bm.createdAt || null,
                    updatedAt: bm.updatedAt || null,
                });
            }
            return { pinned, bookmarks };
        } catch (_) {
            return { pinned: defaultPinned.slice(), bookmarks: [] };
        }
    }

    async function writeConfig(nextConfig) {
        const payload = JSON.stringify({
            pinned: nextConfig.pinned,
            bookmarks: nextConfig.bookmarks,
            updatedAt: new Date(nowFn()).toISOString(),
        }, null, 2) + '\n';

        writeQueue = writeQueue.then(async () => {
            await fsp.mkdir(path.dirname(launcherFile), { recursive: true });
            const tmpFile = `${launcherFile}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
            try {
                await fsp.writeFile(tmpFile, payload, 'utf8');
                await fsp.rename(tmpFile, launcherFile);
            } catch (err) {
                await fsp.unlink(tmpFile).catch(() => {});
                throw err;
            }
        });
        await writeQueue;
        return nextConfig;
    }

    // ── Docker Auto-Discovery ────────────────────────────────────────────────

    async function discoverDockerApps(opts = {}) {
        const force = Boolean(opts.force);
        const now = nowFn();
        if (!force && discoveryCache.items && (now - discoveryCache.at) < DISCOVERY_TTL_MS) {
            return discoveryCache.items;
        }
        try {
            const res = await dockerReq('GET', '/containers/json?all=1');
            const list = Array.isArray(res && res.data) ? res.data : [];
            const discovered = [];
            const seenIds = new Set();
            for (const c of list) {
                const app = parseDockerLabelsToApp(c, { tailHost, builtinIdSet });
                if (!app || seenIds.has(app.id)) continue;
                seenIds.add(app.id);
                discovered.push(app);
            }
            discovered.sort((a, b) => a.label.localeCompare(b.label));
            discoveryCache = { at: now, items: discovered };
            return discovered;
        } catch (_) {
            return discoveryCache.items || [];
        }
    }

    // ── Pinned & Bookmarks Operations ────────────────────────────────────────

    async function sanitizePinnedAgainstAll(pinnedList, bookmarks, discovered) {
        const validIds = new Set([
            ...builtinApps.map((a) => a.id),
            ...(bookmarks || []).map((b) => b.id),
            ...(discovered || []).map((d) => d.id),
        ]);
        const seen = new Set();
        const clean = [];
        for (const item of (Array.isArray(pinnedList) ? pinnedList : [])) {
            if (typeof item !== 'string') continue;
            const id = item.trim();
            if (!id || seen.has(id)) continue;
            if (!validIds.has(id)) continue;
            seen.add(id);
            clean.push(id);
            if (clean.length >= LAUNCHER_MAX_PINNED) break;
        }
        return clean;
    }

    async function setPinned(pinned, opts = {}) {
        const cfg = await readConfig();
        const discovered = await discoverDockerApps();
        const rawList = opts.reset === true ? defaultPinned : pinned;
        if (!Array.isArray(rawList) || !rawList.every((id) => typeof id === 'string')) {
            const err = new Error('pinned must be an array of strings');
            err.statusCode = 400;
            throw err;
        }
        const clean = await sanitizePinnedAgainstAll(rawList, cfg.bookmarks, discovered);
        await writeConfig({ pinned: clean, bookmarks: cfg.bookmarks });
        return { ok: true, pinned: clean };
    }

    async function listBookmarks(opts = {}) {
        const role = resolveRole(opts.role ? { role: opts.role } : opts.session);
        const cfg = await readConfig();
        const bookmarks = role === 'family'
            ? cfg.bookmarks.filter((b) => b.family)
            : cfg.bookmarks;
        return { ok: true, bookmarks };
    }

    async function createBookmark(body) {
        const cfg = await readConfig();
        if (cfg.bookmarks.length >= MAX_BOOKMARKS) {
            const err = new Error(`Maximum ${MAX_BOOKMARKS} bookmarks reached`);
            err.statusCode = 400;
            throw err;
        }
        const bookmark = sanitizeBookmark(body, null);
        const nextBookmarks = [...cfg.bookmarks, bookmark];
        await writeConfig({ pinned: cfg.pinned, bookmarks: nextBookmarks });
        return { ok: true, bookmark, bookmarks: nextBookmarks };
    }

    async function updateBookmark(id, body) {
        const cleanId = sanitizeText(id, 64);
        const cfg = await readConfig();
        const idx = cfg.bookmarks.findIndex((b) => b.id === cleanId);
        if (idx === -1) {
            const err = new Error('Bookmark not found');
            err.statusCode = 404;
            throw err;
        }
        const updated = sanitizeBookmark(body, cfg.bookmarks[idx]);
        const nextBookmarks = cfg.bookmarks.slice();
        nextBookmarks[idx] = updated;
        await writeConfig({ pinned: cfg.pinned, bookmarks: nextBookmarks });
        return { ok: true, bookmark: updated, bookmarks: nextBookmarks };
    }

    async function deleteBookmark(id) {
        const cleanId = sanitizeText(id, 64);
        const cfg = await readConfig();
        const idx = cfg.bookmarks.findIndex((b) => b.id === cleanId);
        if (idx === -1) {
            const err = new Error('Bookmark not found');
            err.statusCode = 404;
            throw err;
        }
        const nextBookmarks = cfg.bookmarks.filter((b) => b.id !== cleanId);
        const nextPinned = cfg.pinned.filter((pid) => pid !== cleanId);
        await writeConfig({ pinned: nextPinned, bookmarks: nextBookmarks });
        return { ok: true, id: cleanId, bookmarks: nextBookmarks };
    }

    // ── Live API Badges ──────────────────────────────────────────────────────

    async function queryBotMongoStats() {
        const now = nowFn();
        if (botDbCache.data && (now - botDbCache.at) < BOT_DB_TTL_MS) {
            return botDbCache.data;
        }
        if (typeof deps.queryBotDb === 'function') {
            try {
                const res = await deps.queryBotDb();
                botDbCache = { at: now, data: res };
                return res;
            } catch (_) {
                return botDbCache.data || null;
            }
        }
        try {
            // Compute start of today in Asia/Bangkok (+07:00)
            const bkkOffsetMs = 7 * 60 * 60 * 1000;
            const bkkNow = new Date(now + bkkOffsetMs);
            const bkkDayStartUtcMs = Date.UTC(bkkNow.getUTCFullYear(), bkkNow.getUTCMonth(), bkkNow.getUTCDate()) - bkkOffsetMs;
            const dayStartIso = new Date(bkkDayStartUtcMs).toISOString();

            const mongoScript = `
              const start = new Date("${dayStartIso}");
              const openPositions = db.bots.countDocuments({ $or: [
                { "position.qty": { $gt: 0 } },
                { "positions.0": { $exists: true } },
                { status: "holding" },
                { isHolding: true }
              ]});
              const enabledBots = db.bots.countDocuments({ enabled: true });
              const trades = db.trades.find({ createdAt: { $gte: start } }, { realizedPnl: 1, profitUsdt: 1, netProfit: 1, pnl: 1 }).toArray();
              let todayPnlUsdt = 0, todayTrades = 0, todayWins = 0;
              for (const t of trades) {
                const p = Number(t.realizedPnl ?? t.profitUsdt ?? t.netProfit ?? t.pnl);
                if (Number.isFinite(p)) {
                  todayTrades++;
                  todayPnlUsdt += p;
                  if (p > 0) todayWins++;
                }
              }
              print(JSON.stringify({ openPositions, enabledBots, todayPnlUsdt: +todayPnlUsdt.toFixed(4), todayTrades, todayWins }));
            `.replace(/\s+/g, ' ').trim();

            const r = await execFn('docker', [
                'exec', 'lab-mongodb', 'sh', '-c',
                `mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin onepercentbottrade --quiet --eval '${mongoScript}'`,
            ], { timeout: 4000 });

            if (r.code !== 0) return botDbCache.data || null;
            const lastLine = r.stdout.trim().split('\n').pop();
            const parsed = JSON.parse(lastLine);
            botDbCache = { at: now, data: parsed };
            return parsed;
        } catch (_) {
            return botDbCache.data || null;
        }
    }

    async function collectBotBadge() {
        let health = null;
        if (fetchFn) {
            try {
                const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                const timer = controller ? setTimeout(() => controller.abort(), 2000) : null;
                try {
                    const resp = await fetchFn(botHealthUrl, controller ? { signal: controller.signal } : undefined);
                    if (resp && resp.ok) {
                        health = await resp.json();
                    }
                } finally {
                    if (timer) clearTimeout(timer);
                }
            } catch (_) {
                health = null;
            }
        }

        const dbStats = await queryBotMongoStats();
        const up = Boolean(health);
        const botMgr = (health && health.components && health.components.botManager) || {};
        const overall = String((health && health.overall) || (up ? 'ok' : 'offline'));
        const running = Boolean(botMgr.running);
        const openPositions = Number((dbStats && dbStats.openPositions) ?? botMgr.activeTraders) || 0;
        const todayPnlUsdt = Number((dbStats && dbStats.todayPnlUsdt) || 0);
        const todayTrades = Number((dbStats && dbStats.todayTrades) || 0);
        const todayWins = Number((dbStats && dbStats.todayWins) || 0);

        if (!up && !dbStats) {
            return {
                text: 'ออฟไลน์',
                tone: 'err',
                up: false,
                running: false,
                overall: 'offline',
                openPositions: 0,
                todayPnlUsdt: 0,
                todayTrades: 0,
                todayWins: 0,
            };
        }

        const sign = todayPnlUsdt > 0 ? '+' : (todayPnlUsdt < 0 ? '-' : '');
        const absPnl = Math.abs(todayPnlUsdt);
        const pnlStr = `${sign}$${absPnl >= 100 ? absPnl.toFixed(0) : absPnl.toFixed(2)}`;
        const text = (openPositions > 0 || todayTrades > 0)
            ? `${openPositions} ไม้ · ${pnlStr}`
            : (running ? `รันอยู่ · ${pnlStr}` : 'สแตนด์บาย');

        let tone = 'neutral';
        if (!up) tone = 'err';
        else if (todayPnlUsdt > 0) tone = 'ok';
        else if (todayPnlUsdt < 0) tone = 'warn';
        else if (running || overall === 'healthy' || overall === 'ok') tone = 'ok';
        else if (overall === 'degraded') tone = 'warn';

        return {
            text,
            tone,
            up,
            running,
            overall,
            openPositions,
            todayPnlUsdt: +todayPnlUsdt.toFixed(4),
            todayTrades,
            todayWins,
        };
    }

    async function getBadges(opts = {}) {
        const force = Boolean(opts.force);
        const now = nowFn();
        if (!force && badgesCache.data && (now - badgesCache.at) < BADGES_TTL_MS) {
            return badgesCache.data;
        }

        const badges = {};

        const [summary, botBadge, hubStatus, hubJobs, aiSess, liveRuns, videoRes, discovered] = await Promise.all([
            typeof deps.buildSummary === 'function' ? deps.buildSummary().catch(() => null) : Promise.resolve(null),
            collectBotBadge().catch(() => null),
            (deps.agentHubManager && typeof deps.agentHubManager.getHubStatus === 'function')
                ? Promise.resolve(deps.agentHubManager.getHubStatus()).catch(() => null)
                : Promise.resolve(null),
            (deps.agentHubManager && typeof deps.agentHubManager.listJobs === 'function')
                ? Promise.resolve(deps.agentHubManager.listJobs({ limit: 30 })).catch(() => [])
                : Promise.resolve([]),
            (deps.geminiManager && typeof deps.geminiManager.listSessions === 'function')
                ? Promise.resolve(deps.geminiManager.listSessions()).catch(() => null)
                : Promise.resolve(null),
            (deps.audit && typeof deps.audit.liveRuns === 'function')
                ? Promise.resolve(deps.audit.liveRuns()).catch(() => [])
                : Promise.resolve([]),
            (deps.videoStudioManager && typeof deps.videoStudioManager.listJobs === 'function')
                ? Promise.resolve(deps.videoStudioManager.listJobs(30)).catch(() => null)
                : Promise.resolve(null),
            discoverDockerApps().catch(() => []),
        ]);

        // 1. OnePercentBotTrade
        if (botBadge) {
            badges.onepercentbot = botBadge;
        }

        // 2. Agent Hub
        if (hubStatus && Array.isArray(hubStatus.nodes)) {
            const total = hubStatus.nodes.length;
            const online = hubStatus.nodes.filter((n) => n && n.online).length;
            const jobsArr = Array.isArray(hubJobs) ? hubJobs : (Array.isArray(hubStatus.renderJobs) ? hubStatus.renderJobs : []);
            const activeJobs = jobsArr.filter((j) => j && !TERMINAL_JOB_STATUSES.has(String(j.status || '').toLowerCase())).length;
            badges['agent-hub'] = {
                text: activeJobs > 0 ? `${online}/${total} · ${activeJobs} งาน` : `${online}/${total} ออนไลน์`,
                tone: activeJobs > 0 ? 'info' : (online > 0 ? 'ok' : (total > 0 ? 'warn' : 'neutral')),
                up: online > 0,
                online,
                total,
                activeJobs,
            };
        }

        // 3. Uptime Kuma
        if (summary && summary.kuma) {
            const total = Number(summary.kuma.total) || 0;
            const upCount = Number(summary.kuma.up) || 0;
            const downCount = Number(summary.kuma.down) || Math.max(0, total - upCount);
            badges.kuma = {
                text: downCount > 0 ? `${upCount}/${total} · ${downCount} DOWN` : `${upCount}/${total} UP`,
                tone: downCount > 0 ? 'err' : (total > 0 ? 'ok' : 'neutral'),
                up: total > 0 && downCount === 0,
                upCount,
                total,
                downCount,
            };
        }

        // 4. Energy (PZEM-01)
        if (summary && summary.energy && !summary.energy.error) {
            const rt = summary.energy.realtime || {};
            const today = summary.energy.today || {};
            const month = summary.energy.this_month || {};
            const watts = Number(rt.power_watts);
            const todayKwh = Number(today.energy_kwh);
            const todayCostThb = Number(today.cost_thb);
            const monthCostThb = Number(month.cost_thb);
            const hasWatts = Number.isFinite(watts);
            const wattsStr = hasWatts ? `${Math.round(watts).toLocaleString('en-US')}W` : '—';
            const costStr = Number.isFinite(todayCostThb) ? ` · ฿${Math.round(todayCostThb)}` : '';
            badges.energy = {
                text: `${wattsStr}${costStr}`,
                tone: !hasWatts ? 'neutral' : (watts >= 4000 ? 'err' : (watts >= 2500 ? 'warn' : 'ok')),
                up: hasWatts,
                watts: hasWatts ? Math.round(watts) : null,
                todayKwh: Number.isFinite(todayKwh) ? +todayKwh.toFixed(2) : null,
                todayCostThb: Number.isFinite(todayCostThb) ? +todayCostThb.toFixed(2) : null,
                monthCostThb: Number.isFinite(monthCostThb) ? +monthCostThb.toFixed(2) : null,
            };
        }

        // 5. AI Chat
        if (aiSess || (Array.isArray(liveRuns) && liveRuns.length)) {
            const runningSet = new Set(Array.isArray(aiSess && aiSess.runningSessionIds) ? aiSess.runningSessionIds : []);
            for (const r of (Array.isArray(liveRuns) ? liveRuns : [])) {
                if (r && (r.sessionId || r.jobId)) runningSet.add(r.sessionId || r.jobId);
            }
            const running = runningSet.size;
            const unread = Array.isArray(aiSess && aiSess.unreadSessionIds) ? aiSess.unreadSessionIds.length : 0;
            const totalSessions = Array.isArray(aiSess && aiSess.sessions) ? aiSess.sessions.length : 0;
            badges.chat = {
                text: running > 0 ? `${running} กำลังรัน` : (unread > 0 ? `${unread} ยังไม่อ่าน` : 'พร้อม'),
                tone: running > 0 ? 'info' : (unread > 0 ? 'warn' : 'ok'),
                up: true,
                running,
                unread,
                totalSessions,
            };
        }

        // 6. Video Studio
        if (videoRes && Array.isArray(videoRes.jobs)) {
            const jobs = videoRes.jobs;
            const active = jobs.filter((j) => j && (j.alive || ACTIVE_VIDEO_STATUSES.has(String(j.status || '').toLowerCase()))).length;
            const completed = jobs.filter((j) => j && String(j.status || '').toLowerCase() === 'done').length;
            badges['video-studio'] = {
                text: active > 0 ? `${active} กำลังเรนเดอร์` : `${completed} คลิป`,
                tone: active > 0 ? 'info' : 'ok',
                up: true,
                active,
                completed,
            };
        }

        // 7. Docker (Portainer)
        if (summary && summary.docker) {
            const total = Number(summary.docker.total) || 0;
            const running = Number(summary.docker.running) || 0;
            const stopped = Number(summary.docker.stopped) || Math.max(0, total - running);
            badges.portainer = {
                text: stopped > 0 ? `${running}/${total} · ${stopped} หยุด` : `${running}/${total} รัน`,
                tone: stopped > 0 ? 'warn' : (total > 0 ? 'ok' : 'neutral'),
                up: total > 0 && stopped === 0,
                running,
                stopped,
                total,
            };
        }

        // 8. PM2
        if (summary && summary.pm2) {
            const total = Number(summary.pm2.total) || 0;
            const online = Number(summary.pm2.online) || 0;
            const down = Math.max(0, total - online);
            badges.pm2 = {
                text: down > 0 ? `${online}/${total} · ${down} หยุด` : `${online}/${total} OK`,
                tone: down > 0 ? 'err' : (total > 0 ? 'ok' : 'neutral'),
                up: total > 0 && down === 0,
                online,
                total,
                down,
            };
        }

        // 9. Service probes -> remaining builtin apps
        const probeToAppId = {
            wireguard: 'wireguard',
            emqx: 'emqx',
            cockpit: 'cockpit',
            'mongo-express': 'mongo',
            filebrowser: 'filebrowser',
            obsidian: 'obsidian',
            homeassistant: 'homeassistant',
            zigbee2mqtt: 'zigbee2mqtt',
        };
        const svcItems = Array.isArray(summary && summary.services && summary.services.items) ? summary.services.items : [];
        for (const s of svcItems) {
            if (!s || !s.id) continue;
            const appId = probeToAppId[s.id];
            if (!appId || badges[appId]) continue;
            badges[appId] = {
                text: s.up ? (s.latencyMs != null ? `${s.latencyMs}ms` : 'UP') : 'DOWN',
                tone: s.up ? 'ok' : 'err',
                up: Boolean(s.up),
                latencyMs: s.latencyMs ?? null,
            };
        }

        // 10. Discovered Docker apps badges
        for (const d of (Array.isArray(discovered) ? discovered : [])) {
            if (!d || !d.id || badges[d.id]) continue;
            const isUp = d.containerState === 'running';
            badges[d.id] = {
                text: isUp ? 'RUNNING' : String(d.containerState || 'stopped').toUpperCase(),
                tone: isUp ? 'ok' : 'err',
                up: isUp,
                state: d.containerState,
            };
        }

        const result = {
            ok: true,
            generatedAt: new Date(now).toISOString(),
            badges,
        };
        badgesCache = { at: now, data: result };
        return result;
    }

    // ── Weather (อ.รือเสาะ จ.นราธิวาส via Open-Meteo) ────────────────────────

    async function getWeather(opts = {}) {
        const force = Boolean(opts.force);
        const now = nowFn();
        if (!force && weatherCache.data && (now - weatherCache.at) < WEATHER_TTL_MS) {
            return { ...weatherCache.data, cached: true, stale: false };
        }

        const lat = Number(opts.lat ?? weatherCoords.lat);
        const lon = Number(opts.lon ?? weatherCoords.lon);
        const tz = String(opts.timezone || weatherCoords.timezone || 'Asia/Bangkok');
        const locName = String(opts.name || weatherCoords.name || DEFAULT_RUESO_COORDS.name);

        const apiUrl = `https://api.open-meteo.com/v1/forecast`
            + `?latitude=${encodeURIComponent(lat)}`
            + `&longitude=${encodeURIComponent(lon)}`
            + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,is_day`
            + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max`
            + `&timezone=${encodeURIComponent(tz)}`
            + `&forecast_days=4`;

        if (!fetchFn) {
            return {
                ok: false,
                cached: false,
                stale: true,
                error: 'fetch unavailable',
                location: { name: locName, lat, lon, timezone: tz },
                fetchedAt: new Date(now).toISOString(),
                current: null,
                daily: [],
            };
        }

        try {
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
            let payload;
            try {
                const resp = await fetchFn(apiUrl, controller ? { signal: controller.signal } : undefined);
                if (!resp || !resp.ok) {
                    throw new Error(`Open-Meteo HTTP ${resp ? resp.status : 'error'}`);
                }
                payload = await resp.json();
            } finally {
                if (timer) clearTimeout(timer);
            }

            const cur = (payload && payload.current) || {};
            const isDay = cur.is_day !== 0;
            const curMeta = mapWmoCodeToThai(cur.weather_code, isDay);

            const dailyRaw = (payload && payload.daily) || {};
            const dates = Array.isArray(dailyRaw.time) ? dailyRaw.time : [];
            const daily = dates.map((date, idx) => {
                const code = Array.isArray(dailyRaw.weather_code) ? dailyRaw.weather_code[idx] : 0;
                const dMeta = mapWmoCodeToThai(code, true);
                return {
                    date,
                    tempMaxC: Array.isArray(dailyRaw.temperature_2m_max) ? Number(dailyRaw.temperature_2m_max[idx]) : null,
                    tempMinC: Array.isArray(dailyRaw.temperature_2m_min) ? Number(dailyRaw.temperature_2m_min[idx]) : null,
                    precipProbPct: Array.isArray(dailyRaw.precipitation_probability_max) ? Number(dailyRaw.precipitation_probability_max[idx]) : null,
                    weatherCode: Number(code) || 0,
                    conditionTh: dMeta.conditionTh,
                    emoji: dMeta.emoji,
                };
            });

            const data = {
                ok: true,
                location: { name: locName, lat, lon, timezone: tz },
                fetchedAt: new Date(now).toISOString(),
                cached: false,
                stale: false,
                current: {
                    tempC: cur.temperature_2m != null ? Number(cur.temperature_2m) : null,
                    feelsLikeC: cur.apparent_temperature != null ? Number(cur.apparent_temperature) : null,
                    humidityPct: cur.relative_humidity_2m != null ? Number(cur.relative_humidity_2m) : null,
                    windKmh: cur.wind_speed_10m != null ? Number(cur.wind_speed_10m) : null,
                    rainMm: cur.rain != null ? Number(cur.rain) : (cur.precipitation != null ? Number(cur.precipitation) : 0),
                    weatherCode: Number(cur.weather_code) || 0,
                    isDay,
                    conditionTh: curMeta.conditionTh,
                    emoji: curMeta.emoji,
                },
                daily,
            };

            weatherCache = { at: now, data };
            return data;
        } catch (err) {
            if (weatherCache.data) {
                return { ...weatherCache.data, cached: true, stale: true, error: String(err.message || err) };
            }
            return {
                ok: false,
                location: { name: locName, lat, lon, timezone: tz },
                fetchedAt: new Date(now).toISOString(),
                cached: false,
                stale: true,
                error: String(err.message || err),
                current: null,
                daily: [],
            };
        }
    }

    // ── Unified Launcher Payload ─────────────────────────────────────────────

    async function getLauncher(opts = {}) {
        const role = resolveRole(opts.role ? { role: opts.role } : opts.session);
        const includeBadges = opts.includeBadges !== false;

        const [cfg, discovered, badgeRes] = await Promise.all([
            readConfig(),
            discoverDockerApps(),
            includeBadges ? getBadges().catch(() => ({ badges: {} })) : Promise.resolve({ badges: {} }),
        ]);

        const allApps = [...builtinApps, ...discovered, ...cfg.bookmarks];
        const filteredApps = role === 'family' ? allApps.filter((a) => a.family) : allApps;
        const allowedIds = new Set(filteredApps.map((a) => a.id));

        const filteredBookmarks = role === 'family'
            ? cfg.bookmarks.filter((b) => b.family)
            : cfg.bookmarks;
        const filteredDiscovered = role === 'family'
            ? discovered.filter((d) => d.family)
            : discovered;

        const sanitizedPinned = await sanitizePinnedAgainstAll(cfg.pinned, cfg.bookmarks, discovered);
        const pinned = role === 'family'
            ? sanitizedPinned.filter((id) => allowedIds.has(id))
            : sanitizedPinned;
        const defaults = role === 'family'
            ? defaultPinned.filter((id) => allowedIds.has(id))
            : defaultPinned.slice();

        const rawBadges = (badgeRes && badgeRes.badges) || {};
        const badges = role === 'family'
            ? Object.fromEntries(Object.entries(rawBadges).filter(([k]) => allowedIds.has(k)))
            : rawBadges;

        return {
            ok: true,
            pinned,
            defaults,
            role,
            apps: filteredApps,
            bookmarks: filteredBookmarks,
            discovered: filteredDiscovered,
            badges,
        };
    }

    function getRoleConfig(env = {}) {
        const familyPass = String((env && (env.DASH_FAMILY_PASS || env.FAMILY_AUTH_PASS)) || '').trim();
        return {
            familyEnabled: familyPass.length >= 4,
            familyUser: String((env && env.DASH_FAMILY_USER) || 'family').trim() || 'family',
        };
    }

    function resetCache() {
        discoveryCache = { at: 0, items: null };
        badgesCache = { at: 0, data: null };
        botDbCache = { at: 0, data: null };
        weatherCache = { at: 0, data: null };
    }

    return {
        getLauncher,
        setPinned,
        listBookmarks,
        createBookmark,
        updateBookmark,
        deleteBookmark,
        getBadges,
        collectBotBadge,
        discoverDockerApps,
        getWeather,
        getRoleConfig,
        checkFamilyPassword,
        isFamilyAllowedRequest,
        resolveRole,
        resetCache,
    };
}

module.exports = {
    createDashboardHubManager,
    sanitizeUrl,
    mapWmoCodeToThai,
    parseDockerLabelsToApp,
    enrichBuiltinApps,
    resolveRole,
    isFamilyAllowedRequest,
    checkFamilyPassword,
    DEFAULT_RUESO_COORDS,
    DEFAULT_FAMILY_APP_IDS,
    DEFAULT_PINNED,
    LAUNCHER_MAX_PINNED,
    MAX_BOOKMARKS,
};
