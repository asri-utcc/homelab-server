#!/usr/bin/env python3
"""Fetch recent or today's emails from Gmail via IMAP."""

import email
from email.header import decode_header
import imaplib
import os
import sys
from datetime import datetime


ENV_PATH = "/home/dev/projects/.gmail.env"


def load_env(path: str) -> dict[str, str]:
    env = {}
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


def decode_mime_header(value: str | None) -> str:
    if not value:
        return ""
    parts = decode_header(value)
    decoded = []
    for part, charset in parts:
        if isinstance(part, bytes):
            decoded.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(part)
    return "".join(decoded)


def main() -> int:
    env = load_env(ENV_PATH)
    user = env.get("GMAIL_USER", "")
    password = env.get("GMAIL_APP_PASSWORD", "").replace(" ", "")

    if not user or not password or "PUT_YOUR_16_CHAR" in password:
        print(f"Error: กรุณาใส่ GMAIL_APP_PASSWORD ใน {ENV_PATH} ก่อนใช้งาน", file=sys.stderr)
        return 1

    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 15

    mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    mail.login(user, password)
    mail.select("INBOX", readonly=True)

    today_str = datetime.now().strftime("%d-%b-%Y")
    status, data = mail.search(None, f'(SINCE "{today_str}")')
    if status != "OK":
        print("Error: ไม่สามารถค้นหาอีเมลได้", file=sys.stderr)
        mail.logout()
        return 1

    msg_ids = data[0].split()
    print(f"📬 อีเมลวันนี้ ({today_str}) — พบ {len(msg_ids)} ฉบับ (แสดงล่าสุด {min(len(msg_ids), limit)} ฉบับ)\n")

    for msg_id in reversed(msg_ids[-limit:]):
        res, msg_data = mail.fetch(msg_id, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
        if res != "OK" or not msg_data or not msg_data[0]:
            continue
        raw_header = msg_data[0][1]
        if isinstance(raw_header, bytes):
            msg = email.message_from_bytes(raw_header)
            subject = decode_mime_header(msg.get("Subject")) or "(ไม่มีหัวข้อ)"
            sender = decode_mime_header(msg.get("From"))
            date_str = msg.get("Date", "")
            print(f"• {subject}")
            print(f"  จาก: {sender}")
            print(f"  เวลา: {date_str}\n")

    mail.logout()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
