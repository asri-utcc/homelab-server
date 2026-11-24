#!/usr/bin/env python3
"""DynamicMotionStage vector spec generator: AI-designed per-scene animated SVG specs + validation + cache.

Usage: venv/bin/python scripts/scene_vector.py --job <jobDir> [--mode auto|all|off] [--only s1,s2] [--no-ai]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))
import studio_job as sj  # noqa: E402

CACHE_DIR = Path("/home/dev/.gemini/outputs/video-studio/scene-vector-cache")
SPEC_VERSION = 1

ALLOWED_BG_TYPES = ("solid", "linear", "radial")
ALLOWED_KINDS = ("rect", "circle", "ellipse", "path", "polygon", "line", "group")
ALLOWED_ENTERS = ("fade", "pop", "slide-up", "slide-left", "slide-right", "draw", "none")
ALLOWED_LOOPS = ("none", "float", "pulse", "spin", "sway", "orbit")
ALLOWED_TEXT_ZONES = ("top", "middle", "bottom")

MAX_ELEMENTS = 48
MAX_POINTS = 40
MAX_GROUP_DEPTH = 2
COORD_MIN = -200.0
COORD_MAX = 2120.0

DATA_VISUALS = frozenset({
    "stat", "compare", "steps", "bullets", "chart", "timeline", "data", "table", "grid",
})

PATH_D_RE = re.compile(r"^[MLHVCSQTAZmlhvcsqtaz0-9eE ,.\-]{1,4000}$")
HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
RGB_COLOR_RE = re.compile(
    r"^rgba?\(\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,"
    r"\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+))?\s*\)$"
)
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


def _log(job_dir: Path | None, msg: str) -> None:
    if job_dir is not None:
        try:
            sj.append_log(job_dir, f"[scene-vector] {msg}")
        except Exception:
            pass
    print(f"[scene-vector] {msg}", file=sys.stderr)


def _style_palette(style_id: str) -> dict[str, str]:
    try:
        pal = sj.get_style_preset(style_id).get("tokens", {}).get("palette", {}) or {}
    except Exception:
        pal = {}
    dflt = {
        "bg": "#0B0E1E",
        "surface": "#151A30",
        "fg": "#F4F7FF",
        "muted": "#94A3B8",
        "accent": "#38BDF8",
        "accent2": "#818CF8",
    }
    out = {k: str(pal.get(k) or dflt[k]) for k in dflt}
    for k, v in pal.items():
        if k not in out and isinstance(v, str) and HEX_COLOR_RE.fullmatch(v.strip()):
            out[k] = v.strip()
    return out


def _scene_id(sc: dict[str, Any], idx: int) -> str:
    raw = str(sc.get("id") or f"s{idx + 1}")
    return re.sub(r"[^A-Za-z0-9_-]", "_", raw) or f"s{idx + 1}"


def _is_data_scene(sc: dict[str, Any]) -> bool:
    vis = str(sc.get("visual") or "").strip().lower()
    if vis in DATA_VISUALS:
        return True
    for key in ("stat", "compare", "steps", "bullets"):
        val = sc.get(key)
        if val:
            return True
    return False


def choose_scenes(script: dict[str, Any], mode: str = "auto") -> list[str]:
    """Select which scene IDs should get a DynamicMotionStage vector spec."""
    norm = str(mode or "auto").strip().lower()
    if norm in ("off", "0", "false", "none"):
        return []
    scenes = script.get("scenes") or []
    if not isinstance(scenes, list) or not scenes:
        return []

    indexed = [(_scene_id(sc, i), sc) for i, sc in enumerate(scenes) if isinstance(sc, dict)]
    if not indexed:
        return []

    if norm == "all":
        return [sid for sid, _ in indexed]

    # mode == "auto": prefer non-data storytelling/hero scenes; guarantee >= 2 when available
    non_data = [sid for sid, sc in indexed if not _is_data_scene(sc)]
    max_pick = min(5, max(2, (len(indexed) + 1) // 2))

    if len(non_data) >= 2:
        if len(non_data) <= max_pick:
            return non_data
        # Evenly spread across non-data scenes, always including the first
        step = (len(non_data) - 1) / float(max_pick - 1)
        picked: list[str] = []
        for k in range(max_pick):
            sid = non_data[round(k * step)]
            if sid not in picked:
                picked.append(sid)
        return picked

    # Fewer than 2 non-data scenes: take non-data scenes first, then top up to 2 from remaining
    picked = list(non_data)
    for sid, _ in indexed:
        if len(picked) >= min(2, len(indexed)):
            break
        if sid not in picked:
            picked.append(sid)
    return picked


def _clamp_num(val: Any, lo: float, hi: float, default: float | None = None) -> float | None:
    if isinstance(val, bool) or val is None:
        return default
    try:
        f = float(val)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(f):
        return default
    clamped = max(lo, min(hi, f))
    return round(clamped, 2)


def _sanitize_color(val: Any, palette: dict[str, str], allow_none: bool = True) -> str | None:
    if not isinstance(val, str):
        return None
    s = val.strip()
    if not s or "<" in s or ">" in s:
        return None
    low = s.lower()
    if low in ("none", "transparent"):
        return low if allow_none else None
    if low in palette:
        resolved = str(palette[low]).strip()
        if HEX_COLOR_RE.fullmatch(resolved) or RGB_COLOR_RE.fullmatch(resolved):
            return resolved
    if s in palette:
        resolved = str(palette[s]).strip()
        if HEX_COLOR_RE.fullmatch(resolved) or RGB_COLOR_RE.fullmatch(resolved):
            return resolved
    if HEX_COLOR_RE.fullmatch(s) or RGB_COLOR_RE.fullmatch(s):
        return s
    return None


def _sanitize_points(raw_pts: Any) -> list[list[float]] | None:
    pts: list[list[float]] = []
    if isinstance(raw_pts, str):
        # Support fallback SVG points string "x1,y1 x2,y2"
        tokens = re.findall(r"-?\d+(?:\.\d+)?", raw_pts)
        if len(tokens) >= 4 and len(tokens) % 2 == 0:
            for i in range(0, min(len(tokens), MAX_POINTS * 2), 2):
                x = _clamp_num(tokens[i], COORD_MIN, COORD_MAX)
                y = _clamp_num(tokens[i + 1], COORD_MIN, COORD_MAX)
                if x is not None and y is not None:
                    pts.append([x, y])
    elif isinstance(raw_pts, list):
        for item in raw_pts[:MAX_POINTS]:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                x = _clamp_num(item[0], COORD_MIN, COORD_MAX)
                y = _clamp_num(item[1], COORD_MIN, COORD_MAX)
                if x is not None and y is not None:
                    pts.append([x, y])
    return pts if pts else None


def _sanitize_anim(raw_anim: Any) -> dict[str, Any]:
    a = raw_anim if isinstance(raw_anim, dict) else {}
    enter = str(a.get("enter") or "fade").strip().lower()
    if enter not in ALLOWED_ENTERS:
        enter = "fade"
    loop = str(a.get("loop") or "none").strip().lower()
    if loop not in ALLOWED_LOOPS:
        loop = "none"
    delay = _clamp_num(a.get("delay"), 0.0, 3.0, 0.0)
    dur = _clamp_num(a.get("dur"), 0.2, 2.0, 0.6)
    loop_amp = _clamp_num(a.get("loopAmp"), 0.0, 60.0, 0.0 if loop == "none" else 12.0)
    loop_speed = _clamp_num(a.get("loopSpeed"), 0.2, 3.0, 1.0)
    return {
        "enter": enter,
        "delay": delay,
        "dur": dur,
        "loop": loop,
        "loopAmp": loop_amp,
        "loopSpeed": loop_speed,
    }


def _sanitize_element(
    el: Any,
    palette: dict[str, str],
    counter: list[int],
    depth: int,
) -> dict[str, Any] | None:
    if counter[0] >= MAX_ELEMENTS or not isinstance(el, dict):
        return None
    kind = str(el.get("kind") or "").strip().lower()
    if kind not in ALLOWED_KINDS:
        return None
    if kind == "group" and depth >= MAX_GROUP_DEPTH:
        return None

    # Validate colors before consuming an element slot
    has_fill = "fill" in el and el.get("fill") is not None
    has_stroke = "stroke" in el and el.get("stroke") is not None
    fill = _sanitize_color(el.get("fill"), palette, allow_none=True) if has_fill else None
    stroke = _sanitize_color(el.get("stroke"), palette, allow_none=True) if has_stroke else None

    if kind != "group":
        # Reject element if an explicitly supplied color is invalid and no valid paint remains
        invalid_fill = has_fill and fill is None
        invalid_stroke = has_stroke and stroke is None
        if (invalid_fill or invalid_stroke) and not (fill and fill not in ("none", "transparent")) and not (stroke and stroke not in ("none", "transparent")):
            return None
        if not has_fill and not has_stroke:
            if kind == "line":
                stroke = palette.get("accent") or "#38BDF8"
            else:
                fill = palette.get("accent") or "#38BDF8"

    raw_id = str(el.get("id") or "").strip()
    next_idx = counter[0] + 1
    el_id = raw_id if ID_RE.fullmatch(raw_id) else f"e{next_idx}"

    out: dict[str, Any] = {"id": el_id, "kind": kind}

    if kind == "rect":
        x = _clamp_num(el.get("x"), COORD_MIN, COORD_MAX, 0.0)
        y = _clamp_num(el.get("y"), COORD_MIN, COORD_MAX, 0.0)
        w = _clamp_num(el.get("w") if el.get("w") is not None else el.get("width"), 1.0, COORD_MAX)
        h = _clamp_num(el.get("h") if el.get("h") is not None else el.get("height"), 1.0, COORD_MAX)
        if w is None or h is None:
            return None
        out.update({"x": x, "y": y, "w": w, "h": h})
        rx = _clamp_num(el.get("rx"), 0.0, 500.0)
        ry = _clamp_num(el.get("ry"), 0.0, 500.0)
        if rx is not None:
            out["rx"] = rx
        if ry is not None:
            out["ry"] = ry

    elif kind == "circle":
        x = _clamp_num(el.get("x") if el.get("x") is not None else el.get("cx"), COORD_MIN, COORD_MAX)
        y = _clamp_num(el.get("y") if el.get("y") is not None else el.get("cy"), COORD_MIN, COORD_MAX)
        r = _clamp_num(el.get("r"), 1.0, COORD_MAX)
        if x is None or y is None or r is None:
            return None
        out.update({"x": x, "y": y, "r": r})

    elif kind == "ellipse":
        x = _clamp_num(el.get("x") if el.get("x") is not None else el.get("cx"), COORD_MIN, COORD_MAX)
        y = _clamp_num(el.get("y") if el.get("y") is not None else el.get("cy"), COORD_MIN, COORD_MAX)
        rx = _clamp_num(el.get("rx"), 1.0, COORD_MAX)
        ry = _clamp_num(el.get("ry"), 1.0, COORD_MAX)
        if x is None or y is None or rx is None or ry is None:
            return None
        out.update({"x": x, "y": y, "rx": rx, "ry": ry})

    elif kind == "path":
        d = el.get("d")
        if not isinstance(d, str):
            return None
        d_clean = d.strip()
        if not PATH_D_RE.fullmatch(d_clean):
            return None
        out["d"] = d_clean
        x = _clamp_num(el.get("x"), COORD_MIN, COORD_MAX)
        y = _clamp_num(el.get("y"), COORD_MIN, COORD_MAX)
        if x is not None:
            out["x"] = x
        if y is not None:
            out["y"] = y

    elif kind in ("polygon", "line"):
        pts = _sanitize_points(el.get("points"))
        if pts is None and kind == "line":
            x1 = _clamp_num(el.get("x1"), COORD_MIN, COORD_MAX)
            y1 = _clamp_num(el.get("y1"), COORD_MIN, COORD_MAX)
            x2 = _clamp_num(el.get("x2"), COORD_MIN, COORD_MAX)
            y2 = _clamp_num(el.get("y2"), COORD_MIN, COORD_MAX)
            if None not in (x1, y1, x2, y2):
                pts = [[x1, y1], [x2, y2]]
        min_pts = 3 if kind == "polygon" else 2
        if not pts or len(pts) < min_pts:
            return None
        out["points"] = pts

    elif kind == "group":
        raw_children = el.get("children")
        if not isinstance(raw_children, list) or not raw_children:
            return None
        x = _clamp_num(el.get("x"), COORD_MIN, COORD_MAX)
        y = _clamp_num(el.get("y"), COORD_MIN, COORD_MAX)
        if x is not None:
            out["x"] = x
        if y is not None:
            out["y"] = y
        counter[0] += 1
        children: list[dict[str, Any]] = []
        for child in raw_children:
            if counter[0] >= MAX_ELEMENTS:
                break
            san = _sanitize_element(child, palette, counter, depth + 1)
            if san is not None:
                children.append(san)
        if not children:
            return None
        out["children"] = children
        if fill is not None:
            out["fill"] = fill
        if stroke is not None:
            out["stroke"] = stroke
        opacity = _clamp_num(el.get("opacity"), 0.0, 1.0)
        if opacity is not None:
            out["opacity"] = opacity
        out["anim"] = _sanitize_anim(el.get("anim"))
        return out

    counter[0] += 1
    if fill is not None:
        out["fill"] = fill
    if stroke is not None:
        out["stroke"] = stroke
    sw = _clamp_num(el.get("strokeWidth"), 0.0, 40.0)
    if sw is not None:
        out["strokeWidth"] = sw
    opacity = _clamp_num(el.get("opacity"), 0.0, 1.0)
    if opacity is not None:
        out["opacity"] = opacity
    out["anim"] = _sanitize_anim(el.get("anim"))
    return out


def validate_vector_spec(
    raw: Any,
    palette: dict[str, str] | None = None,
    model: str | None = None,
) -> dict[str, Any] | None:
    """Strictly validate and sanitize an AI-generated vector stage spec. Returns None if unusable."""
    if not isinstance(raw, dict):
        return None
    pal = palette if isinstance(palette, dict) else {}

    raw_els = raw.get("elements")
    if not isinstance(raw_els, list) or not raw_els:
        return None

    counter = [0]
    clean_elements: list[dict[str, Any]] = []
    for item in raw_els:
        if counter[0] >= MAX_ELEMENTS:
            break
        san = _sanitize_element(item, pal, counter, depth=0)
        if san is not None:
            clean_elements.append(san)

    if not clean_elements:
        return None

    raw_bg = raw.get("bg") if isinstance(raw.get("bg"), dict) else {}
    bg_type = str(raw_bg.get("type") or "linear").strip().lower()
    if bg_type not in ALLOWED_BG_TYPES:
        bg_type = "linear"

    bg_colors: list[str] = []
    raw_colors = raw_bg.get("colors") if isinstance(raw_bg.get("colors"), list) else []
    for c in raw_colors[:3]:
        sc = _sanitize_color(c, pal, allow_none=False)
        if sc is not None:
            bg_colors.append(sc)
    if not bg_colors:
        c1 = _sanitize_color(pal.get("bg"), pal, allow_none=False) or "#0B0E1E"
        c2 = _sanitize_color(pal.get("surface"), pal, allow_none=False) or "#151A30"
        bg_colors = [c1] if bg_type == "solid" else [c1, c2]

    angle = _clamp_num(raw_bg.get("angle"), 0.0, 360.0, 135.0)

    tz = str(raw.get("textZone") or "top").strip().lower()
    if tz not in ALLOWED_TEXT_ZONES:
        tz = "top"

    motif = re.sub(r"[<>]", "", str(raw.get("motif") or "")).strip()[:200]
    mdl = re.sub(r"[<>]", "", str(model or raw.get("model") or "")).strip()[:120]

    return {
        "version": SPEC_VERSION,
        "bg": {"type": bg_type, "colors": bg_colors, "angle": angle},
        "elements": clean_elements,
        "textZone": tz,
        "motif": motif,
        "model": mdl,
    }


def _cache_key(scene: dict[str, Any], style_id: str, palette: dict[str, str]) -> str:
    payload = {
        "v": SPEC_VERSION,
        "styleId": style_id,
        "palette": {k: palette.get(k) for k in ("bg", "surface", "fg", "accent", "accent2")},
        "title": scene.get("title"),
        "subtitle": scene.get("subtitle"),
        "narration": str(scene.get("narration") or "")[:300],
        "visual": scene.get("visual"),
        "icon": scene.get("icon"),
        "direction": scene.get("direction"),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _ai_vector_spec(
    job_dir: Path,
    scene: dict[str, Any],
    style_id: str,
    palette: dict[str, str],
    video_title: str = "",
) -> dict[str, Any] | None:
    scene_brief = {
        "id": scene.get("id"),
        "badge": scene.get("badge"),
        "title": scene.get("title"),
        "subtitle": scene.get("subtitle"),
        "narration": str(scene.get("narration") or "")[:280],
        "visual": scene.get("visual"),
        "icon": scene.get("icon"),
        "direction": scene.get("direction"),
    }
    prompt = (
        "You are a senior motion-graphics art director designing a full-screen 1080x1920 vertical SVG vector scene "
        "for a Thai explainer video. Return ONLY a single JSON object (no markdown, no explanation) matching this EXACT schema:\n"
        "{\n"
        '  "version": 1,\n'
        '  "bg": {"type": "solid"|"linear"|"radial", "colors": ["#rrggbb", "#rrggbb"], "angle": 0-360},\n'
        '  "elements": [\n'
        '    {"id": "e1", "kind": "rect"|"circle"|"ellipse"|"path"|"polygon"|"line"|"group",\n'
        '     "x": num, "y": num, "w": num, "h": num, "r": num, "rx": num, "ry": num,\n'
        '     "d": "M...", "points": [[x,y],...],\n'
        '     "fill": "#rrggbb"|"rgba(r,g,b,a)"|"none", "stroke": "#rrggbb"|"none", "strokeWidth": 0-40, "opacity": 0-1,\n'
        '     "children": [...],\n'
        '     "anim": {"enter": "fade"|"pop"|"slide-up"|"slide-left"|"slide-right"|"draw"|"none", "delay": 0-3, "dur": 0.2-2,\n'
        '              "loop": "none"|"float"|"pulse"|"spin"|"sway"|"orbit", "loopAmp": 0-60, "loopSpeed": 0.2-3}}\n'
        "  ],\n"
        '  "textZone": "top"|"middle"|"bottom",\n'
        '  "motif": "short description of the visual metaphor"\n'
        "}\n"
        "STRICT RULES:\n"
        "- Canvas viewBox is 0 0 1080 1920. Keep main visual artwork inside x: 60..1020, y: 140..1500 (NEVER below y=1540).\n"
        "- NEVER draw any text, letters, or numbers. The engine overlays real Thai title/subtitle in textZone "
        "(top: y 180-520, middle: y 760-1100, bottom: y 1180-1500), so leave clean visual space in your chosen textZone.\n"
        "- Design 14 to 28 rich, layered vector elements (max 48) that vividly illustrate the scene's meaning: "
        "atmospheric glows/shapes in back, a bold central visual metaphor in mid-ground, and crisp animated accents in front.\n"
        "- Use staggered enter delays (0.0 to 1.4s) and lively loop animations (float, pulse, spin, sway, orbit) on key parts.\n"
        "- Use ONLY hex (#rrggbb) or rgba(r,g,b,a) or \"none\" for colors. Harmonize with this style palette: "
        f"{json.dumps(palette, ensure_ascii=False)}\n"
        f"- Style ID: {style_id} | Video title: {video_title}\n"
        f"- Scene:\n{json.dumps(scene_brief, ensure_ascii=False)}"
    )
    text, model = sj.run_agy_with_fallback(job_dir, prompt, timeout=120)
    raw = sj.extract_json_object(text)
    if not isinstance(raw, dict):
        return None
    return validate_vector_spec(raw, palette, model=model)


def run_scene_vector_stage(
    job_dir: str | Path,
    script: dict[str, Any],
    request: dict[str, Any],
    mode: str | None = None,
    only: list[str] | None = None,
    use_ai: bool = True,
) -> dict[str, Any]:
    job_dir = Path(job_dir)
    try:
        eff_mode = str(
            mode if mode is not None else (request.get("dynamicStage") or os.environ.get("MS_DYNAMIC_STAGE") or "auto")
        ).strip().lower()
        if eff_mode in ("off", "0", "false", "none"):
            _log(job_dir, "disabled (dynamicStage=off / MS_DYNAMIC_STAGE=off)")
            return {}

        style_id = str(request.get("styleId") or "look-1").strip()
        palette = _style_palette(style_id)
        video_title = str(script.get("title") or request.get("topic") or "")
        t0 = time.time()

        scenes_list = script.get("scenes") or []
        by_id = {_scene_id(sc, i): sc for i, sc in enumerate(scenes_list) if isinstance(sc, dict)}

        if only:
            target_ids = [sid for sid in only if sid in by_id]
        else:
            target_ids = choose_scenes(script, mode=eff_mode)

        if not target_ids:
            _log(job_dir, f"no scenes selected (mode={eff_mode})")
            return {"mode": eff_mode, "selected": 0, "generated": 0, "cached": 0, "scenes": {}}

        CACHE_DIR.mkdir(parents=True, exist_ok=True)

        # Preserve existing valid specs when running with --only
        existing_doc = sj.read_json(job_dir / "scene_vector.json", {}) or {}
        out_scenes: dict[str, Any] = {}
        if only and isinstance(existing_doc, dict) and isinstance(existing_doc.get("scenes"), dict):
            for k, v in existing_doc["scenes"].items():
                if isinstance(v, dict):
                    out_scenes[k] = v

        cached_count = 0
        generated_count = 0

        for sid in target_ids:
            sc = by_id.get(sid)
            if not sc:
                continue
            try:
                key = _cache_key(sc, style_id, palette)
                cache_path = CACHE_DIR / f"{key}.json"
                spec: dict[str, Any] | None = None

                if cache_path.exists():
                    cached_raw = sj.read_json(cache_path, None)
                    spec = validate_vector_spec(cached_raw, palette)
                    if spec is not None:
                        cached_count += 1
                        _log(job_dir, f"{sid}: cache hit ({key}, {len(spec['elements'])} elements)")

                if spec is None and use_ai:
                    spec = _ai_vector_spec(job_dir, sc, style_id, palette, video_title=video_title)
                    if spec is not None:
                        sj.atomic_write_json(cache_path, spec)
                        generated_count += 1
                        _log(
                            job_dir,
                            f"{sid}: AI generated {len(spec['elements'])} elements "
                            f"(textZone={spec['textZone']}, model={spec.get('model') or 'agy'})",
                        )
                    else:
                        _log(job_dir, f"{sid}: AI returned invalid/empty spec; skipping")

                if spec is not None:
                    out_scenes[sid] = spec
            except Exception as exc:
                _log(job_dir, f"{sid}: failed ({exc}); skipping")

        doc = {
            "version": SPEC_VERSION,
            "mode": eff_mode,
            "styleId": style_id,
            "scenes": out_scenes,
        }
        sj.atomic_write_json(job_dir / "scene_vector.json", doc)

        summary = {
            "mode": eff_mode,
            "selected": len(target_ids),
            "total": len(out_scenes),
            "generated": generated_count,
            "cached": cached_count,
            "sceneIds": list(out_scenes.keys()),
            "totalSec": round(time.time() - t0, 1),
        }
        _log(
            job_dir,
            f"done {summary['total']}/{summary['selected']} "
            f"(generated={generated_count}, cached={cached_count}) in {summary['totalSec']}s",
        )
        return summary
    except Exception as exc:
        _log(job_dir, f"stage failed, continuing without vector stage: {exc}")
        return {}


def main() -> int:
    ap = argparse.ArgumentParser(description="DynamicMotionStage vector spec generator")
    ap.add_argument("--job", required=True, help="Path to studio job directory")
    ap.add_argument("--mode", choices=("auto", "all", "off"), default=None)
    ap.add_argument("--only", help="Comma-separated scene IDs")
    ap.add_argument("--no-ai", action="store_true", help="Use cache only; skip AI calls")
    a = ap.parse_args()

    job_dir = Path(a.job)
    script = sj.read_json(job_dir / "script.json", {}) or {}
    request = sj.read_json(job_dir / "request.json", {}) or {}
    only = [x.strip() for x in a.only.split(",") if x.strip()] if a.only else None
    res = run_scene_vector_stage(
        job_dir,
        script,
        request,
        mode=a.mode,
        only=only,
        use_ai=not a.no_ai,
    )
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
