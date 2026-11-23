#!/usr/bin/env python3
"""Style presets, custom styles loader, and StyleTokens validator for StudioEngine."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

BASE_DIR = Path("/home/dev/.local/share/motion-studio")
PRESETS_PATH = BASE_DIR / "assets" / "studio_style_presets.json"
CUSTOM_PATH = BASE_DIR / "assets" / "studio_custom_styles.json"

VALID_FAMILIES = (
    "glow-world",
    "editorial-paper",
    "documentary-card",
    "data-board",
    "kinetic-type",
    "iso-3d",
)
VALID_SUBTITLE_STYLES = ("pill", "minimal", "bold-bar", "karaoke", "none")
VALID_TRANSITIONS = ("spring", "slide", "zoom", "wipe", "cut")
VALID_BG_PATTERNS = ("grid", "dots", "noise", "lines", "radial", "none")

HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _hex_to_rgb(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]


def _relative_luminance(hex_color: str) -> float:
    def _chan(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = _hex_to_rgb(hex_color)
    return 0.2126 * _chan(r) + 0.7152 * _chan(g) + 0.0722 * _chan(b)


def contrast_ratio(hex1: str, hex2: str) -> float:
    """Compute WCAG 2.1 contrast ratio between two #RRGGBB colors."""
    l1 = _relative_luminance(hex1)
    l2 = _relative_luminance(hex2)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def validate_tokens(tokens: Any) -> tuple[bool, list[str]]:
    """Validate a StyleTokens dict. Returns (ok, errors)."""
    errors: list[str] = []
    if not isinstance(tokens, dict):
        return False, ["tokens must be a dict"]

    family = tokens.get("family")
    if family not in VALID_FAMILIES:
        errors.append(f"invalid family: {family!r}")

    palette = tokens.get("palette")
    if not isinstance(palette, dict):
        errors.append("palette must be a dict")
    else:
        required_colors = ("bg", "bgSecondary", "fg", "muted", "accent", "accent2", "cardBg", "border")
        for key in required_colors:
            val = palette.get(key)
            if not isinstance(val, str) or not HEX_RE.match(val):
                errors.append(f"palette.{key} must be #RRGGBB hex, got {val!r}")
        bg = palette.get("bg")
        fg = palette.get("fg")
        if isinstance(bg, str) and isinstance(fg, str) and HEX_RE.match(bg) and HEX_RE.match(fg):
            cr = contrast_ratio(fg, bg)
            if cr < 4.5:
                errors.append(f"contrast ratio fg/bg ({cr:.2f}) < 4.5:1")

    typo = tokens.get("typography")
    if not isinstance(typo, dict):
        errors.append("typography must be a dict")
    else:
        if not isinstance(typo.get("fontFamily"), str) or not typo["fontFamily"].strip():
            errors.append("typography.fontFamily must be a non-empty string")
        tw = typo.get("titleWeight")
        if not isinstance(tw, int) or not (300 <= tw <= 900):
            errors.append(f"typography.titleWeight must be int 300..900, got {tw!r}")
        ss = typo.get("subtitleStyle")
        if ss not in VALID_SUBTITLE_STYLES:
            errors.append(f"typography.subtitleStyle invalid: {ss!r}")

    motion = tokens.get("motion")
    if not isinstance(motion, dict):
        errors.append("motion must be a dict")
    else:
        damp = motion.get("springDamping")
        if not isinstance(damp, (int, float)) or not (5 <= damp <= 40):
            errors.append(f"motion.springDamping must be 5..40, got {damp!r}")
        stiff = motion.get("springStiffness")
        if not isinstance(stiff, (int, float)) or not (40 <= stiff <= 400):
            errors.append(f"motion.springStiffness must be 40..400, got {stiff!r}")
        tr = motion.get("transitionType")
        if tr not in VALID_TRANSITIONS:
            errors.append(f"motion.transitionType invalid: {tr!r}")
        for norm_key in ("parallaxStrength", "glowIntensity"):
            v = motion.get(norm_key)
            if not isinstance(v, (int, float)) or not (0.0 <= v <= 1.0):
                errors.append(f"motion.{norm_key} must be 0.0..1.0, got {v!r}")

    bg_cfg = tokens.get("background")
    if not isinstance(bg_cfg, dict):
        errors.append("background must be a dict")
    else:
        pat = bg_cfg.get("pattern")
        if pat not in VALID_BG_PATTERNS:
            errors.append(f"background.pattern invalid: {pat!r}")
        for norm_key in ("vignette", "grain"):
            v = bg_cfg.get(norm_key)
            if not isinstance(v, (int, float)) or not (0.0 <= v <= 1.0):
                errors.append(f"background.{norm_key} must be 0.0..1.0, got {v!r}")

    hints = tokens.get("promptHints")
    if not isinstance(hints, str) or len(hints.strip()) < 10:
        errors.append("promptHints must be a non-empty string (>= 10 chars)")

    return len(errors) == 0, errors


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "presets": {}}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_all_styles() -> dict[str, Any]:
    """Load and merge built-in 46 presets with user custom styles."""
    presets_data = _read_json(PRESETS_PATH)
    custom_data = _read_json(CUSTOM_PATH)
    merged: dict[str, Any] = {}
    for k, v in (presets_data.get("presets") or {}).items():
        merged[k] = {**v, "isCustom": False}
    for k, v in (custom_data.get("presets") or {}).items():
        merged[k] = {**v, "isCustom": True}
    return merged


def validate_presets_file(path: Path = PRESETS_PATH) -> dict[str, Any]:
    data = _read_json(path)
    presets = data.get("presets") or {}
    all_errors: list[str] = []
    for style_id, entry in presets.items():
        tokens = entry.get("tokens") if isinstance(entry, dict) else None
        ok, errs = validate_tokens(tokens)
        if not ok:
            for e in errs:
                all_errors.append(f"{style_id}: {e}")
    return {
        "ok": len(all_errors) == 0 and len(presets) == 46,
        "count": len(presets),
        "errors": all_errors,
    }


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "validate":
        res = validate_presets_file()
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0 if res["ok"] else 1
    print("Usage: studio_styles.py validate", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
