#!/usr/bin/env python3
"""Studio Job Runner for Video Studio (/video-studio).

Handles:
  - oneshot    : research -> script -> tts -> render -> mix -> preview -> copy -> telegram
  - draft      : research -> script -> draft_ready
  - build      : lock -> tts (cached) -> props -> render -> mix -> preview -> copy -> telegram
  - edit-scene : lock -> tts (cached) -> props -> render -> mix -> final_v{N}.mp4
  - rebuild    : lock -> tts (cached) -> props -> render -> mix -> final_v{N}.mp4 (all scenes)
  - remix      : lock -> mix latest render_v{N}/render.mp4 + work/timeline.json -> final_v{N}.mp4
  - trim       : ffmpeg trim [start, end] -> final_v{N}.mp4
  - cut        : ffmpeg cut out [from, to] -> final_v{N}.mp4
  - export     : lock -> ffmpeg EDL export from editor_project.json -> final_v{N}.mp4
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

BASE_DIR = Path("/home/dev/.local/share/motion-studio")
SCRIPTS_DIR = BASE_DIR / "scripts"
AUDIO_ASSETS_DIR = BASE_DIR / "assets" / "audio"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
import credit_ledger  # noqa: E402

PRESETS_PATH = BASE_DIR / "assets" / "studio_style_presets.json"
CUSTOM_STYLES_PATH = BASE_DIR / "assets" / "studio_custom_styles.json"

MOTION_STUDIO_BIN = "/home/dev/.local/bin/motion-studio"
AGENT_CTL_BIN = "/home/dev/.local/bin/agent-ctl"
AGY_BIN = os.environ.get("AGY_BIN", "/home/dev/.local/bin/agy")
PROFILES_DIR = Path("/home/dev/.agy-profiles")
MAIN_TOKEN_REL = Path(".gemini/antigravity-cli/antigravity-oauth-token")

OUTPUT_VIDEOS_DIR = Path("/home/dev/.gemini/outputs/videos")
STUDIO_ROOT_DIR = Path("/home/dev/.gemini/outputs/video-studio")
RENDER_LOCK_PATH = STUDIO_ROOT_DIR / "render.lock"
DASHBOARD_ORIGIN = "https://homelab.tail285279.ts.net"

PRIMARY_MODEL = "gemini-4-neon-high"
FALLBACK_MODEL = "gemini-3.8-flash-medium"

VALID_BGMS = ("warm_tech", "story_cinematic", "dawn_ambient", "none")
VALID_SFX = ("soft_impact", "spark", "riser", "pop", "shimmer", "click", "chime", "whoosh")
VALID_VISUALS = ("title", "bullets", "stat", "steps", "compare", "quote", "image", "icon")

# Illustrated (hand-drawn, per-scene staged) styles — rendered by src/studio/director/*
ILLUSTRATED_STYLES = {"look-5", "look-7", "look-8"}
DIRECTION_SHOTS = ("pov-desk", "interview", "whiteboard", "closeup", "crowd", "split", "stairs", "held-paper", "door", "phone")
DIRECTION_MOODS = ("confident", "worried", "panic", "happy", "think", "smug", "tired", "shock")
DIRECTION_POSES = ("type", "stand", "point", "shrug", "cheer", "facepalm", "think", "wave", "hold", "present")
DIRECTION_PROPS = (
    "laptop", "mug", "cup-tower", "calendar", "clock", "resume", "chair", "phone", "bulb", "money", "trophy",
    "plant", "window", "briefcase", "rocket", "chart", "question", "check", "cross", "robot", "book", "star", "heart", "fire",
)
DIRECTION_CAST = ("hero", "interviewer", "boss", "friend", "crowd")

# Style-directed (per-style bespoke shot) catalog — synchronized with src/studio/styleDirector/*
STYLE_DIRECTOR_SHOTS: dict[str, dict[str, str]] = {
    "look-1": {
        "glow-portal": "ประตูวงแหวนแสงที่ข้อความลอยออกมา",
        "orb-core": "ลูกแก้วพลังงานกลางจอพร้อมวงโคจรคีย์เวิร์ด",
        "light-path": "เส้นทางแสงคดเคี้ยวจากล่างขึ้นบนพร้อมจุดเช็กพอยต์",
    },
    "look-3": {
        "holo-table": "โต๊ะฉายโฮโลแกรม 3 มิติหมุนได้พร้อมโนดประเด็นลอยรอบแกน",
        "mission-route": "เส้นทางภารกิจโฮโลแกรมที่จุดเช็กพอยต์สว่างขึ้นทีละด่าน",
        "radar-scan": "จอเรดาร์โฮโลแกรมกวาดคลื่นตรวจจับเป้าหมายและตัวเลขสำคัญ",
        "hud-briefing": "เงาร่างโฮโลแกรมบรรยายสรุปข้างแผงข้อมูล HUD ลอยกลางอากาศ",
    },
    "look-4": {
        "relief-map": "แผนที่นูนสีแดงพร้อมหมุดปักตำแหน่งและลูกศรกวาดข้ามอาณาเขต",
        "battle-arrows": "ลูกศรสองฝ่ายปะทะกันบนแผนที่นูนสำหรับเปรียบเทียบ",
        "era-scroll": "ม้วนคัมภีร์และแผ่นศิลาจารึกปีคลี่ออกตามลำดับเหตุการณ์",
    },
    "look-6": {
        "cosmic-zoom": "ซูมจักรวาลจากกาแล็กซีสู่ดาวเคราะห์และจุดข้อมูลสำคัญ",
        "strata-layers": "ชั้นหินธรณีวิทยาที่แต่ละประเด็นคือหนึ่งยุคสมัย",
        "clock-spiral": "เกลียวเวลาขนาดมหึมาสำหรับตัวเลขใหญ่และสเกลนับล้านปี",
        "planet-orbit": "ระบบดาวเคราะห์โคจรรอบดวงอาทิตย์โดยแต่ละดวงติดป้ายประเด็นสำคัญ",
    },
    "look-9": {
        "gear-mechanism": "เฟืองกลไกหลายตัวหมุนประสานกันพร้อมป้ายชื่อแต่ละประเด็น",
        "flow-schematic": "ผังวงจรและท่อส่งสัญญาณไหลทีละขั้นพร้อมจุดวาล์ว",
        "spec-sheet": "ตารางสเปกเทคนิคพร้อมเส้นบอกขนาดและตัวเลขหลักใหญ่",
    },
    "look-10": {
        "turntable-spin": "แท่นหมุนโชว์สินค้า 360 องศาในสตูดิโอพร้อมแสงริมไลต์และเงาตกกระทบ",
        "hotspot-callouts": "จุดฮอตสปอตบนตัวสินค้าพร้อมเส้นชี้จุดเด่นรอบชิ้นงาน",
        "exploded-features": "แยกชิ้นส่วนสินค้าเป็นชั้นลอยแนวตั้งพร้อมคำอธิบายแต่ละชั้น",
        "price-reveal": "สปอตไลต์ส่องตัวสินค้าพร้อมป้ายราคาหรือตัวเลขหลักขนาดใหญ่",
    },
    "look-11": {
        "cash-tower": "กองธนบัตรซ้อนสูง",
        "coin-rain": "เหรียญทองโปรยลงโถ",
        "piggy-bank": "กระปุกออมสิน",
        "debt-pit": "หลุมหนี้กับบันไดกองเงิน",
        "gold-vault": "ตู้เซฟประตูกลมกับแท่งทอง",
        "money-scale": "ตาชั่งสองแขนเทียบมูลค่า",
        "cash-conveyor": "สายพานโรงงานคัดแยกธนบัตร",
    },
    "look-12": {
        "card-flip": "บัตรพรีเมียมพลิกจากด้านหน้าไปด้านหลังเผยข้อความและข้อเสนอหลัก",
        "card-fan": "บัตรสิทธิพิเศษหลายใบกางออกเป็นพัด แต่ละใบแสดงหนึ่งประเด็นสำคัญ",
        "scratch-reveal": "บัตรขูดฟอยล์สีเงินค่อยๆ ขูดเผยตัวเลขหรือรางวัลใหญ่ด้านใน",
        "compare-cards": "บัตรสองใบวางเทียบกันซ้าย-ขวาพร้อมป้าย VS และไฮไลต์ใบที่คุ้มกว่า",
    },
    "look-13": {
        "receipt-print": "เครื่องพิมพ์ใบเสร็จ",
        "itemized-zoom": "ซูมรายการวงปากกาแดง",
        "total-stamp": "ยอดรวมพร้อมตราประทับ",
    },
    "look-14": {
        "iceberg-reveal": "ผิวน้ำแบ่งจอเผยฐานใต้น้ำ",
        "dive-down": "ดำดิ่งเปิดชั้นความลึก",
        "hidden-labels": "ชี้ป้ายส่วนที่ซ่อนอยู่",
        "tip-only": "ยอดน้ำแข็งเหนือผิวน้ำ",
    },
    "look-15": {
        "chat-burst": "บับเบิลแชทเด้งรัวสลับซ้ายขวา",
        "typing-reveal": "จุดกำลังพิมพ์ (...) แล้วเฉลยคำตอบ",
        "screenshot-zoom": "ซูมหน้าจอโทรศัพท์ + ไฮไลต์ข้อความ",
        "group-chat": "แชทกลุ่มหลายคนพร้อมอวาตาร์",
        "voice-note": "ข้อความเสียงพร้อมคลื่นเสียงวิ่ง",
    },
    "look-16": {
        "size-lineup": "เรียงวัตถุ 3 มิติจากเล็กไปใหญ่บนเส้นไม้บรรทัดพร้อมเงาคนเทียบสเกล",
        "zoom-ladder": "ซูมไล่ระดับจากวัตถุเล็กไปใหญ่ทีละขั้นพร้อมวงเล็งขยายสเกล",
        "stack-tower": "ซ้อนวัตถุ 3 มิติเป็นหอคอยเทียบความสูงกับตัวเลขสถิติยักษ์",
        "side-by-side-giant": "เทียบวัตถุเล็กกับวัตถุยักษ์ข้างกันให้เห็นความต่างชัดเจน",
    },
    "look-17": {
        "trophy-podium": "ถ้วยรางวัลทองคำ 3 มิติบนแท่นโพเดียมพร้อมพลุกระดาษและตัวเลขเป้าหมาย",
        "progress-mountain": "ปีนยอดเขา 3 มิติผ่านธงเช็กพอยต์ทีละขั้นสู่ยอดเป้าหมาย",
        "medal-wall": "กำแพงเหรียญรางวัล 3 มิติแสดงทีละเหรียญตามประเด็นสำคัญ",
        "celebration-burst": "พลุและสายรุ้งทองระเบิดฉลองพร้อมข้อความสรุปความสำเร็จ",
    },
    "look-18": {
        "donut-build": "กราฟโดนัท 3 มิติค่อยๆ วาดทีละชิ้นพร้อมป้ายเปอร์เซ็นต์",
        "exploded-donut": "ดึงชิ้นส่วนโดนัท 3 มิติชิ้นหลักออกมาซูมขยายพร้อมคำอธิบาย",
        "coin-jars": "โหลเหรียญ 3 มิติแยกสัดส่วนงบประมาณตามหมวดหมู่",
        "budget-stack-bar": "แท่งสัดส่วน 100% แบบ 3 มิติเปรียบเทียบสองกลุ่ม",
    },
    "look-19": {
        "globe-arcs": "ลูกโลก 3 มิติหมุนช้าๆ พร้อมเส้นโค้งเรืองแสงเชื่อมศูนย์กลางโลกและการ์ดสรุป",
        "corridor-telemetry": "แผนที่เส้นทางเชื่อมต่อสองฝั่งพร้อมโค้งเปรียบเทียบระยะทางและความเร็ว",
        "hub-constellation": "เครือข่ายฮับโลกกระจายเส้นโค้งสู่ภูมิภาคพร้อมตัวเลขสถิติเด่นกลางฮับ",
        "flight-board": "บอร์ดเส้นทางระดับโลกและมินิโกลบสำหรับฉากหลายขั้นตอนหรือรายการสำคัญ",
    },
    "look-20": {
        "lid-open-hero": "แล็ปท็อปอะลูมิเนียมเปิดฝาสาดแสงโชว์หน้า Hero และป้ายฟีเจอร์ลอย",
        "browser-showcase": "หน้าต่างเบราว์เซอร์ macOS พร้อม URL bar แอนิเมชัน เคอร์เซอร์คลิกและการ์ดฟีเจอร์",
        "split-dashboard": "จอแล็ปท็อปแสดงแดชบอร์ด 2 คอลัมน์ กราฟสถิติเด่นและข้อมูลเปรียบเทียบ",
        "window-cascade": "หน้าต่างแอปแบบ Glass ซ้อนกัน 2–3 ชั้นเลื่อนเปิดตัวตามลำดับขั้น",
    },
    "look-21": {
        "conveyor-pipeline": "สายพานไอโซเมตริก 3–4 สถานีพร้อมแพ็กเก็ตพลังงานวิ่งผ่านและป้ายคำอธิบาย",
        "layered-stack": "บล็อกสถาปัตยกรรมไอโซเมตริก 3–4 ชั้นลอยแยกแนวตั้งพร้อมเส้นโยงการ์ดอธิบาย",
        "hub-router": "แท่นไอโซเมตริกศูนย์กลางกระจายโฟลว์สู่บล็อกปลายทางพร้อมตัวเลขไฮไลต์",
        "kpi-towers": "เสาแท่งไอโซเมตริก 3 มิติสูงไล่ระดับเรืองแสงสำหรับตัวเลขสำคัญและสรุปผล",
    },
    "look-22": {
        "lockscreen-flood": "หน้าจอล็อกสมาร์ตโฟนที่มีแจ้งเตือนเด้งซ้อนเข้ามาทีละใบพร้อมตัวนับยอด",
        "cash-register": "แจ้งเตือนยอดขายและเงินเข้าเด้งรัวพร้อมเครื่องคิดเงินที่ตัวเลขยอดรวมวิ่งขึ้น",
        "wrist-buzz": "สมาร์ตวอตช์สั่นแจ้งเตือนข้อความสั้นและด่วนบนข้อมือ",
        "dashboard-ping": "แดชบอร์ดยอดขายบนจอเดสก์ท็อปที่มีป๊อปอัปแจ้งเตือนเด้งเข้ามุมจอ",
    },
    "look-23": {
        "split-slider": "เส้นแบ่งสไลเดอร์เลื่อนกวาดซ้าย-ขวาเทียบก่อนหน้ากับหลังเปลี่ยน",
        "room-makeover": "ห้องทำงานภาพประกอบ SVG ที่เปลี่ยนจากรกวุ่นวายเป็นระเบียบเรียบร้อย",
        "graph-flip": "กราฟแท่งและเส้นแนวโน้มที่พลิกจากขาลงก่อนหน้าเป็นขาขึ้นหลังเปลี่ยน",
        "mirror-portrait": "ซิลลูเอตตัวละครในกระจกเทียบก่อนและหลังพร้อมลูกศรชี้จุดเปลี่ยน",
    },
    "look-24": {
        "race-bars": "แท่งแนวนอนวิ่งแข่งตามตัวเลข",
        "top-list-scroll": "ลิสต์อันดับ #5→#1 ระเบิดแสงที่ #1",
        "versus-gap": "2 แท่งเทียบส่วนต่างพร้อมลูกศรวัด",
    },
    "look-25": {
        "post-card": "การ์ดโพสต์โซเชียลพร้อมอวาตาร์ ชื่อผู้โพสต์ และยอดไลก์/แชร์ที่วิ่งขึ้น",
        "screenshot-evidence": "ภาพแคปโพสต์ปักหมุดบนบอร์ดหลักฐานพร้อมปากกาไฮไลต์ขีดทับประโยคสำคัญ",
        "comment-storm": "คอมเมนต์จากผู้ใช้หลั่งไหลเข้ามาต่อเนื่องใต้โพสต์ต้นทาง",
        "viral-meter": "แผนผังเครือข่ายการแชร์ต่อของโพสต์พร้อมตัวเลขการเข้าถึง (Reach)",
    },
    "look-26": {
        "flip-calendar": "ปฏิทินพลิกกลไก split-flap ขนาดใหญ่พลิกตัวเลขวัน/ตัวเลขสำคัญพร้อมป้ายไฟ streak และการ์ดสรุป",
        "streak-grid": "ตารางชาเลนจ์ 30 วันแบบ Habit Contribution Grid ที่แต่ละช่องค่อยๆ สว่างไล่สีพร้อมการ์ดประเด็น",
        "milestone-track": "แทร็กความคืบหน้าทีละวันและสัปดาห์พร้อมหมุดเช็กถูกเด้งขึ้นทีละขั้น",
        "challenge-ring": "วงแหวนความสำเร็จของชาเลนจ์แสดงเปอร์เซ็นต์พร้อมเทียบก่อน-หลังหรือคำคมปิดท้าย",
    },
    "look-27": {
        "split-duel": "แบ่งจอเฉียงปะทะกัน + สัญลักษณ์ VS",
        "tug-of-war": "ชักเย่อดึงเชือกชี้ฝั่งที่ชนะ",
    },
    "look-28": {
        "tilted-city-route": "แผนที่เมือง 3D เอียงพร้อมตึกไอโซเมตริกสีหินอ่อน เส้นทางเรืองแสง และจุดนำทางเคลื่อนที่",
        "waypoint-stops": "เส้นทางบนแผนที่ 3D พร้อมหมุดปัก 3 จุด (Pin 01/02/03) เด้งขึ้นตามลำดับและการ์ดอธิบาย",
        "elevation-profile": "ภาพตัดขวางเส้นทางและกราฟระดับความสูง 3D พร้อมตัวเลขสถิติและข้อมูลเปรียบเทียบ",
        "aerial-zone-pin": "มุมมองดาวเทียมซูมเป้าหมายพร้อมวงคลื่นเรดาร์และแผง telemetry สรุปประเด็นสำคัญ",
    },
    "look-29": {
        "vertical-explode": "ไดอะแกรมแยกชิ้นส่วน 3–4 เลเยอร์ลอยแยกตามแกนแนวตั้งด้วยเส้นประพร้อมเส้นโยงและการ์ดระบุหน้าที่",
        "assembly-callouts": "ภาพโครงสร้างแกนกลางพร้อมหมุดหมายเลข 01–03 ชี้ออกไปยังการ์ดคำอธิบายบนกระดาษร่างเทคนิค",
        "cutaway-spec": "ภาพผ่าครึ่งโชว์ชั้นนอก-ชั้นกลาง-แกนในพร้อมแถบสเปกและตัวเลขสำคัญ",
        "knolling-bom": "การจัดเรียงชิ้นส่วนแบบ Knolling ในตารางสเปก (Bill of Materials) พร้อมกรอบหมายเลขชิ้นส่วนและบทสรุป",
    },
    "look-30": {
        "ink-landscape-title": "ทิวเขาหมึกจีน 3 ชั้นวาดตัวเองบนกระดาษสา พร้อมดวงอาทิตย์แดง หน้าผาต้นสน เรือลอยน้ำ หัวข้อแนวตั้ง 2 คอลัมน์ และตราประทับแดง",
        "scroll-unroll-steps": "ม้วนภาพพู่กันคลี่ลงบนกระดาษสาพร้อมเส้นหมึกเชื่อมลำดับขั้นตอนและหมุดวงกลมพู่กันทีละขั้น",
        "enso-stat": "วงเอนโซ (Ensō) ตวัดพู่กันหมึกดำรอบตัวเลขสถิติขนาดใหญ่ พร้อมตราประทับแดงและคำอธิบายด้านล่าง",
        "seal-quote": "คำคมบนกระดาษสาประดับกิ่งไผ่หมึกจางและตราประทับสีแดงกดลงท้ายประโยคอย่างสงบ",
    },
    "look-31": {
        "desk-overhead": "มุมมองโต๊ะจากด้านบนพร้อมเอกสาร ปากกา แก้วกาแฟ และมือวางกระดาษ",
        "sticky-wall": "บอร์ดโพสต์อิทหลายสีแปะทีละใบจากประเด็นสำคัญ",
        "folder-open": "แฟ้มเอกสารเปิดกางเผยหน้าเอกสารและหัวเรื่องด้านใน",
        "highlight-doc": "หน้าเอกสารซูมใกล้พร้อมปากกาไฮไลต์ลากผ่านคำสำคัญ",
    },
    "look-32": {
        "tilted-article-flyin": "หน้าบทความข่าวบินเข้าแบบเอียง 3D บนกำแพงบทความเบลอที่ลอยช้าๆ พร้อมไฮไลต์เขียวมะนาวและการ์ดโพสต์ยืนยันมุมล่างขวา",
        "highlight-sweep": "ดอลลี่ซูมเข้าหาย่อหน้าสำคัญของบทความแล้วปาดไฮไลต์เขียวมะนาวทีละบรรทัดจากซ้ายไปขวาด้วยโหมด multiply",
        "evidence-post-pop": "การ์ดโพสต์อ้างอิงสีขาวพร้อมเครื่องหมายยืนยันสีฟ้าเด้งขึ้นหน้าบทความด้วยสปริงเพื่อโชว์หลักฐานคำพูด",
        "clipping-compare": "ข่าวตัด 2 ชิ้นวางเอียงเปรียบเทียบกัน หรือการ์ดตัวเลขสถิติพร้อม delta ที่ถูกปาดไฮไลต์เขียวมะนาว",
    },
    "look-33": {
        "counter-line": "ตัวเลขสถิติขนาดใหญ่นับขึ้นแบบ tabular พร้อมเส้นกราฟที่วาดซ้ายไปขวาและเปลี่ยนเป็นสีส้มตรงจุดเปลี่ยน",
        "event-marker": "เส้นแนวตั้งบอกจุดเหตุการณ์สำคัญพร้อมการ์ดป้ายอธิบาย และเส้นกราฟเปลี่ยนจากขาวเป็นส้มหลังจุดนั้น",
        "bar-compare": "กราฟแท่งเปรียบเทียบซ้ายสีขาวนวลกับขวาสีส้มพร้อมตัวเลขส่วนต่างและรายการสรุปสองฝั่ง",
        "ticker-rows": "รายการประเด็นแบบแถวหน้าจอเทอร์มินัลพร้อมกราฟสปาร์กไลน์ขนาดเล็กและป้ายเดลต้าแต่ละแถว",
    },
    "look-34": {
        "phone-hero-rotate": "มือถือ 3D หมุนสปริงเข้ามุมบนฉากสตูดิโอฟ้าเทาพร้อมหน้าจอแอป UI จริงและตัวเลขนับขึ้น",
        "floating-ui-cards": "การ์ด UI สีขาว 3–4 ใบเด้งออกมารอบมือถือ 3D พร้อมกราฟแท่งจิ๋ว วงแหวนความคืบหน้า และพารัลแลกซ์",
        "kpi-screen": "หน้าจอ KPI แสดงตัวเลขสถิติใหญ่ ชิปส่วนต่างสีเขียว และกราฟเส้นขนาดเล็กบนมือถือสตูดิโอ",
        "onboarding-steps": "หน้าจอ Onboarding แสดงขั้นตอนทีละข้อพร้อมจุดบอกความคืบหน้าและปุ่มเริ่มใช้งานบนมือถือ 3D",
    },
    "look-35": {
        "window-zoom-click": "หน้าต่างแอปโหมดมืดเต็มบานบนฉากหลังมิ้นต์ กล้องร่อนซูมเข้าปุ่มน้ำเงินพร้อมเคอร์เซอร์คลิกและวงกระเพื่อม",
        "step-click-path": "รายการองค์ประกอบ UI ที่มีหมายเลขขั้นตอน โดยเคอร์เซอร์ไล่คลิกเปิดทีละขั้นพร้อมแถบความคืบหน้า",
        "toggle-before-after": "แผงตั้งค่าเปรียบเทียบก่อน-หลังพร้อมสวิตช์ที่เคอร์เซอร์คลิกเลื่อนจากปิดเป็นเปิด",
        "success-toast": "หน้าต่างแจ้งเตือนสำเร็จ (Success Toast) พร้อมไอคอนเครื่องหมายถูกแอนิเมชันและตัวเลขหรือข้อความสรุป",
    },
    "look-36": {
        "horizontal-track": "เส้นเวลาแนวนอนที่กล้องเลื่อนผ่านจุดปีและเหตุการณ์",
        "vertical-scroll": "ไทม์ไลน์แนวตั้งเลื่อนขึ้นพร้อมไอคอนแต่ละขั้น",
        "milestone-zoom": "ซูมโฟกัสหมุดเหตุการณ์สำคัญพร้อมตัวเลข/วันที่ใหญ่",
        "then-vs-now": "เทียบซ้ายตอนนั้นโทนซีเปียกับขวาตอนนี้โทนสีสด",
    },
    "look-37": {
        "breathing-orb-line": "ลูกแก้วเรืองแสงหายใจช้าๆ บนพื้นมืดพร้อมวงกลมเส้นบางและข้อความบรรทัดเดียวอย่างมินิมอล",
        "orbit-rings-points": "ลูกแก้วกลางเฟรมรายล้อมด้วยวงโคจรเส้นบางและป้ายประเด็นสำคัญบนจุดโคจร",
        "orb-stat": "ตัวเลขสถิติหลักลอยอยู่ในแสงลูกแก้วพร้อมวงแหวนความคืบหน้าและป้ายคำอธิบายด้านล่าง",
        "twin-orb-compare": "ลูกแก้วเรืองแสงคู่สำหรับเปรียบเทียบสองมุมมองหรือแสดงคำคมสำคัญอย่างสงบ",
    },
    "look-38": {
        "glass-search-type": "ช่องค้นหากระจกฝ้ากว้างบนฉากพลบค่ำหลุดโฟกัส เด้งเข้าพร้อมพิมพ์ข้อความทีละตัวอักษรและเคอร์เซอร์กะพริบ",
        "glass-results-select": "ช่องค้นหาร่อนขึ้นพร้อมแผงผลลัพธ์กระจกฝ้าคลี่ลงมา แถวรายการตกลงทีละขั้นและแถบไฮไลต์ยืดเลือกพร้อมปุ่ม return",
        "glass-stat-card": "การ์ดกระจกฝ้าแสดงตัวเลขสถิติหลักนับขึ้นพร้อมแถบความคืบหน้าเรืองแสงและคำอธิบาย",
        "glass-compare-panes": "แผงกระจกฝ้าคู่สำหรับเปรียบเทียบสองมุมมองหรือแสดงคำคมสำคัญอย่างนุ่มนวล",
    },
    "look-39": {
        "one-take-hero-morph": "จุดแดงขยายเป็นแคปซูลแล้วเปลี่ยนรูปเป็นการ์ดคีย์โน้ตต่อเนื่องช็อตเดียว พร้อมหัวข้อเผยขึ้นผ่านมาสก์",
        "one-take-feature-list": "การ์ดพาหะยืดเป็นแผงรายการจุดเด่นพร้อมจุดแดงหนึ่งจุดเคลื่อนไล่ลงตามแต่ละแถวอย่างนุ่มนวล",
        "one-take-stat-reveal": "การ์ดหดรูปต่อเนื่องเป็นพิลล์ใหญ่แสดงตัวเลขสถิตินับขึ้นแบบตารางพร้อมจุดแดงโฟกัส",
        "one-take-split-compare": "การ์ดพาหะใบเดียวแยกออกเป็นสองใบอย่างต่อเนื่องสำหรับเปรียบเทียบสองฝั่งหรือแสดงคำคม",
    },
    "look-40": {
        "crt-power-on": "จอทีวีหลอดเรโทรเปิดจากเส้นแนวนอนสว่างแล้วคลี่เต็มจอ พร้อมหัวข้อฟอสฟอร์เรืองแสงและบรรทัดสถานะระบบพิมพ์ทีละตัว",
        "crt-channel-list": "รายการประเด็นสำคัญในรูปแบบเมนูช่องทีวีและเทเลเท็กซ์ พร้อมเคอร์เซอร์บล็อกฟอสฟอร์เลื่อนสแกนลงตามแถว",
        "crt-stat-broadcast": "หน้าจอประกาศตัวเลขสถิติขนาดใหญ่สไตล์สกอร์บอร์ดออกอากาศ พร้อมแถบวัดสัญญาณและแถบข่าวล่าง (Lower-Third)",
        "crt-split-signal": "จอทีวีแบ่งสัญญาณสองฝั่งสำหรับเปรียบเทียบหรือหน้าต่างคำคมออกอากาศ พร้อมจังหวะสัญญาณซ่าและภาพกลิ้งช่วงสลับช่อง",
    },
    "look-41": {
        "scope-trace-title": "เส้นสัญญาณออสซิลโลสโคปสีเขียวฟอสฟอร์วาดผ่านกริด 10×8 พร้อมหางแสงค้างภาพและหัวข้อลอยขึ้นเหนือเส้นคลื่น",
        "scope-multi-channel": "หน้าจอสโคปหลายช่องสัญญาณ CH1–CH4 แสดงคลื่นไซน์ สี่เหลี่ยม ฟันเลื่อย และพัลส์ ควบคู่ประเด็นสำคัญแต่ละข้อ",
        "scope-measure-stat": "โหมดวัดค่าสัญญาณพร้อมเคอร์เซอร์เส้นประคู่แกน X/Y แสดงตัวเลขสถิติหลักและแผงค่าอ่านจากเครื่องมือวัด",
        "scope-xy-compare": "โหมด XY แสดงรูปลิสซาจูส 2:3 หมุนช้าๆ พร้อมหางฟอสฟอร์ สำหรับเปรียบเทียบสองช่องสัญญาณหรือนำเสนอคำคมสำคัญ",
    },
    "look-42": {
        "mag-spread-headline": "เลย์เอาต์หน้านิตยสารแบบ spread หัวข้อเซริฟขึ้นทีละบรรทัด พร้อมภาพดูโอโทนและปากกาแดงวงคำสำคัญ",
        "mag-column-notes": "คอลัมน์บทความเรียงประเด็นสำคัญพร้อมเลขข้อใหญ่ เครื่องหมายถูกและขีดเส้นใต้ปากกาแดงไล่ทีละข้อ",
        "mag-pull-stat": "ตัวเลขสถิติแบบ pull-quote ขนาดใหญ่กลางหน้านิตยสาร พร้อมวงกลมปากกาแดงและลูกศรโน้ตลายมือชี้ประกอบ",
        "mag-quote-margin": "หน้าคู่สำหรับคำคมหรือเปรียบเทียบสองมุมมอง พร้อมแถบและหมายเหตุลายมือปากกาแดงที่ขอบกระดาษ",
    },
    "look-43": {
        "blue-sliced-title": "ปกนิตยสารสีน้ำเงินอัลตรามารีนพร้อมหัวข้อขาวหนาที่ถูกหั่นเป็นแถบแนวนอนเลื่อนสวนกันแล้วประกบสนิท",
        "blue-cover-lines": "ปกนิตยสารพร้อมหัว masthead และ cover-lines แบบอสมมาตรจากรายการประเด็นสำคัญคั่นด้วยเส้นขาวบาง",
        "blue-big-number": "ตัวเลขสถิติสีขาวขนาดยักษ์หั่นเป็นแถบแนวนอนแล้วประกบเข้าล็อก พร้อมคำอธิบายสไตล์เอดิทอเรียล",
        "blue-manifesto-quote": "ประโยคแถลงการณ์หรือข้อเปรียบเทียบบนพื้นน้ำเงินเรียบที่เผยทีละคำอย่างคมชัดและมั่นใจ",
    },
    "look-44": {
        "riso-poster-title": "โปสเตอร์ริโซสองหมึก (ชมพูสะท้อนแสงและน้ำเงิน) หัวข้อเต็มกว้าง วงกลมสองวงซ้อนเป็นม่วง แถบลายทแยงคืบช้า ๆ และแถวจุดฮาล์ฟโทนไล่ขนาดแบบ on-twos",
        "riso-lineup-list": "ป้ายรายการสองหมึกปั๊มและสไลด์ลงทีละแถวแบบสต็อปโมชัน on-twos พร้อมวงกลมเลขข้อเจาะทะลุกระดาษและเพลตเหลื่อม",
        "riso-big-stat": "ตัวเลขสถิติยักษ์พิมพ์ซ้อนสองหมึกนับขึ้นแบบ on-twos บนวงกลมฮาล์ฟโทนซ้อนกัน พร้อมแถบจุดฮาล์ฟโทนและกรอบคำอธิบายลายทแยง",
        "riso-split-compare": "โปสเตอร์แบ่งสองฝั่งชมพูกับน้ำเงินที่ซ้อนกันตรงกลางเป็นสีม่วงเข้ม หรือหน้าคำคมสองหมึกพร้อมแถบลายทแยงและเพลตดีดแยกกลางช็อต",
    },
    "look-45": {
        "swiss-manifesto-title": "โปสเตอร์แถลงการณ์กริดสวิส 4 คอลัมน์ พื้นแดงงอกตามเส้นกริด วงกลมดำก้าวแบบเรือพร้อมโมชันเบลอ และหัวข้อชิดซ้าย 2–3 แถวพิมพ์ทับพื้นแดง",
        "swiss-numbered-list": "รายการลำดับหมายเลข 01/02/03 หล่นจากเส้นกริดโมดูล พร้อมข้อความชิดซ้ายดันออกจากเส้นคอลัมน์และวงกลมดำล็อกบนกริด",
        "swiss-kpi-field": "ตัวเลขสถิติขนาดยักษ์ชิดซ้ายบนพื้นแดงสัญญาณ พร้อมวงกลมสองโมดูลบนจุดตัดกริดและคำอธิบายแบบตัวเลขหมึกเต็ม",
        "swiss-two-column-compare": "ตารางเปรียบเทียบสองคอลัมน์แบ่งด้วยเส้นกริดกลางพร้อมพื้นแดงเน้นฝั่งเด่น หรือจัดวางคำคมแถลงการณ์บนกริดสวิส",
    },
    "look-46": {
        "blueprint-object-title": "สเก็ตช์ดินสอวัตถุด้านข้างบนกระดาษกราฟแล้วหมึกพิมพ์เขียวท่วมเปลี่ยนเป็นเส้นขาวตรงคมพร้อมระยะวัดและป้ายหัวข้อบนซ้าย",
        "blueprint-process-steps": "วัตถุดินสอสู่พิมพ์เขียวพร้อมเส้นชี้และป้ายคำอธิบายแบบมีหมายเลขชี้ตรงไปยังส่วนประกอบต่าง ๆ ของวัตถุสูงสุด 4 จุด",
        "blueprint-dimension-stat": "แบบพิมพ์เขียวที่แสดงตัวเลขสถิติหลักเป็นค่าระยะวัดขนาดใหญ่พร้อมหน่วยและลูกศรวัดระยะแบบวิศวกรรม",
        "blueprint-sketch-vs-spec": "ภาพวาดเดียวแบ่งด้วยแนวขอบหมึกเปียก ฝั่งซ้ายเป็นสเก็ตช์ดินสอ ฝั่งขวาเป็นแบบพิมพ์เขียว สำหรับเปรียบเทียบหรือคำคม",
    },
}


DATA_DIRECTOR_SHOTS: dict[str, str] = {
    "data-counter": "ตัวเลขสถิติใหญ่นับขึ้น",
    "data-steps": "ไปป์ไลน์ขั้นตอนเชื่อมโหนด",
    "data-versus": "จอแยกเปรียบเทียบซ้าย/ขวา",
    "data-list": "การ์ดรายการซ้อนโผล่ทีละใบ",
    "data-quote": "คำคมตัวใหญ่ปรากฏทีละคำ",
    "data-chart": "กราฟแท่ง/เส้นจากตัวเลขในซีน",
}


def sanitize_direction(raw: Any, style_id: str | None = None) -> dict[str, Any] | None:
    """Keep only known vocabulary from the AI's per-scene staging directions."""
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    sid = str(style_id or "").strip().lower()
    is_style_directed = sid in STYLE_DIRECTOR_SHOTS
    style_shots = STYLE_DIRECTOR_SHOTS.get(sid) or {}
    shot = str(raw.get("shot") or "").strip().lower()
    if shot in DIRECTION_SHOTS or shot in style_shots or (is_style_directed and shot in DATA_DIRECTOR_SHOTS):
        out["shot"] = shot
    mood = str(raw.get("mood") or "").strip().lower()
    if mood in DIRECTION_MOODS:
        out["mood"] = mood
    pose = str(raw.get("pose") or "").strip().lower()
    if pose in DIRECTION_POSES:
        out["pose"] = pose
    props = [str(p).strip().lower() for p in (raw.get("props") or []) if isinstance(p, str)]
    props = [p for p in props if p in DIRECTION_PROPS][:4]
    if props:
        out["props"] = props
    cast = [str(c).strip().lower() for c in (raw.get("cast") or []) if isinstance(c, str)]
    cast = [c for c in cast if c in DIRECTION_CAST][:3]
    if cast:
        out["cast"] = cast
    env = str(raw.get("env") or "").strip().lower()
    if env in ("indoor", "outdoor"):
        out["env"] = env
    action = str(raw.get("action") or "").strip()
    if action:
        out["action"] = action[:160]
    return out or None

VISUAL_ALIASES = {"hero": "title", "outro": "quote", "diagram": "steps"}

NARRATION_CHARS_PER_SEC = 10  # Measured at speed 1.12 (~808 Thai chars -> ~78s)
SCRIPT_CHAR_TOLERANCE = 1.25  # Max ratio over character budget before repair/shorten
TTS_DURATION_TOLERANCE = 1.3  # Max ratio over durationSec (+ leadIn + holdEnd) before post-TTS shorten

DEFAULT_TTS_PROMPT = (
    "Narrate as a calm, charismatic, warm Thai documentary storyteller with a confident, smooth tone. "
    "Speak fluently at a crisp, engaging Thai narration pace (~14-15 syllables per second) with brief "
    "natural breaths between clauses and NO slow dragging or long dramatic pauses. "
    "Pronounce Thai and English terms cleanly and naturally."
)

RELIGIOUS_TTS_PROMPT = (
    "Narrate as a mature, dignified Thai male lecturer or documentary narrator delivering respectful "
    "religious or Dhamma/khutbah knowledge. Speak at a normal, clearly audible speaking volume with a "
    "full chest voice from the very first word—steady, clear, warm, and sincere. Keep a natural, "
    "measured pace (~13-14 syllables per second) with short pauses only at sentence ends. "
    "Pronounce Thai and Arabic-origin terms cleanly and accurately. "
    "Maintain a clear, full-volume speaking tone throughout, never soft-spoken or sing-song."
)

RELIGIOUS_KEYWORDS = (
    "อิสลาม", "ศาสนา", "หะดีษ", "อัลกุรอาน", "ละหมาด", "ดุอา", "อัลลอฮ์", "นบี",
    "รอมฎอน", "ซุนนะฮ์", "ศาสดา", "พุทธ", "ธรรมะ", "คริสต์",
    "islam", "hadith", "quran", "dua", "prayer", "sunnah",
)

FEMALE_VOICES = {
    "gemini:Aoede",
    "gemini:Sulafat",
    "gemini:Kore",
    "gemini:Leda",
    "gemini:Zephyr",
    "gemini:Vindemiatrix",
}

_WHISPER_WORDS_RE = re.compile(
    r"\b(?:whisper(?:ing|ed|s)?|breathy|asmr|intimate(?:ly)?|hushed|sensual(?:ly)?)\b|กระซิบ|แผ่วเบา",
    re.I,
)
_NEGATION_PREFIX_RE = re.compile(
    r"^(?:(?:and|or|but|yet|nor|และ|หรือ|แต่)\s+)?"
    r"(?:never\b|no\b|not\b|don['’]t\b|do\s+not\b|avoid\b|without\b|ห้าม|ไม่)",
    re.I,
)
_SENTENCE_SPLIT_RE = re.compile(r"((?<!\d)\.(?!\d)|[!?]|\n+)")
_CLAUSE_SPLIT_RE = re.compile(r"([,;—])")


def is_religious_topic(topic: str, notes: str = "") -> bool:
    """Return True when topic or notes match religious/spiritual keywords (case-insensitive)."""
    haystack = f"{topic or ''} {notes or ''}".lower()
    return any(kw in haystack for kw in RELIGIOUS_KEYWORDS)


def _is_female_voice(voice: str) -> bool:
    v = str(voice or "").strip()
    return v in FEMALE_VOICES or v.startswith("vachana:th_f_")


def _strip_whisper_words(text: str) -> str:
    """Drop positive whisper/ASMR/breathy/intimate/hushed/sensual clauses while keeping negated clauses intact."""
    if not text:
        return ""
    sent_parts = _SENTENCE_SPLIT_RE.split(str(text))
    rebuilt_sentences: list[str] = []

    for i in range(0, len(sent_parts), 2):
        sent = sent_parts[i]
        sent_delim = sent_parts[i + 1] if i + 1 < len(sent_parts) else ""
        if not sent.strip():
            continue

        clause_parts = _CLAUSE_SPLIT_RE.split(sent)
        kept: list[tuple[str, str]] = []
        for j in range(0, len(clause_parts), 2):
            clause = clause_parts[j]
            lead_delim = clause_parts[j - 1] if j > 0 else ""
            stripped = clause.strip()
            if not stripped:
                continue
            if _WHISPER_WORDS_RE.search(stripped) and not _NEGATION_PREFIX_RE.match(stripped):
                continue
            kept.append((lead_delim, stripped))

        if not kept:
            continue

        out_sent = kept[0][1]
        for delim, cl in kept[1:]:
            if delim == "—":
                out_sent += f"—{cl}"
            elif delim in (",", ";"):
                out_sent += f"{delim} {cl}"
            else:
                out_sent += f", {cl}"

        if sent_delim in (".", "!", "?"):
            out_sent += sent_delim
        rebuilt_sentences.append(out_sent)

    result = " ".join(rebuilt_sentences)
    return re.sub(r"[ \t]{2,}", " ", result).strip()

CRASH_RE = re.compile(
    r"unexpected fault address|fatal error: (fault|unexpected signal)|SIGSEGV|SIGBUS|SIGILL|"
    r"segmentation (fault|violation)|oh no: Bun has crashed|panic\(main thread\)|"
    r"Segmentation fault at address|bun\.report/\d+\.\d+",
    re.I,
)

# Active child processes for clean SIGTERM termination
_active_procs: set[subprocess.Popen[Any]] = set()
_current_job_dir: Path | None = None
_aborted = False


class AbortedError(BaseException):
    """Raised when SIGTERM/SIGINT aborts the job so finally blocks still run."""


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def clamp(val: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, val))


def safe_slug(job_id: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "-", job_id.strip()) or "job"
    return f"studio_{cleaned}"


def make_watch_url(abs_path: str | Path) -> str:
    return f"{DASHBOARD_ORIGIN}/api/gemini/local-file?path={abs_path}"


def make_download_url(abs_path: str | Path) -> str:
    return f"{DASHBOARD_ORIGIN}/api/gemini/local-file?path={abs_path}&download=1"


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.tmp.{os.getpid()}"
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def append_log(job_dir: Path, message: str) -> None:
    job_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_path = job_dir / "log.txt"
    with log_path.open("a", encoding="utf-8") as f:
        for line in str(message).splitlines() or [""]:
            f.write(f"[{ts}] {line}\n")
        f.flush()


def write_status(job_dir: Path, **fields: Any) -> dict[str, Any]:
    """Atomically update <job_dir>/job.json with merged fields, updatedAt, pid, pgid."""
    job_path = job_dir / "job.json"
    current: dict[str, Any] = {}
    if job_path.exists():
        try:
            loaded = read_json(job_path, {})
            if isinstance(loaded, dict):
                current = loaded
        except Exception:
            current = {}

    now = now_iso()
    current.setdefault("id", job_dir.name)
    current.setdefault("createdAt", now)
    current.setdefault("versions", [])
    current.update(fields)
    current["updatedAt"] = now
    current["pid"] = os.getpid()
    try:
        current["pgid"] = os.getpgrp()
    except OSError:
        pass
    atomic_write_json(job_path, current)
    return current


def _kill_active_children() -> None:
    for proc in list(_active_procs):
        try:
            pgid = os.getpgid(proc.pid)
            os.killpg(pgid, signal.SIGTERM)
        except Exception:
            try:
                proc.terminate()
            except Exception:
                pass
    deadline = time.monotonic() + 2.0
    for proc in list(_active_procs):
        rem = max(0.0, deadline - time.monotonic())
        try:
            proc.wait(timeout=rem)
        except Exception:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        _active_procs.discard(proc)


def _handle_signal(signum: int, _frame: Any) -> None:
    global _aborted
    _aborted = True
    _kill_active_children()
    if _current_job_dir is not None:
        try:
            append_log(_current_job_dir, f"Received signal {signum}; aborting job.")
            write_status(
                _current_job_dir,
                status="aborted",
                stage="aborted",
                error="ถูกยกเลิกโดยผู้ใช้",
            )
        except Exception:
            pass
    raise AbortedError(f"Aborted by signal {signum}")


def _install_signal_handlers() -> None:
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)


@contextlib.contextmanager
def acquire_render_lock(job_dir: Path) -> Iterator[None]:
    """Serialize heavy render/build jobs using fcntl.flock on render.lock."""
    RENDER_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    lock_file = open(RENDER_LOCK_PATH, "a+", encoding="utf-8")
    acquired = False
    try:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except BlockingIOError:
            append_log(job_dir, "Another render is active; status=queued, waiting for render.lock...")
            write_status(
                job_dir,
                status="queued",
                stage="queued",
                message="รอคิวเรนเดอร์ (มีงานอื่นกำลังทำงาน)",
            )
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            acquired = True
            append_log(job_dir, "Acquired render.lock.")
        yield
    finally:
        if acquired:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
        try:
            lock_file.close()
        except OSError:
            pass


def _run_subprocess(
    cmd: list[str],
    *,
    cwd: str | Path | None = None,
    env: dict[str, str] | None = None,
    timeout: int | None = None,
) -> tuple[int, str, str]:
    """Run a subprocess in its own process group without shell=True, tracked for SIGTERM."""
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    _active_procs.add(proc)
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
        return proc.returncode, stdout, stderr
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            proc.terminate()
        try:
            proc.communicate(timeout=3)
        except Exception:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                proc.kill()
        raise TimeoutError(f"Command timed out after {timeout}s: {cmd[0]}")
    finally:
        _active_procs.discard(proc)


def _evict_page_cache(path: str) -> None:
    try:
        real = os.path.realpath(path)
        fd = os.open(real, os.O_RDONLY)
        try:
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
        finally:
            os.close(fd)
    except OSError:
        pass


def _list_agy_homes() -> list[str | None]:
    homes: list[str | None] = []
    if (Path("/home/dev") / MAIN_TOKEN_REL).exists():
        homes.append(None)
    if PROFILES_DIR.is_dir():
        for name in sorted(d for d in os.listdir(PROFILES_DIR) if not d.startswith(".")):
            p = PROFILES_DIR / name
            if (p / MAIN_TOKEN_REL).exists():
                homes.append(str(p))
    return homes or [None]


def run_agy(
    prompt: str,
    model: str = PRIMARY_MODEL,
    timeout: int = 180,
    home: str | None = None,
) -> str:
    """Invoke headless agy CLI following cron-ai-runner.py pattern."""
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
    rc, stdout, stderr = _run_subprocess(cmd, cwd="/home/dev/projects", env=env, timeout=timeout + 25)
    if rc != 0:
        err = (stderr or "").strip() or (stdout or "").strip() or f"agy exited with {rc}"
        if CRASH_RE.search(err):
            _evict_page_cache(AGY_BIN)
        raise RuntimeError(err)
    out = (stdout or "").strip()
    if not out:
        raise RuntimeError("agy returned empty output")
    return out


def run_agy_with_fallback(
    job_dir: Path,
    prompt: str,
    *,
    primary_model: str = PRIMARY_MODEL,
    fallback_model: str = FALLBACK_MODEL,
    timeout: int = 180,
) -> tuple[str, str]:
    """Try primary model then fallback model across available agy profiles."""
    homes = _list_agy_homes()
    attempts: list[tuple[str, str | None]] = []
    for h in homes:
        attempts.append((primary_model, h))
    for h in homes:
        if fallback_model and fallback_model != primary_model:
            attempts.append((fallback_model, h))

    errors: list[str] = []
    for model, home in attempts:
        acc_label = Path(home).name if home else "primary"
        append_log(job_dir, f"Calling agy model={model} account={acc_label} timeout={timeout}s")
        try:
            text = run_agy(prompt, model=model, timeout=timeout, home=home)
            return text, model
        except AbortedError:
            raise
        except Exception as exc:
            short_err = str(exc).splitlines()[-1][:200] if str(exc) else repr(exc)
            append_log(job_dir, f"agy failed (model={model}, account={acc_label}): {short_err}")
            errors.append(f"{model}@{acc_label}: {short_err}")
    raise RuntimeError("AI ไม่สามารถตอบกลับได้: " + " | ".join(errors[-2:]))


def load_style_presets() -> dict[str, Any]:
    """Load all 46 built-in presets + custom styles via studio_styles.py with JSON fallback."""
    try:
        if str(SCRIPTS_DIR) not in sys.path:
            sys.path.insert(0, str(SCRIPTS_DIR))
        from studio_styles import load_all_styles  # type: ignore

        styles = load_all_styles()
        if isinstance(styles, dict) and styles:
            return styles
    except Exception:
        pass

    merged: dict[str, Any] = {}
    for path, is_custom in ((PRESETS_PATH, False), (CUSTOM_STYLES_PATH, True)):
        data = read_json(path, {})
        if isinstance(data, dict):
            presets = data.get("presets") or {}
            if isinstance(presets, dict):
                for k, v in presets.items():
                    if isinstance(v, dict):
                        merged[k] = {**v, "isCustom": is_custom}
    return merged


def get_style_preset(style_id: str) -> dict[str, Any]:
    styles = load_style_presets()
    if style_id in styles:
        return styles[style_id]
    if "look-1" in styles:
        return styles["look-1"]
    if styles:
        return next(iter(styles.values()))
    return {
        "id": style_id or "look-1",
        "enName": "Glow World",
        "thName": "โลกเรืองแสง",
        "category": "ลุคช่อง YouTube",
        "summary": "ฉากอธิบายแนวคิดแบบเรืองแสง",
        "tokens": {
            "family": "glow-world",
            "palette": {
                "bg": "#0B0E1E",
                "bgSecondary": "#161B38",
                "fg": "#F4F7FF",
                "muted": "#9AA5CE",
                "accent": "#38BDF8",
                "accent2": "#818CF8",
                "cardBg": "#141933",
                "border": "#2A3466",
            },
            "typography": {
                "fontFamily": "Noto Sans Thai, Kanit, sans-serif",
                "titleWeight": 800,
                "subtitleStyle": "pill",
            },
            "motion": {
                "springDamping": 14,
                "springStiffness": 140,
                "transitionType": "spring",
                "parallaxStrength": 0.65,
                "glowIntensity": 0.75,
            },
            "background": {"pattern": "radial", "vignette": 0.45, "grain": 0.12},
            "promptHints": "เล่าเรื่องกระชับ ชัดเจน ทันสมัย",
        },
    }


def extract_json_object(text: str) -> dict[str, Any]:
    """Extract and parse the first valid JSON object from LLM text."""
    stripped = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", stripped, re.DOTALL)
    if fence:
        return json.loads(fence.group(1))
    first = stripped.find("{")
    last = stripped.rfind("}")
    if first != -1 and last > first:
        return json.loads(stripped[first : last + 1])
    return json.loads(stripped)


def count_narration_chars(script: Any) -> tuple[int, list[tuple[str, int]]]:
    """Count total and per-scene narration characters across all scenes."""
    if not isinstance(script, dict):
        return 0, []
    scenes = script.get("scenes")
    if not isinstance(scenes, list):
        return 0, []
    per_scene: list[tuple[str, int]] = []
    total = 0
    for idx, sc in enumerate(scenes):
        if not isinstance(sc, dict):
            continue
        sid = str(sc.get("id") or f"s{idx + 1}").strip()
        chars = len(str(sc.get("narration") or "").strip())
        per_scene.append((sid, chars))
        total += chars
    return total, per_scene


def check_script_length(script: Any, duration_sec: int) -> list[str]:
    """Check whether total narration characters exceed 1.25x of the Thai character budget."""
    if duration_sec <= 0 or not isinstance(script, dict):
        return []
    total_chars, per_scene = count_narration_chars(script)
    if not per_scene:
        return []
    budget_chars = max(1, int(round(duration_sec * NARRATION_CHARS_PER_SEC)))
    max_chars = int(round(budget_chars * SCRIPT_CHAR_TOLERANCE))
    if total_chars <= max_chars:
        return []
    cut_to_budget = total_chars - budget_chars
    cut_min = total_chars - max_chars
    per_scene_target = max(25, int(round(budget_chars / max(1, len(per_scene)))))
    scene_detail = ", ".join(f"{sid}={c}" for sid, c in per_scene)
    return [
        f"บทพากย์ (narration) ยาวเกินงบ: รวม {total_chars} ตัวอักษร "
        f"(งบเป้าหมาย {budget_chars} ตัวอักษร, เกณฑ์สูงสุด 1.25x = {max_chars} ตัวอักษร) "
        f"— ต้องตัดออก {cut_to_budget} ตัวอักษร (อย่างน้อยที่สุดต้องตัดออก {cut_min} ตัวอักษร) "
        f"ให้เหลือประมาณ {budget_chars} ตัวอักษร และห้ามเกิน {max_chars} ตัวอักษร "
        f"(เฉลี่ยซีนละ ~{per_scene_target} ตัวอักษร) พร้อมย่อ narrationPhonetic และ subtitles ให้สั้นลงตามไปด้วย "
        f"[รายซีนปัจจุบัน: {scene_detail}]"
    ]


def validate_script(script: Any, *, duration_sec: int | None = None) -> tuple[bool, list[str]]:
    errors: list[str] = []
    if not isinstance(script, dict):
        return False, ["script ต้องเป็น JSON object"]
    scenes = script.get("scenes")
    if not isinstance(scenes, list) or len(scenes) < 2:
        return False, ["scenes ต้องเป็น array ที่มีอย่างน้อย 2 ซีน"]
    seen_ids: set[str] = set()
    for idx, sc in enumerate(scenes):
        if not isinstance(sc, dict):
            errors.append(f"scenes[{idx}] ต้องเป็น object")
            continue
        sid = str(sc.get("id") or "").strip()
        if not sid:
            errors.append(f"scenes[{idx}] ขาด id")
        elif sid in seen_ids:
            errors.append(f"scenes[{idx}] มี id ซ้ำ: {sid}")
        else:
            seen_ids.add(sid)
        if not str(sc.get("narration") or "").strip():
            errors.append(f"scenes[{idx}] ({sid or '?'}) ขาด narration")
        if not str(sc.get("title") or "").strip():
            errors.append(f"scenes[{idx}] ({sid or '?'}) ขาด title")
    if duration_sec is not None and duration_sec > 0:
        errors.extend(check_script_length(script, duration_sec))
    return len(errors) == 0, errors


def normalize_script(
    script: dict[str, Any],
    request: dict[str, Any],
    preset: dict[str, Any],
) -> dict[str, Any]:
    """Ensure all required TTS + StudioScene fields exist with clean defaults."""
    topic = str(request.get("topic") or "วิดีโอสรุปความรู้").strip()
    notes = str(request.get("notes") or "").strip()
    explicit_voice = str(request.get("voice") or "").strip()
    voice = (
        explicit_voice
        or str(preset.get("defaultVoice") or "").strip()
        or str(script.get("voice") or "").strip()
        or "gemini:Charon"
    )
    religious = is_religious_topic(topic, notes)
    raw_script_style = str(script.get("ttsStyle") or "").strip()
    tts_style = raw_script_style or str(preset.get("defaultTtsStyle") or "storytelling")
    raw_tts_prompt = str(script.get("ttsPrompt") or preset.get("defaultTtsPrompt") or "").strip()
    tts_prompt = raw_tts_prompt or DEFAULT_TTS_PROMPT

    if religious and not explicit_voice:
        if _is_female_voice(voice):
            voice = "gemini:Charon"
        if raw_script_style not in ("gravitas", "religious"):
            tts_style = "religious"
        tts_prompt = RELIGIOUS_TTS_PROMPT

    if tts_prompt not in (RELIGIOUS_TTS_PROMPT, DEFAULT_TTS_PROMPT):
        tts_prompt = _strip_whisper_words(tts_prompt) or (RELIGIOUS_TTS_PROMPT if religious else DEFAULT_TTS_PROMPT)

    speed_raw = request.get("speed") if request.get("speed") is not None else script.get("speed", 1.12)
    try:
        speed = round(float(speed_raw), 2)
    except (TypeError, ValueError):
        speed = 1.12
    speed = max(0.85, min(1.4, speed))

    out: dict[str, Any] = {
        "title": str(script.get("title") or topic).strip(),
        "fps": int(script.get("fps") or 30),
        "width": int(script.get("width") or 1080),
        "height": int(script.get("height") or 1920),
        "voice": voice,
        "ttsModel": str(script.get("ttsModel") or "gemini-2.5-flash-preview-tts"),
        "ttsStyle": tts_style,
        "ttsPrompt": tts_prompt,
        "masterPreset": str(script.get("masterPreset") or "light"),
        "speed": speed,
        "leadInSec": float(script.get("leadInSec") if script.get("leadInSec") is not None else 0.35),
        "holdEndSec": float(script.get("holdEndSec") if script.get("holdEndSec") is not None else 1.4),
        "scenes": [],
    }

    raw_scenes = script.get("scenes") or []
    total = len(raw_scenes)
    for idx, sc in enumerate(raw_scenes):
        if not isinstance(sc, dict):
            continue
        sid = re.sub(r"[^a-zA-Z0-9_-]", "_", str(sc.get("id") or f"s{idx + 1}")).strip("_") or f"s{idx + 1}"
        narration = str(sc.get("narration") or "").strip()
        phonetic = str(sc.get("narrationPhonetic") or narration).strip()
        title = str(sc.get("title") or f"ซีนที่ {idx + 1}").strip()
        subtitle = str(sc.get("subtitle") or "").strip()
        badge = str(sc.get("badge") or ("HOOK" if idx == 0 else f"{idx:02d}")).strip()

        visual = str(sc.get("visual") or "").strip().lower()
        visual = VISUAL_ALIASES.get(visual, visual)
        if visual not in VALID_VISUALS:
            if idx == 0:
                visual = "title"
            elif idx == total - 1:
                visual = "quote" if sc.get("quote") else "title"
            else:
                visual = "bullets"

        pad_default = 1.4 if idx == total - 1 else 0.35
        try:
            pad_after = float(sc.get("padAfterSec") if sc.get("padAfterSec") is not None else pad_default)
        except (TypeError, ValueError):
            pad_after = pad_default

        clean_sfx = []
        for ev in sc.get("sfx") or []:
            if isinstance(ev, dict) and str(ev.get("name") or "") in VALID_SFX:
                clean_sfx.append(
                    {
                        "name": str(ev["name"]),
                        "offsetSec": float(ev.get("offsetSec", 0.15)),
                        "volume": float(ev.get("volume", 0.24)),
                    }
                )
        if not clean_sfx:
            clean_sfx = [{"name": "soft_impact" if idx == 0 else "pop", "offsetSec": 0.12, "volume": 0.22}]

        clean_subs = []
        for sb in sc.get("subtitles") or []:
            if isinstance(sb, dict) and str(sb.get("text") or "").strip():
                item: dict[str, Any] = {"text": str(sb["text"]).strip()}
                if sb.get("highlight"):
                    item["highlight"] = str(sb["highlight"]).strip()
                clean_subs.append(item)

        scene_obj: dict[str, Any] = {
            "id": sid,
            "badge": badge,
            "title": title,
            "subtitle": subtitle,
            "narration": narration,
            "narrationPhonetic": phonetic,
            "padAfterSec": pad_after,
            "visual": visual,
            "sfx": clean_sfx,
        }
        if clean_subs:
            scene_obj["subtitles"] = clean_subs
        for opt_key in ("bullets", "stat", "steps", "compare", "quote", "icon", "highlightWord", "highlight"):
            if sc.get(opt_key) not in (None, "", [], {}):
                val = sc[opt_key]
                if opt_key == "steps" and isinstance(val, list):
                    norm_steps = []
                    for st_i, item in enumerate(val, 1):
                        if isinstance(item, dict):
                            st_title = str(item.get("title") or item.get("label") or "").strip()
                            if st_title:
                                entry: dict[str, Any] = {"step": str(item.get("step") or f"{st_i:02d}"), "title": st_title}
                                if item.get("detail"):
                                    entry["detail"] = str(item["detail"]).strip()
                                norm_steps.append(entry)
                        elif isinstance(item, str) and item.strip():
                            norm_steps.append(item.strip())
                    val = norm_steps
                scene_obj[opt_key] = val
        if scene_obj.get("highlightWord") and not scene_obj.get("highlight"):
            scene_obj["highlight"] = scene_obj["highlightWord"]
        if sc.get("ttsPrompt"):
            raw_scene_prompt = str(sc.get("ttsPrompt") or "").strip()
            if raw_scene_prompt in (RELIGIOUS_TTS_PROMPT, DEFAULT_TTS_PROMPT):
                cleaned_scene_prompt = raw_scene_prompt
            else:
                cleaned_scene_prompt = _strip_whisper_words(raw_scene_prompt)
            if cleaned_scene_prompt:
                scene_obj["ttsPrompt"] = cleaned_scene_prompt
        style_id = str(preset.get("id") or request.get("styleId") or "").strip().lower()
        direction = sanitize_direction(sc.get("direction"), style_id)
        if direction:
            scene_obj["direction"] = direction
        out["scenes"].append(scene_obj)
    return out


def build_research_prompt(topic: str, duration_sec: int, notes: str = "") -> str:
    extra = f"\nรายละเอียดเพิ่มเติมจากผู้ใช้: {notes}\n" if notes else ""
    religious_note = ""
    if is_religious_topic(topic, notes):
        religious_note = (
            "\nกติกาเพิ่มเติมสำหรับเนื้อหาศาสนา:\n"
            "- ระบุแหล่งอ้างอิงให้ชัดเจน (เช่น บันทึกโดยบุคอรี/มุสลิม พร้อมหมายเลขที่ตรวจสอบได้จริง หรือซูเราะฮ์และอายะฮ์)\n"
            "- ห้ามแต่งหรือเดาหมายเลขหะดีษ/อายะฮ์เอง หากไม่แน่ใจหมายเลขให้ระบุว่า \"มีรายงานในหะดีษ\" โดยไม่ต้องใส่ตัวเลข\n"
            "- แยกหลักฐานแต่ละประเด็นให้ชัดเจน ไม่นำหลายหะดีษมาปะปนกัน และไม่ใส่ตัวเลข/สถิติที่ไม่มีแหล่งยืนยัน\n"
        )
    return (
        f'ค้นหาข้อมูลล่าสุดจากเว็บเกี่ยวกับหัวข้อ: "{topic}"{extra}\n'
        f"สรุปเป็นรายงานข้อเท็จจริงภาษาไทยที่ถูกต้อง กระชับ และน่าสนใจสำหรับทำวิดีโออธิบายความยาวประมาณ {duration_sec} วินาที\n"
        "ให้จัดโครงสร้างเป็น Markdown ดังนี้:\n"
        "1. ประเด็นหลักและ Hook ที่น่าดึงดูด\n"
        "2. ข้อเท็จจริง กลไก หรือขั้นตอนสำคัญ (พร้อมตัวเลข/สถิติจริงถ้ามี)\n"
        "3. ข้อเปรียบเทียบหรือประเด็นสรุปที่คนดูจำได้ง่าย\n"
        "4. แหล่งอ้างอิง (ชื่อแหล่งและ URL ถ้ามี)\n"
        f"{religious_note}"
        "ตอบเป็น Markdown ภาษาไทยโดยตรง ไม่ต้องอธิบายขั้นตอนการทำงานของคุณ"
    )


def build_script_prompt(
    topic: str,
    research_md: str,
    preset: dict[str, Any],
    duration_sec: int,
    scene_count: int,
    notes: str = "",
    retry_errors: list[str] | None = None,
    previous_output: str | None = None,
) -> str:
    tokens = preset.get("tokens") or {}
    family = tokens.get("family", "glow-world")
    prompt_hints = tokens.get("promptHints", "")
    style_desc = (
        f"{preset.get('thName', '')} ({preset.get('enName', '')}) "
        f"[หมวด: {preset.get('category', '')}, family: {family}] — {preset.get('summary', '')}"
    )
    total_chars = int(round(duration_sec * NARRATION_CHARS_PER_SEC))
    max_total_chars = int(round(total_chars * SCRIPT_CHAR_TOLERANCE))
    per_scene_chars = max(25, int(round(total_chars / max(1, scene_count))))
    max_per_scene_chars = max(per_scene_chars + 5, int(round(max_total_chars / max(1, scene_count))))
    extra = f"\nคำสั่งเพิ่มเติมจากผู้ใช้: {notes}\n" if notes else ""
    religious = is_religious_topic(topic, notes)
    example_tts_style = "religious" if religious else "storytelling"

    clarity_rules = (
        "\n=== กติกาความชัดเจนของเนื้อหา ===\n"
        "- โครงเรื่องต้องเรียงลำดับชัดเจน: Hook (เปิดด้วยคำถามหรือข้อเท็จจริงด้วยน้ำเสียงปกติชัดเจน ห้ามกระซิบ) → Context (บริบท) → Evidence (หลักฐาน/ข้อเท็จจริง) → Takeaway (ข้อคิดนำไปใช้จริง) → Closing (สรุปปิดท้าย)\n"
        "- หนึ่งซีนต่อหนึ่งประเด็นเท่านั้น (One idea per scene) ห้ามอัดหลายประเด็นในซีนเดียว\n"
        "- ทุกซีนต้องเชื่อมโยงต่อเนื่องจากซีนก่อนหน้าอย่างมีเหตุผล ไม่กระโดดข้ามประเด็น\n"
        "- ซับไตเติล (subtitles) แต่ละท่อนต้องไม่เกิน 18 ตัวอักษรภาษาไทย และต้องตัดแบ่งที่ขอบคำหรือวลีที่อ่านเข้าใจง่าย (ห้ามตัดกลางคำ)\n"
        "- ข้อความหัวข้อบนจอ (title) ต้องตรงกับสิ่งที่กำลังพูดในซีนนั้น\n"
        "- ห้ามใส่ตัวเลขหรือสถิติใดๆ ที่ไม่มีอยู่ในข้อมูลจากการค้นคว้า (research.md)\n"
    )
    if religious:
        clarity_rules += (
            "- [เฉพาะเนื้อหาศาสนา] ระบุแหล่งอ้างอิงให้ชัดเจนตามที่มีในข้อมูลค้นคว้า (เช่น \"บันทึกโดยบุคอรี หมายเลข ...\") ห้ามแต่งหรือเดาหมายเลขหะดีษหรืออายะฮ์เองเด็ดขาด หากไม่แน่ใจหมายเลขให้เขียนว่า \"มีรายงานในหะดีษ\" โดยไม่ต้องใส่ตัวเลข\n"
            "- [เฉพาะเนื้อหาศาสนา] ห้ามนำหลายหะดีษมาปะปนกันในซีนเดียวกัน\n"
            "- [เฉพาะเนื้อหาศาสนา] ใช้น้ำเสียงและภาษาที่สุภาพ สำรวม ให้เกียรติ ไม่เร้าอารมณ์เกินจริง และไม่ทำโทนลึกลับหรือน่ากลัว (horror)\n"
            "- [เฉพาะเนื้อหาศาสนา] ใช้เสียงผู้ชาย (\"voice\": \"gemini:Charon\") และ \"ttsStyle\": \"religious\" พูดด้วยระดับเสียงปกติชัดเจนตั้งแต่คำแรก\n"
        )

    retry_block = ""
    if retry_errors:
        retry_block = (
            "\n⚠️ คำตอบรอบก่อนไม่ผ่านการตรวจสอบ กรุณาแก้ไขข้อผิดพลาดต่อไปนี้ทั้งหมด:\n"
            + "\n".join(f"- {e}" for e in retry_errors)
            + "\n"
        )
        if previous_output:
            retry_block += f"\nผลลัพธ์รอบก่อน:\n{previous_output[:16000]}\n"

    return (
        "คุณคือนักเขียนบทวิดีโอสั้นแนวตั้ง (9:16 1080x1920) มืออาชีพภาษาไทย\n"
        f'หัวข้อ: "{topic}"\n'
        f"สไตล์ภาพที่เลือก: {style_desc}\n"
        f"คำแนะนำสไตล์: {prompt_hints}\n"
        f"ความยาวเป้าหมาย: {duration_sec} วินาที | จำนวนซีนที่ต้องเขียน: {scene_count} ซีน\n"
        f"งบความยาวบทพากย์ (narration) — กฎเหล็กห้ามเกินเด็ดขาด:\n"
        f"- อัตราพูดจริงของ TTS ภาษาไทยที่ speed 1.12 อยู่ที่ประมาณ {NARRATION_CHARS_PER_SEC} ตัวอักษร/วินาที (วัดจริง ~808 ตัวอักษร = ~78 วินาที)\n"
        f"- เป้าหมาย narration รวมทุกซีน: ประมาณ {total_chars} ตัวอักษร (ขีดจำกัดสูงสุดเด็ดขาด: ห้ามเกิน {max_total_chars} ตัวอักษร — เกินถือว่าไม่ผ่าน)\n"
        f"- ความยาวต่อซีน: เฉลี่ยซีนละ ~{per_scene_chars} ตัวอักษร (ขีดจำกัดสูงสุดต่อซีน: ห้ามเกิน {max_per_scene_chars} ตัวอักษร หรือประมาณ 1-2 ประโยคสั้นกระชับ)\n"
        f"- เขียนให้สั้น คม กระชับ ไม่เกริ่นเยิ่นเย้อ และเขียน narrationPhonetic ให้สั้นกระชับใกล้เคียงกับ narration\n"
        f"{extra}"
        f"\n=== ข้อมูลจากการค้นคว้า (research.md) ===\n{research_md[:6000]}\n"
        f"{retry_block}\n"
        "=== กติการูปแบบ JSON ที่ต้องตอบ ===\n"
        "ตอบเป็น JSON object เดียวเท่านั้น (ใส่ใน ```json ... ``` ได้) ห้ามมีข้อความอธิบายอื่น โครงสร้าง:\n"
        "{\n"
        '  "title": "ชื่อคลิปภาษาไทยสั้นกระชับน่าคลิก",\n'
        '  "fps": 30,\n'
        '  "width": 1080,\n'
        '  "height": 1920,\n'
        '  "voice": "gemini:Charon",\n'
        '  "ttsModel": "gemini-2.5-flash-preview-tts",\n'
        f'  "ttsStyle": "{example_tts_style}",\n'
        '  "ttsPrompt": "...",\n'
        '  "masterPreset": "light",\n'
        '  "speed": 1.12,\n'
        '  "leadInSec": 0.35,\n'
        '  "holdEndSec": 1.4,\n'
        '  "scenes": [\n'
        "    {\n"
        '      "id": "s1_hook",\n'
        '      "badge": "HOOK",\n'
        '      "title": "หัวข้อสั้น 3-7 คำ",\n'
        '      "subtitle": "คำขยายสั้นๆ",\n'
        '      "narration": "บทพากย์ภาษาไทยธรรมชาติ",\n'
        '      "narrationPhonetic": "บทพากย์ที่เขียนคำอ่านภาษาไทยให้ TTS อ่านชัด เช่น ซีพียู แรม เอไอ",\n'
        '      "padAfterSec": 0.35,\n'
        '      "visual": "title | bullets | stat | steps | compare | quote | icon",\n'
        '      "highlightWord": "คำเด่นในซีน",\n'
        '      "icon": "cpu | bolt | spark | chart | shield | globe | rocket | clock | brain | layers",\n'
        '      "bullets": ["ข้อ 1", "ข้อ 2", "ข้อ 3"],\n'
        '      "stat": {"value": "3.5B", "label": "รอบต่อวินาที", "unit": "Hz"},\n'
        '      "steps": [{"step": "01", "title": "ขั้นที่ 1", "detail": "รายละเอียดสั้น"}],\n'
        '      "compare": {"leftTitle": "แบบเก่า", "leftItems": ["..."], "rightTitle": "แบบใหม่", "rightItems": ["..."]},\n'
        '      "quote": {"text": "คำคมหรือข้อสรุปเด่น", "author": "แหล่งที่มา"},\n'
        '      "subtitles": [{"text": "ซับสั้นๆ 1 บรรทัด", "highlight": "คำเน้น"}],\n'
        '      "sfx": [{"name": "soft_impact", "offsetSec": 0.15, "volume": 0.24}]\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "ข้อกำหนดสำคัญ:\n"
        f"- ต้องมีซีนครบ {scene_count} ซีน id ไม่ซ้ำกัน (เช่น s1_hook, s2_..., ..., s{scene_count}_outro)\n"
        f"- [ขีดจำกัดความยาวบังคับ] ความยาว narration รวมทุกซีนต้องไม่เกิน {max_total_chars} ตัวอักษร (เป้าหมาย ~{total_chars} ตัวอักษร, ซีนละไม่เกิน {max_per_scene_chars} ตัวอักษร)\n"
        "- ทุกซีนต้องมี id, title, narration, visual ที่ไม่ว่าง และเลือกใส่ field ภาพ (bullets/stat/steps/compare/quote) ให้ตรงกับ visual ของซีนนั้นๆ อย่างหลากหลาย\n"
        "- ซีนแรกควรใช้ visual='title' ซีนสุดท้ายใช้ visual='quote' หรือ 'title' และ padAfterSec=1.4\n"
        f"- sfx.name ต้องเลือกจากรายการนี้เท่านั้น: {', '.join(VALID_SFX)}\n"
        "- ห้ามใส่เครื่องหมายพิเศษที่อ่านยากใน narrationPhonetic ให้ถอดคำทับศัพท์เป็นภาษาไทยที่อ่านออกเสียงถูกต้อง\n"
        + clarity_rules
        + (
            build_direction_rules(scene_count, str(preset.get("id") or "").strip().lower())
            if (
                str(preset.get("id") or "").strip().lower() in ILLUSTRATED_STYLES
                or str(preset.get("id") or "").strip().lower() in STYLE_DIRECTOR_SHOTS
            )
            else ""
        )
    )


def build_direction_rules(scene_count: int, style_id: str | None = None) -> str:
    """Extra staging instructions for illustrated and style-directed styles."""
    sid = str(style_id or "").strip().lower()
    if sid in STYLE_DIRECTOR_SHOTS:
        shots_map = {**STYLE_DIRECTOR_SHOTS[sid], **DATA_DIRECTOR_SHOTS}
        shot_ids = ", ".join(shots_map.keys())
        shot_desc = "\n".join(f"  - {k}: {v}" for k, v in shots_map.items())
        return (
            f"\n=== การกำกับช็อตประจำสไตล์ ({sid}) ===\n"
            "ทุกซีนต้องมี field \"direction\" เพื่อเลือกมุมภาพ/ช็อตที่เหมาะกับเนื้อหาซีนนั้น:\n"
            '"direction": {"shot": "...", "action": "อธิบายสั้นๆ ว่าซีนนี้เน้นภาพอะไร"}\n'
            f"- shot ต้องเลือกจากรายการนี้เท่านั้น: {shot_ids}\n"
            f"{shot_desc}\n"
            "- ห้ามใช้ช็อตซ้ำกันเลยในคลิป ถ้าจำนวนซีนไม่เกินจำนวนช็อต\n"
            "- ซีนที่มี stat/steps/compare/bullets/quote ให้พิจารณา data-* ที่ตรงชนิดหรือช็อตเฉพาะสไตล์ที่สื่อเนื้อหานั้น\n"
            "- ซีนแรกและซีนสุดท้ายให้ใช้ช็อตเฉพาะสไตล์\n"
            "- action ต้องบรรยายภาพที่ไม่ซ้ำกับซีนอื่น\n"
        )

    return (
        "\n=== การกำกับภาพ (สไตล์นี้วาดเป็นฉากการ์ตูนลายเส้นแยกทุกซีน) ===\n"
        "ทุกซีนต้องมี field \"direction\" เพื่อบอกว่าซีนนี้ต้องวาดอะไร ตัวละครทำอะไร มีของอะไรในฉาก:\n"
        '"direction": {"shot": "...", "mood": "...", "pose": "...", "cast": ["hero", ...], "props": ["...", "..."], "env": "indoor|outdoor", "action": "อธิบายสั้นๆ ว่าตัวละครกำลังทำอะไร"}\n'
        f"- shot (มุมกล้อง/ฉาก) เลือกจาก: {', '.join(DIRECTION_SHOTS)}\n"
        "  pov-desk=ตัวเอกนั่งโต๊ะหันหน้าเข้ากล้อง+โน้ตบนผนัง | interview=คนสองคนคุยกันข้ามโต๊ะ มีบอลลูนคำพูด | whiteboard=ตัวเอกยืนชี้กระดาน |"
        " closeup=หน้าตัวเอกเต็มจอ+ลูกโป่งความคิด | crowd=ฝูงคน 100 หัว ไฮไลต์บางคน (ใช้กับสถิติ X ใน 100 หรือ %) |"
        " split=ช่องการ์ตูนสองช่อง ผิด vs ถูก (ใช้กับ compare) | stairs=ตัวเอกเดินขึ้นบันไดทีละขั้น (ใช้กับ steps) |"
        " held-paper=มุมมองบุคคลที่หนึ่ง มือเราถือกระดาษที่มีรายการ | door=เปิดประตูเข้าห้อง (ฉากเปิด) | phone=มือเราถือมือถือ อ่านแชท\n"
        f"- mood เลือกจาก: {', '.join(DIRECTION_MOODS)} | pose เลือกจาก: {', '.join(DIRECTION_POSES)}\n"
        f"- cast เลือกจาก: {', '.join(DIRECTION_CAST)} | props (ของในฉาก 1-4 ชิ้นที่เล่าเรื่องได้) เลือกจาก: {', '.join(DIRECTION_PROPS)}\n"
        f"- ห้ามใช้ shot ซ้ำในซีนติดกัน และใน {scene_count} ซีนต้องใช้ shot ต่างกันอย่างน้อย {min(scene_count, 5)} แบบ\n"
        "- เลือก shot ให้เข้ากับข้อมูลของซีน: compare→split หรือ interview, steps→stairs, stat→crowd หรือ closeup, bullets→held-paper/whiteboard/pov-desk\n"
        "- อารมณ์ตัวละครต้องเปลี่ยนตามเรื่อง (เช่น ตกใจตอนเปิด กังวลตอนเจอปัญหา ดีใจตอนจบ)\n"
    )


def stage_draft(job_dir: Path) -> dict[str, Any]:
    """Run researching + scripting stages and produce validated script.json."""
    request = read_json(job_dir / "request.json")
    if not isinstance(request, dict) or not str(request.get("topic") or "").strip():
        raise ValueError("ไม่พบไฟล์ request.json หรือไม่ได้ระบุหัวข้อ (topic)")

    topic = str(request["topic"]).strip()
    style_id = str(request.get("styleId") or "look-1").strip()
    try:
        duration_sec = clamp(int(round(float(request.get("durationSec") or 30))), 12, 180)
    except (TypeError, ValueError):
        duration_sec = 30
    notes = str(request.get("notes") or "").strip()

    preset = get_style_preset(style_id)
    scene_count = clamp(round(duration_sec / 4.5), 3, 14)

    # (a) Researching
    append_log(job_dir, f"Stage draft: researching topic='{topic}' styleId='{style_id}' durationSec={duration_sec}")
    write_status(
        job_dir,
        status="researching",
        stage="researching",
        progress=5,
        topic=topic,
        styleId=style_id,
        durationSec=duration_sec,
        mode=str(request.get("mode") or "draft"),
        error=None,
    )

    research_prompt = build_research_prompt(topic, duration_sec, notes)
    research_md, research_model = run_agy_with_fallback(job_dir, research_prompt, timeout=180)
    (job_dir / "research.md").write_text(research_md + "\n", encoding="utf-8")
    append_log(job_dir, f"Research saved to research.md ({len(research_md)} chars, model={research_model})")

    # (b) Scripting
    write_status(job_dir, status="scripting", stage="scripting", progress=15, researchModel=research_model)
    script_prompt = build_script_prompt(topic, research_md, preset, duration_sec, scene_count, notes)
    raw_script_text, script_model = run_agy_with_fallback(job_dir, script_prompt, timeout=180)

    parsed: dict[str, Any] | None = None
    struct_ok = False
    val_errors: list[str] = []
    cur_chars = 0
    budget_chars = int(round(duration_sec * NARRATION_CHARS_PER_SEC))
    max_chars = int(round(budget_chars * SCRIPT_CHAR_TOLERANCE))
    try:
        parsed = extract_json_object(raw_script_text)
        struct_ok, struct_errors = validate_script(parsed)
        len_errors = check_script_length(parsed, duration_sec)
        cur_chars, _ = count_narration_chars(parsed)
        val_errors = [*struct_errors, *len_errors]
        ok = struct_ok and not len_errors
        append_log(
            job_dir,
            f"Draft script narration check: chars={cur_chars}, budget={budget_chars}, max={max_chars}, struct_ok={struct_ok}",
        )
    except Exception as exc:
        ok = False
        struct_ok = False
        val_errors = [f"JSON ไม่ถูกต้อง: {exc}"]

    # Single repair/shorten pass if structural validation or 1.25x character budget failed
    if not ok:
        only_length_issue = struct_ok and bool(val_errors)
        append_log(job_dir, f"Script validation/length check failed ({val_errors}); running 1 repair/shorten attempt...")
        write_status(
            job_dir,
            status="scripting",
            stage="scripting",
            progress=20,
            message="บทพากย์ยาวเกินงบ กำลังกระชับบทให้พอดีความยาว..." if only_length_issue else "กำลังปรับปรุงโครงสร้างบท...",
        )
        prev_for_repair = (
            json.dumps(parsed, ensure_ascii=False, indent=2) if parsed is not None else raw_script_text
        )
        repair_prompt = build_script_prompt(
            topic,
            research_md,
            preset,
            duration_sec,
            scene_count,
            notes,
            retry_errors=val_errors,
            previous_output=prev_for_repair,
        )
        repaired_text, script_model = run_agy_with_fallback(job_dir, repair_prompt, timeout=180)
        try:
            repaired_parsed = extract_json_object(repaired_text)
            rep_struct_ok, rep_struct_errs = validate_script(repaired_parsed)
        except Exception as exc:
            repaired_parsed = None
            rep_struct_ok = False
            rep_struct_errs = [f"JSON รอบซ่อมไม่ถูกต้อง: {exc}"]

        if rep_struct_ok and repaired_parsed is not None:
            rep_chars, _ = count_narration_chars(repaired_parsed)
            rep_len_errs = check_script_length(repaired_parsed, duration_sec)
            if only_length_issue and parsed is not None and rep_len_errs and rep_chars > cur_chars:
                append_log(
                    job_dir,
                    f"Shorten pass became longer ({cur_chars} -> {rep_chars} chars); keeping shorter round-1 draft.",
                )
            else:
                parsed = repaired_parsed
                if rep_len_errs:
                    append_log(
                        job_dir,
                        f"Warning: narration still exceeds 1.25x after repair ({rep_chars} chars vs max {max_chars}); "
                        "will verify actual duration after TTS.",
                    )
                else:
                    append_log(
                        job_dir,
                        f"Repair/shorten pass succeeded: narration chars {cur_chars} -> {rep_chars} (budget={budget_chars}).",
                    )
            ok = True
            val_errors = []
        elif only_length_issue and parsed is not None:
            append_log(
                job_dir,
                f"Shorten pass returned invalid JSON/structure ({rep_struct_errs}); keeping valid round-1 draft.",
            )
            ok = True
            val_errors = []
        else:
            ok = False
            val_errors = rep_struct_errs

    if not ok or parsed is None:
        raise RuntimeError(f"AI สร้างบทไม่ผ่านการตรวจสอบ: {'; '.join(val_errors)}")

    final_script = normalize_script(parsed, request, preset)
    atomic_write_json(job_dir / "script.json", final_script)
    append_log(job_dir, f"Script saved to script.json ({len(final_script['scenes'])} scenes, model={script_model})")

    write_status(
        job_dir,
        status="draft_ready",
        stage="draft_ready",
        progress=25,
        title=final_script["title"],
        sceneCount=len(final_script["scenes"]),
        scriptModel=script_model,
        message="ร่างบทเสร็จแล้ว พร้อมตรวจสอบหรือสั่งสร้างวิดีโอ",
    )
    return final_script


def compute_tts_hash(script: dict[str, Any]) -> str:
    """Hash narration + voice + speed + TTS-relevant fields to skip redundant TTS calls."""
    payload = {
        "voice": script.get("voice"),
        "speed": script.get("speed"),
        "ttsModel": script.get("ttsModel"),
        "ttsStyle": script.get("ttsStyle"),
        "ttsPrompt": script.get("ttsPrompt"),
        "masterPreset": script.get("masterPreset"),
        "leadInSec": script.get("leadInSec"),
        "holdEndSec": script.get("holdEndSec"),
        "fps": script.get("fps", 30),
        "scenes": [
            {
                "id": s.get("id"),
                "narration": s.get("narration"),
                "narrationPhonetic": s.get("narrationPhonetic"),
                "padAfterSec": s.get("padAfterSec"),
                "subtitles": s.get("subtitles"),
                "sfx": s.get("sfx"),
            }
            for s in (script.get("scenes") or [])
        ],
    }
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def run_tts_stage(job_dir: Path, script: dict[str, Any]) -> dict[str, Any]:
    """Run motion-studio tts with cache check via work/tts_hash.json."""
    work_dir = job_dir / "work"
    work_dir.mkdir(parents=True, exist_ok=True)
    timeline_path = work_dir / "timeline.json"
    hash_path = work_dir / "tts_hash.json"

    cur_hash = compute_tts_hash(script)
    cached = read_json(hash_path, {})
    if (
        isinstance(cached, dict)
        and cached.get("hash") == cur_hash
        and timeline_path.exists()
    ):
        tl = read_json(timeline_path, {})
        narration_path = Path(str(tl.get("narrationPath") or ""))
        if isinstance(tl, dict) and tl.get("scenes") and narration_path.exists():
            append_log(job_dir, f"TTS cache hit (hash={cur_hash[:12]}); skipping motion-studio tts.")
            write_status(job_dir, status="tts", stage="tts", progress=38, message="ใช้ไฟล์เสียงจากแคช")
            return tl

    write_status(job_dir, status="tts", stage="tts", progress=30, message="กำลังสร้างเสียงพากย์ภาษาไทย...")
    append_log(job_dir, f"Running motion-studio tts -> {work_dir}")
    cmd = [MOTION_STUDIO_BIN, "tts", str(job_dir / "script.json"), "-o", str(work_dir)]
    rc, stdout, stderr = _run_subprocess(cmd, cwd=BASE_DIR, timeout=600)
    if rc != 0:
        err = (stderr or stdout or f"tts exited {rc}").strip()
        append_log(job_dir, f"TTS error: {err}")
        raise RuntimeError(f"สร้างเสียงพากย์ไม่สำเร็จ: {err.splitlines()[-1][:200]}")

    if not timeline_path.exists():
        raise RuntimeError("ไม่พบไฟล์ work/timeline.json หลังรัน TTS")

    atomic_write_json(hash_path, {"hash": cur_hash, "updatedAt": now_iso()})
    tl = read_json(timeline_path)
    append_log(job_dir, f"TTS completed: totalSec={tl.get('totalSec')}, scenes={len(tl.get('scenes') or [])}")
    write_status(job_dir, status="tts", stage="tts", progress=38)
    return tl


def build_post_tts_shorten_prompt(
    script: dict[str, Any],
    timeline: dict[str, Any],
    target_duration_sec: int,
    max_allowed_sec: float,
) -> str:
    """Build a focused prompt to shorten only over-length narration scenes using measured TTS timing."""
    script_scenes = [s for s in (script.get("scenes") or []) if isinstance(s, dict)]
    tl_scenes = [s for s in (timeline.get("scenes") or []) if isinstance(s, dict)]
    tl_by_id = {str(s.get("id") or ""): s for s in tl_scenes}

    actual_total_sec = float(timeline.get("totalSec") or 0.0)
    actual_speech_total = sum(float(s.get("speechDurSec") or 0.0) for s in tl_scenes)
    overhead_sec = max(0.0, actual_total_sec - actual_speech_total)
    target_speech_sec = max(target_duration_sec * 0.72, target_duration_sec - overhead_sec)

    total_chars, _ = count_narration_chars(script)
    measured_cps = (total_chars / actual_speech_total) if actual_speech_total > 0.5 else float(NARRATION_CHARS_PER_SEC)
    measured_cps = max(5.0, min(18.0, measured_cps))

    # Never ask for more characters than the nominal durationSec * 10 budget
    target_total_chars = min(
        int(round(target_duration_sec * NARRATION_CHARS_PER_SEC)),
        max(60, int(round(target_speech_sec * measured_cps))),
    )
    scene_count = max(1, len(script_scenes))
    fair_scene_sec = target_speech_sec / scene_count

    # Identify scenes already short enough to stay verbatim (preserving per-scene TTS cache)
    scene_durs: list[tuple[dict[str, Any], float]] = []
    for idx, sc in enumerate(script_scenes):
        sid = str(sc.get("id") or f"s{idx + 1}")
        tl_sc = tl_by_id.get(sid) or (tl_scenes[idx] if idx < len(tl_scenes) else {})
        speech_dur = float(tl_sc.get("speechDurSec") or 0.0)
        scene_durs.append((sc, speech_dur))

    keep_ids: set[str] = set()
    kept_sec = 0.0
    candidate_keep = [(sc, d) for sc, d in scene_durs if 0.1 < d <= fair_scene_sec * 1.05]
    if 0 < len(candidate_keep) < scene_count:
        remaining_count = scene_count - len(candidate_keep)
        kept_sum = sum(d for _, d in candidate_keep)
        if (target_speech_sec - kept_sum) / remaining_count >= 2.0:
            keep_ids = {str(sc.get("id") or "") for sc, _ in candidate_keep}
            kept_sec = kept_sum

    shrink_count = max(1, scene_count - len(keep_ids))
    shrink_target_sec = max(2.0, (target_speech_sec - kept_sec) / shrink_count)
    shrink_target_chars = max(25, int(round(shrink_target_sec * measured_cps)))

    guidance_lines: list[str] = []
    compact_scenes: list[dict[str, Any]] = []
    for idx, (sc, speech_dur) in enumerate(scene_durs):
        sid = str(sc.get("id") or f"s{idx + 1}")
        narr = str(sc.get("narration") or "").strip()
        cur_len = len(narr)
        if sid in keep_ids:
            guidance_lines.append(
                f"- {sid}: เสียงจริง {speech_dur:.2f}s ({cur_len} ตัวอักษร) -> [คงเดิมห้ามแก้ เพื่อใช้แคชเสียง]"
            )
        else:
            cut_n = max(0, cur_len - shrink_target_chars)
            guidance_lines.append(
                f"- {sid}: เสียงจริง {speech_dur:.2f}s ({cur_len} ตัวอักษร) -> "
                f"[ต้องย่อให้เหลือไม่เกิน ~{shrink_target_chars} ตัวอักษร (ตัดออก ~{cut_n} ตัวอักษร)]"
            )
        compact_scenes.append(
            {
                "id": sid,
                "title": str(sc.get("title") or ""),
                "narration": narr,
                "narrationPhonetic": str(sc.get("narrationPhonetic") or narr).strip(),
                "subtitles": sc.get("subtitles") or [],
            }
        )

    total_cut = max(1, total_chars - target_total_chars)
    return (
        "คุณคือบรรณาธิการบทพากย์วิดีโอสั้นภาษาไทยที่ต้องย่อบทพากย์ให้พอดีเวลาเสียงจริง\n"
        f"เวลาเสียงพากย์หลังรัน TTS จริง: {actual_total_sec:.2f} วินาที "
        f"(เกินเกณฑ์สูงสุด {max_allowed_sec:.2f} วินาที | เป้าหมายคลิป: {target_duration_sec} วินาที)\n"
        f"อัตราพูดจริงที่วัดได้: ~{measured_cps:.1f} ตัวอักษร/วินาที\n"
        f"ปัจจุบันรวม {total_chars} ตัวอักษร -> ต้องย่อรวมลงอย่างน้อย {total_cut} ตัวอักษร "
        f"ให้รวมทุกซีนเหลือไม่เกิน ~{target_total_chars} ตัวอักษร\n\n"
        "คำสั่งรายซีน:\n"
        + "\n".join(guidance_lines)
        + "\n\nบทพากย์ปัจจุบัน (JSON):\n"
        + json.dumps({"scenes": compact_scenes}, ensure_ascii=False, indent=2)
        + "\n\nกติกาตอบกลับ:\n"
        "- ตอบเป็น JSON object เดียวเท่านั้นในรูปแบบ:\n"
        '  {"scenes": [{"id": "...", "narration": "...", "narrationPhonetic": "...", "subtitles": [{"text": "...", "highlight": "..."}]}]}\n'
        "- คงลำดับและ id ของทุกซีนให้ครบเหมือนเดิมทุกตัว\n"
        "- ซีนที่ระบุว่า [คงเดิมห้ามแก้] ให้คัดลอก narration และ narrationPhonetic เดิมเป๊ะๆ ห้ามเปลี่ยนแม้แต่ตัวอักษรเดียว\n"
        "- ซีนที่ระบุว่า [ต้องย่อ] ให้เขียนใหม่ให้กระชับ คงใจความสำคัญ ภาษาไทยธรรมชาติ ตามจำนวนตัวอักษรเป้าหมาย พร้อมแก้ narrationPhonetic และ subtitles ให้ตรงกับบทใหม่\n"
        "- ห้ามใส่ข้อความอธิบายอื่นนอกจาก JSON\n"
    )


def maybe_shorten_after_tts(
    job_dir: Path,
    script: dict[str, Any],
    timeline: dict[str, Any],
    request: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """If measured TTS timeline exceeds durationSec*1.3 + leadIn + holdEnd, ask AI once to shorten and re-run TTS."""
    timeline_path = job_dir / "work" / "timeline.json"
    tl_disk = read_json(timeline_path, None)
    if isinstance(tl_disk, dict) and tl_disk.get("totalSec") is not None:
        timeline = tl_disk

    dur_raw = request.get("durationSec")
    if dur_raw is None:
        job_meta = read_json(job_dir / "job.json", {}) or {}
        dur_raw = job_meta.get("durationSec")
    try:
        target_duration_sec = clamp(int(round(float(dur_raw))), 12, 180) if dur_raw is not None else 0
    except (TypeError, ValueError):
        target_duration_sec = 0

    if target_duration_sec <= 0:
        return script, timeline

    actual_total_sec = float(timeline.get("totalSec") or 0.0)
    lead_in = float(script.get("leadInSec") if script.get("leadInSec") is not None else 0.35)
    hold_end = float(script.get("holdEndSec") if script.get("holdEndSec") is not None else 1.4)
    max_allowed_sec = target_duration_sec * TTS_DURATION_TOLERANCE + lead_in + hold_end

    append_log(
        job_dir,
        f"Post-TTS duration check: actual={actual_total_sec:.2f}s vs limit={max_allowed_sec:.2f}s "
        f"(target={target_duration_sec}s * {TTS_DURATION_TOLERANCE} + leadIn={lead_in:.2f}s + holdEnd={hold_end:.2f}s)",
    )
    if actual_total_sec <= max_allowed_sec:
        return script, timeline

    old_chars, _ = count_narration_chars(script)
    append_log(
        job_dir,
        f"TTS duration exceeded limit ({actual_total_sec:.2f}s > {max_allowed_sec:.2f}s, {old_chars} chars); "
        "requesting 1-shot AI narration shortening and cached TTS re-run...",
    )
    write_status(
        job_dir,
        status="tts",
        stage="tts",
        progress=34,
        message=f"เสียงพากย์ยาวเกินกำหนด ({actual_total_sec:.1f}s > {max_allowed_sec:.1f}s) กำลังกระชับบทและสร้างเสียงใหม่...",
    )

    try:
        shorten_prompt = build_post_tts_shorten_prompt(script, timeline, target_duration_sec, max_allowed_sec)
        raw_text, used_model = run_agy_with_fallback(job_dir, shorten_prompt, timeout=180)
        parsed = extract_json_object(raw_text)
        upd_scenes_raw = parsed.get("scenes") if isinstance(parsed, dict) else None
        if not isinstance(upd_scenes_raw, list) or not upd_scenes_raw:
            append_log(job_dir, f"Post-TTS shorten warning: AI ({used_model}) returned no scenes; keeping current TTS.")
            return script, timeline
    except AbortedError:
        raise
    except Exception as exc:
        append_log(job_dir, f"Post-TTS shorten failed (non-fatal): {exc}; proceeding with existing TTS audio.")
        return script, timeline

    upd_by_id: dict[str, dict[str, Any]] = {}
    for item in upd_scenes_raw:
        if isinstance(item, dict) and str(item.get("id") or "").strip():
            upd_by_id[str(item["id"]).strip()] = item

    updated_script = json.loads(json.dumps(script, ensure_ascii=False))
    changed_ids: list[str] = []
    unchanged_ids: list[str] = []

    for idx, sc in enumerate(updated_script.get("scenes") or []):
        if not isinstance(sc, dict):
            continue
        sid = str(sc.get("id") or f"s{idx + 1}").strip()
        upd = upd_by_id.get(sid)
        if upd is None and len(upd_scenes_raw) == len(updated_script["scenes"]) and isinstance(upd_scenes_raw[idx], dict):
            upd = upd_scenes_raw[idx]
        if not isinstance(upd, dict):
            unchanged_ids.append(sid)
            continue

        old_narr = str(sc.get("narration") or "").strip()
        old_phon = str(sc.get("narrationPhonetic") or old_narr).strip()
        new_narr = str(upd.get("narration") or "").strip()
        if not new_narr or new_narr == old_narr:
            unchanged_ids.append(sid)
            continue

        sc["narration"] = new_narr
        new_phon = str(upd.get("narrationPhonetic") or "").strip()
        if new_phon and new_phon != old_phon and len(new_phon) <= max(int(len(new_narr) * 1.45) + 20, 40):
            sc["narrationPhonetic"] = new_phon
        else:
            sc["narrationPhonetic"] = new_narr

        clean_subs = []
        for sb in upd.get("subtitles") or []:
            if isinstance(sb, dict) and str(sb.get("text") or "").strip():
                entry: dict[str, Any] = {"text": str(sb["text"]).strip()}
                if sb.get("highlight"):
                    entry["highlight"] = str(sb["highlight"]).strip()
                clean_subs.append(entry)
        if clean_subs:
            sc["subtitles"] = clean_subs
        elif sc.get("subtitles"):
            fallback_sub: dict[str, Any] = {"text": new_narr}
            if sc.get("highlight"):
                fallback_sub["highlight"] = str(sc["highlight"])
            sc["subtitles"] = [fallback_sub]

        changed_ids.append(sid)

    new_chars, _ = count_narration_chars(updated_script)
    if not changed_ids or new_chars >= old_chars:
        append_log(
            job_dir,
            f"Post-TTS shorten did not reduce length (chars {old_chars} -> {new_chars}, changed={changed_ids}); "
            "keeping original script and TTS.",
        )
        return script, timeline

    atomic_write_json(job_dir / "script.json", updated_script)
    append_log(
        job_dir,
        f"Post-TTS shorten applied (model={used_model}): chars {old_chars} -> {new_chars}, "
        f"changed={changed_ids}, cached={unchanged_ids}; re-running TTS...",
    )
    new_timeline = run_tts_stage(job_dir, updated_script)
    new_total_sec = float(new_timeline.get("totalSec") or 0.0)
    append_log(
        job_dir,
        f"Post-TTS re-run completed: totalSec {actual_total_sec:.2f}s -> {new_total_sec:.2f}s "
        f"(target={target_duration_sec}s, limit={max_allowed_sec:.2f}s)",
    )
    return updated_script, new_timeline


def run_scene_art_step(job_dir: Path, script: dict[str, Any], request: dict[str, Any]) -> None:
    """Render a distinct 3D hero object per scene on the Blender nodes (non-fatal; skipped when disabled)."""
    if request.get("sceneArt") is False or os.environ.get("MS_SCENE_ART") == "0":
        return
    try:
        write_status(job_dir, status="rendering", stage="scene-art", progress=36, message="กำลังสร้างวัตถุ 3D ประจำซีน (Blender)...")
        import scene_art  # local module in scripts/

        scene_art.run_scene_art_stage(job_dir, script, {**request, "id": request.get("id") or job_dir.name})
    except Exception as exc:  # never block the video on optional art
        append_log(job_dir, f"[scene-art] skipped: {exc}")


def _trim_scene_art_png(src: str) -> str:
    """Autocrop transparent margins (alpha > 16) with 4% padding, caching <name>_trim.png beside original.

    Never modifies the original file; returns original src on any error.
    """
    if not src or src.startswith(("http://", "https://")):
        return src
    try:
        public_dir = BASE_DIR / "public"
        if src.startswith("/") and Path(src).is_file():
            orig_path = Path(src)
            is_public_rel = False
        else:
            orig_path = public_dir / src.lstrip("/")
            is_public_rel = True

        if orig_path.suffix.lower() != ".png" or not orig_path.is_file():
            return src
        if orig_path.stem.endswith("_trim"):
            return src

        trim_path = orig_path.with_name(f"{orig_path.stem}_trim{orig_path.suffix}")
        if is_public_rel:
            rel_str = str(trim_path.relative_to(public_dir)).replace("\\", "/")
            trim_src = f"/{rel_str}" if src.startswith("/") else rel_str
        else:
            trim_src = str(trim_path)

        if (
            trim_path.is_file()
            and trim_path.stat().st_size > 0
            and trim_path.stat().st_mtime >= orig_path.stat().st_mtime
        ):
            return trim_src

        from PIL import Image

        with Image.open(orig_path) as im:
            rgba = im.convert("RGBA")
            w, h = rgba.size
            alpha = rgba.getchannel("A")
            mask = alpha.point(lambda v: 255 if v > 16 else 0)
            bbox = mask.getbbox()
            if not bbox:
                return src
            x0, y0, x1, y1 = bbox
            bw = x1 - x0
            bh = y1 - y0
            if bw <= 0 or bh <= 0:
                return src
            pad_x = int(round(bw * 0.04))
            pad_y = int(round(bh * 0.04))
            crop_box = (
                max(0, x0 - pad_x),
                max(0, y0 - pad_y),
                min(w, x1 + pad_x),
                min(h, y1 + pad_y),
            )
            cropped = rgba.crop(crop_box)
            tmp_path = trim_path.with_name(f".{trim_path.name}.tmp.{os.getpid()}")
            cropped.save(tmp_path, format="PNG")
            tmp_path.replace(trim_path)
        return trim_src
    except Exception:
        return src


def scene_art_for(job_dir: Path, scene_id: str) -> dict[str, Any] | None:
    doc = read_json(job_dir / "scene_art.json", None)
    entry = ((doc or {}).get("scenes") or {}).get(scene_id) if isinstance(doc, dict) else None
    if not isinstance(entry, dict) or not entry.get("src"):
        return None
    return {k: entry[k] for k in ("src", "composition", "motionHint", "hero") if entry.get(k)}


def run_scene_vector_step(job_dir: Path, script: dict[str, Any], request: dict[str, Any]) -> None:
    """Generate AI vector motion-stage specs per selected scene (non-fatal; skipped when disabled)."""
    mode = str(request.get("dynamicStage") or os.environ.get("MS_DYNAMIC_STAGE") or "auto").strip().lower()
    if mode in ("off", "0", "false", "none"):
        return
    try:
        write_status(
            job_dir,
            status="rendering",
            stage="scene-vector",
            progress=38,
            message="กำลังออกแบบฉากเวกเตอร์แอนิเมชันด้วย AI...",
        )
        import scene_vector  # local module in scripts/

        scene_vector.run_scene_vector_stage(job_dir, script, {**request, "id": request.get("id") or job_dir.name})
    except Exception as exc:  # never block the video on optional vector stage
        append_log(job_dir, f"[scene-vector] skipped: {exc}")


def scene_vector_for(
    job_dir: Path,
    scene_id: str,
    palette: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    doc = read_json(job_dir / "scene_vector.json", None)
    entry = ((doc or {}).get("scenes") or {}).get(scene_id) if isinstance(doc, dict) else None
    if not isinstance(entry, dict) or not entry.get("elements"):
        return None
    try:
        import scene_vector  # local module in scripts/

        return scene_vector.validate_vector_spec(entry, palette or {})
    except Exception:
        return None


def build_props(
    job_dir: Path,
    script: dict[str, Any],
    timeline: dict[str, Any],
    request: dict[str, Any],
) -> Path:
    """Merge timeline.json (frames/cues) with script.json visual fields + style tokens."""
    style_id = str(request.get("styleId") or "look-1").strip()
    preset = get_style_preset(style_id)
    tokens = preset.get("tokens") or {}

    script_scenes = script.get("scenes") or []
    by_id: dict[str, dict[str, Any]] = {
        str(s.get("id")): s for s in script_scenes if isinstance(s, dict) and s.get("id")
    }

    merged_scenes: list[dict[str, Any]] = []
    tl_scenes = timeline.get("scenes") or []
    for idx, tl_sc in enumerate(tl_scenes):
        sid = str(tl_sc.get("id") or "")
        sc_src = by_id.get(sid) or (script_scenes[idx] if idx < len(script_scenes) else {})
        merged = {**sc_src, **tl_sc}
        # Prefer script.json editorial text & visual fields in case user edited them without changing narration
        for k in (
            "badge",
            "title",
            "subtitle",
            "visual",
            "bullets",
            "stat",
            "steps",
            "compare",
            "quote",
            "icon",
            "highlightWord",
            "highlight",
            "direction",
        ):
            if k in sc_src and sc_src[k] is not None:
                merged[k] = sc_src[k]
        if isinstance(merged.get("visual"), str):
            merged["visual"] = VISUAL_ALIASES.get(merged["visual"].lower(), merged["visual"].lower())
        if merged.get("highlightWord") and not merged.get("highlight"):
            merged["highlight"] = merged["highlightWord"]
        if isinstance(merged.get("steps"), list):
            merged["steps"] = [
                {
                    "step": str(it.get("step") or f"{i:02d}"),
                    "title": str(it.get("title") or it.get("label") or ""),
                    **({"detail": str(it["detail"])} if it.get("detail") else {}),
                }
                if isinstance(it, dict)
                else it
                for i, it in enumerate(merged["steps"], 1)
            ]
        art = scene_art_for(job_dir, str(merged.get("id") or ""))
        if art:
            if isinstance(art.get("src"), str):
                art["src"] = _trim_scene_art_png(art["src"])
            merged["art"] = art
        else:
            merged.pop("art", None)
        vec = scene_vector_for(
            job_dir,
            str(merged.get("id") or ""),
            palette=tokens.get("palette") if isinstance(tokens, dict) else None,
        )
        if vec:
            merged["vector"] = vec
        else:
            merged.pop("vector", None)
        merged_scenes.append(merged)

    fps = int(timeline.get("fps") or script.get("fps") or 30)
    total_sec = float(timeline.get("totalSec") or 20.0)
    total_frames = int(timeline.get("totalFrames") or max(90, round(total_sec * fps)))

    props = {
        "title": str(script.get("title") or timeline.get("title") or ""),
        "fps": fps,
        "width": int(timeline.get("width") or script.get("width") or 1080),
        "height": int(timeline.get("height") or script.get("height") or 1920),
        "totalSec": total_sec,
        "totalFrames": total_frames,
        "styleId": style_id,
        "styleName": preset.get("thName") or preset.get("enName") or style_id,
        "tokens": tokens,
        "style": tokens,
        "scenes": merged_scenes,
        "cues": timeline.get("cues") or [],
    }
    props_path = job_dir / "props.json"
    atomic_write_json(props_path, props)
    append_log(job_dir, f"Built props.json: totalFrames={total_frames} fps={fps} scenes={len(merged_scenes)} style={style_id}")
    return props_path


def run_render_stage(job_dir: Path, props_path: Path, out_mp4: Path) -> None:
    """Run motion-studio render StudioEngine and stream % progress (40..85)."""
    write_status(job_dir, status="rendering", stage="rendering", progress=40, message="กำลังเรนเดอร์วิดีโอ...")
    cmd = [
        MOTION_STUDIO_BIN,
        "render",
        "StudioEngine",
        "-o",
        str(out_mp4),
        "--props",
        str(props_path),
        "--concurrency",
        "2",
    ]
    append_log(job_dir, f"Running render: {' '.join(cmd)}")
    proc = subprocess.Popen(
        cmd,
        cwd=str(BASE_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        start_new_session=True,
    )
    _active_procs.add(proc)
    last_progress = 40
    last_write_ts = time.monotonic()
    tail_lines: list[str] = []
    pct_re = re.compile(r"(\d{1,3})%")
    frac_re = re.compile(r"Rendered\s+(\d+)\s*/\s*(\d+)", re.I)

    try:
        assert proc.stdout is not None
        buf = ""
        while True:
            ch = proc.stdout.read(1)
            if not ch:
                break
            if ch in ("\r", "\n"):
                line = buf.strip()
                buf = ""
                if not line:
                    continue
                tail_lines.append(line)
                if len(tail_lines) > 40:
                    tail_lines.pop(0)

                pct: float | None = None
                m_frac = frac_re.search(line)
                if m_frac:
                    cur, tot = int(m_frac.group(1)), max(1, int(m_frac.group(2)))
                    pct = min(100.0, (cur / tot) * 100.0)
                else:
                    m_pct = pct_re.findall(line)
                    if m_pct:
                        val = int(m_pct[-1])
                        if 0 <= val <= 100:
                            pct = float(val)

                if pct is not None:
                    mapped = 40 + int(round(pct * 0.45))
                    mapped = clamp(mapped, 40, 85)
                    now_t = time.monotonic()
                    if mapped >= last_progress + 2 or (mapped > last_progress and now_t - last_write_ts >= 1.5):
                        last_progress = mapped
                        last_write_ts = now_t
                        write_status(
                            job_dir,
                            status="rendering",
                            stage="rendering",
                            progress=mapped,
                            message=f"กำลังเรนเดอร์วิดีโอ ({int(round(pct))}%)",
                        )
            else:
                buf += ch

        rc = proc.wait()
    finally:
        _active_procs.discard(proc)

    if rc != 0 or not out_mp4.exists():
        err_tail = " | ".join(tail_lines[-5:]) if tail_lines else f"render exited {rc}"
        append_log(job_dir, f"Render failed (rc={rc}): {err_tail}")
        raise RuntimeError(f"เรนเดอร์วิดีโอไม่สำเร็จ: {err_tail[:240]}")
    write_status(job_dir, status="rendering", stage="rendering", progress=85)
    append_log(job_dir, f"Render finished: {out_mp4} ({out_mp4.stat().st_size} bytes)")


def run_mix_stage(
    job_dir: Path,
    render_mp4: Path,
    timeline_path: Path,
    final_mp4: Path,
    bgm: str,
    bgm_vol: float | None = None,
    duck_db: float | None = None,
) -> None:
    write_status(job_dir, status="mixing", stage="mixing", progress=87, message="กำลังผสมเสียงพากย์ ดนตรี และเอฟเฟกต์...")
    if bgm not in VALID_BGMS and not Path(bgm).exists():
        bgm = "warm_tech"
    cmd = [
        "nice",
        "-n",
        "15",
        MOTION_STUDIO_BIN,
        "mix",
        str(render_mp4),
        str(timeline_path),
        "-o",
        str(final_mp4),
        "--bgm",
        bgm,
    ]
    if bgm_vol is not None:
        cmd.extend(["--bgm-vol", f"{bgm_vol:.3f}"])
    if duck_db is not None:
        cmd.extend(["--duck-db", f"{duck_db:.1f}"])
    append_log(
        job_dir,
        f"Running mix: bgm={bgm}"
        + (f", bgm_vol={bgm_vol:.3f}" if bgm_vol is not None else "")
        + (f", duck_db={duck_db:.1f}" if duck_db is not None else ""),
    )
    rc, stdout, stderr = _run_subprocess(
        cmd,
        cwd=BASE_DIR,
        env={**os.environ, "OMP_NUM_THREADS": "2"},
        timeout=300,
    )
    if rc != 0 or not final_mp4.exists():
        err = (stderr or stdout or f"mix exited {rc}").strip()
        append_log(job_dir, f"Mix failed: {err}")
        raise RuntimeError(f"ผสมเสียงไม่สำเร็จ: {err.splitlines()[-1][:200]}")
    write_status(job_dir, status="mixing", stage="mixing", progress=90)
    append_log(job_dir, f"Mix finished: {final_mp4} ({final_mp4.stat().st_size} bytes)")


def run_preview_stage(job_dir: Path, video_mp4: Path, timeline_path: Path | None) -> dict[str, str]:
    write_status(job_dir, status="preview", stage="preview", progress=92, message="กำลังสร้างภาพตัวอย่างและ Storyboard...")
    preview_dir = job_dir / "preview"
    preview_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "nice",
        "-n",
        "15",
        MOTION_STUDIO_BIN,
        "preview",
        str(video_mp4),
        "-o",
        str(preview_dir),
        "--prefix",
        "preview",
    ]
    if timeline_path and timeline_path.exists():
        cmd.extend(["--timeline", str(timeline_path)])
    rc, stdout, stderr = _run_subprocess(
        cmd,
        cwd=BASE_DIR,
        env={**os.environ, "OMP_NUM_THREADS": "2"},
        timeout=180,
    )
    if rc != 0:
        err = (stderr or stdout or f"preview exited {rc}").strip()
        append_log(job_dir, f"Preview warning (non-fatal): {err}")
        return {}
    sb = preview_dir / "preview_storyboard.png"
    gif = preview_dir / "preview_preview.gif"
    res: dict[str, str] = {}
    if sb.exists():
        res["storyboardFile"] = "preview/preview_storyboard.png"
        res["storyboardPath"] = str(sb)
    if gif.exists():
        res["gifFile"] = "preview/preview_preview.gif"
        res["gifPath"] = str(gif)
    append_log(job_dir, f"Preview generated: {list(res.keys())}")
    return res


def probe_duration(video_path: Path) -> float:
    rc, stdout, _stderr = _run_subprocess(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ],
        timeout=30,
    )
    if rc == 0:
        try:
            return round(float(stdout.strip()), 3)
        except ValueError:
            pass
    return 0.0


def copy_to_videos_dir(src_mp4: Path, dest_name: str) -> Path:
    OUTPUT_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    dest = OUTPUT_VIDEOS_DIR / dest_name
    tmp = OUTPUT_VIDEOS_DIR / f".{dest_name}.tmp.{os.getpid()}"
    shutil.copy2(src_mp4, tmp)
    os.replace(tmp, dest)
    return dest


def copy_preview_to_videos_dir(
    job_dir: Path,
    preview_info: dict[str, str],
    stem: str,
) -> dict[str, str]:
    """Copy preview storyboard PNG and preview GIF to OUTPUT_VIDEOS_DIR as <stem>_storyboard.png / <stem>_preview.gif."""
    copied: dict[str, str] = {}
    sb_raw = preview_info.get("storyboardPath")
    if sb_raw:
        sb_src = Path(sb_raw)
        if sb_src.exists():
            sb_dest = copy_to_videos_dir(sb_src, f"{stem}_storyboard.png")
            copied["storyboardOutPath"] = str(sb_dest)
            append_log(job_dir, f"Copied storyboard to {sb_dest}")
    gif_raw = preview_info.get("gifPath")
    if gif_raw:
        gif_src = Path(gif_raw)
        if gif_src.exists():
            gif_dest = copy_to_videos_dir(gif_src, f"{stem}_preview.gif")
            copied["gifOutPath"] = str(gif_dest)
            append_log(job_dir, f"Copied preview GIF to {gif_dest}")
    return copied


def maybe_send_telegram(job_dir: Path, video_path: Path, caption: str, enabled: bool) -> tuple[bool, str | None]:
    if not enabled:
        return False, None
    write_status(job_dir, status="delivering", stage="delivering", progress=97, message="กำลังส่งวิดีโอเข้า Telegram...")
    cmd = [MOTION_STUDIO_BIN, "send-telegram", str(video_path), caption]
    append_log(job_dir, f"Sending video to Telegram: {video_path.name}")
    rc, stdout, stderr = _run_subprocess(cmd, cwd=BASE_DIR, timeout=240)
    if rc != 0:
        err = (stderr or stdout or f"send-telegram exited {rc}").strip()
        append_log(job_dir, f"Telegram send failed (non-fatal): {err}")
        return False, err.splitlines()[-1][:200]
    append_log(job_dir, "Telegram delivery succeeded.")
    return True, None


def _next_version_number(job_dir: Path) -> int:
    job = read_json(job_dir / "job.json", {}) or {}
    versions = job.get("versions") if isinstance(job, dict) else []
    max_v = 1 if (job_dir / "final.mp4").exists() else 0
    if isinstance(versions, list):
        for v in versions:
            if isinstance(v, dict):
                try:
                    max_v = max(max_v, int(v.get("version", 0)))
                except (TypeError, ValueError):
                    pass
    return max_v + 1


def _latest_video_path(job_dir: Path) -> Path:
    job = read_json(job_dir / "job.json", {}) or {}
    versions = job.get("versions") if isinstance(job, dict) else []
    if isinstance(versions, list) and versions:
        last = versions[-1]
        if isinstance(last, dict) and last.get("file"):
            cand = job_dir / str(last["file"])
            if cand.exists():
                return cand
    cand = job_dir / "final.mp4"
    if cand.exists():
        return cand
    raise FileNotFoundError("ไม่พบไฟล์วิดีโอต้นฉบับ (final.mp4) กรุณาสร้างวิดีโอก่อนตัดต่อ")


def _latest_render_path(job_dir: Path) -> Path:
    best_v = -1
    best_path: Path | None = None
    for p in job_dir.glob("render_v*.mp4"):
        m = re.fullmatch(r"render_v(\d+)\.mp4", p.name)
        if m:
            v = int(m.group(1))
            if v > best_v:
                best_v = v
                best_path = p
    if best_path is not None and best_path.exists():
        return best_path
    cand = job_dir / "render.mp4"
    if cand.exists():
        return cand
    raise RuntimeError("ไม่พบไฟล์วิดีโอที่เรนเดอร์ไว้ (render.mp4) กรุณาสร้างวิดีโอก่อนผสมเสียงใหม่")


def stage_build(job_dir: Path, *, as_new_version: bool = False, edit_scene_id: str | None = None) -> dict[str, Any]:
    """Run build pipeline (or edit-scene rebuild as final_v{N}.mp4)."""
    request = read_json(job_dir / "request.json", {}) or {}
    script = read_json(job_dir / "script.json")
    if not isinstance(script, dict):
        raise FileNotFoundError("ไม่พบไฟล์ script.json กรุณาร่างบทก่อนสั่งสร้างวิดีโอ")
    ok, errs = validate_script(script)
    if not ok:
        raise ValueError(f"ไฟล์ script.json ไม่ถูกต้อง: {'; '.join(errs)}")

    style_id = str(request.get("styleId") or "look-1").strip()
    preset = get_style_preset(style_id)
    bgm = str(request.get("bgm") or preset.get("defaultBgm") or "warm_tech").strip()
    slug = safe_slug(job_dir.name)
    title = str(script.get("title") or request.get("topic") or job_dir.name)

    with acquire_render_lock(job_dir):
        ledger_start = credit_ledger.count_ledger_lines()
        timeline = run_tts_stage(job_dir, script)
        if not as_new_version:
            script, timeline = maybe_shorten_after_tts(job_dir, script, timeline, request)
        timeline_path = job_dir / "work" / "timeline.json"
        run_scene_art_step(job_dir, script, request)
        run_scene_vector_step(job_dir, script, request)
        props_path = build_props(job_dir, script, timeline, request)

        delta = credit_ledger.summarize_ledger_slice(ledger_start)
        credit_summary = credit_ledger.get_credit_summary()
        tl_cost = timeline.get("ttsCost") if isinstance(timeline, dict) and isinstance(timeline.get("ttsCost"), dict) else {}
        voice_name = str(script.get("voice") or timeline.get("voice") or "")
        cost_thb = round(float(delta.get("costThb") or 0.0), 2)
        cost_usd = round(float(delta.get("costUsd") or 0.0), 4)
        clip_total_thb = round(float(tl_cost.get("clipTotalThb") if tl_cost.get("clipTotalThb") is not None else cost_thb), 2)
        rem_thb = credit_summary.get("remainingThb") if credit_summary.get("ok") else None
        low_thb = float(credit_summary.get("lowThb") if credit_summary.get("lowThb") is not None else 10.0)
        is_low_credit = bool(credit_summary.get("isLow")) if credit_summary.get("ok") else False

        if delta.get("calls", 0) > 0 and credit_summary.get("ok"):
            alert_res = credit_ledger.maybe_send_low_credit_alert(credit_summary, source=f"video-studio:{job_dir.name}")
            if alert_res.get("alerted"):
                append_log(job_dir, f"Low Gemini credit Telegram alert sent (remaining=฿{rem_thb:.2f} < ฿{low_thb:.0f})")

        cost_details = {
            "costThb": cost_thb,
            "costUsd": cost_usd,
            "clipTotalThb": clip_total_thb,
            "apiCalls": int(delta.get("calls") or 0),
            "cachedScenes": int(tl_cost.get("cachedScenes") or 0),
            "inputTokens": int(delta.get("inputTokens") or 0),
            "outputTokens": int(delta.get("outputTokens") or 0),
            "thoughtsTokens": int(delta.get("thoughtsTokens") or 0),
            "voice": voice_name,
            "engine": str(tl_cost.get("engine") or ("gemini" if voice_name.startswith("gemini:") else "edge-tts")),
            "remainingThb": rem_thb,
            "lowThb": low_thb,
            "isLowCredit": is_low_credit,
        }
        append_log(
            job_dir,
            f"TTS cost: this_build=฿{cost_thb:.2f} (${cost_usd:.4f}, calls={cost_details['apiCalls']}), "
            f"clip_total=฿{clip_total_thb:.2f}, remaining=~฿{rem_thb if rem_thb is not None else '?'}",
        )

        if as_new_version and (job_dir / "final.mp4").exists():
            ver = _next_version_number(job_dir)
            render_mp4 = job_dir / f"render_v{ver}.mp4"
            final_mp4 = job_dir / f"final_v{ver}.mp4"
            dest_name = f"{slug}_v{ver}.mp4"
            kind = f"edit-scene:{edit_scene_id}" if edit_scene_id else "edit-scene"
        else:
            ver = 1
            render_mp4 = job_dir / "render.mp4"
            final_mp4 = job_dir / "final.mp4"
            dest_name = f"{slug}.mp4"
            kind = "build"

        run_render_stage(job_dir, props_path, render_mp4)
        run_mix_stage(job_dir, render_mp4, timeline_path, final_mp4, bgm)
        preview_info = run_preview_stage(job_dir, final_mp4, timeline_path)
        preview_out = copy_preview_to_videos_dir(job_dir, preview_info, Path(dest_name).stem)

        master_copy = copy_to_videos_dir(final_mp4, dest_name)
        append_log(job_dir, f"Copied master video to {master_copy}")

        send_tg = bool(request.get("sendTelegram", True)) and not as_new_version
        if cost_thb > 0:
            cost_line = f"💸 ค่าเสียงพากย์คลิปนี้: ฿{cost_thb:.2f}"
        elif voice_name.startswith("gemini:") and clip_total_thb > 0:
            cost_line = f"💸 ค่าเสียงรอบนี้: ฿0.00 (แคช · รวมทั้งคลิป ฿{clip_total_thb:.2f})"
        else:
            cost_line = "💸 ค่าเสียงพากย์คลิปนี้: ฿0.00 (ฟรี)"
        rem_line = f" · เครดิตคงเหลือ ~฿{rem_thb:.2f}" if rem_thb is not None else ""
        low_line = f"\n⚠️ เครดิต Gemini API ใกล้หมด (ต่ำกว่า ฿{low_thb:.0f})!" if is_low_credit else ""
        tg_caption = f"{title}\n{cost_line}{rem_line}{low_line}"
        tg_ok, tg_err = maybe_send_telegram(job_dir, master_copy, tg_caption, send_tg)

        dur = probe_duration(final_mp4) or float(timeline.get("totalSec") or 0.0)
        size_bytes = master_copy.stat().st_size

        outputs: dict[str, Any] = {
            "videoPath": str(master_copy),
            "jobVideoFile": final_mp4.name,
            "watchUrl": make_watch_url(master_copy),
            "downloadUrl": make_download_url(master_copy),
            "durationSec": dur,
            "sizeBytes": size_bytes,
            "telegramSent": tg_ok,
            "costThb": cost_thb,
            "costUsd": cost_usd,
            "costDetails": cost_details,
            **preview_info,
            **preview_out,
        }
        if tg_err:
            outputs["telegramError"] = tg_err

        job = read_json(job_dir / "job.json", {}) or {}
        versions = list(job.get("versions") or [])
        version_entry: dict[str, Any] = {
            "version": ver,
            "kind": kind,
            "file": final_mp4.name,
            "videoPath": str(master_copy),
            "watchUrl": make_watch_url(master_copy),
            "downloadUrl": make_download_url(master_copy),
            "durationSec": dur,
            "sizeBytes": size_bytes,
            "costThb": cost_thb,
            "costUsd": cost_usd,
            "costDetails": cost_details,
            "createdAt": now_iso(),
            **preview_out,
        }
        if ver == 1:
            versions = [v for v in versions if v.get("version") != 1]
            versions.insert(0, version_entry)
        else:
            versions.append(version_entry)

        done_msg = f"สร้างวิดีโอเสร็จสมบูรณ์ · ค่าใช้จ่าย ฿{cost_thb:.2f}"
        if rem_thb is not None:
            done_msg += f" (คงเหลือ ~฿{rem_thb:.2f})"
        return write_status(
            job_dir,
            status="done",
            stage="done",
            progress=100,
            title=title,
            outputs=outputs,
            versions=versions,
            error=None,
            message=done_msg,
        )


def stage_trim(job_dir: Path, start_sec: float, end_sec: float) -> dict[str, Any]:
    """Trim active video to [start_sec, end_sec] into final_v{N}.mp4 without overwriting original."""
    src_mp4 = _latest_video_path(job_dir)
    total_dur = probe_duration(src_mp4)
    if start_sec < 0 or end_sec <= start_sec:
        raise ValueError(f"ช่วงเวลา trim ไม่ถูกต้อง (start={start_sec}, end={end_sec})")
    if total_dur > 0 and start_sec >= total_dur:
        raise ValueError(f"เวลาเริ่มต้น ({start_sec}s) เกินความยาววิดีโอ ({total_dur}s)")
    clamped_end = min(end_sec, total_dur) if total_dur > 0 else end_sec

    ver = _next_version_number(job_dir)
    out_mp4 = job_dir / f"final_v{ver}.mp4"
    slug = safe_slug(job_dir.name)

    write_status(job_dir, status="editing", stage="trim", progress=50, message=f"กำลังตัดหัวท้าย ({start_sec:.2f}s–{clamped_end:.2f}s)...")
    append_log(job_dir, f"Trimming {src_mp4.name} [{start_sec:.3f}, {clamped_end:.3f}] -> {out_mp4.name}")

    argv = [
        "-ss",
        f"{start_sec:.3f}",
        "-to",
        f"{clamped_end:.3f}",
        "-i",
        str(src_mp4),
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
    ]
    offload_rc = _offload_ffmpeg(
        job_dir,
        argv,
        [src_mp4],
        out_mp4,
        label="trim",
        stage="trim",
        timeout_sec=600,
        status_msg="กำลังตัดต่อบนเครื่องลูกข่าย...",
        progress=50,
    )
    if offload_rc != 0 or not out_mp4.exists():
        reason = "no worker node online (rc=3)" if offload_rc == 3 else f"offload rc={offload_rc}"
        append_log(job_dir, f"Trim offload fallback to local throttled ffmpeg ({reason})")
        cmd = ["nice", "-n", "15", "ffmpeg", "-y", "-v", "error", *argv, "-threads", "2", str(out_mp4)]
        rc, stdout, stderr = _run_subprocess(cmd, timeout=300)
        if rc != 0 or not out_mp4.exists():
            err = (stderr or stdout or f"ffmpeg trim exited {rc}").strip()
            raise RuntimeError(f"ตัดหัวท้ายวิดีโอไม่สำเร็จ: {err.splitlines()[-1][:200]}")

    return _finalize_edit_version(job_dir, out_mp4, ver, f"trim:{start_sec:.2f}-{clamped_end:.2f}", f"{slug}_v{ver}.mp4")


def stage_cut(job_dir: Path, cut_from: float, cut_to: float) -> dict[str, Any]:
    """Cut out middle segment [cut_from, cut_to] into final_v{N}.mp4 without overwriting original."""
    src_mp4 = _latest_video_path(job_dir)
    total_dur = probe_duration(src_mp4)
    if total_dur <= 0:
        raise RuntimeError("ไม่สามารถอ่านความยาวของวิดีโอต้นฉบับได้")
    if cut_from < 0 or cut_to <= cut_from or cut_from >= total_dur:
        raise ValueError(f"ช่วงเวลา cut ไม่ถูกต้อง (from={cut_from}, to={cut_to}, duration={total_dur})")
    cut_to = min(cut_to, total_dur)
    if cut_from <= 0.05 and cut_to >= total_dur - 0.05:
        raise ValueError("ไม่สามารถตัดวิดีโอออกทั้งหมดได้")

    ver = _next_version_number(job_dir)
    out_mp4 = job_dir / f"final_v{ver}.mp4"
    slug = safe_slug(job_dir.name)

    write_status(job_dir, status="editing", stage="cut", progress=50, message=f"กำลังตัดช่วงกลาง ({cut_from:.2f}s–{cut_to:.2f}s)...")
    append_log(job_dir, f"Cutting {src_mp4.name} out [{cut_from:.3f}, {cut_to:.3f}] (dur={total_dur:.3f}) -> {out_mp4.name}")

    if cut_from <= 0.05:
        # Cut from start -> keep [cut_to, end]
        argv = [
            "-ss", f"{cut_to:.3f}", "-i", str(src_mp4),
            "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        ]
    elif cut_to >= total_dur - 0.05:
        # Cut to end -> keep [0, cut_from]
        argv = [
            "-to", f"{cut_from:.3f}", "-i", str(src_mp4),
            "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        ]
    else:
        filter_complex = (
            f"[0:v]trim=start=0:end={cut_from:.3f},setpts=PTS-STARTPTS[v0];"
            f"[0:a]atrim=start=0:end={cut_from:.3f},asetpts=PTS-STARTPTS[a0];"
            f"[0:v]trim=start={cut_to:.3f},setpts=PTS-STARTPTS[v1];"
            f"[0:a]atrim=start={cut_to:.3f},asetpts=PTS-STARTPTS[a1];"
            f"[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]"
        )
        argv = [
            "-i", str(src_mp4),
            "-filter_complex", filter_complex,
            "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        ]

    offload_rc = _offload_ffmpeg(
        job_dir,
        argv,
        [src_mp4],
        out_mp4,
        label="cut",
        stage="cut",
        timeout_sec=600,
        status_msg="กำลังตัดต่อบนเครื่องลูกข่าย...",
        progress=50,
    )
    if offload_rc != 0 or not out_mp4.exists():
        reason = "no worker node online (rc=3)" if offload_rc == 3 else f"offload rc={offload_rc}"
        append_log(job_dir, f"Cut offload fallback to local throttled ffmpeg ({reason})")
        cmd = ["nice", "-n", "15", "ffmpeg", "-y", "-v", "error", *argv, "-threads", "2", str(out_mp4)]
        rc, stdout, stderr = _run_subprocess(cmd, timeout=300)
        if rc != 0 or not out_mp4.exists():
            err = (stderr or stdout or f"ffmpeg cut exited {rc}").strip()
            raise RuntimeError(f"ตัดท่อนกลางวิดีโอไม่สำเร็จ: {err.splitlines()[-1][:200]}")

    return _finalize_edit_version(job_dir, out_mp4, ver, f"cut:{cut_from:.2f}-{cut_to:.2f}", f"{slug}_v{ver}.mp4")


def stage_remix(job_dir: Path, bgm: str, bgm_vol: float, duck_db: float) -> dict[str, Any]:
    """Re-mix latest rendered silent video with new BGM/volume/ducking settings into final_v{N}.mp4."""
    if bgm not in VALID_BGMS and not Path(bgm).exists():
        bgm = "warm_tech"
    src_mp4 = _latest_render_path(job_dir)
    timeline_path = job_dir / "work" / "timeline.json"
    if not timeline_path.exists():
        raise RuntimeError("ไม่พบไฟล์ work/timeline.json กรุณาสร้างวิดีโอก่อนผสมเสียงใหม่")

    ver = _next_version_number(job_dir)
    out_mp4 = job_dir / f"final_v{ver}.mp4"
    slug = safe_slug(job_dir.name)

    with acquire_render_lock(job_dir):
        write_status(
            job_dir,
            status="mixing",
            stage="remix",
            progress=30,
            bgm=bgm,
            message=f"กำลังผสมเสียงใหม่ (BGM {bgm})...",
        )
        append_log(
            job_dir,
            f"Remixing {src_mp4.name} + {timeline_path.name} -> {out_mp4.name} "
            f"(bgm={bgm}, bgm_vol={bgm_vol:.3f}, duck_db={duck_db:.1f})",
        )
        run_mix_stage(job_dir, src_mp4, timeline_path, out_mp4, bgm, bgm_vol=bgm_vol, duck_db=duck_db)

        req_path = job_dir / "request.json"
        req = read_json(req_path, {})
        if not isinstance(req, dict):
            req = {}
        req["bgm"] = bgm
        atomic_write_json(req_path, req)

        return _finalize_edit_version(job_dir, out_mp4, ver, "remix", f"{slug}_v{ver}.mp4")


# ---------------------------------------------------------------------------
# Multi-track Video Editor Export (EDL -> FFmpeg filter_complex)
# ---------------------------------------------------------------------------

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
_DRAWTEXT_AVAILABLE: bool | None = None
_THAI_FONT_PATH: str | None = None


def _ffmpeg_has_drawtext() -> bool:
    global _DRAWTEXT_AVAILABLE
    if _DRAWTEXT_AVAILABLE is not None:
        return _DRAWTEXT_AVAILABLE
    try:
        rc, stdout, _stderr = _run_subprocess(["ffmpeg", "-hide_banner", "-filters"], timeout=15)
        _DRAWTEXT_AVAILABLE = rc == 0 and bool(re.search(r"\bdrawtext\b", stdout))
    except Exception:
        _DRAWTEXT_AVAILABLE = False
    return _DRAWTEXT_AVAILABLE


def _find_thai_font() -> str:
    global _THAI_FONT_PATH
    if _THAI_FONT_PATH is not None:
        return _THAI_FONT_PATH
    candidates: list[str] = []
    try:
        rc, stdout, _stderr = _run_subprocess(["fc-list", ":lang=th", "file"], timeout=15)
        if rc == 0:
            for line in stdout.splitlines():
                p = line.split(":", 1)[0].strip()
                if p and p.lower().endswith((".ttf", ".otf")) and Path(p).exists():
                    candidates.append(p)
    except Exception:
        pass

    preferred = ("NotoLoopedThai-Bold", "NotoSansThai-Bold", "NotoSansThai", "Waree-Bold", "Kinnari-Bold")
    chosen = ""
    for pref in preferred:
        for c in candidates:
            if pref.lower() in Path(c).name.lower():
                chosen = c
                break
        if chosen:
            break
    if not chosen and candidates:
        chosen = candidates[0]
    _THAI_FONT_PATH = chosen
    return chosen


def _escape_drawtext_path(path_str: str) -> str:
    """Escape path for ffmpeg drawtext option value (single-quoted)."""
    return path_str.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def _build_atempo_chain(speed: float) -> str:
    """Split arbitrary playback speed into valid ffmpeg atempo filters in [0.5, 2.0]."""
    if abs(speed - 1.0) < 0.001:
        return ""
    parts: list[str] = []
    s = max(0.1, min(16.0, float(speed)))
    while s > 2.0:
        parts.append("atempo=2.0")
        s /= 2.0
    while s < 0.5:
        parts.append("atempo=0.5")
        s /= 0.5
    if abs(s - 1.0) >= 0.001:
        parts.append(f"atempo={s:.6f}")
    return ",".join(parts)


def _has_audio_stream(media_path: Path, cache: dict[Path, bool]) -> bool:
    if media_path in cache:
        return cache[media_path]
    if media_path.suffix.lower() in _IMAGE_EXTS:
        cache[media_path] = False
        return False
    try:
        rc, stdout, _stderr = _run_subprocess(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(media_path),
            ],
            timeout=20,
        )
        has_a = rc == 0 and bool(stdout.strip())
    except Exception:
        has_a = False
    cache[media_path] = has_a
    return has_a


def resolve_editor_src(job_dir: Path, src: Any) -> Path:
    """Resolve an editor clip src descriptor into a safe, existing local Path."""
    if not isinstance(src, dict):
        raise ValueError("ข้อมูลแหล่งสื่อ (src) ไม่ถูกต้อง")
    src_type = str(src.get("type") or "").strip().lower()

    if src_type == "render":
        return _latest_render_path(job_dir)

    if src_type == "final":
        return _latest_video_path(job_dir)

    if src_type == "narration":
        tl_path = job_dir / "timeline.json"
        if not tl_path.exists():
            tl_path = job_dir / "work" / "timeline.json"
        tl = read_json(tl_path, None)
        if not isinstance(tl, dict) or not tl.get("narrationPath"):
            raise FileNotFoundError("ไม่พบไฟล์เสียงพากย์ (narrationPath) ใน timeline.json")
        narr = Path(str(tl["narrationPath"]))
        if not narr.is_absolute():
            narr = (job_dir / narr).resolve()
        if not narr.exists():
            raise FileNotFoundError(f"ไม่พบไฟล์เสียงพากย์: {narr}")
        return narr

    if src_type == "bgm":
        name = str(src.get("name") or "").strip()
        if not name or name.lower() == "none":
            raise ValueError("ไม่ได้ระบุชื่อเพลงประกอบ (BGM)")
        safe_name = Path(name).name
        if safe_name != name or "/" in name or "\\" in name or ".." in name:
            raise ValueError(f"ชื่อเพลงประกอบไม่ถูกต้อง: {name}")
        cand = AUDIO_ASSETS_DIR / (safe_name if safe_name.startswith("bgm_") and safe_name.endswith(".wav") else f"bgm_{safe_name}.wav")
        if not cand.exists():
            raise FileNotFoundError(f"ไม่พบไฟล์เพลงประกอบ: {name}")
        return cand

    if src_type == "sfx":
        name = str(src.get("name") or "").strip()
        if not name:
            raise ValueError("ไม่ได้ระบุชื่อเอฟเฟกต์เสียง (SFX)")
        safe_name = Path(name).name
        if safe_name != name or "/" in name or "\\" in name or ".." in name:
            raise ValueError(f"ชื่อเอฟเฟกต์เสียงไม่ถูกต้อง: {name}")
        cand = AUDIO_ASSETS_DIR / (safe_name if safe_name.startswith("sfx_") and safe_name.endswith(".wav") else f"sfx_{safe_name}.wav")
        if not cand.exists():
            raise FileNotFoundError(f"ไม่พบไฟล์เอฟเฟกต์เสียง: {name}")
        return cand

    if src_type == "jobasset":
        file_name = str(src.get("file") or "").strip()
        if not file_name:
            raise ValueError("ไม่ได้ระบุชื่อไฟล์สื่อในโปรเจกต์ (jobasset)")
        assets_root = (job_dir / "editor_assets").resolve()
        cand = (assets_root / file_name).resolve()
        if cand == assets_root or assets_root not in cand.parents:
            raise ValueError(f"พาธไฟล์ jobasset ไม่อยู่ในโฟลเดอร์ที่อนุญาต: {file_name}")
        if not cand.exists() or not cand.is_file():
            raise FileNotFoundError(f"ไม่พบไฟล์สื่อในโปรเจกต์: {file_name}")
        return cand

    raise ValueError(f"ไม่รู้จักชนิดแหล่งสื่อ (src.type): {src_type or '(ว่าง)'}")


def _clip_timeline_duration(clip: dict[str, Any], is_image_or_text: bool = False, src_path: Path | None = None) -> float:
    speed = max(0.1, min(16.0, float(clip.get("speed") or 1.0)))
    in_pt = max(0.0, float(clip.get("in") or 0.0))
    out_raw = clip.get("out")
    out_pt = float(out_raw) if out_raw is not None else 0.0
    if out_pt > in_pt:
        return (out_pt - in_pt) / (1.0 if is_image_or_text else speed)
    dur_raw = clip.get("duration")
    if dur_raw is not None and float(dur_raw) > 0:
        return float(dur_raw)
    end_raw = clip.get("end")
    start_pt = max(0.0, float(clip.get("start") or 0.0))
    if end_raw is not None and float(end_raw) > start_pt:
        return float(end_raw) - start_pt
    if src_path is not None and not is_image_or_text and src_path.exists():
        probed = probe_duration(src_path)
        if probed > in_pt:
            return (probed - in_pt) / speed
    return 3.0 if is_image_or_text else 0.0


def build_export_ffmpeg(job_dir: Path, project: dict[str, Any]) -> tuple[list[str], list[Path], float]:
    """Build ffmpeg arguments (excluding binary/global flags and output path), input list, and total duration."""
    if not isinstance(project, dict):
        raise ValueError("ข้อมูลโปรเจกต์ตัดต่อไม่ถูกต้อง")

    width = max(64, int(project.get("width") or 1080))
    height = max(64, int(project.get("height") or 1920))
    # Ensure even dimensions for yuv420p
    width = width - (width % 2)
    height = height - (height % 2)
    fps = max(1, min(120, int(round(float(project.get("fps") or 30)))))

    tracks = project.get("tracks")
    if not isinstance(tracks, list) or not tracks:
        raise ValueError("โปรเจกต์ไม่มีแทร็กสำหรับ Export")

    master = project.get("master") if isinstance(project.get("master"), dict) else {}
    master_vol = max(0.0, float(master.get("volume") if master.get("volume") is not None else 1.0))
    master_lufs = float(master.get("lufs") if master.get("lufs") is not None else -14.0)
    master_lufs = max(-36.0, min(-5.0, master_lufs))

    # Separate active tracks
    video_tracks: list[dict[str, Any]] = []
    text_tracks: list[dict[str, Any]] = []
    voice_tracks: list[dict[str, Any]] = []
    music_tracks: list[dict[str, Any]] = []
    sfx_tracks: list[dict[str, Any]] = []

    for tr in tracks:
        if not isinstance(tr, dict):
            continue
        kind = str(tr.get("kind") or "").strip().lower()
        clips = tr.get("clips")
        if not isinstance(clips, list) or not clips:
            continue
        if kind == "video":
            if not tr.get("hidden"):
                video_tracks.append(tr)
        elif kind == "text":
            if not tr.get("hidden"):
                text_tracks.append(tr)
        elif kind == "voice":
            if not tr.get("muted"):
                voice_tracks.append(tr)
        elif kind == "music":
            if not tr.get("muted"):
                music_tracks.append(tr)
        elif kind == "sfx":
            if not tr.get("muted"):
                sfx_tracks.append(tr)

    # First pass: compute total_sec across all active clips
    max_end = 0.0
    resolved_cache: dict[str, Path] = {}
    audio_stream_cache: dict[Path, bool] = {}

    def _resolve_cached(src_obj: Any) -> Path:
        key = json.dumps(src_obj, sort_keys=True, ensure_ascii=False)
        if key not in resolved_cache:
            resolved_cache[key] = resolve_editor_src(job_dir, src_obj)
        return resolved_cache[key]

    for tr in video_tracks + voice_tracks + music_tracks + sfx_tracks:
        for cl in tr.get("clips") or []:
            if not isinstance(cl, dict) or not cl.get("src"):
                continue
            sp = _resolve_cached(cl["src"])
            is_img = sp.suffix.lower() in _IMAGE_EXTS
            st = max(0.0, float(cl.get("start") or 0.0))
            dur = _clip_timeline_duration(cl, is_image_or_text=is_img, src_path=sp)
            if dur > 0:
                max_end = max(max_end, st + dur)

    for tr in text_tracks:
        for cl in tr.get("clips") or []:
            if not isinstance(cl, dict):
                continue
            st = max(0.0, float(cl.get("start") or 0.0))
            dur = _clip_timeline_duration(cl, is_image_or_text=True)
            if dur > 0:
                max_end = max(max_end, st + dur)

    total_sec = round(max_end, 3)
    if total_sec < 0.05:
        raise ValueError("โปรเจกต์ไม่มีคลิปที่มีความยาวมากกว่า 0 วินาทีสำหรับ Export")

    # Input management: keep exact 1-to-1 mapping between -i occurrences and `inputs` list
    input_args: list[str] = []
    inputs: list[Path] = []
    dedup_input_idx: dict[Path, int] = {}

    def add_media_input(path: Path) -> int:
        if path in dedup_input_idx:
            return dedup_input_idx[path]
        idx = len(inputs)
        inputs.append(path)
        input_args.extend(["-i", str(path)])
        dedup_input_idx[path] = idx
        return idx

    def add_image_input(path: Path, dur_sec: float) -> int:
        idx = len(inputs)
        inputs.append(path)
        input_args.extend(["-loop", "1", "-t", f"{max(0.05, dur_sec):.3f}", "-i", str(path)])
        return idx

    filter_parts: list[str] = []

    # ------------------------------------------------------------------
    # 1. Video tracks: main track (v1) + overlay tracks (v2+)
    # ------------------------------------------------------------------
    main_vtrack: dict[str, Any] | None = None
    overlay_vtracks: list[dict[str, Any]] = []
    for tr in video_tracks:
        if main_vtrack is None and (str(tr.get("id") or "") == "v1" or not overlay_vtracks):
            main_vtrack = tr
        else:
            overlay_vtracks.append(tr)

    # Extra audio clips from video tracks with volume > 0
    extra_audio_entries: list[tuple[dict[str, Any], Path, int]] = []

    v_cur_label = "vbase"
    if main_vtrack is not None:
        v1_clips = sorted(
            [c for c in (main_vtrack.get("clips") or []) if isinstance(c, dict) and c.get("src")],
            key=lambda c: float(c.get("start") or 0.0),
        )
        v1_segs: list[str] = []
        cursor = 0.0
        seg_idx = 0
        v1_track_muted = bool(main_vtrack.get("muted"))

        for cl in v1_clips:
            sp = _resolve_cached(cl["src"])
            is_img = sp.suffix.lower() in _IMAGE_EXTS
            raw_start = max(0.0, float(cl.get("start") or 0.0))
            in_pt = max(0.0, float(cl.get("in") or 0.0))
            speed = max(0.1, min(16.0, float(cl.get("speed") or 1.0)))
            dur = _clip_timeline_duration(cl, is_image_or_text=is_img, src_path=sp)
            if dur < 0.02:
                continue

            # If clip starts after cursor, fill gap with black
            if raw_start > cursor + 0.005:
                gap = raw_start - cursor
                lbl = f"vseg{seg_idx}"
                seg_idx += 1
                filter_parts.append(
                    f"color=c=black:s={width}x{height}:r={fps}:d={gap:.3f},format=yuv420p,setsar=1[{lbl}]"
                )
                v1_segs.append(f"[{lbl}]")
                cursor = raw_start
            elif raw_start < cursor - 0.005:
                # Trim overlapping head so timeline stays aligned
                overlap = cursor - raw_start
                if overlap >= dur - 0.02:
                    continue
                if not is_img:
                    in_pt += overlap * speed
                dur -= overlap

            lbl = f"vseg{seg_idx}"
            seg_idx += 1
            fade_in = max(0.0, float(cl.get("fadeIn") or 0.0))
            fade_out = max(0.0, float(cl.get("fadeOut") or 0.0))
            fade_str = ""
            if fade_in > 0:
                fade_str += f",fade=t=in:st=0:d={min(fade_in, dur):.3f}"
            if fade_out > 0:
                fade_str += f",fade=t=out:st={max(0.0, dur - fade_out):.3f}:d={min(fade_out, dur):.3f}"

            if is_img:
                idx = add_image_input(sp, dur)
                filter_parts.append(
                    f"[{idx}:v]trim=duration={dur:.3f},setpts=PTS-STARTPTS,"
                    f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                    f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,"
                    f"fps={fps},format=yuv420p,setsar=1{fade_str}[{lbl}]"
                )
            else:
                out_pt = in_pt + dur * speed
                idx = add_media_input(sp)
                filter_parts.append(
                    f"[{idx}:v]trim=start={in_pt:.3f}:end={out_pt:.3f},"
                    f"setpts=(PTS-STARTPTS)/{speed:.6f},"
                    f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                    f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,"
                    f"fps={fps},format=yuv420p,setsar=1{fade_str}[{lbl}]"
                )
                cl_vol = float(cl.get("volume") or 0.0)
                if not v1_track_muted and cl_vol > 0 and _has_audio_stream(sp, audio_stream_cache):
                    adj = dict(cl)
                    adj["start"] = cursor
                    adj["in"] = in_pt
                    adj["out"] = out_pt
                    extra_audio_entries.append((adj, sp, idx))

            v1_segs.append(f"[{lbl}]")
            cursor += dur

        if total_sec > cursor + 0.005:
            gap = total_sec - cursor
            lbl = f"vseg{seg_idx}"
            seg_idx += 1
            filter_parts.append(
                f"color=c=black:s={width}x{height}:r={fps}:d={gap:.3f},format=yuv420p,setsar=1[{lbl}]"
            )
            v1_segs.append(f"[{lbl}]")

        if not v1_segs:
            filter_parts.append(
                f"color=c=black:s={width}x{height}:r={fps}:d={total_sec:.3f},format=yuv420p,setsar=1[vbase]"
            )
        elif len(v1_segs) == 1:
            filter_parts.append(f"{v1_segs[0]}null[vbase]")
        else:
            filter_parts.append(f"{''.join(v1_segs)}concat=n={len(v1_segs)}:v=1:a=0[vbase]")
    else:
        filter_parts.append(
            f"color=c=black:s={width}x{height}:r={fps}:d={total_sec:.3f},format=yuv420p,setsar=1[vbase]"
        )

    # Overlay tracks (v2+)
    ov_idx = 0
    for tr in overlay_vtracks:
        tr_muted = bool(tr.get("muted"))
        for cl in sorted(
            [c for c in (tr.get("clips") or []) if isinstance(c, dict) and c.get("src")],
            key=lambda c: float(c.get("start") or 0.0),
        ):
            sp = _resolve_cached(cl["src"])
            is_img = sp.suffix.lower() in _IMAGE_EXTS
            start_pt = max(0.0, float(cl.get("start") or 0.0))
            in_pt = max(0.0, float(cl.get("in") or 0.0))
            speed = max(0.1, min(16.0, float(cl.get("speed") or 1.0)))
            dur = _clip_timeline_duration(cl, is_image_or_text=is_img, src_path=sp)
            if dur < 0.02:
                continue
            end_pt = start_pt + dur

            tf = cl.get("transform") if isinstance(cl.get("transform"), dict) else {}
            tx = float(tf.get("x") if tf.get("x") is not None else 0.5)
            ty = float(tf.get("y") if tf.get("y") is not None else 0.5)
            sc = max(0.05, min(5.0, float(tf.get("scale") if tf.get("scale") is not None else 1.0)))
            ow = max(2, int(round(width * sc / 2) * 2))
            oh = max(2, int(round(height * sc / 2) * 2))

            ov_lbl = f"ov{ov_idx}"
            next_v_lbl = f"vov{ov_idx}"
            ov_idx += 1

            if is_img:
                idx = add_image_input(sp, dur)
                filter_parts.append(
                    f"[{idx}:v]trim=duration={dur:.3f},setpts=PTS-STARTPTS+{start_pt:.3f}/TB,"
                    f"scale={ow}:{oh}:force_original_aspect_ratio=decrease,format=rgba[{ov_lbl}]"
                )
            else:
                out_pt = in_pt + dur * speed
                idx = add_media_input(sp)
                filter_parts.append(
                    f"[{idx}:v]trim=start={in_pt:.3f}:end={out_pt:.3f},"
                    f"setpts=(PTS-STARTPTS)/{speed:.6f}+{start_pt:.3f}/TB,"
                    f"scale={ow}:{oh}:force_original_aspect_ratio=decrease,fps={fps},format=rgba[{ov_lbl}]"
                )
                cl_vol = float(cl.get("volume") or 0.0)
                if not tr_muted and cl_vol > 0 and _has_audio_stream(sp, audio_stream_cache):
                    extra_audio_entries.append((cl, sp, idx))

            x_expr = f"({tx:.4f}*W-w/2)"
            y_expr = f"({ty:.4f}*H-h/2)"
            filter_parts.append(
                f"[{v_cur_label}][{ov_lbl}]overlay=x={x_expr}:y={y_expr}:"
                f"enable='between(t,{start_pt:.3f},{end_pt:.3f})':eof_action=pass[{next_v_lbl}]"
            )
            v_cur_label = next_v_lbl

    # ------------------------------------------------------------------
    # 2. Text tracks (drawtext + textfile under job_dir/editor_tmp)
    # ------------------------------------------------------------------
    has_text_clips = any(tr.get("clips") for tr in text_tracks)
    if has_text_clips:
        if not _ffmpeg_has_drawtext():
            append_log(job_dir, "Warning: ffmpeg lacks drawtext filter; skipping text clips.")
        else:
            tmp_dir = job_dir / "editor_tmp"
            tmp_dir.mkdir(parents=True, exist_ok=True)
            thai_font = _find_thai_font()
            txt_idx = 0
            for tr in text_tracks:
                for cl in tr.get("clips") or []:
                    if not isinstance(cl, dict):
                        continue
                    text_val = str(cl.get("text") if cl.get("text") is not None else cl.get("label") or "").strip()
                    if not text_val:
                        continue
                    start_pt = max(0.0, float(cl.get("start") or 0.0))
                    dur = _clip_timeline_duration(cl, is_image_or_text=True)
                    if dur < 0.02:
                        continue
                    end_pt = start_pt + dur

                    txt_file = tmp_dir / f"text_{txt_idx}.txt"
                    txt_file.write_text(text_val, encoding="utf-8")

                    style = cl.get("style") if isinstance(cl.get("style"), dict) else {}
                    font_size = int(cl.get("fontSize") or style.get("fontSize") or max(20, round(width * 0.055)))
                    font_size = max(12, min(300, font_size))
                    raw_color = str(cl.get("color") or style.get("color") or "#ffffff").strip()
                    color = raw_color if re.fullmatch(r"#[0-9a-fA-F]{6,8}|[a-zA-Z]+(@[0-9.]+)?", raw_color) else "white"
                    raw_bg = str(cl.get("bg") or cl.get("background") or style.get("bg") or "").strip()
                    box_opts = ""
                    if raw_bg and raw_bg.lower() not in ("none", "transparent"):
                        bg_col = raw_bg if re.fullmatch(r"#[0-9a-fA-F]{6,8}|[a-zA-Z]+(@[0-9.]+)?", raw_bg) else "black@0.55"
                        box_opts = f":box=1:boxcolor={bg_col}:boxborderw=10"

                    x_val = cl.get("x") if cl.get("x") is not None else style.get("x")
                    y_val = cl.get("y") if cl.get("y") is not None else style.get("y")
                    tx = float(x_val) if x_val is not None else 0.5
                    ty = float(y_val) if y_val is not None else 0.8
                    x_expr = f"(w*{tx:.4f}-text_w/2)"
                    y_expr = f"(h*{ty:.4f}-text_h/2)"

                    font_opt = f"fontfile='{_escape_drawtext_path(thai_font)}':" if thai_font else ""
                    next_v_lbl = f"vtxt{txt_idx}"
                    txt_idx += 1
                    filter_parts.append(
                        f"[{v_cur_label}]drawtext={font_opt}"
                        f"textfile='{_escape_drawtext_path(str(txt_file))}':"
                        f"fontsize={font_size}:fontcolor={color}:borderw=2:bordercolor=black@0.75{box_opts}:"
                        f"x={x_expr}:y={y_expr}:enable='between(t,{start_pt:.3f},{end_pt:.3f})'[{next_v_lbl}]"
                    )
                    v_cur_label = next_v_lbl

    # Ensure final video stream is yuv420p and capped at total_sec
    filter_parts.append(f"[{v_cur_label}]trim=duration={total_sec:.3f},setpts=PTS-STARTPTS,format=yuv420p[vout]")

    # ------------------------------------------------------------------
    # 3. Audio tracks: voice bus, sfx bus, music bus (+ sidechain ducking)
    # ------------------------------------------------------------------
    voice_labels: list[str] = []
    sfx_labels: list[str] = []
    music_labels: list[str] = []
    max_duck_db = 0.0
    a_clip_idx = 0

    def _add_audio_clip(cl: dict[str, Any], sp: Path, idx: int, *, is_music: bool = False) -> str | None:
        nonlocal a_clip_idx, max_duck_db
        vol = float(cl.get("volume") if cl.get("volume") is not None else (0.14 if is_music else 1.0))
        if vol <= 0.0:
            return None
        start_pt = max(0.0, float(cl.get("start") or 0.0))
        in_pt = max(0.0, float(cl.get("in") or 0.0))
        speed = max(0.1, min(16.0, float(cl.get("speed") or 1.0)))
        fade_in = max(0.0, float(cl.get("fadeIn") or 0.0))
        fade_out = max(0.0, float(cl.get("fadeOut") or 0.0))
        loop_flag = bool(cl.get("loop")) if is_music else False

        if is_music:
            duck_val = float(cl.get("duckDb") or 0.0)
            if duck_val > max_duck_db:
                max_duck_db = duck_val

        out_raw = cl.get("out")
        out_pt = float(out_raw) if out_raw is not None else 0.0
        if loop_flag:
            if out_pt > in_pt:
                clip_dur = (out_pt - in_pt) / speed
            elif cl.get("duration") and float(cl["duration"]) > 0:
                clip_dur = float(cl["duration"])
            else:
                clip_dur = max(0.05, total_sec - start_pt)
            chain = (
                f"[{idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,"
                f"aloop=loop=-1:size=2000000000,"
                f"atrim=start={in_pt:.3f}:duration={clip_dur * speed:.3f},asetpts=PTS-STARTPTS"
            )
        else:
            if out_pt <= in_pt:
                probed = probe_duration(sp)
                if probed <= in_pt:
                    return None
                out_pt = probed
            clip_dur = (out_pt - in_pt) / speed
            if clip_dur < 0.02:
                return None
            chain = (
                f"[{idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,"
                f"atrim=start={in_pt:.3f}:end={out_pt:.3f},asetpts=PTS-STARTPTS"
            )

        atempo = _build_atempo_chain(speed)
        if atempo:
            chain += f",{atempo}"
        chain += f",volume={vol:.4f}"
        if fade_in > 0:
            chain += f",afade=t=in:st=0:d={min(fade_in, clip_dur):.3f}"
        if fade_out > 0:
            chain += f",afade=t=out:st={max(0.0, clip_dur - fade_out):.3f}:d={min(fade_out, clip_dur):.3f}"
        delay_ms = int(round(start_pt * 1000.0))
        if delay_ms > 0:
            chain += f",adelay={delay_ms}|{delay_ms}"
        lbl = f"ac{a_clip_idx}"
        a_clip_idx += 1
        chain += f",apad=whole_dur={total_sec:.3f},atrim=0:{total_sec:.3f}[{lbl}]"
        filter_parts.append(chain)
        return f"[{lbl}]"

    for tr in voice_tracks:
        for cl in tr.get("clips") or []:
            if not isinstance(cl, dict) or not cl.get("src") or cl.get("muted"):
                continue
            sp = _resolve_cached(cl["src"])
            idx = add_media_input(sp)
            lbl = _add_audio_clip(cl, sp, idx, is_music=False)
            if lbl:
                voice_labels.append(lbl)

    for cl, sp, idx in extra_audio_entries:
        lbl = _add_audio_clip(cl, sp, idx, is_music=False)
        if lbl:
            voice_labels.append(lbl)

    for tr in sfx_tracks:
        for cl in tr.get("clips") or []:
            if not isinstance(cl, dict) or not cl.get("src") or cl.get("muted"):
                continue
            sp = _resolve_cached(cl["src"])
            idx = add_media_input(sp)
            lbl = _add_audio_clip(cl, sp, idx, is_music=False)
            if lbl:
                sfx_labels.append(lbl)

    for tr in music_tracks:
        for cl in tr.get("clips") or []:
            if not isinstance(cl, dict) or not cl.get("src") or cl.get("muted"):
                continue
            sp = _resolve_cached(cl["src"])
            idx = add_media_input(sp)
            lbl = _add_audio_clip(cl, sp, idx, is_music=True)
            if lbl:
                music_labels.append(lbl)

    voice_bus = ""
    if len(voice_labels) == 1:
        filter_parts.append(f"{voice_labels[0]}anull[vbus_raw]")
        voice_bus = "vbus_raw"
    elif len(voice_labels) > 1:
        filter_parts.append(
            f"{''.join(voice_labels)}amix=inputs={len(voice_labels)}:duration=longest:dropout_transition=0:normalize=0[vbus_raw]"
        )
        voice_bus = "vbus_raw"

    sfx_bus = ""
    if len(sfx_labels) == 1:
        filter_parts.append(f"{sfx_labels[0]}anull[sbus_mix]")
        sfx_bus = "sbus_mix"
    elif len(sfx_labels) > 1:
        filter_parts.append(
            f"{''.join(sfx_labels)}amix=inputs={len(sfx_labels)}:duration=longest:dropout_transition=0:normalize=0[sbus_mix]"
        )
        sfx_bus = "sbus_mix"

    music_bus = ""
    if len(music_labels) == 1:
        filter_parts.append(f"{music_labels[0]}anull[mbus_raw]")
        music_bus = "mbus_raw"
    elif len(music_labels) > 1:
        filter_parts.append(
            f"{''.join(music_labels)}amix=inputs={len(music_labels)}:duration=longest:dropout_transition=0:normalize=0[mbus_raw]"
        )
        music_bus = "mbus_raw"

    mix_buses: list[str] = []
    if voice_bus and music_bus and max_duck_db > 0.0:
        ratio = max(2.0, min(20.0, max_duck_db / 2.0))
        filter_parts.append(f"[{voice_bus}]asplit=2[vbus_mix][vbus_key]")
        filter_parts.append(
            f"[{music_bus}][vbus_key]sidechaincompress=threshold=0.03:ratio={ratio:.2f}:attack=30:release=350:makeup=1[mbus_mix]"
        )
        mix_buses.extend(["[vbus_mix]", "[mbus_mix]"])
    else:
        if voice_bus:
            mix_buses.append(f"[{voice_bus}]")
        if music_bus:
            mix_buses.append(f"[{music_bus}]")
    if sfx_bus:
        mix_buses.append(f"[{sfx_bus}]")

    if not mix_buses:
        filter_parts.append(f"anullsrc=r=44100:cl=stereo,atrim=0:{total_sec:.3f}[aout]")
    else:
        if len(mix_buses) == 1:
            filter_parts.append(f"{mix_buses[0]}anull[amix_raw]")
        else:
            filter_parts.append(
                f"{''.join(mix_buses)}amix=inputs={len(mix_buses)}:duration=longest:dropout_transition=0:normalize=0[amix_raw]"
            )
        filter_parts.append(
            f"[amix_raw]volume={master_vol:.4f},loudnorm=I={master_lufs:.1f}:TP=-1.5:LRA=11,"
            f"atrim=0:{total_sec:.3f}[aout]"
        )

    filter_complex = ";".join(filter_parts)

    argv: list[str] = [
        *input_args,
        "-filter_complex",
        filter_complex,
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-t",
        f"{total_sec:.3f}",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
    ]
    return argv, inputs, total_sec


PROXY_VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}


def _quote_win_arg(arg: str) -> str:
    """Quote a single argument for Windows cmd.exe /S /C invocation."""
    if not arg or any(ch in arg for ch in (' ', '\t', '"', ';', '[', ']', '(', ')', ',', "'", '*', '&', '|', '<', '>', '^', '=')):
        escaped = arg.replace('"', '\\"')
        return f'"{escaped}"'
    return arg


def _offload_ffmpeg(
    job_dir: Path,
    argv: list[str],
    inputs: list[Path],
    out_path: Path,
    *,
    label: str,
    stage: str,
    timeout_sec: int = 1800,
    status_msg: str | None = None,
    progress: int = 20,
    log_fn: Any = None,
) -> int:
    """Offload an ffmpeg command via agent-ctl run --requires ffmpeg.

    Returns:
      0 = succeeded and copied output to out_path
      3 = no worker node online (or agent-ctl unavailable)
      other non-zero = disabled / failed
    """
    _log = log_fn if callable(log_fn) else (lambda msg: append_log(job_dir, msg))

    if os.environ.get("STUDIO_OFFLOAD", "").strip().lower() == "off":
        _log(f"Offload ({label}) disabled via STUDIO_OFFLOAD=off.")
        return 2

    if not Path(AGENT_CTL_BIN).exists():
        _log(f"Offload ({label}) unavailable: {AGENT_CTL_BIN} not found.")
        return 3

    safe_label = re.sub(r"[^a-zA-Z0-9._-]+", "_", label).strip("_") or "job"
    stage_dir = job_dir / "editor_tmp" / f"offload_{safe_label}_stage"
    offload_out_dir = job_dir / "editor_tmp" / f"offload_{safe_label}_out"
    shutil.rmtree(stage_dir, ignore_errors=True)
    shutil.rmtree(offload_out_dir, ignore_errors=True)
    stage_dir.mkdir(parents=True, exist_ok=True)
    offload_out_dir.mkdir(parents=True, exist_ok=True)

    try:
        staged_files: list[Path] = []
        staged_names: list[str] = []
        for i, orig in enumerate(inputs):
            ext = orig.suffix or ".bin"
            name = f"in{i}{ext}"
            dest = stage_dir / name
            try:
                os.link(orig, dest)
            except OSError:
                shutil.copy2(orig, dest)
            staged_files.append(dest)
            staged_names.append(name)

        # Rewrite argv for remote execution (inputs -> staged basenames, filter_complex -> script file)
        remote_argv: list[str] = []
        in_idx = 0
        fc_raw = ""
        i = 0
        while i < len(argv):
            tok = argv[i]
            if tok == "-i" and i + 1 < len(argv):
                remote_argv.extend(["-i", staged_names[in_idx]])
                in_idx += 1
                i += 2
                continue
            if tok == "-filter_complex" and i + 1 < len(argv):
                fc_raw = argv[i + 1]
                remote_argv.extend(["-filter_complex_script", "fc_remote.txt"])
                i += 2
                continue
            remote_argv.append(tok)
            i += 1

        # Stage any drawtext textfiles and rewrite their paths to relative basenames
        if fc_raw:
            txt_counter = 0

            def _repl_textfile(m: re.Match[str]) -> str:
                nonlocal txt_counter
                raw_p = m.group(1).replace("\\:", ":").replace("\\'", "'")
                p = Path(raw_p)
                if p.exists():
                    tname = f"txt{txt_counter}.txt"
                    txt_counter += 1
                    dest = stage_dir / tname
                    shutil.copy2(p, dest)
                    staged_files.append(dest)
                    return f"textfile='{tname}'"
                return m.group(0)

            fc_remote = re.sub(r"textfile='([^']+)'", _repl_textfile, fc_raw)
            # Drop homelab-specific fontfile path on remote workers (may be Windows/different font path)
            fc_remote = re.sub(r"fontfile='[^']+':", "", fc_remote)
            fc_file = stage_dir / "fc_remote.txt"
            fc_file.write_text(fc_remote, encoding="utf-8")
            staged_files.append(fc_file)

        out_ext = out_path.suffix or ".mp4"
        remote_out_name = f"out{out_ext}"

        posix_args = " ".join(shlex.quote(a) for a in remote_argv)
        win_args = " ".join(_quote_win_arg(a) for a in remote_argv)

        cmd_posix = f'cd "$LAB_IN_DIR" && ffmpeg -y -hide_banner -v error {posix_args} "$LAB_OUT_DIR/{remote_out_name}"'
        cmd_win = f'cd /d "%LAB_IN_DIR%" && ffmpeg -y -hide_banner -v error {win_args} "%LAB_OUT_DIR%\\{remote_out_name}"'

        ctl_cmd: list[str] = [
            AGENT_CTL_BIN,
            "run",
            "--name",
            f"editor-{safe_label}-{safe_slug(job_dir.name)}",
            "--requires",
            "ffmpeg",
        ]
        for sf in staged_files:
            ctl_cmd.extend(["--input", str(sf)])
        ctl_cmd.extend([
            "--cmd-posix",
            cmd_posix,
            "--cmd-win",
            cmd_win,
            "--timeout",
            str(int(timeout_sec)),
            "--out-dir",
            str(offload_out_dir),
        ])

        _log(f"Attempting remote offload {label} via agent-ctl ({len(staged_files)} staged inputs)...")
        if status_msg:
            write_status(
                job_dir,
                status="editing",
                stage=stage,
                progress=progress,
                message=status_msg,
            )
        try:
            rc, stdout, stderr = _run_subprocess(ctl_cmd, timeout=int(timeout_sec) + 60)
        except AbortedError:
            raise
        except TimeoutError as exc:
            _log(f"Offload {label} timed out: {exc}")
            return 124
        except Exception as exc:
            _log(f"Offload {label} exception: {exc}")
            return 1

        remote_out = offload_out_dir / remote_out_name
        if rc == 0 and remote_out.exists() and remote_out.stat().st_size > 0:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(remote_out, out_path)
            _log(f"Remote offload {label} succeeded -> {out_path.name} ({out_path.stat().st_size} bytes)")
            if status_msg:
                done_msg = (
                    "Export วิดีโอบนเครื่องลูกข่ายเสร็จสิ้น"
                    if stage == "export"
                    else f"ประมวลผล {stage} บนเครื่องลูกข่ายเสร็จสิ้น"
                )
                write_status(job_dir, status="editing", stage=stage, progress=95, message=done_msg)
            return 0

        if rc == 3:
            _log(f"No worker node online for {label} (agent-ctl exit 3).")
        else:
            err_tail = (stderr or stdout or f"exit {rc}").strip().splitlines()[-1:] or [f"exit {rc}"]
            _log(f"Offload {label} unavailable/failed (rc={rc}: {err_tail[0][:200]}).")
        return rc if rc != 0 else 1
    finally:
        shutil.rmtree(stage_dir, ignore_errors=True)
        shutil.rmtree(offload_out_dir, ignore_errors=True)


def _try_offload_export_ffmpeg(
    job_dir: Path,
    argv: list[str],
    inputs: list[Path],
    out_mp4: Path,
) -> bool:
    """Attempt to offload ffmpeg export via agent-ctl run --requires ffmpeg. Returns True on success."""
    return (
        _offload_ffmpeg(
            job_dir,
            argv,
            inputs,
            out_mp4,
            label="export",
            stage="export",
            timeout_sec=1800,
            status_msg="กำลังส่งงาน Export วิดีโอไปยังเครื่องลูกข่าย...",
            progress=20,
        )
        == 0
    )


def _append_proxy_log(job_dir: Path, message: str) -> None:
    proxy_dir = job_dir / "editor_assets" / "proxy"
    proxy_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_path = proxy_dir / "proxy.log"
    with log_path.open("a", encoding="utf-8") as f:
        for line in str(message).splitlines() or [""]:
            f.write(f"[{ts}] {line}\n")
        f.flush()


def run_proxy(job_dir: Path, filename: str) -> int:
    """Generate a lightweight 540p preview proxy on a worker node only (never runs ffmpeg on homelab)."""
    if not filename or "/" in filename or "\\" in filename or ".." in filename or Path(filename).name != filename:
        msg = f"Invalid proxy filename (must be a single filename without '/' or '..'): {filename!r}"
        _append_proxy_log(job_dir, msg)
        print(msg, file=sys.stderr)
        return 1

    assets_dir = job_dir / "editor_assets"
    src_path = assets_dir / filename
    if not src_path.is_file():
        _append_proxy_log(job_dir, f"skip proxy (source not found): {filename}")
        return 0

    if src_path.suffix.lower() not in PROXY_VIDEO_EXTS:
        _append_proxy_log(job_dir, f"skip proxy (non-video extension {src_path.suffix}): {filename}")
        return 0

    stem = src_path.stem
    proxy_dir = assets_dir / "proxy"
    proxy_dir.mkdir(parents=True, exist_ok=True)
    out_proxy = proxy_dir / f"{stem}_proxy.mp4"
    failed_marker = proxy_dir / f"{stem}_proxy.failed"

    if out_proxy.exists():
        try:
            if out_proxy.stat().st_size > 0 and out_proxy.stat().st_mtime >= src_path.stat().st_mtime:
                _append_proxy_log(job_dir, f"skip proxy (up-to-date): {out_proxy.name}")
                return 0
        except OSError:
            pass

    tmp_proxy = proxy_dir / f".{stem}_proxy.tmp.{os.getpid()}.mp4"
    argv = [
        "-i",
        str(src_path),
        "-vf",
        "scale='min(960,iw)':'min(960,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-g",
        "30",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
    ]
    _append_proxy_log(job_dir, f"Starting remote proxy for {filename} -> {out_proxy.name}")
    try:
        rc = _offload_ffmpeg(
            job_dir,
            argv,
            [src_path],
            tmp_proxy,
            label=f"proxy_{stem}",
            stage="proxy",
            timeout_sec=900,
            status_msg=None,
            log_fn=lambda msg: _append_proxy_log(job_dir, msg),
        )
        if rc == 0 and tmp_proxy.exists() and tmp_proxy.stat().st_size > 0:
            os.replace(tmp_proxy, out_proxy)
            try:
                failed_marker.unlink()
            except OSError:
                pass
            _append_proxy_log(job_dir, f"Proxy ready: {out_proxy.name} ({out_proxy.stat().st_size} bytes)")
            return 0
        if rc != 0:
            try:
                failed_marker.write_text(
                    json.dumps({"rc": rc, "ts": int(time.time())}),
                    encoding="utf-8",
                )
            except OSError:
                pass
        _append_proxy_log(job_dir, f"skip proxy (no worker / failed, rc={rc}): {filename}")
        return 0
    finally:
        if tmp_proxy.exists():
            try:
                tmp_proxy.unlink()
            except OSError:
                pass


def run_export_ffmpeg(
    job_dir: Path,
    argv: list[str],
    inputs: list[Path],
    out_mp4: Path,
    total_sec: float,
) -> None:
    """Run export ffmpeg: try Homelab Agent Hub offload first, else throttled local ffmpeg with progress."""
    force_local = os.environ.get("STUDIO_EXPORT_LOCAL") == "1"
    if not force_local and Path(AGENT_CTL_BIN).exists():
        try:
            if _try_offload_export_ffmpeg(job_dir, argv, inputs, out_mp4):
                return
        except Exception as exc:
            append_log(job_dir, f"Offload export exception ({exc}); falling back to local ffmpeg.")

    local_cmd = [
        "nice",
        "-n",
        "15",
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-v",
        "error",
        "-threads",
        "2",
        "-filter_complex_threads",
        "2",
        "-progress",
        "pipe:1",
        "-nostats",
        *argv,
        str(out_mp4),
    ]
    append_log(job_dir, f"Running local throttled ffmpeg export (total={total_sec:.2f}s) -> {out_mp4.name}")
    write_status(
        job_dir,
        status="editing",
        stage="export",
        progress=10,
        message="กำลัง Export วิดีโอจากโปรแกรมตัดต่อ...",
    )

    proc = subprocess.Popen(
        local_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    _active_procs.add(proc)

    stderr_chunks: list[str] = []

    def _drain_stderr() -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            stderr_chunks.append(line)

    stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
    stderr_thread.start()

    timeout_sec = 1800.0
    deadline = time.monotonic() + timeout_sec
    last_report_ts = 0.0
    last_pct = 10

    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if time.monotonic() > deadline:
                raise TimeoutError(f"Export ffmpeg timed out after {int(timeout_sec)}s")
            sline = line.strip()
            if sline.startswith("out_time_ms=") or sline.startswith("out_time_us="):
                val_str = sline.split("=", 1)[1].strip()
                try:
                    us = int(val_str)
                    cur_sec = max(0.0, us / 1_000_000.0)
                    pct = clamp(10 + int((cur_sec / max(0.1, total_sec)) * 85), 10, 95)
                    now_ts = time.monotonic()
                    if pct > last_pct and (pct - last_pct >= 3 or now_ts - last_report_ts >= 1.5):
                        last_pct = pct
                        last_report_ts = now_ts
                        write_status(
                            job_dir,
                            status="editing",
                            stage="export",
                            progress=pct,
                            message="กำลัง Export วิดีโอจากโปรแกรมตัดต่อ...",
                        )
                except ValueError:
                    pass

        rem = max(1.0, deadline - time.monotonic())
        proc.wait(timeout=rem)
        stderr_thread.join(timeout=5.0)
    except (subprocess.TimeoutExpired, TimeoutError):
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                proc.kill()
        raise TimeoutError(f"Export ffmpeg timed out after {int(timeout_sec)}s")
    finally:
        _active_procs.discard(proc)

    stderr_text = "".join(stderr_chunks).strip()
    if proc.returncode != 0 or not out_mp4.exists() or out_mp4.stat().st_size == 0:
        last_line = stderr_text.splitlines()[-1] if stderr_text else f"ffmpeg exited {proc.returncode}"
        raise RuntimeError(f"Export วิดีโอไม่สำเร็จ: {last_line[:240]}")


def stage_export(job_dir: Path) -> dict[str, Any]:
    """Export multi-track EDL from <jobDir>/editor_project.json into final_v{N}.mp4."""
    project_path = job_dir / "editor_project.json"
    if not project_path.exists():
        raise ValueError("ยังไม่มีโปรเจกต์ตัดต่อ")
    project = read_json(project_path, None)
    if not isinstance(project, dict):
        raise ValueError("ไฟล์โปรเจกต์ตัดต่อ (editor_project.json) ไม่ถูกต้อง")

    ver = _next_version_number(job_dir)
    out_mp4 = job_dir / f"final_v{ver}.mp4"
    slug = safe_slug(job_dir.name)

    with acquire_render_lock(job_dir):
        write_status(
            job_dir,
            status="editing",
            stage="export",
            progress=10,
            message="กำลังเตรียม Export วิดีโอจากโปรแกรมตัดต่อ...",
        )
        append_log(job_dir, f"Starting editor export -> {out_mp4.name}")
        argv, inputs, total_sec = build_export_ffmpeg(job_dir, project)
        run_export_ffmpeg(job_dir, argv, inputs, out_mp4, total_sec)
        shutil.rmtree(job_dir / "editor_tmp", ignore_errors=True)
        return _finalize_edit_version(job_dir, out_mp4, ver, "export:editor", f"{slug}_v{ver}.mp4")


def _finalize_edit_version(
    job_dir: Path,
    out_mp4: Path,
    ver: int,
    kind: str,
    dest_name: str,
) -> dict[str, Any]:
    preview_info = run_preview_stage(job_dir, out_mp4, None)
    preview_out = copy_preview_to_videos_dir(job_dir, preview_info, Path(dest_name).stem)

    master_copy = copy_to_videos_dir(out_mp4, dest_name)
    dur = probe_duration(out_mp4)
    size_bytes = master_copy.stat().st_size

    job = read_json(job_dir / "job.json", {}) or {}
    versions = list(job.get("versions") or [])
    prev_outputs = dict(job.get("outputs") or {})

    entry: dict[str, Any] = {
        "version": ver,
        "kind": kind,
        "file": out_mp4.name,
        "videoPath": str(master_copy),
        "watchUrl": make_watch_url(master_copy),
        "downloadUrl": make_download_url(master_copy),
        "durationSec": dur,
        "sizeBytes": size_bytes,
        "createdAt": now_iso(),
        **preview_out,
    }
    versions.append(entry)

    outputs = {
        **prev_outputs,
        "videoPath": str(master_copy),
        "jobVideoFile": out_mp4.name,
        "watchUrl": make_watch_url(master_copy),
        "downloadUrl": make_download_url(master_copy),
        "durationSec": dur,
        "sizeBytes": size_bytes,
        **preview_info,
        **preview_out,
    }
    append_log(job_dir, f"Saved edited version v{ver} ({kind}) -> {master_copy}")
    return write_status(
        job_dir,
        status="done",
        stage="done",
        progress=100,
        outputs=outputs,
        versions=versions,
        error=None,
        message=f"บันทึกเวอร์ชัน v{ver} เรียบร้อยแล้ว",
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Video Studio Job Runner")
    sub = parser.add_subparsers(dest="cmd", required=True)

    for name in ("oneshot", "draft", "build", "rebuild"):
        p = sub.add_parser(name)
        p.add_argument("--job", required=True, help="Job directory path")

    p_es = sub.add_parser("edit-scene")
    p_es.add_argument("--job", required=True, help="Job directory path")
    p_es.add_argument("--scene", "--scene-id", dest="scene", default="", help="Edited scene ID")

    p_rm = sub.add_parser("remix")
    p_rm.add_argument("--job", required=True, help="Job directory path")
    p_rm.add_argument("--bgm", default="warm_tech", help="BGM preset name or path")
    p_rm.add_argument("--bgm-vol", type=float, default=0.14, dest="bgm_vol", help="BGM volume multiplier (0..1)")
    p_rm.add_argument("--duck-db", type=float, default=12.0, dest="duck_db", help="Sidechain ducking depth in dB (0..30)")

    p_tr = sub.add_parser("trim")
    p_tr.add_argument("--job", required=True, help="Job directory path")
    p_tr.add_argument("--start", type=float, required=True, help="Start time in seconds")
    p_tr.add_argument("--end", type=float, required=True, help="End time in seconds")

    p_cut = sub.add_parser("cut")
    p_cut.add_argument("--job", required=True, help="Job directory path")
    p_cut.add_argument("--from", "--cut-from", dest="cut_from", type=float, required=True, help="Cut start in seconds")
    p_cut.add_argument("--to", "--cut-to", dest="cut_to", type=float, required=True, help="Cut end in seconds")

    p_ex = sub.add_parser("export")
    p_ex.add_argument("--job", required=True, help="Job directory path")

    p_px = sub.add_parser("proxy")
    p_px.add_argument("--job", required=True, help="Job directory path")
    p_px.add_argument("--file", required=True, help="Single video filename inside job/editor_assets")

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    global _current_job_dir
    args = parse_args(argv if argv is not None else sys.argv[1:])
    job_dir = Path(args.job).resolve()
    job_dir.mkdir(parents=True, exist_ok=True)

    if args.cmd == "proxy":
        _install_signal_handlers()
        try:
            return run_proxy(job_dir, args.file)
        except AbortedError:
            return 143
        except Exception as exc:
            _append_proxy_log(job_dir, f"ERROR (proxy): {exc}")
            return 0

    _current_job_dir = job_dir
    _install_signal_handlers()

    append_log(job_dir, f"=== studio_job.py {args.cmd} started (pid={os.getpid()}) ===")
    try:
        if args.cmd == "draft":
            stage_draft(job_dir)
        elif args.cmd == "build":
            stage_build(job_dir, as_new_version=False)
        elif args.cmd == "oneshot":
            stage_draft(job_dir)
            stage_build(job_dir, as_new_version=False)
        elif args.cmd == "edit-scene":
            stage_build(job_dir, as_new_version=True, edit_scene_id=args.scene or None)
        elif args.cmd == "rebuild":
            stage_build(job_dir, as_new_version=True, edit_scene_id=None)
        elif args.cmd == "remix":
            stage_remix(job_dir, args.bgm, args.bgm_vol, args.duck_db)
        elif args.cmd == "trim":
            stage_trim(job_dir, args.start, args.end)
        elif args.cmd == "cut":
            stage_cut(job_dir, args.cut_from, args.cut_to)
        elif args.cmd == "export":
            stage_export(job_dir)
        else:
            raise ValueError(f"ไม่รู้จักคำสั่ง: {args.cmd}")
        append_log(job_dir, f"=== studio_job.py {args.cmd} completed ===")
        return 0
    except AbortedError:
        return 143
    except Exception as exc:
        short_err = str(exc).strip() or exc.__class__.__name__
        if len(short_err) > 300:
            short_err = short_err[:297] + "..."
        append_log(job_dir, f"ERROR ({args.cmd}): {short_err}")
        write_status(
            job_dir,
            status="error",
            stage="error",
            error=short_err,
            message=f"เกิดข้อผิดพลาด: {short_err}",
        )
        print(json.dumps({"ok": False, "error": short_err}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
