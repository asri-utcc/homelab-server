#!/usr/bin/env python3
"""Fetch real news media (article photo + short news clip) for news-mode Studio scenes.

For each story (scenes sharing the same mediaQuery/sourceUrl):
  - 1st scene -> ~10s muted clip from a recent YouTube news report (yt-dlp search, upload date >= story date - 1)
  - 2nd scene -> article og:image (falls back to a frame from the clip)
Files go to public/news-media/<job>/ so the Remotion bundle ships them to the render node.
Everything is best-effort: a scene without media simply keeps the normal style visual.
"""

from __future__ import annotations

import html
import io
import json
import re
import shutil
import subprocess
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urljoin, urlparse

BASE_DIR = Path("/home/dev/.local/share/motion-studio")
PUBLIC_DIR = BASE_DIR / "public"
MEDIA_ROOT = PUBLIC_DIR / "news-media"
UVX = "/home/dev/.local/bin/uvx"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
)
CLIP_SEC = 10
KEEP_JOB_DIRS = 3  # older job media dirs are pruned so the render bundle stays small
MAX_HTML_BYTES = 3_000_000
MAX_IMG_BYTES = 12_000_000

OG_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["\'][^>]*>',
    re.I,
)
CONTENT_RE = re.compile(r'content=["\']([^"\']+)["\']', re.I)
SKIP_IMG_RE = re.compile(r"logo|default|placeholder|favicon|share-image|og-default", re.I)

Log = Callable[[str], None]


def _http_get(url: str, limit: int, timeout: int = 15) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "th,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read(limit + 1)[:limit]


def find_og_image(page_url: str) -> str | None:
    raw = _http_get(page_url, MAX_HTML_BYTES).decode("utf-8", "replace")
    for tag in OG_RE.findall(raw):
        m = CONTENT_RE.search(tag)
        if not m:
            continue
        img = urljoin(page_url, html.unescape(m.group(1).strip()))
        if img.startswith("http") and not SKIP_IMG_RE.search(urlparse(img).path):
            return img
    return None


def save_image(img_bytes: bytes, out_path: Path, min_w: int = 480) -> bool:
    from PIL import Image

    with Image.open(io.BytesIO(img_bytes)) as im:
        im = im.convert("RGB")
        w, h = im.size
        if w < min_w or h < 240:
            return False
        if w > 1600:
            im = im.resize((1600, int(h * 1600 / w)))
        tmp = out_path.with_suffix(".tmp.jpg")
        im.save(tmp, "JPEG", quality=86)
        tmp.replace(out_path)
    return True


def fetch_article_image(page_url: str, out_path: Path, log: Log) -> bool:
    try:
        img_url = find_og_image(page_url)
        if not img_url:
            log(f"[news-media] no og:image on {page_url}")
            return False
        ok = save_image(_http_get(img_url, MAX_IMG_BYTES, timeout=20), out_path)
        if ok:
            log(f"[news-media] image <- {img_url}")
        return ok
    except Exception as exc:
        log(f"[news-media] image failed ({page_url}): {exc}")
        return False


def _yt_dlp(args: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["nice", "-n", "15", UVX, "yt-dlp", "--no-warnings", "--no-progress", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def search_news_video(query: str, after: date, log: Log) -> dict[str, Any] | None:
    try:
        res = _yt_dlp(
            [
                "--dateafter", after.strftime("%Y%m%d"),
                "--match-filter", "duration>30 & duration<2400 & !is_live",
                "--print", "%(id)s\t%(duration)s\t%(channel)s\t%(title)s",
                f"ytsearch6:{query}",
            ],
            timeout=150,
        )
    except subprocess.TimeoutExpired:
        log(f"[news-media] video search timeout: {query}")
        return None
    for line in res.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) >= 4 and re.fullmatch(r"[\w-]{11}", parts[0]):
            try:
                dur = float(parts[1])
            except ValueError:
                continue
            return {"id": parts[0], "duration": dur, "channel": parts[2].strip(), "title": parts[3].strip()}
    log(f"[news-media] no recent video for '{query}' (rc={res.returncode} {res.stderr.strip()[-160:]})")
    return None


def download_clip(video: dict[str, Any], out_path: Path, log: Log) -> bool:
    dur = float(video["duration"])
    # Skip anchor intros: start ~25% in (at least 15s), keep the whole window inside the video
    start = max(15.0, dur * 0.25)
    start = min(start, max(0.0, dur - CLIP_SEC - 2))
    raw_dir = out_path.parent / f".dl_{out_path.stem}"
    raw_dir.mkdir(exist_ok=True)
    try:
        res = _yt_dlp(
            [
                "-q",
                "-f", "bv*[height<=720][vcodec^=avc1]/bv*[height<=720]/b[height<=720]",
                "--download-sections", f"*{int(start)}-{int(start) + CLIP_SEC}",
                "-P", str(raw_dir),
                "-o", "raw.%(ext)s",
                f"https://www.youtube.com/watch?v={video['id']}",
            ],
            timeout=240,
        )
        raws = sorted(raw_dir.glob("raw.*"))
        if res.returncode != 0 or not raws:
            log(f"[news-media] clip download failed {video['id']}: {res.stderr.strip()[-200:]}")
            return False
        # Short 720p re-encode (~10s of video): light enough to run throttled here
        tmp = out_path.with_suffix(".tmp.mp4")
        enc = subprocess.run(
            [
                "nice", "-n", "15", "ffmpeg", "-v", "error", "-y", "-threads", "2",
                "-i", str(raws[0]), "-t", str(CLIP_SEC), "-an",
                "-vf", "scale=1280:-2,fps=30", "-c:v", "libx264", "-preset", "veryfast",
                "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(tmp),
            ],
            capture_output=True,
            text=True,
            timeout=180,
        )
        if enc.returncode != 0 or not tmp.exists() or tmp.stat().st_size < 20_000:
            log(f"[news-media] clip encode failed: {enc.stderr.strip()[-200:]}")
            tmp.unlink(missing_ok=True)
            return False
        tmp.replace(out_path)
        return True
    except subprocess.TimeoutExpired:
        log(f"[news-media] clip timeout {video['id']}")
        return False
    finally:
        shutil.rmtree(raw_dir, ignore_errors=True)


def grab_frame(clip: Path, out_path: Path, at_sec: float) -> bool:
    res = subprocess.run(
        ["nice", "-n", "15", "ffmpeg", "-v", "error", "-y", "-threads", "2", "-ss", str(at_sec),
         "-i", str(clip), "-frames:v", "1", "-q:v", "3", str(out_path)],
        capture_output=True,
        timeout=60,
    )
    return res.returncode == 0 and out_path.exists()


def _prune_old(keep_name: str) -> None:
    if not MEDIA_ROOT.is_dir():
        return
    dirs = sorted((d for d in MEDIA_ROOT.iterdir() if d.is_dir()), key=lambda d: d.stat().st_mtime, reverse=True)
    for d in dirs[KEEP_JOB_DIRS:]:
        if d.name != keep_name:
            shutil.rmtree(d, ignore_errors=True)


def _rel(p: Path) -> str:
    return str(p.relative_to(PUBLIC_DIR)).replace("\\", "/")


def attach_news_media(job_dir: Path, script: dict[str, Any], story_date: date | None, log: Log) -> int:
    """Mutates script scenes in place (adds 'media'); returns how many scenes got media."""
    scenes = [s for s in script.get("scenes") or [] if isinstance(s, dict)]
    slug = re.sub(r"[^a-z0-9-]", "-", job_dir.name.lower())[:60] or "job"
    out_dir = MEDIA_ROOT / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    _prune_old(slug)
    after = (story_date or date.today()) - timedelta(days=1)

    groups: dict[str, list[dict[str, Any]]] = {}
    for sc in scenes:
        key = str(sc.get("mediaQuery") or sc.get("sourceUrl") or "").strip()
        if key:
            groups.setdefault(key, []).append(sc)

    attached = 0
    for key, group in groups.items():
        query = str(group[0].get("mediaQuery") or "").strip()
        source_url = next((str(s.get("sourceUrl")) for s in group if str(s.get("sourceUrl") or "").startswith("http")), "")
        label = str(group[0].get("mediaLabel") or "").strip()[:24]
        source_host = urlparse(source_url).netloc.removeprefix("www.") if source_url else ""
        sid0 = re.sub(r"[^a-zA-Z0-9_-]", "_", str(group[0].get("id")))

        clip_path = out_dir / f"{sid0}.mp4"
        video = None
        if query:
            video = search_news_video(query, after, log)
            if video and not (clip_path.exists() or download_clip(video, clip_path, log)):
                video = None

        img_path = out_dir / f"{sid0}_img.jpg"
        has_img = img_path.exists() or (bool(source_url) and fetch_article_image(source_url, img_path, log))

        media_slots: list[dict[str, Any]] = []
        if video:
            credit = f"ภาพ: {video['channel']} / YouTube"
            media_slots.append({"type": "video", "src": _rel(clip_path), "credit": credit, "durationSec": CLIP_SEC})
            log(f"[news-media] clip <- {video['id']} ({video['channel']}: {video['title'][:60]})")
        if has_img:
            media_slots.append({"type": "image", "src": _rel(img_path), "credit": f"ภาพ: {source_host}" if source_host else ""})
        elif video:
            frame_path = out_dir / f"{sid0}_frame.jpg"
            if grab_frame(clip_path, frame_path, CLIP_SEC * 0.7):
                media_slots.append({"type": "image", "src": _rel(frame_path), "credit": f"ภาพ: {video['channel']}"})

        for sc, slot in zip(group, media_slots):
            if label:
                slot = {**slot, "label": label}
            sc["media"] = slot
            attached += 1
        log(f"[news-media] story '{key[:50]}': {len(media_slots)} media for {len(group)} scene(s)")

    script_path = job_dir / "script.json"
    tmp = script_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(script, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(script_path)
    return attached


# ---------------------------------------------------------------------------
# Research freshness guard: AI research sometimes returns last year's stories for the same date.
# ---------------------------------------------------------------------------
PUB_PATTERNS = (
    re.compile(r'(?:article:published_time|og:published_time|datePublished|pubdate|publish-date|date)["\'][^>]*?content=["\'](\d{4}-\d{2}-\d{2})', re.I),
    re.compile(r'content=["\'](\d{4}-\d{2}-\d{2})[^"\']*["\'][^>]*(?:article:published_time|datePublished)', re.I),
    re.compile(r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})', re.I),
    re.compile(r'<time[^>]+datetime=["\'](\d{4}-\d{2}-\d{2})', re.I),
)
URL_RE = re.compile(r"https?://[^\s)\]>\"'`]+")
URL_YEAR_RE = re.compile(r"/(20\d{2})[/-](\d{1,2})(?:[/-](\d{1,2}))?(?:[/-]|$)")


def page_published_date(url: str) -> date | None:
    m = URL_YEAR_RE.search(urlparse(url).path)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3) or 1))
        except ValueError:
            pass
    try:
        raw = _http_get(url, 600_000, timeout=12).decode("utf-8", "replace")
    except Exception:
        return None
    for pat in PUB_PATTERNS:
        mm = pat.search(raw)
        if mm:
            try:
                return date.fromisoformat(mm.group(1))
            except ValueError:
                continue
    return None


def split_stories(research_md: str) -> list[tuple[str, str]]:
    parts = re.split(r"(?m)^(#{2,4} .+)$", research_md)
    out: list[tuple[str, str]] = []
    for i in range(1, len(parts) - 1, 2):
        out.append((parts[i].lstrip("# ").strip(), parts[i + 1]))
    return out


def check_research_freshness(research_md: str, story_date: date, log: Log, max_age_days: int = 3) -> tuple[list[str], int]:
    """Return (stale story headings, fresh-or-unverified story count) for stories that cite URLs."""
    stale: list[str] = []
    ok = 0
    for heading, body in split_stories(research_md):
        urls = list(dict.fromkeys(URL_RE.findall(body)))[:3]
        if not urls:
            continue
        dates = [d for d in (page_published_date(u.rstrip(".,")) for u in urls) if d]
        old = [d for d in dates if (story_date - d).days > max_age_days or d.year != story_date.year and (story_date - d).days > 0]
        if dates and len(old) == len(dates):
            stale.append(f"{heading[:90]} (แหล่งข่าวลงวันที่ {', '.join(sorted({d.isoformat() for d in old}))})")
            log(f"[news-fresh] STALE: {heading[:70]} -> {[d.isoformat() for d in dates]}")
        else:
            ok += 1
            log(f"[news-fresh] ok: {heading[:70]} -> {[d.isoformat() for d in dates] or 'unverified'}")
    return stale, ok
