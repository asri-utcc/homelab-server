#!/usr/bin/env python3
"""Audio-first Thai TTS pipeline supporting:
  - Google Gemini 2.5 Flash / Pro TTS (`gemini:Aoede`, `gemini:Sulafat`, `gemini:Charon`, ...)
  - Local VachanaTTS via stt-service (`vachana:th_f_1`, `vachana:th_m_1`, ...)
  - Microsoft Edge Neural TTS (`th-TH-PremwadeeNeural`, `en-US-AvaMultilingualNeural`, ...)
Plus gentle tail-preserving silence trim, Studio Vocal Mastering, exact ffprobe durations,
and frame-accurate timeline.json + subtitles.srt output.
"""

import argparse
import asyncio
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from typing import Any

import edge_tts

import credit_ledger

TTS_ENV_PATH = "/home/dev/projects/.tts.env"
GEMINI_ENV_PATH = "/home/dev/.gemini/.env"
GEMINI_SETTINGS_PATH = "/home/dev/.gemini/settings.json"
STT_SERVICE_URL = os.environ.get("STT_SERVICE_URL", "http://127.0.0.1:8096")

DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-preview-tts"
GEMINI_MODELS = (
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-pro-preview-tts",
)

# Curated Gemini 2.5 TTS voice directory (subset of Google's 30 prebuilt studio voices)
GEMINI_VOICE_PRESETS = {
    "Aoede": "หญิง · อบอุ่น นุ่มนวล เป็นธรรมชาติ (แนะนำทั่วไป/แรงบันดาลใจ)",
    "Sulafat": "หญิง · อ่อนโยน มีอารมณ์ความรู้สึก สงบ (แนะนำเนื้อหาศาสนา/อบอุ่น)",
    "Kore": "หญิง · ชัดถ้อยชัดคำ มั่นใจ (แนะนำคลิปอธิบายความรู้/เทคโนโลยี)",
    "Leda": "หญิง · อ่อนหวาน ผ่อนคลาย น่าฟัง",
    "Zephyr": "หญิง · สดใส กระฉับกระเฉง เป็นกันเอง",
    "Vindemiatrix": "หญิง · นุ่มลึก สุภาพ ละมุนแบบผู้ใหญ่",
    "Charon": "ชาย · สุขุม นุ่มลึก มีพลัง (แนะนำสารคดี/The Story Room)",
    "Algenib": "ชาย · ทุ้มต่ำ เข้ม แมน สุขุมนุ่มลึก",
    "Alnilam": "ชาย · หนักแน่น มั่นคง น่าเกรงขาม",
    "Puck": "ชาย · สดใส มีชีวิตชีวา เล่าเรื่องสนุก",
    "Orus": "ชาย · หนักแน่น ชัดเจน น่าเชื่อถือ",
    "Enceladus": "ชาย · ทุ้มนุ่ม เบาสบาย มีลมหายใจธรรมชาติ",
    "Fenrir": "ชาย · กระตือรือร้น มีจังหวะจะโคน",
}

STYLE_PROMPTS = {
    "gravitas": (
        "Narrate as a mature, confident, masculine Thai male narrator with a low, "
        "resonant baritone chest voice. Speak fluently at a natural, crisp, engaging "
        "Thai narration pace (~14-15 syllables per second) with only brief natural "
        "breaths between clauses and NO long dramatic pauses or dragging syllables. "
        "Keep the voice grounded, authoritative, and warm—never breathy-soft or "
        "high-pitched. Pronounce Thai and Arabic-origin terms clearly and respectfully."
    ),
    "documentary": (
        "Narrate in warm, composed, studio-quality Thai documentary voiceover style. "
        "Speak smoothly with natural human breathing, clear articulation, gentle phrasing pauses "
        "at commas and clause boundaries, and rich emotional depth. Never rush or sound robotic."
    ),
    "spiritual": (
        "Narrate in a deeply calm, gentle, warm, and reverent Thai voiceover tone suitable for "
        "inspirational Islamic spiritual reflection. Keep the pacing unhurried and heartfelt, "
        "with soft natural breaths, tender warmth, and clear respectful pronunciation of Thai "
        "and Arabic-origin terms. Never sound hurried, harsh, or synthetic."
    ),
    "explainer": (
        "Narrate in a clear, engaging, friendly, and confident Thai explainer voiceover style. "
        "Maintain crisp diction, lively yet smooth cadence, and natural short pauses to emphasize "
        "key concepts so listeners stay hooked from start to finish."
    ),
    "storytelling": (
        "Narrate in an expressive, captivating Thai storytelling voice like a top YouTube/TikTok "
        "narrator. Vary pitch subtly for curiosity and warmth, pause naturally before reveals, "
        "and speak as if sharing a fascinating story with a close friend."
    ),
    "warm": (
        "Narrate in a deeply warm, soft, soothing, and intimate Thai voice with unhurried pacing, "
        "gentle human pauses, and comforting sincerity."
    ),
}

MASTER_FILTERS = {
    "none": "",
    "light": (
        "highpass=f=70,"
        "equalizer=f=200:t=q:w=1.1:g=1.2,"
        "equalizer=f=6800:t=q:w=1.2:g=-1.0,"
        "acompressor=threshold=-18dB:ratio=1.8:attack=18:release=180:makeup=1.2"
    ),
    "studio": (
        "highpass=f=75,"
        "equalizer=f=220:t=q:w=1.2:g=2.2,"
        "equalizer=f=3600:t=q:w=1.5:g=-2.4,"
        "equalizer=f=7500:t=q:w=1.0:g=-1.6,"
        "acompressor=threshold=-18dB:ratio=2.2:attack=15:release=180:makeup=1.8"
    ),
}


TTS_LEDGER_PATH = "/home/dev/.gemini/gemini-tts-ledger.jsonl"


def _log_tts_usage(model: str, usage: dict) -> dict[str, int]:
    """Append token usage of one successful Gemini TTS call (dashboard computes credit balance from this)."""
    rec = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "model": model,
        "promptTokens": int(usage.get("promptTokenCount") or 0),
        "outputTokens": int(usage.get("candidatesTokenCount") or 0),
        "thoughtsTokens": int(usage.get("thoughtsTokenCount") or 0),
    }
    try:
        with open(TTS_LEDGER_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception:
        pass
    return {
        "promptTokens": rec["promptTokens"],
        "outputTokens": rec["outputTokens"],
        "thoughtsTokens": rec["thoughtsTokens"],
    }


def find_gemini_api_key() -> tuple[str, str]:
    """Locate GEMINI_API_KEY from sanctioned environment or config files. Returns (key, source)."""
    for env_name in ("GEMINI_TTS_API_KEY", "GEMINI_API_KEY"):
        val = os.environ.get(env_name, "").strip()
        if len(val) > 10:
            return val, f"env:{env_name}"
    for env_path in (TTS_ENV_PATH, GEMINI_ENV_PATH):
        if os.path.exists(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        m = re.match(
                            r'^(?:GEMINI_TTS_API_KEY|GEMINI_API_KEY)=["\']?([^"\'\s#]+)["\']?',
                            line.strip(),
                        )
                        if m and len(m.group(1)) > 10:
                            return m.group(1), env_path
            except OSError:
                pass
    if os.path.exists(GEMINI_SETTINGS_PATH):
        try:
            with open(GEMINI_SETTINGS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                k = str(data.get("apiKey") or "").strip()
                if len(k) > 10:
                    return k, GEMINI_SETTINGS_PATH
        except Exception:
            pass
    return "", ""


def ffprobe_duration(path: str) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        text=True,
    ).strip()
    return float(out)


def fmt_srt_time(sec: float) -> str:
    ms_total = max(0, int(round(sec * 1000)))
    h = ms_total // 3600000
    m = (ms_total % 3600000) // 60000
    s = (ms_total % 60000) // 1000
    ms = ms_total % 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _parse_pcm_rate(mime_type: str) -> int:
    m = re.search(r"rate=(\d+)", mime_type or "", re.IGNORECASE)
    return int(m.group(1)) if m else 24000


def _synth_gemini_sync(
    text: str,
    voice_name: str,
    model: str,
    style_prompt: str,
    api_key: str,
    out_raw_wav: str,
    timeout_sec: int = 45,
) -> dict[str, Any]:
    """Call Google Gemini 2.5 TTS REST API and write raw 24kHz mono WAV. Returns usage dict."""
    director_prompt = (
        f"{style_prompt.strip()}\n"
        "Read ONLY the exact script below aloud in Thai without adding commentary, "
        "greetings, or extra words:\n\n"
        f"{text}"
    )
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )
    payload = {
        "contents": [{"parts": [{"text": director_prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice_name,
                    }
                }
            },
        },
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    last_err: Exception | None = None
    # Gentle backoff handles AI Studio Free Tier RPM limits smoothly
    for attempt, wait_s in enumerate((6.0, 15.0, 30.0, 60.0), 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            candidates = data.get("candidates") or []
            parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
            inline = next((p.get("inlineData") for p in parts if p.get("inlineData")), None)
            if not inline or not inline.get("data"):
                finish = candidates[0].get("finishReason") if candidates else "NO_CANDIDATE"
                raise RuntimeError(f"Gemini TTS returned no audio data (finishReason={finish})")

            usage_rec = _log_tts_usage(model, data.get("usageMetadata") or {})
            raw_audio = base64.b64decode(inline["data"])
            mime = (inline.get("mimeType") or "").lower()
            if "wav" in mime:
                with open(out_raw_wav, "wb") as f:
                    f.write(raw_audio)
            else:
                sample_rate = _parse_pcm_rate(mime)
                with wave.open(out_raw_wav, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(sample_rate)
                    wf.writeframes(raw_audio)
            return {
                "model": model,
                **usage_rec,
            }
        except urllib.error.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8", errors="replace")[:400]
            except Exception:
                pass
            # Auth / bad key / invalid voice errors should fail immediately
            if e.code in (400, 401, 403, 404):
                raise RuntimeError(f"Gemini TTS HTTP {e.code}: {err_body}") from e
            # 429 or 5xx: retry with backoff
            retry_after = e.headers.get("Retry-After") if e.headers else None
            delay = float(retry_after) if (retry_after and retry_after.isdigit()) else wait_s
            last_err = RuntimeError(f"Gemini TTS HTTP {e.code}: {err_body}")
            if attempt < 4:
                time.sleep(delay)
        except Exception as e:
            last_err = e
            if attempt < 4:
                time.sleep(wait_s)

    raise RuntimeError(f"Gemini TTS failed after retries: {last_err}")


def _synth_vachana_sync(text: str, voice_id: str, style: str, out_mp3: str) -> None:
    """Synthesize via local stt-service VachanaTTS endpoint."""
    st_map = {"documentary": "calm", "spiritual": "warm", "explainer": "natural", "storytelling": "natural", "warm": "warm"}
    payload = json.dumps(
        {"text": text, "voice": voice_id, "style": st_map.get(style, "natural")},
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{STT_SERVICE_URL.rstrip('/')}/tts",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        data = resp.read()
    if len(data) < 512:
        raise RuntimeError("Local stt-service VachanaTTS returned empty audio")
    with open(out_mp3, "wb") as f:
        f.write(data)


async def _synth_edge_once(text: str, voice: str, rate: str, pitch: str) -> tuple[bytes, list[dict]]:
    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch)
    boundaries: list[dict] = []
    audio_bytes = bytearray()
    async for chunk in communicate.stream():
        ctype = chunk.get("type")
        if ctype == "audio":
            audio_bytes.extend(chunk["data"])
        elif ctype in ("WordBoundary", "SentenceBoundary"):
            boundaries.append(
                {
                    "type": ctype,
                    "offsetSec": chunk["offset"] / 10_000_000.0,
                    "durationSec": chunk["duration"] / 10_000_000.0,
                    "text": chunk.get("text", ""),
                }
            )
    if len(audio_bytes) < 512:
        raise RuntimeError("Empty audio response from edge-tts")
    return bytes(audio_bytes), boundaries


async def synth_scene(
    spoken_text: str,
    raw_audio_path: str,
    voice: str,
    rate: str,
    pitch: str,
    model: str,
    style: str,
    custom_prompt: str,
    gemini_delay: float,
    allow_fallback: bool,
) -> tuple[list[dict], str, dict[str, Any]]:
    """Synthesize a single scene to raw_audio_path (.wav or .mp3). Returns (word_boundaries, engine_used, usage_cost)."""
    style_prompt = custom_prompt.strip() or STYLE_PROMPTS.get(style, STYLE_PROMPTS["documentary"])
    sig_src = f"{voice}|{model}|{rate}|{pitch}|{style_prompt}|{spoken_text}"
    sig = hashlib.sha256(sig_src.encode("utf-8")).hexdigest()[:16]
    sig_file = raw_audio_path + ".sig"
    bnd_file = raw_audio_path + ".bnd.json"
    usage_file = raw_audio_path + ".usage.json"

    if os.path.exists(raw_audio_path) and os.path.getsize(raw_audio_path) > 1024 and os.path.exists(sig_file):
        if open(sig_file, "r", encoding="utf-8").read().strip() == sig:
            cached_bnd = []
            if os.path.exists(bnd_file):
                try:
                    cached_bnd = json.load(open(bnd_file, "r", encoding="utf-8"))
                except Exception:
                    cached_bnd = []
            cached_usage: dict[str, Any] = {"cached": True, "costUsd": 0.0, "costThb": 0.0, "inputTokens": 0, "outputTokens": 0, "thoughtsTokens": 0}
            if os.path.exists(usage_file):
                try:
                    u = json.load(open(usage_file, "r", encoding="utf-8"))
                    if isinstance(u, dict):
                        cached_usage = {**u, "cached": True}
                except Exception:
                    pass
            return cached_bnd, "cache", cached_usage

    # 1) Google Gemini 2.5 Flash / Pro TTS
    if voice.startswith("gemini:"):
        g_voice = voice.split(":", 1)[1].strip() or "Aoede"
        api_key, _ = find_gemini_api_key()
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY not found. Set GEMINI_API_KEY in /home/dev/projects/.tts.env "
                "or /home/dev/.gemini/.env (get a free key at https://aistudio.google.com/apikey)."
            )
        usage_raw = await asyncio.to_thread(
            _synth_gemini_sync,
            spoken_text,
            g_voice,
            model,
            style_prompt,
            api_key,
            raw_audio_path,
        )
        cost_info = credit_ledger.calc_usage_cost(
            model,
            usage_raw.get("promptTokens", 0),
            usage_raw.get("outputTokens", 0),
            usage_raw.get("thoughtsTokens", 0),
        )
        cost_info["cached"] = False
        try:
            with open(usage_file, "w", encoding="utf-8") as f:
                json.dump(cost_info, f, ensure_ascii=False)
        except OSError:
            pass
        with open(sig_file, "w", encoding="utf-8") as f:
            f.write(sig)
        if gemini_delay > 0:
            await asyncio.sleep(gemini_delay)
        return [], f"gemini:{model}", cost_info

    # 2) Local VachanaTTS via stt-service
    if voice.startswith("vachana:"):
        await asyncio.to_thread(_synth_vachana_sync, spoken_text, voice, style, raw_audio_path)
        with open(sig_file, "w", encoding="utf-8") as f:
            f.write(sig)
        return [], "vachana", {"cached": False, "costUsd": 0.0, "costThb": 0.0, "inputTokens": 0, "outputTokens": 0, "thoughtsTokens": 0}

    # 3) Microsoft Edge Neural TTS
    last_err: Exception | None = None
    for wait_s in (1.5, 4.0, 8.0, 12.0):
        try:
            data, boundaries = await _synth_edge_once(spoken_text, voice, rate, pitch)
            with open(raw_audio_path, "wb") as f:
                f.write(data)
            with open(sig_file, "w", encoding="utf-8") as f:
                f.write(sig)
            with open(bnd_file, "w", encoding="utf-8") as f:
                json.dump(boundaries, f, ensure_ascii=False)
            await asyncio.sleep(1.5)
            return boundaries, "edge-tts", {"cached": False, "costUsd": 0.0, "costThb": 0.0, "inputTokens": 0, "outputTokens": 0, "thoughtsTokens": 0}
        except Exception as e:
            last_err = e
            await asyncio.sleep(wait_s)

    if not allow_fallback:
        raise RuntimeError(f"edge-tts failed for voice={voice}: {last_err}")

    try:
        from gtts import gTTS  # type: ignore

        tts = gTTS(text=spoken_text, lang="th", slow=False)
        tts.save(raw_audio_path)
        with open(sig_file, "w", encoding="utf-8") as f:
            f.write(sig + "_gtts")
        return [], "gtts-fallback", {"cached": False, "costUsd": 0.0, "costThb": 0.0, "inputTokens": 0, "outputTokens": 0, "thoughtsTokens": 0}
    except Exception as gtts_err:
        raise RuntimeError(f"edge-tts failed ({last_err}) and gTTS fallback failed ({gtts_err})")


def _build_atempo_filters(speed: float) -> list[str]:
    """Build FFmpeg atempo filter chain supporting any positive speed multiplier."""
    if abs(speed - 1.0) <= 0.005:
        return []
    s = max(0.25, min(4.0, float(speed)))
    filters: list[str] = []
    while s > 2.0:
        filters.append("atempo=2.0")
        s /= 2.0
    while s < 0.5:
        filters.append("atempo=0.5")
        s /= 0.5
    filters.append(f"atempo={s:.4f}")
    return filters


def postprocess_scene_audio(
    raw_path: str, wav_path: str, master_preset: str, speed: float = 1.0
) -> float:
    """Gentle tail-preserving silence trim + optional tempo + vocal mastering chain -> 44.1kHz stereo WAV."""
    # Gentle silence trim (-52dB) trims dead air while preserving soft breath tails and word endings
    trim_chain = (
        "silenceremove=start_periods=1:start_threshold=-52dB:start_silence=0.04,"
        "areverse,"
        "silenceremove=start_periods=1:start_threshold=-52dB:start_silence=0.12,"
        "areverse"
    )
    master_eq = MASTER_FILTERS.get(master_preset, "")
    parts = [trim_chain]
    parts.extend(_build_atempo_filters(speed))
    if master_eq:
        parts.append(master_eq)
    parts.append("afade=t=in:st=0:d=0.015")

    tmp_wav = wav_path + ".tmp.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            raw_path,
            "-af",
            ",".join(parts),
            "-ar",
            "44100",
            "-ac",
            "2",
            tmp_wav,
        ],
        check=True,
    )
    dur = ffprobe_duration(tmp_wav)
    # Smooth 30ms fade-out at tail so no abrupt click/cutoff ever occurs
    fade_start = max(0.0, dur - 0.030)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            tmp_wav,
            "-af",
            f"afade=t=out:st={fade_start:.3f}:d=0.030",
            "-ar",
            "44100",
            "-ac",
            "2",
            wav_path,
        ],
        check=True,
    )
    try:
        os.remove(tmp_wav)
    except OSError:
        pass
    return ffprobe_duration(wav_path)


def distribute_subtitles(subtitles: list[dict], speech_dur: float, start_sec: float, fps: int) -> list[dict]:
    """Distribute scene subtitle cues proportionally by Thai character length across actual spoken duration."""
    if not subtitles:
        return []
    weights = [max(4, len(item["text"].replace(" ", ""))) for item in subtitles]
    total_w = sum(weights)
    cues = []
    cursor = start_sec
    for idx, (item, w) in enumerate(zip(subtitles, weights)):
        dur = speech_dur * (w / total_w)
        end = start_sec + speech_dur if idx == len(subtitles) - 1 else cursor + dur
        cues.append(
            {
                "text": item["text"],
                "highlight": item.get("highlight", ""),
                "startSec": round(cursor, 3),
                "endSec": round(end, 3),
                "startFrame": int(round(cursor * fps)),
                "endFrame": int(round(end * fps)),
            }
        )
        cursor = end
    return cues


async def run_pipeline(args: argparse.Namespace) -> dict[str, Any]:
    with open(args.script, "r", encoding="utf-8") as f:
        spec = json.load(f)

    fps = int(spec.get("fps", args.fps))
    voice = args.voice or spec.get("voice", "th-TH-PremwadeeNeural")
    model = args.model or spec.get("ttsModel", DEFAULT_GEMINI_MODEL)
    style = args.style or spec.get("ttsStyle", "documentary")
    global_prompt = args.prompt or spec.get("ttsPrompt", "")
    rate = args.rate or spec.get("rate", "+5%")
    pitch = args.pitch or spec.get("pitch", "+0Hz")
    speed = float(args.speed if args.speed is not None else spec.get("speed", 1.0))
    lead_in_sec = float(spec.get("leadInSec", 0.35))
    hold_end_sec = float(spec.get("holdEndSec", 1.2))

    # Default mastering: 'light' for Gemini (already warm/studio) and 'studio' for Edge/Vachana
    if args.master:
        master_preset = args.master
    elif spec.get("masterPreset"):
        master_preset = str(spec["masterPreset"])
    else:
        master_preset = "light" if voice.startswith("gemini:") else "studio"

    os.makedirs(args.output, exist_ok=True)
    scenes_dir = os.path.join(args.output, "scenes_audio")
    os.makedirs(scenes_dir, exist_ok=True)

    timeline_scenes = []
    all_cues = []
    sfx_events = []
    filter_parts = []
    inputs = []
    engines_used: list[str] = []
    scene_usages: list[dict[str, Any]] = []

    raw_ext = ".raw.wav" if voice.startswith("gemini:") else ".mp3"
    cursor_sec = lead_in_sec

    for idx, sc in enumerate(spec["scenes"]):
        sid = sc["id"]
        raw_path = os.path.join(scenes_dir, f"{idx:02d}_{sid}{raw_ext}")
        wav_path = os.path.join(scenes_dir, f"{idx:02d}_{sid}.wav")

        # Separate spoken phonetic script from display text when provided
        spoken_text = (sc.get("narrationPhonetic") or sc["narration"]).strip()
        scene_prompt = (sc.get("ttsPrompt") or global_prompt).strip()

        boundaries, eng, usage_info = await synth_scene(
            spoken_text=spoken_text,
            raw_audio_path=raw_path,
            voice=voice,
            rate=rate,
            pitch=pitch,
            model=model,
            style=style,
            custom_prompt=scene_prompt,
            gemini_delay=args.gemini_delay,
            allow_fallback=not args.no_fallback,
        )
        engines_used.append(eng)
        scene_usages.append(usage_info)

        speech_dur = postprocess_scene_audio(raw_path, wav_path, master_preset, speed=speed)

        # Ensure KaraokeSubtitle always receives a clean timing boundary even for Gemini/Vachana
        if not boundaries:
            boundaries = [
                {
                    "type": "SentenceBoundary",
                    "offsetSec": 0.0,
                    "durationSec": round(speech_dur, 3),
                    "text": sc["narration"],
                }
            ]

        pad_after = float(sc.get("padAfterSec", 0.45))
        if idx == len(spec["scenes"]) - 1:
            pad_after = max(pad_after, hold_end_sec)

        scene_start = cursor_sec - (lead_in_sec if idx == 0 else 0.0)
        speech_start = cursor_sec
        scene_end = speech_start + speech_dur + pad_after

        raw_subs = sc.get("subtitles") or [{"text": sc["narration"], "highlight": ""}]
        cues = distribute_subtitles(raw_subs, speech_dur, speech_start, fps)
        all_cues.extend(cues)

        for ev in sc.get("sfx", []):
            sfx_events.append(
                {
                    "name": ev["name"],
                    "timeSec": round(scene_start + float(ev.get("offsetSec", 0.0)), 3),
                    "volume": float(ev.get("volume", 0.35)),
                }
            )

        inputs.extend(["-i", wav_path])
        delay_ms = int(round(speech_start * 1000))
        filter_parts.append(f"[{idx}:a]adelay={delay_ms}|{delay_ms}[a{idx}]")

        start_frame = int(round(scene_start * fps))
        end_frame = int(round(scene_end * fps))
        timeline_scenes.append(
            {
                "id": sid,
                "index": idx,
                "badge": sc.get("badge", f"{idx + 1:02d}"),
                "title": sc.get("title", ""),
                "subtitle": sc.get("subtitle", ""),
                "source": sc.get("source", ""),
                "arabic": sc.get("arabic", ""),
                "arabicMeaning": sc.get("arabicMeaning", ""),
                "narration": sc["narration"],
                "audioPath": wav_path,
                "startSec": round(scene_start, 3),
                "speechStartSec": round(speech_start, 3),
                "speechDurSec": round(speech_dur, 3),
                "endSec": round(scene_end, 3),
                "startFrame": start_frame,
                "durationFrames": max(1, end_frame - start_frame),
                "endFrame": end_frame,
                "cues": cues,
                "wordBoundaries": boundaries,
            }
        )
        cursor_sec = scene_end

    # Contiguous frames with zero gaps
    for i in range(len(timeline_scenes) - 1):
        timeline_scenes[i]["endFrame"] = timeline_scenes[i + 1]["startFrame"]
        timeline_scenes[i]["durationFrames"] = timeline_scenes[i]["endFrame"] - timeline_scenes[i]["startFrame"]

    total_sec = timeline_scenes[-1]["endSec"]
    total_frames = timeline_scenes[-1]["endFrame"]

    narration_wav = os.path.join(args.output, "narration_full.wav")
    mix_inputs = "".join(f"[a{i}]" for i in range(len(timeline_scenes)))
    filter_complex = (
        ";".join(filter_parts)
        + f";{mix_inputs}amix=inputs={len(timeline_scenes)}:duration=longest:normalize=0,"
        f"apad=whole_dur={total_sec:.3f},atrim=0:{total_sec:.3f},loudnorm=I=-16:TP=-1.5:LRA=11[out]"
    )
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            *inputs,
            "-filter_complex",
            filter_complex,
            "-map",
            "[out]",
            "-ar",
            "44100",
            "-ac",
            "2",
            narration_wav,
        ],
        check=True,
    )

    srt_path = os.path.join(args.output, "subtitles.srt")
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, cue in enumerate(all_cues, 1):
            f.write(f"{i}\n{fmt_srt_time(cue['startSec'])} --> {fmt_srt_time(cue['endSec'])}\n{cue['text']}\n\n")

    run_usd = sum(float(u.get("costUsd") or 0.0) for u in scene_usages if not u.get("cached"))
    run_thb = sum(float(u.get("costThb") or 0.0) for u in scene_usages if not u.get("cached"))
    clip_usd = sum(float(u.get("costUsd") or 0.0) for u in scene_usages)
    clip_thb = sum(float(u.get("costThb") or 0.0) for u in scene_usages)
    run_in_tok = sum(int(u.get("inputTokens") or 0) for u in scene_usages if not u.get("cached"))
    run_out_tok = sum(int(u.get("outputTokens") or 0) for u in scene_usages if not u.get("cached"))
    clip_in_tok = sum(int(u.get("inputTokens") or 0) for u in scene_usages)
    clip_out_tok = sum(int(u.get("outputTokens") or 0) for u in scene_usages)
    api_calls = sum(1 for u, eng in zip(scene_usages, engines_used) if not u.get("cached") and eng.startswith("gemini:"))
    cached_scenes = sum(1 for u in scene_usages if u.get("cached"))

    tts_cost = {
        "engine": f"gemini:{model}" if voice.startswith("gemini:") else ("vachana" if voice.startswith("vachana:") else "edge-tts"),
        "thisRunThb": round(run_thb, 2),
        "thisRunUsd": round(run_usd, 4),
        "clipTotalThb": round(clip_thb, 2),
        "clipTotalUsd": round(clip_usd, 4),
        "apiCalls": api_calls,
        "cachedScenes": cached_scenes,
        "inputTokens": clip_in_tok,
        "outputTokens": clip_out_tok,
        "thisRunInputTokens": run_in_tok,
        "thisRunOutputTokens": run_out_tok,
    }

    credit_summary = credit_ledger.get_credit_summary()
    alert_res = credit_ledger.maybe_send_low_credit_alert(credit_summary, source="motion-studio-tts") if api_calls > 0 else {"alerted": False, "reason": "no_gemini_calls"}

    timeline = {
        "title": spec.get("title", ""),
        "fps": fps,
        "width": int(spec.get("width", 1080)),
        "height": int(spec.get("height", 1920)),
        "voice": voice,
        "ttsModel": model if voice.startswith("gemini:") else None,
        "ttsStyle": style,
        "masterPreset": master_preset,
        "rate": rate,
        "speed": round(speed, 3),
        "totalSec": round(total_sec, 3),
        "totalFrames": total_frames,
        "narrationPath": narration_wav,
        "srtPath": srt_path,
        "ttsCost": tts_cost,
        "scenes": timeline_scenes,
        "cues": all_cues,
        "sfx": sfx_events,
    }
    timeline_path = os.path.join(args.output, "timeline.json")
    with open(timeline_path, "w", encoding="utf-8") as f:
        json.dump(timeline, f, ensure_ascii=False, indent=2)

    timeline["_enginesUsed"] = engines_used
    timeline["_credit"] = {
        "remainingThb": credit_summary.get("remainingThb"),
        "lowThb": credit_summary.get("lowThb", 10.0),
        "isLow": bool(credit_summary.get("isLow")),
        "lowAlertSent": bool(alert_res.get("alerted")),
    }
    return timeline


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate Thai voiceover (Gemini 2.5 TTS / VachanaTTS / Edge-TTS) and frame-accurate timeline"
    )
    parser.add_argument("script", nargs="?", help="Path to script.json")
    parser.add_argument("-o", "--output", help="Output working directory")
    parser.add_argument(
        "--voice",
        default=None,
        help="Voice ID: gemini:Aoede, gemini:Sulafat, gemini:Charon, vachana:th_f_1, or Edge voice",
    )
    parser.add_argument(
        "--model",
        default=None,
        help=f"Gemini TTS model ({', '.join(GEMINI_MODELS)}; default {DEFAULT_GEMINI_MODEL})",
    )
    parser.add_argument(
        "--style",
        default=None,
        choices=sorted(STYLE_PROMPTS.keys()),
        help="Voiceover tone preset for Gemini/Vachana (documentary, spiritual, explainer, storytelling, warm)",
    )
    parser.add_argument("--prompt", default="", help="Custom Gemini director style instruction override")
    parser.add_argument(
        "--master",
        default=None,
        choices=["light", "studio", "none"],
        help="Vocal mastering preset (default: light for Gemini, studio for Edge/Vachana)",
    )
    parser.add_argument("--rate", default=None, help="Edge-TTS speech rate (e.g. +6%%)")
    parser.add_argument("--pitch", default=None, help="Edge-TTS pitch adjustment (e.g. +0Hz)")
    parser.add_argument("--speed", type=float, default=None, help="Post-TTS pitch-preserving speed multiplier (e.g. 1.12)")
    parser.add_argument("--fps", type=int, default=30, help="Target FPS")
    parser.add_argument(
        "--gemini-delay",
        type=float,
        default=2.5,
        help="Seconds to pause between Gemini TTS scene calls to stay under RPM limits (default 2.5)",
    )
    parser.add_argument("--no-fallback", action="store_true", help="Disable gTTS fallback on Edge-TTS failure")
    parser.add_argument("--list-voices", action="store_true", help="Print curated Gemini 2.5 TTS voices and exit")
    args = parser.parse_args()

    if args.list_voices:
        key, src = find_gemini_api_key()
        print(
            json.dumps(
                {
                    "ok": True,
                    "geminiConfigured": bool(key),
                    "keySource": src or None,
                    "models": list(GEMINI_MODELS),
                    "styles": list(STYLE_PROMPTS.keys()),
                    "geminiVoices": [
                        {"id": f"gemini:{k}", "desc": v} for k, v in GEMINI_VOICE_PRESETS.items()
                    ],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    if not args.script or not args.output:
        parser.error("script and -o/--output are required (or use --list-voices)")

    tl = asyncio.run(run_pipeline(args))
    summary = {
        "ok": True,
        "voice": tl["voice"],
        "ttsModel": tl["ttsModel"],
        "ttsStyle": tl["ttsStyle"],
        "masterPreset": tl["masterPreset"],
        "speed": tl["speed"],
        "enginesUsed": tl.get("_enginesUsed", []),
        "ttsCost": tl.get("ttsCost"),
        "credit": tl.get("_credit"),
        "totalSec": tl["totalSec"],
        "totalFrames": tl["totalFrames"],
        "sceneCount": len(tl["scenes"]),
        "timeline": os.path.join(args.output, "timeline.json"),
        "narration": tl["narrationPath"],
        "srt": tl["srtPath"],
        "scenes": [
            {"id": s["id"], "startSec": s["startSec"], "endSec": s["endSec"], "frames": s["durationFrames"]}
            for s in tl["scenes"]
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
