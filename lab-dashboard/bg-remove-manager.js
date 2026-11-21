'use strict';

/**
 * bg-remove-manager.js
 * -----------------------------------------------------------------------------
 * Local / Offline Background Removal Manager for Lab Dashboard
 * Wraps /home/dev/.local/bin/remove-bg (rembg + onnxruntime CPU).
 *
 * Safety Guarantees:
 *  - Strictly local models only (never atlascloud / withoutbg)
 *  - Single active heavy job mutex to protect shared 11GB RAM server
 *  - Pure argument-array spawn (no shell interpolation)
 *  - Path-traversal guarded upload & output file serving
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const REMOVE_BG_BIN = process.env.REMOVE_BG_BIN || path.join(os.homedir(), '.local/bin/remove-bg');
const VENV_PYTHON = process.env.REMOVE_BG_PYTHON || path.join(os.homedir(), '.local/share/bg-remove/venv/bin/python');
const WORK_DIR = path.join(os.homedir(), '.gemini', 'bg-studio');
const UPLOADS_DIR = path.join(WORK_DIR, 'uploads');
const OUTPUTS_DIR = path.join(WORK_DIR, 'outputs');

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const FILE_TTL_MS = 24 * 60 * 60 * 1000;

const LOCAL_MODELS = new Set([
    'u2netp', 'u2net', 'u2net_human_seg', 'u2net_cloth_seg', 'silueta',
    'isnet-general-use', 'isnet-anime',
    'birefnet-general', 'birefnet-general-lite', 'birefnet-portrait',
    'birefnet-dis', 'birefnet-hrsod', 'birefnet-cod', 'birefnet-massive',
    'bria-rmbg',
]);

const PRESETS = {
    fast: 'u2netp',
    balanced: 'isnet-general-use',
    product: 'birefnet-general-lite',
    best: 'birefnet-general-lite',
    max: 'birefnet-general',
    person: 'birefnet-portrait',
    anime: 'isnet-anime',
};

const DEFAULT_COMPARE = [
    'isnet-general-use',
    'birefnet-general-lite',
    'birefnet-general',
    'birefnet-portrait',
];

const ALLOWED_BG_NAMES = new Set([
    'white', 'black', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta', 'gray', 'grey', 'silver',
]);

const ALLOWED_FORMATS = new Set(['png', 'webp', 'jpg']);
const ALLOWED_MAX_SIDES = new Set([0, 1024, 2048, 4096]);

const ALLOWED_UPLOAD_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif']);
const WEB_NATIVE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

let activeJob = null;

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

function ramNeededMb(model) {
    if (!model) return 1200;
    if (model.startsWith('birefnet-general-lite')) return 7000;
    if (model.startsWith('birefnet') || model.startsWith('bria-rmbg')) return 8500;
    if (model.startsWith('sam')) return 4000;
    return 1200;
}

async function getStatus() {
    const mem = await getMemInfo();
    return {
        ok: true,
        busy: Boolean(activeJob),
        activeJob: activeJob ? {
            id: activeJob.id,
            mode: activeJob.mode,
            model: activeJob.modelLabel,
            startedAt: activeJob.startedAt,
            elapsedSec: Math.round((Date.now() - activeJob.startedAt) / 100) / 10,
        } : null,
        freeRamMb: mem.freeRamMb,
        totalRamMb: mem.totalRamMb,
        presets: PRESETS,
        models: Array.from(LOCAL_MODELS),
        defaultCompare: DEFAULT_COMPARE,
    };
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

function inspectAndMaybePreview(filePath, needPreview) {
    return new Promise((resolve) => {
        const pyCode = [
            'import json, sys',
            'from PIL import Image, ImageOps',
            'try:',
            '    from pillow_heif import register_heif_opener',
            '    register_heif_opener()',
            'except Exception:',
            '    pass',
            'p = sys.argv[1]',
            'prev = sys.argv[2] if len(sys.argv) > 2 else ""',
            'im = ImageOps.exif_transpose(Image.open(p))',
            'w, h = im.size',
            'if prev:',
            '    im.convert("RGB").save(prev, quality=92)',
            'print(json.dumps({"width": w, "height": h}))',
        ].join('\n');

        const args = ['-c', pyCode, filePath];
        if (needPreview) {
            args.push(filePath + '.preview.jpg');
        }
        execFile(VENV_PYTHON, args, { timeout: 15000 }, (err, stdout) => {
            if (err) {
                resolve({ width: null, height: null, hasPreview: false });
                return;
            }
            try {
                const parsed = JSON.parse(String(stdout || '').trim());
                resolve({
                    width: parsed.width || null,
                    height: parsed.height || null,
                    hasPreview: Boolean(needPreview),
                });
            } catch (_) {
                resolve({ width: null, height: null, hasPreview: false });
            }
        });
    });
}

async function saveUpload(dataUrl, originalName = 'image.png') {
    const rawStr = String(dataUrl || '');
    const m = rawStr.match(/^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i);
    if (!m) {
        throw new Error('รูปแบบไฟล์ไม่ถูกต้อง (ต้องเป็น Base64 Data URL)');
    }
    const mime = m[1].toLowerCase();
    const b64 = m[2];
    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) throw new Error('ไฟล์รูปภาพว่างเปล่า');
    if (buffer.length > MAX_UPLOAD_BYTES) {
        throw new Error(`ไฟล์มีขนาดเกิน ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB`);
    }

    const origBase = path.basename(String(originalName || 'image.png'));
    const origExt = path.extname(origBase).replace('.', '').toLowerCase();
    const mimeMap = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/bmp': 'bmp',
        'image/x-ms-bmp': 'bmp',
        'image/tiff': 'tif',
        'image/heic': 'heic',
        'image/heif': 'heif',
    };

    let ext = mimeMap[mime] || '';
    if (!ext && ALLOWED_UPLOAD_EXTS.has(origExt)) {
        ext = origExt;
    }
    if (!ext || !ALLOWED_UPLOAD_EXTS.has(ext)) {
        throw new Error('รองรับเฉพาะไฟล์รูปภาพ PNG, JPG, WEBP, GIF, BMP, TIFF หรือ HEIC');
    }

    await fsp.mkdir(UPLOADS_DIR, { recursive: true });
    await fsp.mkdir(OUTPUTS_DIR, { recursive: true });

    // Background cleanup of expired temporary studio uploads/outputs (>24h)
    pruneDir(UPLOADS_DIR, FILE_TTL_MS).catch(() => {});
    pruneDir(OUTPUTS_DIR, FILE_TTL_MS).catch(() => {});

    const stamp = Date.now();
    const rand = crypto.randomBytes(3).toString('hex');
    const imageId = `up_${stamp}_${rand}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, imageId);
    await fsp.writeFile(filePath, buffer);

    const needPreview = !WEB_NATIVE_EXTS.has(`.${ext}`);
    const info = await inspectAndMaybePreview(filePath, needPreview);
    const previewFile = info.hasPreview ? `${imageId}.preview.jpg` : imageId;

    return {
        ok: true,
        imageId,
        originalName: origBase,
        bytes: buffer.length,
        width: info.width,
        height: info.height,
        originalUrl: `/api/bg-remove/file/uploads/${encodeURIComponent(previewFile)}`,
        rawUrl: `/api/bg-remove/file/uploads/${encodeURIComponent(imageId)}`,
    };
}

function validateBoxList(boxes, label) {
    if (!Array.isArray(boxes)) return [];
    if (boxes.length > 20) throw new Error(`${label} สูงสุด 20 กรอบ`);
    return boxes.map((b) => {
        const x1 = Number(b?.x1);
        const y1 = Number(b?.y1);
        const x2 = Number(b?.x2);
        const y2 = Number(b?.y2);
        if (![x1, y1, x2, y2].every((v) => Number.isFinite(v))) {
            throw new Error(`พิกัด ${label} ไม่ถูกต้อง`);
        }
        const cx1 = Math.max(0, Math.min(100, Math.min(x1, x2)));
        const cy1 = Math.max(0, Math.min(100, Math.min(y1, y2)));
        const cx2 = Math.max(0, Math.min(100, Math.max(x1, x2)));
        const cy2 = Math.max(0, Math.min(100, Math.max(y1, y2)));
        if (cx2 - cx1 < 0.2 || cy2 - cy1 < 0.2) return null;
        return `${cx1.toFixed(2)}%,${cy1.toFixed(2)}%,${cx2.toFixed(2)}%,${cy2.toFixed(2)}%`;
    }).filter(Boolean);
}

function validateBgColor(bg) {
    const raw = String(bg || '').trim().toLowerCase();
    if (!raw || raw === 'transparent' || raw === 'none') return null;
    if (ALLOWED_BG_NAMES.has(raw)) return raw;
    if (/^#[0-9a-f]{6}$/i.test(raw) || /^#[0-9a-f]{3}$/i.test(raw)) return raw;
    throw new Error('สีพื้นหลังไม่ถูกต้อง (ใช้ชื่อสี เช่น white, black หรือรหัส #RRGGBB)');
}

function toFileUrl(jobId, absPath) {
    const base = path.basename(String(absPath || ''));
    return `/api/bg-remove/file/outputs/${encodeURIComponent(jobId)}/${encodeURIComponent(base)}`;
}

async function runJob(params = {}) {
    if (activeJob) {
        const err = new Error(`กำลังประมวลผลอยู่ (${activeJob.modelLabel}) กรุณารอสักครู่หรือกดยกเลิก`);
        err.statusCode = 409;
        throw err;
    }

    const imageId = path.basename(String(params.imageId || ''));
    if (!imageId || !/^[a-zA-Z0-9_.-]+$/.test(imageId)) {
        const err = new Error('ไม่พบรูปภาพต้นฉบับ (กรุณาอัปโหลดรูปก่อน)');
        err.statusCode = 400;
        throw err;
    }
    const inputPath = path.join(UPLOADS_DIR, imageId);
    if (!inputPath.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(inputPath)) {
        const err = new Error('ไฟล์รูปต้นฉบับหมดอายุหรือถูกลบแล้ว กรุณาอัปโหลดใหม่');
        err.statusCode = 404;
        throw err;
    }

    const mode = params.mode === 'compare' ? 'compare' : 'single';
    const preset = Object.prototype.hasOwnProperty.call(PRESETS, params.preset) ? params.preset : 'balanced';
    const directModel = params.model ? String(params.model).trim() : '';
    if (directModel && !LOCAL_MODELS.has(directModel)) {
        const err = new Error(`ไม่อนุญาตให้ใช้โมเดล '${directModel}' (รองรับเฉพาะโมเดลออฟไลน์ในเครื่องเท่านั้น)`);
        err.statusCode = 400;
        throw err;
    }

    const refine = params.refine !== false;
    const matting = Boolean(params.matting);
    const smooth = Boolean(params.smooth);
    const maskOnly = Boolean(params.maskOnly);
    const crop = Boolean(params.crop);
    const pad = Math.max(0, Math.min(200, Math.round(Number(params.pad ?? 20) || 0)));
    const format = ALLOWED_FORMATS.has(params.format) ? params.format : 'png';
    const maxSideNum = Number(params.maxSide ?? 4096);
    const maxSide = ALLOWED_MAX_SIDES.has(maxSideNum) ? maxSideNum : 4096;
    const force = Boolean(params.force);
    const bg = validateBgColor(params.bg);
    const keepBoxes = validateBoxList(params.keepBoxes, 'keepBox');
    const eraseBoxes = validateBoxList(params.eraseBoxes, 'eraseBox');

    const jobId = `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const jobOutDir = path.join(OUTPUTS_DIR, jobId);
    await fsp.mkdir(jobOutDir, { recursive: true });

    const args = [inputPath, '--out-dir', jobOutDir, '--max-side', String(maxSide), '--format', format];
    let modelLabel = directModel || PRESETS[preset];

    if (mode === 'compare') {
        const rawList = Array.isArray(params.compareModels) && params.compareModels.length
            ? params.compareModels
            : DEFAULT_COMPARE;
        const resolved = [];
        for (const item of rawList) {
            const key = String(item || '').trim();
            const m = PRESETS[key] || key;
            if (!LOCAL_MODELS.has(m)) {
                const err = new Error(`โมเดลเปรียบเทียบ '${key}' ไม่ใช่โมเดล local`);
                err.statusCode = 400;
                throw err;
            }
            if (!resolved.includes(m)) resolved.push(m);
        }
        if (!resolved.length) {
            const err = new Error('กรุณาเลือกโมเดลสำหรับเทียบอย่างน้อย 1 ตัว');
            err.statusCode = 400;
            throw err;
        }
        if (resolved.length > 6) {
            const err = new Error('เทียบได้สูงสุดครั้งละ 6 โมเดล');
            err.statusCode = 400;
            throw err;
        }
        args.push('--compare', resolved.join(','));
        modelLabel = `compare(${resolved.length})`;
    } else if (directModel) {
        args.push('-m', directModel);
    } else {
        args.push('-q', preset);
    }

    if (!refine) args.push('--no-refine');
    if (matting) args.push('--matting');
    if (smooth) args.push('--smooth');
    if (maskOnly && mode === 'single') args.push('--mask');
    if (crop) args.push('--crop', '--pad', String(pad));
    if (bg) args.push('--bg', bg);
    if (force) args.push('--force');
    for (const kb of keepBoxes) args.push('--keep-box', kb);
    for (const eb of eraseBoxes) args.push('--erase-box', eb);

    const timeoutMs = mode === 'compare' ? 240000 : 120000;
    const t0 = Date.now();

    return await new Promise((resolve, reject) => {
        const child = spawn(REMOVE_BG_BIN, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, HOME: os.homedir() },
        });

        activeJob = {
            id: jobId,
            mode,
            modelLabel,
            startedAt: t0,
            child,
            aborted: false,
        };

        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
            if (!settled && activeJob && activeJob.child === child) {
                activeJob.aborted = true;
                child.kill('SIGTERM');
                setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 2000).unref();
            }
        }, timeoutMs);

        child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
        child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

        child.on('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            activeJob = null;
            reject(new Error(`เรียกใช้ remove-bg ไม่สำเร็จ: ${err.message}`));
        });

        child.on('close', async (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const wasAborted = Boolean(activeJob && activeJob.aborted);
            activeJob = null;

            if (wasAborted) {
                const err = new Error('ยกเลิกการประมวลผลแล้ว');
                err.statusCode = 499;
                reject(err);
                return;
            }

            let data = null;
            try {
                data = JSON.parse(stdout.trim());
            } catch (_) {
                data = null;
            }

            if (!data || code !== 0) {
                const msg = (data && data.errors && data.errors[0]?.error)
                    || stderr.trim().split('\n').slice(-2).join(' ')
                    || `ประมวลผลไม่สำเร็จ (exit ${code})`;
                reject(new Error(msg));
                return;
            }

            const mem = await getMemInfo();
            const totalElapsed = Math.round((Date.now() - t0) / 10) / 100;

            if (mode === 'compare') {
                const first = (data.results || [])[0] || {};
                const candidates = (first.candidates || []).map((c) => ({
                    n: c.n,
                    model: c.model,
                    seconds: c.seconds,
                    maskCached: Boolean(c.mask_cached),
                    url: toFileUrl(jobId, c.output),
                    filename: path.basename(c.output),
                }));
                resolve({
                    ok: Boolean(data.ok),
                    mode: 'compare',
                    jobId,
                    totalSeconds: totalElapsed,
                    modelLoadSeconds: data.model_load_seconds ?? 0,
                    originalSize: first.original_size || null,
                    compareSheetUrl: first.compare_sheet ? toFileUrl(jobId, first.compare_sheet) : null,
                    candidates,
                    skipped: first.skipped || [],
                    errors: data.errors || [],
                    freeRamMb: mem.freeRamMb,
                });
                return;
            }

            const r = (data.results || [])[0];
            if (!r || !r.output) {
                reject(new Error((data.errors && data.errors[0]?.error) || 'ไม่พบไฟล์ผลลัพธ์'));
                return;
            }
            resolve({
                ok: Boolean(data.ok),
                mode: 'single',
                jobId,
                model: r.model || data.model,
                note: r.note || data.note || null,
                refine: data.refine !== false,
                maskOnly,
                size: r.size || null,
                originalSize: r.original_size || null,
                seconds: r.seconds ?? totalElapsed,
                totalSeconds: totalElapsed,
                modelLoadSeconds: data.model_load_seconds ?? 0,
                maskCached: Boolean(r.mask_cached),
                outputUrl: toFileUrl(jobId, r.output),
                filename: path.basename(r.output),
                freeRamMb: mem.freeRamMb,
            });
        });
    });
}

function abortActive() {
    if (!activeJob) return { ok: true, aborted: false, message: 'ไม่มีงานที่กำลังทำงานอยู่' };
    activeJob.aborted = true;
    const child = activeJob.child;
    try { child.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 2000).unref();
    return { ok: true, aborted: true, jobId: activeJob.id };
}

async function resolveSafeFile(relSubpath) {
    const cleanRel = String(relSubpath || '').split('/').filter(Boolean).map((seg) => {
        try { return decodeURIComponent(seg); } catch (_) { return seg; }
    });
    if (cleanRel.length < 2 || (cleanRel[0] !== 'uploads' && cleanRel[0] !== 'outputs')) {
        return null;
    }
    const target = path.resolve(WORK_DIR, ...cleanRel);
    if (!target.startsWith(WORK_DIR + path.sep)) return null;
    const ext = path.extname(target).toLowerCase();
    const mimeMap = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
    };
    if (!mimeMap[ext]) return null;
    try {
        const st = await fsp.stat(target);
        if (!st.isFile()) return null;
        return { filePath: target, mime: mimeMap[ext], filename: path.basename(target), size: st.size };
    } catch (_) {
        return null;
    }
}

module.exports = {
    getStatus,
    saveUpload,
    runJob,
    abortActive,
    resolveSafeFile,
    ramNeededMb,
    LOCAL_MODELS,
    PRESETS,
};
