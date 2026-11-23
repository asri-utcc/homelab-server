# Design Document: Server Audit & AI Flight Recorder ("Black Box" Activity Monitor)

**Date:** 2026-11-24  
**Author:** Asrida (AI Assistant) & Asri (User)  
**Status:** Draft v2 — User decisions locked (2026-11-24); Pending Final Approval  
**Target Repo:** `/home/dev/projects/homelab-server` (`lab-dashboard/` & `scripts/`)  
**Live Runtime:** `/home/dev/projects/lab-dashboard`  

---

## 1. Intent & Why

### Problem Statement
Currently, AI activity and server operations in `lab-dashboard` are ephemeral and fragmented:
1. **Ephemeral Step Logs:** `gemini-manager.js` tracks real-time thinking, tool calls (`Read`, `Edit`, `Write`, `Bash`), watchdog probes, and cross-team worker execution inside `job.liveThought` (RAM only). Once a job ends (`persistJobToHistory()`), crashes, or the server restarts, all intermediate steps are discarded—only the final assistant message text is saved to `/home/dev/.gemini/sessions/sess_*.json`.
2. **Session Deletion Destroys History:** Deleting a chat room permanently deletes its `sess_*.json` file, leaving no trace of what commands were run or what files were modified by that room.
3. **Truncated Router Logs:** `ai-router-log.jsonl` only captures model selection metadata and truncates prompts to 120–200 characters without capturing file mutations, tool calls, or background worker behavior.
4. **Silent Overwrites & Unexplained Crashes:** As seen in past incidents (e.g., parallel sessions overwriting `public/gemini.html`, or AI processes dying silently mid-task), there is no way to audit:
   - What did the user command, when, and in which room/source?
   - Which AI model/account/worker executed it, what tools/commands did it run, and in which directory (`cwd`)?
   - Did it succeed, abort, crash midway (`SIGSEGV`/restart), or secretly touch/overwrite files outside its reported scope?

### Core Objective
Build a permanent, tamper-resistant, append-only **"Black Box" Flight Recorder + File-Touch & Diff Tracker** that captures every user prompt, AI step, cross-team worker, background cron job, and Agent Hub command in real time, persists forever across local NVMe and cold archive storage, detects mid-flight crashes automatically, and surfaces an intuitive audit timeline both inline inside chat bubbles and in a dedicated Activity & Audit Explorer.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
1. **Real-Time Per-Step Persistence (Crash-Safe):** Flush every meaningful event (`job_start`, `route`, `thought`, `tool`, `worker_*`, `probe`, `file_touch`, `job_end`) to disk immediately as append-only JSONL—not at job completion—so mid-flight crashes or server restarts never erase evidence up to the last step.
2. **Immutable Central Archive:** Store all audit logs in `/home/dev/.gemini/audit/` independent of chat session files (`sess_*.json`). Deleting a chat session must **never** delete its central audit history.
3. **File-Touch & Diff Truth Tracking:** Combine two signals per run:
   - *Tool-reported touches:* Parse `Read`, `Edit`, `Write`, `MultiEdit`, `Bash`, and `agy` brain tool events in real time.
   - *Filesystem/Git truth scan:* Snapshot `cwd` state before job start and after job completion/crash (using `git status --porcelain` + `git diff --numstat` when inside a git repo, plus bounded `mtime` scan for non-git paths or `homelab-server` / `lab-dashboard` sync targets) to catch unreported or concurrent file edits (`unreportedTouch: true`).
4. **Mid-Flight Crash & Orphan Detection:** On server startup (`init()`), sweep any run still marked `running` whose PID/owner is no longer alive, finalize it as `crashed_midway` with the last recorded timestamp, last step, and any partial git/fs mutations left behind.
5. **Unified Coverage Across All AI & Background Surfaces:**
   - Interactive web chat (`gemini-manager.js`: `executeAuto`, `executePrompt` for Agy, Claude Code, DeepSeek, and Recovery/Auto-Resume).
   - Cross-team multi-agent pipeline (`cross-team-orchestrator.js`: Architect, Workers `t1..tn`, Reviewer).
   - Scheduled background AI & scripts (`cron-ai-runner.py` & `cron-manager.js`).
   - Distributed worker nodes (`agent-hub-manager.js`: `dispatchCommand`, `renderJobs`).
6. **Forever Retention Without Disk Bloat:** Keep recent hot logs (`<= 90 days`) locally in fast JSONL format; automatically compress and archive older monthly partitions (`.jsonl.gz`) to `/mnt/gdrive/homelab-audit-archive/` (10 TB pool) while retaining lightweight run summaries locally for instant search.
7. **Dual Inspection UX:**
   - *Inline in Chat:* Collapsible step & file-touch drawer attached permanently to each assistant message in `gemini.html`.
   - *Central Audit Explorer:* Dedicated modal/view accessible from `gemini.html` & `index.html` with filters by status (`completed`, `crashed_midway`, `error`, `aborted`, `unreported_touch`), source (`chat`, `cross-team`, `cron`, `agent-hub`), date range, model, prompt text, and touched file path.

### Non-Goals
- **Kernel-level OS syscall auditing (`auditd` / `eBPF`):** We do not intercept arbitrary OS processes unrelated to AI/dashboard/cron/agent-hub operations.
- **Line-by-line diffs for non-Git folders (decision D1):** Folders outside a Git repo (e.g. live `lab-dashboard/`) record only file path, action, mtime and size delta (`+KB/-KB`). No pre-edit copies, no unified diff. Unified diffs are produced only inside Git repos (`git diff`).
- **Full-file snapshot backups per step:** We record touched file paths, action types (`read`, `write`, `edit`, `delete`), byte/line diff stats (`+ins/-del`), and concise unified diff excerpts (capped per file/run), not full copies of every file on disk.
- **External DB engines (SQLite/PostgreSQL/MongoDB):** Native SQLite bindings (`better-sqlite3`, `sqlite3`) are not installed in `lab-dashboard`. The design uses zero-dependency Node.js/Python append-only JSONL with partitioned daily/monthly files.

### Anti-Goals
- **Never block or crash primary AI/chat execution:** Audit writes and filesystem scans must be wrapped in defensive `try/catch` / bounded timeouts. If disk I/O fails or `git` hangs, the AI task must proceed unaffected.
- **Never store unredacted secrets:** API keys, OAuth tokens, Telegram bot tokens, passwords, and `.env` secrets in prompts, commands, or outputs must be redacted before writing to disk.
- **Never trigger `admin` autofill in UI search inputs:** All filter/search inputs in the Audit Explorer must enforce `type="search"`, `autocomplete="off"`, `data-lpignore="true"`, and explicit value reset on open (per Homelab UI rules).

---

## 3. Constraints & Existing System Context

- **Runtime:** Node.js (`lab-dashboard/server.js`, port 8090 via PM2) + Python 3 (`/home/dev/projects/cron-ai-runner.py`).
- **Disk Space:** `/` has 19 GB free, `/home` has 116 GB free, `/mnt/gdrive` has 10 TB free.
- **No Unnecessary Restarts During Implementation:** Editing static UI files (`public/gemini.html`) must not force a `pm2 restart lab-dashboard` while other AI chats are running (`activeRuns.size > 0`).
- **Monorepo Rule:** All code, docs, and helper scripts live in `/home/dev/projects/homelab-server` (synced from live `/home/dev/projects/lab-dashboard`) and follow commit + push + Telegram notification rules.

---

## 4. Approaches Considered

| Approach | Summary | Trade-offs | Decision |
| :--- | :--- | :--- | :--- |
| **1. Real-time Flight Recorder Only** | Stream every tool/thought/worker event to `/home/dev/.gemini/audit/` and persist timeline in chat messages. | Lightweight and crash-safe, **but** misses actual files modified indirectly inside `Bash` commands (e.g., `python`, `cp`, `sed`) or concurrent overwrites. | Rejected |
| **2. Flight Recorder + File-Touch & Diff Tracker** | Real-time JSONL event stream **plus** pre/post workspace truth scanning (`git status`/`diff` & bounded `mtime` scan) and startup crash-recovery sweep. | Slightly more work per job start/end (a few milliseconds for git/fs scan), **but** definitively detects silent file overwrites, secret edits, and mid-flight crashes. | **Selected** |
| **3. End-of-Job Session Persistence Only** | Save `liveThought.timeline` into `sess_*.json` inside `persistJobToHistory()`. | Minimal code changes, **but** loses all logs if the process crashes/restarts mid-job and loses history if the user deletes the chat room. | Rejected |

---

## 5. System Architecture & Data Design

### 5.1 Directory & File Layout (`/home/dev/.gemini/audit/`)

```text
/home/dev/.gemini/audit/
├── active-runs.json                 # Lock/registry of currently running jobIds + PID + startedAt + preSnapshot
├── events/
│   └── YYYY-MM-DD.jsonl             # Append-only real-time event stream (every step, thought, tool, probe, file_touch)
├── runs/
│   └── YYYY-MM.jsonl                # Monthly run index (1 JSON line per completed/crashed/aborted job summary)
├── diffs/
│   └── YYYY-MM/
│       └── <jobId>.diff.txt         # Bounded unified diff / file-change summary for jobs that mutated tracked files
└── archive-state.json               # Tracks which months have been gzipped & copied to /mnt/gdrive/homelab-audit-archive/
```

**Why partitioned JSONL (`events/YYYY-MM-DD.jsonl` + `runs/YYYY-MM.jsonl`)?**
- `runs/YYYY-MM.jsonl` stays small (~a few KB–MB per month) for sub-50ms filtering & listing across months/years.
- `events/YYYY-MM-DD.jsonl` isolates high-frequency step events by day so looking up a specific `jobId` (using `eventDate` stored in the run summary) only scans a single day's file instead of gigabytes of history.
- Every line is self-contained JSON so partial writes on hard power-loss only affect at most the trailing incomplete line (safely ignored by line parser).

### 5.2 Core Data Schemas

#### A. Run Summary Record (`runs/YYYY-MM.jsonl` & `active-runs.json`)
```json
{
  "jobId": "job_1795462000123_a1b2",
  "source": "chat",
  "sessionId": "sess_1795461148812_o8zc",
  "sessionTitle": "ตรวจสอบระบบล็อก",
  "cwd": "/home/dev/projects/lab-dashboard",
  "mode": "exec",
  "promptFull": "คำสั่งเต็มจากผู้ใช้ (redacted secrets)...",
  "model": "gemini-4-hydrogen-high",
  "account": "g2",
  "isTeam": false,
  "workers": [],
  "startedAt": 1795462000123,
  "finishedAt": 1795462045678,
  "durationMs": 45555,
  "eventDate": "2026-11-24",
  "status": "completed",
  "exitCode": 0,
  "error": null,
  "stepsCount": 8,
  "tokenUsage": { "inputTokens": 1200, "outputTokens": 450, "totalTokens": 1650 },
  "filesTouched": [
    {
      "path": "/home/dev/projects/lab-dashboard/server.js",
      "actions": ["read", "edit"],
      "sources": ["tool", "git_diff"],
      "insertions": 42,
      "deletions": 3,
      "unreported": false
    }
  ],
  "unreportedFilesCount": 0,
  "diffFile": "2026-11/job_1795462000123_a1b2.diff.txt",
  "answerPreview": "สรุปคำตอบ 500 ตัวอักษรแรก..."
}
```
- **Allowed `source` values:** `"chat"`, `"cross-team"`, `"recovery"`, `"cron"`, `"agent-hub"`.
- **Allowed `status` values:** `"running"`, `"completed"`, `"error"`, `"aborted"`, `"crashed_midway"`.

#### B. Event Stream Record (`events/YYYY-MM-DD.jsonl`)
```json
{
  "ts": 1795462005100,
  "jobId": "job_1795462000123_a1b2",
  "seq": 4,
  "kind": "tool",
  "actor": "main",
  "model": "gemini-4-hydrogen-high",
  "account": "g2",
  "text": "✏️ Edit: /home/dev/projects/lab-dashboard/server.js",
  "meta": {
    "tool": "Edit",
    "path": "/home/dev/projects/lab-dashboard/server.js",
    "action": "edit"
  }
}
```
- **Allowed `kind` values:** `"job_start"`, `"route"`, `"status"`, `"think"`, `"tool"`, `"tool_ok"`, `"probe"`, `"worker_start"`, `"worker_done"`, `"file_touch"`, `"diff_summary"`, `"job_end"`, `"job_crashed"`.
- **Throttling / Noise Control:**
  - `think` events: Only flush when thinking text changes meaningfully (e.g., new paragraph/heading or >= 400 chars delta since last flushed thought, or at least once before a `tool` event), capped at 1,500 chars per event.
  - `probe` (watchdog heartbeat every 15s): Flush as `probe` event with PID, RSS MB, and child processes so silent hangs or OOMs are clearly visible on the timeline.

### 5.3 Secret Redaction Filter (`audit-logger.js`)
Before any string enters `events/`, `runs/`, or `diffs/`, pass through `redactSecrets(str)`:
- Redact patterns matching:
  - `Bearer <token>`, `sk-<key>`, `AIza<key>`, `ghp_<key>`, `xoxb-<key>`
  - Telegram bot tokens (`\b\d{8,12}:[A-Za-z0-9_-]{30,}\b`)
  - Key-value assignments (`api_key`, `apikey`, `token`, `secret`, `password`, `passwd`, `session_key`, `DEEPSEEK_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`) with values replaced by `***REDACTED***`.

### 5.4 File-Touch & Diff Truth Tracker

To catch **every** file change—including changes made via shell commands (`Bash`), Python one-liners, or external scripts invoked by AI:

1. **Pre-Job Snapshot (`captureWorkspaceSnapshot(cwd)`):**
   - Check if `cwd` (or parent up to `/home/dev/projects`) is inside a Git repository (`git rev-parse --show-toplevel`, timeout 1,500ms).
   - If Git repo: record `gitStatusMap` (`Map<relPath, statusCode>` + `fileHash` or `mtimeMs:size` for already-dirty files so pre-existing dirty files are NOT falsely blamed on this job!).
   - Also capture `mtimeMs` + `size` for key watched directories (`cwd` depth <= 3, excluding `node_modules`, `.git`, `.next`, `dist`, `__pycache__`, `tmp`) bounded to max 3,000 files / 1,500ms timeout.
   - Store this baseline snapshot in memory on the active job + lightweight metadata in `active-runs.json`.

2. **Real-Time Tool Touch Extraction:**
   - Whenever `gemini-manager.js` or `cross-team-orchestrator.js` observes a tool call (`Read`, `Edit`, `Write`, `MultiEdit`, `Grep`, `Glob`, or `agy` tool summary), extract the target path and action (`read`, `write`, `edit`) immediately and emit a `file_touch` / `tool` event.
   - For `Bash` commands, run lightweight path-mention extraction for paths under `/home/dev/` (recorded as `mentioned` / `exec`).

3. **Post-Job Truth Reconciliation (`reconcileWorkspaceDiff(preSnapshot, cwd, toolTouches)`):**
   - Run after job finishes (or during crash recovery).
   - Compare post-job `git status --porcelain` / `mtimeMs:size` against `preSnapshot`:
     - Any file whose `mtimeMs` or `size` or git status changed during `[startedAt, finishedAt]` is marked as an observed mutation (`fs_scan` / `git_diff`).
     - **Decision D1:** in non-Git paths, record only `{path, action, sizeBefore, sizeAfter, mtime}`; never write a `diffs/` file for them.
   - If a mutated file was **not** present in `toolTouches` (e.g., modified silently via `Bash` script or concurrent session), flag `unreported: true` on that file entry and increment `unreportedFilesCount`!
   - Only if inside a Git repo and files were modified by this job, run `git diff --numstat` and `git diff --unified=2` (capped at 64 KB total per job) and save to `diffs/YYYY-MM/<jobId>.diff.txt`.

4. **Concurrent Session Conflict Awareness:**
   - Maintain an in-memory map of `activeJobWriters: Map<absFilePath, Set<jobId>>`. If two running jobs modify or touch the same file within overlapping windows, emit a `status` warning event (`⚠️ Concurrent edit detected on <file> while job <otherJobId> is also active`) into both jobs' audit streams.

### 5.5 Mid-Flight Crash & Orphan Sweep (`sweepOrphanedRunsOnBoot()`)
1. On `executePrompt` / `executeAuto` / `cron` start: write entry `{ jobId, pid, hostPid: process.pid, source, sessionId, promptSnippet, cwd, model, account, startedAt, eventDate, lastHeartbeatAt }` into `active-runs.json` (using atomic temp-file rename).
2. During execution: update `lastHeartbeatAt` & `lastStepText` in `active-runs.json` at most every 5 seconds (throttled) and on every tool call.
3. On clean finish / abort / handled error: remove `jobId` from `active-runs.json` and append final record to `runs/YYYY-MM.jsonl`.
4. **On `gemini-manager.js` startup (`init()`):**
   - Read `active-runs.json`.
   - For every entry whose `hostPid !== process.pid` (or whose child `pid` is dead via `process.kill(pid, 0)`):
     - Reconstruct `stepsCount` and `lastStep` by reading matching `jobId` events from `events/<eventDate>.jsonl`.
     - Run `reconcileWorkspaceDiff` on `cwd` (if `preSnapshot` was saved) to see what files were left modified on disk before the crash.
     - Append a `job_crashed` event to `events/<eventDate>.jsonl` (`reason: "process_died_or_server_restarted"`).
     - Append finalized run summary with `status: "crashed_midway"` to `runs/YYYY-MM.jsonl` and remove from `active-runs.json`.

### 5.6 Integration Across All Sources

| Source | Integration Hook | What Gets Captured |
| :--- | :--- | :--- |
| **Chat (Single Agent)** | `gemini-manager.js`: `executeAuto`, `executePrompt` (Agy, Claude Code, DeepSeek), `handoff` / `autoResume` | Full prompt, model/account routing & failovers, crash-heal retries, thinking summaries, all tool steps, 15s watchdog probes, file-touches, token usage, final status, exitCode. |
| **Chat (Cross-Team)** | `cross-team-orchestrator.js`: `runCrossTeamPipeline`, `runStage` | Parent `jobId` links Architect, each Worker (`t1..tn` with model, account, filesRead, filesWrite, steps, duration, ok/skip), Rework rounds, and Reviewer verdict. |
| **Cron Background AI & Scripts** (filtered, decision D2) | `/home/dev/projects/cron-ai-runner.py` & `cron-manager.js` | Direct append or localhost HTTP ingest (`POST /api/audit/ingest`) recording cron job ID/name, mode (`script`/`ai`/`script_ai`), command, AI model failover attempts, output summary, Telegram notify result. |
| **Agent Hub (Remote Nodes)** | `agent-hub-manager.js`: `dispatchCommand`, `createRenderJob`, job completion | Node ID/hostname, command action (`exec`, `fs.*`, `blender`, `render.ffmpeg`), command payload (redacted), exit status, output tail, duration. |

**Cron Audit Filter (decision D2):** A cron run is written to the audit only if at least one holds: (a) an AI model was actually invoked, (b) it ended in error/non-zero exit/timeout, (c) a Telegram notification was sent, (d) the user triggered it manually via Run. Routine `[OK]` runs that skip the AI (`server_health_check` every 5 min, quota check every 15 min) are not audited; they stay in `cron-logs/`. Skipped runs are counted in an in-memory counter shown in `/api/audit/stats` (`cronSkippedOk`).

### 5.7 Inline Chat History Persistence
In `gemini-manager.js` (`persistJobToHistory`):
- Attach `auditJobId` and a compact `auditSummary` (`{ stepsCount, filesTouched: [...], status, durationMs, unreportedFilesCount, timeline: last/key steps up to 80 items }`) to the saved assistant message in `sess_*.json`.
- **UI benefit:** When scrolling back in any chat room (even weeks later), each AI response renders a compact toggle bar:
  `🔍 ขั้นตอนการทำงาน (12 ขั้น · แก้ 3 ไฟล์ · 42.1s)` — clicking it expands the exact step-by-step timeline and files touched right inside the chat bubble, fetching full details from `/api/audit/runs/:jobId` if needed.

### 5.8 Forever Retention & Cold Archiver
- **Daily/Startup Maintenance Timer** (runs 60s after boot and once every 24h):
  - Check local `events/YYYY-MM-DD.jsonl` and `diffs/YYYY-MM/` older than **90 days**.
  - Gzip and archive them to `/mnt/gdrive/homelab-audit-archive/events/` and `/mnt/gdrive/homelab-audit-archive/diffs/` (if `/mnt/gdrive` is mounted & writable; otherwise keep compressed `.jsonl.gz` in `/home/dev/.gemini/audit/cold/` until `/mnt/gdrive` is available).
  - **Never delete `runs/YYYY-MM.jsonl`** from local disk unless a single month exceeds 50 MB (even 10,000 runs/month is only ~8 MB), so the Run Index stays searchable across all time instantaneously.
  - When viewing a run older than 90 days in the UI, the backend transparently reads from `.jsonl.gz` (local or `/mnt/gdrive`) on demand.

---

## 6. HTTP API & UI Design

### 6.1 Backend Endpoints (`server.js`)
All protected by existing dashboard session auth (`isAuthorized`):
- `GET /api/audit/live`: Currently active jobs from `active-runs.json` + in-memory `activeRuns` (with live PID status & elapsed time).
- `GET /api/audit/runs`: Query run history across `runs/*.jsonl` with parameters:
  - `q` (search prompt, answer preview, or session title)
  - `file` (filter runs that touched a matching file path)
  - `source` (`all|chat|cross-team|cron|agent-hub|recovery`)
  - `status` (`all|completed|crashed_midway|error|aborted`)
  - `unreported` (`1` = only runs with unreported file touches)
  - `from`, `to` (YYYY-MM-DD date range)
  - `limit` (default 50, max 200), `offset`
- `GET /api/audit/runs/:jobId`: Full run details + full ordered event timeline from `events/YYYY-MM-DD.jsonl` (or `.gz` archive) + unified diff excerpt from `diffs/YYYY-MM/<jobId>.diff.txt`.
- `GET /api/audit/stats`: Aggregated stats (today/7d/30d/all-time run counts by source & status, crash count, top most-modified files).
- `POST /api/audit/ingest`: Localhost-only (`127.0.0.1` / `::1` / Docker bridge `172.17.0.1` with internal secret or local check) endpoint used by `cron-ai-runner.py` to log cron runs cleanly without race conditions.

### 6.2 UI Layout (`public/gemini.html` & `public/index.html`)
1. **Topbar Entry Point:** Add a compact button `📜 ประวัติงาน AI` in `gemini.html` topbar (and inside mobile Settings modal + `index.html` Dashboard quick link) with a live badge showing any `crashed_midway` or `unreported` alerts from the last 24h.
2. **Audit Explorer Modal / Drawer (`#modal-audit`):**
   - **Live Now Strip:** Shows any currently running tasks across all rooms, Cron, and Agent Hub with PID, elapsed timer, and current action.
   - **Filter Bar:** Search box (`type="search"`, `autocomplete="off"`, `data-lpignore="true"`), File Path filter (`e.g., gemini.html`), Source chips (`ทั้งหมด`, `แชท`, `ทีมข้ามค่าย`, `Cron`, `Agent Hub`), Status chips (`สำเร็จ`, `ดับกลางคัน 🔴`, `ผิดพลาด`, `แตะไฟล์นอกเหนือแจ้ง ⚠️`), and Date Range.
   - **Split Master-Detail View:**
     - *Left List:* Chronological run cards showing timestamp, status badge, source badge, prompt snippet, model/account used, duration, and `📁 N ไฟล์`.
     - *Right Detail Pane:*
       - Header metadata (Full prompt, CWD, Session link, Model/Workers breakdown, Token usage, Start/End timestamps, Exit status / Crash reason).
       - **Files Touched Panel:** Table/chips of every file touched with badges (`Read`, `Edit`, `Write`, `⚠️ Unreported`) and expandable Unified Diff viewer.
       - **Black-Box Timeline:** Chronological step-by-step log (`[02:14:05] 🧠 Thought`, `[02:14:08] ✏️ Edit ...`, `[02:14:23] 💓 Watchdog ALIVE`, `[02:14:40] ✅ Done`).
3. **Inline Chat Bubble Step Drawer:**
   - Attached beneath each assistant message that has `auditJobId` or `auditSummary`. Collapsed by default (`🔍 ดูขั้นตอน (N ขั้น · X ไฟล์)`), expands cleanly on click without cluttering chat reading.

---

## 7. Security, Performance & Edge Cases

- **Concurrency / File Locking:** Node.js `fsp.appendFile` with single-line JSON payloads under PIPE_BUF/page size (~4 KB) is atomic enough for low-rate events, and for `active-runs.json` we use a serialized async write queue (`writeQueue = writeQueue.then(...)`) + atomic write-to-temp-and-rename so parallel chat rooms never corrupt `active-runs.json`.
- **Large Outputs / Diffs:** Cap per-event text at 1,500 chars, per-job diff file at 64 KB, and `promptFull` at 16 KB so a single run copying giant logs cannot bloat `runs/YYYY-MM.jsonl`.
- **Archive Fallback:** Verify `/mnt/gdrive` is genuinely mounted (check `mountpoint` / `.audit_archive_ready` probe) before moving files out of local hot storage; never delete local files unless the gzipped destination size & checksum verify cleanly.

---

## 8. Implementation Boundaries (Left to the Builder)

The implementation plan will organize the work cleanly into modules:
1. `lab-dashboard/audit-logger.js` — Core flight recorder, secret redactor, active-runs registry, startup crash sweep, pre/post workspace truth tracker, query & archive reader.
2. Hooks in `gemini-manager.js`, `cross-team-orchestrator.js`, `agent-hub-manager.js`, `cron-manager.js`, and `scripts/cron-ai-runner.py`.
3. API routes in `lab-dashboard/server.js`.
4. UI components in `lab-dashboard/public/gemini.html` (and link/badge in `index.html`).
5. Automated unit/integration tests in `lab-dashboard/test/audit-logger.test.js` covering: secret redaction, crash-recovery sweep on dead PID, unreported file-touch detection via git/fs snapshot, and monthly archive/search queries.
