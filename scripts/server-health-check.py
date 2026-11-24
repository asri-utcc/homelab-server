#!/usr/bin/env python3
"""Smart Homelab Linux server health probe with live per-PID/container attribution,
sustained-load verification, rolling history, and cooldown/recovery state tracking.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import pwd
import re
import socket
import subprocess
import sys
import time
from datetime import datetime

NOTIFY_SCRIPT = "/home/dev/projects/notify-telegram.py"
PM2_BIN = "/usr/local/bin/pm2"
STATE_FILE = "/tmp/server_health_state.json"
HISTORY_FILE = "/tmp/server_health_history.jsonl"
HISTORY_MAX_LINES = 288  # 24h at 5-minute intervals
ALERT_COOLDOWN_SEC = 1800  # 30 minutes before re-alerting on unchanged ongoing issue

THRESHOLDS = {
    "cpu_percent": 75.0,       # sustained average CPU% across samples
    "iowait_percent": 20.0,    # sustained I/O wait%
    "load_5m_per_core": 1.25,  # e.g. 5.0 on 4 cores
    "load_1m_per_core": 2.0,   # e.g. 8.0 on 4 cores (requires elevated 5m or CPU)
    "ram_percent": 85.0,
    "swap_percent": 85.0,  # Alert when swap is nearly exhausted (>=85%) or paired with high RAM (>=70%)
    "temp_c": 75.0,
    "disk_percent": 85.0,
    "inode_percent": 85.0,
    "d_state_procs": 4,
    "zombie_procs": 5,
    "pm2_cpu_percent": 65.0,
    "pm2_mem_mb": 2500.0,
    "docker_cpu_percent": 150.0,  # container % across all cores (e.g. >1.5 cores)
    "docker_mem_percent": 85.0,
}

# Per-process PM2 memory overrides (MB) - e.g. AI models that naturally require more memory
PM2_MEM_THRESHOLDS: dict[str, float] = {
    "whisper-stt": 4000.0,  # Faster-Whisper + VachanaTTS models take ~2.5-3.5 GB
}

DISK_MOUNTS = ["/", "/var", "/home", "/boot"]
CLK_TCK = os.sysconf("SC_CLK_TCK")


def _esc(val: object) -> str:
    return html.escape(str(val), quote=False)


def read_proc_stat() -> dict[str, int]:
    """Read aggregate CPU jiffies from /proc/stat."""
    with open("/proc/stat", "r", encoding="utf-8") as f:
        parts = f.readline().split()
    vals = [int(x) for x in parts[1:]]
    # user, nice, system, idle, iowait, irq, softirq, steal
    while len(vals) < 8:
        vals.append(0)
    return {
        "user": vals[0] + vals[1],
        "system": vals[2] + vals[5],
        "idle": vals[3],
        "iowait": vals[4],
        "softirq": vals[6],
        "steal": vals[7],
        "total": sum(vals),
    }


def compute_cpu_breakdown(s1: dict[str, int], s2: dict[str, int]) -> dict[str, float]:
    dt = max(1, s2["total"] - s1["total"])
    idle_dt = (s2["idle"] - s1["idle"]) + (s2["iowait"] - s1["iowait"])
    return {
        "total": round(100.0 * max(0, dt - idle_dt) / dt, 1),
        "user": round(100.0 * max(0, s2["user"] - s1["user"]) / dt, 1),
        "system": round(100.0 * max(0, s2["system"] - s1["system"]) / dt, 1),
        "iowait": round(100.0 * max(0, s2["iowait"] - s1["iowait"]) / dt, 1),
        "softirq": round(100.0 * max(0, s2["softirq"] - s1["softirq"]) / dt, 1),
        "steal": round(100.0 * max(0, s2["steal"] - s1["steal"]) / dt, 1),
    }


def read_diskstats() -> dict[str, tuple[int, int, int]]:
    """Read (sectors_read, sectors_written, io_ms) for physical block devices."""
    stats: dict[str, tuple[int, int, int]] = {}
    dev_re = re.compile(r"^(sd[a-z]+|vd[a-z]+|nvme\d+n\d+|mmcblk\d+)$")
    try:
        with open("/proc/diskstats", "r", encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 13:
                    continue
                name = parts[2]
                if not dev_re.match(name):
                    continue
                sec_r = int(parts[5])
                sec_w = int(parts[9])
                io_ms = int(parts[12])
                stats[name] = (sec_r, sec_w, io_ms)
    except OSError:
        pass
    return stats


def compute_disk_io(
    d1: dict[str, tuple[int, int, int]],
    d2: dict[str, tuple[int, int, int]],
    elapsed: float,
) -> list[dict[str, object]]:
    out = []
    if elapsed <= 0:
        return out
    for name, (r2, w2, ms2) in sorted(d2.items()):
        if name not in d1:
            continue
        r1, w1, ms1 = d1[name]
        read_mb_s = round(((max(0, r2 - r1) * 512) / (1024 * 1024)) / elapsed, 2)
        write_mb_s = round(((max(0, w2 - w1) * 512) / (1024 * 1024)) / elapsed, 2)
        busy_pct = round(min(100.0, (max(0, ms2 - ms1) / (elapsed * 1000.0)) * 100.0), 1)
        out.append({
            "dev": name,
            "read_mb_s": read_mb_s,
            "write_mb_s": write_mb_s,
            "busy_pct": busy_pct,
        })
    return out


def snapshot_pid_ticks() -> dict[int, int]:
    """Snapshot (utime + stime) ticks for all running PIDs."""
    ticks: dict[int, int] = {}
    my_pid = os.getpid()
    try:
        entries = os.listdir("/proc")
    except OSError:
        return ticks
    for name in entries:
        if not name.isdigit():
            continue
        pid = int(name)
        if pid == my_pid:
            continue
        try:
            with open(f"/proc/{pid}/stat", "r", encoding="utf-8", errors="replace") as f:
                data = f.read()
            rparen = data.rfind(")")
            if rparen == -1:
                continue
            rest = data[rparen + 2 :].split()
            # rest[0] is state (field 3), utime is field 14 -> index 11, stime is field 15 -> index 12
            if len(rest) > 12:
                ticks[pid] = int(rest[11]) + int(rest[12])
        except OSError:
            continue
    return ticks


def read_proc_meta(pid: int) -> dict[str, object] | None:
    """Read detailed process metadata for a PID."""
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8", errors="replace") as f:
            data = f.read()
        lparen = data.find("(")
        rparen = data.rfind(")")
        comm = data[lparen + 1 : rparen] if lparen != -1 and rparen != -1 else "?"
        rest = data[rparen + 2 :].split()
        state = rest[0] if rest else "?"
        ppid = int(rest[1]) if len(rest) > 1 else 0

        rss_mb = 0.0
        uid = -1
        threads = 1
        with open(f"/proc/{pid}/status", "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    rss_mb = round(int(line.split()[1]) / 1024.0, 1)
                elif line.startswith("Uid:"):
                    uid = int(line.split()[1])
                elif line.startswith("Threads:"):
                    threads = int(line.split()[1])

        try:
            user = pwd.getpwuid(uid).pw_name if uid >= 0 else str(uid)
        except KeyError:
            user = str(uid)

        cmdline = ""
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                raw = f.read().replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
            cmdline = re.sub(r"\s+", " ", raw)
        except OSError:
            pass
        if not cmdline:
            cmdline = f"[{comm}]"
        if len(cmdline) > 140:
            cmdline = cmdline[:137] + "..."

        container_id = ""
        try:
            with open(f"/proc/{pid}/cgroup", "r", encoding="utf-8", errors="replace") as f:
                cg = f.read()
            m = re.search(r"docker[-/]([0-9a-f]{12,64})", cg)
            if m:
                container_id = m.group(1)[:12]
        except OSError:
            pass

        return {
            "pid": pid,
            "ppid": ppid,
            "user": user,
            "state": state,
            "comm": comm,
            "threads": threads,
            "rss_mb": rss_mb,
            "cmdline": cmdline,
            "container_id": container_id,
        }
    except OSError:
        return None


def sample_window(interval: float = 2.0) -> dict[str, object]:
    """Perform one synchronized sampling window for CPU, Disk I/O, and per-PID CPU%."""
    t1 = time.monotonic()
    cpu1 = read_proc_stat()
    disk1 = read_diskstats()
    pid1 = snapshot_pid_ticks()

    time.sleep(interval)

    t2 = time.monotonic()
    cpu2 = read_proc_stat()
    disk2 = read_diskstats()
    pid2 = snapshot_pid_ticks()

    elapsed = max(0.1, t2 - t1)
    cpu_bd = compute_cpu_breakdown(cpu1, cpu2)
    disk_io = compute_disk_io(disk1, disk2, elapsed)

    pid_deltas: list[tuple[int, float]] = []
    for pid, ticks2 in pid2.items():
        if pid not in pid1:
            continue
        dt = max(0, ticks2 - pid1[pid])
        if dt == 0:
            continue
        cpu_core_pct = round(100.0 * (dt / CLK_TCK) / elapsed, 1)
        if cpu_core_pct >= 0.3:
            pid_deltas.append((pid, cpu_core_pct))
    pid_deltas.sort(key=lambda x: x[1], reverse=True)

    return {
        "cpu": cpu_bd,
        "disk_io": disk_io,
        "pid_deltas": pid_deltas,
        "all_pids": list(pid2.keys()),
    }


def collect_process_insights(
    pid_deltas: list[tuple[int, float]],
    all_pids: list[int],
    docker_id_map: dict[str, str],
    pm2_pid_map: dict[int, str],
) -> dict[str, object]:
    """Enrich top CPU, top RAM, D-state, and Zombie processes with container/PM2 attribution."""
    top_cpu = []
    seen_pids: set[int] = set()
    for pid, cpu_core_pct in pid_deltas[:10]:
        meta = read_proc_meta(pid)
        if not meta:
            continue
        meta["cpu_core_pct"] = cpu_core_pct
        seen_pids.add(pid)
        tag = ""
        if pid in pm2_pid_map:
            tag = f"pm2:{pm2_pid_map[pid]}"
        elif meta["container_id"] and meta["container_id"] in docker_id_map:
            tag = f"docker:{docker_id_map[meta['container_id']]}"
        meta["service"] = tag
        top_cpu.append(meta)

    # Scan all PIDs quickly for D-state, Z-state, and top RSS memory
    d_procs = []
    z_count = 0
    mem_candidates: list[tuple[float, int]] = []
    for pid in all_pids:
        try:
            with open(f"/proc/{pid}/stat", "r", encoding="utf-8", errors="replace") as f:
                data = f.read()
            rp = data.rfind(")")
            if rp == -1:
                continue
            rest = data[rp + 2 :].split()
            st = rest[0] if rest else ""
            if st == "D":
                meta = read_proc_meta(pid)
                if meta:
                    if meta["container_id"] and meta["container_id"] in docker_id_map:
                        meta["service"] = f"docker:{docker_id_map[meta['container_id']]}"
                    elif pid in pm2_pid_map:
                        meta["service"] = f"pm2:{pm2_pid_map[pid]}"
                    else:
                        meta["service"] = ""
                    d_procs.append(meta)
            elif st == "Z":
                z_count += 1
            # field 24 is rss in pages -> rest[21]
            if len(rest) > 21:
                rss_pages = int(rest[21])
                if rss_pages > 10000:  # > ~40MB
                    mem_candidates.append((rss_pages, pid))
        except OSError:
            continue

    mem_candidates.sort(reverse=True)
    top_mem = []
    for _, pid in mem_candidates[:5]:
        meta = read_proc_meta(pid)
        if not meta:
            continue
        if pid in pm2_pid_map:
            meta["service"] = f"pm2:{pm2_pid_map[pid]}"
        elif meta["container_id"] and meta["container_id"] in docker_id_map:
            meta["service"] = f"docker:{docker_id_map[meta['container_id']]}"
        else:
            meta["service"] = ""
        top_mem.append(meta)

    return {
        "top_cpu": top_cpu,
        "top_mem": top_mem,
        "d_procs": d_procs,
        "zombie_count": z_count,
    }


def read_memory() -> dict[str, float]:
    info: dict[str, int] = {}
    with open("/proc/meminfo", "r", encoding="utf-8") as f:
        for line in f:
            if ":" not in line:
                continue
            k, v = line.split(":", 1)
            info[k.strip()] = int(v.strip().split()[0])

    mem_total = info.get("MemTotal", 0)
    mem_avail = info.get("MemAvailable", info.get("MemFree", 0))
    mem_used = max(0, mem_total - mem_avail)
    ram_pct = round((mem_used / mem_total) * 100.0, 1) if mem_total else 0.0

    swap_total = info.get("SwapTotal", 0)
    swap_free = info.get("SwapFree", 0)
    swap_used = max(0, swap_total - swap_free)
    swap_pct = round((swap_used / swap_total) * 100.0, 1) if swap_total else 0.0

    return {
        "ram_pct": ram_pct,
        "ram_used_gb": round(mem_used / (1024 * 1024), 2),
        "ram_total_gb": round(mem_total / (1024 * 1024), 2),
        "swap_pct": swap_pct,
        "swap_used_gb": round(swap_used / (1024 * 1024), 2),
        "swap_total_gb": round(swap_total / (1024 * 1024), 2),
    }


def read_temperatures() -> list[tuple[str, float]]:
    temps: list[tuple[str, float]] = []
    base = "/sys/class/thermal"
    if not os.path.isdir(base):
        return temps
    for entry in sorted(os.listdir(base)):
        if not entry.startswith("thermal_zone"):
            continue
        try:
            with open(os.path.join(base, entry, "temp"), "r", encoding="utf-8") as f:
                raw = float(f.read().strip())
            c = raw / 1000.0 if raw > 1000 else raw
            label = entry
            tp = os.path.join(base, entry, "type")
            if os.path.exists(tp):
                with open(tp, "r", encoding="utf-8") as f:
                    label = f.read().strip() or entry
            temps.append((label, round(c, 1)))
        except OSError:
            continue
    return temps


def read_disks() -> list[dict[str, object]]:
    seen_devs: set[int] = set()
    disks: list[dict[str, object]] = []
    for mount in DISK_MOUNTS:
        if not os.path.exists(mount):
            continue
        st_dev = os.stat(mount).st_dev
        if st_dev in seen_devs:
            continue
        seen_devs.add(st_dev)
        vfs = os.statvfs(mount)
        total = vfs.f_blocks * vfs.f_frsize
        avail = vfs.f_bavail * vfs.f_frsize
        used = max(0, total - (vfs.f_bfree * vfs.f_frsize))
        denom = used + avail
        pct = round((used / denom) * 100.0, 1) if denom > 0 else 0.0
        inode_pct = 0.0
        if vfs.f_files > 0:
            inode_used = vfs.f_files - vfs.f_ffree
            inode_denom = inode_used + vfs.f_favail
            inode_pct = round((inode_used / inode_denom) * 100.0, 1) if inode_denom > 0 else 0.0
        disks.append({
            "mount": mount,
            "pct": pct,
            "inode_pct": inode_pct,
            "avail_gb": round(avail / (1024 ** 3), 1),
        })
    return disks


def read_run_queue() -> str:
    try:
        with open("/proc/loadavg", "r", encoding="utf-8") as f:
            parts = f.read().split()
        return parts[3] if len(parts) > 3 else ""
    except OSError:
        return ""


def tail_file(path: str, lines: int = 12) -> list[str]:
    if not path or not os.path.isfile(path):
        return []
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 8192))
            data = f.read().decode("utf-8", errors="replace")
        return [ln.strip() for ln in data.splitlines() if ln.strip()][-lines:]
    except OSError:
        return []


def check_pm2(prev_restarts: dict[str, int]) -> tuple[list[str], dict[int, str], dict[str, int], list[str]]:
    """Inspect PM2 apps: status, restart delta, CPU/RAM, and recent error log snippets."""
    issues: list[str] = []
    pid_map: dict[int, str] = {}
    curr_restarts: dict[str, int] = {}
    log_hints: list[str] = []
    if not os.path.exists(PM2_BIN):
        return issues, pid_map, curr_restarts, log_hints
    try:
        res = subprocess.run([PM2_BIN, "jlist"], capture_output=True, text=True, timeout=10)
        if res.returncode != 0:
            return [f"PM2 ตรวจสอบไม่สำเร็จ (exit {res.returncode})"], pid_map, curr_restarts, log_hints
        apps = json.loads(res.stdout or "[]")
        for app in apps:
            name = app.get("name", "unknown")
            pid = app.get("pid") or 0
            if pid:
                pid_map[int(pid)] = name
            env = app.get("pm2_env", {})
            monit = app.get("monit", {})
            status = env.get("status", "unknown")
            restarts = int(env.get("restart_time", 0) or 0)
            curr_restarts[name] = restarts
            cpu = float(monit.get("cpu", 0) or 0)
            mem_mb = round(float(monit.get("memory", 0) or 0) / (1024 * 1024), 1)
            err_log = env.get("pm_err_log_path", "")

            prev_r = prev_restarts.get(name)
            delta_r = (restarts - prev_r) if (prev_r is not None and restarts >= prev_r) else 0
            pm_uptime_ms = float(env.get("pm_uptime", 0) or 0)
            up_sec = (time.time() * 1000 - pm_uptime_ms) / 1000.0 if pm_uptime_ms > 0 else 999999.0

            app_bad = False
            if status != "online":
                issues.append(f"PM2 <code>{_esc(name)}</code> สถานะ: <b>{_esc(status)}</b> (restarts={restarts})")
                app_bad = True
            if delta_r > 0:
                issues.append(f"PM2 <code>{_esc(name)}</code> รีสตาร์ทเพิ่ม <b>+{delta_r} ครั้ง</b> ตั้งแต่รอบก่อน (รวม {restarts})")
                app_bad = True
            elif restarts > 0 and 0 <= up_sec < 300 and prev_r is None:
                issues.append(f"PM2 <code>{_esc(name)}</code> เพิ่งรีสตาร์ทเมื่อ {int(up_sec)}s ก่อน (รวม {restarts})")
                app_bad = True
            if cpu >= THRESHOLDS["pm2_cpu_percent"]:
                issues.append(f"PM2 <code>{_esc(name)}</code> ใช้ CPU สูง: <b>{cpu}%</b> (RAM {mem_mb} MB)")
                app_bad = True
            mem_limit = PM2_MEM_THRESHOLDS.get(name, THRESHOLDS["pm2_mem_mb"])
            if mem_mb >= mem_limit:
                issues.append(f"PM2 <code>{_esc(name)}</code> ใช้ RAM สูง: <b>{mem_mb} MB</b> (เกณฑ์ {mem_limit} MB)")

            if app_bad and err_log:
                tail = tail_file(err_log, 10)
                if tail:
                    log_hints.append(f"[PM2 {name} err log tail ({err_log})]:\n" + "\n".join(tail))
        return issues, pid_map, curr_restarts, log_hints
    except Exception as exc:
        return [f"PM2 ตรวจสอบผิดพลาด: {_esc(exc)}"], pid_map, curr_restarts, log_hints


def check_docker_basic() -> tuple[list[str], dict[str, str], list[str]]:
    """Inspect Docker container statuses and build ID->Name map."""
    issues: list[str] = []
    id_map: dict[str, str] = {}
    bad_containers: list[str] = []
    try:
        res = subprocess.run(
            ["docker", "ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Status}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if res.returncode != 0:
            return [f"Docker ตรวจสอบไม่สำเร็จ (exit {res.returncode})"], id_map, bad_containers
        for line in res.stdout.splitlines():
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            cid, name, status = parts[0][:12], parts[1], parts[2]
            id_map[cid] = name
            low = status.lower()
            if "restarting" in low or "unhealthy" in low or "dead" in low:
                issues.append(f"Docker <code>{_esc(name)}</code>: <b>{_esc(status)}</b>")
                bad_containers.append(name)
            elif low.startswith("exited") and not low.startswith("exited (0)"):
                issues.append(f"Docker <code>{_esc(name)}</code>: <b>{_esc(status)}</b>")
                bad_containers.append(name)
        return issues, id_map, bad_containers
    except FileNotFoundError:
        return [], id_map, bad_containers
    except Exception as exc:
        return [f"Docker ตรวจสอบผิดพลาด: {_esc(exc)}"], id_map, bad_containers


def check_docker_stats(bad_containers: list[str]) -> tuple[list[str], list[str], list[str]]:
    """Collect live docker stats and tail logs for any unhealthy/high-CPU containers."""
    issues: list[str] = []
    stats_lines: list[str] = []
    log_hints: list[str] = []
    inspect_targets = set(bad_containers)
    try:
        res = subprocess.run(
            ["docker", "stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"],
            capture_output=True,
            text=True,
            timeout=12,
        )
        if res.returncode == 0:
            rows = []
            for line in res.stdout.splitlines():
                parts = line.split("\t")
                if len(parts) < 4:
                    continue
                name, cpu_s, mem_u, mem_p_s = parts[0], parts[1], parts[2], parts[3]
                try:
                    cpu_v = float(cpu_s.rstrip("%"))
                except ValueError:
                    cpu_v = 0.0
                try:
                    mem_v = float(mem_p_s.rstrip("%"))
                except ValueError:
                    mem_v = 0.0
                rows.append((cpu_v, mem_v, name, cpu_s, mem_u, mem_p_s))
                if cpu_v >= THRESHOLDS["docker_cpu_percent"]:
                    issues.append(f"Docker <code>{_esc(name)}</code> ใช้ CPU สูง: <b>{cpu_s}</b> (RAM {mem_u})")
                    inspect_targets.add(name)
                if mem_v >= THRESHOLDS["docker_mem_percent"]:
                    issues.append(f"Docker <code>{_esc(name)}</code> ใช้ RAM ใกล้เต็ม Limit: <b>{mem_p_s}</b> ({mem_u})")
                    inspect_targets.add(name)
            rows.sort(reverse=True)
            for _, _, name, cpu_s, mem_u, mem_p_s in rows[:6]:
                stats_lines.append(f"{name}: CPU {cpu_s} | Mem {mem_u} ({mem_p_s})")
    except Exception:
        pass

    for cname in sorted(inspect_targets)[:3]:
        try:
            lg = subprocess.run(
                ["docker", "logs", "--tail", "15", cname],
                capture_output=True,
                text=True,
                timeout=8,
            )
            combined = "\n".join(p for p in (lg.stdout.strip(), lg.stderr.strip()) if p).strip()
            if combined:
                tail_lines = combined.splitlines()[-12:]
                log_hints.append(f"[Docker {cname} logs tail]:\n" + "\n".join(tail_lines))
        except Exception:
            pass
    return issues, stats_lines, log_hints


def check_systemd_failed() -> list[str]:
    try:
        res = subprocess.run(
            ["systemctl", "--failed", "--no-legend", "--plain"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if res.returncode != 0:
            return []
        issues = []
        for line in res.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            unit = line.split()[0]
            issues.append(f"Systemd unit ล้มเหลว: <code>{_esc(unit)}</code>")
        return issues
    except Exception:
        return []


def load_json(path: str) -> dict:
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def save_json(path: str, data: dict) -> None:
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def append_history(entry: dict) -> list[dict]:
    records: list[dict] = []
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        records.append(json.loads(line))
                    except Exception:
                        continue
    except OSError:
        pass
    records.append(entry)
    records = records[-HISTORY_MAX_LINES:]
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            for rec in records:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass
    return records


def format_duration(seconds: float) -> str:
    sec = max(0, int(seconds))
    mins, s = divmod(sec, 60)
    hrs, m = divmod(mins, 60)
    if hrs > 0:
        return f"{hrs} ชม. {m} นาที"
    if mins > 0:
        return f"{mins} นาที"
    return f"{s} วินาที"


def send_telegram(message: str) -> int:
    res = subprocess.run([sys.executable, NOTIFY_SCRIPT, message], text=True)
    return res.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Smart Homelab Linux server health probe")
    parser.add_argument("--always-notify", action="store_true", help="Print full report & send Telegram even when healthy")
    parser.add_argument("--no-notify", action="store_true", help="Print report only without sending Telegram")
    parser.add_argument("--force-check", action="store_true", help="Ignore cooldown and always output full alert when abnormal")
    args = parser.parse_args()

    now_ts = time.time()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    hostname = socket.gethostname()
    cores = os.cpu_count() or 1

    state = load_json(STATE_FILE)
    prev_pm2_restarts: dict[str, int] = state.get("pm2_restarts", {})

    # 1. Initial synchronized 2.0s measurement window
    win = sample_window(interval=2.0)
    cpu_bd = win["cpu"]
    cpu_samples = [cpu_bd["total"]]
    iowait_samples = [cpu_bd["iowait"]]
    load1, load5, load15 = os.getloadavg()
    run_q = read_run_queue()

    load5_limit = round(cores * THRESHOLDS["load_5m_per_core"], 2)
    load1_limit = round(cores * THRESHOLDS["load_1m_per_core"], 2)

    # 2. If CPU, I/O wait, or Load looks elevated, take 2 extra samples to verify sustained vs spike
    elevated_initial = (
        cpu_bd["total"] >= THRESHOLDS["cpu_percent"]
        or cpu_bd["iowait"] >= THRESHOLDS["iowait_percent"]
        or load5 >= load5_limit
        or load1 >= load1_limit
    )
    if elevated_initial:
        for _ in range(2):
            win = sample_window(interval=2.0)
            cpu_bd = win["cpu"]
            cpu_samples.append(cpu_bd["total"])
            iowait_samples.append(cpu_bd["iowait"])
        load1, load5, load15 = os.getloadavg()
        run_q = read_run_queue()

    cpu_avg = round(sum(cpu_samples) / len(cpu_samples), 1)
    iowait_avg = round(sum(iowait_samples) / len(iowait_samples), 1)
    mem = read_memory()
    temps = read_temperatures()
    disks = read_disks()
    max_temp_label, max_temp = max(temps, key=lambda x: x[1]) if temps else ("N/A", 0.0)

    # 3. Services check
    pm2_issues, pm2_pid_map, curr_pm2_restarts, pm2_logs = check_pm2(prev_pm2_restarts)
    docker_issues, docker_id_map, bad_containers = check_docker_basic()
    systemd_issues = check_systemd_failed()

    # 4. Evaluate thresholds & build issue categories
    issues: list[str] = []
    categories: set[str] = set()

    if cpu_avg >= THRESHOLDS["cpu_percent"]:
        trend = ""
        if len(cpu_samples) > 1:
            trend = f" (วัด {len(cpu_samples)} รอบ: {', '.join(f'{s}%' for s in cpu_samples)})"
        issues.append(f"🔥 CPU ใช้งานสูงต่อเนื่อง: <b>{cpu_avg}%</b>{trend} [user {cpu_bd['user']}% / sys {cpu_bd['system']}% / iowait {cpu_bd['iowait']}%]")
        categories.add("cpu")

    if iowait_avg >= THRESHOLDS["iowait_percent"]:
        issues.append(f"💽 Disk I/O Wait สูง: <b>{iowait_avg}%</b> (ซีพียูรออ่าน/เขียนดิสก์)")
        categories.add("iowait")

    if load5 >= load5_limit:
        issues.append(f"⚡ Load Average (5m) สูง: <b>{load5:.2f}</b> (1m={load1:.2f}, 15m={load15:.2f}, เกณฑ์ ≥ {load5_limit} สำหรับ {cores} cores)")
        categories.add("load")
    elif load1 >= load1_limit and (load5 >= cores * 0.8 or cpu_avg >= 65.0):
        issues.append(f"⚡ Load Average (1m) พุ่งสูง: <b>{load1:.2f}</b> (5m={load5:.2f}, CPU={cpu_avg}%)")
        categories.add("load")

    if mem["ram_pct"] >= THRESHOLDS["ram_percent"]:
        issues.append(f"🧠 RAM ใช้งานสูง: <b>{mem['ram_pct']}%</b> ({mem['ram_used_gb']}/{mem['ram_total_gb']} GB)")
        categories.add("ram")

    # Only alert on Swap if swap is near exhaustion (>=85%) OR under genuine memory pressure (RAM >= 70% and swap >= 60%)
    swap_is_issue = False
    if mem["swap_total_gb"] > 0:
        # Swap-full with plenty of free RAM is stale cold pages, not pressure -> don't alert
        if mem["swap_pct"] >= THRESHOLDS["swap_percent"] and mem["ram_pct"] >= 60.0:
            swap_is_issue = True
        elif mem["ram_pct"] >= 70.0 and mem["swap_pct"] >= 60.0:
            swap_is_issue = True

    if swap_is_issue:
        issues.append(f"💾 Swap ถูกใช้งานสูง: <b>{mem['swap_pct']}%</b> ({mem['swap_used_gb']}/{mem['swap_total_gb']} GB)")
        categories.add("swap")

    if temps and max_temp >= THRESHOLDS["temp_c"]:
        issues.append(f"🌡️ อุณหภูมิสูง: <b>{max_temp}°C</b> ({_esc(max_temp_label)}, เกณฑ์ ≥ {THRESHOLDS['temp_c']}°C)")
        categories.add("temp")

    for d in disks:
        if float(d["pct"]) >= THRESHOLDS["disk_percent"]:
            issues.append(f"💿 พื้นที่ดิสก์ <code>{_esc(d['mount'])}</code> ใกล้เต็ม: <b>{d['pct']}%</b> (เหลือ {d['avail_gb']} GB)")
            categories.add("disk")
        if float(d["inode_pct"]) >= THRESHOLDS["inode_percent"]:
            issues.append(f"📁 Inode ดิสก์ <code>{_esc(d['mount'])}</code> ใกล้เต็ม: <b>{d['inode_pct']}%</b>")
            categories.add("inode")

    if pm2_issues:
        issues.extend(pm2_issues)
        categories.add("pm2")
    if docker_issues:
        issues.extend(docker_issues)
        categories.add("docker")
    if systemd_issues:
        issues.extend(systemd_issues)
        categories.add("systemd")

    # Gather deep process/container telemetry whenever ANY issue exists OR always-notify OR load1 >= cores
    need_deep = bool(issues) or args.always_notify or load1 >= cores * 1.25
    proc_insights = None
    docker_stats_lines: list[str] = []
    docker_logs: list[str] = []
    if need_deep:
        proc_insights = collect_process_insights(
            win["pid_deltas"], win["all_pids"], docker_id_map, pm2_pid_map
        )
        if len(proc_insights["d_procs"]) >= THRESHOLDS["d_state_procs"]:
            issues.append(f"⏳ พบโปรเซสค้างในสถานะ D (Uninterruptible I/O): <b>{len(proc_insights['d_procs'])} ตัว</b>")
            categories.add("d_state")
        if proc_insights["zombie_count"] >= THRESHOLDS["zombie_procs"]:
            issues.append(f"🧟 พบ Zombie processes: <b>{proc_insights['zombie_count']} ตัว</b>")
            categories.add("zombie")

        if issues or args.always_notify:
            d_stat_issues, docker_stats_lines, docker_logs = check_docker_stats(bad_containers)
            if d_stat_issues:
                issues.extend(d_stat_issues)
                categories.add("docker_res")

    # 5. Append compact snapshot to rolling history
    history = append_history({
        "ts": int(now_ts),
        "t": datetime.now().strftime("%H:%M"),
        "cpu": cpu_avg,
        "iow": iowait_avg,
        "l1": round(load1, 2),
        "l5": round(load5, 2),
        "ram": mem["ram_pct"],
        "temp": max_temp,
        "issues": sorted(categories),
    })

    summary_line = (
        f"CPU {cpu_avg}% (iowait {iowait_avg}%) | Load {load1:.2f}/{load5:.2f}/{load15:.2f} | "
        f"RAM {mem['ram_pct']}% ({mem['ram_used_gb']}/{mem['ram_total_gb']}GB) | "
        f"Temp {max_temp}°C | RootDisk {disks[0]['pct'] if disks else 'N/A'}%"
    )

    # 6. Incident / Cooldown / Recovery state machine
    incident = state.get("incident") or {}
    active = bool(incident.get("active"))
    state["pm2_restarts"] = curr_pm2_restarts

    if not issues:
        # Check if an active incident just recovered cleanly (hysteresis to avoid flapping near threshold)
        if active and load1 < cores * 0.9 and load5 < load5_limit * 0.9 and cpu_avg < 65.0:
            started_ts = float(incident.get("started_ts", now_ts))
            dur = format_duration(now_ts - started_ts)
            peak_cpu = incident.get("peak_cpu", cpu_avg)
            peak_load5 = incident.get("peak_load5", load5)
            prev_cats = ", ".join(incident.get("categories", [])) or "-"
            state["incident"] = {"active": False, "resolved_ts": now_ts}
            save_json(STATE_FILE, state)

            msg = "\n".join([
                f"✅ <b>[RECOVERED] สถานะ Server ({_esc(hostname)}) กลับสู่ปกติแล้ว</b>",
                f"🕒 {now_str}",
                "",
                f"• อาการก่อนหน้า: <code>{_esc(prev_cats)}</code>",
                f"• ระยะเวลาผิดปกติ: <b>{dur}</b>",
                f"• ค่าสูงสุดที่พบระหว่างเกิดเหตุ: CPU <b>{peak_cpu}%</b> | Load(5m) <b>{peak_load5:.2f}</b>",
                f"• สถานะปัจจุบัน: {summary_line}",
            ])
            print(msg)
            if not args.no_notify:
                return send_telegram(msg)
            return 0

        save_json(STATE_FILE, state)
        if not args.always_notify:
            print(f"[OK] {now_str} {hostname}: {summary_line}")
            return 0

    # We have active issues (or --always-notify)
    mode_tag = "[ALERT]"
    should_emit_full = True

    if issues:
        if not active:
            # Brand new incident
            state["incident"] = {
                "active": True,
                "started_ts": now_ts,
                "last_alert_ts": now_ts,
                "categories": sorted(categories),
                "peak_cpu": cpu_avg,
                "peak_load5": load5,
                "alert_count": 1,
            }
            mode_tag = "[ALERT]"
        else:
            prev_cats = set(incident.get("categories", []))
            peak_cpu = float(incident.get("peak_cpu", 0.0))
            peak_load5 = float(incident.get("peak_load5", 0.0))
            last_alert_ts = float(incident.get("last_alert_ts", 0.0))

            new_cat = bool(categories - prev_cats)
            escalated = (
                new_cat
                or (load5 >= max(peak_load5 * 1.35, peak_load5 + 2.0) and load5 >= load5_limit)
                or (cpu_avg >= 92.0 and peak_cpu < 85.0)
            )
            cooldown_expired = (now_ts - last_alert_ts) >= ALERT_COOLDOWN_SEC

            incident["categories"] = sorted(prev_cats | categories)
            incident["peak_cpu"] = max(peak_cpu, cpu_avg)
            incident["peak_load5"] = max(peak_load5, load5)

            if args.force_check or args.always_notify or escalated or cooldown_expired:
                incident["last_alert_ts"] = now_ts
                incident["alert_count"] = int(incident.get("alert_count", 1)) + 1
                mode_tag = "[ALERT-ESCALATED]" if escalated else "[ALERT-ONGOING]"
            else:
                should_emit_full = False

            state["incident"] = incident

        save_json(STATE_FILE, state)

        if not should_emit_full:
            mins_ago = int((now_ts - float(incident.get("last_alert_ts", now_ts))) / 60)
            print(f"[COOLDOWN] {now_str} {hostname}: {summary_line} | issues={','.join(sorted(categories))} (last alert {mins_ago}m ago)")
            return 0

    # 7. Build rich diagnostic report for AI / Telegram
    if issues:
        dur_note = ""
        if active and incident.get("started_ts"):
            dur_note = f" (ต่อเนื่องมาแล้ว {format_duration(now_ts - float(incident['started_ts']))})"
        header = f"🚨 <b>{mode_tag} แจ้งเตือนสุขภาพ Server ({_esc(hostname)})</b>{dur_note}"
    else:
        header = f"✅ <b>รายงานสุขภาพ Server ({_esc(hostname)}) - ปกติ</b>"

    parts = [header, f"🕒 {now_str}", ""]

    if issues:
        parts.append("<b>ความผิดปกติที่ตรวจพบ:</b>")
        parts.extend(f"• {item}" for item in issues)
        parts.append("")

    parts.append("<b>ค่าสถานะปัจจุบัน:</b>")
    parts.append(
        f"• CPU: <b>{cpu_avg}%</b> (user {cpu_bd['user']}%, sys {cpu_bd['system']}%, "
        f"iowait {cpu_bd['iowait']}%, softirq {cpu_bd['softirq']}%) | {cores} cores"
    )
    parts.append(f"• Load Average: <b>{load1:.2f}, {load5:.2f}, {load15:.2f}</b> | RunQueue: {run_q}")
    if "load" in categories and cpu_avg < 35.0 and iowait_avg < 10.0:
        parts.append("  ↳ <i>หมายเหตุ: CPU ปัจจุบันลดลงแล้ว แต่ Load เฉลี่ยยังสูงค้างจาก burst ที่เพิ่งเกิด (ควรตรวจ log ย้อนหลัง 5-15 นาที)</i>")
    parts.append(
        f"• RAM: <b>{mem['ram_pct']}%</b> ({mem['ram_used_gb']}/{mem['ram_total_gb']} GB) | "
        f"Swap: {mem['swap_pct']}% ({mem['swap_used_gb']}/{mem['swap_total_gb']} GB)"
    )
    parts.append(f"• Temp: <b>{max_temp}°C</b> ({_esc(max_temp_label)})")
    disk_str = ", ".join(f"{_esc(d['mount'])} {d['pct']}% (inode {d['inode_pct']}%)" for d in disks)
    parts.append(f"• Disk: {disk_str}")

    if win["disk_io"]:
        io_str = ", ".join(
            f"{d['dev']}: R {d['read_mb_s']} MB/s W {d['write_mb_s']} MB/s (busy {d['busy_pct']}%)"
            for d in win["disk_io"]
        )
        parts.append(f"• Disk I/O (live 2s): {io_str}")

    if proc_insights:
        if proc_insights["top_cpu"]:
            parts.append("")
            parts.append("<b>Top Live CPU Processes (วัดจริงช่วง 2s ล่าสุด):</b>")
            for p in proc_insights["top_cpu"][:7]:
                svc = f" [{p['service']}]" if p.get("service") else ""
                parts.append(
                    f"• <code>PID {p['pid']} ({p['user']}) {p['cpu_core_pct']}%core | "
                    f"{p['rss_mb']}MB | state={p['state']}{svc}</code> — <code>{_esc(p['cmdline'])}</code>"
                )

        if proc_insights["top_mem"]:
            parts.append("")
            parts.append("<b>Top RAM Consumers:</b>")
            for p in proc_insights["top_mem"][:5]:
                svc = f" [{p['service']}]" if p.get("service") else ""
                parts.append(
                    f"• <code>PID {p['pid']} ({p['user']}) {p['rss_mb']}MB{svc}</code> — <code>{_esc(p['cmdline'])}</code>"
                )

        if proc_insights["d_procs"]:
            parts.append("")
            parts.append(f"<b>Processes in D-State (Uninterruptible I/O, {len(proc_insights['d_procs'])}):</b>")
            for p in proc_insights["d_procs"][:5]:
                svc = f" [{p['service']}]" if p.get("service") else ""
                parts.append(f"• <code>PID {p['pid']} ({p['user']}){svc}</code> — <code>{_esc(p['cmdline'])}</code>")

    if docker_stats_lines:
        parts.append("")
        parts.append("<b>Docker Top Resource Containers:</b>")
        parts.extend(f"• <code>{_esc(ln)}</code>" for ln in docker_stats_lines)

    # Recent 30-min trend from rolling history
    recent_hist = history[-7:]
    if len(recent_hist) >= 2:
        parts.append("")
        parts.append("<b>แนวโน้มล่าสุด (History):</b>")
        for rec in recent_hist:
            iss_txt = f" [!{','.join(rec['issues'])}]" if rec.get("issues") else ""
            parts.append(
                f"• <code>{rec['t']} CPU={rec['cpu']}% iow={rec['iow']}% Load={rec['l1']}/{rec['l5']} RAM={rec['ram']}% Temp={rec['temp']}°C{iss_txt}</code>"
            )

    if pm2_logs or docker_logs:
        parts.append("")
        parts.append("<b>Recent Service Logs:</b>")
        for blk in (pm2_logs + docker_logs):
            parts.append(f"<pre>{_esc(blk[:1500])}</pre>")

    msg = "\n".join(parts)
    print(msg)
    if args.no_notify:
        return 0
    return send_telegram(msg)


if __name__ == "__main__":
    raise SystemExit(main())
