#!/usr/bin/env python3
"""Quick A/B voice tester for Google Gemini 2.5 Flash / Pro TTS with optional Telegram delivery."""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tts_pipeline import (  # noqa: E402
    DEFAULT_GEMINI_MODEL,
    GEMINI_VOICE_PRESETS,
    STYLE_PROMPTS,
    _synth_gemini_sync,
    ffprobe_duration,
    find_gemini_api_key,
    postprocess_scene_audio,
)

TELEGRAM_ENV_PATH = "/home/dev/projects/.telegram.env"
DEFAULT_OUT_DIR = "/home/dev/.gemini/outputs/videos/tts_ab_test"

# Scene 1 of Dhuha clip with clear Thai phonetic hints for Arabic religious terms
DEFAULT_TEXT = (
    "รู้ไหมคะ... ทุกเช้าที่เราตื่นขึ้น ร่างกายของมนุษย์มีข้อต่อถึงสามร้อยหกสิบข้อ "
    "และทุกข้อต่อ ล้วนมีหน้าที่ต้องทำ ซอ-ดะ-เกาะฮ์ ขอบคุณ อัลลอฮ์ ในทุกๆ วัน"
)


def load_telegram_env() -> tuple[str, str]:
    token = ""
    chat_id = ""
    if not os.path.exists(TELEGRAM_ENV_PATH):
        return token, chat_id
    with open(TELEGRAM_ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            if k.strip() == "TELEGRAM_BOT_TOKEN":
                token = v
            elif k.strip() == "TELEGRAM_CHAT_ID":
                chat_id = v
    return token, chat_id


def send_telegram_audio(mp3_path: str, title: str, caption: str, duration_sec: int) -> dict:
    token, chat_id = load_telegram_env()
    if not token or not chat_id:
        return {"ok": False, "error": f"Missing Telegram credentials in {TELEGRAM_ENV_PATH}"}
    url = f"https://api.telegram.org/bot{token}/sendAudio"
    out = subprocess.check_output(
        [
            "curl",
            "-sS",
            "-X",
            "POST",
            url,
            "-F",
            f"chat_id={chat_id}",
            "-F",
            f"audio=@{mp3_path}",
            "-F",
            f"title={title}",
            "-F",
            "performer=Gemini 2.5 TTS",
            "-F",
            f"duration={duration_sec}",
            "-F",
            f"caption={caption}",
        ],
        text=True,
        timeout=60,
    )
    res = json.loads(out)
    if res.get("ok"):
        return {"ok": True, "messageId": res.get("result", {}).get("message_id")}
    return {"ok": False, "telegramError": res}


def main() -> int:
    parser = argparse.ArgumentParser(description="Synthesize Gemini 2.5 TTS A/B voice samples")
    parser.add_argument("--voices", default="Aoede,Sulafat,Kore,Charon", help="Comma-separated Gemini voice names")
    parser.add_argument("--model", default=DEFAULT_GEMINI_MODEL, help="Gemini TTS model")
    parser.add_argument("--style", default="spiritual", choices=sorted(STYLE_PROMPTS.keys()), help="Voiceover style preset")
    parser.add_argument("--prompt", default="", help="Custom style instruction override")
    parser.add_argument("--text", default=DEFAULT_TEXT, help="Thai script text to synthesize")
    parser.add_argument("--master", default="light", choices=["light", "studio", "none"], help="Mastering preset")
    parser.add_argument("--delay", type=float, default=3.5, help="Delay in seconds between voices (Free Tier RPM guard)")
    parser.add_argument("-o", "--output", default=DEFAULT_OUT_DIR, help="Output directory")
    parser.add_argument("--send-telegram", action="store_true", help="Send generated MP3 clips to Telegram")
    args = parser.parse_args()

    api_key, key_src = find_gemini_api_key()
    if not api_key:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "GEMINI_API_KEY not configured",
                    "hint": "Save GEMINI_API_KEY=... in /home/dev/projects/.tts.env (chmod 600)",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1

    os.makedirs(args.output, exist_ok=True)
    style_prompt = args.prompt.strip() or STYLE_PROMPTS[args.style]
    voices = [v.strip().replace("gemini:", "") for v in args.voices.split(",") if v.strip()]
    results = []

    for idx, voice_name in enumerate(voices):
        slug = voice_name.lower()
        mp3_out = os.path.join(args.output, f"G{idx + 1}_gemini25_{slug}_{args.style}.mp3")
        with tempfile.TemporaryDirectory() as td:
            raw_wav = os.path.join(td, "raw.wav")
            master_wav = os.path.join(td, "master.wav")
            t0 = time.time()
            _synth_gemini_sync(args.text, voice_name, args.model, style_prompt, api_key, raw_wav)
            dur = postprocess_scene_audio(raw_wav, master_wav, args.master)
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-v",
                    "error",
                    "-i",
                    master_wav,
                    "-af",
                    "loudnorm=I=-16:TP=-1.5:LRA=11",
                    "-c:a",
                    "libmp3lame",
                    "-b:a",
                    "160k",
                    mp3_out,
                ],
                check=True,
            )
            elapsed = round(time.time() - t0, 2)

        desc = GEMINI_VOICE_PRESETS.get(voice_name, "Gemini Studio Voice")
        item = {
            "label": f"G{idx + 1}",
            "voice": f"gemini:{voice_name}",
            "desc": desc,
            "model": args.model,
            "style": args.style,
            "durationSec": round(ffprobe_duration(mp3_out), 2),
            "elapsedSec": elapsed,
            "file": mp3_out,
        }
        if args.send_telegram:
            cap = (
                f"🎙️ ตัวอย่าง {item['label']}: Gemini 2.5 TTS ({voice_name})\n"
                f"• สไตล์: {args.style} · {desc}\n"
                f"• โมเดล: {args.model} ({item['durationSec']} วิ)"
            )
            item["telegram"] = send_telegram_audio(
                mp3_out,
                title=f"{item['label']} Gemini 2.5 TTS — {voice_name}",
                caption=cap,
                duration_sec=int(round(item["durationSec"])),
            )
        results.append(item)

        if idx < len(voices) - 1 and args.delay > 0:
            time.sleep(args.delay)

    print(
        json.dumps(
            {
                "ok": True,
                "keySource": key_src,
                "model": args.model,
                "style": args.style,
                "count": len(results),
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
