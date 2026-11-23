#!/home/dev/.local/share/bg-remove/venv/bin/python
"""ลบพื้นหลังรูปภาพแบบ local 100% (rembg + ONNX Runtime CPU) — ไม่ส่งรูปออกนอกเครื่อง

ตัวอย่าง:
  remove-bg รูป.jpg                       # ได้ PNG พื้นหลังโปร่งใส (refine ขอบสีอัตโนมัติ)
  remove-bg รูป.jpg -q max                # คุณภาพสูงสุด (BiRefNet, ช้ากว่า)
  remove-bg รูป.jpg --bg white            # แทนพื้นหลังด้วยสีขาว (หรือ #RRGGBB)
  remove-bg รูป.jpg --crop --matting      # ครอปชิดวัตถุ + เกลี่ยขอบผม/ขน
  remove-bg โฟลเดอร์/                     # ทำทั้งโฟลเดอร์

โหมดเลือกโดย AI (ทางเลือก):
  remove-bg รูป.jpg --compare             # รันหลายโมเดล + ทำภาพเทียบ (contact sheet) มีเส้นกริด %
  remove-bg รูป.jpg -m birefnet-general --erase-box 0%,25%,30%,80%   # ลบส่วนเกินในกรอบ (ใช้ mask cache → ทันที)
  remove-bg รูป.jpg -m birefnet-general --keep-box 10%,20%,95%,100%  # เก็บเฉพาะในกรอบ
"""
import argparse
import gc
import hashlib
import json
import os
import sys
import time
from pathlib import Path

# โมเดลเก็บที่ ~/.rembg/models (ดาวน์โหลดครั้งแรกครั้งเดียว หลังจากนั้นออฟไลน์)
os.environ.setdefault("OMP_NUM_THREADS", str(os.cpu_count() or 4))

# เฉพาะโมเดลที่รันในเครื่อง (atlascloud / withoutbg เป็น cloud API — ห้ามใช้)
LOCAL_MODELS = {
    "u2netp", "u2net", "u2net_human_seg", "u2net_cloth_seg", "silueta",
    "isnet-general-use", "isnet-anime",
    "birefnet-general", "birefnet-general-lite", "birefnet-portrait",
    "birefnet-dis", "birefnet-hrsod", "birefnet-cod", "birefnet-massive",
    "bria-rmbg",
}
PRESETS = {
    "fast": "u2netp",                    # เร็วมาก คุณภาพพอใช้
    "balanced": "isnet-general-use",     # ค่าเริ่มต้น สมดุลเร็ว/คม
    "best": "birefnet-general-lite",     # ขอบคมขึ้น (สาย/รองเท้า/ผม) ~15s, RAM ~7GB
    "max": "birefnet-general",           # คมสุด จับเครื่องประดับ/ชิ้นเล็กได้ดีสุด ~30s, RAM ~8GB
    "person": "birefnet-portrait",       # คน / ผม ~30s, RAM ~8GB
    "product": "birefnet-general-lite",  # สินค้า วัตถุ
    "anime": "isnet-anime",              # การ์ตูน / อนิเมะ
}
DEFAULT_COMPARE = ["isnet-general-use", "birefnet-general-lite", "birefnet-general", "birefnet-portrait"]
# RAM สูงสุดที่วัดได้จริงบนเครื่องนี้ (MB, รูป ~1MP, ปิด mem arena) — ใช้กันเครื่องค้าง
RAM_NEED_MB = {"birefnet-general-lite": 7000, "birefnet": 8500, "bria-rmbg": 8500, "sam": 4000}
FALLBACK_MODEL = "isnet-general-use"  # ~1GB
IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif", ".heic"}
DEFAULT_OUT = Path.home() / ".gemini" / "outputs" / "bg-removed"
MASK_CACHE = Path.home() / ".cache" / "bg-remove" / "masks"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def mem_available_mb():
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) // 1024
    except OSError:
        pass
    return None


def ram_needed_mb(model):
    for prefix, mb in RAM_NEED_MB.items():
        if model.startswith(prefix):
            return mb
    return 1200


def resolve_model(name):
    model = PRESETS.get(name, name)
    if model not in LOCAL_MODELS:
        raise SystemExit(f"โมเดล '{name}' ไม่ใช่โมเดล local (อนุญาต: {', '.join(sorted(LOCAL_MODELS))})")
    return model


def make_session(model):
    import onnxruntime as ort
    from rembg import new_session
    opts = ort.SessionOptions()
    opts.enable_cpu_mem_arena = False   # ลด peak RAM ~1GB ช้าลงเล็กน้อย
    opts.enable_mem_pattern = False
    opts.intra_op_num_threads = os.cpu_count() or 4
    opts.inter_op_num_threads = 1
    return new_session(model, sess_opts=opts)


class Sessions:
    """โหลดโมเดลเมื่อจำเป็นเท่านั้น (mask อยู่ใน cache แล้วไม่ต้องโหลด) และถือไว้ทีละตัวเพื่อประหยัด RAM"""

    def __init__(self):
        self.model, self.session, self.load_seconds = None, None, 0.0

    def get(self, model):
        if self.model != model:
            self.session = None
            gc.collect()
            t0 = time.time()
            self.session = make_session(model)
            self.load_seconds += time.time() - t0
            self.model = model
        return self.session

    def release(self):
        self.model, self.session = None, None
        gc.collect()


def parse_color(s):
    from PIL import ImageColor
    return ImageColor.getrgb(s)


def parse_box(s, w, h):
    """'x1,y1,x2,y2' เป็นพิกเซล หรือมี % เช่น '0%,25%,30%,80%' (สัดส่วนของรูป)"""
    parts = [p.strip() for p in s.split(",")]
    if len(parts) != 4:
        raise SystemExit(f"กรอบไม่ถูกต้อง '{s}' (ต้องเป็น x1,y1,x2,y2)")
    out = []
    for i, p in enumerate(parts):
        size = w if i % 2 == 0 else h
        v = float(p.rstrip("%")) * size / 100 if p.endswith("%") else float(p)
        out.append(int(round(min(max(v, 0), size))))
    x1, y1, x2, y2 = out
    return min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)


def collect_inputs(paths):
    files = []
    for p in map(Path, paths):
        if p.is_dir():
            files += sorted(f for f in p.iterdir() if f.suffix.lower() in IMG_EXTS)
        elif p.is_file():
            files.append(p)
        else:
            raise SystemExit(f"ไม่พบไฟล์: {p}")
    if not files:
        raise SystemExit("ไม่พบรูปภาพที่จะประมวลผล")
    return files


def load_image(path, max_side):
    from PIL import Image, ImageOps
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)  # แก้รูปจากมือถือที่หมุนผิด
    img = img.convert("RGB")
    orig_size = img.size
    # ลดขนาดรูปใหญ่มากก่อน เพื่อประหยัด RAM/เวลา
    if max_side and max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    return img, orig_size


def mask_cache_path(path, img, model):
    digest = hashlib.sha1(Path(path).read_bytes()).hexdigest()[:16]
    return MASK_CACHE / f"{digest}_{model}_{img.width}x{img.height}.png"


def get_mask(path, img, model, sessions):
    """mask ดิบจากโมเดล (L, ขนาดเท่ารูป) — cache ไว้ตาม hash ไฟล์+โมเดล ทำให้แก้กรอบ/ตัวเลือกซ้ำได้ทันที"""
    from PIL import Image
    cache = mask_cache_path(path, img, model)
    if cache.exists():
        return Image.open(cache).convert("L"), 0.0, True
    t0 = time.time()
    mask = sessions.get(model).predict(img)[0].convert("L")
    if mask.size != img.size:
        mask = mask.resize(img.size, Image.LANCZOS)
    elapsed = time.time() - t0
    cache.parent.mkdir(parents=True, exist_ok=True)
    mask.save(cache)
    return mask, elapsed, False


def edit_mask(mask, args):
    import numpy as np
    from PIL import Image
    from rembg.bg import post_process
    a = np.array(mask)
    if args.smooth:
        a = post_process(a)
    w, h = mask.size
    if args.keep_box:
        keep = np.zeros_like(a, dtype=bool)
        for b in args.keep_box:
            x1, y1, x2, y2 = parse_box(b, w, h)
            keep[y1:y2, x1:x2] = True
        a[~keep] = 0
    for b in args.erase_box or []:
        x1, y1, x2, y2 = parse_box(b, w, h)
        a[y1:y2, x1:x2] = 0
    return Image.fromarray(a)


def cutout(img, mask, args):
    """ตัดภาพตาม mask — refine = ประมาณสีจริงของ foreground ตรงขอบ (ลบขอบสีพื้นหลังเดิมที่ติดมา)"""
    import numpy as np
    from PIL import Image
    if args.matting:
        from rembg.bg import alpha_matting_cutout
        try:
            return alpha_matting_cutout(img, mask, 240, 10, 10)
        except Exception as e:  # pymatting ล้มบางกรณี (mask ว่าง) → ใช้วิธีปกติ
            print(f"⚠ matting ล้มเหลว ({e}) → ใช้ mask ปกติ", file=sys.stderr)
    if args.refine:
        from pymatting import estimate_foreground_ml
        alpha = np.asarray(mask, dtype=np.float64) / 255.0
        if 0 < alpha.max():
            fg = estimate_foreground_ml(np.asarray(img, dtype=np.float64) / 255.0, alpha)
            rgb = (np.clip(fg, 0, 1) * 255 + 0.5).astype(np.uint8)
            out = Image.fromarray(rgb, "RGB").convert("RGBA")
            out.putalpha(mask)
            return out
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def finish(result, path, args, out_dir, suffix=None, output=None):
    from PIL import Image
    if args.crop and not args.mask:
        bbox = result.getchannel("A").getbbox()
        if bbox:
            pad = args.pad
            bbox = (max(bbox[0] - pad, 0), max(bbox[1] - pad, 0),
                    min(bbox[2] + pad, result.width), min(bbox[3] + pad, result.height))
            result = result.crop(bbox)

    ext = ".png"
    if args.bg and not args.mask:
        canvas = Image.new("RGBA", result.size, parse_color(args.bg) + (255,))
        canvas.alpha_composite(result.convert("RGBA"))
        result = canvas.convert("RGB")
        ext = ".jpg" if args.format == "jpg" else ".png"
    elif args.format == "webp":
        ext = ".webp"

    suffix = suffix or ("_mask" if args.mask else "_nobg")
    out = Path(output) if output else out_dir / f"{path.stem}{suffix}{ext}"
    out.parent.mkdir(parents=True, exist_ok=True)
    save_kw = {"quality": 95} if out.suffix.lower() in (".jpg", ".jpeg", ".webp") else {"optimize": True}
    if out.suffix.lower() in (".jpg", ".jpeg") and result.mode == "RGBA":
        result = result.convert("RGB")
    result.save(out, **save_kw)
    return out, result.size


def process(path, model, sessions, args, out_dir, output=None):
    img, orig_size = load_image(path, args.max_side)
    note = None
    avail = mem_available_mb()
    if (not args.force and avail is not None and avail < ram_needed_mb(model)
            and sessions.model != model and not mask_cache_path(path, img, model).exists()):
        note = f"RAM ว่าง {avail}MB ไม่พอสำหรับ {model} (~{ram_needed_mb(model)}MB) → ใช้ {FALLBACK_MODEL} แทน"
        print("⚠ " + note, file=sys.stderr)
        model = FALLBACK_MODEL
    mask, infer_s, cached = get_mask(path, img, model, sessions)
    t0 = time.time()
    mask = edit_mask(mask, args)
    result = mask if args.mask else cutout(img, mask, args)
    out, size = finish(result, path, args, out_dir, output=output)
    return {"input": str(path), "output": str(out), "model": model, "note": note, "size": list(size),
            "original_size": list(orig_size), "seconds": round(infer_s + time.time() - t0, 2), "mask_cached": cached}


# ---------- โหมดเทียบหลายโมเดล (ให้ AI / ผู้ใช้เลือก) ----------

def checker(size, cell=16):
    from PIL import Image, ImageDraw
    bg = Image.new("RGB", size, (205, 205, 205))
    d = ImageDraw.Draw(bg)
    for y in range(0, size[1], cell):
        for x in range((y // cell) % 2 * cell, size[0], cell * 2):
            d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(150, 150, 150))
    return bg


def draw_grid(im):
    """เส้นกริดทุก 10% + ตัวเลข % เพื่อให้ AI อ้างอิงพิกัดกรอบ (--erase-box / --keep-box) ได้"""
    from PIL import ImageDraw, ImageFont
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype(FONT, 11)
    w, h = im.size
    for i in range(1, 10):
        x, y = w * i // 10, h * i // 10
        d.line([(x, 0), (x, h)], fill=(255, 0, 255), width=1)
        d.line([(0, y), (w, y)], fill=(255, 0, 255), width=1)
        d.text((x + 2, 2), f"{i * 10}", fill=(255, 0, 255), font=font)
        d.text((2, y + 1), f"{i * 10}", fill=(255, 0, 255), font=font)
    return im


def contact_sheet(img, tiles, out, tile_h=640):
    from PIL import Image, ImageDraw, ImageFont
    tw = max(1, round(img.width * tile_h / img.height))
    head = 30
    sheet = Image.new("RGB", (tw * len(tiles) + 10 * (len(tiles) - 1), tile_h + head), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(FONT, 15)
    for i, (label, im) in enumerate(tiles):
        im = im.convert("RGBA").resize((tw, tile_h), Image.LANCZOS)
        tile = checker((tw, tile_h)).convert("RGBA")
        tile.alpha_composite(im)
        tile = draw_grid(tile.convert("RGB"))
        x = i * (tw + 10)
        sheet.paste(tile, (x, head))
        d.text((x + 4, 6), label, fill=(0, 0, 0), font=font)
    sheet.save(out, quality=90)


def compare(path, models, sessions, args, out_dir):
    img, orig_size = load_image(path, args.max_side)
    tiles, cands, skipped = [("0 original", img)], [], []
    for i, model in enumerate(models, 1):
        avail = mem_available_mb()
        if not mask_cache_path(path, img, model).exists() and avail is not None and avail < ram_needed_mb(model) and not args.force:
            sessions.release()
            avail = mem_available_mb()
            if avail is not None and avail < ram_needed_mb(model):
                skipped.append(f"{model} (RAM ว่าง {avail}MB < ~{ram_needed_mb(model)}MB)")
                continue
        mask, infer_s, cached = get_mask(path, img, model, sessions)
        mask = edit_mask(mask, args)
        res = cutout(img, mask, args)
        out, _ = finish(res, path, args, out_dir, suffix=f"_{model}")
        cands.append({"n": i, "model": model, "output": str(out), "seconds": round(infer_s, 2),
                      "mask_cached": cached})
        tiles.append((f"{i} {model}", res))
        print(f"✓ [{i}] {model} ({infer_s:.1f}s{' cache' if cached else ''})", file=sys.stderr)
    sessions.release()
    sheet = out_dir / f"{path.stem}_compare.jpg"
    contact_sheet(img, tiles, sheet)
    return {"input": str(path), "original_size": list(orig_size), "compare_sheet": str(sheet),
            "candidates": cands, "skipped": skipped}


def main():
    ap = argparse.ArgumentParser(description="ลบพื้นหลังรูปภาพแบบออฟไลน์ในเครื่อง")
    ap.add_argument("inputs", nargs="*", help="ไฟล์รูป หรือโฟลเดอร์")
    ap.add_argument("-o", "--output", help="ไฟล์ปลายทาง (เมื่อมีอินพุตเดียว)")
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT), help=f"โฟลเดอร์ผลลัพธ์ (ค่าเริ่มต้น {DEFAULT_OUT})")
    ap.add_argument("-q", "--quality", "--preset", dest="preset", choices=PRESETS, default="balanced")
    ap.add_argument("-m", "--model", help="ระบุโมเดล rembg โดยตรง (override preset)")
    ap.add_argument("--bg", help="สีพื้นหลังแทน เช่น white, black, '#00ff00'")
    ap.add_argument("--format", choices=["png", "jpg", "webp"], default="png")
    ap.add_argument("--crop", action="store_true", help="ครอปให้ชิดวัตถุ")
    ap.add_argument("--pad", type=int, default=20, help="ระยะขอบเมื่อ --crop (px)")
    ap.add_argument("--matting", action="store_true", help="alpha matting เกลี่ยขอบผม/ขน (ช้าขึ้น)")
    ap.add_argument("--no-refine", dest="refine", action="store_false",
                    help="ปิดการแก้สีขอบ (foreground color estimation) ที่เปิดไว้โดยค่าเริ่มต้น")
    ap.add_argument("--smooth", action="store_true", help="ทำให้ขอบ mask เรียบ ลดจุดเล็กๆ")
    ap.add_argument("--erase-box", action="append", metavar="X1,Y1,X2,Y2",
                    help="ลบส่วนในกรอบออก (px หรือ %%) ใช้ซ้ำได้หลายกรอบ")
    ap.add_argument("--keep-box", action="append", metavar="X1,Y1,X2,Y2",
                    help="เก็บเฉพาะส่วนในกรอบ (px หรือ %%) ใช้ซ้ำได้")
    ap.add_argument("--compare", nargs="?", const=",".join(DEFAULT_COMPARE), metavar="M1,M2,...",
                    help="รันหลายโมเดล (preset หรือชื่อโมเดล) แล้วทำภาพเทียบ *_compare.jpg พร้อมกริด %%")
    ap.add_argument("--mask", action="store_true", help="ส่งออกเฉพาะ mask ขาวดำ")
    ap.add_argument("--max-side", type=int, default=4096, help="ย่อรูปที่ด้านยาวเกินค่านี้ (0=ไม่ย่อ)")
    ap.add_argument("--force", action="store_true", help="ข้ามการเช็ค RAM")
    ap.add_argument("--list-models", action="store_true")
    args = ap.parse_args()

    if args.list_models:
        print(json.dumps({"presets": PRESETS, "local_models": sorted(LOCAL_MODELS),
                          "compare_default": DEFAULT_COMPARE}, ensure_ascii=False, indent=2))
        return
    if not args.inputs:
        ap.error("ต้องระบุไฟล์รูปอย่างน้อย 1 ไฟล์")

    if any(p.suffix.lower() == ".heic" for p in map(Path, args.inputs)):
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except ImportError:
            pass

    try:
        os.nice(10)  # อย่าแย่ง CPU กับ service อื่นในเครื่อง
    except OSError:
        pass

    files = collect_inputs(args.inputs)
    out_dir = Path(args.out_dir)
    sessions = Sessions()
    results, errors = [], []

    if args.compare:
        models = list(dict.fromkeys(resolve_model(m.strip()) for m in args.compare.split(",") if m.strip()))
        for f in files:
            try:
                results.append(compare(f, models, sessions, args, out_dir))
            except Exception as e:
                errors.append({"input": str(f), "error": str(e)})
                print(f"✗ {f.name}: {e}", file=sys.stderr)
        print(json.dumps({"ok": not errors, "mode": "compare", "models": models,
                          "model_load_seconds": round(sessions.load_seconds, 2),
                          "results": results, "errors": errors}, ensure_ascii=False, indent=2))
        sys.exit(0 if results else 1)

    model = resolve_model(args.model or args.preset)

    single = len(args.inputs) == 1 and not Path(args.inputs[0]).is_dir()
    for f in files:
        try:
            r = process(f, model, sessions, args, out_dir, output=args.output if single else None)
            results.append(r)
            print(f"✓ {f.name} → {r['output']} ({r['seconds']}s)", file=sys.stderr)
        except Exception as e:  # ทำไฟล์อื่นต่อ
            errors.append({"input": str(f), "error": str(e)})
            print(f"✗ {f.name}: {e}", file=sys.stderr)

    notes = [r["note"] for r in results if r["note"]]
    print(json.dumps({"ok": not errors, "model": results[0]["model"] if results else model,
                      "model_load_seconds": round(sessions.load_seconds, 2),
                      "note": notes[0] if notes else None, "refine": args.refine, "results": results, "errors": errors},
                     ensure_ascii=False, indent=2))
    sys.exit(0 if results else 1)


if __name__ == "__main__":
    main()
