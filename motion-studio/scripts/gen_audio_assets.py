#!/usr/bin/env python3
"""Generate clean, pleasant, 100% royalty-free synthesized BGM and SFX WAV assets."""

import argparse
import math
import os
import random
import struct
import wave

OUT_DIR = "/home/dev/.local/share/motion-studio/assets/audio"
SR = 44100


def write_wav(path: str, samples: list[float], stereo: bool = True) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "w") as wf:
        wf.setnchannels(2 if stereo else 1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        frames = bytearray()
        if stereo:
            for l_val, r_val in samples:
                li = max(-32767, min(32767, int(l_val * 32767)))
                ri = max(-32767, min(32767, int(r_val * 32767)))
                frames.extend(struct.pack("<hh", li, ri))
        else:
            for val in samples:
                vi = max(-32767, min(32767, int(val * 32767)))
                frames.extend(struct.pack("<h", vi))
        wf.writeframes(frames)


def note_freq(midi: int) -> float:
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def gen_bgm_warm_tech(duration_sec: float = 32.0) -> list[tuple[float, float]]:
    """Warm, modern explainer marimba + soft pad progression (Cmaj9 -> Am9 -> Fmaj9 -> G6), seamless loop."""
    n = int(SR * duration_sec)
    buf_l = [0.0] * n
    buf_r = [0.0] * n

    # 120 BPM => 0.5s per beat, 4 bars per chord = 2s, 4 chords = 8s cycle (4 cycles = 32s)
    chords = [
        [48, 55, 60, 64, 67, 71],  # Cmaj9
        [45, 52, 57, 60, 64, 67],  # Am7
        [41, 48, 53, 57, 60, 64],  # Fmaj7
        [43, 50, 55, 59, 62, 64],  # G6
    ]
    arp_pattern = [2, 3, 4, 5, 4, 3, 2, 4]  # 8 eighth-notes per 2s chord

    # Soft warm pad across chords
    for c_idx in range(int(duration_sec // 2)):
        chord = chords[c_idx % len(chords)]
        start_s = c_idx * 2.0
        s0 = int(start_s * SR)
        s1 = min(n, int((start_s + 2.15) * SR))
        freqs = [note_freq(m) for m in chord[:4]]
        for i in range(s0, s1):
            t = (i - s0) / SR
            env = min(1.0, t / 0.25) * max(0.0, min(1.0, (2.15 - t) / 0.35))
            val_l = 0.0
            val_r = 0.0
            for fi, f in enumerate(freqs):
                # Subtle stereo detune
                val_l += math.sin(2.0 * math.pi * f * t) * (0.28 if fi == 0 else 0.16)
                val_r += math.sin(2.0 * math.pi * (f * 1.0015) * t + 0.4) * (0.28 if fi == 0 else 0.16)
            buf_l[i] += val_l * env * 0.22
            buf_r[i] += val_r * env * 0.22

        # Gentle marimba/pluck arpeggio
        for step, note_idx in enumerate(arp_pattern):
            t_note = start_s + step * 0.25
            ns0 = int(t_note * SR)
            ns1 = min(n, int((t_note + 0.42) * SR))
            f = note_freq(chord[note_idx] + (12 if step % 4 == 3 else 0))
            pan = 0.35 if step % 2 == 0 else 0.65
            for i in range(ns0, ns1):
                t = (i - ns0) / SR
                env = min(1.0, t / 0.006) * math.exp(-t * 9.5)
                tone = (
                    0.75 * math.sin(2.0 * math.pi * f * t)
                    + 0.20 * math.sin(2.0 * math.pi * f * 2.0 * t) * math.exp(-t * 14.0)
                    + 0.05 * math.sin(2.0 * math.pi * f * 3.0 * t) * math.exp(-t * 20.0)
                )
                amp = tone * env * 0.20
                buf_l[i] += amp * (1.0 - pan) * 1.4
                buf_r[i] += amp * pan * 1.4

        # Subtle muted pulse on beat 1 & 3
        for beat in (0.0, 1.0):
            ks0 = int((start_s + beat) * SR)
            ks1 = min(n, int((start_s + beat + 0.14) * SR))
            for i in range(ks0, ks1):
                t = (i - ks0) / SR
                f_k = 110.0 * math.exp(-t * 24.0) + 48.0
                env = math.exp(-t * 26.0)
                val = math.sin(2.0 * math.pi * f_k * t) * env * 0.16
                buf_l[i] += val
                buf_r[i] += val

    # Normalize gently to -3dB peak
    peak = max(max(abs(x) for x in buf_l), max(abs(x) for x in buf_r), 1e-6)
    scale = 0.72 / peak
    return [(buf_l[i] * scale, buf_r[i] * scale) for i in range(n)]


def gen_bgm_story_cinematic(duration_sec: float = 32.0) -> list[tuple[float, float]]:
    """Gentle storytelling documentary pad + crystalline piano-bell motif (Dm9 -> Bbmaj7 -> Fmaj7 -> Csus4)."""
    n = int(SR * duration_sec)
    buf_l = [0.0] * n
    buf_r = [0.0] * n
    chords = [
        [50, 57, 62, 65, 69],  # Dm9
        [46, 53, 58, 62, 65],  # Bbmaj7
        [41, 48, 53, 57, 60],  # Fmaj7
        [48, 55, 60, 62, 67],  # Csus2
    ]
    for c_idx in range(int(duration_sec // 4)):
        chord = chords[c_idx % len(chords)]
        start_s = c_idx * 4.0
        s0 = int(start_s * SR)
        s1 = min(n, int((start_s + 4.3) * SR))
        freqs = [note_freq(m) for m in chord[:4]]
        for i in range(s0, s1):
            t = (i - s0) / SR
            env = min(1.0, t / 0.6) * max(0.0, min(1.0, (4.3 - t) / 0.7))
            vl = sum(math.sin(2.0 * math.pi * f * t) * (0.26 if idx == 0 else 0.15) for idx, f in enumerate(freqs))
            vr = sum(math.sin(2.0 * math.pi * (f * 1.0018) * t + 0.5) * (0.26 if idx == 0 else 0.15) for idx, f in enumerate(freqs))
            buf_l[i] += vl * env * 0.25
            buf_r[i] += vr * env * 0.25

        # Sparse bell motif
        for step, midi in enumerate([chord[2] + 12, chord[3] + 12, chord[4] + 12, chord[3] + 12]):
            ns0 = int((start_s + step * 1.0) * SR)
            ns1 = min(n, int((start_s + step * 1.0 + 1.1) * SR))
            f = note_freq(midi)
            pan = 0.35 + 0.1 * step
            for i in range(ns0, ns1):
                t = (i - ns0) / SR
                env = min(1.0, t / 0.01) * math.exp(-t * 3.8)
                v = (math.sin(2.0 * math.pi * f * t) + 0.25 * math.sin(4.0 * math.pi * f * t) * math.exp(-t * 8)) * env * 0.18
                buf_l[i] += v * (1.0 - pan) * 1.3
                buf_r[i] += v * pan * 1.3

    peak = max(max(abs(x) for x in buf_l), max(abs(x) for x in buf_r), 1e-6)
    scale = 0.70 / peak
    return [(buf_l[i] * scale, buf_r[i] * scale) for i in range(n)]


def gen_bgm_dawn_ambient(duration_sec: float = 40.0) -> list[tuple[float, float]]:
    """Warm dawn ambient pad drone + soft morning breeze (no drums, no rhythm, no prominent melody), seamless loop at ~-6dBFS."""
    n = int(SR * duration_sec)
    xfade_sec = 2.0
    xfade_n = int(SR * xfade_sec)
    total_n = n + xfade_n

    # Dsus2 warm open pad (D2, A2, D3, E3, A3, E4) — pure serene drone, no rhythm
    pad_notes = [
        (38, 0.28),  # D2
        (45, 0.22),  # A2
        (50, 0.20),  # D3
        (52, 0.14),  # E3
        (57, 0.12),  # A3
        (64, 0.06),  # E4
    ]
    freqs = [(note_freq(midi), wt) for midi, wt in pad_notes]

    rng = random.Random(108)
    lp_pad_l = 0.0
    lp_pad_r = 0.0
    lp_wind1_l = 0.0
    lp_wind2_l = 0.0
    lp_wind1_r = 0.0
    lp_wind2_r = 0.0

    buf_l = [0.0] * total_n
    buf_r = [0.0] * total_n

    for i in range(total_n):
        t = i / SR
        # Very slow breathing LFOs for amplitude and filter
        amp_lfo_l = 0.78 + 0.22 * math.sin(2.0 * math.pi * 0.075 * t)
        amp_lfo_r = 0.78 + 0.22 * math.sin(2.0 * math.pi * 0.075 * t + 1.1)
        filt_lfo = 0.5 + 0.5 * math.sin(2.0 * math.pi * 0.05 * t + 0.4)

        raw_l = 0.0
        raw_r = 0.0
        for idx, (f, wt) in enumerate(freqs):
            phase_l = 2.0 * math.pi * f * t + idx * 0.37
            phase_r = 2.0 * math.pi * (f * 1.0012) * t + idx * 0.61
            # Soft sine + gentle warm triangle blend (low harmonic saturation)
            tri_l = (2.0 / math.pi) * math.asin(math.sin(phase_l))
            tri_r = (2.0 / math.pi) * math.asin(math.sin(phase_r))
            tone_l = 0.78 * math.sin(phase_l) + 0.22 * tri_l
            tone_r = 0.78 * math.sin(phase_r) + 0.22 * tri_r
            raw_l += tone_l * wt
            raw_r += tone_r * wt

        # Slow LFO lowpass filter on pad
        pad_alpha = 0.025 + 0.045 * filt_lfo
        lp_pad_l += pad_alpha * (raw_l - lp_pad_l)
        lp_pad_r += pad_alpha * (raw_r - lp_pad_r)

        # Gentle morning breeze (cascaded lowpass noise with slow swell)
        nl = rng.uniform(-1.0, 1.0)
        nr = rng.uniform(-1.0, 1.0)
        wind_alpha = 0.012 + 0.020 * (0.5 + 0.5 * math.sin(2.0 * math.pi * 0.0625 * t + 1.7))
        lp_wind1_l += wind_alpha * (nl - lp_wind1_l)
        lp_wind2_l += wind_alpha * (lp_wind1_l - lp_wind2_l)
        lp_wind1_r += wind_alpha * (nr - lp_wind1_r)
        lp_wind2_r += wind_alpha * (lp_wind1_r - lp_wind2_r)

        wind_gain = 0.38 * (0.7 + 0.3 * math.sin(2.0 * math.pi * 0.0875 * t))
        buf_l[i] = lp_pad_l * amp_lfo_l * 0.85 + lp_wind2_l * wind_gain
        buf_r[i] = lp_pad_r * amp_lfo_r * 0.85 + lp_wind2_r * wind_gain

    # Seamless 2-second equal-power crossfade between tail extra and head
    for i in range(xfade_n):
        ang = 0.5 * math.pi * (i / xfade_n)
        w_head = math.sin(ang)
        w_tail = math.cos(ang)
        buf_l[i] = buf_l[i] * w_head + buf_l[n + i] * w_tail
        buf_r[i] = buf_r[i] * w_head + buf_r[n + i] * w_tail

    out_l = buf_l[:n]
    out_r = buf_r[:n]
    peak = max(max(abs(x) for x in out_l), max(abs(x) for x in out_r), 1e-6)
    # Peak around -6 dBFS (10**(-6/20) ~= 0.501)
    scale = 0.50 / peak
    return [(out_l[i] * scale, out_r[i] * scale) for i in range(n)]


def gen_sfx_pop() -> list[tuple[float, float]]:
    dur = 0.16
    n = int(SR * dur)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / SR
        freq = 320.0 + 520.0 * (1.0 - math.exp(-t * 40.0)) * math.exp(-t * 14.0)
        phase += 2.0 * math.pi * freq / SR
        env = min(1.0, t / 0.004) * math.exp(-t * 28.0)
        v = math.sin(phase) * env * 0.85
        out.append((v, v))
    return out


def gen_sfx_whoosh() -> list[tuple[float, float]]:
    dur = 0.34
    n = int(SR * dur)
    rng = random.Random(42)
    lp = 0.0
    out = []
    for i in range(n):
        t = i / SR
        p = t / dur
        env = math.sin(math.pi * p) ** 1.6
        cutoff = 0.03 + 0.24 * math.sin(math.pi * p)
        noise = rng.uniform(-1.0, 1.0)
        lp = lp + cutoff * (noise - lp)
        tone = math.sin(2.0 * math.pi * (160.0 + 260.0 * p) * t) * 0.18
        v = (lp * 1.4 + tone) * env * 0.65
        pan = 0.25 + 0.5 * p
        out.append((v * (1.0 - pan) * 1.3, v * pan * 1.3))
    return out


def gen_sfx_chime() -> list[tuple[float, float]]:
    dur = 0.65
    n = int(SR * dur)
    freqs = [note_freq(72), note_freq(76), note_freq(79), note_freq(84)]  # C5 E5 G5 C6
    out = []
    for i in range(n):
        t = i / SR
        v = 0.0
        for idx, f in enumerate(freqs):
            dt = t - idx * 0.055
            if dt > 0:
                env = min(1.0, dt / 0.005) * math.exp(-dt * 6.5)
                v += (math.sin(2.0 * math.pi * f * dt) + 0.2 * math.sin(4.0 * math.pi * f * dt)) * env * 0.28
        out.append((v, v))
    return out


def gen_sfx_spark() -> list[tuple[float, float]]:
    dur = 0.42
    n = int(SR * dur)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / SR
        p = t / dur
        f = 220.0 + 660.0 * (p ** 1.3)
        phase += 2.0 * math.pi * f / SR
        env = min(1.0, t / 0.02) * math.exp(-t * 6.0)
        mod = 1.0 + 0.25 * math.sin(2.0 * math.pi * 50.0 * t)
        v = (math.sin(phase) * 0.6 + math.sin(phase * 2.0) * 0.25) * mod * env * 0.65
        out.append((v, v))
    return out


def gen_sfx_click() -> list[tuple[float, float]]:
    dur = 0.06
    n = int(SR * dur)
    out = []
    for i in range(n):
        t = i / SR
        env = math.exp(-t * 90.0)
        v = (math.sin(2.0 * math.pi * 1200.0 * t) * 0.6 + math.sin(2.0 * math.pi * 2400.0 * t) * 0.4) * env * 0.75
        out.append((v, v))
    return out


def gen_sfx_riser() -> list[tuple[float, float]]:
    """1.5s airy upward noise sweep + subtle harmonic swell for scene transitions."""
    dur = 1.5
    n = int(SR * dur)
    rng = random.Random(77)
    lp_l = 0.0
    lp_r = 0.0
    phase = 0.0
    raw = []
    for i in range(n):
        t = i / SR
        p = t / dur
        # Smooth build up peaking around p=0.90, then clean tail fade
        if p < 0.90:
            env = (p / 0.90) ** 1.9
        else:
            env = math.cos(0.5 * math.pi * (p - 0.90) / 0.10)
        cutoff = 0.015 + 0.38 * (p ** 2.1)
        nl = rng.uniform(-1.0, 1.0)
        nr = rng.uniform(-1.0, 1.0)
        lp_l += cutoff * (nl - lp_l)
        lp_r += cutoff * (nr - lp_r)

        freq = 140.0 + 480.0 * (p ** 2.0)
        phase += 2.0 * math.pi * freq / SR
        tone = math.sin(phase) * 0.22 + math.sin(phase * 1.5) * 0.10
        raw.append(((lp_l * 1.15 + tone) * env, (lp_r * 1.15 + tone) * env))

    peak = max(max(abs(l), abs(r)) for l, r in raw) or 1e-6
    scale = 0.70 / peak
    return [(l * scale, r * scale) for l, r in raw]


def gen_sfx_shimmer() -> list[tuple[float, float]]:
    """1.2s crystalline high sine cluster with gentle stereo detune and decay."""
    dur = 1.2
    n = int(SR * dur)
    # D5, A5, E6, F#6, A6, D7
    notes = [74, 81, 88, 90, 93, 98]
    freqs = [note_freq(m) for m in notes]
    raw = []
    for i in range(n):
        t = i / SR
        tail_fade = 1.0 if t < dur - 0.12 else max(0.0, (dur - t) / 0.12)
        vl = 0.0
        vr = 0.0
        for idx, f in enumerate(freqs):
            dt = t - idx * 0.032
            if dt > 0.0:
                env = min(1.0, dt / 0.025) * math.exp(-dt * (3.2 + idx * 0.35))
                shimmer_lfo = 0.85 + 0.15 * math.sin(2.0 * math.pi * (5.5 + idx * 0.7) * dt)
                vl += math.sin(2.0 * math.pi * f * dt + idx * 0.4) * env * shimmer_lfo
                vr += math.sin(2.0 * math.pi * (f * 1.0025) * dt + idx * 0.8) * env * shimmer_lfo
        raw.append((vl * tail_fade, vr * tail_fade))

    peak = max(max(abs(l), abs(r)) for l, r in raw) or 1e-6
    scale = 0.68 / peak
    return [(l * scale, r * scale) for l, r in raw]


def gen_sfx_soft_impact() -> list[tuple[float, float]]:
    """0.8s warm, gentle sub boom for soft emphasis without harsh transient."""
    dur = 0.8
    n = int(SR * dur)
    rng = random.Random(91)
    lp = 0.0
    phase = 0.0
    raw = []
    for i in range(n):
        t = i / SR
        tail_fade = 1.0 if t < dur - 0.08 else max(0.0, (dur - t) / 0.08)
        freq = 42.0 + 78.0 * math.exp(-t * 14.0)
        phase += 2.0 * math.pi * freq / SR
        env_sub = min(1.0, t / 0.008) * math.exp(-t * 4.8)
        sub = math.sin(phase) * env_sub

        # Very soft lowpassed air thump
        lp += 0.035 * (rng.uniform(-1.0, 1.0) - lp)
        env_air = min(1.0, t / 0.006) * math.exp(-t * 12.0)
        v = (sub * 0.85 + lp * env_air * 0.45) * tail_fade
        raw.append((v, v))

    peak = max(max(abs(l), abs(r)) for l, r in raw) or 1e-6
    scale = 0.75 / peak
    return [(l * scale, r * scale) for l, r in raw]


ASSET_REGISTRY = {
    "warm_tech": ("bgm_warm_tech.wav", lambda: gen_bgm_warm_tech(32.0)),
    "story_cinematic": ("bgm_story_cinematic.wav", lambda: gen_bgm_story_cinematic(32.0)),
    "dawn_ambient": ("bgm_dawn_ambient.wav", lambda: gen_bgm_dawn_ambient(40.0)),
    "pop": ("sfx_pop.wav", gen_sfx_pop),
    "whoosh": ("sfx_whoosh.wav", gen_sfx_whoosh),
    "chime": ("sfx_chime.wav", gen_sfx_chime),
    "spark": ("sfx_spark.wav", gen_sfx_spark),
    "click": ("sfx_click.wav", gen_sfx_click),
    "riser": ("sfx_riser.wav", gen_sfx_riser),
    "shimmer": ("sfx_shimmer.wav", gen_sfx_shimmer),
    "soft_impact": ("sfx_soft_impact.wav", gen_sfx_soft_impact),
}


def resolve_asset_key(raw_name: str) -> str:
    key = raw_name.strip().lower()
    if key.endswith(".wav"):
        key = key[:-4]
    if key in ASSET_REGISTRY:
        return key
    for prefix in ("bgm_", "sfx_"):
        if key.startswith(prefix) and key[len(prefix) :] in ASSET_REGISTRY:
            return key[len(prefix) :]
    raise ValueError(f"Unknown audio asset name: {raw_name!r}. Valid: {', '.join(ASSET_REGISTRY.keys())}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate royalty-free BGM and SFX WAV assets")
    parser.add_argument(
        "--only",
        default="",
        help="Comma-separated asset names to generate (e.g. dawn_ambient,riser,shimmer,soft_impact)",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing WAV files")
    args = parser.parse_args()

    if args.only.strip():
        keys = [resolve_asset_key(x) for x in args.only.split(",") if x.strip()]
    else:
        keys = list(ASSET_REGISTRY.keys())

    generated = []
    skipped = []
    for key in keys:
        filename, gen_fn = ASSET_REGISTRY[key]
        out_path = os.path.join(OUT_DIR, filename)
        if os.path.exists(out_path) and not args.force:
            skipped.append(filename)
            continue
        write_wav(out_path, gen_fn())
        generated.append(filename)

    print(f"Generated {len(generated)} assets ({', '.join(generated) or 'none'}), skipped {len(skipped)} existing ({', '.join(skipped) or 'none'}) in {OUT_DIR}")


if __name__ == "__main__":
    main()
