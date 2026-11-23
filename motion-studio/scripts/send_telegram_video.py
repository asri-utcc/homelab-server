#!/usr/bin/env python3
"""Send rendered MP4 video directly to Telegram chat using Bot API sendVideo.

If the source MP4 exceeds Telegram's 50 MB Bot API upload cap (>48 MiB),
automatically creates a compressed `<stem>_telegram.mp4` sibling under 48 MiB
while leaving the original Master video intact.
"""

import argparse
import json
import os
import subprocess
import sys

ENV_PATH = "/home/dev/projects/.telegram.env"
MAX_TELEGRAM_BYTES = 48 * 1024 * 1024


def load_env(path: str) -> dict[str, str]:
    env: dict[str, str] = {}
    if not os.path.exists(path):
        return env
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def ffprobe_meta(video: str) -> tuple[int, int, int]:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
            video,
        ],
        text=True,
    )
    d = json.loads(out)
    st = d["streams"][0]
    return int(st["width"]), int(st["height"]), max(1, int(round(float(d["format"]["duration"]))))


def ensure_telegram_size(video: str, dur: int) -> tuple[str, bool]:
    """Return (path_to_send, was_compressed) ensuring size <= MAX_TELEGRAM_BYTES."""
    if os.path.getsize(video) <= MAX_TELEGRAM_BYTES:
        return video, False

    stem, ext = os.path.splitext(video)
    tg_path = f"{stem}_tg.mp4" if stem.endswith("_telegram") else f"{stem}_telegram{ext or '.mp4'}"

    if (
        os.path.exists(tg_path)
        and os.path.getsize(tg_path) <= MAX_TELEGRAM_BYTES
        and os.path.getmtime(tg_path) >= os.path.getmtime(video)
    ):
        return tg_path, True

    # Target ~42 MiB so container overhead still lands well below 48 MiB
    target_bits = 42 * 1024 * 1024 * 8
    audio_kbps = 128
    video_kbps = max(300, min(5500, int(target_bits / max(1, dur) / 1000) - audio_kbps))

    for attempt_kbps in (video_kbps, max(250, int(video_kbps * 0.72))):
        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            video,
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-b:v",
            f"{attempt_kbps}k",
            "-maxrate",
            f"{int(attempt_kbps * 1.25)}k",
            "-bufsize",
            f"{attempt_kbps * 2}k",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-c:a",
            "aac",
            "-b:a",
            f"{audio_kbps}k",
            tg_path,
        ]
        subprocess.run(cmd, check=True)
        if os.path.getsize(tg_path) <= MAX_TELEGRAM_BYTES:
            return tg_path, True

    raise RuntimeError(f"Compressed file still exceeds {MAX_TELEGRAM_BYTES} bytes: {tg_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Send MP4 video via Telegram Bot API")
    parser.add_argument("video", help="Path to MP4 file")
    parser.add_argument("caption", nargs="?", default="🎬 คลิปวิดีโอจาก Motion Video Studio", help="Caption text")
    args = parser.parse_args()

    if not os.path.exists(args.video):
        print(json.dumps({"ok": False, "error": f"File not found: {args.video}"}))
        return 1

    env = load_env(ENV_PATH)
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = env.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        print(json.dumps({"ok": False, "error": f"Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in {ENV_PATH}"}))
        return 1

    w, h, dur = ffprobe_meta(args.video)
    try:
        send_path, compressed = ensure_telegram_size(args.video, dur)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"Compression failed: {exc}"}))
        return 1

    url = f"https://api.telegram.org/bot{token}/sendVideo"
    cmd = [
        "curl",
        "-sS",
        "-X",
        "POST",
        url,
        "-F",
        f"chat_id={chat_id}",
        "-F",
        f"video=@{send_path}",
        "-F",
        f"caption={args.caption}",
        "-F",
        f"width={w}",
        "-F",
        f"height={h}",
        "-F",
        f"duration={dur}",
        "-F",
        "supports_streaming=true",
    ]
    res_raw = subprocess.check_output(cmd, text=True, timeout=180)
    res = json.loads(res_raw)
    if res.get("ok"):
        msg = res.get("result", {})
        print(
            json.dumps(
                {
                    "ok": True,
                    "messageId": msg.get("message_id"),
                    "chatId": chat_id,
                    "masterFile": args.video,
                    "sentFile": send_path,
                    "compressed": compressed,
                    "sentSizeMB": round(os.path.getsize(send_path) / (1024 * 1024), 2),
                    "width": w,
                    "height": h,
                    "durationSec": dur,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    print(json.dumps({"ok": False, "telegramError": res}, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
