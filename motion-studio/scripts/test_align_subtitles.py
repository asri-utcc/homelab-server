#!/usr/bin/env python3
"""Unit test for detect_pauses() and align_subtitles() in tts_pipeline.py.

Builds a synthetic WAV via ffmpeg lavfi (sine 1.0s, silence 0.6s, sine 1.5s, silence 0.5s, sine 1.0s),
runs detect_pauses + align_subtitles with 3 cues of unequal Thai character length, and verifies every
internal cue boundary is within 0.3s of the real pause midpoints (1.3s and 3.35s).
"""

import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tts_pipeline as tp


def build_synthetic_wav(wav_path: str) -> None:
    """Create: sine 1.0s + silence 0.6s + sine 1.5s + silence 0.5s + sine 1.0s (total 4.6s)."""
    filter_complex = (
        "aevalsrc=0.5*sin(2*PI*440*t):d=1.0:s=44100[s1];"
        "anullsrc=r=44100:cl=mono,atrim=duration=0.6[p1];"
        "aevalsrc=0.5*sin(2*PI*523*t):d=1.5:s=44100[s2];"
        "anullsrc=r=44100:cl=mono,atrim=duration=0.5[p2];"
        "aevalsrc=0.5*sin(2*PI*659*t):d=1.0:s=44100[s3];"
        "[s1][p1][s2][p2][s3]concat=n=5:v=0:a=1[out]"
    )
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-filter_complex",
            filter_complex,
            "-map",
            "[out]",
            "-ar",
            "44100",
            "-ac",
            "1",
            wav_path,
        ],
        check=True,
    )


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="test_align_") as tmpdir:
        wav_path = os.path.join(tmpdir, "synthetic.wav")
        build_synthetic_wav(wav_path)
        dur = tp.ffprobe_duration(wav_path)
        pauses = tp.detect_pauses(wav_path)

        # Unequal character lengths so proportional split drifts significantly from real pauses
        subtitles = [
            {"text": "ความสงบในใจเริ่มต้นวันนี้เสมอไป", "highlight": "ความสงบ"},   # long (~31 chars) -> prop end ~2.1s
            {"text": "สั้นนิดเดียว", "highlight": ""},                              # short (~12 chars) -> prop end ~2.9s
            {"text": "และคำสอนนี้จะนำพาชีวิตให้มั่นคง", "highlight": "มั่นคง"},      # long (~31 chars)
        ]

        fps = 30
        start_sec = 0.0
        prop_cues = tp.distribute_subtitles(subtitles, dur, start_sec, fps)
        aligned_cues = tp.align_subtitles(subtitles, dur, start_sec, fps, pauses, boundaries=None)

        expected_mids = [1.30, 3.35]

        print(f"Synthetic WAV duration: {dur:.3f}s")
        print(f"Detected pauses: {[(round(a, 3), round(b, 3)) for a, b in pauses]}")
        print("\n--- BEFORE (distribute_subtitles / proportional) ---")
        for i, c in enumerate(prop_cues):
            print(f"  Cue {i}: {c['startSec']:.3f}s -> {c['endSec']:.3f}s | {c['text']}")
        print("\n--- AFTER (align_subtitles / pause-aligned) ---")
        for i, c in enumerate(aligned_cues):
            print(
                f"  Cue {i}: {c['startSec']:.3f}s -> {c['endSec']:.3f}s "
                f"[aligned={c['aligned']}] | {c['text']}"
            )

        assert len(pauses) == 2, f"Expected 2 pauses, got {pauses}"
        assert len(aligned_cues) == 3, f"Expected 3 cues, got {len(aligned_cues)}"
        assert all(c["aligned"] == "pause" for c in aligned_cues), f"Expected all cues aligned='pause': {aligned_cues}"

        # Verify every internal cue boundary is within 0.3s of the real pause midpoints (1.3s and 3.35s)
        for i, mid in enumerate(expected_mids):
            end_err = abs(aligned_cues[i]["endSec"] - mid)
            start_err = abs(aligned_cues[i + 1]["startSec"] - mid)
            prop_err = abs(prop_cues[i]["endSec"] - mid)
            print(
                f"\nBoundary {i + 1} (real pause mid={mid:.2f}s): "
                f"before(prop) err={prop_err:.3f}s | "
                f"after cue[{i}].end err={end_err:.3f}s, cue[{i+1}].start err={start_err:.3f}s"
            )
            assert end_err <= 0.30 + 1e-9, f"Cue {i} endSec {aligned_cues[i]['endSec']} too far from {mid} (err={end_err:.3f}s)"
            assert start_err <= 0.30 + 1e-9, f"Cue {i+1} startSec {aligned_cues[i+1]['startSec']} too far from {mid} (err={start_err:.3f}s)"

        # Verify leading silence shifts first cue start
        leading_cues = tp.align_subtitles(subtitles, dur, 0.0, fps, [(0.0, 0.35), (1.0, 1.6), (3.1, 3.6)])
        assert leading_cues[0]["startSec"] == 0.35, f"Expected leading start 0.35, got {leading_cues[0]['startSec']}"

        # Verify Edge WordBoundary path
        edge_wb = [
            {"type": "WordBoundary", "offsetSec": 0.0, "durationSec": 0.9, "text": "ความสงบในใจเริ่มต้นวันนี้เสมอไป"},
            {"type": "WordBoundary", "offsetSec": 1.2, "durationSec": 1.4, "text": "สั้นนิดเดียว"},
            {"type": "WordBoundary", "offsetSec": 3.2, "durationSec": 1.4, "text": "และคำสอนนี้จะนำพาชีวิตให้มั่นคง"},
        ]
        edge_cues = tp.align_subtitles(subtitles, dur, 0.0, fps, [], boundaries=edge_wb)
        assert all(c["aligned"] == "edge" for c in edge_cues), f"Expected edge alignment: {edge_cues}"

        # Verify proportional fallback when no pauses and no WordBoundary
        fallback_cues = tp.align_subtitles(subtitles, dur, 0.0, fps, [], boundaries=None)
        assert all(c["aligned"] == "proportional" for c in fallback_cues), f"Expected proportional: {fallback_cues}"

        # Also verify non-zero start_sec offset handling
        offset = 2.5
        shifted = tp.align_subtitles(subtitles, dur, offset, fps, pauses, boundaries=None)
        for c0, c1 in zip(aligned_cues, shifted):
            assert abs((c1["startSec"] - offset) - c0["startSec"]) < 0.002
            assert abs((c1["endSec"] - offset) - c0["endSec"]) < 0.002

        # Verify detect_pauses never crashes on missing file
        assert tp.detect_pauses(os.path.join(tmpdir, "does_not_exist.wav")) == []

        print("\nALL ASSERTIONS PASSED!")


if __name__ == "__main__":
    main()
