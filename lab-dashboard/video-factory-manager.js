'use strict';

/**
 * video-factory-manager.js
 * -----------------------------------------------------------------------------
 * Backend orchestration layer for Homelab Video Factory OS (/video-studio).
 *
 * Responsibilities:
 *  - Sequential Factory Queue Pump (maxConcurrent = 1 to protect homelab RAM)
 *  - Single, Batch, and Daily News Broadcast v2 order submission
 *  - QC state machine (pending | approved | rejected | skipped) with audit history
 *  - AI Natural-Language Revision (Gemini REST API + deterministic fallback)
 *  - Production Lines CRUD + manual trigger (factory_lines.json)
 *  - Preferences & Favorite Styles persistence (factory_prefs.json)
 *  - Safe Agent Hub Worker Summary (whitelisted fields only; never leaks token)
 *  - Factory KPI & Analytics aggregation
 *
 * Safety Guarantees:
 *  - Pure Node.js built-ins only
 *  - Strict ID validation (/^[a-z0-9-]{6,40}$/)
 *  - Pure argument-array spawn/execFile (zero shell interpolation)
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const { spawn } = require('child_process');

const videoStudioManager = require('./video-studio-manager');

const FACTORY_DIR = path.join(videoStudioManager.OUT_ROOT, 'factory');
const LINES_PATH = path.join(FACTORY_DIR, 'factory_lines.json');
const PREFS_PATH = path.join(FACTORY_DIR, 'factory_prefs.json');
const DAILY_NEWS_SCRIPT = '/home/dev/projects/daily-news-clip.py';
const GEMINI_ENV_PATHS = [
    '/home/dev/.gemini/.env',
    '/home/dev/projects/lab-stack/.env',
    '/home/dev/projects/.env',
];

const ID_RE = /^[a-z0-9-]{6,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_QC_STATUS = new Set(['pending', 'approved', 'rejected', 'skipped']);
const ALLOWED_STOP_GATES = new Set(['draft', 'qc', 'autopilot', 'skip']);
const ALLOWED_BGM = new Set(['warm_tech', 'story_cinematic', 'dawn_ambient', 'none']);

const MAX_CONCURRENT = 1;
const PUMP_INTERVAL_MS = 8000;

let pumpTimer = null;
let pumpInFlight = false;

const DEFAULT_LINES = [
    {
        id: 'line-news-v2',
        name: 'ข่าวเช้า Broadcast v2',
        description: 'สรุป 6 ข่าวเด่นไทย-ต่างประเทศ พร้อมภาพ og:image และคลิปข่าวจริง 5–10 วินาที (~3.5 นาที)',
        schedule: 'ทุกวัน 07:30 น.',
        cron: '30 7 * * *',
        styleId: 'look-32',
        voice: 'gemini:Charon',
        bgm: 'warm_tech',
        durationSec: 210,
        stopGate: 'qc',
        contentMode: 'news',
        active: true,
        builtin: true,
        defaultTopic: 'สรุปข่าวเด็ดประจำวัน (Daily News Broadcast v2)',
        lastRunAt: null,
        lastRunStatus: 'พร้อมใช้งาน (Cron 07:30 น.)',
    },
    {
        id: 'line-smarthome',
        name: 'Smart Home & ค่าไฟ',
        description: 'เคล็ดลับประหยัดไฟ, PZEM-01, Home Assistant และอุปกรณ์ IoT ในบ้าน',
        schedule: 'จ. / พ. / ศ. 18:00 น.',
        cron: '0 18 * * 1,3,5',
        styleId: 'look-13',
        voice: 'gemini:Aoede',
        bgm: 'story_cinematic',
        durationSec: 45,
        stopGate: 'qc',
        contentMode: 'standard',
        active: true,
        builtin: false,
        defaultTopic: '3 เทคนิคประหยัดค่าไฟบ้านด้วยมิเตอร์ PZEM-01 และ Home Assistant',
        lastRunAt: null,
        lastRunStatus: 'รอสั่งรัน',
    },
    {
        id: 'line-ai-homelab',
        name: 'AI & Homelab Express',
        description: 'สรุปเทคโนโลยี AI, Homelab Server และเครื่องมืออัตโนมัติ (ใช้ Edge TTS ฟรี ฿0)',
        schedule: 'อ. / พฤ. 19:30 น.',
        cron: '30 19 * * 2,4',
        styleId: 'look-3',
        voice: 'edge:th-TH-PremwadeeNeural',
        bgm: 'warm_tech',
        durationSec: 45,
        stopGate: 'draft',
        contentMode: 'standard',
        active: false,
        builtin: false,
        defaultTopic: 'เจาะลึกการทำงานของ AI Agent บน Homelab ที่ช่วยลดงานประจำวัน',
        lastRunAt: null,
        lastRunStatus: 'หยุดชั่วคราว',
    },
];

const DEFAULT_PREFS = {
    favoriteStyles: ['look-32', 'look-3', 'look-1', 'look-11'],
    defaultVoice: 'gemini:Charon',
    defaultBgm: 'warm_tech',
    defaultStopGate: 'qc',
    defaultDurationSec: 45,
    lowCreditThresholdThb: 10,
};

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

function genId(prefix = 'fac') {
    const stamp = Date.now().toString(36);
    const rnd = crypto.randomBytes(3).toString('hex');
    return `${prefix}-${stamp}-${rnd}`.slice(0, 40);
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

function callGeminiJson(promptText, timeoutMs = 25000) {
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return Promise.resolve(null);

    return new Promise((resolve) => {
        const payload = JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            generationConfig: {
                temperature: 0.35,
                responseMimeType: 'application/json',
            },
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
                res.on('data', (chunk) => {
                    data += chunk;
                    if (data.length > 2 * 1024 * 1024) req.destroy();
                });
                res.on('end', () => {
                    if (res.statusCode < 200 || res.statusCode >= 300) return resolve(null);
                    try {
                        const parsed = JSON.parse(data);
                        const txt = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        if (!txt) return resolve(null);
                        const clean = txt.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
                        resolve(JSON.parse(clean));
                    } catch (_) {
                        resolve(null);
                    }
                });
            }
        );

        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
        req.write(payload);
        req.end();
    });
}

// ── Preferences & Favorites ──────────────────────────────────────────────────
async function getPrefs() {
    const stored = await readJsonSafe(PREFS_PATH, null);
    if (!stored || typeof stored !== 'object') {
        return { ...DEFAULT_PREFS, favoriteStyles: [...DEFAULT_PREFS.favoriteStyles] };
    }
    return {
        ...DEFAULT_PREFS,
        ...stored,
        favoriteStyles: Array.isArray(stored.favoriteStyles)
            ? [...new Set(stored.favoriteStyles.map((s) => String(s).trim()).filter(Boolean))]
            : [...DEFAULT_PREFS.favoriteStyles],
    };
}

async function updatePrefs(patch = {}) {
    const cur = await getPrefs();
    const next = { ...cur };
    if (Array.isArray(patch.favoriteStyles)) {
        next.favoriteStyles = [...new Set(patch.favoriteStyles.map((s) => String(s).trim()).filter((s) => ID_RE.test(s)))];
    }
    if (typeof patch.defaultVoice === 'string' && patch.defaultVoice.trim()) {
        next.defaultVoice = patch.defaultVoice.trim().slice(0, 80);
    }
    if (typeof patch.defaultBgm === 'string' && ALLOWED_BGM.has(patch.defaultBgm.trim())) {
        next.defaultBgm = patch.defaultBgm.trim();
    }
    if (typeof patch.defaultStopGate === 'string' && ALLOWED_STOP_GATES.has(patch.defaultStopGate.trim())) {
        next.defaultStopGate = patch.defaultStopGate.trim();
    }
    if (patch.defaultDurationSec !== undefined) {
        const d = Number(patch.defaultDurationSec);
        if (Number.isFinite(d) && d >= 15 && d <= 240) next.defaultDurationSec = Math.round(d);
    }
    if (patch.lowCreditThresholdThb !== undefined) {
        const th = Number(patch.lowCreditThresholdThb);
        if (Number.isFinite(th) && th >= 1 && th <= 1000) next.lowCreditThresholdThb = Math.round(th * 100) / 100;
    }
    next.updatedAt = new Date().toISOString();
    await atomicWriteJson(PREFS_PATH, next);
    return { ok: true, prefs: next };
}

async function toggleFavoriteStyle(styleId) {
    const sid = validateId(styleId, 'Style ID');
    const cur = await getPrefs();
    const set = new Set(cur.favoriteStyles || []);
    let favorited = false;
    if (set.has(sid)) {
        set.delete(sid);
        favorited = false;
    } else {
        set.add(sid);
        favorited = true;
    }
    cur.favoriteStyles = [...set];
    cur.updatedAt = new Date().toISOString();
    await atomicWriteJson(PREFS_PATH, cur);
    return { ok: true, styleId: sid, favorited, favoriteStyles: cur.favoriteStyles };
}

// ── Production Lines CRUD ────────────────────────────────────────────────────
async function ensureLinesSeeded() {
    const raw = await readJsonSafe(LINES_PATH, null);
    if (Array.isArray(raw) && raw.length > 0) return raw;
    if (raw && Array.isArray(raw.lines) && raw.lines.length > 0) return raw.lines;
    const seeded = DEFAULT_LINES.map((l) => ({ ...l }));
    await atomicWriteJson(LINES_PATH, { version: 1, lines: seeded });
    return seeded;
}

async function listLines() {
    const lines = await ensureLinesSeeded();
    return { ok: true, lines };
}

async function saveLine(payload = {}) {
    const lines = await ensureLinesSeeded();
    const name = String(payload.name || '').trim().slice(0, 80);
    if (name.length < 2) {
        throw httpError('กรุณาระบุชื่อสายการผลิตอย่างน้อย 2 ตัวอักษร', 400);
    }

    const styleId = validateId(payload.styleId || 'look-3', 'Style ID');
    const durationSec = Math.round(Math.min(240, Math.max(15, Number(payload.durationSec || 45))));
    const bgm = ALLOWED_BGM.has(String(payload.bgm || '').trim()) ? String(payload.bgm).trim() : 'warm_tech';
    const stopGate = ALLOWED_STOP_GATES.has(String(payload.stopGate || '').trim()) ? String(payload.stopGate).trim() : 'qc';
    const voice = String(payload.voice || 'gemini:Charon').trim().slice(0, 80);
    const schedule = String(payload.schedule || 'สั่งรันเอง (Manual)').trim().slice(0, 80);
    const cron = String(payload.cron || '').trim().slice(0, 40);
    const description = String(payload.description || '').trim().slice(0, 260);
    const defaultTopic = String(payload.defaultTopic || '').trim().slice(0, 400);
    const contentMode = payload.contentMode === 'news' ? 'news' : 'standard';

    let id = payload.id ? String(payload.id).trim() : '';
    if (id) {
        validateId(id, 'Line ID');
    } else {
        id = genId('line');
    }

    const idx = lines.findIndex((l) => l.id === id);
    const existing = idx >= 0 ? lines[idx] : null;
    const entry = {
        id,
        name,
        description,
        schedule,
        cron,
        styleId,
        voice,
        bgm,
        durationSec,
        stopGate,
        contentMode,
        defaultTopic,
        active: payload.active !== undefined ? Boolean(payload.active) : (existing ? existing.active : true),
        builtin: existing ? Boolean(existing.builtin) : false,
        lastRunAt: existing ? existing.lastRunAt : null,
        lastRunStatus: existing ? existing.lastRunStatus : 'สร้างใหม่',
        updatedAt: new Date().toISOString(),
    };

    if (idx >= 0) {
        lines[idx] = entry;
    } else {
        lines.push(entry);
    }

    await atomicWriteJson(LINES_PATH, { version: 1, lines });
    return { ok: true, line: entry, lines };
}

async function toggleLine(lineId) {
    const cleanId = validateId(lineId, 'Line ID');
    const lines = await ensureLinesSeeded();
    const target = lines.find((l) => l.id === cleanId);
    if (!target) throw httpError('ไม่พบสายการผลิตที่ระบุ', 404);
    target.active = !target.active;
    target.lastRunStatus = target.active ? 'เปิดใช้งานแล้ว' : 'หยุดชั่วคราว';
    target.updatedAt = new Date().toISOString();
    await atomicWriteJson(LINES_PATH, { version: 1, lines });
    return { ok: true, line: target, lines };
}

async function deleteLine(lineId) {
    const cleanId = validateId(lineId, 'Line ID');
    const lines = await ensureLinesSeeded();
    const target = lines.find((l) => l.id === cleanId);
    if (!target) throw httpError('ไม่พบสายการผลิตที่ระบุ', 404);
    if (target.builtin) {
        throw httpError('ไม่สามารถลบสายการผลิตมาตรฐานของระบบได้ (สามารถกดพักสายนี้แทน)', 400);
    }
    const next = lines.filter((l) => l.id !== cleanId);
    await atomicWriteJson(LINES_PATH, { version: 1, lines: next });
    return { ok: true, id: cleanId, deleted: true, lines: next };
}

// ── Daily News Broadcast v2 Launcher ─────────────────────────────────────────
async function triggerDailyNews({ date, durationSec = 210, styleId = 'look-32', bgm = 'warm_tech', sendTelegram = true } = {}) {
    if (!fs.existsSync(DAILY_NEWS_SCRIPT)) {
        throw httpError('ไม่พบสคริปต์ daily-news-clip.py ในระบบ', 404);
    }

    let cleanDate = '';
    if (date) {
        cleanDate = String(date).trim();
        if (!DATE_RE.test(cleanDate)) {
            throw httpError('รูปแบบวันที่ข่าวไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)', 400);
        }
    } else {
        // Default: yesterday in Asia/Bangkok (UTC+7)
        const bkkNow = new Date(Date.now() + 7 * 3600 * 1000 - 24 * 3600 * 1000);
        cleanDate = bkkNow.toISOString().slice(0, 10);
    }

    const cleanStyle = validateId(styleId || 'look-32', 'Style ID');
    const cleanDur = Math.round(Math.min(240, Math.max(30, Number(durationSec || 210))));
    const cleanBgm = ALLOWED_BGM.has(String(bgm || '').trim()) ? String(bgm).trim() : 'warm_tech';

    const args = [
        DAILY_NEWS_SCRIPT,
        '--date', cleanDate,
        '--duration', String(cleanDur),
        '--style', cleanStyle,
        '--bgm', cleanBgm,
    ];
    if (sendTelegram === false) {
        args.push('--no-telegram');
    }

    await fsp.mkdir(FACTORY_DIR, { recursive: true });
    const yyyymmdd = cleanDate.replace(/-/g, '');
    const jobId = `daily-news-${yyyymmdd}`;
    const logPath = path.join(FACTORY_DIR, `${jobId}.log`);
    const fd = fs.openSync(logPath, 'a');

    let child;
    try {
        child = spawn('/usr/bin/python3', args, {
            detached: true,
            stdio: ['ignore', fd, fd],
            cwd: '/home/dev/projects',
            env: {
                ...process.env,
                HOME: os.homedir(),
                PYTHONUNBUFFERED: '1',
            },
        });
    } finally {
        try { fs.closeSync(fd); } catch (_) {}
    }
    child.unref();

    return {
        ok: true,
        orderMode: 'news',
        jobId,
        date: cleanDate,
        pid: child.pid || null,
        message: `เริ่มผลิตข่าวประจำวัน Daily News Broadcast v2 (${cleanDate}) แล้ว`,
    };
}

// ── Factory Queue Pump (maxConcurrent = 1) ───────────────────────────────────
async function pumpQueue() {
    if (pumpInFlight) return { ok: true, skipped: 'in_flight' };
    pumpInFlight = true;
    try {
        const listRes = await videoStudioManager.listJobs(120);
        const jobs = Array.isArray(listRes?.jobs) ? listRes.jobs : [];

        const runningCount = jobs.filter((j) => j.alive).length;
        if (runningCount >= MAX_CONCURRENT) {
            return { ok: true, active: runningCount, started: null };
        }

        const pending = jobs
            .filter((j) => String(j.status) === 'queued' && j.deferredStart === true && !j.pid)
            .sort((a, b) => {
                const oa = Number.isFinite(Number(a.queueOrder)) ? Number(a.queueOrder) : 999999;
                const ob = Number.isFinite(Number(b.queueOrder)) ? Number(b.queueOrder) : 999999;
                if (oa !== ob) return oa - ob;
                return (Date.parse(a.createdAt || 0) || 0) - (Date.parse(b.createdAt || 0) || 0);
            });

        if (!pending.length) {
            return { ok: true, active: 0, started: null };
        }

        const nextJob = pending[0];
        const jobPath = path.join(videoStudioManager.JOBS_DIR, nextJob.id, 'job.json');
        const fresh = await readJsonSafe(jobPath, null);
        if (!fresh || fresh.status !== 'queued' || !fresh.deferredStart || fresh.pid) {
            return { ok: true, active: 0, started: null };
        }

        fresh.deferredStart = false;
        fresh.message = 'สายพานดึงงานออกจากคิวและเริ่มผลิตแล้ว...';
        fresh.updatedAt = new Date().toISOString();
        await atomicWriteJson(jobPath, fresh);

        const mode = fresh.mode === 'draft' ? 'draft' : 'oneshot';
        await videoStudioManager.spawnRunner(nextJob.id, mode);

        return { ok: true, active: 1, started: nextJob.id };
    } catch (err) {
        return { ok: false, error: err.message };
    } finally {
        pumpInFlight = false;
    }
}

function startQueuePump() {
    if (pumpTimer) return;
    pumpTimer = setInterval(() => {
        pumpQueue().catch(() => {});
    }, PUMP_INTERVAL_MS);
    if (typeof pumpTimer.unref === 'function') pumpTimer.unref();
    // Run one initial tick shortly after startup
    const initTimer = setTimeout(() => {
        pumpQueue().catch(() => {});
    }, 2500);
    if (typeof initTimer.unref === 'function') initTimer.unref();
}

function stopQueuePump() {
    if (pumpTimer) {
        clearInterval(pumpTimer);
        pumpTimer = null;
    }
}

// ── Order & Batch Composer Submission ────────────────────────────────────────
async function submitOrder(payload = {}) {
    const orderMode = String(payload.orderMode || 'single').trim().toLowerCase();

    if (orderMode === 'news') {
        const res = await triggerDailyNews({
            date: payload.newsDate || payload.date,
            durationSec: payload.durationSec || 210,
            styleId: payload.styleId || 'look-32',
            bgm: payload.bgm || 'warm_tech',
            sendTelegram: payload.sendTelegram !== false,
        });
        // Update line-news lastRun metadata best-effort
        try {
            const lines = await ensureLinesSeeded();
            const nl = lines.find((l) => l.id === 'line-news-v2' || l.contentMode === 'news');
            if (nl) {
                nl.lastRunAt = new Date().toISOString();
                nl.lastRunStatus = `กำลังผลิต (${res.date})`;
                await atomicWriteJson(LINES_PATH, { version: 1, lines });
            }
        } catch (_) {}
        return res;
    }

    const stopGate = ALLOWED_STOP_GATES.has(String(payload.stopGate || '').trim().toLowerCase())
        ? String(payload.stopGate).trim().toLowerCase()
        : 'qc';
    const mode = stopGate === 'draft' ? 'draft' : 'oneshot';
    const styleId = validateId(payload.styleId || 'look-3', 'Style ID');
    const durationSec = Math.round(Math.min(240, Math.max(15, Number(payload.durationSec || 45))));
    const bgm = ALLOWED_BGM.has(String(payload.bgm || '').trim()) ? String(payload.bgm).trim() : 'warm_tech';
    const voice = payload.voice ? String(payload.voice).trim().slice(0, 80) : undefined;
    const notes = payload.notes ? String(payload.notes).trim().slice(0, 1000) : undefined;
    const sendTelegram = payload.sendTelegram === true || stopGate === 'autopilot';
    const lineId = payload.lineId ? String(payload.lineId).trim().slice(0, 60) : undefined;
    const lineName = payload.lineName ? String(payload.lineName).trim().slice(0, 80) : (orderMode === 'batch' ? 'ชุดผลิต Batch' : 'สั่งอิสระ');
    const contentMode = payload.contentMode === 'news' ? 'news' : undefined;

    if (orderMode === 'batch') {
        const rawTopics = Array.isArray(payload.topics)
            ? payload.topics
            : String(payload.batchText || '').split(/\r?\n/);
        const topics = rawTopics.map((t) => String(t || '').trim()).filter((t) => t.length >= 2);
        if (!topics.length) {
            throw httpError('กรุณาใส่หัวข้ออย่างน้อย 1 บรรทัด (ความยาวอย่างน้อย 2 ตัวอักษร)', 400);
        }
        if (topics.length > 20) {
            throw httpError('สั่งผลิตแบบชุด (Batch) ได้สูงสุด 20 คลิปต่อครั้ง', 400);
        }

        const batchId = genId('bat');
        const created = [];
        for (let i = 0; i < topics.length; i += 1) {
            const job = await videoStudioManager.createJob({
                topic: topics[i].slice(0, 500),
                styleId,
                durationSec,
                mode,
                bgm,
                voice,
                notes,
                sendTelegram,
                stopGate,
                lineId,
                lineName,
                batchId,
                contentMode,
                deferredStart: true,
                queueOrder: Date.now() + i,
                qcStatus: stopGate === 'skip' ? 'skipped' : 'pending',
            });
            created.push(job);
        }

        const pumpRes = await pumpQueue();
        return {
            ok: true,
            orderMode: 'batch',
            batchId,
            count: created.length,
            jobs: created,
            startedJobId: pumpRes.started || null,
            message: `ส่งชุดผลิต ${created.length} คลิปเข้าคิวสายพานแล้ว (รันทีละ 1 งานเพื่อปกป้อง RAM)`,
        };
    }

    // Single order: enforce maxConcurrent = 1 by deferring if another job is active
    const topic = String(payload.topic || '').trim();
    if (topic.length < 2 || topic.length > 500) {
        throw httpError('หัวข้อวิดีโอ (topic) ต้องมีความยาว 2–500 ตัวอักษร', 400);
    }

    const listRes = await videoStudioManager.listJobs(50);
    const hasRunning = (listRes.jobs || []).some((j) => j.alive);

    const job = await videoStudioManager.createJob({
        topic,
        styleId,
        durationSec,
        mode,
        bgm,
        voice,
        notes,
        sendTelegram,
        stopGate,
        lineId,
        lineName,
        contentMode,
        deferredStart: hasRunning,
        queueOrder: Date.now(),
        qcStatus: stopGate === 'skip' ? 'skipped' : 'pending',
    });

    if (hasRunning) {
        pumpQueue().catch(() => {});
    }

    return {
        ok: true,
        orderMode: 'single',
        jobId: job.id,
        id: job.id,
        deferred: hasRunning,
        job,
        message: hasRunning
            ? 'มีงานอื่นกำลังผลิตอยู่ — นำเข้าคิวสายพานเรียบร้อยแล้ว จะเริ่มอัตโนมัติเมื่อเครื่องว่าง'
            : 'เริ่มผลิตวิดีโอบนสายพานแล้ว',
    };
}

async function triggerLine(lineId, override = {}) {
    const cleanId = validateId(lineId, 'Line ID');
    const lines = await ensureLinesSeeded();
    const line = lines.find((l) => l.id === cleanId);
    if (!line) throw httpError('ไม่พบสายการผลิตที่ระบุ', 404);

    let result;
    if (line.contentMode === 'news') {
        result = await submitOrder({
            orderMode: 'news',
            newsDate: override.date || undefined,
            durationSec: line.durationSec,
            styleId: line.styleId,
            bgm: line.bgm,
            sendTelegram: true,
        });
    } else {
        const topic = String(override.topic || line.defaultTopic || `${line.name} — รอบผลิตอัตโนมัติ`).trim();
        result = await submitOrder({
            orderMode: 'single',
            topic,
            styleId: line.styleId,
            durationSec: line.durationSec,
            voice: line.voice,
            bgm: line.bgm,
            stopGate: line.stopGate || 'qc',
            lineId: line.id,
            lineName: line.name,
            notes: override.notes || line.description || undefined,
        });
    }

    line.lastRunAt = new Date().toISOString();
    line.lastRunStatus = `สั่งรันแล้ว (${result.jobId || 'OK'})`;
    await atomicWriteJson(LINES_PATH, { version: 1, lines });

    return { ok: true, line, result };
}

// ── QC Workbench State Machine ───────────────────────────────────────────────
async function setJobQC(jobId, { qcStatus, note } = {}) {
    const cleanId = validateId(jobId, 'Job ID');
    const status = String(qcStatus || '').trim().toLowerCase();
    if (!ALLOWED_QC_STATUS.has(status)) {
        throw httpError('สถานะ QC ต้องเป็น pending, approved, rejected หรือ skipped เท่านั้น', 400);
    }

    const jobDir = path.join(videoStudioManager.JOBS_DIR, cleanId);
    const jobPath = path.join(jobDir, 'job.json');
    const job = await readJsonSafe(jobPath, null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);

    if (status === 'skipped' && String(job.status || '').toLowerCase() !== 'done') {
        throw httpError('งานยังเรนเดอร์ไม่เสร็จ จึงกดผ่านแบบไม่โพสต์ไม่ได้', 409);
    }

    const now = new Date().toISOString();
    const rawNote = String(note || '').trim().slice(0, 400);
    const cleanNote = rawNote || (status === 'skipped' ? 'ผ่าน — เก็บไว้ดูเอง ไม่ต้องโพสต์' : '');
    const history = Array.isArray(job.qcHistory) ? job.qcHistory : [];
    history.push({
        status,
        note: cleanNote || null,
        at: now,
    });

    job.qcStatus = status;
    job.qcNote = cleanNote || null;
    job.qcUpdatedAt = now;
    job.qcHistory = history.slice(-30);
    job.updatedAt = now;

    await atomicWriteJson(jobPath, job);
    return { ok: true, id: cleanId, qcStatus: status, qcNote: job.qcNote, job };
}

// ── AI Natural-Language Revision ─────────────────────────────────────────────
function detectBgmIntent(promptText) {
    const p = promptText.toLowerCase();
    const mentionsAudioOnly = /(bgm|เพลงประกอบ|ดนตรี|เสียงเพลง|duck|ความดังเพลง)/.test(p)
        && !/(ซีน|บท|พูด|พากย์|คำ|ประโยค|ข้อความ|มุมกล้อง|ภาพ|ตัด|สั้นลง|ยาวขึ้น)/.test(p);
    if (!mentionsAudioOnly) return null;

    let bgm = null;
    if (/(ไม่มีเพลง|ปิดเพลง|mute|none)/.test(p)) bgm = 'none';
    else if (/(warm|เทค)/.test(p)) bgm = 'warm_tech';
    else if (/(cinematic|ดราม่า|เล่าเรื่อง)/.test(p)) bgm = 'story_cinematic';
    else if (/(dawn|สงบ|นุ่ม)/.test(p)) bgm = 'dawn_ambient';

    let bgmVol = null;
    if (/(ลด|เบา|เงียบลง)/.test(p)) bgmVol = 0.08;
    else if (/(เพิ่ม|ดังขึ้น)/.test(p)) bgmVol = 0.24;

    let duckDb = null;
    if (/(ชัดขึ้น|ลดเพลงตอนพูด|duck)/.test(p)) duckDb = 16;

    return { bgm, bgmVol, duckDb };
}

function findSceneIndexFromPrompt(promptText, scenes, props, timeSec) {
    // 1. Explicit Thai/EN scene number: "ซีน 2" or "scene 2"
    const m = promptText.match(/(?:ซีน|ฉาก|scene)\s*#?\s*(\d+)/i);
    if (m) {
        const idx = parseInt(m[1], 10) - 1;
        if (idx >= 0 && idx < scenes.length) return idx;
    }
    // 2. Timestamp @mm:ss in prompt or explicit timeSec
    let targetSec = Number.isFinite(Number(timeSec)) ? Number(timeSec) : null;
    const tm = promptText.match(/@(\d{1,2}):(\d{2})/);
    if (tm) {
        targetSec = parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10);
    }
    if (targetSec !== null && props && Array.isArray(props.scenes)) {
        for (let i = 0; i < props.scenes.length; i += 1) {
            const ps = props.scenes[i];
            if (targetSec >= Number(ps.startSec || 0) && targetSec <= Number(ps.endSec || 0)) {
                if (i < scenes.length) return i;
            }
        }
    }
    return 0;
}

async function reviseJobWithAI(jobId, { prompt, timeSec } = {}) {
    const cleanId = validateId(jobId, 'Job ID');
    const cleanPrompt = String(prompt || '').trim();
    if (cleanPrompt.length < 2 || cleanPrompt.length > 1000) {
        throw httpError('คำสั่งแก้ไข (prompt) ต้องมีความยาว 2–1000 ตัวอักษร', 400);
    }

    const jobDir = path.join(videoStudioManager.JOBS_DIR, cleanId);
    const jobPath = path.join(jobDir, 'job.json');
    const job = await readJsonSafe(jobPath, null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);
    if (videoStudioManager.isJobActivelyRunning(job)) {
        throw httpError('งานกำลังประมวลผลอยู่ กรุณารอให้เสร็จก่อนสั่งแก้ไข', 409);
    }

    const isDraftReady = String(job.status || '').toLowerCase() === 'draft_ready';

    // Fast path: audio/BGM remix only (zero video/TTS re-render cost!)
    const bgmIntent = detectBgmIntent(cleanPrompt);
    if (bgmIntent) {
        const reqPath = path.join(jobDir, 'request.json');
        const reqData = (await readJsonSafe(reqPath, {})) || {};
        const targetBgm = bgmIntent.bgm || reqData.bgm || job.bgm || 'warm_tech';
        const targetVol = bgmIntent.bgmVol !== null ? bgmIntent.bgmVol : 0.10;
        const targetDuck = bgmIntent.duckDb !== null ? bgmIntent.duckDb : 15;

        const [latestRender, latestFinal] = await Promise.all([
            videoStudioManager.findLatestJobRender(jobDir),
            videoStudioManager.findLatestJobFinal(jobDir),
        ]);
        const hasRenderedVideo = Boolean(latestRender || latestFinal);

        if (isDraftReady || !hasRenderedVideo) {
            reqData.bgm = targetBgm;
            await atomicWriteJson(reqPath, reqData);

            const revision = {
                at: new Date().toISOString(),
                prompt: cleanPrompt,
                mode: 'draft-bgm',
                summary: `บันทึกค่าเพลงประกอบ (BGM=${targetBgm}) ลงในร่างแล้ว — กรุณากด Build เพื่อสร้างวิดีโอ`,
                engine: 'rule-audio',
            };
            job.bgm = targetBgm;
            job.revisions = [...(Array.isArray(job.revisions) ? job.revisions : []), revision].slice(-30);
            job.qcStatus = job.qcStatus === 'skipped' ? 'skipped' : 'pending';
            job.updatedAt = new Date().toISOString();
            await atomicWriteJson(jobPath, job);

            return {
                ok: true,
                id: cleanId,
                mode: 'draft-bgm',
                bgm: targetBgm,
                needsBuild: true,
                summary: revision.summary,
                message: 'งานยังไม่มีไฟล์เรนเดอร์ — บันทึกค่า BGM ลง request.json และ job.json แล้ว กรุณาสั่ง Build เพื่อเรนเดอร์วิดีโอ',
                revision,
                dispatch: null,
            };
        }

        const revision = {
            at: new Date().toISOString(),
            prompt: cleanPrompt,
            mode: 'remix',
            summary: `ปรับมิกซ์เสียงอัตโนมัติ (BGM=${targetBgm}, vol=${targetVol}, duck=${targetDuck}dB)`,
            engine: 'rule-audio',
        };
        job.bgm = targetBgm;
        job.revisions = [...(Array.isArray(job.revisions) ? job.revisions : []), revision].slice(-30);
        job.qcStatus = job.qcStatus === 'skipped' ? 'skipped' : 'pending';
        await atomicWriteJson(jobPath, job);

        const remixRes = await videoStudioManager.remixJob(cleanId, {
            bgm: targetBgm,
            bgmVol: targetVol,
            duckDb: targetDuck,
        });
        return { ok: true, id: cleanId, mode: 'remix', revision, dispatch: remixRes };
    }

    const scriptPath = path.join(jobDir, 'script.json');
    const script = await readJsonSafe(scriptPath, null);
    if (!script || !Array.isArray(script.scenes) || !script.scenes.length) {
        throw httpError('ยังไม่พบไฟล์บท (script.json) สำหรับสั่งแก้ไขด้วย AI', 400);
    }
    const props = await readJsonSafe(path.join(jobDir, 'props.json'), null);

    let changedSceneIds = [];
    let summary = '';
    let engine = 'deterministic-fallback';

    // Try Gemini REST API for intelligent minimal-diff script revision
    const aiPrompt = [
        'คุณคือบรรณาธิการวิดีโอ AI ภาษาไทยที่ช่วยแก้บทวิดีโอตามคำสั่งผู้ใช้',
        'กฎสำคัญ: แก้เฉพาะซีนที่เกี่ยวข้องกับคำสั่งเท่านั้น เพื่อรักษาแคช TTS และภาพของซีนอื่นไว้',
        `คำสั่งแก้ไขจากผู้ใช้: "${cleanPrompt}"`,
        Number.isFinite(Number(timeSec)) ? `เวลาที่ผู้ใช้กำลังดูในคลิป: ${Number(timeSec).toFixed(1)} วินาที` : '',
        'ข้อมูล script.json ปัจจุบัน:',
        JSON.stringify({ title: script.title || job.topic, scenes: script.scenes }),
        'ตอบกลับเป็น JSON object เท่านั้น รูปแบบ:',
        '{"summary":"สรุปสิ่งที่แก้เป็นภาษาไทยสั้นๆ","changedSceneIds":["s2"],"scenes":[/* array ของซีนทั้งหมดครบจำนวนเดิมหรือปรับตามสั่ง โดยแต่ละซีนมี id, title, subtitle, narration, visual, icon, direction ตามเดิม */]}',
    ].filter(Boolean).join('\n');

    const aiResult = await callGeminiJson(aiPrompt);
    if (aiResult && Array.isArray(aiResult.scenes) && aiResult.scenes.length > 0 && aiResult.scenes.length <= 30) {
        const valid = aiResult.scenes.every((s) => s && typeof s.narration === 'string' && s.narration.trim().length > 0);
        if (valid) {
            const oldById = new Map(script.scenes.map((s) => [s.id, s]));
            script.scenes = aiResult.scenes.map((s, idx) => {
                const id = String(s.id || `s${idx + 1}`).trim();
                const prev = oldById.get(id) || {};
                return {
                    ...prev,
                    ...s,
                    id,
                    narration: String(s.narration).trim(),
                };
            });
            changedSceneIds = Array.isArray(aiResult.changedSceneIds)
                ? aiResult.changedSceneIds.map((x) => String(x).trim()).filter(Boolean)
                : [];
            summary = String(aiResult.summary || `AI ปรับบทตามคำสั่ง: ${cleanPrompt.slice(0, 80)}`).trim();
            engine = 'gemini-2.5-flash';
        }
    }

    // Deterministic fallback if Gemini API unavailable
    if (engine !== 'gemini-2.5-flash') {
        const targetIdx = findSceneIndexFromPrompt(cleanPrompt, script.scenes, props, timeSec);
        const sc = script.scenes[targetIdx];
        if (sc) {
            const origNar = String(sc.narration || '').trim();
            if (/(สั้นลง|กระชับ|ตัดคำ|ยาวเกิน)/.test(cleanPrompt) && origNar.length > 50) {
                // Trim ~25% gracefully at clause boundary
                const cutAt = Math.max(35, Math.floor(origNar.length * 0.75));
                const spacePos = origNar.lastIndexOf(' ', cutAt);
                sc.narration = origNar.slice(0, spacePos > 30 ? spacePos : cutAt).trim();
                summary = `กระชับบทบรรยายซีน ${targetIdx + 1} (${sc.id}) ให้สั้นลง`;
            } else if (/(เว้นจังหวะ|ช้าลง|หายใจ)/.test(cleanPrompt)) {
                sc.padAfterSec = Math.min(2.5, Number(sc.padAfterSec || 0.35) + 0.5);
                summary = `เพิ่มจังหวะพักท้ายซีน ${targetIdx + 1} (${sc.id}) เป็น ${sc.padAfterSec}s`;
            } else {
                sc.visual = `${String(sc.visual || '').trim()} (${cleanPrompt.slice(0, 80)})`.trim();
                summary = `อัปเดตทิศทางซีน ${targetIdx + 1} (${sc.id}) ตามคำสั่งแก้ไข`;
            }
            changedSceneIds = [sc.id];
        }
    }

    await videoStudioManager.saveScript(cleanId, script);

    const freshJob = await readJsonSafe(jobPath, job);
    const dispatchMode = isDraftReady
        ? 'build'
        : (changedSceneIds.length === 1 && script.scenes.some((s) => s.id === changedSceneIds[0])
            ? 'edit-scene'
            : 'rebuild');

    const revision = {
        at: new Date().toISOString(),
        prompt: cleanPrompt,
        timeSec: Number.isFinite(Number(timeSec)) ? Number(timeSec) : null,
        mode: dispatchMode,
        changedSceneIds,
        summary,
        engine,
    };
    freshJob.revisions = [...(Array.isArray(freshJob.revisions) ? freshJob.revisions : []), revision].slice(-30);
    freshJob.qcStatus = freshJob.qcStatus === 'skipped' ? 'skipped' : 'pending';
    freshJob.updatedAt = new Date().toISOString();
    await atomicWriteJson(jobPath, freshJob);

    let dispatch;
    if (dispatchMode === 'build') {
        dispatch = await videoStudioManager.buildJob(cleanId);
    } else if (dispatchMode === 'edit-scene') {
        dispatch = await videoStudioManager.editScene(cleanId, changedSceneIds[0]);
    } else {
        dispatch = await videoStudioManager.rebuildJob(cleanId);
    }

    return {
        ok: true,
        id: cleanId,
        mode: dispatchMode,
        changedSceneIds,
        summary,
        engine,
        revision,
        dispatch,
    };
}

// ── Agent Hub Safe Worker Summary (NEVER LEAKS TOKEN!) ───────────────────────
async function getWorkersSummary(hubManager) {
    if (!hubManager || typeof hubManager.getHubStatus !== 'function') {
        return { ok: true, onlineCount: 0, totalCount: 0, nvencCount: 0, nodes: [] };
    }
    try {
        const raw = await hubManager.getHubStatus();
        const rawNodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
        const safeNodes = rawNodes.map((n) => {
            const specs = n && typeof n.specs === 'object' && n.specs ? n.specs : {};
            const metrics = n && typeof n.metrics === 'object' && n.metrics ? n.metrics : {};
            const memTotalBytes = Number(metrics.memTotal || specs.memTotal || 0);
            const memUsedBytes = Number(metrics.memUsed || 0);
            const memTotalGb = memTotalBytes > 0 ? +(memTotalBytes / (1024 ** 3)).toFixed(1) : null;
            const memUsedPct = memTotalBytes > 0 && memUsedBytes > 0
                ? Math.round((memUsedBytes / memTotalBytes) * 100)
                : (Number.isFinite(Number(metrics.memPct)) ? Math.round(Number(metrics.memPct)) : null);

            return {
                nodeId: String(n.nodeId || n.id || ''),
                alias: String(n.alias || n.displayName || n.nodeId || ''),
                hostname: String(n.hostname || specs.hostname || ''),
                online: Boolean(n.online),
                os: String(n.os || specs.os || ''),
                arch: String(n.arch || specs.arch || ''),
                capabilities: Array.isArray(n.capabilities) ? n.capabilities.map(String) : [],
                specs: {
                    cpuModel: String(specs.cpuModel || ''),
                    cpuThreads: Number(specs.cpuThreads || 0) || null,
                    gpuName: String(specs.gpuName || ''),
                    hasNvenc: Boolean(specs.hasNvenc),
                    ramGb: memTotalGb,
                },
                metrics: {
                    cpuPct: Number.isFinite(Number(metrics.cpuPct)) ? Math.round(Number(metrics.cpuPct)) : null,
                    memUsedPct,
                    memTotalGb,
                },
                activeJobs: Number(n.activeJobs || 0),
                lastSeen: n.lastSeen || n.lastSeenAt || null,
            };
        });

        const onlineNodes = safeNodes.filter((n) => n.online);
        return {
            ok: true,
            onlineCount: onlineNodes.length,
            totalCount: safeNodes.length,
            nvencCount: onlineNodes.filter((n) => n.specs.hasNvenc).length,
            nodes: safeNodes,
        };
    } catch (err) {
        return { ok: false, error: err.message, onlineCount: 0, totalCount: 0, nvencCount: 0, nodes: [] };
    }
}

// ── Analytics & Factory State Aggregate ──────────────────────────────────────
function classifyJobColumn(job) {
    const status = String(job.status || '').toLowerCase();
    const qc = String(job.qcStatus || 'pending').toLowerCase();
    if (job.alive || ['researching', 'scripting', 'tts', 'rendering', 'mixing', 'previewing', 'editing', 'building', 'running'].includes(status)) {
        return 'running';
    }
    if (status === 'done' && qc === 'skipped') return 'kept';
    if (status === 'draft_ready' || (status === 'done' && qc === 'rejected')) return 'script';
    if (status === 'done') {
        return qc === 'approved' ? 'ready' : 'qc';
    }
    if (status === 'queued' && (job.deferredStart || !job.alive)) return 'queued';
    // error / aborted -> stay visible in queued or script so user can resume/inspect
    if (status === 'error' || status === 'aborted') return 'queued';
    return 'queued';
}

async function getAnalytics({ socialPublishManager = null, geminiCredit = null } = {}) {
    const listRes = await videoStudioManager.listJobs(200);
    const jobs = Array.isArray(listRes?.jobs) ? listRes.jobs : [];
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    let doneJobs = 0;
    let runningJobs = 0;
    let queuedJobs = 0;
    let scriptJobs = 0;
    let qcPendingJobs = 0;
    let qcApprovedJobs = 0;
    let qcRejectedJobs = 0;
    let keptJobs = 0;
    let errorJobs = 0;
    let totalCostThb = 0;
    let monthCostThb = 0;
    let renderedCount = 0;
    let offloadedCount = 0;
    let firstPassApproved = 0;

    for (const j of jobs) {
        const col = classifyJobColumn(j);
        if (col === 'running') runningJobs += 1;
        else if (col === 'queued') queuedJobs += 1;
        else if (col === 'script') scriptJobs += 1;
        else if (col === 'qc') qcPendingJobs += 1;
        else if (col === 'ready') qcApprovedJobs += 1;
        else if (col === 'kept') keptJobs += 1;

        if (j.status === 'done') doneJobs += 1;
        if (j.status === 'error' || j.status === 'aborted') errorJobs += 1;
        if (j.qcStatus === 'rejected') qcRejectedJobs += 1;

        const c = Number(j.outputs?.costDetails?.clipTotalThb ?? j.outputs?.costThb ?? 0);
        if (Number.isFinite(c) && c > 0) {
            totalCostThb += c;
            if (String(j.createdAt || '').startsWith(monthPrefix)) {
                monthCostThb += c;
            }
        }

        const rNode = String(j.renderNode || j.outputs?.renderNode || '').trim();
        if (rNode) {
            renderedCount += 1;
            if (!rNode.toLowerCase().startsWith('homelab')) {
                offloadedCount += 1;
            }
        }

        if (j.status === 'done' && j.qcStatus === 'approved') {
            const revs = Array.isArray(j.revisions) ? j.revisions.length : 0;
            const vers = Array.isArray(j.versions) ? j.versions.length : 1;
            if (revs === 0 && vers <= 1) firstPassApproved += 1;
        }
    }

    const totalQcEvaluated = qcApprovedJobs + qcRejectedJobs;
    const firstPassQcRate = totalQcEvaluated > 0
        ? Math.round((firstPassApproved / totalQcEvaluated) * 100)
        : (doneJobs > 0 ? 100 : 0);
    const offloadRatePct = renderedCount > 0 ? Math.round((offloadedCount / renderedCount) * 100) : 100;

    let socialPublishedCount = 0;
    let socialScheduledCount = 0;
    if (socialPublishManager && typeof socialPublishManager.listQueue === 'function') {
        try {
            const sq = await socialPublishManager.listQueue();
            for (const item of sq.items || []) {
                if (item.status === 'posted') socialPublishedCount += 1;
                else if (item.status === 'scheduled') socialScheduledCount += 1;
            }
        } catch (_) {}
    }

    return {
        ok: true,
        totalJobs: jobs.length,
        doneJobs,
        runningJobs,
        queuedJobs,
        scriptJobs,
        qcPendingJobs,
        keptJobs,
        qcApprovedJobs,
        qcRejectedJobs,
        errorJobs,
        firstPassQcRate,
        totalCostThb: +totalCostThb.toFixed(2),
        monthCostThb: +monthCostThb.toFixed(2),
        offloadRatePct,
        socialPublishedCount,
        socialScheduledCount,
        geminiCredit: geminiCredit || null,
    };
}

async function getFactoryState({ agentHubManager = null, socialPublishManager = null, geminiCredit = null } = {}) {
    const [jobsRes, status, workers, prefs, linesRes, analytics] = await Promise.all([
        videoStudioManager.listJobs(100),
        videoStudioManager.getStatus().catch(() => ({ ok: false })),
        getWorkersSummary(agentHubManager),
        getPrefs(),
        listLines(),
        getAnalytics({ socialPublishManager, geminiCredit }),
    ]);

    const jobs = (jobsRes.jobs || []).map((j) => ({
        ...j,
        factoryCol: classifyJobColumn(j),
        qcStatus: j.qcStatus || (j.status === 'done' ? 'pending' : 'pending'),
        lineName: j.lineName || (String(j.id || '').startsWith('daily-news-') ? 'ข่าวเช้า Broadcast v2' : 'สั่งอิสระ'),
    }));

    return {
        ok: true,
        jobs,
        status,
        workers,
        prefs,
        lines: linesRes.lines,
        analytics,
        geminiCredit,
    };
}

module.exports = {
    FACTORY_DIR,
    LINES_PATH,
    PREFS_PATH,
    MAX_CONCURRENT,
    startQueuePump,
    stopQueuePump,
    pumpQueue,
    submitOrder,
    triggerDailyNews,
    setJobQC,
    reviseJobWithAI,
    listLines,
    saveLine,
    toggleLine,
    deleteLine,
    triggerLine,
    getPrefs,
    updatePrefs,
    toggleFavoriteStyle,
    getWorkersSummary,
    getAnalytics,
    getFactoryState,
    classifyJobColumn,
};
