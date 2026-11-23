#!/usr/bin/env python3
"""Studio Job Runner for Video Studio (/video-studio).

Handles:
  - oneshot    : research -> script -> tts -> render -> mix -> preview -> copy -> telegram
  - draft      : research -> script -> draft_ready
  - build      : lock -> tts (cached) -> props -> render -> mix -> preview -> copy -> telegram
  - edit-scene : lock -> tts (cached) -> props -> render -> mix -> final_v{N}.mp4
  - trim       : ffmpeg trim [start, end] -> final_v{N}.mp4
  - cut        : ffmpeg cut out [from, to] -> final_v{N}.mp4
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

BASE_DIR = Path("/home/dev/.local/share/motion-studio")
SCRIPTS_DIR = BASE_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
import credit_ledger  # noqa: E402

PRESETS_PATH = BASE_DIR / "assets" / "studio_style_presets.json"
CUSTOM_STYLES_PATH = BASE_DIR / "assets" / "studio_custom_styles.json"

MOTION_STUDIO_BIN = "/home/dev/.local/bin/motion-studio"
AGY_BIN = os.environ.get("AGY_BIN", "/home/dev/.local/bin/agy")
PROFILES_DIR = Path("/home/dev/.agy-profiles")
MAIN_TOKEN_REL = Path(".gemini/antigravity-cli/antigravity-oauth-token")

OUTPUT_VIDEOS_DIR = Path("/home/dev/.gemini/outputs/videos")
STUDIO_ROOT_DIR = Path("/home/dev/.gemini/outputs/video-studio")
RENDER_LOCK_PATH = STUDIO_ROOT_DIR / "render.lock"
DASHBOARD_ORIGIN = "https://homelab.tail285279.ts.net"

PRIMARY_MODEL = "gemini-4-neon-high"
FALLBACK_MODEL = "gemini-3.8-flash-medium"

VALID_BGMS = ("warm_tech", "story_cinematic", "dawn_ambient", "none")
VALID_SFX = ("soft_impact", "spark", "riser", "pop", "shimmer", "click", "chime", "whoosh")
VALID_VISUALS = ("title", "bullets", "stat", "steps", "compare", "quote", "image", "icon")

# Illustrated (hand-drawn, per-scene staged) styles — rendered by src/studio/director/*
ILLUSTRATED_STYLES = {"look-5", "look-7", "look-8"}
DIRECTION_SHOTS = ("pov-desk", "interview", "whiteboard", "closeup", "crowd", "split", "stairs", "held-paper", "door", "phone")
DIRECTION_MOODS = ("confident", "worried", "panic", "happy", "think", "smug", "tired", "shock")
DIRECTION_POSES = ("type", "stand", "point", "shrug", "cheer", "facepalm", "think", "wave", "hold", "present")
DIRECTION_PROPS = (
    "laptop", "mug", "cup-tower", "calendar", "clock", "resume", "chair", "phone", "bulb", "money", "trophy",
    "plant", "window", "briefcase", "rocket", "chart", "question", "check", "cross", "robot", "book", "star", "heart", "fire",
)
DIRECTION_CAST = ("hero", "interviewer", "boss", "friend", "crowd")

# Style-directed (per-style bespoke shot) catalog — synchronized with src/studio/styleDirector/*
STYLE_DIRECTOR_SHOTS: dict[str, dict[str, str]] = {
    "look-15": {
        "chat-burst": "บับเบิลแชทเด้งรัวสลับซ้ายขวาเหมือนคุยจริง",
        "typing-reveal": "จุดกำลังพิมพ์ (...) แล้วเด้งข้อความเฉลยคำตอบ",
        "screenshot-zoom": "ซูมหน้าจอแชทเน้นข้อความสำคัญพร้อมไฮไลต์",
        "group-chat": "แชทกลุ่มหลายคนโต้ตอบกันหลายชื่อ",
        "voice-note": "ข้อความเสียงพร้อมคลื่นเสียงวิ่งและคำถอดความ",
    },
    "look-24": {
        "race-bars": "แท่งอันดับวิ่งแข่งขึ้นลงพร้อมตัวเลข",
        "podium": "แท่นรับรางวัลอันดับ 1-2-3 พร้อมถ้วย/เหรียญ",
        "top-list-scroll": "ลิสต์อันดับไล่เรียงจากบนลงล่างพร้อมแถบคะแนน",
        "versus-gap": "เทียบช่องว่างความต่างระหว่างสองอันดับชัดเจน",
    },
    "look-27": {
        "split-duel": "แบ่งจอซ้ายขวาประชันตัวต่อตัวพร้อมสายฟ้า VS",
        "scoreboard": "ป้ายสกอร์บอร์ดนับแต้มเปรียบเทียบสองฝั่ง",
        "tug-of-war": "แถบชักเย่อดึงน้ำหนักชี้ฝั่งที่ได้เปรียบ",
        "verdict": "หน้าสรุปตัดสินผู้ชนะพร้อมตราประทับ",
    },
    "look-11": {
        "cash-tower": "กองธนบัตรซ้อนสูงเป็นตึกตามมูลค่าตัวเลข",
        "coin-rain": "เหรียญทองโปรยลงมาสะสมพร้อมยอดรวม",
        "piggy-bank": "กระปุกออมสินหยอดเหรียญแสดงเงินออม",
        "debt-pit": "หลุมรายจ่าย/หนี้สินที่ดูดเงินลงด้านล่าง",
    },
    "look-13": {
        "receipt-print": "ใบเสร็จค่อยๆ พิมพ์ไหลออกมาจากเครื่องพิมพ์",
        "itemized-zoom": "ซูมรายการทีละบรรทัดพร้อมราคาต่อหน่วย",
        "total-stamp": "ยอดสุทธิท้ายใบเสร็จพร้อมตราประทับ PAID/ALERT",
        "crumple": "ใบเสร็จยับ/ฉีกเน้นจุดรั่วไหลหรือสิ่งที่ควรตัดออก",
    },
    "look-14": {
        "iceberg-reveal": "ภูเขาน้ำแข็งเต็มมุม เผยยอดเหนือน้ำและฐานมหึมาใต้น้ำ",
        "dive-down": "กล้องดำดิ่งลงใต้ผิวน้ำเปิดชั้นความลับทีละระดับ",
        "hidden-labels": "ชี้ป้ายอธิบายองค์ประกอบที่ซ่อนอยู่ใต้น้ำ",
        "tip-only": "โฟกัสเฉพาะยอดน้ำแข็งที่คนทั่วไปมองเห็น",
    },
    "look-1": {
        "glow-portal": "วงแหวนประตูแสงเรืองรองดึงสายตาสู่ใจกลาง",
        "constellation": "กลุ่มดาวเชื่อมเส้นโนดอธิบายความสัมพันธ์",
        "orb-core": "ลูกแก้วพลังงานเรืองแสงพร้อมวงโคจรและค่าหลัก",
        "light-path": "เส้นทางแสงทอดยาวเชื่อมจุดเริ่มต้นสู่เป้าหมาย",
    },
    "look-31": {
        "desk-overhead": "มุมมองจากด้านบนเห็นโต๊ะทำงาน กระดาษ และอุปกรณ์",
        "sticky-wall": "บอร์ดโพสต์อิทแปะเรียงประเด็นสำคัญ",
        "folder-open": "แฟ้มเอกสารเปิดกางโชว์ข้อมูลสำคัญข้างใน",
        "highlight-doc": "แผ่นเอกสารซูมใกล้พร้อมปากกาไฮไลต์ขีดทับคำสำคัญ",
    },
    "look-36": {
        "horizontal-track": "เส้นไทม์ไลน์แนวนอนเลื่อนผ่านหมุดเหตุการณ์",
        "vertical-scroll": "เส้นไทม์ไลน์แนวตั้งไล่ลำดับปี/ขั้นตอนลงมา",
        "milestone-zoom": "ซูมหมุดเหตุการณ์สำคัญจุดเดียวพร้อมรายละเอียด",
        "then-vs-now": "เทียบอดีตกับปัจจุบันบนเส้นเวลาเดียวกัน",
    },
}


def sanitize_direction(raw: Any, style_id: str | None = None) -> dict[str, Any] | None:
    """Keep only known vocabulary from the AI's per-scene staging directions."""
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    sid = str(style_id or "").strip().lower()
    style_shots = STYLE_DIRECTOR_SHOTS.get(sid) or {}
    shot = str(raw.get("shot") or "").strip().lower()
    if shot in DIRECTION_SHOTS or shot in style_shots:
        out["shot"] = shot
    mood = str(raw.get("mood") or "").strip().lower()
    if mood in DIRECTION_MOODS:
        out["mood"] = mood
    pose = str(raw.get("pose") or "").strip().lower()
    if pose in DIRECTION_POSES:
        out["pose"] = pose
    props = [str(p).strip().lower() for p in (raw.get("props") or []) if isinstance(p, str)]
    props = [p for p in props if p in DIRECTION_PROPS][:4]
    if props:
        out["props"] = props
    cast = [str(c).strip().lower() for c in (raw.get("cast") or []) if isinstance(c, str)]
    cast = [c for c in cast if c in DIRECTION_CAST][:3]
    if cast:
        out["cast"] = cast
    env = str(raw.get("env") or "").strip().lower()
    if env in ("indoor", "outdoor"):
        out["env"] = env
    action = str(raw.get("action") or "").strip()
    if action:
        out["action"] = action[:160]
    return out or None

VISUAL_ALIASES = {"hero": "title", "outro": "quote", "diagram": "steps"}

NARRATION_CHARS_PER_SEC = 10  # Measured at speed 1.12 (~808 Thai chars -> ~78s)
SCRIPT_CHAR_TOLERANCE = 1.25  # Max ratio over character budget before repair/shorten
TTS_DURATION_TOLERANCE = 1.3  # Max ratio over durationSec (+ leadIn + holdEnd) before post-TTS shorten

DEFAULT_TTS_PROMPT = (
    "Narrate as a calm, charismatic, warm Thai documentary storyteller with a confident, smooth tone. "
    "Speak fluently at a crisp, engaging Thai narration pace (~14-15 syllables per second) with brief "
    "natural breaths between clauses and NO slow dragging or long dramatic pauses. "
    "Pronounce Thai and English terms cleanly and naturally."
)

CRASH_RE = re.compile(
    r"unexpected fault address|fatal error: (fault|unexpected signal)|SIGSEGV|SIGBUS|SIGILL|"
    r"segmentation (fault|violation)|oh no: Bun has crashed|panic\(main thread\)|"
    r"Segmentation fault at address|bun\.report/\d+\.\d+",
    re.I,
)

# Active child processes for clean SIGTERM termination
_active_procs: set[subprocess.Popen[Any]] = set()
_current_job_dir: Path | None = None
_aborted = False


class AbortedError(BaseException):
    """Raised when SIGTERM/SIGINT aborts the job so finally blocks still run."""


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def clamp(val: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, val))


def safe_slug(job_id: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "-", job_id.strip()) or "job"
    return f"studio_{cleaned}"


def make_watch_url(abs_path: str | Path) -> str:
    return f"{DASHBOARD_ORIGIN}/api/gemini/local-file?path={abs_path}"


def make_download_url(abs_path: str | Path) -> str:
    return f"{DASHBOARD_ORIGIN}/api/gemini/local-file?path={abs_path}&download=1"


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.tmp.{os.getpid()}"
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def append_log(job_dir: Path, message: str) -> None:
    job_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_path = job_dir / "log.txt"
    with log_path.open("a", encoding="utf-8") as f:
        for line in str(message).splitlines() or [""]:
            f.write(f"[{ts}] {line}\n")
        f.flush()


def write_status(job_dir: Path, **fields: Any) -> dict[str, Any]:
    """Atomically update <job_dir>/job.json with merged fields, updatedAt, pid, pgid."""
    job_path = job_dir / "job.json"
    current: dict[str, Any] = {}
    if job_path.exists():
        try:
            loaded = read_json(job_path, {})
            if isinstance(loaded, dict):
                current = loaded
        except Exception:
            current = {}

    now = now_iso()
    current.setdefault("id", job_dir.name)
    current.setdefault("createdAt", now)
    current.setdefault("versions", [])
    current.update(fields)
    current["updatedAt"] = now
    current["pid"] = os.getpid()
    try:
        current["pgid"] = os.getpgrp()
    except OSError:
        pass
    atomic_write_json(job_path, current)
    return current


def _kill_active_children() -> None:
    for proc in list(_active_procs):
        try:
            pgid = os.getpgid(proc.pid)
            os.killpg(pgid, signal.SIGTERM)
        except Exception:
            try:
                proc.terminate()
            except Exception:
                pass
    deadline = time.monotonic() + 2.0
    for proc in list(_active_procs):
        rem = max(0.0, deadline - time.monotonic())
        try:
            proc.wait(timeout=rem)
        except Exception:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        _active_procs.discard(proc)


def _handle_signal(signum: int, _frame: Any) -> None:
    global _aborted
    _aborted = True
    _kill_active_children()
    if _current_job_dir is not None:
        try:
            append_log(_current_job_dir, f"Received signal {signum}; aborting job.")
            write_status(
                _current_job_dir,
                status="aborted",
                stage="aborted",
                error="ถูกยกเลิกโดยผู้ใช้",
            )
        except Exception:
            pass
    raise AbortedError(f"Aborted by signal {signum}")


def _install_signal_handlers() -> None:
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)


@contextlib.contextmanager
def acquire_render_lock(job_dir: Path) -> Iterator[None]:
    """Serialize heavy render/build jobs using fcntl.flock on render.lock."""
    RENDER_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    lock_file = open(RENDER_LOCK_PATH, "a+", encoding="utf-8")
    acquired = False
    try:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except BlockingIOError:
            append_log(job_dir, "Another render is active; status=queued, waiting for render.lock...")
            write_status(
                job_dir,
                status="queued",
                stage="queued",
                message="รอคิวเรนเดอร์ (มีงานอื่นกำลังทำงาน)",
            )
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            acquired = True
            append_log(job_dir, "Acquired render.lock.")
        yield
    finally:
        if acquired:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
        try:
            lock_file.close()
        except OSError:
            pass


def _run_subprocess(
    cmd: list[str],
    *,
    cwd: str | Path | None = None,
    env: dict[str, str] | None = None,
    timeout: int | None = None,
) -> tuple[int, str, str]:
    """Run a subprocess in its own process group without shell=True, tracked for SIGTERM."""
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    _active_procs.add(proc)
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
        return proc.returncode, stdout, stderr
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            proc.terminate()
        try:
            proc.communicate(timeout=3)
        except Exception:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                proc.kill()
        raise TimeoutError(f"Command timed out after {timeout}s: {cmd[0]}")
    finally:
        _active_procs.discard(proc)


def _evict_page_cache(path: str) -> None:
    try:
        real = os.path.realpath(path)
        fd = os.open(real, os.O_RDONLY)
        try:
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
        finally:
            os.close(fd)
    except OSError:
        pass


def _list_agy_homes() -> list[str | None]:
    homes: list[str | None] = []
    if (Path("/home/dev") / MAIN_TOKEN_REL).exists():
        homes.append(None)
    if PROFILES_DIR.is_dir():
        for name in sorted(d for d in os.listdir(PROFILES_DIR) if not d.startswith(".")):
            p = PROFILES_DIR / name
            if (p / MAIN_TOKEN_REL).exists():
                homes.append(str(p))
    return homes or [None]


def run_agy(
    prompt: str,
    model: str = PRIMARY_MODEL,
    timeout: int = 180,
    home: str | None = None,
) -> str:
    """Invoke headless agy CLI following cron-ai-runner.py pattern."""
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
    env = {**os.environ, "HOME": home} if home else None
    rc, stdout, stderr = _run_subprocess(cmd, cwd="/home/dev/projects", env=env, timeout=timeout + 25)
    if rc != 0:
        err = (stderr or "").strip() or (stdout or "").strip() or f"agy exited with {rc}"
        if CRASH_RE.search(err):
            _evict_page_cache(AGY_BIN)
        raise RuntimeError(err)
    out = (stdout or "").strip()
    if not out:
        raise RuntimeError("agy returned empty output")
    return out


def run_agy_with_fallback(
    job_dir: Path,
    prompt: str,
    *,
    primary_model: str = PRIMARY_MODEL,
    fallback_model: str = FALLBACK_MODEL,
    timeout: int = 180,
) -> tuple[str, str]:
    """Try primary model then fallback model across available agy profiles."""
    homes = _list_agy_homes()
    attempts: list[tuple[str, str | None]] = []
    for h in homes:
        attempts.append((primary_model, h))
    for h in homes:
        if fallback_model and fallback_model != primary_model:
            attempts.append((fallback_model, h))

    errors: list[str] = []
    for model, home in attempts:
        acc_label = Path(home).name if home else "primary"
        append_log(job_dir, f"Calling agy model={model} account={acc_label} timeout={timeout}s")
        try:
            text = run_agy(prompt, model=model, timeout=timeout, home=home)
            return text, model
        except AbortedError:
            raise
        except Exception as exc:
            short_err = str(exc).splitlines()[-1][:200] if str(exc) else repr(exc)
            append_log(job_dir, f"agy failed (model={model}, account={acc_label}): {short_err}")
            errors.append(f"{model}@{acc_label}: {short_err}")
    raise RuntimeError("AI ไม่สามารถตอบกลับได้: " + " | ".join(errors[-2:]))


def load_style_presets() -> dict[str, Any]:
    """Load all 46 built-in presets + custom styles via studio_styles.py with JSON fallback."""
    try:
        if str(SCRIPTS_DIR) not in sys.path:
            sys.path.insert(0, str(SCRIPTS_DIR))
        from studio_styles import load_all_styles  # type: ignore

        styles = load_all_styles()
        if isinstance(styles, dict) and styles:
            return styles
    except Exception:
        pass

    merged: dict[str, Any] = {}
    for path, is_custom in ((PRESETS_PATH, False), (CUSTOM_STYLES_PATH, True)):
        data = read_json(path, {})
        if isinstance(data, dict):
            presets = data.get("presets") or {}
            if isinstance(presets, dict):
                for k, v in presets.items():
                    if isinstance(v, dict):
                        merged[k] = {**v, "isCustom": is_custom}
    return merged


def get_style_preset(style_id: str) -> dict[str, Any]:
    styles = load_style_presets()
    if style_id in styles:
        return styles[style_id]
    if "look-1" in styles:
        return styles["look-1"]
    if styles:
        return next(iter(styles.values()))
    return {
        "id": style_id or "look-1",
        "enName": "Glow World",
        "thName": "โลกเรืองแสง",
        "category": "ลุคช่อง YouTube",
        "summary": "ฉากอธิบายแนวคิดแบบเรืองแสง",
        "tokens": {
            "family": "glow-world",
            "palette": {
                "bg": "#0B0E1E",
                "bgSecondary": "#161B38",
                "fg": "#F4F7FF",
                "muted": "#9AA5CE",
                "accent": "#38BDF8",
                "accent2": "#818CF8",
                "cardBg": "#141933",
                "border": "#2A3466",
            },
            "typography": {
                "fontFamily": "Noto Sans Thai, Kanit, sans-serif",
                "titleWeight": 800,
                "subtitleStyle": "pill",
            },
            "motion": {
                "springDamping": 14,
                "springStiffness": 140,
                "transitionType": "spring",
                "parallaxStrength": 0.65,
                "glowIntensity": 0.75,
            },
            "background": {"pattern": "radial", "vignette": 0.45, "grain": 0.12},
            "promptHints": "เล่าเรื่องกระชับ ชัดเจน ทันสมัย",
        },
    }


def extract_json_object(text: str) -> dict[str, Any]:
    """Extract and parse the first valid JSON object from LLM text."""
    stripped = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", stripped, re.DOTALL)
    if fence:
        return json.loads(fence.group(1))
    first = stripped.find("{")
    last = stripped.rfind("}")
    if first != -1 and last > first:
        return json.loads(stripped[first : last + 1])
    return json.loads(stripped)


def count_narration_chars(script: Any) -> tuple[int, list[tuple[str, int]]]:
    """Count total and per-scene narration characters across all scenes."""
    if not isinstance(script, dict):
        return 0, []
    scenes = script.get("scenes")
    if not isinstance(scenes, list):
        return 0, []
    per_scene: list[tuple[str, int]] = []
    total = 0
    for idx, sc in enumerate(scenes):
        if not isinstance(sc, dict):
            continue
        sid = str(sc.get("id") or f"s{idx + 1}").strip()
        chars = len(str(sc.get("narration") or "").strip())
        per_scene.append((sid, chars))
        total += chars
    return total, per_scene


def check_script_length(script: Any, duration_sec: int) -> list[str]:
    """Check whether total narration characters exceed 1.25x of the Thai character budget."""
    if duration_sec <= 0 or not isinstance(script, dict):
        return []
    total_chars, per_scene = count_narration_chars(script)
    if not per_scene:
        return []
    budget_chars = max(1, int(round(duration_sec * NARRATION_CHARS_PER_SEC)))
    max_chars = int(round(budget_chars * SCRIPT_CHAR_TOLERANCE))
    if total_chars <= max_chars:
        return []
    cut_to_budget = total_chars - budget_chars
    cut_min = total_chars - max_chars
    per_scene_target = max(25, int(round(budget_chars / max(1, len(per_scene)))))
    scene_detail = ", ".join(f"{sid}={c}" for sid, c in per_scene)
    return [
        f"บทพากย์ (narration) ยาวเกินงบ: รวม {total_chars} ตัวอักษร "
        f"(งบเป้าหมาย {budget_chars} ตัวอักษร, เกณฑ์สูงสุด 1.25x = {max_chars} ตัวอักษร) "
        f"— ต้องตัดออก {cut_to_budget} ตัวอักษร (อย่างน้อยที่สุดต้องตัดออก {cut_min} ตัวอักษร) "
        f"ให้เหลือประมาณ {budget_chars} ตัวอักษร และห้ามเกิน {max_chars} ตัวอักษร "
        f"(เฉลี่ยซีนละ ~{per_scene_target} ตัวอักษร) พร้อมย่อ narrationPhonetic และ subtitles ให้สั้นลงตามไปด้วย "
        f"[รายซีนปัจจุบัน: {scene_detail}]"
    ]


def validate_script(script: Any, *, duration_sec: int | None = None) -> tuple[bool, list[str]]:
    errors: list[str] = []
    if not isinstance(script, dict):
        return False, ["script ต้องเป็น JSON object"]
    scenes = script.get("scenes")
    if not isinstance(scenes, list) or len(scenes) < 2:
        return False, ["scenes ต้องเป็น array ที่มีอย่างน้อย 2 ซีน"]
    seen_ids: set[str] = set()
    for idx, sc in enumerate(scenes):
        if not isinstance(sc, dict):
            errors.append(f"scenes[{idx}] ต้องเป็น object")
            continue
        sid = str(sc.get("id") or "").strip()
        if not sid:
            errors.append(f"scenes[{idx}] ขาด id")
        elif sid in seen_ids:
            errors.append(f"scenes[{idx}] มี id ซ้ำ: {sid}")
        else:
            seen_ids.add(sid)
        if not str(sc.get("narration") or "").strip():
            errors.append(f"scenes[{idx}] ({sid or '?'}) ขาด narration")
        if not str(sc.get("title") or "").strip():
            errors.append(f"scenes[{idx}] ({sid or '?'}) ขาด title")
    if duration_sec is not None and duration_sec > 0:
        errors.extend(check_script_length(script, duration_sec))
    return len(errors) == 0, errors


def normalize_script(
    script: dict[str, Any],
    request: dict[str, Any],
    preset: dict[str, Any],
) -> dict[str, Any]:
    """Ensure all required TTS + StudioScene fields exist with clean defaults."""
    topic = str(request.get("topic") or "วิดีโอสรุปความรู้").strip()
    voice = (
        str(request.get("voice") or "").strip()
        or str(preset.get("defaultVoice") or "").strip()
        or str(script.get("voice") or "").strip()
        or "gemini:Charon"
    )
    speed_raw = request.get("speed") if request.get("speed") is not None else script.get("speed", 1.12)
    try:
        speed = round(float(speed_raw), 2)
    except (TypeError, ValueError):
        speed = 1.12
    speed = max(0.85, min(1.4, speed))

    out: dict[str, Any] = {
        "title": str(script.get("title") or topic).strip(),
        "fps": int(script.get("fps") or 30),
        "width": int(script.get("width") or 1080),
        "height": int(script.get("height") or 1920),
        "voice": voice,
        "ttsModel": str(script.get("ttsModel") or "gemini-2.5-flash-preview-tts"),
        "ttsStyle": str(script.get("ttsStyle") or preset.get("defaultTtsStyle") or "storytelling"),
        "ttsPrompt": str(script.get("ttsPrompt") or preset.get("defaultTtsPrompt") or DEFAULT_TTS_PROMPT),
        "masterPreset": str(script.get("masterPreset") or "light"),
        "speed": speed,
        "leadInSec": float(script.get("leadInSec") if script.get("leadInSec") is not None else 0.35),
        "holdEndSec": float(script.get("holdEndSec") if script.get("holdEndSec") is not None else 1.4),
        "scenes": [],
    }

    raw_scenes = script.get("scenes") or []
    total = len(raw_scenes)
    for idx, sc in enumerate(raw_scenes):
        if not isinstance(sc, dict):
            continue
        sid = re.sub(r"[^a-zA-Z0-9_-]", "_", str(sc.get("id") or f"s{idx + 1}")).strip("_") or f"s{idx + 1}"
        narration = str(sc.get("narration") or "").strip()
        phonetic = str(sc.get("narrationPhonetic") or narration).strip()
        title = str(sc.get("title") or f"ซีนที่ {idx + 1}").strip()
        subtitle = str(sc.get("subtitle") or "").strip()
        badge = str(sc.get("badge") or ("HOOK" if idx == 0 else f"{idx:02d}")).strip()

        visual = str(sc.get("visual") or "").strip().lower()
        visual = VISUAL_ALIASES.get(visual, visual)
        if visual not in VALID_VISUALS:
            if idx == 0:
                visual = "title"
            elif idx == total - 1:
                visual = "quote" if sc.get("quote") else "title"
            else:
                visual = "bullets"

        pad_default = 1.4 if idx == total - 1 else 0.35
        try:
            pad_after = float(sc.get("padAfterSec") if sc.get("padAfterSec") is not None else pad_default)
        except (TypeError, ValueError):
            pad_after = pad_default

        clean_sfx = []
        for ev in sc.get("sfx") or []:
            if isinstance(ev, dict) and str(ev.get("name") or "") in VALID_SFX:
                clean_sfx.append(
                    {
                        "name": str(ev["name"]),
                        "offsetSec": float(ev.get("offsetSec", 0.15)),
                        "volume": float(ev.get("volume", 0.24)),
                    }
                )
        if not clean_sfx:
            clean_sfx = [{"name": "soft_impact" if idx == 0 else "pop", "offsetSec": 0.12, "volume": 0.22}]

        clean_subs = []
        for sb in sc.get("subtitles") or []:
            if isinstance(sb, dict) and str(sb.get("text") or "").strip():
                item: dict[str, Any] = {"text": str(sb["text"]).strip()}
                if sb.get("highlight"):
                    item["highlight"] = str(sb["highlight"]).strip()
                clean_subs.append(item)

        scene_obj: dict[str, Any] = {
            "id": sid,
            "badge": badge,
            "title": title,
            "subtitle": subtitle,
            "narration": narration,
            "narrationPhonetic": phonetic,
            "padAfterSec": pad_after,
            "visual": visual,
            "sfx": clean_sfx,
        }
        if clean_subs:
            scene_obj["subtitles"] = clean_subs
        for opt_key in ("bullets", "stat", "steps", "compare", "quote", "icon", "highlightWord", "highlight"):
            if sc.get(opt_key) not in (None, "", [], {}):
                val = sc[opt_key]
                if opt_key == "steps" and isinstance(val, list):
                    norm_steps = []
                    for st_i, item in enumerate(val, 1):
                        if isinstance(item, dict):
                            st_title = str(item.get("title") or item.get("label") or "").strip()
                            if st_title:
                                entry: dict[str, Any] = {"step": str(item.get("step") or f"{st_i:02d}"), "title": st_title}
                                if item.get("detail"):
                                    entry["detail"] = str(item["detail"]).strip()
                                norm_steps.append(entry)
                        elif isinstance(item, str) and item.strip():
                            norm_steps.append(item.strip())
                    val = norm_steps
                scene_obj[opt_key] = val
        if scene_obj.get("highlightWord") and not scene_obj.get("highlight"):
            scene_obj["highlight"] = scene_obj["highlightWord"]
        style_id = str(preset.get("id") or request.get("styleId") or "").strip().lower()
        direction = sanitize_direction(sc.get("direction"), style_id)
        if direction:
            scene_obj["direction"] = direction
        out["scenes"].append(scene_obj)
    return out


def build_research_prompt(topic: str, duration_sec: int, notes: str = "") -> str:
    extra = f"\nรายละเอียดเพิ่มเติมจากผู้ใช้: {notes}\n" if notes else ""
    return (
        f'ค้นหาข้อมูลล่าสุดจากเว็บเกี่ยวกับหัวข้อ: "{topic}"{extra}\n'
        f"สรุปเป็นรายงานข้อเท็จจริงภาษาไทยที่ถูกต้อง กระชับ และน่าสนใจสำหรับทำวิดีโออธิบายความยาวประมาณ {duration_sec} วินาที\n"
        "ให้จัดโครงสร้างเป็น Markdown ดังนี้:\n"
        "1. ประเด็นหลักและ Hook ที่น่าดึงดูด\n"
        "2. ข้อเท็จจริง กลไก หรือขั้นตอนสำคัญ (พร้อมตัวเลข/สถิติจริงถ้ามี)\n"
        "3. ข้อเปรียบเทียบหรือประเด็นสรุปที่คนดูจำได้ง่าย\n"
        "4. แหล่งอ้างอิง (ชื่อแหล่งและ URL ถ้ามี)\n"
        "ตอบเป็น Markdown ภาษาไทยโดยตรง ไม่ต้องอธิบายขั้นตอนการทำงานของคุณ"
    )


def build_script_prompt(
    topic: str,
    research_md: str,
    preset: dict[str, Any],
    duration_sec: int,
    scene_count: int,
    notes: str = "",
    retry_errors: list[str] | None = None,
    previous_output: str | None = None,
) -> str:
    tokens = preset.get("tokens") or {}
    family = tokens.get("family", "glow-world")
    prompt_hints = tokens.get("promptHints", "")
    style_desc = (
        f"{preset.get('thName', '')} ({preset.get('enName', '')}) "
        f"[หมวด: {preset.get('category', '')}, family: {family}] — {preset.get('summary', '')}"
    )
    total_chars = int(round(duration_sec * NARRATION_CHARS_PER_SEC))
    max_total_chars = int(round(total_chars * SCRIPT_CHAR_TOLERANCE))
    per_scene_chars = max(25, int(round(total_chars / max(1, scene_count))))
    max_per_scene_chars = max(per_scene_chars + 5, int(round(max_total_chars / max(1, scene_count))))
    extra = f"\nคำสั่งเพิ่มเติมจากผู้ใช้: {notes}\n" if notes else ""

    retry_block = ""
    if retry_errors:
        retry_block = (
            "\n⚠️ คำตอบรอบก่อนไม่ผ่านการตรวจสอบ กรุณาแก้ไขข้อผิดพลาดต่อไปนี้ทั้งหมด:\n"
            + "\n".join(f"- {e}" for e in retry_errors)
            + "\n"
        )
        if previous_output:
            retry_block += f"\nผลลัพธ์รอบก่อน:\n{previous_output[:16000]}\n"

    return (
        "คุณคือนักเขียนบทวิดีโอสั้นแนวตั้ง (9:16 1080x1920) มืออาชีพภาษาไทย\n"
        f'หัวข้อ: "{topic}"\n'
        f"สไตล์ภาพที่เลือก: {style_desc}\n"
        f"คำแนะนำสไตล์: {prompt_hints}\n"
        f"ความยาวเป้าหมาย: {duration_sec} วินาที | จำนวนซีนที่ต้องเขียน: {scene_count} ซีน\n"
        f"งบความยาวบทพากย์ (narration) — กฎเหล็กห้ามเกินเด็ดขาด:\n"
        f"- อัตราพูดจริงของ TTS ภาษาไทยที่ speed 1.12 อยู่ที่ประมาณ {NARRATION_CHARS_PER_SEC} ตัวอักษร/วินาที (วัดจริง ~808 ตัวอักษร = ~78 วินาที)\n"
        f"- เป้าหมาย narration รวมทุกซีน: ประมาณ {total_chars} ตัวอักษร (ขีดจำกัดสูงสุดเด็ดขาด: ห้ามเกิน {max_total_chars} ตัวอักษร — เกินถือว่าไม่ผ่าน)\n"
        f"- ความยาวต่อซีน: เฉลี่ยซีนละ ~{per_scene_chars} ตัวอักษร (ขีดจำกัดสูงสุดต่อซีน: ห้ามเกิน {max_per_scene_chars} ตัวอักษร หรือประมาณ 1-2 ประโยคสั้นกระชับ)\n"
        f"- เขียนให้สั้น คม กระชับ ไม่เกริ่นเยิ่นเย้อ และเขียน narrationPhonetic ให้สั้นกระชับใกล้เคียงกับ narration\n"
        f"{extra}"
        f"\n=== ข้อมูลจากการค้นคว้า (research.md) ===\n{research_md[:6000]}\n"
        f"{retry_block}\n"
        "=== กติการูปแบบ JSON ที่ต้องตอบ ===\n"
        "ตอบเป็น JSON object เดียวเท่านั้น (ใส่ใน ```json ... ``` ได้) ห้ามมีข้อความอธิบายอื่น โครงสร้าง:\n"
        "{\n"
        '  "title": "ชื่อคลิปภาษาไทยสั้นกระชับน่าคลิก",\n'
        '  "fps": 30,\n'
        '  "width": 1080,\n'
        '  "height": 1920,\n'
        '  "voice": "gemini:Charon",\n'
        '  "ttsModel": "gemini-2.5-flash-preview-tts",\n'
        '  "ttsStyle": "storytelling",\n'
        '  "ttsPrompt": "...",\n'
        '  "masterPreset": "light",\n'
        '  "speed": 1.12,\n'
        '  "leadInSec": 0.35,\n'
        '  "holdEndSec": 1.4,\n'
        '  "scenes": [\n'
        "    {\n"
        '      "id": "s1_hook",\n'
        '      "badge": "HOOK",\n'
        '      "title": "หัวข้อสั้น 3-7 คำ",\n'
        '      "subtitle": "คำขยายสั้นๆ",\n'
        '      "narration": "บทพากย์ภาษาไทยธรรมชาติ",\n'
        '      "narrationPhonetic": "บทพากย์ที่เขียนคำอ่านภาษาไทยให้ TTS อ่านชัด เช่น ซีพียู แรม เอไอ",\n'
        '      "padAfterSec": 0.35,\n'
        '      "visual": "title | bullets | stat | steps | compare | quote | icon",\n'
        '      "highlightWord": "คำเด่นในซีน",\n'
        '      "icon": "cpu | bolt | spark | chart | shield | globe | rocket | clock | brain | layers",\n'
        '      "bullets": ["ข้อ 1", "ข้อ 2", "ข้อ 3"],\n'
        '      "stat": {"value": "3.5B", "label": "รอบต่อวินาที", "unit": "Hz"},\n'
        '      "steps": [{"step": "01", "title": "ขั้นที่ 1", "detail": "รายละเอียดสั้น"}],\n'
        '      "compare": {"leftTitle": "แบบเก่า", "leftItems": ["..."], "rightTitle": "แบบใหม่", "rightItems": ["..."]},\n'
        '      "quote": {"text": "คำคมหรือข้อสรุปเด่น", "author": "แหล่งที่มา"},\n'
        '      "subtitles": [{"text": "ซับสั้นๆ 1 บรรทัด", "highlight": "คำเน้น"}],\n'
        '      "sfx": [{"name": "soft_impact", "offsetSec": 0.15, "volume": 0.24}]\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "ข้อกำหนดสำคัญ:\n"
        f"- ต้องมีซีนครบ {scene_count} ซีน id ไม่ซ้ำกัน (เช่น s1_hook, s2_..., ..., s{scene_count}_outro)\n"
        f"- [ขีดจำกัดความยาวบังคับ] ความยาว narration รวมทุกซีนต้องไม่เกิน {max_total_chars} ตัวอักษร (เป้าหมาย ~{total_chars} ตัวอักษร, ซีนละไม่เกิน {max_per_scene_chars} ตัวอักษร)\n"
        "- ทุกซีนต้องมี id, title, narration, visual ที่ไม่ว่าง และเลือกใส่ field ภาพ (bullets/stat/steps/compare/quote) ให้ตรงกับ visual ของซีนนั้นๆ อย่างหลากหลาย\n"
        "- ซีนแรกควรใช้ visual='title' ซีนสุดท้ายใช้ visual='quote' หรือ 'title' และ padAfterSec=1.4\n"
        f"- sfx.name ต้องเลือกจากรายการนี้เท่านั้น: {', '.join(VALID_SFX)}\n"
        "- ห้ามใส่เครื่องหมายพิเศษที่อ่านยากใน narrationPhonetic ให้ถอดคำทับศัพท์เป็นภาษาไทยที่อ่านออกเสียงถูกต้อง\n"
        + (
            build_direction_rules(scene_count, str(preset.get("id") or "").strip().lower())
            if (
                str(preset.get("id") or "").strip().lower() in ILLUSTRATED_STYLES
                or str(preset.get("id") or "").strip().lower() in STYLE_DIRECTOR_SHOTS
            )
            else ""
        )
    )


def build_direction_rules(scene_count: int, style_id: str | None = None) -> str:
    """Extra staging instructions for illustrated and style-directed styles."""
    sid = str(style_id or "").strip().lower()
    if sid in STYLE_DIRECTOR_SHOTS:
        shots_map = STYLE_DIRECTOR_SHOTS[sid]
        shot_ids = ", ".join(shots_map.keys())
        shot_desc = "\n".join(f"  - {k}: {v}" for k, v in shots_map.items())
        return (
            f"\n=== การกำกับช็อตประจำสไตล์ ({sid}) ===\n"
            "ทุกซีนต้องมี field \"direction\" เพื่อเลือกมุมภาพ/ช็อตที่เหมาะกับเนื้อหาซีนนั้น:\n"
            '"direction": {"shot": "...", "action": "อธิบายสั้นๆ ว่าซีนนี้เน้นภาพอะไร"}\n'
            f"- shot ต้องเลือกจากรายการนี้เท่านั้น: {shot_ids}\n"
            f"{shot_desc}\n"
            "- ห้ามใช้ช็อตเดียวกันกับซีนติดกัน\n"
            f"- ใน {scene_count} ซีนให้สลับใช้ช็อตอย่างหลากหลายตามข้อมูลของแต่ละซีน (ตัวเลข/เปรียบเทียบ/ขั้นตอน/สรุป)\n"
        )

    return (
        "\n=== การกำกับภาพ (สไตล์นี้วาดเป็นฉากการ์ตูนลายเส้นแยกทุกซีน) ===\n"
        "ทุกซีนต้องมี field \"direction\" เพื่อบอกว่าซีนนี้ต้องวาดอะไร ตัวละครทำอะไร มีของอะไรในฉาก:\n"
        '"direction": {"shot": "...", "mood": "...", "pose": "...", "cast": ["hero", ...], "props": ["...", "..."], "env": "indoor|outdoor", "action": "อธิบายสั้นๆ ว่าตัวละครกำลังทำอะไร"}\n'
        f"- shot (มุมกล้อง/ฉาก) เลือกจาก: {', '.join(DIRECTION_SHOTS)}\n"
        "  pov-desk=ตัวเอกนั่งโต๊ะหันหน้าเข้ากล้อง+โน้ตบนผนัง | interview=คนสองคนคุยกันข้ามโต๊ะ มีบอลลูนคำพูด | whiteboard=ตัวเอกยืนชี้กระดาน |"
        " closeup=หน้าตัวเอกเต็มจอ+ลูกโป่งความคิด | crowd=ฝูงคน 100 หัว ไฮไลต์บางคน (ใช้กับสถิติ X ใน 100 หรือ %) |"
        " split=ช่องการ์ตูนสองช่อง ผิด vs ถูก (ใช้กับ compare) | stairs=ตัวเอกเดินขึ้นบันไดทีละขั้น (ใช้กับ steps) |"
        " held-paper=มุมมองบุคคลที่หนึ่ง มือเราถือกระดาษที่มีรายการ | door=เปิดประตูเข้าห้อง (ฉากเปิด) | phone=มือเราถือมือถือ อ่านแชท\n"
        f"- mood เลือกจาก: {', '.join(DIRECTION_MOODS)} | pose เลือกจาก: {', '.join(DIRECTION_POSES)}\n"
        f"- cast เลือกจาก: {', '.join(DIRECTION_CAST)} | props (ของในฉาก 1-4 ชิ้นที่เล่าเรื่องได้) เลือกจาก: {', '.join(DIRECTION_PROPS)}\n"
        f"- ห้ามใช้ shot ซ้ำในซีนติดกัน และใน {scene_count} ซีนต้องใช้ shot ต่างกันอย่างน้อย {min(scene_count, 5)} แบบ\n"
        "- เลือก shot ให้เข้ากับข้อมูลของซีน: compare→split หรือ interview, steps→stairs, stat→crowd หรือ closeup, bullets→held-paper/whiteboard/pov-desk\n"
        "- อารมณ์ตัวละครต้องเปลี่ยนตามเรื่อง (เช่น ตกใจตอนเปิด กังวลตอนเจอปัญหา ดีใจตอนจบ)\n"
    )


def stage_draft(job_dir: Path) -> dict[str, Any]:
    """Run researching + scripting stages and produce validated script.json."""
    request = read_json(job_dir / "request.json")
    if not isinstance(request, dict) or not str(request.get("topic") or "").strip():
        raise ValueError("ไม่พบไฟล์ request.json หรือไม่ได้ระบุหัวข้อ (topic)")

    topic = str(request["topic"]).strip()
    style_id = str(request.get("styleId") or "look-1").strip()
    try:
        duration_sec = clamp(int(round(float(request.get("durationSec") or 30))), 12, 180)
    except (TypeError, ValueError):
        duration_sec = 30
    notes = str(request.get("notes") or "").strip()

    preset = get_style_preset(style_id)
    scene_count = clamp(round(duration_sec / 4.5), 3, 14)

    # (a) Researching
    append_log(job_dir, f"Stage draft: researching topic='{topic}' styleId='{style_id}' durationSec={duration_sec}")
    write_status(
        job_dir,
        status="researching",
        stage="researching",
        progress=5,
        topic=topic,
        styleId=style_id,
        durationSec=duration_sec,
        mode=str(request.get("mode") or "draft"),
        error=None,
    )

    research_prompt = build_research_prompt(topic, duration_sec, notes)
    research_md, research_model = run_agy_with_fallback(job_dir, research_prompt, timeout=180)
    (job_dir / "research.md").write_text(research_md + "\n", encoding="utf-8")
    append_log(job_dir, f"Research saved to research.md ({len(research_md)} chars, model={research_model})")

    # (b) Scripting
    write_status(job_dir, status="scripting", stage="scripting", progress=15, researchModel=research_model)
    script_prompt = build_script_prompt(topic, research_md, preset, duration_sec, scene_count, notes)
    raw_script_text, script_model = run_agy_with_fallback(job_dir, script_prompt, timeout=180)

    parsed: dict[str, Any] | None = None
    struct_ok = False
    val_errors: list[str] = []
    cur_chars = 0
    budget_chars = int(round(duration_sec * NARRATION_CHARS_PER_SEC))
    max_chars = int(round(budget_chars * SCRIPT_CHAR_TOLERANCE))
    try:
        parsed = extract_json_object(raw_script_text)
        struct_ok, struct_errors = validate_script(parsed)
        len_errors = check_script_length(parsed, duration_sec)
        cur_chars, _ = count_narration_chars(parsed)
        val_errors = [*struct_errors, *len_errors]
        ok = struct_ok and not len_errors
        append_log(
            job_dir,
            f"Draft script narration check: chars={cur_chars}, budget={budget_chars}, max={max_chars}, struct_ok={struct_ok}",
        )
    except Exception as exc:
        ok = False
        struct_ok = False
        val_errors = [f"JSON ไม่ถูกต้อง: {exc}"]

    # Single repair/shorten pass if structural validation or 1.25x character budget failed
    if not ok:
        only_length_issue = struct_ok and bool(val_errors)
        append_log(job_dir, f"Script validation/length check failed ({val_errors}); running 1 repair/shorten attempt...")
        write_status(
            job_dir,
            status="scripting",
            stage="scripting",
            progress=20,
            message="บทพากย์ยาวเกินงบ กำลังกระชับบทให้พอดีความยาว..." if only_length_issue else "กำลังปรับปรุงโครงสร้างบท...",
        )
        prev_for_repair = (
            json.dumps(parsed, ensure_ascii=False, indent=2) if parsed is not None else raw_script_text
        )
        repair_prompt = build_script_prompt(
            topic,
            research_md,
            preset,
            duration_sec,
            scene_count,
            notes,
            retry_errors=val_errors,
            previous_output=prev_for_repair,
        )
        repaired_text, script_model = run_agy_with_fallback(job_dir, repair_prompt, timeout=180)
        try:
            repaired_parsed = extract_json_object(repaired_text)
            rep_struct_ok, rep_struct_errs = validate_script(repaired_parsed)
        except Exception as exc:
            repaired_parsed = None
            rep_struct_ok = False
            rep_struct_errs = [f"JSON รอบซ่อมไม่ถูกต้อง: {exc}"]

        if rep_struct_ok and repaired_parsed is not None:
            rep_chars, _ = count_narration_chars(repaired_parsed)
            rep_len_errs = check_script_length(repaired_parsed, duration_sec)
            if only_length_issue and parsed is not None and rep_len_errs and rep_chars > cur_chars:
                append_log(
                    job_dir,
                    f"Shorten pass became longer ({cur_chars} -> {rep_chars} chars); keeping shorter round-1 draft.",
                )
            else:
                parsed = repaired_parsed
                if rep_len_errs:
                    append_log(
                        job_dir,
                        f"Warning: narration still exceeds 1.25x after repair ({rep_chars} chars vs max {max_chars}); "
                        "will verify actual duration after TTS.",
                    )
                else:
                    append_log(
                        job_dir,
                        f"Repair/shorten pass succeeded: narration chars {cur_chars} -> {rep_chars} (budget={budget_chars}).",
                    )
            ok = True
            val_errors = []
        elif only_length_issue and parsed is not None:
            append_log(
                job_dir,
                f"Shorten pass returned invalid JSON/structure ({rep_struct_errs}); keeping valid round-1 draft.",
            )
            ok = True
            val_errors = []
        else:
            ok = False
            val_errors = rep_struct_errs

    if not ok or parsed is None:
        raise RuntimeError(f"AI สร้างบทไม่ผ่านการตรวจสอบ: {'; '.join(val_errors)}")

    final_script = normalize_script(parsed, request, preset)
    atomic_write_json(job_dir / "script.json", final_script)
    append_log(job_dir, f"Script saved to script.json ({len(final_script['scenes'])} scenes, model={script_model})")

    write_status(
        job_dir,
        status="draft_ready",
        stage="draft_ready",
        progress=25,
        title=final_script["title"],
        sceneCount=len(final_script["scenes"]),
        scriptModel=script_model,
        message="ร่างบทเสร็จแล้ว พร้อมตรวจสอบหรือสั่งสร้างวิดีโอ",
    )
    return final_script


def compute_tts_hash(script: dict[str, Any]) -> str:
    """Hash narration + voice + speed + TTS-relevant fields to skip redundant TTS calls."""
    payload = {
        "voice": script.get("voice"),
        "speed": script.get("speed"),
        "ttsModel": script.get("ttsModel"),
        "ttsStyle": script.get("ttsStyle"),
        "ttsPrompt": script.get("ttsPrompt"),
        "masterPreset": script.get("masterPreset"),
        "leadInSec": script.get("leadInSec"),
        "holdEndSec": script.get("holdEndSec"),
        "fps": script.get("fps", 30),
        "scenes": [
            {
                "id": s.get("id"),
                "narration": s.get("narration"),
                "narrationPhonetic": s.get("narrationPhonetic"),
                "padAfterSec": s.get("padAfterSec"),
                "subtitles": s.get("subtitles"),
                "sfx": s.get("sfx"),
            }
            for s in (script.get("scenes") or [])
        ],
    }
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def run_tts_stage(job_dir: Path, script: dict[str, Any]) -> dict[str, Any]:
    """Run motion-studio tts with cache check via work/tts_hash.json."""
    work_dir = job_dir / "work"
    work_dir.mkdir(parents=True, exist_ok=True)
    timeline_path = work_dir / "timeline.json"
    hash_path = work_dir / "tts_hash.json"

    cur_hash = compute_tts_hash(script)
    cached = read_json(hash_path, {})
    if (
        isinstance(cached, dict)
        and cached.get("hash") == cur_hash
        and timeline_path.exists()
    ):
        tl = read_json(timeline_path, {})
        narration_path = Path(str(tl.get("narrationPath") or ""))
        if isinstance(tl, dict) and tl.get("scenes") and narration_path.exists():
            append_log(job_dir, f"TTS cache hit (hash={cur_hash[:12]}); skipping motion-studio tts.")
            write_status(job_dir, status="tts", stage="tts", progress=38, message="ใช้ไฟล์เสียงจากแคช")
            return tl

    write_status(job_dir, status="tts", stage="tts", progress=30, message="กำลังสร้างเสียงพากย์ภาษาไทย...")
    append_log(job_dir, f"Running motion-studio tts -> {work_dir}")
    cmd = [MOTION_STUDIO_BIN, "tts", str(job_dir / "script.json"), "-o", str(work_dir)]
    rc, stdout, stderr = _run_subprocess(cmd, cwd=BASE_DIR, timeout=600)
    if rc != 0:
        err = (stderr or stdout or f"tts exited {rc}").strip()
        append_log(job_dir, f"TTS error: {err}")
        raise RuntimeError(f"สร้างเสียงพากย์ไม่สำเร็จ: {err.splitlines()[-1][:200]}")

    if not timeline_path.exists():
        raise RuntimeError("ไม่พบไฟล์ work/timeline.json หลังรัน TTS")

    atomic_write_json(hash_path, {"hash": cur_hash, "updatedAt": now_iso()})
    tl = read_json(timeline_path)
    append_log(job_dir, f"TTS completed: totalSec={tl.get('totalSec')}, scenes={len(tl.get('scenes') or [])}")
    write_status(job_dir, status="tts", stage="tts", progress=38)
    return tl


def build_post_tts_shorten_prompt(
    script: dict[str, Any],
    timeline: dict[str, Any],
    target_duration_sec: int,
    max_allowed_sec: float,
) -> str:
    """Build a focused prompt to shorten only over-length narration scenes using measured TTS timing."""
    script_scenes = [s for s in (script.get("scenes") or []) if isinstance(s, dict)]
    tl_scenes = [s for s in (timeline.get("scenes") or []) if isinstance(s, dict)]
    tl_by_id = {str(s.get("id") or ""): s for s in tl_scenes}

    actual_total_sec = float(timeline.get("totalSec") or 0.0)
    actual_speech_total = sum(float(s.get("speechDurSec") or 0.0) for s in tl_scenes)
    overhead_sec = max(0.0, actual_total_sec - actual_speech_total)
    target_speech_sec = max(target_duration_sec * 0.72, target_duration_sec - overhead_sec)

    total_chars, _ = count_narration_chars(script)
    measured_cps = (total_chars / actual_speech_total) if actual_speech_total > 0.5 else float(NARRATION_CHARS_PER_SEC)
    measured_cps = max(5.0, min(18.0, measured_cps))

    # Never ask for more characters than the nominal durationSec * 10 budget
    target_total_chars = min(
        int(round(target_duration_sec * NARRATION_CHARS_PER_SEC)),
        max(60, int(round(target_speech_sec * measured_cps))),
    )
    scene_count = max(1, len(script_scenes))
    fair_scene_sec = target_speech_sec / scene_count

    # Identify scenes already short enough to stay verbatim (preserving per-scene TTS cache)
    scene_durs: list[tuple[dict[str, Any], float]] = []
    for idx, sc in enumerate(script_scenes):
        sid = str(sc.get("id") or f"s{idx + 1}")
        tl_sc = tl_by_id.get(sid) or (tl_scenes[idx] if idx < len(tl_scenes) else {})
        speech_dur = float(tl_sc.get("speechDurSec") or 0.0)
        scene_durs.append((sc, speech_dur))

    keep_ids: set[str] = set()
    kept_sec = 0.0
    candidate_keep = [(sc, d) for sc, d in scene_durs if 0.1 < d <= fair_scene_sec * 1.05]
    if 0 < len(candidate_keep) < scene_count:
        remaining_count = scene_count - len(candidate_keep)
        kept_sum = sum(d for _, d in candidate_keep)
        if (target_speech_sec - kept_sum) / remaining_count >= 2.0:
            keep_ids = {str(sc.get("id") or "") for sc, _ in candidate_keep}
            kept_sec = kept_sum

    shrink_count = max(1, scene_count - len(keep_ids))
    shrink_target_sec = max(2.0, (target_speech_sec - kept_sec) / shrink_count)
    shrink_target_chars = max(25, int(round(shrink_target_sec * measured_cps)))

    guidance_lines: list[str] = []
    compact_scenes: list[dict[str, Any]] = []
    for idx, (sc, speech_dur) in enumerate(scene_durs):
        sid = str(sc.get("id") or f"s{idx + 1}")
        narr = str(sc.get("narration") or "").strip()
        cur_len = len(narr)
        if sid in keep_ids:
            guidance_lines.append(
                f"- {sid}: เสียงจริง {speech_dur:.2f}s ({cur_len} ตัวอักษร) -> [คงเดิมห้ามแก้ เพื่อใช้แคชเสียง]"
            )
        else:
            cut_n = max(0, cur_len - shrink_target_chars)
            guidance_lines.append(
                f"- {sid}: เสียงจริง {speech_dur:.2f}s ({cur_len} ตัวอักษร) -> "
                f"[ต้องย่อให้เหลือไม่เกิน ~{shrink_target_chars} ตัวอักษร (ตัดออก ~{cut_n} ตัวอักษร)]"
            )
        compact_scenes.append(
            {
                "id": sid,
                "title": str(sc.get("title") or ""),
                "narration": narr,
                "narrationPhonetic": str(sc.get("narrationPhonetic") or narr).strip(),
                "subtitles": sc.get("subtitles") or [],
            }
        )

    total_cut = max(1, total_chars - target_total_chars)
    return (
        "คุณคือบรรณาธิการบทพากย์วิดีโอสั้นภาษาไทยที่ต้องย่อบทพากย์ให้พอดีเวลาเสียงจริง\n"
        f"เวลาเสียงพากย์หลังรัน TTS จริง: {actual_total_sec:.2f} วินาที "
        f"(เกินเกณฑ์สูงสุด {max_allowed_sec:.2f} วินาที | เป้าหมายคลิป: {target_duration_sec} วินาที)\n"
        f"อัตราพูดจริงที่วัดได้: ~{measured_cps:.1f} ตัวอักษร/วินาที\n"
        f"ปัจจุบันรวม {total_chars} ตัวอักษร -> ต้องย่อรวมลงอย่างน้อย {total_cut} ตัวอักษร "
        f"ให้รวมทุกซีนเหลือไม่เกิน ~{target_total_chars} ตัวอักษร\n\n"
        "คำสั่งรายซีน:\n"
        + "\n".join(guidance_lines)
        + "\n\nบทพากย์ปัจจุบัน (JSON):\n"
        + json.dumps({"scenes": compact_scenes}, ensure_ascii=False, indent=2)
        + "\n\nกติกาตอบกลับ:\n"
        "- ตอบเป็น JSON object เดียวเท่านั้นในรูปแบบ:\n"
        '  {"scenes": [{"id": "...", "narration": "...", "narrationPhonetic": "...", "subtitles": [{"text": "...", "highlight": "..."}]}]}\n'
        "- คงลำดับและ id ของทุกซีนให้ครบเหมือนเดิมทุกตัว\n"
        "- ซีนที่ระบุว่า [คงเดิมห้ามแก้] ให้คัดลอก narration และ narrationPhonetic เดิมเป๊ะๆ ห้ามเปลี่ยนแม้แต่ตัวอักษรเดียว\n"
        "- ซีนที่ระบุว่า [ต้องย่อ] ให้เขียนใหม่ให้กระชับ คงใจความสำคัญ ภาษาไทยธรรมชาติ ตามจำนวนตัวอักษรเป้าหมาย พร้อมแก้ narrationPhonetic และ subtitles ให้ตรงกับบทใหม่\n"
        "- ห้ามใส่ข้อความอธิบายอื่นนอกจาก JSON\n"
    )


def maybe_shorten_after_tts(
    job_dir: Path,
    script: dict[str, Any],
    timeline: dict[str, Any],
    request: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """If measured TTS timeline exceeds durationSec*1.3 + leadIn + holdEnd, ask AI once to shorten and re-run TTS."""
    timeline_path = job_dir / "work" / "timeline.json"
    tl_disk = read_json(timeline_path, None)
    if isinstance(tl_disk, dict) and tl_disk.get("totalSec") is not None:
        timeline = tl_disk

    dur_raw = request.get("durationSec")
    if dur_raw is None:
        job_meta = read_json(job_dir / "job.json", {}) or {}
        dur_raw = job_meta.get("durationSec")
    try:
        target_duration_sec = clamp(int(round(float(dur_raw))), 12, 180) if dur_raw is not None else 0
    except (TypeError, ValueError):
        target_duration_sec = 0

    if target_duration_sec <= 0:
        return script, timeline

    actual_total_sec = float(timeline.get("totalSec") or 0.0)
    lead_in = float(script.get("leadInSec") if script.get("leadInSec") is not None else 0.35)
    hold_end = float(script.get("holdEndSec") if script.get("holdEndSec") is not None else 1.4)
    max_allowed_sec = target_duration_sec * TTS_DURATION_TOLERANCE + lead_in + hold_end

    append_log(
        job_dir,
        f"Post-TTS duration check: actual={actual_total_sec:.2f}s vs limit={max_allowed_sec:.2f}s "
        f"(target={target_duration_sec}s * {TTS_DURATION_TOLERANCE} + leadIn={lead_in:.2f}s + holdEnd={hold_end:.2f}s)",
    )
    if actual_total_sec <= max_allowed_sec:
        return script, timeline

    old_chars, _ = count_narration_chars(script)
    append_log(
        job_dir,
        f"TTS duration exceeded limit ({actual_total_sec:.2f}s > {max_allowed_sec:.2f}s, {old_chars} chars); "
        "requesting 1-shot AI narration shortening and cached TTS re-run...",
    )
    write_status(
        job_dir,
        status="tts",
        stage="tts",
        progress=34,
        message=f"เสียงพากย์ยาวเกินกำหนด ({actual_total_sec:.1f}s > {max_allowed_sec:.1f}s) กำลังกระชับบทและสร้างเสียงใหม่...",
    )

    try:
        shorten_prompt = build_post_tts_shorten_prompt(script, timeline, target_duration_sec, max_allowed_sec)
        raw_text, used_model = run_agy_with_fallback(job_dir, shorten_prompt, timeout=180)
        parsed = extract_json_object(raw_text)
        upd_scenes_raw = parsed.get("scenes") if isinstance(parsed, dict) else None
        if not isinstance(upd_scenes_raw, list) or not upd_scenes_raw:
            append_log(job_dir, f"Post-TTS shorten warning: AI ({used_model}) returned no scenes; keeping current TTS.")
            return script, timeline
    except AbortedError:
        raise
    except Exception as exc:
        append_log(job_dir, f"Post-TTS shorten failed (non-fatal): {exc}; proceeding with existing TTS audio.")
        return script, timeline

    upd_by_id: dict[str, dict[str, Any]] = {}
    for item in upd_scenes_raw:
        if isinstance(item, dict) and str(item.get("id") or "").strip():
            upd_by_id[str(item["id"]).strip()] = item

    updated_script = json.loads(json.dumps(script, ensure_ascii=False))
    changed_ids: list[str] = []
    unchanged_ids: list[str] = []

    for idx, sc in enumerate(updated_script.get("scenes") or []):
        if not isinstance(sc, dict):
            continue
        sid = str(sc.get("id") or f"s{idx + 1}").strip()
        upd = upd_by_id.get(sid)
        if upd is None and len(upd_scenes_raw) == len(updated_script["scenes"]) and isinstance(upd_scenes_raw[idx], dict):
            upd = upd_scenes_raw[idx]
        if not isinstance(upd, dict):
            unchanged_ids.append(sid)
            continue

        old_narr = str(sc.get("narration") or "").strip()
        old_phon = str(sc.get("narrationPhonetic") or old_narr).strip()
        new_narr = str(upd.get("narration") or "").strip()
        if not new_narr or new_narr == old_narr:
            unchanged_ids.append(sid)
            continue

        sc["narration"] = new_narr
        new_phon = str(upd.get("narrationPhonetic") or "").strip()
        if new_phon and new_phon != old_phon and len(new_phon) <= max(int(len(new_narr) * 1.45) + 20, 40):
            sc["narrationPhonetic"] = new_phon
        else:
            sc["narrationPhonetic"] = new_narr

        clean_subs = []
        for sb in upd.get("subtitles") or []:
            if isinstance(sb, dict) and str(sb.get("text") or "").strip():
                entry: dict[str, Any] = {"text": str(sb["text"]).strip()}
                if sb.get("highlight"):
                    entry["highlight"] = str(sb["highlight"]).strip()
                clean_subs.append(entry)
        if clean_subs:
            sc["subtitles"] = clean_subs
        elif sc.get("subtitles"):
            fallback_sub: dict[str, Any] = {"text": new_narr}
            if sc.get("highlight"):
                fallback_sub["highlight"] = str(sc["highlight"])
            sc["subtitles"] = [fallback_sub]

        changed_ids.append(sid)

    new_chars, _ = count_narration_chars(updated_script)
    if not changed_ids or new_chars >= old_chars:
        append_log(
            job_dir,
            f"Post-TTS shorten did not reduce length (chars {old_chars} -> {new_chars}, changed={changed_ids}); "
            "keeping original script and TTS.",
        )
        return script, timeline

    atomic_write_json(job_dir / "script.json", updated_script)
    append_log(
        job_dir,
        f"Post-TTS shorten applied (model={used_model}): chars {old_chars} -> {new_chars}, "
        f"changed={changed_ids}, cached={unchanged_ids}; re-running TTS...",
    )
    new_timeline = run_tts_stage(job_dir, updated_script)
    new_total_sec = float(new_timeline.get("totalSec") or 0.0)
    append_log(
        job_dir,
        f"Post-TTS re-run completed: totalSec {actual_total_sec:.2f}s -> {new_total_sec:.2f}s "
        f"(target={target_duration_sec}s, limit={max_allowed_sec:.2f}s)",
    )
    return updated_script, new_timeline


def build_props(
    job_dir: Path,
    script: dict[str, Any],
    timeline: dict[str, Any],
    request: dict[str, Any],
) -> Path:
    """Merge timeline.json (frames/cues) with script.json visual fields + style tokens."""
    style_id = str(request.get("styleId") or "look-1").strip()
    preset = get_style_preset(style_id)
    tokens = preset.get("tokens") or {}

    script_scenes = script.get("scenes") or []
    by_id: dict[str, dict[str, Any]] = {
        str(s.get("id")): s for s in script_scenes if isinstance(s, dict) and s.get("id")
    }

    merged_scenes: list[dict[str, Any]] = []
    tl_scenes = timeline.get("scenes") or []
    for idx, tl_sc in enumerate(tl_scenes):
        sid = str(tl_sc.get("id") or "")
        sc_src = by_id.get(sid) or (script_scenes[idx] if idx < len(script_scenes) else {})
        merged = {**sc_src, **tl_sc}
        # Prefer script.json editorial text & visual fields in case user edited them without changing narration
        for k in (
            "badge",
            "title",
            "subtitle",
            "visual",
            "bullets",
            "stat",
            "steps",
            "compare",
            "quote",
            "icon",
            "highlightWord",
            "highlight",
            "direction",
        ):
            if k in sc_src and sc_src[k] is not None:
                merged[k] = sc_src[k]
        if isinstance(merged.get("visual"), str):
            merged["visual"] = VISUAL_ALIASES.get(merged["visual"].lower(), merged["visual"].lower())
        if merged.get("highlightWord") and not merged.get("highlight"):
            merged["highlight"] = merged["highlightWord"]
        if isinstance(merged.get("steps"), list):
            merged["steps"] = [
                {
                    "step": str(it.get("step") or f"{i:02d}"),
                    "title": str(it.get("title") or it.get("label") or ""),
                    **({"detail": str(it["detail"])} if it.get("detail") else {}),
                }
                if isinstance(it, dict)
                else it
                for i, it in enumerate(merged["steps"], 1)
            ]
        merged_scenes.append(merged)

    fps = int(timeline.get("fps") or script.get("fps") or 30)
    total_sec = float(timeline.get("totalSec") or 20.0)
    total_frames = int(timeline.get("totalFrames") or max(90, round(total_sec * fps)))

    props = {
        "title": str(script.get("title") or timeline.get("title") or ""),
        "fps": fps,
        "width": int(timeline.get("width") or script.get("width") or 1080),
        "height": int(timeline.get("height") or script.get("height") or 1920),
        "totalSec": total_sec,
        "totalFrames": total_frames,
        "styleId": style_id,
        "styleName": preset.get("thName") or preset.get("enName") or style_id,
        "tokens": tokens,
        "style": tokens,
        "scenes": merged_scenes,
        "cues": timeline.get("cues") or [],
    }
    props_path = job_dir / "props.json"
    atomic_write_json(props_path, props)
    append_log(job_dir, f"Built props.json: totalFrames={total_frames} fps={fps} scenes={len(merged_scenes)} style={style_id}")
    return props_path


def run_render_stage(job_dir: Path, props_path: Path, out_mp4: Path) -> None:
    """Run motion-studio render StudioEngine and stream % progress (40..85)."""
    write_status(job_dir, status="rendering", stage="rendering", progress=40, message="กำลังเรนเดอร์วิดีโอ...")
    cmd = [
        MOTION_STUDIO_BIN,
        "render",
        "StudioEngine",
        "-o",
        str(out_mp4),
        "--props",
        str(props_path),
        "--concurrency",
        "2",
    ]
    append_log(job_dir, f"Running render: {' '.join(cmd)}")
    proc = subprocess.Popen(
        cmd,
        cwd=str(BASE_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        start_new_session=True,
    )
    _active_procs.add(proc)
    last_progress = 40
    last_write_ts = time.monotonic()
    tail_lines: list[str] = []
    pct_re = re.compile(r"(\d{1,3})%")
    frac_re = re.compile(r"Rendered\s+(\d+)\s*/\s*(\d+)", re.I)

    try:
        assert proc.stdout is not None
        buf = ""
        while True:
            ch = proc.stdout.read(1)
            if not ch:
                break
            if ch in ("\r", "\n"):
                line = buf.strip()
                buf = ""
                if not line:
                    continue
                tail_lines.append(line)
                if len(tail_lines) > 40:
                    tail_lines.pop(0)

                pct: float | None = None
                m_frac = frac_re.search(line)
                if m_frac:
                    cur, tot = int(m_frac.group(1)), max(1, int(m_frac.group(2)))
                    pct = min(100.0, (cur / tot) * 100.0)
                else:
                    m_pct = pct_re.findall(line)
                    if m_pct:
                        val = int(m_pct[-1])
                        if 0 <= val <= 100:
                            pct = float(val)

                if pct is not None:
                    mapped = 40 + int(round(pct * 0.45))
                    mapped = clamp(mapped, 40, 85)
                    now_t = time.monotonic()
                    if mapped >= last_progress + 2 or (mapped > last_progress and now_t - last_write_ts >= 1.5):
                        last_progress = mapped
                        last_write_ts = now_t
                        write_status(
                            job_dir,
                            status="rendering",
                            stage="rendering",
                            progress=mapped,
                            message=f"กำลังเรนเดอร์วิดีโอ ({int(round(pct))}%)",
                        )
            else:
                buf += ch

        rc = proc.wait()
    finally:
        _active_procs.discard(proc)

    if rc != 0 or not out_mp4.exists():
        err_tail = " | ".join(tail_lines[-5:]) if tail_lines else f"render exited {rc}"
        append_log(job_dir, f"Render failed (rc={rc}): {err_tail}")
        raise RuntimeError(f"เรนเดอร์วิดีโอไม่สำเร็จ: {err_tail[:240]}")
    write_status(job_dir, status="rendering", stage="rendering", progress=85)
    append_log(job_dir, f"Render finished: {out_mp4} ({out_mp4.stat().st_size} bytes)")


def run_mix_stage(
    job_dir: Path,
    render_mp4: Path,
    timeline_path: Path,
    final_mp4: Path,
    bgm: str,
) -> None:
    write_status(job_dir, status="mixing", stage="mixing", progress=87, message="กำลังผสมเสียงพากย์ ดนตรี และเอฟเฟกต์...")
    if bgm not in VALID_BGMS and not Path(bgm).exists():
        bgm = "warm_tech"
    cmd = [
        MOTION_STUDIO_BIN,
        "mix",
        str(render_mp4),
        str(timeline_path),
        "-o",
        str(final_mp4),
        "--bgm",
        bgm,
    ]
    append_log(job_dir, f"Running mix: bgm={bgm}")
    rc, stdout, stderr = _run_subprocess(cmd, cwd=BASE_DIR, timeout=300)
    if rc != 0 or not final_mp4.exists():
        err = (stderr or stdout or f"mix exited {rc}").strip()
        append_log(job_dir, f"Mix failed: {err}")
        raise RuntimeError(f"ผสมเสียงไม่สำเร็จ: {err.splitlines()[-1][:200]}")
    write_status(job_dir, status="mixing", stage="mixing", progress=90)
    append_log(job_dir, f"Mix finished: {final_mp4} ({final_mp4.stat().st_size} bytes)")


def run_preview_stage(job_dir: Path, video_mp4: Path, timeline_path: Path | None) -> dict[str, str]:
    write_status(job_dir, status="preview", stage="preview", progress=92, message="กำลังสร้างภาพตัวอย่างและ Storyboard...")
    preview_dir = job_dir / "preview"
    preview_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        MOTION_STUDIO_BIN,
        "preview",
        str(video_mp4),
        "-o",
        str(preview_dir),
        "--prefix",
        "preview",
    ]
    if timeline_path and timeline_path.exists():
        cmd.extend(["--timeline", str(timeline_path)])
    rc, stdout, stderr = _run_subprocess(cmd, cwd=BASE_DIR, timeout=180)
    if rc != 0:
        err = (stderr or stdout or f"preview exited {rc}").strip()
        append_log(job_dir, f"Preview warning (non-fatal): {err}")
        return {}
    sb = preview_dir / "preview_storyboard.png"
    gif = preview_dir / "preview_preview.gif"
    res: dict[str, str] = {}
    if sb.exists():
        res["storyboardFile"] = "preview/preview_storyboard.png"
        res["storyboardPath"] = str(sb)
    if gif.exists():
        res["gifFile"] = "preview/preview_preview.gif"
        res["gifPath"] = str(gif)
    append_log(job_dir, f"Preview generated: {list(res.keys())}")
    return res


def probe_duration(video_path: Path) -> float:
    rc, stdout, _stderr = _run_subprocess(
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
        timeout=30,
    )
    if rc == 0:
        try:
            return round(float(stdout.strip()), 3)
        except ValueError:
            pass
    return 0.0


def copy_to_videos_dir(src_mp4: Path, dest_name: str) -> Path:
    OUTPUT_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    dest = OUTPUT_VIDEOS_DIR / dest_name
    tmp = OUTPUT_VIDEOS_DIR / f".{dest_name}.tmp.{os.getpid()}"
    shutil.copy2(src_mp4, tmp)
    os.replace(tmp, dest)
    return dest


def copy_preview_to_videos_dir(
    job_dir: Path,
    preview_info: dict[str, str],
    stem: str,
) -> dict[str, str]:
    """Copy preview storyboard PNG and preview GIF to OUTPUT_VIDEOS_DIR as <stem>_storyboard.png / <stem>_preview.gif."""
    copied: dict[str, str] = {}
    sb_raw = preview_info.get("storyboardPath")
    if sb_raw:
        sb_src = Path(sb_raw)
        if sb_src.exists():
            sb_dest = copy_to_videos_dir(sb_src, f"{stem}_storyboard.png")
            copied["storyboardOutPath"] = str(sb_dest)
            append_log(job_dir, f"Copied storyboard to {sb_dest}")
    gif_raw = preview_info.get("gifPath")
    if gif_raw:
        gif_src = Path(gif_raw)
        if gif_src.exists():
            gif_dest = copy_to_videos_dir(gif_src, f"{stem}_preview.gif")
            copied["gifOutPath"] = str(gif_dest)
            append_log(job_dir, f"Copied preview GIF to {gif_dest}")
    return copied


def maybe_send_telegram(job_dir: Path, video_path: Path, caption: str, enabled: bool) -> tuple[bool, str | None]:
    if not enabled:
        return False, None
    write_status(job_dir, status="delivering", stage="delivering", progress=97, message="กำลังส่งวิดีโอเข้า Telegram...")
    cmd = [MOTION_STUDIO_BIN, "send-telegram", str(video_path), caption]
    append_log(job_dir, f"Sending video to Telegram: {video_path.name}")
    rc, stdout, stderr = _run_subprocess(cmd, cwd=BASE_DIR, timeout=240)
    if rc != 0:
        err = (stderr or stdout or f"send-telegram exited {rc}").strip()
        append_log(job_dir, f"Telegram send failed (non-fatal): {err}")
        return False, err.splitlines()[-1][:200]
    append_log(job_dir, "Telegram delivery succeeded.")
    return True, None


def _next_version_number(job_dir: Path) -> int:
    job = read_json(job_dir / "job.json", {}) or {}
    versions = job.get("versions") if isinstance(job, dict) else []
    max_v = 1 if (job_dir / "final.mp4").exists() else 0
    if isinstance(versions, list):
        for v in versions:
            if isinstance(v, dict):
                try:
                    max_v = max(max_v, int(v.get("version", 0)))
                except (TypeError, ValueError):
                    pass
    return max_v + 1


def _latest_video_path(job_dir: Path) -> Path:
    job = read_json(job_dir / "job.json", {}) or {}
    versions = job.get("versions") if isinstance(job, dict) else []
    if isinstance(versions, list) and versions:
        last = versions[-1]
        if isinstance(last, dict) and last.get("file"):
            cand = job_dir / str(last["file"])
            if cand.exists():
                return cand
    cand = job_dir / "final.mp4"
    if cand.exists():
        return cand
    raise FileNotFoundError("ไม่พบไฟล์วิดีโอต้นฉบับ (final.mp4) กรุณาสร้างวิดีโอก่อนตัดต่อ")


def stage_build(job_dir: Path, *, as_new_version: bool = False, edit_scene_id: str | None = None) -> dict[str, Any]:
    """Run build pipeline (or edit-scene rebuild as final_v{N}.mp4)."""
    request = read_json(job_dir / "request.json", {}) or {}
    script = read_json(job_dir / "script.json")
    if not isinstance(script, dict):
        raise FileNotFoundError("ไม่พบไฟล์ script.json กรุณาร่างบทก่อนสั่งสร้างวิดีโอ")
    ok, errs = validate_script(script)
    if not ok:
        raise ValueError(f"ไฟล์ script.json ไม่ถูกต้อง: {'; '.join(errs)}")

    style_id = str(request.get("styleId") or "look-1").strip()
    preset = get_style_preset(style_id)
    bgm = str(request.get("bgm") or preset.get("defaultBgm") or "warm_tech").strip()
    slug = safe_slug(job_dir.name)
    title = str(script.get("title") or request.get("topic") or job_dir.name)

    with acquire_render_lock(job_dir):
        ledger_start = credit_ledger.count_ledger_lines()
        timeline = run_tts_stage(job_dir, script)
        if not as_new_version:
            script, timeline = maybe_shorten_after_tts(job_dir, script, timeline, request)
        timeline_path = job_dir / "work" / "timeline.json"
        props_path = build_props(job_dir, script, timeline, request)

        delta = credit_ledger.summarize_ledger_slice(ledger_start)
        credit_summary = credit_ledger.get_credit_summary()
        tl_cost = timeline.get("ttsCost") if isinstance(timeline, dict) and isinstance(timeline.get("ttsCost"), dict) else {}
        voice_name = str(script.get("voice") or timeline.get("voice") or "")
        cost_thb = round(float(delta.get("costThb") or 0.0), 2)
        cost_usd = round(float(delta.get("costUsd") or 0.0), 4)
        clip_total_thb = round(float(tl_cost.get("clipTotalThb") if tl_cost.get("clipTotalThb") is not None else cost_thb), 2)
        rem_thb = credit_summary.get("remainingThb") if credit_summary.get("ok") else None
        low_thb = float(credit_summary.get("lowThb") if credit_summary.get("lowThb") is not None else 10.0)
        is_low_credit = bool(credit_summary.get("isLow")) if credit_summary.get("ok") else False

        if delta.get("calls", 0) > 0 and credit_summary.get("ok"):
            alert_res = credit_ledger.maybe_send_low_credit_alert(credit_summary, source=f"video-studio:{job_dir.name}")
            if alert_res.get("alerted"):
                append_log(job_dir, f"Low Gemini credit Telegram alert sent (remaining=฿{rem_thb:.2f} < ฿{low_thb:.0f})")

        cost_details = {
            "costThb": cost_thb,
            "costUsd": cost_usd,
            "clipTotalThb": clip_total_thb,
            "apiCalls": int(delta.get("calls") or 0),
            "cachedScenes": int(tl_cost.get("cachedScenes") or 0),
            "inputTokens": int(delta.get("inputTokens") or 0),
            "outputTokens": int(delta.get("outputTokens") or 0),
            "thoughtsTokens": int(delta.get("thoughtsTokens") or 0),
            "voice": voice_name,
            "engine": str(tl_cost.get("engine") or ("gemini" if voice_name.startswith("gemini:") else "edge-tts")),
            "remainingThb": rem_thb,
            "lowThb": low_thb,
            "isLowCredit": is_low_credit,
        }
        append_log(
            job_dir,
            f"TTS cost: this_build=฿{cost_thb:.2f} (${cost_usd:.4f}, calls={cost_details['apiCalls']}), "
            f"clip_total=฿{clip_total_thb:.2f}, remaining=~฿{rem_thb if rem_thb is not None else '?'}",
        )

        if as_new_version and (job_dir / "final.mp4").exists():
            ver = _next_version_number(job_dir)
            render_mp4 = job_dir / f"render_v{ver}.mp4"
            final_mp4 = job_dir / f"final_v{ver}.mp4"
            dest_name = f"{slug}_v{ver}.mp4"
            kind = f"edit-scene:{edit_scene_id}" if edit_scene_id else "edit-scene"
        else:
            ver = 1
            render_mp4 = job_dir / "render.mp4"
            final_mp4 = job_dir / "final.mp4"
            dest_name = f"{slug}.mp4"
            kind = "build"

        run_render_stage(job_dir, props_path, render_mp4)
        run_mix_stage(job_dir, render_mp4, timeline_path, final_mp4, bgm)
        preview_info = run_preview_stage(job_dir, final_mp4, timeline_path)
        preview_out = copy_preview_to_videos_dir(job_dir, preview_info, Path(dest_name).stem)

        master_copy = copy_to_videos_dir(final_mp4, dest_name)
        append_log(job_dir, f"Copied master video to {master_copy}")

        send_tg = bool(request.get("sendTelegram", True)) and not as_new_version
        if cost_thb > 0:
            cost_line = f"💸 ค่าเสียงพากย์คลิปนี้: ฿{cost_thb:.2f}"
        elif voice_name.startswith("gemini:") and clip_total_thb > 0:
            cost_line = f"💸 ค่าเสียงรอบนี้: ฿0.00 (แคช · รวมทั้งคลิป ฿{clip_total_thb:.2f})"
        else:
            cost_line = "💸 ค่าเสียงพากย์คลิปนี้: ฿0.00 (ฟรี)"
        rem_line = f" · เครดิตคงเหลือ ~฿{rem_thb:.2f}" if rem_thb is not None else ""
        low_line = f"\n⚠️ เครดิต Gemini API ใกล้หมด (ต่ำกว่า ฿{low_thb:.0f})!" if is_low_credit else ""
        tg_caption = f"{title}\n{cost_line}{rem_line}{low_line}"
        tg_ok, tg_err = maybe_send_telegram(job_dir, master_copy, tg_caption, send_tg)

        dur = probe_duration(final_mp4) or float(timeline.get("totalSec") or 0.0)
        size_bytes = master_copy.stat().st_size

        outputs: dict[str, Any] = {
            "videoPath": str(master_copy),
            "jobVideoFile": final_mp4.name,
            "watchUrl": make_watch_url(master_copy),
            "downloadUrl": make_download_url(master_copy),
            "durationSec": dur,
            "sizeBytes": size_bytes,
            "telegramSent": tg_ok,
            "costThb": cost_thb,
            "costUsd": cost_usd,
            "costDetails": cost_details,
            **preview_info,
            **preview_out,
        }
        if tg_err:
            outputs["telegramError"] = tg_err

        job = read_json(job_dir / "job.json", {}) or {}
        versions = list(job.get("versions") or [])
        version_entry: dict[str, Any] = {
            "version": ver,
            "kind": kind,
            "file": final_mp4.name,
            "videoPath": str(master_copy),
            "watchUrl": make_watch_url(master_copy),
            "downloadUrl": make_download_url(master_copy),
            "durationSec": dur,
            "sizeBytes": size_bytes,
            "costThb": cost_thb,
            "costUsd": cost_usd,
            "costDetails": cost_details,
            "createdAt": now_iso(),
            **preview_out,
        }
        if ver == 1:
            versions = [v for v in versions if v.get("version") != 1]
            versions.insert(0, version_entry)
        else:
            versions.append(version_entry)

        done_msg = f"สร้างวิดีโอเสร็จสมบูรณ์ · ค่าใช้จ่าย ฿{cost_thb:.2f}"
        if rem_thb is not None:
            done_msg += f" (คงเหลือ ~฿{rem_thb:.2f})"
        return write_status(
            job_dir,
            status="done",
            stage="done",
            progress=100,
            title=title,
            outputs=outputs,
            versions=versions,
            error=None,
            message=done_msg,
        )


def stage_trim(job_dir: Path, start_sec: float, end_sec: float) -> dict[str, Any]:
    """Trim active video to [start_sec, end_sec] into final_v{N}.mp4 without overwriting original."""
    src_mp4 = _latest_video_path(job_dir)
    total_dur = probe_duration(src_mp4)
    if start_sec < 0 or end_sec <= start_sec:
        raise ValueError(f"ช่วงเวลา trim ไม่ถูกต้อง (start={start_sec}, end={end_sec})")
    if total_dur > 0 and start_sec >= total_dur:
        raise ValueError(f"เวลาเริ่มต้น ({start_sec}s) เกินความยาววิดีโอ ({total_dur}s)")
    clamped_end = min(end_sec, total_dur) if total_dur > 0 else end_sec

    ver = _next_version_number(job_dir)
    out_mp4 = job_dir / f"final_v{ver}.mp4"
    slug = safe_slug(job_dir.name)

    write_status(job_dir, status="editing", stage="trim", progress=50, message=f"กำลังตัดหัวท้าย ({start_sec:.2f}s–{clamped_end:.2f}s)...")
    append_log(job_dir, f"Trimming {src_mp4.name} [{start_sec:.3f}, {clamped_end:.3f}] -> {out_mp4.name}")

    cmd = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-ss",
        f"{start_sec:.3f}",
        "-to",
        f"{clamped_end:.3f}",
        "-i",
        str(src_mp4),
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(out_mp4),
    ]
    rc, stdout, stderr = _run_subprocess(cmd, timeout=300)
    if rc != 0 or not out_mp4.exists():
        err = (stderr or stdout or f"ffmpeg trim exited {rc}").strip()
        raise RuntimeError(f"ตัดหัวท้ายวิดีโอไม่สำเร็จ: {err.splitlines()[-1][:200]}")

    return _finalize_edit_version(job_dir, out_mp4, ver, f"trim:{start_sec:.2f}-{clamped_end:.2f}", f"{slug}_v{ver}.mp4")


def stage_cut(job_dir: Path, cut_from: float, cut_to: float) -> dict[str, Any]:
    """Cut out middle segment [cut_from, cut_to] into final_v{N}.mp4 without overwriting original."""
    src_mp4 = _latest_video_path(job_dir)
    total_dur = probe_duration(src_mp4)
    if total_dur <= 0:
        raise RuntimeError("ไม่สามารถอ่านความยาวของวิดีโอต้นฉบับได้")
    if cut_from < 0 or cut_to <= cut_from or cut_from >= total_dur:
        raise ValueError(f"ช่วงเวลา cut ไม่ถูกต้อง (from={cut_from}, to={cut_to}, duration={total_dur})")
    cut_to = min(cut_to, total_dur)
    if cut_from <= 0.05 and cut_to >= total_dur - 0.05:
        raise ValueError("ไม่สามารถตัดวิดีโอออกทั้งหมดได้")

    ver = _next_version_number(job_dir)
    out_mp4 = job_dir / f"final_v{ver}.mp4"
    slug = safe_slug(job_dir.name)

    write_status(job_dir, status="editing", stage="cut", progress=50, message=f"กำลังตัดช่วงกลาง ({cut_from:.2f}s–{cut_to:.2f}s)...")
    append_log(job_dir, f"Cutting {src_mp4.name} out [{cut_from:.3f}, {cut_to:.3f}] (dur={total_dur:.3f}) -> {out_mp4.name}")

    if cut_from <= 0.05:
        # Cut from start -> keep [cut_to, end]
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-ss", f"{cut_to:.3f}", "-i", str(src_mp4),
            "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
            str(out_mp4),
        ]
    elif cut_to >= total_dur - 0.05:
        # Cut to end -> keep [0, cut_from]
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-to", f"{cut_from:.3f}", "-i", str(src_mp4),
            "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
            str(out_mp4),
        ]
    else:
        filter_complex = (
            f"[0:v]trim=start=0:end={cut_from:.3f},setpts=PTS-STARTPTS[v0];"
            f"[0:a]atrim=start=0:end={cut_from:.3f},asetpts=PTS-STARTPTS[a0];"
            f"[0:v]trim=start={cut_to:.3f},setpts=PTS-STARTPTS[v1];"
            f"[0:a]atrim=start={cut_to:.3f},asetpts=PTS-STARTPTS[a1];"
            f"[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]"
        )
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(src_mp4),
            "-filter_complex", filter_complex,
            "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
            str(out_mp4),
        ]

    rc, stdout, stderr = _run_subprocess(cmd, timeout=300)
    if rc != 0 or not out_mp4.exists():
        err = (stderr or stdout or f"ffmpeg cut exited {rc}").strip()
        raise RuntimeError(f"ตัดท่อนกลางวิดีโอไม่สำเร็จ: {err.splitlines()[-1][:200]}")

    return _finalize_edit_version(job_dir, out_mp4, ver, f"cut:{cut_from:.2f}-{cut_to:.2f}", f"{slug}_v{ver}.mp4")


def _finalize_edit_version(
    job_dir: Path,
    out_mp4: Path,
    ver: int,
    kind: str,
    dest_name: str,
) -> dict[str, Any]:
    preview_info = run_preview_stage(job_dir, out_mp4, None)
    preview_out = copy_preview_to_videos_dir(job_dir, preview_info, Path(dest_name).stem)

    master_copy = copy_to_videos_dir(out_mp4, dest_name)
    dur = probe_duration(out_mp4)
    size_bytes = master_copy.stat().st_size

    job = read_json(job_dir / "job.json", {}) or {}
    versions = list(job.get("versions") or [])
    prev_outputs = dict(job.get("outputs") or {})

    entry: dict[str, Any] = {
        "version": ver,
        "kind": kind,
        "file": out_mp4.name,
        "videoPath": str(master_copy),
        "watchUrl": make_watch_url(master_copy),
        "downloadUrl": make_download_url(master_copy),
        "durationSec": dur,
        "sizeBytes": size_bytes,
        "createdAt": now_iso(),
        **preview_out,
    }
    versions.append(entry)

    outputs = {
        **prev_outputs,
        "videoPath": str(master_copy),
        "jobVideoFile": out_mp4.name,
        "watchUrl": make_watch_url(master_copy),
        "downloadUrl": make_download_url(master_copy),
        "durationSec": dur,
        "sizeBytes": size_bytes,
        **preview_info,
        **preview_out,
    }
    append_log(job_dir, f"Saved edited version v{ver} ({kind}) -> {master_copy}")
    return write_status(
        job_dir,
        status="done",
        stage="done",
        progress=100,
        outputs=outputs,
        versions=versions,
        error=None,
        message=f"บันทึกเวอร์ชัน v{ver} เรียบร้อยแล้ว",
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Video Studio Job Runner")
    sub = parser.add_subparsers(dest="cmd", required=True)

    for name in ("oneshot", "draft", "build"):
        p = sub.add_parser(name)
        p.add_argument("--job", required=True, help="Job directory path")

    p_es = sub.add_parser("edit-scene")
    p_es.add_argument("--job", required=True, help="Job directory path")
    p_es.add_argument("--scene", "--scene-id", dest="scene", default="", help="Edited scene ID")

    p_tr = sub.add_parser("trim")
    p_tr.add_argument("--job", required=True, help="Job directory path")
    p_tr.add_argument("--start", type=float, required=True, help="Start time in seconds")
    p_tr.add_argument("--end", type=float, required=True, help="End time in seconds")

    p_cut = sub.add_parser("cut")
    p_cut.add_argument("--job", required=True, help="Job directory path")
    p_cut.add_argument("--from", "--cut-from", dest="cut_from", type=float, required=True, help="Cut start in seconds")
    p_cut.add_argument("--to", "--cut-to", dest="cut_to", type=float, required=True, help="Cut end in seconds")

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    global _current_job_dir
    args = parse_args(argv if argv is not None else sys.argv[1:])
    job_dir = Path(args.job).resolve()
    job_dir.mkdir(parents=True, exist_ok=True)
    _current_job_dir = job_dir
    _install_signal_handlers()

    append_log(job_dir, f"=== studio_job.py {args.cmd} started (pid={os.getpid()}) ===")
    try:
        if args.cmd == "draft":
            stage_draft(job_dir)
        elif args.cmd == "build":
            stage_build(job_dir, as_new_version=False)
        elif args.cmd == "oneshot":
            stage_draft(job_dir)
            stage_build(job_dir, as_new_version=False)
        elif args.cmd == "edit-scene":
            stage_build(job_dir, as_new_version=True, edit_scene_id=args.scene or None)
        elif args.cmd == "trim":
            stage_trim(job_dir, args.start, args.end)
        elif args.cmd == "cut":
            stage_cut(job_dir, args.cut_from, args.cut_to)
        else:
            raise ValueError(f"ไม่รู้จักคำสั่ง: {args.cmd}")
        append_log(job_dir, f"=== studio_job.py {args.cmd} completed ===")
        return 0
    except AbortedError:
        return 143
    except Exception as exc:
        short_err = str(exc).strip() or exc.__class__.__name__
        if len(short_err) > 300:
            short_err = short_err[:297] + "..."
        append_log(job_dir, f"ERROR ({args.cmd}): {short_err}")
        write_status(
            job_dir,
            status="error",
            stage="error",
            error=short_err,
            message=f"เกิดข้อผิดพลาด: {short_err}",
        )
        print(json.dumps({"ok": False, "error": short_err}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
