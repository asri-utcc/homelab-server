---
name: offload-jobs
description: Dispatch any heavy compute, batch processing, media conversion, Python/Node script, ML/Whisper/OCR, or cross-machine workload to connected Homelab Agent Hub worker nodes (e.g. asridaytrade, servergigi) using the generic `job.run` pipeline via `/home/dev/.local/bin/agent-ctl run`, with automatic node selection, cached setup environments, live log streaming, cancel/timeout safety, and local fallback when no worker is online.
---

# Generic Distributed Job Offload (`job.run` / Homelab Agent Hub)

Use this skill whenever you need to run a **heavy, CPU/GPU-intensive, or long-running workload** on Homelab Agent Hub worker nodes without writing a custom Go handler or recompiling `homelab-agent.exe`.

## CLI & Endpoints
- CLI (always call by full path — PM2 PATH lacks `~/.local/bin`): `/home/dev/.local/bin/agent-ctl`
  - Submit & run job: `/home/dev/.local/bin/agent-ctl run ...`
  - List jobs: `/home/dev/.local/bin/agent-ctl jobs [--kind generic] [--limit 20] [--json]`
  - Cancel job: `/home/dev/.local/bin/agent-ctl cancel <jobId> [--json]`
  - List online nodes & capabilities: `/home/dev/.local/bin/agent-ctl nodes`
- Hub REST API:
  - `POST /api/agent-hub/jobs` — create & dispatch (or queue if worker is at `maxJobs`)
  - `GET /api/agent-hub/jobs?kind=generic&limit=50` — list recent jobs
  - `GET /api/agent-hub/jobs/:jobId` — live status + `logTail`
  - `GET /api/agent-hub/jobs/:jobId/result` — download `result.tar.gz`
  - `POST /api/agent-hub/jobs/:jobId/cancel` — kill active process tree / remove from queue

## Environment Variables Available Inside Remote Jobs
Every `job.run` command runs via `cmd.exe /S /C` on Windows (use `%VAR%`, or invoke `powershell -NoProfile -Command "..."` for PowerShell) and `/bin/sh -c` on Linux/macOS (use `$VAR`):
- `LAB_JOB_ID`, `LAB_JOB_NAME`, `LAB_NODE_ID`
- `LAB_WORK_DIR` — isolated per-job working directory (cleaned up after upload)
- `LAB_IN_DIR` (`LAB_INPUT_DIR`) — extracted files/folders passed via `--input`
- `LAB_OUT_DIR` (`LAB_OUTPUT_DIR`) — **everything written here is automatically archived into `result.tar.gz`** (plus `_job.log` and any `--collect` globs)
- `LAB_CACHE_DIR` — persistent per-`--cache-key` directory for `--setup` dependencies (venv, models, node_modules); skipped automatically on future runs when setup SHA-1 marker already exists
- `PYTHONUNBUFFERED=1`, `PYTHONIOENCODING=utf-8` (and detected tool dirs for Python, Node, FFmpeg, Git, Blender are auto-added to `PATH`)
- Progress updates: print `LAB_PROGRESS <0..100> <message>` to stdout to update live progress bar on `/agent-hub`.

## Key CLI Flags (`agent-ctl run`)
| Flag | Description |
|---|---|
| `--name <label>` | Human-readable job label shown in `/agent-hub` and `agent-ctl jobs` |
| `--requires <caps>` | Comma-separated capabilities, e.g. `python,nvidia-gpu`, `ffmpeg-nvenc`, `nodejs`, `blender` (aliases supported: `gpu`, `nvenc`, `node`, `python3`, `blender`) |
| `--os <any\|windows\|linux\|darwin>` | Filter target worker OS (default `any`) |
| `--node <id\|alias\|auto>` | Pin to a specific worker by ID or Alias (e.g. `asridaytrade` or `"เครื่องเรนเดอร์"`), or `auto` (default) |
| `--input <path>` | Repeatable local file or directory on `homelab` (must be under `/home/dev/projects/`, `/home/dev/.gemini/`, or `/tmp/`; max 500 MB tar.gz) |
| `--cmd <str>` | Cross-platform shell command |
| `--cmd-win <str>` / `--cmd-posix <str>` | OS-specific commands (Windows `cmd.exe` vs Linux/macOS `/bin/sh`) |
| `--setup <str>` + `--cache-key <key>` | One-time setup command run inside `LAB_CACHE_DIR`, cached by key + setup SHA-1 |
| `--collect <glob>` | Repeatable relative path/glob inside `LAB_WORK_DIR` to include alongside `LAB_OUT_DIR` |
| `--env KEY=VAL` | Repeatable extra environment variable |
| `--timeout <sec>` | Hard timeout in seconds (default `1800`, max `86400`) |
| `--out-dir <dir>` | Local extraction directory (default `/home/dev/.gemini/outputs/offload/<jobId>`) |
| `--spec <file.json>` | Load full job JSON spec (CLI flags override) |
| `--no-wait` | Submit immediately and print `jobId` |
| `--json` | Emit single-line JSON summary (`ok`, `jobId`, `node`, `status`, `exitCode`, `outDir`, `files`, `error`) |

## Exit Codes & Automatic Fallback Pattern
- `0` — Completed successfully (`exitCode == 0`, outputs extracted to `--out-dir`)
- `2` — Remote command failed (`exitCode != 0`; `_job.log` and any partial outputs are still downloaded)
- `3` — **No matching worker online / hub unavailable (`409 NO_NODE` or `404`) → fall back to running locally on `homelab`**
- `4` — Timeout or worker node lost (`status=timeout|lost`)
- `130` — Cancelled (`Ctrl+C` or `agent-ctl cancel`)

## Examples

### 1. Cross-platform Python batch job with input files & cached setup
```bash
/home/dev/.local/bin/agent-ctl run \
  --name "transcribe-clip" \
  --requires python,gpu \
  --input /home/dev/.gemini/outputs/videos/sample.mp4 \
  --cache-key whisper-v1 \
  --setup "python -m venv venv && venv/Scripts/pip install faster-whisper" \
  --cmd-win '"%LAB_CACHE_DIR%\venv\Scripts\python.exe" -c "import os; open(os.path.join(os.environ[\"LAB_OUT_DIR\"], \"done.txt\"), \"w\").write(\"ok\")"' \
  --cmd-posix '"$LAB_CACHE_DIR/venv/bin/python" -c "import os; open(os.path.join(os.environ[\"LAB_OUT_DIR\"], \"done.txt\"), \"w\").write(\"ok\")"' \
  --out-dir /home/dev/.gemini/outputs/offload/transcribe-clip
```

### 2. Fallback to local `homelab` when exit code is 3
```bash
/home/dev/.local/bin/agent-ctl run --name "heavy-task" --requires python --cmd-win "..." --cmd-posix "..." --out-dir "$OUT"
rc=$?
if [[ $rc -eq 3 ]]; then
  echo "No worker online — running locally on homelab..."
  python3 local_script.py
fi
```

## Security & Operational Notes
- Hub strictly restricts `--input` paths to `/home/dev/projects/`, `/home/dev/.gemini/`, and `/tmp/` (symlinks resolved via `realpathSync`), returning HTTP `400` otherwise.
- Hub enforces per-node `maxJobs` queueing (`status=pending` → auto-dispatched when a slot frees up) and runs a 10s watchdog that marks jobs `lost` if a worker stops heartbeating (>45s) or `timeout` if exceeded.
- Both `job.run` and `job.cancel` kill the full child process tree on Windows (`taskkill /T /F` / Job Object) and POSIX (negative process-group `SIGKILL`).
