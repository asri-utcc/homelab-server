#!/usr/bin/env python3
"""
obsidian-daily-note.py
Generate or update the Homelab Obsidian Vault Daily Note (04-Daily/YYYY-MM-DD.md)
with automated summaries for PZEM-01 energy, server health, PM2, Docker, and git commits.
Uses Python 3 standard library only.
"""

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
import re
import subprocess
import sys
import tempfile

try:
    from zoneinfo import ZoneInfo

    BKK_TZ = ZoneInfo("Asia/Bangkok")
except Exception:
    BKK_TZ = timezone(timedelta(hours=7))

DEFAULT_VAULT = "/home/dev/storage/obsidian/Homelab-Vault"
HEALTH_LOG_PATH = "/tmp/server_health_history.jsonl"
REPO_PATH = "/home/dev/projects/homelab-server"
MARKER_START = "<!-- AUTO:START -->"
MARKER_END = "<!-- AUTO:END -->"
ALLOWED_FM_KEYS = (
    "energy_kwh",
    "cost_thb",
    "month_kwh",
    "month_cost_thb",
    "cpu_avg",
    "ram_max",
    "pm2_down",
)

FALLBACK_DAILY_TEMPLATE = """---
tags:
  - daily
created: {{date}}
---

# 📅 บันทึกประจำวัน — {{date}}

## 🎯 เป้าหมายวันนี้
- [ ] 

## 📝 สิ่งที่ทำ / เหตุการณ์สำคัญ
- 

## 💡 สิ่งที่เรียนรู้ / ข้อสังเกต
- 
"""


def collect_energy():
    """Collect PZEM-01 energy data via get-energy.py --json."""
    try:
        res = subprocess.run(
            ["/usr/bin/python3", "/home/dev/projects/get-energy.py", "--json"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if res.returncode != 0:
            return None
        data = json.loads(res.stdout)
        if not isinstance(data, dict) or "error" in data:
            return None
        if not all(k in data for k in ("today", "this_month", "realtime")):
            return None
        return data
    except Exception as exc:
        print(f"[warn] collect_energy failed: {exc}", file=sys.stderr)
        return None


def collect_pm2():
    """Collect PM2 process statuses via /usr/local/bin/pm2 jlist."""
    try:
        res = subprocess.run(
            ["/usr/local/bin/pm2", "jlist"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if res.returncode != 0:
            return None
        raw_out = (res.stdout or "").strip()
        if not raw_out:
            return None
        try:
            raw = json.loads(raw_out)
        except json.JSONDecodeError:
            start_idx = raw_out.find("[")
            end_idx = raw_out.rfind("]")
            if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
                return None
            raw = json.loads(raw_out[start_idx : end_idx + 1])
        if not isinstance(raw, list):
            return None

        procs = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            pm2_env = item.get("pm2_env") or {}
            monit = item.get("monit") or {}
            mem_bytes = monit.get("memory") or 0
            try:
                mem_mb = round(float(mem_bytes) / (1024 * 1024), 1)
            except (TypeError, ValueError):
                mem_mb = 0.0
            cpu_val = monit.get("cpu")
            try:
                cpu_pct = round(float(cpu_val), 1) if cpu_val is not None else 0.0
            except (TypeError, ValueError):
                cpu_pct = 0.0
            procs.append(
                {
                    "name": str(item.get("name") or "unknown"),
                    "pm_id": item.get("pm_id"),
                    "status": str(pm2_env.get("status") or "unknown"),
                    "restart_time": pm2_env.get("restart_time", 0),
                    "memory_mb": mem_mb,
                    "cpu": cpu_pct,
                }
            )
        procs.sort(key=lambda p: p["name"].lower())
        return procs
    except Exception as exc:
        print(f"[warn] collect_pm2 failed: {exc}", file=sys.stderr)
        return None


def collect_docker():
    """Collect Docker container names and statuses."""
    try:
        res = subprocess.run(
            ["docker", "ps", "-a", "--format", "{{.Names}}\t{{.Status}}"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if res.returncode != 0:
            return None
        containers = []
        for line in (res.stdout or "").splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t", 1)
            name = parts[0].strip()
            status = parts[1].strip() if len(parts) > 1 else ""
            containers.append({"name": name, "status": status})
        containers.sort(key=lambda c: c["name"].lower())
        return containers
    except Exception as exc:
        print(f"[warn] collect_docker failed: {exc}", file=sys.stderr)
        return None


def collect_health(date, path=HEALTH_LOG_PATH):
    """Aggregate server health metrics for the given YYYY-MM-DD from JSONL history."""
    try:
        if not os.path.exists(path):
            return None
        cpus, rams, temps, l5s = [], [], [], []
        issues_seen = []
        issues_set = set()
        samples = 0

        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(row, dict):
                    continue
                ts = row.get("ts")
                if ts is None:
                    continue
                try:
                    row_date = datetime.fromtimestamp(float(ts)).strftime("%Y-%m-%d")
                except (TypeError, ValueError, OSError):
                    continue
                if row_date != date:
                    continue

                samples += 1
                for key, bucket in (
                    ("cpu", cpus),
                    ("ram", rams),
                    ("temp", temps),
                    ("l5", l5s),
                ):
                    val = row.get(key)
                    if isinstance(val, (int, float)) and not isinstance(val, bool):
                        bucket.append(float(val))
                row_issues = row.get("issues")
                if isinstance(row_issues, list):
                    for iss in row_issues:
                        text = str(iss).strip()
                        if text and text not in issues_set:
                            issues_set.add(text)
                            issues_seen.append(text)

        if samples == 0:
            return None

        def _stats(vals, ndigits=1):
            if not vals:
                return None, None
            return round(sum(vals) / len(vals), ndigits), round(max(vals), ndigits)

        cpu_avg, cpu_max = _stats(cpus, 1)
        ram_avg, ram_max = _stats(rams, 1)
        temp_avg, temp_max = _stats(temps, 1)
        l5_avg, l5_max = _stats(l5s, 2)

        return {
            "samples": samples,
            "cpu_avg": cpu_avg,
            "cpu_max": cpu_max,
            "ram_avg": ram_avg,
            "ram_max": ram_max,
            "temp_avg": temp_avg,
            "temp_max": temp_max,
            "l5_avg": l5_avg,
            "l5_max": l5_max,
            "issues": issues_seen,
        }
    except Exception as exc:
        print(f"[warn] collect_health failed: {exc}", file=sys.stderr)
        return None


def collect_commits(date):
    """Collect git commits in homelab-server for the given YYYY-MM-DD."""
    try:
        res = subprocess.run(
            [
                "git",
                "-C",
                REPO_PATH,
                "log",
                "--since",
                f"{date} 00:00",
                "--until",
                f"{date} 23:59:59",
                "--pretty=format:%h %s",
            ],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if res.returncode != 0:
            return None
        return [line.strip() for line in (res.stdout or "").splitlines() if line.strip()]
    except Exception as exc:
        print(f"[warn] collect_commits failed: {exc}", file=sys.stderr)
        return None


def _escape_cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def _fmt_num(val, fmt, suffix=""):
    if val is None:
        return "-"
    try:
        return f"{format(float(val), fmt)}{suffix}"
    except (TypeError, ValueError):
        return "-"


def render_auto(data):
    """Render automated Thai Markdown summary block."""
    updated_at = data.get("updated_at") or datetime.now(BKK_TZ).strftime("%H:%M")
    energy = data.get("energy")
    health = data.get("health")
    pm2 = data.get("pm2")
    docker = data.get("docker")
    commits = data.get("commits")

    lines = [f"## 🤖 สรุปอัตโนมัติ (อัปเดต {updated_at})", ""]

    # 1. Energy (PZEM-01)
    lines.append("### ⚡ ค่าไฟ (PZEM-01)")
    if energy is None:
        lines.append("⚠️ ไม่มีข้อมูล")
    else:
        td = energy.get("today") or {}
        tm = energy.get("this_month") or {}
        rt = energy.get("realtime") or {}
        month_name = tm.get("month_name") or "รอบบิลนี้"
        days_rec = tm.get("days_recorded")
        days_tot = tm.get("days_total")
        days_info = f" — วันที่ {days_rec}/{days_tot}" if days_rec is not None and days_tot is not None else ""
        pf_val = rt.get("power_factor")
        pf_info = f" | PF {_fmt_num(pf_val, '.2f')}" if pf_val is not None else ""

        lines.append(
            f"- **วันนี้:** {_fmt_num(td.get('energy_kwh'), ',.3f', ' kWh')} "
            f"({_fmt_num(td.get('cost_thb'), ',.2f', ' บาท')})"
        )
        lines.append(
            f"- **เดือนนี้ ({month_name}{days_info}):** "
            f"{_fmt_num(tm.get('energy_kwh'), ',.3f', ' kWh')} "
            f"({_fmt_num(tm.get('cost_thb'), ',.2f', ' บาท')})"
        )
        lines.append(
            f"- **คาดการณ์ทั้งเดือน:** ~{_fmt_num(tm.get('projected_kwh'), ',.1f', ' kWh')} "
            f"(~{_fmt_num(tm.get('projected_cost_thb'), ',.2f', ' บาท')})"
        )
        lines.append(
            f"- **โหลดขณะเก็บข้อมูล:** {_fmt_num(rt.get('power_watts'), ',.1f', ' W')} | "
            f"{_fmt_num(rt.get('voltage_volts'), '.1f', ' V')} | "
            f"{_fmt_num(rt.get('current_amps'), '.2f', ' A')}{pf_info}"
        )
    lines.append("")

    # 2. Server Health
    lines.append("### 🖥️ สุขภาพเซิร์ฟเวอร์")
    if health is None:
        lines.append("⚠️ ไม่มีข้อมูล")
    else:
        lines.append(f"- **จำนวนตัวอย่าง:** {health.get('samples', 0)} จุด")
        lines.append(
            f"- **CPU:** เฉลี่ย {_fmt_num(health.get('cpu_avg'), '.1f', '%')} / "
            f"สูงสุด {_fmt_num(health.get('cpu_max'), '.1f', '%')}"
        )
        lines.append(
            f"- **RAM:** เฉลี่ย {_fmt_num(health.get('ram_avg'), '.1f', '%')} / "
            f"สูงสุด {_fmt_num(health.get('ram_max'), '.1f', '%')}"
        )
        lines.append(
            f"- **อุณหภูมิ:** เฉลี่ย {_fmt_num(health.get('temp_avg'), '.1f', '°C')} / "
            f"สูงสุด {_fmt_num(health.get('temp_max'), '.1f', '°C')}"
        )
        lines.append(
            f"- **Load (5m):** เฉลี่ย {_fmt_num(health.get('l5_avg'), '.2f')} / "
            f"สูงสุด {_fmt_num(health.get('l5_max'), '.2f')}"
        )
        issues = health.get("issues") or []
        if issues:
            lines.append(f"- **⚠️ ปัญหาที่พบ ({len(issues)} รายการ):**")
            for issue in issues:
                lines.append(f"  - {issue}")
        else:
            lines.append("- **ปัญหาที่พบ:** ปกติ (ไม่มีแจ้งเตือน)")
    lines.append("")

    # 3. PM2
    lines.append("### ⚙️ PM2")
    if pm2 is None:
        lines.append("⚠️ ไม่มีข้อมูล")
    elif not pm2:
        lines.append("- ไม่พบโปรเซส PM2")
    else:
        down_count = sum(1 for p in pm2 if p.get("status") != "online")
        if down_count > 0:
            lines.append(f"- ⚠️ มีโปรเซสที่ไม่ online จำนวน **{down_count}** จาก {len(pm2)} โปรเซส")
            lines.append("")
        lines.append("| ชื่อ | สถานะ | รีสตาร์ท | RAM (MB) | CPU (%) |")
        lines.append("| --- | --- | ---: | ---: | ---: |")
        for proc in pm2:
            name = _escape_cell(proc.get("name", "unknown"))
            status = str(proc.get("status", "unknown"))
            status_cell = f"✅ {_escape_cell(status)}" if status == "online" else f"⚠️ {_escape_cell(status)}"
            restarts = proc.get("restart_time", 0)
            mem_mb = _fmt_num(proc.get("memory_mb"), ".1f")
            cpu_pct = _fmt_num(proc.get("cpu"), ".1f")
            lines.append(f"| `{name}` | {status_cell} | {restarts} | {mem_mb} | {cpu_pct} |")
    lines.append("")

    # 4. Docker
    lines.append("### 🐳 Docker")
    if docker is None:
        lines.append("⚠️ ไม่มีข้อมูล")
    elif not docker:
        lines.append("- ไม่พบ Container")
    else:
        up_count = sum(
            1
            for c in docker
            if str(c.get("status", "")).startswith("Up")
            and "unhealthy" not in str(c.get("status", "")).lower()
        )
        not_up = len(docker) - up_count
        lines.append(f"- **รวมทั้งหมด:** {len(docker)} containers (ปกติ {up_count} / ผิดปกติ {not_up})")
        lines.append("")
        lines.append("| Container | สถานะ |")
        lines.append("| --- | --- |")
        for ctr in docker:
            name = _escape_cell(ctr.get("name", "unknown"))
            status = str(ctr.get("status", ""))
            is_ok = status.startswith("Up") and "unhealthy" not in status.lower()
            status_cell = f"✅ {_escape_cell(status)}" if is_ok else f"⚠️ {_escape_cell(status)}"
            lines.append(f"| `{name}` | {status_cell} |")
    lines.append("")

    # 5. Commits (homelab-server)
    lines.append("### 🧾 Commits (homelab-server)")
    if commits is None:
        lines.append("⚠️ ไม่มีข้อมูล")
    elif not commits:
        lines.append("- ไม่มี commit ในวันนี้")
    else:
        for entry in commits:
            parts = entry.split(" ", 1)
            if len(parts) == 2:
                lines.append(f"- `{parts[0]}` {parts[1]}")
            else:
                lines.append(f"- `{entry}`")

    return "\n".join(lines)


def _update_frontmatter(text, fm_updates):
    """Update or insert allowed YAML frontmatter keys line-by-line via regex without removing other keys."""
    if not fm_updates:
        return text

    updates = [
        (key, fm_updates[key])
        for key in ALLOWED_FM_KEYS
        if key in fm_updates and fm_updates[key] is not None
    ]
    if not updates:
        return text

    fm_match = re.match(
        r"\A---[ \t]*\r?\n(?:(.*?)\r?\n)?---[ \t]*(\r?\n|\Z)",
        text,
        flags=re.DOTALL,
    )
    if fm_match:
        fm_body = fm_match.group(1)
        trailing = fm_match.group(2)
        lines = fm_body.splitlines() if fm_body is not None else []
        for key, val in updates:
            key_re = re.compile(rf"^{re.escape(key)}\s*:")
            new_line = f"{key}: {val}"
            replaced = False
            for idx, line in enumerate(lines):
                if key_re.match(line):
                    lines[idx] = new_line
                    replaced = True
                    break
            if not replaced:
                lines.append(new_line)
        new_fm = "---\n" + "\n".join(lines) + "\n---" + trailing
        return new_fm + text[fm_match.end() :]

    new_fm = "---\n" + "\n".join(f"{k}: {v}" for k, v in updates) + "\n---\n\n"
    return new_fm + text


def upsert_note(path, date, auto_md, fm_updates, template_path=None, dry_run=False):
    """Create or update daily note atomically, preserving user content outside AUTO markers."""
    abs_path = os.path.abspath(path)
    if template_path is None:
        vault_dir = os.path.dirname(os.path.dirname(abs_path))
        template_path = os.path.join(vault_dir, "99-Templates", "Daily.md")

    auto_block = f"{MARKER_START}\n{auto_md.strip()}\n{MARKER_END}"

    if os.path.exists(abs_path):
        with open(abs_path, "r", encoding="utf-8") as fh:
            content = fh.read()
    else:
        if os.path.exists(template_path):
            with open(template_path, "r", encoding="utf-8") as fh:
                content = fh.read()
        else:
            content = FALLBACK_DAILY_TEMPLATE
        content = content.replace("{{date}}", date)

    marker_re = re.compile(
        re.escape(MARKER_START) + r".*?" + re.escape(MARKER_END),
        flags=re.DOTALL,
    )
    if marker_re.search(content):
        content = marker_re.sub(lambda _: auto_block, content, count=1)
    else:
        heading_match = re.search(r"^# 📅[^\n]*", content, flags=re.MULTILINE)
        if heading_match is None:
            heading_match = re.search(r"^# [^\n]*", content, flags=re.MULTILINE)

        if heading_match is not None:
            before = content[: heading_match.end()]
            after = content[heading_match.end() :].lstrip("\r\n")
            if after:
                content = f"{before}\n\n{auto_block}\n\n{after}"
            else:
                content = f"{before}\n\n{auto_block}\n"
        else:
            fm_match = re.match(
                r"\A---[ \t]*\r?\n(?:.*?\r?\n)?---[ \t]*(?:\r?\n|\Z)",
                content,
                flags=re.DOTALL,
            )
            if fm_match is not None:
                before = content[: fm_match.end()].rstrip("\r\n")
                after = content[fm_match.end() :].lstrip("\r\n")
                if after:
                    content = f"{before}\n\n{auto_block}\n\n{after}"
                else:
                    content = f"{before}\n\n{auto_block}\n"
            else:
                after = content.lstrip("\r\n")
                if after:
                    content = f"{auto_block}\n\n{after}"
                else:
                    content = f"{auto_block}\n"

    content = _update_frontmatter(content, fm_updates)
    if not content.endswith("\n"):
        content += "\n"

    if dry_run:
        return content

    parent_dir = os.path.dirname(abs_path)
    os.makedirs(parent_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".obsidian-daily-", suffix=".tmp", dir=parent_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp_file:
            tmp_file.write(content)
            tmp_file.flush()
            os.fsync(tmp_file.fileno())
        os.chmod(tmp_path, 0o644)
        os.replace(tmp_path, abs_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    return content


def build_fm_updates(energy, health, pm2):
    """Build frontmatter numeric metrics from collected data."""
    fm = {}
    if isinstance(energy, dict):
        td = energy.get("today") or {}
        tm = energy.get("this_month") or {}
        if isinstance(td.get("energy_kwh"), (int, float)) and not isinstance(td.get("energy_kwh"), bool):
            fm["energy_kwh"] = round(float(td["energy_kwh"]), 3)
        if isinstance(td.get("cost_thb"), (int, float)) and not isinstance(td.get("cost_thb"), bool):
            fm["cost_thb"] = round(float(td["cost_thb"]), 2)
        if isinstance(tm.get("energy_kwh"), (int, float)) and not isinstance(tm.get("energy_kwh"), bool):
            fm["month_kwh"] = round(float(tm["energy_kwh"]), 3)
        if isinstance(tm.get("cost_thb"), (int, float)) and not isinstance(tm.get("cost_thb"), bool):
            fm["month_cost_thb"] = round(float(tm["cost_thb"]), 2)
    if isinstance(health, dict):
        if health.get("cpu_avg") is not None:
            fm["cpu_avg"] = health["cpu_avg"]
        if health.get("ram_max") is not None:
            fm["ram_max"] = health["ram_max"]
    if isinstance(pm2, list):
        fm["pm2_down"] = sum(1 for p in pm2 if p.get("status") != "online")
    return fm


def parse_args(argv=None):
    today_bkk = datetime.now(BKK_TZ).strftime("%Y-%m-%d")
    parser = argparse.ArgumentParser(
        description="Generate or update Homelab Obsidian Daily Note with automated metrics."
    )
    parser.add_argument(
        "--date",
        default=today_bkk,
        help=f"Target date in YYYY-MM-DD (default: today Asia/Bangkok, {today_bkk})",
    )
    parser.add_argument(
        "--vault",
        default=DEFAULT_VAULT,
        help=f"Path to Obsidian vault (default: {DEFAULT_VAULT})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print generated note content to stdout instead of writing file",
    )
    args = parser.parse_args(argv)
    try:
        datetime.strptime(args.date, "%Y-%m-%d")
    except ValueError:
        parser.error(f"Invalid --date format '{args.date}'; expected YYYY-MM-DD")
    return args


def main(argv=None):
    args = parse_args(argv)
    now_bkk = datetime.now(BKK_TZ)

    energy = collect_energy()
    pm2 = collect_pm2()
    docker = collect_docker()
    health = collect_health(args.date)
    commits = collect_commits(args.date)

    data = {
        "updated_at": now_bkk.strftime("%H:%M"),
        "energy": energy,
        "health": health,
        "pm2": pm2,
        "docker": docker,
        "commits": commits,
    }

    auto_md = render_auto(data)
    fm_updates = build_fm_updates(energy, health, pm2)

    note_path = os.path.join(args.vault, "04-Daily", f"{args.date}.md")
    template_path = os.path.join(args.vault, "99-Templates", "Daily.md")

    try:
        result = upsert_note(
            note_path,
            args.date,
            auto_md,
            fm_updates,
            template_path=template_path,
            dry_run=args.dry_run,
        )
    except Exception as exc:
        print(f"[error] failed to write daily note {note_path}: {exc}", file=sys.stderr)
        return 1

    if args.dry_run:
        sys.stdout.write(result)
    else:
        print(
            f"[{now_bkk.strftime('%Y-%m-%d %H:%M:%S')}] updated {note_path}",
            file=sys.stdout,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
