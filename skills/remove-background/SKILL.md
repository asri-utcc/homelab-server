---
name: remove-background
description: Remove or replace the background of images fully offline on this homelab (rembg + ONNX Runtime on CPU, no cloud API). Use when the user sends/attaches an image and asks to remove background, make it transparent, cut out a person/product, or change the background color (e.g. "ลบพื้นหลัง", "ลบแบ็คกราวด์", "ตัดพื้นหลัง", "ทำพื้นหลังใส", "เปลี่ยนพื้นหลังเป็นสีขาว", "remove bg").
---

# Remove Background (Local / Offline)

Removes image backgrounds **on this machine only**. Images never leave the server —
do NOT use Google Flow, Gemini image editing, remove.bg, or any web/cloud service for this task.

## Tool
- CLI: always call by full path `/home/dev/.local/bin/remove-bg` (PM2 PATH lacks ~/.local/bin) → `/home/dev/.local/share/bg-remove/remove_bg.py`
- Engine: `rembg` 2.0.87 + `onnxruntime` CPU, venv `/home/dev/.local/share/bg-remove/venv`
- Models (already downloaded, offline): `~/.rembg/models/`
- Default output: `/home/dev/.gemini/outputs/bg-removed/<name>_nobg.png`
- Prints JSON on stdout: `{"ok", "model", "note", "results":[{"output", "size", "seconds"}], "errors"}`

## Workflow
1. Find the image path. Images attached in the dashboard chat are listed at the top of the
   prompt (`/home/dev/.gemini/uploads/img_*.jpg|png|webp`). If none is attached, ask the user to send one.
2. Pick a preset from the request (default `balanced` when unspecified):

   | Request | Command flag | Speed / RAM (this server, ~1MP) |
   |---|---|---|
   | ทั่วไป / ไม่ระบุ | `-q balanced` (isnet-general-use) | ~2s / ~1GB |
   | "ละเอียด", "คมๆ", สินค้า, ขอบซับซ้อน | `-q best` (birefnet-general-lite) | ~15s / ~7GB |
   | "ละเอียดสุด", มีเครื่องประดับ/ชิ้นเล็กยื่นออกมา (มงกุฎ ต่างหู) | `-q max` (birefnet-general) | ~30s / ~8GB |
   | "ให้ AI ช่วยเลือก", "เอาดีที่สุด", ผลเดิมยังไม่ดี | `--compare` → ดูหัวข้อ **โหมด AI ช่วยเลือก** | ~60s |
   | รูปคน ผมเยอะ พอร์ตเทรต (ต้องการคุณภาพสูง) | `-q person` (birefnet-portrait) | ~30s / ~8GB |
   | การ์ตูน / อนิเมะ | `-q anime` | ~2s / ~1GB |
   | ด่วน / หลายรูปมาก | `-q fast` (u2netp, ขอบหยาบ) | <1s |

3. Add options as requested:
   - `--bg white` / `--bg "#00ff00"` — replace background with a solid color (add `--format jpg` for JPG)
   - `--crop` — trim to the subject (`--pad 20` margin px)
   - `--matting` — soften hair/fur edges (slower)
   - Edge colour refine (removes old-background colour fringe) is ON by default; `--no-refine` disables it
   - `--smooth` — clean small specks on the mask edge
   - `--mask` — export black/white mask only
   - `-o /path/out.png` — custom output path (single input); passing a folder processes every image in it
4. Run it, e.g.:
   ```bash
   /home/dev/.local/bin/remove-bg /home/dev/.gemini/uploads/img_123.jpg
   /home/dev/.local/bin/remove-bg /home/dev/.gemini/uploads/img_123.jpg -q best --crop
   /home/dev/.local/bin/remove-bg /home/dev/.gemini/uploads/img_123.jpg --bg white --format jpg
   ```
5. Reply in Thai with the result shown inline using the absolute output path so the dashboard renders it:
   `![ลบพื้นหลังแล้ว](/home/dev/.gemini/outputs/bg-removed/img_123_nobg.png)`
   plus the model used and processing time. If `note` is non-null (RAM fallback), tell the user.
   Offer a follow-up: higher quality (`-q best`), white background, or crop.

## โหมด AI ช่วยเลือก (optional — only when the user asks for AI help, "ดีที่สุด", or is unhappy with a result)
Pixel work stays local; the AI only *looks* at a preview and chooses settings. Note: viewing the
preview sends it to the chat model (same as the attached image already was) — never to an image-editing service.
1. `/home/dev/.local/bin/remove-bg <img> --compare` — runs isnet, birefnet-lite, birefnet-general, birefnet-portrait
   one at a time (RAM-safe; skipped models are listed in `skipped`) → `<name>_compare.jpg` (original + each
   candidate on a checkerboard with a magenta 10% grid) and `<name>_<model>.png` per candidate.
   Pick a subset with `--compare balanced,max,person`.
2. Read `compare_sheet` with your image-viewing tool. Judge each candidate on: background leftovers (walls,
   doors, furniture), missing subject parts (crown spikes, fingers, hair, straps), edge quality.
3. Re-run with the winner: `remove-bg <img> -m birefnet-general` — masks are cached
   (`~/.cache/bg-remove/masks`), so this takes ~2s, no model reload.
4. Only if the best candidate still has a leftover blob, remove it with a box in % of the image (read off the grid):
   `--erase-box 0%,24%,26%,78%` (repeatable). `--keep-box x1,y1,x2,y2` keeps only that region (e.g. pick one
   person out of a group). Keep boxes tight — a box cuts the subject too if it overlaps it. View the result
   again before replying.
5. Reply with the final image + which model won and why (one line), and the compare sheet if useful:
   `![เทียบโมเดล](/home/dev/.gemini/outputs/bg-removed/<name>_compare.jpg)`

## Rules & Safety
- Run only ONE heavy job (`best`/`max`/`person`) at a time — this server has 11GB RAM shared with
  PM2 services. The script auto-falls back to `isnet-general-use` when free RAM is too low; use
  `--force` only if the user insists.
- Never pass `-m atlascloud` or `-m withoutbg` (cloud APIs) — the script rejects them anyway.
- Don't modify or audit the tool unless the user asks; just run it and report.
- `bria-rmbg` is non-commercial licensed (CC BY-NC); prefer birefnet/isnet for commercial use.

## Troubleshooting
- `ModuleNotFoundError` → reinstall: `cd /home/dev/.local/share/bg-remove && VIRTUAL_ENV=$PWD/venv uv pip install "rembg[cpu]" pillow pillow-heif`
- Model missing → the first run of that model downloads it once from GitHub (weights only, no images uploaded).
- Result has holes or keeps background parts → retry with `-q max`, or use `--compare` (AI mode).
- Old script backup: `/home/dev/.local/share/bg-remove/remove_bg.py.bak-v1`.
