#!/usr/bin/env python3
"""Mix narration, auto-ducked BGM, and timeline SFX into the rendered Remotion MP4."""

import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import credit_ledger

AUDIO_ASSETS = "/home/dev/.local/share/motion-studio/assets/audio"


def main() -> int:
    parser = argparse.ArgumentParser(description="Mix voiceover + ducked BGM + SFX into final MP4")
    parser.add_argument("video", help="Rendered silent video MP4")
    parser.add_argument("timeline", help="Path to timeline.json")
    parser.add_argument("-o", "--output", required=True, help="Final output MP4 path")
    parser.add_argument("--bgm", default="warm_tech", help="BGM preset name (warm_tech, story_cinematic, dawn_ambient, none, or path)")
    parser.add_argument("--bgm-vol", type=float, default=0.14, help="BGM volume multiplier (default 0.14 ≈ -17dB)")
    parser.add_argument("--duck-db", type=float, default=12.0, help="Sidechain ducking depth in dB when narration speaks (default 12)")
    parser.add_argument("--no-duck", action="store_true", help="Disable sidechain ducking on BGM")
    parser.add_argument("--lufs", type=float, default=-14.0, help="Target integrated loudness in LUFS for loudnorm (default -14)")
    args = parser.parse_args()

    with open(args.timeline, "r", encoding="utf-8") as f:
        tl = json.load(f)

    total_sec = float(tl["totalSec"])
    narration = tl["narrationPath"]
    sfx_list = tl.get("sfx", [])

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    inputs = ["-i", args.video, "-i", narration]
    filter_parts = []
    mix_labels = ["[vo]"]

    bgm_path = ""
    has_bgm = False
    if args.bgm and args.bgm.lower() != "none":
        bgm_path = args.bgm if os.path.exists(args.bgm) else os.path.join(AUDIO_ASSETS, f"bgm_{args.bgm}.wav")
        has_bgm = os.path.exists(bgm_path)

    use_ducking = has_bgm and (not args.no_duck) and (args.duck_db > 0)

    # Voice track (split sidechain key when ducking is active)
    if use_ducking:
        filter_parts.append("[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=1.08,asplit=2[vo][nkey]")
    else:
        filter_parts.append("[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=1.08[vo]")

    next_idx = 2
    # BGM track
    if has_bgm:
        inputs.extend(["-stream_loop", "-1", "-i", bgm_path])
        fade_out_start = max(0.0, total_sec - 2.2)
        filter_parts.append(
            f"[{next_idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,"
            f"atrim=0:{total_sec:.3f},asetpts=PTS-STARTPTS,"
            f"volume={args.bgm_vol:.3f},"
            f"afade=t=in:st=0:d=1.0,afade=t=out:st={fade_out_start:.3f}:d=2.2[bgm]"
        )
        if use_ducking:
            ratio = min(20.0, max(2.0, 2.0 + args.duck_db * 0.5))
            thresh_db = -20.0 - (args.duck_db / (1.0 - 1.0 / ratio))
            threshold = min(0.5, max(0.001, 10.0 ** (thresh_db / 20.0)))
            filter_parts.append(
                f"[bgm][nkey]sidechaincompress=threshold={threshold:.4f}:ratio={ratio:.2f}:attack=20:release=400:makeup=1[bgmduck]"
            )
            mix_labels.append("[bgmduck]")
        else:
            mix_labels.append("[bgm]")
        next_idx += 1

    # SFX events
    for idx, ev in enumerate(sfx_list):
        name = ev["name"]
        sfx_path = name if os.path.exists(name) else os.path.join(AUDIO_ASSETS, f"sfx_{name}.wav")
        if not os.path.exists(sfx_path):
            continue
        inputs.extend(["-i", sfx_path])
        delay_ms = max(0, int(round(float(ev["timeSec"]) * 1000)))
        vol = float(ev.get("volume", 0.30))
        lbl = f"sfx{idx}"
        filter_parts.append(
            f"[{next_idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,"
            f"volume={vol:.3f},adelay={delay_ms}|{delay_ms}[{lbl}]"
        )
        mix_labels.append(f"[{lbl}]")
        next_idx += 1

    filter_parts.append(
        f"{''.join(mix_labels)}amix=inputs={len(mix_labels)}:duration=first:dropout_transition=0:normalize=0,"
        f"alimiter=limit=0.95,loudnorm=I={args.lufs:.1f}:TP=-1.5:LRA=11[aout]"
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        *inputs,
        "-filter_complex",
        ";".join(filter_parts),
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-shortest",
        args.output,
    ]
    subprocess.run(cmd, check=True)
    size_bytes = os.path.getsize(args.output)
    credit_summary = credit_ledger.get_credit_summary()
    print(
        json.dumps(
            {
                "ok": True,
                "output": args.output,
                "sizeBytes": size_bytes,
                "sizeMB": round(size_bytes / (1024 * 1024), 2),
                "durationSec": round(total_sec, 2),
                "bgm": args.bgm,
                "ducking": use_ducking,
                "duckDb": args.duck_db if use_ducking else 0.0,
                "targetLufs": args.lufs,
                "sfxCount": len(sfx_list),
                "ttsCost": tl.get("ttsCost"),
                "credit": {
                    "remainingThb": credit_summary.get("remainingThb"),
                    "lowThb": credit_summary.get("lowThb", 10.0),
                    "isLow": bool(credit_summary.get("isLow")),
                } if credit_summary.get("ok") else None,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
