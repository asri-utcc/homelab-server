#!/usr/bin/env python3
"""Create a labeled Storyboard Contact Sheet PNG + optimized Animated GIF preview for visual QA and chat UI.

Offloads keyframe extraction, Pillow contact-sheet rendering (with staged Thai + Latin fonts),
and 2-pass lanczos GIF generation to Homelab Agent Hub worker nodes via agent-ctl run --requires python,ffmpeg.
Falls back to throttled local execution on homelab ONLY when no worker node is online (rc=3)
or when explicitly configured via STUDIO_OFFLOAD=off / MOTION_REMOTE_PREVIEW=off / MOTION_ALLOW_LOCAL_FALLBACK=1.
"""

import argparse
import json
import math
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

AGENT_CTL_BIN = "/home/dev/.local/bin/agent-ctl"
OFFLOAD_STAGE_ROOT = "/home/dev/.gemini/outputs/offload"

LATIN_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
)

THAI_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/tlwg/Loma-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoLoopedThai-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf",
    "/usr/share/fonts/truetype/tlwg/Garuda-Bold.ttf",
    "C:/Windows/Fonts/LeelawUI.ttf",
    "C:/Windows/Fonts/leelawdb.ttf",
    "C:/Windows/Fonts/tahomabd.ttf",
)


def _is_truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _quote_win_arg(arg: str) -> str:
    if not arg or any(ch in arg for ch in (' ', '\t', '"', ';', '[', ']', '(', ')', ',', "'", '*', '&', '|', '<', '>', '^', '=')):
        escaped = arg.replace('"', '\\"')
        return f'"{escaped}"'
    return arg


def _stage_file(src: str, dst: str, seen_inodes: set[tuple[int, int]]) -> None:
    real_src = os.path.realpath(src)
    st = os.stat(real_src)
    key = (st.st_dev, st.st_ino)
    if key not in seen_inodes:
        try:
            os.link(real_src, dst)
            seen_inodes.add(key)
            return
        except OSError:
            pass
    shutil.copy2(real_src, dst)


def _parse_agent_json(stdout: str) -> dict:
    for line in reversed((stdout or "").strip().splitlines()):
        s = line.strip()
        if s.startswith("{") and s.endswith("}"):
            try:
                data = json.loads(s)
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
    return {}


def ffprobe_info(path: str, *, throttled: bool = False) -> dict:
    prefix = ["nice", "-n", "15"] if throttled and shutil.which("nice") else []
    out = subprocess.check_output(
        [
            *prefix,
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,r_frame_rate:format=duration",
            "-of",
            "json",
            path,
        ],
        text=True,
    )
    d = json.loads(out)
    st = d["streams"][0]
    dur = float(d["format"]["duration"])
    return {"width": int(st["width"]), "height": int(st["height"]), "duration": dur}


def _run_local_preview(args: argparse.Namespace, *, throttled: bool = False) -> dict:
    from PIL import Image, ImageDraw, ImageFont

    os.makedirs(args.output_dir, exist_ok=True)
    info = ffprobe_info(args.video, throttled=throttled)
    dur = info["duration"]

    nice_prefix = ["nice", "-n", "15"] if throttled and shutil.which("nice") else []
    thread_args = ["-threads", "2"] if throttled else []
    run_env = {**os.environ, "OMP_NUM_THREADS": "2"} if throttled else None

    labels: list[str] | None = None
    if args.timeline.strip():
        with open(args.timeline.strip(), "r", encoding="utf-8") as f:
            tl = json.load(f)
        scenes = tl.get("scenes", [])
        times = []
        labels = []
        for idx, sc in enumerate(scenes):
            s0 = float(sc.get("startSec", 0.0))
            s1 = float(sc.get("endSec", s0))
            mid = round(max(0.0, min(max(0.0, dur - 0.05), (s0 + s1) / 2.0)), 2)
            times.append(mid)
            badge = str(sc.get("badge", "")).strip()
            if not badge or not all(ch.isalnum() or ch in "-_" for ch in badge):
                badge = f"{idx + 1:02d}"
            title = str(sc.get("title") or sc.get("id") or f"Scene {idx + 1}").strip()
            labels.append(f"{badge} · {title}")
        if not times:
            n = max(2, args.panels)
            times = [round(dur * (i + 0.5) / n, 2) for i in range(n)]
            labels = None
    elif args.timestamps.strip():
        times = [float(x.strip()) for x in args.timestamps.split(",") if x.strip()]
    else:
        n = max(2, args.panels)
        times = [round(dur * (i + 0.5) / n, 2) for i in range(n)]

    storyboard_path = os.path.join(args.output_dir, f"{args.prefix}_storyboard.png")
    gif_path = os.path.join(args.output_dir, f"{args.prefix}_preview.gif")
    script_dir = os.path.dirname(os.path.abspath(__file__))

    with tempfile.TemporaryDirectory() as tmp:
        frames = []
        for idx, t in enumerate(times):
            fp = os.path.join(tmp, f"frame_{idx:02d}.png")
            subprocess.run(
                [*nice_prefix, "ffmpeg", "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", args.video, "-frames:v", "1", *thread_args, fp],
                check=True,
                env=run_env,
            )
            with Image.open(fp) as _im:
                frames.append((t, _im.convert("RGB")))

        if labels is not None and len(frames) > 6:
            cols = 4
        else:
            cols = 3 if len(frames) >= 6 else max(1, len(frames))
        rows = math.ceil(len(frames) / cols)
        is_portrait = info["height"] > info["width"]
        cell_w = 360 if is_portrait else 480
        cell_h = int(round(cell_w * (info["height"] / info["width"])))
        label_h = 44 if labels is not None else 0
        pad = 18
        header_h = 54
        sheet_w = cols * cell_w + (cols + 1) * pad
        sheet_h = header_h + rows * (cell_h + label_h) + (rows + 1) * pad

        sheet = Image.new("RGB", (sheet_w, sheet_h), (238, 242, 247))
        draw = ImageDraw.Draw(sheet)

        font_h = ImageFont.load_default()
        font_b = font_h
        for fp_font in (os.path.join(script_dir, "font_latin.ttf"), *LATIN_FONT_CANDIDATES):
            if os.path.exists(fp_font):
                font_h = ImageFont.truetype(fp_font, 22)
                font_b = ImageFont.truetype(fp_font, 18)
                break

        font_cap = font_b
        if labels is not None:
            for fp_cap in (os.path.join(script_dir, "font_thai.ttf"), *THAI_FONT_CANDIDATES):
                if os.path.exists(fp_cap):
                    font_cap = ImageFont.truetype(fp_cap, 16)
                    break

        draw.text(
            (pad, 14),
            f"Storyboard QA · {info['width']}x{info['height']} · {dur:.1f}s ({len(frames)} keyframes)",
            fill=(30, 41, 59),
            font=font_h,
        )

        for idx, (t, im) in enumerate(frames):
            r = idx // cols
            c = idx % cols
            x = pad + c * (cell_w + pad)
            y = header_h + pad + r * (cell_h + label_h + pad)
            resized = im.resize((cell_w, cell_h), Image.Resampling.LANCZOS)
            sheet.paste(resized, (x, y))
            draw.rectangle([x, y, x + cell_w - 1, y + cell_h + label_h - 1], outline=(148, 163, 184), width=2)
            tag = f"#{idx+1} · {t:.1f}s"
            draw.rounded_rectangle([x + 10, y + 10, x + 130, y + 40], radius=8, fill=(15, 23, 42))
            draw.text((x + 20, y + 13), tag, fill=(255, 255, 255), font=font_b)
            if labels is not None:
                cap_y = y + cell_h
                draw.rectangle([x + 1, cap_y, x + cell_w - 2, cap_y + label_h - 2], fill=(248, 250, 252))
                caption = labels[idx]
                max_w = cell_w - 20
                while len(caption) > 3 and draw.textlength(caption, font=font_cap) > max_w:
                    caption = caption[:-4].rstrip() + "..."
                draw.text((x + 10, cap_y + 10), caption, fill=(15, 23, 42), font=font_cap)

        sheet.save(storyboard_path, "PNG", optimize=True)

        gif_bytes = 0
        if not args.no_gif:
            speed = max(1.0, dur / 16.0)
            gif_w = 360 if is_portrait else 540
            palette = os.path.join(tmp, "palette.png")
            vf_base = f"setpts=PTS/{speed:.3f},fps=8,scale={gif_w}:-1:flags=lanczos"
            subprocess.run(
                [*nice_prefix, "ffmpeg", "-y", "-v", "error", "-i", args.video, "-vf", f"{vf_base},palettegen=max_colors=128", *thread_args, palette],
                check=True,
                env=run_env,
            )
            subprocess.run(
                [
                    *nice_prefix,
                    "ffmpeg",
                    "-y",
                    "-v",
                    "error",
                    "-i",
                    args.video,
                    "-i",
                    palette,
                    "-lavfi",
                    f"{vf_base} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3",
                    *thread_args,
                    gif_path,
                ],
                check=True,
                env=run_env,
            )
            gif_bytes = os.path.getsize(gif_path)

    return {
        "ok": True,
        "storyboard": storyboard_path,
        "storyboardKB": round(os.path.getsize(storyboard_path) / 1024, 1),
        "gif": None if args.no_gif else gif_path,
        "gifMB": None if args.no_gif else round(gif_bytes / (1024 * 1024), 2),
        "durationSec": round(dur, 2),
        "timestamps": times,
    }


def _try_offload_preview(args: argparse.Namespace) -> tuple[int, str | None, dict | None, str]:
    """Dispatch preview generation (keyframes + Pillow contact sheet + 2-pass GIF) to a worker node."""
    if (
        args.local
        or os.environ.get("STUDIO_OFFLOAD", "").strip().lower() == "off"
        or os.environ.get("MOTION_REMOTE_PREVIEW", "").strip().lower() == "off"
    ):
        return -1, None, None, "disabled by env/flag"

    if not os.path.exists(AGENT_CTL_BIN):
        return 3, None, None, f"{AGENT_CTL_BIN} not found"

    os.makedirs(OFFLOAD_STAGE_ROOT, exist_ok=True)
    stage_dir = tempfile.mkdtemp(prefix=".stage_preview_", dir=OFFLOAD_STAGE_ROOT)
    out_dir = tempfile.mkdtemp(prefix=".out_preview_", dir=OFFLOAD_STAGE_ROOT)

    try:
        staged_inputs: list[str] = []
        seen_inodes: set[tuple[int, int]] = set()

        vid_ext = Path(args.video).suffix or ".mp4"
        vid_name = f"video{vid_ext}"
        in_vid = os.path.join(stage_dir, vid_name)
        _stage_file(args.video, in_vid, seen_inodes)
        staged_inputs.append(in_vid)

        worker_script = os.path.join(stage_dir, "worker_preview.py")
        shutil.copy2(os.path.abspath(__file__), worker_script)
        staged_inputs.append(worker_script)

        has_tl = bool(args.timeline.strip() and os.path.exists(args.timeline.strip()))
        if has_tl:
            in_tl = os.path.join(stage_dir, "timeline.json")
            _stage_file(args.timeline.strip(), in_tl, seen_inodes)
            staged_inputs.append(in_tl)

        for cand in LATIN_FONT_CANDIDATES:
            if os.path.exists(cand):
                dst_f = os.path.join(stage_dir, "font_latin.ttf")
                _stage_file(cand, dst_f, seen_inodes)
                staged_inputs.append(dst_f)
                break

        for cand in THAI_FONT_CANDIDATES:
            if os.path.exists(cand):
                dst_f = os.path.join(stage_dir, "font_thai.ttf")
                _stage_file(cand, dst_f, seen_inodes)
                staged_inputs.append(dst_f)
                break

        common_args = [
            "--local",
            vid_name,
            "--prefix",
            args.prefix,
            "--panels",
            str(args.panels),
        ]
        if has_tl:
            common_args.extend(["--timeline", "timeline.json"])
        elif args.timestamps.strip():
            common_args.extend(["--timestamps", args.timestamps.strip()])
        if args.no_gif:
            common_args.append("--no-gif")

        posix_tail = " ".join(shlex.quote(a) for a in common_args)
        win_tail = " ".join(_quote_win_arg(a) for a in common_args)

        setup_cmd = (
            "python -m venv venv && "
            "(if exist venv\\Scripts\\pip.exe (venv\\Scripts\\pip install -q pillow) else (venv/bin/pip install -q pillow))"
        )
        cmd_posix = f'cd "$LAB_IN_DIR" && "$LAB_CACHE_DIR/venv/bin/python" worker_preview.py {posix_tail} -o "$LAB_OUT_DIR" > "$LAB_OUT_DIR/meta.json"'
        cmd_win = f'cd /d "%LAB_IN_DIR%" && "%LAB_CACHE_DIR%\\venv\\Scripts\\python.exe" worker_preview.py {win_tail} -o "%LAB_OUT_DIR%" > "%LAB_OUT_DIR%\\meta.json"'

        sb_name = f"{args.prefix}_storyboard.png"
        gif_name = f"{args.prefix}_preview.gif"

        max_attempts = 2
        last_rc = 1
        last_err = ""
        for attempt in range(1, max_attempts + 1):
            shutil.rmtree(out_dir, ignore_errors=True)
            os.makedirs(out_dir, exist_ok=True)
            ctl_cmd = [
                AGENT_CTL_BIN,
                "run",
                "--name",
                "motion-preview",
                "--requires",
                "python,ffmpeg",
            ]
            for si in staged_inputs:
                ctl_cmd.extend(["--input", si])
            ctl_cmd.extend([
                "--cache-key",
                "motion-preview-pil-v1",
                "--setup",
                setup_cmd,
                "--cmd-posix",
                cmd_posix,
                "--cmd-win",
                cmd_win,
                "--timeout",
                "300",
                "--out-dir",
                out_dir,
                "--json",
            ])
            proc = subprocess.run(ctl_cmd, capture_output=True, text=True, timeout=360)
            last_rc = proc.returncode
            summary = _parse_agent_json(proc.stdout)
            node_used = str(summary.get("node") or "worker")

            rem_sb = os.path.join(out_dir, sb_name)
            rem_gif = os.path.join(out_dir, gif_name)
            rem_meta = os.path.join(out_dir, "meta.json")

            sb_ok = os.path.exists(rem_sb) and os.path.getsize(rem_sb) > 0
            gif_ok = args.no_gif or (os.path.exists(rem_gif) and os.path.getsize(rem_gif) > 0)

            if last_rc == 0 and sb_ok and gif_ok:
                os.makedirs(args.output_dir, exist_ok=True)
                dest_sb = os.path.join(args.output_dir, sb_name)
                dest_gif = os.path.join(args.output_dir, gif_name)
                shutil.copy2(rem_sb, dest_sb)
                if not args.no_gif:
                    shutil.copy2(rem_gif, dest_gif)

                meta: dict = {}
                if os.path.exists(rem_meta):
                    try:
                        with open(rem_meta, "r", encoding="utf-8") as mf:
                            meta = json.load(mf)
                    except Exception:
                        meta = {}

                res = {
                    "ok": True,
                    "storyboard": dest_sb,
                    "storyboardKB": round(os.path.getsize(dest_sb) / 1024, 1),
                    "gif": None if args.no_gif else dest_gif,
                    "gifMB": None if args.no_gif else round(os.path.getsize(dest_gif) / (1024 * 1024), 2),
                    "durationSec": meta.get("durationSec"),
                    "timestamps": meta.get("timestamps"),
                }
                return 0, node_used, res, ""

            last_err = str(summary.get("error") or proc.stderr.strip() or proc.stdout.strip() or f"exit {last_rc}")
            if last_rc == 3:
                return 3, None, None, last_err
            if attempt < max_attempts:
                time.sleep(3)

        return last_rc or 1, None, None, last_err
    finally:
        shutil.rmtree(stage_dir, ignore_errors=True)
        shutil.rmtree(out_dir, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Storyboard PNG and Animated GIF preview")
    parser.add_argument("video", help="Path to MP4 video")
    parser.add_argument("-o", "--output-dir", required=True, help="Output directory")
    parser.add_argument("--prefix", default="preview", help="Filename prefix")
    parser.add_argument("--timestamps", default="", help="Comma-separated timestamps in sec (optional)")
    parser.add_argument("--timeline", default="", help="Optional timeline.json to extract midpoint of each scene with labels")
    parser.add_argument("--panels", type=int, default=6, help="Number of storyboard frames (default 6)")
    parser.add_argument("--no-gif", action="store_true", help="Skip animated GIF generation")
    parser.add_argument("--local", action="store_true", help="Run locally without remote offload (worker mode)")
    args = parser.parse_args()

    if args.local:
        res = _run_local_preview(args, throttled=False)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0

    rc, remote_node, res, offload_err = _try_offload_preview(args)
    if rc == 0 and res is not None and remote_node:
        node_label = remote_node
        res["node"] = node_label
        res["offloaded"] = True
        print(f"[preview-node] {node_label}", file=sys.stderr, flush=True)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0

    if rc in (-1, 3) or _is_truthy_env("MOTION_ALLOW_LOCAL_FALLBACK"):
        fb_reason = "explicit local" if rc == -1 else ("no worker online" if rc == 3 else f"fallback rc={rc}")
        node_label = f"homelab ({fb_reason})"
        print(f"[preview-node] {node_label}", file=sys.stderr, flush=True)
        res = _run_local_preview(args, throttled=True)
        res["node"] = node_label
        res["offloaded"] = False
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0

    print(
        f"[preview-error] สร้างพรีวิวบนเครื่องลูกข่ายไม่สำเร็จ (rc={rc}): {offload_err[:240]}",
        file=sys.stderr,
        flush=True,
    )
    return rc if rc > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
