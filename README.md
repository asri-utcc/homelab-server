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
* **AI Chat & Terminal:** คอนโซลสื่อสารกับ Antigravity / Gemini พร้อมเสียง Sound Effects เชิงมิติ Sci-Fi
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
