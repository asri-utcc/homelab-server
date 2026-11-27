#!/usr/bin/env python3
"""
daily-news-clip.py
Automated daily Thai/International news highlight video generator.
Triggers the existing Video Studio pipeline (studio_job.py oneshot) and sends
a Telegram HTML summary with Watch/Download links, TTS cost, and Gemini credit.
Uses Python 3 standard library only.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import fcntl
import html
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

try:
    from zoneinfo import ZoneInfo

    BKK_TZ = ZoneInfo("Asia/Bangkok")
except Exception:
    BKK_TZ = timezone(timedelta(hours=7))

BASE_DIR = Path("/home/dev/.local/share/motion-studio")
VENV_PY = BASE_DIR / "venv" / "bin" / "python"
STUDIO_JOB = BASE_DIR / "scripts" / "studio_job.py"
MOTION_STUDIO_BIN = "/home/dev/.local/bin/motion-studio"
NOTIFY_TELEGRAM = "/home/dev/projects/notify-telegram.py"
JOBS_DIR = Path("/home/dev/.gemini/outputs/video-studio/jobs")
LOCK_PATH = "/tmp/daily-news-clip.lock"
DASHBOARD_ORIGIN = "https://homelab.tail285279.ts.net"

DEFAULT_DURATION = 210
DEFAULT_STYLE = "look-32"
DEFAULT_BGM = "warm_tech"
ALLOWED_BGM = {"warm_tech", "story_cinematic", "dawn_ambient", "none"}
LOW_CREDIT_THB = 10.0
SUBPROCESS_TIMEOUT_SEC = 3600
MAX_NOTES_LEN = 1000
LOG_TAIL_LINES = 15

JOB_ID_RE = re.compile(r"^[a-z0-9-]{6,40}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FAILED_STATUSES = {"failed", "error"}

# Mirror of studio_job.py RELIGIOUS_KEYWORDS to guarantee news prompts never trigger religious mode
RELIGIOUS_KEYWORDS = (
    "อิสลาม", "ศาสนา", "หะดีษ", "อัลกุรอาน", "ละหมาด", "ดุอา", "อัลลอฮ์", "นบี",
    "รอมฎอน", "ซุนนะฮ์", "ศาสดา", "พุทธ", "ธรรมะ", "คริสต์",
    "islam", "hadith", "quran", "dua", "prayer", "sunnah",
)

THAI_MONTHS = (
    "มกราคม",
    "กุมภาพันธ์",
    "มีนาคม",
    "เมษายน",
    "พฤษภาคม",
    "มิถุนายน",
    "กรกฎาคม",
    "สิงหาคม",
    "กันยายน",
    "ตุลาคม",
    "พฤศจิกายน",
    "ธันวาคม",
)


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def default_yesterday_bkk() -> date:
    return datetime.now(BKK_TZ).date() - timedelta(days=1)


def parse_date_arg(raw: str | None) -> date:
    if not raw:
        return default_yesterday_bkk()
    val = raw.strip()
    if not DATE_RE.fullmatch(val):
        raise ValueError(f"รูปแบบวันที่ไม่ถูกต้อง: '{raw}' (ต้องเป็น YYYY-MM-DD)")
    try:
        return datetime.strptime(val, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError(f"วันที่ไม่ถูกต้อง: '{raw}' ({exc})") from exc


def format_thai_date(d: date) -> str:
    return f"{d.day} {THAI_MONTHS[d.month - 1]} {d.year + 543}"


def build_topic(target_date: date) -> str:
    return f"สรุปข่าวเด็ดประจำวันที่ {format_thai_date(target_date)}"


def build_notes(target_date: date) -> str:
    thai_date = format_thai_date(target_date)
    iso_date = target_date.isoformat()
    notes = (
        f"รายการข่าวสรุปข่าวเด่นที่เกิดขึ้นเมื่อวาน วันที่ {thai_date} ({iso_date}) จำนวน 6 ข่าว "
        "ผสมข่าวในประเทศไทยกับข่าวต่างประเทศ (อย่างละอย่างน้อย 2 ข่าว) "
        "เลือกเฉพาะเรื่องใหญ่หรือประเด็นสำคัญ เช่น การเมือง เศรษฐกิจ เหตุการณ์ใหญ่ เทคโนโลยี กีฬา สังคม "
        f"ห้ามใช้ข่าวเก่ากว่าวันที่ {iso_date} ห้ามแต่งตัวเลขหรือสถิติเอง ต้องอ้างอิงแหล่งข่าวจริงพร้อม URL หน้าข่าว "
        "เล่าแบบผู้ประกาศข่าวรายการข่าวจริงๆ ที่อธิบายรายละเอียดให้คนดูฟังแล้วเข้าใจเรื่องราวชัดเจนในระดับหนึ่ง ข่าวละ 2 ซีน: "
        "ซีนแรกอธิบายให้ครบว่าเกิดอะไรขึ้น ที่ไหน เมื่อไร ใครเกี่ยวข้อง รายละเอียดเหตุการณ์และตัวเลขสำคัญเป็นอย่างไร "
        "ซีนสองอธิบายเบื้องหลังที่มาที่ไป สาเหตุ ผลกระทบต่อประชาชนหรือเศรษฐกิจ ท่าทีของหน่วยงาน และสิ่งที่ต้องติดตามต่อ "
        "ห้ามเขียนสั้นห้วนแบบสไลด์ผู้บริหารหรือสรุปให้นักเรียนท่องจำ ห้ามมีคำคมหรือสรุป 3 คำ "
        "มีซีนเปิดทักทายบอกวันที่และภาพรวมข่าวเด่น และซีนปิดสั้นๆ น้ำเสียงผู้ประกาศข่าวชัดเจน น่าฟัง"
    )
    if len(notes) > MAX_NOTES_LEN:
        notes = notes[:MAX_NOTES_LEN]
    return notes


def assert_non_religious(topic: str, notes: str) -> None:
    haystack = f"{topic} {notes}".lower()
    matched = [kw for kw in RELIGIOUS_KEYWORDS if kw in haystack]
    if matched:
        raise ValueError(f"topic/notes มีคำต้องห้ามในกลุ่ม religious mode: {', '.join(matched)}")


def atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.parent / f".{path.name}.tmp.{os.getpid()}"
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    try:
        with tmp_path.open("w", encoding="utf-8") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def read_json_safe(path: Path) -> dict[str, Any] | None:
    try:
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def append_log_line(job_dir: Path, message: str) -> None:
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(BKK_TZ).strftime("%Y-%m-%d %H:%M:%S")
        with (job_dir / "log.txt").open("a", encoding="utf-8") as f:
            for line in str(message).splitlines() or [""]:
                f.write(f"[{ts}] [daily-news-clip] {line}\n")
    except Exception:
        pass


def read_log_tail(job_dir: Path, max_lines: int = LOG_TAIL_LINES) -> list[str]:
    log_path = job_dir / "log.txt"
    try:
        if not log_path.exists():
            return []
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        return lines[-max_lines:]
    except Exception:
        return []


def acquire_lock(lock_path: str) -> Any:
    lock_file = open(lock_path, "a+", encoding="utf-8")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_file.close()
        return None
    try:
        lock_file.seek(0)
        lock_file.truncate()
        lock_file.write(f"{os.getpid()}\n")
        lock_file.flush()
    except OSError:
        pass
    return lock_file


def release_lock(lock_file: Any) -> None:
    if lock_file is None:
        return
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass
    try:
        lock_file.close()
    except OSError:
        pass


def archive_failed_job(job_dir: Path, job_id: str) -> Path:
    n = 1
    while True:
        retry_id = f"{job_id}-retry{n}"
        retry_dir = JOBS_DIR / retry_id
        if not retry_dir.exists():
            break
        n += 1
    if not JOB_ID_RE.fullmatch(retry_id):
        raise ValueError(f"retry jobId ไม่ตรงรูปแบบที่อนุญาต: {retry_id}")

    job_dir.rename(retry_dir)

    # Keep archived job/request IDs aligned with the new folder name for /video-studio listing
    for fname in ("job.json", "request.json"):
        fpath = retry_dir / fname
        payload = read_json_safe(fpath)
        if payload is not None:
            payload["id"] = retry_id
            try:
                atomic_write_json(fpath, payload)
            except Exception:
                pass
    return retry_dir


def build_child_env() -> dict[str, str]:
    env = dict(os.environ)
    env["HOME"] = "/home/dev"
    env["PYTHONUNBUFFERED"] = "1"
    # Ensure standard user/system binary directories exist when invoked from cron
    current_path = env.get("PATH", "")
    path_parts = [p for p in current_path.split(":") if p]
    for needed in ("/home/dev/.local/bin", "/usr/local/bin", "/usr/bin", "/bin"):
        if needed not in path_parts:
            path_parts.insert(0, needed)
    env["PATH"] = ":".join(path_parts)
    # Deliberately DO NOT set MOTION_REMOTE_RENDER so motion-studio offloads via auto mode
    return env


def make_watch_url(video_path: str) -> str:
    return f"{DASHBOARD_ORIGIN}/api/gemini/local-file?path={video_path}"


def make_download_url(video_path: str) -> str:
    return f"{DASHBOARD_ORIGIN}/api/gemini/local-file?path={video_path}&download=1"


def parse_credit_output(raw_text: str) -> dict[str, Any]:
    text = (raw_text or "").strip()
    if not text:
        return {"ok": False}

    # 1) Try direct JSON or embedded JSON object
    parsed: dict[str, Any] | None = None
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            parsed = obj
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end > start:
            try:
                obj = json.loads(text[start : end + 1])
                if isinstance(obj, dict):
                    parsed = obj
            except json.JSONDecodeError:
                parsed = None

    if parsed is not None:
        rem_raw = parsed.get("remainingThb")
        low_raw = parsed.get("lowThb")
        rem_val: float | None = None
        low_val = LOW_CREDIT_THB
        try:
            if rem_raw is not None:
                rem_val = float(rem_raw)
        except (TypeError, ValueError):
            rem_val = None
        try:
            if low_raw is not None:
                low_val = float(low_raw)
        except (TypeError, ValueError):
            low_val = LOW_CREDIT_THB
        is_low = bool(parsed.get("isLow")) or (rem_val is not None and rem_val < low_val)
        return {
            "ok": bool(parsed.get("ok", rem_val is not None)),
            "remainingThb": rem_val,
            "lowThb": low_val,
            "isLow": is_low,
            "raw": parsed,
        }

    # 2) Fallback plain-text parsing
    rem_val = None
    patterns = (
        r"(?:remaining(?:thb)?|คงเหลือ|balance)[^\d-]{0,20}[฿]?\s*([+-]?\d+(?:,\d{3})*(?:\.\d+)?)",
        r"฿\s*([+-]?\d+(?:,\d{3})*(?:\.\d+)?)",
    )
    for pat in patterns:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            try:
                rem_val = float(m.group(1).replace(",", ""))
                break
            except ValueError:
                pass
    if rem_val is not None:
        return {
            "ok": True,
            "remainingThb": rem_val,
            "lowThb": LOW_CREDIT_THB,
            "isLow": rem_val < LOW_CREDIT_THB,
            "rawText": text,
        }
    return {"ok": False, "rawText": text}


def read_credit_info(env: dict[str, str]) -> dict[str, Any]:
    try:
        res = subprocess.run(
            [MOTION_STUDIO_BIN, "credit"],
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
            check=False,
        )
        out = (res.stdout or "").strip() or (res.stderr or "").strip()
        info = parse_credit_output(out)
        if res.returncode != 0 and not info.get("ok"):
            info["error"] = f"motion-studio credit exited {res.returncode}"
        return info
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def extract_latest_output(job_data: dict[str, Any]) -> dict[str, Any]:
    outputs = job_data.get("outputs") if isinstance(job_data.get("outputs"), dict) else {}
    versions = job_data.get("versions") if isinstance(job_data.get("versions"), list) else []

    latest: dict[str, Any] = {}
    valid_versions = [v for v in versions if isinstance(v, dict)]
    if valid_versions:
        def _ver_key(v: dict[str, Any]) -> int:
            try:
                return int(v.get("version") or 0)
            except (TypeError, ValueError):
                return 0

        latest = max(valid_versions, key=_ver_key)

    video_path = str(
        latest.get("videoPath")
        or outputs.get("videoPath")
        or latest.get("path")
        or ""
    ).strip()

    watch_url = str(latest.get("watchUrl") or outputs.get("watchUrl") or "").strip()
    if not watch_url and video_path:
        watch_url = make_watch_url(video_path)

    download_url = str(latest.get("downloadUrl") or outputs.get("downloadUrl") or "").strip()
    if not download_url and video_path:
        download_url = make_download_url(video_path)

    duration_raw = latest.get("durationSec")
    if duration_raw is None:
        duration_raw = outputs.get("durationSec")
    duration_sec: float | None = None
    try:
        if duration_raw is not None:
            duration_sec = float(duration_raw)
    except (TypeError, ValueError):
        duration_sec = None

    cost_details = latest.get("costDetails")
    if not isinstance(cost_details, dict):
        cost_details = outputs.get("costDetails")
    if not isinstance(cost_details, dict):
        cost_details = {}

    def _first_float(*vals: Any) -> float | None:
        for val in vals:
            if val is not None:
                try:
                    return float(val)
                except (TypeError, ValueError):
                    continue
        return None

    cost_thb = _first_float(latest.get("costThb"), outputs.get("costThb"), cost_details.get("costThb"))
    clip_total_thb = _first_float(cost_details.get("clipTotalThb"), cost_thb)
    job_remaining_thb = _first_float(cost_details.get("remainingThb"))

    render_node = str(
        latest.get("renderNode")
        or outputs.get("renderNode")
        or job_data.get("renderNode")
        or ""
    ).strip()

    return {
        "title": str(job_data.get("title") or job_data.get("topic") or "").strip(),
        "videoPath": video_path,
        "watchUrl": watch_url,
        "downloadUrl": download_url,
        "durationSec": duration_sec,
        "costThb": cost_thb,
        "clipTotalThb": clip_total_thb,
        "voice": str(cost_details.get("voice") or "").strip(),
        "engine": str(cost_details.get("engine") or "").strip(),
        "jobRemainingThb": job_remaining_thb,
        "renderNode": render_node,
        "telegramSent": bool(outputs.get("telegramSent", False)),
        "telegramError": str(outputs.get("telegramError") or "").strip(),
    }


def format_success_html(
    *,
    target_date: date,
    job_id: str,
    topic: str,
    info: dict[str, Any],
    credit: dict[str, Any],
) -> str:
    thai_date = format_thai_date(target_date)
    iso_date = target_date.isoformat()
    clip_title = info.get("title") or topic

    dur = info.get("durationSec")
    dur_str = f"{dur:.1f} วินาที" if dur is not None and dur > 0 else "ไม่ทราบ"

    cost_thb = info.get("costThb")
    clip_total_thb = info.get("clipTotalThb")
    voice = info.get("voice") or ""
    engine = info.get("engine") or ""

    if clip_total_thb is not None:
        if clip_total_thb == 0.0 and not voice.startswith("gemini:") and engine != "gemini":
            cost_str = "฿0.00 (ฟรี)"
        elif cost_thb is not None and cost_thb == 0.0 and clip_total_thb > 0.0:
            cost_str = f"฿0.00 (แคช · รวมทั้งคลิป ฿{clip_total_thb:.2f})"
        else:
            cost_str = f"฿{clip_total_thb:.2f}"
    else:
        cost_str = "ไม่ทราบ"

    rem_thb = credit.get("remainingThb")
    if rem_thb is None:
        rem_thb = info.get("jobRemainingThb")
    low_thb = float(credit.get("lowThb") if credit.get("lowThb") is not None else LOW_CREDIT_THB)
    is_low = (rem_thb is not None and rem_thb < low_thb) or bool(credit.get("isLow"))

    credit_str = f"~฿{rem_thb:.2f}" if rem_thb is not None else "ไม่ทราบ"

    lines = [
        "📰 <b>สรุปข่าวเด็ดประจำวันพร้อมรับชมแล้ว</b>",
        f"<b>หัวข้อ:</b> {html.escape(clip_title)}",
        f"<b>วันที่ข่าว:</b> {html.escape(thai_date)} ({html.escape(iso_date)})",
        f"<b>Job ID:</b> <code>{html.escape(job_id)}</code>",
    ]

    meta_parts = [f"⏱ <b>ความยาว:</b> {html.escape(dur_str)}"]
    if info.get("renderNode"):
        meta_parts.append(f"🖥 <b>Render:</b> {html.escape(str(info['renderNode']))}")
    lines.append(" · ".join(meta_parts))

    watch_url = str(info.get("watchUrl") or "").strip()
    download_url = str(info.get("downloadUrl") or "").strip()
    if watch_url or download_url:
        link_parts = []
        if watch_url:
            link_parts.append(f'<a href="{html.escape(watch_url, quote=True)}">▶️ ดูวิดีโอ Master</a>')
        if download_url:
            link_parts.append(f'<a href="{html.escape(download_url, quote=True)}">⬇️ ดาวน์โหลด MP4</a>')
        lines.append("🎬 " + " | ".join(link_parts))

    lines.append(f"💸 <b>ค่าเสียงพากย์:</b> {html.escape(cost_str)}")
    lines.append(f"💳 <b>เครดิต Gemini คงเหลือ:</b> {html.escape(credit_str)}")

    if is_low:
        lines.append(
            f"⚠️ <b>คำเตือน:</b> เครดิต Gemini API เหลือต่ำกว่า ฿{low_thb:.0f} กรุณาเติมเครดิต!"
        )

    if info.get("telegramError"):
        lines.append(
            f"⚠️ <i>หมายเหตุ: ส่งไฟล์คลิปอัตโนมัติไม่สำเร็จ ({html.escape(str(info['telegramError']))}) สามารถดู/โหลดจากลิงก์ด้านบนได้</i>"
        )

    return "\n".join(lines)


def format_error_html(
    *,
    target_date: date,
    job_id: str,
    topic: str,
    error_msg: str,
    log_tail: list[str],
) -> str:
    thai_date = format_thai_date(target_date)
    iso_date = target_date.isoformat()
    header_lines = [
        "❌ <b>สร้างคลิปข่าวเด็ดประจำวันไม่สำเร็จ</b>",
        f"<b>หัวข้อ:</b> {html.escape(topic)}",
        f"<b>วันที่ข่าว:</b> {html.escape(thai_date)} ({html.escape(iso_date)})",
        f"<b>Job ID:</b> <code>{html.escape(job_id)}</code>",
        f"<b>สาเหตุ:</b> {html.escape(error_msg[:500])}",
    ]
    msg = "\n".join(header_lines)
    if log_tail:
        snippet = "\n".join(log_tail)
        # Keep well under Telegram 4096-character limit after HTML escaping
        if len(snippet) > 2200:
            snippet = snippet[-2200:]
        escaped_log = html.escape(snippet)
        msg += f"\n\n<b>Log ล่าสุด ({len(log_tail)} บรรทัด):</b>\n<pre>{escaped_log}</pre>"
    return msg


def send_telegram_html(html_message: str, env: dict[str, str]) -> tuple[bool, str]:
    try:
        res = subprocess.run(
            ["/usr/bin/python3", NOTIFY_TELEGRAM, html_message],
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
            check=False,
        )
        if res.returncode == 0:
            return True, (res.stdout or "").strip()
        err = (res.stderr or res.stdout or f"notify-telegram exited {res.returncode}").strip()
        return False, err
    except Exception as exc:
        return False, str(exc)


def mark_job_error(job_dir: Path, error_msg: str) -> None:
    job_path = job_dir / "job.json"
    data = read_json_safe(job_path) or {}
    if str(data.get("status") or "").strip().lower() not in FAILED_STATUSES:
        data["status"] = "error"
        data["stage"] = "error"
        data["error"] = error_msg[:300]
        data["message"] = f"เกิดข้อผิดพลาด: {error_msg[:200]}"
        data["updatedAt"] = now_utc_iso()
        try:
            atomic_write_json(job_path, data)
        except Exception:
            pass


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="สร้างคลิปสรุปข่าวเด็ดประจำวันของเมื่อวานผ่าน Video Studio pipeline"
    )
    parser.add_argument(
        "--date",
        default=None,
        help="วันที่ของข่าวในรูปแบบ YYYY-MM-DD (ค่าเริ่มต้น: เมื่อวานตามเวลา Asia/Bangkok)",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=DEFAULT_DURATION,
        help=f"ความยาวเป้าหมายเป็นวินาที (ค่าเริ่มต้น: {DEFAULT_DURATION})",
    )
    parser.add_argument(
        "--style",
        default=DEFAULT_STYLE,
        help=f"รหัสสไตล์ Video Studio (ค่าเริ่มต้น: {DEFAULT_STYLE})",
    )
    parser.add_argument(
        "--bgm",
        default=DEFAULT_BGM,
        help=f"พรีเซ็ตเพลงประกอบ (ค่าเริ่มต้น: {DEFAULT_BGM})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="สร้างเฉพาะโฟลเดอร์งานและ request.json/job.json โดยไม่สั่งรัน studio_job.py",
    )
    parser.add_argument(
        "--no-telegram",
        action="store_true",
        help="ปิดการส่งคลิปและข้อความสรุปไปยัง Telegram",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        target_date = parse_date_arg(args.date)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    duration_sec = int(args.duration)
    if duration_sec < 12 or duration_sec > 300:
        print(f"Error: --duration ต้องอยู่ระหว่าง 12 ถึง 300 วินาที (ได้รับ {duration_sec})", file=sys.stderr)
        return 1

    style_id = str(args.style or "").strip()
    if not JOB_ID_RE.fullmatch(style_id):
        print(f"Error: --style ไม่ตรงรูปแบบ ^[a-z0-9-]{{6,40}}$ (ได้รับ '{style_id}')", file=sys.stderr)
        return 1

    bgm = str(args.bgm or DEFAULT_BGM).strip()
    if bgm not in ALLOWED_BGM:
        print(f"Error: --bgm ไม่ถูกต้อง '{bgm}' (รองรับ: {', '.join(sorted(ALLOWED_BGM))})", file=sys.stderr)
        return 1

    yyyymmdd = target_date.strftime("%Y%m%d")
    job_id = f"daily-news-{yyyymmdd}"
    if not JOB_ID_RE.fullmatch(job_id):
        print(f"Error: jobId '{job_id}' ไม่ตรงรูปแบบ ^[a-z0-9-]{{6,40}}$", file=sys.stderr)
        return 1

    topic = build_topic(target_date)
    notes = build_notes(target_date)
    assert_non_religious(topic, notes)

    job_dir = JOBS_DIR / job_id
    send_telegram = not args.no_telegram
    env = build_child_env()

    lock_file = None
    if not args.dry_run:
        lock_file = acquire_lock(LOCK_PATH)
        if lock_file is None:
            print(f"[skip] มีโปรเซส daily-news-clip กำลังทำงานอยู่แล้ว ({LOCK_PATH})")
            return 0

    resume_existing = False
    try:
        # Idempotency & retry archive handling
        if job_dir.exists():
            existing_job = read_json_safe(job_dir / "job.json")
            existing_status = (
                str(existing_job.get("status") or "").strip().lower()
                if isinstance(existing_job, dict)
                else ""
            )
            # We hold the run lock, so any non-done status (failed/aborted/stuck) is a dead run -> retry
            if existing_job is not None and existing_status == "done":
                print(
                    f"[skip] งาน {job_id} มีอยู่แล้ว (status={existing_status or 'unknown'}) ที่ {job_dir}"
                )
                return 0
            # A failed/interrupted run that already has a script resumes in place (studio_job.py resume
            # reuses script, cached TTS and any valid render/mix) instead of researching from scratch.
            if existing_job is not None and (job_dir / "script.json").exists() and not args.dry_run:
                resume_existing = True
                print(f"[resume] ทำงานเดิมต่อ (status={existing_status or 'unknown'}) ที่ {job_dir}")
            else:
                retry_dir = archive_failed_job(job_dir, job_id)
                print(f"[retry] ย้ายงานเดิมที่ไม่สำเร็จ (status={existing_status or 'missing'}) ไปยัง {retry_dir}")

        # Atomic creation of request.json and job.json matching createJob() schema
        job_dir.mkdir(parents=True, exist_ok=True)
        created_at = now_utc_iso()

        request_payload: dict[str, Any] = {
            "id": job_id,
            "topic": topic,
            "styleId": style_id,
            "durationSec": duration_sec,
            "mode": "oneshot",
            "bgm": bgm,
            "sendTelegram": send_telegram,
            "notes": notes,
            "contentMode": "news",
            "newsMedia": True,
            "storyDate": target_date.isoformat(),
            "createdAt": created_at,
        }
        initial_job: dict[str, Any] = {
            "id": job_id,
            "topic": topic,
            "styleId": style_id,
            "durationSec": duration_sec,
            "mode": "oneshot",
            "bgm": bgm,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "message": "เข้าคิวรอเริ่มงาน...",
            "versions": [],
            "error": None,
            "createdAt": created_at,
            "updatedAt": created_at,
        }

        if not resume_existing:
            atomic_write_json(job_dir / "request.json", request_payload)
            atomic_write_json(job_dir / "job.json", initial_job)

        if args.dry_run:
            print(f"[dry-run] สร้างงาน {job_id} เรียบร้อยที่ {job_dir}")
            print(f"  topic: {topic}")
            print(f"  styleId: {style_id} | durationSec: {duration_sec} | bgm: {bgm} | sendTelegram: {send_telegram}")
            print(f"  notes ({len(notes)} chars): {notes}")
            return 0

        # Execute studio_job.py oneshot
        if not VENV_PY.exists() or not STUDIO_JOB.exists():
            err_msg = f"ไม่พบตัวรัน Video Studio ({VENV_PY} หรือ {STUDIO_JOB})"
            append_log_line(job_dir, f"ERROR: {err_msg}")
            mark_job_error(job_dir, err_msg)
            print(f"Error: {err_msg}", file=sys.stderr)
            if send_telegram:
                html_err = format_error_html(
                    target_date=target_date,
                    job_id=job_id,
                    topic=topic,
                    error_msg=err_msg,
                    log_tail=read_log_tail(job_dir, LOG_TAIL_LINES),
                )
                send_telegram_html(html_err, env)
            return 1

        run_cmd = "resume" if resume_existing else "oneshot"
        cmd = [str(VENV_PY), str(STUDIO_JOB), run_cmd, "--job", str(job_dir)]
        append_log_line(job_dir, f"Starting {run_cmd} job {job_id} for {target_date.isoformat()} (style={style_id}, duration={duration_sec}s)")
        print(f"[run] เริ่มสร้างคลิป {job_id} ({topic}) -> {job_dir}")

        returncode = 1
        run_error = ""
        try:
            with (job_dir / "log.txt").open("a", encoding="utf-8") as log_f:
                proc = subprocess.run(
                    cmd,
                    cwd=str(BASE_DIR),
                    env=env,
                    stdout=log_f,
                    stderr=subprocess.STDOUT,
                    timeout=SUBPROCESS_TIMEOUT_SEC,
                    check=False,
                )
                returncode = proc.returncode
        except subprocess.TimeoutExpired:
            run_error = f"studio_job.py ทำงานเกินเวลาที่กำหนด ({SUBPROCESS_TIMEOUT_SEC} วินาที)"
            append_log_line(job_dir, f"ERROR: {run_error}")
            mark_job_error(job_dir, run_error)
        except Exception as exc:
            run_error = f"เรียกใช้งาน studio_job.py ล้มเหลว: {exc}"
            append_log_line(job_dir, f"ERROR: {run_error}")
            mark_job_error(job_dir, run_error)

        job_data = read_json_safe(job_dir / "job.json") or {}
        final_status = str(job_data.get("status") or "").strip().lower()

        if run_error or returncode != 0 or final_status != "done":
            err_msg = (
                run_error
                or str(job_data.get("error") or "").strip()
                or f"studio_job.py จบไม่สมบูรณ์ (rc={returncode}, status={final_status or 'unknown'})"
            )
            mark_job_error(job_dir, err_msg)
            append_log_line(job_dir, f"Job failed: {err_msg}")
            print(f"Error: {err_msg}", file=sys.stderr)
            if send_telegram:
                html_err = format_error_html(
                    target_date=target_date,
                    job_id=job_id,
                    topic=topic,
                    error_msg=err_msg,
                    log_tail=read_log_tail(job_dir, LOG_TAIL_LINES),
                )
                tg_ok, tg_out = send_telegram_html(html_err, env)
                if not tg_ok:
                    print(f"[warn] ส่งข้อความแจ้ง error เข้า Telegram ไม่สำเร็จ: {tg_out}", file=sys.stderr)
            return 1

        # Extract output details & credit balance
        info = extract_latest_output(job_data)
        video_path = info.get("videoPath") or ""
        if not video_path or not Path(video_path).exists():
            err_msg = f"งานจบ status=done แต่ไม่พบไฟล์วิดีโอผลลัพธ์ ({video_path or 'empty'})"
            append_log_line(job_dir, f"ERROR: {err_msg}")
            mark_job_error(job_dir, err_msg)
            print(f"Error: {err_msg}", file=sys.stderr)
            if send_telegram:
                html_err = format_error_html(
                    target_date=target_date,
                    job_id=job_id,
                    topic=topic,
                    error_msg=err_msg,
                    log_tail=read_log_tail(job_dir, LOG_TAIL_LINES),
                )
                send_telegram_html(html_err, env)
            return 1

        credit = read_credit_info(env)
        append_log_line(
            job_dir,
            f"Completed: video={video_path} dur={info.get('durationSec')}s "
            f"costThb={info.get('clipTotalThb')} remainingThb={credit.get('remainingThb')}",
        )
        print(
            f"[done] สร้างคลิปสำเร็จ: {video_path} "
            f"(watch={info.get('watchUrl')}, costThb={info.get('clipTotalThb')}, "
            f"remainingThb={credit.get('remainingThb')})"
        )

        if send_telegram:
            html_summary = format_success_html(
                target_date=target_date,
                job_id=job_id,
                topic=topic,
                info=info,
                credit=credit,
            )
            tg_ok, tg_out = send_telegram_html(html_summary, env)
            if not tg_ok:
                err_msg = f"ส่งข้อความสรุปเข้า Telegram ไม่สำเร็จ: {tg_out}"
                append_log_line(job_dir, f"ERROR: {err_msg}")
                print(f"Error: {err_msg}", file=sys.stderr)
                return 1
            print(f"[telegram] {tg_out or 'ส่งข้อความสรุปเรียบร้อย'}")

        return 0
    finally:
        release_lock(lock_file)


if __name__ == "__main__":
    raise SystemExit(main())
