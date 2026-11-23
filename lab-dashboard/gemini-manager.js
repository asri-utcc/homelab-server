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
const crypto = require('crypto');
const deepseekAgent = require('./deepseek-agent');
const aiRouter = require('./ai-router');
const crossTeam = require('./cross-team-orchestrator');
const tokenUsageHelper = require('./token-usage');

const HOME_DIR = os.homedir();
const AGY_BIN = process.env.AGY_BIN || path.join(HOME_DIR, '.local/bin/agy');
const CLAUDE_BIN = process.env.CLAUDE_BIN || path.join(HOME_DIR, '.local/bin/claude');
const CLAUDE_CODE_MODELS = [
    { id: 'claude-code-sonnet', name: 'Claude Code · Sonnet (Sub)' },
    { id: 'claude-code-opus', name: 'Claude Code · Opus (Sub)' },
    { id: 'claude-code-haiku', name: 'Claude Code · Haiku (Sub)' }
];
const GEMINI_DIR = path.join(HOME_DIR, '.gemini');
const GEMINI_ENV_FILE = path.join(GEMINI_DIR, '.env');
const GEMINI_SETTINGS_FILE = path.join(GEMINI_DIR, 'settings.json');
const HISTORY_FILE = path.join(GEMINI_DIR, 'webui-history.json');
const MEMORY_FILE = path.join(GEMINI_DIR, 'MEMORY.md');
const PROJECTS_BASE = path.join(HOME_DIR, 'projects');
const QUEUE_FILE = path.join(GEMINI_DIR, 'task-queue.json');
const UPLOADS_DIR = path.join(GEMINI_DIR, 'uploads');
const SESSIONS_INDEX_FILE = path.join(GEMINI_DIR, 'webui-sessions.json');
const SESSIONS_DIR = path.join(GEMINI_DIR, 'sessions');
const BRAIN_DIR = path.join(GEMINI_DIR, 'antigravity-cli/brain');
const PREFS_FILE = path.join(GEMINI_DIR, 'webui-prefs.json');
const AUTO_RESUME_FILE = path.join(GEMINI_DIR, 'auto-resume.json');

let activeChild = null;
let shouldResetSession = false;
const sessionActiveByCwd = {};
const activeRuns = new Map(); // sessionId -> { child, job }
const lastJobs = new Map();   // sessionId -> last job object
const autoResumeMap = new Map(); // sessionId -> recovery/auto-resume state
const autoResumeTimers = new Map(); // sessionId -> Timeout handle

let taskQueue = [];
// คิวงานแยกตามห้องแชท: ทุกรายการมี sessionId, แต่ละห้องรันคิวของตัวเองอิสระ
const queueStarting = new Set(); // sessionId ที่กำลังดึงงานจากคิวขึ้นมารัน (กันเริ่มซ้ำ)

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

// getQueue(sessionId) → คิวเฉพาะห้องนั้น (เรียงลำดับ #1.. ต่อห้อง); ไม่ส่ง sessionId = คิวทุกห้อง
function getQueue(sessionId = null) {
    const items = sessionId ? taskQueue.filter((t) => t.sessionId === sessionId) : taskQueue;
    return items.map((item, idx) => ({ ...item, order: idx + 1 }));
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

async function enqueueTask({ sessionId = null, prompt, images = [], mode = 'exec', cwd = PROJECTS_BASE, model = null }) {
    const cleanImages = Array.isArray(images) ? images : [];
    const cleanPrompt = (prompt || '').trim() || (cleanImages.length > 0 ? 'ช่วยดูและวิเคราะห์รูปภาพที่แนบมานี้หน่อย' : '');
    if (!cleanPrompt) throw new Error('ข้อความคำสั่งว่างเปล่า ไม่สามารถเพิ่มเข้าคิวได้');

    const sid = resolveSessionId(sessionId);
    const sessMeta = getSessionMetaSync(sid);
    const item = {
        id: 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        sessionId: sid,
        prompt: cleanPrompt,
        images: cleanImages,
        mode: mode || 'exec',
        cwd: cwd || PROJECTS_BASE,
        model: model || (sessMeta && sessMeta.model) || getDefaultModel(),
        createdAt: Date.now()
    };

    taskQueue.push(item);
    await saveQueue();

    // ถ้าห้องนี้ว่างอยู่ ให้เริ่มรันงานจากคิวของห้องนี้ทันที (ไม่สนว่าห้องอื่นกำลังรันอยู่หรือไม่)
    if (!activeRuns.has(sid)) {
        setImmediate(() => processNextInQueue(sid));
    }

    return { ok: true, task: item, queue: getQueue(sid) };
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
    return { ok: true, task: taskQueue[idx], queue: getQueue(taskQueue[idx].sessionId) };
}

async function removeQueueTask(id) {
    const task = taskQueue.find(t => t.id === id);
    const sid = task ? task.sessionId : null;
    const prevLen = taskQueue.length;
    taskQueue = taskQueue.filter(t => t.id !== id);
    if (taskQueue.length !== prevLen) {
        await saveQueue();
    }
    return { ok: true, queue: getQueue(sid) };
}

// ล้างคิว: ส่ง sessionId = ล้างเฉพาะห้องนั้น, ไม่ส่ง = ล้างทุกห้อง
async function clearQueue(sessionId = null) {
    if (sessionId) {
        taskQueue = taskQueue.filter(t => t.sessionId !== sessionId);
    } else {
        taskQueue = [];
    }
    await saveQueue();
    return { ok: true, queue: sessionId ? getQueue(sessionId) : [] };
}

// สลับลำดับภายในห้องเดียวกันเท่านั้น
async function reorderQueue(id, direction) {
    const task = taskQueue.find(t => t.id === id);
    if (!task) return { ok: false, error: 'ไม่พบงานในคิว' };
    const sameIdx = [];
    taskQueue.forEach((t, i) => { if (t.sessionId === task.sessionId) sameIdx.push(i); });
    const pos = sameIdx.findIndex(i => taskQueue[i].id === id);
    const tpos = direction === 'up' ? pos - 1 : pos + 1;
    if (tpos < 0 || tpos >= sameIdx.length) return { ok: false, error: 'ไม่สามารถย้ายลำดับได้' };
    const a = sameIdx[pos], b = sameIdx[tpos];
    const temp = taskQueue[a];
    taskQueue[a] = taskQueue[b];
    taskQueue[b] = temp;
    await saveQueue();
    return { ok: true, queue: getQueue(task.sessionId) };
}

// ดึงงานถัดไปจากคิว "ของแต่ละห้อง" ขึ้นมารัน
//  - ห้องที่ว่าง (ไม่มี run ค้างอยู่) และมีงานในคิว จะเริ่มรันได้ทันที โดยไม่รอห้องอื่น
//  - onlySid = จำกัดเฉพาะห้องนั้น, ไม่ส่ง = ไล่ดูทุกห้องที่มีงานค้าง
async function processNextInQueue(onlySid = null) {
    if (taskQueue.length === 0) return;

    // งานเก่าที่ยังไม่มี sessionId (ก่อนอัปเกรด) → ผูกกับห้องล่าสุด
    let legacyFixed = false;
    for (const t of taskQueue) {
        if (!t.sessionId) { t.sessionId = resolveSessionId(null); legacyFixed = true; }
    }
    if (legacyFixed) await saveQueue();

    const sids = [...new Set(taskQueue.map((t) => t.sessionId))];
    for (const sid of sids) {
        if (onlySid && sid !== onlySid) continue;
        if (activeRuns.has(sid) || queueStarting.has(sid)) continue; // ห้องนี้ยังไม่ว่าง
        const idx = taskQueue.findIndex((t) => t.sessionId === sid);
        if (idx === -1) continue;

        queueStarting.add(sid);
        const safetyRelease = setTimeout(() => queueStarting.delete(sid), 20000);
        const nextTask = taskQueue.splice(idx, 1)[0];
        await saveQueue();

        const release = () => { clearTimeout(safetyRelease); queueStarting.delete(sid); };
        try {
            console.log(`[GeminiManager] Running next task from queue [${sid}] (${nextTask.id}): "${nextTask.prompt.substring(0, 45)}..." (Remaining in room: ${getQueue(sid).length}, total: ${taskQueue.length})`);
            executePrompt(
                {
                    sessionId: sid,
                    prompt: nextTask.prompt,
                    images: Array.isArray(nextTask.images) ? nextTask.images : [],
                    mode: nextTask.mode,
                    cwd: nextTask.cwd,
                    model: nextTask.model || getDefaultModel(),
                    resetSession: false
                },
                () => { /* output เก็บอยู่ใน job ของห้องนั้น */ },
                () => { release(); }
            );
        } catch (err) {
            release();
            console.error(`[GeminiManager] Error executing queued task [${sid}]:`, err.message);
            if (/กำลังประมวลผลอยู่/.test(err.message)) {
                // ห้องยังไม่ว่างจริง → คืนงานกลับหัวคิว แล้วรอให้รอบที่จบเรียกต่อเอง
                taskQueue.unshift(nextTask);
                await saveQueue();
            }
            // error อื่น (เช่น ยังไม่ล็อกอิน) → ทิ้งงานนั้น ไม่วนซ้ำไม่รู้จบ; ไปห้องถัดไปต่อ
        }
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

function getLiveThinkingState(sinceMs = 0, agyConversationId = null, brainDir = BRAIN_DIR) {
    try {
        if (!fs.existsSync(brainDir)) return null;
        let targetDir = null;
        if (agyConversationId && fs.existsSync(path.join(brainDir, agyConversationId))) {
            targetDir = path.join(brainDir, agyConversationId);
        } else {
            const subdirs = fs.readdirSync(brainDir)
                .map(d => path.join(brainDir, d))
                .filter(p => {
                    try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
                });
            if (!subdirs.length) return null;
            subdirs.sort((a, b) => {
                try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch (_) { return 0; }
            });
            targetDir = subdirs[0];
        }

        const logsDir = path.join(targetDir, '.system_generated/logs');
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
        const timeline = [];

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
                    timeline.push({ kind: 'think', text: latestThinking, ts: ts || Date.now() });
                }
                if (Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {
                    for (const tc of obj.tool_calls) {
                        const summary = formatToolSummary(tc);
                        if (summary) {
                            currentAction = summary;
                            steps.push(summary);
                            timeline.push({ kind: 'tool', text: summary, ts: ts || Date.now() });
                        }
                    }
                }
            } catch (_) {}
        }

        return {
            thinking: latestThinking || (steps.length ? 'ขั้นตอนที่ทำในรอบนี้:\n' + steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : ''),
            currentAction: currentAction || 'กำลังคิดวิเคราะห์คำสั่ง...',
            steps,
            stepsCount: steps.length,
            timeline: timeline.slice(-120),
            lastStepTime,
            transcriptMtimeMs: stat.mtimeMs || 0,
            transcriptSize: stat.size || 0,
            engine: 'antigravity'
        };
    } catch (_) {
        return null;
    }
}

// ── Linux /proc Process Tree Liveness & 15s Auto-Watchdog Probe ──────────────
function getDirectChildPidsSync(pid) {
    const out = [];
    try {
        const taskDir = `/proc/${pid}/task`;
        if (!fs.existsSync(taskDir)) return out;
        for (const tid of fs.readdirSync(taskDir)) {
            try {
                const raw = fs.readFileSync(`${taskDir}/${tid}/children`, 'utf8').trim();
                if (raw) {
                    for (const tok of raw.split(/\s+/)) {
                        const n = parseInt(tok, 10);
                        if (n > 0) out.push(n);
                    }
                }
            } catch (_) {}
        }
    } catch (_) {}
    return out;
}

function readProcSummarySync(pid) {
    try {
        const statusPath = `/proc/${pid}/status`;
        if (!fs.existsSync(statusPath)) return null;
        const status = fs.readFileSync(statusPath, 'utf8');
        const rssMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
        const stateMatch = status.match(/State:\s+([A-Z])/);
        const nameMatch = status.match(/Name:\s+([^\n]+)/);
        const rssKb = rssMatch ? parseInt(rssMatch[1], 10) : 0;
        const procState = stateMatch ? stateMatch[1] : 'S';
        const comm = nameMatch ? nameMatch[1].trim() : '';
        let cmdLabel = comm;
        try {
            const rawCmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
            const parts = rawCmd.split('\0').filter(Boolean);
            if (parts.length > 0) {
                const bin = path.basename(parts[0]);
                const arg1 = parts[1] && !parts[1].startsWith('-') ? path.basename(parts[1]) : (parts[1] || '');
                cmdLabel = arg1 ? `${bin} ${arg1}`.slice(0, 36) : bin.slice(0, 28);
            }
        } catch (_) {}
        return { pid, rssKb, procState, comm, cmdLabel };
    } catch (_) {
        return null;
    }
}

function inspectProcessTreeSync(rootPid) {
    if (!rootPid || rootPid <= 0) {
        return { pid: null, alive: false, rssMb: 0, procState: 'X', childProcs: [], childCount: 0 };
    }
    const rootInfo = readProcSummarySync(rootPid);
    if (!rootInfo) {
        return { pid: rootPid, alive: false, rssMb: 0, procState: 'X', childProcs: [], childCount: 0 };
    }
    let totalRssKb = rootInfo.rssKb || 0;
    const shellNames = new Set(['sh', 'bash', 'dash', 'zsh']);
    const leafLabels = [];
    const seenPids = new Set([rootPid]);
    const queue = [{ pid: rootPid, depth: 0 }];

    while (queue.length > 0) {
        const { pid, depth } = queue.shift();
        if (depth >= 4) continue;
        const children = getDirectChildPidsSync(pid);
        for (const cpid of children) {
            if (seenPids.has(cpid)) continue;
            seenPids.add(cpid);
            const cinfo = readProcSummarySync(cpid);
            if (!cinfo) continue;
            totalRssKb += cinfo.rssKb || 0;
            const grandChildren = depth < 3 ? getDirectChildPidsSync(cpid) : [];
            if (grandChildren.length > 0) {
                queue.push({ pid: cpid, depth: depth + 1 });
            }
            if (!shellNames.has(cinfo.comm) || grandChildren.length === 0) {
                if (cinfo.cmdLabel && !leafLabels.includes(cinfo.cmdLabel)) {
                    leafLabels.push(cinfo.cmdLabel);
                }
            }
        }
    }

    return {
        pid: rootPid,
        alive: true,
        rssMb: Math.max(1, Math.round(totalRssKb / 1024)),
        procState: rootInfo.procState || 'S',
        childProcs: leafLabels.slice(0, 3),
        childCount: Math.max(0, seenPids.size - 1)
    };
}

function attachLivenessToThought(job, state, rootPid) {
    if (!job || !state || typeof state !== 'object') return state;
    const now = Date.now();
    const tree = inspectProcessTreeSync(rootPid);
    const tlLen = Array.isArray(state.timeline) ? state.timeline.length : 0;
    const thinkLen = state.thinking ? state.thinking.length : 0;
    const outLen = job.output ? job.output.length : 0;
    const action = String(state.currentAction || '').trim();
    const stepsCount = Number(state.stepsCount || 0);

    const sigKey = `${action}|${stepsCount}|${tlLen}|${thinkLen}|${state.transcriptMtimeMs || 0}|${outLen}|${tree.childProcs.join(',')}`;
    if (!job._lastSignalAt || sigKey !== job._lastSigKey) {
        job._lastSigKey = sigKey;
        job._lastSignalAt = now;
    }

    const actionStepKey = `${action}|${stepsCount}`;
    if (!job._stepStartedAt || actionStepKey !== job._lastActionStepKey) {
        job._lastActionStepKey = actionStepKey;
        job._stepStartedAt = now;
    }

    const silentSec = Math.max(0, Math.floor((now - (job._lastSignalAt || now)) / 1000));
    const stepElapsedSec = Math.max(0, Math.floor((now - (job._stepStartedAt || now)) / 1000));
    const totalElapsedSec = Math.max(0, Math.floor((now - (job.startedAt || now)) / 1000));

    let phase = 'llm_think';
    let phaseLabel = '🧠 กำลังรอโมเดลคิดวิเคราะห์...';
    if (!tree.alive && rootPid) {
        phase = 'lost';
        phaseLabel = '🔴 โพรเซสหยุดทำงานแล้ว';
    } else if (tree.childProcs.length > 0) {
        phase = 'child_exec';
        phaseLabel = `⚙️ รอโพรเซสลูก: ${tree.childProcs.join(', ')}`;
    } else if (/^(run_command:|⚙️\s*Bash:)/i.test(action)) {
        phase = 'tool_exec';
        const cleanCmd = action.replace(/^(run_command:|⚙️\s*Bash:)\s*/i, '').slice(0, 62);
        phaseLabel = `🔧 กำลังรันคำสั่ง: ${cleanCmd}`;
    } else if (/^(invoke_subagent|🤖)/i.test(action)) {
        phase = 'subagent';
        phaseLabel = `🤖 กำลังรอ Subagent: ${action.slice(0, 56)}`;
    } else if (action && !/กำลังคิดวิเคราะห์|กำลังเชื่อมต่อ|เชื่อมต่อ.*สำเร็จ/.test(action)) {
        phase = 'tool_exec';
        phaseLabel = `🔧 ใช้เครื่องมือ: ${action.slice(0, 62)}`;
    } else if (outLen > (job._routeBannerLen || 0)) {
        phase = 'streaming';
        phaseLabel = '✍️ กำลังพิมพ์คำตอบส่งกลับ...';
    }

    // Auto-Watchdog Probe Log every 15 seconds of quiet waiting
    if (!Array.isArray(job._probeEvents)) job._probeEvents = [];
    const lastProbeOrSignal = Math.max(job._lastSignalAt || 0, job._lastProbeAt || 0);
    if (silentSec >= 15 && (now - lastProbeOrSignal) >= 15000) {
        job._lastProbeAt = now;
        const childNote = tree.childProcs.length ? ` · child: ${tree.childProcs.join(', ')}` : '';
        const pidNote = rootPid ? `PID ${rootPid} ${tree.alive ? 'ALIVE' : 'LOST'} · ${tree.rssMb}MB${childNote}` : 'Engine active';
        const probeText = `${pidNote} · ${phaseLabel} (รอต่อเนื่อง ${silentSec}s — ระบบยังทำงานปกติ)`;
        job._probeEvents.push({ kind: 'probe', text: probeText, ts: now });
        if (job._probeEvents.length > 24) job._probeEvents.shift();
    }

    if (job._probeEvents.length > 0 && Array.isArray(state.timeline)) {
        const existingProbeTs = new Set(state.timeline.filter(e => e && e.kind === 'probe').map(e => e.ts));
        const merged = [...state.timeline];
        for (const pe of job._probeEvents) {
            if (!existingProbeTs.has(pe.ts)) merged.push(pe);
        }
        merged.sort((a, b) => (a.ts || 0) - (b.ts || 0));
        state.timeline = merged.slice(-140);
    }

    state.liveness = {
        pid: tree.pid,
        alive: tree.alive,
        rssMb: tree.rssMb,
        procState: tree.procState,
        childProcs: tree.childProcs,
        childCount: tree.childCount,
        phase,
        phaseLabel,
        lastSignalAt: job._lastSignalAt || now,
        silentSec,
        stepElapsedSec,
        totalElapsedSec,
        heartbeatAt: now
    };
    return state;
}

function formatClaudeToolSummary(name, input) {
    const args = (input && typeof input === 'object') ? input : {};
    if (name === 'Bash') {
        const desc = args.description || args.command || '';
        return `⚙️ Bash: ${String(desc).replace(/\s+/g, ' ').trim()}`.slice(0, 140);
    }
    if (name === 'Read') return `📖 Read: ${args.file_path || ''}`.slice(0, 140);
    if (name === 'Edit' || name === 'MultiEdit') return `✏️ ${name}: ${args.file_path || ''}`.slice(0, 140);
    if (name === 'Write') return `📝 Write: ${args.file_path || ''}`.slice(0, 140);
    if (name === 'Grep') return `🔍 Grep: ${args.pattern || ''}`.slice(0, 140);
    if (name === 'Glob') return `📁 Glob: ${args.pattern || ''}`.slice(0, 140);
    if (name === 'WebSearch' || name === 'WebFetch') return `🌐 ${name}: ${args.query || args.url || ''}`.slice(0, 140);
    if (name === 'Agent' || name === 'Task') return `🤖 ${name}: ${args.description || ''}`.slice(0, 140);
    const fallbackDetail = args.command || args.path || args.file_path || args.pattern || args.query || '';
    const clean = String(fallbackDetail).replace(/\s+/g, ' ').trim();
    return clean ? `🔧 ${name}: ${clean}`.slice(0, 140) : `🔧 ${name}`;
}

function resolveJobLiveThought(job, sess) {
    if (!job || job.status !== 'running') return null;
    const run = job.sessionId ? activeRuns.get(job.sessionId) : null;
    const pid = (run && run.child && run.child.pid) ? run.child.pid : null;
    if (job.liveThought) {
        return pid ? attachLivenessToThought(job, { ...job.liveThought, timeline: Array.isArray(job.liveThought.timeline) ? [...job.liveThought.timeline] : [] }, pid) : job.liveThought;
    }
    const m = typeof job.model === 'string' ? job.model : '';
    if (m.startsWith('claude-code-') || deepseekAgent.isDeepSeekModel(m)) return null;
    const brainDir = aiRouter.agyBrainDir(aiRouter.getAgyAccount(job.agyAccount || (sess && sess.agyAccount) || 'g1'));
    const activeConvId = (sess && sess.agyConvs && sess.agyConvs[job.agyAccount || sess.agyAccount || 'g1']) || (sess && sess.agyConversationId);
    const state = getLiveThinkingState(job.startedAt || 0, activeConvId, brainDir);
    return (state && pid) ? attachLivenessToThought(job, state, pid) : state;
}

function getSessionBadges() {
    const list = ensureSessionsStoreSync();
    return {
        runningSessionIds: [...activeRuns.keys()],
        unreadSessionIds: list.filter((s) => isSessionUnread(s)).map((s) => s.id)
    };
}

function buildJobModelInfo({ model, account = null, auto = false, team = false, teamSummary = null, attempts = null } = {}) {
    const rawModel = String(model || '').trim();
    let engine = 'agy';
    if (team || rawModel === 'cross-team') engine = 'cross-team';
    else if (rawModel.startsWith('claude-code-')) engine = 'claude-code';
    else if (deepseekAgent.isDeepSeekModel(rawModel)) engine = 'deepseek';
    else if (rawModel === aiRouter.AUTO_MODEL_ID) engine = 'auto';

    let accountLabel = null;
    if (engine === 'agy' && account) {
        try {
            const acc = aiRouter.getAgyAccount(account);
            accountLabel = (acc && acc.label) || String(account);
        } catch (_) {
            accountLabel = String(account);
        }
    } else if (engine === 'claude-code') {
        accountLabel = 'Claude Pro';
    } else if (engine === 'deepseek') {
        accountLabel = 'DeepSeek API';
    }

    const label = rawModel === 'cross-team'
        ? 'Cross-Team AI'
        : (rawModel ? aiRouter.modelLabel(rawModel) : 'AI Assistant');

    const info = {
        model: rawModel || null,
        label,
        engine,
        account: account || null,
        accountLabel,
        auto: Boolean(auto),
        team: Boolean(team)
    };
    if (teamSummary) info.teamSummary = teamSummary;
    if (Array.isArray(attempts) && attempts.length > 1) info.attempts = [...attempts];
    return info;
}

function getActiveJob(sessionId = null) {
    const { runningSessionIds, unreadSessionIds } = getSessionBadges();
    if (sessionId) {
        const run = activeRuns.get(sessionId);
        const job = run ? run.job : (lastJobs.get(sessionId) || { id: null, status: 'idle', sessionId });
        const sess = getSessionMetaSync(sessionId);
        const rec = autoResumeMap.get(sessionId) || null;
        return {
            ...job,
            sessionId,
            activeRunning: !!run,
            runningSessionIds,
            unreadSessionIds,
            queue: getQueue(sessionId),
            liveThought: resolveJobLiveThought(job, sess),
            recovery: rec ? sanitizeRecoveryForClient(rec) : (job.recovery || null)
        };
    }
    const latestSid = runningSessionIds[0] || null;
    const latestRun = latestSid ? activeRuns.get(latestSid) : null;
    const job = latestRun ? latestRun.job : activeJob;
    const sess = latestSid ? getSessionMetaSync(latestSid) : null;
    return {
        ...job,
        sessionId: job.sessionId || latestSid,
        activeRunning: activeRuns.size > 0,
        runningSessionIds,
        unreadSessionIds,
        queue: latestSid ? getQueue(latestSid) : [],
        liveThought: resolveJobLiveThought(job, sess)
    };
}

// ── Multi-Session Conversation Store ─────────────────────────────────────────
let sessionsCache = null;
let sessionsCacheMtime = 0;

function mergeSessionsInPlace(targetList, diskList) {
    if (!Array.isArray(targetList) || !Array.isArray(diskList)) return diskList;
    const byId = new Map(targetList.filter(Boolean).map(s => [s.id, s]));
    const next = [];
    for (const item of diskList) {
        if (!item || typeof item !== 'object') continue;
        const existing = byId.get(item.id);
        if (existing) {
            Object.assign(existing, item);
            next.push(existing);
        } else {
            next.push(item);
        }
    }
    targetList.length = 0;
    targetList.push(...next);
    return targetList;
}

function ensureSessionsStoreSync() {
    try {
        if (fs.existsSync(SESSIONS_INDEX_FILE)) {
            const stat = fs.statSync(SESSIONS_INDEX_FILE);
            if (sessionsCache && stat.mtimeMs <= sessionsCacheMtime) {
                return sessionsCache;
            }
            const parsed = JSON.parse(fs.readFileSync(SESSIONS_INDEX_FILE, 'utf8'));
            if (Array.isArray(parsed)) {
                sessionsCache = sessionsCache ? mergeSessionsInPlace(sessionsCache, parsed) : parsed;
                sessionsCacheMtime = stat.mtimeMs;
                return sessionsCache;
            }
        }
    } catch (_) {}
    if (sessionsCache) return sessionsCache;
    try {
        fs.mkdirSync(GEMINI_DIR, { recursive: true });
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        if (fs.existsSync(SESSIONS_INDEX_FILE)) {
            const stat = fs.statSync(SESSIONS_INDEX_FILE);
            const parsed = JSON.parse(fs.readFileSync(SESSIONS_INDEX_FILE, 'utf8'));
            if (Array.isArray(parsed)) {
                sessionsCache = parsed;
                sessionsCacheMtime = stat.mtimeMs;
                return sessionsCache;
            }
        }
        // Migrate legacy webui-history.json into initial session if present
        let legacyMsgs = [];
        if (fs.existsSync(HISTORY_FILE)) {
            try {
                const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
                if (Array.isArray(raw)) legacyMsgs = raw;
            } catch (_) {}
        }
        const firstUser = legacyMsgs.find(m => m && m.role === 'user' && m.content);
        const title = firstUser ? String(firstUser.content).replace(/\s+/g, ' ').trim().slice(0, 48) : 'แชทเริ่มต้น';
        const now = Date.now();
        const defSess = {
            id: 'sess_default',
            title: title || 'แชทเริ่มต้น',
            model: 'gemini-4-hydrogen-high',
            cwd: PROJECTS_BASE,
            mode: 'exec',
            agyConversationId: null,
            messageCount: legacyMsgs.length,
            lastMessage: legacyMsgs.length ? String(legacyMsgs[legacyMsgs.length - 1].content || '').slice(0, 80) : '',
            createdAt: now,
            updatedAt: now
        };
        sessionsCache = [defSess];
        fs.writeFileSync(path.join(SESSIONS_DIR, 'sess_default.json'), JSON.stringify(legacyMsgs, null, 2), 'utf8');
        fs.writeFileSync(SESSIONS_INDEX_FILE, JSON.stringify(sessionsCache, null, 2), 'utf8');
        try { sessionsCacheMtime = fs.statSync(SESSIONS_INDEX_FILE).mtimeMs; } catch (_) { sessionsCacheMtime = Date.now(); }
        return sessionsCache;
    } catch (_) {
        sessionsCache = [];
        return sessionsCache;
    }
}

function saveSessionsIndexSync() {
    try {
        fs.mkdirSync(GEMINI_DIR, { recursive: true });
        fs.writeFileSync(SESSIONS_INDEX_FILE, JSON.stringify(sessionsCache || [], null, 2), 'utf8');
        try {
            sessionsCacheMtime = fs.statSync(SESSIONS_INDEX_FILE).mtimeMs;
        } catch (_) {
            sessionsCacheMtime = Date.now();
        }
    } catch (e) {
        console.error('[GeminiManager] saveSessionsIndexSync error:', e.message);
    }
}

function getPriorSessionMessages(sessionId, currentPrompt = '') {
    try {
        const hist = loadSessionMessagesSync(sessionId);
        if (!Array.isArray(hist) || hist.length === 0) return [];
        const cleanCur = String(currentPrompt || '').trim();
        const last = hist[hist.length - 1];
        const rawPrior = (last && last.role === 'user' && String(last.content || '').trim() === cleanCur)
            ? hist.slice(0, -1)
            : hist.slice();
        return rawPrior.filter((m) => {
            if (!m || !m.content) return false;
            const txt = String(m.content).trim();
            if (!txt) return false;
            if (m.role === 'assistant' && (/^พร้อมเริ่มบทสนทนาใหม่แล้วครับ/.test(txt) || /^ประวัติการคุยถูกล้างเรียบร้อย/.test(txt))) {
                return false;
            }
            return true;
        });
    } catch (_) {
        return [];
    }
}

function formatSessionHistoryBridge(priorMessages, { maxMessages = 14, maxCharsPerMsg = 3500, maxTotalChars = 20000 } = {}) {
    if (!Array.isArray(priorMessages) || priorMessages.length === 0) return '';
    const recent = priorMessages.slice(-maxMessages);
    const lines = [];
    let totalChars = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
        const m = recent[i];
        const role = m.role === 'user' ? 'User' : 'Assistant';
        let txt = String(m.content || '').trim();
        // Strip auto-router banner header from assistant messages so context stays clean and dense
        if (m.role === 'assistant') {
            txt = txt.replace(/^>\s*🧠\s*Auto[^\n]*\n+/i, '').trim();
        }
        if (!txt) continue;
        if (txt.length > maxCharsPerMsg) {
            txt = txt.slice(0, maxCharsPerMsg) + '\n...[ตัดทอนบางส่วน]...';
        }
        const entry = `${role}: ${txt}`;
        if (totalChars + entry.length > maxTotalChars && lines.length >= 2) break;
        lines.unshift(entry);
        totalChars += entry.length;
    }
    if (lines.length === 0) return '';
    return `[บริบทประวัติการสนทนาในห้องแชทนี้ (อ่านให้ครบถ้วนก่อนตอบเพื่อความต่อเนื่องของบทสนทนา):\n${lines.join('\n---\n')}\n]`;
}

function getSessionMetaSync(sessionId) {
    const list = ensureSessionsStoreSync();
    return list.find(s => s.id === sessionId) || null;
}

function loadSessionMessagesSync(sessionId) {
    ensureSessionsStoreSync();
    const file = path.join(SESSIONS_DIR, `${path.basename(sessionId)}.json`);
    try {
        if (!fs.existsSync(file)) return [];
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch (_) {
        return [];
    }
}

function scheduleAutoTitling(sessionId, userPrompt) {
    if (!sessionId || !userPrompt || typeof userPrompt !== 'string') return;
    const cleanPrompt = userPrompt.replace(/\s+/g, ' ').trim();
    if (!cleanPrompt || cleanPrompt.length < 3) return;

    setImmediate(() => {
        const acc = aiRouter.getAgyAccount('g1');
        if (!acc || !acc.ready || !fs.existsSync(AGY_BIN)) return;
        const promptText = `สรุปเนื้อหาข้อความต่อไปนี้ให้เป็นชื่อหัวข้อแชทภาษาไทยที่กระชับ ชัดเจน ตรงประเด็น (ความยาว 4-8 คำ) พร้อมใส่อีโมจิที่เข้ากับเนื้อหา 1 ตัวข้างหน้าสุด ห้ามใส่เครื่องหมายคำพูด ห้ามมีคำอธิบายอื่น ให้ตอบเฉพาะชื่อหัวข้อเท่านั้น:\n\n${cleanPrompt.slice(0, 400)}`;
        const args = ['-p', promptText, '--model', 'gemini-3.8-flash-low', '--disable-slash-commands', '--print-timeout', '15s'];
        execFile(AGY_BIN, args, { timeout: 20000, env: { ...process.env, HOME: acc.home, FORCE_COLOR: '0' } }, (err, stdout) => {
            if (err || !stdout) return;
            const lines = stdout.trim().replace(/["']/g, '').split('\n').map(l => l.trim()).filter(Boolean);
            const title = lines[0];
            if (title && title.length >= 4 && title.length <= 80) {
                const meta = getSessionMetaSync(sessionId);
                if (meta) {
                    meta.title = title;
                    meta.autoTitled = true;
                    saveSessionsIndexSync();
                    console.log(`[GeminiManager] Auto-titled session ${sessionId}: "${title}"`);
                }
            }
        });
    });
}

function saveSessionMessagesSync(sessionId, messages) {
    ensureSessionsStoreSync();
    const slice = (messages || []).slice(-80);
    const file = path.join(SESSIONS_DIR, `${path.basename(sessionId)}.json`);
    try {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(slice, null, 2), 'utf8');
        const meta = getSessionMetaSync(sessionId);
        if (meta) {
            meta.messageCount = slice.length;
            meta.lastMessage = slice.length ? String(slice[slice.length - 1].content || '').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
            meta.updatedAt = Date.now();
            if ((!meta.title || meta.title === 'แชทใหม่' || meta.title === 'New Chat' || !meta.autoTitled) && slice.length > 0) {
                const firstUser = slice.find(m => m && m.role === 'user' && m.content);
                if (firstUser) {
                    if (!meta.title || meta.title === 'แชทใหม่' || meta.title === 'New Chat') {
                        meta.title = String(firstUser.content).replace(/\s+/g, ' ').trim().slice(0, 60);
                    }
                    if (!meta.autoTitled) {
                        meta.autoTitled = true;
                        scheduleAutoTitling(sessionId, firstUser.content);
                    }
                }
            }
            saveSessionsIndexSync();
        }
        return true;
    } catch (_) {
        return false;
    }
}

function isSessionUnread(sess) {
    if (!sess || !sess.id) return false;
    if (activeRuns.has(sess.id)) return false;
    const completedAt = Number(sess.lastCompletedAt || 0);
    const viewedAt = Number(sess.lastViewedAt || 0);
    return completedAt > 0 && completedAt > viewedAt;
}

function decorateSession(sess) {
    return {
        ...sess,
        pinned: Boolean(sess.pinned),
        running: activeRuns.has(sess.id),
        unread: isSessionUnread(sess),
        lastCompletedAt: sess.lastCompletedAt || null,
        lastCompletedStatus: sess.lastCompletedStatus || null
    };
}

function markSessionCompletedSync(sessionId, { finishedAt = Date.now(), status = 'completed' } = {}) {
    const sess = getSessionMetaSync(sessionId);
    if (!sess) return;
    const ts = Number(finishedAt) || Date.now();
    sess.lastCompletedAt = Math.max(ts, Number(sess.lastCompletedAt || 0));
    sess.lastCompletedStatus = status || 'completed';
    saveSessionsIndexSync();
}

function markSessionRead(sessionId, read = true) {
    const sess = getSessionMetaSync(sessionId);
    if (!sess) throw new Error('ไม่พบ Session นี้');
    if (read) {
        sess.lastViewedAt = Math.max(Date.now(), Number(sess.lastCompletedAt || 0));
    } else {
        sess.lastViewedAt = 0;
        if (!sess.lastCompletedAt) {
            sess.lastCompletedAt = sess.updatedAt || Date.now();
        }
    }
    saveSessionsIndexSync();
    const listed = listSessions();
    return {
        ok: true,
        session: decorateSession(sess),
        sessions: listed.sessions,
        runningSessionIds: listed.runningSessionIds,
        unreadSessionIds: listed.unreadSessionIds
    };
}

function markAllSessionsRead() {
    const list = ensureSessionsStoreSync();
    const now = Date.now();
    let changed = false;
    for (const sess of list) {
        if (!sess || !sess.id) continue;
        if (isSessionUnread(sess)) {
            sess.lastViewedAt = Math.max(now, Number(sess.lastCompletedAt || 0));
            changed = true;
        }
    }
    if (changed) saveSessionsIndexSync();
    const listed = listSessions();
    return {
        ok: true,
        sessions: listed.sessions,
        runningSessionIds: listed.runningSessionIds,
        unreadSessionIds: listed.unreadSessionIds
    };
}

function listSessions() {
    const list = ensureSessionsStoreSync();
    const sorted = [...list].sort((a, b) => {
        const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        if (pinDiff !== 0) return pinDiff;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    const decorated = sorted.map(decorateSession);
    return {
        ok: true,
        runningSessionIds: [...activeRuns.keys()],
        unreadSessionIds: decorated.filter((s) => s.unread).map((s) => s.id),
        sessions: decorated
    };
}

// ── Default model for every NEW chat (server-side, shared across devices) ──
// Default = 'auto' (🧠 สมองกลางเลือกโมเดลให้) unless user picked another in Settings.
function readPrefs() {
    try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) || {}; } catch (_) { return {}; }
}
function getDefaultModel() {
    const m = String(readPrefs().defaultModel || '').trim();
    return m || aiRouter.AUTO_MODEL_ID;
}
function setDefaultModel(modelId) {
    const id = String(modelId || '').trim();
    if (!/^[A-Za-z0-9._:\/-]{1,80}$/.test(id)) return { ok: false, error: 'invalid model id' };
    const prefs = readPrefs();
    prefs.defaultModel = id;
    prefs.updatedAt = Date.now();
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), { mode: 0o600 });
    return { ok: true, defaultModel: id };
}

function createSession({ title = 'แชทใหม่', model = null, cwd = PROJECTS_BASE, mode = 'exec' } = {}) {
    const list = ensureSessionsStoreSync();
    const id = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = Date.now();
    const sess = {
        id,
        title: String(title || 'แชทใหม่').trim().slice(0, 60) || 'แชทใหม่',
        model: model || getDefaultModel(),
        cwd: cwd || PROJECTS_BASE,
        mode: mode || 'exec',
        pinned: false,
        agyConversationId: null,
        messageCount: 0,
        lastMessage: '',
        createdAt: now,
        updatedAt: now
    };
    list.unshift(sess);
    saveSessionMessagesSync(id, []);
    saveSessionsIndexSync();
    return { ok: true, session: decorateSession(sess) };
}

function getSession(sessionId) {
    const list = ensureSessionsStoreSync();
    let sess = getSessionMetaSync(sessionId);
    if (!sess && list.length > 0) {
        sess = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    }
    if (!sess) {
        sess = createSession().session;
    }
    const messages = loadSessionMessagesSync(sess.id);
    return {
        ok: true,
        session: decorateSession(sess),
        messages,
        job: getActiveJob(sess.id)
    };
}

function renameSession(sessionId, title) {
    const sess = getSessionMetaSync(sessionId);
    if (!sess) throw new Error('ไม่พบ Session นี้');
    const clean = String(title || '').trim().slice(0, 80);
    if (!clean) throw new Error('ชื่อแชทต้องไม่ว่างเปล่า');
    sess.title = clean;
    sess.updatedAt = Date.now();
    saveSessionsIndexSync();
    return { ok: true, session: decorateSession(sess) };
}

function togglePinSession(sessionId, pinned) {
    const sess = getSessionMetaSync(sessionId);
    if (!sess) throw new Error('ไม่พบ Session นี้');
    sess.pinned = typeof pinned === 'boolean' ? pinned : !Boolean(sess.pinned);
    sess.pinnedAt = sess.pinned ? Date.now() : null;
    saveSessionsIndexSync();
    const listed = listSessions();
    return {
        ok: true,
        session: decorateSession(sess),
        sessions: listed.sessions,
        runningSessionIds: listed.runningSessionIds,
        unreadSessionIds: listed.unreadSessionIds
    };
}

function deleteSession(sessionId) {
    const list = ensureSessionsStoreSync();
    const idx = list.findIndex(s => s.id === sessionId);
    if (idx === -1) throw new Error('ไม่พบ Session นี้');
    if (activeRuns.has(sessionId)) {
        abortActive(sessionId);
    }
    lastJobs.delete(sessionId);
    clearRecoveryForSession(sessionId);
    if (taskQueue.some((t) => t.sessionId === sessionId)) {
        taskQueue = taskQueue.filter((t) => t.sessionId !== sessionId);
        saveQueue();
    }
    list.splice(idx, 1);
    const file = path.join(SESSIONS_DIR, `${path.basename(sessionId)}.json`);
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
    if (list.length === 0) {
        createSession();
    } else {
        saveSessionsIndexSync();
    }
    try {
        require('./browser-vision-bridge').closeChatBrowser(sessionId);
    } catch (_) {}
    const listed = listSessions();
    return {
        ok: true,
        sessions: listed.sessions,
        runningSessionIds: listed.runningSessionIds,
        unreadSessionIds: listed.unreadSessionIds
    };
}

function resolveSessionId(sessionId) {
    const list = ensureSessionsStoreSync();
    if (sessionId && getSessionMetaSync(sessionId)) return sessionId;
    if (list.length > 0) {
        const sorted = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return sorted[0].id;
    }
    return createSession().session.id;
}

async function persistJobToHistory(job) {
    if (!job || !job.prompt) return;
    const promptText = (job.prompt || '').trim();
    const outputText = (job.output || '').trim();
    if (!promptText && !outputText) return;

    try {
        const sid = resolveSessionId(job.sessionId);
        const history = loadSessionMessagesSync(sid);
        const last = history[history.length - 1];
        const secondLast = history[history.length - 2];

        const startTs = job.startedAt || Date.now();
        const finishTs = job.finishedAt || Date.now();
        const durationMs = Math.max(0, finishTs - startTs);
        const assistantFields = {
            role: 'assistant',
            content: outputText || (job.error ? `❌ ${job.error}` : '[ไม่มีผลลัพธ์จากคำสั่ง]'),
            timestamp: finishTs,
            durationMs
        };
        if (job.modelInfo) assistantFields.modelInfo = job.modelInfo;
        if (job.tokenUsage) assistantFields.tokenUsage = job.tokenUsage;

        if (secondLast && secondLast.role === 'user' && secondLast.content === promptText && last && last.role === 'assistant') {
            if (!secondLast.timestamp) secondLast.timestamp = startTs;
            last.content = assistantFields.content;
            last.timestamp = finishTs;
            last.durationMs = durationMs;
            if (assistantFields.modelInfo) last.modelInfo = assistantFields.modelInfo;
            if (assistantFields.tokenUsage) last.tokenUsage = assistantFields.tokenUsage;
        } else if (last && last.role === 'user' && last.content === promptText) {
            if (!last.timestamp) last.timestamp = startTs;
            history.push(assistantFields);
        } else {
            history.push({ role: 'user', content: promptText, timestamp: startTs });
            history.push(assistantFields);
        }
        saveSessionMessagesSync(sid, history);
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

    if (process.env.GEMINI_NO_QUEUE_AUTORUN !== '1' && taskQueue.length > 0) {
        console.log(`[GeminiManager] Restoring ${taskQueue.length} pending queued task(s) from disk...`);
        setTimeout(() => {
            processNextInQueue();
        }, 3000);
    }

    loadAutoResumeStoreSync();
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
    let oauthEmail = '';
    let models = [];

    const agyAccounts = aiRouter.listAgyAccounts().map(({ id, label, email, ready, profile }) => ({ id, label, email, ready, profile }));
    const readyAccounts = aiRouter.listAgyAccounts().filter((a) => a.ready);
    const primaryAcc = readyAccounts[0] || null;

    // 1. Check Antigravity CLI (Primary Engine — uses first ready Google account, with crash heal)
    if (fs.existsSync(AGY_BIN) && primaryAcc) {
        try {
            const runAgyProbe = (args, timeout = 8000) => new Promise((resolve) => {
                execFile(AGY_BIN, args, { timeout, env: { ...process.env, HOME: primaryAcc.home, FORCE_COLOR: '0' } }, (err, stdout, stderr) => {
                    resolve({ ok: !err, stdout: String(stdout || '').trim(), stderr: String(stderr || '') });
                });
            });
            let verRes = await runAgyProbe(['--version'], 6000);
            if (!verRes.ok && aiRouter.isBinaryCrash(verRes.stderr)) {
                await aiRouter.healBinaryCache(AGY_BIN);
                verRes = await runAgyProbe(['--version'], 6000);
            }
            if (verRes.ok && verRes.stdout) {
                let modRes = await runAgyProbe(['models'], 8000);
                if (!modRes.ok && aiRouter.isBinaryCrash(modRes.stderr)) {
                    await aiRouter.healBinaryCache(AGY_BIN);
                    modRes = await runAgyProbe(['models'], 8000);
                }
                const modelsOut = modRes.ok ? modRes.stdout : '';
                if (modelsOut && !modelsOut.includes('Please sign in')) {
                    installed = true;
                    version = verRes.stdout;
                    binPath = AGY_BIN;
                    engine = 'antigravity';
                    engineLabel = 'Google Antigravity Core (agy)';
                    hasAuth = true;
                    authType = 'antigravity-oauth';
                    oauthEmail = primaryAcc.email || 'asri.utcc@gmail.com';
                    authLabel = `Google Account (${primaryAcc.label} · ${oauthEmail})`;

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
            models = [
                { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
                { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
            ];
        }
    }

    const hasDeepSeek = !!deepseekAgent.getApiKey();
    if (hasDeepSeek) {
        const existingIds = new Set(models.map((m) => m.id));
        for (const dm of deepseekAgent.DEEPSEEK_MODELS) {
            if (!existingIds.has(dm.id)) models.push(dm);
        }
    }

    const claudeAvail = getClaudeCodeAvailability();
    const hasClaudeCode = claudeAvail.ready;
    if (hasClaudeCode) {
        const existingIds = new Set(models.map((m) => m.id));
        for (const cm of CLAUDE_CODE_MODELS) {
            if (!existingIds.has(cm.id)) models.push(cm);
        }
    }

    if (models.length > 0) {
        models.unshift({ id: aiRouter.AUTO_MODEL_ID, name: '🧠 Auto · สมองกลางเลือกให้' });
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
        hasDeepSeek,
        hasClaudeCode,
        claudeCodeReady: hasClaudeCode,
        claudeCodeReason: claudeAvail.reason || null,
        readyAccountsCount: readyAccounts.length,
        hasOAuth: hasAuth,
        oauthEmail: oauthEmail || (primaryAcc && primaryAcc.email) || '',
        authType,
        authLabel,
        hasAuth,
        projectsBase: PROJECTS_BASE,
        projects,
        activeRunning: activeChild !== null,
        agyAccounts,
        defaultModel: getDefaultModel(),
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

// ── 🧠 Auto model: route via ai-router, then run with failover ───────────────
const AUTO_MAX_ATTEMPTS = 8;

function executeAuto(params, onChunk, onDone) {
    const sid = resolveSessionId(params.sessionId);
    if (activeRuns.has(sid)) {
        throw new Error('แชทนี้กำลังประมวลผลอยู่ กรุณารอสักครู่หรือกด "➕ แชทใหม่" เพื่อคุยอีกห้องพร้อมกัน');
    }
    const jobId = params.jobId || ('job_' + Date.now());
    const images = Array.isArray(params.images) ? params.images : [];

    // Placeholder job while the router classifies (keeps the room busy & pollable)
    const placeholder = {
        id: jobId,
        sessionId: sid,
        status: 'running',
        prompt: params.prompt,
        images,
        output: '',
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
        exitCode: null,
        mode: params.mode,
        cwd: params.cwd,
        model: aiRouter.AUTO_MODEL_ID,
        liveThought: { currentAction: '🧠 สมองกลางกำลังวิเคราะห์งาน...', thinking: '', steps: [], stepsCount: 0, timeline: [] }
    };
    let aborted = false;
    let innerHandle = null;
    let finished = false;
    let routedDecision = null;   // ผลการจัดเส้นทาง (ใช้บันทึกผลจริงเทียบกับที่ทำนาย)
    let observedSteps = 0;       // จำนวนขั้นตอน/เครื่องมือที่ใช้จริง (สูงสุดของทุกความพยายาม)
    const abort = () => {
        aborted = true;
        if (innerHandle) innerHandle.abort();
        else finish(130, 'aborted', placeholder);
    };
    activeRuns.set(sid, { abort, job: placeholder });
    lastJobs.set(sid, placeholder);
    try { onChunk('thought', placeholder.liveThought); } catch (_) {}

    const finish = async (code, err, job) => {
        if (finished) return;
        finished = true;
        if (job === placeholder) {
            activeRuns.delete(sid);
            placeholder.status = code === 130 ? 'aborted' : 'error';
            placeholder.error = err;
            placeholder.finishedAt = Date.now();
            placeholder.liveThought = null;
        }
        const meta = getSessionMetaSync(sid);
        if (meta) {
            meta.model = aiRouter.AUTO_MODEL_ID;
            saveSessionsIndexSync();
        }
        if (code !== 0 && code !== 130 && !aborted && !(job && job.status === 'aborted')) {
            try {
                await finalizeFailedJobRecovery(job || placeholder, {
                    isAuto: true,
                    stderrTail: (job && job._stderrTail) || ''
                });
            } catch (e) {
                console.error('[GeminiManager] finalizeFailedJobRecovery(auto) error:', e.message);
            }
        }
        const isUserAborted = aborted || code === 130 || Boolean(job && job.status === 'aborted');
        if (!isUserAborted) {
            markSessionCompletedSync(sid, {
                finishedAt: (job && job.finishedAt) || placeholder.finishedAt || Date.now(),
                status: code === 0 ? 'completed' : 'error'
            });
        }
        persistJobToHistory({ ...job }).catch((e) => {
            console.error('[GeminiManager] Failed to persist auto job:', e.message);
        });
        if (routedDecision) {
            try {
                aiRouter.noteOutcome({
                    sessionId: sid,
                    decision: routedDecision,
                    steps: observedSteps,
                    durationMs: Date.now() - placeholder.startedAt,
                    ok: code === 0,
                    // ผู้ใช้สั่งหยุด = ไม่นับเป็นความยากที่สังเกตได้ (เช็กทั้ง flag, รหัสออก และสถานะงาน — กระบวนการที่ถูก kill ไม่ได้คืน 130 เสมอไป)
                    aborted: aborted || code === 130 || Boolean(job && job.status === 'aborted'),
                    model: job && job.model,
                    account: job && job.agyAccount,
                    team: Boolean(routedDecision.teamPlan && routedDecision.teamPlan.enabled)
                });
            } catch (e) {
                console.error('[GeminiManager] noteOutcome failed:', e.message);
            }
        }
        onDone(code, err);
        setTimeout(() => { processNextInQueue(); }, 600);
    };

    (async () => {
        let decision;
        try {
            const meta0 = getSessionMetaSync(sid);
            // บริบทแชทให้ตัวประเมินความยาก (ตัดข้อความปัจจุบันที่อาจถูกบันทึกไว้ก่อนแล้วออก)
            let routeHistory = [];
            try {
                routeHistory = loadSessionMessagesSync(sid);
                const lastMsg = routeHistory[routeHistory.length - 1];
                if (lastMsg && lastMsg.role === 'user' && lastMsg.content === params.prompt) routeHistory = routeHistory.slice(0, -1);
            } catch (_) {}
            decision = await aiRouter.routeTask({
                prompt: params.prompt,
                hasImages: images.length > 0,
                source: 'chat',
                sessionAccount: (meta0 && meta0.agyAccount) || null,
                sessionId: sid,
                history: routeHistory
            });
            routedDecision = decision;
        } catch (err) {
            decision = { ok: false, candidates: [], error: err.message };
        }
        if (aborted) return;
        if (!decision.ok || !decision.candidates.length) {
            placeholder.output = '❌ สมองกลางหาโมเดลที่ใช้ได้ไม่เจอในขณะนี้ (ทุกบัญชี Google / Claude Pro / DeepSeek ไม่พร้อมใช้งานหรือโควตา/เครดิตหมด)';
            onChunk('stdout', placeholder.output);
            return finish(1, decision.error || 'no candidates', placeholder);
        }

        const tried = [];
        const deadGroups = new Set();
        let healed = false;
        const nextIndex = (from) => {
            for (let i = from; i < decision.candidates.length; i++) {
                const cand = decision.candidates[i];
                if (!deadGroups.has(aiRouter.failureGroup(cand, false)) && !deadGroups.has(aiRouter.failureGroup(cand, true))) return i;
            }
            return -1;
        };
        const runAttempt = (idx, note) => {
            const c = decision.candidates[idx];
            tried.push(`${c.model}@${c.account}`);
            const banner = aiRouter.formatBanner(decision, c, note);
            let maxSteps = 0;
            let stderrTail = '';
            if (activeRuns.get(sid) && activeRuns.get(sid).job === placeholder) activeRuns.delete(sid);
            try {
                innerHandle = executePrompt({
                    ...params,
                    jobId,
                    model: c.model,
                    agyAccount: c.engine === 'agy' ? c.account : null,
                    routeBanner: banner,
                    routerDirective: aiRouter.directiveFor(decision, c),
                    deferPersist: true,
                    isAuto: true,
                    attempts: [...tried]
                }, (type, payload) => {
                    if (type === 'meta' && payload && typeof payload === 'object') {
                        if (payload.modelInfo) placeholder.modelInfo = payload.modelInfo;
                        if (payload.tokenUsage) placeholder.tokenUsage = payload.tokenUsage;
                    }
                    if (type === 'thought' && payload && typeof payload === 'object') {
                        maxSteps = Math.max(maxSteps, payload.stepsCount || 0);
                        observedSteps = Math.max(observedSteps, maxSteps);
                    }
                    if (type === 'stderr') {
                        stderrTail = (stderrTail + String(payload || '')).slice(-4000);
                        // Suppress raw CLI stderr/crash dumps (Bun/Go) in chat bubbles; deepseek warnings still stream
                        if (c.engine !== 'deepseek') return;
                    }
                    onChunk(type, payload);
                }, (code, err) => {
                    const job = lastJobs.get(sid);
                    const body = job ? String(job.output || '').slice(banner.length) : '';
                    const failed = code !== 0 && code !== 130 && !(job && job.status === 'aborted');
                    const crashed = failed && aiRouter.isBinaryCrash(stderrTail);
                    const errText = crashed ? aiRouter.summarizeCrashError(stderrTail, c.engine, err) : String(err || body);
                    const canSwitch = failed && !aborted && maxSteps === 0 && tried.length < AUTO_MAX_ATTEMPTS;

                    // agy / claude-code crashed at startup → bit-flipped page cache: evict once and retry the same model
                    if (canSwitch && crashed && (c.engine === 'agy' || c.engine === 'claude-code') && !healed) {
                        healed = true;
                        const binFile = c.engine === 'claude-code' ? CLAUDE_BIN : aiRouter.AGY_BIN;
                        aiRouter.logDecision({ source: 'chat', prompt: params.prompt, decision, event: 'crash-heal', extra: { from: tried[tried.length - 1], bin: binFile, stderr: stderrTail.slice(0, 300) } });
                        onChunk('stdout', `\n\n> 🩹 ${c.label} แครชตอนเปิดโปรแกรม (ไฟล์ใน RAM cache เสีย) — ล้าง cache แล้ว กำลังลองใหม่...\n\n`);
                        return aiRouter.healBinaryCache(binFile).then(() => runAttempt(idx, `ลองใหม่หลังล้าง cache`));
                    }
                    if (failed && !aborted && maxSteps === 0) {
                        aiRouter.recordFailure(c, { crashed, errorText: errText, outputText: body, stderrText: stderrTail });
                    }
                    if (canSwitch && (crashed || aiRouter.isRetryableFailure(err, body, stderrTail))) {
                        deadGroups.add(aiRouter.failureGroup(c, crashed));
                        const next = nextIndex(idx + 1);
                        if (next !== -1) {
                            aiRouter.logDecision({ source: 'chat', prompt: params.prompt, decision, event: 'failover', extra: { from: tried[tried.length - 1], error: errText.slice(0, 200), crashed } });
                            const nc = decision.candidates[next];
                            onChunk('stdout', `\n\n> ⚠️ ${c.label} · ${c.accountLabel} ใช้ไม่ได้ (${errText.slice(0, 80)}) — สลับไป ${nc.label} · ${nc.accountLabel}\n\n`);
                            return runAttempt(next, `สลับจาก ${c.label} (${c.accountLabel})`);
                        }
                    }
                    if (failed && maxSteps > 0 && job) {
                        const msg = `\n\n> ⚠️ ${c.label} หยุดกลางทางหลังใช้เครื่องมือไปแล้ว ${maxSteps} ขั้น — ไม่สลับโมเดลให้อัตโนมัติ เพื่อกันการแก้ไฟล์ซ้ำ กรุณาตรวจผลแล้วสั่งต่อ`;
                        job.output += msg;
                        onChunk('stdout', msg);
                    }
                    if (failed && job && !body.trim()) {
                        job.output += `❌ ${errText}${tried.length > 1 ? ` (ลองแล้ว ${tried.length} ตัว: ${tried.join(', ')})` : ''}`;
                    }
                    finish(code, err, job || placeholder);
                });
            } catch (err) {
                aiRouter.recordFailure(c, { crashed: true, errorText: err.message });
                deadGroups.add(aiRouter.failureGroup(c, true));
                const next = nextIndex(idx + 1);
                if (next !== -1 && tried.length < AUTO_MAX_ATTEMPTS) {
                    return runAttempt(next, `สลับจาก ${c.label} (${err.message.slice(0, 60)})`);
                }
                finish(1, err.message, lastJobs.get(sid) || placeholder);
            }
        };

        // 🤝 Cross-Provider Multi-Agent Pipeline (Architect Opus/Neon → Workers Gemini G1+G2 → Reviewer Opus/Neon)
        if (decision.teamPlan && decision.teamPlan.enabled) {
            let safeCwd = PROJECTS_BASE;
            if (params.cwd && fs.existsSync(params.cwd)) {
                safeCwd = params.cwd;
            } else if (params.cwd && fs.existsSync(path.join(PROJECTS_BASE, params.cwd))) {
                safeCwd = path.join(PROJECTS_BASE, params.cwd);
            }
            const imagePaths = images
                .map((img) => (typeof img === 'string' ? img : img && img.path))
                .filter((p) => p && fs.existsSync(p));

            // Pre-save user prompt and snapshot prior history before Stage 1
            let priorHistory = [];
            try {
                const hist = loadSessionMessagesSync(sid);
                const last = hist[hist.length - 1];
                if (!last || last.role !== 'user' || last.content !== params.prompt) {
                    priorHistory = hist.slice(-6);
                    const entry = { role: 'user', content: params.prompt, timestamp: placeholder.startedAt };
                    if (images.length > 0) entry.images = images;
                    hist.push(entry);
                    saveSessionMessagesSync(sid, hist);
                } else {
                    priorHistory = hist.slice(0, -1).slice(-6);
                }
            } catch (e) {
                console.error('[GeminiManager] Failed to pre-save cross-team prompt:', e.message);
            }

            const sessMeta = getSessionMetaSync(sid);
            if (sessMeta) {
                sessMeta.cwd = safeCwd;
                sessMeta.mode = params.mode || sessMeta.mode;
                if (params.resetSession) {
                    sessMeta.agyConversationId = null;
                    sessMeta.agyConvs = {};
                    sessMeta.agySyncedCount = {};
                    sessMeta.claudeSessionId = null;
                    sessMeta.claudeSyncedCount = 0;
                    priorHistory = [];
                }
                sessMeta.needsAgyBridge = true;
                sessMeta.needsClaudeBridge = true;
                saveSessionsIndexSync();
            }

            const teamJob = {
                id: jobId,
                sessionId: sid,
                status: 'running',
                prompt: params.prompt,
                images,
                output: '',
                startedAt: placeholder.startedAt,
                finishedAt: null,
                error: null,
                exitCode: null,
                mode: params.mode || 'exec',
                cwd: safeCwd,
                model: aiRouter.AUTO_MODEL_ID,
                liveThought: placeholder.liveThought
            };
            activeJob = teamJob;
            lastJobs.set(sid, teamJob);

            const teamPrompt = buildBrowserVisionPrompt(params.prompt, sid, params.browserVision);
            const teamHandle = crossTeam.runCrossTeamPipeline({
                decision,
                prompt: teamPrompt,
                imagePaths,
                mode: params.mode || 'exec',
                cwd: safeCwd,
                history: priorHistory,
                job: teamJob,
                onChunk,
                onDone: (code, err, meta) => {
                    activeRuns.delete(sid);
                    teamJob.liveThought = null;
                    teamJob.exitCode = code;
                    teamJob.finishedAt = Date.now();
                    if (code !== 0 && !aborted && meta && meta.canFallbackSingle && decision.candidates.length > 0) {
                        const warn = `\n\n> ⚠️ ทีมข้ามค่ายเริ่มด่านวางแผนไม่สำเร็จ (${String(err || '').slice(0, 90)}) — สลับไปรันแบบเอเยนต์เดี่ยวอัตโนมัติ...\n\n`;
                        onChunk('stdout', warn);
                        return runAttempt(0, 'สลับเป็นโหมดเดี่ยว (ทีมข้ามค่ายไม่พร้อม)');
                    }
                    teamJob.status = code === 130 ? 'aborted' : (code === 0 ? 'completed' : 'error');
                    teamJob.error = code === 0 ? null : (err || `Exit code ${code}`);
                    lastJobs.set(sid, teamJob);
                    finish(code, teamJob.error, teamJob);
                }
            });
            innerHandle = teamHandle;
            activeRuns.set(sid, { abort, job: teamJob });
            return;
        }

        runAttempt(0, '');
    })().catch((err) => {
        console.error('[GeminiManager] Auto routing crashed:', err);
        finish(1, err.message, lastJobs.get(sid) || placeholder);
    });

    return { abort };
}

// ── Browser Vision Co-Pilot Prompt Hint ──────────────────────────────────────
function buildBrowserVisionHint(sessionId, browserVision) {
    if (browserVision !== true || !sessionId) return '';
    let bvSession;
    try {
        const bridge = require('./browser-vision-bridge');
        bvSession = bridge.toBrowserSessionName(sessionId);
    } catch (_) {
        return '';
    }
    return [
        '[Browser Vision Co-Pilot เปิดใช้งานอยู่ในห้องแชทนี้]',
        `- งานโต้ตอบบนเว็บให้ใช้: /home/dev/.local/bin/lab-browser session <subcmd> --session ${bvSession} --shared-auth`,
        '- งานค้นหาหรืออ่านข้อมูลด่วนแบบไม่โต้ตอบให้ใช้คำสั่ง one-shot (view / shot / check) โดยไม่ใส่ --session',
        `- ถ้าจะเปิดหน้าเว็บเพื่อโชว์ผลให้ผู้ใช้ดู ให้ใช้: /home/dev/.local/bin/lab-browser session open <url> --new-tab --session ${bvSession} --shared-auth`,
        `- งาน Blender/3D บนเครื่องลูกข่าย ให้รัน: /home/dev/.local/bin/agent-ctl blender --script <file.py> --live-session ${bvSession} --wait เพื่อสตรีมภาพสด + log ขึ้น Browser Vision (ในสคริปต์ bpy เรียก live_snapshot('ขั้นตอน') และ live_progress(pct,'ข้อความ') เป็นระยะ)`,
        '- ถ้าคำสั่งคืนค่า paused: true ให้หยุดคำสั่งเบราว์เซอร์ทั้งหมดทันที แจ้งผู้ใช้ และรอจนกว่าผู้ใช้จะกด Resume',
        '- ถ้าเจอ handoff หรือหน้า sensitive (Login / OTP / Payment / CAPTCHA) ให้ขอให้ผู้ใช้ดำเนินการเองในหน้าจอด้านขวาแล้วกด ✅ ห้ามพยายามแก้ CAPTCHA เอง และห้ามเดาหรือกรอกรหัสผ่านแทนผู้ใช้',
    ].join('\n');
}

function buildBrowserVisionPrompt(rawPrompt, sessionId, browserVision) {
    const hint = buildBrowserVisionHint(sessionId, browserVision);
    return hint ? `${hint}\n\n${rawPrompt}` : rawPrompt;
}

// ── Execute Prompt Stream ────────────────────────────────────────────────────
function executePrompt({ sessionId = null, jobId = null, prompt, images = [], mode = 'exec', cwd = PROJECTS_BASE, model = 'gemini-4-hydrogen-high', resetSession = false, agyAccount = null, routeBanner = '', deferPersist = false, routerDirective = '', browserVision = false, fromRecovery = false, isAuto = false, attempts = null }, onChunk, onDone) {
    const sid0 = resolveSessionId(sessionId);
    if (!fromRecovery && !deferPersist) {
        clearRecoveryForSession(sid0);
    }
    if (model === aiRouter.AUTO_MODEL_ID) {
        return executeAuto({ sessionId, jobId, prompt, images, mode, cwd, resetSession, browserVision, fromRecovery }, onChunk, onDone);
    }
    const sid = sid0;
    if (activeRuns.has(sid)) {
        throw new Error('แชทนี้กำลังประมวลผลอยู่ กรุณารอสักครู่หรือกด "➕ แชทใหม่" เพื่อคุยอีกห้องพร้อมกัน');
    }

    const cleanImages = Array.isArray(images) ? images : [];
    const imagePaths = cleanImages
        .map((img) => (typeof img === 'string' ? img : img && img.path))
        .filter((p) => p && fs.existsSync(p));

    // bvHint and routerDirective go to the CLI/agent only — history keeps the user's own prompt
    const bvHint = buildBrowserVisionHint(sid, browserVision);
    const directedPrompt = [bvHint, routerDirective, prompt].filter(Boolean).join('\n\n');
    const cliPrompt = imagePaths.length > 0
        ? `[ผู้ใช้งานแนบรูปภาพมาด้วย กรุณาอ่าน/ดูไฟล์รูปภาพต่อไปนี้ก่อนตอบคำถาม:\n${imagePaths.map((p) => `- ${p}`).join('\n')}\n]\n\n${directedPrompt}`
        : directedPrompt;

    // Sanitize cwd
    let safeCwd = PROJECTS_BASE;
    if (cwd && fs.existsSync(cwd)) {
        safeCwd = cwd;
    } else if (cwd && fs.existsSync(path.join(PROJECTS_BASE, cwd))) {
        safeCwd = path.join(PROJECTS_BASE, cwd);
    }

    const sessMeta = getSessionMetaSync(sid);
    if (sessMeta) {
        sessMeta.model = model || sessMeta.model;
        sessMeta.cwd = safeCwd;
        sessMeta.mode = mode || sessMeta.mode;
        if (resetSession) {
            sessMeta.agyConversationId = null;
            sessMeta.agyConvs = {};
            sessMeta.agySyncedCount = {};
            sessMeta.claudeSessionId = null;
            sessMeta.claudeSyncedCount = 0;
        }
        saveSessionsIndexSync();
    }

    // Initialize background job tracker for this session
    const finalJobId = jobId || ('job_' + Date.now());
    const job = {
        id: finalJobId,
        sessionId: sid,
        status: 'running',
        prompt,
        images: cleanImages,
        output: routeBanner || '',
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
        exitCode: null,
        mode,
        cwd: safeCwd,
        model,
        agyAccount: agyAccount || null,
        usedModel: model,
        usedAccount: agyAccount || (typeof model === 'string' && model.startsWith('claude-code-') ? 'claude-pro' : (deepseekAgent.isDeepSeekModel(model) ? 'deepseek' : null)),
        modelInfo: null,
        tokenUsage: null,
        steps: [],
        deferPersist: Boolean(deferPersist)
    };
    job.modelInfo = buildJobModelInfo({ model, account: job.usedAccount, auto: isAuto, attempts });
    activeJob = job;
    lastJobs.set(sid, job);
    try { onChunk('meta', { modelInfo: job.modelInfo, tokenUsage: null }); } catch (_) {}
    if (routeBanner) {
        try { onChunk('stdout', routeBanner); } catch (_) {}
    }

    // Pre-save user's prompt immediately to this session on disk
    try {
        const history = loadSessionMessagesSync(sid);
        const last = history[history.length - 1];
        if (!last || last.role !== 'user' || last.content !== prompt) {
            const entry = { role: 'user', content: prompt, timestamp: job.startedAt };
            if (cleanImages.length > 0) entry.images = cleanImages;
            history.push(entry);
            saveSessionMessagesSync(sid, history);
        }
    } catch (e) {
        console.error('[GeminiManager] Failed to pre-save prompt:', e.message);
    }

    // Session continuation logic via agyConversationId
    const forceNew = Boolean(resetSession) || shouldResetSession;
    if (forceNew) {
        shouldResetSession = false;
        if (sessMeta) {
            sessMeta.agyConversationId = null;
            sessMeta.agyConvs = {};
            sessMeta.agySyncedCount = {};
            sessMeta.claudeSessionId = null;
            sessMeta.claudeSyncedCount = 0;
            saveSessionsIndexSync();
        }
    }
    const existingConvId = (!forceNew && sessMeta) ? sessMeta.agyConversationId : null;

    // Route to Claude Code CLI (monthly Claude.ai OAuth subscription)
    if (typeof model === 'string' && model.startsWith('claude-code-')) {
        const claudeAvail = getClaudeCodeAvailability();
        if (!claudeAvail.ready) {
            throw new Error(claudeAvail.reason || 'Claude Code ยังไม่พร้อมใช้งาน (ไม่ได้ล็อกอินหรือยกเลิกแพ็กเกจ Claude Pro) — แนะนำใช้โหมด 🧠 Auto หรือโมเดล Google');
        }
        const cliModel = model.replace('claude-code-', '').trim() || 'sonnet';
        const claudeProjectsDir = path.join(HOME_DIR, '.claude', 'projects');
        const claudeSessionExistsOnDisk = (uuid) => {
            if (!uuid || !fs.existsSync(claudeProjectsDir)) return false;
            try {
                for (const d of fs.readdirSync(claudeProjectsDir)) {
                    if (fs.existsSync(path.join(claudeProjectsDir, d, `${uuid}.jsonl`))) return true;
                }
            } catch (_) {}
            return false;
        };
        const hadClaudeSession = Boolean(!forceNew && sessMeta && sessMeta.claudeSessionId && claudeSessionExistsOnDisk(sessMeta.claudeSessionId));
        let claudeSid = hadClaudeSession ? sessMeta.claudeSessionId : crypto.randomUUID();
        let finalClaudePrompt = cliPrompt;

        // Bridge prior messages if first time using Claude Code in this room, after another engine, or unsynced turns exist
        const priorForClaude = getPriorSessionMessages(sid, prompt);
        const claudeSyncedCount = (sessMeta && typeof sessMeta.claudeSyncedCount === 'number')
            ? sessMeta.claudeSyncedCount
            : (hadClaudeSession ? priorForClaude.length : 0);
        const needClaudeBridge = !hadClaudeSession || Boolean(sessMeta && sessMeta.needsClaudeBridge) || (claudeSyncedCount < priorForClaude.length);
        if (needClaudeBridge && priorForClaude.length > 0) {
            const bridgeBlock = formatSessionHistoryBridge(priorForClaude);
            if (bridgeBlock) {
                finalClaudePrompt = `${bridgeBlock}\n\n${cliPrompt}`;
            }
        }

        if (sessMeta) {
            sessMeta.claudeSessionId = claudeSid;
            sessMeta.claudeSyncedCount = priorForClaude.length + 2;
            sessMeta.needsClaudeBridge = false;
            sessMeta.needsAgyBridge = true;
            saveSessionsIndexSync();
        }

        const args = [
            '-p', finalClaudePrompt,
            '--model', cliModel,
            '--output-format', 'stream-json',
            '--verbose',
            '--include-partial-messages'
        ];
        if (hadClaudeSession) {
            args.push('--resume', claudeSid);
        } else {
            args.push('--session-id', claudeSid);
        }
        if (mode === 'exec') {
            args.push('--dangerously-skip-permissions');
        } else {
            args.push('--permission-mode', 'plan');
        }

        const env = {
            ...process.env,
            PATH: `/home/dev/.gemini/antigravity-cli/bin:/home/dev/.gemini/bin:/home/dev/.local/bin:/home/dev/.local/pm2/node_modules/.bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
            TERM: 'xterm-256color',
            FORCE_COLOR: '0'
        };

        const child = spawn(CLAUDE_BIN, args, {
            cwd: safeCwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        activeRuns.set(sid, { child, job });

        let claudeStdoutBuf = '';
        let claudeThinking = '';
        let currentBlockThinking = '';
        const claudeSteps = [];
        const claudeTimeline = [];
        const seenClaudeToolIds = new Set();
        let currentBlockType = '';
        let currentToolName = '';
        let currentToolId = '';
        let currentToolJson = '';
        let currentAction = 'กำลังเชื่อมต่อ Claude Code...';
        let emittedTextFromDeltas = false;
        let lastClaudeThoughtAt = 0;

        const pushClaudeEvent = (kind, text) => {
            const clean = String(text || '').trim();
            if (!clean) return;
            claudeTimeline.push({ kind, text: clean, ts: Date.now() });
            if (claudeTimeline.length > 120) claudeTimeline.shift();
        };
        pushClaudeEvent('init', `claude-code --model=${cliModel} --mode=${mode}`);

        job._routeBannerLen = (routeBanner || '').length;
        const emitClaudeThought = (action, force = false) => {
            if (action) {
                currentAction = action;
                job._lastSignalAt = Date.now();
            }
            const stepList = claudeSteps.length
                ? 'ขั้นตอนที่ทำในรอบนี้:\n' + claudeSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')
                : '';
            const thinkingText = claudeThinking
                ? (stepList ? `${claudeThinking}\n\n${stepList}` : claudeThinking)
                : stepList;
            const rawPayload = {
                currentAction: currentAction || 'กำลังคิดวิเคราะห์ (Claude)...',
                thinking: thinkingText.slice(-3000),
                steps: [...claudeSteps],
                stepsCount: claudeSteps.length,
                timeline: [...claudeTimeline],
                engine: 'claude-code'
            };
            const payload = attachLivenessToThought(job, rawPayload, child.pid);
            job.liveThought = payload;
            const now = Date.now();
            if (force || now - lastClaudeThoughtAt >= 100) {
                lastClaudeThoughtAt = now;
                try { onChunk('thought', payload); } catch (_) {}
            }
        };

        emitClaudeThought('กำลังเชื่อมต่อ Claude Code...', true);
        const claudeHeartbeatTimer = setInterval(() => {
            emitClaudeThought(null, true);
        }, 2000);

        const claudeMsgUsages = new Map();
        let inFlightMsgId = null;
        let inFlightRawUsage = null;
        let claudeResultUsage = null;
        let claudeCostUsd = null;
        let claudeTurns = 0;
        let lastClaudeMetaAt = 0;

        const syncClaudeTokenUsage = (force = false) => {
            let thinkingSum = 0;
            let acc = null;
            for (const mu of claudeMsgUsages.values()) {
                thinkingSum += Number(mu.thinkingTokens || 0);
                acc = tokenUsageHelper.mergeTokenUsages(acc, mu, 'claude-stream');
            }
            if (inFlightRawUsage && (!inFlightMsgId || !claudeMsgUsages.has(inFlightMsgId))) {
                const liveNorm = tokenUsageHelper.normalizeClaudeUsage(inFlightRawUsage, 1, null, model);
                if (liveNorm) {
                    thinkingSum += Number(liveNorm.thinkingTokens || 0);
                    acc = tokenUsageHelper.mergeTokenUsages(acc, liveNorm, 'claude-stream');
                }
            }
            if (claudeResultUsage) {
                const resNorm = tokenUsageHelper.normalizeClaudeUsage(
                    claudeResultUsage,
                    claudeTurns || claudeMsgUsages.size || 1,
                    claudeCostUsd,
                    model
                );
                if (resNorm) {
                    if (thinkingSum > resNorm.thinkingTokens) resNorm.thinkingTokens = thinkingSum;
                    acc = resNorm;
                }
            }
            if (acc) {
                job.tokenUsage = acc;
                const now = Date.now();
                if (force || (now - lastClaudeMetaAt) >= 400) {
                    lastClaudeMetaAt = now;
                    try { onChunk('meta', { modelInfo: job.modelInfo, tokenUsage: job.tokenUsage }); } catch (_) {}
                }
            }
        };

        const processClaudeLine = (rawLine) => {
            const line = rawLine.trim();
            if (!line) return;
            let obj;
            try {
                obj = JSON.parse(line);
            } catch (_) {
                const cleaned = line.replace(/^\[claude-code:unrecognized_model\][^\n]*$/gm, '').trim();
                if (cleaned && !line.startsWith('{')) {
                    job.output += cleaned + '\n';
                    onChunk('stdout', cleaned + '\n');
                }
                return;
            }

            if (obj.type === 'system') {
                if (obj.subtype === 'init') {
                    pushClaudeEvent('status', `session=${String(obj.session_id || claudeSid).slice(0, 8)} model=${obj.model || cliModel}`);
                    emitClaudeThought('เชื่อมต่อ Claude Code สำเร็จ — กำลังรอผล...', true);
                } else if (obj.subtype === 'status' && obj.status) {
                    const statusMsg = obj.status === 'requesting' ? 'กำลังส่งคำขอไปยัง Claude API...' : `status: ${obj.status}`;
                    pushClaudeEvent('status', statusMsg);
                    emitClaudeThought(statusMsg, true);
                }
                return;
            }

            if (obj.type === 'stream_event' && obj.event) {
                const ev = obj.event;
                if (ev.type === 'message_start') {
                    if (ev.message && ev.message.usage) {
                        inFlightMsgId = ev.message.id || `m_${claudeMsgUsages.size + 1}`;
                        inFlightRawUsage = { ...ev.message.usage };
                        syncClaudeTokenUsage(false);
                    }
                    if (job.output && !job.output.endsWith('\n')) {
                        job.output += '\n\n';
                        onChunk('stdout', '\n\n');
                    }
                } else if (ev.type === 'message_delta') {
                    if (ev.usage) {
                        inFlightRawUsage = { ...(inFlightRawUsage || {}), ...ev.usage };
                        syncClaudeTokenUsage(false);
                    }
                } else if (ev.type === 'content_block_start' && ev.content_block) {
                    const cb = ev.content_block;
                    currentBlockType = cb.type || '';
                    if (currentBlockType === 'thinking') {
                        currentBlockThinking = '';
                        pushClaudeEvent('status', 'กำลังคิดวิเคราะห์ (extended thinking)...');
                        emitClaudeThought('กำลังคิดวิเคราะห์ (Claude)...', true);
                    } else if (currentBlockType === 'tool_use') {
                        currentToolName = cb.name || 'tool';
                        currentToolId = cb.id || '';
                        currentToolJson = '';
                        emitClaudeThought(`⚙️ กำลังเตรียมเครื่องมือ: ${currentToolName}...`, true);
                    } else if (currentBlockType === 'text') {
                        pushClaudeEvent('status', 'กำลังเรียบเรียงคำตอบ (streaming)...');
                        emitClaudeThought('กำลังเรียบเรียงคำตอบ (Claude)...', true);
                    }
                } else if (ev.type === 'content_block_delta' && ev.delta) {
                    const d = ev.delta;
                    if (d.type === 'thinking_delta' && d.thinking) {
                        claudeThinking += d.thinking;
                        currentBlockThinking += d.thinking;
                        emitClaudeThought('กำลังคิดวิเคราะห์ (Claude)...');
                    } else if (d.type === 'input_json_delta' && d.partial_json) {
                        currentToolJson += d.partial_json;
                    } else if (d.type === 'text_delta' && d.text) {
                        emittedTextFromDeltas = true;
                        job.output += d.text;
                        onChunk('stdout', d.text);
                    }
                } else if (ev.type === 'content_block_stop') {
                    if (currentBlockType === 'thinking' && currentBlockThinking.trim()) {
                        pushClaudeEvent('think', currentBlockThinking.trim().slice(-1200));
                        emitClaudeThought('กำลังคิดวิเคราะห์ (Claude)...', true);
                        currentBlockThinking = '';
                    } else if (currentBlockType === 'tool_use' && currentToolName) {
                        let parsedInput = {};
                        try {
                            if (currentToolJson) parsedInput = JSON.parse(currentToolJson);
                        } catch (_) {}
                        const summary = formatClaudeToolSummary(currentToolName, parsedInput);
                        if (!currentToolId || !seenClaudeToolIds.has(currentToolId)) {
                            if (currentToolId) seenClaudeToolIds.add(currentToolId);
                            claudeSteps.push(summary);
                            pushClaudeEvent('tool', summary);
                        }
                        emitClaudeThought(summary, true);
                    }
                    currentBlockType = '';
                    currentToolName = '';
                    currentToolId = '';
                    currentToolJson = '';
                }
                return;
            }

            if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
                if (obj.message.usage) {
                    const msgKey = obj.message.id || `msg_${claudeMsgUsages.size + 1}`;
                    const norm = tokenUsageHelper.normalizeClaudeUsage(obj.message.usage, 1, null, obj.message.model || model);
                    if (norm) {
                        claudeMsgUsages.set(msgKey, norm);
                        if (inFlightMsgId === msgKey) {
                            inFlightMsgId = null;
                            inFlightRawUsage = null;
                        }
                        syncClaudeTokenUsage(true);
                    }
                }
                let updated = false;
                for (const block of obj.message.content) {
                    if (!block) continue;
                    if (block.type === 'thinking' && block.thinking && !claudeThinking.includes(block.thinking)) {
                        claudeThinking += (claudeThinking ? '\n' : '') + block.thinking;
                        pushClaudeEvent('think', block.thinking.trim().slice(-1200));
                        updated = true;
                    } else if (block.type === 'tool_use' && block.name) {
                        const tid = block.id || '';
                        if (!tid || !seenClaudeToolIds.has(tid)) {
                            if (tid) seenClaudeToolIds.add(tid);
                            const summary = formatClaudeToolSummary(block.name, block.input);
                            claudeSteps.push(summary);
                            pushClaudeEvent('tool', summary);
                            currentAction = summary;
                            updated = true;
                        }
                    } else if (block.type === 'text' && block.text && !emittedTextFromDeltas) {
                        job.output += block.text;
                        onChunk('stdout', block.text);
                    }
                }
                if (updated) emitClaudeThought(currentAction, true);
                return;
            }

            if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
                let gotResult = false;
                for (const block of obj.message.content) {
                    if (block && block.type === 'tool_result') {
                        const len = typeof block.content === 'string'
                            ? block.content.length
                            : JSON.stringify(block.content || '').length;
                        pushClaudeEvent('tool_ok', `tool_result received (${len} bytes)`);
                        gotResult = true;
                    }
                }
                if (gotResult) emitClaudeThought('วิเคราะห์ผลลัพธ์จากเครื่องมือ...', true);
                return;
            }

            if (obj.type === 'result') {
                if (obj.usage) claudeResultUsage = obj.usage;
                if (typeof obj.total_cost_usd === 'number') claudeCostUsd = obj.total_cost_usd;
                if (obj.num_turns) claudeTurns = Number(obj.num_turns || 0);
                syncClaudeTokenUsage(true);
                const dur = obj.duration_ms ? `${(obj.duration_ms / 1000).toFixed(1)}s` : '';
                const cost = typeof obj.total_cost_usd === 'number' ? `$${obj.total_cost_usd.toFixed(4)}` : '';
                pushClaudeEvent('status', `completed turns=${obj.num_turns || 1}${dur ? ' time=' + dur : ''}${cost ? ' cost=' + cost : ''}`);
                emitClaudeThought('เสร็จสิ้นการประมวลผล', true);
                if (!emittedTextFromDeltas && job.output.length <= (routeBanner || '').length && typeof obj.result === 'string' && obj.result) {
                    job.output += obj.result;
                    onChunk('stdout', obj.result);
                }
                if (obj.is_error && obj.result && !job.error) {
                    job.error = String(obj.result);
                }
            }
        };

        child.stdout.on('data', (d) => {
            claudeStdoutBuf += d.toString('utf8');
            const lines = claudeStdoutBuf.split('\n');
            claudeStdoutBuf = lines.pop() || '';
            for (const line of lines) processClaudeLine(line);
        });

        let claudeStderrTail = '';
        let claudeCrashSuppressed = false;
        child.stderr.on('data', (d) => {
            const str = d.toString('utf8');
            claudeStderrTail = (claudeStderrTail + str).slice(-4000);
            if (!claudeCrashSuppressed && (/^={20,}/.test(claudeStderrTail.trimStart()) || aiRouter.isBinaryCrash(claudeStderrTail))) {
                claudeCrashSuppressed = true;
            }
            if (!claudeCrashSuppressed) onChunk('stderr', str);
        });

        child.on('error', async (err) => {
            clearInterval(claudeHeartbeatTimer);
            activeRuns.delete(sid);
            job.liveThought = null;
            job.steps = [...claudeSteps];
            job._stderrTail = claudeStderrTail;
            job.status = 'error';
            job.error = err.message;
            job.finishedAt = Date.now();
            syncClaudeTokenUsage(true);
            try { onChunk('meta', { modelInfo: job.modelInfo, tokenUsage: job.tokenUsage || null }); } catch (_) {}
            lastJobs.set(sid, job);
            if (!job.deferPersist) {
                markSessionCompletedSync(sid, { finishedAt: job.finishedAt, status: 'error' });
                try { await finalizeFailedJobRecovery(job, { stderrTail: claudeStderrTail }); } catch (_) {}
            }
            onDone(1, err.message);
            setTimeout(() => { processNextInQueue(); }, 600);
        });

        child.on('close', async (code) => {
            clearInterval(claudeHeartbeatTimer);
            if (claudeStdoutBuf.trim()) {
                processClaudeLine(claudeStdoutBuf);
                claudeStdoutBuf = '';
            }
            activeRuns.delete(sid);
            job.liveThought = null;
            job.steps = [...claudeSteps];
            job._stderrTail = claudeStderrTail;
            const effectiveCode = (code === 0 && job.error) ? 1 : code;
            job.exitCode = effectiveCode;
            if (job.status !== 'aborted') {
                job.status = (effectiveCode === 0) ? 'completed' : 'error';
                if (effectiveCode !== 0 && !job.error) {
                    if (aiRouter.isBinaryCrash(claudeStderrTail)) {
                        job.error = aiRouter.summarizeCrashError(claudeStderrTail, 'claude-code', `Exit code ${effectiveCode}`);
                        if (!job.deferPersist) aiRouter.healBinaryCache(CLAUDE_BIN);
                    } else {
                        job.error = claudeStderrTail.trim() || `Exit code ${effectiveCode}`;
                    }
                }
            }
            job.finishedAt = Date.now();
            syncClaudeTokenUsage(true);
            try { onChunk('meta', { modelInfo: job.modelInfo, tokenUsage: job.tokenUsage || null }); } catch (_) {}
            lastJobs.set(sid, job);
            if (!job.deferPersist && effectiveCode !== 0 && job.status !== 'aborted') {
                try { await finalizeFailedJobRecovery(job, { stderrTail: claudeStderrTail }); } catch (_) {}
            }
            if (!job.deferPersist && job.status !== 'aborted') {
                markSessionCompletedSync(sid, { finishedAt: job.finishedAt, status: job.status });
            }
            if (!job.deferPersist) persistJobToHistory({ ...job }).catch((err) => {
                console.error('[GeminiManager] Failed to persist Claude job:', err.message);
            });
            onDone(effectiveCode, job.error);
            setTimeout(() => { processNextInQueue(); }, 600);
        });

        return {
            abort: () => {
                const run = activeRuns.get(sid);
                if (run && run.child === child) {
                    job.status = 'aborted';
                    job.finishedAt = Date.now();
                    try {
                        child.kill('SIGTERM');
                        setTimeout(() => {
                            const r = activeRuns.get(sid);
                            if (r && r.child === child) child.kill('SIGKILL');
                        }, 2000);
                    } catch (_) {}
                }
            }
        };
    }

    // Route to DeepSeek Agent when a deepseek-* model is selected
    if (deepseekAgent.isDeepSeekModel(model)) {
        const sessionHistory = loadSessionMessagesSync(sid);
        if (sessMeta) {
            sessMeta.needsAgyBridge = true;
            sessMeta.needsClaudeBridge = true;
            saveSessionsIndexSync();
        }
        let handle = null;
        handle = deepseekAgent.runDeepSeekPrompt({
            job,
            prompt: directedPrompt,
            imagePaths,
            mode,
            cwd: safeCwd,
            model,
            history: sessionHistory,
            onChunk,
            onDone: async (code, errMsg) => {
                activeRuns.delete(sid);
                lastJobs.set(sid, job);
                try { onChunk('meta', { modelInfo: job.modelInfo, tokenUsage: job.tokenUsage || null }); } catch (_) {}
                if (!job.deferPersist && code !== 0 && job.status !== 'aborted') {
                    try { await finalizeFailedJobRecovery(job, {}); } catch (_) {}
                }
                if (!job.deferPersist && job.status !== 'aborted') {
                    markSessionCompletedSync(sid, { finishedAt: job.finishedAt || Date.now(), status: code === 0 ? 'completed' : 'error' });
                }
                if (!job.deferPersist) persistJobToHistory({ ...job }).catch((err) => {
                    console.error('[GeminiManager] Failed to persist DeepSeek job:', err.message);
                });
                onDone(code, errMsg);
                setTimeout(() => { processNextInQueue(); }, 600);
            }
        });
        activeRuns.set(sid, { abort: handle.abort, job });
        return handle;
    }

    const readyAgyAccs = aiRouter.listAgyAccounts().filter((a) => a.ready);
    const hasAgy = fs.existsSync(AGY_BIN) && readyAgyAccs.length > 0;

    if (hasAgy) {
        // Google account (HOME profile) — conversations live in each account's own brain dir
        const agyAcc = aiRouter.getAgyAccount(agyAccount || (sessMeta && sessMeta.agyAccount) || 'g1');
        const agyBrain = aiRouter.agyBrainDir(agyAcc);
        job.agyAccount = agyAcc.id;

        if (sessMeta) {
            if (!sessMeta.agyConvs || typeof sessMeta.agyConvs !== 'object') sessMeta.agyConvs = {};
            if (!sessMeta.agySyncedCount || typeof sessMeta.agySyncedCount !== 'object') sessMeta.agySyncedCount = {};
            if (sessMeta.agyConversationId && sessMeta.agyAccount && !sessMeta.agyConvs[sessMeta.agyAccount]) {
                sessMeta.agyConvs[sessMeta.agyAccount] = sessMeta.agyConversationId;
            }
        }

        const prevAccount = (sessMeta && sessMeta.agyAccount) || null;
        const switchedAccount = Boolean(prevAccount && prevAccount !== agyAcc.id);
        let convId = (!forceNew && sessMeta)
            ? ((sessMeta.agyConvs && sessMeta.agyConvs[agyAcc.id]) || (!switchedAccount ? existingConvId : null))
            : null;
        // Verify that the conversation directory actually exists in this Google account's brain dir
        if (convId && !fs.existsSync(path.join(agyBrain, convId))) {
            convId = null;
            if (sessMeta && sessMeta.agyConvs) {
                delete sessMeta.agyConvs[agyAcc.id];
            }
        }

        const priorForAgy = getPriorSessionMessages(sid, prompt);
        const agySyncedForAcc = (sessMeta && sessMeta.agySyncedCount && typeof sessMeta.agySyncedCount[agyAcc.id] === 'number')
            ? sessMeta.agySyncedCount[agyAcc.id]
            : (convId && !switchedAccount && !(sessMeta && sessMeta.needsAgyBridge) ? priorForAgy.length : 0);
        const needAgyBridge = !convId
            || Boolean(sessMeta && sessMeta.needsAgyBridge)
            || switchedAccount
            || (agySyncedForAcc < priorForAgy.length);

        let finalAgyPrompt = cliPrompt;
        if (needAgyBridge && priorForAgy.length > 0) {
            const bridgeBlock = formatSessionHistoryBridge(priorForAgy);
            if (bridgeBlock) {
                finalAgyPrompt = `${bridgeBlock}\n\n${cliPrompt}`;
            }
        }

        if (sessMeta) {
            sessMeta.agyAccount = agyAcc.id;
            sessMeta.agyConversationId = convId || null;
            if (convId) sessMeta.agyConvs[agyAcc.id] = convId;
            sessMeta.agySyncedCount[agyAcc.id] = priorForAgy.length + 2;
            sessMeta.needsAgyBridge = false;
            sessMeta.needsClaudeBridge = true;
            saveSessionsIndexSync();
        }

        // Snapshot existing brain UUIDs if this account doesn't have an agyConversationId yet
        let beforeBrains = null;
        if (!convId) {
            try {
                beforeBrains = new Set(fs.existsSync(agyBrain) ? fs.readdirSync(agyBrain) : []);
            } catch (_) {
                beforeBrains = new Set();
            }
        }

        const args = ['-p', finalAgyPrompt];
        if (convId) {
            args.unshift('--conversation', convId);
        }
        if (mode === 'exec') {
            args.push('--dangerously-skip-permissions');
        }
        if (model) {
            args.push('--model', model);
        }

        const env = {
            ...process.env,
            PATH: `/home/dev/.gemini/antigravity-cli/bin:/home/dev/.gemini/bin:/home/dev/.local/bin:/home/dev/.local/pm2/node_modules/.bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
            TERM: 'xterm-256color',
            FORCE_COLOR: '0',
            HOME: agyAcc.home,
        };

        const child = spawn(AGY_BIN, args, {
            cwd: safeCwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        activeRuns.set(sid, { child, job });

        const detectConvId = () => {
            const liveMeta = getSessionMetaSync(sid) || sessMeta;
            const existingForAcc = liveMeta && liveMeta.agyConvs && liveMeta.agyConvs[agyAcc.id];
            if (!beforeBrains || existingForAcc) return;
            try {
                if (!fs.existsSync(agyBrain)) return;
                const allSessions = ensureSessionsStoreSync();
                const claimed = new Set();
                for (const s of allSessions) {
                    if (!s) continue;
                    if (s.agyConversationId) claimed.add(s.agyConversationId);
                    if (s.agyConvs && typeof s.agyConvs === 'object') {
                        for (const cid of Object.values(s.agyConvs)) {
                            if (cid) claimed.add(cid);
                        }
                    }
                }
                const nowDirs = fs.readdirSync(agyBrain).filter(d => !beforeBrains.has(d) && !claimed.has(d));
                if (nowDirs.length > 0) {
                    const validDirs = nowDirs.filter((d) => {
                        try {
                            const tPath = path.join(agyBrain, d, '.system_generated/logs/transcript.jsonl');
                            if (fs.existsSync(tPath)) {
                                const head = fs.readFileSync(tPath, 'utf8').slice(0, 1500);
                                if (head.includes('สรุปเนื้อหาข้อความต่อไปนี้ให้เป็นชื่อหัวข้อแชท')) return false;
                            }
                        } catch (_) {}
                        return true;
                    });
                    if (validDirs.length > 0) {
                        validDirs.sort((a, b) => {
                            try { return fs.statSync(path.join(agyBrain, b)).mtimeMs - fs.statSync(path.join(agyBrain, a)).mtimeMs; } catch (_) { return 0; }
                        });
                        const chosen = validDirs[0];
                        if (liveMeta) {
                            liveMeta.agyConversationId = chosen;
                            if (!liveMeta.agyConvs || typeof liveMeta.agyConvs !== 'object') liveMeta.agyConvs = {};
                            liveMeta.agyConvs[agyAcc.id] = chosen;
                            saveSessionsIndexSync();
                        }
                    }
                }
            } catch (_) {}
        };
        const brainPoll = beforeBrains ? setInterval(detectConvId, 500) : null;
        let lastAgyThoughtSig = '';
        let lastAgyHeartbeatAt = 0;
        let lastAgyTokenSig = '';
        job._routeBannerLen = (routeBanner || '').length;
        const refreshAgyTokens = (forceEmit = false) => {
            const liveMeta = getSessionMetaSync(sid) || sessMeta;
            const activeConvId = (liveMeta && liveMeta.agyConvs && liveMeta.agyConvs[agyAcc.id])
                || (liveMeta && liveMeta.agyConversationId)
                || convId;
            const usage = tokenUsageHelper.readAgyTurnUsage(job.startedAt || 0, activeConvId, agyBrain);
            if (!usage) return;
            const tSig = `${usage.calls}:${usage.totalTokens}`;
            if (forceEmit || tSig !== lastAgyTokenSig) {
                lastAgyTokenSig = tSig;
                job.tokenUsage = usage;
                try { onChunk('meta', { modelInfo: job.modelInfo, tokenUsage: job.tokenUsage }); } catch (_) {}
            }
        };
        const thoughtPoll = setInterval(() => {
            const liveMeta = getSessionMetaSync(sid) || sessMeta;
            const activeConvId = (liveMeta && liveMeta.agyConvs && liveMeta.agyConvs[agyAcc.id])
                || (liveMeta && liveMeta.agyConversationId)
                || convId;
            const rawState = getLiveThinkingState(job.startedAt || 0, activeConvId, agyBrain) || {
                thinking: '',
                currentAction: 'กำลังเชื่อมต่อและวิเคราะห์คำสั่ง...',
                steps: [],
                stepsCount: 0,
                timeline: [],
                engine: 'antigravity'
            };
            const state = attachLivenessToThought(job, rawState, child.pid);
            const tlLen = Array.isArray(state.timeline) ? state.timeline.length : 0;
            const sig = `${state.currentAction}|${state.stepsCount}|${tlLen}|${state.thinking}`;
            const now = Date.now();
            if (sig !== lastAgyThoughtSig || (now - lastAgyHeartbeatAt) >= 2000) {
                lastAgyThoughtSig = sig;
                lastAgyHeartbeatAt = now;
                job.liveThought = state;
                if (Array.isArray(state.steps) && state.steps.length) job.steps = [...state.steps];
                try { onChunk('thought', state); } catch (_) {}
            }
            refreshAgyTokens(false);
        }, 300);

        child.stdout.on('data', (d) => {
            const str = d.toString('utf8');
            job._lastSignalAt = Date.now();
            job.output += str;
            onChunk('stdout', str);
        });

        let agyStderrTail = '';
        child.stderr.on('data', (d) => {
            const str = d.toString('utf8');
            job._lastSignalAt = Date.now();
            agyStderrTail = (agyStderrTail + str).slice(-4000);
            onChunk('stderr', str);
        });

        child.on('error', async (err) => {
            if (brainPoll) clearInterval(brainPoll);
            clearInterval(thoughtPoll);
            job.liveThought = null;
            job._stderrTail = agyStderrTail;
            activeRuns.delete(sid);
            job.status = 'error';
            job.error = err.message;
            job.finishedAt = Date.now();
            refreshAgyTokens(true);
            try { onChunk('meta', { modelInfo: job.modelInfo, tokenUsage: job.tokenUsage || null }); } catch (_) {}
            lastJobs.set(sid, job);
            if (!job.deferPersist) {
                markSessionCompletedSync(sid, { finishedAt: job.finishedAt, status: 'error' });
                try { await finalizeFailedJobRecovery(job, { stderrTail: agyStderrTail }); } catch (_) {}
            }
            onDone(1, err.message);
            setTimeout(() => { processNextInQueue(); }, 600);
        });

        child.on('close', async (code) => {
            if (brainPoll) clearInterval(brainPoll);
            clearInterval(thoughtPoll);
            detectConvId();
            refreshAgyTokens(true);
            job.liveThought = null;
            job._stderrTail = agyStderrTail;
            activeRuns.delete(sid);
            job.exitCode = code;
            if (job.status !== 'aborted') {
                job.status = (code === 0) ? 'completed' : 'error';
                if (code !== 0 && !job.error) {
                    job.error = agyStderrTail.trim() || `Exit code ${code}`;
                }
            }
            job.finishedAt = Date.now();
            try { onChunk('meta', { modelInfo: job.modelInfo, tokenUsage: job.tokenUsage || null }); } catch (_) {}
            lastJobs.set(sid, job);

            if (!job.deferPersist && code !== 0 && job.status !== 'aborted') {
                try { await finalizeFailedJobRecovery(job, { stderrTail: agyStderrTail }); } catch (_) {}
            }
            if (!job.deferPersist && job.status !== 'aborted') {
                markSessionCompletedSync(sid, { finishedAt: job.finishedAt, status: job.status });
            }
            if (!job.deferPersist) persistJobToHistory({ ...job }).catch((err) => {
                console.error('[GeminiManager] Failed to persist background job:', err.message);
            });

            onDone(code, job.error);
            setTimeout(() => { processNextInQueue(); }, 600);
        });

        return {
            abort: () => {
                const run = activeRuns.get(sid);
                if (run && run.child === child) {
                    job.status = 'aborted';
                    job.finishedAt = Date.now();
                    try {
                        child.kill('SIGTERM');
                        setTimeout(() => {
                            const r = activeRuns.get(sid);
                            if (r && r.child === child) child.kill('SIGKILL');
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

    const args = ['-p', cliPrompt, '--skip-trust'];
    if (!forceNew) {
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
        markSessionCompletedSync(sid, { finishedAt: activeJob.finishedAt, status: 'error' });
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
        if (activeJob.status !== 'aborted') {
            markSessionCompletedSync(sid, { finishedAt: activeJob.finishedAt, status: activeJob.status });
        }

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
function abortActive(sessionId = null) {
    if (sessionId && activeRuns.has(sessionId)) {
        const run = activeRuns.get(sessionId);
        if (run.job && run.job.status === 'running') {
            run.job.status = 'aborted';
            run.job.finishedAt = Date.now();
            lastJobs.set(sessionId, run.job);
        }
        try {
            if (typeof run.abort === 'function') run.abort();
            else if (run.child) run.child.kill('SIGTERM');
            activeRuns.delete(sessionId);
            return { ok: true, killed: true, sessionId };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
    if (!sessionId && activeRuns.size > 0) {
        let killed = 0;
        for (const [sid, run] of activeRuns.entries()) {
            if (run.job && run.job.status === 'running') {
                run.job.status = 'aborted';
                run.job.finishedAt = Date.now();
                lastJobs.set(sid, run.job);
            }
            try {
                if (typeof run.abort === 'function') run.abort();
                else if (run.child) run.child.kill('SIGTERM');
                killed++;
            } catch (_) {}
            activeRuns.delete(sid);
        }
        return { ok: true, killed: killed > 0 };
    }
    if (activeJob && activeJob.status === 'running') {
        activeJob.status = 'aborted';
        activeJob.finishedAt = Date.now();
    }
    if (activeChild) {
        try {
            activeChild.kill('SIGTERM');
            activeChild = null;
            return { ok: true, killed: true };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
    return { ok: true, message: 'No running process' };
}

// ── Chat History Persistence (Session-Aware) ─────────────────────────────────
async function loadHistory(sessionId = null) {
    const sid = resolveSessionId(sessionId);
    return loadSessionMessagesSync(sid);
}

async function saveHistory(messages, sessionId = null) {
    const sid = resolveSessionId(sessionId);
    const existing = loadSessionMessagesSync(sid);
    const merged = (messages || []).map((m, i) => {
        if (!m || typeof m !== 'object') return m;
        const ex = existing[i] && existing[i].role === m.role && existing[i].content === m.content
            ? existing[i]
            : existing.find(e => e && e.role === m.role && e.content === m.content);
        const out = { ...m };
        if (ex) {
            if (!out.timestamp && ex.timestamp) out.timestamp = ex.timestamp;
            if (!out.durationMs && ex.durationMs) {
                out.durationMs = ex.durationMs;
                if (ex.timestamp) out.timestamp = ex.timestamp;
            }
            if (!out.modelInfo && ex.modelInfo) out.modelInfo = ex.modelInfo;
            if (!out.tokenUsage && ex.tokenUsage) out.tokenUsage = ex.tokenUsage;
        }
        return out;
    });
    return saveSessionMessagesSync(sid, merged);
}

async function clearHistory(sessionId = null) {
    try {
        const sid = resolveSessionId(sessionId);
        const sess = getSessionMetaSync(sid);
        if (sess) {
            sess.agyConversationId = null;
            sess.agyConvs = {};
            sess.agySyncedCount = {};
            sess.claudeSessionId = null;
            sess.claudeSyncedCount = 0;
            sess.needsAgyBridge = false;
            sess.needsClaudeBridge = false;
            sess.title = 'แชทใหม่';
            sess.lastCompletedAt = null;
            sess.lastCompletedStatus = null;
            sess.lastViewedAt = Date.now();
            sess.updatedAt = Date.now();
            saveSessionsIndexSync();
        }
        saveSessionMessagesSync(sid, []);
        lastJobs.delete(sid);
        clearRecoveryForSession(sid);
        return { ok: true, sessionId: sid };
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
const CLOUDCODE_BASE = 'https://daily-cloudcode-pa.googleapis.com/v1internal';
const CLOUDCODE_HEADERS_BASE = {
    'Content-Type': 'application/json',
    'User-Agent': 'antigravity/1.15.8'
};
const cachedProjectInfoByAccount = new Map(); // accountId -> { project, tier, fetchedAt }

function execFileAsync(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, opts, (err, stdout, stderr) => {
            if (err) return reject(err);
            resolve({ stdout, stderr });
        });
    });
}

function readOAuthTokenFile(tokenFile) {
    const raw = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    const inner = typeof raw.token === 'string' ? JSON.parse(raw.token) : raw.token;
    return { raw, inner };
}

async function getValidAccessToken(tokenFile, forceRefresh = false, home = HOME_DIR) {
    let { raw, inner } = readOAuthTokenFile(tokenFile);
    const expiryMs = inner?.expiry ? Date.parse(inner.expiry) : 0;
    const isExpired = !expiryMs || (expiryMs - Date.now() < 60_000);
    const needsRefresh = forceRefresh || !inner?.access_token || isExpired;
    let refreshFailed = false;

    if (needsRefresh && fs.existsSync(AGY_BIN)) {
        try {
            await execFileAsync(AGY_BIN, ['models'], { timeout: 15000, env: { ...process.env, HOME: home } });
            ({ raw, inner } = readOAuthTokenFile(tokenFile));
        } catch (_) {
            refreshFailed = true;
        }
    }

    const afterExpiryMs = inner?.expiry ? Date.parse(inner.expiry) : 0;
    const expired = !afterExpiryMs || afterExpiryMs <= Date.now();
    return {
        accessToken: inner?.access_token || null,
        email: raw.id_token_email || (home === HOME_DIR ? 'asri.utcc@gmail.com' : null),
        refreshFailed,
        expired
    };
}

// `agy -p /usage` prints the app's "View Usage" table as TSV: group \t label \t NN% \t resetISO
const AGY_USAGE_TTL_MS = 60 * 1000;
const agyUsageCache = new Map(); // accountId -> { at, rows }

function parseAgyUsage(text) {
    const rows = [];
    for (const line of String(text || '').split('\n')) {
        const parts = line.split('\t');
        if (parts.length < 3) continue;
        const pct = parseFloat(parts[2]);
        if (Number.isNaN(pct)) continue;
        rows.push({
            group: parts[0].trim(),
            label: parts[1].trim(),
            window: /five.?hour|5.?h/i.test(parts[1]) ? '5h' : 'weekly',
            remainingPct: pct,
            resetTime: (parts[3] || '').trim() || null
        });
    }
    return rows;
}

async function getAgyUsage(account) {
    const hit = agyUsageCache.get(account.id);
    if (hit && Date.now() - hit.at < AGY_USAGE_TTL_MS) return hit.rows;
    let rows = null;
    try {
        const { stdout } = await execFileAsync(AGY_BIN, ['-p', '/usage', '--print-timeout', '30s'], {
            timeout: 40000,
            cwd: path.join(GEMINI_DIR, 'router-tmp'),
            env: { ...process.env, HOME: account.home, FORCE_COLOR: '0' }
        });
        rows = parseAgyUsage(stdout);
    } catch (err) {
        console.error(`[GeminiManager] agy /usage failed for ${account.label}: ${String(err.message || err).slice(0, 160)}`);
    }
    // Keep the last good reading if this one failed
    if (!rows || !rows.length) return hit ? hit.rows : null;
    agyUsageCache.set(account.id, { at: Date.now(), rows });
    return rows;
}

async function postCloudCode(endpoint, accessToken, bodyObj) {
    const res = await fetch(`${CLOUDCODE_BASE}:${endpoint}`, {
        method: 'POST',
        headers: {
            ...CLOUDCODE_HEADERS_BASE,
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(bodyObj),
        signal: AbortSignal.timeout(10000)
    });
    return res;
}

function toPctObj(remainingFraction, resetTime = null) {
    const rem = typeof remainingFraction === 'number' ? remainingFraction : 1;
    const remainingPct = Math.max(0, Math.min(100, Number((rem * 100).toFixed(1))));
    return {
        remainingPct,
        usedPct: Number((100 - remainingPct).toFixed(1)),
        resetTime: resetTime || null
    };
}

const CREDIT_GEMINI_DIR = fs.existsSync(path.join(os.homedir(), '.gemini', 'gemini-credit.json'))
    ? path.join(os.homedir(), '.gemini')
    : '/home/dev/.gemini';
const GEMINI_CREDIT_CFG = path.join(CREDIT_GEMINI_DIR, 'gemini-credit.json');
const GEMINI_TTS_LEDGER = path.join(CREDIT_GEMINI_DIR, 'gemini-tts-ledger.jsonl');
const GEMINI_CREDIT_ALERT_SCRIPT = '/home/dev/.local/share/motion-studio/scripts/credit_ledger.py';

function maybeCheckLowCreditAlertAsync(credit) {
    if (!credit || !credit.ok || !credit.isLow) return;
    execFile('/usr/bin/python3', [GEMINI_CREDIT_ALERT_SCRIPT, '--check-alert'], { timeout: 15000 }, () => {});
}

// Estimated Gemini API prepay balance = baseline (read from AI Studio) - cost of TTS calls logged since then
async function getGeminiCredit() {
    let cfg;
    try {
        cfg = JSON.parse(await fsp.readFile(GEMINI_CREDIT_CFG, 'utf8'));
    } catch {
        return null;
    }
    const fx = Number(cfg.usdToThb) || 34.5;
    const since = Date.parse(cfg.baselineAt) || 0;
    let usd = 0, calls = 0, inTok = 0, outTok = 0, lastAt = null;
    let unpriced = 0;
    try {
        const lines = (await fsp.readFile(GEMINI_TTS_LEDGER, 'utf8')).split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            let r;
            try { r = JSON.parse(line); } catch { continue; }
            if ((Date.parse(r.ts) || 0) < since) continue;
            const price = (cfg.pricesUsdPerMTok || {})[r.model];
            if (!price) { unpriced++; continue; }
            const out = (r.outputTokens || 0) + (r.thoughtsTokens || 0);
            usd += ((r.promptTokens || 0) * price.input + out * price.output) / 1e6;
            inTok += r.promptTokens || 0;
            outTok += out;
            calls++;
            lastAt = r.ts;
        }
    } catch { /* no ledger yet */ }
    const baseline = Number(cfg.baselineBalanceThb) || 0;
    const spentThb = usd * fx;
    const remainingThb = Number(Math.max(0, baseline - spentThb).toFixed(2));
    const topUp = Number(cfg.topUpThb) || baseline;
    const lowThb = cfg.lowThb !== undefined && cfg.lowThb !== null ? Number(cfg.lowThb) : 10;
    const result = {
        ok: true,
        currency: cfg.currency || 'THB',
        remainingThb,
        baselineThb: baseline,
        baselineAt: cfg.baselineAt,
        topUpThb: topUp,
        spentThb: Number(spentThb.toFixed(2)),
        spentUsd: Number(usd.toFixed(4)),
        usdToThb: fx,
        calls, inputTokens: inTok, outputTokens: outTok, unpriced, lastAt,
        lowThb,
        isLow: remainingThb < lowThb,
        isEmpty: remainingThb <= 0.5,
        estimated: true
    };
    maybeCheckLowCreditAlertAsync(result);
    return result;
}

async function getProviderQuotas({ force = false } = {}) {
    const geminiCredit = await getGeminiCredit().catch(() => null);
    const [deepseek, claudeWeb] = await Promise.all([
        deepseekAgent.getDeepSeekBalance({ force, timeoutMs: 4500 }).catch((err) => ({ ok: false, error: err.message })),
        getClaudeWebQuota({ force }).catch((err) => ({ ok: false, configured: false, error: err.message }))
    ]);
    return { deepseek: deepseek || null, claudeWeb: claudeWeb || null, geminiCredit };
}

async function getQuotaSummary({ accountId = 'g1', force = false } = {}) {
    const account = aiRouter.getAgyAccountExact(accountId);
    const isPrimary = account.id === 'g1' || accountId === 'g1';
    const provPromise = isPrimary
        ? getProviderQuotas({ force })
        : Promise.resolve({ deepseek: null, claudeWeb: null });

    const tokenFile = aiRouter.agyTokenFile(account);
    if (!fs.existsSync(tokenFile)) {
        const prov = await provPromise;
        return {
            ok: false,
            account: account.id,
            accountLabel: account.label,
            email: account.email || null,
            authError: true,
            error: 'ไม่พบไฟล์ antigravity-oauth-token',
            deepseek: prov.deepseek,
            claudeWeb: prov.claudeWeb
        };
    }
    let cachedProjectInfo = cachedProjectInfoByAccount.get(account.id) || { project: null, tier: null, fetchedAt: 0 };
    try {
        let { accessToken, email, refreshFailed, expired } = await getValidAccessToken(tokenFile, false, account.home);
        if (!accessToken || (refreshFailed && expired)) {
            const prov = await provPromise;
            return {
                ok: false,
                account: account.id,
                accountLabel: account.label,
                email: email || account.email || null,
                authError: true,
                error: !accessToken ? 'ไม่พบ access_token ในไฟล์ OAuth' : 'OAuth token หมดอายุและต่ออายุไม่สำเร็จ (บัญชีอาจถูกยกเลิกหรือถูกถอดสิทธิ์)',
                deepseek: prov.deepseek,
                claudeWeb: prov.claudeWeb
            };
        }

        // Resolve project & tier via loadCodeAssist (cached for 10 minutes)
        if (!cachedProjectInfo.project || Date.now() - cachedProjectInfo.fetchedAt > 10 * 60_000) {
            let lcaRes = await postCloudCode('loadCodeAssist', accessToken, {
                metadata: { ideType: 'ANTIGRAVITY', pluginType: 'GEMINI' }
            });
            if (lcaRes.status === 401) {
                ({ accessToken, email } = await getValidAccessToken(tokenFile, true, account.home));
                lcaRes = await postCloudCode('loadCodeAssist', accessToken, {
                    metadata: { ideType: 'ANTIGRAVITY', pluginType: 'GEMINI' }
                });
            }
            if (lcaRes.ok) {
                const lcaData = await lcaRes.json();
                cachedProjectInfo = {
                    project: lcaData.cloudaicompanionProject || 'aicode-consumers',
                    tier: lcaData.currentTier?.name || lcaData.currentTier?.id || null,
                    fetchedAt: Date.now()
                };
                cachedProjectInfoByAccount.set(account.id, cachedProjectInfo);
            }
        }
        const project = cachedProjectInfo.project || 'aicode-consumers';

        let [modelsRes, summaryRes, prov] = await Promise.all([
            postCloudCode('fetchAvailableModels', accessToken, { project }),
            postCloudCode('retrieveUserQuotaSummary', accessToken, { project }),
            provPromise
        ]);

        if (modelsRes.status === 401 || summaryRes.status === 401) {
            ({ accessToken, email } = await getValidAccessToken(tokenFile, true, account.home));
            [modelsRes, summaryRes] = await Promise.all([
                postCloudCode('fetchAvailableModels', accessToken, { project }),
                postCloudCode('retrieveUserQuotaSummary', accessToken, { project })
            ]);
        }

        if (!modelsRes.ok) {
            const errTxt = await modelsRes.text().catch(() => '');
            const authError = modelsRes.status === 401 || modelsRes.status === 403 || /invalid_grant|unauthenticated|permission/i.test(errTxt);
            return {
                ok: false,
                account: account.id,
                accountLabel: account.label,
                email: email || account.email || null,
                authError,
                error: `Quota API HTTP ${modelsRes.status}: ${errTxt.slice(0, 120)}`,
                deepseek: prov.deepseek,
                claudeWeb: prov.claudeWeb
            };
        }

        const deepseekInfo = prov.deepseek;
        const claudeWebInfo = prov.claudeWeb;

        const data = await modelsRes.json();
        const summaryData = summaryRes.ok ? await summaryRes.json().catch(() => null) : null;
        const modelsObj = data.models || {};
        const models = [];

        for (const [id, info] of Object.entries(modelsObj)) {
            if (!info || !info.quotaInfo) continue;
            const pct = toPctObj(info.quotaInfo.remainingFraction, info.quotaInfo.resetTime);
            models.push({
                id,
                displayName: info.displayName || id,
                provider: info.modelProvider || info.apiProvider || null,
                apiProvider: info.apiProvider || null,
                ...pct
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

        // ── Pool definitions: ทุก pool ที่ระบบรู้จัก (data-driven, ไม่ hardcode ยอด) ──
        const POOL_DEFS = [
            {
                id: 'gemini',
                name: 'Gemini Models (Hydrogen / Flash / Pro)',
                color: '#38bdf8',
                match: m => !/argon/i.test(m.id) && (
                    /GOOGLE/i.test(m.provider || '') || m.id.startsWith('gemini-') || m.id.startsWith('chat_') || m.id.startsWith('tab_')
                )
            },
            {
                id: 'claude',
                name: 'Claude & GPT Models',
                color: '#fb923c',
                match: m => !/argon/i.test(m.id) && (
                    /claude|gpt/i.test(m.id) || /ANTHROPIC|OPENAI/i.test(m.provider || '')
                )
            },
            {
                id: 'argon',
                name: 'Gemini 4 Argon',
                color: '#a855f7',
                match: m => /argon/i.test(m.id)
            }
        ];

        const pools = [];
        const unavailablePools = [];
        const claimed = new Set();

        for (const def of POOL_DEFS) {
            const matched = models.filter(m => !claimed.has(m.id) && def.match(m));
            if (!matched.length) {
                unavailablePools.push({
                    id: def.id,
                    name: def.name,
                    color: def.color,
                    reason: 'ไม่มีโมเดลนี้ในบัญชีของคุณ (API ไม่ส่ง quota กลับมา)'
                });
                continue;
            }
            matched.forEach(m => claimed.add(m.id));
            const pool = pickPool(def.id, def.name, m => matched.includes(m), def.color);
            if (pool) pools.push(pool);
        }

        // โมเดลที่ยังไม่ถูกจัดเข้า pool ใด → แสดงเป็น pool เสริม ไม่ให้ข้อมูลหาย
        const leftovers = models.filter(m => !claimed.has(m.id));
        if (leftovers.length) {
            leftovers.forEach(m => claimed.add(m.id));
            const pool = pickPool('other', 'Other Models (Internal / Preview)', m => leftovers.includes(m), '#94a3b8');
            if (pool) pools.push(pool);
        }

        // ── Enrich pool ด้วย bucket 5h / weekly จาก retrieveUserQuotaSummary ──
        const poolById = Object.fromEntries(pools.map(p => [p.id, p]));
        const applyBuckets = (pool, group) => {
            if (!pool || !Array.isArray(group?.buckets)) return;
            const b5h = group.buckets.find(b => b.window === '5h');
            const bWk = group.buckets.find(b => b.window === 'weekly');
            if (b5h) pool.fiveHour = toPctObj(b5h.remainingFraction, b5h.resetTime);
            if (bWk) pool.weekly = toPctObj(bWk.remainingFraction, bWk.resetTime);
            const tighter = [pool.fiveHour, pool.weekly]
                .filter(Boolean)
                .reduce((a, b) => (!a || b.remainingPct < a.remainingPct ? b : a), null);
            if (tighter && tighter.remainingPct < pool.remainingPct) {
                pool.remainingPct = tighter.remainingPct;
                pool.usedPct = tighter.usedPct;
                pool.resetTime = tighter.resetTime;
            }
            pool.bucketGroup = group.displayName || null;
        };

        if (Array.isArray(summaryData?.groups) && summaryData.groups.length) {
            for (const group of summaryData.groups) {
                const desc = `${group.displayName || ''} ${group.description || ''}`.toLowerCase();
                // เลือก pool ที่มีชื่อโมเดลตรงกับคำอธิบายกลุ่มมากที่สุด
                let best = null;
                let bestScore = 0;
                for (const pool of pools) {
                    const score = (pool.models || []).reduce((acc, m) => {
                        const nm = (m.displayName || m.id || '').toLowerCase().split(' (')[0];
                        return acc + (nm && desc.includes(nm) ? 1 : 0);
                    }, 0);
                    if (score > bestScore) { bestScore = score; best = pool; }
                }
                if (!best && (group.buckets || []).some(b => (b.bucketId || '').startsWith('3p-'))) {
                    best = poolById.claude || null;
                }
                applyBuckets(best, group);
            }
        }

        // ── agy /usage: แหล่งเดียวกับหน้า "View Usage" ของแอป (มี Gemini weekly + Argon weekly ที่ API ข้างบนไม่ส่ง) ──
        const usage = await getAgyUsage(account);
        if (usage && usage.length) {
            const poolIdOf = (g) => (/argon/i.test(g) ? 'argon' : (/claude|gpt/i.test(g) ? 'claude' : (/gemini/i.test(g) ? 'gemini' : null)));
            const byPool = {};
            for (const row of usage) {
                const id = poolIdOf(row.group);
                if (!id) continue;
                (byPool[id] = byPool[id] || { group: row.group, rows: [] }).rows.push(row);
            }
            for (const [id, info] of Object.entries(byPool)) {
                let pool = pools.find((pl) => pl.id === id);
                if (!pool) {
                    pool = { id, name: info.group, color: id === 'argon' ? '#a855f7' : '#94a3b8', remainingPct: 100, usedPct: 0, resetTime: null, modelsCount: 0, models: [] };
                    pools.push(pool);
                    const ui = unavailablePools.findIndex((u) => u.id === id);
                    if (ui !== -1) unavailablePools.splice(ui, 1);
                }
                for (const row of info.rows) {
                    const w = toPctObj(row.remainingPct / 100, row.resetTime);
                    if (row.window === '5h') pool.fiveHour = w;
                    else pool.weekly = w;
                }
                const wins = [pool.fiveHour, pool.weekly].filter(Boolean);
                const tight = wins.reduce((x, y) => (!x || y.remainingPct < x.remainingPct ? y : x), null);
                if (tight) {
                    pool.remainingPct = tight.remainingPct;
                    pool.usedPct = tight.usedPct;
                    pool.resetTime = tight.resetTime;
                }
                pool.bucketGroup = info.group;
                pool.usageSource = 'agy-usage';
            }
        }

        return {
            ok: true,
            account: account.id,
            accountLabel: account.label,
            email,
            tier: cachedProjectInfo.tier,
            project,
            updatedAt: new Date().toISOString(),
            pools,
            unavailablePools,
            deepseek: deepseekInfo || null,
            claudeWeb: claudeWebInfo || null,
            geminiCredit: prov.geminiCredit || null,
            summaryGroups: summaryData?.groups || [],
            models: models.sort((a, b) => a.id.localeCompare(b.id))
        };
    } catch (err) {
        const prov = await provPromise.catch(() => ({ deepseek: null, claudeWeb: null }));
        const errMsg = String(err && err.message ? err.message : err);
        const authError = /invalid_grant|unauthorized|401|403/i.test(errMsg);
        return {
            ok: false,
            account: account.id,
            accountLabel: account.label,
            email: account.email || null,
            authError,
            error: errMsg,
            deepseek: prov.deepseek,
            claudeWeb: prov.claudeWeb
        };
    }
}

async function setClaudeSessionKey(key) {
    const cleanKey = (key || '').trim();
    if (cleanKey && cleanKey.length < 15) {
        throw new Error('sessionKey ไม่ถูกต้อง (สั้นเกินไป)');
    }
    if (!fs.existsSync(GEMINI_DIR)) {
        await fsp.mkdir(GEMINI_DIR, { recursive: true });
    }
    let lines = [];
    if (fs.existsSync(GEMINI_ENV_FILE)) {
        const raw = await fsp.readFile(GEMINI_ENV_FILE, 'utf8');
        lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('CLAUDE_SESSION_KEY='));
    }
    if (cleanKey) {
        lines.push(`CLAUDE_SESSION_KEY=${cleanKey}`);
        process.env.CLAUDE_SESSION_KEY = cleanKey;
    } else {
        delete process.env.CLAUDE_SESSION_KEY;
    }
    await fsp.writeFile(GEMINI_ENV_FILE, lines.join('\n') + '\n', { mode: 0o600 });
    claudeQuotaErrCache = null;
    if (claudeQuotaCache && claudeQuotaCache.data && claudeQuotaCache.data.source === 'sessionKey') {
        claudeQuotaCache = null;
        try { if (fs.existsSync(CLAUDE_QUOTA_CACHE_FILE)) fs.unlinkSync(CLAUDE_QUOTA_CACHE_FILE); } catch (_) {}
    }
    return { ok: true, configured: !!cleanKey };
}

function parseClaudeUsagePayload(data) {
    if (!data || typeof data !== 'object') return null;
    const now = Date.now();
    const toValidResetIso = (raw) => {
        if (!raw) return null;
        const ms = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(raw);
        if (Number.isNaN(ms) || ms <= now) return null;
        return new Date(ms).toISOString();
    };
    const root = (data.rate_limits && typeof data.rate_limits === 'object') ? data.rate_limits : data;
    const extract = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        const rawPct = obj.utilization ?? obj.percent ?? obj.used_percentage ?? obj.percentage;
        if (rawPct === undefined || rawPct === null) return null;
        const rawReset = obj.resets_at ?? obj.resetsAt;
        const resetTime = toValidResetIso(rawReset);
        const usedPct = (rawReset && !resetTime) ? 0 : Math.max(0, Math.min(100, Number(rawPct) || 0));
        return {
            usedPct: Number(usedPct.toFixed(1)),
            remainingPct: Number((100 - usedPct).toFixed(1)),
            resetTime
        };
    };

    const fiveHour = extract(root.five_hour || root.session) || (
        (data.session_percentage != null || data.five_hour_percent != null)
            ? {
                usedPct: Number(data.session_percentage ?? data.five_hour_percent) || 0,
                remainingPct: Number((100 - (Number(data.session_percentage ?? data.five_hour_percent) || 0)).toFixed(1)),
                resetTime: toValidResetIso(data.session_resets_at ?? data.five_hour_resets_at)
            }
            : null
    );

    const wkCandidates = [
        extract(root.seven_day || root.weekly),
        extract(root.seven_day_sonnet),
        extract(root.seven_day_opus)
    ].filter(Boolean);
    let weekly = wkCandidates.length > 0
        ? (wkCandidates[0].usedPct > 0 ? wkCandidates[0] : wkCandidates.reduce((a, b) => (b.usedPct > a.usedPct ? b : a), wkCandidates[0]))
        : null;
    if (!weekly && (data.weekly_percentage != null || data.seven_day_percent != null)) {
        const u = Number(data.weekly_percentage ?? data.seven_day_percent) || 0;
        weekly = {
            usedPct: u,
            remainingPct: Number((100 - u).toFixed(1)),
            resetTime: toValidResetIso(data.weekly_resets_at ?? data.seven_day_resets_at)
        };
    }

    if (!fiveHour && !weekly) return null;
    return { fiveHour, weekly };
}

// ── Claude.ai subscription quota ─────────────────────────────────────────────
// Sources (in order): 1) Claude Code CLI OAuth (monthly plan) 2) manual sessionKey cookie
const CLAUDE_QUOTA_CACHE_FILE = path.join(GEMINI_DIR, 'claude-quota-cache.json');
const CLAUDE_QUOTA_OK_TTL_MS = 5 * 60 * 1000;   // reuse a good reading for 5 minutes
const CLAUDE_QUOTA_ERR_TTL_MS = 60 * 1000;      // back off for 1 minute after a failure
const CLAUDE_QUOTA_STALE_MAX_MS = 2 * 60 * 60 * 1000; // max 2h stale fallback for transient errors
let claudeQuotaCache = (() => {
    try {
        if (fs.existsSync(CLAUDE_QUOTA_CACHE_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(CLAUDE_QUOTA_CACHE_FILE, 'utf8'));
            if (parsed && parsed.data && parsed.data.ok) return parsed;
        }
    } catch (_) {}
    return null;
})();
let claudeQuotaErrCache = null;   // { at, data } last failure (to avoid hammering Anthropic)

function hasPaidClaudePlan(subType) {
    return /^(pro|max|team|enterprise)/i.test(String(subType || '').trim());
}

function clearClaudeQuotaCache() {
    claudeQuotaCache = null;
    try { if (fs.existsSync(CLAUDE_QUOTA_CACHE_FILE)) fs.unlinkSync(CLAUDE_QUOTA_CACHE_FILE); } catch (_) {}
}

function readClaudeOAuthCreds() {
    try {
        const credFile = path.join(HOME_DIR, '.claude', '.credentials.json');
        if (!fs.existsSync(credFile)) {
            return { configured: false, error: 'ไม่พบ ~/.claude/.credentials.json (ยังไม่ได้ล็อกอิน Claude Code)' };
        }
        const mtimeMs = fs.statSync(credFile).mtimeMs || 0;
        const creds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        const oauth = creds.claudeAiOauth || creds;
        if (!oauth || !oauth.accessToken) {
            return { configured: false, mtimeMs, error: 'ไม่พบ accessToken ใน .credentials.json' };
        }
        const subType = oauth.subscriptionType;
        if (subType !== undefined && !hasPaidClaudePlan(subType)) {
            return {
                oauth,
                mtimeMs,
                configured: false,
                unsubscribed: true,
                subscriptionType: subType || 'free',
                error: 'บัญชี Claude ไม่ได้สมัครแพ็กเกจ Pro/Max (ระบบข้ามอัตโนมัติ)'
            };
        }
        return { oauth, mtimeMs, accessToken: oauth.accessToken, configured: true };
    } catch (err) {
        return { configured: false, error: 'อ่าน Claude credentials ไม่สำเร็จ: ' + err.message };
    }
}

function getClaudeCodeAvailability() {
    if (!fs.existsSync(CLAUDE_BIN)) {
        return { ready: false, reason: 'ไม่พบ Claude Code CLI (/home/dev/.local/bin/claude)' };
    }
    const creds = readClaudeOAuthCreds();
    if (!creds.accessToken) {
        return { ready: false, reason: creds.error || 'ยังไม่ได้ล็อกอินหรือยกเลิกแพ็กเกจ Claude Pro' };
    }
    if (claudeQuotaErrCache && Date.now() - claudeQuotaErrCache.at < 15 * 60 * 1000) {
        const d = claudeQuotaErrCache.data || {};
        if (d.authError && claudeQuotaErrCache.at >= (creds.mtimeMs || 0)) {
            return { ready: false, reason: d.error || 'บัญชี Claude Pro หมดอายุหรือถูกปฏิเสธสิทธิ์' };
        }
    }
    return { ready: true, plan: (creds.oauth && creds.oauth.subscriptionType) || 'pro' };
}

async function refreshClaudeOAuthIfNeeded(creds, forceRefresh = false) {
    if (!creds || !creds.oauth || !fs.existsSync(CLAUDE_BIN)) return creds;
    const exp = Number(creds.oauth.expiresAt || 0);
    const nearExpiry = exp > 0 && (exp - Date.now() < 60_000);
    if (!forceRefresh && !nearExpiry) return creds;
    try {
        await execFileAsync(CLAUDE_BIN, ['auth', 'status'], { timeout: 8000 });
        return readClaudeOAuthCreds();
    } catch (_) {
        return creds;
    }
}

async function fetchClaudeOAuthUsage(accessToken) {
    let lastErr = null;
    let status = 0;
    let transient = true;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const uRes = await fetch('https://api.anthropic.com/api/oauth/usage', {
                headers: {
                    'Authorization': 'Bearer ' + accessToken,
                    'anthropic-beta': 'oauth-2025-04-20',
                    'Accept': 'application/json',
                    'User-Agent': 'claude-cli/2.1.312 (external, cli)'
                },
                signal: AbortSignal.timeout(6000)
            });
            status = uRes.status;
            const bodyText = await uRes.text();
            if (uRes.ok) {
                let uData = null;
                try { uData = JSON.parse(bodyText); } catch (_) { uData = null; }
                const parsed = parseClaudeUsagePayload(uData);
                if (parsed) return { ok: true, parsed };
                lastErr = 'Anthropic API ตอบกลับแต่ไม่มีข้อมูล rate limit ที่อ่านได้';
                transient = false;
                break;
            }
            if (uRes.status === 429) {
                lastErr = 'Anthropic API จำกัดความถี่คำขอ (HTTP 429) — จะลองใหม่ใน 1 นาที';
                transient = true;
                break;
            }
            if (uRes.status === 401 || uRes.status === 403) {
                lastErr = 'OAuth token ถูกปฏิเสธหรือหมดสิทธิ์แพ็กเกจ (HTTP ' + uRes.status + ')';
                transient = false;
                break;
            }
            lastErr = 'Anthropic API HTTP ' + uRes.status;
            transient = uRes.status >= 500;
        } catch (err) {
            lastErr = err.name === 'TimeoutError' ? 'เชื่อมต่อ Anthropic API หมดเวลา (6s)' : err.message;
            transient = true;
        }
        if (attempt === 0) await new Promise(r => setTimeout(r, 800));
    }
    return { ok: false, status, transient, authError: status === 401 || status === 403, error: lastErr };
}

async function getClaudeWebQuota(opts) {
    const force = !!(opts && opts.force);
    const now = Date.now();

    // Serve fresh cache first (avoids Anthropic rate limits from UI polling)
    if (!force && claudeQuotaCache && now - claudeQuotaCache.at < CLAUDE_QUOTA_OK_TTL_MS) {
        const credsNow = readClaudeOAuthCreds();
        if (!credsNow.unsubscribed) {
            return Object.assign({}, claudeQuotaCache.data, {
                cached: true,
                ageSec: Math.round((now - claudeQuotaCache.at) / 1000)
            });
        }
    }
    if (!force && claudeQuotaErrCache && now - claudeQuotaErrCache.at < CLAUDE_QUOTA_ERR_TTL_MS) {
        return claudeQuotaErrCache.data;
    }

    const succeed = (payload) => {
        const data = Object.assign({ fetchedAt: new Date().toISOString() }, payload);
        claudeQuotaCache = { at: Date.now(), data };
        claudeQuotaErrCache = null;
        try {
            fs.writeFileSync(CLAUDE_QUOTA_CACHE_FILE, JSON.stringify(claudeQuotaCache, null, 2), 'utf8');
        } catch (_) {}
        return Object.assign({}, data, { cached: false });
    };
    const fail = (payload) => {
        const data = Object.assign({ ok: false, configured: true }, payload);
        claudeQuotaErrCache = { at: Date.now(), data };
        return data;
    };
    const staleOr = (error, { allowStale = true, authError = false, transient = false } = {}) => {
        if (!allowStale || authError) {
            clearClaudeQuotaCache();
            return fail({ error, authError, transient: false });
        }
        if (claudeQuotaCache && (Date.now() - claudeQuotaCache.at) < CLAUDE_QUOTA_STALE_MAX_MS) {
            return Object.assign({}, claudeQuotaCache.data, {
                cached: true,
                stale: true,
                warning: error,
                ageSec: Math.round((Date.now() - claudeQuotaCache.at) / 1000)
            });
        }
        return fail({ error, authError: false, transient });
    };

    // ── Source 1: Claude Code CLI OAuth (Claude.ai monthly subscription) ──
    let creds = await refreshClaudeOAuthIfNeeded(readClaudeOAuthCreds(), false);
    if (creds.accessToken) {
        let res = await fetchClaudeOAuthUsage(creds.accessToken);
        if (!res.ok && res.status === 401) {
            creds = await refreshClaudeOAuthIfNeeded(creds, true);
            if (creds.accessToken) {
                res = await fetchClaudeOAuthUsage(creds.accessToken);
            }
        }
        if (res.ok) {
            return succeed({
                ok: true,
                configured: true,
                source: 'oauth',
                orgName: 'Claude.ai (OAuth · Claude Code)',
                plan: (creds.oauth && creds.oauth.subscriptionType) || 'pro',
                fiveHour: res.parsed.fiveHour,
                weekly: res.parsed.weekly
            });
        }
        if (!creds.unsubscribed) {
            return staleOr(res.error, { allowStale: res.transient, authError: res.authError, transient: res.transient });
        }
    }

    // ── Source 2: manual CLAUDE_SESSION_KEY cookie fallback ──
    const sessionKey = (process.env.CLAUDE_SESSION_KEY || '').trim();
    if (!sessionKey) {
        clearClaudeQuotaCache();
        const data = {
            ok: false,
            configured: false,
            unsubscribed: Boolean(creds.unsubscribed),
            plan: creds.subscriptionType || null,
            error: creds.error || 'ยังไม่ได้เชื่อมต่อ Claude.ai'
        };
        claudeQuotaErrCache = { at: Date.now(), data };
        return data;
    }
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': 'sessionKey=' + sessionKey,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    };
    try {
        const orgRes = await fetch('https://claude.ai/api/organizations', {
            headers,
            signal: AbortSignal.timeout(8000)
        });
        if (orgRes.status === 401 || orgRes.status === 403) {
            return staleOr('Cookie sessionKey หมดอายุหรือถูกปฏิเสธ (HTTP ' + orgRes.status + ')', { allowStale: false, authError: true });
        }
        if (!orgRes.ok) {
            return staleOr('claude.ai HTTP ' + orgRes.status, { allowStale: orgRes.status >= 500 || orgRes.status === 429, transient: true });
        }
        const orgText = await orgRes.text();
        if (/^\s*<(!doctype|html)/i.test(orgText)) {
            return staleOr('Cloudflare Block (ดึงจากเซิร์ฟเวอร์ตรงไม่ได้)', { allowStale: true, transient: true });
        }
        const orgs = JSON.parse(orgText);
        if (!Array.isArray(orgs) || orgs.length === 0) {
            return staleOr('ไม่พบ Organization ในบัญชี Claude', { allowStale: false });
        }
        const scoreOrg = (org) => {
            let s = 0;
            const caps = Array.isArray(org && org.capabilities) ? org.capabilities.join(' ').toLowerCase() : '';
            if (caps.includes('claude_max') || caps.includes('max')) s += 40;
            if (caps.includes('claude_pro') || caps.includes('pro')) s += 30;
            if (caps.includes('chat')) s += 20;
            return s;
        };
        const sorted = [].concat(orgs).sort((a, b) => scoreOrg(b) - scoreOrg(a));
        let lastErr = null;
        for (const org of sorted.slice(0, 4)) {
            if (!org || !org.uuid) continue;
            const uRes = await fetch('https://claude.ai/api/organizations/' + org.uuid + '/usage', {
                headers,
                signal: AbortSignal.timeout(8000)
            });
            if (!uRes.ok) {
                lastErr = 'claude.ai usage HTTP ' + uRes.status;
                continue;
            }
            const uText = await uRes.text();
            if (/^\s*<(!doctype|html)/i.test(uText)) {
                lastErr = 'Cloudflare Block';
                continue;
            }
            let uJson = null;
            try { uJson = JSON.parse(uText); } catch (_) { uJson = null; }
            const parsed = parseClaudeUsagePayload(uJson);
            if (parsed) {
                const caps = Array.isArray(org.capabilities) ? org.capabilities : [];
                return succeed({
                    ok: true,
                    configured: true,
                    source: 'sessionKey',
                    orgName: org.name || 'Claude.ai',
                    plan: caps.find(c => /max|pro/i.test(c)) || 'Claude',
                    fiveHour: parsed.fiveHour,
                    weekly: parsed.weekly
                });
            }
        }
        return staleOr(lastErr || 'ไม่พบข้อมูล Usage ในองค์กรนี้', { allowStale: true, transient: true });
    } catch (err) {
        return staleOr(err.message, { allowStale: true, transient: true });
    }
}

// ── Quota Limit Recovery: Auto-Resume & Model Handoff ────────────────────────
function engineOfModel(model) {
    const m = String(model || '');
    if (m.startsWith('claude-code-')) return 'claude-code';
    if (deepseekAgent.isDeepSeekModel(m)) return 'deepseek';
    if (m === aiRouter.AUTO_MODEL_ID) return 'auto';
    return 'agy';
}

function saveAutoResumeStoreSync() {
    try {
        fs.mkdirSync(GEMINI_DIR, { recursive: true });
        const arr = [...autoResumeMap.values()].filter((r) => r && r.sessionId);
        fs.writeFileSync(AUTO_RESUME_FILE, JSON.stringify(arr, null, 2), { mode: 0o600 });
    } catch (e) {
        console.error('[GeminiManager] saveAutoResumeStoreSync error:', e.message);
    }
}

function loadAutoResumeStoreSync() {
    if (process.env.GEMINI_NO_QUEUE_AUTORUN === '1') return;
    try {
        if (!fs.existsSync(AUTO_RESUME_FILE)) return;
        const raw = JSON.parse(fs.readFileSync(AUTO_RESUME_FILE, 'utf8'));
        if (!Array.isArray(raw)) return;
        const now = Date.now();
        let restored = 0;
        for (const rec of raw) {
            if (!rec || !rec.sessionId) continue;
            // Prune stale records older than 24 hours
            if (rec.createdAt && (now - rec.createdAt) > 24 * 3600 * 1000) continue;
            autoResumeMap.set(rec.sessionId, rec);
            if (rec.armed) {
                restored++;
                scheduleAutoResumeTimer(rec);
            }
        }
        if (restored > 0) {
            console.log(`[GeminiManager] Restored ${restored} armed auto-resume task(s) from disk`);
        }
    } catch (e) {
        console.error('[GeminiManager] loadAutoResumeStoreSync error:', e.message);
    }
}

function clearAutoResumeTimer(sessionId) {
    const t = autoResumeTimers.get(sessionId);
    if (t) {
        clearTimeout(t);
        autoResumeTimers.delete(sessionId);
    }
}

function clearRecoveryForSession(sessionId) {
    if (!sessionId) return;
    clearAutoResumeTimer(sessionId);
    if (autoResumeMap.has(sessionId)) {
        autoResumeMap.delete(sessionId);
        saveAutoResumeStoreSync();
    }
}

function sanitizeRecoveryForClient(rec) {
    if (!rec) return null;
    return {
        sessionId: rec.sessionId,
        jobId: rec.jobId,
        model: rec.model,
        modelLabel: rec.modelLabel || aiRouter.modelLabel(rec.model),
        agyAccount: rec.agyAccount || null,
        engine: rec.engine,
        isQuotaLimit: Boolean(rec.isQuotaLimit),
        stepsCount: Array.isArray(rec.steps) ? rec.steps.length : 0,
        steps: Array.isArray(rec.steps) ? rec.steps.slice(-15) : [],
        errorText: rec.errorText || '',
        armed: Boolean(rec.armed),
        resumeAt: rec.resumeAt || null,
        resetSource: rec.resetSource || null,
        retryCount: rec.retryCount || 0,
        lastCheckMsg: rec.lastCheckMsg || null,
        createdAt: rec.createdAt || Date.now(),
        updatedAt: rec.updatedAt || Date.now()
    };
}

function getRecoveryState(sessionId) {
    const sid = resolveSessionId(sessionId);
    const rec = autoResumeMap.get(sid);
    return rec ? sanitizeRecoveryForClient(rec) : null;
}

function parseResetTimeFromText(text) {
    const raw = String(text || '');
    if (!raw) return null;
    const now = Date.now();
    const bufferMs = 45 * 1000;

    // 1) Explicit ISO timestamp
    const isoMatch = raw.match(/resets?(?:\s+at)?\s+(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)/i);
    if (isoMatch) {
        const ms = Date.parse(isoMatch[1]);
        if (!Number.isNaN(ms) && ms > now && (ms - now) <= 8 * 24 * 3600 * 1000) {
            return { resumeAt: ms + bufferMs, source: 'error_text' };
        }
    }

    // 2) Relative duration: "try again in 45 minutes" / "resets in 2 hours 15 minutes"
    const relMatch = raw.match(/(?:resets?|try again|wait|available)\s+(?:in\s+)?(?:(\d+)\s*(?:hours?|hrs?|h)\s*)?(?:(\d+)\s*(?:minutes?|mins?|m)\s*)?(?:(\d+)\s*(?:seconds?|secs?|s))?/i);
    if (relMatch && (relMatch[1] || relMatch[2] || relMatch[3])) {
        const ms = ((Number(relMatch[1] || 0) * 3600) + (Number(relMatch[2] || 0) * 60) + Number(relMatch[3] || 0)) * 1000;
        if (ms >= 5000 && ms <= 24 * 3600 * 1000) {
            return { resumeAt: now + ms + bufferMs, source: 'error_text' };
        }
    }

    // 3) Clock time: "resets 6am (Asia/Bangkok)" or "resets 14:30" or "resets at 11:15pm"
    const clkMatch = raw.match(/resets?(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i);
    if (clkMatch) {
        let hour = Number(clkMatch[1]);
        const min = Number(clkMatch[2] || 0);
        const ampm = clkMatch[3] ? clkMatch[3].toLowerCase() : null;
        const tz = clkMatch[4] ? clkMatch[4].trim() : '';
        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        if (hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
            const d = new Date(now);
            if (/utc|gmt/i.test(tz)) {
                d.setUTCHours(hour, min, 0, 0);
            } else {
                d.setHours(hour, min, 0, 0);
            }
            let targetMs = d.getTime();
            if (targetMs <= now) targetMs += 24 * 3600 * 1000;
            if (targetMs > now && (targetMs - now) <= 25 * 3600 * 1000) {
                return { resumeAt: targetMs + bufferMs, source: 'error_text' };
            }
        }
    }

    return null;
}

async function resolveQuotaResetTime({ engine, model, agyAccount, errorText, outputText, stderrText }) {
    const combined = [errorText, stderrText, String(outputText || '').slice(-1500)].filter(Boolean).join('\n');
    const parsedFromText = parseResetTimeFromText(combined);
    const now = Date.now();
    const bufferMs = 45 * 1000;

    try {
        if (engine === 'claude-code') {
            const cw = await Promise.race([
                getClaudeWebQuota({ force: true }),
                new Promise((resolve) => setTimeout(() => resolve(null), 3500))
            ]);
            if (cw && cw.ok) {
                const fh = cw.fiveHour;
                const wk = cw.weekly;
                const pick = (fh && fh.remainingPct <= 5 && fh.resetTime)
                    ? fh.resetTime
                    : ((wk && wk.remainingPct <= 5 && wk.resetTime) ? wk.resetTime : (fh && fh.resetTime));
                if (pick) {
                    const ms = Date.parse(pick);
                    if (!Number.isNaN(ms) && ms > now) {
                        return { resumeAt: ms + bufferMs, source: 'quota_api' };
                    }
                }
            }
        } else if (engine === 'agy') {
            const q = await Promise.race([
                getQuotaSummary({ accountId: agyAccount || 'g1' }),
                new Promise((resolve) => setTimeout(() => resolve(null), 3500))
            ]);
            if (q && q.ok && Array.isArray(q.pools)) {
                const pid = aiRouter.agyPoolId(model || '');
                const pool = q.pools.find((p) => p.id === pid) || q.pools[0];
                const rt = (pool && pool.fiveHour && pool.fiveHour.resetTime) || (pool && pool.resetTime);
                if (rt) {
                    const ms = Date.parse(rt);
                    if (!Number.isNaN(ms) && ms > now) {
                        return { resumeAt: ms + bufferMs, source: 'quota_api' };
                    }
                }
            }
        }
    } catch (_) {}

    return parsedFromText || { resumeAt: null, source: 'poll' };
}

function scheduleAutoResumeTimer(rec) {
    if (!rec || !rec.sessionId) return;
    clearAutoResumeTimer(rec.sessionId);
    if (!rec.armed) return;

    const now = Date.now();
    // Cap polling lifetime at 12h if reset time is unknown
    if (!rec.resumeAt && rec.createdAt && (now - rec.createdAt) > 12 * 3600 * 1000) {
        rec.armed = false;
        rec.lastCheckMsg = 'หมดเวลาเฝ้ารอปลดลิมิตอัตโนมัติ (12 ชม.)';
        saveAutoResumeStoreSync();
        return;
    }

    let delay;
    if (rec.resumeAt) {
        const remaining = rec.resumeAt - now;
        if (remaining <= 0) {
            delay = 3000;
        } else {
            // Wake every <= 5 minutes so system sleep or long setTimeout limits never miss target
            delay = Math.min(remaining, 5 * 60 * 1000);
        }
    } else {
        delay = 3 * 60 * 1000; // poll every 3 min when reset time is unknown
    }

    const timer = setTimeout(() => {
        autoResumeTimers.delete(rec.sessionId);
        onAutoResumeTick(rec.sessionId).catch((err) => {
            console.error(`[GeminiManager] Auto-resume tick error [${rec.sessionId}]:`, err.message);
        });
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    autoResumeTimers.set(rec.sessionId, timer);
}

async function checkQuotaRecovered(rec) {
    try {
        if (rec.engine === 'claude-code') {
            const cw = await getClaudeWebQuota({ force: true });
            if (cw && cw.ok && cw.fiveHour) {
                if (cw.fiveHour.remainingPct <= 2) {
                    return {
                        ready: false,
                        nextResumeAt: cw.fiveHour.resetTime ? (Date.parse(cw.fiveHour.resetTime) + 45 * 1000) : (Date.now() + 90 * 1000),
                        msg: `โควตา Claude 5h ยังอยู่ที่ ${cw.fiveHour.remainingPct}%`
                    };
                }
                return { ready: true };
            }
            // If quota API unreachable and resumeAt has elapsed, go ahead and try
            return { ready: Boolean(rec.resumeAt && Date.now() >= rec.resumeAt) };
        }
        if (rec.engine === 'agy') {
            const q = await getQuotaSummary({ accountId: rec.agyAccount || 'g1' });
            if (q && q.ok && Array.isArray(q.pools)) {
                const pid = aiRouter.agyPoolId(rec.model || '');
                const pool = q.pools.find((p) => p.id === pid);
                if (pool && pool.remainingPct <= 2) {
                    const rt = (pool.fiveHour && pool.fiveHour.resetTime) || pool.resetTime;
                    return {
                        ready: false,
                        nextResumeAt: rt ? (Date.parse(rt) + 45 * 1000) : (Date.now() + 2 * 60 * 1000),
                        msg: `โควตา ${pool.name} ยังอยู่ที่ ${pool.remainingPct}%`
                    };
                }
                return { ready: true };
            }
            return { ready: Boolean(rec.resumeAt && Date.now() >= rec.resumeAt) };
        }
        if (rec.engine === 'auto') {
            const alt = await aiRouter.pickAlternativeCandidates({ prompt: rec.prompt, sessionId: rec.sessionId });
            if (alt && alt.ok && alt.candidates.length > 0) return { ready: true };
            return { ready: false, nextResumeAt: Date.now() + 3 * 60 * 1000, msg: 'ยังไม่มีโมเดลที่พร้อมใช้งาน' };
        }
    } catch (_) {}
    return { ready: Boolean(rec.resumeAt && Date.now() >= rec.resumeAt) };
}

function buildRecoveryDirective({ originalPrompt, failedModelLabel, steps, partialOutput, errorText, isAutoResume }) {
    const stepList = Array.isArray(steps) && steps.length > 0
        ? steps.slice(-20).map((s, i) => `${i + 1}. ${s}`).join('\n')
        : '(ยังไม่มีการใช้เครื่องมือ หรือยังไม่บันทึกขั้นตอน)';
    const tail = String(partialOutput || '').trim().slice(-1500);
    const header = isAutoResume
        ? '[⏱️ Auto-Resume หลังปลดลิมิตโควตา]'
        : '[🔄 ส่งไม้ต่อจากโมเดลก่อนหน้าที่หยุดกลางคัน]';
    const lines = [
        header,
        `โมเดลก่อนหน้า: ${failedModelLabel}${errorText ? ` (หยุดเพราะ: ${String(errorText).replace(/\s+/g, ' ').slice(0, 140)})` : ''}`,
        '',
        'คำสั่งเดิมของผู้ใช้:',
        String(originalPrompt || '').slice(0, 3000),
        '',
        `สิ่งที่ทำไปแล้วในรอบก่อน (${Array.isArray(steps) ? steps.length : 0} ขั้นตอน):`,
        stepList
    ];
    if (tail) {
        lines.push('', 'ผลลัพธ์ล่าสุดก่อนหยุด:', tail);
    }
    lines.push(
        '',
        'แนวทางสำคัญ:',
        '- ตรวจสอบสถานะไฟล์/ระบบปัจจุบันก่อนลงมือแก้ไข เพื่อไม่ให้ทำซ้ำหรือทับงานที่ทำเสร็จไปแล้ว',
        '- ดำเนินการต่อจากจุดที่ค้างอยู่ให้เสร็จสมบูรณ์'
    );
    return lines.join('\n');
}

async function onAutoResumeTick(sessionId) {
    const rec = autoResumeMap.get(sessionId);
    if (!rec || !rec.armed) return;

    const now = Date.now();
    if (rec.resumeAt && now < rec.resumeAt) {
        scheduleAutoResumeTimer(rec);
        return;
    }

    if (activeRuns.has(sessionId)) {
        // Room is busy; re-check shortly
        rec.resumeAt = now + 15 * 1000;
        scheduleAutoResumeTimer(rec);
        return;
    }

    const chk = await checkQuotaRecovered(rec);
    if (!chk.ready) {
        if (rec.resumeAt) {
            rec.retryCount = (rec.retryCount || 0) + 1;
            if (rec.retryCount > 8) {
                rec.armed = false;
                rec.lastCheckMsg = chk.msg || 'โควตายังไม่รีเซ็ตหลังตรวจสอบซ้ำ 8 ครั้ง — กรุณากดทำต่อด้วยโมเดลอื่นหรือส่งคำสั่งใหม่';
                rec.updatedAt = Date.now();
                saveAutoResumeStoreSync();
                return;
            }
        }
        rec.resumeAt = chk.nextResumeAt || (Date.now() + 3 * 60 * 1000);
        rec.lastCheckMsg = chk.msg || null;
        rec.updatedAt = Date.now();
        saveAutoResumeStoreSync();
        scheduleAutoResumeTimer(rec);
        return;
    }

    // Quota recovered! Trigger resume now
    autoResumeMap.delete(sessionId);
    saveAutoResumeStoreSync();
    aiRouter.clearCooldowns();

    const sessMeta = getSessionMetaSync(sessionId);
    const failedLabel = rec.modelLabel || aiRouter.modelLabel(rec.model);
    const directive = buildRecoveryDirective({
        originalPrompt: rec.prompt,
        failedModelLabel: failedLabel,
        steps: rec.steps,
        partialOutput: rec.partialOutput,
        errorText: rec.errorText,
        isAutoResume: true
    });
    const resumePrompt = `⏱️ [Auto-Resume หลังปลดลิมิต] โควตา ${failedLabel} รีเซ็ตแล้ว — ดำเนินการต่อจากจุดที่ค้างให้เสร็จสมบูรณ์`;

    console.log(`[GeminiManager] Auto-resuming session ${sessionId} on ${rec.model} (${rec.agyAccount || 'default'})`);
    try {
        executePrompt(
            {
                sessionId,
                prompt: resumePrompt,
                images: Array.isArray(rec.images) ? rec.images : [],
                mode: rec.mode || (sessMeta && sessMeta.mode) || 'exec',
                cwd: rec.cwd || (sessMeta && sessMeta.cwd) || PROJECTS_BASE,
                model: rec.model,
                agyAccount: rec.engine === 'agy' ? rec.agyAccount : null,
                routerDirective: directive,
                fromRecovery: true
            },
            () => {},
            () => {}
        );
    } catch (err) {
        console.error(`[GeminiManager] Auto-resume launch failed [${sessionId}]:`, err.message);
    }
}

async function finalizeFailedJobRecovery(job, { isAuto = false, stderrTail = '' } = {}) {
    if (!job || !job.sessionId) return null;
    const sid = job.sessionId;
    if (job.status === 'aborted' || job.exitCode === 130 || job.exitCode === 0) return null;

    const errText = String(job.error || '');
    const rawOut = String(job.output || '');
    const body = job._routeBannerLen ? rawOut.slice(job._routeBannerLen) : rawOut;
    const isQuotaLimit = aiRouter.isQuotaOrLimitError(errText, body, stderrTail);
    const steps = Array.isArray(job.steps) ? job.steps : [];

    if (!isQuotaLimit && steps.length === 0) return null;

    const failedModel = job.usedModel || job.model || getDefaultModel();
    const failedEngine = engineOfModel(failedModel);
    const failedAccount = job.usedAccount || job.agyAccount || (failedEngine === 'claude-code' ? 'claude-pro' : null);

    let resetInfo = { resumeAt: null, source: null };
    if (isQuotaLimit) {
        resetInfo = await resolveQuotaResetTime({
            engine: failedEngine,
            model: failedModel,
            agyAccount: failedAccount,
            errorText: errText,
            outputText: body,
            stderrText: stderrTail
        });
    }

    const now = Date.now();
    const rec = {
        sessionId: sid,
        jobId: job.id,
        model: failedModel,
        modelLabel: failedModel === aiRouter.AUTO_MODEL_ID ? 'Auto (ทุกโมเดล)' : aiRouter.modelLabel(failedModel),
        agyAccount: failedAccount,
        engine: failedEngine,
        mode: job.mode || 'exec',
        cwd: job.cwd || PROJECTS_BASE,
        prompt: job.prompt || '',
        images: Array.isArray(job.images) ? job.images : [],
        steps: steps.slice(-30),
        partialOutput: body.slice(-2500),
        errorText: errText.slice(0, 300),
        isQuotaLimit,
        isAuto,
        armed: Boolean(isQuotaLimit),
        resumeAt: resetInfo ? resetInfo.resumeAt : null,
        resetSource: resetInfo ? resetInfo.source : null,
        retryCount: 0,
        lastCheckMsg: null,
        createdAt: now,
        updatedAt: now
    };

    autoResumeMap.set(sid, rec);
    saveAutoResumeStoreSync();
    if (rec.armed) {
        scheduleAutoResumeTimer(rec);
    }

    const clientRec = sanitizeRecoveryForClient(rec);
    job.recovery = clientRec;
    return clientRec;
}

async function getHandoffOptions(sessionId) {
    const sid = resolveSessionId(sessionId);
    const rec = autoResumeMap.get(sid) || null;
    const job = lastJobs.get(sid) || null;
    const promptText = (rec && rec.prompt) || (job && job.prompt) || '';
    const hasImages = Boolean((rec && rec.images && rec.images.length) || (job && job.images && job.images.length));
    const exModel = (rec && rec.model) || (job && (job.usedModel || job.model)) || null;
    const exEngine = (rec && rec.engine) || (exModel ? engineOfModel(exModel) : null);
    const exAccount = (rec && rec.agyAccount) || (job && (job.usedAccount || job.agyAccount)) || null;

    const alt = await aiRouter.pickAlternativeCandidates({
        prompt: promptText,
        hasImages,
        excludeEngine: exEngine === 'auto' ? null : exEngine,
        excludeModel: exModel === aiRouter.AUTO_MODEL_ID ? null : exModel,
        excludeAccount: exAccount,
        sessionId: sid
    });

    return {
        ok: true,
        recovery: rec ? sanitizeRecoveryForClient(rec) : null,
        candidates: alt.candidates || []
    };
}

function cancelAutoResume(sessionId) {
    const sid = resolveSessionId(sessionId);
    clearAutoResumeTimer(sid);
    const rec = autoResumeMap.get(sid);
    if (!rec) return { ok: true, recovery: null };
    rec.armed = false;
    rec.updatedAt = Date.now();
    saveAutoResumeStoreSync();
    const lj = lastJobs.get(sid);
    const clientRec = sanitizeRecoveryForClient(rec);
    if (lj) lj.recovery = clientRec;
    return { ok: true, recovery: clientRec };
}

async function armAutoResume(sessionId) {
    const sid = resolveSessionId(sessionId);
    const rec = autoResumeMap.get(sid);
    if (!rec) throw new Error('ไม่พบงานที่หยุดชั่วคราวในห้องแชทนี้');
    rec.armed = true;
    rec.retryCount = 0;
    rec.lastCheckMsg = null;
    if (!rec.resumeAt || rec.resumeAt <= Date.now()) {
        const resetInfo = await resolveQuotaResetTime({
            engine: rec.engine,
            model: rec.model,
            agyAccount: rec.agyAccount,
            errorText: rec.errorText,
            outputText: rec.partialOutput,
            stderrText: ''
        });
        rec.resumeAt = resetInfo ? resetInfo.resumeAt : null;
        rec.resetSource = resetInfo ? resetInfo.source : 'poll';
    }
    rec.updatedAt = Date.now();
    saveAutoResumeStoreSync();
    scheduleAutoResumeTimer(rec);
    const lj = lastJobs.get(sid);
    const clientRec = sanitizeRecoveryForClient(rec);
    if (lj) lj.recovery = clientRec;
    return { ok: true, recovery: clientRec };
}

function dismissRecovery(sessionId) {
    const sid = resolveSessionId(sessionId);
    clearRecoveryForSession(sid);
    const lj = lastJobs.get(sid);
    if (lj) lj.recovery = null;
    return { ok: true };
}

async function handoffToAnotherModel({ sessionId = null, jobId = null, targetModel = 'best', targetAccount = null, browserVision = false } = {}, onChunk, onDone) {
    const sid = resolveSessionId(sessionId);
    if (activeRuns.has(sid)) {
        throw new Error('แชทนี้กำลังประมวลผลอยู่ กรุณารอสักครู่');
    }

    const rec = autoResumeMap.get(sid) || null;
    const lj = lastJobs.get(sid) || null;
    const sessMeta = getSessionMetaSync(sid);
    const hist = loadSessionMessagesSync(sid);
    const lastUser = [...hist].reverse().find((m) => m && m.role === 'user' && m.content);

    const originalPrompt = (rec && rec.prompt) || (lj && lj.prompt) || (lastUser && lastUser.content) || '';
    if (!originalPrompt) {
        throw new Error('ไม่พบคำสั่งเดิมสำหรับส่งต่อให้โมเดลอื่น');
    }
    const images = (rec && rec.images) || (lj && lj.images) || [];
    const failedModel = (rec && rec.model) || (lj && (lj.usedModel || lj.model)) || (sessMeta && sessMeta.model) || '';
    const failedEngine = (rec && rec.engine) || engineOfModel(failedModel);
    const failedAccount = (rec && rec.agyAccount) || (lj && (lj.usedAccount || lj.agyAccount)) || null;
    const failedLabel = (rec && rec.modelLabel) || (failedModel ? aiRouter.modelLabel(failedModel) : 'โมเดลก่อนหน้า');

    let chosenModel = (targetModel && targetModel !== 'best') ? String(targetModel) : null;
    let chosenAccount = targetAccount || null;

    if (!chosenModel) {
        const alt = await aiRouter.pickAlternativeCandidates({
            prompt: originalPrompt,
            hasImages: images.length > 0,
            excludeEngine: failedEngine === 'auto' ? null : failedEngine,
            excludeModel: failedModel === aiRouter.AUTO_MODEL_ID ? null : failedModel,
            excludeAccount: failedAccount,
            sessionId: sid
        });
        if (!alt.ok || !alt.candidates.length) {
            throw new Error('ยังไม่มีโมเดลสำรองที่พร้อมใช้งานในขณะนี้ (โควตา/เครดิตทุกตัวอาจยังไม่พอ)');
        }
        chosenModel = alt.candidates[0].model;
        chosenAccount = alt.candidates[0].engine === 'agy' ? alt.candidates[0].account : null;
    }

    // Disarm & clear pending recovery before starting handoff
    clearRecoveryForSession(sid);
    if (lj) lj.recovery = null;

    if (sessMeta) {
        sessMeta.needsAgyBridge = true;
        sessMeta.needsClaudeBridge = true;
        saveSessionsIndexSync();
    }

    const chosenLabel = aiRouter.modelLabel(chosenModel);
    const directive = buildRecoveryDirective({
        originalPrompt,
        failedModelLabel: failedLabel,
        steps: (rec && rec.steps) || (lj && lj.steps) || [],
        partialOutput: (rec && rec.partialOutput) || (lj && lj.output) || '',
        errorText: (rec && rec.errorText) || (lj && lj.error) || '',
        isAutoResume: false
    });
    const displayPrompt = `🔄 ทำต่อด้วย ${chosenLabel} (ส่งไม้ต่อจาก ${failedLabel})`;

    return executePrompt(
        {
            sessionId: sid,
            jobId,
            prompt: displayPrompt,
            images,
            mode: (rec && rec.mode) || (lj && lj.mode) || (sessMeta && sessMeta.mode) || 'exec',
            cwd: (rec && rec.cwd) || (lj && lj.cwd) || (sessMeta && sessMeta.cwd) || PROJECTS_BASE,
            model: chosenModel,
            agyAccount: chosenAccount,
            routerDirective: directive,
            browserVision: Boolean(browserVision),
            fromRecovery: true
        },
        onChunk,
        onDone
    );
}

aiRouter.setQuotaProvider(getQuotaSummary);
aiRouter.setProviderQuotaProvider(getProviderQuotas);

module.exports = {
    getDefaultModel,
    setDefaultModel,
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
    getQuotaSummary,
    getGeminiCredit,
    setClaudeSessionKey,
    listSessions,
    createSession,
    getSession,
    renameSession,
    togglePinSession,
    markSessionRead,
    markAllSessionsRead,
    deleteSession,
    scheduleAutoTitling,
    getRecoveryState,
    getHandoffOptions,
    handoffToAnotherModel,
    cancelAutoResume,
    armAutoResume,
    dismissRecovery
};
