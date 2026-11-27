'use strict';

/**
 * video-studio-manager.js
 * -----------------------------------------------------------------------------
 * Backend Manager for Video Studio (/video-studio) in Lab Dashboard.
 * Wraps /home/dev/.local/share/motion-studio/scripts/studio_job.py and
 * style_learn.py via detached child processes so renders survive PM2 restarts.
 *
 * Safety Guarantees:
 *  - Pure argument-array spawn (no shell interpolation)
 *  - Strict ID validation (/^[a-z0-9-]{6,40}$/) on jobId, learnId, uploadId, styleId
 *  - Path-traversal guarded file resolution (resolveSafeFile)
 *  - Detached runner with log.txt append fd + child.unref()
 *  - URL validation (http/https only) before passing to style_learn.py / yt-dlp
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { pipeline } = require('stream/promises');

const BASE = '/home/dev/.local/share/motion-studio';
const VENV_PY = path.join(BASE, 'venv', 'bin', 'python');
const MOTION_STUDIO_BIN = '/home/dev/.local/bin/motion-studio';
const STUDIO_JOB = path.join(BASE, 'scripts', 'studio_job.py');
const STYLE_LEARN = path.join(BASE, 'scripts', 'style_learn.py');

const PRESETS_PATH = path.join(BASE, 'assets', 'studio_style_presets.json');
const CUSTOM_STYLES_PATH = path.join(BASE, 'assets', 'studio_custom_styles.json');
const CATALOG_PATH = path.join(BASE, 'assets', 'styles_catalog.json');
const AUDIO_ASSETS_DIR = path.join(BASE, 'assets', 'audio');

const OUT_ROOT = '/home/dev/.gemini/outputs/video-studio';
const JOBS_DIR = path.join(OUT_ROOT, 'jobs');
const LEARN_DIR = path.join(OUT_ROOT, 'learn');
const UPLOAD_DIR = path.join(OUT_ROOT, 'uploads');

const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const DOCTOR_CACHE_TTL_MS = 60 * 1000;

const ID_RE = /^[a-z0-9-]{6,40}$/;
const SCENE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const ALLOWED_MODES = new Set(['oneshot', 'draft']);
const ALLOWED_BGM = new Set(['warm_tech', 'story_cinematic', 'dawn_ambient', 'none']);

const RUNNING_STATUSES = new Set([
    'queued',
    'researching',
    'scripting',
    'tts',
    'rendering',
    'mixing',
    'previewing',
    'editing',
    'running',
    'building',
    'downloading',
    'extracting',
    'analyzing',
]);

const ALLOWED_UPLOAD_EXTS = new Set([
    'png', 'jpg', 'jpeg', 'webp', 'gif',
    'mp4', 'mov', 'webm', 'mkv', 'm4v',
    'mp3', 'wav', 'm4a', 'aac', 'ogg',
]);

const UPLOAD_MIME_MAP = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
    'video/x-m4v': 'm4v',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
};

const SERVE_MIME_MAP = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.log': 'text/plain; charset=utf-8',
};

// ── caches ────────────────────────────────────────────────────────────────────
let stylesCache = {
    key: '',
    value: null,
};

let doctorCache = {
    at: 0,
    value: null,
};

// ── helpers ───────────────────────────────────────────────────────────────────
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

function generateId(prefix = '') {
    const stamp = Date.now().toString(36);
    const rand = crypto.randomBytes(3).toString('hex');
    return prefix ? `${prefix}-${stamp}-${rand}` : `${stamp}-${rand}`;
}

function isProcessAlive(pid) {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 1) return false;
    try {
        process.kill(n, 0);
    } catch (err) {
        return Boolean(err && err.code === 'EPERM');
    }
    // After a reboot the pid may belong to an unrelated process -> require it to be our runner.
    try {
        return fs.readFileSync(`/proc/${n}/cmdline`, 'utf8').includes('studio_job.py');
    } catch (_) {
        return true;
    }
}

function isJobActivelyRunning(job) {
    if (!job || typeof job !== 'object') return false;
    const status = String(job.status || '');
    if (!RUNNING_STATUSES.has(status)) return false;
    if (job.deferredStart && !job.pid) return false;
    if (job.pid) return isProcessAlive(job.pid);
    // If queued very recently (< 15s) before pid is recorded, treat as active
    if (status === 'queued' && job.updatedAt) {
        const ageMs = Date.now() - Date.parse(job.updatedAt);
        if (Number.isFinite(ageMs) && ageMs < 15000) return true;
    }
    return false;
}

// A job still marked as running whose runner process is gone (crash, reboot, kill -9)
// is persisted as an error so the UI stops showing it as in-progress and offers Resume.
async function reconcileStaleJob(jobPath, job) {
    if (!job || !RUNNING_STATUSES.has(String(job.status || '')) || !job.pid) return job;
    if (isJobActivelyRunning(job)) return job;
    const stage = String(job.stage || job.status);
    const fixed = {
        ...job,
        status: 'error',
        stage: 'error',
        interruptedStage: stage,
        error: `งานถูกขัดจังหวะระหว่างขั้น ${stage} (โปรเซสหยุดทำงาน เช่น เครื่องค้าง/รีบูต)`,
        message: `งานถูกขัดจังหวะระหว่างขั้น ${stage} · กด "ทำงานต่อ" เพื่อทำต่อจากเดิม`,
        updatedAt: new Date().toISOString(),
    };
    await atomicWriteJson(jobPath, fixed).catch(() => {});
    return fixed;
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

async function getMtimeKey(filePath) {
    try {
        const st = await fsp.stat(filePath);
        return `${st.mtimeMs}:${st.size}`;
    } catch (_) {
        return 'missing';
    }
}

async function getMemInfo() {
    try {
        const raw = await fsp.readFile('/proc/meminfo', 'utf8');
        let totalKb = null;
        let availKb = null;
        for (const line of raw.split('\n')) {
            if (line.startsWith('MemTotal:')) totalKb = parseInt(line.split(/\s+/)[1], 10);
            else if (line.startsWith('MemAvailable:')) availKb = parseInt(line.split(/\s+/)[1], 10);
        }
        return {
            totalRamMb: totalKb ? Math.round(totalKb / 1024) : null,
            freeRamMb: availKb ? Math.round(availKb / 1024) : null,
        };
    } catch (_) {
        return { totalRamMb: null, freeRamMb: null };
    }
}

async function pruneDir(dir, maxAgeMs) {
    try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        const cutoff = Date.now() - maxAgeMs;
        for (const ent of entries) {
            const full = path.join(dir, ent.name);
            try {
                const st = await fsp.stat(full);
                if (st.mtimeMs < cutoff) {
                    await fsp.rm(full, { recursive: true, force: true });
                }
            } catch (_) { /* ignore individual failures */ }
        }
    } catch (_) { /* dir may not exist yet */ }
}

function normalizeStyleMapOrList(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === 'object');
    if (raw && typeof raw === 'object') {
        const src = raw.presets !== undefined ? raw.presets : raw.styles;
        if (Array.isArray(src)) return src.filter((item) => item && typeof item === 'object');
        if (src && typeof src === 'object') {
            return Object.entries(src).map(([id, val]) => ({
                id,
                ...(val && typeof val === 'object' ? val : {}),
            }));
        }
    }
    return [];
}

// ── styles ────────────────────────────────────────────────────────────────────
async function listStyles() {
    const [pKey, cKey, catKey] = await Promise.all([
        getMtimeKey(PRESETS_PATH),
        getMtimeKey(CUSTOM_STYLES_PATH),
        getMtimeKey(CATALOG_PATH),
    ]);
    const cacheKey = `${pKey}|${cKey}|${catKey}`;
    if (stylesCache.value && stylesCache.key === cacheKey) {
        return stylesCache.value;
    }

    const [presetsRaw, customRaw, catalogRaw] = await Promise.all([
        readJsonSafe(PRESETS_PATH, null),
        readJsonSafe(CUSTOM_STYLES_PATH, null),
        readJsonSafe(CATALOG_PATH, []),
    ]);

    const catalogById = new Map();
    if (Array.isArray(catalogRaw)) {
        for (const item of catalogRaw) {
            if (item && item.id) catalogById.set(item.id, item);
        }
    }

    let warning = null;
    if (!presetsRaw) {
        warning = 'ยังไม่พบไฟล์ studio_style_presets.json (กำลังรอการสร้าง preset)';
    }

    const presets = normalizeStyleMapOrList(presetsRaw).map((item) => {
        const cat = catalogById.get(item.id) || {};
        return {
            ...item,
            id: item.id,
            num: item.num ?? cat.num ?? null,
            enName: item.enName || cat.enName || item.id,
            thName: item.thName || cat.thName || item.enName || item.id,
            category: item.category || cat.category || 'ทั่วไป',
            summary: item.summary || cat.summary || '',
            isCustom: false,
        };
    }).sort((a, b) => {
        const na = Number(a.num ?? 9999);
        const nb = Number(b.num ?? 9999);
        if (na !== nb) return na - nb;
        return String(a.id).localeCompare(String(b.id));
    });

    const custom = normalizeStyleMapOrList(customRaw).map((item) => ({
        ...item,
        id: item.id,
        enName: item.enName || item.id,
        thName: item.thName || item.enName || item.id,
        category: item.category || 'สไตล์ของฉัน (Custom)',
        summary: item.summary || '',
        isCustom: true,
    }));

    const categories = [];
    const seenCat = new Set();
    for (const s of [...presets, ...custom]) {
        if (s.category && !seenCat.has(s.category)) {
            seenCat.add(s.category);
            categories.push(s.category);
        }
    }

    const result = {
        ok: true,
        presets,
        custom,
        categories,
        totalPresets: presets.length,
        totalCustom: custom.length,
        ...(warning ? { warning } : {}),
    };

    stylesCache = { key: cacheKey, value: result };
    return result;
}

async function styleExists(styleId) {
    const data = await listStyles();
    return data.presets.some((s) => s.id === styleId) || data.custom.some((s) => s.id === styleId);
}

// ── doctor & status ───────────────────────────────────────────────────────────
function runDoctor() {
    if (doctorCache.value && Date.now() - doctorCache.at < DOCTOR_CACHE_TTL_MS) {
        return Promise.resolve(doctorCache.value);
    }
    return new Promise((resolve) => {
        execFile(
            MOTION_STUDIO_BIN,
            ['doctor'],
            { timeout: 15000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, HOME: os.homedir() } },
            (err, stdout, stderr) => {
                let parsed = null;
                try {
                    parsed = JSON.parse(String(stdout || '').trim());
                } catch (_) {
                    parsed = null;
                }
                const result = parsed || {
                    ok: false,
                    error: (stderr || (err && err.message) || 'motion-studio doctor failed').trim(),
                };
                doctorCache = { at: Date.now(), value: result };
                resolve(result);
            }
        );
    });
}

async function listJobs(limit = 50) {
    const maxItems = Math.max(1, Math.min(200, Number(limit) || 50));
    let entries = [];
    try {
        entries = await fsp.readdir(JOBS_DIR, { withFileTypes: true });
    } catch (_) {
        return { ok: true, jobs: [] };
    }

    const jobs = [];
    for (const ent of entries) {
        if (!ent.isDirectory() || !ID_RE.test(ent.name)) continue;
        const jobPath = path.join(JOBS_DIR, ent.name, 'job.json');
        const raw = await readJsonSafe(jobPath, null);
        if (!raw || typeof raw !== 'object') continue;
        const data = await reconcileStaleJob(jobPath, raw);
        const alive = isJobActivelyRunning(data);
        jobs.push({
            ...data,
            id: data.id || ent.name,
            alive,
        });
    }

    jobs.sort((a, b) => {
        const ta = Date.parse(a.createdAt || a.updatedAt || 0) || 0;
        const tb = Date.parse(b.createdAt || b.updatedAt || 0) || 0;
        return tb - ta;
    });

    return { ok: true, jobs: jobs.slice(0, maxItems) };
}

async function getStatus() {
    const [doctor, mem, listRes] = await Promise.all([
        runDoctor(),
        getMemInfo(),
        listJobs(50),
    ]);

    const activeJobs = [];
    const queue = [];

    for (const job of listRes.jobs) {
        if (!job.alive) continue;
        const summary = {
            id: job.id,
            topic: job.topic || '',
            styleId: job.styleId || '',
            mode: job.mode || 'oneshot',
            status: job.status,
            stage: job.stage || job.status,
            progress: job.progress ?? 0,
            pid: job.pid || null,
            createdAt: job.createdAt || null,
            updatedAt: job.updatedAt || null,
        };
        if (job.status === 'queued') {
            queue.push(summary);
        } else {
            activeJobs.push(summary);
        }
    }

    const activeJob = activeJobs[0] || null;

    return {
        ok: true,
        busy: Boolean(activeJob),
        activeJob,
        activeJobs,
        queue,
        queueCount: queue.length,
        freeRamMb: mem.freeRamMb,
        totalRamMb: mem.totalRamMb,
        doctor,
    };
}

// ── detached runner ───────────────────────────────────────────────────────────
async function spawnRunner(jobId, subcmd, extraArgs = []) {
    const cleanId = validateId(jobId, 'Job ID');
    const jobDir = path.join(JOBS_DIR, cleanId);
    await fsp.mkdir(jobDir, { recursive: true });

    const logPath = path.join(jobDir, 'log.txt');
    const fd = fs.openSync(logPath, 'a');

    let child;
    try {
        child = spawn(
            VENV_PY,
            [STUDIO_JOB, subcmd, '--job', jobDir, ...extraArgs],
            {
                detached: true,
                stdio: ['ignore', fd, fd],
                cwd: BASE,
                env: {
                    ...process.env,
                    HOME: os.homedir(),
                    PYTHONUNBUFFERED: '1',
                },
            }
        );
    } finally {
        try { fs.closeSync(fd); } catch (_) {}
    }

    child.unref();

    // Record pid/pgid immediately so abort works even before Python finishes startup
    const jobPath = path.join(jobDir, 'job.json');
    const current = (await readJsonSafe(jobPath, {})) || {};
    if (child.pid) {
        current.pid = child.pid;
        current.pgid = child.pid;
        current.updatedAt = new Date().toISOString();
        await atomicWriteJson(jobPath, current).catch(() => {});
    }

    return { pid: child.pid || null };
}

// ── job lifecycle ─────────────────────────────────────────────────────────────
async function createJob(req = {}) {
    const topic = String(req.topic || '').trim();
    if (topic.length < 2 || topic.length > 500) {
        throw httpError('หัวข้อวิดีโอ (topic) ต้องมีความยาว 2–500 ตัวอักษร', 400);
    }

    const styleId = String(req.styleId || '').trim();
    if (!styleId || !ID_RE.test(styleId)) {
        throw httpError('กรุณาเลือกสไตล์วิดีโอ (styleId) ที่ถูกต้อง', 400);
    }
    const stylesData = await listStyles();
    if (stylesData.presets.length > 0 || stylesData.custom.length > 0) {
        const exists = await styleExists(styleId);
        if (!exists) {
            throw httpError(`ไม่พบสไตล์ '${styleId}' ในระบบ`, 400);
        }
    }

    const rawDuration = req.durationSec !== undefined ? Number(req.durationSec) : 30;
    if (!Number.isFinite(rawDuration) || rawDuration < 15 || rawDuration > 240) {
        throw httpError('ความยาววิดีโอ (durationSec) ต้องอยู่ระหว่าง 15–240 วินาที', 400);
    }
    const durationSec = Math.round(rawDuration);

    const mode = String(req.mode || 'oneshot').trim().toLowerCase();
    if (!ALLOWED_MODES.has(mode)) {
        throw httpError('โหมดการทำงานต้องเป็น oneshot หรือ draft เท่านั้น', 400);
    }

    const bgmRaw = String(req.bgm || 'warm_tech').trim();
    const bgm = ALLOWED_BGM.has(bgmRaw) ? bgmRaw : 'warm_tech';

    const voice = req.voice ? String(req.voice).trim().slice(0, 80) : undefined;
    const notes = req.notes ? String(req.notes).trim().slice(0, 1000) : undefined;
    const sendTelegram = req.sendTelegram !== false;

    const ALLOWED_STOP_GATES = new Set(['draft', 'qc', 'autopilot']);
    const rawStopGate = req.stopGate ? String(req.stopGate).trim().toLowerCase() : '';
    const stopGate = ALLOWED_STOP_GATES.has(rawStopGate) ? rawStopGate : (mode === 'draft' ? 'draft' : 'qc');

    const ALLOWED_QC_STATUS = new Set(['pending', 'approved', 'rejected']);
    const rawQcStatus = req.qcStatus ? String(req.qcStatus).trim().toLowerCase() : '';
    const qcStatus = ALLOWED_QC_STATUS.has(rawQcStatus) ? rawQcStatus : 'pending';

    const lineId = req.lineId ? String(req.lineId).trim().slice(0, 60) : undefined;
    const lineName = req.lineName ? String(req.lineName).trim().slice(0, 80) : undefined;
    const batchId = req.batchId ? String(req.batchId).trim().slice(0, 60) : undefined;
    const contentMode = req.contentMode ? String(req.contentMode).trim().toLowerCase().slice(0, 32) : undefined;
    const deferredStart = Boolean(req.deferredStart);
    const queueOrder = Number.isFinite(Number(req.queueOrder)) ? Math.round(Number(req.queueOrder)) : undefined;

    const jobId = generateId();
    const jobDir = path.join(JOBS_DIR, jobId);
    await fsp.mkdir(jobDir, { recursive: true });

    const now = new Date().toISOString();
    const requestPayload = {
        id: jobId,
        topic,
        styleId,
        durationSec,
        mode,
        bgm,
        sendTelegram,
        stopGate,
        ...(voice ? { voice } : {}),
        ...(notes ? { notes } : {}),
        ...(lineId ? { lineId } : {}),
        ...(lineName ? { lineName } : {}),
        ...(batchId ? { batchId } : {}),
        ...(contentMode ? { contentMode } : {}),
        createdAt: now,
    };

    const initialJob = {
        id: jobId,
        topic,
        styleId,
        durationSec,
        mode,
        bgm,
        stopGate,
        qcStatus,
        ...(voice ? { voice } : {}),
        ...(lineId ? { lineId } : {}),
        ...(lineName ? { lineName } : {}),
        ...(batchId ? { batchId } : {}),
        ...(contentMode ? { contentMode } : {}),
        ...(deferredStart ? { deferredStart: true } : {}),
        ...(queueOrder !== undefined ? { queueOrder } : {}),
        status: 'queued',
        stage: 'queued',
        progress: 0,
        message: deferredStart ? 'รอคิวในสายพานผลิต (Batch Queue)...' : 'เข้าคิวรอเริ่มงาน...',
        versions: [],
        error: null,
        createdAt: now,
        updatedAt: now,
    };

    await atomicWriteJson(path.join(jobDir, 'request.json'), requestPayload);
    await atomicWriteJson(path.join(jobDir, 'job.json'), initialJob);

    if (!deferredStart) {
        await spawnRunner(jobId, mode);
    }

    return {
        ok: true,
        id: jobId,
        jobId,
        status: 'queued',
        mode,
        stopGate,
        deferredStart,
        ...(batchId ? { batchId } : {}),
    };
}

async function readLogTail(jobDir, maxLines = 40) {
    try {
        const raw = await fsp.readFile(path.join(jobDir, 'log.txt'), 'utf8');
        const lines = raw.trimEnd().split(/\r?\n/);
        return lines.slice(-maxLines);
    } catch (_) {
        return [];
    }
}

async function getJob(id) {
    const cleanId = validateId(id, 'Job ID');
    const jobDir = path.join(JOBS_DIR, cleanId);
    const jobPath = path.join(jobDir, 'job.json');
    const rawJob = await readJsonSafe(jobPath, null);
    if (!rawJob) {
        throw httpError('ไม่พบงานที่ระบุ', 404);
    }
    const job = await reconcileStaleJob(jobPath, rawJob);
    const script = await readJsonSafe(path.join(jobDir, 'script.json'), null);
    const alive = isJobActivelyRunning(job);
    const logTail = await readLogTail(jobDir, 40);

    return {
        ok: true,
        ...job,
        id: job.id || cleanId,
        alive,
        logTail,
        job: { ...job, id: job.id || cleanId, alive, logTail },
        script,
    };
}

async function saveScript(id, script) {
    const cleanId = validateId(id, 'Job ID');
    const jobDir = path.join(JOBS_DIR, cleanId);
    const jobPath = path.join(jobDir, 'job.json');
    const job = await readJsonSafe(jobPath, null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);
    if (isJobActivelyRunning(job)) {
        throw httpError('งานกำลังประมวลผลอยู่ ไม่สามารถแก้ไขบทได้ในขณะนี้', 409);
    }

    if (!script || typeof script !== 'object' || Array.isArray(script)) {
        throw httpError('ข้อมูลบท (script) ต้องเป็น JSON object', 400);
    }
    if (!Array.isArray(script.scenes) || script.scenes.length === 0) {
        throw httpError('บทต้องมีรายการซีน (scenes) อย่างน้อย 1 ซีน', 400);
    }
    if (script.scenes.length > 30) {
        throw httpError('จำนวนซีนสูงสุดไม่เกิน 30 ซีน', 400);
    }

    for (let i = 0; i < script.scenes.length; i += 1) {
        const sc = script.scenes[i];
        if (!sc || typeof sc !== 'object' || Array.isArray(sc)) {
            throw httpError(`ซีนที่ ${i + 1} รูปแบบไม่ถูกต้อง`, 400);
        }
        const scId = String(sc.id || `s${i + 1}`).trim();
        if (!SCENE_ID_RE.test(scId)) {
            throw httpError(`รหัสซีนที่ ${i + 1} ไม่ถูกต้อง`, 400);
        }
        sc.id = scId;
        if (typeof sc.narration !== 'string' || !sc.narration.trim()) {
            throw httpError(`ซีน '${scId}' ต้องมีบทบรรยาย (narration)`, 400);
        }
    }

    await atomicWriteJson(path.join(jobDir, 'script.json'), script);
    job.updatedAt = new Date().toISOString();
    await atomicWriteJson(jobPath, job);

    return { ok: true, id: cleanId, script };
}

async function ensureJobReadyForAction(id, { requireScript = false } = {}) {
    const cleanId = validateId(id, 'Job ID');
    const jobDir = path.join(JOBS_DIR, cleanId);
    const jobPath = path.join(jobDir, 'job.json');
    const job = await readJsonSafe(jobPath, null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);
    if (isJobActivelyRunning(job)) {
        throw httpError('งานนี้กำลังประมวลผลอยู่ กรุณารอให้เสร็จหรือกดยกเลิกก่อน', 409);
    }
    if (requireScript) {
        const script = await readJsonSafe(path.join(jobDir, 'script.json'), null);
        if (!script) {
            throw httpError('ยังไม่พบไฟล์บท (script.json) สำหรับงานนี้', 400);
        }
    }
    return { cleanId, jobDir, jobPath, job };
}

async function buildJob(id) {
    const { cleanId, jobPath, job } = await ensureJobReadyForAction(id, { requireScript: true });
    job.status = 'queued';
    job.stage = 'build';
    job.qcStatus = 'pending';
    job.error = null;
    job.message = 'เข้าคิวเรนเดอร์วิดีโอจากบท...';
    job.updatedAt = new Date().toISOString();
    await atomicWriteJson(jobPath, job);

    await spawnRunner(cleanId, 'build');
    return { ok: true, id: cleanId, status: 'queued' };
}

// Continue a failed/aborted/interrupted job without starting over: studio_job.py resume
// drafts only if script.json is missing, reuses cached TTS/art and skips render/mix/preview
// whose outputs are still valid.
async function resumeJob(id) {
    const { cleanId, jobPath, job } = await ensureJobReadyForAction(id);
    if (!['error', 'aborted'].includes(String(job.status || ''))) {
        throw httpError('ทำงานต่อได้เฉพาะงานที่ล้มเหลว ถูกยกเลิก หรือถูกขัดจังหวะเท่านั้น', 409);
    }
    const resumedFrom = job.interruptedStage || job.stage || job.status;
    job.status = 'queued';
    job.stage = 'resume';
    job.error = null;
    job.resumedFrom = resumedFrom;
    delete job.interruptedStage;
    job.message = `เข้าคิวทำงานต่อจากเดิม (หยุดไว้ที่ขั้น ${resumedFrom})...`;
    job.updatedAt = new Date().toISOString();
    await atomicWriteJson(jobPath, job);

    await spawnRunner(cleanId, 'resume');
    return { ok: true, id: cleanId, status: 'queued', resumedFrom };
}

async function editScene(id, sceneId) {
    const { cleanId, jobPath, job } = await ensureJobReadyForAction(id, { requireScript: true });
    const scId = String(sceneId || '').trim();
    if (!scId || !SCENE_ID_RE.test(scId)) {
        throw httpError('กรุณาระบุ sceneId ที่ถูกต้อง', 400);
    }

    job.status = 'queued';
    job.stage = 'edit-scene';
    job.qcStatus = 'pending';
    job.error = null;
    job.message = `เข้าคิวสร้างเวอร์ชันใหม่จากการแก้ไขซีน ${scId}...`;
    job.updatedAt = new Date().toISOString();
    await atomicWriteJson(jobPath, job);

    await spawnRunner(cleanId, 'edit-scene', ['--scene', scId]);
    return { ok: true, id: cleanId, sceneId: scId, status: 'queued' };
}

async function trimJob(id, start, end) {
    const { cleanId, jobPath, job } = await ensureJobReadyForAction(id);
    const s = Number(start);
    const e = Number(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s) {
        throw httpError('ช่วงเวลา trim ไม่ถูกต้อง (ต้องระบุ start >= 0 และ end > start)', 400);
    }

    job.status = 'queued';
    job.stage = 'trim';
    job.qcStatus = 'pending';
    job.error = null;
    job.message = `เข้าคิวตัดหัว-ท้าย (${s.toFixed(1)}s - ${e.toFixed(1)}s)...`;
    job.updatedAt = new Date().toISOString();
    await atomicWriteJson(jobPath, job);

    await spawnRunner(cleanId, 'trim', ['--start', String(s), '--end', String(e)]);
    return { ok: true, id: cleanId, start: s, end: e, status: 'queued' };
}

async function cutJob(id, from, to) {
    const { cleanId, jobPath, job } = await ensureJobReadyForAction(id);
    const f = Number(from);
    const t = Number(to);
    if (!Number.isFinite(f) || !Number.isFinite(t) || f < 0 || t <= f) {
        throw httpError('ช่วงเวลา cut ไม่ถูกต้อง (ต้องระบุ from >= 0 และ to > from)', 400);
    }

    job.status = 'queued';
    job.stage = 'cut';
    job.qcStatus = 'pending';
    job.error = null;
    job.message = `เข้าคิวตัดช่วงกลางออก (${f.toFixed(1)}s - ${t.toFixed(1)}s)...`;
    job.updatedAt = new Date().toISOString();
    await atomicWriteJson(jobPath, job);

    await spawnRunner(cleanId, 'cut', ['--from', String(f), '--to', String(t)]);
    return { ok: true, id: cleanId, from: f, to: t, status: 'queued' };
}

async function getTimeline(id) {
    const cleanId = validateId(id, 'Job ID');
    const jobDir = path.join(JOBS_DIR, cleanId);
    const job = await readJsonSafe(path.join(jobDir, 'job.json'), null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);

    const props = await readJsonSafe(path.join(jobDir, 'props.json'), null);
    const script = await readJsonSafe(path.join(jobDir, 'script.json'), null);
    const request = await readJsonSafe(path.join(jobDir, 'request.json'), {});

    const padById = new Map();
    if (script && Array.isArray(script.scenes)) {
        for (const s of script.scenes) {
            if (s && s.id) padById.set(s.id, s.padAfterSec);
        }
    }

    const scenes = props && Array.isArray(props.scenes)
        ? props.scenes.map((s) => {
            const startSec = Number(s.startSec || 0);
            const endSec = Number(s.endSec || 0);
            return {
                id: s.id,
                index: s.index,
                title: s.title,
                startSec,
                endSec,
                durationSec: +(endSec - startSec).toFixed(3),
                speechDurSec: s.speechDurSec,
                padAfterSec: padById.has(s.id) ? padById.get(s.id) : s.padAfterSec,
            };
        })
        : [];

    let hasRender = false;
    try {
        const files = await fsp.readdir(jobDir);
        hasRender = files.some((f) => f === 'render.mp4' || /^render_v\d+\.mp4$/.test(f));
    } catch (_) {
        hasRender = false;
    }

    return {
        ok: true,
        id: cleanId,
        totalSec: props ? (props.totalSec || 0) : 0,
        fps: props ? (props.fps || 30) : 30,
        bgm: request.bgm || job.bgm || 'warm_tech',
        hasRender,
        scenes,
    };
}

async function rebuildJob(id, script) {
    if (script && typeof script === 'object' && !Array.isArray(script)) {
        await saveScript(id, script);
    }
    const { cleanId, jobPath, job } = await ensureJobReadyForAction(id, { requireScript: true });
    job.status = 'queued';
    job.stage = 'rebuild';
    job.qcStatus = 'pending';
    job.error = null;
    job.message = 'เข้าคิวสร้างวิดีโอเวอร์ชันใหม่จาก Timeline...';
    job.updatedAt = new Date().toISOString();
    await atomicWriteJson(jobPath, job);

    await spawnRunner(cleanId, 'rebuild');
    return { ok: true, id: cleanId, status: 'queued' };
}

async function remixJob(id, { bgm, bgmVol, duckDb } = {}) {
    const bgmVal = String(bgm || 'warm_tech');
    if (!ALLOWED_BGM.has(bgmVal)) {
        throw httpError('BGM ไม่ถูกต้อง', 400);
    }
    const v = bgmVol === undefined ? 0.14 : Number(bgmVol);
    if (!Number.isFinite(v) || v < 0 || v > 1) {
        throw httpError('ระดับเสียง BGM (bgmVol) ไม่ถูกต้อง (ต้องอยู่ระหว่าง 0 ถึง 1)', 400);
    }
    const d = duckDb === undefined ? 12 : Number(duckDb);
    if (!Number.isFinite(d) || d < 0 || d > 30) {
        throw httpError('ค่า duckDb ไม่ถูกต้อง (ต้องอยู่ระหว่าง 0 ถึง 30)', 400);
    }

    const { cleanId, jobPath, job } = await ensureJobReadyForAction(id);
    job.status = 'queued';
    job.stage = 'remix';
    job.qcStatus = 'pending';
    job.error = null;
    job.message = `เข้าคิวผสมเสียงใหม่ (${bgmVal} · vol ${v} · duck ${d}dB)...`;
    job.updatedAt = new Date().toISOString();
    await atomicWriteJson(jobPath, job);

    await spawnRunner(cleanId, 'remix', ['--bgm', bgmVal, '--bgm-vol', String(v), '--duck-db', String(d)]);
    return { ok: true, id: cleanId, status: 'queued', bgm: bgmVal, bgmVol: v, duckDb: d };
}

async function abortJob(id) {
    const cleanId = validateId(id, 'Job ID');
    const jobDir = path.join(JOBS_DIR, cleanId);
    const jobPath = path.join(jobDir, 'job.json');
    const job = await readJsonSafe(jobPath, null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);

    const pgid = Number(job.pgid || job.pid);
    const pid = Number(job.pid);
    let killed = false;

    if (Number.isInteger(pgid) && pgid > 1) {
        try {
            process.kill(-pgid, 'SIGTERM');
            killed = true;
        } catch (_) {
            if (Number.isInteger(pid) && pid > 1) {
                try {
                    process.kill(pid, 'SIGTERM');
                    killed = true;
                } catch (_) {}
            }
        }
    }

    job.status = 'aborted';
    job.stage = 'aborted';
    job.message = 'ยกเลิกงานตามคำสั่งผู้ใช้แล้ว';
    job.updatedAt = new Date().toISOString();
    await atomicWriteJson(jobPath, job);

    return { ok: true, id: cleanId, aborted: killed };
}

async function abortActive() {
    const listRes = await listJobs(50);
    const abortedIds = [];
    for (const job of listRes.jobs) {
        if (job.alive) {
            await abortJob(job.id).catch(() => {});
            abortedIds.push(job.id);
        }
    }
    return {
        ok: true,
        aborted: abortedIds.length > 0,
        abortedIds,
    };
}

async function deleteJob(id) {
    const cleanId = validateId(id, 'Job ID');
    const jobDir = path.join(JOBS_DIR, cleanId);
    const job = await readJsonSafe(path.join(jobDir, 'job.json'), null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);
    if (isJobActivelyRunning(job)) {
        throw httpError('ไม่สามารถลบงานที่กำลังทำงานอยู่ได้ กรุณากดยกเลิกก่อน', 409);
    }
    await fsp.rm(jobDir, { recursive: true, force: true });
    return { ok: true, id: cleanId, deleted: true };
}

// ── upload & style learner ────────────────────────────────────────────────────
async function saveUpload(dataUrl, originalName = 'reference.mp4') {
    const rawStr = String(dataUrl || '');
    const m = rawStr.match(/^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!m) {
        throw httpError('รูปแบบไฟล์ไม่ถูกต้อง (ต้องเป็น Base64 Data URL)', 400);
    }

    const mime = m[1].toLowerCase();
    const b64 = m[2].replace(/\s+/g, '');
    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) throw httpError('ไฟล์ว่างเปล่า', 400);
    if (buffer.length > MAX_UPLOAD_BYTES) {
        throw httpError(`ไฟล์มีขนาดเกิน ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB`, 413);
    }

    const origBase = path.basename(String(originalName || 'reference.mp4'));
    const origExt = path.extname(origBase).replace('.', '').toLowerCase();
    let ext = UPLOAD_MIME_MAP[mime] || '';
    if (!ext && ALLOWED_UPLOAD_EXTS.has(origExt)) {
        ext = origExt;
    }
    if (!ext || !ALLOWED_UPLOAD_EXTS.has(ext)) {
        throw httpError('รองรับเฉพาะไฟล์ภาพ (PNG, JPG, WEBP, GIF), วิดีโอ (MP4, MOV, WEBM, MKV, M4V) หรือเสียง (MP3, WAV, M4A, AAC, OGG)', 400);
    }

    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    pruneDir(UPLOAD_DIR, UPLOAD_TTL_MS).catch(() => {});

    const uploadId = generateId('up');
    const filename = `${uploadId}.${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);
    await fsp.writeFile(filePath, buffer);

    return {
        ok: true,
        uploadId,
        id: uploadId,
        filename,
        originalName: origBase,
        bytes: buffer.length,
        ext,
        mime,
    };
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);
const ACTIVE_PROXY_JOBS = new Set();
const PROXY_LAST_SPAWN = new Map();
const PROXY_COOLDOWN_MS = 120 * 1000;
const PROXY_FAIL_TTL_MS = 10 * 60 * 1000;

function spawnProxyJob(jobDir, fileName) {
    const key = `${jobDir}/${fileName}`;
    if (ACTIVE_PROXY_JOBS.has(key)) return;

    const now = Date.now();
    const lastSpawn = PROXY_LAST_SPAWN.get(key);
    if (lastSpawn && (now - lastSpawn) < PROXY_COOLDOWN_MS) return;

    const stem = path.basename(fileName, path.extname(fileName));
    const failedMarker = path.join(jobDir, 'editor_assets', 'proxy', `${stem}_proxy.failed`);
    try {
        const st = fs.statSync(failedMarker);
        if ((now - st.mtimeMs) < PROXY_FAIL_TTL_MS) return;
    } catch (_) {}

    ACTIVE_PROXY_JOBS.add(key);
    PROXY_LAST_SPAWN.set(key, now);

    try {
        const child = spawn(VENV_PY, [STUDIO_JOB, 'proxy', '--job', jobDir, '--file', fileName], {
            detached: true,
            stdio: 'ignore',
            cwd: BASE,
            env: {
                ...process.env,
                HOME: os.homedir(),
                PYTHONUNBUFFERED: '1',
            },
        });
        child.on('exit', () => {
            ACTIVE_PROXY_JOBS.delete(key);
        });
        child.on('error', () => {
            ACTIVE_PROXY_JOBS.delete(key);
        });
        child.unref();
    } catch (_) {
        ACTIVE_PROXY_JOBS.delete(key);
    }
}

async function saveUploadStream(req, originalName = 'reference.mp4', maxBytes = 200 * 1024 * 1024) {
    const origBase = path.basename(String(originalName || 'reference.mp4'));
    const ext = path.extname(origBase).replace('.', '').toLowerCase();
    if (!ext || !ALLOWED_UPLOAD_EXTS.has(ext)) {
        throw httpError('รองรับเฉพาะไฟล์ภาพ (PNG, JPG, WEBP, GIF), วิดีโอ (MP4, MOV, WEBM, MKV, M4V) หรือเสียง (MP3, WAV, M4A, AAC, OGG)', 400);
    }

    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    pruneDir(UPLOAD_DIR, UPLOAD_TTL_MS).catch(() => {});

    const uploadId = generateId('up');
    const filename = `${uploadId}.${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);
    const partPath = `${filePath}.part`;

    let bytes = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes && !tooLarge) {
            tooLarge = true;
            req.destroy();
        }
    });

    try {
        await pipeline(req, fs.createWriteStream(partPath));
    } catch (err) {
        await fsp.unlink(partPath).catch(() => {});
        if (tooLarge) {
            throw httpError(`ไฟล์มีขนาดเกิน ${(maxBytes / 1024 / 1024).toFixed(0)} MB`, 413);
        }
        throw httpError(`อัปโหลดไฟล์ไม่สำเร็จ: ${err.message}`, 400);
    }

    if (tooLarge || bytes > maxBytes) {
        await fsp.unlink(partPath).catch(() => {});
        throw httpError(`ไฟล์มีขนาดเกิน ${(maxBytes / 1024 / 1024).toFixed(0)} MB`, 413);
    }
    if (bytes === 0) {
        await fsp.unlink(partPath).catch(() => {});
        throw httpError('ไฟล์ว่างเปล่า', 400);
    }

    await fsp.rename(partPath, filePath);

    return {
        ok: true,
        uploadId,
        id: uploadId,
        filename,
        originalName: origBase,
        bytes,
        ext,
    };
}

async function resolveUploadPath(uploadIdOrName) {
    const raw = String(uploadIdOrName || '').trim();
    if (!raw) throw httpError('uploadId ว่างเปล่า', 400);

    // Accept either "<uploadId>" or "<uploadId>.<ext>"
    const dotIdx = raw.indexOf('.');
    const baseId = dotIdx >= 0 ? raw.slice(0, dotIdx) : raw;
    validateId(baseId, 'Upload ID');

    let entries = [];
    try {
        entries = await fsp.readdir(UPLOAD_DIR);
    } catch (_) {
        throw httpError('ไม่พบไฟล์ที่อัปโหลด', 404);
    }

    const match = entries.find((f) => f === raw || f.startsWith(`${baseId}.`));
    if (!match) {
        throw httpError(`ไม่พบไฟล์อัปโหลด '${baseId}' (อาจหมดอายุแล้ว)`, 404);
    }
    const target = path.resolve(UPLOAD_DIR, match);
    if (!target.startsWith(UPLOAD_DIR + path.sep)) {
        throw httpError('ไฟล์อัปโหลดไม่ถูกต้อง', 400);
    }
    return target;
}

async function learnStyle({ url, uploadIds, name } = {}) {
    const cleanUrl = url ? String(url).trim() : '';
    const hasUrl = Boolean(cleanUrl);
    const rawUploads = Array.isArray(uploadIds) ? uploadIds.filter(Boolean) : [];
    const hasUploads = rawUploads.length > 0;

    if (!hasUrl && !hasUploads) {
        throw httpError('กรุณาระบุ URL วิดีโอตัวอย่าง หรืออัปโหลดไฟล์อย่างน้อย 1 ไฟล์', 400);
    }
    if (hasUrl) {
        if (!/^https?:\/\/[^\s"'<>]+$/i.test(cleanUrl) || cleanUrl.length > 2000) {
            throw httpError('URL ต้องขึ้นต้นด้วย http:// หรือ https:// และไม่มีช่องว่าง', 400);
        }
    }

    const filePaths = [];
    if (hasUploads) {
        if (rawUploads.length > 8) {
            throw httpError('อัปโหลดไฟล์อ้างอิงได้สูงสุด 8 ไฟล์ต่อครั้ง', 400);
        }
        for (const uid of rawUploads) {
            filePaths.push(await resolveUploadPath(uid));
        }
    }

    const cleanName = name ? String(name).trim().slice(0, 80) : '';

    const learnId = generateId('ln');
    const learnDir = path.join(LEARN_DIR, learnId);
    await fsp.mkdir(learnDir, { recursive: true });

    const now = new Date().toISOString();
    const initial = {
        id: learnId,
        status: 'queued',
        name: cleanName || null,
        sourceType: hasUrl ? 'url' : 'files',
        createdAt: now,
        updatedAt: now,
    };
    await atomicWriteJson(path.join(learnDir, 'job.json'), initial);

    const args = [STYLE_LEARN, '--job', learnDir];
    if (hasUrl) {
        args.push('--url', cleanUrl);
    } else {
        args.push('--file', ...filePaths);
    }
    if (cleanName) {
        args.push('--name', cleanName);
    }

    const logPath = path.join(learnDir, 'log.txt');
    const fd = fs.openSync(logPath, 'a');
    let child;
    try {
        child = spawn(VENV_PY, args, {
            detached: true,
            stdio: ['ignore', fd, fd],
            cwd: BASE,
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
        learnId,
        id: learnId,
        status: 'queued',
    };
}

async function getLearn(id) {
    const cleanId = validateId(id, 'Learn ID');
    const learnDir = path.join(LEARN_DIR, cleanId);
    const data = await readJsonSafe(path.join(learnDir, 'job.json'), null);
    if (!data) {
        throw httpError('ไม่พบงานเรียนรู้สไตล์ที่ระบุ', 404);
    }
    return {
        ok: true,
        id: cleanId,
        learnId: cleanId,
        ...data,
    };
}

async function deleteCustomStyle(id) {
    const cleanId = validateId(id, 'Style ID');
    const data = await readJsonSafe(CUSTOM_STYLES_PATH, null);
    if (!data || typeof data !== 'object' || !data.presets || !Object.prototype.hasOwnProperty.call(data.presets, cleanId)) {
        throw httpError('ไม่พบสไตล์ Custom ที่ระบุ', 404);
    }
    delete data.presets[cleanId];
    await atomicWriteJson(CUSTOM_STYLES_PATH, data);
    stylesCache = { key: '', value: null };
    return { ok: true, id: cleanId, deleted: true };
}

// ── safe file serving ─────────────────────────────────────────────────────────
async function resolveSafeFile(jobId, relSubpath) {
    let cleanId;
    try {
        cleanId = validateId(jobId, 'Job ID');
    } catch (_) {
        return null;
    }

    const rawSegments = String(relSubpath || '').split('/').filter(Boolean);
    if (!rawSegments.length) return null;

    const cleanSegments = [];
    for (const seg of rawSegments) {
        let decoded;
        try {
            decoded = decodeURIComponent(seg);
        } catch (_) {
            return null;
        }
        if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
            return null;
        }
        cleanSegments.push(decoded);
    }

    const jobDir = path.resolve(JOBS_DIR, cleanId);
    const target = path.resolve(jobDir, ...cleanSegments);
    if (!target.startsWith(jobDir + path.sep)) return null;

    const ext = path.extname(target).toLowerCase();
    const mime = SERVE_MIME_MAP[ext];
    if (!mime) return null;

    try {
        const st = await fsp.stat(target);
        if (!st.isFile()) return null;
        return {
            filePath: target,
            mime,
            filename: path.basename(target),
            size: st.size,
        };
    } catch (_) {
        return null;
    }
}

// ── Video Editor (Project / Assets / Media / Export) ─────────────────────────
const AUDIO_NAME_RE = /^[a-z0-9_]{1,40}$/;
const JOBASSET_NAME_RE = /^[a-zA-Z0-9._-]{1,120}$/;
const ALLOWED_TRACK_KINDS = new Set(['video', 'voice', 'music', 'sfx', 'text']);
const ALLOWED_SRC_TYPES = new Set(['render', 'final', 'narration', 'bgm', 'sfx', 'jobasset', 'upload']);
const BGM_LABELS = {
    warm_tech: 'Warm Tech (ทันสมัย อบอุ่น)',
    story_cinematic: 'Story Cinematic (เล่าเรื่อง ดราม่า)',
    dawn_ambient: 'Dawn Ambient (สงบ นุ่มนวล)',
};

const durationProbeCache = new Map();

function uidHex(prefix = 'c') {
    return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

function clampNum(val, min, max, fallback) {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

async function probeDurationSec(filePath) {
    if (!filePath) return 0;
    let st;
    try {
        st = await fsp.stat(filePath);
    } catch (_) {
        return 0;
    }
    const cacheKey = `${filePath}:${st.mtimeMs}:${st.size}`;
    if (durationProbeCache.has(cacheKey)) {
        return durationProbeCache.get(cacheKey);
    }
    const dur = await new Promise((resolve) => {
        execFile(
            'ffprobe',
            ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
            { timeout: 8000 },
            (err, stdout) => {
                if (err) return resolve(0);
                const parsed = parseFloat(String(stdout || '').trim());
                resolve(Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1000) / 1000 : 0);
            }
        );
    });
    if (durationProbeCache.size > 500) durationProbeCache.clear();
    durationProbeCache.set(cacheKey, dur);
    return dur;
}

async function findLatestJobRender(jobDir) {
    const candidates = [];
    try {
        const entries = await fsp.readdir(jobDir);
        for (const f of entries) {
            if (f === 'render.mp4' || /^render_v\d+\.mp4$/.test(f)) {
                const full = path.join(jobDir, f);
                const st = await fsp.stat(full).catch(() => null);
                if (st && st.isFile()) candidates.push({ file: full, name: f, mtime: st.mtimeMs });
            }
        }
    } catch (_) {}
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0] || null;
}

async function findLatestJobFinal(jobDir) {
    const candidates = [];
    try {
        const entries = await fsp.readdir(jobDir);
        for (const f of entries) {
            if (f === 'final.mp4' || /^final_v\d+\.mp4$/.test(f)) {
                const full = path.join(jobDir, f);
                const st = await fsp.stat(full).catch(() => null);
                if (st && st.isFile()) candidates.push({ file: full, name: f, mtime: st.mtimeMs });
            }
        }
    } catch (_) {}
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0] || null;
}

async function buildDefaultProject(cleanId) {
    const jobDir = path.join(JOBS_DIR, cleanId);
    const props = await readJsonSafe(path.join(jobDir, 'props.json'), {});
    const reqData = await readJsonSafe(path.join(jobDir, 'request.json'), {});
    const timeline = await readJsonSafe(path.join(jobDir, 'timeline.json'), {});

    const fps = clampNum(props.fps, 15, 60, 30);
    const width = clampNum(props.width, 240, 3840, 1080);
    const height = clampNum(props.height, 240, 3840, 1920);

    const renderInfo = await findLatestJobRender(jobDir);
    const renderDur = renderInfo ? await probeDurationSec(renderInfo.file) : 0;
    const totalSec = clampNum(props.totalSec || renderDur, 0.5, 7200, 10);

    const v1Clips = [];
    const a1Clips = [];
    const scenes = Array.isArray(props.scenes) ? props.scenes : [];

    if (scenes.length > 0) {
        for (let i = 0; i < scenes.length; i++) {
            const sc = scenes[i] || {};
            const startSec = clampNum(sc.startSec, 0, 7200, 0);
            const endSec = clampNum(sc.endSec, startSec + 0.1, 7200, totalSec);
            const linkId = uidHex('lnk');
            const label = String(sc.title || `ฉาก ${i + 1}`).slice(0, 80);
            v1Clips.push({
                id: uidHex('v'),
                linkId,
                label,
                sceneId: sc.id ? String(sc.id) : undefined,
                src: { type: 'render' },
                in: startSec,
                out: endSec,
                start: startSec,
                speed: 1,
                volume: 0,
                fadeIn: 0,
                fadeOut: 0,
            });
            a1Clips.push({
                id: uidHex('a'),
                linkId,
                label: `พากย์: ${label}`,
                sceneId: sc.id ? String(sc.id) : undefined,
                src: { type: 'narration' },
                in: startSec,
                out: endSec,
                start: startSec,
                speed: 1,
                volume: 1,
                fadeIn: 0,
                fadeOut: 0,
            });
        }
    } else {
        const linkId = uidHex('lnk');
        v1Clips.push({
            id: uidHex('v'),
            linkId,
            label: 'วิดีโอหลัก',
            src: { type: 'render' },
            in: 0,
            out: totalSec,
            start: 0,
            speed: 1,
            volume: 0,
            fadeIn: 0,
            fadeOut: 0,
        });
        if (timeline && timeline.narrationPath) {
            a1Clips.push({
                id: uidHex('a'),
                linkId,
                label: 'เสียงพากย์',
                src: { type: 'narration' },
                in: 0,
                out: totalSec,
                start: 0,
                speed: 1,
                volume: 1,
                fadeIn: 0,
                fadeOut: 0,
            });
        }
    }

    const bgmName = String(reqData.bgm || 'warm_tech').trim();
    const m1Clips = [];
    if (bgmName && bgmName !== 'none' && AUDIO_NAME_RE.test(bgmName)) {
        const bgmFile = path.join(AUDIO_ASSETS_DIR, `bgm_${bgmName}.wav`);
        if (fs.existsSync(bgmFile)) {
            m1Clips.push({
                id: uidHex('m'),
                label: BGM_LABELS[bgmName] || bgmName,
                src: { type: 'bgm', name: bgmName },
                in: 0,
                out: totalSec,
                start: 0,
                volume: 0.14,
                fadeIn: 1,
                fadeOut: 2,
                duckDb: 12,
                loop: true,
            });
        }
    }

    const s1Clips = [];
    const sfxEvents = Array.isArray(timeline.sfx) ? timeline.sfx : [];
    for (const ev of sfxEvents) {
        if (!ev || !ev.name) continue;
        const sfxName = String(ev.name).trim();
        if (!AUDIO_NAME_RE.test(sfxName)) continue;
        const sfxFile = path.join(AUDIO_ASSETS_DIR, `sfx_${sfxName}.wav`);
        if (!fs.existsSync(sfxFile)) continue;
        const sfxDur = (await probeDurationSec(sfxFile)) || 0.8;
        const stSec = clampNum(ev.atSec ?? ev.startSec ?? ev.time, 0, 7200, 0);
        s1Clips.push({
            id: uidHex('s'),
            label: sfxName,
            src: { type: 'sfx', name: sfxName },
            in: 0,
            out: sfxDur,
            start: stSec,
            speed: 1,
            volume: clampNum(ev.volume, 0, 2, 0.7),
            fadeIn: 0,
            fadeOut: 0,
        });
    }

    return {
        version: 1,
        jobId: cleanId,
        fps,
        width,
        height,
        master: { volume: 1, lufs: -14 },
        tracks: [
            { id: 'v1', kind: 'video', name: 'วิดีโอหลัก', muted: false, locked: false, hidden: false, clips: v1Clips },
            { id: 'v2', kind: 'video', name: 'โอเวอร์เลย์', muted: false, locked: false, hidden: false, clips: [] },
            { id: 'a1', kind: 'voice', name: 'เสียงพากย์', muted: false, locked: false, hidden: false, clips: a1Clips },
            { id: 'm1', kind: 'music', name: 'เพลงประกอบ (BGM)', muted: false, locked: false, hidden: false, clips: m1Clips },
            { id: 's1', kind: 'sfx', name: 'เอฟเฟกต์เสียง', muted: false, locked: false, hidden: false, clips: s1Clips },
            { id: 't1', kind: 'text', name: 'ข้อความ', muted: false, locked: false, hidden: false, clips: [] },
        ],
    };
}

function sanitizeClipSrc(rawSrc) {
    if (!rawSrc || typeof rawSrc !== 'object') return null;
    const type = String(rawSrc.type || '').trim();
    if (!ALLOWED_SRC_TYPES.has(type)) return null;

    if (type === 'render' || type === 'final' || type === 'narration') {
        return { type };
    }
    if (type === 'bgm' || type === 'sfx') {
        const name = String(rawSrc.name || '').trim();
        if (!AUDIO_NAME_RE.test(name)) return null;
        const prefix = type === 'bgm' ? 'bgm_' : 'sfx_';
        if (!fs.existsSync(path.join(AUDIO_ASSETS_DIR, `${prefix}${name}.wav`))) {
            return null;
        }
        return { type, name };
    }
    if (type === 'jobasset') {
        const file = path.basename(String(rawSrc.file || '').trim());
        if (!JOBASSET_NAME_RE.test(file) || file.includes('..')) return null;
        return { type: 'jobasset', file };
    }
    if (type === 'upload') {
        const id = String(rawSrc.id || rawSrc.uploadId || '').trim();
        if (!id) return null;
        return { type: 'upload', id };
    }
    return null;
}

function sanitizeProject(project, cleanId) {
    if (!project || typeof project !== 'object') {
        throw httpError('ข้อมูลโปรเจกต์ไม่ถูกต้อง', 400);
    }
    const rawTracks = Array.isArray(project.tracks) ? project.tracks : [];
    if (rawTracks.length > 12) {
        throw httpError('จำนวนแทร็กเกินกำหนด (สูงสุด 12 แทร็ก)', 400);
    }

    const masterRaw = project.master && typeof project.master === 'object' ? project.master : {};
    const sanitized = {
        version: 1,
        jobId: cleanId,
        fps: clampNum(project.fps, 15, 60, 30),
        width: Math.round(clampNum(project.width, 240, 3840, 1080)),
        height: Math.round(clampNum(project.height, 240, 3840, 1920)),
        master: {
            volume: clampNum(masterRaw.volume, 0, 2, 1),
            lufs: clampNum(masterRaw.lufs, -30, -5, -14),
        },
        tracks: [],
    };

    let totalClips = 0;
    for (let ti = 0; ti < rawTracks.length; ti++) {
        const tr = rawTracks[ti];
        if (!tr || typeof tr !== 'object') continue;
        const kind = String(tr.kind || '').trim();
        if (!ALLOWED_TRACK_KINDS.has(kind)) continue;

        const rawClips = Array.isArray(tr.clips) ? tr.clips : [];
        const cleanClips = [];
        for (let ci = 0; ci < rawClips.length; ci++) {
            totalClips += 1;
            if (totalClips > 500) {
                throw httpError('จำนวนคลิปรวมเกินกำหนด (สูงสุด 500 คลิป)', 400);
            }
            const c = rawClips[ci];
            if (!c || typeof c !== 'object') continue;

            const inSec = clampNum(c.in, 0, 7200, 0);
            const outSec = clampNum(c.out, inSec + 0.05, 7200, inSec + 1);
            const startSec = clampNum(c.start, 0, 7200, 0);

            const cleanClip = {
                id: String(c.id || uidHex('c')).slice(0, 48),
                label: String(c.label || '').slice(0, 120),
                in: inSec,
                out: outSec,
                start: startSec,
                speed: clampNum(c.speed, 0.25, 4, 1),
                volume: clampNum(c.volume, 0, 2, kind === 'video' ? 0 : 1),
                fadeIn: clampNum(c.fadeIn, 0, 10, 0),
                fadeOut: clampNum(c.fadeOut, 0, 10, 0),
            };
            if (c.linkId) cleanClip.linkId = String(c.linkId).slice(0, 48);
            if (c.sceneId) cleanClip.sceneId = String(c.sceneId).slice(0, 64);

            if (kind === 'text') {
                cleanClip.text = String(c.text || '').slice(0, 300);
                cleanClip.fontSize = Math.round(clampNum(c.fontSize, 12, 200, 48));
                cleanClip.color = String(c.color || '#ffffff').slice(0, 24);
                cleanClip.x = clampNum(c.x, 0, 1, 0.5);
                cleanClip.y = clampNum(c.y, 0, 1, 0.8);
            } else {
                const src = sanitizeClipSrc(c.src);
                if (!src) continue;
                cleanClip.src = src;
            }

            if (kind === 'music') {
                cleanClip.duckDb = clampNum(c.duckDb, 0, 30, 12);
                cleanClip.loop = Boolean(c.loop);
            }
            if (kind === 'video' && c.transform && typeof c.transform === 'object') {
                cleanClip.transform = {
                    x: clampNum(c.transform.x, 0, 1, 0.5),
                    y: clampNum(c.transform.y, 0, 1, 0.5),
                    scale: clampNum(c.transform.scale, 0.1, 4, 1),
                };
            }

            cleanClips.push(cleanClip);
        }

        sanitized.tracks.push({
            id: String(tr.id || uidHex('tr')).slice(0, 32),
            kind,
            name: String(tr.name || kind).slice(0, 60),
            muted: Boolean(tr.muted),
            locked: Boolean(tr.locked),
            hidden: Boolean(tr.hidden),
            clips: cleanClips,
        });
    }

    return sanitized;
}

async function getEditorProject(id) {
    const cleanId = validateId(id, 'Job ID');
    const jobDir = path.join(JOBS_DIR, cleanId);
    const job = await readJsonSafe(path.join(jobDir, 'job.json'), null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);

    const projPath = path.join(jobDir, 'editor_project.json');
    const existing = await readJsonSafe(projPath, null);
    if (existing && typeof existing === 'object') {
        return { ok: true, project: existing, isDefault: false };
    }
    const def = await buildDefaultProject(cleanId);
    return { ok: true, project: def, isDefault: true };
}

async function saveEditorProject(id, project) {
    const cleanId = validateId(id, 'Job ID');
    const jobDir = path.join(JOBS_DIR, cleanId);
    const job = await readJsonSafe(path.join(jobDir, 'job.json'), null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);

    const sanitized = sanitizeProject(project, cleanId);
    const assetsDir = path.join(jobDir, 'editor_assets');

    for (const tr of sanitized.tracks) {
        for (const clip of tr.clips) {
            if (clip.src && clip.src.type === 'upload') {
                const upPath = await resolveUploadPath(clip.src.id);
                await fsp.mkdir(assetsDir, { recursive: true });
                const safeFile = path.basename(upPath).replace(/[^a-zA-Z0-9._-]/g, '_');
                const destPath = path.join(assetsDir, safeFile);
                await fsp.copyFile(upPath, destPath);
                clip.src = { type: 'jobasset', file: safeFile };
                if (VIDEO_EXTS.has(path.extname(safeFile).toLowerCase())) {
                    spawnProxyJob(jobDir, safeFile);
                }
            }
        }
    }

    const projectPath = path.join(jobDir, 'editor_project.json');
    const existingProject = await readJsonSafe(projectPath, null);
    if (!existingProject || JSON.stringify(existingProject) !== JSON.stringify(sanitized)) {
        await atomicWriteJson(projectPath, sanitized);
    }
    return { ok: true, project: sanitized };
}

async function resetEditorProject(id) {
    const cleanId = validateId(id, 'Job ID');
    const jobDir = path.join(JOBS_DIR, cleanId);
    const job = await readJsonSafe(path.join(jobDir, 'job.json'), null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);

    await fsp.unlink(path.join(jobDir, 'editor_project.json')).catch(() => {});
    const project = await buildDefaultProject(cleanId);
    return { ok: true, project, isDefault: true };
}

async function exportEditorProject(id, project) {
    if (project && typeof project === 'object') {
        await saveEditorProject(id, project);
    }
    const { cleanId, jobPath, job } = await ensureJobReadyForAction(id);
    job.status = 'queued';
    job.stage = 'export';
    job.qcStatus = 'pending';
    job.error = null;
    job.message = 'เข้าคิว Export จากโปรแกรมตัดต่อ...';
    job.updatedAt = new Date().toISOString();
    await atomicWriteJson(jobPath, job);

    await spawnRunner(cleanId, 'export');
    return { ok: true, id: cleanId, status: 'queued', stage: 'export' };
}

async function listEditorAssets(jobId) {
    const cleanId = validateId(jobId, 'Job ID');
    const jobDir = path.join(JOBS_DIR, cleanId);
    const job = await readJsonSafe(path.join(jobDir, 'job.json'), null);
    if (!job) throw httpError('ไม่พบงานที่ระบุ', 404);

    const bgm = [];
    const sfx = [];
    try {
        const files = (await fsp.readdir(AUDIO_ASSETS_DIR)).sort();
        for (const f of files) {
            if (!f.endsWith('.wav')) continue;
            const full = path.join(AUDIO_ASSETS_DIR, f);
            if (f.startsWith('bgm_')) {
                const name = f.slice(4, -4);
                const durationSec = await probeDurationSec(full);
                bgm.push({
                    name,
                    label: BGM_LABELS[name] || name,
                    durationSec,
                    url: `/api/video-studio/media/bgm/${encodeURIComponent(name)}?job=${encodeURIComponent(cleanId)}`,
                });
            } else if (f.startsWith('sfx_')) {
                const name = f.slice(4, -4);
                const durationSec = await probeDurationSec(full);
                sfx.push({
                    name,
                    label: name,
                    durationSec,
                    url: `/api/video-studio/media/sfx/${encodeURIComponent(name)}?job=${encodeURIComponent(cleanId)}`,
                });
            }
        }
    } catch (_) {}

    const renderInfo = await findLatestJobRender(jobDir);
    const finalInfo = await findLatestJobFinal(jobDir);
    const timeline = await readJsonSafe(path.join(jobDir, 'timeline.json'), {});
    const narrPath = timeline && timeline.narrationPath ? String(timeline.narrationPath) : '';
    const hasNarr = narrPath && fs.existsSync(narrPath);

    const jobMedia = {
        render: renderInfo ? {
            file: renderInfo.name,
            durationSec: await probeDurationSec(renderInfo.file),
            url: `/api/video-studio/media/render/main?job=${encodeURIComponent(cleanId)}`,
        } : null,
        final: finalInfo ? {
            file: finalInfo.name,
            durationSec: await probeDurationSec(finalInfo.file),
            url: `/api/video-studio/media/final/main?job=${encodeURIComponent(cleanId)}`,
        } : null,
        narration: hasNarr ? {
            file: path.basename(narrPath),
            durationSec: await probeDurationSec(narrPath),
            url: `/api/video-studio/media/narration/main?job=${encodeURIComponent(cleanId)}`,
        } : null,
    };

    const jobAssets = [];
    const assetsDir = path.join(jobDir, 'editor_assets');
    try {
        const files = (await fsp.readdir(assetsDir)).sort();
        for (const f of files) {
            const full = path.join(assetsDir, f);
            const st = await fsp.stat(full).catch(() => null);
            if (!st || !st.isFile()) continue;
            const ext = path.extname(f).toLowerCase();
            const item = {
                file: f,
                size: st.size,
                mime: SERVE_MIME_MAP[ext] || 'application/octet-stream',
                durationSec: await probeDurationSec(full),
                url: `/api/video-studio/media/jobasset/${encodeURIComponent(f)}?job=${encodeURIComponent(cleanId)}`,
            };
            if (VIDEO_EXTS.has(ext)) {
                const stem = path.basename(f, ext);
                const proxyFile = `${stem}_proxy.mp4`;
                const proxyPath = path.join(assetsDir, 'proxy', proxyFile);
                if (fs.existsSync(proxyPath)) {
                    item.proxyUrl = `/api/video-studio/media/jobproxy/${encodeURIComponent(proxyFile)}?job=${encodeURIComponent(cleanId)}`;
                    item.hasProxy = true;
                } else {
                    spawnProxyJob(jobDir, f);
                }
            }
            jobAssets.push(item);
        }
    } catch (_) {}

    return { ok: true, jobId: cleanId, bgm, sfx, job: jobMedia, jobAssets };
}

async function resolveEditorMedia(jobId, type, name) {
    const cleanId = validateId(jobId, 'Job ID');
    const cleanType = String(type || '').trim();
    const cleanName = String(name || '').trim();
    const jobDir = path.join(JOBS_DIR, cleanId);

    let targetPath = null;
    if (cleanType === 'bgm' || cleanType === 'sfx') {
        if (!AUDIO_NAME_RE.test(cleanName)) return null;
        const prefix = cleanType === 'bgm' ? 'bgm_' : 'sfx_';
        const baseDir = path.resolve(AUDIO_ASSETS_DIR);
        const resolved = path.resolve(baseDir, `${prefix}${cleanName}.wav`);
        if (!resolved.startsWith(baseDir + path.sep)) return null;
        targetPath = resolved;
    } else if (cleanType === 'render') {
        const info = await findLatestJobRender(jobDir);
        targetPath = info ? info.file : null;
    } else if (cleanType === 'final') {
        const info = await findLatestJobFinal(jobDir);
        targetPath = info ? info.file : null;
    } else if (cleanType === 'narration') {
        const timeline = await readJsonSafe(path.join(jobDir, 'timeline.json'), {});
        const narrPath = timeline && timeline.narrationPath ? String(timeline.narrationPath) : '';
        if (narrPath) {
            const resolved = path.resolve(narrPath);
            const jobRoot = path.resolve(jobDir);
            if (resolved.startsWith(jobRoot + path.sep)) {
                targetPath = resolved;
            }
        }
    } else if (cleanType === 'jobasset') {
        if (!cleanName || cleanName.includes('..') || cleanName.includes('/') || cleanName.includes('\\')) {
            return null;
        }
        const baseDir = path.resolve(jobDir, 'editor_assets');
        const resolved = path.resolve(baseDir, cleanName);
        if (!resolved.startsWith(baseDir + path.sep)) return null;
        targetPath = resolved;
    } else if (cleanType === 'jobproxy') {
        if (!cleanName || cleanName.includes('..') || cleanName.includes('/') || cleanName.includes('\\')) {
            return null;
        }
        const baseDir = path.resolve(jobDir, 'editor_assets', 'proxy');
        const resolved = path.resolve(baseDir, path.basename(cleanName));
        if (!resolved.startsWith(baseDir + path.sep)) return null;
        targetPath = resolved;
    } else {
        return null;
    }

    if (!targetPath) return null;
    try {
        const st = await fsp.stat(targetPath);
        if (!st.isFile()) return null;
        const ext = path.extname(targetPath).toLowerCase();
        return {
            filePath: targetPath,
            mime: SERVE_MIME_MAP[ext] || 'application/octet-stream',
            filename: path.basename(targetPath),
            size: st.size,
        };
    } catch (_) {
        return null;
    }
}

module.exports = {
    BASE,
    VENV_PY,
    OUT_ROOT,
    JOBS_DIR,
    LEARN_DIR,
    UPLOAD_DIR,
    ID_RE,
    httpError,
    validateId,
    readJsonSafe,
    atomicWriteJson,
    isJobActivelyRunning,
    findLatestJobFinal,
    findLatestJobRender,
    listStyles,
    getStatus,
    createJob,
    spawnRunner,
    getJob,
    listJobs,
    saveScript,
    buildJob,
    resumeJob,
    editScene,
    trimJob,
    cutJob,
    getTimeline,
    rebuildJob,
    remixJob,
    trim: trimJob,
    cut: cutJob,
    abortJob,
    abortActive,
    deleteJob,
    saveUpload,
    saveUploadStream,
    learnStyle,
    getLearn,
    deleteCustomStyle,
    resolveSafeFile,
    buildDefaultProject,
    getEditorProject,
    sanitizeProject,
    saveEditorProject,
    resetEditorProject,
    exportEditorProject,
    listEditorAssets,
    resolveEditorMedia,
};
