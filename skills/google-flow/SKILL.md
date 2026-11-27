---
name: google-flow
description: Generate AI images on Google Flow (labs.google/fx/tools/flow -> flow.google.com) and download full-resolution outputs locally using /home/dev/.local/bin/google-flow with lab-browser Shared Auth. Use automatically whenever the user asks to generate, create, or draw an image with Google Flow (e.g. "สร้างรูป", "สร้างภาพ", "เจนภาพ", "Google Flow", "กูเกิลโฟลว์", "generate image"). Do NOT use this skill for background removal — always use the offline remove-background skill instead.
---

# Google Flow AI Image Generation

CLI tool + Shared Auth integration for generating and downloading full-resolution images from **Google Flow** (`https://labs.google/fx/tools/flow` -> `https://flow.google.com`) with **0 MB idle RAM** (no persistent MCP server).

## Tool & Paths
- **CLI (always use full path — PM2 `PATH` lacks `~/.local/bin`):** `/home/dev/.local/bin/google-flow` -> `/home/dev/projects/homelab-server/google-flow/google-flow.js`
- **Default Output Directory:** `/home/dev/.gemini/outputs/google-flow/`
- **Shared Auth Store:** `/home/dev/.local/share/lab-browser/auth/shared.json` (shared across all chat sessions via `lab-browser`; uses `playwright-core` from `lab-browser` with no extra `npm install`).
- **Rule:** Never use `google-flow` for background removal (`ลบพื้นหลัง`, `ตัดพื้นหลัง`, `remove bg`). Use the offline `remove-background` skill (`/home/dev/.local/bin/remove-bg`).

## AI Agent Workflow

1. **Prepare the prompt:**
   - If the user writes in Thai (e.g., `"รูปลูกแมว 8 ขา"`), translate and expand it into a clear, detailed English image prompt while preserving every user requirement verbatim (e.g., `"A cute photorealistic fluffy kitten with exactly eight legs, all 8 legs clearly visible, natural lighting, high detail"`), or pass the exact prompt if the user explicitly wants it verbatim.
2. **Choose execution mode:**
   - **Browser Vision Co-Pilot active in chat:** pass `--session <bv_session>` so the user sees live progress on the right panel and can take over immediately if login/OTP/CAPTCHA appears.
   - **No Browser Vision active:** omit `--session` to run in **Standalone Headless mode** (`--shared-auth` automatically), which closes Chromium and frees RAM immediately on exit.
3. **Run generation:**
   ```bash
   /home/dev/.local/bin/google-flow generate "<prompt>" --session <bv_session> --aspect 1:1
   ```
   *(Or omit `--session <bv_session>` when running standalone headless.)*
4. **Handle Exit Code `2` (`needsLogin: true` / `paused: true` / `handoff`):**
   - **STRICTLY FORBIDDEN:** Never guess passwords, never auto-fill credentials, and never attempt to solve CAPTCHAs.
   - Open the Google Flow login page in Browser Vision:
     ```bash
     /home/dev/.local/bin/google-flow login --session <bv_session>
     ```
   - Ask the user to sign in to Google manually in the Browser Vision panel on the right and click Resume (`✅`), then re-run `google-flow generate`.
5. **Inspect downloaded image before replying:**
   - Always inspect the saved file using `read_file` on `/home/dev/.gemini/outputs/google-flow/<file>.png` (or `.webp`/`.jpg`) to verify visual quality and completeness (e.g., correct subject details, not a broken/icon image).
6. **Deliver to the user:**
   - Show the image inline in chat using the local path:
     `![คำอธิบายภาพ](/home/dev/.gemini/outputs/google-flow/<file>.png)`
   - Include clickable full-view and download links via Lab Dashboard:
     - View full image: `https://homelab.tail285279.ts.net/api/gemini/local-image?path=/home/dev/.gemini/outputs/google-flow/<file>.png`
     - Download file: `https://homelab.tail285279.ts.net/api/gemini/local-file?path=/home/dev/.gemini/outputs/google-flow/<file>.png&download=1`

## Commands Reference

### 1. `status` — Check Shared Auth & Live Google Flow Access
```bash
/home/dev/.local/bin/google-flow status
/home/dev/.local/bin/google-flow status --session <bv_sess> [--project-url <url>] [--compact]
```
Returns safe metadata JSON (`{ ok, authenticated, needsLogin, url, googleCookieCount, googleDomains }`) without printing cookie values or tokens.

### 2. `login` — Open Google Flow in Browser Vision for Manual Sign-In
```bash
/home/dev/.local/bin/google-flow login [--session <bv_sess>] [--compact]
```
Opens `https://labs.google/fx/tools/flow` with `--new-tab --shared-auth` so the user can log in once manually.

### 3. `generate` (aliases: `gen`, `image`) — Generate & Download Full-Resolution Image(s)
```bash
/home/dev/.local/bin/google-flow generate "cute fluffy kitten with 8 legs, photorealistic" --aspect 1:1
/home/dev/.local/bin/google-flow generate "cyberpunk bangkok rain" --session <bv_sess> --aspect 16:9 --count 1
/home/dev/.local/bin/google-flow image "minimalist product shot" --all -o /home/dev/.gemini/outputs/google-flow/
```
Options:
- `--session <bv_sess>`: Run inside active Browser Vision session (stops immediately on `paused`/`handoff`); omit for standalone headless `--shared-auth`
- `--aspect <ratio>`: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`
- `--count <n>`: Number of newly generated images to save (default `1`)
- `--all`: Save all newly generated images from the batch
- `--model <name>`: Model name hint (e.g. `"Nano Banana"`)
- `-o, --out <path>`: Custom output file or directory (allowed roots: `/home/dev/.gemini`, `/home/dev/projects`, `/tmp`)
- `--project-url <url>`: Reuse an existing Google Flow project (`https://flow.google.com/project/<uuid>`)
- `--timeout <ms>`: Generation timeout in milliseconds (default `120000`)
- `--debug-shot`: Capture a debug screenshot after generation
- `--compact`: Print single-line JSON

### 4. `inspect` — Dump Live DOM Selectors & Screenshot
Use if Google updates the Flow UI and selectors need recalibration:
```bash
/home/dev/.local/bin/google-flow inspect [--session <bv_sess>] [--project-url <url>] [-o <shot.png>] [--compact]
```

## Exit Codes & Security
- `0`: Success
- `2`: Login required, Browser Vision session paused, or manual handoff (OTP/CAPTCHA/TOS/Region)
- `1`: Other error (invalid args, timeout, missing UI element, etc.)
- Never print, log, or commit cookies/tokens from `/home/dev/.local/share/lab-browser/auth/shared.json`.
- Output paths are restricted to `/home/dev/.gemini`, `/home/dev/projects`, and `/tmp`, and downloaded buffers are verified by magic bytes and dimensions (`>= 256px` or `>= 15 KB`, rejecting icons `< 64px`).
