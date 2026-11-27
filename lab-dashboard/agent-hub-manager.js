'use strict';

/**
 * agent-hub-manager.js
 * -----------------------------------------------------------------------------
 * Central Control Hub for Homelab Worker Agents (homelab-agent.exe / Linux / macOS).
 *
 * Responsibilities:
 *  - Persistent token & node registry in HUB_ROOT (default /home/dev/.gemini/agent-hub/,
 *    override via env AGENT_HUB_ROOT; set AGENT_HUB_SKIP_SIDE_EFFECTS=1 to skip iptables/auto-compile on init)
 *  - On-demand & startup Go cross-compilation of homelab-agent.exe (Windows amd64),
 *    homelab-agent-linux-amd64, and homelab-agent-darwin-arm64 with baked-in token & URLs
 *  - Heartbeat ingestion (5s live telemetry: CPU, RAM, GPU, VRAM, Disks, Capabilities)
 *  - Instant Long-Polling + Command Queue RPC dispatcher (exec, fs.*, sysinfo, render.*, job.run, job.cancel, self-update)
 *  - Distributed Render & Generic Job Runner (POST/GET /api/agent-hub/jobs, cancel, result tar.gz,
 *    per-node maxJobs pending queue, live log tail, and offline/timeout watchdog)
 *  - PowerShell 1-liner installer (/api/agent-hub/install.ps1) & Bash installer (/api/agent-hub/install.sh)
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const audit = require('./audit-logger');

const HUB_ROOT = process.env.AGENT_HUB_ROOT
    ? path.resolve(process.env.AGENT_HUB_ROOT)
    : '/home/dev/.gemini/agent-hub';
const SKIP_SIDE_EFFECTS =
    process.env.AGENT_HUB_SKIP_SIDE_EFFECTS === '1' ||
    String(process.env.AGENT_HUB_SKIP_SIDE_EFFECTS || '').toLowerCase() === 'true';
const BIN_DIR = path.join(HUB_ROOT, 'bin');
const JOBS_DIR = path.join(HUB_ROOT, 'jobs');
const BUNDLES_DIR = path.join(HUB_ROOT, 'bundles');
const MOTION_STUDIO_DIR = '/home/dev/.local/share/motion-studio';
const CONFIG_PATH = path.join(HUB_ROOT, 'config.json');
const NODES_PATH = path.join(HUB_ROOT, 'nodes.json');
const JOBS_PATH = path.join(HUB_ROOT, 'jobs.json');

const AGENT_SRC_DIR = '/home/dev/projects/homelab-agent';
const GO_BIN = fs.existsSync('/home/dev/.local/bin/go')
    ? '/home/dev/.local/bin/go'
    : '/home/dev/.local/go/bin/go';

const DEFAULT_TOKEN = 'hlag_7f8e9a2b4c6d1e3f5a7b9c0d2e4f6a8b';
const DEFAULT_HUB_URLS = [
    'https://homelab.tail285279.ts.net',
    'http://100.93.214.79',
    'http://100.93.214.79:8090',
    'http://192.168.1.123',
    'https://192.168.1.123',
];

const ONLINE_THRESHOLD_MS = 18000; // 18 seconds (3.5 heartbeats)
const JOB_WATCHDOG_INTERVAL_MS = 10000; // 10 seconds
const JOB_NODE_LOST_MS = Math.max(20000, Number(process.env.AGENT_HUB_LOST_MS) || 45000);
const JOB_CANCELLING_GRACE_MS = 20000;
const GENERIC_INPUT_ALLOWED_ROOTS = ['/home/dev/projects/', '/home/dev/.gemini/', '/tmp/'];
const MAX_JOB_INPUT_TAR_BYTES = 500 * 1024 * 1024;
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'lost', 'timeout', 'timed_out', 'cancelled']);
const ACTIVE_DISPATCHED_STATUSES = new Set([
    'queued',
    'downloading',
    'installing',
    'setup',
    'rendering',
    'running',
    'collecting',
    'uploading',
    'cancelling',
]);

let jobWatchdogTimer = null;

let hubConfig = {
    token: DEFAULT_TOKEN,
    hubUrls: DEFAULT_HUB_URLS,
    agentVersion: '1.2.0',
    createdAt: new Date().toISOString(),
};

const MONITOR_HTML_PATH = path.join(__dirname, 'blender-live-monitor.html');
const MAX_JOB_LOG_LINES = 300;
const MAX_JOB_LOG_LINE_LEN = 400;

// nodeId -> node record
const nodes = new Map();
// nodeId -> Array<Command>
const pendingCommands = new Map();
// nodeId -> Set<{ res, timer }>
const pollWaiters = new Map();
// commandId -> { nodeId, action, payload, createdAt, status, result, waiterResolvers: [] }
const commandHistory = new Map();
// jobId -> render job record
const renderJobs = new Map();
// jobId -> Array<string> (in-memory log tail, never persisted to jobs.json)
const jobLogs = new Map();

let initialized = false;
let buildInProgress = null;

function ensureDirsSync() {
    for (const d of [HUB_ROOT, BIN_DIR, JOBS_DIR, BUNDLES_DIR]) {
        if (!fs.existsSync(d)) {
            fs.mkdirSync(d, { recursive: true });
        }
    }
}

function loadStateSync() {
    ensureDirsSync();
    const codeAgentVersion = hubConfig.agentVersion;
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            if (raw && typeof raw.token === 'string' && raw.token.length >= 16) {
                hubConfig = { ...hubConfig, ...raw, agentVersion: codeAgentVersion };
            }
        } else {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(hubConfig, null, 2), { mode: 0o600 });
        }
    } catch (_) {}

    try {
        if (fs.existsSync(NODES_PATH)) {
            const raw = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'));
            if (Array.isArray(raw)) {
                for (const n of raw) {
                    if (n && n.nodeId) nodes.set(n.nodeId, n);
                }
            }
        }
    } catch (_) {}

    try {
        if (fs.existsSync(JOBS_PATH)) {
            const raw = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8'));
            if (Array.isArray(raw)) {
                for (const j of raw) {
                    if (j && j.jobId) renderJobs.set(j.jobId, j);
                }
            }
        }
    } catch (_) {}
}

let saveNodesTimer = null;
async function saveNodesNow() {
    if (saveNodesTimer) {
        clearTimeout(saveNodesTimer);
        saveNodesTimer = null;
    }
    try {
        const arr = [...nodes.values()];
        await fsp.writeFile(NODES_PATH, JSON.stringify(arr, null, 2));
    } catch (_) {}
}

function scheduleSaveNodes() {
    if (saveNodesTimer) return;
    saveNodesTimer = setTimeout(async () => {
        saveNodesTimer = null;
        await saveNodesNow();
    }, 1500);
    if (typeof saveNodesTimer.unref === 'function') saveNodesTimer.unref();
}

let saveJobsTimer = null;
let lastJobsSavedAt = 0;

async function saveJobs() {
    lastJobsSavedAt = Date.now();
    try {
        const arr = [...renderJobs.values()].slice(-100);
        await fsp.writeFile(JOBS_PATH, JSON.stringify(arr, null, 2));
    } catch (_) {}
}

function scheduleSaveJobsThrottled() {
    const now = Date.now();
    const elapsed = now - lastJobsSavedAt;
    if (elapsed >= 5000 && !saveJobsTimer) {
        saveJobs();
        return;
    }
    if (saveJobsTimer) return;
    const delay = Math.max(200, 5000 - elapsed);
    saveJobsTimer = setTimeout(() => {
        saveJobsTimer = null;
        saveJobs();
    }, delay);
    if (typeof saveJobsTimer.unref === 'function') saveJobsTimer.unref();
}

function execFileAsync(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: opts.timeout || 120000, maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
            if (err) {
                const e = new Error(`${cmd} ${args.join(' ')} failed: ${stderr || err.message}`);
                e.stdout = stdout;
                e.stderr = stderr;
                return reject(e);
            }
            resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

async function compileBinaries(force = false) {
    if (buildInProgress) return buildInProgress;
    buildInProgress = (async () => {
        ensureDirsSync();
        const targets = [
            { goos: 'windows', goarch: 'amd64', out: 'homelab-agent.exe' },
            { goos: 'linux', goarch: 'amd64', out: 'homelab-agent-linux-amd64' },
            { goos: 'darwin', goarch: 'arm64', out: 'homelab-agent-darwin-arm64' },
        ];

        const ldflags = [
            '-s -w',
            `-X main.AgentVersion=${hubConfig.agentVersion}`,
            `-X main.DefaultToken=${hubConfig.token}`,
            `-X main.DefaultHubURLs=${hubConfig.hubUrls.join(',')}`,
        ].join(' ');

        const results = [];
        for (const t of targets) {
            const outPath = path.join(BIN_DIR, t.out);
            if (!force && fs.existsSync(outPath)) {
                const st = fs.statSync(outPath);
                if (st.size > 500 * 1024) {
                    results.push({ target: `${t.goos}/${t.goarch}`, file: t.out, size: st.size, cached: true });
                    continue;
                }
            }
            await execFileAsync(
                GO_BIN,
                ['build', '-trimpath', '-ldflags', ldflags, '-o', outPath, '.'],
                {
                    cwd: AGENT_SRC_DIR,
                    env: {
                        ...process.env,
                        PATH: `${process.env.PATH || ''}:/home/dev/.local/bin:/home/dev/.local/go/bin`,
                        GOOS: t.goos,
                        GOARCH: t.goarch,
                        CGO_ENABLED: '0',
                    },
                }
            );
            const st = fs.statSync(outPath);
            results.push({ target: `${t.goos}/${t.goarch}`, file: t.out, size: st.size, cached: false });
        }
        return results;
    })().finally(() => {
        buildInProgress = null;
    });
    return buildInProgress;
}

function ensurePort8090NatRedirect() {
    if (SKIP_SIDE_EFFECTS) return;
    const rules = [
        ['-t', 'nat', '-i', 'tailscale0', '-p', 'tcp', '--dport', '8090', '-j', 'REDIRECT', '--to-ports', '80'],
        ['-t', 'nat', '-i', 'enp1s0', '-p', 'tcp', '--dport', '8090', '-j', 'REDIRECT', '--to-ports', '80'],
    ];
    for (const r of rules) {
        execFile('sudo', ['iptables', '-t', 'nat', '-C', 'PREROUTING', ...r.slice(2)], (err) => {
            if (err) {
                execFile('sudo', ['iptables', '-t', 'nat', '-A', 'PREROUTING', ...r.slice(2)], () => {});
            }
        });
    }
}

function init() {
    if (initialized) return;
    initialized = true;
    loadStateSync();
    if (!SKIP_SIDE_EFFECTS) {
        ensurePort8090NatRedirect();
        compileBinaries(false).catch((err) => {
            console.error('[AgentHub] Initial binary build error:', err.message);
        });
    }
    startJobWatchdog();
}

init();

function verifyAgentToken(candidate) {
    if (typeof candidate !== 'string' || !candidate) return false;
    const expected = hubConfig.token || DEFAULT_TOKEN;
    const a = crypto.createHash('sha256').update(candidate.trim(), 'utf8').digest();
    const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return crypto.timingSafeEqual(a, b);
}

function extractTokenFromReq(req, url) {
    const hdr = req.headers['x-agent-token'];
    if (hdr) return String(hdr).trim();
    const auth = String(req.headers.authorization || '');
    if (auth.toLowerCase().startsWith('bearer ')) {
        return auth.slice(7).trim();
    }
    if (url && url.searchParams && url.searchParams.get('token')) {
        return url.searchParams.get('token').trim();
    }
    return '';
}

/**
 * Checks if a request forwarded by Caddy's forward_auth (/auth) or hitting server.js directly
 * is an authorized Agent Hub request (or public installer/binary download).
 */
function isPublicOrAgentAuthorized(req, uriPath) {
    let parsedUrl = null;
    try {
        parsedUrl = new URL(uriPath || req.url || '/', 'http://localhost');
    } catch (_) {}
    const p = parsedUrl ? parsedUrl.pathname : String(uriPath || '');

    // Allow easy download of homelab-agent.exe & install.ps1 / install.sh directly on LAN/Tailscale
    if (
        p.startsWith('/api/agent-hub/download/') ||
        p === '/api/agent-hub/install.ps1' ||
        p === '/api/agent-hub/install.sh'
    ) {
        return true;
    }

    // Covers /api/agent-hub/agent/*, /api/agent-hub/jobs/*, /api/agent-hub/bundles/*, etc.
    if (p.startsWith('/api/agent-hub/')) {
        const tok = extractTokenFromReq(req, parsedUrl);
        if (tok && verifyAgentToken(tok)) return true;
        // Also allow localhost CLI calls (from 127.0.0.1 / ::1 / 172.17.0.1)
        const remote = (req.socket && req.socket.remoteAddress) || '';
        const xff = String(req.headers['x-forwarded-for'] || '');
        if ((remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1' || remote === '172.17.0.1' || remote === '::ffff:172.17.0.1') && !xff) {
            return true;
        }
    }
    return false;
}

function getNodeMaxJobs(node) {
    const raw = (node && node.maxJobs) ?? (node && node.specs && node.specs.maxJobs);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
    return 1;
}

function countNodeActiveJobs(nodeId) {
    const targetId = String(nodeId || '').trim().toLowerCase();
    if (!targetId) return 0;
    let count = 0;
    for (const j of renderJobs.values()) {
        if (j && String(j.nodeId || '').trim().toLowerCase() === targetId && ACTIVE_DISPATCHED_STATUSES.has(j.status)) {
            count++;
        }
    }
    return count;
}

function getNodeCurrentJobs(nodeId) {
    const targetId = String(nodeId || '').trim().toLowerCase();
    if (!targetId) return [];
    const list = [];
    for (const j of renderJobs.values()) {
        if (j && String(j.nodeId || '').trim().toLowerCase() === targetId && ACTIVE_DISPATCHED_STATUSES.has(j.status)) {
            list.push({
                jobId: j.jobId,
                name: j.name || j.compositionId || j.outputName || j.jobId,
                kind: j.kind || 'ffmpeg',
                status: j.status,
                progress: typeof j.progress === 'number' ? j.progress : 0,
                message: j.message || '',
                phase: j.phase || '',
                startedAt: j.startedAt || j.dispatchedAt || j.createdAt || null,
                updatedAt: j.updatedAt || null,
            });
        }
    }
    list.sort((a, b) => (Date.parse(b.updatedAt || b.startedAt || '') || 0) - (Date.parse(a.updatedAt || a.startedAt || '') || 0));
    return list;
}

function getNodeRecentJobs(nodeId, limit = 15) {
    const targetId = String(nodeId || '').trim().toLowerCase();
    if (!targetId) return [];
    const lim = Math.min(50, Math.max(1, Number(limit) || 15));
    const items = [];
    for (const j of renderJobs.values()) {
        if (j && String(j.nodeId || '').trim().toLowerCase() === targetId) {
            items.push(j);
        }
    }
    items.sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));
    return items.slice(0, lim).map(sanitizeJobForList);
}

function getNodeAlias(nodeId, fallbackAlias = '') {
    const key = String(nodeId || '').trim().toLowerCase();
    const rec = key ? nodes.get(key) : null;
    if (rec && typeof rec.alias === 'string' && rec.alias.trim()) {
        return rec.alias.trim();
    }
    return String(fallbackAlias || '').trim();
}

function decorateNode(n) {
    const now = Date.now();
    const lastSeenMs = n.lastSeenAt ? Date.parse(n.lastSeenAt) : 0;
    const ageMs = lastSeenMs ? Math.max(0, now - lastSeenMs) : null;
    const online = ageMs !== null && ageMs <= ONLINE_THRESHOLD_MS;
    const q = pendingCommands.get(n.nodeId) || [];
    const waiters = pollWaiters.get(n.nodeId);
    const alias = String(n.alias || '').trim();
    const notes = String(n.notes || '').trim();
    const hostname = String((n.specs && n.specs.hostname) || n.nodeId || '').trim();
    const maxJobs = getNodeMaxJobs(n);
    const hubCurrentJobs = getNodeCurrentJobs(n.nodeId);
    const currentJobs = [...hubCurrentJobs];
    if (online && n.metrics && Array.isArray(n.metrics.currentJobs)) {
        const seenIds = new Set(currentJobs.map((j) => j.jobId));
        for (const aj of n.metrics.currentJobs) {
            if (!aj || !aj.jobId || seenIds.has(aj.jobId)) continue;
            seenIds.add(aj.jobId);
            currentJobs.push({
                jobId: String(aj.jobId),
                name: String(aj.name || aj.jobId),
                kind: String(aj.kind || 'generic'),
                status: String(aj.status || 'running'),
                progress: Number.isFinite(Number(aj.progress)) ? Number(aj.progress) : 0,
                message: String(aj.message || ''),
                phase: '',
                startedAt: aj.startedAt || null,
                updatedAt: aj.updatedAt || null,
            });
        }
    }
    const agentActiveJobs = online && n.metrics ? (Number(n.metrics.activeJobs) || 0) : 0;
    const activeJobs = Math.max(hubCurrentJobs.length, currentJobs.length, agentActiveJobs);
    const paused = Boolean(n.metrics && n.metrics.paused);
    let workerState = 'offline';
    if (online) {
        if (paused) {
            workerState = 'paused';
        } else if (activeJobs > 0) {
            workerState = 'running';
        } else {
            workerState = 'idle';
        }
    }
    return {
        ...n,
        alias,
        notes,
        displayName: alias || hostname,
        online,
        paused,
        workerState,
        ageMs,
        maxJobs,
        activeJobs,
        currentJobs,
        longPollConnected: Boolean(waiters && waiters.size > 0),
        queuedCommands: q.length,
    };
}

function resolveNodeRef(identifier, candidateList = null) {
    const raw = String(identifier || '').trim();
    const q = raw.toLowerCase();
    const list = candidateList || [...nodes.values()].map(decorateNode);
    if (!q) return { node: null, ambiguous: false, matches: [] };

    const exactId = list.find((n) => String(n.nodeId || '').toLowerCase() === q);
    if (exactId) return { node: exactId, ambiguous: false, matches: [exactId] };

    const exactAlias = list.filter((n) => String(n.alias || '').trim().toLowerCase() === q);
    if (exactAlias.length === 1) return { node: exactAlias[0], ambiguous: false, matches: exactAlias };
    if (exactAlias.length > 1) return { node: null, ambiguous: true, matches: exactAlias };

    const exactHost = list.filter((n) => String((n.specs && n.specs.hostname) || '').trim().toLowerCase() === q);
    if (exactHost.length === 1) return { node: exactHost[0], ambiguous: false, matches: exactHost };
    if (exactHost.length > 1) return { node: null, ambiguous: true, matches: exactHost };

    const partial = list.filter((n) => {
        const fields = [
            n.nodeId || '',
            n.alias || '',
            (n.specs && n.specs.hostname) || '',
            n.notes || '',
        ];
        return fields.some((f) => String(f).toLowerCase().includes(q));
    });
    if (partial.length === 1) return { node: partial[0], ambiguous: false, matches: partial };
    if (partial.length > 1) return { node: null, ambiguous: true, matches: partial };

    return { node: null, ambiguous: false, matches: [] };
}

async function updateNodeMeta(identifier, body = {}) {
    const resolved = resolveNodeRef(identifier);
    if (resolved.ambiguous) {
        const err = new Error(`ชื่อ "${identifier}" ตรงกับหลายเครื่อง: ${resolved.matches.map((m) => m.nodeId).join(', ')}`);
        err.statusCode = 409;
        throw err;
    }
    if (!resolved.node) {
        const err = new Error(`ไม่พบเครื่องลูกข่าย "${identifier}"`);
        err.statusCode = 404;
        throw err;
    }

    const target = nodes.get(resolved.node.nodeId);
    const hasAlias = Object.prototype.hasOwnProperty.call(body, 'alias');
    const hasNotes = Object.prototype.hasOwnProperty.call(body, 'notes');
    const hasMaxJobs = Object.prototype.hasOwnProperty.call(body, 'maxJobs');
    const nextAlias = hasAlias ? String(body.alias ?? '').trim().slice(0, 80) : String(target.alias || '').trim();
    const nextNotes = hasNotes ? String(body.notes ?? '').trim().slice(0, 500) : String(target.notes || '').trim();

    if (nextAlias) {
        const aliasLower = nextAlias.toLowerCase();
        for (const other of nodes.values()) {
            if (other.nodeId === target.nodeId) continue;
            if (String(other.alias || '').trim().toLowerCase() === aliasLower || other.nodeId.toLowerCase() === aliasLower) {
                const err = new Error(`ชื่อเรียก "${nextAlias}" ถูกใช้งานโดยเครื่อง ${other.nodeId} อยู่แล้ว กรุณาตั้งชื่อที่ไม่ซ้ำกันค่ะ`);
                err.statusCode = 409;
                throw err;
            }
        }
    }

    target.alias = nextAlias;
    target.notes = nextNotes;
    if (hasMaxJobs) {
        const v = Number(body.maxJobs);
        if (Number.isFinite(v) && v >= 1) {
            target.maxJobs = Math.floor(v);
        } else {
            delete target.maxJobs;
        }
    }
    target.metaUpdatedAt = new Date().toISOString();
    nodes.set(target.nodeId, target);
    await saveNodesNow();
    return decorateNode(target);
}

function handleHeartbeat(body, clientIp) {
    const specs = (body && body.specs) || {};
    const metrics = (body && body.metrics) || {};
    const nodeId = String(specs.nodeId || '').trim().toLowerCase();
    if (!nodeId) {
        throw new Error('Missing specs.nodeId in heartbeat');
    }

    const nowIso = new Date().toISOString();
    const existing = nodes.get(nodeId) || {
        nodeId,
        firstSeenAt: nowIso,
    };

    const record = {
        ...existing,
        nodeId,
        specs: {
            ...existing.specs,
            ...specs,
        },
        metrics: {
            ...existing.metrics,
            ...metrics,
            currentJobs: Array.isArray(metrics.currentJobs) ? metrics.currentJobs : [],
        },
        lastIp: clientIp || existing.lastIp || '',
        lastSeenAt: nowIso,
    };

    nodes.set(nodeId, record);
    scheduleSaveNodes();

    // Dispatch any pending generic jobs if this node is ready with free capacity
    pumpGenericQueue();

    const dec = decorateNode(record);
    const allDecorated = [...nodes.values()].map(decorateNode);
    const totalNodes = allDecorated.length;
    const onlineNodes = allDecorated.filter((n) => n.online).length;

    const queued = drainPendingCommands(nodeId);
    return {
        ok: true,
        nodeId,
        displayName: dec.displayName,
        alias: dec.alias,
        workerState: dec.workerState,
        paused: dec.paused,
        agentVersion: hubConfig.agentVersion,
        totalNodes,
        onlineNodes,
        serverTime: nowIso,
        commands: queued,
    };
}

function buildSelfStatus(nodeIdRaw) {
    const nodeId = String(nodeIdRaw || '').trim().toLowerCase();
    const nowIso = new Date().toISOString();
    const allDecorated = [...nodes.values()].map(decorateNode);
    const totalNodes = allDecorated.length;
    const onlineNodes = allDecorated.filter((n) => n.online).length;
    const hubMeta = {
        serverTime: nowIso,
        agentVersion: hubConfig.agentVersion,
        totalNodes,
        onlineNodes,
        onlineThresholdMs: ONLINE_THRESHOLD_MS,
    };

    const raw = nodeId ? nodes.get(nodeId) : null;
    if (!raw) {
        return {
            ok: true,
            registered: false,
            nodeId,
            online: false,
            paused: false,
            workerState: 'offline',
            alias: '',
            displayName: nodeId,
            lastSeenAt: null,
            ageMs: null,
            longPollConnected: false,
            activeJobs: 0,
            maxJobs: 1,
            currentJobs: [],
            recentJobs: [],
            serverTime: nowIso,
            hub: hubMeta,
        };
    }

    const dec = decorateNode(raw);
    return {
        ok: true,
        registered: true,
        nodeId: dec.nodeId,
        online: Boolean(dec.online),
        paused: Boolean(dec.paused),
        workerState: dec.workerState,
        alias: dec.alias || '',
        displayName: dec.displayName || dec.nodeId,
        lastSeenAt: dec.lastSeenAt || null,
        ageMs: dec.ageMs,
        longPollConnected: Boolean(dec.longPollConnected),
        activeJobs: dec.activeJobs,
        maxJobs: dec.maxJobs,
        currentJobs: dec.currentJobs,
        recentJobs: getNodeRecentJobs(dec.nodeId, 15),
        serverTime: nowIso,
        hub: hubMeta,
    };
}

function drainPendingCommands(nodeId) {
    const q = pendingCommands.get(nodeId);
    if (!q || q.length === 0) return [];
    const items = q.splice(0, q.length);
    for (const cmd of items) {
        const hist = commandHistory.get(cmd.id);
        if (hist && hist.status === 'queued') {
            hist.status = 'dispatched';
            hist.dispatchedAt = new Date().toISOString();
        }
    }
    return items;
}

function enqueueCommand(nodeId, action, payload = {}, opts = {}) {
    const targetId = String(nodeId || '').trim().toLowerCase();
    if (!targetId) throw new Error('Missing nodeId');
    if (!action) throw new Error('Missing action');

    const cmdId = `cmd_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const cmd = {
        id: cmdId,
        action: String(action),
        payload: payload && typeof payload === 'object' ? payload : {},
        createdAt: nowIso,
    };

    const histEntry = {
        id: cmdId,
        nodeId: targetId,
        action: cmd.action,
        payload: cmd.payload,
        createdAt: nowIso,
        status: 'queued',
        result: null,
        waiterResolvers: [],
    };
    commandHistory.set(cmdId, histEntry);

    // Prune old command history (> 200 items)
    if (commandHistory.size > 200) {
        const firstKey = commandHistory.keys().next().value;
        if (firstKey) commandHistory.delete(firstKey);
    }

    // Check if the node currently has an open long-poll connection
    const waiters = pollWaiters.get(targetId);
    if (waiters && waiters.size > 0) {
        const waiter = waiters.values().next().value;
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        histEntry.status = 'dispatched';
        histEntry.dispatchedAt = new Date().toISOString();
        try {
            waiter.sendJson(200, { ok: true, commands: [cmd] });
            return { cmd, histEntry, dispatchedImmediately: true };
        } catch (_) {
            // Fall through to queue if socket died
        }
    }

    if (!pendingCommands.has(targetId)) {
        pendingCommands.set(targetId, []);
    }
    pendingCommands.get(targetId).push(cmd);
    return { cmd, histEntry, dispatchedImmediately: false };
}

function dispatchAndWait(nodeId, action, payload = {}, timeoutMs = 45000) {
    const { cmd, histEntry } = enqueueCommand(nodeId, action, payload);
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            const idx = histEntry.waiterResolvers.indexOf(onDone);
            if (idx !== -1) histEntry.waiterResolvers.splice(idx, 1);
            resolve({
                ok: false,
                timeout: true,
                commandId: cmd.id,
                nodeId,
                action,
                status: histEntry.status,
                error: `คำสั่ง ${action} ใช้เวลานานเกิน ${Math.round(timeoutMs / 1000)} วินาที (สถานะ: ${histEntry.status})`,
            });
        }, timeoutMs);

        function onDone(resObj) {
            clearTimeout(timer);
            resolve(resObj);
        }

        histEntry.waiterResolvers.push(onDone);
    });
}

function handleCommandResult(body) {
    const cmdId = String((body && body.commandId) || '').trim();
    if (!cmdId) throw new Error('Missing commandId');

    const nodeId = String((body && body.nodeId) || '').trim().toLowerCase();
    if (nodeId && nodes.has(nodeId)) {
        const n = nodes.get(nodeId);
        n.lastSeenAt = new Date().toISOString();
    }

    const hist = commandHistory.get(cmdId);
    const resultRecord = {
        ok: Boolean(body.ok),
        commandId: cmdId,
        nodeId: nodeId || (hist && hist.nodeId) || '',
        action: body.action || (hist && hist.action) || '',
        error: body.error || null,
        data: body.data || null,
        durationMs: Number(body.durationMs) || 0,
        finishedAt: body.finishedAt || new Date().toISOString(),
    };

    if (hist) {
        hist.status = resultRecord.ok ? 'completed' : 'failed';
        hist.result = resultRecord;
        hist.finishedAt = resultRecord.finishedAt;
        const resolvers = hist.waiterResolvers.splice(0, hist.waiterResolvers.length);
        for (const fn of resolvers) {
            try { fn(resultRecord); } catch (_) {}
        }

        if (hist.action !== 'sysinfo') {
            try {
                const id = audit.startRun({
                    source: 'agent-hub', prompt: `${hist.action} @${hist.nodeId} ${JSON.stringify(hist.payload || {}).slice(0, 1500)}`,
                    startedAt: Date.parse(hist.createdAt) || undefined, mode: hist.action
                });
                if (id) {
                    const out = resultRecord.data ? JSON.stringify(resultRecord.data).slice(-1500) : '';
                    audit.finishRun(id, { status: resultRecord.ok ? 'completed' : 'error', error: resultRecord.error, answer: out, exitCode: resultRecord.ok ? 0 : 1 });
                }
            } catch (_) {}
        }
    }

    // Safety net for job.run / job.cancel in case final job-progress was missed or handler returned early error
    if (resultRecord.action === 'job.run') {
        const data = (resultRecord.data && typeof resultRecord.data === 'object') ? resultRecord.data : {};
        const jobId = String(data.jobId || (hist && hist.payload && hist.payload.jobId) || '').trim();
        const job = jobId ? renderJobs.get(jobId) : null;
        if (job && !TERMINAL_JOB_STATUSES.has(job.status)) {
            const nowIso = new Date().toISOString();
            const dataStatus = typeof data.status === 'string' ? data.status.trim() : '';
            const exitCode = typeof data.exitCode === 'number' && Number.isFinite(data.exitCode)
                ? data.exitCode
                : undefined;
            const durationMs = typeof data.durationMs === 'number' && Number.isFinite(data.durationMs)
                ? data.durationMs
                : (resultRecord.durationMs || 0);

            let finalStatus = 'completed';
            if (dataStatus && TERMINAL_JOB_STATUSES.has(dataStatus)) {
                finalStatus = dataStatus;
            } else if (job.status === 'cancelling') {
                finalStatus = 'cancelled';
            } else if (!resultRecord.ok) {
                finalStatus = 'failed';
            } else if (exitCode !== undefined && exitCode !== 0) {
                finalStatus = 'failed';
            }

            job.status = finalStatus;
            if (exitCode !== undefined && (job.exitCode === undefined || job.exitCode === null)) {
                job.exitCode = exitCode;
            }
            if (durationMs && !job.durationMs) {
                job.durationMs = durationMs;
            }
            if (!resultRecord.ok && resultRecord.error && !job.error) {
                job.error = String(resultRecord.error);
            }
            if (finalStatus === 'completed' && (typeof job.progress !== 'number' || job.progress < 100)) {
                job.progress = 100;
            }
            if (finalStatus === 'failed' && (!job.message || job.message === `ส่งงานไปยัง ${job.nodeId} แล้ว`)) {
                job.message = job.error || `งานล้มเหลว (exitCode=${job.exitCode ?? '?'})`;
            }
            job.finishedAt = job.finishedAt || resultRecord.finishedAt || nowIso;
            job.updatedAt = nowIso;
            saveJobs();
            pumpGenericQueue();
        }
    } else if (resultRecord.action === 'job.cancel' && !resultRecord.ok) {
        const jobId = String((hist && hist.payload && hist.payload.jobId) || '').trim();
        const job = jobId ? renderJobs.get(jobId) : null;
        const errStr = String(resultRecord.error || '').toLowerCase();
        if (job && job.status === 'cancelling' && errStr.includes('not running')) {
            const nowIso = new Date().toISOString();
            job.status = 'cancelled';
            job.message = 'ยกเลิกงานแล้ว';
            job.finishedAt = job.finishedAt || nowIso;
            job.updatedAt = nowIso;
            saveJobs();
            pumpGenericQueue();
        }
    }

    return { ok: true, commandId: cmdId };
}

function selectBestRenderNode(preferredNodeId = '', opts = {}) {
    const pref = String(preferredNodeId || '').trim().toLowerCase();
    const allowPaused = Boolean(opts && opts.allowPaused);
    const allOnline = [...nodes.values()]
        .map(decorateNode)
        .filter((n) => n.online && (allowPaused || !n.paused));
    if (pref && pref !== 'auto') {
        const res = resolveNodeRef(pref, allOnline);
        if (res.node) return res.node;
    }
    // Score online nodes with ffmpeg capability: prefer NVENC GPU, more threads, lower CPU load
    const capable = allOnline.filter((n) => {
        const caps = (n.specs && n.specs.capabilities) || [];
        return caps.includes('ffmpeg');
    });
    if (capable.length === 0) return null;

    capable.sort((a, b) => {
        const aNv = a.specs && a.specs.hasNvenc ? 1000 : 0;
        const bNv = b.specs && b.specs.hasNvenc ? 1000 : 0;
        const aThreads = ((a.specs && a.specs.cpuThreads) || 1) * 20;
        const bThreads = ((b.specs && b.specs.cpuThreads) || 1) * 20;
        const aLoad = (a.metrics && a.metrics.cpuPct) || 0;
        const bLoad = (b.metrics && b.metrics.cpuPct) || 0;
        return (bNv + bThreads - bLoad) - (aNv + aThreads - aLoad);
    });
    return capable[0];
}

async function createRenderJob(opts = {}) {
    const node = selectBestRenderNode(opts.nodeId);
    if (!node) {
        throw new Error('ไม่มีเครื่อง Worker Agent ที่ออนไลน์และพร้อมเรนเดอร์ (FFmpeg) ในขณะนี้');
    }

    const jobId = `rjob_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const jobDir = path.join(JOBS_DIR, jobId);
    await fsp.mkdir(jobDir, { recursive: true });

    let inputUrl = opts.inputUrl || '';
    let inputFilePath = '';
    if (opts.inputPath) {
        const srcPath = path.resolve(String(opts.inputPath));
        if (!fs.existsSync(srcPath)) {
            throw new Error(`ไม่พบไฟล์ต้นฉบับ: ${srcPath}`);
        }
        const ext = path.extname(srcPath) || '.mp4';
        inputFilePath = path.join(jobDir, `input${ext}`);
        await fsp.copyFile(srcPath, inputFilePath);
        inputUrl = `/api/agent-hub/jobs/${encodeURIComponent(jobId)}/input`;
    }

    const outputName = opts.outputName || `${jobId}_rendered.mp4`;
    const job = {
        jobId,
        nodeId: node.nodeId,
        hostname: (node.specs && node.specs.hostname) || node.nodeId,
        status: 'queued',
        progress: 0,
        message: `ส่งงานไปยัง ${node.nodeId} แล้ว`,
        testMode: Boolean(opts.testMode),
        useNvenc: opts.useNvenc !== undefined ? Boolean(opts.useNvenc) : Boolean(node.specs && node.specs.hasNvenc),
        crf: Number(opts.crf) || 20,
        preset: opts.preset || '',
        durationSec: Number(opts.durationSec) || 5,
        inputFilePath,
        inputUrl,
        outputName,
        outputFilePath: '',
        downloadUrl: '',
        encoder: '',
        renderDurationMs: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    renderJobs.set(jobId, job);
    await saveJobs();

    const { cmd } = enqueueCommand(node.nodeId, 'render.ffmpeg', {
        jobId,
        inputUrl,
        outputName,
        testMode: job.testMode,
        useNvenc: job.useNvenc,
        crf: job.crf,
        preset: job.preset,
        durationSec: job.durationSec,
        extraArgs: Array.isArray(opts.extraArgs) ? opts.extraArgs : [],
    });
    job.commandId = cmd.id;
    return job;
}

function selectBestBlenderNode(preferredNodeId = '', preferGpu = false, opts = {}) {
    const pref = String(preferredNodeId || '').trim().toLowerCase();
    const allowPaused = Boolean(opts && opts.allowPaused);
    const allOnline = [...nodes.values()]
        .map(decorateNode)
        .filter((n) => n.online && (allowPaused || !n.paused));
    if (pref && pref !== 'auto') {
        const res = resolveNodeRef(pref, allOnline);
        if (res.node) return res.node;
    }
    const capable = allOnline.filter((n) => {
        const caps = (n.specs && n.specs.capabilities) || [];
        return caps.includes('blender') || caps.includes('blender-3d') || Boolean(n.specs && n.specs.blenderPath);
    });
    if (capable.length === 0) return null;

    capable.sort((a, b) => {
        const aGpu = preferGpu && a.specs && a.specs.hasNvidiaSmi ? 600 : (a.specs && a.specs.hasNvidiaSmi ? 150 : 0);
        const bGpu = preferGpu && b.specs && b.specs.hasNvidiaSmi ? 600 : (b.specs && b.specs.hasNvidiaSmi ? 150 : 0);
        const aThreads = ((a.specs && a.specs.cpuThreads) || 1) * 40;
        const bThreads = ((b.specs && b.specs.cpuThreads) || 1) * 40;
        const aLoad = ((a.metrics && a.metrics.cpuPct) || 0) * 5;
        const bLoad = ((b.metrics && b.metrics.cpuPct) || 0) * 5;
        return (bGpu + bThreads - bLoad) - (aGpu + aThreads - aLoad);
    });
    return capable[0];
}

async function createBlenderJob(opts = {}) {
    const node = selectBestBlenderNode(opts.nodeId, Boolean(opts.preferGpu));
    if (!node) {
        throw new Error('ไม่มีเครื่อง Worker Agent ที่ออนไลน์และพร้อมรัน Blender 3D ในขณะนี้');
    }

    const jobId = `bjob_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const jobDir = path.join(JOBS_DIR, jobId);
    await fsp.mkdir(jobDir, { recursive: true });

    const script = String(opts.script || '').trim();
    if (!script) {
        throw new Error('ต้องระบุสคริปต์ Python (bpy) สำหรับสร้างหรือเรนเดอร์ 3D Object');
    }

    const outputName = opts.outputName || `${jobId}.glb`;
    const previewName = opts.previewName || `${jobId}_preview.png`;
    const job = {
        jobId,
        kind: 'blender-3d',
        nodeId: node.nodeId,
        hostname: (node.specs && node.specs.hostname) || node.nodeId,
        status: 'queued',
        progress: 0,
        message: `ส่งงาน 3D ไปยัง ${node.nodeId} แล้ว`,
        outputName,
        previewName,
        outputFilePath: '',
        previewFilePath: '',
        downloadUrl: '',
        previewUrl: '',
        openGui: Boolean(opts.openGui),
        encoder: 'blender-4.3',
        renderDurationMs: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    renderJobs.set(jobId, job);
    await saveJobs();

    const { cmd } = enqueueCommand(node.nodeId, 'render.blender', {
        jobId,
        script,
        outputName,
        previewName,
        openGui: job.openGui,
    });
    job.commandId = cmd.id;
    return job;
}

const REMOTION_BUNDLE_ITEMS = [
    'src',
    'public',
    'package.json',
    'package-lock.json',
    'remotion.config.ts',
    'tsconfig.json',
    'assets/fonts',
];
const ACTIVE_RENDER_STATUSES = new Set(['queued', 'downloading', 'installing', 'rendering']);
let motionBundleCache = { hash: '', filePath: '', expiresAt: 0 };
let motionBundleInFlight = null;

function selectBestRemotionNode(preferredNodeId = '', opts = {}) {
    const pref = String(preferredNodeId || '').trim().toLowerCase();
    const allowPaused = Boolean(opts && opts.allowPaused);
    const allOnline = [...nodes.values()]
        .map(decorateNode)
        .filter((n) => n.online && (allowPaused || !n.paused));
    if (pref && pref !== 'auto') {
        const res = resolveNodeRef(pref, allOnline);
        return res.node || null;
    }

    const busyNodes = new Set();
    for (const j of renderJobs.values()) {
        if (j && j.nodeId && ACTIVE_RENDER_STATUSES.has(j.status)) {
            busyNodes.add(String(j.nodeId).trim().toLowerCase());
        }
    }

    const capable = allOnline.filter((n) => {
        const caps = (n.specs && n.specs.capabilities) || [];
        if (!caps.includes('remotion-render')) return false;
        if (busyNodes.has(n.nodeId)) return false;
        if (n.metrics && (n.metrics.rendering || n.metrics.busy || (Number(n.metrics.activeRenderJobs) || 0) > 0)) {
            return false;
        }
        return true;
    });
    if (capable.length === 0) return null;

    capable.sort((a, b) => {
        const aNv = a.specs && a.specs.hasNvenc ? 1000 : 0;
        const bNv = b.specs && b.specs.hasNvenc ? 1000 : 0;
        const aThreads = ((a.specs && a.specs.cpuThreads) || 1) * 20;
        const bThreads = ((b.specs && b.specs.cpuThreads) || 1) * 20;
        const aLoad = (a.metrics && a.metrics.cpuPct) || 0;
        const bLoad = (b.metrics && b.metrics.cpuPct) || 0;
        return (bNv + bThreads - bLoad) - (aNv + aThreads - aLoad);
    });
    return capable[0];
}

async function collectBundleFileEntries(baseDir, relItems) {
    const entries = [];
    async function walk(relPath) {
        const fullPath = path.join(baseDir, relPath);
        const st = await fsp.lstat(fullPath);
        if (st.isDirectory()) {
            const names = await fsp.readdir(fullPath);
            names.sort();
            for (const name of names) {
                await walk(path.posix.join(relPath.split(path.sep).join('/'), name));
            }
        } else if (st.isFile() || st.isSymbolicLink()) {
            entries.push(`${relPath}|${Math.trunc(st.mtimeMs)}|${st.size}`);
        }
    }
    for (const item of relItems) {
        await walk(item);
    }
    entries.sort();
    return entries;
}

async function ensureMotionBundle() {
    const now = Date.now();
    if (motionBundleCache.hash && now < motionBundleCache.expiresAt && fs.existsSync(motionBundleCache.filePath)) {
        return { hash: motionBundleCache.hash, filePath: motionBundleCache.filePath };
    }
    if (motionBundleInFlight) return motionBundleInFlight;

    motionBundleInFlight = (async () => {
        await fsp.mkdir(BUNDLES_DIR, { recursive: true });
        const items = REMOTION_BUNDLE_ITEMS.filter((rel) => fs.existsSync(path.join(MOTION_STUDIO_DIR, rel)));
        if (items.length === 0) {
            throw new Error(`ไม่พบไฟล์โปรเจกต์ motion-studio ใน ${MOTION_STUDIO_DIR}`);
        }

        const entries = await collectBundleFileEntries(MOTION_STUDIO_DIR, items);
        const hasher = crypto.createHash('sha1');
        for (const line of entries) {
            hasher.update(line);
            hasher.update('\n');
        }
        const hash = hasher.digest('hex').slice(0, 16);
        const outPath = path.join(BUNDLES_DIR, `motion-studio-${hash}.tar.gz`);

        if (!fs.existsSync(outPath)) {
            const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;
            try {
                await execFileAsync('tar', ['-czf', tmpPath, '-C', MOTION_STUDIO_DIR, ...items], { timeout: 120000 });
                await fsp.rename(tmpPath, outPath);
            } catch (err) {
                await fsp.unlink(tmpPath).catch(() => {});
                throw err;
            }
        }

        // Prune old bundles, keeping the 3 most recent
        try {
            const files = (await fsp.readdir(BUNDLES_DIR))
                .filter((f) => /^motion-studio-[a-f0-9]{16}\.tar\.gz$/.test(f));
            if (files.length > 3) {
                const withStat = await Promise.all(
                    files.map(async (f) => {
                        const full = path.join(BUNDLES_DIR, f);
                        const st = await fsp.stat(full).catch(() => null);
                        return { full, mtimeMs: st ? st.mtimeMs : 0 };
                    })
                );
                withStat.sort((a, b) => b.mtimeMs - a.mtimeMs);
                for (const old of withStat.slice(3)) {
                    if (old.full !== outPath) {
                        await fsp.unlink(old.full).catch(() => {});
                    }
                }
            }
        } catch (_) {}

        motionBundleCache = { hash, filePath: outPath, expiresAt: Date.now() + 60000 };
        return { hash, filePath: outPath };
    })().finally(() => {
        motionBundleInFlight = null;
    });

    return motionBundleInFlight;
}

async function createRemotionJob(opts = {}) {
    const node = selectBestRemotionNode(opts.nodeId);
    if (!node) {
        const err = new Error('ไม่มีเครื่อง Worker Agent ที่ออนไลน์และพร้อมเรนเดอร์ Remotion ในขณะนี้');
        err.code = 'NO_NODE';
        throw err;
    }

    if (!opts.propsPath) {
        throw new Error('ต้องระบุ propsPath สำหรับงานเรนเดอร์ Remotion');
    }
    const srcPropsPath = path.resolve(String(opts.propsPath));
    const allowedRoots = ['/home/dev/.gemini/', '/tmp/'];
    if (!allowedRoots.some((root) => srcPropsPath.startsWith(root))) {
        throw new Error(`ไม่อนุญาตให้เข้าถึง propsPath นอกขอบเขต: ${srcPropsPath}`);
    }
    if (!fs.existsSync(srcPropsPath)) {
        throw new Error(`ไม่พบไฟล์ props: ${srcPropsPath}`);
    }
    const realPropsPath = fs.realpathSync(srcPropsPath);
    if (!allowedRoots.some((root) => realPropsPath.startsWith(root))) {
        throw new Error(`ไม่อนุญาตให้เข้าถึง propsPath นอกขอบเขต (symlink): ${srcPropsPath}`);
    }

    const { hash } = await ensureMotionBundle();

    const jobId = `rmjob_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const jobDir = path.join(JOBS_DIR, jobId);
    await fsp.mkdir(jobDir, { recursive: true });

    const inputFilePath = path.join(jobDir, 'input.json');
    await fsp.copyFile(realPropsPath, inputFilePath);

    const bundleUrl = `/api/agent-hub/bundles/${hash}.tar.gz`;
    const propsUrl = `/api/agent-hub/jobs/${encodeURIComponent(jobId)}/input`;
    const compositionId = String(opts.compositionId || 'StudioEngine').trim() || 'StudioEngine';
    const outputName = String(opts.outputName || `${jobId}.mp4`).trim() || `${jobId}.mp4`;
    const concurrency = Number(opts.concurrency) || ((node.specs && node.specs.cpuThreads >= 12) ? 6 : 4);
    const crf = Number(opts.crf) || 18;

    const job = {
        jobId,
        kind: 'remotion',
        nodeId: node.nodeId,
        hostname: (node.specs && node.specs.hostname) || node.nodeId,
        status: 'queued',
        progress: 0,
        message: `ส่งงาน Remotion ไปยัง ${node.nodeId} แล้ว`,
        compositionId,
        bundleHash: hash,
        bundleUrl,
        concurrency,
        crf,
        inputFilePath,
        inputUrl: propsUrl,
        outputName,
        outputFilePath: '',
        downloadUrl: '',
        encoder: 'remotion',
        renderDurationMs: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    renderJobs.set(jobId, job);
    await saveJobs();

    const { cmd } = enqueueCommand(node.nodeId, 'render.remotion', {
        jobId,
        bundleUrl,
        bundleHash: hash,
        propsUrl,
        compositionId,
        outputName,
        concurrency,
        crf,
    });
    job.commandId = cmd.id;
    return job;
}

// -----------------------------------------------------------------------------
// Generic Job Runner (job.run / job.cancel / pending queue / watchdog)
// -----------------------------------------------------------------------------

function nodeHasCapability(node, reqCap) {
    const r = String(reqCap || '').trim().toLowerCase();
    if (!r) return true;
    const specs = (node && node.specs) || {};
    const caps = Array.isArray(specs.capabilities)
        ? specs.capabilities.map((c) => String(c).toLowerCase())
        : [];
    const capSet = new Set(caps);
    if (capSet.has(r)) return true;
    if (r === 'gpu' && (capSet.has('nvidia-gpu') || Boolean(specs.hasNvidiaSmi))) return true;
    if (r === 'nvenc' && (capSet.has('ffmpeg-nvenc') || Boolean(specs.hasNvenc))) return true;
    if (r === 'node' && (capSet.has('nodejs') || Boolean(specs.nodePath))) return true;
    if (r === 'python3' && (capSet.has('python') || Boolean(specs.pythonPath))) return true;
    if (r === 'blender' && (capSet.has('blender-3d') || Boolean(specs.blenderPath))) return true;
    return false;
}

function nodeMatchesOs(node, osReq) {
    const req = String(osReq || 'any').trim().toLowerCase();
    if (!req || req === 'any') return true;
    const nodeOs = String((node && node.specs && node.specs.os) || '').trim().toLowerCase();
    if (!nodeOs) return false;
    if (req === 'windows' || req === 'win') return nodeOs === 'windows';
    if (req === 'linux') return nodeOs === 'linux';
    if (req === 'darwin' || req === 'macos') return nodeOs === 'darwin';
    if (req === 'posix') return nodeOs === 'linux' || nodeOs === 'darwin';
    return nodeOs === req;
}

function resolveCommandForNode(command, node) {
    if (typeof command === 'string') return command.trim();
    if (!command || typeof command !== 'object') return '';
    const nodeOs = String((node && node.specs && node.specs.os) || '').trim().toLowerCase();
    if (nodeOs === 'windows') {
        return String(command.windows || command.win || '').trim();
    }
    if (nodeOs === 'linux' || nodeOs === 'darwin') {
        return String(command[nodeOs] || command.posix || '').trim();
    }
    return String(command.posix || command.windows || '').trim();
}

function findMatchingGenericNodes(opts = {}) {
    const pref = String(opts.nodeId || 'auto').trim();
    const requires = Array.isArray(opts.requires) ? opts.requires.filter(Boolean) : [];
    const osReq = String(opts.os || 'any').trim().toLowerCase() || 'any';
    const command = opts.command;
    const allowPaused = Boolean(opts.allowPaused);
    const allOnline = [...nodes.values()]
        .map(decorateNode)
        .filter((n) => n.online && (allowPaused || !n.paused));

    let candidates = allOnline;
    if (pref && pref.toLowerCase() !== 'auto') {
        const res = resolveNodeRef(pref, allOnline);
        if (!res.node) return [];
        candidates = [res.node];
    }

    const matched = candidates.filter((n) => {
        if (!nodeMatchesOs(n, osReq)) return false;
        if (command !== undefined && command !== null && !resolveCommandForNode(command, n)) return false;
        for (const cap of requires) {
            if (!nodeHasCapability(n, cap)) return false;
        }
        return true;
    });

    const wantsGpu = requires.some((c) => {
        const lc = String(c).toLowerCase();
        return lc === 'gpu' || lc === 'nvidia-gpu' || lc === 'nvenc' || lc === 'ffmpeg-nvenc' || lc === 'cuda';
    });

    matched.sort((a, b) => {
        const aMax = getNodeMaxJobs(a);
        const bMax = getNodeMaxJobs(b);
        const aActive = countNodeActiveJobs(a.nodeId);
        const bActive = countNodeActiveJobs(b.nodeId);
        const aFree = aActive < aMax ? 1 : 0;
        const bFree = bActive < bMax ? 1 : 0;
        if (aFree !== bFree) return bFree - aFree;

        const score = (n, active) => {
            const sp = n.specs || {};
            const mt = n.metrics || {};
            const gpuBase = wantsGpu ? 1000 : 250;
            const gpuBonus = sp.hasNvenc ? gpuBase : (sp.hasNvidiaSmi ? Math.round(gpuBase * 0.8) : 0);
            const vramBonus = wantsGpu ? Math.min(400, ((sp.gpuVramMB || 0) / 1024) * 20) : 0;
            const threads = (sp.cpuThreads || 1) * 20;
            const loadPenalty = (mt.cpuPct || 0) * 3;
            const activePenalty = active * 500;
            return gpuBonus + vramBonus + threads - loadPenalty - activePenalty;
        };

        const diff = score(b, bActive) - score(a, aActive);
        if (diff !== 0) return diff;
        return String(a.nodeId).localeCompare(String(b.nodeId));
    });

    return matched;
}

function selectBestGenericNode(opts = {}) {
    const matched = findMatchingGenericNodes(opts);
    if (matched.length === 0) return null;
    if (opts.allowBusy) return matched[0];
    for (const n of matched) {
        if (countNodeActiveJobs(n.nodeId) < getNodeMaxJobs(n)) {
            return n;
        }
    }
    return null;
}

function isPathUnderAllowedRoots(absPath, roots = GENERIC_INPUT_ALLOWED_ROOTS) {
    const normalized = path.resolve(String(absPath || ''));
    return roots.some((root) => {
        const normRoot = root.endsWith(path.sep) ? root : root + path.sep;
        return normalized.startsWith(normRoot);
    });
}

function validateJobInputs(inputs) {
    if (inputs === undefined || inputs === null) return [];
    if (!Array.isArray(inputs)) {
        const err = new Error('inputs must be an array of file/directory paths');
        err.statusCode = 400;
        throw err;
    }
    if (inputs.length > 50) {
        const err = new Error('inputs exceeds maximum of 50 items');
        err.statusCode = 400;
        throw err;
    }
    const seenBasenames = new Set();
    const validated = [];
    for (const raw of inputs) {
        if (typeof raw !== 'string' || !raw.trim()) {
            const err = new Error('Each input path must be a non-empty string');
            err.statusCode = 400;
            throw err;
        }
        const resolvedPath = path.resolve(raw.trim());
        if (!isPathUnderAllowedRoots(resolvedPath)) {
            const err = new Error(`ไม่อนุญาตให้เข้าถึง input path นอกขอบเขต: ${resolvedPath}`);
            err.statusCode = 400;
            throw err;
        }
        if (!fs.existsSync(resolvedPath)) {
            const err = new Error(`ไม่พบไฟล์หรือโฟลเดอร์ input: ${resolvedPath}`);
            err.statusCode = 400;
            throw err;
        }
        const realPath = fs.realpathSync(resolvedPath);
        if (!isPathUnderAllowedRoots(realPath)) {
            const err = new Error(`ไม่อนุญาตให้เข้าถึง input path นอกขอบเขต (symlink): ${resolvedPath}`);
            err.statusCode = 400;
            throw err;
        }
        const st = fs.statSync(realPath);
        if (!st.isFile() && !st.isDirectory()) {
            const err = new Error(`input ต้องเป็นไฟล์หรือโฟลเดอร์เท่านั้น: ${resolvedPath}`);
            err.statusCode = 400;
            throw err;
        }
        const base = path.basename(realPath);
        if (!base || base === '.' || base === '..') {
            const err = new Error(`ชื่อไฟล์ input ไม่ถูกต้อง: ${resolvedPath}`);
            err.statusCode = 400;
            throw err;
        }
        if (seenBasenames.has(base)) {
            const err = new Error(`ชื่อไฟล์/โฟลเดอร์ input ซ้ำกัน: ${base}`);
            err.statusCode = 400;
            throw err;
        }
        seenBasenames.add(base);
        validated.push({
            rawPath: raw.trim(),
            resolvedPath,
            realPath,
            dir: path.dirname(realPath),
            base,
        });
    }
    return validated;
}

async function packJobInputs(job, inputs) {
    if (!job || !job.jobId) {
        const err = new Error('Missing job object for packJobInputs');
        err.statusCode = 400;
        throw err;
    }
    if (!inputs || inputs.length === 0) {
        job.inputFilePath = '';
        job.inputUrl = '';
        job.inputSize = 0;
        job.inputNames = [];
        return { inputFilePath: '', inputUrl: '', size: 0, names: [] };
    }

    const validated = (typeof inputs[0] === 'string')
        ? validateJobInputs(inputs)
        : inputs;

    const jobDir = path.join(JOBS_DIR, job.jobId);
    await fsp.mkdir(jobDir, { recursive: true });
    const outPath = path.join(jobDir, 'input.tar.gz');
    const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;

    const tarArgs = ['-czf', tmpPath];
    for (const item of validated) {
        tarArgs.push('-C', item.dir, item.base);
    }

    try {
        await execFileAsync('tar', tarArgs, { timeout: 120000 });
        const st = await fsp.stat(tmpPath);
        if (st.size > MAX_JOB_INPUT_TAR_BYTES) {
            await fsp.unlink(tmpPath).catch(() => {});
            const err = new Error(`ขนาดไฟล์ input รวมเกิน 500MB (${st.size} bytes)`);
            err.statusCode = 400;
            throw err;
        }
        await fsp.rename(tmpPath, outPath);
        job.inputFilePath = outPath;
        job.inputUrl = `/api/agent-hub/jobs/${encodeURIComponent(job.jobId)}/input`;
        job.inputSize = st.size;
        job.inputNames = validated.map((v) => v.base);
        return {
            inputFilePath: outPath,
            inputUrl: job.inputUrl,
            size: st.size,
            names: job.inputNames,
        };
    } catch (err) {
        await fsp.unlink(tmpPath).catch(() => {});
        throw err;
    }
}

function dispatchGenericJobToNode(job, node) {
    const nowIso = new Date().toISOString();
    const resolvedCommand = resolveCommandForNode(job.command, node);
    const resolvedSetup = job.setup ? resolveCommandForNode(job.setup, node) : '';
    const alias = String(node.alias || '').trim();
    const hostname = String((node.specs && node.specs.hostname) || node.nodeId).trim();

    job.nodeId = node.nodeId;
    job.hostname = hostname;
    job.alias = alias;
    job.nodeAlias = alias;
    job.status = 'queued';
    job.message = `ส่งงานไปยัง ${alias || hostname || node.nodeId} แล้ว`;
    job.dispatchedAt = nowIso;
    job.updatedAt = nowIso;

    const { cmd } = enqueueCommand(node.nodeId, 'job.run', {
        jobId: job.jobId,
        name: job.name,
        command: resolvedCommand,
        setup: resolvedSetup,
        cacheKey: job.cacheKey || '',
        inputUrl: job.inputUrl || '',
        collect: Array.isArray(job.collect) ? job.collect : [],
        env: (job.env && typeof job.env === 'object') ? job.env : {},
        timeoutSec: job.timeoutSec || 1800,
    });
    job.commandId = cmd.id;
    return cmd;
}

function pumpGenericQueue() {
    const pendingJobs = [...renderJobs.values()]
        .filter((j) => j && j.kind === 'generic' && j.status === 'pending')
        .sort((a, b) => (Date.parse(a.createdAt || '') || 0) - (Date.parse(b.createdAt || '') || 0));

    if (pendingJobs.length === 0) return 0;

    let dispatchedCount = 0;
    for (const job of pendingJobs) {
        const node = selectBestGenericNode({
            nodeId: job.requestedNodeId || 'auto',
            requires: job.requires || [],
            os: job.os || 'any',
            command: job.command,
        });
        if (!node) continue;
        dispatchGenericJobToNode(job, node);
        dispatchedCount++;
    }

    if (dispatchedCount > 0) {
        saveJobs();
    }
    return dispatchedCount;
}

async function createGenericJob(opts = {}) {
    // 1. Validate command
    const rawCmd = opts.command;
    let command = null;
    if (typeof rawCmd === 'string') {
        const trimmed = rawCmd.trim();
        if (trimmed) command = trimmed;
    } else if (rawCmd && typeof rawCmd === 'object' && !Array.isArray(rawCmd)) {
        const cleaned = {};
        for (const k of ['windows', 'win', 'posix', 'linux', 'darwin']) {
            if (typeof rawCmd[k] === 'string' && rawCmd[k].trim()) {
                cleaned[k] = rawCmd[k].trim();
            }
        }
        if (Object.keys(cleaned).length > 0) command = cleaned;
    }
    if (!command) {
        const err = new Error('ต้องระบุ command (string หรือ {windows, posix})');
        err.statusCode = 400;
        throw err;
    }

    // 2. Validate os
    const rawOs = String(opts.os || 'any').trim().toLowerCase() || 'any';
    const osNormMap = { any: 'any', windows: 'windows', win: 'windows', linux: 'linux', darwin: 'darwin', macos: 'darwin', posix: 'posix' };
    if (!Object.prototype.hasOwnProperty.call(osNormMap, rawOs)) {
        const err = new Error(`ค่า os ไม่ถูกต้อง: ${rawOs} (รองรับ any, windows, linux, darwin, posix)`);
        err.statusCode = 400;
        throw err;
    }
    const osReq = osNormMap[rawOs];

    // 3. Validate requires
    let requires = [];
    if (Array.isArray(opts.requires)) {
        requires = opts.requires.map((r) => String(r || '').trim()).filter(Boolean);
    } else if (typeof opts.requires === 'string' && opts.requires.trim()) {
        requires = opts.requires.split(',').map((r) => r.trim()).filter(Boolean);
    }
    if (requires.length > 30) {
        const err = new Error('requires เกินจำนวนสูงสุด (30)');
        err.statusCode = 400;
        throw err;
    }

    // 4. Validate setup
    let setup = '';
    if (typeof opts.setup === 'string') {
        setup = opts.setup.trim();
    } else if (opts.setup && typeof opts.setup === 'object' && !Array.isArray(opts.setup)) {
        const cleaned = {};
        for (const k of ['windows', 'win', 'posix', 'linux', 'darwin']) {
            if (typeof opts.setup[k] === 'string' && opts.setup[k].trim()) {
                cleaned[k] = opts.setup[k].trim();
            }
        }
        if (Object.keys(cleaned).length > 0) setup = cleaned;
    }

    // 5. Validate cacheKey
    const cacheKey = String(opts.cacheKey || '').trim();
    if (cacheKey && !/^[a-zA-Z0-9._-]{1,80}$/.test(cacheKey)) {
        const err = new Error('cacheKey ต้องใช้ตัวอักษร a-z, A-Z, 0-9, ., _, - เท่านั้น (ไม่เกิน 80 ตัว)');
        err.statusCode = 400;
        throw err;
    }

    // 6. Validate collect globs
    let collect = [];
    if (opts.collect !== undefined && opts.collect !== null) {
        if (!Array.isArray(opts.collect)) {
            const err = new Error('collect ต้องเป็น array ของ relative glob');
            err.statusCode = 400;
            throw err;
        }
        for (const g of opts.collect) {
            const s = String(g || '').trim();
            if (!s) continue;
            if (s.startsWith('/') || s.startsWith('\\') || /^[a-zA-Z]:/.test(s) || /(^|[\\/])\.\.([\\/]|$)/.test(s)) {
                const err = new Error(`collect glob ต้องเป็น relative path และห้ามมี '..': ${s}`);
                err.statusCode = 400;
                throw err;
            }
            collect.push(s);
        }
    }

    // 7. Validate env
    const env = {};
    if (opts.env !== undefined && opts.env !== null) {
        if (typeof opts.env !== 'object' || Array.isArray(opts.env)) {
            const err = new Error('env ต้องเป็น object { KEY: VALUE }');
            err.statusCode = 400;
            throw err;
        }
        const entries = Object.entries(opts.env);
        if (entries.length > 100) {
            const err = new Error('env เกินจำนวนสูงสุด (100)');
            err.statusCode = 400;
            throw err;
        }
        for (const [k, v] of entries) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
                const err = new Error(`ชื่อตัวแปร env ไม่ถูกต้อง: ${k}`);
                err.statusCode = 400;
                throw err;
            }
            env[k] = String(v ?? '');
        }
    }

    // 8. Validate timeoutSec
    let timeoutSec = 1800;
    if (opts.timeoutSec !== undefined && opts.timeoutSec !== null && opts.timeoutSec !== '') {
        const parsed = Number(opts.timeoutSec);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            const err = new Error('timeoutSec ต้องเป็นตัวเลขมากกว่า 0');
            err.statusCode = 400;
            throw err;
        }
        timeoutSec = Math.min(86400, Math.max(1, Math.floor(parsed)));
    }

    // 9. Validate inputs BEFORE checking node availability (invalid paths always return 400)
    const validatedInputs = validateJobInputs(opts.inputs);

    // 10. Validate requested nodeId & check matching online nodes
    const requestedNodeId = String(opts.nodeId || 'auto').trim() || 'auto';
    if (requestedNodeId.toLowerCase() !== 'auto') {
        const allOnline = [...nodes.values()].map(decorateNode).filter((n) => n.online);
        const resolved = resolveNodeRef(requestedNodeId, allOnline);
        if (resolved.ambiguous) {
            const err = new Error(`ชื่อเครื่อง "${requestedNodeId}" ตรงกับหลายเครื่อง: ${resolved.matches.map((m) => m.nodeId).join(', ')}`);
            err.statusCode = 409;
            err.code = 'AMBIGUOUS_NODE';
            throw err;
        }
    }

    const matchingNodes = findMatchingGenericNodes({
        nodeId: requestedNodeId,
        requires,
        os: osReq,
        command,
    });
    if (matchingNodes.length === 0) {
        const capDesc = requires.length > 0 ? ` (requires: ${requires.join(', ')})` : '';
        const osDesc = osReq !== 'any' ? ` (os: ${osReq})` : '';
        const err = new Error(`ไม่มีเครื่อง Worker Agent ที่ออนไลน์และตรงเงื่อนไข${capDesc}${osDesc}`);
        err.code = 'NO_NODE';
        err.statusCode = 409;
        throw err;
    }

    const freeNode = matchingNodes.find((n) => countNodeActiveJobs(n.nodeId) < getNodeMaxJobs(n)) || null;

    // 11. Create job record & pack inputs
    const jobId = `gjob_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const name = String(opts.name || '').trim().slice(0, 120) || 'job';
    const nowIso = new Date().toISOString();

    const job = {
        jobId,
        kind: 'generic',
        name,
        requestedNodeId,
        nodeId: '',
        hostname: '',
        alias: '',
        nodeAlias: '',
        status: 'pending',
        progress: 0,
        message: 'รอเครื่องว่าง (คิว)',
        requires,
        os: osReq,
        command,
        setup,
        cacheKey,
        collect,
        env,
        timeoutSec,
        inputFilePath: '',
        inputUrl: '',
        inputSize: 0,
        inputNames: [],
        resultFilePath: '',
        resultUrl: '',
        resultSize: 0,
        exitCode: null,
        error: null,
        durationMs: 0,
        commandId: '',
        createdAt: nowIso,
        startedAt: null,
        dispatchedAt: null,
        updatedAt: nowIso,
        finishedAt: null,
    };

    if (validatedInputs.length > 0) {
        await packJobInputs(job, validatedInputs);
    }

    renderJobs.set(jobId, job);

    if (freeNode) {
        dispatchGenericJobToNode(job, freeNode);
    } else if (requestedNodeId.toLowerCase() !== 'auto') {
        const target = matchingNodes[0];
        job.nodeId = target.nodeId;
        job.hostname = String((target.specs && target.specs.hostname) || target.nodeId).trim();
        job.alias = String(target.alias || '').trim();
        job.nodeAlias = job.alias;
        job.message = `รอคิวบน ${job.alias || job.hostname || job.nodeId} (maxJobs=${getNodeMaxJobs(target)})`;
    }

    await saveJobs();
    return job;
}

async function cancelJob(jobId) {
    const id = String(jobId || '').trim();
    const job = renderJobs.get(id);
    if (!job) {
        return { ok: false, statusCode: 404, error: 'Job not found' };
    }

    const nowIso = new Date().toISOString();
    if (job.status === 'cancelled') {
        return { ok: true, jobId: id, status: 'cancelled' };
    }
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
        return {
            ok: false,
            statusCode: 409,
            jobId: id,
            status: job.status,
            error: `Job already finished with status=${job.status}`,
        };
    }

    // Case 1: Pending in hub queue (never dispatched yet)
    if (job.status === 'pending') {
        job.status = 'cancelled';
        job.message = 'ยกเลิกงานจากคิวสำเร็จ';
        job.error = 'Cancelled by user';
        job.finishedAt = nowIso;
        job.updatedAt = nowIso;
        await saveJobs();
        pumpGenericQueue();
        return { ok: true, jobId: id, status: 'cancelled' };
    }

    // Case 2: Command still queued in pendingCommands (agent hasn't pulled it yet)
    if (job.nodeId && job.commandId) {
        const q = pendingCommands.get(job.nodeId);
        if (Array.isArray(q)) {
            const idx = q.findIndex((c) => c && c.id === job.commandId);
            if (idx !== -1) {
                q.splice(idx, 1);
                job.status = 'cancelled';
                job.message = 'ยกเลิกงานก่อนส่งถึงเครื่องลูกข่ายสำเร็จ';
                job.error = 'Cancelled by user';
                job.finishedAt = nowIso;
                job.updatedAt = nowIso;
                await saveJobs();
                pumpGenericQueue();
                return { ok: true, jobId: id, status: 'cancelled' };
            }
        }
    }

    // Case 3: Dispatched / running on worker node
    const rawNode = job.nodeId ? nodes.get(job.nodeId) : null;
    const dec = rawNode ? decorateNode(rawNode) : null;
    if (!dec || !dec.online) {
        job.status = 'cancelled';
        job.message = 'ยกเลิกงานแล้ว (เครื่องลูกข่ายออฟไลน์)';
        job.error = 'Cancelled by user (node offline)';
        job.finishedAt = nowIso;
        job.updatedAt = nowIso;
        await saveJobs();
        pumpGenericQueue();
        return { ok: true, jobId: id, status: 'cancelled' };
    }

    job.status = 'cancelling';
    job.cancelRequestedAt = job.cancelRequestedAt || nowIso;
    job.message = 'กำลังส่งคำสั่งยกเลิกงานไปยังเครื่องลูกข่าย...';
    job.updatedAt = nowIso;
    enqueueCommand(job.nodeId, 'job.cancel', { jobId: id });
    await saveJobs();
    return { ok: true, jobId: id, status: 'cancelling' };
}

function runJobWatchdogTick() {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    let changed = false;

    for (const job of renderJobs.values()) {
        if (!job || job.kind !== 'generic') continue;
        if (TERMINAL_JOB_STATUSES.has(job.status)) continue;

        if (ACTIVE_DISPATCHED_STATUSES.has(job.status)) {
            // 1. Cancelling grace timeout
            if (job.status === 'cancelling') {
                const cancelRef = Date.parse(job.cancelRequestedAt || job.updatedAt || '') || 0;
                if (cancelRef && now - cancelRef > JOB_CANCELLING_GRACE_MS) {
                    job.status = 'cancelled';
                    job.error = job.error || 'Cancelled (agent confirmation timeout)';
                    job.message = 'ยกเลิกงานแล้ว';
                    job.finishedAt = nowIso;
                    job.updatedAt = nowIso;
                    changed = true;
                    continue;
                }
            }

            // 2. Worker node heartbeat lost detection
            const node = job.nodeId ? nodes.get(job.nodeId) : null;
            const lastSeenMs = node && node.lastSeenAt ? Date.parse(node.lastSeenAt) : 0;
            const ageMs = lastSeenMs ? Math.max(0, now - lastSeenMs) : Infinity;
            if (!node || ageMs > JOB_NODE_LOST_MS) {
                job.status = 'lost';
                const secs = Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : 'unknown';
                job.error = `Worker node ${job.nodeId || 'unknown'} went offline (last seen ${secs}s ago)`;
                job.message = 'เครื่องลูกข่ายขาดการติดต่อระหว่างทำงาน';
                job.finishedAt = nowIso;
                job.updatedAt = nowIso;
                changed = true;
                continue;
            }

            // 3. Hard timeout safety net (give agent +30s grace to report timeout itself)
            if (typeof job.timeoutSec === 'number' && job.timeoutSec > 0) {
                const startRef = Date.parse(job.startedAt || job.dispatchedAt || job.createdAt || '') || 0;
                if (startRef && now - startRef > (job.timeoutSec * 1000 + 30000)) {
                    job.status = 'timeout';
                    job.error = `Job exceeded timeout of ${job.timeoutSec}s (hub watchdog)`;
                    job.message = 'งานหมดเวลา (watchdog)';
                    job.finishedAt = nowIso;
                    job.updatedAt = nowIso;
                    changed = true;
                    if (job.nodeId) {
                        try { enqueueCommand(job.nodeId, 'job.cancel', { jobId: job.jobId }); } catch (_) {}
                    }
                    continue;
                }
            }
        }
    }

    const dispatched = pumpGenericQueue();
    if (changed && dispatched === 0) {
        saveJobs();
    }
}

function startJobWatchdog() {
    if (jobWatchdogTimer) return jobWatchdogTimer;
    jobWatchdogTimer = setInterval(() => {
        try {
            runJobWatchdogTick();
        } catch (err) {
            console.error('[AgentHub] Job watchdog error:', err.message);
        }
    }, JOB_WATCHDOG_INTERVAL_MS);
    if (typeof jobWatchdogTimer.unref === 'function') {
        jobWatchdogTimer.unref();
    }
    return jobWatchdogTimer;
}

function sanitizeJobForList(job) {
    if (!job || typeof job !== 'object') return null;
    const alias = getNodeAlias(job.nodeId, job.alias || job.nodeAlias);
    const out = {
        jobId: job.jobId,
        kind: job.kind || '',
        nodeId: job.nodeId || '',
        hostname: job.hostname || '',
        alias,
        nodeAlias: alias,
        status: job.status || 'queued',
        progress: typeof job.progress === 'number' ? job.progress : 0,
        message: job.message || '',
        createdAt: job.createdAt || null,
        updatedAt: job.updatedAt || null,
    };
    if (job.name !== undefined) out.name = job.name;
    if (job.compositionId !== undefined) out.compositionId = job.compositionId;
    if (job.phase !== undefined) out.phase = job.phase;
    if (job.exitCode !== undefined) out.exitCode = job.exitCode;
    if (job.error !== undefined) out.error = job.error;
    if (job.resultUrl !== undefined) out.resultUrl = job.resultUrl;
    if (job.resultSize !== undefined) out.resultSize = job.resultSize;
    if (job.downloadUrl !== undefined) out.downloadUrl = job.downloadUrl;
    if (job.previewUrl !== undefined) out.previewUrl = job.previewUrl;
    if (job.outputName !== undefined) out.outputName = job.outputName;
    if (job.outputSize !== undefined) out.outputSize = job.outputSize;
    if (job.encoder !== undefined) out.encoder = job.encoder;
    if (job.renderDurationMs !== undefined) out.renderDurationMs = job.renderDurationMs;
    if (job.durationMs !== undefined) out.durationMs = job.durationMs;
    if (job.requires !== undefined) out.requires = job.requires;
    if (job.os !== undefined) out.os = job.os;
    if (job.cacheKey !== undefined) out.cacheKey = job.cacheKey;
    if (job.timeoutSec !== undefined) out.timeoutSec = job.timeoutSec;
    if (job.inputUrl !== undefined) out.inputUrl = job.inputUrl;
    if (job.inputSize !== undefined) out.inputSize = job.inputSize;
    if (job.inputNames !== undefined) out.inputNames = job.inputNames;
    if (job.startedAt !== undefined) out.startedAt = job.startedAt;
    if (job.finishedAt !== undefined) out.finishedAt = job.finishedAt;
    return out;
}

function listJobs({ kind = '', limit = 50 } = {}) {
    const kindFilter = String(kind || '').trim().toLowerCase();
    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    let items = [...renderJobs.values()].filter(Boolean);
    if (kindFilter) {
        items = items.filter((j) => String(j.kind || '').trim().toLowerCase() === kindFilter);
    }
    items.sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));
    return items.slice(0, lim).map(sanitizeJobForList);
}

function handleJobProgress(body) {
    const jobId = String((body && body.jobId) || '').trim();
    const job = renderJobs.get(jobId);
    if (!job) return { ok: false, error: 'Job not found' };

    const nowIso = new Date().toISOString();
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
        // Respect already-finished terminal status; only backfill missing exitCode/durationMs
        if ((job.exitCode === undefined || job.exitCode === null) && typeof body.exitCode === 'number' && Number.isFinite(body.exitCode)) {
            job.exitCode = body.exitCode;
        }
        if (!job.durationMs && typeof body.durationMs === 'number' && Number.isFinite(body.durationMs)) {
            job.durationMs = body.durationMs;
        }
        return { ok: true, job, ignored: true };
    }

    const nextStatus = body.status ? String(body.status).trim() : '';
    if (nextStatus) {
        if (job.status === 'cancelling' && !TERMINAL_JOB_STATUSES.has(nextStatus)) {
            // Do not revert 'cancelling' back to 'running'/'uploading'
        } else {
            job.status = nextStatus;
        }
    }
    if (typeof body.progress === 'number' && Number.isFinite(body.progress)) {
        job.progress = Math.max(0, Math.min(100, body.progress));
    }
    if (body.message !== undefined && body.message !== null && String(body.message) !== '') {
        job.message = String(body.message);
    }
    if (typeof body.exitCode === 'number' && Number.isFinite(body.exitCode)) {
        job.exitCode = body.exitCode;
    }
    if (body.error !== undefined && body.error !== null && String(body.error) !== '') {
        job.error = String(body.error);
    }
    if (typeof body.durationMs === 'number' && Number.isFinite(body.durationMs)) {
        job.durationMs = body.durationMs;
    }
    if (body.startedAt && !job.startedAt) {
        job.startedAt = String(body.startedAt);
    }
    if (!job.startedAt && (job.status === 'running' || job.status === 'setup' || job.status === 'downloading' || job.status === 'rendering')) {
        job.startedAt = nowIso;
    }

    const nowTerminal = TERMINAL_JOB_STATUSES.has(job.status);
    if (nowTerminal && !job.finishedAt) {
        job.finishedAt = body.finishedAt ? String(body.finishedAt) : nowIso;
    }
    if (job.status === 'completed' && (typeof job.progress !== 'number' || job.progress < 100)) {
        job.progress = 100;
    }

    job.updatedAt = nowIso;
    saveJobs();

    if (nowTerminal) {
        pumpGenericQueue();
    }
    return { ok: true, job };
}

function handleJobLog(body) {
    const jobId = String((body && body.jobId) || '').trim();
    const job = renderJobs.get(jobId);
    if (!job) return { ok: false, error: 'Job not found' };

    if (Array.isArray(body.lines) && body.lines.length > 0) {
        let buf = jobLogs.get(jobId);
        if (!buf) {
            buf = [];
            jobLogs.set(jobId, buf);
        }
        for (const rawLine of body.lines) {
            if (rawLine === null || rawLine === undefined) continue;
            buf.push(String(rawLine).slice(0, MAX_JOB_LOG_LINE_LEN));
        }
        if (buf.length > MAX_JOB_LOG_LINES) {
            buf.splice(0, buf.length - MAX_JOB_LOG_LINES);
        }
        if (jobLogs.size > 120) {
            const firstKey = jobLogs.keys().next().value;
            if (firstKey && firstKey !== jobId) jobLogs.delete(firstKey);
        }
    }

    if (typeof body.progress === 'number' && Number.isFinite(body.progress) && !TERMINAL_JOB_STATUSES.has(job.status)) {
        const clamped = Math.max(0, Math.min(100, body.progress));
        job.progress = Math.max(typeof job.progress === 'number' ? job.progress : 0, clamped);
    }

    if (typeof body.phase === 'string' && body.phase.trim()) {
        job.phase = body.phase.trim();
    }

    if (body.stats && typeof body.stats === 'object' && !Array.isArray(body.stats)) {
        job.stats = { ...(job.stats || {}), ...body.stats };
    }

    if (job.status === 'queued') {
        job.status = job.kind === 'generic' ? 'running' : 'rendering';
        if (!job.startedAt) job.startedAt = new Date().toISOString();
    }

    job.updatedAt = new Date().toISOString();
    scheduleSaveJobsThrottled();
    return { ok: true };
}

function escapeHtmlAttr(str) {
    return String(str || '').replace(/[&<>"'`\\]/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;',
        '\\': '&#92;',
    })[ch]);
}

function buildJobLiveStatus(jobId) {
    const job = renderJobs.get(jobId);
    if (!job) return null;

    const rawNode = job.nodeId ? nodes.get(job.nodeId) : null;
    const dec = rawNode ? decorateNode(rawNode) : null;
    const specs = dec?.specs || {};
    const metrics = dec?.metrics || {};
    const memUsed = metrics.memUsed || 0;
    const memTotal = metrics.memTotal || 0;
    const nodeInfo = dec ? {
        nodeId: dec.nodeId,
        hostname: specs.hostname || dec.nodeId,
        online: Boolean(dec.online),
        cpuThreads: specs.cpuThreads || 0,
        cpuPct: metrics.cpuPct ?? null,
        memUsed,
        memTotal,
        memPct: memTotal ? Math.round((memUsed / memTotal) * 1000) / 10 : null,
        gpuModel: specs.gpuModel || '',
        gpuUtilPct: metrics.gpuUtilPct ?? null,
        gpuTempC: metrics.gpuTempC ?? null,
        gpuMemUsed: metrics.gpuMemUsed ?? null,
        gpuMemTotal: metrics.gpuMemTotal ?? null,
    } : null;

    const hasLiveFrame = Boolean(
        (job.liveFramePath && fs.existsSync(job.liveFramePath)) ||
        (job.previewFilePath && fs.existsSync(job.previewFilePath))
    );

    return {
        ok: true,
        jobId: job.jobId,
        kind: job.kind || '',
        nodeId: job.nodeId || '',
        hostname: job.hostname || nodeInfo?.hostname || job.nodeId || '',
        status: job.status || 'queued',
        progress: typeof job.progress === 'number' ? job.progress : 0,
        phase: job.phase || '',
        message: job.message || '',
        stats: job.stats || null,
        liveSeq: job.liveSeq || 0,
        liveUpdatedAt: job.liveUpdatedAt || null,
        hasLiveFrame,
        liveUrl: `/api/agent-hub/jobs/${encodeURIComponent(job.jobId)}/live`,
        previewUrl: job.previewUrl || '',
        downloadUrl: job.downloadUrl || '',
        outputName: job.outputName || '',
        outputSize: job.outputSize || 0,
        createdAt: job.createdAt || null,
        updatedAt: job.updatedAt || null,
        logTail: jobLogs.get(jobId) || [],
        node: nodeInfo,
    };
}

function parseMultipartFile(buf, contentType) {
    const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!m) throw new Error('Missing multipart boundary');
    const boundary = '--' + (m[1] || m[2]).trim();
    const boundaryBuf = Buffer.from(boundary, 'utf8');
    const headerSep = Buffer.from('\r\n\r\n', 'utf8');

    let pos = buf.indexOf(boundaryBuf);
    while (pos !== -1) {
        const start = pos + boundaryBuf.length;
        if (buf.slice(start, start + 2).toString() === '--') break;
        const partStart = start + 2; // skip \r\n
        const nextPos = buf.indexOf(boundaryBuf, partStart);
        if (nextPos === -1) break;
        const partBuf = buf.slice(partStart, nextPos - 2); // strip trailing \r\n
        const hEnd = partBuf.indexOf(headerSep);
        if (hEnd !== -1) {
            const headersStr = partBuf.slice(0, hEnd).toString('utf8');
            const contentBuf = partBuf.slice(hEnd + 4);
            if (/name="file"/i.test(headersStr)) {
                const fnMatch = headersStr.match(/filename="([^"]+)"/i);
                return {
                    filename: fnMatch ? path.basename(fnMatch[1]) : 'output.mp4',
                    data: contentBuf,
                };
            }
        }
        pos = nextPos;
    }
    return { filename: 'output.mp4', data: buf };
}

async function handleJobUpload(req, url) {
    const jobId = String(url.searchParams.get('jobId') || '').trim();
    const nodeId = String(url.searchParams.get('nodeId') || '').trim();
    if (!jobId) throw new Error('Missing jobId');

    const chunks = [];
    let total = 0;
    const maxUpload = 500 * 1024 * 1024; // 500 MB
    await new Promise((resolve, reject) => {
        req.on('data', (c) => {
            total += c.length;
            if (total > maxUpload) {
                req.destroy();
                reject(new Error('Upload exceeds 500MB limit'));
                return;
            }
            chunks.push(c);
        });
        req.on('end', resolve);
        req.on('error', reject);
    });

    const rawBuf = Buffer.concat(chunks);
    const ct = String(req.headers['content-type'] || '');
    let fileData = rawBuf;
    let filename = url.searchParams.get('filename') || `${jobId}.mp4`;
    if (ct.toLowerCase().includes('multipart/form-data')) {
        const parsed = parseMultipartFile(rawBuf, ct);
        fileData = parsed.data;
        if (parsed.filename) filename = parsed.filename;
    }

    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const jobDir = path.join(JOBS_DIR, jobId);
    await fsp.mkdir(jobDir, { recursive: true });
    const outPath = path.join(jobDir, safeName);
    await fsp.writeFile(outPath, fileData);

    const nowIso = new Date().toISOString();
    const job = renderJobs.get(jobId) || {
        jobId,
        nodeId,
        createdAt: nowIso,
    };
    let isLiveFrame = false;
    if (safeName.startsWith('live_')) {
        isLiveFrame = true;
        job.liveFramePath = outPath;
        job.liveSeq = (job.liveSeq || 0) + 1;
        job.liveUpdatedAt = nowIso;
    } else if (job.previewName && safeName === job.previewName) {
        job.previewFilePath = outPath;
        job.previewUrl = `/api/agent-hub/jobs/${encodeURIComponent(jobId)}/preview`;
        job.liveSeq = (job.liveSeq || 0) + 1;
        job.liveUpdatedAt = nowIso;
    } else if (job.kind === 'generic' && safeName === 'result.tar.gz') {
        job.resultFilePath = outPath;
        job.resultUrl = `/api/agent-hub/jobs/${encodeURIComponent(jobId)}/result`;
        job.resultSize = fileData.length;
    } else {
        job.status = 'completed';
        job.progress = 100;
        job.outputName = safeName;
        job.outputFilePath = outPath;
        job.outputSize = fileData.length;
        job.downloadUrl = `/api/agent-hub/jobs/${encodeURIComponent(jobId)}/output`;
    }
    job.updatedAt = nowIso;
    renderJobs.set(jobId, job);
    if (isLiveFrame) {
        scheduleSaveJobsThrottled();
    } else {
        await saveJobs();
    }

    return {
        ok: true,
        jobId,
        filename: safeName,
        size: fileData.length,
        liveSeq: job.liveSeq || 0,
        downloadUrl: job.downloadUrl || '',
        previewUrl: job.previewUrl || '',
        resultUrl: job.resultUrl || '',
    };
}

function buildPowerShellInstaller(originHint) {
    const urls = [...hubConfig.hubUrls];
    if (originHint && !urls.includes(originHint)) {
        urls.unshift(originHint);
    }
    const urlsStr = urls.join(',');
    const Endpoints = urls.map((u) => `"${u}"`).join(', ');
    return `# Homelab Worker Agent — One-Click Windows Installer
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
    add-type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAllCertsPolicy : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint srvPoint, X509Certificate certificate, WebRequest request, int certificateProblem) {
        return true;
    }
}
"@
    [System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAllCertsPolicy
} catch {}

$InstallDir = Join-Path $env:LOCALAPPDATA "HomelabAgent"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$ExePath = Join-Path $InstallDir "homelab-agent.exe"

$Endpoints = @(${Endpoints})
$Downloaded = $false
foreach ($ep in $Endpoints) {
    try {
        Write-Host "Downloading homelab-agent.exe from $ep ..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri "$ep/api/agent-hub/download/homelab-agent.exe" -OutFile "$ExePath.new" -UseBasicParsing -TimeoutSec 15
        if ((Get-Item "$ExePath.new").Length -gt 500000) {
            try {
                Get-Process -Name "homelab-agent*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            } catch {}
            Start-Sleep -Milliseconds 400
            Move-Item -Force "$ExePath.new" $ExePath
            $Downloaded = $true
            break
        }
    } catch {
        Write-Host "  -> $ep unreachable, trying next..." -ForegroundColor DarkGray
    }
}

if (-not $Downloaded) {
    Write-Error "Failed to download homelab-agent.exe from any Homelab endpoint."
    exit 1
}

& $ExePath --install --hub "${urlsStr}" --token "${hubConfig.token}"
Write-Host "✅ Homelab Agent installed and running in background!" -ForegroundColor Green
`;
}

function buildBashInstaller(originHint) {
    const urls = [...hubConfig.hubUrls];
    if (originHint && !urls.includes(originHint)) {
        urls.unshift(originHint);
    }
    const urlsStr = urls.join(',');
    return `#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="$HOME/.local/share/homelab-agent"
mkdir -p "$INSTALL_DIR"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
if [[ "$ARCH" == "x86_64" ]]; then ARCH="amd64"; fi
if [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then ARCH="arm64"; fi
BIN_NAME="homelab-agent-\${OS}-\${ARCH}"
TARGET="$INSTALL_DIR/homelab-agent"

for EP in ${urls.map((u) => `"${u}"`).join(' ')}; do
  if curl -fsSLk --connect-timeout 5 "$EP/api/agent-hub/download/$BIN_NAME" -o "$TARGET.new"; then
    chmod +x "$TARGET.new"
    mv -f "$TARGET.new" "$TARGET"
    break
  fi
done

pkill -f "$TARGET" 2>/dev/null || true
nohup "$TARGET" --service --hub "${urlsStr}" --token "${hubConfig.token}" >/dev/null 2>&1 &
echo "✅ Homelab Agent started in background (PID $!)"
`;
}

async function getHubStatus() {
    ensureDirsSync();
    const binaries = [];
    for (const f of ['homelab-agent.exe', 'homelab-agent-linux-amd64', 'homelab-agent-darwin-arm64']) {
        const p = path.join(BIN_DIR, f);
        if (fs.existsSync(p)) {
            const st = fs.statSync(p);
            binaries.push({
                filename: f,
                size: st.size,
                updatedAt: st.mtime.toISOString(),
                downloadUrl: `/api/agent-hub/download/${f}`,
            });
        }
    }

    const decoratedNodes = [...nodes.values()].map(decorateNode);
    decoratedNodes.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return String(a.nodeId).localeCompare(String(b.nodeId));
    });

    const onlineNodes = decoratedNodes.filter((n) => n.online);
    const totalThreads = onlineNodes.reduce((acc, n) => acc + ((n.specs && n.specs.cpuThreads) || 0), 0);
    const totalRamBytes = onlineNodes.reduce((acc, n) => acc + ((n.metrics && n.metrics.memTotal) || 0), 0);
    const nvencNodes = onlineNodes.filter((n) => n.specs && n.specs.hasNvenc).length;

    return {
        ok: true,
        agentVersion: hubConfig.agentVersion,
        token: hubConfig.token,
        hubUrls: hubConfig.hubUrls,
        binaries,
        cluster: {
            totalNodes: decoratedNodes.length,
            onlineNodes: onlineNodes.length,
            totalThreads,
            totalRamBytes,
            nvencNodes,
        },
        nodes: decoratedNodes,
        recentCommands: [...commandHistory.values()].slice(-25).reverse().map((c) => ({
            id: c.id,
            nodeId: c.nodeId,
            action: c.action,
            status: c.status,
            createdAt: c.createdAt,
            finishedAt: c.finishedAt || null,
            result: c.result,
        })),
        renderJobs: [...renderJobs.values()]
            .slice(-25)
            .reverse()
            .map((j) => sanitizeJobForList(j)),
    };
}

async function handleApi(req, res, url, { sendJson, readJsonBody, clientIp }) {
    const p = url.pathname;

    // 1. Public / Token-authenticated binary downloads & installers
    const isGetOrHead = req.method === 'GET' || req.method === 'HEAD';
    if (isGetOrHead && p.startsWith('/api/agent-hub/download/')) {
        const fname = path.basename(p.slice('/api/agent-hub/download/'.length));
        const allowed = new Set(['homelab-agent.exe', 'homelab-agent-linux-amd64', 'homelab-agent-darwin-arm64']);
        if (!allowed.has(fname)) {
            sendJson(res, 404, { ok: false, error: 'Binary not found' });
            return true;
        }
        const filePath = path.join(BIN_DIR, fname);
        if (!fs.existsSync(filePath)) {
            await compileBinaries(false);
        }
        if (!fs.existsSync(filePath)) {
            sendJson(res, 500, { ok: false, error: 'Binary build unavailable' });
            return true;
        }
        const st = await fsp.stat(filePath);
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(st.size),
            'Content-Disposition': `attachment; filename="${fname}"`,
            'Cache-Control': 'no-store',
        });
        if (req.method === 'HEAD') {
            res.end();
        } else {
            fs.createReadStream(filePath).pipe(res);
        }
        return true;
    }

    if (isGetOrHead && p === '/api/agent-hub/install.ps1') {
        const proto = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host || '100.93.214.79';
        const ps = buildPowerShellInstaller(`${proto}://${host}`);
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? '' : ps);
        return true;
    }

    if (isGetOrHead && p === '/api/agent-hub/install.sh') {
        const proto = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host || '100.93.214.79';
        const sh = buildBashInstaller(`${proto}://${host}`);
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? '' : sh);
        return true;
    }

    // 2. Agent-to-Hub endpoints (authenticated with X-Agent-Token)
    if (p.startsWith('/api/agent-hub/agent/')) {
        const tok = extractTokenFromReq(req, url);
        if (!verifyAgentToken(tok)) {
            sendJson(res, 401, { ok: false, error: 'Invalid X-Agent-Token' });
            return true;
        }

        if (req.method === 'GET' && p === '/api/agent-hub/agent/self-status') {
            const nodeId = String(url.searchParams.get('nodeId') || req.headers['x-agent-node'] || '').trim().toLowerCase();
            if (!nodeId) {
                sendJson(res, 400, { ok: false, error: 'Missing nodeId' });
                return true;
            }
            res.setHeader('Cache-Control', 'no-store');
            sendJson(res, 200, buildSelfStatus(nodeId));
            return true;
        }

        if (req.method === 'POST' && p === '/api/agent-hub/agent/heartbeat') {
            const body = await readJsonBody(req, 512 * 1024);
            const ip = typeof clientIp === 'function' ? clientIp(req) : (req.socket && req.socket.remoteAddress) || '';
            const out = handleHeartbeat(body, ip);
            sendJson(res, 200, out);
            return true;
        }

        if (req.method === 'GET' && p === '/api/agent-hub/agent/poll') {
            const nodeId = String(url.searchParams.get('nodeId') || req.headers['x-agent-node'] || '').trim().toLowerCase();
            if (!nodeId) {
                sendJson(res, 400, { ok: false, error: 'Missing nodeId' });
                return true;
            }
            if (nodes.has(nodeId)) {
                nodes.get(nodeId).lastSeenAt = new Date().toISOString();
            }

            const immediate = drainPendingCommands(nodeId);
            if (immediate.length > 0) {
                sendJson(res, 200, { ok: true, commands: immediate });
                return true;
            }

            const timeoutSec = Math.min(30, Math.max(5, parseInt(url.searchParams.get('timeout') || '25', 10) || 25));
            if (!pollWaiters.has(nodeId)) pollWaiters.set(nodeId, new Set());
            const waiters = pollWaiters.get(nodeId);

            const waiter = {
                sendJson: (code, obj) => sendJson(res, code, obj),
                timer: null,
            };
            waiter.timer = setTimeout(() => {
                waiters.delete(waiter);
                if (!res.writableEnded) {
                    sendJson(res, 200, { ok: true, commands: [] });
                }
            }, timeoutSec * 1000);

            waiters.add(waiter);
            req.on('close', () => {
                clearTimeout(waiter.timer);
                waiters.delete(waiter);
            });
            return true;
        }

        if (req.method === 'POST' && p === '/api/agent-hub/agent/result') {
            const body = await readJsonBody(req, 16 * 1024 * 1024);
            const out = handleCommandResult(body);
            sendJson(res, 200, out);
            return true;
        }

        if (req.method === 'POST' && p === '/api/agent-hub/agent/job-progress') {
            const body = await readJsonBody(req, 256 * 1024);
            const out = handleJobProgress(body);
            sendJson(res, 200, out);
            return true;
        }

        if (req.method === 'POST' && p === '/api/agent-hub/agent/job-log') {
            const body = await readJsonBody(req, 512 * 1024);
            const out = handleJobLog(body);
            sendJson(res, 200, out);
            return true;
        }

        if (req.method === 'POST' && p === '/api/agent-hub/agent/job-upload') {
            try {
                const out = await handleJobUpload(req, url);
                sendJson(res, 200, out);
            } catch (err) {
                sendJson(res, 400, { ok: false, error: err.message });
            }
            return true;
        }
    }

    // 3. Job Input / Output / Preview / Live file streaming, Bundle download & Live Monitor (accessible by Agent Token, Localhost, or Dashboard Session)
    const bundleMatch = p.match(/^\/api\/agent-hub\/bundles\/([a-f0-9]{16})\.tar\.gz$/);
    if (isGetOrHead && bundleMatch) {
        const [, hash] = bundleMatch;
        const filePath = path.join(BUNDLES_DIR, `motion-studio-${hash}.tar.gz`);
        if (!fs.existsSync(filePath)) {
            sendJson(res, 404, { ok: false, error: 'Bundle not found' });
            return true;
        }
        const st = await fsp.stat(filePath);
        res.writeHead(200, {
            'Content-Type': 'application/gzip',
            'Content-Length': String(st.size),
            'Content-Disposition': `attachment; filename="motion-studio-${hash}.tar.gz"`,
            'Cache-Control': 'private, max-age=3600',
        });
        if (req.method === 'HEAD') {
            res.end();
        } else {
            fs.createReadStream(filePath).pipe(res);
        }
        return true;
    }

    if (req.method === 'POST' && p === '/api/agent-hub/jobs') {
        let body;
        try {
            body = await readJsonBody(req, 2 * 1024 * 1024);
        } catch (err) {
            sendJson(res, 400, { ok: false, error: err.message || 'Invalid JSON body' });
            return true;
        }
        try {
            const job = await createGenericJob(body || {});
            sendJson(res, 200, { ok: true, job: sanitizeJobForList(job) });
        } catch (err) {
            if (err && (err.code === 'NO_NODE' || err.statusCode === 409)) {
                sendJson(res, 409, { ok: false, code: err.code || 'NO_NODE', error: err.message });
            } else {
                sendJson(res, (err && err.statusCode) || 400, { ok: false, error: err.message });
            }
        }
        return true;
    }

    if (req.method === 'GET' && p === '/api/agent-hub/jobs') {
        const kind = String(url.searchParams.get('kind') || '').trim();
        const limit = url.searchParams.get('limit') || '50';
        const jobs = listJobs({ kind, limit });
        res.setHeader('Cache-Control', 'no-store');
        sendJson(res, 200, { ok: true, jobs });
        return true;
    }

    const jobCancelMatch = p.match(/^\/api\/agent-hub\/jobs\/([a-zA-Z0-9_-]+)\/cancel$/);
    if (req.method === 'POST' && jobCancelMatch) {
        const [, jobId] = jobCancelMatch;
        const out = await cancelJob(jobId);
        const statusCode = out.statusCode || (out.ok ? 200 : 400);
        const { statusCode: _sc, ...payload } = out;
        sendJson(res, statusCode, payload);
        return true;
    }

    const jobStatusMatch = p.match(/^\/api\/agent-hub\/jobs\/([a-zA-Z0-9_-]+)$/);
    if (req.method === 'GET' && jobStatusMatch) {
        const [, jobId] = jobStatusMatch;
        const job = renderJobs.get(jobId);
        if (!job) {
            sendJson(res, 404, { ok: false, error: 'Render job not found' });
            return true;
        }
        res.setHeader('Cache-Control', 'no-store');
        const alias = getNodeAlias(job.nodeId, job.alias || job.nodeAlias);
        sendJson(res, 200, {
            ok: true,
            job: {
                ...job,
                alias,
                nodeAlias: alias,
                logTail: jobLogs.get(jobId) || [],
            },
        });
        return true;
    }

    const jobFileMatch = p.match(/^\/api\/agent-hub\/jobs\/([a-zA-Z0-9_-]+)\/(input|output|preview|live|result)$/);
    if (isGetOrHead && jobFileMatch) {
        const [, jobId, kind] = jobFileMatch;
        const job = renderJobs.get(jobId);
        if (!job) {
            sendJson(res, 404, { ok: false, error: 'Render job not found' });
            return true;
        }
        const targetPath = kind === 'input'
            ? job.inputFilePath
            : kind === 'preview'
                ? job.previewFilePath
                : kind === 'live'
                    ? (job.liveFramePath || job.previewFilePath)
                    : kind === 'result'
                        ? job.resultFilePath
                        : job.outputFilePath;
        if (!targetPath || !fs.existsSync(targetPath)) {
            sendJson(res, 404, { ok: false, error: `${kind} file not found` });
            return true;
        }
        const st = await fsp.stat(targetPath);
        const fname = path.basename(targetPath);
        const ext = path.extname(fname).toLowerCase();
        const mimeMap = {
            '.mp4': 'video/mp4',
            '.json': 'application/json; charset=utf-8',
            '.gz': 'application/gzip',
            '.tgz': 'application/gzip',
            '.tar': 'application/x-tar',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.glb': 'model/gltf-binary',
            '.gltf': 'model/gltf+json',
            '.stl': 'model/stl',
            '.obj': 'text/plain; charset=utf-8',
            '.fbx': 'application/octet-stream',
            '.blend': 'application/octet-stream',
        };
        const contentType = mimeMap[ext] || 'application/octet-stream';
        const disp = (kind === 'live' || ((ext === '.png' || ext === '.jpg' || ext === '.jpeg') && !url.searchParams.get('download')))
            ? `inline; filename="${fname}"`
            : `attachment; filename="${fname}"`;
        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': String(st.size),
            'Content-Disposition': disp,
            'Cache-Control': 'no-store',
        });
        if (req.method === 'HEAD') {
            res.end();
        } else {
            fs.createReadStream(targetPath).pipe(res);
        }
        return true;
    }

    const jobLiveStatusMatch = p.match(/^\/api\/agent-hub\/jobs\/([a-zA-Z0-9_-]+)\/live-status$/);
    if (req.method === 'GET' && jobLiveStatusMatch) {
        const [, jobId] = jobLiveStatusMatch;
        const payload = buildJobLiveStatus(jobId);
        if (!payload) {
            sendJson(res, 404, { ok: false, error: 'Render job not found' });
            return true;
        }
        res.setHeader('Cache-Control', 'no-store');
        sendJson(res, 200, payload);
        return true;
    }

    const jobMonitorMatch = p.match(/^\/api\/agent-hub\/jobs\/([a-zA-Z0-9_-]+)\/monitor$/);
    if (req.method === 'GET' && jobMonitorMatch) {
        const [, jobId] = jobMonitorMatch;
        try {
            const tpl = await fsp.readFile(MONITOR_HTML_PATH, 'utf8');
            const html = tpl.replace(/__JOB_ID__/g, escapeHtmlAttr(jobId));
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            res.end(html);
        } catch (err) {
            sendJson(res, 500, { ok: false, error: `Monitor template unavailable: ${err.message}` });
        }
        return true;
    }

    if (req.method === 'GET' && p === '/api/agent-hub/blender-monitor') {
        const blenderJobs = [...renderJobs.values()]
            .filter((j) => j && j.kind === 'blender-3d')
            .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));
        if (blenderJobs.length === 0) {
            const emptyHtml = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blender Live Monitor</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0f17;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}.card{background:#121826;border:1px solid #1e293b;border-radius:14px;padding:28px 32px;text-align:center;max-width:420px;box-shadow:0 12px 32px rgba(0,0,0,.4)}h1{margin:0 0 8px;font-size:20px;color:#38bdf8}p{margin:0 0 18px;font-size:14px;color:#94a3b8;line-height:1.6}button{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer}button:hover{background:#334155}</style></head><body><div class="card"><h1>🎨 Blender Live Monitor</h1><p>ยังไม่มีงาน Blender 3D ในระบบขณะนี้<br>เมื่อมีการสั่งเรนเดอร์ หน้านี้จะแสดงความคืบหน้าแบบเรียลไทม์โดยอัตโนมัติ</p><button onclick="location.reload()">รีเฟรช</button></div><script>setTimeout(()=>location.reload(),5000);</script></body></html>`;
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            res.end(emptyHtml);
            return true;
        }
        try {
            const latestJob = blenderJobs[0];
            const tpl = await fsp.readFile(MONITOR_HTML_PATH, 'utf8');
            const html = tpl.replace(/__JOB_ID__/g, escapeHtmlAttr(latestJob.jobId));
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            res.end(html);
        } catch (err) {
            sendJson(res, 500, { ok: false, error: `Monitor template unavailable: ${err.message}` });
        }
        return true;
    }

    // 4. Dashboard UI & CLI Control endpoints
    if (req.method === 'GET' && p === '/api/agent-hub/status') {
        sendJson(res, 200, await getHubStatus());
        return true;
    }

    if (req.method === 'GET' && p === '/api/agent-hub/mini') {
        const list = [...nodes.values()]
            .map(decorateNode)
            .sort((a, b) => Number(b.online) - Number(a.online));
        const onlineNodes = list.filter((n) => n.online).length;
        const miniNodes = list.map((n) => {
            const specs = n.specs || {};
            const metrics = n.metrics || {};
            const memUsed = metrics.memUsed || 0;
            const memTotal = metrics.memTotal || 0;
            return {
                nodeId: n.nodeId,
                alias: n.alias || '',
                notes: n.notes || '',
                displayName: n.displayName || specs.hostname || n.nodeId,
                hostname: specs.hostname || n.nodeId,
                os: specs.os || specs.osCaption || '',
                online: !!n.online,
                paused: !!n.paused,
                workerState: n.workerState || (n.online ? 'idle' : 'offline'),
                activeJobs: n.activeJobs || 0,
                currentJobs: Array.isArray(n.currentJobs) ? n.currentJobs : [],
                ageMs: n.ageMs,
                cpuThreads: specs.cpuThreads || 0,
                hasNvenc: !!specs.hasNvenc,
                gpuModel: specs.gpuModel || '',
                cpuPct: metrics.cpuPct ?? null,
                memUsed,
                memTotal,
                memPct: memTotal ? Math.round((memUsed / memTotal) * 1000) / 10 : null,
                gpuUtilPct: metrics.gpuUtilPct ?? null,
                gpuTempC: metrics.gpuTempC ?? null,
            };
        });
        sendJson(res, 200, {
            ok: true,
            totalNodes: list.length,
            onlineNodes,
            nodes: miniNodes,
        });
        return true;
    }

    if (req.method === 'POST' && p === '/api/agent-hub/build') {
        const results = await compileBinaries(true);
        sendJson(res, 200, { ok: true, results });
        return true;
    }

    if (req.method === 'POST' && p === '/api/agent-hub/command') {
        const body = await readJsonBody(req, 16 * 1024 * 1024);
        const rawNodeRef = String(body.nodeId || '').trim();
        const action = String(body.action || '').trim();
        const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
        const wait = body.wait !== false;
        const timeoutMs = Math.min(600000, Math.max(3000, Number(body.timeoutMs) || 45000));

        if (!rawNodeRef || !action) {
            sendJson(res, 400, { ok: false, error: 'nodeId and action are required' });
            return true;
        }
        const resolved = resolveNodeRef(rawNodeRef);
        if (resolved.ambiguous) {
            sendJson(res, 409, {
                ok: false,
                error: `ชื่อเครื่อง "${rawNodeRef}" ตรงกับหลายเครื่อง: ${resolved.matches.map((m) => m.alias ? `${m.alias} (${m.nodeId})` : m.nodeId).join(', ')}`,
            });
            return true;
        }
        if (!resolved.node) {
            sendJson(res, 404, { ok: false, error: `ไม่พบเครื่องลูกข่าย "${rawNodeRef}"` });
            return true;
        }
        const nodeId = resolved.node.nodeId;
        if (wait) {
            const resObj = await dispatchAndWait(nodeId, action, payload, timeoutMs);
            sendJson(res, 200, resObj);
        } else {
            const { cmd, dispatchedImmediately } = enqueueCommand(nodeId, action, payload);
            sendJson(res, 200, { ok: true, commandId: cmd.id, nodeId, dispatchedImmediately });
        }
        return true;
    }

    if (req.method === 'POST' && p === '/api/agent-hub/render-jobs') {
        const body = await readJsonBody(req, 1024 * 1024);
        try {
            const job = await createRenderJob(body);
            sendJson(res, 200, { ok: true, job });
        } catch (err) {
            sendJson(res, 400, { ok: false, error: err.message });
        }
        return true;
    }

    if (req.method === 'POST' && p === '/api/agent-hub/blender-jobs') {
        const body = await readJsonBody(req, 8 * 1024 * 1024);
        try {
            const job = await createBlenderJob(body);
            sendJson(res, 200, { ok: true, job });
        } catch (err) {
            sendJson(res, 400, { ok: false, error: err.message });
        }
        return true;
    }

    if (req.method === 'POST' && p === '/api/agent-hub/remotion-jobs') {
        const body = await readJsonBody(req, 1024 * 1024);
        try {
            const job = await createRemotionJob(body);
            sendJson(res, 200, { ok: true, job });
        } catch (err) {
            if (err && err.code === 'NO_NODE') {
                sendJson(res, 409, { ok: false, code: 'NO_NODE', error: err.message });
            } else {
                sendJson(res, 400, { ok: false, error: err.message });
            }
        }
        return true;
    }

    const nodeMetaMatch = p.match(/^\/api\/agent-hub\/nodes\/([^/]+?)(?:\/meta)?$/);
    if ((req.method === 'PATCH' || req.method === 'PUT' || (req.method === 'POST' && p.endsWith('/meta'))) && nodeMetaMatch) {
        const nodeIdParam = decodeURIComponent(nodeMetaMatch[1]);
        const body = await readJsonBody(req, 64 * 1024);
        try {
            const updated = await updateNodeMeta(nodeIdParam, body);
            sendJson(res, 200, { ok: true, node: updated });
        } catch (err) {
            sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
        }
        return true;
    }

    if (req.method === 'DELETE' && p.startsWith('/api/agent-hub/nodes/')) {
        const nodeId = decodeURIComponent(p.slice('/api/agent-hub/nodes/'.length)).trim().toLowerCase();
        const existed = nodes.delete(nodeId);
        pendingCommands.delete(nodeId);
        scheduleSaveNodes();
        sendJson(res, 200, { ok: true, deleted: existed, nodeId });
        return true;
    }

    return false;
}

module.exports = {
    init,
    getHubStatus,
    compileBinaries,
    verifyAgentToken,
    isPublicOrAgentAuthorized,
    handleApi,
    dispatchAndWait,
    enqueueCommand,
    createRenderJob,
    selectBestRenderNode,
    createBlenderJob,
    selectBestBlenderNode,
    createRemotionJob,
    selectBestRemotionNode,
    findMatchingGenericNodes,
    selectBestGenericNode,
    createGenericJob,
    packJobInputs,
    pumpGenericQueue,
    cancelJob,
    startJobWatchdog,
    listJobs,
    resolveNodeRef,
    updateNodeMeta,
    decorateNode,
    handleHeartbeat,
    buildSelfStatus,
};
