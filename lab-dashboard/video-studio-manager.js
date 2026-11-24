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

const BASE = '/home/dev/.local/share/motion-studio';
const VENV_PY = path.join(BASE, 'venv', 'bin', 'python');
const MOTION_STUDIO_BIN = '/home/dev/.local/bin/motion-studio';
const STUDIO_JOB = path.join(BASE, 'scripts', 'studio_job.py');
const STYLE_LEARN = path.join(BASE, 'scripts', 'style_learn.py');

const PRESETS_PATH = path.join(BASE, 'assets', 'studio_style_presets.json');
const CUSTOM_STYLES_PATH = path.join(BASE, 'assets', 'studio_custom_styles.json');
const CATALOG_PATH = path.join(BASE, 'assets', 'styles_catalog.json');

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
        return true;
    } catch (err) {
        return err && err.code === 'EPERM';
    }
}

function isJobActivelyRunning(job) {
    if (!job || typeof job !== 'object') return false;
    const status = String(job.status || '');
    if (!RUNNING_STATUSES.has(status)) return false;
    if (job.pid) return isProcessAlive(job.pid);
    // If queued very recently (< 15s) before pid is recorded, treat as active
    if (status === 'queued' && job.updatedAt) {
        const ageMs = Date.now() - Date.parse(job.updatedAt);
        if (Number.isFinite(ageMs) && ageMs < 15000) return true;
    }
    return false;
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
        const data = await readJsonSafe(jobPath, null);
        if (!data || typeof data !== 'object') continue;
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
    if (!Number.isFinite(rawDuration) || rawDuration < 15 || rawDuration > 120) {
        throw httpError('ความยาววิดีโอ (durationSec) ต้องอยู่ระหว่าง 15–120 วินาที', 400);
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
        ...(voice ? { voice } : {}),
        ...(notes ? { notes } : {}),
        createdAt: now,
    };

    const initialJob = {
        id: jobId,
        topic,
        styleId,
        durationSec,
        mode,
        bgm,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        message: 'เข้าคิวรอเริ่มงาน...',
        versions: [],
        error: null,
        createdAt: now,
        updatedAt: now,
    };

    await atomicWriteJson(path.join(jobDir, 'request.json'), requestPayload);
    await atomicWriteJson(path.join(jobDir, 'job.json'), initialJob);

    await spawnRunner(jobId, mode);

    return {
        ok: true,
        id: jobId,
        jobId,
        status: 'queued',
        mode,
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
    const job = await readJsonSafe(path.join(jobDir, 'job.json'), null);
    if (!job) {
        throw httpError('ไม่พบงานที่ระบุ', 404);
    }
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
    job.error = null;
    job.message = 'เข้าคิวเรนเดอร์วิดีโอจากบท...';
    job.updatedAt = new Date().toISOString();
    await atomicWriteJson(jobPath, job);

    await spawnRunner(cleanId, 'build');
    return { ok: true, id: cleanId, status: 'queued' };
}

async function editScene(id, sceneId) {
    const { cleanId, jobPath, job } = await ensureJobReadyForAction(id, { requireScript: true });
    const scId = String(sceneId || '').trim();
    if (!scId || !SCENE_ID_RE.test(scId)) {
        throw httpError('กรุณาระบุ sceneId ที่ถูกต้อง', 400);
    }

    job.status = 'queued';
    job.stage = 'edit-scene';
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
        throw httpError('รองรับเฉพาะไฟล์ภาพ (PNG, JPG, WEBP, GIF) หรือวิดีโอ (MP4, MOV, WEBM, MKV, M4V)', 400);
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

module.exports = {
    BASE,
    VENV_PY,
    JOBS_DIR,
    LEARN_DIR,
    UPLOAD_DIR,
    ID_RE,
    listStyles,
    getStatus,
    createJob,
    spawnRunner,
    getJob,
    listJobs,
    saveScript,
    buildJob,
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
    learnStyle,
    getLearn,
    deleteCustomStyle,
    resolveSafeFile,
};
