'use strict';

/**
 * social-publish-manager.js
 * -----------------------------------------------------------------------------
 * Option C — Hybrid Pluggable SocialAdapter Engine for Homelab Video Factory OS.
 *
 * Platforms & Modes:
 *  1. telegram  : Live Bot API via /home/dev/.local/share/motion-studio/scripts/send_telegram_video.py
 *                 (auto-compresses < 48 MiB copy while leaving Master MP4 intact)
 *  2. youtube   : Official YouTube Data API v3 (plugin-ready via YOUTUBE_CLIENT_ID /
 *                 YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN) with automatic
 *                 fallback to Export Kit when credentials are not yet configured
 *  3. tiktok    : Browser Vision Semi-Auto (lab-browser shared-auth session) + Manual Export Kit
 *  4. facebook  : Browser Vision Semi-Auto (Meta Business Suite Reels) + Manual Export Kit
 *  5. instagram : Browser Vision Semi-Auto (Instagram / Meta Reels) + Manual Export Kit
 *  + Postiz Adapter Hook: if POSTIZ_URL & POSTIZ_API_KEY are set in .social.env,
 *    direct API dispatch through Postiz becomes available seamlessly.
 *
 * Also includes:
 *  - AI Caption & Hashtag Pack Generator (Gemini REST API + deterministic Thai fallback)
 *  - Persistent Queue & 60s Scheduler (social_queue.json)
 *  - 7-Day Publishing Calendar
 *
 * Safety Guarantees:
 *  - Zero secrets/tokens returned by any public method (including listAdapters)
 *  - Pure argument-array spawn/execFile (zero shell interpolation)
 *  - Strict ID validation (/^[a-z0-9-]{6,40}$/)
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { execFile, spawn } = require('child_process');

const videoStudioManager = require('./video-studio-manager');

const SOCIAL_DIR = path.join(videoStudioManager.OUT_ROOT, 'social');
const QUEUE_PATH = path.join(SOCIAL_DIR, 'social_queue.json');
const CONFIG_PATH = path.join(SOCIAL_DIR, 'social_config.json');

const SEND_TELEGRAM_SCRIPT = '/home/dev/.local/share/motion-studio/scripts/send_telegram_video.py';
const LAB_BROWSER_BIN = '/home/dev/.local/bin/lab-browser';
const TELEGRAM_ENV_PATH = '/home/dev/projects/.telegram.env';
const SOCIAL_ENV_PATH = '/home/dev/projects/.social.env';
const GEMINI_ENV_PATHS = [
    '/home/dev/.gemini/.env',
    '/home/dev/projects/lab-stack/.env',
    '/home/dev/projects/.env',
];

const DASHBOARD_ORIGIN = process.env.DASHBOARD_PUBLIC_ORIGIN || 'https://homelab.tail285279.ts.net';
const ID_RE = /^[a-z0-9-]{6,40}$/;
const SCHEDULER_INTERVAL_MS = 60 * 1000;

let schedulerTimer = null;
let schedulerRunning = false;

const PLATFORM_DEFS = [
    {
        key: 'telegram',
        short: 'TG',
        name: 'Telegram Channel / Bot',
        modeLabel: 'Bot API · ยิงจริงทันที',
        uploadUrl: 'https://web.telegram.org/',
        browserProfile: null,
        supportsDirectApi: true,
        supportsBrowserVision: false,
        supportsExportKit: true,
        defaultEnabled: true,
        maxCaptionLen: 1000,
    },
    {
        key: 'youtube',
        short: 'YT',
        name: 'YouTube Shorts',
        modeLabel: 'Official API v3 · พร้อมเสียบคีย์',
        uploadUrl: 'https://studio.youtube.com/',
        browserProfile: 'youtube-studio',
        supportsDirectApi: true,
        supportsBrowserVision: true,
        supportsExportKit: true,
        defaultEnabled: true,
        maxCaptionLen: 4800,
    },
    {
        key: 'tiktok',
        short: 'TT',
        name: 'TikTok',
        modeLabel: 'Browser Vision Semi-Auto + Export Kit',
        uploadUrl: 'https://www.tiktok.com/creator-center/upload',
        browserProfile: 'tiktok-creator',
        supportsDirectApi: false,
        supportsBrowserVision: true,
        supportsExportKit: true,
        defaultEnabled: true,
        maxCaptionLen: 2200,
    },
    {
        key: 'facebook',
        short: 'FB',
        name: 'Facebook Reels',
        modeLabel: 'Browser Vision Semi-Auto + Export Kit',
        uploadUrl: 'https://business.facebook.com/latest/reels_composer',
        browserProfile: 'meta-creator',
        supportsDirectApi: false,
        supportsBrowserVision: true,
        supportsExportKit: true,
        defaultEnabled: false,
        maxCaptionLen: 2200,
    },
    {
        key: 'instagram',
        short: 'IG',
        name: 'Instagram Reels',
        modeLabel: 'Browser Vision Semi-Auto + Export Kit',
        uploadUrl: 'https://business.facebook.com/latest/reels_composer',
        browserProfile: 'meta-creator',
        supportsDirectApi: false,
        supportsBrowserVision: true,
        supportsExportKit: true,
        defaultEnabled: false,
        maxCaptionLen: 2200,
    },
];

const PLATFORM_MAP = new Map(PLATFORM_DEFS.map((p) => [p.key, p]));

function httpError(message, statusCode = 400) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function validateId(id, label = 'ID') {
    const s = String(id || '').trim();
    if (!ID_RE.test(s)) {
        throw httpError(`${label} ไม่ถูกต้อง (ต้องเป็น a-z, 0-9, - ความยาว 6-40 ตัวอักษร)`, 400);
    }
    return s;
}

function genQueueId() {
    const stamp = Date.now().toString(36);
    const rnd = crypto.randomBytes(3).toString('hex');
    return `sp-${stamp}-${rnd}`.slice(0, 40);
}

async function readJsonSafe(filePath, fallback = null) {
    try {
        const raw = await fsp.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        return fallback;
    }
}

async function atomicWriteJson(filePath, data) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.tmp.${process.pid}.${crypto.randomBytes(3).toString('hex')}`
    );
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tmp, filePath);
}

function parseEnvFile(filePath) {
    const out = {};
    try {
        if (!fs.existsSync(filePath)) return out;
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq <= 0) continue;
            const k = trimmed.slice(0, eq).trim();
            let v = trimmed.slice(eq + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                v = v.slice(1, -1);
            }
            out[k] = v;
        }
    } catch (_) {}
    return out;
}

function getSocialSecretsInternal() {
    // Strictly internal — NEVER serialize or return this object in any response!
    const fileEnv = parseEnvFile(SOCIAL_ENV_PATH);
    const tgEnv = parseEnvFile(TELEGRAM_ENV_PATH);
    const get = (k) => String(process.env[k] || fileEnv[k] || '').trim();
    return {
        telegramReady: Boolean((process.env.TELEGRAM_BOT_TOKEN || tgEnv.TELEGRAM_BOT_TOKEN) && (process.env.TELEGRAM_CHAT_ID || tgEnv.TELEGRAM_CHAT_ID)),
        youtubeClientId: get('YOUTUBE_CLIENT_ID'),
        youtubeClientSecret: get('YOUTUBE_CLIENT_SECRET'),
        youtubeRefreshToken: get('YOUTUBE_REFRESH_TOKEN'),
        postizUrl: get('POSTIZ_URL'),
        postizApiKey: get('POSTIZ_API_KEY'),
    };
}

function resolveGeminiApiKey() {
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 10) {
        return process.env.GEMINI_API_KEY.trim();
    }
    for (const p of GEMINI_ENV_PATHS) {
        const env = parseEnvFile(p);
        if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 10) {
            return env.GEMINI_API_KEY.trim();
        }
    }
    return '';
}

function callGeminiJson(promptText, timeoutMs = 20000) {
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return Promise.resolve(null);
    return new Promise((resolve) => {
        const payload = JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.5, responseMimeType: 'application/json' },
        });
        const req = https.request(
            {
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
                timeout: timeoutMs,
            },
            (res) => {
                let data = '';
                res.on('data', (c) => { data += c; if (data.length > 1024 * 1024) req.destroy(); });
                res.on('end', () => {
                    if (res.statusCode < 200 || res.statusCode >= 300) return resolve(null);
                    try {
                        const parsed = JSON.parse(data);
                        const txt = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        const clean = txt.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
                        resolve(JSON.parse(clean));
                    } catch (_) {
                        resolve(null);
                    }
                });
            }
        );
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.write(payload);
        req.end();
    });
}

// ── Adapter Discovery (Zero Secrets!) ────────────────────────────────────────
async function listAdapters() {
    const sec = getSocialSecretsInternal();
    const hasLabBrowser = fs.existsSync(LAB_BROWSER_BIN);
    const hasPostiz = Boolean(sec.postizUrl && sec.postizApiKey);
    const youtubeReady = Boolean(sec.youtubeClientId && sec.youtubeClientSecret && sec.youtubeRefreshToken);

    const adapters = PLATFORM_DEFS.map((p) => {
        let configured = false;
        let activeMode = 'manual_kit';
        let statusLabel = 'Manual Export Kit';

        if (p.key === 'telegram') {
            configured = sec.telegramReady && fs.existsSync(SEND_TELEGRAM_SCRIPT);
            activeMode = configured ? 'direct_api' : 'manual_kit';
            statusLabel = configured ? 'Bot API พร้อมยิงจริง' : 'ยังไม่ได้ตั้งค่า .telegram.env';
        } else if (p.key === 'youtube') {
            configured = youtubeReady;
            if (youtubeReady) {
                activeMode = 'direct_api';
                statusLabel = 'YouTube Data API v3 พร้อมใช้';
            } else if (hasPostiz) {
                activeMode = 'postiz_hook';
                statusLabel = 'พร้อมส่งผ่าน Postiz Hook';
            } else if (hasLabBrowser) {
                activeMode = 'browser_vision';
                statusLabel = 'พร้อมเสียบคีย์ API / Browser Semi-Auto';
            } else {
                activeMode = 'manual_kit';
                statusLabel = 'Export Kit พร้อมคัดลอก';
            }
        } else {
            // tiktok, facebook, instagram
            configured = hasPostiz || hasLabBrowser;
            if (hasPostiz) {
                activeMode = 'postiz_hook';
                statusLabel = 'Postiz Hook พร้อมยิงอัตโนมัติ';
            } else if (hasLabBrowser) {
                activeMode = 'browser_vision';
                statusLabel = 'Browser Vision Semi-Auto + Export Kit';
            } else {
                activeMode = 'manual_kit';
                statusLabel = 'Manual Export Kit';
            }
        }

        return {
            key: p.key,
            short: p.short,
            name: p.name,
            modeLabel: p.modeLabel,
            activeMode,
            statusLabel,
            configured,
            defaultEnabled: p.defaultEnabled,
            uploadUrl: p.uploadUrl,
            browserProfile: p.browserProfile,
            supportsDirectApi: p.supportsDirectApi,
            supportsBrowserVision: p.supportsBrowserVision && hasLabBrowser,
            supportsExportKit: p.supportsExportKit,
            postizHookAvailable: hasPostiz,
            maxCaptionLen: p.maxCaptionLen,
        };
    });

    return {
        ok: true,
        architecture: 'option-c-hybrid-pluggable',
        postizConfigured: hasPostiz,
        browserVisionAvailable: hasLabBrowser,
        adapters,
    };
}

// ── Video Asset Resolution ───────────────────────────────────────────────────
async function resolveJobVideoAsset(jobId, preferredFile = null) {
    const cleanId = validateId(jobId, 'Job ID');
    const jobDir = path.join(videoStudioManager.JOBS_DIR, cleanId);
    const job = await readJsonSafe(path.join(jobDir, 'job.json'), null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);

    let videoPath = null;
    let relFile = null;

    if (preferredFile) {
        const info = await videoStudioManager.resolveSafeFile(cleanId, preferredFile);
        if (info) {
            videoPath = info.filePath;
            relFile = preferredFile;
        }
    }

    if (!videoPath && job.outputs?.jobVideoFile) {
        const info = await videoStudioManager.resolveSafeFile(cleanId, job.outputs.jobVideoFile);
        if (info) {
            videoPath = info.filePath;
            relFile = job.outputs.jobVideoFile;
        }
    }

    if (!videoPath) {
        const latestFinal = await videoStudioManager.findLatestJobFinal(jobDir);
        if (latestFinal) {
            videoPath = latestFinal.file;
            relFile = latestFinal.name;
        }
    }

    if (!videoPath && Array.isArray(job.versions) && job.versions.length > 0) {
        const lastVer = job.versions[job.versions.length - 1];
        if (lastVer && lastVer.videoPath && fs.existsSync(lastVer.videoPath)) {
            videoPath = lastVer.videoPath;
            relFile = lastVer.file || path.basename(lastVer.videoPath);
        }
    }

    const stat = videoPath ? await fsp.stat(videoPath).catch(() => null) : null;
    const watchUrl = relFile
        ? `${DASHBOARD_ORIGIN}/api/video-studio/file/${encodeURIComponent(cleanId)}/${encodeURIComponent(relFile)}`
        : (job.outputs?.watchUrl || null);
    const downloadUrl = watchUrl ? `${watchUrl}?download=1` : null;
    const sbFile = job.outputs?.storyboardFile || job.storyboardFile || null;
    const storyboardUrl = sbFile
        ? `${DASHBOARD_ORIGIN}/api/video-studio/file/${encodeURIComponent(cleanId)}/${encodeURIComponent(sbFile)}`
        : null;

    return {
        job,
        jobDir,
        videoPath,
        relFile,
        sizeMb: stat ? +(stat.size / (1024 * 1024)).toFixed(2) : null,
        durationSec: Number(job.outputs?.durationSec ?? job.durationSec ?? 0),
        watchUrl,
        downloadUrl,
        storyboardUrl,
    };
}

// ── AI Caption & Hashtag Pack Generator ──────────────────────────────────────
function buildDeterministicCaptions(job, script) {
    const title = String(job.title || job.topic || 'คลิปวิดีโอใหม่').trim();
    const dur = Math.round(Number(job.outputs?.durationSec ?? job.durationSec ?? 45));
    const scenes = Array.isArray(script?.scenes) ? script.scenes : [];
    const bullets = scenes.slice(0, 4).map((s, i) => `${i + 1}. ${String(s.title || '').trim()}`).filter((x) => x.length > 3);
    const bulletBlock = bullets.length ? `\n\nประเด็นสำคัญ:\n${bullets.join('\n')}` : '';
    const isNews = String(job.id || '').startsWith('daily-news-') || job.contentMode === 'news';

    const baseTags = isNews
        ? ['#สรุปข่าว', '#ข่าวเด่นวันนี้', '#ข่าวไทย', '#ข่าวต่างประเทศ', '#DailyNews']
        : ['#Homelab', '#ความรู้', '#สรุปสั้นเข้าใจง่าย', '#AI', '#เทคโนโลยี'];

    return {
        telegram: {
            title: title.slice(0, 100),
            caption: `🎬 ${title} (${dur}s)${bulletBlock}\n\n${baseTags.slice(0, 4).join(' ')}`,
            hashtags: baseTags.slice(0, 4),
        },
        youtube: {
            title: `${title.slice(0, 82)} #Shorts`,
            caption: `${title}\n\nสรุปประเด็นสำคัญเข้าใจง่ายใน ${dur} วินาที${bulletBlock}\n\n${[...baseTags, '#Shorts'].join(' ')}`,
            hashtags: [...baseTags, '#Shorts'],
        },
        tiktok: {
            title: title.slice(0, 90),
            caption: `${isNews ? '📰 อัปเดตข่าวเด่นครบจบในคลิปเดียว!' : 'รู้ยัง?'} ${title} ดูจบใน ${dur} วิ! 🔥\n\n${[...baseTags, '#TikTokความรู้'].join(' ')}`,
            hashtags: [...baseTags, '#TikTokความรู้'],
        },
        facebook: {
            title: title.slice(0, 95),
            caption: `${title}${bulletBlock}\n\nคิดเห็นยังไงคอมเมนต์คุยกันได้ครับ 👇\n${[...baseTags, '#Reels'].join(' ')}`,
            hashtags: [...baseTags, '#Reels'],
        },
        instagram: {
            title: title.slice(0, 90),
            caption: `${title} ✨\nสรุปครบกระชับใน ${dur} วินาที — กดเซฟไว้ดูย้อนหลังได้เลย!\n\n${[...baseTags, '#IGReels'].join(' ')}`,
            hashtags: [...baseTags, '#IGReels'],
        },
    };
}

async function generateCaptionPack(jobId, { platforms } = {}) {
    const cleanId = validateId(jobId, 'Job ID');
    const jobDir = path.join(videoStudioManager.JOBS_DIR, cleanId);
    const job = await readJsonSafe(path.join(jobDir, 'job.json'), null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);
    const script = await readJsonSafe(path.join(jobDir, 'script.json'), null);

    const fallback = buildDeterministicCaptions(job, script);
    let pack = fallback;
    let engine = 'deterministic-fallback';

    const sceneSummary = Array.isArray(script?.scenes)
        ? script.scenes.slice(0, 8).map((s) => `- ${s.title || ''}: ${String(s.narration || '').slice(0, 120)}`).join('\n')
        : '';

    const prompt = [
        'สร้างชุดแคปชันและแฮชแท็กภาษาไทยสำหรับโพสต์คลิปวิดีโอสั้นลง 5 แพลตฟอร์ม: telegram, youtube, tiktok, facebook, instagram',
        `หัวข้อ: ${job.title || job.topic}`,
        `ความยาว: ${Math.round(Number(job.outputs?.durationSec ?? job.durationSec ?? 45))} วินาที`,
        sceneSummary ? `เนื้อหาหลัก:\n${sceneSummary}` : '',
        'ตอบกลับเป็น JSON object เท่านั้น รูปแบบ:',
        '{"telegram":{"title":"...","caption":"...","hashtags":["#..."]},"youtube":{"title":"... #Shorts","caption":"...","hashtags":["#..."]},"tiktok":{"title":"...","caption":"...","hashtags":["#..."]},"facebook":{"title":"...","caption":"...","hashtags":["#..."]},"instagram":{"title":"...","caption":"...","hashtags":["#..."]}}',
    ].filter(Boolean).join('\n');

    const aiPack = await callGeminiJson(prompt);
    if (aiPack && typeof aiPack === 'object') {
        const merged = { ...fallback };
        let usedAi = false;
        for (const p of PLATFORM_DEFS) {
            const entry = aiPack[p.key];
            if (entry && typeof entry === 'object' && typeof entry.caption === 'string' && entry.caption.trim()) {
                merged[p.key] = {
                    title: String(entry.title || fallback[p.key].title).trim().slice(0, 140),
                    caption: String(entry.caption).trim().slice(0, p.maxCaptionLen),
                    hashtags: Array.isArray(entry.hashtags)
                        ? entry.hashtags.map((h) => String(h).trim()).filter(Boolean).slice(0, 12)
                        : fallback[p.key].hashtags,
                };
                usedAi = true;
            }
        }
        if (usedAi) {
            pack = merged;
            engine = 'gemini-2.5-flash';
        }
    }

    if (Array.isArray(platforms) && platforms.length > 0) {
        const filtered = {};
        for (const k of platforms) {
            if (pack[k]) filtered[k] = pack[k];
        }
        return { ok: true, jobId: cleanId, engine, pack: filtered };
    }

    return { ok: true, jobId: cleanId, engine, pack };
}

async function buildExportKit(jobId, overrides = {}) {
    const asset = await resolveJobVideoAsset(jobId, overrides.videoFile || null);
    const script = await readJsonSafe(path.join(asset.jobDir, 'script.json'), null);
    const basePack = buildDeterministicCaptions(asset.job, script);

    const platforms = {};
    for (const p of PLATFORM_DEFS) {
        const ovTitle = overrides.titles && overrides.titles[p.key];
        const ovCap = overrides.captions && overrides.captions[p.key];
        platforms[p.key] = {
            name: p.name,
            uploadUrl: p.uploadUrl,
            title: String(ovTitle || basePack[p.key].title).trim(),
            caption: String(ovCap || basePack[p.key].caption).trim(),
            hashtags: basePack[p.key].hashtags,
        };
    }

    const clipboardText = [
        `=== EXPORT KIT: ${asset.job.title || asset.job.topic} (${asset.job.id}) ===`,
        `Master Video: ${asset.downloadUrl || asset.watchUrl || asset.videoPath || 'N/A'}`,
        `Duration: ${Math.round(asset.durationSec)}s · Size: ${asset.sizeMb ?? '—'} MB`,
        '',
        ...Object.entries(platforms).map(([k, v]) => (
            `[${v.name}] (${v.uploadUrl})\nTitle: ${v.title}\nCaption:\n${v.caption}\n`
        )),
    ].join('\n');

    return {
        ok: true,
        jobId: asset.job.id,
        topic: asset.job.title || asset.job.topic,
        durationSec: asset.durationSec,
        sizeMb: asset.sizeMb,
        watchUrl: asset.watchUrl,
        downloadUrl: asset.downloadUrl,
        storyboardUrl: asset.storyboardUrl,
        localPath: asset.videoPath,
        platforms,
        clipboardText,
    };
}

// ── Platform Adapters Implementation ─────────────────────────────────────────
function execSendTelegram(videoPath, caption) {
    return new Promise((resolve, reject) => {
        execFile(
            '/usr/bin/python3',
            [SEND_TELEGRAM_SCRIPT, videoPath, caption],
            { timeout: 240000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, HOME: os.homedir() } },
            (err, stdout, stderr) => {
                let parsed = null;
                try { parsed = JSON.parse(String(stdout || '').trim()); } catch (_) {}
                if (err || !parsed || !parsed.ok) {
                    const msg = (parsed && (parsed.error || JSON.stringify(parsed.telegramError))) || stderr || (err && err.message) || 'Telegram send failed';
                    return reject(new Error(String(msg).trim()));
                }
                resolve(parsed);
            }
        );
    });
}

function httpsJsonRequest(urlStr, { method = 'POST', headers = {}, body = null, timeoutMs = 20000 } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const mod = u.protocol === 'http:' ? http : https;
        const req = mod.request(
            {
                hostname: u.hostname,
                port: u.port || (u.protocol === 'http:' ? 80 : 443),
                path: `${u.pathname}${u.search}`,
                method,
                headers,
                timeout: timeoutMs,
            },
            (res) => {
                let raw = '';
                res.on('data', (c) => { raw += c; });
                res.on('end', () => {
                    let json = null;
                    try { json = raw ? JSON.parse(raw) : null; } catch (_) {}
                    resolve({ statusCode: res.statusCode, headers: res.headers, json, raw });
                });
            }
        );
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('Request timeout')); });
        if (body) req.write(body);
        req.end();
    });
}

async function uploadYoutubeResumable({ videoPath, title, description, tags, clientId, clientSecret, refreshToken }) {
    const tokenBody = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    }).toString();

    const tokenRes = await httpsJsonRequest('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(tokenBody),
        },
        body: tokenBody,
    });
    if (tokenRes.statusCode < 200 || tokenRes.statusCode >= 300 || !tokenRes.json?.access_token) {
        throw new Error('YouTube OAuth2 token refresh failed');
    }

    const accessToken = tokenRes.json.access_token;
    const stat = await fsp.stat(videoPath);
    const metaPayload = JSON.stringify({
        snippet: {
            title: String(title || 'Homelab Video').slice(0, 100),
            description: String(description || '').slice(0, 4900),
            tags: Array.isArray(tags) ? tags.slice(0, 15) : ['Shorts', 'Homelab'],
            categoryId: '28',
        },
        status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false,
        },
    });

    const initRes = await httpsJsonRequest(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json; charset=UTF-8',
                'Content-Length': Buffer.byteLength(metaPayload),
                'X-Upload-Content-Length': String(stat.size),
                'X-Upload-Content-Type': 'video/mp4',
            },
            body: metaPayload,
        }
    );
    const uploadUrl = initRes.headers?.location;
    if (!uploadUrl) {
        throw new Error(`YouTube resumable init failed (HTTP ${initRes.statusCode})`);
    }

    const fileBuf = await fsp.readFile(videoPath);
    const putRes = await httpsJsonRequest(uploadUrl, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'video/mp4',
            'Content-Length': String(fileBuf.length),
        },
        body: fileBuf,
        timeoutMs: 180000,
    });
    if (putRes.statusCode < 200 || putRes.statusCode >= 300 || !putRes.json?.id) {
        throw new Error(`YouTube video upload failed (HTTP ${putRes.statusCode})`);
    }
    return {
        videoId: putRes.json.id,
        url: `https://youtube.com/shorts/${putRes.json.id}`,
    };
}

async function launchBrowserSemiAuto(platformKey, jobId) {
    const plat = PLATFORM_MAP.get(String(platformKey || '').trim().toLowerCase());
    if (!plat || !plat.supportsBrowserVision) {
        throw httpError('แพลตฟอร์มนี้ไม่รองรับ Browser Vision Semi-Auto', 400);
    }
    const cleanJobId = validateId(jobId, 'Job ID');
    const kit = await buildExportKit(cleanJobId);

    if (!fs.existsSync(LAB_BROWSER_BIN)) {
        return {
            ok: true,
            launched: false,
            mode: 'manual_kit',
            platform: plat.key,
            uploadUrl: plat.uploadUrl,
            message: 'ไม่พบ lab-browser ในเครื่อง — สร้าง Manual Export Kit ให้คัดลอกแทนแล้ว',
            exportKit: kit,
        };
    }

    const sessionName = `social-${plat.key}`;
    const args = ['session', 'open', plat.uploadUrl, '--session', sessionName];
    if (plat.browserProfile) {
        args.push('--auth-profile', plat.browserProfile);
    }

    try {
        const child = spawn(LAB_BROWSER_BIN, args, {
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, HOME: os.homedir() },
        });
        child.unref();
        return {
            ok: true,
            launched: true,
            mode: 'browser_vision',
            platform: plat.key,
            sessionName,
            authProfile: plat.browserProfile,
            uploadUrl: plat.uploadUrl,
            pid: child.pid || null,
            message: `เปิดเซสชัน Browser Vision (${sessionName}) ไปยังหน้าอัปโหลด ${plat.name} แล้ว — ล็อกอินครั้งเดียวแล้ววางไฟล์/แคปชันได้เลย`,
            exportKit: kit,
        };
    } catch (err) {
        return {
            ok: true,
            launched: false,
            mode: 'manual_kit',
            platform: plat.key,
            uploadUrl: plat.uploadUrl,
            message: `เปิด Browser Vision ไม่สำเร็จ (${err.message}) — ใช้ Manual Export Kit แทนได้ทันที`,
            exportKit: kit,
        };
    }
}

async function executeAdapterDispatch(item) {
    const plat = PLATFORM_MAP.get(item.platform);
    if (!plat) throw new Error(`Unknown platform: ${item.platform}`);

    const asset = await resolveJobVideoAsset(item.jobId, item.videoFile || null);
    if (!asset.videoPath) {
        throw new Error('ยังไม่พบไฟล์วิดีโอ Master (final.mp4) ของงานนี้');
    }

    const sec = getSocialSecretsInternal();

    // 1. Telegram live Bot API
    if (item.platform === 'telegram') {
        if (!sec.telegramReady || !fs.existsSync(SEND_TELEGRAM_SCRIPT)) {
            return {
                status: 'export_kit_ready',
                mode: 'manual_kit',
                note: 'ยังไม่ได้ตั้งค่า .telegram.env — เตรียม Export Kit ไว้ให้แล้ว',
                watchUrl: asset.watchUrl,
                downloadUrl: asset.downloadUrl,
            };
        }
        const caption = String(item.caption || item.title || asset.job.topic || '').slice(0, 1000);
        const tgRes = await execSendTelegram(asset.videoPath, caption);
        return {
            status: 'posted',
            mode: 'direct_api',
            note: `ส่งเข้า Telegram สำเร็จ (messageId #${tgRes.messageId}, ${tgRes.sentSizeMB} MB${tgRes.compressed ? ' · บีบอัด <48MB' : ''})`,
            externalId: String(tgRes.messageId || ''),
            sentSizeMB: tgRes.sentSizeMB,
            compressed: Boolean(tgRes.compressed),
        };
    }

    // 2. YouTube Official API v3 (plugin-ready) with graceful Export Kit fallback
    if (item.platform === 'youtube') {
        if (sec.youtubeClientId && sec.youtubeClientSecret && sec.youtubeRefreshToken) {
            const ytRes = await uploadYoutubeResumable({
                videoPath: asset.videoPath,
                title: item.title || asset.job.topic,
                description: item.caption || asset.job.topic,
                tags: item.hashtags || ['Shorts'],
                clientId: sec.youtubeClientId,
                clientSecret: sec.youtubeClientSecret,
                refreshToken: sec.youtubeRefreshToken,
            });
            return {
                status: 'posted',
                mode: 'direct_api',
                note: `อัปโหลด YouTube Shorts สำเร็จ (${ytRes.url})`,
                externalId: ytRes.videoId,
                externalUrl: ytRes.url,
            };
        }
        return {
            status: 'export_kit_ready',
            mode: 'manual_kit',
            note: 'พร้อมเสียบคีย์ YouTube Data API v3 ใน /home/dev/projects/.social.env — ตอนนี้เตรียม Export Kit + ลิงก์ YouTube Studio ไว้ให้พร้อมโพสต์แล้ว',
            uploadUrl: plat.uploadUrl,
            watchUrl: asset.watchUrl,
            downloadUrl: asset.downloadUrl,
        };
    }

    // 3. TikTok / Facebook / Instagram -> Postiz Hook (if configured) OR Browser Vision Semi-Auto + Export Kit
    if (sec.postizUrl && sec.postizApiKey) {
        try {
            const base = sec.postizUrl.replace(/\/+$/, '');
            const postizPayload = JSON.stringify({
                platform: item.platform,
                title: item.title || asset.job.topic,
                caption: item.caption || '',
                videoUrl: asset.downloadUrl || asset.watchUrl,
                scheduledAt: item.scheduledAt || null,
            });
            const pRes = await httpsJsonRequest(`${base}/api/public/v1/posts`, {
                method: 'POST',
                headers: {
                    Authorization: sec.postizApiKey,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postizPayload),
                },
                body: postizPayload,
            });
            if (pRes.statusCode >= 200 && pRes.statusCode < 300) {
                return {
                    status: 'posted',
                    mode: 'postiz_hook',
                    note: `ส่งเข้า Postiz (${plat.name}) สำเร็จ`,
                    externalId: String(pRes.json?.id || ''),
                };
            }
        } catch (_) {
            // Fall through gracefully to Semi-Auto / Export Kit
        }
    }

    return {
        status: 'export_kit_ready',
        mode: fs.existsSync(LAB_BROWSER_BIN) ? 'browser_vision_ready' : 'manual_kit',
        note: `พร้อมโพสต์แบบ Semi-Auto (${plat.name}) — กดเปิด Browser Vision หรือคัดลอก Export Kit เพื่อวางและกดโพสต์ได้เลย`,
        uploadUrl: plat.uploadUrl,
        watchUrl: asset.watchUrl,
        downloadUrl: asset.downloadUrl,
    };
}

// ── Queue Persistence & Job Status Mirror ────────────────────────────────────
async function readQueueStore() {
    const data = await readJsonSafe(QUEUE_PATH, null);
    if (data && Array.isArray(data.items)) return data;
    return { version: 1, items: [] };
}

async function writeQueueStore(store) {
    store.updatedAt = new Date().toISOString();
    await atomicWriteJson(QUEUE_PATH, store);
}

async function updateJobSocialStatus(jobId, platformKey, status) {
    try {
        const cleanId = validateId(jobId, 'Job ID');
        const jobPath = path.join(videoStudioManager.JOBS_DIR, cleanId, 'job.json');
        const job = await readJsonSafe(jobPath, null);
        if (!job) return;
        const map = job.social && typeof job.social === 'object' ? { ...job.social } : {};
        map[platformKey] = status;
        job.social = map;
        job.updatedAt = new Date().toISOString();
        await atomicWriteJson(jobPath, job);
    } catch (_) {}
}

async function listQueue({ jobId = null, limit = 100 } = {}) {
    const store = await readQueueStore();
    let items = store.items || [];
    if (jobId) {
        const cleanId = validateId(jobId, 'Job ID');
        items = items.filter((it) => it.jobId === cleanId);
    }
    items = items.slice().sort((a, b) => (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0));
    return { ok: true, items: items.slice(0, Math.max(1, Math.min(300, Number(limit) || 100))) };
}

async function dispatchQueueItem(itemId) {
    const cleanId = validateId(itemId, 'Queue Item ID');
    const store = await readQueueStore();
    const item = store.items.find((x) => x.id === cleanId);
    if (!item) throw httpError('ไม่พบรายการคิวโพสต์ที่ระบุ', 404);

    item.status = 'dispatching';
    item.updatedAt = new Date().toISOString();
    await writeQueueStore(store);

    try {
        const outcome = await executeAdapterDispatch(item);
        item.status = outcome.status || 'posted';
        item.mode = outcome.mode || item.mode;
        item.note = outcome.note || '';
        item.result = outcome;
        item.dispatchedAt = new Date().toISOString();
        item.updatedAt = item.dispatchedAt;
        item.error = null;
        await writeQueueStore(store);
        await updateJobSocialStatus(item.jobId, item.platform, item.status === 'posted' ? 'posted' : 'ready');
        return { ok: true, item };
    } catch (err) {
        item.status = 'failed';
        item.error = String(err.message || err);
        item.note = `โพสต์ไม่สำเร็จ: ${item.error}`;
        item.updatedAt = new Date().toISOString();
        await writeQueueStore(store);
        await updateJobSocialStatus(item.jobId, item.platform, 'failed');
        return { ok: false, error: item.error, item };
    }
}

async function enqueuePost({ jobId, platforms, titles = {}, captions = {}, publishMode = 'now', scheduledAt = null, videoFile = null } = {}) {
    const cleanJobId = validateId(jobId, 'Job ID');
    const asset = await resolveJobVideoAsset(cleanJobId, videoFile);

    const rawPlats = Array.isArray(platforms) ? platforms : [];
    const validPlats = [...new Set(rawPlats.map((p) => String(p || '').trim().toLowerCase()).filter((p) => PLATFORM_MAP.has(p)))];
    if (!validPlats.length) {
        throw httpError('กรุณาเลือกแพลตฟอร์มอย่างน้อย 1 ช่องทาง', 400);
    }

    const mode = String(publishMode || 'now').trim().toLowerCase() === 'schedule' ? 'schedule' : 'now';
    let cleanSchedIso = null;
    if (mode === 'schedule') {
        const ts = Date.parse(String(scheduledAt || ''));
        if (!Number.isFinite(ts)) {
            throw httpError('วันและเวลาที่ตั้งโพสต์ไม่ถูกต้อง', 400);
        }
        cleanSchedIso = new Date(ts).toISOString();
    }

    const store = await readQueueStore();
    const created = [];
    const now = new Date().toISOString();

    for (const platKey of validPlats) {
        const platDef = PLATFORM_MAP.get(platKey);
        const item = {
            id: genQueueId(),
            jobId: cleanJobId,
            topic: String(asset.job.title || asset.job.topic || cleanJobId).slice(0, 160),
            platform: platKey,
            platformName: platDef.name,
            videoFile: asset.relFile || null,
            title: String(titles[platKey] || asset.job.title || asset.job.topic || '').trim().slice(0, 140),
            caption: String(captions[platKey] || asset.job.topic || '').trim().slice(0, platDef.maxCaptionLen),
            publishMode: mode,
            scheduledAt: cleanSchedIso,
            status: mode === 'schedule' ? 'scheduled' : 'queued',
            mode: null,
            note: mode === 'schedule' ? `ตั้งเวลาโพสต์ไว้ที่ ${cleanSchedIso}` : 'รอส่งโพสต์...',
            error: null,
            createdAt: now,
            updatedAt: now,
        };
        store.items.unshift(item);
        created.push(item);
        await updateJobSocialStatus(cleanJobId, platKey, mode === 'schedule' ? 'scheduled' : 'queued');
    }

    // Keep history bounded to latest 400 items
    store.items = store.items.slice(0, 400);
    await writeQueueStore(store);

    if (mode === 'now') {
        const results = [];
        for (const it of created) {
            const res = await dispatchQueueItem(it.id);
            results.push(res.item || it);
        }
        return {
            ok: true,
            publishMode: 'now',
            items: results,
            message: `ดำเนินการส่งโพสต์ ${results.length} ช่องทางเรียบร้อยแล้ว`,
        };
    }

    return {
        ok: true,
        publishMode: 'schedule',
        scheduledAt: cleanSchedIso,
        items: created,
        message: `ตั้งเวลาโพสต์ ${created.length} ช่องทางเรียบร้อยแล้ว`,
    };
}

async function cancelQueueItem(itemId) {
    const cleanId = validateId(itemId, 'Queue Item ID');
    const store = await readQueueStore();
    const before = store.items.length;
    store.items = store.items.filter((x) => x.id !== cleanId);
    if (store.items.length === before) {
        throw httpError('ไม่พบรายการคิวโพสต์ที่ระบุ', 404);
    }
    await writeQueueStore(store);
    return { ok: true, id: cleanId, deleted: true };
}

async function retryQueueItem(itemId) {
    return await dispatchQueueItem(itemId);
}

// ── 7-Day Publishing Calendar ────────────────────────────────────────────────
async function getCalendar(days = 7) {
    const numDays = Math.max(1, Math.min(14, Number(days) || 7));
    const store = await readQueueStore();
    const items = store.items || [];

    const thaiWeekdays = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
    const thaiMonthsShort = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

    // Anchor on Asia/Bangkok (UTC+7)
    const nowBkkMs = Date.now() + 7 * 3600 * 1000;
    const resultDays = [];

    for (let i = 0; i < numDays; i += 1) {
        const d = new Date(nowBkkMs + i * 24 * 3600 * 1000);
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth();
        const dayNum = d.getUTCDate();
        const dow = d.getUTCDay();
        const isoDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const label = i === 0
            ? `วันนี้ (${thaiWeekdays[dow]})`
            : `${thaiWeekdays[dow]} ${dayNum} ${thaiMonthsShort[m]}`;

        const slots = [
            {
                id: `cron-news-${isoDate}`,
                time: '07:30',
                title: 'Daily News Broadcast v2',
                channel: 'Auto Cron · TG',
                status: 'cron',
            },
        ];

        for (const it of items) {
            const refIso = it.scheduledAt || it.dispatchedAt || it.createdAt;
            if (!refIso) continue;
            const bkkTs = Date.parse(refIso) + 7 * 3600 * 1000;
            if (!Number.isFinite(bkkTs)) continue;
            const itDate = new Date(bkkTs);
            const itIso = itDate.toISOString().slice(0, 10);
            if (itIso !== isoDate) continue;
            const hhmm = `${String(itDate.getUTCHours()).padStart(2, '0')}:${String(itDate.getUTCMinutes()).padStart(2, '0')}`;
            const platShort = PLATFORM_MAP.get(it.platform)?.short || it.platform.toUpperCase();
            slots.push({
                id: it.id,
                jobId: it.jobId,
                time: hhmm,
                title: String(it.title || it.topic || '').slice(0, 42),
                channel: `${platShort} · ${it.status === 'posted' ? '✓' : it.status === 'scheduled' ? '⏳' : it.status === 'export_kit_ready' ? '📦' : '⚠'}`,
                status: it.status,
            });
        }

        slots.sort((a, b) => String(a.time).localeCompare(String(b.time)));
        resultDays.push({ date: isoDate, label, items: slots });
    }

    return { ok: true, days: resultDays };
}

// ── 60-Second Persistent Scheduler ───────────────────────────────────────────
async function tickScheduler() {
    if (schedulerRunning) return { ok: true, skipped: 'running' };
    schedulerRunning = true;
    try {
        const store = await readQueueStore();
        const nowMs = Date.now();
        const due = (store.items || []).filter(
            (it) => it.status === 'scheduled' && it.scheduledAt && Date.parse(it.scheduledAt) <= nowMs
        );
        const dispatched = [];
        for (const it of due) {
            await dispatchQueueItem(it.id).catch(() => {});
            dispatched.push(it.id);
        }
        return { ok: true, dueCount: due.length, dispatched };
    } catch (err) {
        return { ok: false, error: err.message };
    } finally {
        schedulerRunning = false;
    }
}

function startScheduler() {
    if (schedulerTimer) return;
    schedulerTimer = setInterval(() => {
        tickScheduler().catch(() => {});
    }, SCHEDULER_INTERVAL_MS);
    if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref();
}

function stopScheduler() {
    if (schedulerTimer) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
    }
}

module.exports = {
    SOCIAL_DIR,
    QUEUE_PATH,
    CONFIG_PATH,
    PLATFORM_DEFS,
    listAdapters,
    generateCaptionPack,
    buildExportKit,
    launchBrowserSemiAuto,
    enqueuePost,
    dispatchQueueItem,
    cancelQueueItem,
    retryQueueItem,
    listQueue,
    getCalendar,
    tickScheduler,
    startScheduler,
    stopScheduler,
};
