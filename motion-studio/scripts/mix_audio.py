#!/usr/bin/env python3
"""Mix narration, auto-ducked BGM, and timeline SFX into the rendered Remotion MP4.

Offloads FFmpeg audio mastering (sidechaincompress + amix + loudnorm + AAC mux)
to Homelab Agent Hub worker nodes via agent-ctl run --requires ffmpeg.
Falls back to throttled local FFmpeg on homelab ONLY when no worker node is online (rc=3)
or when explicitly configured via STUDIO_OFFLOAD=off / MOTION_REMOTE_MIX=off / MOTION_ALLOW_LOCAL_FALLBACK=1.
"""

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import credit_ledger

AUDIO_ASSETS = "/home/dev/.local/share/motion-studio/assets/audio"
AGENT_CTL_BIN = "/home/dev/.local/bin/agent-ctl"
OFFLOAD_STAGE_ROOT = "/home/dev/.gemini/outputs/offload"


def _is_truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _quote_win_arg(arg: str) -> str:
    if not arg or any(ch in arg for ch in (' ', '\t', '"', ';', '[', ']', '(', ')', ',', "'", '*', '&', '|', '<', '>', '^', '=')):
        escaped = arg.replace('"', '\\"')
        return f'"{escaped}"'
    return arg


def _stage_file(src: str, dst: str, seen_inodes: set[tuple[int, int]]) -> None:
    real_src = os.path.realpath(src)
    st = os.stat(real_src)
    key = (st.st_dev, st.st_ino)
    if key not in seen_inodes:
        try:
            os.link(real_src, dst)
            seen_inodes.add(key)
            return
        except OSError:
            pass
    shutil.copy2(real_src, dst)


def _parse_agent_json(stdout: str) -> dict:
    for line in reversed((stdout or "").strip().splitlines()):
        s = line.strip()
        if s.startswith("{") and s.endswith("}"):
            try:
                data = json.loads(s)
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
    return {}


def _try_offload_mix(
    video_path: str,
    narration_path: str,
    bgm_path: str | None,
    sfx_paths: list[str],
    filter_complex_str: str,
    output_path: str,
) -> tuple[int, str | None, str]:
    """Dispatch FFmpeg audio mix to a worker node.

    Returns (rc, node_label, error_msg):
      0  = succeeded on remote worker
     -1  = offload explicitly disabled via env
      3  = no worker node online (NO_NODE)
     >0  = remote error
    """
    if (
        os.environ.get("STUDIO_OFFLOAD", "").strip().lower() == "off"
        or os.environ.get("MOTION_REMOTE_MIX", "").strip().lower() == "off"
    ):
        return -1, None, "disabled by env"

    if not os.path.exists(AGENT_CTL_BIN):
        return 3, None, f"{AGENT_CTL_BIN} not found"

    os.makedirs(OFFLOAD_STAGE_ROOT, exist_ok=True)
    stage_dir = tempfile.mkdtemp(prefix=".stage_mix_", dir=OFFLOAD_STAGE_ROOT)
    out_dir = tempfile.mkdtemp(prefix=".out_mix_", dir=OFFLOAD_STAGE_ROOT)

    try:
        staged_inputs: list[str] = []
        remote_input_args: list[str] = []
        seen_inodes: set[tuple[int, int]] = set()

        vid_ext = Path(video_path).suffix or ".mp4"
        in_vid = os.path.join(stage_dir, f"in0{vid_ext}")
        _stage_file(video_path, in_vid, seen_inodes)
        staged_inputs.append(in_vid)
        remote_input_args.extend(["-i", f"in0{vid_ext}"])

        nar_ext = Path(narration_path).suffix or ".wav"
        in_nar = os.path.join(stage_dir, f"in1{nar_ext}")
        _stage_file(narration_path, in_nar, seen_inodes)
        staged_inputs.append(in_nar)
        remote_input_args.extend(["-i", f"in1{nar_ext}"])

        next_idx = 2
        if bgm_path:
            bgm_ext = Path(bgm_path).suffix or ".wav"
            bgm_name = f"in{next_idx}{bgm_ext}"
            in_bgm = os.path.join(stage_dir, bgm_name)
            _stage_file(bgm_path, in_bgm, seen_inodes)
            staged_inputs.append(in_bgm)
            remote_input_args.extend(["-stream_loop", "-1", "-i", bgm_name])
            next_idx += 1

        for sp in sfx_paths:
            sfx_ext = Path(sp).suffix or ".wav"
            sfx_name = f"in{next_idx}{sfx_ext}"
            in_sfx = os.path.join(stage_dir, sfx_name)
            _stage_file(sp, in_sfx, seen_inodes)
            staged_inputs.append(in_sfx)
            remote_input_args.extend(["-i", sfx_name])
            next_idx += 1

        fc_path = os.path.join(stage_dir, "fc_mix.txt")
        with open(fc_path, "w", encoding="utf-8") as f:
            f.write(filter_complex_str)
        staged_inputs.append(fc_path)

        remote_argv = [
            *remote_input_args,
            "-filter_complex_script",
            "fc_mix.txt",
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
        ]
        out_ext = Path(output_path).suffix or ".mp4"
        remote_out_name = f"mixed{out_ext}"

        posix_args = " ".join(shlex.quote(a) for a in remote_argv)
        win_args = " ".join(_quote_win_arg(a) for a in remote_argv)

        cmd_posix = f'cd "$LAB_IN_DIR" && ffmpeg -y -hide_banner -v error {posix_args} "$LAB_OUT_DIR/{remote_out_name}"'
        cmd_win = f'cd /d "%LAB_IN_DIR%" && ffmpeg -y -hide_banner -v error {win_args} "%LAB_OUT_DIR%\\{remote_out_name}"'

        max_attempts = 2
        last_rc = 1
        last_err = ""
        for attempt in range(1, max_attempts + 1):
            shutil.rmtree(out_dir, ignore_errors=True)
            os.makedirs(out_dir, exist_ok=True)
            ctl_cmd = [
                AGENT_CTL_BIN,
                "run",
                "--name",
                "motion-mix",
                "--requires",
                "ffmpeg",
            ]
            for si in staged_inputs:
                ctl_cmd.extend(["--input", si])
            ctl_cmd.extend([
                "--cmd-posix",
                cmd_posix,
                "--cmd-win",
                cmd_win,
                "--timeout",
                "300",
                "--out-dir",
                out_dir,
                "--json",
            ])
            proc = subprocess.run(ctl_cmd, capture_output=True, text=True, timeout=360)
            last_rc = proc.returncode
            summary = _parse_agent_json(proc.stdout)
            node_used = str(summary.get("node") or "worker")
            remote_out = os.path.join(out_dir, remote_out_name)

            if last_rc == 0 and os.path.exists(remote_out) and os.path.getsize(remote_out) > 0:
                tmp_dest = f"{output_path}.tmp.{os.getpid()}"
                shutil.copy2(remote_out, tmp_dest)
                os.replace(tmp_dest, output_path)
                return 0, node_used, ""

            last_err = str(summary.get("error") or proc.stderr.strip() or proc.stdout.strip() or f"exit {last_rc}")
            if last_rc == 3:
                return 3, None, last_err
            if attempt < max_attempts:
                time.sleep(3)

        return last_rc or 1, None, last_err
    finally:
        shutil.rmtree(stage_dir, ignore_errors=True)
        shutil.rmtree(out_dir, ignore_errors=True)


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
    valid_sfx_paths: list[str] = []
    for idx, ev in enumerate(sfx_list):
        name = ev["name"]
        sfx_path = name if os.path.exists(name) else os.path.join(AUDIO_ASSETS, f"sfx_{name}.wav")
        if not os.path.exists(sfx_path):
            continue
        inputs.extend(["-i", sfx_path])
        valid_sfx_paths.append(sfx_path)
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
    fc_str = ";".join(filter_parts)

    rc, remote_node, offload_err = _try_offload_mix(
        args.video,
        narration,
        bgm_path if has_bgm else None,
        valid_sfx_paths,
        fc_str,
        args.output,
    )

    offloaded = False
    if rc == 0 and remote_node:
        node_label = remote_node
        offloaded = True
        print(f"[mix-node] {node_label}", file=sys.stderr, flush=True)
    elif rc in (-1, 3) or _is_truthy_env("MOTION_ALLOW_LOCAL_FALLBACK"):
        fb_reason = "explicit local" if rc == -1 else ("no worker online" if rc == 3 else f"fallback rc={rc}")
        node_label = f"homelab ({fb_reason})"
        print(f"[mix-node] {node_label}", file=sys.stderr, flush=True)
        cmd = [
            "nice",
            "-n",
            "15",
            "ffmpeg",
            "-y",
            "-v",
            "error",
            *inputs,
            "-filter_complex",
            fc_str,
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
            "-threads",
            "2",
            args.output,
        ]
        subprocess.run(cmd, check=True, env={**os.environ, "OMP_NUM_THREADS": "2"})
    else:
        print(
            f"[mix-error] ผสมเสียงบนเครื่องลูกข่ายไม่สำเร็จ (rc={rc}): {offload_err[:240]}",
            file=sys.stderr,
            flush=True,
        )
        return rc if rc > 0 else 1

    size_bytes = os.path.getsize(args.output)
    credit_summary = credit_ledger.get_credit_summary()
    print(
        json.dumps(
            {
                "ok": True,
                "output": args.output,
                "node": node_label,
                "offloaded": offloaded,
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
