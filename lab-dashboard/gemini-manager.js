'use strict';

/**
 * gemini-manager.js
 * -----------------------------------------------------------------------------
 * Backend Service Manager for Google Antigravity (agy) & Gemini Assistant Web UI
 * Runs natively on the Homelab Linux server.
 *
 * Capabilities:
 *  - Primary Engine: Google Antigravity CLI (agy) with Google OAuth session
 *  - Models: Gemini 4 Argon, Gemini 3.8 Flash, Claude Sonnet 5.5, Claude Opus 5.5, etc.
 *  - Fallback Engine: Google Gemini CLI / Google AI Studio API Key
 *  - Real-time streaming response (Server-Sent Events)
 *  - Safe execution modes:
 *      * 'chat' : Advisory / Q&A mode
 *      * 'exec' : Full Agent mode (--dangerously-skip-permissions)
 *      * 'plan' : Planning mode
 *  - Multi-project workspace selector (/home/dev/projects/*)
 *  - Session history persistence & Abort controller
 */

const { spawn, execFile } = require('child_process');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME_DIR = os.homedir();
const AGY_BIN = process.env.AGY_BIN || path.join(HOME_DIR, '.local/bin/agy');
const GEMINI_DIR = path.join(HOME_DIR, '.gemini');
const GEMINI_ENV_FILE = path.join(GEMINI_DIR, '.env');
const GEMINI_SETTINGS_FILE = path.join(GEMINI_DIR, 'settings.json');
const HISTORY_FILE = path.join(GEMINI_DIR, 'webui-history.json');
const MEMORY_FILE = path.join(GEMINI_DIR, 'MEMORY.md');
const PROJECTS_BASE = path.join(HOME_DIR, 'projects');
const QUEUE_FILE = path.join(GEMINI_DIR, 'task-queue.json');
const UPLOADS_DIR = path.join(GEMINI_DIR, 'uploads');

let activeChild = null;
let shouldResetSession = false;
const sessionActiveByCwd = {};

let taskQueue = [];
let isProcessingQueue = false;

function loadQueueSync() {
    try {
        if (fs.existsSync(QUEUE_FILE)) {
            const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) taskQueue = data;
        }
    } catch (_) {
        taskQueue = [];
    }
}
loadQueueSync();

async function saveQueue() {
    try {
        await fsp.mkdir(GEMINI_DIR, { recursive: true });
        await fsp.writeFile(QUEUE_FILE, JSON.stringify(taskQueue, null, 2), { mode: 0o600 });
    } catch (e) {
        console.error('[GeminiManager] Failed to save queue:', e.message);
    }
}

function getQueue() {
    return taskQueue.map((item, idx) => ({ ...item, order: idx + 1 }));
}

async function saveUploadedImage(dataUrl, originalName = 'image.png') {
    const match = String(dataUrl || '').match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
        throw new Error('รองรับเฉพาะไฟล์รูปภาพ PNG, JPG, WEBP หรือ GIF เท่านั้น');
    }
    const rawExt = match[1].toLowerCase();
    const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 10 * 1024 * 1024) {
        throw new Error('ขนาดไฟล์รูปภาพต้องไม่เกิน 10 MB');
    }
    await fsp.mkdir(UPLOADS_DIR, { recursive: true });
    const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);
    await fsp.writeFile(filePath, buffer);
    return {
        ok: true,
        filename,
        originalName: path.basename(originalName || filename),
        path: filePath,
        url: `/api/gemini/uploads/${filename}`
    };
}

async function enqueueTask({ prompt, images = [], mode = 'exec', cwd = PROJECTS_BASE, model = 'gemini-4-hydrogen-medium' }) {
    const cleanImages = Array.isArray(images) ? images : [];
    const cleanPrompt = (prompt || '').trim() || (cleanImages.length > 0 ? 'ช่วยดูและวิเคราะห์รูปภาพที่แนบมานี้หน่อย' : '');
    if (!cleanPrompt) throw new Error('ข้อความคำสั่งว่างเปล่า ไม่สามารถเพิ่มเข้าคิวได้');

    const item = {
        id: 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        prompt: cleanPrompt,
        images: cleanImages,
        mode: mode || 'exec',
        cwd: cwd || PROJECTS_BASE,
        model: model || 'gemini-4-hydrogen-medium',
        createdAt: Date.now()
    };

    taskQueue.push(item);
    await saveQueue();

    // If AI is currently idle, trigger execution of this queued task immediately
    if (!activeChild && (!activeJob || activeJob.status !== 'running')) {
        setImmediate(processNextInQueue);
    }

    return { ok: true, task: item, queue: getQueue() };
}

async function updateQueueTask(id, updates = {}) {
    const idx = taskQueue.findIndex(t => t.id === id);
    if (idx === -1) throw new Error('ไม่พบคำสั่งนี้ในคิว (อาจเริ่มทำงานไปแล้วหรือถูกลบออก)');

    if (updates.prompt !== undefined) {
        const cleanPrompt = (updates.prompt || '').trim();
        if (!cleanPrompt) throw new Error('ข้อความคำสั่งต้องไม่ว่างเปล่า');
        taskQueue[idx].prompt = cleanPrompt;
    }
    if (updates.mode !== undefined) taskQueue[idx].mode = updates.mode;
    if (updates.cwd !== undefined) taskQueue[idx].cwd = updates.cwd;
    if (updates.model !== undefined) taskQueue[idx].model = updates.model;
    taskQueue[idx].updatedAt = Date.now();

    await saveQueue();
    return { ok: true, task: taskQueue[idx], queue: getQueue() };
}

async function removeQueueTask(id) {
    const prevLen = taskQueue.length;
    taskQueue = taskQueue.filter(t => t.id !== id);
    if (taskQueue.length !== prevLen) {
        await saveQueue();
    }
    return { ok: true, queue: getQueue() };
}

async function clearQueue() {
    taskQueue = [];
    await saveQueue();
    return { ok: true, queue: [] };
}

async function reorderQueue(id, direction) {
    const idx = taskQueue.findIndex(t => t.id === id);
    if (idx === -1) return { ok: false, error: 'ไม่พบงานในคิว' };
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= taskQueue.length) return { ok: false, error: 'ไม่สามารถย้ายลำดับได้' };
    const temp = taskQueue[idx];
    taskQueue[idx] = taskQueue[targetIdx];
    taskQueue[targetIdx] = temp;
    await saveQueue();
    return { ok: true, queue: getQueue() };
}

async function processNextInQueue() {
    if (activeChild || (activeJob && activeJob.status === 'running')) {
        return; // Process currently busy
    }
    if (taskQueue.length === 0) {
        return; // No tasks in queue
    }
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    const nextTask = taskQueue.shift();
    await saveQueue();

    try {
        console.log(`[GeminiManager] Running next task from queue (${nextTask.id}): "${nextTask.prompt.substring(0, 45)}..." (Remaining: ${taskQueue.length})`);
        executePrompt(
            {
                prompt: nextTask.prompt,
                images: Array.isArray(nextTask.images) ? nextTask.images : [],
                mode: nextTask.mode,
                cwd: nextTask.cwd,
                model: nextTask.model,
                resetSession: false
            },
            (type, text) => {
                // Stream chunks internally stored in activeJob.output
            },
            (exitCode, error) => {
                isProcessingQueue = false;
            }
        );
    } catch (err) {
        console.error('[GeminiManager] Error executing queued task:', err.message);
        isProcessingQueue = false;
        setTimeout(() => {
            processNextInQueue();
        }, 1000);
    }
}

let activeJob = {
    id: null,
    status: 'idle', // 'idle' | 'running' | 'completed' | 'error' | 'aborted'
    prompt: '',
    output: '',
    startedAt: null,
    finishedAt: null,
    error: null,
    exitCode: null,
    mode: 'exec',
    cwd: PROJECTS_BASE,
    model: ''
};

function formatToolSummary(tc) {
    if (!tc) return '';
    const args = tc.args || tc.arguments || {};
    const detail = args.toolSummary || args.Path || args.Description || args.CommandLine || args.query || args.Prompt || '';
    const clean = String(detail).replace(/\s+/g, ' ').trim();
    return clean ? `${tc.name}: ${clean}`.slice(0, 140) : tc.name;
}

function getLiveThinkingState(sinceMs = 0) {
    try {
        const brainDir = path.join(HOME_DIR, '.gemini/antigravity-cli/brain');
        if (!fs.existsSync(brainDir)) return null;
        const subdirs = fs.readdirSync(brainDir)
            .map(d => path.join(brainDir, d))
            .filter(p => {
                try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
            });
        if (!subdirs.length) return null;
        subdirs.sort((a, b) => {
            try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch (_) { return 0; }
        });

        const logsDir = path.join(subdirs[0], '.system_generated/logs');
        const fullFile = path.join(logsDir, 'transcript_full.jsonl');
        const compactFile = path.join(logsDir, 'transcript.jsonl');
        const tFile = fs.existsSync(fullFile) ? fullFile : compactFile;
        if (!fs.existsSync(tFile)) return null;

        // Read only last 48KB for fast, low-overhead polling
        const stat = fs.statSync(tFile);
        const readSize = Math.min(stat.size, 48 * 1024);
        const buf = Buffer.alloc(readSize);
        const fd = fs.openSync(tFile, 'r');
        try {
            fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
        } finally {
            fs.closeSync(fd);
        }

        const lines = buf.toString('utf8').split('\n');
        if (stat.size > readSize && lines.length > 0) lines.shift(); // drop partial first line

        const cutoffMs = sinceMs ? (sinceMs - 3000) : 0;
        let latestThinking = '';
        let currentAction = '';
        let lastStepTime = '';
        const steps = [];

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i].trim();
            if (!raw) continue;
            try {
                const obj = JSON.parse(raw);
                const ts = obj.created_at ? new Date(obj.created_at).getTime() : 0;
                if (cutoffMs && ts && ts < cutoffMs) continue;

                if (obj.created_at) lastStepTime = obj.created_at;
                if (obj.thinking && String(obj.thinking).trim()) {
                    latestThinking = String(obj.thinking).trim();
                }
                if (Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {
                    for (const tc of obj.tool_calls) {
                        const summary = formatToolSummary(tc);
                        if (summary) {
                            currentAction = summary;
                            steps.push(summary);
                        }
                    }
                }
            } catch (_) {}
        }

        return {
            thinking: latestThinking || (steps.length ? 'ขั้นตอนที่ทำในรอบนี้:\n' + steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : ''),
            currentAction: currentAction || 'กำลังคิดวิเคราะห์คำสั่ง...',
            stepsCount: steps.length,
            lastStepTime
        };
    } catch (_) {
        return null;
    }
}

function getActiveJob() {
    return {
        ...activeJob,
        activeRunning: activeChild !== null,
        queue: getQueue(),
        liveThought: activeJob.status === 'running' ? getLiveThinkingState(activeJob.startedAt || 0) : null
    };
}

async function persistJobToHistory(job) {
    if (!job || !job.prompt) return;
    const promptText = (job.prompt || '').trim();
    const outputText = (job.output || '').trim();
    if (!promptText && !outputText) return;

    try {
        const history = await loadHistory();
        const last = history[history.length - 1];
        const secondLast = history[history.length - 2];

        if (secondLast && secondLast.role === 'user' && secondLast.content === promptText && last && last.role === 'assistant') {
            last.content = outputText || (job.error ? `❌ ${job.error}` : '[ไม่มีผลลัพธ์จากคำสั่ง]');
        } else if (last && last.role === 'user' && last.content === promptText) {
            history.push({ role: 'assistant', content: outputText || (job.error ? `❌ ${job.error}` : '[ไม่มีผลลัพธ์จากคำสั่ง]') });
        } else {
            history.push({ role: 'user', content: promptText });
            history.push({ role: 'assistant', content: outputText || (job.error ? `❌ ${job.error}` : '[ไม่มีผลลัพธ์จากคำสั่ง]') });
        }
        await saveHistory(history);
    } catch (e) {
        console.error('[GeminiManager] persistJobToHistory error:', e.message);
    }
}

// ── Initialize Environment ───────────────────────────────────────────────────
function init() {
    try {
        if (!fs.existsSync(GEMINI_DIR)) {
            fs.mkdirSync(GEMINI_DIR, { recursive: true });
        }
        if (fs.existsSync(GEMINI_ENV_FILE)) {
            const content = fs.readFileSync(GEMINI_ENV_FILE, 'utf8');
            for (const line of content.split('\n')) {
                const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
                if (match) {
                    const [, k, v] = match;
                    const cleanV = v.replace(/^['"](.*)['"]$/, '$1');
                    if (!process.env[k]) process.env[k] = cleanV;
                }
            }
        }
    } catch (e) {
        console.error('[GeminiManager] Failed to init env:', e.message);
    }

    if (taskQueue.length > 0) {
        console.log(`[GeminiManager] Restoring ${taskQueue.length} pending queued task(s) from disk...`);
        setTimeout(() => {
            processNextInQueue();
        }, 3000);
    }
}
init();

// ── Check CLI Status & Available Projects ────────────────────────────────────
async function getStatus() {
    let installed = false;
    let version = 'unknown';
    let binPath = '';
    let engine = 'gemini';
    let engineLabel = 'Google Gemini CLI';
    let hasAuth = false;
    let authType = 'none';
    let authLabel = 'ยังไม่ได้ล็อกอิน';
    let oauthEmail = 'asri.utcc@gmail.com';
    let models = [];

    // 1. Check Antigravity CLI (Primary Engine)
    if (fs.existsSync(AGY_BIN)) {
        try {
            const verOut = await new Promise((resolve) => {
                execFile(AGY_BIN, ['--version'], (err, stdout) => {
                    resolve(err ? '' : stdout.trim());
                });
            });

            if (verOut) {
                const modelsOut = await new Promise((resolve) => {
                    execFile(AGY_BIN, ['models'], { timeout: 8000 }, (err, stdout) => {
                        resolve(err ? '' : stdout.trim());
                    });
                });

                if (modelsOut && !modelsOut.includes('Please sign in')) {
                    installed = true;
                    version = verOut;
                    binPath = AGY_BIN;
                    engine = 'antigravity';
                    engineLabel = 'Google Antigravity Core (agy)';
                    hasAuth = true;
                    authType = 'antigravity-oauth';
                    authLabel = 'Google Account (Antigravity · asri.utcc@gmail.com)';

                    const lines = modelsOut.split('\n');
                    for (const l of lines) {
                        const parts = l.split('\t');
                        if (parts.length >= 2 && parts[0] && !parts[0].includes('...')) {
                            models.push({
                                id: parts[0].trim(),
                                name: parts[1].trim()
                            });
                        }
                    }
                }
            }
        } catch (_) {}
    }

    // 2. Fallback to Gemini CLI / API Key
    if (!hasAuth) {
        try {
            const binRes = await new Promise((resolve) => {
                execFile('which', ['gemini'], (err, stdout) => {
                    resolve(err ? '' : stdout.trim());
                });
            });
            if (binRes) {
                installed = true;
                binPath = binRes;
                const verRes = await new Promise((resolve) => {
                    execFile('gemini', ['--version'], (err, stdout) => {
                        resolve(err ? 'unknown' : stdout.trim());
                    });
                });
                version = verRes || 'unknown';
            }
        } catch (_) {}

        const key = process.env.GEMINI_API_KEY || '';
        const hasKey = key.trim().length > 10;
        if (hasKey) {
            authType = 'api-key';
            authLabel = 'API Key (' + key.slice(0, 6) + '••••••••' + key.slice(-4) + ')';
            hasAuth = true;
        }

        models = [
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
        ];
    }

    // List available project folders
    let projects = [];
    try {
        if (fs.existsSync(PROJECTS_BASE)) {
            const entries = await fsp.readdir(PROJECTS_BASE, { withFileTypes: true });
            projects = entries
                .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
                .map((e) => e.name);
        }
    } catch (_) {}

    return {
        installed,
        version,
        binPath,
        engine,
        engineLabel,
        hasKey: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 10),
        hasOAuth: hasAuth,
        oauthEmail,
        authType,
        authLabel,
        hasAuth,
        projectsBase: PROJECTS_BASE,
        projects,
        activeRunning: activeChild !== null,
        models
    };
}

// ── Save API Key ─────────────────────────────────────────────────────────────
async function setApiKey(key) {
    const cleanKey = (key || '').trim();
    if (cleanKey.length < 10) {
        throw new Error('API Key ไม่ถูกต้อง (ความยาวสั้นเกินไป)');
    }

    process.env.GEMINI_API_KEY = cleanKey;

    await fsp.mkdir(GEMINI_DIR, { recursive: true });
    await fsp.writeFile(GEMINI_ENV_FILE, `GEMINI_API_KEY="${cleanKey}"\n`, { mode: 0o600 });

    try {
        let settings = {};
        if (fs.existsSync(GEMINI_SETTINGS_FILE)) {
            const raw = await fsp.readFile(GEMINI_SETTINGS_FILE, 'utf8');
            settings = JSON.parse(raw);
        }
        settings.apiKey = cleanKey;
        await fsp.writeFile(GEMINI_SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
    } catch (_) {}

    return { ok: true, message: 'API key saved and applied successfully' };
}

// ── Execute Prompt Stream ────────────────────────────────────────────────────
function executePrompt({ jobId = null, prompt, images = [], mode = 'exec', cwd = PROJECTS_BASE, model = 'gemini-4-hydrogen-medium', resetSession = false }, onChunk, onDone) {
    if (activeChild) {
        throw new Error('Another AI command is currently running. Please wait or stop it.');
    }

    const cleanImages = Array.isArray(images) ? images : [];
    const imagePaths = cleanImages
        .map((img) => (typeof img === 'string' ? img : img && img.path))
        .filter((p) => p && fs.existsSync(p));

    const cliPrompt = imagePaths.length > 0
        ? `[ผู้ใช้งานแนบรูปภาพมาด้วย กรุณาอ่าน/ดูไฟล์รูปภาพต่อไปนี้ก่อนตอบคำถาม:\n${imagePaths.map((p) => `- ${p}`).join('\n')}\n]\n\n${prompt}`
        : prompt;

    // Sanitize cwd
    let safeCwd = PROJECTS_BASE;
    if (cwd && fs.existsSync(cwd)) {
        safeCwd = cwd;
    } else if (cwd && fs.existsSync(path.join(PROJECTS_BASE, cwd))) {
        safeCwd = path.join(PROJECTS_BASE, cwd);
    }

    // Initialize background job tracker
    const finalJobId = jobId || ('job_' + Date.now());
    activeJob = {
        id: finalJobId,
        status: 'running',
        prompt,
        images: cleanImages,
        output: '',
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
        exitCode: null,
        mode,
        cwd: safeCwd,
        model
    };

    // Pre-save user's prompt immediately to disk so it can never be lost if connection drops
    loadHistory().then(async (history) => {
        const last = history[history.length - 1];
        if (!last || last.role !== 'user' || last.content !== prompt) {
            const entry = { role: 'user', content: prompt };
            if (cleanImages.length > 0) entry.images = cleanImages;
            history.push(entry);
            await saveHistory(history);
        }
    }).catch((e) => console.error('[GeminiManager] Failed to pre-save prompt:', e.message));

    // Session continuation logic
    const forceNew = Boolean(resetSession) || shouldResetSession;
    if (forceNew) {
        shouldResetSession = false;
        sessionActiveByCwd[safeCwd] = false;
    }
    const continueSession = !forceNew;

    const hasAgy = fs.existsSync(AGY_BIN);

    if (hasAgy) {
        // Run natively with Antigravity CLI (agy)
        const args = ['-p', cliPrompt];
        if (continueSession) {
            args.unshift('-c'); // Continue the ongoing conversation session
        }
        if (mode === 'exec') {
            args.push('--dangerously-skip-permissions');
        }
        if (model) {
            args.push('--model', model);
        }

        const env = {
            ...process.env,
            PATH: `/home/dev/.gemini/bin:/home/dev/.local/bin:${process.env.PATH || ''}`,
            TERM: 'xterm-256color',
            FORCE_COLOR: '0',
        };

        const child = spawn(AGY_BIN, args, {
            cwd: safeCwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        sessionActiveByCwd[safeCwd] = true;
        activeChild = child;

        child.stdout.on('data', (d) => {
            const str = d.toString('utf8');
            activeJob.output += str;
            onChunk('stdout', str);
        });

        child.stderr.on('data', (d) => {
            const str = d.toString('utf8');
            onChunk('stderr', str);
        });

        child.on('error', (err) => {
            activeChild = null;
            activeJob.status = 'error';
            activeJob.error = err.message;
            activeJob.finishedAt = Date.now();
            onDone(1, err.message);
            setTimeout(() => {
                processNextInQueue();
            }, 600);
        });

        child.on('close', (code) => {
            activeChild = null;
            activeJob.exitCode = code;
            if (activeJob.status !== 'aborted') {
                activeJob.status = (code === 0) ? 'completed' : 'error';
                if (code !== 0 && !activeJob.error) {
                    activeJob.error = `Exit code ${code}`;
                }
            }
            activeJob.finishedAt = Date.now();

            // Background auto-persistence to disk
            persistJobToHistory({ ...activeJob }).catch((err) => {
                console.error('[GeminiManager] Failed to persist background job:', err.message);
            });

            onDone(code, activeJob.error);
            setTimeout(() => {
                processNextInQueue();
            }, 600);
        });

        return {
            abort: () => {
                if (activeChild === child) {
                    activeJob.status = 'aborted';
                    activeJob.finishedAt = Date.now();
                    try {
                        child.kill('SIGTERM');
                        setTimeout(() => {
                            if (activeChild === child) child.kill('SIGKILL');
                        }, 2000);
                    } catch (_) {}
                }
            }
        };
    }

    // Fallback: Legacy Gemini CLI
    const key = process.env.GEMINI_API_KEY || '';
    if (!key) {
        activeJob.status = 'error';
        activeJob.error = 'ยังไม่ได้ยืนยันตัวตน: กรุณาล็อกอิน Antigravity หรือระบุ Gemini API Key';
        activeJob.finishedAt = Date.now();
        throw new Error('ยังไม่ได้ยืนยันตัวตน: กรุณาล็อกอิน Antigravity หรือระบุ Gemini API Key');
    }

    const args = ['-p', prompt, '--skip-trust'];
    if (continueSession) {
        args.push('--resume', 'latest');
    }
    if (mode === 'exec') {
        args.push('--approval-mode', 'yolo');
    } else {
        args.push('--approval-mode', 'plan');
    }
    if (model) {
        args.push('-m', model);
    }

    const env = {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '0',
        GEMINI_API_KEY: key
    };

    const child = spawn('gemini', args, {
        cwd: safeCwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    activeChild = child;

    child.stdout.on('data', (d) => {
        const str = d.toString('utf8');
        activeJob.output += str;
        onChunk('stdout', str);
    });

    child.stderr.on('data', (d) => {
        const str = d.toString('utf8');
        onChunk('stderr', str);
    });

    child.on('error', (err) => {
        activeChild = null;
        activeJob.status = 'error';
        activeJob.error = err.message;
        activeJob.finishedAt = Date.now();
        onDone(1, err.message);
        setTimeout(() => {
            processNextInQueue();
        }, 600);
    });

    child.on('close', (code) => {
        activeChild = null;
        activeJob.exitCode = code;
        if (activeJob.status !== 'aborted') {
            activeJob.status = (code === 0) ? 'completed' : 'error';
            if (code !== 0 && !activeJob.error) {
                activeJob.error = `Exit code ${code}`;
            }
        }
        activeJob.finishedAt = Date.now();

        // Background auto-persistence to disk
        persistJobToHistory({ ...activeJob }).catch((err) => {
            console.error('[GeminiManager] Failed to persist background job:', err.message);
        });

        onDone(code, activeJob.error);
        setTimeout(() => {
            processNextInQueue();
        }, 600);
    });

    return {
        abort: () => {
            if (activeChild === child) {
                activeJob.status = 'aborted';
                activeJob.finishedAt = Date.now();
                try {
                    child.kill('SIGTERM');
                    setTimeout(() => {
                        if (activeChild === child) child.kill('SIGKILL');
                    }, 2000);
                } catch (_) {}
            }
        }
    };
}

// ── Abort Active Task ────────────────────────────────────────────────────────
function abortActive() {
    if (activeJob && activeJob.status === 'running') {
        activeJob.status = 'aborted';
        activeJob.finishedAt = Date.now();
    }
    if (activeChild) {
        try {
            activeChild.kill('SIGTERM');
            const killed = true;
            activeChild = null;
            return { ok: true, killed };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
    return { ok: true, message: 'No running process' };
}

// ── Chat History Persistence ─────────────────────────────────────────────────
async function loadHistory() {
    try {
        if (!fs.existsSync(HISTORY_FILE)) return [];
        const raw = await fsp.readFile(HISTORY_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        return [];
    }
}

async function saveHistory(messages) {
    try {
        const slice = (messages || []).slice(-40);
        await fsp.writeFile(HISTORY_FILE, JSON.stringify(slice, null, 2), 'utf8');
        return true;
    } catch (_) {
        return false;
    }
}

async function clearHistory() {
    try {
        shouldResetSession = true;
        for (const k of Object.keys(sessionActiveByCwd)) {
            sessionActiveByCwd[k] = false;
        }
        if (fs.existsSync(HISTORY_FILE)) await fsp.unlink(HISTORY_FILE);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Smart Long-Term Memory (Persistent) ──────────────────────────────────────
async function getMemory() {
    try {
        if (!fs.existsSync(MEMORY_FILE)) {
            return { ok: true, memory: '', exists: false };
        }
        const text = await fsp.readFile(MEMORY_FILE, 'utf8');
        return { ok: true, memory: text, exists: true };
    } catch (e) {
        return { ok: false, error: e.message, memory: '' };
    }
}

async function saveMemory(content) {
    try {
        await fsp.writeFile(MEMORY_FILE, content || '', 'utf8');
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function appendMemory(fact) {
    try {
        let current = '';
        if (fs.existsSync(MEMORY_FILE)) {
            current = await fsp.readFile(MEMORY_FILE, 'utf8');
        }
        const dateStr = new Date().toLocaleDateString('th-TH');
        const entry = `\n- [${dateStr}] ${fact.trim()}`;
        if (current.includes('## 🧠 Learned Facts & Notes')) {
            current = current.replace('## 🧠 Learned Facts & Notes', `## 🧠 Learned Facts & Notes${entry}`);
        } else {
            current += `\n\n## 🧠 Learned Facts & Notes${entry}\n`;
        }
        await fsp.writeFile(MEMORY_FILE, current, 'utf8');
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── AI Quota Summary (Google Cloud Code / Antigravity OAuth) ─────────────────
async function getQuotaSummary() {
    const tokenFile = path.join(HOME_DIR, '.gemini/antigravity-cli/antigravity-oauth-token');
    if (!fs.existsSync(tokenFile)) {
        return { ok: false, error: 'ไม่พบไฟล์ antigravity-oauth-token' };
    }
    try {
        const raw = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
        const inner = typeof raw.token === 'string' ? JSON.parse(raw.token) : raw.token;
        const accessToken = inner?.access_token;
        if (!accessToken) {
            return { ok: false, error: 'ไม่พบ access_token ในไฟล์ OAuth' };
        }

        const res = await fetch('https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'antigravity/1.15.8'
            },
            body: '{}'
        });

        if (!res.ok) {
            const errTxt = await res.text().catch(() => '');
            return { ok: false, error: `Quota API HTTP ${res.status}: ${errTxt.slice(0, 120)}` };
        }

        const data = await res.json();
        const modelsObj = data.models || {};
        const models = [];

        for (const [id, info] of Object.entries(modelsObj)) {
            if (!info || !info.quotaInfo) continue;
            const rem = typeof info.quotaInfo.remainingFraction === 'number' ? info.quotaInfo.remainingFraction : 1;
            const remainingPct = Math.max(0, Math.min(100, Number((rem * 100).toFixed(1))));
            models.push({
                id,
                displayName: info.displayName || id,
                remainingPct,
                usedPct: Number((100 - remainingPct).toFixed(1)),
                resetTime: info.quotaInfo.resetTime || null
            });
        }

        const pickPool = (id, name, matchFn, color) => {
            const matched = models.filter(matchFn);
            if (!matched.length) return null;
            // Use lowest remainingPct in pool as conservative indicator
            const minModel = matched.reduce((a, b) => (a.remainingPct <= b.remainingPct ? a : b));
            return {
                id,
                name,
                color,
                remainingPct: minModel.remainingPct,
                usedPct: minModel.usedPct,
                resetTime: minModel.resetTime,
                modelsCount: matched.length,
                models: matched.sort((a, b) => a.remainingPct - b.remainingPct)
            };
        };

        const pools = [
            pickPool('hydrogen', 'Gemini 4 Hydrogen', m => m.id.includes('hydrogen'), '#38bdf8'),
            pickPool('argon', 'Gemini 2.5 Pro', m => m.id.includes('argon') || m.id.includes('orchestrator') || m.id.includes('gemini-2.5-pro'), '#a855f7'),
            pickPool('flash', 'Gemini 3.8 Flash', m => m.id.includes('flash'), '#34d399'),
            pickPool('claude', 'Claude 5.5 & GPT-OSS', m => m.id.includes('claude') || m.id.includes('gpt-oss'), '#fb923c')
        ].filter(Boolean);

        return {
            ok: true,
            email: raw.id_token_email || 'asri.utcc@gmail.com',
            updatedAt: new Date().toISOString(),
            pools,
            models: models.sort((a, b) => a.id.localeCompare(b.id))
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

module.exports = {
    getStatus,
    setApiKey,
    executePrompt,
    abortActive,
    getActiveJob,
    loadHistory,
    saveHistory,
    clearHistory,
    getMemory,
    saveMemory,
    appendMemory,
    getQueue,
    enqueueTask,
    updateQueueTask,
    removeQueueTask,
    clearQueue,
    reorderQueue,
    processNextInQueue,
    UPLOADS_DIR,
    saveUploadedImage,
    getQuotaSummary
};
