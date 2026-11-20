#!/usr/bin/env python3
"""Unified Cron AI runner supporting 'ai' and 'script_ai' modes with deep SRE investigation."""

import argparse
import base64
import html
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime

AGY_BIN = os.environ.get("AGY_BIN", "/home/dev/.local/bin/agy")
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "/home/dev/.local/bin/claude")
ROUTER_URL = os.environ.get("AI_ROUTER_URL", "http://172.17.0.1:8090/api/ai-router/route")
GEMINI_ENV_FILE = "/home/dev/.gemini/.env"
AUTO_MODEL = "auto"
AUTO_MAX_ATTEMPTS = 3
NOTIFY_SCRIPT = "/home/dev/projects/notify-telegram.py"
DEFAULT_MODEL = "gemini-3.8-flash-low"
DEFAULT_TIMEOUT = 180
ALLOWED_TG_TAGS = ("b", "i", "code", "pre", "u", "s")


def decode_b64(val: str | None) -> str:
    if not val:
        return ""
    return base64.b64decode(val.encode("ascii")).decode("utf-8")


def run_shell(cmd: str, timeout: int = 90) -> tuple[int, str]:
    res = subprocess.run(
        ["bash", "-lc", cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    out = "\n".join(p for p in (res.stdout.strip(), res.stderr.strip()) if p).strip()
    return res.returncode, out


def run_agy(prompt: str, model: str, timeout: int = DEFAULT_TIMEOUT, home: str | None = None) -> str:
    cmd = [
        AGY_BIN,
        "-p",
        prompt,
        "--model",
        model,
        "--disable-slash-commands",
        "--dangerously-skip-permissions",
        "--print-timeout",
        f"{timeout}s",
    ]
    env = {**os.environ, "HOME": home} if home else None
    res = subprocess.run(
        cmd,
        cwd="/home/dev/projects",
        capture_output=True,
        text=True,
        timeout=timeout + 20,
        env=env,
    )
    if res.returncode != 0:
        err = res.stderr.strip() or res.stdout.strip() or f"agy exited with {res.returncode}"
        raise RuntimeError(err)
    return res.stdout.strip()


def run_claude(prompt: str, model: str, timeout: int = DEFAULT_TIMEOUT) -> str:
    """Claude Code CLI (Claude Pro subscription); model = claude-code-<opus|sonnet|haiku>."""
    cli_model = model.replace("claude-code-", "") or "sonnet"
    res = subprocess.run(
        [CLAUDE_BIN, "-p", prompt, "--model", cli_model, "--output-format", "text", "--dangerously-skip-permissions"],
        cwd="/home/dev/projects",
        capture_output=True,
        text=True,
        timeout=timeout + 20,
    )
    if res.returncode != 0 or not res.stdout.strip():
        err = res.stderr.strip() or res.stdout.strip() or f"claude exited with {res.returncode}"
        raise RuntimeError(err)
    return res.stdout.strip()


def read_env_value(key: str) -> str:
    val = os.environ.get(key, "")
    if val:
        return val
    try:
        with open(GEMINI_ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                m = re.match(rf"^\s*{key}\s*=\s*(.*?)\s*$", line)
                if m:
                    return m.group(1).strip("'\"")
    except OSError:
        pass
    return ""


def run_deepseek(prompt: str, model: str, timeout: int = DEFAULT_TIMEOUT) -> str:
    """DeepSeek API (pay-per-use, last resort). No tools: answers from the given prompt only."""
    key = read_env_value("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("DEEPSEEK_API_KEY not set")
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a homelab SRE assistant. Tools are unavailable; answer only from the provided data."},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not text.strip():
        raise RuntimeError("DeepSeek returned empty answer")
    return text.strip()


def route_auto(route_prompt: str, min_level: int = 1) -> tuple[list[dict], str]:
    """Ask the dashboard's AI Router for ordered candidates. Falls back to DEFAULT_MODEL."""
    fallback = [{"model": DEFAULT_MODEL, "engine": "agy", "home": None, "label": DEFAULT_MODEL, "accountLabel": "Google#1"}]
    try:
        body = json.dumps({"prompt": route_prompt, "source": "cron", "minLevel": min_level}).encode("utf-8")
        req = urllib.request.Request(ROUTER_URL, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        cands = data.get("candidates") or []
        if not cands:
            return fallback, "router: no candidates"
        cls = data.get("classification") or {}
        return cands, f"router: {data.get('routeKey')} ({cls.get('source', '?')}) {cls.get('reason', '')}"
    except Exception as exc:
        return fallback, f"router unavailable ({exc})"


def run_model(prompt: str, model: str, timeout: int, route_prompt: str = "", min_level: int = 1) -> tuple[str, str]:
    """Run a prompt on a fixed model, or on 'auto' via the AI Router with failover. Returns (reply, used_label)."""
    if model != AUTO_MODEL:
        return run_agy(prompt, model, timeout=timeout), model

    cands, why = route_auto(route_prompt or prompt, min_level)
    print(f"[AUTO] {why} -> " + ", ".join(f"{c.get('model')}@{c.get('account', 'g1')}" for c in cands[:5]))
    errors = []
    for c in cands[:AUTO_MAX_ATTEMPTS]:
        engine, cmodel = c.get("engine"), c.get("model")
        label = f"{c.get('label', cmodel)} · {c.get('accountLabel', '')}".strip(" ·")
        try:
            if engine == "claude-code":
                return run_claude(prompt, cmodel, timeout=timeout), label
            if engine == "deepseek":
                return run_deepseek(prompt, cmodel, timeout=timeout), label
            return run_agy(prompt, cmodel, timeout=timeout, home=c.get("home")), label
        except Exception as exc:
            print(f"[AUTO] {label} failed: {str(exc)[:200]}", file=sys.stderr)
            errors.append(f"{label}: {str(exc)[:120]}")
    raise RuntimeError("all auto candidates failed: " + " | ".join(errors))


def format_for_telegram(text: str) -> str:
    """Convert common markdown/HTML to Telegram-safe HTML while escaping stray brackets."""
    escaped = html.escape(text, quote=False)
    for tag in ALLOWED_TG_TAGS:
        escaped = re.sub(rf"&lt;{tag}&gt;(.*?)&lt;/{tag}&gt;", rf"<{tag}>\1</{tag}>", escaped, flags=re.DOTALL)
    # Fenced code blocks ```lang\n...\n``` -> <pre>...</pre>
    escaped = re.sub(r"```[a-zA-Z0-9_-]*\n(.*?)```", r"<pre>\1</pre>", escaped, flags=re.DOTALL)
    # Markdown headings ### Title -> <b>Title</b>
    escaped = re.sub(r"^#{1,4}\s+(.+)$", r"<b>\1</b>", escaped, flags=re.MULTILINE)
    # Bold **text** and inline `code`
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", escaped)
    return escaped.strip()


def send_telegram(message: str) -> bool:
    formatted = format_for_telegram(message)
    chunks = [formatted[i : i + 3800] for i in range(0, len(formatted), 3800)] or [formatted]
    all_ok = True
    for chunk in chunks:
        res = subprocess.run([sys.executable, NOTIFY_SCRIPT, chunk], capture_output=True, text=True)
        if res.returncode != 0:
            # Fallback to plain escaped text if HTML tag nesting failed
            plain = html.escape(message[:3800], quote=False)
            fb = subprocess.run([sys.executable, NOTIFY_SCRIPT, plain], capture_output=True, text=True)
            if fb.returncode != 0:
                print(f"[ERROR] Telegram send failed: {res.stderr} | {fb.stderr}", file=sys.stderr)
                all_ok = False
    return all_ok


def build_filter_prompt(user_prompt: str, cmd: str, exit_code: int, output: str, investigate: bool) -> str:
    trimmed = output[-8000:] if len(output) > 8000 else output
    is_alert = any(tag in output for tag in ("[ALERT]", "[ALERT-ESCALATED]", "[ALERT-ONGOING]"))
    is_recovered = "[RECOVERED]" in output

    instruction = user_prompt.strip() or (
        "วิเคราะห์ผลลัพธ์ด้านล่างว่ามีความผิดปกติที่ต้องแจ้งเตือนเจ้าของเครื่องหรือไม่"
    )

    if is_recovered:
        return (
            "คุณคือวิศวกรดูแลระบบ (SRE) ประจำ Homelab Server\n"
            f"เวลาปัจจุบัน: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
            f"--- รายงานจากระบบตรวจสุขภาพ ---\n{trimmed}\n--- จบรายงาน ---\n\n"
            "งานของคุณ: สถานการณ์ก่อนหน้านี้กลับสู่ปกติแล้ว ([RECOVERED]) ไม่ต้องรันคำสั่งเพิ่ม "
            "ให้สรุปข้อความแจ้งเตือนภาษาไทยที่สั้นกระชับ สวยงาม ไม่เกิน 4-5 บรรทัด เช่น:\n"
            "✅ <b>ระบบกลับสู่ปกติแล้ว</b>\n"
            "• อาการที่หาย: [ระบุสั้นๆ]\n"
            "• สาเหตุ & พีคสุด: [เช่น CPU พีค xx% / แก้ไขแล้ว]\n"
            "• สถานะปัจจุบัน: CPU xx% | RAM xx% | ปกติเรียบร้อยค่ะ\n"
            "เพื่อส่งเข้า Telegram ทันที (ห้ามตอบ SKIP และห้ามเขียนยาว)"
        )

    if is_alert or investigate or exit_code != 0:
        return (
            "คุณคือ AI Senior Linux SRE ประจำ Homelab Server ที่มีสิทธิ์ใช้เครื่องมืออ่านไฟล์และรันคำสั่งวินิจฉัยแบบ Read-Only บนเครื่องจริง\n\n"
            f"คำสั่งมอนิเตอร์ที่รัน: {cmd}\n"
            f"Exit Code: {exit_code}\n"
            f"เวลาปัจจุบัน: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
            f"--- ข้อมูลเบื้องต้นจากสคริปต์ตรวจสุขภาพ ---\n{trimmed or '(ไม่มี output)'}\n--- จบข้อมูลเบื้องต้น ---\n\n"
            f"คำสั่งเพิ่มเติมจากเจ้าของเครื่อง:\n{instruction}\n\n"
            "แนวทางการสืบสวนเชิงลึก (สำคัญมาก):\n"
            "1. หากสคริปต์รายงาน [ALERT], [ALERT-ESCALATED], [ALERT-ONGOING] หรือมี Load/CPU/RAM/Disk/Service ผิดปกติ หรือ Exit Code != 0 "
            "<b>ห้ามตอบ SKIP เด็ดขาด</b> (ระบบตรวจวัดหลายรอบและกรอง spike สั้นๆ แล้ว)\n"
            "2. ให้ใช้เครื่องมือรันคำสั่ง Read-Only เจาะลึกหา <b>ต้นตอที่แท้จริง (Root Cause)</b> ก่อนตอบ เช่น:\n"
            "   - เช็กโปรเซส/cmd เต็ม: <code>ps -eo pid,ppid,pcpu,pmem,stat,etime,args --sort=-%cpu | head -n 20</code>\n"
            "   - เช็ก PM2: <code>/usr/local/bin/pm2 jlist</code> และดู log ล่าสุดใน <code>/home/dev/.pm2/logs/</code> หรือ <code>/home/dev/projects/OnePercentBotTrade/logs/</code>\n"
            "   - เช็ก Docker: <code>docker ps -a</code> และ <code>docker logs --tail 30 &lt;container&gt;</code>\n"
            "   - เช็ก Cron / AI CLI ล่าสุด (โดยเฉพาะถ้า Load สูงแต่ CPU ปัจจุบันลดลงแล้ว): "
            "<code>ls -lt /home/dev/.gemini/antigravity-cli/log/ | head -n 8</code> และ <code>/home/dev/projects/lab-dashboard/cron-logs/</code>\n"
            "   - เช็ก Memory/IO/Network หากสงสัยคอขวด: <code>vmstat 1 2</code>, <code>free -h</code>, <code>ss -s</code>\n"
            "3. กฎความปลอดภัย: รันเฉพาะคำสั่งตรวจสอบแบบ Read-Only เท่านั้น <b>ห้าม</b> kill โปรเซส, <b>ห้าม</b> restart service, และ <b>ห้าม</b> ลบ/แก้ไฟล์ใดๆ\n"
            "4. กฎการสรุปข้อความส่งเข้า Telegram (สำคัญที่สุด - บังยีสั่งให้สรุปสั้นกระชับ จัดรูปแบบสวยงาม ไม่เกิน 4-5 บรรทัด ห้ามเขียนยาวยืดเป็นรายงานเด็ดขาด):\n"
            "   ให้ใช้ Format นี้เท่านั้น:\n"
            "   🚨 <b>ปัญหา:</b> [ระบุปัญหา & ระดับความรุนแรง เช่น ต่ำ/เฝ้าระวัง/วิกฤต]\n"
            "   🔍 <b>ต้นตอ:</b> [ระบุโปรเซสหรือสาเหตุสั้นๆ]\n"
            "   📊 <b>สถานะ:</b> CPU xx% | RAM xx% | Load x.x\n"
            "   💡 <b>วิธีแก้:</b> [คำสั่งหรือคำแนะนำ 1 บรรทัด]\n"
        )

    return (
        "คุณคือผู้ช่วยดูแล Homelab Server ที่ช่วยวิเคราะห์และสรุปผลลัพธ์จาก Cron Job ก่อนส่งเข้า Telegram\n\n"
        f"คำสั่งที่รัน: {cmd}\n"
        f"Exit Code: {exit_code}\n"
        f"เวลาปัจจุบัน: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        f"--- ผลลัพธ์จากสคริปต์ ---\n{trimmed or '(ไม่มี output)'}\n--- จบผลลัพธ์ ---\n\n"
        f"คำสั่งจากผู้ใช้:\n{instruction}\n\n"
        "กติกาการตอบ:\n"
        "1. หากไม่มีความผิดปกติและไม่มีประเด็นต้องแจ้ง ให้ตอบกลับมาแค่คำว่า SKIP คำเดียวเท่านั้น\n"
        "2. หากมีประเด็นสำคัญ ให้สรุปเป็นภาษาไทยที่กระชับ ชัดเจน พร้อมหลักฐานและคำแนะนำ ส่งเข้า Telegram ได้ทันที"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="AI-powered Cron Runner")
    parser.add_argument("--job-file", default="", help="Path to JSON job config file")
    parser.add_argument("--mode", choices=["ai", "script_ai"], default="script_ai")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--cmd", default="")
    parser.add_argument("--cmd-b64", default="")
    parser.add_argument("--prompt", default="")
    parser.add_argument("--prompt-b64", default="")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    parser.add_argument("--investigate", action="store_true", help="Enable deep SRE tool investigation")
    parser.add_argument("--no-telegram", action="store_true")
    parser.add_argument("--skip-ok", action="store_true", help="Skip AI call if script exits 0 and output starts with [OK] or [COOLDOWN]")
    args = parser.parse_args()

    mode = args.mode
    model = args.model
    cmd = decode_b64(args.cmd_b64) or args.cmd
    prompt = decode_b64(args.prompt_b64) or args.prompt
    timeout = args.timeout
    investigate = args.investigate
    no_telegram = args.no_telegram
    skip_ok = args.skip_ok

    if args.job_file:
        with open(args.job_file, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        mode = cfg.get("mode", mode)
        model = cfg.get("aiModel") or model
        cmd = cfg.get("rawCommand") or cmd
        prompt = cfg.get("aiPrompt") or prompt
        if cfg.get("timeoutSec"):
            timeout = int(cfg["timeoutSec"])
        if cfg.get("investigate"):
            investigate = True
        if cfg.get("notifyTelegram") is False:
            no_telegram = True
        if cfg.get("skipOk"):
            skip_ok = True

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if mode == "ai":
        if not prompt.strip():
            print(f"[ERROR] {now_str} Missing AI prompt", file=sys.stderr)
            return 1
        try:
            reply, used = run_model(prompt.strip(), model, timeout)
        except Exception as exc:
            print(f"[ERROR] {now_str} AI execution failed: {exc}", file=sys.stderr)
            return 1

        print(f"[AI] {now_str} ({used}):\n{reply}")
        if reply.strip().upper().startswith("SKIP") and len(reply.strip()) <= 12:
            print(f"[AI] {now_str} Skipped Telegram notification")
            return 0
        if not no_telegram and reply.strip():
            send_telegram(reply)
        return 0

    # script_ai mode
    if not cmd.strip():
        print(f"[ERROR] {now_str} Missing command for script_ai mode", file=sys.stderr)
        return 1

    try:
        exit_code, output = run_shell(cmd.strip())
    except subprocess.TimeoutExpired:
        exit_code, output = 124, "Command timed out after 90s"

    is_single_line = "\n" not in output
    if skip_ok and exit_code == 0 and is_single_line and (output.startswith("[OK]") or output.startswith("[COOLDOWN]")):
        print(f"[SKIP-AI] {now_str} {output}")
        return 0

    hard_alert = exit_code != 0 or any(
        tag in output for tag in ("[ALERT]", "[ALERT-ESCALATED]", "[ALERT-ONGOING]", "[RECOVERED]")
    )
    ai_timeout = max(timeout, 210) if (hard_alert or investigate) else timeout

    filter_prompt = build_filter_prompt(prompt, cmd.strip(), exit_code, output, investigate)
    try:
        # Routing is keyed on the job's own prompt (stable → classifier cache hit every run);
        # a real alert bumps the minimum difficulty so a stronger model investigates.
        reply, used = run_model(filter_prompt, model, ai_timeout, route_prompt=prompt or cmd.strip(), min_level=2 if hard_alert else 1)
    except Exception as exc:
        print(f"[ERROR] {now_str} AI filter failed ({exc}); raw output:\n{output}", file=sys.stderr)
        if not no_telegram and output:
            send_telegram(f"⚠️ <b>Cron Diagnostic Output (AI ขัดข้อง: {exc})</b>\n\n{output[:3300]}")
        return 1

    first_line = reply.strip().splitlines()[0].strip().upper() if reply.strip() else ""
    if first_line in ("SKIP", "NO_ALERT", "OK_SKIP"):
        if hard_alert:
            print(f"[AI-OVERRIDE:NOTIFY] {now_str} AI returned SKIP on hard alert; sending raw report.")
            if not no_telegram and output:
                send_telegram(f"⚠️ <b>ส่งรายงานตรง (AI พยายามข้าม Alert)</b>\n\n{output[:3300]}")
            return 0
        print(f"[AI-FILTER:SKIP] {now_str} Filtered out (no Telegram sent). Raw output:\n{output}")
        return 0

    print(f"[AI-FILTER:NOTIFY] {now_str} ({used}):\n{reply}")
    if not no_telegram and reply.strip():
        send_telegram(reply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
