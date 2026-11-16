#!/usr/bin/env python3
"""Send notifications to Telegram using Bot API and auto-detect chat_id on first message."""

import json
import os
import sys
import urllib.parse
import urllib.request

ENV_PATH = "/home/dev/projects/.telegram.env"


def load_env(path: str) -> dict[str, str]:
    env: dict[str, str] = {}
    if not os.path.exists(path):
        return env
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def save_chat_id(path: str, token: str, chat_id: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"TELEGRAM_BOT_TOKEN={token}\nTELEGRAM_CHAT_ID={chat_id}\n")
    os.chmod(path, 0o600)


def api_call(token: str, method: str, data: dict | None = None) -> dict:
    url = f"https://api.telegram.org/bot{token}/{method}"
    if data is not None:
        encoded = urllib.parse.urlencode(data).encode("utf-8")
        req = urllib.request.Request(url, data=encoded, method="POST")
    else:
        req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode("utf-8"))


def detect_chat_id(token: str) -> str | None:
    resp = api_call(token, "getUpdates")
    for upd in reversed(resp.get("result", [])):
        msg = upd.get("message") or upd.get("edited_message") or upd.get("channel_post")
        if msg and "chat" in msg and "id" in msg["chat"]:
            return str(msg["chat"]["id"])
    return None


def main() -> int:
    env = load_env(ENV_PATH)
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = env.get("TELEGRAM_CHAT_ID", "")

    if not token:
        print(f"Error: กรุณาตั้งค่า TELEGRAM_BOT_TOKEN ใน {ENV_PATH}", file=sys.stderr)
        return 1

    if not chat_id:
        detected = detect_chat_id(token)
        if not detected:
            print("NO_CHAT_ID: ยังไม่พบแชท กรุณากด Start ที่ t.me/asrida_homelab_bot ก่อน", file=sys.stderr)
            return 2
        chat_id = detected
        save_chat_id(ENV_PATH, token, chat_id)
        print(f"Detected and saved TELEGRAM_CHAT_ID={chat_id}")

    text = " ".join(sys.argv[1:]).strip() if len(sys.argv) > 1 else "🔔 ทดสอบการแจ้งเตือนจาก Homelab Server (homelab) สำเร็จ!"
    res = api_call(token, "sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "HTML"})
    if res.get("ok"):
        print("✅ ส่งข้อความเข้า Telegram สำเร็จ!")
        return 0
    print("❌ ส่งไม่สำเร็จ:", res, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
