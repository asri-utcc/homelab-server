'use strict';
// Server Audit & AI Flight Recorder ("Black Box").
// Append-only JSONL, crash-safe, zero dependencies. Never throws into callers.
// Spec: homelab-server/docs/superpowers/specs/2026-11-24-server-audit-flight-recorder-design.md

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const AUDIT_DIR = process.env.AUDIT_DIR || path.join(os.homedir(), '.gemini', 'audit');
const EVENTS_DIR = path.join(AUDIT_DIR, 'events');
const RUNS_DIR = path.join(AUDIT_DIR, 'runs');
const DIFFS_DIR = path.join(AUDIT_DIR, 'diffs');
const COLD_DIR = path.join(AUDIT_DIR, 'cold');
const ACTIVE_FILE = path.join(AUDIT_DIR, 'active-runs.json');
const GDRIVE_ARCHIVE = process.env.AUDIT_ARCHIVE_DIR || '/mnt/gdrive/homelab-audit-archive';

const MAX_EVENT_TEXT = 1500;
const MAX_PROMPT = 16 * 1024;
const MAX_DIFF = 64 * 1024;
const SCAN_MAX_FILES = 3000;
const SCAN_MAX_MS = 1500;
const SCAN_MAX_DEPTH = 3;
const SCAN_SKIP = new Set(['node_modules', '.git', '.next', 'dist', '__pycache__', 'tmp', 'cron-logs']);
const HOT_DAYS = 90;

const active = new Map(); // jobId -> in-memory run state (incl. preSnapshot)
let lastActiveWrite = 0;
let cronSkippedOk = 0;

// ── helpers ─────────────────────────────────────────────────────────────────
function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
}
function ensureDirs() {
    for (const d of [AUDIT_DIR, EVENTS_DIR, RUNS_DIR, DIFFS_DIR]) fs.mkdirSync(d, { recursive: true });
}
function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function monthStr(ts) { return dateStr(ts).slice(0, 7); }

function redactSecrets(input) {
    if (input == null) return input;
    let s = String(input);
    s = s.replace(/Bearer\s+[A-Za-z0-9._~+\/=-]{8,}/g, 'Bearer ***REDACTED***');
    s = s.replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '***REDACTED***');
    s = s.replace(/\bAIza[A-Za-z0-9_-]{20,}/g, '***REDACTED***');
    s = s.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '***REDACTED***');
    s = s.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '***REDACTED***');
    s = s.replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, '***REDACTED***');
    s = s.replace(
        /\b((?:[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|SESSION[_-]?KEY)[A-Z0-9_]*)|api[_-]?key|apikey|token|secret|password|passwd|session[_-]?key)(["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi,
        (m, k, sep) => `${k}${sep}***REDACTED***`
    );
    return s;
}
function clip(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + '…' : s;
}

function appendLine(file, obj) {
    ensureDirs();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}
function readJsonl(file) {
    let raw;
    if (file.endsWith('.gz')) raw = safe(() => zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'), '');
    else raw = safe(() => fs.readFileSync(file, 'utf8'), '');
    const out = [];
    for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line)); } catch (_) { /* partial trailing line */ }
    }
    return out;
}
function writeActiveFile() {
    const obj = {};
    for (const [id, r] of active) {
        const { preSnapshot, toolTouches, ...rest } = r;
        obj[id] = { ...rest, preSnapshotMeta: preSnapshot ? { git: preSnapshot.gitRoot || null, files: preSnapshot.files ? preSnapshot.files.size : 0 } : null };
    }
    const tmp = ACTIVE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, ACTIVE_FILE);
}
function persistActive(force) {
    const now = Date.now();
    if (!force && now - lastActiveWrite < 5000) return;
    lastActiveWrite = now;
    safe(() => { ensureDirs(); writeActiveFile(); });
}

// ── workspace snapshot / reconcile ──────────────────────────────────────────
function gitRootOf(cwd) {
    return safe(() => execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null, null);
}
function scanDir(root, maxDepth) {
    const files = new Map();
    const deadline = Date.now() + SCAN_MAX_MS;
    const walk = (dir, depth) => {
        if (files.size >= SCAN_MAX_FILES || Date.now() > deadline) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const e of entries) {
            if (files.size >= SCAN_MAX_FILES || Date.now() > deadline) return;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (SCAN_SKIP.has(e.name) || depth >= maxDepth) continue;
                walk(full, depth + 1);
            } else if (e.isFile()) {
                try {
                    const st = fs.statSync(full);
                    files.set(full, { m: Math.round(st.mtimeMs), s: st.size });
                } catch (_) { /* vanished */ }
            }
        }
    };
    walk(root, 0);
    return files;
}
function captureWorkspaceSnapshot(cwd) {
    if (!cwd || !fs.existsSync(cwd)) return null;
    return { cwd, gitRoot: gitRootOf(cwd), files: scanDir(cwd, SCAN_MAX_DEPTH), at: Date.now() };
}
function reconcileWorkspaceDiff(pre, toolTouches) {
    const result = { files: [], diffText: '' };
    if (!pre) return result;
    const post = scanDir(pre.cwd, SCAN_MAX_DEPTH);
    const touched = toolTouches || new Map();
    const changed = [];
    for (const [f, now] of post) {
        const was = pre.files.get(f);
        if (!was) changed.push({ path: f, action: 'create', sizeBefore: 0, sizeAfter: now.s, mtime: now.m });
        else if (was.m !== now.m || was.s !== now.s) changed.push({ path: f, action: 'modify', sizeBefore: was.s, sizeAfter: now.s, mtime: now.m });
    }
    for (const [f, was] of pre.files) {
        if (!post.has(f)) changed.push({ path: f, action: 'delete', sizeBefore: was.s, sizeAfter: 0, mtime: Date.now() });
    }
    for (const c of changed) {
        const reported = touched.has(c.path) && touched.get(c.path).some((a) => a !== 'read');
        result.files.push({ ...c, deltaBytes: c.sizeAfter - c.sizeBefore, unreported: !reported });
    }
    // Decision D1: unified diff only inside git repos.
    if (pre.gitRoot && changed.length) {
        const paths = changed.filter((c) => c.action !== 'create').map((c) => c.path).slice(0, 50);
        if (paths.length) {
            const diff = safe(() => execFileSync('git', ['-C', pre.gitRoot, 'diff', '--unified=2', '--', ...paths], { timeout: 3000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString(), '');
            result.diffText = redactSecrets(diff).slice(0, MAX_DIFF);
            const num = safe(() => execFileSync('git', ['-C', pre.gitRoot, 'diff', '--numstat', '--', ...paths], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString(), '');
            for (const line of num.split('\n')) {
                const m = line.match(/^(\d+)\t(\d+)\t(.+)$/);
                if (!m) continue;
                const abs = path.join(pre.gitRoot, m[3]);
                const f = result.files.find((x) => x.path === abs);
                if (f) { f.insertions = Number(m[1]); f.deletions = Number(m[2]); }
            }
        }
    }
    return result;
}

// ── tool touch extraction ───────────────────────────────────────────────────
function extractTouches(text) {
    const out = [];
    const s = String(text || '');
    const paths = s.match(/(?<![\w.:\/])(?:\/[\w.@+~-]+){2,}/g) || [];
    if (!paths.length) return out;
    let action = 'mention';
    if (/\b(Edit|MultiEdit|NotebookEdit|แก้ไข)\b|✏️/i.test(s)) action = 'edit';
    else if (/\b(Write|สร้างไฟล์|เขียน)\b|📝/i.test(s)) action = 'write';
    else if (/\b(Read|Grep|Glob|อ่าน)\b|📖|🔍/i.test(s)) action = 'read';
    else if (/\bBash\b|\$ |⚡/i.test(s)) action = 'exec';
    for (const p of paths) out.push({ path: p.replace(/[.:]+$/, ''), action });
    return out;
}

// ── run lifecycle ───────────────────────────────────────────────────────────
function emit(jobId, kind, text, meta) {
    safe(() => {
        const r = active.get(jobId);
        const now = Date.now();
        const seq = r ? ++r.seq : 0;
        appendLine(path.join(EVENTS_DIR, `${r ? r.eventDate : dateStr(now)}.jsonl`), {
            ts: now, jobId, seq, kind,
            actor: (meta && meta.actor) || 'main',
            model: r ? r.model : undefined,
            account: r ? r.account : undefined,
            text: clip(redactSecrets(text), MAX_EVENT_TEXT),
            meta: meta || undefined
        });
        if (r) { r.lastHeartbeatAt = now; r.lastStepText = clip(redactSecrets(text), 200); persistActive(false); }
    });
}

function startRun(info) {
    return safe(() => {
        ensureDirs();
        const now = info.startedAt || Date.now();
        const jobId = info.jobId || `job_${now}_${Math.random().toString(36).slice(2, 6)}`;
        const r = {
            jobId, source: info.source || 'chat', sessionId: info.sessionId || null, sessionTitle: info.sessionTitle || null,
            cwd: info.cwd || null, mode: info.mode || null,
            promptFull: clip(redactSecrets(info.prompt || ''), MAX_PROMPT),
            model: info.model || null, account: info.account || null,
            isTeam: !!info.isTeam, workers: info.workers || [],
            startedAt: now, eventDate: dateStr(now), status: 'running',
            hostPid: process.pid, pid: info.pid || null, seq: 0, stepsCount: 0,
            lastHeartbeatAt: now, lastStepText: '',
            toolTouches: new Map(),
            preSnapshot: info.cwd ? safe(() => captureWorkspaceSnapshot(info.cwd), null) : null
        };
        active.set(jobId, r);
        emit(jobId, 'job_start', clip(info.prompt || '', 300), { source: r.source, sessionId: r.sessionId, cwd: r.cwd });
        persistActive(true);
        return jobId;
    }, null);
}

function updateRun(jobId, patch) {
    const r = active.get(jobId);
    if (!r || !patch) return;
    for (const k of ['model', 'account', 'pid', 'isTeam', 'workers', 'sessionTitle']) if (patch[k] !== undefined) r[k] = patch[k];
    persistActive(false);
}

function recordEvent(jobId, kind, text, meta) {
    const r = active.get(jobId);
    if (r && kind === 'tool') {
        r.stepsCount++;
        for (const t of extractTouches(text)) {
            const arr = r.toolTouches.get(t.path) || [];
            if (!arr.includes(t.action)) arr.push(t.action);
            r.toolTouches.set(t.path, arr);
        }
    }
    emit(jobId, kind, text, meta);
}

// Feed the live timeline array (grows monotonically); only new entries are logged.
function observeTimeline(jobId, timeline) {
    const r = active.get(jobId);
    if (!r || !Array.isArray(timeline)) return;
    const from = r.timelineSeen || 0;
    if (timeline.length < from) { r.timelineSeen = timeline.length; return; }
    for (let i = from; i < timeline.length; i++) {
        const e = timeline[i] || {};
        const kind = ['think', 'tool', 'tool_ok', 'status', 'probe', 'worker_start', 'worker_done'].includes(e.kind) ? e.kind : 'status';
        if (kind === 'think') {
            const t = String(e.text || '');
            if (t.length < 20 && i < timeline.length - 1) continue;
        }
        recordEvent(jobId, kind, e.text || '', { entryTs: e.ts });
    }
    r.timelineSeen = timeline.length;
}

function probe(jobId, data) {
    const r = active.get(jobId);
    if (!r) return;
    const now = Date.now();
    if (r.lastProbeAt && now - r.lastProbeAt < 14000) return;
    r.lastProbeAt = now;
    emit(jobId, 'probe', `watchdog pid=${data && data.pid} rss=${data && data.rssMb}MB`, data || {});
}

function finishRun(jobId, result) {
    return safe(() => {
        const r = active.get(jobId);
        if (!r) return null;
        result = result || {};
        const finishedAt = Date.now();
        const rec = reconcileWorkspaceDiff(r.preSnapshot, r.toolTouches);
        // merge tool-reported touches that left no fs trace (reads, in-place no-ops, outside cwd)
        const files = rec.files.map((f) => ({
            path: f.path, actions: Array.from(new Set([f.action, ...(r.toolTouches.get(f.path) || [])])),
            sources: r.toolTouches.has(f.path) ? ['tool', 'fs_scan'] : ['fs_scan'],
            sizeBefore: f.sizeBefore, sizeAfter: f.sizeAfter, deltaBytes: f.deltaBytes,
            insertions: f.insertions, deletions: f.deletions, unreported: f.unreported
        }));
        for (const [p, acts] of r.toolTouches) {
            if (!files.some((f) => f.path === p) && acts.some((a) => a !== 'mention' && a !== 'exec')) {
                files.push({ path: p, actions: acts, sources: ['tool'], unreported: false });
            }
        }
        const unreported = files.filter((f) => f.unreported).length;
        let diffFile = null;
        if (rec.diffText) {
            const rel = `${monthStr(r.startedAt)}/${jobId}.diff.txt`;
            safe(() => {
                fs.mkdirSync(path.join(DIFFS_DIR, monthStr(r.startedAt)), { recursive: true });
                fs.writeFileSync(path.join(DIFFS_DIR, rel), rec.diffText);
                diffFile = rel;
            });
        }
        const status = result.status || (result.error ? 'error' : 'completed');
        const summary = {
            jobId, source: r.source, sessionId: r.sessionId, sessionTitle: r.sessionTitle, cwd: r.cwd, mode: r.mode,
            promptFull: r.promptFull, model: r.model, account: r.account, isTeam: r.isTeam, workers: r.workers,
            startedAt: r.startedAt, finishedAt, durationMs: finishedAt - r.startedAt, eventDate: r.eventDate,
            status, exitCode: result.exitCode == null ? null : result.exitCode,
            error: result.error ? clip(redactSecrets(result.error), 500) : null,
            stepsCount: r.stepsCount, tokenUsage: result.tokenUsage || null,
            filesTouched: files.slice(0, 200), unreportedFilesCount: unreported, diffFile,
            answerPreview: clip(redactSecrets(result.answer || ''), 500)
        };
        emit(jobId, 'job_end', `${status}${result.error ? ': ' + result.error : ''}`, { exitCode: summary.exitCode, files: files.length, unreported });
        appendLine(path.join(RUNS_DIR, `${monthStr(r.startedAt)}.jsonl`), summary);
        active.delete(jobId);
        persistActive(true);
        return summary;
    }, null);
}

// ── crash sweep on boot ─────────────────────────────────────────────────────
function pidAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function sweepOrphanedRunsOnBoot() {
    return safe(() => {
        if (!fs.existsSync(ACTIVE_FILE)) return [];
        const saved = safe(() => JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8')), {});
        const swept = [];
        for (const [jobId, r] of Object.entries(saved)) {
            if (active.has(jobId)) continue;
            if (r.hostPid === process.pid) continue;
            const ownerAlive = r.hostPid && pidAlive(r.hostPid);
            if (ownerAlive) continue;
            const events = readJsonl(path.join(EVENTS_DIR, `${r.eventDate}.jsonl`)).filter((e) => e.jobId === jobId);
            const last = events[events.length - 1];
            const finishedAt = (last && last.ts) || r.lastHeartbeatAt || r.startedAt;
            appendLine(path.join(EVENTS_DIR, `${r.eventDate}.jsonl`), {
                ts: Date.now(), jobId, seq: (last ? last.seq : 0) + 1, kind: 'job_crashed',
                text: 'process_died_or_server_restarted', meta: { lastStep: r.lastStepText || (last && last.text) || '' }
            });
            const { preSnapshotMeta, ...base } = r;
            const summary = {
                ...base, status: 'crashed_midway', finishedAt, durationMs: finishedAt - r.startedAt,
                exitCode: null, error: 'process_died_or_server_restarted',
                stepsCount: events.filter((e) => e.kind === 'tool').length,
                filesTouched: [], unreportedFilesCount: 0, diffFile: null, tokenUsage: null,
                answerPreview: `🔴 ดับกลางคัน — ขั้นสุดท้าย: ${r.lastStepText || (last && last.text) || '(ไม่มีข้อมูล)'}`
            };
            appendLine(path.join(RUNS_DIR, `${monthStr(r.startedAt)}.jsonl`), summary);
            swept.push(summary);
        }
        safe(() => { fs.writeFileSync(ACTIVE_FILE + '.tmp', JSON.stringify(Object.fromEntries([...active].map(([k, v]) => [k, { jobId: k, hostPid: process.pid, eventDate: v.eventDate, startedAt: v.startedAt }])))); fs.renameSync(ACTIVE_FILE + '.tmp', ACTIVE_FILE); });
        return swept;
    }, []);
}

// ── cron filter (decision D2) ───────────────────────────────────────────────
function shouldAuditCron(run) {
    run = run || {};
    const yes = !!(run.aiInvoked || run.error || (run.exitCode != null && run.exitCode !== 0) || run.timedOut || run.telegramSent || run.manual);
    if (!yes) cronSkippedOk++;
    return yes;
}

// ── query ───────────────────────────────────────────────────────────────────
function listMonthFiles() {
    return safe(() => fs.readdirSync(RUNS_DIR).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort().reverse(), []);
}
function queryRuns(opts) {
    opts = opts || {};
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
    const offset = Math.max(Number(opts.offset) || 0, 0);
    const q = (opts.q || '').toLowerCase();
    const file = (opts.file || '').toLowerCase();
    const fromTs = opts.from ? new Date(opts.from + 'T00:00:00').getTime() : 0;
    const toTs = opts.to ? new Date(opts.to + 'T23:59:59.999').getTime() : Infinity;
    let rows = [];
    for (const f of listMonthFiles()) {
        const month = f.slice(0, 7);
        if (opts.from && month < opts.from.slice(0, 7)) break;
        if (opts.to && month > opts.to.slice(0, 7)) continue;
        rows = rows.concat(readJsonl(path.join(RUNS_DIR, f)));
    }
    rows = rows.filter((r) => {
        if (r.startedAt < fromTs || r.startedAt > toTs) return false;
        if (opts.source && opts.source !== 'all' && r.source !== opts.source) return false;
        if (opts.status && opts.status !== 'all' && r.status !== opts.status) return false;
        if (opts.unreported && !(r.unreportedFilesCount > 0)) return false;
        if (q && !`${r.promptFull} ${r.answerPreview} ${r.sessionTitle || ''}`.toLowerCase().includes(q)) return false;
        if (file && !(r.filesTouched || []).some((x) => x.path.toLowerCase().includes(file))) return false;
        return true;
    });
    rows.sort((a, b) => b.startedAt - a.startedAt);
    return { total: rows.length, runs: rows.slice(offset, offset + limit) };
}
function eventFileFor(date) {
    const plain = path.join(EVENTS_DIR, `${date}.jsonl`);
    if (fs.existsSync(plain)) return plain;
    for (const p of [path.join(COLD_DIR, 'events', `${date}.jsonl.gz`), path.join(GDRIVE_ARCHIVE, 'events', `${date}.jsonl.gz`)]) if (fs.existsSync(p)) return p;
    return null;
}
function getRun(jobId) {
    for (const f of listMonthFiles()) {
        const run = readJsonl(path.join(RUNS_DIR, f)).find((r) => r.jobId === jobId);
        if (!run) continue;
        const ef = eventFileFor(run.eventDate);
        const events = ef ? readJsonl(ef).filter((e) => e.jobId === jobId) : [];
        const diff = run.diffFile ? safe(() => fs.readFileSync(path.join(DIFFS_DIR, run.diffFile), 'utf8'), '') : '';
        return { run, events, diff };
    }
    const r = active.get(jobId);
    if (r) {
        const { preSnapshot, toolTouches, ...rest } = r;
        const ef = eventFileFor(r.eventDate);
        return { run: rest, events: ef ? readJsonl(ef).filter((e) => e.jobId === jobId) : [], diff: '' };
    }
    return null;
}
function liveRuns() {
    const now = Date.now();
    return [...active.values()].map((r) => ({
        jobId: r.jobId, source: r.source, sessionId: r.sessionId, model: r.model, account: r.account, pid: r.pid,
        startedAt: r.startedAt, elapsedMs: now - r.startedAt, lastStepText: r.lastStepText,
        promptSnippet: clip(r.promptFull, 120), pidAlive: r.pid ? pidAlive(r.pid) : null
    }));
}
function stats() {
    const now = Date.now();
    const out = { today: {}, d7: {}, d30: {}, all: {}, crashed: 0, unreported: 0, topFiles: [], cronSkippedOk };
    const files = {};
    for (const f of listMonthFiles()) {
        for (const r of readJsonl(path.join(RUNS_DIR, f))) {
            const age = now - r.startedAt;
            const bump = (b) => { b.total = (b.total || 0) + 1; b[r.source] = (b[r.source] || 0) + 1; b[r.status] = (b[r.status] || 0) + 1; };
            bump(out.all);
            if (age < 30 * 864e5) bump(out.d30);
            if (age < 7 * 864e5) bump(out.d7);
            if (dateStr(r.startedAt) === dateStr(now)) bump(out.today);
            if (r.status === 'crashed_midway') out.crashed++;
            if (r.unreportedFilesCount > 0) out.unreported++;
            for (const t of r.filesTouched || []) if (t.actions && t.actions.some((a) => ['edit', 'write', 'modify', 'create'].includes(a))) files[t.path] = (files[t.path] || 0) + 1;
        }
    }
    out.topFiles = Object.entries(files).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([p, n]) => ({ path: p, runs: n }));
    return out;
}

// ── cold archive ────────────────────────────────────────────────────────────
function archiveOldLogs(nowTs) {
    return safe(() => {
        const cutoff = dateStr((nowTs || Date.now()) - HOT_DAYS * 864e5);
        const moved = [];
        const gdriveOk = fs.existsSync(path.join(GDRIVE_ARCHIVE, '.audit_archive_ready'));
        for (const f of safe(() => fs.readdirSync(EVENTS_DIR), [])) {
            const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
            if (!m || m[1] >= cutoff) continue;
            const src = path.join(EVENTS_DIR, f);
            const gz = zlib.gzipSync(fs.readFileSync(src));
            const dests = [path.join(gdriveOk ? GDRIVE_ARCHIVE : COLD_DIR, 'events', `${m[1]}.jsonl.gz`)];
            const dest = dests[0];
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, gz);
            const verify = zlib.gunzipSync(fs.readFileSync(dest));
            if (verify.equals(fs.readFileSync(src))) { fs.unlinkSync(src); moved.push(dest); }
        }
        return moved;
    }, []);
}

module.exports = {
    AUDIT_DIR, redactSecrets, startRun, updateRun, recordEvent, observeTimeline, probe, finishRun,
    sweepOrphanedRunsOnBoot, shouldAuditCron, queryRuns, getRun, liveRuns, stats, archiveOldLogs,
    captureWorkspaceSnapshot, reconcileWorkspaceDiff, extractTouches,
    _active: active
};
