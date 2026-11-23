# Homelab Server (Linux NUC / Debian Bookworm)

โปรเจกต์เก็บบันทึกซอร์สโค้ด **Lab Dashboard** และ **การตั้งค่าระบบเซิร์ฟเวอร์ Homelab (Linux NUC)** ทั้งหมด

---

## 🖥️ Server Environment
* **Hardware:** Intel NUC / Mini PC
* **OS:** Debian GNU/Linux 12 (bookworm), Linux Kernel 6.1
* **Host IP:** `192.168.1.123`
* **Tailscale Domain:** `homelab.tail285279.ts.net`
* **Primary User:** `dev`

---

## 📂 โครงสร้างโปรเจกต์ (Repository Structure)

```text
homelab-server/
├── lab-dashboard/          # ซอร์สโค้ด Web Dashboard หลัก (Node.js/Express, PM2 ID 0)
│   ├── server.js           # Main Backend API, WebSocket, Image Streaming & System Metrics
│   ├── gemini.html         # AI Terminal Interface, Rich Markdown, Image Upload & SFX Synthesizer
│   ├── gemini-manager.js   # Background task streaming, Image Uploads Manager & AI State Engine
│   ├── wireguard-manager.js# WireGuard Peer Policy & IP Manager
│   └── public/             # Frontend UI, Icons, PWA Manifest, Terminal, Styles
├── lab-browser/            # Headless Chromium CLI + session daemon (Browser Vision backend ของ lab-dashboard)
├── configs/
│   ├── caddy/
│   │   └── Caddyfile       # การตั้งค่า Reverse Proxy HTTPS + Let's Encrypt TLS
│   └── docker/
│       └── compose.yaml    # Docker Compose ทั้ง 13 Containers (Home Assistant, EMQX, Caddy, ฯลฯ)
└── scripts/
    ├── get-energy.py       # เครื่องมือดึงข้อมูลไฟฟ้า Real-time & คำนวณค่าไฟ PZEM-01
    └── check-mail.py       # เครื่องมือตรวจเช็คอีเมลและแจ้งเตือนผ่าน Gmail IMAP
```

---

## ✨ Lab Dashboard & AI Terminal Features
* **AI Chat & Terminal (Default: Gemini 4 Hydrogen Medium):** คอนโซลสื่อสารกับ Antigravity / Gemini พร้อมเสียง Sound Effects เชิงมิติ Sci-Fi
* **Live Thinking Drawer & Deduplication:** ถาดตรวจสอบสถานะความคิดและการทำงานของ AI แบบ Real-time (กดย่อ/ขยายได้) พร้อมระบบป้องกันข้อความซ้ำซ้อนเมื่อ Reconnect
* **Direct Image Attachment & Rendering:**
  * รองรับการแนบและอัปโหลดรูปภาพผ่านแชทโดยตรง (ลากวาง / เลือกไฟล์ / คัดลอก-วาง) สูงสุด 10 MB
  * แสดงผลรูปภาพแบบ Responsive Card Gallery พร้อมระบบคลิกดูภาพขยาย
  * มี Media Proxy Endpoint เสิร์ฟรูปภาพทั้งจากระบบ AI Brain และ User Uploads อย่างปลอดภัย
* **Rich Markdown Formatting:** จัดรูปแบบข้อความอัตโนมัติ (Headings, Tables, Lists, Code Syntax Highlighting)
* **WireGuard & Network Management:** จัดการสถานะ Peer และกำหนด Routing Policy
* **Homelab System Metrics:** รายงานการใช้ CPU, RAM, Disk และ Docker Status แบบ Real-time

---

## 🚀 Key Services & Ports

| Service | Port / Path | Description |
| :--- | :--- | :--- |
| **Lab Dashboard** | `:8090` / `https://homelab.tail285279.ts.net/` | Main Homelab Control Center (Node.js/Express) |
| **Caddy Proxy** | `:80`, `:443` | Reverse Proxy & Auto HTTPS (Let's Encrypt) |
| **Home Assistant** | `:8123` / Host Net | Smart Home Hub (PZEM-01, Xiaomi Cameras, Tuya) |
| **IoT Dashboard** | `:8095` / `/iot/` | Standalone Sonoff Direct LAN & ESPHome Manager |
| **EMQX Broker** | `:1883`, `:8883` | MQTT Broker สำหรับอุปกรณ์ IoT |
| **Zigbee2MQTT** | `:8099` | Zigbee Coordinator Bridge (`/dev/ttyACM0`) |
| **WireGuard** | `51820/udp` | Remote VPN Gateway |
| **OnePercentBot** | PM2 Process | Automated Crypto Trading Bot (Binance Spot) |

---

## 🔒 Security & Privacy Notice
* ไฟล์รหัสผ่าน, App Password, และ API Token ส่วนตัวทั้งหมดถูกคัดแยกออกไปยัง `.env` / `.gmail.env` และถูก `.gitignore` ไว้เรียบร้อย ปลอดภัยต่อการเก็บไว้บน GitHub

---

## lab-browser

เครื่องมือ Headless Chromium CLI + session daemon ที่ทำหน้าที่เป็น **Browser Vision backend ของ `lab-dashboard`** โดยโค้ดที่ใช้งานจริง (live) อยู่ที่ `~/.local/share/lab-browser` (และ `lab-dashboard/browser-vision-bridge.js` มีการ hardcode path นี้ไว้)

### วิธีติดตั้ง (Restore / Fresh Install)

```bash
mkdir -p ~/.local/share/lab-browser
rsync -a lab-browser/ ~/.local/share/lab-browser/ --exclude skill
cd ~/.local/share/lab-browser && npm ci
ln -sf ~/.local/share/lab-browser/bin/lab-browser.js ~/.local/bin/lab-browser
mkdir -p ~/.gemini/antigravity-cli/skills/web-browser && cp lab-browser/skill/SKILL.md ~/.gemini/antigravity-cli/skills/web-browser/
```

> **หมายเหตุ:** โฟลเดอร์ `auth/` (cookies/storageState ที่ login ร่วมกัน), `state/` และ `profiles/` ถูกกันออกโดย `.gitignore` และไม่ได้เก็บใน git จึงต้อง login ใหม่หลังการติดตั้ง

### วิธี Re-sync เมื่อมีการแก้ไขฝั่ง Live

```bash
rsync -a --exclude 'node_modules/' --exclude 'auth/' --exclude 'state/' --exclude 'profiles/' --exclude '*.bak*' --exclude '*.log' ~/.local/share/lab-browser/ lab-browser/
cp ~/.gemini/antigravity-cli/skills/web-browser/SKILL.md lab-browser/skill/SKILL.md
```

---

## motion-studio

เครื่องมือสร้างวิดีโอและ Motion Graphics (Remotion + Thai TTS) โดยโค้ดที่ใช้งานจริง (live) อยู่ที่ `~/.local/share/motion-studio` (ไฟล์ `bin/motion-studio` และ `lab-dashboard` / PM2 เรียกใช้ path นี้โดยตรง)

### วิธีติดตั้ง (Restore / Fresh Install)

```bash
mkdir -p ~/.local/share/motion-studio
rsync -a motion-studio/ ~/.local/share/motion-studio/
cd ~/.local/share/motion-studio
npm ci
python3 -m venv venv && venv/bin/pip install edge-tts pillow
ln -sf ~/.local/share/motion-studio/bin/motion-studio ~/.local/bin/motion-studio
```

> **หมายเหตุ:** โฟลเดอร์ `node_modules/`, `venv/`, `out/`, `core.*` และไฟล์เรนเดอร์ชั่วคราว (`*.mp4`, `*.wav`, `*.png.tmp`) ถูกกันออกโดย `.gitignore` และไม่ได้เก็บใน git

### วิธี Re-sync เมื่อมีการแก้ไขฝั่ง Live

```bash
./scripts/sync-motion-studio.sh
```
