#!/usr/bin/env python3
"""Shared Gemini API (TTS) credit & per-clip cost ledger utilities.

Reads:
  - /home/dev/.gemini/gemini-credit.json
  - /home/dev/.gemini/gemini-tts-ledger.jsonl
Writes alert dedup state:
  - /home/dev/.gemini/gemini-credit-alert.json
"""

import argparse
from datetime import datetime
import json
import os
import subprocess
import sys
import time
from typing import Any

CREDIT_CFG_PATH = "/home/dev/.gemini/gemini-credit.json"
TTS_LEDGER_PATH = "/home/dev/.gemini/gemini-tts-ledger.jsonl"
ALERT_STATE_PATH = "/home/dev/.gemini/gemini-credit-alert.json"
NOTIFY_TELEGRAM_PY = "/home/dev/projects/notify-telegram.py"
DEFAULT_LOW_THB = 10.0
DEFAULT_FX = 34.5


def _parse_iso_ts(raw: Any) -> float:
    """Parse ISO-8601 timestamp string to Unix epoch seconds (0.0 on failure)."""
    if not raw:
        return 0.0
    s = str(raw).strip()
    if not s:
        return 0.0
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return 0.0


def load_credit_config() -> dict[str, Any] | None:
    """Load gemini-credit.json; return None if missing or invalid."""
    try:
        with open(CREDIT_CFG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def calc_usage_cost(
    model: str,
    prompt_tokens: int,
    output_tokens: int,
    thoughts_tokens: int = 0,
    cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Calculate USD & THB cost for one Gemini TTS usage record."""
    if cfg is None:
        cfg = load_credit_config() or {}
    fx = float(cfg.get("usdToThb") or DEFAULT_FX)
    prices = cfg.get("pricesUsdPerMTok") or {}
    price = prices.get(model)
    in_tok = max(0, int(prompt_tokens or 0))
    out_tok = max(0, int(output_tokens or 0))
    th_tok = max(0, int(thoughts_tokens or 0))
    bill_out = out_tok + th_tok
    if not isinstance(price, dict):
        return {
            "priced": False,
            "model": model,
            "inputTokens": in_tok,
            "outputTokens": bill_out,
            "thoughtsTokens": th_tok,
            "costUsd": 0.0,
            "costThb": 0.0,
        }
    in_rate = float(price.get("input") or 0.0)
    out_rate = float(price.get("output") or 0.0)
    usd = (in_tok * in_rate + bill_out * out_rate) / 1_000_000.0
    thb = usd * fx
    return {
        "priced": True,
        "model": model,
        "inputTokens": in_tok,
        "outputTokens": bill_out,
        "thoughtsTokens": th_tok,
        "costUsd": round(usd, 6),
        "costThb": round(thb, 4),
    }


def count_ledger_lines() -> int:
    """Return current number of lines in gemini-tts-ledger.jsonl."""
    try:
        with open(TTS_LEDGER_PATH, "r", encoding="utf-8") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def summarize_ledger_slice(start_line: int = 0) -> dict[str, Any]:
    """Summarize ledger entries from line `start_line` (0-based) to EOF."""
    cfg = load_credit_config() or {}
    fx = float(cfg.get("usdToThb") or DEFAULT_FX)
    prices = cfg.get("pricesUsdPerMTok") or {}

    calls = 0
    in_tok = 0
    out_tok = 0
    th_tok = 0
    usd = 0.0
    unpriced = 0
    models: list[str] = []

    try:
        with open(TTS_LEDGER_PATH, "r", encoding="utf-8") as f:
            for idx, line in enumerate(f):
                if idx < start_line or not line.strip():
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                model = str(rec.get("model") or "")
                price = prices.get(model)
                if not isinstance(price, dict):
                    unpriced += 1
                    continue
                p_tok = int(rec.get("promptTokens") or 0)
                o_tok = int(rec.get("outputTokens") or 0)
                t_tok = int(rec.get("thoughtsTokens") or 0)
                bill_out = o_tok + t_tok
                usd += (p_tok * float(price.get("input") or 0) + bill_out * float(price.get("output") or 0)) / 1_000_000.0
                in_tok += p_tok
                out_tok += bill_out
                th_tok += t_tok
                calls += 1
                if model and model not in models:
                    models.append(model)
    except OSError:
        pass

    thb = usd * fx
    return {
        "calls": calls,
        "inputTokens": in_tok,
        "outputTokens": out_tok,
        "thoughtsTokens": th_tok,
        "costUsd": round(usd, 4),
        "costThb": round(thb, 2),
        "costThbExact": round(thb, 4),
        "models": models,
        "unpriced": unpriced,
    }


def get_credit_summary() -> dict[str, Any]:
    """Compute current estimated Gemini API prepay credit balance (matches gemini-manager.js)."""
    cfg = load_credit_config()
    if not cfg:
        return {"ok": False, "error": "gemini-credit.json not found"}

    fx = float(cfg.get("usdToThb") or DEFAULT_FX)
    since = _parse_iso_ts(cfg.get("baselineAt"))
    prices = cfg.get("pricesUsdPerMTok") or {}

    usd = 0.0
    calls = 0
    in_tok = 0
    out_tok = 0
    unpriced = 0
    last_at = None

    try:
        with open(TTS_LEDGER_PATH, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                if _parse_iso_ts(rec.get("ts")) < since:
                    continue
                price = prices.get(rec.get("model"))
                if not isinstance(price, dict):
                    unpriced += 1
                    continue
                p_tok = int(rec.get("promptTokens") or 0)
                o_tok = int(rec.get("outputTokens") or 0) + int(rec.get("thoughtsTokens") or 0)
                usd += (p_tok * float(price.get("input") or 0) + o_tok * float(price.get("output") or 0)) / 1_000_000.0
                in_tok += p_tok
                out_tok += o_tok
                calls += 1
                last_at = rec.get("ts")
    except OSError:
        pass

    baseline = float(cfg.get("baselineBalanceThb") or 0.0)
    spent_thb = usd * fx
    remaining_thb = max(0.0, baseline - spent_thb)
    top_up = float(cfg.get("topUpThb") or baseline)
    raw_low = cfg.get("lowThb")
    low_thb = float(raw_low) if raw_low is not None else DEFAULT_LOW_THB
    rem_rounded = round(remaining_thb, 2)

    return {
        "ok": True,
        "currency": str(cfg.get("currency") or "THB"),
        "remainingThb": rem_rounded,
        "baselineThb": baseline,
        "baselineAt": cfg.get("baselineAt"),
        "topUpThb": top_up,
        "spentThb": round(spent_thb, 2),
        "spentUsd": round(usd, 4),
        "usdToThb": fx,
        "calls": calls,
        "inputTokens": in_tok,
        "outputTokens": out_tok,
        "unpriced": unpriced,
        "lastAt": last_at,
        "lowThb": low_thb,
        "isLow": rem_rounded < low_thb,
        "isEmpty": rem_rounded <= 0.5,
        "estimated": True,
    }


def _read_alert_state() -> dict[str, Any]:
    try:
        with open(ALERT_STATE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_alert_state(state: dict[str, Any]) -> None:
    try:
        os.makedirs(os.path.dirname(ALERT_STATE_PATH), exist_ok=True)
        tmp = f"{ALERT_STATE_PATH}.tmp.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp, ALERT_STATE_PATH)
    except OSError:
        pass


def maybe_send_low_credit_alert(
    summary: dict[str, Any] | None = None,
    *,
    source: str = "tts",
    force: bool = False,
) -> dict[str, Any]:
    """Send a deduplicated Telegram warning if remaining credit drops below lowThb (default 10 THB)."""
    s = summary or get_credit_summary()
    if not s.get("ok"):
        return {"alerted": False, "reason": "credit_not_configured"}

    rem = float(s.get("remainingThb") or 0.0)
    low_thb = float(s.get("lowThb") if s.get("lowThb") is not None else DEFAULT_LOW_THB)
    baseline_at = str(s.get("baselineAt") or "")
    state = _read_alert_state()

    if rem >= low_thb:
        # Reset alert flag once balance is topped up above threshold
        if state.get("alertedBelowAt") or state.get("alertedCriticalAt"):
            _write_alert_state({"baselineAt": baseline_at, "clearedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
        return {"alerted": False, "reason": "above_threshold", "remainingThb": rem, "lowThb": low_thb}

    critical = rem <= 2.0
    same_baseline = state.get("baselineAt") == baseline_at
    already_low = bool(state.get("alertedBelowAt")) and same_baseline
    already_crit = bool(state.get("alertedCriticalAt")) and same_baseline

    if not force:
        if critical and already_crit:
            return {"alerted": False, "reason": "already_alerted_critical", "remainingThb": rem, "lowThb": low_thb}
        if (not critical) and already_low:
            return {"alerted": False, "reason": "already_alerted_low", "remainingThb": rem, "lowThb": low_thb}

    if not os.path.exists(NOTIFY_TELEGRAM_PY):
        return {"alerted": False, "reason": "notify_script_missing", "remainingThb": rem, "lowThb": low_thb}

    title = "🚨 เครดิต Gemini API ใกล้หมดวิกฤต!" if rem <= 2.0 else "⚠️ แจ้งเตือนเครดิต Gemini API ใกล้หมด!"
    msg = (
        f"{title}\n"
        f"💳 คงเหลือโดยประมาณ: <b>฿{rem:.2f}</b> (ต่ำกว่าเกณฑ์ ฿{low_thb:.0f})\n"
        f"🎙️ ใช้ไปแล้ว ฿{float(s.get('spentThb') or 0):.2f} ({int(s.get('calls') or 0)} ครั้ง)\n"
        f"📌 แนะนำ: เติมเงินที่ Google AI Studio หรือสลับเสียงพากย์เป็น Edge TTS / VachanaTTS (ฟรี ฿0) ชั่วคราว\n"
        f"<i>ที่มา: {source}</i>"
    )
    try:
        proc = subprocess.run(
            [sys.executable, NOTIFY_TELEGRAM_PY, msg],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=20,
        )
        if proc.returncode == 0:
            now_str = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            _write_alert_state(
                {
                    "baselineAt": baseline_at,
                    "alertedBelowAt": state.get("alertedBelowAt") if same_baseline and state.get("alertedBelowAt") else now_str,
                    "alertedCriticalAt": now_str if critical else (state.get("alertedCriticalAt") if same_baseline else None),
                    "lastRemainingThb": rem,
                    "source": source,
                }
            )
            return {"alerted": True, "remainingThb": rem, "lowThb": low_thb}
        return {
            "alerted": False,
            "reason": f"telegram_exit_{proc.returncode}: {(proc.stderr or proc.stdout).strip()[:120]}",
            "remainingThb": rem,
            "lowThb": low_thb,
        }
    except Exception as exc:
        return {"alerted": False, "reason": str(exc), "remainingThb": rem, "lowThb": low_thb}


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect Gemini API TTS credit balance & trigger low-balance alerts")
    parser.add_argument("--check-alert", action="store_true", help="Send Telegram alert if balance < lowThb")
    parser.add_argument("--force-alert", action="store_true", help="Force send Telegram alert if balance < lowThb")
    args = parser.parse_args()

    summary = get_credit_summary()
    if args.check_alert or args.force_alert:
        summary["alertCheck"] = maybe_send_low_credit_alert(summary, source="cli", force=args.force_alert)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
