#!/usr/bin/env python3
"""Fetch real news media (short 5s news clip + article/report photos) for news-mode Studio scenes.

For each story (scenes sharing the same mediaQuery/sourceUrl):
  - 1st scene -> 5s muted highlight clip from a reputable YouTube news report + poster photo for smooth hold after clip ends
  - 2nd scene -> article og:image (falls back to a distinct frame/thumbnail from the news report)
Files go to public/news-media/<job>/ so the Remotion bundle ships them to the render node.
Everything is best-effort: a scene without media simply keeps the normal style visual.
"""

from __future__ import annotations

import html
import io
import json
import math
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
YT_DLP_BIN = str(BASE_DIR / "venv" / "bin" / "yt-dlp")
UVX = "/home/dev/.local/bin/uvx"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
)
CLIP_SEC = 5
WINDOW_SEC = 14
KEEP_JOB_DIRS = 3  # older job media dirs are pruned so the render bundle stays small
MAX_HTML_BYTES = 3_000_000
MAX_IMG_BYTES = 12_000_000

OG_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["\'][^>]*>',
    re.I,
)
CONTENT_RE = re.compile(r'content=["\']([^"\']+)["\']', re.I)
SKIP_IMG_RE = re.compile(r"logo|default|placeholder|favicon|share-image|og-default|avatar|icon", re.I)

TRUSTED_NEWS_CHANNELS = (
    "thaipbs", "thai pbs", "ไทยพีบีเอส",
    "thairath", "ไทยรัฐ",
    "เรื่องเล่าเช้านี้", "ch3", "ช่อง3", "3hd",
    "ch7hd", "ช่อง 7", "สนามข่าว", "เช้านี้ที่หมอชิต",
    "amarintv", "อมรินทร์",
    "pptv", "พีพีทีวี",
    "nation", "เนชั่น",
    "mcot", "สำนักข่าวไทย", "tnamcot",
    "tnn", "ช่อง8", "thai ch8",
    "workpoint", "เวิร์คพอยท์", "ข่าวเวิร์คพอยท์",
    "one31", "ช่องวัน", "ข่าวช่องวัน",
    "the standard", "matichon", "มติชน", "khaosod", "ข่าวสด",
    "prd", "กรมประชาสัมพันธ์", "กรุงเทพธุรกิจ", "ฐานเศรษฐกิจ",
    "reuters", "associated press", "ap archive", "bbc", "al jazeera",
    "cnn", "dw news", "abc news", "cbs news", "nbc news", "cna",
    "bloomberg", "sky news", "france 24", "euronews", "nhk", "wion", "dawnnews",
)

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


def save_image(img_bytes: bytes, out_path: Path, min_w: int = 480, trim_letterbox: bool = False) -> bool:
    from PIL import Image

    with Image.open(io.BytesIO(img_bytes)) as im:
        im = im.convert("RGB")
        w, h = im.size
        if w < min_w or h < 240:
            return False
        if trim_letterbox and abs((w / max(1, h)) - (4 / 3)) < 0.08:
            # Standard 4:3 YouTube hqdefault (480x360) has 45px top/bottom black bars -> crop to 16:9
            bar = int(round(h * 0.125))
            im = im.crop((0, bar, w, h - bar))
            w, h = im.size
        if w > 1600:
            im = im.resize((1600, int(h * 1600 / w)))
        tmp = out_path.with_suffix(".tmp.jpg")
        im.save(tmp, "JPEG", quality=88)
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


def fetch_youtube_thumbnail(video_id: str, out_path: Path, log: Log) -> bool:
    for variant, trim_lb in (("maxresdefault.jpg", False), ("sddefault.jpg", True), ("hqdefault.jpg", True)):
        url = f"https://i.ytimg.com/vi/{video_id}/{variant}"
        try:
            data = _http_get(url, MAX_IMG_BYTES, timeout=12)
            if save_image(data, out_path, min_w=460, trim_letterbox=trim_lb):
                log(f"[news-media] yt-thumb <- {url}")
                return True
        except Exception:
            continue
    return False


def _yt_dlp(args: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    cmd = (
        ["nice", "-n", "15", YT_DLP_BIN, "--no-warnings", "--no-progress", *args]
        if Path(YT_DLP_BIN).exists()
        else ["nice", "-n", "15", UVX, "yt-dlp", "--no-warnings", "--no-progress", *args]
    )
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _score_video_candidate(cand: dict[str, Any]) -> float:
    ch = cand["channel"].lower()
    title = cand["title"].lower()
    score = 0.0
    if any(t in ch for t in TRUSTED_NEWS_CHANNELS):
        score += 50.0
    if any(k in title for k in ("ข่าว", "ด่วน", "news", "report", "breaking")):
        score += 8.0
    if any(bad in title for bad in ("full", "live", "สด", "ย้อนหลังทั้งรายการ", "podcast", "วิเคราะห์ยาว")):
        score -= 12.0
    dur = float(cand.get("duration") or 0.0)
    if 45 <= dur <= 900:
        score += 10.0
    views = max(0, int(cand.get("views") or 0))
    score += min(20.0, math.log10(views + 1) * 3.5)
    return score


def search_news_video(query: str, after: date, log: Log) -> dict[str, Any] | None:
    try:
        res = _yt_dlp(
            [
                "--dateafter", after.strftime("%Y%m%d"),
                "--match-filter", "duration>25 & duration<2400 & !is_live",
                "--print", "%(id)s\t%(duration)s\t%(view_count)s\t%(channel)s\t%(title)s",
                f"ytsearch8:{query}",
            ],
            timeout=150,
        )
    except subprocess.TimeoutExpired:
        log(f"[news-media] video search timeout: {query}")
        return None
    candidates: list[dict[str, Any]] = []
    for line in res.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) >= 5 and re.fullmatch(r"[\w-]{11}", parts[0]):
            try:
                dur = float(parts[1])
            except ValueError:
                continue
            try:
                views = int(parts[2])
            except ValueError:
                views = 0
            cand = {
                "id": parts[0],
                "duration": dur,
                "views": views,
                "channel": parts[3].strip(),
                "title": parts[4].strip(),
            }
            cand["score"] = _score_video_candidate(cand)
            candidates.append(cand)
    if candidates:
        candidates.sort(key=lambda c: c["score"], reverse=True)
        return candidates[0]
    log(f"[news-media] no recent video for '{query}' (rc={res.returncode} {res.stderr.strip()[-160:]})")
    return None


def _frame_visual_richness(img_path: Path) -> float:
    """Score a frame so we prefer real camera footage over blank/solid/text-slide cards."""
    try:
        from PIL import Image, ImageStat

        with Image.open(img_path) as im:
            small = im.convert("RGB").resize((160, 90))
            stat = ImageStat.Stat(small)
            stddev = sum(stat.stddev) / 3.0
            mean_luma = sum(stat.mean) / 3.0
            # Penalize nearly solid white (>232) or pitch black (<20) graphic slides
            penalty = 0.35 if (mean_luma > 228 or mean_luma < 20) else 1.0
            return stddev * penalty
    except Exception:
        return 0.0


def grab_frame(clip: Path, out_path: Path, at_sec: float) -> bool:
    res = subprocess.run(
        [
            "nice", "-n", "15", "ffmpeg", "-v", "error", "-y", "-threads", "2",
            "-ss", f"{max(0.0, at_sec):.2f}", "-i", str(clip),
            "-frames:v", "1", "-q:v", "3", str(out_path),
        ],
        capture_output=True,
        timeout=60,
    )
    return res.returncode == 0 and out_path.exists() and out_path.stat().st_size > 5_000


def download_clip(video: dict[str, Any], out_path: Path, poster_path: Path, extra_frame_path: Path, log: Log) -> bool:
    dur = float(video["duration"])
    # Skip anchor intro desk: start ~28% in (at least 18s), download a 14s window and pick the richest 5s sub-clip
    win_dur = min(WINDOW_SEC, max(CLIP_SEC + 1, int(dur - 4)))
    start = max(18.0, dur * 0.28)
    start = min(start, max(0.0, dur - win_dur - 2))
    raw_dir = out_path.parent / f".dl_{out_path.stem}"
    raw_dir.mkdir(exist_ok=True)
    try:
        res = _yt_dlp(
            [
                "-q",
                "-f", "bv*[height<=720][vcodec^=avc1]/bv*[height<=720]/b[height<=720]",
                "--download-sections", f"*{int(start)}-{int(start) + win_dur}",
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
        raw_clip = raws[0]

        # Probe 3 candidate offsets inside the downloaded window to pick the visually richest 5s cut
        best_off = 0.0
        best_score = -1.0
        probe_offsets = [0.5, max(0.5, (win_dur - CLIP_SEC) * 0.5), max(0.5, win_dur - CLIP_SEC - 0.5)]
        scored_frames: list[tuple[float, float, Path]] = []
        for idx, off in enumerate(probe_offsets):
            cand_jpg = raw_dir / f"probe_{idx}.jpg"
            if grab_frame(raw_clip, cand_jpg, min(win_dur - 0.5, off + 1.5)):
                sc = _frame_visual_richness(cand_jpg)
                scored_frames.append((sc, off, cand_jpg))
                if sc > best_score:
                    best_score = sc
                    best_off = off

        # Encode crisp 5-second muted 720p H.264 sub-clip
        tmp = out_path.with_suffix(".tmp.mp4")
        enc = subprocess.run(
            [
                "nice", "-n", "15", "ffmpeg", "-v", "error", "-y", "-threads", "2",
                "-ss", f"{best_off:.2f}", "-i", str(raw_clip), "-t", str(CLIP_SEC), "-an",
                "-vf", "scale=1280:-2,fps=30", "-c:v", "libx264", "-preset", "veryfast",
                "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(tmp),
            ],
            capture_output=True,
            text=True,
            timeout=180,
        )
        if enc.returncode != 0 or not tmp.exists() or tmp.stat().st_size < 15_000:
            log(f"[news-media] clip encode failed: {enc.stderr.strip()[-200:]}")
            tmp.unlink(missing_ok=True)
            return False
        tmp.replace(out_path)

        # Save poster frame (near end of the 5s clip so video->photo crossfade feels continuous)
        if not grab_frame(out_path, poster_path, max(0.5, CLIP_SEC - 0.25)):
            grab_frame(out_path, poster_path, 1.0)

        # Save a distinct second frame from another part of the raw window for Scene 2 fallback
        alt_off = max(0.5, win_dur - 1.2) if best_off < win_dur * 0.4 else 0.8
        if not grab_frame(raw_clip, extra_frame_path, alt_off):
            if poster_path.exists():
                shutil.copyfile(poster_path, extra_frame_path)
        return True
    except subprocess.TimeoutExpired:
        log(f"[news-media] clip timeout {video['id']}")
        return False
    finally:
        shutil.rmtree(raw_dir, ignore_errors=True)


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
        urls = [
            str(s.get("sourceUrl")).strip()
            for s in group
            if str(s.get("sourceUrl") or "").strip().startswith("http")
        ]
        source_url = urls[0] if urls else ""
        label = str(group[0].get("mediaLabel") or "").strip()[:24]
        source_host = urlparse(source_url).netloc.removeprefix("www.") if source_url else ""
        sid0 = re.sub(r"[^a-zA-Z0-9_-]", "_", str(group[0].get("id")))

        clip_path = out_dir / f"{sid0}.mp4"
        poster_path = out_dir / f"{sid0}_poster.jpg"
        extra_frame_path = out_dir / f"{sid0}_frame2.jpg"
        video = None
        if query:
            video = search_news_video(query, after, log)
            if video:
                if clip_path.exists() and poster_path.exists():
                    pass
                elif not download_clip(video, clip_path, poster_path, extra_frame_path, log):
                    video = None

        img_path = out_dir / f"{sid0}_img.jpg"
        has_img = img_path.exists()
        if not has_img:
            for u in dict.fromkeys(urls):
                if fetch_article_image(u, img_path, log):
                    has_img = True
                    source_host = urlparse(u).netloc.removeprefix("www.")
                    break

        media_slots: list[dict[str, Any]] = []
        if video and clip_path.exists():
            credit = f"วิดีโอข่าว: {video['channel']}"
            slot1: dict[str, Any] = {
                "type": "video",
                "src": _rel(clip_path),
                "credit": credit,
                "durationSec": CLIP_SEC,
            }
            if poster_path.exists():
                slot1["poster"] = _rel(poster_path)
            elif has_img:
                slot1["poster"] = _rel(img_path)
            media_slots.append(slot1)
            log(f"[news-media] clip <- {video['id']} ({video['channel']}: {video['title'][:60]})")

        if has_img:
            media_slots.append(
                {
                    "type": "image",
                    "src": _rel(img_path),
                    "credit": f"ภาพข่าว: {source_host}" if source_host else "ภาพประกอบข่าว",
                }
            )
        elif video:
            thumb_path = out_dir / f"{sid0}_thumb.jpg"
            if extra_frame_path.exists():
                media_slots.append(
                    {
                        "type": "image",
                        "src": _rel(extra_frame_path),
                        "credit": f"ภาพข่าว: {video['channel']}",
                    }
                )
            elif fetch_youtube_thumbnail(video["id"], thumb_path, log):
                media_slots.append(
                    {
                        "type": "image",
                        "src": _rel(thumb_path),
                        "credit": f"ภาพข่าว: {video['channel']}",
                    }
                )

        # If only 1 image was found (no video) and story has 2 scenes, share it across both scenes with different pan
        if len(media_slots) == 1 and len(group) >= 2 and media_slots[0]["type"] == "image":
            media_slots.append({**media_slots[0]})

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
