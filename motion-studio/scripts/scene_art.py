#!/usr/bin/env python3
"""Scene Art scheduler: per-scene 3D spec planning + cache + parallel Blender render across nodes.

Usage: venv/bin/python scripts/scene_art.py --job <jobDir> [--live-session S] [--no-ai] [--only s1,s3]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))
import studio_job as sj  # noqa: E402

STUDIO_ROOT = SCRIPTS_DIR.parent
BLENDER_SCRIPT = SCRIPTS_DIR / "scene_art_blender.py"
PUBLIC_DIR = STUDIO_ROOT / "public" / "scene-art"
CACHE_DIR = Path("/home/dev/.gemini/outputs/video-studio/scene-art-cache")
LOCAL_3D_OUT = Path("/home/dev/.gemini/outputs/3d")
AGENT_CTL = "/home/dev/.local/bin/agent-ctl"
BLENDER_STUDIO = "/home/dev/.local/bin/blender-studio"
BLENDER_BIN = shutil.which("blender") or "/usr/bin/blender"
RENDER_TIMEOUT = 600
SPEC_MARKER = "SPEC_JSON = None  # @@SPEC@@"

COMPOSITIONS = ("hero-center", "hero-left", "orbit", "stack", "exploded", "duo-versus")
ANGLES = ("low", "eye", "high", "top", "dutch")
LIGHTINGS = ("studio", "rim", "neon", "sunset", "noir")
MATERIALS = ("clay", "glossy", "metal", "glass", "toon")
MOTION_HINTS = ("float", "spin", "rise")

FALLBACK_PROPS = [
    "coin-stack", "banknote-fan", "candle-chart", "bar-chart", "line-graph-arrow", "robot-bot", "laptop",
    "smartphone", "shield-lock", "rocket", "gear-pair", "lightbulb", "globe", "server-rack", "piggy-bank",
    "hourglass", "trophy", "target-dart", "magnifier", "warning-sign",
]

# Category groups used to pick the "closest" replacement prop.
CATEGORIES = {
    "finance": ["coin-stack", "banknote-fan", "candle-chart", "bar-chart", "line-graph-arrow", "piggy-bank", "trophy"],
    "tech": ["robot-bot", "laptop", "smartphone", "server-rack", "globe", "gear-pair"],
    "idea": ["lightbulb", "rocket", "target-dart", "magnifier"],
    "risk": ["shield-lock", "warning-sign", "hourglass"],
}

# direction.props / cast / visual / icon -> ordered candidate heroes
PROP_CANDIDATES = {
    "money": ["coin-stack", "banknote-fan", "piggy-bank"],
    "chart": ["candle-chart", "bar-chart", "line-graph-arrow"],
    "laptop": ["laptop", "server-rack"],
    "phone": ["smartphone"],
    "bulb": ["lightbulb"],
    "trophy": ["trophy"],
    "rocket": ["rocket"],
    "robot": ["robot-bot", "gear-pair"],
    "clock": ["hourglass"],
    "calendar": ["hourglass"],
    "question": ["magnifier"],
    "check": ["shield-lock", "target-dart"],
    "cross": ["warning-sign"],
    "fire": ["warning-sign", "rocket"],
    "star": ["trophy", "target-dart"],
    "heart": ["piggy-bank"],
    "book": ["magnifier", "lightbulb"],
    "briefcase": ["piggy-bank", "server-rack"],
    "resume": ["magnifier", "laptop"],
    "window": ["globe", "server-rack"],
    "plant": ["bar-chart", "line-graph-arrow"],
    "hero": ["robot-bot", "trophy"],
    "interviewer": ["magnifier"],
    "boss": ["trophy", "target-dart"],
    "friend": ["lightbulb"],
    "crowd": ["globe"],
}

# Thai/English title/narration keywords -> candidate heroes
KEYWORDS = [
    (r"บอท|bot|อัตโนมัติ|automat|robot|ai\b|เอไอ", ["robot-bot", "gear-pair"]),
    (r"กำไร|เงิน|ทุน|money|profit|cash|เหรียญ|coin|รายได้", ["coin-stack", "banknote-fan", "piggy-bank"]),
    (r"ออม|เก็บ|saving|piggy", ["piggy-bank"]),
    (r"กราฟ|แท่งเทียน|candle|เทรนด์|trend|ราคา|price|ตลาด|market", ["candle-chart", "line-graph-arrow", "bar-chart"]),
    (r"สถิติ|วอลุ่ม|volume|เปอร์เซ็นต์|%|ข้อมูล|data", ["bar-chart", "candle-chart"]),
    (r"เติบโต|พุ่ง|ขึ้น|growth|rise|surge", ["line-graph-arrow", "rocket"]),
    (r"เสี่ยง|risk|ขาดทุน|loss|อันตราย|warning|เตือน|ระวัง", ["warning-sign", "hourglass"]),
    (r"ปลอดภัย|ป้องกัน|secure|safe|shield|ความปลอดภัย|stop.?loss|หยุดขาดทุน", ["shield-lock"]),
    (r"เวลา|นาที|วินาที|time|24|ตลอด|เร็ว|speed", ["hourglass", "rocket"]),
    (r"เป้าหมาย|goal|target|แม่นยำ|กลยุทธ์|strategy|plan|แผน", ["target-dart"]),
    (r"ตรวจ|วิเคราะห์|analy|ค้นหา|search|ทดสอบ|backtest|test", ["magnifier"]),
    (r"ไอเดีย|idea|เรียนรู้|learn|เคล็ด|tip|ความรู้", ["lightbulb"]),
    (r"โลก|global|world|ทั่ว|ตลาดหุ้น|stock|crypto|คริปโต", ["globe"]),
    (r"เซิร์ฟเวอร์|server|คลาวด์|cloud|api|ระบบ|system", ["server-rack", "gear-pair"]),
    (r"มือถือ|แอป|app|phone|แจ้งเตือน", ["smartphone"]),
    (r"คอม|โปรแกรม|โค้ด|code|laptop|เขียน", ["laptop"]),
    (r"ชนะ|win|สำเร็จ|success|ผล|result|สรุป", ["trophy"]),
    (r"เริ่ม|start|launch|เปิดตัว", ["rocket"]),
]

_PROPS_CACHE: list[str] | None = None


def builder_version() -> str:
    try:
        m = re.search(r'^BUILDER_VERSION\s*=\s*["\']([^"\']+)["\']', BLENDER_SCRIPT.read_text(encoding="utf-8"), re.M)
        if m:
            return m.group(1)
    except Exception:
        pass
    return "0"


BUILDER_VERSION = builder_version()


def _log(job_dir: Path, msg: str) -> None:
    try:
        sj.append_log(job_dir, f"[scene-art] {msg}")
    except Exception:
        pass
    print(f"[scene-art] {msg}", file=sys.stderr)


# ---------------------------------------------------------------- props

def list_props() -> list[str]:
    global _PROPS_CACHE
    if _PROPS_CACHE is not None:
        return _PROPS_CACHE
    props: list[str] = []
    try:
        if Path(BLENDER_BIN).exists():
            rc, out, _ = sj._run_subprocess(
                [BLENDER_BIN, "-b", "--python", str(BLENDER_SCRIPT), "--", "--list-props"], timeout=90
            )
            if rc == 0:
                m = re.search(r"(\[[^\[\]]*\])\s*$", out.strip())
                if m:
                    props = [str(p) for p in json.loads(m.group(1))]
    except Exception:
        props = []
    _PROPS_CACHE = props or list(FALLBACK_PROPS)
    return _PROPS_CACHE


def _category_of(prop: str) -> str | None:
    for cat, items in CATEGORIES.items():
        if prop in items:
            return cat
    return None


# ---------------------------------------------------------------- spec planning

def _style_palette(style_id: str) -> dict[str, str]:
    try:
        pal = sj.get_style_preset(style_id).get("tokens", {}).get("palette", {}) or {}
    except Exception:
        pal = {}
    dflt = {"bg": "#0B0E1E", "accent": "#38BDF8", "accent2": "#818CF8", "fg": "#F4F7FF"}
    out = {k: str(pal.get(k) or dflt[k]) for k in dflt}
    # Near-grey accents make clay/metal props look washed out on the dark stage: borrow a vivid pair.
    if _saturation(out["accent"]) < 0.10 and _saturation(out["accent2"]) < 0.10:
        out["accent"], out["accent2"] = "#F5B83D", "#4FB3F6"
    return out


def _saturation(hex_color: str) -> float:
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", hex_color.strip())
    if not m:
        return 1.0
    v = int(m.group(1), 16)
    r, g, b = ((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255
    hi, lo = max(r, g, b), min(r, g, b)
    return 0.0 if hi == 0 else (hi - lo) / hi


def _scene_id(sc: dict, idx: int) -> str:
    raw = str(sc.get("id") or f"s{idx + 1}")
    return re.sub(r"[^A-Za-z0-9_-]", "_", raw) or f"s{idx + 1}"


def _scene_text(sc: dict) -> str:
    return " ".join(str(sc.get(k) or "") for k in ("title", "subtitle", "narration", "visual", "icon")).lower()


def _candidates_for_scene(sc: dict, props: list[str]) -> list[str]:
    cands: list[str] = []
    direction = sc.get("direction") or {}
    keys = list(direction.get("props") or []) + list(direction.get("cast") or [])
    for k in keys + [sc.get("icon"), sc.get("visual")]:
        cands += PROP_CANDIDATES.get(str(k or "").lower(), [])
    text = _scene_text(sc)
    for pat, items in KEYWORDS:
        if re.search(pat, text):
            cands += items
    seen, out = set(), []
    for c in cands:
        if c in props and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def heuristic_specs(script: dict, props: list[str]) -> list[dict]:
    specs = []
    for i, sc in enumerate(script.get("scenes") or []):
        cands = _candidates_for_scene(sc, props)
        hero = cands[0] if cands else props[i % len(props)]
        sup = [c for c in cands[1:] if c != hero][:2]
        specs.append({
            "sceneId": _scene_id(sc, i),
            "hero": hero,
            "supporting": sup,
            "composition": COMPOSITIONS[i % len(COMPOSITIONS)],
            "camera": {"angle": ANGLES[(i * 2 + 1) % len(ANGLES)]},
            "lighting": LIGHTINGS[i % len(LIGHTINGS)],
            "material": MATERIALS[i % len(MATERIALS)],
            "motionHint": MOTION_HINTS[i % len(MOTION_HINTS)],
        })
    return specs


def _ai_specs(job_dir: Path, script: dict, props: list[str]) -> list[dict] | None:
    scenes = []
    for i, sc in enumerate(script.get("scenes") or []):
        d = sc.get("direction") or {}
        scenes.append({
            "sceneId": _scene_id(sc, i), "title": sc.get("title"), "narration": str(sc.get("narration") or "")[:220],
            "direction": {"props": d.get("props"), "cast": d.get("cast"), "action": d.get("action")},
        })
    prompt = (
        "You design a distinct 3D hero object for each scene of a short explainer video. Return ONLY JSON:\n"
        '{"scenes":[{"sceneId":"..","hero":"..","supporting":["..",".."],"composition":"..",'
        '"camera":{"angle":"..","lens":24-85,"orbitDeg":0-360},"lighting":"..","material":"..","motionHint":".."}]}\n'
        f"Props (hero/supporting must come from this list): {', '.join(props)}\n"
        f"composition: {', '.join(COMPOSITIONS)}\ncamera.angle: {', '.join(ANGLES)}\n"
        f"lighting: {', '.join(LIGHTINGS)}\nmaterial: {', '.join(MATERIALS)}\nmotionHint: {', '.join(MOTION_HINTS)}\n"
        "Rules: choose the hero that best matches each scene's meaning; every scene needs a DIFFERENT hero; "
        "supporting max 3, no repeat of hero; vary composition/angle/lighting between scenes.\n"
        f"Video title: {script.get('title')}\nScenes:\n{json.dumps(scenes, ensure_ascii=False)}"
    )
    text, _model = sj.run_agy_with_fallback(job_dir, prompt, timeout=120)
    data = sj.extract_json_object(text)
    items = data.get("scenes") if isinstance(data, dict) else None
    return items if isinstance(items, list) else None


def _pick(val: Any, allowed: tuple, default: str) -> str:
    v = str(val or "").strip().lower()
    return v if v in allowed else default


def validate_specs(raw: list[dict], script: dict, props: list[str]) -> list[dict]:
    """Merge AI output over heuristic defaults, forcing every value into its enum."""
    base = heuristic_specs(script, props)
    by_id = {str(r.get("sceneId")): r for r in raw if isinstance(r, dict)}
    out = []
    for b in base:
        r = by_id.get(b["sceneId"], {})
        hero = str(r.get("hero") or "")
        if hero not in props:
            hero = b["hero"]
        sup = [str(s) for s in (r.get("supporting") or []) if str(s) in props and str(s) != hero][:3]
        cam = r.get("camera") if isinstance(r.get("camera"), dict) else {}
        try:
            lens = max(24, min(85, int(cam.get("lens", 50))))
        except Exception:
            lens = 50
        try:
            orbit = max(0, min(360, int(cam.get("orbitDeg", 25))))
        except Exception:
            orbit = 25
        out.append({
            "sceneId": b["sceneId"],
            "hero": hero,
            "supporting": sup or b["supporting"],
            "composition": _pick(r.get("composition"), COMPOSITIONS, b["composition"]),
            "camera": {"angle": _pick(cam.get("angle"), ANGLES, b["camera"]["angle"]), "lens": lens, "orbitDeg": orbit},
            "lighting": _pick(r.get("lighting"), LIGHTINGS, b["lighting"]),
            "material": _pick(r.get("material"), MATERIALS, b["material"]),
            "motionHint": _pick(r.get("motionHint"), MOTION_HINTS, b["motionHint"]),
        })
    return out


def plan_scene_art_specs(script: dict, style_id: str, job_dir: Path | None = None, use_ai: bool = True) -> list[dict]:
    props = list_props()
    specs = None
    if use_ai and job_dir is not None:
        try:
            raw = _ai_specs(job_dir, script, props)
            if raw:
                specs = validate_specs(raw, script, props)
                _log(job_dir, f"AI planned {len(specs)} specs")
        except Exception as exc:
            _log(job_dir, f"AI planning failed ({exc}); using heuristics")
    if specs is None:
        specs = heuristic_specs(script, props)
        for s in specs:
            s["camera"].setdefault("lens", 50)
            s["camera"].setdefault("orbitDeg", 25)
    return specs


# ---------------------------------------------------------------- diversity

def _dims_diff(a: dict, b: dict) -> int:
    return sum([
        a["hero"] != b["hero"],
        a["composition"] != b["composition"],
        a["camera"]["angle"] != b["camera"]["angle"],
        a["lighting"] != b["lighting"],
    ])


def _closest_unused(hero: str, used: set[str], props: list[str], wanted: list[str]) -> str | None:
    for w in wanted:  # preferred by scene meaning
        if w in props and w not in used:
            return w
    cat = _category_of(hero)
    pool = CATEGORIES.get(cat, []) if cat else []
    for p in pool:
        if p in props and p not in used:
            return p
    for p in props:
        if p not in used:
            return p
    return None


def enforce_diversity(specs: list[dict], style_id: str, job_id: str, script: dict | None = None) -> list[dict]:
    props = list_props()
    palette = _style_palette(style_id)
    scenes = (script or {}).get("scenes") or []
    used: set[str] = set()
    for i, s in enumerate(specs):
        wanted = _candidates_for_scene(scenes[i], props) if i < len(scenes) else []
        if s["hero"] in used:
            repl = _closest_unused(s["hero"], used, props, [w for w in wanted if w != s["hero"]])
            if repl:
                s["hero"] = repl
        used.add(s["hero"])
        if len(used) >= len(props):
            used = set()  # library exhausted: start a new round
        s["supporting"] = [p for p in s.get("supporting", []) if p != s["hero"]][:3]
    for i in range(1, len(specs)):
        prev, cur = specs[i - 1], specs[i]
        for step in range(1, 12):
            if _dims_diff(prev, cur) >= 2:
                break
            if cur["composition"] == prev["composition"]:
                cur["composition"] = COMPOSITIONS[(COMPOSITIONS.index(cur["composition"]) + 1) % len(COMPOSITIONS)]
            elif cur["camera"]["angle"] == prev["camera"]["angle"]:
                cur["camera"]["angle"] = ANGLES[(ANGLES.index(cur["camera"]["angle"]) + 1) % len(ANGLES)]
            else:
                cur["lighting"] = LIGHTINGS[(LIGHTINGS.index(cur["lighting"]) + 1) % len(LIGHTINGS)]
    for s in specs:
        s["version"] = 1
        s["palette"] = dict(palette)
        s["seed"] = zlib.crc32((s["sceneId"] + job_id).encode("utf-8")) & 0x7FFFFFFF
    return specs


# ---------------------------------------------------------------- cache + render

def cache_key(spec: dict) -> str:
    return hashlib.sha1((json.dumps(spec, sort_keys=True) + BUILDER_VERSION).encode("utf-8")).hexdigest()


def cache_path(spec: dict) -> Path:
    return CACHE_DIR / f"{cache_key(spec)}.png"


def online_nodes() -> list[str]:
    try:
        rc, out, _ = sj._run_subprocess([AGENT_CTL, "nodes"], timeout=30)
    except Exception:
        return []
    if rc != 0:
        return []
    names = []
    for line in out.splitlines():
        if "🟢" in line and "ONLINE" in line:
            m = re.search(r"•\s*([A-Za-z0-9_.-]+)", line)
            if m:
                names.append(m.group(1))
    return names


def _write_blender_script(spec: dict, job_dir: Path) -> Path:
    src = BLENDER_SCRIPT.read_text(encoding="utf-8")
    # Only match the real assignment line (a marker mentioned in a docstring must never be replaced)
    pattern = re.compile(r"^" + re.escape(SPEC_MARKER) + r"[ \t]*$", re.M)
    if len(pattern.findall(src)) != 1:
        raise RuntimeError("SPEC marker line missing or ambiguous in scene_art_blender.py")
    payload = json.dumps(spec, ensure_ascii=True)
    lit = "SPEC_JSON = r'''" + payload + "'''"
    out = job_dir / "scene_art" / f"{spec['sceneId']}.py"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(pattern.sub(lambda _m: lit, src, count=1), encoding="utf-8")
    return out


def _newest_png(directory: Path, since: float = 0.0) -> Path | None:
    if not directory.exists():
        return None
    pngs = [p for p in directory.rglob("*.png") if p.stat().st_mtime >= since and p.stat().st_size > 1000]
    return max(pngs, key=lambda p: p.stat().st_mtime) if pngs else None


def _render_remote(spec: dict, py: Path, node: str, job_dir: Path, live_session: str | None) -> Path | None:
    sid = spec["sceneId"]
    out_dir = job_dir / "scene_art" / f"out_{sid}"
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [AGENT_CTL, "blender", "--script", str(py), "--node", node, "--output", f"{sid}.glb",
           "--preview", f"{sid}.png", "--wait", "--timeout", str(RENDER_TIMEOUT), "--out-dir", str(out_dir)]
    if live_session:
        cmd += ["--live-session", live_session]
    rc, out, err = sj._run_subprocess(cmd, timeout=RENDER_TIMEOUT + 120)
    png = out_dir / f"{sid}.png"
    if rc == 0 and png.exists() and png.stat().st_size > 1000:
        return png
    found = _newest_png(out_dir) if rc == 0 else None
    if not found:
        _log(job_dir, f"{sid}: node {node} failed rc={rc} {(err or out)[-200:].strip()}")
    return found


def _render_local(spec: dict, py: Path, job_dir: Path) -> Path | None:
    sid = spec["sceneId"]
    started = time.time() - 1
    cmd = [BLENDER_STUDIO, "run", "--script", str(py), "--out", f"{sid}.glb", "--node", "local"]
    rc, out, err = sj._run_subprocess(cmd, timeout=RENDER_TIMEOUT + 120)
    png = _newest_png(LOCAL_3D_OUT, started)
    if not png:
        _log(job_dir, f"{sid}: local fallback failed rc={rc} {(err or out)[-200:].strip()}")
    return png


def _render_one(spec: dict, job_dir: Path, node: str | None, nodes: list[str], locks: dict, live_session):
    """Returns (png|None, node_used, seconds)."""
    t0 = time.time()
    sid = spec["sceneId"]
    py = _write_blender_script(spec, job_dir)
    order = []
    if node:
        order.append(node)
        order += [n for n in nodes if n != node][:1]  # retry once on another node
    for n in order:
        with locks[n]:  # one job per node at a time
            _log(job_dir, f"{sid}: rendering on {n}")
            png = _render_remote(spec, py, n, job_dir, live_session)
        if png:
            return png, n, round(time.time() - t0, 1)
    _log(job_dir, f"{sid}: falling back to local blender")
    png = _render_local(spec, py, job_dir)
    return png, "local" if png else None, round(time.time() - t0, 1)


def render_specs(specs: list[dict], job_dir: Path, live_session: str | None = None) -> dict[str, dict]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    results: dict[str, dict] = {}
    todo = []
    for s in specs:
        cp = cache_path(s)
        if cp.exists() and cp.stat().st_size > 1000:
            results[s["sceneId"]] = {"png": cp, "node": "cache", "cached": True, "sec": 0.0}
        else:
            todo.append(s)
    if not todo:
        return results
    nodes = online_nodes()
    _log(job_dir, f"render {len(todo)} scenes ({len(specs) - len(todo)} cached) nodes={nodes or ['local']}")
    locks = {n: threading.Lock() for n in nodes}
    q: queue.Queue = queue.Queue()
    for s in todo:
        q.put(s)
    # Worker i is bound to node i (round-robin pull); with no nodes a single local worker runs.
    workers = nodes or [None]

    def worker(node: str | None):
        while True:
            try:
                s = q.get_nowait()
            except queue.Empty:
                return
            try:
                png, used, sec = _render_one(s, job_dir, node, nodes, locks, live_session)
            except Exception as exc:
                _log(job_dir, f"{s['sceneId']}: error {exc}")
                png, used, sec = None, None, 0.0
            if png:
                try:
                    shutil.copyfile(png, cache_path(s))
                    results[s["sceneId"]] = {"png": cache_path(s), "node": used, "cached": False, "sec": sec}
                except Exception as exc:
                    _log(job_dir, f"{s['sceneId']}: cache copy failed {exc}")

    with ThreadPoolExecutor(max_workers=len(workers)) as ex:
        list(ex.map(worker, workers))
    return results


# ---------------------------------------------------------------- plan persistence

def _scene_sig(sc: dict) -> str:
    raw = "|".join(str(sc.get(k) or "") for k in ("title", "narration", "visual", "icon"))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def _reuse_saved_plan(specs: list[dict], script: dict, job_dir: Path) -> list[dict]:
    """Edits keep the hero/camera of scenes whose content did not change (AI planning is not deterministic)."""
    saved = sj.read_json(job_dir / "scene_art_plan.json", {}) or {}
    scenes = script.get("scenes") or []
    for i, s in enumerate(specs):
        prev = saved.get(s["sceneId"])
        if prev and i < len(scenes) and prev.get("sig") == _scene_sig(scenes[i]) and isinstance(prev.get("spec"), dict):
            keep = prev["spec"]
            for k in ("hero", "supporting", "composition", "camera", "lighting", "material", "motionHint"):
                if k in keep:
                    s[k] = keep[k]
    return specs


def _save_plan(specs: list[dict], script: dict, job_dir: Path) -> None:
    scenes = script.get("scenes") or []
    plan = {s["sceneId"]: {"sig": _scene_sig(scenes[i]) if i < len(scenes) else "", "spec": s} for i, s in enumerate(specs)}
    sj.atomic_write_json(job_dir / "scene_art_plan.json", plan)


# ---------------------------------------------------------------- publish + stage

def publish(job_id: str, specs: list[dict], results: dict[str, dict], job_dir: Path) -> dict:
    dest = PUBLIC_DIR / job_id
    dest.mkdir(parents=True, exist_ok=True)
    scenes = {}
    for s in specs:
        r = results.get(s["sceneId"])
        if not r:
            continue
        shutil.copyfile(r["png"], dest / f"{s['sceneId']}.png")
        scenes[s["sceneId"]] = {
            "src": f"scene-art/{job_id}/{s['sceneId']}.png",
            "hero": s["hero"], "composition": s["composition"], "motionHint": s["motionHint"],
            "node": r["node"], "cached": r["cached"], "sec": r["sec"],
        }
    doc = {"version": 1, "builder": BUILDER_VERSION, "scenes": scenes}
    sj.atomic_write_json(job_dir / "scene_art.json", doc)
    return doc


def run_scene_art_stage(job_dir, script: dict, request: dict, live_session: str | None = None,
                        use_ai: bool = True, only: list[str] | None = None) -> dict:
    job_dir = Path(job_dir)
    try:
        if request.get("sceneArt") is False or os.environ.get("MS_SCENE_ART") == "0":
            _log(job_dir, "disabled (sceneArt=false / MS_SCENE_ART=0)")
            return {}
        job_id = str(request.get("id") or job_dir.name)
        style_id = str(request.get("styleId") or "look-1")
        t0 = time.time()
        specs = plan_scene_art_specs(script, style_id, job_dir, use_ai=use_ai)
        specs = _reuse_saved_plan(specs, script, job_dir)
        specs = enforce_diversity(specs, style_id, job_id, script)
        _save_plan(specs, script, job_dir)
        _log(job_dir, "heroes: " + ", ".join(f"{s['sceneId']}={s['hero']}" for s in specs))
        if only:
            specs = [s for s in specs if s["sceneId"] in only]
        results = render_specs(specs, job_dir, live_session)
        doc = publish(job_id, specs, results, job_dir)
        summary = {
            "scenes": len(specs), "rendered": len(doc["scenes"]),
            "cached": sum(1 for v in doc["scenes"].values() if v["cached"]),
            "heroes": {s["sceneId"]: s["hero"] for s in specs},
            "perScene": doc["scenes"], "totalSec": round(time.time() - t0, 1),
        }
        _log(job_dir, f"done {summary['rendered']}/{summary['scenes']} cached={summary['cached']} in {summary['totalSec']}s")
        return summary
    except Exception as exc:
        _log(job_dir, f"stage failed, continuing without art: {exc}")
        return {}


def main() -> int:
    ap = argparse.ArgumentParser(description="Scene Art scheduler")
    ap.add_argument("--job", required=True)
    ap.add_argument("--live-session")
    ap.add_argument("--no-ai", action="store_true")
    ap.add_argument("--only")
    a = ap.parse_args()
    job_dir = Path(a.job)
    script = sj.read_json(job_dir / "script.json", {}) or {}
    request = sj.read_json(job_dir / "request.json", {}) or {}
    only = [x.strip() for x in a.only.split(",") if x.strip()] if a.only else None
    res = run_scene_art_stage(job_dir, script, request, a.live_session, use_ai=not a.no_ai, only=only)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
