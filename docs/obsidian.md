# คู่มือการใช้งาน Obsidian บน Homelab

เอกสารสรุปการใช้งานและการดูแล **Obsidian Web UI (`lab-obsidian`)** สำหรับจัดการความรู้และบันทึกของ Homelab

## 1. URL เข้าใช้งาน

- **Web UI:** `https://homelab.tail285279.ts.net/obsidian/`
- ป้องกันด้วยระบบ Auth กลางของ Lab Dashboard (`Caddy forward_auth`) — ต้องล็อกอินผ่าน Lab Dashboard ก่อนเข้าใช้งาน
- พอร์ตภายในโฮสต์: `127.0.0.1:3010` (ไม่เปิดพอร์ตออกนอกเครื่อง `0.0.0.0`)

## 2. วิธีเปิด Vault ครั้งแรก

เมื่อเข้าหน้าเว็บ Obsidian ครั้งแรก:
1. เลือก **Open folder as vault** (Open)
2. ระบุพาธภายใน container เป็น `/vaults/Homelab-Vault`
3. กดเปิดใช้งาน (หน้าแรกคือ `Home.md`)

> พาธจริงบนเครื่องโฮสต์: `/home/dev/storage/obsidian/Homelab-Vault` (เจ้าของ `1000:1000` / `dev:dev`, เข้าดูไฟล์ผ่าน File Browser และ SMB ได้)

## 3. โครงสร้างโฟลเดอร์ใน Vault

- `00-Inbox/` — บันทึกด่วนและโน้ตที่ยังไม่ได้จัดหมวด
- `01-AI-Memory/` — ความรู้ที่ AI สรุป (`Facts.md`, `Decisions.md`) และ `_mirror/` (สำเนาอ่านอย่างเดียว)
- `02-Homelab/` — เอกสารระบบโครงสร้างพื้นฐาน, `Incidents/` และ `Runbooks/`
- `03-Projects/` — โน้ตเฉพาะโปรเจกต์ (`lab-dashboard`, `OnePercentBotTrade`, `iot-dashboard` ฯลฯ)
- `04-Daily/` — บันทึกรายวัน (`YYYY-MM-DD.md`)
- `05-Knowledge/` — คู่มือและเอกสารอ้างอิงทางเทคนิค
- `99-Templates/` — เทมเพลตสำหรับสร้างโน้ตใหม่
- `Home.md` — หน้าหลักของ Vault

## 4. การ Sync ความจำ AI (AI Memory Mirror)

- สคริปต์: `/home/dev/projects/obsidian-memory-sync.sh`
- ตั้งเวลาทำงานอัตโนมัติผ่าน cron ของ `dev` ทุก 10 นาที (`*/10 * * * *`)
- คัดลอกไฟล์ความจำแบบ **ทางเดียว (Read-Only)** จาก:
  - `/home/dev/.gemini/MEMORY.md` → `01-AI-Memory/_mirror/gemini-MEMORY.md`
  - `/home/dev/.claude/projects/-home-dev-projects/memory/*.md` → `01-AI-Memory/_mirror/claude-*.md`
- **ข้อควรระวัง:** ห้ามแก้ไขไฟล์ใน `01-AI-Memory/_mirror/` โดยตรง ให้แก้ไขที่ไฟล์ต้นฉบับเท่านั้น และห้ามเก็บ password / token / API key ลงใน Vault

## 5. คำสั่งดูแลและอัปเดต

```bash
# ดูสถานะและ log ของ container
docker ps --filter name=lab-obsidian
docker logs -f --tail 100 lab-obsidian

# รีสตาร์ท container
cd /home/dev/projects/lab-stack && docker compose restart obsidian

# อัปเดต image เวอร์ชันล่าสุด
cd /home/dev/projects/lab-stack && docker compose pull obsidian && docker compose up -d obsidian

# รัน sync ความจำ AI ด้วยตนเอง
/home/dev/projects/obsidian-memory-sync.sh
```

## 6. ทางเลือกการ Sync กับมือถือ (ยังไม่ได้ติดตั้ง)

ปัจจุบันระบบใช้งานผ่าน Web UI เป็นหลัก หากต้องการเปิดแก้แบบออฟไลน์บนมือถือในอนาคต สามารถเลือกติดตั้งเพิ่มเติมได้ 2 แนวทาง:
1. **Syncthing (ฟรี / Self-hosted):** รัน Syncthing container บน homelab ชี้ไปที่ `/home/dev/storage/obsidian/Homelab-Vault` เพื่อ sync แบบ P2P กับแอป Obsidian บนมือถือผ่าน Tailscale
2. **Obsidian Sync (บริการทางการ):** สมัครแพ็กเกจของ Obsidian แล้วเชื่อมต่อจากหน้า Settings ของตัวแอปได้โดยตรง

## 7. Auto Daily Note

- **สคริปต์:** `/home/dev/projects/obsidian-daily-note.py` (ใช้ Python 3 standard library เท่านั้น สร้าง/อัปเดตโน้ต `04-Daily/YYYY-MM-DD.md` โดยอ้างอิงโครงจาก `99-Templates/Daily.md`)
- **Cron Schedule:** ทำงานอัตโนมัติทุกคืนเวลา **23:55** (`55 23 * * *`) ภายใต้ crontab ของ `dev`
- **Log File:** `/home/dev/projects/lab-dashboard/cron-logs/obsidian_daily_note.log`
- **กติกา Marker (`AUTO:START` / `AUTO:END`):**
  - ข้อมูลอัตโนมัติ (ค่าไฟ PZEM-01, สุขภาพเซิร์ฟเวอร์, สถานะ PM2, สถานะ Docker และ Git commits) จะถูกเขียนเฉพาะภายในช่วง `<!-- AUTO:START -->` ถึง `<!-- AUTO:END -->`
  - **ผู้ใช้และ AI ต้องเขียนบันทึกนอกช่วง marker เท่านั้น** (ห้ามแก้ไขในบล็อก `AUTO` เพราะจะถูกเขียนทับเมื่อรันสคริปต์รอบถัดไป)
- **คีย์ Frontmatter ที่สคริปต์ดูแล:** `energy_kwh`, `cost_thb`, `month_kwh`, `month_cost_thb`, `cpu_avg`, `ram_max`, `pm2_down` (สคริปต์จะอัปเดตเฉพาะคีย์เหล่านี้และคงคีย์เดิมอย่าง `tags`, `created` ไว้ครบ)
- **วิธีรันด้วยตนเอง / รันย้อนหลัง:**
  ```bash
  # สร้างหรืออัปเดต Daily Note ของวันนี้
  /usr/bin/python3 /home/dev/projects/obsidian-daily-note.py

  # รันย้อนหลังหรือเจาะจงวันที่ต้องการ
  /usr/bin/python3 /home/dev/projects/obsidian-daily-note.py --date YYYY-MM-DD

  # ทดสอบผลลัพธ์โดยไม่เขียนไฟล์จริง
  /usr/bin/python3 /home/dev/projects/obsidian-daily-note.py --date YYYY-MM-DD --dry-run
  ```

## 8. ปลั๊กอิน Dataview

- **การติดตั้ง:** ติดตั้งจาก official GitHub Releases ของ `blacksmithgu/obsidian-dataview` ลงใน `/home/dev/storage/obsidian/Homelab-Vault/.obsidian/plugins/dataview/` (`main.js`, `manifest.json`, `styles.css`) และเปิดรายการใน `.obsidian/community-plugins.json` (`["dataview"]`) เพื่อใช้แสดง Dashboard ใน `Home.md` (Daily Notes 7 วันล่าสุด, Incidents และ Runbooks)
- **การเปิดใช้งานครั้งแรกใน Web UI:** หากหน้า `Home.md` ยังแสดงโค้ด `dataview` แบบดิบ ให้เข้าไปที่ **Settings → Community plugins → Turn on community plugins** และเปิดใช้งาน **Dataview**
- **วิธีอัปเดต Dataview:**
  ```bash
  cd /home/dev/storage/obsidian/Homelab-Vault/.obsidian/plugins/dataview
  curl -fsSLO https://github.com/blacksmithgu/obsidian-dataview/releases/latest/download/main.js
  curl -fsSLO https://github.com/blacksmithgu/obsidian-dataview/releases/latest/download/manifest.json
  curl -fsSLO https://github.com/blacksmithgu/obsidian-dataview/releases/latest/download/styles.css
  chown -R dev:dev /home/dev/storage/obsidian/Homelab-Vault/.obsidian/plugins/dataview
  docker restart lab-obsidian
  ```

## 9. แนวทางให้ AI

- **บันทึก Incident:** เมื่อแก้ไขปัญหาระบบเสร็จ ให้สร้างโน้ต Incident ใน `02-Homelab/Incidents/YYYY-MM-DD-<slug>.md` ตามเทมเพลต `99-Templates/Incident.md` (ระบุอาการ สาเหตุ การแก้ไข และแนวทางป้องกัน)
- **บันทึก Runbook:** ขั้นตอนปฏิบัติการหรือการแก้ไขที่ต้องทำซ้ำได้ ให้เขียนเป็น Runbook ใน `02-Homelab/Runbooks/<slug>.md` ตามเทมเพลต `99-Templates/Runbook.md`
- **บันทึกงานประจำวัน:** เมื่อต้องการบันทึกสิ่งที่ทำในวันนั้น ให้เขียนต่อท้ายใต้หัวข้อ `## 📝 สิ่งที่ทำ / เหตุการณ์สำคัญ` ใน `04-Daily/YYYY-MM-DD.md` (**ห้ามเขียนในบล็อก `<!-- AUTO:START -->` ... `<!-- AUTO:END -->`**)
- **ข้อห้ามเดิม:** ห้ามแก้ไขไฟล์ใน `01-AI-Memory/_mirror/` โดยตรง (read-only mirror) และห้ามใส่รหัสผ่าน, token หรือ API key ลงใน Vault
