'use strict';

/**
 * cross-team-orchestrator.js
 * -----------------------------------------------------------------------------
 * 🤝 Cross-Provider Multi-Agent Orchestrator (สายพาน 3 ด่านข้ามค่าย)
 *
 *   Stage 1: 🏗️ Architect (Claude Opus · Fallback: Gemini 4 Neon High/XHigh)
 *            - Strict Read-Only codebase exploration
 *            - Produces a structured JSON blueprint with 1–4 scoped subtasks
 *
 *   Stage 2: ⚡ Workers (Gemini Neon / Hydrogen / Flash / Argon across G1 + G2)
 *            - Runs disjoint/read-only subtasks in parallel across Google#1 & Google#2
 *            - Strictly serializes conflicting or wildcard file-write subtasks (zero file races)
 *            - Automatically fails over across accounts/models on transient/quota errors
 *
 *   Stage 3: 🔍 Reviewer (Claude Opus · Fallback: Gemini 4 Neon High/XHigh)
 *            - Strict Read-Only inspection of Worker reports + workspace diff/files
 *            - Can trigger at most 1 targeted Gemini rework round if critical bugs remain
 *            - Produces the final verified Thai answer for the user
 */

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const aiRouter = require('./ai-router');
const deepseekAgent = require('./deepseek-agent');

const HOME_DIR = os.homedir();
const AGY_BIN = process.env.AGY_BIN || path.join(HOME_DIR, '.local/bin/agy');
const CLAUDE_BIN = process.env.CLAUDE_BIN || path.join(HOME_DIR, '.local/bin/claude');

// เพดานรวมสูงสุดต่อด่าน (hard cap) — ปรับจาก 240/360/240 วินาทีเดิม หลังพบว่า Architect (Claude Opus High)
// ยังสำรวจ/คิดอยู่แต่ถูกตัดที่ 240 วินาที (26 ขั้นตอน, ขั้นเดียวคิดนาน ~2 นาที) แล้วทั้งด่านล้ม
const STAGE_TIMEOUT_MS = {
    architect: 720_000,
    worker: 1_800_000, // งานเรนเดอร์วิดีโอ/ติดตั้ง/เทสต์ยาว (คลิป 62 วินาที = 1,870 เฟรม) ต้องอยู่ได้ — ตัวจับเวลา idle ยังตัดโปรเซสค้างอยู่
    reviewer: 480_000
};
// ตัดเมื่อ "เงียบนิ่ง" ไม่มีความคืบหน้าเกินนี้ (เท่ากับเพดานเดิมของ Architect/Reviewer จึงไม่ทนต่อโปรเซสค้างนานกว่าเดิม)
// ถ้ายังคืบหน้าอยู่ ทำต่อได้ถึงเพดานรวมข้างบน
const STAGE_IDLE_MS = {
    architect: 240_000,
    worker: 600_000, // เขียนไฟล์ใหญ่ก้อนเดียว (เช่น TSX ทั้งคอมโพเนนต์) ใช้เวลาหลายนาทีโดยไม่มีเหตุการณ์ใหม่ (วัดเจอ: script.json 75 วินาที)
    reviewer: 240_000
};

/**
 * ตัวจับเวลาของด่าน: ยิง onFire เมื่อ (ก) เงียบนิ่งเกิน idleMs นับจาก touch() ครั้งล่าสุด หรือ (ข) รวมเกิน hardMs
 * touch() เรียกทุกครั้งที่เห็นความคืบหน้า (ข้อมูลออก, เรียกเครื่องมือ, transcript ขยับ)
 */
function makeWatchdog({ hardMs, idleMs, onFire }) {
    let fired = null;
    let idleTimer = null;
    let hardTimer = null;
    const useIdle = Boolean(idleMs) && idleMs < hardMs;
    const stop = () => { clearTimeout(idleTimer); clearTimeout(hardTimer); };
    const fire = (kind, ms) => {
        if (fired) return;
        fired = { kind, ms };
        stop();
        onFire(fired);
    };
    const arm = () => {
        if (fired || !useIdle) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => fire('idle', idleMs), idleMs);
    };
    hardTimer = setTimeout(() => fire('hard', hardMs), hardMs);
    arm();
    return { touch: arm, stop, get fired() { return fired; } };
}

function timeoutErrorText(f) {
    return `timeout (${f.kind} ${Math.round(f.ms / 1000)}s)`;
}

// ── ความคืบหน้าระดับโปรเซส ──────────────────────────────────────────────────────
// คำสั่งยาวๆ (remotion render / ffmpeg / tsc / npm) ที่ agy หรือ claude รันเป็นโปรเซสลูก ทำให้ transcript และ stdout
// ไม่ขยับเลยเป็นสิบนาที (agy -p รอ background task อยู่เฉยๆ) — วัดจริง: Worker รอเรนเดอร์ 1,870 เฟรมแล้วถูกตัดที่ idle 300s
// จึงนับ "CPU ของโปรเซสลูกเพิ่มขึ้น" เป็นความคืบหน้าด้วย (โปรเซสค้างที่ไม่ใช้ CPU ยังถูกตัดตามปกติ)
const CPU_SAMPLE_MS = parseInt(process.env.CROSS_TEAM_CPU_SAMPLE_MS || '5000', 10);
// CPU ต้องเพิ่มอย่างน้อย 5% ของหนึ่งคอร์ตลอดรอบสุ่ม (สเกลตามความยาวรอบ; ขั้นต่ำ 1 tick = 0.01 วินาที)
const CPU_PROGRESS_MIN_S = Math.max(0.01, 0.05 * CPU_SAMPLE_MS / 1000);
const CLK_TCK = 100;            // Linux

function procCpuSeconds(pid, { includeSelf }) {
    try {
        const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const r = f.slice(f.lastIndexOf(')') + 2).split(' ');
        // utime, stime (ตัวเอง) + cutime, cstime (ลูกที่จบไปแล้ว — กันเลขลดเมื่อโปรเซสลูกเลิกทำงาน)
        const self = includeSelf ? (parseInt(r[11], 10) + parseInt(r[12], 10)) : 0;
        return (self + parseInt(r[13], 10) + parseInt(r[14], 10)) / CLK_TCK;
    } catch (_) {
        return 0;
    }
}

/** เวลา CPU รวม (วินาที) ของทุกโปรเซสลูกใต้ rootPid (root นับเฉพาะส่วนของลูกที่จบแล้ว) */
function treeCpuSeconds(rootPid) {
    if (!rootPid) return 0;
    let total = procCpuSeconds(rootPid, { includeSelf: false });
    const seen = new Set([rootPid]);
    const stack = [rootPid];
    while (stack.length) {
        const pid = stack.pop();
        let tasks = [];
        try { tasks = fs.readdirSync(`/proc/${pid}/task`); } catch (_) { continue; }
        for (const t of tasks) {
            let kids = [];
            try { kids = fs.readFileSync(`/proc/${pid}/task/${t}/children`, 'utf8').split(' ').filter(Boolean).map(Number); } catch (_) { continue; }
            for (const k of kids) {
                if (seen.has(k)) continue;
                seen.add(k);
                stack.push(k);
                total += procCpuSeconds(k, { includeSelf: true });
            }
        }
    }
    return total;
}

/** pid ของโปรเซสลูกทุกชั้นใต้ rootPid (ไม่รวม root) */
function listDescendants(rootPid) {
    const out = [];
    if (!rootPid) return out;
    const seen = new Set([rootPid]);
    const stack = [rootPid];
    while (stack.length) {
        const pid = stack.pop();
        let tasks = [];
        try { tasks = fs.readdirSync(`/proc/${pid}/task`); } catch (_) { continue; }
        for (const t of tasks) {
            let kids = [];
            try { kids = fs.readFileSync(`/proc/${pid}/task/${t}/children`, 'utf8').split(' ').filter(Boolean).map(Number); } catch (_) { continue; }
            for (const k of kids) {
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(k);
                stack.push(k);
            }
        }
    }
    return out;
}

/**
 * ตัดโปรเซสที่หมดเวลาพร้อมลูกทั้งหมด: ต้องเก็บรายชื่อลูก "ก่อน" ฆ่า root (พอ root ตาย ลูกจะถูกย้ายไปอยู่ใต้ init แล้วหาไม่เจอ)
 * ไม่งั้นเรนเดอร์/ffmpeg ที่ตกค้างวิ่งต่อและถือท่อ stdout ไว้ ทำให้ด่านค้างรอจนมันจบเอง
 */
function killProcessTree(child, graceMs = 2500) {
    const kids = listDescendants(child.pid);
    const send = (sig) => {
        try { child.kill(sig); } catch (_) {}
        for (const k of kids) { try { process.kill(k, sig); } catch (_) {} }
    };
    send('SIGTERM');
    setTimeout(() => send('SIGKILL'), graceMs);
}

/** เริ่มสุ่มวัด CPU ของโปรเซสลูก แล้ว touch() ตัวจับเวลาเมื่อ CPU เพิ่ม — คืนฟังก์ชันหยุด */
function startCpuProgressProbe(pid, getWatchdog) {
    let last = treeCpuSeconds(pid);
    const timer = setInterval(() => {
        const now = treeCpuSeconds(pid);
        const wd = getWatchdog();
        if (wd && now - last >= CPU_PROGRESS_MIN_S) wd.touch();
        last = now;
    }, CPU_SAMPLE_MS);
    return () => clearInterval(timer);
}
const MAX_SUBTASKS = 6;
const MAX_REWORK_ROUNDS = 1;
const MAX_FAILOVER_ATTEMPTS = 8;
const MAX_PROMPT_CHARS = 60_000;

// ── Text & Path Utilities ────────────────────────────────────────────────────

function stripAnsi(str) {
    return String(str || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function truncateMiddle(text, maxChars = 8000) {
    const s = String(text || '');
    if (s.length <= maxChars) return s;
    const head = Math.floor(maxChars * 0.55);
    const tail = Math.floor(maxChars * 0.40);
    return `${s.slice(0, head)}\n\n... [ตัดทอน ${s.length - head - tail} ตัวอักษร] ...\n\n${s.slice(-tail)}`;
}

function normalizeTargetPath(rawPath, cwd) {
    const clean = String(rawPath || '').trim().replace(/^['"`]|['"`]$/g, '');
    if (!clean) return '';
    const resolved = path.isAbsolute(clean) ? path.normalize(clean) : path.resolve(cwd, clean);
    return resolved.replace(/\/+$/, '') || '/';
}

function pathsOverlap(a, b) {
    if (!a || !b) return true;
    if (a === b) return true;
    return a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}

/**
 * Conflict predicate between two subtasks.
 * Conservative by design: guarantees two workers NEVER race on the same file
 * and a reader NEVER reads a file while another worker is writing it.
 */
function tasksConflict(a, b) {
    if (!a || !b) return false;
    const aWrite = a.access !== 'read';
    const bWrite = b.access !== 'read';
    // Two read-only tasks never conflict with each other
    if (!aWrite && !bWrite) return false;

    const aFiles = Array.isArray(a.files) ? a.files.filter(Boolean) : [];
    const bFiles = Array.isArray(b.files) ? b.files.filter(Boolean) : [];

    // Any write task with unspecified/wildcard files must run exclusively
    if ((aWrite && aFiles.length === 0) || (bWrite && bFiles.length === 0)) return true;
    // A read task scanning the whole workspace (empty files) must not overlap a writer
    if (aFiles.length === 0 || bFiles.length === 0) return true;

    for (const fa of aFiles) {
        for (const fb of bFiles) {
            if (pathsOverlap(fa, fb)) return true;
        }
    }
    return false;
}

/**
 * Extract the best JSON object from an LLM response (supports fenced ```json blocks
 * or balanced top-level braces, tolerating surrounding prose).
 */
function extractJsonObject(rawText, requiredKeys = []) {
    const text = stripAnsi(rawText || '').trim();
    if (!text) return null;

    const matchesKey = (obj) => {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
        if (!requiredKeys.length) return true;
        return requiredKeys.some((k) => Object.prototype.hasOwnProperty.call(obj, k));
    };

    // 1. Try fenced ```json ... ``` blocks from last to first
    const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
    const fenced = [];
    let m;
    while ((m = fenceRe.exec(text)) !== null) fenced.push(m[1].trim());
    for (let i = fenced.length - 1; i >= 0; i--) {
        try {
            const parsed = JSON.parse(fenced[i]);
            if (matchesKey(parsed)) return parsed;
        } catch (_) {}
    }

    // 2. Try parsing entire text as JSON
    try {
        const whole = JSON.parse(text);
        if (matchesKey(whole)) return whole;
    } catch (_) {}

    // 3. Balanced-brace scan across text
    const candidates = [];
    let depth = 0;
    let start = -1;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') {
            inStr = true;
            continue;
        }
        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            if (depth > 0) {
                depth--;
                if (depth === 0 && start !== -1) {
                    candidates.push(text.slice(start, i + 1));
                    start = -1;
                }
            }
        }
    }
    for (let i = candidates.length - 1; i >= 0; i--) {
        try {
            const parsed = JSON.parse(candidates[i]);
            if (matchesKey(parsed)) return parsed;
        } catch (_) {}
    }
    return null;
}

/**
 * Remove cyclic dependencies so the DAG scheduler can never deadlock.
 */
function breakDependencyCycles(tasks) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const state = new Map(); // 0=unvisited, 1=visiting, 2=done

    const dfs = (id) => {
        state.set(id, 1);
        const task = byId.get(id);
        const kept = [];
        for (const dep of task.depends_on) {
            if (!byId.has(dep) || dep === id) continue;
            const st = state.get(dep) || 0;
            if (st === 1) continue; // back-edge → cycle, drop it
            kept.push(dep);
            if (st === 0) dfs(dep);
        }
        task.depends_on = kept;
        state.set(id, 2);
    };

    for (const t of tasks) {
        if (!state.get(t.id)) dfs(t.id);
    }
    return tasks;
}

function sanitizeTasks(rawTasks, { cwd, mode, maxTasks = MAX_SUBTASKS } = {}) {
    if (!Array.isArray(rawTasks)) return [];
    const out = [];
    const seenIds = new Set();
    const allowWrite = mode === 'exec';

    for (let i = 0; i < rawTasks.length && out.length < maxTasks; i++) {
        const raw = rawTasks[i];
        if (!raw || typeof raw !== 'object') continue;
        let id = String(raw.id || `t${out.length + 1}`).trim().replace(/[^A-Za-z0-9_-]/g, '') || `t${out.length + 1}`;
        while (seenIds.has(id)) id = `${id}_${out.length + 1}`;
        seenIds.add(id);

        const instructions = String(raw.instructions || raw.description || raw.prompt || '').trim();
        if (!instructions) continue;

        const rawAccess = String(raw.access || '').trim().toLowerCase();
        const access = !allowWrite ? 'read' : (rawAccess === 'read' ? 'read' : 'write');
        const files = Array.isArray(raw.files)
            ? [...new Set(raw.files.map((f) => normalizeTargetPath(f, cwd)).filter(Boolean))]
            : [];
        const depends_on = Array.isArray(raw.depends_on)
            ? [...new Set(raw.depends_on.map((d) => String(d || '').trim()).filter(Boolean))]
            : [];

        out.push({
            id,
            title: String(raw.title || `งานย่อย ${out.length + 1}`).trim().slice(0, 100),
            model: aiRouter.normalizeWorkerFamily(raw.model || 'neon'),
            access,
            files,
            depends_on,
            instructions
        });
    }
    return breakDependencyCycles(out);
}

function parseArchitectPlan(rawOutput, { cwd, mode }) {
    const obj = extractJsonObject(rawOutput, ['tasks', 'direct_answer']);
    if (!obj) return null;
    const tasks = sanitizeTasks(obj.tasks || [], { cwd, mode, maxTasks: MAX_SUBTASKS });
    const directAnswer = Boolean(obj.direct_answer) && tasks.length === 0;
    return {
        direct_answer: directAnswer,
        answer: String(obj.answer || obj.summary || '').trim(),
        summary: String(obj.summary || '').trim().slice(0, 300),
        architecture_notes: String(obj.architecture_notes || '').trim(),
        acceptance_criteria: Array.isArray(obj.acceptance_criteria)
            ? obj.acceptance_criteria.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 8)
            : [],
        tasks
    };
}

function parseReviewerVerdict(rawOutput, { cwd, mode, allowRework = true }) {
    const clean = stripAnsi(rawOutput || '').trim();
    const hasReworkTag = /\[\[VERDICT\s*:\s*REWORK\]\]/i.test(clean);
    const hasPassTag = /\[\[VERDICT\s*:\s*PASS\]\]/i.test(clean);

    if (allowRework && hasReworkTag) {
        const obj = extractJsonObject(clean, ['rework_tasks', 'tasks']);
        const reworkTasks = obj ? sanitizeTasks(obj.rework_tasks || obj.tasks || [], { cwd, mode, maxTasks: 3 }) : [];
        if (reworkTasks.length > 0) {
            return {
                verdict: 'rework',
                issues: Array.isArray(obj.issues) ? obj.issues.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6) : [],
                reworkTasks,
                finalAnswer: ''
            };
        }
    }

    const stripped = clean
        .replace(/^\s*\[\[VERDICT\s*:\s*(?:PASS|REWORK)\]\]\s*/i, '')
        .trim();
    return {
        verdict: 'pass',
        issues: [],
        reworkTasks: [],
        finalAnswer: stripped || clean,
        explicitPass: hasPassTag
    };
}

// ── Workspace Diff / Change Tracking ─────────────────────────────────────────

function execFileSafe(bin, args, opts = {}) {
    return new Promise((resolve) => {
        execFile(bin, args, { timeout: 10000, maxBuffer: 2 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
            resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

async function captureWorkspaceSnapshot(cwd, targetFiles = []) {
    const gitCheck = await execFileSafe('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree']);
    const isGit = gitCheck.ok && gitCheck.stdout.trim() === 'true';
    const fileStats = new Map();
    for (const f of targetFiles) {
        try {
            const st = fs.statSync(f);
            fileStats.set(f, { exists: true, mtimeMs: st.mtimeMs, size: st.size });
        } catch (_) {
            fileStats.set(f, { exists: false, mtimeMs: 0, size: 0 });
        }
    }
    let gitStatusBefore = '';
    if (isGit) {
        const st = await execFileSafe('git', ['-C', cwd, 'status', '--porcelain']);
        gitStatusBefore = st.ok ? st.stdout.trim() : '';
    }
    return { isGit, gitStatusBefore, fileStats };
}

async function summarizeWorkspaceChanges(cwd, snapshot, targetFiles = []) {
    const parts = [];
    if (snapshot && snapshot.isGit) {
        const [stRes, statRes, diffRes] = await Promise.all([
            execFileSafe('git', ['-C', cwd, 'status', '--porcelain']),
            execFileSafe('git', ['-C', cwd, 'diff', '--stat']),
            execFileSafe('git', ['-C', cwd, 'diff', '--no-color'])
        ]);
        if (stRes.ok && stRes.stdout.trim()) {
            parts.push(`git status:\n${truncateMiddle(stRes.stdout.trim(), 2000)}`);
        }
        if (statRes.ok && statRes.stdout.trim()) {
            parts.push(`git diff --stat:\n${truncateMiddle(statRes.stdout.trim(), 1500)}`);
        }
        if (diffRes.ok && diffRes.stdout.trim()) {
            parts.push(`git diff:\n${truncateMiddle(diffRes.stdout.trim(), 10000)}`);
        }
    } else if (snapshot && snapshot.fileStats) {
        const changed = [];
        const allFiles = new Set([...snapshot.fileStats.keys(), ...targetFiles]);
        for (const f of allFiles) {
            const prev = snapshot.fileStats.get(f) || { exists: false, mtimeMs: 0, size: 0 };
            let cur = { exists: false, mtimeMs: 0, size: 0 };
            try {
                const st = fs.statSync(f);
                cur = { exists: true, mtimeMs: st.mtimeMs, size: st.size };
            } catch (_) {}
            if (!prev.exists && cur.exists) changed.push(`[NEW] ${f} (${cur.size} bytes)`);
            else if (prev.exists && !cur.exists) changed.push(`[DELETED] ${f}`);
            else if (prev.exists && cur.exists && (prev.mtimeMs !== cur.mtimeMs || prev.size !== cur.size)) {
                changed.push(`[MODIFIED] ${f} (${prev.size} -> ${cur.size} bytes)`);
            }
        }
        if (changed.length) {
            parts.push(`ไฟล์ที่เปลี่ยนแปลงบนดิสก์ (นอก git repo):\n${changed.join('\n')}`);
        }
    }
    return parts.join('\n\n') || '(ไม่พบความเปลี่ยนแปลงของไฟล์ หรือเป็นงานอ่าน/วิเคราะห์เท่านั้น)';
}

// ── Prompt Builders ──────────────────────────────────────────────────────────

function formatRecentHistory(history = []) {
    if (!Array.isArray(history) || !history.length) return '';
    const prior = history.slice(-6);
    const lines = prior.map((m) => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        return `${role}: ${truncateMiddle(String(m.content || ''), 1000)}`;
    });
    return `[บริบทล่าสุดในห้องแชทเดียวกัน (อ่านเพื่อความต่อเนื่อง):\n${lines.join('\n---\n')}\n]`;
}

function formatImageNotice(imagePaths = []) {
    if (!imagePaths || !imagePaths.length) return '';
    return `[ผู้ใช้งานแนบรูปภาพมาด้วย กรุณาอ่าน/ดูไฟล์รูปภาพต่อไปนี้:\n${imagePaths.map((p) => `- ${p}`).join('\n')}\n]`;
}

function buildArchitectPrompt({ prompt, history, imagePaths, cwd, mode, workerAccounts }) {
    const accInfo = workerAccounts && workerAccounts.length
        ? workerAccounts.map((a) => `${a.accountLabel} (${a.remainingPct ?? '?'}%)`).join(', ')
        : 'Gemini (single account)';
    const sections = [
        'คุณคือ 🏗️ Architect ประจำทีม AI ข้ามค่าย (Cross-Provider Pipeline · ด่าน 1/3)',
        `Workspace (cwd): ${cwd}`,
        `Execution Mode: ${mode}${mode !== 'exec' ? ' (READ-ONLY — ห้ามให้ Worker แก้ไขไฟล์)' : ' (อนุญาตให้ Worker แก้ไขไฟล์และรันคำสั่งเทสต์ได้)'}`,
        `Worker Accounts พร้อมใช้งาน: ${accInfo}`,
        '',
        'กฎเหล็กของด่าน 1 (Architect):',
        '1. **ห้ามแก้ไข สร้าง หรือลบไฟล์ใดๆ เด็ดขาด** (Strict Read-Only) — ให้ใช้เครื่องมืออ่าน/ค้นไฟล์/ตรวจโครงสร้างเพื่อวางพิมพ์เขียวเท่านั้น',
        '2. วางพิมพ์เขียวให้ละเอียด ระบุ path ไฟล์จริง ชื่อฟังก์ชัน จุดที่ต้องแก้ และคำสั่งตรวจสอบให้ชัดเจน เพื่อไม่ให้ Worker หลุดบริบท',
        `3. แตกงานให้ทีม Gemini Workers เป็น **1 ถึง ${MAX_SUBTASKS} ข้อย่อย** โดยเลือกโมเดลที่คุ้มค่าให้แต่ละข้อ:`,
        '   - "neon": งานโค้ดซับซ้อน/แก้ตรรกะสำคัญ/สถาปัตยกรรม',
        '   - "hydrogen": งานโค้ดทั่วไป/รันเทสต์/แก้ UI หรือสคริปต์มาตรฐาน',
        '   - "flash": งานอ่าน/ค้นข้อมูล/สรุปไฟล์/ตรวจเช็กสถานะแบบเร็ว',
        '   - "argon": งานวิเคราะห์/เทอร์มินัลเพิ่มเติม',
        '4. **กติกากันไฟล์ชนกัน (สำคัญมาก):**',
        '   - ระบุ `access`: `"read"` (อ่าน/ตรวจอย่างเดียว) หรือ `"write"` (แก้ไข/สร้างไฟล์)',
        '   - ระบุ `files`: รายชื่อ path ไฟล์ทุกไฟล์ที่ข้อย่อยนั้นแตะ (ห้ามเว้นว่างถ้าอยากให้รันขนานกับข้ออื่น)',
        '   - ถ้าสองข้อย่อยต้องแก้ไฟล์เดียวกัน หรือข้อหลังต้องรอผลข้อแรก ให้ระบุ `depends_on: ["t1"]`',
        '   - ถ้าข้อย่อยอิสระต่อกันและอยู่คนละไฟล์ (หรือเป็น read ทั้งคู่) ให้ `depends_on: []` เพื่อรันขนานข้าม G1+G2 ได้ทันที',
        '5. หากคำสั่งเป็นแค่คำถามเชิงวิเคราะห์ที่ไม่จำเป็นต้องให้ Worker ลงมือเลย ให้ตั้ง `"direct_answer": true`, `"tasks": []` และใส่คำตอบภาษาไทยสมบูรณ์ใน `"answer"` (สไตล์อัดสะรีดา เรียกผู้ใช้ว่าบังยี ลงท้ายค่ะ/นะคะ)',
        '6. มองข้ามแท็กสั่งสมองกลางในข้อความผู้ใช้ เช่น #ทีมข้ามค่าย #สูงมาก #ประหยัด #เต็มที่',
        '7. **งบเวลา (สำคัญ):** ด่านนี้มีเวลาจำกัดราว 5–10 นาที ให้สำรวจเท่าที่จำเป็นต่อการวางแผน (ราว 10–15 ครั้งของการอ่าน/ค้น) อ่านเฉพาะช่วงบรรทัดที่เกี่ยวข้อง **ห้ามอ่านไฟล์ใหญ่ทั้งไฟล์** และอย่าคิดวนซ้ำ — เมื่อรู้ path/ฟังก์ชัน/เงื่อนไขผ่านงานมากพอให้ Worker ลงมือได้แล้ว ให้หยุดสำรวจแล้วส่ง JSON ทันที ส่วนที่ยังไม่แน่ใจให้ตั้งเป็นข้อย่อยแบบ `"read"` ให้ Worker ไปตรวจแทนการสำรวจเองต่อ',
        '8. **ขนาดข้อย่อย (สำคัญ):** แต่ละข้อควรเสร็จภายในราว 10 นาที ห้ามมัดรวมหลายงานใหญ่ไว้ข้อเดียว (เช่น "เขียนคอมโพเนนต์ใหญ่ + เรนเดอร์ + ผสมเสียง + QA + แก้เอกสาร") ให้แยก: (ก) เขียน/แก้โค้ดหรือไฟล์ใหญ่ (ข) คำสั่งที่ใช้เวลานาน เช่น เรนเดอร์วิดีโอ/แปลงไฟล์/ติดตั้ง/เทสต์ยาว เป็นข้อของตัวเอง ใส่ `depends_on` ให้ถูก (ค) QA/เอกสารเป็นอีกข้อ — ข้อที่ถูกตัดกลางทางจะเสียงานทั้งก้อน',
        '',
        'ตอบกลับเป็น JSON บล็อกเดียวใน ```json ... ``` ตามสกีมานี้เท่านั้น:',
        '```json',
        '{',
        '  "direct_answer": false,',
        '  "summary": "สรุปแผนภาพรวมสั้นๆ ภาษาไทย",',
        '  "architecture_notes": "รายละเอียดโค้ด/โครงสร้าง/ชื่อฟังก์ชัน/ข้อควรระวังสำหรับทีม Worker",',
        '  "acceptance_criteria": ["เงื่อนไขผ่านงานข้อ 1", "เงื่อนไขผ่านงานข้อ 2"],',
        '  "tasks": [',
        '    {',
        '      "id": "t1",',
        '      "title": "ชื่อข้อย่อยสั้นๆ ภาษาไทย",',
        '      "model": "neon|hydrogen|flash|argon",',
        '      "access": "read|write",',
        '      "files": ["/abs/or/relative/path.js"],',
        '      "depends_on": [],',
        '      "instructions": "สเปกการทำงานละเอียดทุกจุด + วิธีตรวจสอบผล"',
        '    }',
        '  ]',
        '}',
        '```'
    ];

    const hist = formatRecentHistory(history);
    if (hist) sections.push('', hist);
    const img = formatImageNotice(imagePaths);
    if (img) sections.push('', img);
    sections.push('', '=== คำสั่งจากผู้ใช้ (บังยี) ===', prompt);

    return truncateMiddle(sections.join('\n'), MAX_PROMPT_CHARS);
}

function buildWorkerPrompt({ task, plan, originalPrompt, imagePaths, cwd, depResults, isRework = false }) {
    const fileScope = task.files.length
        ? task.files.join(', ')
        : '(ไม่ได้จำกัดรายชื่อไฟล์ — ใช้ความระมัดระวังสูงสุด)';
    const accessRule = task.access === 'read'
        ? '**งานนี้เป็นโหมด READ-ONLY เท่านั้น** ห้ามแก้ไข สร้าง หรือลบไฟล์ใดๆ เด็ดขาด ให้ตรวจสอบและรายงานข้อเท็จจริงกลับมา'
        : (task.files.length
            ? `**ขอบเขตไฟล์ที่อนุญาตให้แก้:** แก้ไขเฉพาะไฟล์ต่อไปนี้เท่านั้น (${fileScope}) ห้ามแก้ไฟล์นอกขอบเขตเพื่อป้องกันการชนกันกับ Worker ตัวอื่น`
            : '**โหมดแก้ไขไฟล์:** ดำเนินการตามสเปกอย่างรอบคอบและตรวจสอบ syntax/เทสต์หลังแก้ทุกครั้ง');

    const sections = [
        `คุณคือ ⚡ Gemini Worker (${isRework ? 'รอบแก้ไขตามผลตรวจ' : 'ด่าน 2/3'}) รับมอบหมายงานย่อย [${task.id}]: ${task.title}`,
        `Workspace (cwd): ${cwd}`,
        accessRule,
        '',
        '=== ภาพรวมและพิมพ์เขียวจาก Architect ===',
        plan.summary ? `แผนภาพรวม: ${plan.summary}` : '',
        plan.architecture_notes ? `รายละเอียดสถาปัตยกรรม:\n${truncateMiddle(plan.architecture_notes, 6000)}` : '',
        plan.acceptance_criteria && plan.acceptance_criteria.length
            ? `เกณฑ์ผ่านงาน:\n${plan.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
            : '',
        '',
        `=== สเปกงานย่อย [${task.id}] ที่คุณต้องทำให้จบ ===`,
        task.instructions
    ].filter((s) => s !== '');

    if (depResults && depResults.length) {
        sections.push('', '=== ผลจากงานย่อยก่อนหน้าที่เกี่ยวข้อง ===');
        for (const dep of depResults) {
            sections.push(`--- [${dep.task.id}] ${dep.task.title} (${dep.ok ? 'สำเร็จ' : 'มีข้อผิดพลาด'}) ---`);
            sections.push(truncateMiddle(dep.output || dep.error || '(ไม่มีผลลัพธ์)', 4000));
        }
    }

    const img = formatImageNotice(imagePaths);
    if (img) sections.push('', img);

    sections.push(
        '',
        '=== บริบทคำสั่งต้นทางของผู้ใช้ ===',
        truncateMiddle(originalPrompt, 3000),
        '',
        '=== รูปแบบรายงานผลกลับให้ Reviewer ===',
        'สรุปให้กระชับและครบถ้วนเป็นภาษาไทย:',
        '- สิ่งที่ตรวจสอบ/แก้ไข (ระบุ path ไฟล์และบรรทัด/ฟังก์ชันจริง)',
        '- คำสั่งตรวจสอบ/เทสต์ที่รันและผลลัพธ์จริง',
        '- ข้อสังเกตหรือปัญหาที่ยังค้าง (ถ้ามี)'
    );

    return truncateMiddle(sections.join('\n'), MAX_PROMPT_CHARS);
}

function buildReviewerPrompt({ originalPrompt, history, plan, workerResults, changesSummary, cwd, mode, reworkRound }) {
    const allowRework = reworkRound < MAX_REWORK_ROUNDS && mode === 'exec';
    const workerReport = workerResults.map((r) => {
        const who = r.candidate ? `${r.candidate.label} (${r.candidate.accountLabel})` : r.task.model;
        const durationMs = Number(r.durationMs) || 0;
        const stepsCount = Number(r.stepsCount) || 0;
        const skipped = Boolean(r.skipped);
        const status = r.ok
            ? '✅ สำเร็จ'
            : (skipped ? `⏭️ ถูกข้าม (${r.error || 'ข้อก่อนหน้าไม่สำเร็จ'})` : `❌ ล้มเหลว (${r.error || 'error'})`);
        const metaLine = `สถานะ: ok=${Boolean(r.ok)} · skipped=${skipped} · stepsCount=${stepsCount} · durationMs=${durationMs}${r.error ? ` · error=${r.error}` : ''}`;
        return [
            `### [${r.task.id}] ${r.task.title} · ${who} · ${status} (${(durationMs / 1000).toFixed(1)}s)`,
            metaLine,
            `ขอบเขต: ${r.task.access} · ไฟล์: ${(r.task.files || []).join(', ') || '(ไม่ระบุ)'}`,
            truncateMiddle(r.output || r.error || '(ไม่มีผลลัพธ์)', 6500)
        ].join('\n');
    }).join('\n\n');

    const sections = [
        `คุณคือ 🔍 Reviewer ประจำทีม AI ข้ามค่าย (ด่าน 3/3${reworkRound > 0 ? ' · รอบตรวจสุดท้ายหลังแก้ไข' : ''})`,
        `Workspace (cwd): ${cwd}`,
        '',
        'กฎเหล็กของด่าน 3 (Reviewer):',
        '1. **ห้ามแก้ไขไฟล์เองเด็ดขาด** (Strict Read-Only) — ใช้เครื่องมืออ่านไฟล์/เช็ก syntax/ตรวจ diff เพื่อยืนยันว่างานของทีม Gemini ถูกต้องครบตามสเปก ไม่มีบั๊ก ไม่มีจุดหลุด',
        '2. ตรวจสอบให้สอดคล้องกับเกณฑ์ผ่านงาน (Acceptance Criteria) และผลลัพธ์จริงบนดิสก์',
        allowRework
            ? [
                '3. **การตัดสินใจ:**',
                '   - ถ้างานผ่านครบถ้วน (หรือมีเพียงข้อสังเกตเล็กน้อยที่ไม่ใช่บั๊ก) → ขึ้นต้นบรรทัดแรกด้วย `[[VERDICT:PASS]]` แล้วตามด้วย **คำตอบสรุปฉบับสมบูรณ์ภาษาไทย** ส่งตรงถึงผู้ใช้',
                '   - ถ้าพบ **บั๊กร้ายแรง / syntax พัง / ทำไม่ครบตามสเปก** ที่ต้องให้ Gemini แก้ก่อนจบ → ขึ้นต้นบรรทัดแรกด้วย `[[VERDICT:REWORK]]` แล้วตามด้วย JSON บล็อกเดียวใน ```json ... ``` รูปแบบ:',
                '     `{"issues":["..."],"rework_tasks":[{"id":"r1","title":"...","model":"neon|hydrogen","access":"write","files":["..."],"depends_on":[],"instructions":"..."}]}` (ไม่เกิน 3 ข้อย่อย, เฉพาะจุดที่ต้องแก้จริง)',
                '   - **กรณีมี Worker ล้มเพราะ timeout หรือถูกข้าม (`skipped=true`):** ให้ตรวจไฟล์จริงบนดิสก์ก่อน แล้วสร้าง `rework_tasks` ที่ทำเฉพาะส่วนที่ยังไม่เสร็จต่อจากจุดที่ค้าง (เช่น สั่งเรนเดอร์/มิกซ์/พรีวิวต่อจากไฟล์ที่มีอยู่) แยกงานยาวเป็นข้อของตัวเอง และไม่ต้องเขียนโค้ดที่เสร็จแล้วใหม่ทั้งหมด'
            ].join('\n')
            : '3. **นี่คือรอบตรวจสุดท้าย (Final Review):** ห้ามสั่ง REWORK อีก ให้ขึ้นต้นบรรทัดแรกด้วย `[[VERDICT:PASS]]` แล้วเขียนคำตอบสรุปฉบับสมบูรณ์ภาษาไทยส่งตรงถึงผู้ใช้ (หากยังมีข้อจำกัด/จุดที่ค้างให้แจ้งตรงไปตรงมา)',
        '4. **โทนภาษาสำหรับคำตอบสุดท้ายถึงผู้ใช้:** แทนตัวเองว่า **อัดสะรีดา**, เรียกผู้ใช้ว่า **บังยี**, ใช้คำลงท้าย ค่ะ/นะคะ อย่างเป็นกันเอง ชัดเจน กระชับ ตรงประเด็น และใส่ลิงก์ไฟล์แบบ `[filename](file:///abs/path)` สำหรับไฟล์ที่อ้างอิงทุกไฟล์'
    ];

    const hist = formatRecentHistory(history);
    if (hist) sections.push('', hist);

    sections.push(
        '',
        '=== คำสั่งต้นทางจากบังยี ===',
        truncateMiddle(originalPrompt, 4000),
        '',
        '=== พิมพ์เขียวจาก Architect ===',
        plan.summary ? `แผนภาพรวม: ${plan.summary}` : '',
        plan.acceptance_criteria && plan.acceptance_criteria.length
            ? `เกณฑ์ผ่านงาน:\n${plan.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
            : '',
        '',
        '=== รายงานผลจากทีม Gemini Workers ===',
        workerReport,
        '',
        '=== สรุปการเปลี่ยนแปลงบนดิสก์ ===',
        truncateMiddle(changesSummary, 10000)
    );

    return truncateMiddle(sections.join('\n'), MAX_PROMPT_CHARS);
}

// ── Single-Agent Headless Subprocess Runner ──────────────────────────────────

function runClaudeSubprocess(candidate, { prompt, cwd, readOnly, mode, timeoutMs, idleMs, rolePrefix, onThoughtEvent, abortCtx }) {
    return new Promise((resolve) => {
        const cliModel = String(candidate.model || '').replace('claude-code-', '').trim() || 'opus';
        const args = [
            '-p', prompt,
            '--model', cliModel,
            '--output-format', 'stream-json',
            '--verbose',
            '--include-partial-messages',
            '--no-session-persistence'
        ];
        if (readOnly || mode !== 'exec') {
            args.push('--permission-mode', 'plan', '--disallowed-tools', 'Edit,Write,NotebookEdit');
        } else {
            args.push('--dangerously-skip-permissions');
        }

        const env = {
            ...process.env,
            HOME: HOME_DIR, // Always resolve ~/.claude/.credentials.json from real home
            PATH: `/home/dev/.local/bin:${process.env.PATH || ''}`,
            TERM: 'xterm-256color',
            FORCE_COLOR: '0'
        };

        const child = spawn(CLAUDE_BIN, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        abortCtx.register(child);

        let settled = false;
        let stdoutBuf = '';
        let output = '';
        let stderrTail = '';
        let stepsCount = 0;
        let emittedDeltas = false;
        let resultIsError = false;
        let resultErrorText = '';
        let currentBlockType = '';
        let currentToolName = '';
        let currentToolJson = '';
        let timedOut = null;

        const wd = makeWatchdog({
            hardMs: timeoutMs,
            idleMs,
            onFire: (f) => {
                timedOut = f;
                killProcessTree(child);
            }
        });

        const stopCpuProbe = startCpuProgressProbe(child.pid, () => wd);
        const finishOnce = (res) => {
            if (settled) return;
            settled = true;
            wd.stop();
            stopCpuProbe();
            abortCtx.unregister(child);
            resolve(res);
        };

        const processLine = (rawLine) => {
            const line = rawLine.trim();
            if (!line) return;
            let obj;
            try { obj = JSON.parse(line); } catch (_) { return; }

            if (obj.type === 'stream_event' && obj.event) {
                const ev = obj.event;
                if (ev.type === 'content_block_start' && ev.content_block) {
                    currentBlockType = ev.content_block.type || '';
                    if (currentBlockType === 'tool_use') {
                        currentToolName = ev.content_block.name || 'tool';
                        currentToolJson = '';
                    }
                } else if (ev.type === 'content_block_delta' && ev.delta) {
                    const d = ev.delta;
                    if (d.type === 'text_delta' && d.text) {
                        emittedDeltas = true;
                        output += d.text;
                    } else if (d.type === 'input_json_delta' && d.partial_json) {
                        currentToolJson += d.partial_json;
                    }
                } else if (ev.type === 'content_block_stop') {
                    if (currentBlockType === 'tool_use' && currentToolName) {
                        stepsCount++;
                        let detail = '';
                        try {
                            const inp = currentToolJson ? JSON.parse(currentToolJson) : {};
                            detail = inp.file_path || inp.pattern || inp.description || inp.command || inp.query || '';
                        } catch (_) {}
                        const summary = detail
                            ? `${rolePrefix} 🔧 ${currentToolName}: ${String(detail).replace(/\s+/g, ' ').slice(0, 90)}`
                            : `${rolePrefix} 🔧 ${currentToolName}`;
                        onThoughtEvent('tool', summary);
                    }
                    currentBlockType = '';
                    currentToolName = '';
                    currentToolJson = '';
                }
                return;
            }

            if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
                for (const block of obj.message.content) {
                    if (block && block.type === 'text' && block.text && !emittedDeltas) {
                        output += block.text;
                    }
                }
                return;
            }

            if (obj.type === 'result') {
                if (obj.is_error) {
                    resultIsError = true;
                    resultErrorText = String(obj.result || 'Claude Code returned error');
                } else if (!output.trim() && typeof obj.result === 'string') {
                    output = obj.result;
                }
            }
        };

        child.stdout.on('data', (d) => {
            wd.touch();
            stdoutBuf += d.toString('utf8');
            const lines = stdoutBuf.split('\n');
            stdoutBuf = lines.pop() || '';
            for (const l of lines) processLine(l);
        });
        child.stderr.on('data', (d) => {
            stderrTail = (stderrTail + d.toString('utf8')).slice(-4000);
        });
        child.on('error', (err) => {
            finishOnce({ ok: false, output, stderr: stderrTail, error: err.message, crashed: false, stepsCount });
        });
        child.on('close', (code) => {
            if (stdoutBuf.trim()) processLine(stdoutBuf);
            if (abortCtx.aborted) {
                return finishOnce({ ok: false, aborted: true, output, stderr: stderrTail, error: 'aborted', crashed: false, stepsCount });
            }
            if (timedOut) {
                return finishOnce({ ok: false, output, stderr: stderrTail, error: timeoutErrorText(timedOut), crashed: false, stepsCount });
            }
            const crashed = aiRouter.isBinaryCrash(stderrTail);
            const failed = code !== 0 || crashed || resultIsError || !output.trim();
            finishOnce({
                ok: !failed,
                output: output.trim(),
                stderr: stderrTail,
                error: failed ? (crashed ? aiRouter.summarizeCrashError(stderrTail, 'claude-code', `exit code ${code}`) : (resultErrorText || stderrTail.trim() || `exit code ${code}`)) : null,
                crashed,
                stepsCount
            });
        });
    });
}

function runAgySubprocess(candidate, { prompt, cwd, readOnly, mode, timeoutMs, idleMs, rolePrefix, onThoughtEvent, abortCtx, claimedBrains }) {
    return new Promise((resolve) => {
        const home = candidate.home || HOME_DIR;
        const brainDir = path.join(home, '.gemini/antigravity-cli/brain');
        let beforeBrains = new Set();
        try {
            if (fs.existsSync(brainDir)) beforeBrains = new Set(fs.readdirSync(brainDir));
        } catch (_) {}

        const args = [
            '-p', prompt,
            '--model', candidate.model,
            '--disable-slash-commands',
            '--print-timeout', `${Math.max(30, Math.floor(timeoutMs / 1000))}s`
        ];
        if (!readOnly && mode === 'exec') {
            args.push('--dangerously-skip-permissions');
        }

        const env = {
            ...process.env,
            HOME: home,
            PATH: `/home/dev/.gemini/bin:/home/dev/.local/bin:${process.env.PATH || ''}`,
            TERM: 'xterm-256color',
            FORCE_COLOR: '0'
        };

        const child = spawn(AGY_BIN, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        abortCtx.register(child);

        let settled = false;
        let output = '';
        let stderrTail = '';
        let stepsCount = 0;
        let timedOut = null;
        let myBrainId = null;
        let lastSeenSteps = 0;
        let lastTranscriptSig = '';
        let wd = null; // ตั้งค่าด้านล่าง (poller เรียก wd.touch() เมื่อ transcript ขยับ)

        // Lightweight brain transcript poller so live tool calls show up in UI timeline
        const pollBrain = setInterval(() => {
            try {
                if (!myBrainId && fs.existsSync(brainDir)) {
                    const dirs = fs.readdirSync(brainDir).filter((d) => !beforeBrains.has(d) && !claimedBrains.has(`${home}:${d}`));
                    if (dirs.length) {
                        dirs.sort((a, b) => {
                            try { return fs.statSync(path.join(brainDir, b)).mtimeMs - fs.statSync(path.join(brainDir, a)).mtimeMs; } catch (_) { return 0; }
                        });
                        myBrainId = dirs[0];
                        claimedBrains.add(`${home}:${myBrainId}`);
                        if (wd) wd.touch();
                    }
                }
                if (!myBrainId) return;
                const tFile = path.join(brainDir, myBrainId, '.system_generated/logs/transcript.jsonl');
                if (!fs.existsSync(tFile)) return;
                const stat = fs.statSync(tFile);
                // transcript ขยับ = โมเดลยังทำงานอยู่ (นับเป็นความคืบหน้า)
                const sig = `${stat.size}:${stat.mtimeMs}`;
                if (sig !== lastTranscriptSig) {
                    lastTranscriptSig = sig;
                    if (wd) wd.touch();
                }
                const readSz = Math.min(stat.size, 32 * 1024);
                const buf = Buffer.alloc(readSz);
                const fd = fs.openSync(tFile, 'r');
                try { fs.readSync(fd, buf, 0, readSz, Math.max(0, stat.size - readSz)); } finally { fs.closeSync(fd); }
                const lines = buf.toString('utf8').split('\n');
                if (stat.size > readSz && lines.length) lines.shift();
                const allTools = [];
                for (const l of lines) {
                    if (!l.trim()) continue;
                    try {
                        const obj = JSON.parse(l);
                        if (Array.isArray(obj.tool_calls)) {
                            for (const tc of obj.tool_calls) {
                                const a = tc.args || tc.arguments || {};
                                const d = a.toolSummary || a.Path || a.CommandLine || a.Description || a.query || '';
                                allTools.push(d ? `${tc.name}: ${String(d).replace(/\s+/g, ' ').slice(0, 90)}` : tc.name);
                            }
                        }
                    } catch (_) {}
                }
                if (allTools.length > lastSeenSteps) {
                    for (let i = lastSeenSteps; i < allTools.length; i++) {
                        onThoughtEvent('tool', `${rolePrefix} 🔧 ${allTools[i]}`);
                    }
                    lastSeenSteps = allTools.length;
                    stepsCount = Math.max(stepsCount, allTools.length);
                }
            } catch (_) {}
        }, 700);

        wd = makeWatchdog({
            hardMs: timeoutMs,
            idleMs,
            onFire: (f) => {
                timedOut = f;
                killProcessTree(child);
            }
        });

        const stopCpuProbe = startCpuProgressProbe(child.pid, () => wd);
        const finishOnce = (res) => {
            if (settled) return;
            settled = true;
            clearInterval(pollBrain);
            wd.stop();
            stopCpuProbe();
            abortCtx.unregister(child);
            resolve(res);
        };

        child.stdout.on('data', (d) => { wd.touch(); output += d.toString('utf8'); });
        child.stderr.on('data', (d) => { wd.touch(); stderrTail = (stderrTail + d.toString('utf8')).slice(-4000); });
        child.on('error', (err) => {
            finishOnce({ ok: false, output, stderr: stderrTail, error: err.message, crashed: false, stepsCount });
        });
        child.on('close', (code) => {
            if (abortCtx.aborted) {
                return finishOnce({ ok: false, aborted: true, output, stderr: stderrTail, error: 'aborted', crashed: false, stepsCount });
            }
            const crashed = aiRouter.isBinaryCrash(stderrTail);
            if (timedOut) {
                return finishOnce({ ok: false, output, stderr: stderrTail, error: timeoutErrorText(timedOut), crashed, stepsCount });
            }
            const cleanOut = output.trim();
            const failed = code !== 0 || crashed || !cleanOut;
            finishOnce({
                ok: !failed,
                output: cleanOut,
                stderr: stderrTail,
                error: failed ? (crashed ? 'agy binary crashed (SIGSEGV/RAM cache)' : (stderrTail.trim().slice(0, 260) || `exit code ${code}`)) : null,
                crashed,
                stepsCount
            });
        });
    });
}

function runDeepSeekSubprocess(candidate, { prompt, cwd, readOnly, mode, timeoutMs, idleMs, rolePrefix, onThoughtEvent, abortCtx }) {
    return new Promise((resolve) => {
        let settled = false;
        let output = '';
        let stepsCount = 0;
        const fakeJob = { output: '', status: 'running' };
        let handle = null;

        const finishOnce = (res) => {
            if (settled) return;
            settled = true;
            wd.stop();
            abortCtx.unregisterHandle(handle);
            resolve(res);
        };

        const wd = makeWatchdog({
            hardMs: timeoutMs,
            idleMs,
            onFire: (f) => {
                if (handle && handle.abort) handle.abort();
                finishOnce({ ok: false, output, stderr: '', error: timeoutErrorText(f), crashed: false, stepsCount });
            }
        });

        try {
            handle = deepseekAgent.runDeepSeekPrompt({
                job: fakeJob,
                prompt,
                imagePaths: [],
                mode: readOnly ? 'chat' : mode,
                cwd,
                model: candidate.model,
                history: [],
                onChunk: (type, payload) => {
                    wd.touch();
                    if (type === 'stdout') output += String(payload || '');
                    else if (type === 'thought' && payload && payload.currentAction) {
                        stepsCount = Math.max(stepsCount, payload.stepsCount || 0);
                        onThoughtEvent('status', `${rolePrefix} ${payload.currentAction}`);
                    }
                },
                onDone: (code, errMsg) => {
                    if (abortCtx.aborted) {
                        return finishOnce({ ok: false, aborted: true, output, stderr: '', error: 'aborted', crashed: false, stepsCount });
                    }
                    const failed = code !== 0 || !output.trim();
                    finishOnce({
                        ok: !failed,
                        output: output.trim(),
                        stderr: '',
                        error: failed ? (errMsg || `exit code ${code}`) : null,
                        crashed: false,
                        stepsCount
                    });
                }
            });
            abortCtx.registerHandle(handle);
        } catch (err) {
            finishOnce({ ok: false, output, stderr: '', error: err.message, crashed: false, stepsCount });
        }
    });
}

async function runSingleCandidate(candidate, opts) {
    if (candidate.engine === 'claude-code') return runClaudeSubprocess(candidate, opts);
    if (candidate.engine === 'deepseek') return runDeepSeekSubprocess(candidate, opts);
    return runAgySubprocess(candidate, opts);
}

/**
 * Run a stage/worker across an ordered candidate queue with crash-heal + group-aware failover.
 * - For read-only stages: safe to fail over even if tools were called.
 * - For write workers: NEVER fails over after stepsCount > 0 (prevents double-mutation).
 */
async function runWithFailover(candidates, {
    stageName,
    prompt,
    cwd,
    readOnly,
    mode,
    timeoutMs,
    idleMs,
    rolePrefix,
    decision,
    originalPrompt,
    onThoughtEvent,
    abortCtx,
    claimedBrains,
    runner = runSingleCandidate
}) {
    const startedAt = Date.now();
    const deadGroups = new Set();
    let healed = false;
    let attempts = 0;
    let lastSteps = 0;
    const tried = [];
    let lastError = 'ไม่มีโมเดลที่พร้อมใช้งาน';

    const queue = [...(candidates || [])];
    while (queue.length > 0 && attempts < MAX_FAILOVER_ATTEMPTS) {
        if (abortCtx.aborted) {
            return { ok: false, aborted: true, error: 'aborted', output: '', candidate: null, tried, durationMs: Date.now() - startedAt };
        }
        const c = queue.shift();
        if (!c) continue;
        if (deadGroups.has(aiRouter.failureGroup(c, false)) || deadGroups.has(aiRouter.failureGroup(c, true))) {
            continue;
        }
        attempts++;
        tried.push(`${c.model}@${c.account}`);
        aiRouter.notePick(c);
        onThoughtEvent('status', `${rolePrefix} กำลังรันด้วย ${c.label} (${c.accountLabel})...`);

        const res = await runner(c, { prompt, cwd, readOnly, mode, timeoutMs, idleMs, rolePrefix: `${rolePrefix} [${c.label}]`, onThoughtEvent, abortCtx, claimedBrains });
        lastSteps = Math.max(lastSteps, res.stepsCount || 0);
        if (res.aborted || abortCtx.aborted) {
            return { ok: false, aborted: true, error: 'aborted', output: res.output || '', candidate: c, tried, durationMs: Date.now() - startedAt };
        }
        if (res.ok) {
            return { ok: true, output: res.output, candidate: c, tried, stepsCount: res.stepsCount || 0, durationMs: Date.now() - startedAt };
        }

        lastError = res.error || 'unknown error';
        const canRetrySameOrFailover = readOnly || (res.stepsCount || 0) === 0;

        // agy / claude-code binary crash at startup → evict page cache once & retry same candidate
        if (canRetrySameOrFailover && res.crashed && (c.engine === 'agy' || c.engine === 'claude-code') && !healed) {
            healed = true;
            const binFile = c.engine === 'claude-code' ? CLAUDE_BIN : aiRouter.AGY_BIN;
            aiRouter.logDecision({ source: 'cross-team', prompt: originalPrompt, decision, event: 'crash-heal', extra: { stage: stageName, from: `${c.model}@${c.account}`, bin: binFile } });
            onThoughtEvent('status', `🩹 ${rolePrefix} ${c.label} แครชตอนเปิด — ล้าง RAM cache แล้วลองใหม่...`);
            await aiRouter.healBinaryCache(binFile);
            queue.unshift(c);
            attempts--; // healing retry does not consume a failover slot
            continue;
        }

        if (canRetrySameOrFailover) {
            aiRouter.recordFailure(c, { crashed: res.crashed, errorText: lastError, outputText: res.output, stderrText: res.stderr });
        }

        const retryable = canRetrySameOrFailover && (res.crashed || aiRouter.isRetryableFailure(lastError, res.output, res.stderr));
        if (retryable) {
            deadGroups.add(aiRouter.failureGroup(c, res.crashed));
            const nextCand = queue.find((n) => !deadGroups.has(aiRouter.failureGroup(n, false)) && !deadGroups.has(aiRouter.failureGroup(n, true)));
            aiRouter.logDecision({ source: 'cross-team', prompt: originalPrompt, decision, event: 'failover', extra: { stage: stageName, from: `${c.model}@${c.account}`, to: nextCand ? `${nextCand.model}@${nextCand.account}` : null, error: String(lastError).slice(0, 180) } });
            if (nextCand) {
                onThoughtEvent('status', `↪️ ${rolePrefix} ${c.label} (${c.accountLabel}) ขัดข้อง → สลับไป ${nextCand.label} (${nextCand.accountLabel})`);
            }
            continue;
        }

        // Non-retryable or write-task failed mid-execution after tool calls → stop safely
        return {
            ok: false,
            output: res.output || '',
            error: !readOnly && (res.stepsCount || 0) > 0
                ? `${c.label} หยุดกลางทางหลังใช้เครื่องมือไป ${res.stepsCount} ขั้น (${lastError})`
                : lastError,
            candidate: c,
            tried,
            stepsCount: res.stepsCount || 0,
            durationMs: Date.now() - startedAt
        };
    }

    return { ok: false, output: '', error: lastError, candidate: null, tried, stepsCount: lastSteps, durationMs: Date.now() - startedAt };
}

// ── Stage 2: Conflict-Free DAG + Multi-Account Worker Scheduler ──────────────

async function runWorkerWave(tasks, {
    plan,
    originalPrompt,
    imagePaths,
    cwd,
    mode,
    decision,
    workerAccounts,
    maxParallelWorkers,
    isRework = false,
    onThoughtEvent,
    abortCtx,
    claimedBrains,
    buildWorkersFn = aiRouter.buildWorkerCandidates,
    runner = runSingleCandidate
}) {
    const completed = new Map(); // id -> result
    const running = new Map();   // id -> { task, account }
    const pending = [...tasks];
    const busyAccounts = new Set();
    const accountUseCount = new Map();
    const accounts = Array.isArray(workerAccounts) ? workerAccounts : [];
    const maxPar = Math.max(1, Math.min(2, maxParallelWorkers || accounts.length || 1));

    const pickPreferredAccount = () => {
        if (!accounts.length) return null;
        const idle = accounts.filter((a) => !busyAccounts.has(a.account));
        const pool = idle.length ? idle : accounts;
        pool.sort((a, b) => ((accountUseCount.get(a.account) || 0) - (accountUseCount.get(b.account) || 0)) || ((b.score || 0) - (a.score || 0)));
        return pool[0].account;
    };

    const canStartTask = (task) => {
        for (const depId of (task.depends_on || [])) {
            const depRec = completed.get(depId);
            if (!depRec || !depRec.ok) return false;
        }
        for (const { task: activeTask } of running.values()) {
            if (tasksConflict(task, activeTask)) return false;
        }
        return true;
    };

    // ข้ามข้อที่พึ่งข้อก่อนหน้าซึ่งล้มเหลวหรือถูกข้ามไปแล้ว เพื่อไม่ให้รันต่อบนโค้ด/ผลลัพธ์ที่ไม่ครบ
    const skipTask = (task, failedDepIds) => {
        const reason = `ข้ามเพราะข้อ ${failedDepIds.join(', ')} ไม่สำเร็จ`;
        const record = {
            task,
            ok: false,
            skipped: true,
            aborted: false,
            output: '',
            error: reason,
            candidate: null,
            tried: [],
            stepsCount: 0,
            durationMs: 0
        };
        completed.set(task.id, record);
        onThoughtEvent('status', `⏭️ Worker[${task.id}] ข้าม "${task.title}" เพราะข้อ ${failedDepIds.join(', ')} ไม่สำเร็จ`);
        return record;
    };

    let ranInParallel = false;

    const launchTask = async (task) => {
        const prefAcc = pickPreferredAccount();
        if (prefAcc) {
            busyAccounts.add(prefAcc);
            accountUseCount.set(prefAcc, (accountUseCount.get(prefAcc) || 0) + 1);
        }
        running.set(task.id, { task, account: prefAcc });
        if (running.size >= 2) ranInParallel = true;

        const depResults = (task.depends_on || []).map((id) => completed.get(id)).filter(Boolean);
        const workerPrompt = buildWorkerPrompt({ task, plan, originalPrompt, imagePaths, cwd, depResults, isRework });

        const candidates = await buildWorkersFn(task.model, {
            preferredAccount: prefAcc,
            qType: decision && decision.classification ? (decision.classification.type === 'quick' ? 'chat' : decision.classification.type) : 'code',
            hasImages: Boolean(imagePaths && imagePaths.length),
            modeOverride: (decision && decision.overrides && decision.overrides.mode) || null
        });

        const tag = `⚡ Worker[${task.id}]`;
        onThoughtEvent('status', `${tag} เริ่มงาน "${task.title}" (${task.access === 'read' ? 'อ่าน' : 'แก้ไฟล์'} · ขอ ${task.model}${prefAcc ? ' @' + prefAcc.toUpperCase() : ''})`);

        const res = await runWithFailover(candidates, {
            stageName: `${isRework ? 'rework' : 'worker'}:${task.id}`,
            prompt: workerPrompt,
            cwd,
            readOnly: task.access === 'read' || mode !== 'exec',
            mode,
            timeoutMs: STAGE_TIMEOUT_MS.worker,
            idleMs: STAGE_IDLE_MS.worker,
            rolePrefix: tag,
            decision,
            originalPrompt,
            onThoughtEvent,
            abortCtx,
            claimedBrains,
            runner
        });

        running.delete(task.id);
        if (prefAcc) busyAccounts.delete(prefAcc);

        const record = {
            task,
            ok: res.ok,
            skipped: false,
            aborted: Boolean(res.aborted),
            output: res.output || '',
            error: res.error || null,
            candidate: res.candidate,
            tried: res.tried || [],
            stepsCount: res.stepsCount || 0,
            durationMs: res.durationMs || 0
        };
        completed.set(task.id, record);
        const who = res.candidate ? `${res.candidate.label} (${res.candidate.accountLabel})` : task.model;
        onThoughtEvent(res.ok ? 'tool_ok' : 'status', `${tag} ${res.ok ? '✅ เสร็จแล้ว' : '⚠️ พบปัญหา'} (${who} · ${(record.durationMs / 1000).toFixed(1)}s)`);
        return record;
    };

    const inflightPromises = new Map();

    while ((pending.length > 0 || inflightPromises.size > 0) && !abortCtx.aborted) {
        // ข้ามข้อที่ dependency ครบแล้วแต่มีอย่างน้อย 1 ข้อไม่สำเร็จ (วนซ้ำเพื่อให้ข้ามเป็นทอดได้ครบ)
        let skippedAny = true;
        while (skippedAny && pending.length > 0) {
            skippedAny = false;
            for (let i = 0; i < pending.length; ) {
                const deps = pending[i].depends_on || [];
                if (deps.length > 0 && deps.every((d) => completed.has(d))) {
                    const failedDepIds = deps.filter((d) => !completed.get(d).ok);
                    if (failedDepIds.length > 0) {
                        const [toSkip] = pending.splice(i, 1);
                        skipTask(toSkip, failedDepIds);
                        skippedAny = true;
                        continue;
                    }
                }
                i++;
            }
        }

        let launchedAny = false;
        for (let i = 0; i < pending.length && running.size < maxPar; ) {
            const candidateTask = pending[i];
            if (canStartTask(candidateTask)) {
                pending.splice(i, 1);
                const p = launchTask(candidateTask).finally(() => { inflightPromises.delete(candidateTask.id); });
                inflightPromises.set(candidateTask.id, p);
                launchedAny = true;
            } else {
                i++;
            }
        }

        if (inflightPromises.size > 0) {
            await Promise.race(inflightPromises.values());
        } else if (!launchedAny && pending.length > 0) {
            // Defensive safety valve (should never happen because cycles were broken)
            const forced = pending.shift();
            const failedDepIds = (forced.depends_on || []).filter((d) => completed.has(d) && !completed.get(d).ok);
            if (failedDepIds.length > 0) {
                skipTask(forced, failedDepIds);
            } else {
                const p = launchTask(forced).finally(() => { inflightPromises.delete(forced.id); });
                inflightPromises.set(forced.id, p);
                await p;
            }
        }
    }

    if (inflightPromises.size > 0) {
        await Promise.allSettled(inflightPromises.values());
    }

    // Preserve original task order in returned list
    const results = tasks.map((t) => completed.get(t.id)).filter(Boolean);
    return { results, ranInParallel };
}

// ── Main 3-Stage Pipeline Entry Point ────────────────────────────────────────

function createAbortContext() {
    const children = new Set();
    const handles = new Set();
    return {
        aborted: false,
        register(child) {
            if (this.aborted) { try { child.kill('SIGTERM'); } catch (_) {} return; }
            children.add(child);
        },
        unregister(child) { children.delete(child); },
        registerHandle(h) {
            if (!h) return;
            if (this.aborted) { try { if (h.abort) h.abort(); } catch (_) {} return; }
            handles.add(h);
        },
        unregisterHandle(h) { if (h) handles.delete(h); },
        abortAll() {
            if (this.aborted) return;
            this.aborted = true;
            for (const c of children) {
                try {
                    c.kill('SIGTERM');
                    setTimeout(() => { try { c.kill('SIGKILL'); } catch (_) {} }, 2000);
                } catch (_) {}
            }
            for (const h of handles) {
                try { if (h.abort) h.abort(); } catch (_) {}
            }
        }
    };
}

/**
 * Execute the full 3-Stage Cross-Provider Pipeline.
 *
 * @param {object} opts
 * @param {object} opts.decision       - aiRouter.routeTask() decision (with teamPlan.enabled === true)
 * @param {string} opts.prompt         - User prompt
 * @param {string[]} [opts.imagePaths] - Valid local image paths
 * @param {string} [opts.mode]         - 'exec' | 'chat' | 'plan'
 * @param {string} opts.cwd            - Safe working directory
 * @param {Array} [opts.history]       - Prior chat messages (excluding current prompt)
 * @param {object} opts.job            - Mutable active job object (updates job.output & job.liveThought)
 * @param {Function} opts.onChunk      - (type, payload) => void
 * @param {Function} opts.onDone       - (exitCode, error, meta) => void
 * @param {object} [opts._deps]        - Optional test hooks (runner, buildWorkersFn)
 */
function runCrossTeamPipeline({
    decision,
    prompt,
    imagePaths = [],
    mode = 'exec',
    cwd,
    history = [],
    job,
    onChunk,
    onDone,
    _deps = {}
}) {
    const abortCtx = createAbortContext();
    const claimedBrains = new Set();
    const runner = _deps.runner || runSingleCandidate;
    const buildWorkersFn = _deps.buildWorkersFn || aiRouter.buildWorkerCandidates;
    const teamPlan = decision.teamPlan || {};

    const timeline = [];
    const steps = [];
    let currentAction = '🤝 เปิดระบบทีม AI ข้ามค่าย (3 ด่าน)...';

    const emitThought = (kind, text) => {
        const clean = String(text || '').trim();
        if (!clean) return;
        const ts = Date.now();
        timeline.push({ kind: kind || 'status', text: clean, ts });
        if (timeline.length > 160) timeline.shift();
        if (kind === 'tool' || kind === 'tool_ok') steps.push(clean);
        currentAction = clean;
        const payload = {
            currentAction,
            thinking: steps.length ? 'ความคืบหน้าสายพาน 3 ด่าน:\n' + steps.slice(-25).map((s, i) => `${i + 1}. ${s}`).join('\n') : clean,
            steps: [...steps],
            stepsCount: steps.length,
            timeline: [...timeline],
            engine: 'cross-team'
        };
        if (job) job.liveThought = payload;
        try { onChunk('thought', payload); } catch (_) {}
    };

    const appendOut = (chunk) => {
        if (!chunk) return;
        if (job) job.output += chunk;
        try { onChunk('stdout', chunk); } catch (_) {}
    };

    const pipelineStart = Date.now();

    (async () => {
        const workersAvailLabel = (teamPlan.workerAccounts || []).length >= 2
            ? 'Gemini Neon / Hydrogen / Flash (G1+G2 ขนาน)'
            : 'Gemini Neon / Hydrogen / Flash';

        // Emit Cross-Team header banner
        const banner = aiRouter.formatTeamBanner(decision, {
            architect: teamPlan.architects && teamPlan.architects[0],
            workersLabel: workersAvailLabel,
            reviewer: teamPlan.reviewers && teamPlan.reviewers[0]
        });
        appendOut(banner);
        emitThought('init', `Cross-Team Pipeline · ${teamPlan.reason || 'งานซับซ้อน'}`);

        // ── STAGE 1: ARCHITECT (STRICT READ-ONLY) ────────────────────────────
        emitThought('status', '🏗️ ด่าน 1/3 · Architect กำลังสำรวจโค้ดและวางพิมพ์เขียว...');
        const archPrompt = buildArchitectPrompt({
            prompt,
            history,
            imagePaths,
            cwd,
            mode,
            workerAccounts: teamPlan.workerAccounts
        });

        const archRes = await runWithFailover(teamPlan.architects, {
            stageName: 'architect',
            prompt: archPrompt,
            cwd,
            readOnly: true,
            mode,
            timeoutMs: STAGE_TIMEOUT_MS.architect,
            idleMs: STAGE_IDLE_MS.architect,
            rolePrefix: '🏗️ Architect',
            decision,
            originalPrompt: prompt,
            onThoughtEvent: emitThought,
            abortCtx,
            claimedBrains,
            runner
        });

        if (archRes.aborted || abortCtx.aborted) {
            return onDone(130, 'aborted', { stage: 'architect' });
        }
        if (!archRes.ok) {
            aiRouter.logDecision({ source: 'cross-team', prompt, decision, event: 'stage1-failed', extra: { error: archRes.error, tried: archRes.tried, steps: archRes.stepsCount || 0, ms: archRes.durationMs, outputChars: String(archRes.output || '').length } });
            return onDone(1, archRes.error || 'Architect failed', { stage: 'architect', canFallbackSingle: true });
        }

        const archWho = archRes.candidate ? `${archRes.candidate.label} (${archRes.candidate.accountLabel})` : 'Architect';
        let plan = parseArchitectPlan(archRes.output, { cwd, mode });

        // Direct-answer short-circuit if Architect determined no Workers needed
        if (plan && plan.direct_answer && plan.answer) {
            appendOut(`> 🏗️ **ด่าน 1 (Architect · ${archWho})** (${(archRes.durationMs / 1000).toFixed(1)}s) — ตอบได้ทันทีไม่ต้องแตกทีม Worker\n\n---\n\n${plan.answer}`);
            aiRouter.logDecision({ source: 'cross-team', prompt, decision, event: 'completed', extra: { directAnswer: true, architect: archRes.candidate && `${archRes.candidate.model}@${archRes.candidate.account}`, totalMs: Date.now() - pipelineStart } });
            return onDone(0, null, { directAnswer: true });
        }

        // Graceful fallback if Architect output wasn't valid JSON or returned 0 tasks
        if (!plan || !plan.tasks.length) {
            emitThought('status', '⚠️ Architect ไม่ส่ง JSON ตามสกีมา — ห่อพิมพ์เขียวเป็นงานย่อย 1 ข้อให้ Gemini 4 Neon ทำต่อ');
            plan = {
                direct_answer: false,
                summary: (plan && plan.summary) || 'ดำเนินการตามพิมพ์เขียวของ Architect',
                architecture_notes: archRes.output,
                acceptance_criteria: (plan && plan.acceptance_criteria) || ['ทำงานตรงตามคำสั่งผู้ใช้ครบถ้วนและตรวจสอบความถูกต้องเรียบร้อย'],
                tasks: [{
                    id: 't1',
                    title: 'ลงมือทำงานตามพิมพ์เขียว Architect',
                    model: 'neon',
                    access: mode === 'exec' ? 'write' : 'read',
                    files: [],
                    depends_on: [],
                    instructions: `ดำเนินการให้ครบถ้วนตามรายละเอียดและแผนที่ Architect วางไว้ข้างต้น และตรวจสอบความถูกต้องก่อนรายงานผล`
                }]
            };
        }

        const taskListSummary = plan.tasks.map((t) => `${t.id}:${t.title} [${t.model}/${t.access}]`).join(' · ');
        appendOut(`> 🏗️ **ด่าน 1 (Architect · ${archWho}) เสร็จแล้ว** (${(archRes.durationMs / 1000).toFixed(1)}s) — แตกงาน ${plan.tasks.length} ข้อ: ${taskListSummary}\n\n`);
        emitThought('tool_ok', `🏗️ Architect เสร็จแล้ว (${plan.tasks.length} ข้อย่อย) → ส่งต่อทีม Gemini Workers`);

        // ── STAGE 2: WORKERS (GEMINI G1 + G2 WITH FILE-CONFLICT GUARD) ───────
        const allTargetFiles = [...new Set(plan.tasks.flatMap((t) => t.files))];
        const snapshot = await captureWorkspaceSnapshot(cwd, allTargetFiles);

        const stage2Start = Date.now();
        emitThought('status', `⚡ ด่าน 2/3 · กำลังส่งงาน ${plan.tasks.length} ข้อให้ทีม Gemini Workers...`);

        const wave1 = await runWorkerWave(plan.tasks, {
            plan,
            originalPrompt: prompt,
            imagePaths,
            cwd,
            mode,
            decision,
            workerAccounts: teamPlan.workerAccounts,
            maxParallelWorkers: teamPlan.maxParallelWorkers,
            isRework: false,
            onThoughtEvent: emitThought,
            abortCtx,
            claimedBrains,
            buildWorkersFn,
            runner
        });

        if (abortCtx.aborted) {
            return onDone(130, 'aborted', { stage: 'workers' });
        }

        const stage2Ms = Date.now() - stage2Start;
        const formatWorkerChips = (results) => results.map((r) => {
            const w = r.candidate ? `${r.candidate.label} @${String(r.candidate.account || '').toUpperCase()}` : r.task.model;
            const icon = r.ok ? '✅' : (r.skipped ? '⏭️' : '⚠️');
            return `${r.task.id}: ${w} ${icon}`;
        }).join(' · ');

        appendOut(`> ⚡ **ด่าน 2 (Workers) เสร็จแล้ว** (${(stage2Ms / 1000).toFixed(1)}s${wave1.ranInParallel ? ' · รันขนาน G1+G2' : ''}) — ${formatWorkerChips(wave1.results)}\n\n`);

        let allWorkerResults = [...wave1.results];

        // ── STAGE 3: REVIEWER (STRICT READ-ONLY + MAX 1 REWORK LOOP) ─────────
        let finalAnswer = '';
        let reviewerUsed = null;
        let reviewDurationMs = 0;

        for (let reworkRound = 0; reworkRound <= MAX_REWORK_ROUNDS; reworkRound++) {
            const changesSummary = await summarizeWorkspaceChanges(cwd, snapshot, allTargetFiles);
            emitThought('status', `🔍 ด่าน 3/3 · Reviewer กำลังตรวจงาน${reworkRound > 0 ? ' (รอบสุดท้ายหลังแก้ไข)' : ''}...`);

            const revPrompt = buildReviewerPrompt({
                originalPrompt: prompt,
                history,
                plan,
                workerResults: allWorkerResults,
                changesSummary,
                cwd,
                mode,
                reworkRound
            });

            const revRes = await runWithFailover(teamPlan.reviewers, {
                stageName: reworkRound === 0 ? 'reviewer' : `reviewer-round${reworkRound}`,
                prompt: revPrompt,
                cwd,
                readOnly: true,
                mode,
                timeoutMs: STAGE_TIMEOUT_MS.reviewer,
                idleMs: STAGE_IDLE_MS.reviewer,
                rolePrefix: '🔍 Reviewer',
                decision,
                originalPrompt: prompt,
                onThoughtEvent: emitThought,
                abortCtx,
                claimedBrains,
                runner
            });

            if (revRes.aborted || abortCtx.aborted) {
                return onDone(130, 'aborted', { stage: 'reviewer' });
            }

            if (!revRes.ok) {
                // Even if Reviewer completely fails across all models, present Worker outputs cleanly!
                const fallbackBody = allWorkerResults.map((r) => `### ${r.task.id}: ${r.task.title}\n${r.output || r.error || '(ไม่มีผลลัพธ์)'}`).join('\n\n');
                appendOut(`> ⚠️ **ด่าน 3 (Reviewer) ไม่สามารถทำงานได้** (${revRes.error}) — แสดงผลสรุปจากทีม Workers โดยตรง:\n\n---\n\n${fallbackBody}`);
                aiRouter.logDecision({ source: 'cross-team', prompt, decision, event: 'reviewer-failed', extra: { error: revRes.error, totalMs: Date.now() - pipelineStart } });
                return onDone(0, null, { reviewerFallback: true });
            }

            reviewerUsed = revRes.candidate;
            reviewDurationMs += revRes.durationMs;

            const verdict = parseReviewerVerdict(revRes.output, {
                cwd,
                mode,
                allowRework: reworkRound < MAX_REWORK_ROUNDS && mode === 'exec'
            });

            if (verdict.verdict === 'rework' && verdict.reworkTasks.length > 0 && reworkRound < MAX_REWORK_ROUNDS) {
                const revWho = reviewerUsed ? `${reviewerUsed.label} (${reviewerUsed.accountLabel})` : 'Reviewer';
                const issueTxt = verdict.issues.length ? ` (${verdict.issues.slice(0, 2).join('; ')})` : '';
                appendOut(`> 🔁 **ด่าน 3 (Reviewer · ${revWho}) พบจุดต้องแก้ไข${issueTxt}** → ส่งกลับทีม Gemini แก้ไข ${verdict.reworkTasks.length} ข้อ...\n\n`);
                emitThought('status', `🔁 Reviewer สั่งแก้ไข ${verdict.reworkTasks.length} ข้อ → ส่งให้ Gemini Workers...`);

                const reworkStart = Date.now();
                const rwWave = await runWorkerWave(verdict.reworkTasks, {
                    plan,
                    originalPrompt: prompt,
                    imagePaths,
                    cwd,
                    mode,
                    decision,
                    workerAccounts: teamPlan.workerAccounts,
                    maxParallelWorkers: teamPlan.maxParallelWorkers,
                    isRework: true,
                    onThoughtEvent: emitThought,
                    abortCtx,
                    claimedBrains,
                    buildWorkersFn,
                    runner
                });
                if (abortCtx.aborted) {
                    return onDone(130, 'aborted', { stage: 'rework' });
                }
                for (const t of verdict.reworkTasks) {
                    for (const f of t.files) allTargetFiles.push(f);
                }
                allWorkerResults = [...allWorkerResults, ...rwWave.results];
                appendOut(`> ⚡ **รอบแก้ไขเสร็จแล้ว** (${((Date.now() - reworkStart) / 1000).toFixed(1)}s) — ${formatWorkerChips(rwWave.results)}\n\n`);
                continue;
            }

            finalAnswer = verdict.finalAnswer;
            break;
        }

        const revWho = reviewerUsed ? `${reviewerUsed.label} (${reviewerUsed.accountLabel})` : 'Reviewer';
        // รอบสุดท้ายผู้ตรวจต้องสรุปเสมอ (ห้ามสั่งแก้อีก) → ถ้ายังมี Worker ที่ไม่สำเร็จ ห้ามติดป้ายว่า "เรียบร้อย"
        const failedWorkers = allWorkerResults.filter((r) => !r.ok);
        const incomplete = failedWorkers.length > 0;
        const failedChips = failedWorkers.map((r) => `${r.skipped ? '⏭️ ' : ''}${r.task.id}${r.error ? ` (${String(r.error).slice(0, 60)})` : ''}`).join(', ');
        appendOut(incomplete
            ? `> ⚠️ **ด่าน 3 (Reviewer · ${revWho}) ตรวจแล้ว แต่งานยังไม่ครบ** — Worker ที่ไม่สำเร็จ ${failedWorkers.length} ข้อ: ${failedChips} (${(reviewDurationMs / 1000).toFixed(1)}s · รวมทั้งหมด ${((Date.now() - pipelineStart) / 1000).toFixed(1)}s)\n\n---\n\n${finalAnswer}`
            : `> 🔍 **ด่าน 3 (Reviewer · ${revWho}) ตรวจเรียบร้อยแล้ว** (${(reviewDurationMs / 1000).toFixed(1)}s · รวมทั้งหมด ${((Date.now() - pipelineStart) / 1000).toFixed(1)}s)\n\n---\n\n${finalAnswer}`);
        emitThought('tool_ok', incomplete ? `⚠️ สายพานทีม AI ข้ามค่ายจบแล้ว แต่มี Worker ไม่สำเร็จ ${failedWorkers.length} ข้อ` : '✅ สายพานทีม AI ข้ามค่าย 3 ด่านทำงานเสร็จสมบูรณ์');

        aiRouter.logDecision({
            source: 'cross-team',
            prompt,
            decision,
            event: 'completed',
            extra: {
                architect: archRes.candidate && `${archRes.candidate.model}@${archRes.candidate.account}`,
                workers: allWorkerResults.map((r) => ({ id: r.task.id, model: r.candidate && r.candidate.model, account: r.candidate && r.candidate.account, ok: r.ok, skipped: Boolean(r.skipped), steps: r.stepsCount || 0, ms: r.durationMs, error: r.ok ? undefined : String(r.error || '').slice(0, 120) })),
                incomplete,
                reviewer: reviewerUsed && `${reviewerUsed.model}@${reviewerUsed.account}`,
                ranInParallel: wave1.ranInParallel,
                totalMs: Date.now() - pipelineStart
            }
        });
        onDone(0, null, { completed: true, incomplete });
    })().catch((err) => {
        console.error('[CrossTeam] Pipeline crashed:', err);
        onDone(1, err.message || String(err), { stage: 'crash' });
    });

    return {
        abort: () => abortCtx.abortAll()
    };
}

module.exports = {
    runCrossTeamPipeline,
    // Export pure helpers for unit testing
    tasksConflict,
    pathsOverlap,
    normalizeTargetPath,
    extractJsonObject,
    breakDependencyCycles,
    sanitizeTasks,
    parseArchitectPlan,
    parseReviewerVerdict,
    buildReviewerPrompt,
    runWorkerWave,
    runWithFailover,
    // ตัวรัน/ตัวจับเวลา — export ให้เทสต์ (test/cross-team-watchdog.test.js)
    makeWatchdog,
    treeCpuSeconds,
    runAgySubprocess,
    STAGE_TIMEOUT_MS,
    STAGE_IDLE_MS
};
