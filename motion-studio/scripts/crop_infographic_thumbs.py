#!/usr/bin/env python3
"""Crop 46 style illustration strips from video_styles_infographic.png."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SRC_IMAGE = Path("/home/dev/.gemini/outputs/videos/video_styles_infographic.png")
OUT_DIR = Path("/home/dev/.gemini/outputs/video-studio/style-thumbs/art")
MANIFEST_PATH = OUT_DIR / "manifest.json"
CONTACT_PATH = Path("/tmp/art_contact.jpg")

BORDER_RGB = (226, 232, 240)

APPROX_COLS = [
    (108, 712),
    (741, 1345),
    (1374, 1978),
    (2007, 2614),
    (2643, 3247),
]

APPROX_ROWS = [
    (1342, 1568),
    (1771, 1997),
    (2428, 2654),
    (2857, 3083),
    (3512, 3738),
    (3975, 4201),
    (4632, 4858),
    (5060, 5286),
    (5717, 5943),
    (6143, 6368),
]

# Row index -> number of style cards in that row (skip summary card in col 4 for rows 1,3,5,7)
ROW_CARD_COUNTS = [5, 4, 5, 4, 5, 4, 5, 4, 5, 5]


def is_border_pixel(rgb: tuple[int, int, int], tol: int = 6) -> bool:
    return (
        abs(rgb[0] - BORDER_RGB[0]) <= tol
        and abs(rgb[1] - BORDER_RGB[1]) <= tol
        and abs(rgb[2] - BORDER_RGB[2]) <= tol
    )


def find_border_span(px, fixed_coord: int, approx: int, horizontal: bool, search_radius: int = 16) -> tuple[int, int]:
    """Find contiguous border pixel indices around approx along x (horizontal=True) or y."""
    hits = []
    for offset in range(-search_radius, search_radius + 1):
        c = approx + offset
        rgb = px[c, fixed_coord] if horizontal else px[fixed_coord, c]
        if is_border_pixel(rgb[:3]):
            hits.append(c)
    if not hits:
        return (approx, approx)
    return (min(hits), max(hits))


def detect_grid(im: Image.Image) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    """Detect exact inner (left, right) for 5 columns and (top, bottom) for 10 rows."""
    px = im.load()
    cols = []
    for approx_l, approx_r in APPROX_COLS:
        l_min, l_max = find_border_span(px, 1450, approx_l, horizontal=True)
        r_min, r_max = find_border_span(px, 1450, approx_r, horizontal=True)
        cols.append((l_max + 1, r_min))

    rows = []
    for approx_t, approx_b in APPROX_ROWS:
        t_min, t_max = find_border_span(px, 400, approx_t, horizontal=False)
        b_min, b_max = find_border_span(px, 400, approx_b, horizontal=False)
        rows.append((t_max + 1, b_min))

    return cols, rows


def build_contact_sheet(crops: list[tuple[str, Image.Image]], out_path: Path) -> None:
    """Create a 5-column contact sheet with style IDs labeled under each thumbnail."""
    grid_cols = 5
    grid_rows = (len(crops) + grid_cols - 1) // grid_cols
    thumb_w, thumb_h = 300, 112
    label_h = 26
    pad = 10

    sheet_w = grid_cols * (thumb_w + pad) + pad
    sheet_h = grid_rows * (thumb_h + label_h + pad) + pad
    sheet = Image.new("RGB", (sheet_w, sheet_h), (245, 245, 245))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for idx, (style_id, crop_im) in enumerate(crops):
        r = idx // grid_cols
        c = idx % grid_cols
        x = pad + c * (thumb_w + pad)
        y = pad + r * (thumb_h + label_h + pad)
        resized = crop_im.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        sheet.paste(resized, (x, y))
        draw.text((x + 6, y + thumb_h + 6), style_id, fill=(20, 20, 20), font=font)

    sheet.save(out_path, format="JPEG", quality=88)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    im = Image.open(SRC_IMAGE).convert("RGB")
    cols, rows = detect_grid(im)

    inset_x = 3
    inset_y = 2
    items: dict[str, dict] = {}
    crops_for_sheet: list[tuple[str, Image.Image]] = []
    look_num = 1

    for row_idx, (top, bottom) in enumerate(rows):
        count = ROW_CARD_COUNTS[row_idx]
        for col_idx in range(count):
            left, right = cols[col_idx]
            box = (left + inset_x, top + inset_y, right - inset_x, bottom - inset_y)
            crop_im = im.crop(box)

            style_id = f"look-{look_num}"
            filename = f"{style_id}.jpg"
            out_file = OUT_DIR / filename
            crop_im.save(out_file, format="JPEG", quality=88, optimize=True)

            mtime_ms = int(os.stat(out_file).st_mtime * 1000)
            w, h = crop_im.size
            items[style_id] = {
                "file": filename,
                "mtime": mtime_ms,
                "width": w,
                "height": h,
            }
            crops_for_sheet.append((style_id, crop_im))
            look_num += 1

    manifest = {
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": SRC_IMAGE.name,
        "items": items,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    build_contact_sheet(crops_for_sheet, CONTACT_PATH)
    print(f"Cropped {len(items)} thumbnails to {OUT_DIR}")
    print(f"Manifest written to {MANIFEST_PATH}")
    print(f"Contact sheet written to {CONTACT_PATH}")


if __name__ == "__main__":
    main()
