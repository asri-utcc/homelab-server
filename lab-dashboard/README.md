# lab-dashboard — แดชบอร์ดควบคุม Home-lab

หน้าเดียวรวมข้อมูล + คำสั่งควบคุมของทุกบริการใน home-lab
(แทนที่จะต้องกดลิ้งค์ไป login ทีละเว็บ)

- **Node.js เปล่า ๆ ไม่มี npm dependency** — ใช้แค่โมดูล built-in
- รันอยู่ระดับ host (ไม่ใช่ใน Docker) เพื่อให้เห็น `/proc`, `/sys`, `docker.sock` และเรียก `pm2` ได้ตรง ๆ
- อยู่หลัง **HTTP Basic Auth** ของ Caddy เสมอ (มีสิทธิ์สตาร์ต/หยุด container และ process)

---

## โครงสร้าง

```
lab-dashboard/
├── server.js              # API + ตัวเก็บข้อมูล + ตัวควบคุม
├── ecosystem.config.js    # config สำหรับ PM2
└── public/
    ├── index.html         # โครงหน้า + SVG icon sprite
    ├── styles.css         # design tokens (tactical/futuristic/light/dark) + layout
    └── app.js             # fetch → render + HUD SVG frames + กราฟ + ปุ่มควบคุม
```

## แหล่งข้อมูล

| ส่วน | อ่านจาก | วิธี |
|---|---|---|
| CPU / RAM / disk / temp / net / load / uptime | `/proc`, `/sys` | อ่านไฟล์ตรง ๆ |
| Containers + CPU/Mem ของแต่ละตัว | Docker API | `docker.sock` + `docker stats --no-stream` |
| PM2 processes | PM2 daemon | `pm2 jlist` |
| Uptime Kuma monitors | `kuma.db` (SQLite) | `docker exec lab-uptime-kuma node -e '…@louislam/sqlite3…'` |
| MongoDB stats | `mongosh` | `docker exec lab-mongodb` (อ่าน credential จาก env ของคอนเทนเนอร์) |
| สถานะบริการ | HTTP/TCP probe | ยิงเข้า 127.0.0.1 ทีละพอร์ต |

> ตัวแดชบอร์ดไม่ต้องถือรหัสผ่านของบริการใด ๆ เลย — ข้อมูลที่ต้องใช้สิทธิ์ถูกอ่านจากภายในคอนเทนเนอร์ที่เกี่ยวข้องเอง

## API

| Method | Path | ความหมาย |
|---|---|---|
| `GET` | `/api/summary` | ข้อมูลทั้งหมดใน JSON เดียว (cache 2–20 วินาที) |
| `GET` | `/api/health` | health check เบา ๆ |
| `GET` | `/api/guide` | คู่มือเปลี่ยนรหัสผ่าน (markdown) อ่านจาก `PASSWORD-GUIDE.md` |
| `POST` | `/api/refresh` | ล้าง cache ทิ้งทั้งหมด |
| `POST` | `/api/containers/:name/:action` | `start` / `stop` / `restart` (เฉพาะชื่อที่ขึ้นต้นด้วย `lab-`) |
| `POST` | `/api/pm2/:name/:action` | `start` / `stop` / `restart` (เฉพาะ `pm2-ui`) |

ตัวอย่าง:
```bash
curl -X POST http://127.0.0.1:8090/api/containers/lab-caddy/restart
curl -s http://127.0.0.1:8090/api/summary | jq '.services'
```

## ตัวแปรแวดล้อม

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `DASHBOARD_PORT` | `8090` | พอร์ตที่ฟัง |
| `DASHBOARD_HOST` | `0.0.0.0` | address ที่ฟัง |
| `LAB_DIR` | `~/projects/lab-stack` | โฟลเดอร์ stack (ใช้หาไฟล์ .env / สั่ง pm2) |
| `PM2_BIN` | `~/.local/pm2/node_modules/.bin/pm2` | ตำแหน่ง pm2 |
| `DOCKER_SOCK` | `/var/run/docker.sock` | docker socket |
| `TAIL_HOST` | `homelab.tail285279.ts.net` | โดเมนหลัก (ใช้สร้างลิงก์ทางลัด) |
| `ALLOWED_CONTAINERS` | `lab-` | prefix ของ container ที่สั่งควบคุมได้ |
| `ALLOWED_PM2` | `pm2-ui` | ชื่อ process ที่สั่งควบคุมได้ |

## การรัน

```bash
cd ~/projects/lab-dashboard
~/.local/pm2/node_modules/.bin/pm2 start ecosystem.config.js
~/.local/pm2/node_modules/.bin/pm2 logs lab-dashboard
~/.local/pm2/node_modules/.bin/pm2 restart lab-dashboard
```

ทดสอบ: `curl -s http://127.0.0.1:8090/api/health`

## การออกแบบ (UI)

อ้างอิงชุดสีจาก `dataviz` skill (validated ด้วย `validate_palette.js`):

- categorical 3 slot — blue `#2a78d6`/`#3987e5`, orange `#eb6834`/`#d95926`, aqua `#1baf7a`/`#199e70`
  (ผ่านทุก gate ทั้ง light/dark แบบ `--pairs all`)
- สถานะ (good/warning/serious/critical) ใช้ค่าคงที่ `#0ca30c` `#fab219` `#ec835a` `#d03b3b`
  และ **แสดงไอคอน + ป้ายกำกับเสมอ** ไม่ใช้สีสื่อความหมายเพียงอย่างเดียว
- light/dark เป็นค่าที่ *เลือก* เอง ไม่ใช่การกลับสีอัตโนมัติ
- ตัวเลขในตารางใช้ `tabular-nums`; ตัวเลขใหญ่ใช้ proportional ตามแนวทาง
- กราฟมี crosshair + tooltip เสมอ; 2 series มี legend ครบ

### ธีม

ปุ่มธีมบนแถบบนสลับตามลำดับ: **แทคติคอล HUD → อนาคต → มืด → สว่าง → อัตโนมัติ** (ค่าเริ่มต้นคือ "แทคติคอล HUD")
เลือกผ่าน URL ได้ด้วย เช่น `?theme=tactical` / `?theme=futuristic` / `?theme=dark` / `?theme=light`

| ธีม | ลักษณะ |
|---|---|
| `tactical` | สไตล์ Cyber-Frame / Tactical Wireframe HUD — พื้นหลัง `#050e15` + การ์ดเขียวน้ำทะเลลึก `#04232d`, กรอบโพลีกอนมุมตัด 45° สีไซแอน `#00d2f0` ผสมเส้นหนา-บาง, เส้นแบ่งหักมุมภายใน, มาตรวัดแบบแบ่งช่อง และจุดเน้นสีส้มแทคติคอล `#f2541b` (ค่าเริ่มต้น) |
| `futuristic` | สไตล์ HUD — พื้นหลังตารางแสง + แสงเรืองสี, การ์ดกระจกมุมกรอบ, ตัวเลข monospace เรืองแสง, เส้นกราฟมี glow |
| `dark` | โทนมืดเรียบ กริดชัด ๆ |
| `light` | โทนสว่าง |
| `auto` | ตามค่าระบบ (`prefers-color-scheme`) |

ธีมอนาคตใช้ชุดสีข้อมูลที่ validate ผ่านบนพื้น `#0b121c`:
teal `#0e8fa6` · magenta `#db2777` · amber `#a16207`
(CVD ΔE 8.9 / normal-vision ΔE 20.5 / contrast ≥3:1 — ผ่านทุก gate)
สีสถานะ `#22c55e` `#f59e0b` `#f97316` `#ef4444` ผ่าน WCAG ≥4.5:1 บนพื้นเดียวกัน

### คู่มือเปลี่ยนรหัสผ่าน (ปุ่ม 📖 บนแถบบน)

- `GET /api/guide` อ่าน `PASSWORD-GUIDE.md` (จาก `LAB_DIR` ก่อน → fallback ที่โฟลเดอร์โค้ด)
- ฝั่งหน้าเว็บมี **markdown renderer ที่เขียนเอง** ไม่พึ่ง dependency
  (heading · ตาราง · รายการ · code block · blockquote · hr · ลิงก์ · ตัวหนา/เอียง)
- code block มีปุ่ม **คัดลอก** (clipboard API → fallback `execCommand('copy')`)
- เปิดด้วย deep link `?guide=1` ได้เลย
- ไฟล์คู่มืออยู่ที่ `~/projects/lab-stack/PASSWORD-GUIDE.md`
  (ตัวช่วยเปลี่ยนรหัส: `~/projects/lab-stack/set-dash-password.sh`)

## ไฟล์ที่เกี่ยวข้อง

- `~/projects/lab-stack/PASSWORD-GUIDE.md` — วิธีเปลี่ยนรหัสผ่านของทุกบริการ
- `~/projects/lab-stack/set-dash-password.sh` — สคริปต์เปลี่ยนรหัส basic auth (อ่านรหัสจาก stdin)
- `~/projects/install-dashboard.sh` — สคริปต์ติดตั้งทั้งระบบ (idempotent)
