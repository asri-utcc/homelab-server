#!/usr/bin/env python3
"""Create a labeled Storyboard Contact Sheet PNG + optimized Animated GIF preview for visual QA and chat UI."""

import argparse
import json
import math
import os
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont


def ffprobe_info(path: str) -> dict:
    out = subprocess.check_output(
        [
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Storyboard PNG and Animated GIF preview")
    parser.add_argument("video", help="Path to MP4 video")
    parser.add_argument("-o", "--output-dir", required=True, help="Output directory")
    parser.add_argument("--prefix", default="preview", help="Filename prefix")
    parser.add_argument("--timestamps", default="", help="Comma-separated timestamps in sec (optional)")
    parser.add_argument("--timeline", default="", help="Optional timeline.json to extract midpoint of each scene with labels")
    parser.add_argument("--panels", type=int, default=6, help="Number of storyboard frames (default 6)")
    parser.add_argument("--no-gif", action="store_true", help="Skip animated GIF generation")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    info = ffprobe_info(args.video)
    dur = info["duration"]

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

    with tempfile.TemporaryDirectory() as tmp:
        frames = []
        for idx, t in enumerate(times):
            fp = os.path.join(tmp, f"frame_{idx:02d}.png")
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", args.video, "-frames:v", "1", fp],
                check=True,
            )
            frames.append((t, Image.open(fp).convert("RGB")))

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
        for fp_font in (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        ):
            if os.path.exists(fp_font):
                font_h = ImageFont.truetype(fp_font, 22)
                font_b = ImageFont.truetype(fp_font, 18)
                break

        font_cap = font_b
        if labels is not None:
            for fp_cap in (
                "/usr/share/fonts/truetype/tlwg/Loma-Bold.ttf",
                "/usr/share/fonts/truetype/noto/NotoLoopedThai-Bold.ttf",
                "/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf",
                "/usr/share/fonts/truetype/tlwg/Garuda-Bold.ttf",
            ):
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

        # Animated GIF preview (sped up smoothly ~2x-3x or crisp timelapse so full journey fits < 8 MB!)
        gif_bytes = 0
        if not args.no_gif:
            # Target ~15s preview loop at 8fps 360px wide so user sees ALL scenes cleanly under ~6MB
            speed = max(1.0, dur / 16.0)
            gif_w = 360 if is_portrait else 540
            palette = os.path.join(tmp, "palette.png")
            vf_base = f"setpts=PTS/{speed:.3f},fps=8,scale={gif_w}:-1:flags=lanczos"
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-i", args.video, "-vf", f"{vf_base},palettegen=max_colors=128", palette],
                check=True,
            )
            subprocess.run(
                [
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
                    gif_path,
                ],
                check=True,
            )
            gif_bytes = os.path.getsize(gif_path)

    print(
        json.dumps(
            {
                "ok": True,
                "storyboard": storyboard_path,
                "storyboardKB": round(os.path.getsize(storyboard_path) / 1024, 1),
                "gif": None if args.no_gif else gif_path,
                "gifMB": None if args.no_gif else round(gif_bytes / (1024 * 1024), 2),
                "durationSec": round(dur, 2),
                "timestamps": times,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
