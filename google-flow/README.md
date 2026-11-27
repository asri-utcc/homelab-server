# google-flow — Homelab CLI for Google Flow AI Image Generation

เครื่องมือ CLI สำหรับสั่งสร้างภาพและดาวน์โหลดภาพความละเอียดเต็มจาก **Google Flow** (`https://labs.google/fx/tools/flow` -> `https://flow.google.com`) บน Homelab Server โดยใช้ Shared Auth ของ `lab-browser` (ไม่ต้องใช้ API Key ภายนอก และใช้ RAM **0 MB** ตอนไม่ได้เรียกใช้)

## สถาปัตยกรรม (ทำไมเป็น CLI + Skill แทน MCP Server ค้าง)

- **RAM 0 MB ตอนว่าง:** ออกแบบเป็น CLI Tool (`/home/dev/.local/bin/google-flow` -> `/home/dev/projects/homelab-server/google-flow/google-flow.js`) คู่กับ Antigravity Skill แทนการรัน MCP Server ค้างไว้ในหน่วยความจำ เพื่อรักษาเสถียรภาพของเครื่อง `homelab` (RAM 12 GB)
- **ใช้ได้กับทุก AI Provider & Script:** เรียกใช้ผ่าน CLI ได้ทันทีจาก Antigravity/Gemini, Claude Code, DeepSeek หรือ cron/script
- **แชร์การล็อกอิน Google ข้ามห้องแชท:** ใช้ Shared Auth Store ของ `lab-browser` (`/home/dev/.local/share/lab-browser/auth/shared.json`) และ `playwright-core` ที่มีอยู่แล้วโดยไม่ต้องติดตั้ง dependency เพิ่ม
- **รองรับ 2 โหมดการทำงาน:**
  1. **โหมด Live Browser Vision (`--session <bv_sess>`):** สั่งงานผ่าน `/home/dev/.local/bin/lab-browser session ... --session <bv_sess> --shared-auth` เพื่อให้เห็นการทำงานสดบนหน้าจอ Browser Vision และหยุดทันทีเมื่อพบ `paused: true` หรือ `handoff` (Login / OTP / CAPTCHA) — มี fallback ดึงภาพผ่าน `session eval` (`fetch` + `FileReader` / `<canvas>`) เผื่อ daemon เดิมที่เปิดค้างอยู่
  2. **โหมด Standalone Headless (ไม่ใส่ `--session`):** เปิด Chromium ผ่าน `lab-browser/lib/browser-core.js` (`authProfile: 'shared'`, `acceptDownloads: true`), ดัก network image response + เทียบ DOM snapshot ก่อน/หลังกด Generate เพื่อไม่หยิบรูปเก่า, ดาวน์โหลดแบบ 4 ชั้น (UI Download button -> `context.request.get` -> network buffer -> in-page `fetch`/`canvas`), ตรวจ magic bytes + ขนาดภาพจริง, merge คุกกี้กลับเข้า `auth-store` แล้วปิดเบราว์เซอร์คืน RAM ทันทีใน `finally`

## การล็อกอินครั้งแรก (ครั้งเดียวผ่าน Browser Vision)

1. เปิดหน้า Google Flow บน Browser Vision:
   ```bash
   /home/dev/.local/bin/google-flow login --session <bv_sess>
   ```
2. ลงชื่อเข้าใช้บัญชี Google ด้วยตนเองบนหน้าจอ Browser Vision (ห้ามให้ AI กรอกรหัสผ่านหรือแก้ CAPTCHA)
3. ตรวจสอบสถานะการล็อกอิน:
   ```bash
   /home/dev/.local/bin/google-flow status
   ```

## คำสั่งทั้งหมด

### 1. ตรวจสอบสถานะ Auth และการเข้าถึง Google Flow
```bash
/home/dev/.local/bin/google-flow status
/home/dev/.local/bin/google-flow status --session <bv_sess>
```
คืนค่า JSON `{ ok, authenticated, needsLogin, url, googleCookieCount, googleDomains }` (ไม่พิมพ์ค่าคุกกี้หรือโทเค็น)

### 2. เปิดหน้าล็อกอินใน Browser Vision
```bash
/home/dev/.local/bin/google-flow login --session <bv_sess>
```

### 3. สร้างภาพและดาวน์โหลดความละเอียดเต็ม (`generate` / `gen` / `image`)
```bash
/home/dev/.local/bin/google-flow generate "ลูกแมว 8 ขา น่ารักสมจริง แสงธรรมชาติ" --aspect 1:1
/home/dev/.local/bin/google-flow generate "cute 8-legged kitten" --session <bv_sess> --count 1
/home/dev/.local/bin/google-flow image "cyberpunk bangkok rain" --aspect 16:9 --all --out /home/dev/.gemini/outputs/google-flow/
```

ตัวเลือกที่รองรับ:
- `--session <bv_sess>` — รันบน Browser Vision เซสชันสด (ไม่ใส่ = โหมด Standalone Headless)
- `--aspect <ratio>` — อัตราส่วนภาพ (`16:9`, `4:3`, `1:1`, `3:4`, `9:16`)
- `--count <n>` — จำนวนภาพใหม่ที่ต้องการบันทึก (ค่าเริ่มต้น `1`)
- `--all` — บันทึกภาพใหม่ทั้งหมดที่ได้ในรอบนั้น
- `--model <name>` — ชื่อรุ่นโมเดล (เช่น `"Nano Banana"`)
- `-o, --out <path>` — ไฟล์หรือโฟลเดอร์ปลายทาง (อนุญาตเฉพาะใต้ `/home/dev/.gemini`, `/home/dev/projects`, `/tmp`)
- `--project-url <url>` — ระบุ URL โปรเจ็กต์เดิมของ Google Flow (`https://flow.google.com/project/<uuid>`)
- `--timeout <ms>` — เวลารอสูงสุดในการสร้างภาพ (ค่าเริ่มต้น `120000`)
- `--debug-shot` — เก็บภาพหน้าจอประกอบหลังจบงาน
- `--compact` — พิมพ์ JSON บรรทัดเดียว

ตัวอย่าง JSON ผลลัพธ์:
```json
{
  "ok": true,
  "mode": "standalone",
  "prompt": "ลูกแมว 8 ขา น่ารักสมจริง",
  "projectUrl": "https://flow.google.com/project/...",
  "elapsedMs": 18420,
  "images": [
    {
      "path": "/home/dev/.gemini/outputs/google-flow/20261128-021000_flow-8-xxxx.webp",
      "filename": "20261128-021000_flow-8-xxxx.webp",
      "mime": "image/webp",
      "width": 2400,
      "height": 3200,
      "sizeBytes": 412890,
      "method": "context_request",
      "viewUrl": "https://homelab.tail285279.ts.net/api/gemini/local-image?path=...",
      "downloadUrl": "https://homelab.tail285279.ts.net/api/gemini/local-file?path=...&download=1"
    }
  ]
}
```

### 4. สำรวจ DOM ปัจจุบัน (`inspect`)
ใช้เมื่อ Google ปรับหน้าเว็บในอนาคตเพื่อตรวจสอบปุ่ม/ช่องกรอก/การ์ดรูปภาพจริงพร้อมจับภาพหน้าจอ:
```bash
/home/dev/.local/bin/google-flow inspect [--session <bv_sess>] [--project-url <url>]
```

## รหัสออก (Exit Codes)

- `0` — สำเร็จ
- `2` — ต้องล็อกอิน, เซสชัน Browser Vision ถูก pause หรือพบ handoff (Login / OTP / CAPTCHA / TOS / Region)
- `1` — ข้อผิดพลาดอื่นๆ (อาร์กิวเมนต์ผิด, timeout, ไม่พบองค์ประกอบบนหน้าเว็บ ฯลฯ)

## ความปลอดภัยและข้อกำหนด

- ห้ามพิมพ์หรือ commit ค่าคุกกี้/โทเค็นจาก `shared.json`
- Path traversal guard จำกัดการเขียนไฟล์ให้อยู่ใต้ `/home/dev/.gemini`, `/home/dev/projects`, `/tmp` เท่านั้น
- ตรวจ magic bytes (PNG/JPEG/WEBP) และขนาดภาพจริง (`>= 256px` หรือ `>= 15 KB`, ปฏิเสธไอคอน `< 64px` และหน้า HTML error)
- ห้ามแก้ CAPTCHA หรือเดารหัสผ่านอัตโนมัติเด็ดขาด

## ทดสอบ (Unit Tests)
```bash
node --test /home/dev/projects/homelab-server/google-flow/test/google-flow.test.js
```
