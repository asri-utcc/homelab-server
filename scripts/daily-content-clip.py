#!/usr/bin/env python3
"""
daily-content-clip.py
Automated daily Thai YouTube Shorts & Video Studio generator for noon Tech
and evening Health slots.
Generates a fresh non-duplicate topic via agy (with curated 30+30 fallback banks),
runs studio_job.py oneshot, uploads public #Shorts to YouTube, logs topic history,
and sends a Telegram HTML summary with Watch/Download/YouTube links & credit balance.
Uses Python 3 standard library only.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import fcntl
import html
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

try:
    from zoneinfo import ZoneInfo

    BKK_TZ = ZoneInfo("Asia/Bangkok")
except Exception:
    BKK_TZ = timezone(timedelta(hours=7))

BASE_DIR = Path("/home/dev/.local/share/motion-studio")
VENV_PY = BASE_DIR / "venv" / "bin" / "python"
STUDIO_JOB = BASE_DIR / "scripts" / "studio_job.py"
MOTION_STUDIO_BIN = "/home/dev/.local/bin/motion-studio"
AGY_BIN = os.environ.get("AGY_BIN", "/home/dev/.local/bin/agy")
PROFILES_DIR = Path("/home/dev/.agy-profiles")
NOTIFY_TELEGRAM = "/home/dev/projects/notify-telegram.py"
JOBS_DIR = Path("/home/dev/.gemini/outputs/video-studio/jobs")
HISTORY_PATH = Path("/home/dev/.gemini/outputs/video-studio/daily_topics_history.json")
DASHBOARD_ORIGIN = "https://homelab.tail285279.ts.net"

DEFAULT_DURATION = 50
MIN_DURATION = 25
MAX_DURATION = 90
LOW_CREDIT_THB = 10.0
SUBPROCESS_TIMEOUT_SEC = 3600
AGY_TIMEOUT_SEC = 90
LOG_TAIL_LINES = 15
SIMILARITY_THRESHOLD = 0.55

JOB_ID_RE = re.compile(r"^[a-z0-9-]{6,40}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FAILED_STATUSES = {"failed", "error"}
ALLOWED_BGM = {"warm_tech", "story_cinematic", "dawn_ambient", "none"}

RELIGIOUS_KEYWORDS = (
    "อิสลาม", "ศาสนา", "หะดีษ", "อัลกุรอาน", "ละหมาด", "ดุอา", "อัลลอฮ์", "นบี",
    "รอมฎอน", "ซุนนะฮ์", "ศาสดา", "พุทธ", "ธรรมะ", "คริสต์",
    "islam", "hadith", "quran", "dua", "prayer", "sunnah",
)

HEALTH_DISCLAIMER = (
    "หมายเหตุ: ข้อมูลนี้จัดทำขึ้นเพื่อให้ความรู้ด้านสุขภาพทั่วไปเท่านั้น "
    "ไม่ใช่การวินิจฉัยหรือคำแนะนำทางการแพทย์ หากมีอาการผิดปกติหรือโรคประจำตัวควรปรึกษาแพทย์"
)

STYLE_POOLS: dict[str, list[str]] = {
    "tech": [
        "look-3", "look-5", "look-8", "look-9", "look-21",
        "look-29", "look-33", "look-34", "look-38", "look-1",
    ],
    "health": [
        "look-5", "look-8", "look-23", "look-26", "look-31",
        "look-33", "look-36", "look-37", "look-1", "look-21",
    ],
}

SLOT_DEFAULTS: dict[str, dict[str, Any]] = {
    "tech": {
        "bgm": "warm_tech",
        "category": "28",
        "labelTh": "เทคโนโลยี (รอบเที่ยง)",
        "emoji": "💻",
        "defaultTags": ["เทคโนโลยี", "ไอที", "ความรู้ไอที", "Shorts", "ย่อโลกมายำ"],
    },
    "health": {
        "bgm": "story_cinematic",
        "category": "27",
        "labelTh": "สุขภาพ (รอบเย็น)",
        "emoji": "💚",
        "defaultTags": ["สุขภาพ", "ดูแลตัวเอง", "ความรู้สุขภาพ", "Shorts", "ย่อโลกมายำ"],
    },
}

SEED_TOPICS: list[dict[str, str]] = [
    {"slot": "tech", "topic": "CPU ทำงานยังไง Fetch-Decode-Execute"},
    {"slot": "tech", "topic": "RAM ทำงานยังไง โต๊ะทำงานความเร็วระดับนาโนวินาที"},
    {"slot": "tech", "topic": "การทำงานของมอเตอร์แม่เหล็กไฟฟ้า"},
    {"slot": "health", "topic": "Intermittent Fasting ทำงานยังไง ประโยชน์และข้อควรระวัง"},
    {"slot": "general", "topic": "คำถามสัมภาษณ์งานที่โดนถามบ่อย สูตรแนะนำตัว STAR"},
    {"slot": "general", "topic": "ข้อเสียของการเดินทางไกลไปทำงานทุกวัน"},
    {"slot": "health", "topic": "รักษารากฟัน คืออะไร ทำยังไง ดีไหม"},
    {"slot": "tech", "topic": "แผงโซลาร์เซลล์ทำงานยังไง จากแสงแดดสู่ไฟบ้าน"},
    {"slot": "health", "topic": "คิดบวกเปลี่ยนสมองได้จริงไหม วิทยาศาสตร์ 86,000 ล้านเซลล์ประสาท RAS Neuroplasticity"},
    {"slot": "tech", "topic": "AI Agent บน Homelab ทำงาน 24 ชม. ฟรีค่า API"},
    {"slot": "tech", "topic": "3 เทคนิคประหยัดค่าไฟบ้านด้วยมิเตอร์ PZEM-01 และ Home Assistant"},
    {"slot": "general", "topic": "ประโยชน์ของการละหมาดฎุฮา 360 ข้อต่อ"},
    {"slot": "general", "topic": "หนึ่งในสามสุดท้ายของค่ำคืน ช่วงเวลาแห่งการขอดุอาอ์"},
]

FALLBACK_BANK: dict[str, list[dict[str, Any]]] = {
    "tech": [
        {
            "topic": "SSD vs HDD ต่างกันยังไง ทำไม SSD ถึงเปิดคอมเร็วกว่าหลายเท่า",
            "ytTitle": "SSD vs HDD ต่างกันยังไง? ทำไมเครื่องเร็วขึ้นทันตา #Shorts",
            "angle": "เปรียบเทียบจานหมุนกับชิป NAND Flash ความเร็ว Latency และวิธีเลือกซื้อให้คุ้ม",
            "tags": ["SSD", "HDD", "ฮาร์ดแวร์", "คอมพิวเตอร์", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "HTTPS และแม่กุญแจสีเขียวปกป้องรหัสผ่านบนเน็ตยังไง",
            "ytTitle": "HTTPS ป้องกันรหัสผ่านบนเน็ตยังไง? เข้าใจการเข้ารหัส TLS ใน 50 วิ #Shorts",
            "angle": "อธิบาย Asymmetric + Symmetric Encryption และ Digital Certificate แบบเข้าใจง่าย",
            "tags": ["HTTPS", "Cybersecurity", "ความปลอดภัยไซเบอร์", "อินเทอร์เน็ต", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "Wi-Fi 2.4GHz กับ 5GHz และ 6GHz ต่างกันตรงไหน เลือกคลื่นไหนดี",
            "ytTitle": "Wi-Fi 2.4GHz vs 5GHz เลือกยังไงให้เน็ตแรงไม่หลุด? #Shorts",
            "angle": "ความเร็ว vs ระยะทะลุกำแพง และการตั้งชื่อ SSID แยกให้เหมาะกับอุปกรณ์ในบ้าน",
            "tags": ["WiFi", "เราเตอร์", "เน็ตบ้าน", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "แบตเตอรี่ลิเธียมไอออนชาร์จ 20-80% ช่วยยืดอายุแบตได้จริงไหม",
            "ytTitle": "ชาร์จมือถือ 20-80% ยืดอายุแบตได้จริงไหม? กลไกเคมีในลิเธียมไอออน #Shorts",
            "angle": "แรงดันไฟสูงกับความร้อนที่ทำให้ขั้วแบตเสื่อมเร็ว และวิธีชาร์จที่พอดี",
            "tags": ["แบตเตอรี่", "สมาร์ตโฟน", "เทคโนโลยี", "ทิปส์ไอที", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "DNS ทำงานยังไง สมุดโทรศัพท์ของโลกอินเทอร์เน็ต",
            "ytTitle": "พิมพ์ชื่อเว็บแล้วเปิดหน้าเว็บได้ยังไง? รู้จัก DNS ใน 50 วิ #Shorts",
            "angle": "เส้นทางจาก Browser Cache → Resolver → Root/TLD → IP Address ในเสี้ยววินาที",
            "tags": ["DNS", "อินเทอร์เน็ต", "เครือข่าย", "ไอที", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "Passkey คืออะไร ทำไมกำลังมาแทนรหัสผ่านแบบเดิม",
            "ytTitle": "Passkey คืออะไร? ล็อกอินไม่ต้องจำรหัส แถมกันฟิชชิ่งได้ #Shorts",
            "angle": "กุญแจสาธารณะ-ส่วนตัวในชิปมือถือ (FIDO2) ที่ไม่ส่งรหัสผ่านข้ามเน็ต",
            "tags": ["Passkey", "ความปลอดภัย", "ล็อกอิน", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "Docker Container ต่างจาก Virtual Machine ยังไง ทำไมสายเซิร์ฟเวอร์นิยมใช้",
            "ytTitle": "Docker ต่างจาก VM ยังไง? ทำไมเปิดแอปได้ในเสี้ยววินาที #Shorts",
            "angle": "เทียบการจำลองทั้ง OS กับการแชร์ Kernel ของโฮสต์แบบเบาและพกพาง่าย",
            "tags": ["Docker", "Container", "เซิร์ฟเวอร์", "DevOps", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "Large Language Model อย่าง AI แชตบอตคาดเดาคำถัดไปยังไง",
            "ytTitle": "AI เข้าใจภาษาคนได้ยังไง? รู้จัก Token และ Next-Token Prediction #Shorts",
            "angle": "การตัดคำเป็น Token, Transformer Attention และเหตุผลที่ AI อาจหลอนข้อมูล",
            "tags": ["AI", "LLM", "ปัญญาประดิษฐ์", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "สาย Fiber Optic ส่งเน็ตความเร็วสูงด้วยแสงได้ยังไง",
            "ytTitle": "สายไฟเบอร์ส่งเน็ตด้วยแสงได้ยังไง? หลักการสะท้อนกลับหมด #Shorts",
            "angle": "แกนแก้วใยแก้วนำแสง Total Internal Reflection ส่งข้อมูลข้ามทวีป",
            "tags": ["FiberOptic", "เน็ตบ้าน", "วิทยาศาสตร์", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "GPU ต่างจาก CPU ยังไง ทำไม AI และการเล่นเกมต้องใช้การ์ดจอ",
            "ytTitle": "GPU ต่างจาก CPU ยังไง? ทำไม AI ต้องใช้การ์ดจอเป็นพันคอร์ #Shorts",
            "angle": "เทียบหัวสมองใหญ่ทำงานซับซ้อนทีละงาน กับกองทัพคอร์เล็กนับพันที่คำนวณขนาน",
            "tags": ["GPU", "CPU", "การ์ดจอ", "AI", "คอมพิวเตอร์", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ระบบเบรกฉุกเฉินอัตโนมัติในรถยนต์ (AEB) มองเห็นรถคันหน้ายังไง",
            "ytTitle": "รถเบรกเองได้ยังไง? เบื้องหลังกล้อง + เรดาร์ของระบบ AEB #Shorts",
            "angle": "Sensor Fusion ระหว่างกล้องและคลื่นเรดาร์ 77 GHz คำนวณ Time-to-Collision",
            "tags": ["รถยนต์ไฟฟ้า", "ADAS", "เทคโนโลยีรถยนต์", "ความปลอดภัย", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "NFC และระบบแตะจ่ายเงินทำงานยังไงในระยะไม่กี่เซนติเมตร",
            "ytTitle": "แตะมือถือจ่ายเงินทำงานยังไง? รู้จักคลื่น NFC 13.56 MHz #Shorts",
            "angle": "การเหนี่ยวนำแม่เหล็กไฟฟ้าระยะใกล้ + Tokenization แทนเลขบัตรจริง",
            "tags": ["NFC", "แตะจ่าย", "ฟินเทค", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "Two-Factor Authentication แบบ SMS vs แอป OTP ต่างกันยังไง",
            "ytTitle": "2FA แบบ SMS เสี่ยงตรงไหน? เทียบกับแอป Authenticator #Shorts",
            "angle": "ความเสี่ยง SIM Swap vs TOTP 30 วินาทีบนเครื่องตัวเอง",
            "tags": ["2FA", "ความปลอดภัยไซเบอร์", "OTP", "ไอที", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "อินเวอร์เตอร์ในแอร์บ้านช่วยประหยัดไฟกว่ารุ่นธรรมดายังไง",
            "ytTitle": "แอร์ Inverter ประหยัดไฟกว่าแอร์ธรรมดายังไง? #Shorts",
            "angle": "คอมเพรสเซอร์ปรับรอบต่อเนื่องเทียบกับการตัด-ต่อกระชากไฟทุกครั้งที่อุณหภูมิเปลี่ยน",
            "tags": ["แอร์Inverter", "ประหยัดไฟ", "เครื่องใช้ไฟฟ้า", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "GPS รู้ตำแหน่งเราบนโลกแม่นยำไม่กี่เมตรจากดาวเทียมยังไง",
            "ytTitle": "GPS รู้ตำแหน่งแม่นยำได้ยังไง? ไขความลับดาวเทียม 4 ดวง + ทฤษฎีสัมพัทธภาพ #Shorts",
            "angle": "Trilateration วัดเวลาสัญญาณแสงและนาฬิกาอะตอมที่ต้องชดเชยเวลาตามไอน์สไตน์",
            "tags": ["GPS", "ดาวเทียม", "แผนที่", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "QR Code เก็บข้อมูลได้ยังไง แม้แหว่งไปบางส่วนยังสแกนติด",
            "ytTitle": "ทำไม QR Code โดนบังบางส่วนยังสแกนติด? รู้จัก Reed-Solomon #Shorts",
            "angle": "Finder Patterns 3 มุม และรหัสแก้ข้อผิดพลาดที่กู้ข้อมูลคืนได้สูงสุด ~30%",
            "tags": ["QRCode", "คณิตศาสตร์", "เทคโนโลยี", "ไอที", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "Noise Cancelling ในหูฟังตัดเสียงรบกวนรอบข้างให้เงียบได้ยังไง",
            "ytTitle": "หูฟังตัดเสียงรบกวน (ANC) ทำงานยังไง? เสียงหักล้างเสียง #Shorts",
            "angle": "ไมโครโฟนจับคลื่นรบกวนแล้วสร้างคลื่นเฟสตรงข้าม 180 องศาหักล้างแบบเรียลไทม์",
            "tags": ["ANC", "หูฟัง", "คลื่นเสียง", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "VPN เข้ารหัสข้อมูลยังไง และช่วยเรื่องอะไรได้บ้าง-ไม่ได้บ้าง",
            "ytTitle": "VPN ทำงานยังไง? ป้องกันอะไรได้และไม่ควรเข้าใจผิดเรื่องไหน #Shorts",
            "angle": "อุโมงค์เข้ารหัสระหว่างเครื่องกับเซิร์ฟเวอร์ VPN พร้อมข้อจำกัดเรื่อง Tracker/Cookies",
            "tags": ["VPN", "ความเป็นส่วนตัว", "อินเทอร์เน็ต", "ความปลอดภัย", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "RAID กับ Backup ต่างกันยังไง อย่าเข้าใจผิดว่า RAID คือการสำรองข้อมูล",
            "ytTitle": "RAID ไม่ใช่ Backup! ทำไมฮาร์ดดิสก์พังพร้อมกันยังกู้ไม่ได้ #Shorts",
            "angle": "RAID เพิ่มความพร้อมใช้งานเมื่อดิสก์พัง 1 ลูก แต่ป้องกันไฟล์ถูกลบหรือ Ransomware ไม่ได้",
            "tags": ["RAID", "Backup", "NAS", "สำรองข้อมูล", "ไอที", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "E-Ink ในเครื่องอ่านอีบุ๊กทำไมไม่แสบตาและแบตอยู่ได้เป็นสัปดาห์",
            "ytTitle": "จอ E-Ink ต่างจากจอมือถือยังไง? ทำไมอ่านนานแล้วไม่ปวดตา #Shorts",
            "angle": "เม็ดหมึกประจุไฟฟ้าสะท้อนแสงธรรมชาติ ไม่ยิงแสงสีฟ้า และกินไฟเฉพาะตอนพลิกหน้า",
            "tags": ["EInk", "อีบุ๊ก", "หน้าจอ", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "UPS เครื่องสำรองไฟป้องกันไฟตกไฟกระชากให้คอมและเราเตอร์ยังไง",
            "ytTitle": "ทำไมคอมและ NAS ควรมี UPS? เทียบแบบ Offline vs Pure Sine Wave #Shorts",
            "angle": "การสลับไฟในเสี้ยววินาที ป้องกันดิสก์พังและไฟล์ระบบเสียหายตอนไฟดับ",
            "tags": ["UPS", "เครื่องสำรองไฟ", "คอมพิวเตอร์", "Homelab", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "Regenerative Braking ในรถ EV แปลงแรงเบรกกลับมาชาร์จแบตยังไง",
            "ytTitle": "รถไฟฟ้าเบรกแล้วได้ไฟคืนมายังไง? รู้จัก Regenerative Braking #Shorts",
            "angle": "สลับบทบาทมอเตอร์ขับเคลื่อนเป็นเครื่องกำเนิดไฟฟ้าขณะชะลอรถ",
            "tags": ["รถไฟฟ้า", "EV", "RegenerativeBraking", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "API คืออะไร ตัวกลางที่ทำให้แอปต่างๆ คุยกันได้",
            "ytTitle": "API คืออะไร? เข้าใจใน 50 วิผ่านภาพพนังงานรับออเดอร์ร้านอาหาร #Shorts",
            "angle": "Request → Server → JSON Response และเหตุผลที่แอปแผนที่และจ่ายเงินเชื่อมกันได้",
            "tags": ["API", "โปรแกรมมิ่ง", "ซอฟต์แวร์", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ระบบระบายความร้อน Vapor Chamber ในมือถือเรือธงทำงานยังไง",
            "ytTitle": "มือถือเกมมิ่งระบายความร้อนด้วยไอน้ำได้ยังไง? รู้จัก Vapor Chamber #Shorts",
            "angle": "วงจรระเหย-ควบแน่นของของเหลวภายในแผ่นทองแดงบางเฉียบกระจายความร้อนเร็ว",
            "tags": ["VaporChamber", "สมาร์ตโฟน", "ระบายความร้อน", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "Bluetooth LE Audio และ Auracast กำลังเปลี่ยนวิธีฟังเสียงไร้สายยังไง",
            "ytTitle": "Bluetooth ยุคใหม่เชื่อมหูฟังหลายอันพร้อมกันได้! รู้จัก Auracast #Shorts",
            "angle": "โคเดก LC3 ประหยัดแบตกว่าเดิมและการกระจายเสียงสาธารณะในสนามบิน/โรงหนัง",
            "tags": ["Bluetooth", "Auracast", "ไร้สาย", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "การบีบอัดภาพ WebP และ AVIF ลดขนาดไฟล์เว็บลงครึ่งหนึ่งยังไง",
            "ytTitle": "ทำไมรูปบนเว็บเดี๋ยวนี้ชัดแต่ไฟล์นิดเดียว? รู้จัก WebP และ AVIF #Shorts",
            "angle": "การเข้ารหัสพื้นที่สีและเฟรมแบบสมัยใหม่ช่วยให้เว็บโหลดไวและประหยัดเน็ต",
            "tags": ["AVIF", "WebP", "เว็บ", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "Smart Plug และโปรโตคอล Zigbee ต่างจากอุปกรณ์ Wi-Fi ในบ้านอัจฉริยะยังไง",
            "ytTitle": "Smart Home ใช้ Zigbee ดีกว่า Wi-Fi ตรงไหน? ไม่แย่งเน็ตเราเตอร์ #Shorts",
            "angle": "เครือข่าย Mesh กินไฟต่ำและทำงานต่อในบ้านได้แม้เน็ตบ้านหลุด",
            "tags": ["Zigbee", "SmartHome", "IoT", "บ้านอัจฉริยะ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ระบบแจ้งเตือนแผ่นดินไหวในมือถือรู้ล่วงหน้าไม่กี่วินาทียังไง",
            "ytTitle": "มือถือแจ้งเตือนแผ่นดินไหวก่อนคลื่นแรงมาถึงได้ยังไง? #Shorts",
            "angle": "คลื่น P-wave เดินทางเร็วกว่าคลื่นทำลาย S-wave + เซ็นเซอร์ Accelerometer นับล้านเครื่อง",
            "tags": ["แผ่นดินไหว", "แจ้งเตือนภัย", "สมาร์ตโฟน", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "กฎ 3-2-1 Backup วิธีสำรองข้อมูลสำคัญไม่ให้สูญหายตลอดกาล",
            "ytTitle": "สูตรสำรองข้อมูล 3-2-1 ป้องกันไฟล์หายจากฮาร์ดดิสก์พังและไวรัส #Shorts",
            "angle": "3 สำเนา 2 สื่อต่างชนิด 1 ที่นอกบ้าน/คลาวด์ ทำง่ายในชีวิตจริง",
            "tags": ["Backup", "321Backup", "สำรองข้อมูล", "ไอที", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "OLED vs Mini-LED จอสองแบบนี้ให้สีดำสนิทและความสว่างต่างกันยังไง",
            "ytTitle": "จอ OLED vs Mini-LED แบบไหนเหมาะกับคุณ? เทียบชัดใน 50 วิ #Shorts",
            "angle": "พิกเซลเปล่งแสงเองได้เทียบกับโซนไฟ Backlight นับพันดวงและความเสี่ยง Burn-in",
            "tags": ["OLED", "MiniLED", "ทีวี", "หน้าจอ", "เทคโนโลยี", "Shorts", "ย่อโลกมายำ"],
        },
    ],
    "health": [
        {
            "topic": "กฎ 20-20-20 พักสายตาจากหน้าจอป้องกันอาการตาล้าและตาแห้ง",
            "ytTitle": "จ้องจอนานปวดตา! ใช้กฎ 20-20-20 พักกล้ามเนื้อตายังไงให้ได้ผล #Shorts",
            "angle": "กล้ามเนื้อ Ciliary หดเกร็งตอนมองใกล้ อัตรากะพริบตาลดลง และวิธีพักทุก 20 นาที",
            "tags": ["ถนอมสายตา", "ออฟฟิศซินโดรม", "202020", "สุขภาพตา", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ทำไมดื่มกาแฟทันทีหลังตื่นนอนถึงทำให้บ่ายง่วงกว่าเดิม (กลไก Adenosine)",
            "ytTitle": "เพิ่งตื่นอย่าเพิ่งรีบดื่มกาแฟ! รู้จักกลไก Adenosine กับ Cortisol #Shorts",
            "angle": "คาเฟอีนบล็อกตัวรับ Adenosine ชั่วคราวและช่วงเวลาที่เหมาะสมหลังตื่น 60–90 นาที",
            "tags": ["กาแฟ", "คาเฟอีน", "การนอน", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "เดินหลังมื้ออาหาร 10-15 นาที ช่วยคุมระดับน้ำตาลในเลือดยังไง",
            "ytTitle": "เดินเล่นหลังกินข้าวแค่ 10 นาที ช่วยลดน้ำตาลพุ่งได้ยังไง? #Shorts",
            "angle": "กล้ามเนื้อขาใช้กลูโคสผ่าน GLUT4 โดยไม่ต้องพึ่งอินซูลินมาก ลดง่วงหลังมื้ออาหาร",
            "tags": ["คุมน้ำตาล", "เดินหลังอาหาร", "เบาหวาน", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "นั่งทำงานนานเกินไปเกิดอะไรขึ้นกับหลังและหลอดเลือด ทริคขยับทุก 30 นาที",
            "ytTitle": "นั่งทำงานทั้งวันเสี่ยงอะไร? วิธีแก้ปวดหลังและกระตุ้นเลือดไหลเวียน #Shorts",
            "angle": "แรงกดหมอนรองกระดูกและกล้ามเนื้อสะโพกตึง พร้อมท่าคลายสั้นๆ ทุกครึ่งชั่วโมง",
            "tags": ["ออฟฟิศซินโดรม", "ปวดหลัง", "ท่านั่งทำงาน", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "วัฏจักรการนอนหลับ 90 นาที (Sleep Cycle) ทำไมนอนครบชั่วโมงยังตื่นมาเพลีย",
            "ytTitle": "นอน 8 ชม. ทำไมยังงัวเงีย? รู้จัก Sleep Cycle และช่วงตื่นที่สดชื่น #Shorts",
            "angle": "Light Sleep, Deep Sleep, REM และอาการ Sleep Inertia เมื่อปลุกกลางหลับลึก",
            "tags": ["การนอนหลับ", "SleepCycle", "นอนไม่หลับ", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ดื่มน้ำแค่ไหนถึงพอดี เช็กง่ายๆ จากสีปัสสาวะและสัญญาณขาดน้ำอ่อนๆ",
            "ytTitle": "วันหนึ่งต้องดื่มน้ำกี่แก้ว? วิธีเช็กว่าร่างกายขาดน้ำแบบแม่นยำ #Shorts",
            "angle": "สังเกตสีปัสสาวะเหลืองอ่อน ผลของการขาดน้ำต่อสมาธิ-ปวดหัว และข้อควรระวังในผู้ป่วยไต/หัวใจ",
            "tags": ["ดื่มน้ำ", "ขาดน้ำ", "สุขภาพประจำวัน", "ไต", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "แสงแดดยามเช้าช่วยตั้งนาฬิกาชีวิต (Circadian Rhythm) ให้หลับง่ายตอนกลางคืนยังไง",
            "ytTitle": "รับแดดตอนเช้าแค่ 10 นาที ช่วยให้นอนหลับง่ายขึ้นตอนกลางคืนได้ไง? #Shorts",
            "angle": "เซลล์รับแสงในจอตาตั้งเวลา SCN ในสมองให้หลั่ง Melatonin ตรงเวลาในอีก ~14–16 ชม.",
            "tags": ["นาฬิกาชีวิต", "นอนหลับ", "แสงแดดเช้า", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ลำดับการกินอาหาร ผัก-โปรตีน-แป้ง ช่วยชะลอน้ำตาลและอิ่มนานขึ้นจริงไหม",
            "ytTitle": "เปลี่ยนแค่ลำดับการกิน ผัก→โปรตีน→ข้าว ช่วยชะลอน้ำตาลได้ยังไง? #Shorts",
            "angle": "ใยอาหารและโปรตีนช่วยชะลอการดูดซึมคาร์โบไฮเดรตในลำไส้เล็กอย่างเป็นธรรมชาติ",
            "tags": ["โภชนาการ", "คุมน้ำตาล", "ลดพุง", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "แปรงฟันทันทีหลังกินของเปรี้ยวหรือน้ำอัดลมทำร้ายเคลือบฟันยังไง",
            "ytTitle": "กินของเปรี้ยวแล้วห้ามแปรงฟันทันที! รอ 30 นาทีช่วยฟันยังไง #Shorts",
            "angle": "กรดทำให้ผิวเคลือบฟันอ่อนตัวชั่วคราว น้ำลายต้องใช้เวลาปรับค่า pH คืนก่อนแปรง",
            "tags": ["ดูแลฟัน", "เคลือบฟัน", "ทันตกรรม", "สุขภาพช่องปาก", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "หายใจเข้าช้า-ผ่อนยาว (Physiological Sigh) ลดความเครียดฉับพลันยังไง",
            "ytTitle": "เครียดใจเต้นแรง? เทคนิคหายใจ 2 จังหวะลดความตึงเครียดใน 30 วิ #Shorts",
            "angle": "กระตุ้นเส้นประสาทวากัส (Vagus Nerve) และขยายถุงลมปอดเพื่อชะลออัตราหัวใจ",
            "tags": ["ลดเครียด", "ฝึกหายใจ", "สุขภาพจิต", "ระบบประสาท", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ก้มดูจอมือถือบ่อย (Text Neck) เพิ่มแรงกดบนกระดูกคอมากแค่ไหน",
            "ytTitle": "ก้มเล่นมือถือ 60 องศา คอแบกน้ำหนักกี่กิโล? วิธีจัดท่าที่ถูกต้อง #Shorts",
            "angle": "ฟิสิกส์ของแนวกระดูกคอเมื่อก้มหน้าเทียบกับท่ายกมือถือขึ้นระดับสายตา",
            "tags": ["TextNeck", "ปวดคอ", "กระดูกคอ", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "โซเดียมแฝงในอาหารจานเดียวและน้ำจิ้ม กินยังไงไม่ให้เกินวันละ 2,000 มก.",
            "ytTitle": "ไม่กินเค็มแต่ความดันขึ้น? เช็กโซเดียมแฝงที่คนไทยมักมองข้าม #Shorts",
            "angle": "เกณฑ์ WHO ไม่เกิน 2,000 มก./วัน และทริคชิมก่อนปรุง-ลดซดน้ำซุป",
            "tags": ["โซเดียม", "ความดันโลหิต", "โรคไต", "โภชนาการ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "คาร์ดิโอโซน 2 (Zone 2) คืออะไร ทำไมถึงเหมาะกับหัวใจและการเผาผลาญ",
            "ytTitle": "ออกกำลังกาย Zone 2 คืออะไร? เหนื่อยแค่พอคุยได้แต่ดีต่อหัวใจสุดๆ #Shorts",
            "angle": "ความหนักระดับ Talk Test กระตุ้นไมโทคอนเดรียและใช้ไขมันเป็นพลังงานหลัก",
            "tags": ["Zone2", "ออกกำลังกาย", "คาร์ดิโอ", "สุขภาพหัวใจ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ใยอาหารละลายน้ำกับไม่ละลายน้ำ ต่างกันยังไงต่อลำไส้และคอเลสเตอรอล",
            "ytTitle": "ไฟเบอร์มี 2 แบบ! กินผักผลไม้ยังไงให้ลำไส้ดีและคุมไขมันด้วย #Shorts",
            "angle": "ใยละลายน้ำเป็นอาหารจุลินทรีย์ดีและดักจับน้ำดี ส่วนไม่ละลายน้ำช่วยเพิ่มกากใยขับถ่าย",
            "tags": ["ไฟเบอร์", "ลำไส้", "ขับถ่าย", "โภชนาการ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "แสงสีฟ้าจากหน้าจอก่อนนอนรบกวนฮอร์โมนเมลาโทนินยังไง",
            "ytTitle": "เล่นมือถือก่อนนอนทำไมหลับยาก? กลไกแสงสีฟ้ากับเมลาโทนิน #Shorts",
            "angle": "ทั้งแสงช่วง 460-480 nm และการกระตุ้นสมองจากคอนเทนต์ทำให้เลื่อนเวลานอน",
            "tags": ["แสงสีฟ้า", "นอนไม่หลับ", "เมลาโทนิน", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ฝึกกล้ามเนื้อแรงต้าน (Resistance Training) สำคัญยังไงหลังอายุ 30 ปี",
            "ytTitle": "อายุเกิน 30 ต้องรู้! ทำไมเวทเทรนนิ่งถึงสำคัญพอๆ กับวิ่ง #Shorts",
            "angle": "ชะลอภาวะมวลกล้ามเนื้อลดลงตามวัย (Sarcopenia) และเพิ่มความหนาแน่นกระดูก",
            "tags": ["เวทเทรนนิ่ง", "กล้ามเนื้อ", "กระดูกแข็งแรง", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "น้ำตาลแฝงในเครื่องดื่มชงและน้ำผลไม้ มีผลต่อตับและไตรกลีเซอไรด์ยังไง",
            "ytTitle": "น้ำตาลในเครื่องดื่มชง 1 แก้ว เท่ากับกี่ช้อนชา? ผลต่อไขมันพอกตับ #Shorts",
            "angle": "เกณฑ์น้ำตาลเติมไม่ควรเกิน 6 ช้อนชา/วัน และวิธีลดหวานทีละระดับ",
            "tags": ["ลดหวาน", "น้ำตาลแฝง", "ไขมันพอกตับ", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "PM2.5 เข้าปอดและกระแสเลือดได้ยังไง วิธีเลือกหน้ากาก N95 ที่แนบสนิท",
            "ytTitle": "ฝุ่น PM2.5 เล็กแค่ไหน? ทำไมหน้ากากผ้าเอาไม่อยู่ และวิธีใส่ให้ถูก #Shorts",
            "angle": "ขนาด 2.5 ไมครอนทะลุถึงถุงลมปอด พร้อมหลักเช็ก Fit Check ขอบหน้ากาก",
            "tags": ["PM25", "ฝุ่นพิษ", "หน้ากากN95", "สุขภาพปอด", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "กรดไหลย้อน (GERD) กับพฤติกรรมกินแล้วนอนทันที แก้ที่หูรูดหลอดอาหารยังไง",
            "ytTitle": "แสบกลางอกหลังกินข้าว! เข้าใจกลไกกรดไหลย้อนและกฎ 3 ชั่วโมงก่อนนอน #Shorts",
            "angle": "เว้น 2–3 ชม.หลังอาหารก่อนเอนนอน นอนตะแคงซ้าย และลดมื้อดึกไขมันสูง",
            "tags": ["กรดไหลย้อน", "แสบกลางอก", "ทางเดินอาหาร", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "การล้างมือด้วยสบู่ 20 วินาที ทำลายเยื่อหุ้มไขมันของไวรัสและแบคทีเรียยังไง",
            "ytTitle": "ทำไมต้องล้างมือด้วยสบู่นาน 20 วินาที? กลไกระดับโมเลกุลที่ฆ่าเชื้อได้ #Shorts",
            "angle": "โมเลกุลสบู่มีหัวชอบน้ำ-หางชอบไขมันเข้าไปแทรกและแตกเกราะหุ้มเชื้อโรค",
            "tags": ["ล้างมือ", "ป้องกันโรค", "สุขอนามัย", "วิทยาศาสตร์สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "วิตามินดีจากแสงแดดอ่อนและอาหาร ช่วยดูดซึมแคลเซียมและภูมิคุ้มกันยังไง",
            "ytTitle": "คนทำงานในออฟฟิศเสี่ยงขาดวิตามินดี! รับแดดยังไงให้พอดีไม่ไหม้ #Shorts",
            "angle": "สังเคราะห์ผ่านผิวหนังช่วงเช้า/บ่ายแก่ 10–15 นาที และบทบาทต่อกระดูกและภูมิคุ้มกัน",
            "tags": ["วิตามินดี", "กระดูก", "ภูมิคุ้มกัน", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "เสียงดังเกิน 85 เดซิเบลจากหูฟังทำลายเซลล์ขนในหูชั้นในถาวรยังไง",
            "ytTitle": "เปิดหูฟังดังแค่ไหนถึงเสี่ยงหูตึงถาวร? รู้จักกฎ 60/60 ถนอมหู #Shorts",
            "angle": "เซลล์ขนรับเสียงใน Cochlea ไม่สามารถงอกใหม่ได้ ลดความเสี่ยงด้วยกฎ 60% ไม่เกิน 60 นาที",
            "tags": ["ถนอมหู", "หูฟัง", "การได้ยิน", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ไขมันทรานส์ ไขมันอิ่มตัว และไขมันไม่อิ่มตัว ต่างกันยังไงต่อหลอดเลือดหัวใจ",
            "ytTitle": "แยกไขมันดี-ไขมันร้ายใน 50 วิ เลือกน้ำมันทำอาหารยังไงให้หัวใจแข็งแรง #Shorts",
            "angle": "ผลต่อ LDL และ HDL ในเลือด และการอ่านฉลากโภชนาการก่อนซื้อ",
            "tags": ["ไขมันดี", "คอเลสเตอรอล", "สุขภาพหัวใจ", "โภชนาการ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ตะคริวตอนกลางคืนเกิดจากอะไร วิธีปฐมพยาบาลยืดกล้ามเนื้อให้คลายทันที",
            "ytTitle": "เป็นตะคริวกลางดึกทำไงให้หายไว? สาเหตุและท่าเหยียดน่องที่ถูกต้อง #Shorts",
            "angle": "ความล้าของกล้ามเนื้อ เกลือแร่-น้ำ และการดึงปลายเท้าเข้าหาตัวช้าๆ",
            "tags": ["ตะคริว", "ปวดน่อง", "ปฐมพยาบาล", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "อาการเตือนโรคหลอดเลือดสมอง BE FAST ที่ทุกคนควรจำให้ขึ้นใจ",
            "ytTitle": "จำง่าย 6 สัญญาณเตือนสโตรก BE FAST รู้ไวช่วยชีวิตทันเวลา #Shorts",
            "angle": "Balance, Eyes, Face, Arm, Speech, Time รีบโทร 1669 ทันทีที่พบอาการ",
            "tags": ["สโตรก", "หลอดเลือดสมอง", "BEFAST", "ความรู้สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ทำไมไม่ควรกินยาแก้ปวดกลุ่ม NSAIDs ตอนท้องว่างหรือติดต่อกันนานๆ",
            "ytTitle": "กินยาแก้ปวดบ่อยระวังกระเพาะและไต! ข้อควรรู้การใช้ยากลุ่ม NSAIDs #Shorts",
            "angle": "กลไกยับยั้ง Prostaglandin ที่ปกป้องเยื่อบุกระเพาะและการไหลเวียนเลือดที่ไต",
            "tags": ["ยาแก้ปวด", "NSAIDs", "โรคกระเพาะ", "ไต", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "ประโยชน์ของจุลินทรีย์ในลำไส้ (Gut Microbiome) จากอาหารหมักดองและพรีไบโอติกส์",
            "ytTitle": "ลำไส้คือสมองที่สอง! ดูแลจุลินทรีย์ดีด้วยพรีไบโอติกส์และโพรไบโอติกส์ #Shorts",
            "angle": "ความต่างของเชื้อดีกับอาหารของเชื้อ และบทบาทต่อภูมิคุ้มกันและอารมณ์",
            "tags": ["จุลินทรีย์ลำไส้", "โพรไบโอติกส์", "ลำไส้", "สุขภาพ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "วิธีวัดความดันโลหิตที่บ้านให้ค่าแม่นยำ ไม่คลาดเคลื่อน",
            "ytTitle": "วัดความดันที่บ้านยังไงให้แม่นยำ? 5 ข้อห้ามก่อนกดปุ่มวัด #Shorts",
            "angle": "นั่งพัก 5 นาที วางแขนระดับหัวใจ ไม่ไขว่ห้าง งดกาแฟ/บุหรี่ 30 นาทีก่อนวัด",
            "tags": ["ความดันโลหิต", "วัดความดัน", "สุขภาพ", "โรคความดัน", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "การยืดเหยียดแบบ Dynamic ก่อนออกกำลังกาย vs Static หลังออกกำลังกาย",
            "ytTitle": "ยืดกล้ามเนื้อผิดจังหวะเสี่ยงบาดเจ็บ! ก่อน-หลังเล่นต้องยืดคนละแบบ #Shorts",
            "angle": "วอร์มอัพแบบเคลื่อนไหวก่อนเริ่ม และยืดค้าง 15–30 วินาทีหลังจบเซสชัน",
            "tags": ["ยืดเหยียด", "วอร์มอัพ", "ออกกำลังกาย", "ป้องกันบาดเจ็บ", "Shorts", "ย่อโลกมายำ"],
        },
        {
            "topic": "อาการหมดไฟ (Burnout) ต่างจากเหนื่อยธรรมดายังไง 3 สัญญาณที่ต้องพัก",
            "ytTitle": "เหนื่อยสะสมหรือกำลัง Burnout? เช็ก 3 สัญญาณเตือนและวิธีฟื้นพลังใจ #Shorts",
            "angle": "อ่อนเพลียเรื้อรัง เฉยชาต่องาน ประสิทธิภาพตก และการตั้งขอบเขตเวลาพัก",
            "tags": ["Burnout", "สุขภาพจิต", "หมดไฟ", "วัยทำงาน", "Shorts", "ย่อโลกมายำ"],
        },
    ],
}


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def default_today_bkk() -> date:
    return datetime.now(BKK_TZ).date()


def parse_date_arg(raw: str | None) -> date:
    if not raw:
        return default_today_bkk()
    val = raw.strip()
    if not DATE_RE.fullmatch(val):
        raise ValueError(f"รูปแบบวันที่ไม่ถูกต้อง: '{raw}' (ต้องเป็น YYYY-MM-DD)")
    try:
        return datetime.strptime(val, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError(f"วันที่ไม่ถูกต้อง: '{raw}' ({exc})") from exc


def pick_style_for_slot(slot: str, target_date: date) -> str:
    pool = STYLE_POOLS[slot]
    offset = 0 if slot == "tech" else 3
    return pool[(target_date.toordinal() + offset) % len(pool)]


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.parent / f".{path.name}.tmp.{os.getpid()}"
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    try:
        with tmp_path.open("w", encoding="utf-8") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def read_json_safe(path: Path) -> Any:
    try:
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def append_log_line(job_dir: Path, message: str) -> None:
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(BKK_TZ).strftime("%Y-%m-%d %H:%M:%S")
        with (job_dir / "log.txt").open("a", encoding="utf-8") as f:
            for line in str(message).splitlines() or [""]:
                f.write(f"[{ts}] [daily-content-clip] {line}\n")
    except Exception:
        pass


def read_log_tail(job_dir: Path, max_lines: int = LOG_TAIL_LINES) -> list[str]:
    log_path = job_dir / "log.txt"
    try:
        if not log_path.exists():
            return []
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        return lines[-max_lines:]
    except Exception:
        return []


def acquire_lock(lock_path: str) -> Any:
    lock_file = open(lock_path, "a+", encoding="utf-8")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_file.close()
        return None
    try:
        lock_file.seek(0)
        lock_file.truncate()
        lock_file.write(f"{os.getpid()}\n")
        lock_file.flush()
    except OSError:
        pass
    return lock_file


def release_lock(lock_file: Any) -> None:
    if lock_file is None:
        return
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass
    try:
        lock_file.close()
    except OSError:
        pass


def archive_failed_job(job_dir: Path, job_id: str) -> Path:
    n = 1
    while True:
        retry_id = f"{job_id}-retry{n}"
        retry_dir = JOBS_DIR / retry_id
        if not retry_dir.exists():
            break
        n += 1
    if not JOB_ID_RE.fullmatch(retry_id):
        raise ValueError(f"retry jobId ไม่ตรงรูปแบบที่อนุญาต: {retry_id}")

    job_dir.rename(retry_dir)
    for fname in ("job.json", "request.json"):
        fpath = retry_dir / fname
        payload = read_json_safe(fpath)
        if isinstance(payload, dict):
            payload["id"] = retry_id
            try:
                atomic_write_json(fpath, payload)
            except Exception:
                pass
    return retry_dir


def build_child_env() -> dict[str, str]:
    env = dict(os.environ)
    env["HOME"] = "/home/dev"
    env["PYTHONUNBUFFERED"] = "1"
    current_path = env.get("PATH", "")
    path_parts = [p for p in current_path.split(":") if p]
    for needed in ("/home/dev/.local/bin", "/usr/local/bin", "/usr/bin", "/bin"):
        if needed not in path_parts:
            path_parts.insert(0, needed)
    env["PATH"] = ":".join(path_parts)
    # Never set MOTION_REMOTE_RENDER so motion-studio offloads automatically
    return env


def assert_non_religious(topic: str, notes: str) -> None:
    haystack = f"{topic} {notes}".lower()
    matched = [kw for kw in RELIGIOUS_KEYWORDS if kw in haystack]
    if matched:
        raise ValueError(f"topic/notes มีคำต้องห้ามในกลุ่ม religious mode: {', '.join(matched)}")


def _normalize_text(text: str) -> str:
    cleaned = re.sub(r"#shorts\b", "", text or "", flags=re.IGNORECASE)
    cleaned = re.sub(r"[^\w\u0E00-\u0E7F]+", " ", cleaned.lower()).strip()
    return re.sub(r"\s+", " ", cleaned)


def _tokenize_for_similarity(text: str) -> set[str]:
    norm = _normalize_text(text)
    if not norm:
        return set()
    tokens: set[str] = set()
    for part in norm.split():
        tokens.add(part)
        # Add Thai 3-grams for compound phrases without spaces
        if re.search(r"[\u0E00-\u0E7F]", part) and len(part) >= 4:
            for i in range(len(part) - 2):
                tokens.add(part[i : i + 3])
    return tokens


def is_topic_duplicate(candidate: str, existing_topics: list[str]) -> tuple[bool, str | None]:
    cand_norm = _normalize_text(candidate)
    cand_compact = cand_norm.replace(" ", "")
    cand_tokens = _tokenize_for_similarity(candidate)
    if not cand_norm:
        return True, "empty"

    for past in existing_topics:
        past_norm = _normalize_text(past)
        past_compact = past_norm.replace(" ", "")
        if not past_norm:
            continue
        if len(cand_compact) >= 6 and len(past_compact) >= 6:
            if cand_compact in past_compact or past_compact in cand_compact:
                return True, past
        past_tokens = _tokenize_for_similarity(past)
        if cand_tokens and past_tokens:
            inter = len(cand_tokens & past_tokens)
            union = len(cand_tokens | past_tokens)
            if union > 0 and (inter / union) >= SIMILARITY_THRESHOLD:
                return True, past
    return False, None


def load_history_data(*, create_if_missing: bool) -> dict[str, Any]:
    existing = read_json_safe(HISTORY_PATH)
    if isinstance(existing, dict) and isinstance(existing.get("items"), list):
        return existing
    seeded = {
        "version": 1,
        "updatedAt": now_utc_iso(),
        "items": [
            {
                "slot": item["slot"],
                "topic": item["topic"],
                "ytTitle": item["topic"],
                "date": "seed",
                "source": "seed",
            }
            for item in SEED_TOPICS
        ],
    }
    if create_if_missing:
        atomic_write_json(HISTORY_PATH, seeded)
    return seeded


def collect_exclusion_topics(history_data: dict[str, Any]) -> list[str]:
    seen: list[str] = []
    for item in history_data.get("items") or []:
        if isinstance(item, dict):
            for k in ("topic", "ytTitle"):
                val = str(item.get(k) or "").strip()
                if val and val not in seen:
                    seen.append(val)
    if JOBS_DIR.exists():
        for jdir in sorted(JOBS_DIR.iterdir()):
            if not jdir.is_dir():
                continue
            jdata = read_json_safe(jdir / "job.json")
            if isinstance(jdata, dict):
                for k in ("topic", "title"):
                    val = str(jdata.get(k) or "").strip()
                    if val and val not in seen:
                        seen.append(val)
    return seen


def record_topic_history(
    *,
    slot: str,
    target_date: date,
    job_id: str,
    topic: str,
    yt_title: str,
    yt_url: str,
    style_id: str,
) -> None:
    data = load_history_data(create_if_missing=True)
    items = data.setdefault("items", [])
    if not isinstance(items, list):
        items = []
        data["items"] = items

    # Replace or append entry for this job_id
    entry = {
        "jobId": job_id,
        "date": target_date.isoformat(),
        "slot": slot,
        "topic": topic,
        "ytTitle": yt_title,
        "youtubeUrl": yt_url,
        "styleId": style_id,
        "recordedAt": now_utc_iso(),
    }
    replaced = False
    for idx, it in enumerate(items):
        if isinstance(it, dict) and it.get("jobId") == job_id:
            items[idx] = entry
            replaced = True
            break
    if not replaced:
        items.append(entry)
    data["updatedAt"] = now_utc_iso()
    atomic_write_json(HISTORY_PATH, data)


def _list_agy_homes() -> list[str | None]:
    homes: list[str | None] = []
    if PROFILES_DIR.exists():
        for d in sorted(PROFILES_DIR.iterdir()):
            if d.is_dir() and (d / ".gemini" / "antigravity-cli").exists():
                homes.append(str(d))
    return homes or [None]


def _extract_json_object(raw_text: str) -> dict[str, Any] | None:
    text = (raw_text or "").strip()
    if not text:
        return None
    # Strip markdown code fences if present
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            obj = json.loads(text[start : end + 1])
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            return None
    return None


def _ensure_shorts_title(title: str) -> str:
    t = re.sub(r"\s+", " ", (title or "").strip())
    if not t:
        t = "สาระน่ารู้วันนี้ #Shorts"
    if "#shorts" not in t.lower():
        suffix = " #Shorts"
        if len(t) + len(suffix) > 100:
            t = t[: 100 - len(suffix)].rstrip()
        t = f"{t}{suffix}"
    return t[:100]


def pick_fresh_topic(slot: str, target_date: date, exclusion_topics: list[str]) -> dict[str, Any]:
    slot_desc = (
        "เทคโนโลยี คอมพิวเตอร์ ไอที AI ฮาร์ดแวร์ เครือข่าย ความปลอดภัยไซเบอร์ หรือวิทยาศาสตร์ประยุกต์ใกล้ตัว"
        if slot == "tech"
        else "สุขภาพ การดูแลร่างกาย โภชนาการ การนอน การออกกำลังกาย หรือการป้องกันโรคตามหลักการแพทย์มาตรฐาน (WHO/CDC)"
    )
    past_block = "\n".join(f"- {t}" for t in exclusion_topics[-60:])
    prompt = (
        f"ช่วยคิด 1 หัวข้อสำหรับทำคลิปสั้น YouTube #Shorts ภาษาไทย ประจำวันที่ {target_date.isoformat()} "
        f"หมวด: {slot_desc}\n\n"
        "ข้อกำหนดบังคับ:\n"
        "1. ต้องเข้าใจง่าย น่าสนใจ ชวนติดตามตั้งแต่ 3 วินาทีแรก อธิบายจบได้ใน 45-55 วินาที\n"
        "2. ข้อมูลต้องอ้างอิงหลักฐานหรือกลไกทางวิทยาศาสตร์/การแพทย์ที่ตรวจสอบได้ ห้ามแต่งสถิติเอง ห้ามเรื่องการเงิน/คริปโต ห้ามเคลมรักษาโรคเกินจริง ห้ามเรื่องศาสนา\n"
        "3. ห้ามซ้ำหรือคล้ายกับหัวข้อที่เคยทำไปแล้วด้านล่างนี้เด็ดขาด:\n"
        f"{past_block}\n\n"
        "ตอบเป็น JSON object เดียวเท่านั้น (ห้ามอธิบายนอก JSON):\n"
        '{"topic": "หัวข้อคลิปสั้นกระชับ", "ytTitle": "ชื่อคลิป YouTube น่าคลิกไม่เกิน 90 ตัวอักษร ลงท้าย #Shorts", '
        '"angle": "สรุปมุมเล่าเรื่อง Hook -> กลไก/วิธีใช้ 3 จุด -> บทสรุป", "tags": ["แท็ก1", "แท็ก2", "แท็ก3", "Shorts", "ย่อโลกมายำ"]}'
    )

    homes = _list_agy_homes()
    attempts: list[tuple[str, str | None]] = []
    for model in ("gemini-3.8-flash-medium", "gemini-4-neon-high"):
        for h in homes:
            attempts.append((model, h))

    for model, home in attempts:
        cmd = [
            AGY_BIN,
            "-p",
            prompt,
            "--model",
            model,
            "--disable-slash-commands",
            "--dangerously-skip-permissions",
            "--print-timeout",
            f"{AGY_TIMEOUT_SEC}s",
        ]
        env = {**os.environ, "HOME": home} if home else dict(os.environ)
        try:
            res = subprocess.run(
                cmd,
                cwd="/home/dev/projects",
                env=env,
                capture_output=True,
                text=True,
                timeout=AGY_TIMEOUT_SEC + 20,
                check=False,
            )
            if res.returncode != 0:
                continue
            parsed = _extract_json_object(res.stdout or "")
            if not parsed:
                continue
            topic = str(parsed.get("topic") or "").strip()
            yt_title = _ensure_shorts_title(str(parsed.get("ytTitle") or topic))
            angle = str(parsed.get("angle") or "").strip()
            raw_tags = parsed.get("tags")
            tags = [str(x).strip() for x in raw_tags if str(x).strip()] if isinstance(raw_tags, list) else []
            if not topic:
                continue
            try:
                assert_non_religious(topic, angle)
            except ValueError:
                continue
            dup, _ = is_topic_duplicate(topic, exclusion_topics)
            if dup:
                continue
            return {
                "topic": topic,
                "ytTitle": yt_title,
                "angle": angle,
                "tags": tags or list(SLOT_DEFAULTS[slot]["defaultTags"]),
                "source": f"agy:{model}",
            }
        except Exception:
            continue

    # Curated fallback bank (guaranteed fresh daily topic)
    for item in FALLBACK_BANK[slot]:
        dup, _ = is_topic_duplicate(item["topic"], exclusion_topics)
        if not dup:
            return {
                "topic": item["topic"],
                "ytTitle": _ensure_shorts_title(item["ytTitle"]),
                "angle": item["angle"],
                "tags": list(item["tags"]),
                "source": "fallback-bank",
            }

    # Ultimate fallback if entire bank was exhausted
    idx = target_date.toordinal() % len(FALLBACK_BANK[slot])
    item = FALLBACK_BANK[slot][idx]
    return {
        "topic": f"{item['topic']} (อัปเดต {target_date.strftime('%d/%m')})",
        "ytTitle": _ensure_shorts_title(item["ytTitle"]),
        "angle": item["angle"],
        "tags": list(item["tags"]),
        "source": "fallback-bank-cycled",
    }


def build_slot_notes(slot: str, topic: str, angle: str, duration_sec: int) -> str:
    angle_part = f" แนวทางเล่า: {angle}" if angle else ""
    if slot == "tech":
        return (
            f"คลิปสั้นอธิบายเทคโนโลยีเรื่อง '{topic}' สำหรับ YouTube Shorts ความยาวเป้าหมาย {duration_sec} วินาที "
            "โครงสร้าง: 1) Hook ที่น่าสนใจใน 3 วินาทีแรก 2) อธิบายกลไกการทำงานหรือเทคนิคที่ใช้จริง 3 ประเด็นให้คนทั่วไปเข้าใจง่าย "
            "3) บทสรุปที่นำไปใช้ได้ทันที อ้างอิงข้อเท็จจริงทางเทคนิคที่ตรวจสอบได้เท่านั้น ห้ามแต่งตัวเลขสถิติเอง "
            "ห้ามทำเป็นข่าวหรือคำคมลอยๆ โทนเสียงกระชับ ชัดเจน น่าฟัง"
            f"{angle_part}"
        )[:1000]
    return (
        f"คลิปสั้นให้ความรู้ด้านสุขภาพเรื่อง '{topic}' สำหรับ YouTube Shorts ความยาวเป้าหมาย {duration_sec} วินาที "
        "โครงสร้าง: 1) Hook ปัญหาใกล้ตัวที่คนเจอบ่อย 2) อธิบายกลไกของร่างกายและวิธีดูแลตัวเองที่ใช้ได้จริง อ้างอิงหลักฐานทางการแพทย์ที่ยอมรับทั่วไป (เช่น WHO/CDC/งานวิจัยมาตรฐาน) "
        "3) ข้อควรระวังและสรุปสั้นๆ ห้ามวินิจฉัยโรค ห้ามสั่งยา ห้ามโฆษณาเกินจริง ห้ามแต่งตัวเลขสถิติเอง "
        "โทนเสียงอบอุ่น ชัดเจน น่าเชื่อถือ"
        f"{angle_part}"
    )[:1000]


def make_watch_url(video_path: str) -> str:
    return f"{DASHBOARD_ORIGIN}/api/gemini/local-file?path={video_path}"


def make_download_url(video_path: str) -> str:
    return f"{DASHBOARD_ORIGIN}/api/gemini/local-file?path={video_path}&download=1"


def parse_credit_output(raw_text: str) -> dict[str, Any]:
    text = (raw_text or "").strip()
    if not text:
        return {"ok": False}
    parsed = _extract_json_object(text)
    if parsed is not None:
        rem_val = None
        low_val = LOW_CREDIT_THB
        try:
            if parsed.get("remainingThb") is not None:
                rem_val = float(parsed["remainingThb"])
        except (TypeError, ValueError):
            rem_val = None
        try:
            if parsed.get("lowThb") is not None:
                low_val = float(parsed["lowThb"])
        except (TypeError, ValueError):
            low_val = LOW_CREDIT_THB
        is_low = bool(parsed.get("isLow")) or (rem_val is not None and rem_val < low_val)
        return {
            "ok": bool(parsed.get("ok", rem_val is not None)),
            "remainingThb": rem_val,
            "lowThb": low_val,
            "isLow": is_low,
        }
    return {"ok": False, "rawText": text}


def read_credit_info(env: dict[str, str]) -> dict[str, Any]:
    try:
        res = subprocess.run(
            [MOTION_STUDIO_BIN, "credit"],
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
            check=False,
        )
        out = (res.stdout or "").strip() or (res.stderr or "").strip()
        return parse_credit_output(out)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def extract_latest_output(job_data: dict[str, Any]) -> dict[str, Any]:
    outputs = job_data.get("outputs") if isinstance(job_data.get("outputs"), dict) else {}
    versions = job_data.get("versions") if isinstance(job_data.get("versions"), list) else []

    latest: dict[str, Any] = {}
    valid_versions = [v for v in versions if isinstance(v, dict)]
    if valid_versions:
        def _ver_key(v: dict[str, Any]) -> int:
            try:
                return int(v.get("version") or 0)
            except (TypeError, ValueError):
                return 0
        latest = max(valid_versions, key=_ver_key)

    video_path = str(latest.get("videoPath") or outputs.get("videoPath") or latest.get("path") or "").strip()
    watch_url = str(latest.get("watchUrl") or outputs.get("watchUrl") or "").strip() or (
        make_watch_url(video_path) if video_path else ""
    )
    download_url = str(latest.get("downloadUrl") or outputs.get("downloadUrl") or "").strip() or (
        make_download_url(video_path) if video_path else ""
    )

    duration_sec: float | None = None
    dur_raw = latest.get("durationSec") if latest.get("durationSec") is not None else outputs.get("durationSec")
    try:
        if dur_raw is not None:
            duration_sec = float(dur_raw)
    except (TypeError, ValueError):
        pass

    cost_details = latest.get("costDetails") if isinstance(latest.get("costDetails"), dict) else outputs.get("costDetails")
    if not isinstance(cost_details, dict):
        cost_details = {}

    def _first_float(*vals: Any) -> float | None:
        for val in vals:
            if val is not None:
                try:
                    return float(val)
                except (TypeError, ValueError):
                    continue
        return None

    cost_thb = _first_float(latest.get("costThb"), outputs.get("costThb"), cost_details.get("costThb"))
    clip_total_thb = _first_float(cost_details.get("clipTotalThb"), cost_thb)
    job_remaining_thb = _first_float(cost_details.get("remainingThb"))
    render_node = str(latest.get("renderNode") or outputs.get("renderNode") or job_data.get("renderNode") or "").strip()

    return {
        "title": str(job_data.get("title") or job_data.get("topic") or "").strip(),
        "videoPath": video_path,
        "watchUrl": watch_url,
        "downloadUrl": download_url,
        "durationSec": duration_sec,
        "costThb": cost_thb,
        "clipTotalThb": clip_total_thb,
        "voice": str(cost_details.get("voice") or "").strip(),
        "engine": str(cost_details.get("engine") or "").strip(),
        "jobRemainingThb": job_remaining_thb,
        "renderNode": render_node,
        "telegramError": str(outputs.get("telegramError") or "").strip(),
    }


def build_youtube_metadata(
    *,
    slot: str,
    topic: str,
    yt_title: str,
    tags: list[str],
    job_dir: Path,
) -> tuple[str, str, str]:
    title = _ensure_shorts_title(yt_title or topic)
    merged_tags: list[str] = []
    for t in [*tags, *SLOT_DEFAULTS[slot]["defaultTags"]]:
        t = str(t).strip()
        if t and t not in merged_tags:
            merged_tags.append(t)

    script_data = read_json_safe(job_dir / "script.json") or {}
    scenes = script_data.get("scenes") if isinstance(script_data.get("scenes"), list) else []
    points: list[str] = []
    for sc in scenes:
        if isinstance(sc, dict):
            hd = str(sc.get("title") or sc.get("heading") or "").strip()
            if hd:
                points.append(f"• {hd}")

    desc_lines = [topic]
    if points:
        desc_lines.append("")
        desc_lines.extend(points[:8])
    if slot == "health":
        desc_lines.append("")
        desc_lines.append(HEALTH_DISCLAIMER)
    desc_lines.append("")
    desc_lines.append("ช่อง ย่อโลกมายำ (@yaolokmayam)")
    return title, "\n".join(desc_lines), ",".join(merged_tags[:15])


def upload_to_youtube(
    *,
    slot: str,
    video_path: str,
    topic: str,
    yt_title: str,
    tags: list[str],
    job_dir: Path,
    job_data: dict[str, Any],
    env: dict[str, str],
    privacy: str = "public",
) -> dict[str, Any]:
    outputs = job_data.get("outputs") if isinstance(job_data.get("outputs"), dict) else {}
    existing_url = str(outputs.get("youtubeUrl") or "").strip()
    if existing_url:
        return {
            "ok": True,
            "id": str(outputs.get("youtubeId") or "").strip(),
            "url": existing_url,
            "privacy": str(outputs.get("youtubePrivacy") or privacy).strip(),
            "cached": True,
        }

    title, desc, tag_csv = build_youtube_metadata(
        slot=slot, topic=topic, yt_title=yt_title, tags=tags, job_dir=job_dir
    )
    category = SLOT_DEFAULTS[slot]["category"]
    cmd = [
        MOTION_STUDIO_BIN,
        "send-youtube",
        video_path,
        "--title",
        title,
        "--description",
        desc,
        "--tags",
        tag_csv,
        "--category",
        category,
        "--privacy",
        privacy,
        "--synthetic",
    ]
    append_log_line(job_dir, f"Uploading to YouTube (category={category}, privacy={privacy}): {title}")
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=600, env=env, check=False)
    except Exception as exc:
        err = f"send-youtube exception: {exc}"
        append_log_line(job_dir, f"WARN: {err}")
        return {"ok": False, "error": err}

    parsed = None
    for line in reversed((res.stdout or "").strip().splitlines()):
        obj = _extract_json_object(line)
        if obj and obj.get("url"):
            parsed = obj
            break

    job_path = job_dir / "job.json"
    latest_job = read_json_safe(job_path) if isinstance(read_json_safe(job_path), dict) else dict(job_data)
    out_obj = latest_job.setdefault("outputs", {})
    if not isinstance(out_obj, dict):
        out_obj = {}
        latest_job["outputs"] = out_obj

    if res.returncode == 0 and parsed:
        yt_id = str(parsed.get("id") or "").strip()
        yt_url = str(parsed.get("url") or "").strip()
        yt_priv = str(parsed.get("privacy") or privacy).strip()
        out_obj["youtubeId"] = yt_id
        out_obj["youtubeUrl"] = yt_url
        out_obj["youtubePrivacy"] = yt_priv
        out_obj.pop("youtubeError", None)
        latest_job["updatedAt"] = now_utc_iso()
        try:
            atomic_write_json(job_path, latest_job)
        except Exception:
            pass
        append_log_line(job_dir, f"YouTube upload OK: {yt_url} ({yt_priv})")
        return {"ok": True, "id": yt_id, "url": yt_url, "privacy": yt_priv, "title": title}

    err_msg = (res.stderr or res.stdout or f"send-youtube exited {res.returncode}").strip()
    err_short = err_msg.splitlines()[-1][:300] if err_msg else f"exit {res.returncode}"
    out_obj["youtubeError"] = err_short
    latest_job["updatedAt"] = now_utc_iso()
    try:
        atomic_write_json(job_path, latest_job)
    except Exception:
        pass
    append_log_line(job_dir, f"WARN: YouTube upload failed: {err_short}")
    return {"ok": False, "error": err_short}


def send_telegram_html(html_message: str, env: dict[str, str]) -> tuple[bool, str]:
    try:
        res = subprocess.run(
            ["/usr/bin/python3", NOTIFY_TELEGRAM, html_message],
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
            check=False,
        )
        if res.returncode == 0:
            return True, (res.stdout or "").strip()
        return False, (res.stderr or res.stdout or f"notify-telegram exited {res.returncode}").strip()
    except Exception as exc:
        return False, str(exc)


def format_success_html(
    *,
    slot: str,
    target_date: date,
    job_id: str,
    topic: str,
    style_id: str,
    info: dict[str, Any],
    credit: dict[str, Any],
    yt_info: dict[str, Any] | None = None,
) -> str:
    meta = SLOT_DEFAULTS[slot]
    clip_title = info.get("title") or topic
    dur = info.get("durationSec")
    dur_str = f"{dur:.1f} วินาที" if dur is not None and dur > 0 else "ไม่ทราบ"

    cost_thb = info.get("costThb")
    clip_total_thb = info.get("clipTotalThb")
    voice = info.get("voice") or ""
    engine = info.get("engine") or ""
    if clip_total_thb is not None:
        if clip_total_thb == 0.0 and not voice.startswith("gemini:") and engine != "gemini":
            cost_str = "฿0.00 (ฟรี)"
        elif cost_thb is not None and cost_thb == 0.0 and clip_total_thb > 0.0:
            cost_str = f"฿0.00 (แคช · รวมทั้งคลิป ฿{clip_total_thb:.2f})"
        else:
            cost_str = f"฿{clip_total_thb:.2f}"
    else:
        cost_str = "ไม่ทราบ"

    rem_thb = credit.get("remainingThb")
    if rem_thb is None:
        rem_thb = info.get("jobRemainingThb")
    low_thb = float(credit.get("lowThb") if credit.get("lowThb") is not None else LOW_CREDIT_THB)
    is_low = (rem_thb is not None and rem_thb < low_thb) or bool(credit.get("isLow"))
    credit_str = f"~฿{rem_thb:.2f}" if rem_thb is not None else "ไม่ทราบ"

    lines = [
        f"{meta['emoji']} <b>คลิป{html.escape(meta['labelTh'])}ประจำวันพร้อมแล้ว</b>",
        f"<b>หัวข้อ:</b> {html.escape(clip_title)}",
        f"<b>วันที่:</b> {html.escape(target_date.isoformat())} · <b>สไตล์:</b> <code>{html.escape(style_id)}</code>",
        f"<b>Job ID:</b> <code>{html.escape(job_id)}</code>",
    ]
    meta_parts = [f"⏱ <b>ความยาว:</b> {html.escape(dur_str)}"]
    if info.get("renderNode"):
        meta_parts.append(f"🖥 <b>Render:</b> {html.escape(str(info['renderNode']))}")
    lines.append(" · ".join(meta_parts))

    watch_url = str(info.get("watchUrl") or "").strip()
    download_url = str(info.get("downloadUrl") or "").strip()
    if watch_url or download_url:
        link_parts = []
        if watch_url:
            link_parts.append(f'<a href="{html.escape(watch_url, quote=True)}">▶️ ดูวิดีโอ Master</a>')
        if download_url:
            link_parts.append(f'<a href="{html.escape(download_url, quote=True)}">⬇️ ดาวน์โหลด MP4</a>')
        lines.append("🎬 " + " | ".join(link_parts))

    if yt_info:
        yt_url = str(yt_info.get("url") or "").strip()
        yt_priv = str(yt_info.get("privacy") or "public").strip()
        yt_err = str(yt_info.get("error") or "").strip()
        if yt_url:
            lines.append(
                f'📺 <b>YouTube ({html.escape(yt_priv)}):</b> <a href="{html.escape(yt_url, quote=True)}">{html.escape(yt_url)}</a>'
            )
        elif yt_err:
            lines.append(f"⚠️ <i>อัปโหลด YouTube ไม่สำเร็จ: {html.escape(yt_err[:300])}</i>")

    lines.append(f"💸 <b>ค่าเสียงพากย์:</b> {html.escape(cost_str)}")
    lines.append(f"💳 <b>เครดิต Gemini คงเหลือ:</b> {html.escape(credit_str)}")
    if is_low:
        lines.append(f"⚠️ <b>คำเตือน:</b> เครดิต Gemini API เหลือต่ำกว่า ฿{low_thb:.0f} กรุณาเติมเครดิต!")
    return "\n".join(lines)


def format_error_html(
    *,
    slot: str,
    target_date: date,
    job_id: str,
    topic: str,
    error_msg: str,
    log_tail: list[str],
) -> str:
    meta = SLOT_DEFAULTS[slot]
    header_lines = [
        f"❌ <b>สร้างคลิป{html.escape(meta['labelTh'])}ไม่สำเร็จ</b>",
        f"<b>หัวข้อ:</b> {html.escape(topic)}",
        f"<b>วันที่:</b> {html.escape(target_date.isoformat())}",
        f"<b>Job ID:</b> <code>{html.escape(job_id)}</code>",
        f"<b>สาเหตุ:</b> {html.escape(error_msg[:500])}",
    ]
    msg = "\n".join(header_lines)
    if log_tail:
        snippet = "\n".join(log_tail)
        if len(snippet) > 2200:
            snippet = snippet[-2200:]
        msg += f"\n\n<b>Log ล่าสุด ({len(log_tail)} บรรทัด):</b>\n<pre>{html.escape(snippet)}</pre>"
    return msg


def mark_job_error(job_dir: Path, error_msg: str) -> None:
    job_path = job_dir / "job.json"
    data = read_json_safe(job_path)
    if not isinstance(data, dict):
        data = {}
    if str(data.get("status") or "").strip().lower() not in FAILED_STATUSES:
        data["status"] = "error"
        data["stage"] = "error"
        data["error"] = error_msg[:300]
        data["message"] = f"เกิดข้อผิดพลาด: {error_msg[:200]}"
        data["updatedAt"] = now_utc_iso()
        try:
            atomic_write_json(job_path, data)
        except Exception:
            pass


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="สร้างคลิปความรู้ประจำวัน (เทคโนโลยีเที่ยง / สุขภาพเย็น) + อัปโหลด YouTube + ส่ง Telegram"
    )
    parser.add_argument("--slot", choices=["tech", "health"], required=True, help="รอบเนื้อหา: tech หรือ health")
    parser.add_argument("--date", default=None, help="วันที่ (YYYY-MM-DD, ค่าเริ่มต้น: วันนี้ตามเวลา Asia/Bangkok)")
    parser.add_argument(
        "--duration",
        type=int,
        default=DEFAULT_DURATION,
        help=f"ความยาวเป้าหมายเป็นวินาที ({MIN_DURATION}-{MAX_DURATION}, ค่าเริ่มต้น: {DEFAULT_DURATION})",
    )
    parser.add_argument("--style", default=None, help="ระบุสไตล์ Video Studio เอง (ค่าเริ่มต้น: หมุนเวียนอัตโนมัติ)")
    parser.add_argument("--bgm", default=None, help="ระบุพรีเซ็ตเพลงประกอบเอง")
    parser.add_argument("--topic", default=None, help="กำหนดหัวข้อเองแทนการให้ AI คิด")
    parser.add_argument("--dry-run", action="store_true", help="ทดลองคิดหัวข้อและสร้าง payload โดยไม่บันทึกประวัติและไม่เรนเดอร์")
    parser.add_argument("--no-telegram", action="store_true", help="ปิดการส่งคลิปและสรุปเข้า Telegram")
    parser.add_argument("--no-youtube", action="store_true", help="ปิดการอัปโหลดขึ้น YouTube อัตโนมัติ")
    parser.add_argument(
        "--youtube-privacy",
        choices=["private", "unlisted", "public"],
        default="public",
        help="ระดับความเป็นส่วนตัวบน YouTube (ค่าเริ่มต้น: public)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        target_date = parse_date_arg(args.date)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    slot: str = args.slot
    duration_sec = int(args.duration)
    if duration_sec < MIN_DURATION or duration_sec > MAX_DURATION:
        print(f"Error: --duration ต้องอยู่ระหว่าง {MIN_DURATION} ถึง {MAX_DURATION} วินาที", file=sys.stderr)
        return 1

    style_id = str(args.style or pick_style_for_slot(slot, target_date)).strip()
    if not JOB_ID_RE.fullmatch(style_id):
        print(f"Error: --style ไม่ตรงรูปแบบ ^[a-z0-9-]{{6,40}}$ (ได้รับ '{style_id}')", file=sys.stderr)
        return 1

    bgm = str(args.bgm or SLOT_DEFAULTS[slot]["bgm"]).strip()
    if bgm not in ALLOWED_BGM:
        print(f"Error: --bgm ไม่ถูกต้อง '{bgm}'", file=sys.stderr)
        return 1

    yyyymmdd = target_date.strftime("%Y%m%d")
    job_id = f"daily-{slot}-{yyyymmdd}"
    if not JOB_ID_RE.fullmatch(job_id):
        print(f"Error: jobId '{job_id}' ไม่ตรงรูปแบบ", file=sys.stderr)
        return 1

    job_dir = JOBS_DIR / job_id
    send_telegram = not args.no_telegram
    env = build_child_env()

    lock_file = None
    if not args.dry_run:
        lock_file = acquire_lock(f"/tmp/daily-content-clip-{slot}.lock")
        if lock_file is None:
            print(f"[skip] มีโปรเซส daily-content-clip ({slot}) กำลังทำงานอยู่แล้ว")
            return 0

    try:
        history_data = load_history_data(create_if_missing=not args.dry_run)
        exclusion_topics = collect_exclusion_topics(history_data)

        existing_job = read_json_safe(job_dir / "job.json") if job_dir.exists() else None
        existing_status = (
            str(existing_job.get("status") or "").strip().lower()
            if isinstance(existing_job, dict)
            else ""
        )

        # Idempotent skip / YouTube catch-up when job is already done
        if isinstance(existing_job, dict) and existing_status == "done" and not args.dry_run:
            existing_outputs = existing_job.get("outputs") if isinstance(existing_job.get("outputs"), dict) else {}
            existing_info = extract_latest_output(existing_job)
            existing_video = existing_info.get("videoPath") or ""
            if (
                not args.no_youtube
                and not str(existing_outputs.get("youtubeUrl") or "").strip()
                and existing_video
                and Path(existing_video).exists()
            ):
                existing_req = read_json_safe(job_dir / "request.json")
                req_meta = existing_req if isinstance(existing_req, dict) else {}
                topic_done = str(existing_job.get("topic") or req_meta.get("topic") or existing_info["title"]).strip()
                yt_title_done = str(req_meta.get("ytTitle") or topic_done).strip()
                tags_done = req_meta.get("ytTags") if isinstance(req_meta.get("ytTags"), list) else []
                yt_info = upload_to_youtube(
                    slot=slot,
                    video_path=existing_video,
                    topic=topic_done,
                    yt_title=yt_title_done,
                    tags=tags_done,
                    job_dir=job_dir,
                    job_data=existing_job,
                    env=env,
                    privacy=args.youtube_privacy,
                )
                if yt_info.get("ok"):
                    record_topic_history(
                        slot=slot,
                        target_date=target_date,
                        job_id=job_id,
                        topic=topic_done,
                        yt_title=str(yt_info.get("title") or yt_title_done),
                        yt_url=str(yt_info.get("url") or ""),
                        style_id=style_id,
                    )
                    if send_telegram:
                        credit = read_credit_info(env)
                        html_summary = format_success_html(
                            slot=slot,
                            target_date=target_date,
                            job_id=job_id,
                            topic=topic_done,
                            style_id=style_id,
                            info=existing_info,
                            credit=credit,
                            yt_info=yt_info,
                        )
                        send_telegram_html(html_summary, env)
                return 0
            print(f"[skip] งาน {job_id} เสร็จสมบูรณ์แล้วที่ {job_dir}")
            return 0

        resume_existing = False
        if job_dir.exists() and not args.dry_run:
            if isinstance(existing_job, dict) and (job_dir / "script.json").exists():
                resume_existing = True
                print(f"[resume] ทำงานเดิมต่อ ({existing_status or 'unknown'}) ที่ {job_dir}")
            else:
                retry_dir = archive_failed_job(job_dir, job_id)
                print(f"[retry] ย้ายงานเดิมที่ไม่สำเร็จไปยัง {retry_dir}")

        if resume_existing:
            req_old = read_json_safe(job_dir / "request.json")
            req_meta = req_old if isinstance(req_old, dict) else {}
            topic = str(req_meta.get("topic") or (existing_job or {}).get("topic") or "").strip()
            yt_title = _ensure_shorts_title(str(req_meta.get("ytTitle") or topic))
            tags = req_meta.get("ytTags") if isinstance(req_meta.get("ytTags"), list) else list(SLOT_DEFAULTS[slot]["defaultTags"])
            angle = str(req_meta.get("angle") or "").strip()
            topic_source = "resume"
        else:
            if args.topic:
                topic = str(args.topic).strip()
                yt_title = _ensure_shorts_title(topic)
                angle = ""
                tags = list(SLOT_DEFAULTS[slot]["defaultTags"])
                topic_source = "manual"
            else:
                picked = pick_fresh_topic(slot, target_date, exclusion_topics)
                topic = picked["topic"]
                yt_title = picked["ytTitle"]
                angle = picked["angle"]
                tags = picked["tags"]
                topic_source = picked["source"]

        notes = build_slot_notes(slot, topic, angle, duration_sec)
        assert_non_religious(topic, notes)

        created_at = now_utc_iso()
        request_payload: dict[str, Any] = {
            "id": job_id,
            "topic": topic,
            "styleId": style_id,
            "durationSec": duration_sec,
            "mode": "oneshot",
            "bgm": bgm,
            "sendTelegram": send_telegram,
            "notes": notes,
            "contentMode": "standard",
            "newsMedia": False,
            "slot": slot,
            "storyDate": target_date.isoformat(),
            "ytTitle": yt_title,
            "ytTags": tags,
            "angle": angle,
            "topicSource": topic_source,
            "createdAt": created_at,
        }

        if args.dry_run:
            print(f"[dry-run] {job_id} ({SLOT_DEFAULTS[slot]['labelTh']})")
            print(f"  topic ({topic_source}): {topic}")
            print(f"  ytTitle: {yt_title}")
            print(f"  styleId: {style_id} | durationSec: {duration_sec} | bgm: {bgm} | sendTelegram: {send_telegram}")
            print(f"  tags: {', '.join(tags)}")
            print(f"  notes ({len(notes)} chars): {notes}")
            return 0

        if not resume_existing:
            job_dir.mkdir(parents=True, exist_ok=True)
            initial_job: dict[str, Any] = {
                "id": job_id,
                "topic": topic,
                "styleId": style_id,
                "durationSec": duration_sec,
                "mode": "oneshot",
                "bgm": bgm,
                "status": "queued",
                "stage": "queued",
                "progress": 0,
                "message": "เข้าคิวรอเริ่มงาน...",
                "versions": [],
                "error": None,
                "createdAt": created_at,
                "updatedAt": created_at,
            }
            atomic_write_json(job_dir / "request.json", request_payload)
            atomic_write_json(job_dir / "job.json", initial_job)

        if not VENV_PY.exists() or not STUDIO_JOB.exists():
            err_msg = f"ไม่พบตัวรัน Video Studio ({VENV_PY} หรือ {STUDIO_JOB})"
            append_log_line(job_dir, f"ERROR: {err_msg}")
            mark_job_error(job_dir, err_msg)
            if send_telegram:
                send_telegram_html(
                    format_error_html(
                        slot=slot,
                        target_date=target_date,
                        job_id=job_id,
                        topic=topic,
                        error_msg=err_msg,
                        log_tail=read_log_tail(job_dir),
                    ),
                    env,
                )
            return 1

        run_cmd = "resume" if resume_existing else "oneshot"
        cmd = [str(VENV_PY), str(STUDIO_JOB), run_cmd, "--job", str(job_dir)]
        append_log_line(job_dir, f"Starting {run_cmd} {job_id} ({topic_source}): {topic}")
        print(f"[run] {job_id}: {topic} -> {job_dir}")

        returncode = 1
        run_error = ""
        try:
            with (job_dir / "log.txt").open("a", encoding="utf-8") as log_f:
                proc = subprocess.run(
                    cmd,
                    cwd=str(BASE_DIR),
                    env=env,
                    stdout=log_f,
                    stderr=subprocess.STDOUT,
                    timeout=SUBPROCESS_TIMEOUT_SEC,
                    check=False,
                )
                returncode = proc.returncode
        except subprocess.TimeoutExpired:
            run_error = f"studio_job.py ทำงานเกินเวลา ({SUBPROCESS_TIMEOUT_SEC} วินาที)"
            append_log_line(job_dir, f"ERROR: {run_error}")
            mark_job_error(job_dir, run_error)
        except Exception as exc:
            run_error = f"เรียกใช้งาน studio_job.py ล้มเหลว: {exc}"
            append_log_line(job_dir, f"ERROR: {run_error}")
            mark_job_error(job_dir, run_error)

        job_data = read_json_safe(job_dir / "job.json")
        if not isinstance(job_data, dict):
            job_data = {}
        final_status = str(job_data.get("status") or "").strip().lower()

        if run_error or returncode != 0 or final_status != "done":
            err_msg = (
                run_error
                or str(job_data.get("error") or "").strip()
                or f"studio_job.py จบไม่สมบูรณ์ (rc={returncode}, status={final_status or 'unknown'})"
            )
            mark_job_error(job_dir, err_msg)
            append_log_line(job_dir, f"Job failed: {err_msg}")
            print(f"Error: {err_msg}", file=sys.stderr)
            if send_telegram:
                send_telegram_html(
                    format_error_html(
                        slot=slot,
                        target_date=target_date,
                        job_id=job_id,
                        topic=topic,
                        error_msg=err_msg,
                        log_tail=read_log_tail(job_dir),
                    ),
                    env,
                )
            return 1

        info = extract_latest_output(job_data)
        video_path = info.get("videoPath") or ""
        if not video_path or not Path(video_path).exists():
            err_msg = f"งานจบ status=done แต่ไม่พบไฟล์วิดีโอ ({video_path or 'empty'})"
            append_log_line(job_dir, f"ERROR: {err_msg}")
            mark_job_error(job_dir, err_msg)
            if send_telegram:
                send_telegram_html(
                    format_error_html(
                        slot=slot,
                        target_date=target_date,
                        job_id=job_id,
                        topic=topic,
                        error_msg=err_msg,
                        log_tail=read_log_tail(job_dir),
                    ),
                    env,
                )
            return 1

        yt_info: dict[str, Any] | None = None
        if not args.no_youtube:
            yt_info = upload_to_youtube(
                slot=slot,
                video_path=video_path,
                topic=topic,
                yt_title=yt_title,
                tags=tags,
                job_dir=job_dir,
                job_data=job_data,
                env=env,
                privacy=args.youtube_privacy,
            )

        record_topic_history(
            slot=slot,
            target_date=target_date,
            job_id=job_id,
            topic=topic,
            yt_title=str((yt_info or {}).get("title") or yt_title),
            yt_url=str((yt_info or {}).get("url") or ""),
            style_id=style_id,
        )

        credit = read_credit_info(env)
        append_log_line(
            job_dir,
            f"Completed: video={video_path} dur={info.get('durationSec')}s "
            f"costThb={info.get('clipTotalThb')} remainingThb={credit.get('remainingThb')} "
            f"youtubeUrl={(yt_info or {}).get('url', '')}",
        )
        print(
            f"[done] {job_id}: {video_path} "
            f"(youtube={(yt_info or {}).get('url', '-')}, costThb={info.get('clipTotalThb')})"
        )

        if send_telegram:
            html_summary = format_success_html(
                slot=slot,
                target_date=target_date,
                job_id=job_id,
                topic=topic,
                style_id=style_id,
                info=info,
                credit=credit,
                yt_info=yt_info,
            )
            tg_ok, tg_out = send_telegram_html(html_summary, env)
            if not tg_ok:
                print(f"[warn] ส่งข้อความ Telegram ไม่สำเร็จ: {tg_out}", file=sys.stderr)

        return 0
    finally:
        release_lock(lock_file)


if __name__ == "__main__":
    raise SystemExit(main())
