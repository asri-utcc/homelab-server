#!/usr/bin/env python3
"""Style Learner CLI: extracts StyleTokens from a video URL or uploaded files using yt-dlp + ffmpeg + agy."""

from __future__ import annotations

import argparse
import fcntl
import json
import re
import secrets
import subprocess
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from studio_styles import (
    BASE_DIR,
    CUSTOM_PATH,
    VALID_BG_PATTERNS,
    VALID_FAMILIES,
    VALID_SUBTITLE_STYLES,
    VALID_TRANSITIONS,
    validate_tokens,
)

YT_DLP_BIN = str(BASE_DIR / "venv" / "bin" / "yt-dlp")
AGY_BIN = "/home/dev/.local/bin/agy"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def write_job(job_dir: Path, payload: dict[str, Any]) -> None:
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "job.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run_agy(prompt: str, model: str = "gemini-4-neon-high", timeout: int = 120) -> str:
    cmd = [
        AGY_BIN,
        "-p",
        prompt,
        "--model",
        model,
        "--disable-slash-commands",
        "--dangerously-skip-permissions",
        "--print-timeout",
        f"{timeout}s",
    ]
    res = subprocess.run(
        cmd,
        cwd="/home/dev/projects",
        capture_output=True,
        text=True,
        timeout=timeout + 20,
    )
    if res.returncode != 0:
        err = res.stderr.strip() or res.stdout.strip() or f"agy exited with {res.returncode}"
        raise RuntimeError(err)
    return res.stdout.strip()


def extract_json_block(text: str) -> dict[str, Any]:
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    raw = m.group(1) if m else text.strip()
    return json.loads(raw)


def download_video(url: str, job_dir: Path) -> Path:
    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError("URL ต้องขึ้นต้นด้วย http:// หรือ https:// เท่านั้น")
    out_tmpl = str(job_dir / "source.%(ext)s")
    cmd = [
        YT_DLP_BIN,
        "-f",
        "bv*[height<=720]+ba/b[height<=720]",
        "--no-playlist",
        "--max-filesize",
        "200M",
        "--download-sections",
        "*0-180",
        "-o",
        out_tmpl,
        url,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if res.returncode != 0:
        raise RuntimeError(
            "ไม่สามารถดาวน์โหลดวิดีโอจากลิงก์นี้ได้ (อาจติดล็อกอินหรือจำกัดสิทธิ์) "
            "แนะนำให้อัปโหลดไฟล์วิดีโอหรือภาพแคปหน้าจอแทนค่ะ"
        )
    for p in sorted(job_dir.glob("source.*")):
        if p.is_file():
            return p
    raise RuntimeError("ไม่พบไฟล์วิดีโอที่ดาวน์โหลด")


def extract_keyframes(video_path: Path, frames_dir: Path) -> list[Path]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    try:
        duration = max(1.0, float(probe.stdout.strip()))
    except ValueError:
        duration = 10.0
    fps_expr = f"8/{duration:.3f}"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video_path),
            "-vf",
            f"fps={fps_expr},scale=540:-1",
            "-frames:v",
            "8",
            str(frames_dir / "frame_%02d.png"),
        ],
        capture_output=True,
        text=True,
        timeout=90,
        check=True,
    )
    frames = sorted(frames_dir.glob("frame_*.png"))
    if not frames:
        raise RuntimeError("ไม่สามารถดึงภาพ keyframes จากวิดีโอได้")
    return frames


def build_prompt(image_paths: list[Path], custom_name: str | None, retry_errors: list[str] | None = None) -> str:
    paths_str = "\n".join(f"- {p}" for p in image_paths)
    name_hint = f'ชื่อสไตล์ที่ผู้ใช้ตั้ง: "{custom_name}"\n' if custom_name else ""
    err_hint = ""
    if retry_errors:
        err_hint = (
            "\nคำตอบก่อนหน้าไม่ผ่านการตรวจสอบ กรุณาแก้ไขข้อผิดพลาดต่อไปนี้:\n"
            + "\n".join(f"- {e}" for e in retry_errors)
            + "\n"
        )
    return f"""กรุณาเปิดอ่านไฟล์ภาพต่อไปนี้เพื่อวิเคราะห์สไตล์ภาพ สี แสง ฟอนต์ และจังหวะการเคลื่อนไหว:
{paths_str}
{name_hint}{err_hint}
ตอบกลับเป็น JSON ในบล็อก ```json ... ``` เท่านั้น ห้ามมีข้อความอื่น โดยมีโครงสร้างดังนี้:
{{
  "enName": "Short English Style Name",
  "thName": "ชื่อสไตล์ภาษาไทย",
  "summary": "คำอธิบายสั้นๆ 1 ประโยคภาษาไทย",
  "tokens": {{
    "family": "เลือก 1 ค่าจาก {list(VALID_FAMILIES)}",
    "palette": {{
      "bg": "#RRGGBB",
      "bgSecondary": "#RRGGBB",
      "fg": "#RRGGBB (ต้องมี contrast กับ bg >= 4.5:1)",
      "muted": "#RRGGBB",
      "accent": "#RRGGBB",
      "accent2": "#RRGGBB",
      "cardBg": "#RRGGBB",
      "border": "#RRGGBB"
    }},
    "typography": {{
      "fontFamily": "Noto Sans Thai, Kanit, sans-serif",
      "titleWeight": 800,
      "subtitleStyle": "เลือก 1 ค่าจาก {list(VALID_SUBTITLE_STYLES)}"
    }},
    "motion": {{
      "springDamping": 15,
      "springStiffness": 160,
      "transitionType": "เลือก 1 ค่าจาก {list(VALID_TRANSITIONS)}",
      "parallaxStrength": 0.4,
      "glowIntensity": 0.3
    }},
    "background": {{
      "pattern": "เลือก 1 ค่าจาก {list(VALID_BG_PATTERNS)}",
      "vignette": 0.3,
      "grain": 0.15
    }},
    "promptHints": "คำแนะนำภาษาไทย 1-2 ประโยคสำหรับ AI เขียนบทวิดีโอในสไตล์นี้"
  }}
}}"""


def save_custom_style(parsed: dict[str, Any], custom_name: str | None) -> str:
    en_name = (parsed.get("enName") or custom_name or "Custom Style").strip()
    th_name = (custom_name or parsed.get("thName") or en_name).strip()
    slug = re.sub(r"[^a-z0-9]+", "-", en_name.lower()).strip("-")[:20] or "style"
    style_id = f"custom-{slug}-{secrets.token_hex(2)}"

    CUSTOM_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not CUSTOM_PATH.exists():
        CUSTOM_PATH.write_text('{"version": 1, "presets": {}}', encoding="utf-8")

    with CUSTOM_PATH.open("r+", encoding="utf-8") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            data = json.load(f)
            if "presets" not in data or not isinstance(data["presets"], dict):
                data["presets"] = {}
            data["presets"][style_id] = {
                "id": style_id,
                "enName": en_name,
                "thName": th_name,
                "category": "สไตล์ของฉัน (Custom)",
                "summary": parsed.get("summary") or f"สไตล์ที่เรียนรู้จากตัวอย่าง ({th_name})",
                "tokens": parsed["tokens"],
            }
            f.seek(0)
            f.truncate()
            json.dump(data, f, ensure_ascii=False, indent=2)
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    return style_id


def main() -> int:
    parser = argparse.ArgumentParser(description="Learn a new StyleTokens preset from URL or files.")
    parser.add_argument("--job", required=True, help="Job working directory")
    parser.add_argument("--url", help="Video URL (http/https)")
    parser.add_argument("--file", nargs="+", help="Uploaded video or image file path(s)")
    parser.add_argument("--name", help="Optional custom style name")
    args = parser.parse_args()

    job_dir = Path(args.job)
    try:
        image_paths: list[Path] = []
        if args.url:
            write_job(job_dir, {"status": "downloading"})
            video_path = download_video(args.url, job_dir)
            write_job(job_dir, {"status": "extracting"})
            image_paths = extract_keyframes(video_path, job_dir / "frames")
        elif args.file:
            write_job(job_dir, {"status": "extracting"})
            for fp in args.file:
                p = Path(fp)
                if not p.exists():
                    raise FileNotFoundError(f"ไม่พบไฟล์: {p}")
                if p.suffix.lower() in IMAGE_EXTS:
                    image_paths.append(p)
                else:
                    image_paths.extend(extract_keyframes(p, job_dir / "frames"))
        else:
            raise ValueError("ต้องระบุ --url หรือ --file อย่างน้อย 1 อย่าง")

        write_job(job_dir, {"status": "analyzing"})
        raw_out = run_agy(build_prompt(image_paths[:8], args.name))
        parsed = extract_json_block(raw_out)
        ok, errs = validate_tokens(parsed.get("tokens"))
        if not ok:
            raw_out = run_agy(build_prompt(image_paths[:8], args.name, retry_errors=errs))
            parsed = extract_json_block(raw_out)
            ok, errs = validate_tokens(parsed.get("tokens"))
            if not ok:
                raise ValueError("StyleTokens ไม่ผ่านการตรวจสอบ: " + "; ".join(errs))

        style_id = save_custom_style(parsed, args.name)
        write_job(job_dir, {"status": "done", "styleId": style_id})
        print(json.dumps({"ok": True, "styleId": style_id}, ensure_ascii=False))
        return 0
    except Exception as exc:
        write_job(job_dir, {"status": "error", "error": str(exc)})
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
