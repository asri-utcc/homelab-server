#!/usr/bin/env python3
"""Check Gemini/AI 5-hour & weekly quota usage; alert via Telegram if > 70%."""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

QUOTA_URL = "http://172.17.0.1:8090/api/gemini/quota"
ACCOUNTS_URL = "http://172.17.0.1:8090/api/ai-router/accounts"
NOTIFY_SCRIPT = "/home/dev/projects/notify-telegram.py"
STATE_FILE = "/tmp/gemini_quota_alert_state.json"
THRESHOLD_PCT = 70.0
REPEAT_COOLDOWN_SEC = 6 * 3600  # Re-alert at most every 6h for the same unreset pool


def fetch_quota(account_id: str | None = None) -> dict:
    url = QUOTA_URL if not account_id else f"{QUOTA_URL}?account={account_id}"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode("utf-8"))


def fetch_ready_accounts() -> list[dict]:
    try:
        req = urllib.request.Request(ACCOUNTS_URL, method="GET")
        with urllib.request.urlopen(req, timeout=8) as res:
            data = json.loads(res.read().decode("utf-8"))
        accs = [a for a in (data.get("accounts") or []) if a.get("ready")]
        if accs:
            return accs
    except Exception:
        pass
    return [{"id": "g1", "label": "Google#1"}]


def format_reset_left(reset_iso: str | None) -> str:
    if not reset_iso:
        return "ไม่ทราบเวลา"
    try:
        dt = datetime.fromisoformat(reset_iso.replace("Z", "+00:00"))
        diff = int((dt - datetime.now(timezone.utc)).total_seconds())
        if diff <= 0:
            return "กำลังรีเซ็ต"
        days, rem = divmod(diff, 86400)
        hours, rem = divmod(rem, 3600)
        mins = rem // 60
        if days > 0:
            return f"{days} วัน {hours} ชม. {mins} นาที"
        if hours > 0:
            return f"{hours} ชม. {mins} นาที"
        return f"{mins} นาที"
    except Exception:
        return reset_iso


def window_type(reset_iso: str | None, pool_id: str) -> str:
    if pool_id == "argon":
        return "Weekly Limit"
    if not reset_iso:
        return "5-Hour / Weekly"
    try:
        dt = datetime.fromisoformat(reset_iso.replace("Z", "+00:00"))
        diff = (dt - datetime.now(timezone.utc)).total_seconds()
        return "5-Hour Limit" if diff <= 12 * 3600 else "Weekly Limit"
    except Exception:
        return "5-Hour / Weekly"


def load_state() -> dict:
    try:
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def save_state(state: dict) -> None:
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def send_telegram(msg: str) -> int:
    res = subprocess.run([sys.executable, NOTIFY_SCRIPT, msg], text=True)
    return res.returncode


def check_single_account(acc: dict, args, state: dict, now_ts: float, now_str: str) -> tuple[bool, int]:
    acc_id = acc.get("id") or "g1"
    acc_label = acc.get("label") or acc_id
    try:
        data = fetch_quota(acc_id)
    except Exception as exc:
        print(f"[ERR] {now_str} [{acc_label}] Failed to fetch quota: {exc}", file=sys.stderr)
        return False, 1

    if not data.get("ok"):
        print(f"[WARN] {now_str} [{acc_label}] Quota unavailable: {data.get('error')}", file=sys.stderr)
        return False, 1

    pools = data.get("pools", [])
    over_pools = []
    should_notify = args.force

    for p in pools:
        pid = p.get("id", "")
        state_key = pid if acc_id == "g1" else f"{acc_id}:{pid}"
        used = float(p.get("usedPct", 0))
        reset_iso = p.get("resetTime")
        wtype = window_type(reset_iso, pid)
        reset_left = format_reset_left(reset_iso)

        if used > THRESHOLD_PCT:
            over_pools.append((p, wtype, reset_left))
            prev = state.get(state_key, {})
            prev_reset = prev.get("resetTime")
            prev_ts = float(prev.get("alertedAt", 0))
            prev_used = float(prev.get("usedPct", 0))

            if (
                prev_reset != reset_iso
                or (used >= 100 and prev_used < 100)
                or (used - prev_used >= 15)
                or (now_ts - prev_ts >= REPEAT_COOLDOWN_SEC)
            ):
                should_notify = True
        else:
            state.pop(state_key, None)

    summary = " | ".join(
        f"{p.get('id')}: used {p.get('usedPct')}% (rem {p.get('remainingPct')}%)"
        for p in pools
    )

    if not over_pools and not args.force:
        print(f"[OK] {now_str} [{acc_label}] Quota within limit (<= {THRESHOLD_PCT}%): {summary}")
        return True, 0

    if not should_notify:
        print(f"[OK] {now_str} [{acc_label}] Over {THRESHOLD_PCT}% already alerted recently (cooldown active): {summary}")
        return True, 0

    lines = [
        f"⚠️ <b>แจ้งเตือนโควตา AI เกิน {THRESHOLD_PCT:.0f}%</b> ({acc_label})",
        f"👤 บัญชี: <code>{data.get('email') or acc.get('email') or acc_label}</code>",
        f"🕒 {now_str}",
        "",
    ]

    if over_pools:
        lines.append("<b>รายการที่ใช้งานเกินเกณฑ์:</b>")
        for p, wtype, reset_left in over_pools:
            used = p.get("usedPct", 0)
            rem = p.get("remainingPct", 0)
            icon = "🔴" if used >= 95 else "🟠"
            lines.append(
                f"{icon} <b>{p.get('name')}</b> ({wtype})\n"
                f"   ใช้ไป <b>{used}%</b> (เหลือ {rem}%) · รีเซ็ตใน {reset_left}"
            )
        lines.append("")

    lines.append("<b>สรุปโควตาทุก Pool:</b>")
    for p in pools:
        wtype = window_type(p.get("resetTime"), p.get("id", ""))
        lines.append(f"• {p.get('id').upper()} ({wtype}): ใช้ไป <b>{p.get('usedPct')}%</b> · เหลือ {p.get('remainingPct')}%")

    msg = "\n".join(lines)
    print(msg)

    rc = send_telegram(msg)
    if rc == 0:
        for p, _, _ in over_pools:
            pid = p.get("id", "")
            state_key = pid if acc_id == "g1" else f"{acc_id}:{pid}"
            state[state_key] = {
                "usedPct": float(p.get("usedPct", 0)),
                "resetTime": p.get("resetTime"),
                "alertedAt": now_ts,
            }
    return True, rc


def main() -> int:
    parser = argparse.ArgumentParser(description="Monitor Gemini AI quota usage")
    parser.add_argument("--force", action="store_true", help="Send alert regardless of cooldown/threshold")
    args = parser.parse_args()

    now_ts = time.time()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    accounts = fetch_ready_accounts()
    state = load_state()
    any_ok = False
    worst_rc = 0
    for acc in accounts:
        ok, rc = check_single_account(acc, args, state, now_ts, now_str)
        if ok:
            any_ok = True
        if rc != 0:
            worst_rc = rc
    save_state(state)
    return 0 if any_ok else (worst_rc or 1)


if __name__ == "__main__":
    raise SystemExit(main())
