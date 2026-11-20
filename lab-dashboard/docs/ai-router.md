# 🧠 AI Router (สมองกลาง) — Design

อนุมัติโดยบังยี 2026-11-20 · แบบ B (ตัวคัดงานขนาดเล็ก + ตารางเส้นทาง + ตรวจโควตา)

## เป้าหมาย
1. **ประหยัดที่สุดก่อน** — ใช้บัญชีรายเดือน (Google Antigravity ทุกบัญชี, Claude Pro) ก่อนเสมอ
   **DeepSeek ใช้เป็นอันดับสุดท้าย** เพราะคิดเงินตามจริง
2. **ภายใต้ข้อ 1** เลือกโมเดลที่เก่งที่สุดที่เหมาะกับงาน
3. ใช้ได้ทั้ง **หน้าแชท** (เลือกโมเดล `🧠 Auto`) และ **งาน Cron** (`aiModel: "auto"`)

## ขั้นตอน
```
งาน → ① คัดงาน → ② ตารางเส้นทาง → ③ ตรวจโควตา → ④ รัน + ส่งต่อเมื่อพัง
```

### ① คัดงาน (`classifyTask`)
- **ทางลัด (ไม่เรียก AI):** ข้อความสั้น ≤ 40 ตัวอักษรที่ไม่มีคำเกี่ยวกับโค้ด → `quick`
- นอกนั้นเรียก `gemini-3.8-flash-low` ผ่าน `agy` (ไม่ใช้เครื่องมือ) ให้ตอบ JSON
  `{type: code|analysis|chat|quick, level: 1-3, needs_tools, reason}`
- ใช้เวลาจริง ~5–7 วินาที (วัดเมื่อ 2026-11-20) → **cache ตาม hash ของข้อความ** (2 ชม.)
  งาน cron ที่ prompt ซ้ำทุกรอบจึงคัดแค่ครั้งแรก
- คัดไม่สำเร็จ → ใช้ค่าเริ่มต้น `chat` ระดับ 2

### ② ตารางเส้นทาง (`ROUTES` ใน `ai-router.js`)
แต่ละ `type:level` มีรายชื่อโมเดลเรียงจากเก่ง → ด้อย ตัวอย่าง:

| งาน | ลำดับ |
|---|---|
| code:3 | Opus 5.5 High (agy) → Claude Code Opus → Hydrogen High → Sonnet 5.5 High |
| code:2 | Sonnet 5.5 High (agy) → Hydrogen Medium → Claude Code Sonnet → Opus 5.5 Medium |
| analysis:3 | Hydrogen XHigh → Opus 5.5 High (agy) → Claude Code Opus → Argon High |
| chat / quick | Flash Medium/Low → Hydrogen Low → Claude Code Haiku |
| ท้ายทุกแถว | DeepSeek (Pro หรือ Flash; มีรูปแนบ → Flash เท่านั้น) |

แก้ตารางได้ใน `ai-router.js` ที่เดียว

### ③ ตรวจโควตา (`buildCandidates`)
- โมเดลของ `agy` ถูกขยายเป็นทุกบัญชี Google ตามลำดับ **Google#1 → Google#2 → …**
- โควตาดึงจาก `getQuotaSummary()` ต่อบัญชี (cache 90 วินาที)
  - agy: pool `gemini` / `claude` / `argon` ตามชื่อโมเดล
  - Claude Pro: ค่าต่ำสุดของ 5 ชม. กับรายสัปดาห์
  - DeepSeek: มียอดเงิน > $0.10
- ลำดับผู้สมัครสุดท้าย = **(เหลือ > 20%) → (เหลือ 5–20%) → DeepSeek**
  ตัวที่เหลือ ≤ 5% ถูกตัดทิ้ง; อ่านโควตาไม่ได้ถือว่าเหลือ 50%

### ④ รัน + ส่งต่อ (failover)
- **แชท:** `executePrompt({model:'auto'})` → รันผู้สมัครตัวแรก ถ้าพังด้วยเหตุโควตา/สิทธิ์
  (429, quota, exhausted, rate limit, sign in, 401 …) **และยังไม่มีคำตอบ/ไม่ได้ใช้เครื่องมือ**
  → ส่งต่อตัวถัดไปเอง (สูงสุด 3 ครั้ง). ถ้าเริ่มแก้ไฟล์ไปแล้ว → หยุดและแจ้งผู้ใช้
- **Cron:** `cron-ai-runner.py` เรียก `POST /api/ai-router/route` แล้วไล่ลองตามรายชื่อ
  (agy / claude CLI / DeepSeek API แบบไม่ใช้เครื่องมือ); ถ้า router ล่ม → ใช้ `gemini-3.8-flash-low`

## หลายบัญชี Google
- บัญชีหลัก = `$HOME` ปกติ
- บัญชีเพิ่ม = โฟลเดอร์ใน `~/.agy-profiles/<ชื่อ>/` (เรียงตามชื่อ = Google#2, #3 …)
  ล็อกอิน: `mkdir -p ~/.agy-profiles/acc2 && HOME=~/.agy-profiles/acc2 ~/.local/bin/agy`
- ระบบเห็นบัญชีเมื่อมีไฟล์ `.gemini/antigravity-cli/antigravity-oauth-token`
- `agy` ถูก spawn ด้วย `HOME=<บัญชี>`; ห้องแชทที่สลับบัญชีจะเริ่ม conversation ใหม่พร้อมสรุปบริบท 6 ข้อความล่าสุด

## สิ่งที่ผู้ใช้เห็น
- คำตอบทุกครั้งขึ้นต้นด้วยป้าย เช่น
  `> 🧠 Auto → Claude Opus 5.5 (High) · Google#1 (เหลือ 98%) — code ระดับ 3: …`
- เลือกโมเดลเองได้ตามปกติ (Auto เป็นแค่ตัวเลือกหนึ่ง)
- บันทึกทุกการตัดสินใจ: `~/.gemini/ai-router-log.jsonl` · ดูผ่าน `GET /api/ai-router/log`

## ข้อจำกัด
- ตัวคัดงานอาจประเมินผิด → ปรับ `ROUTES` จาก log
- Auto เพิ่มเวลา ~6 วินาทีต่อข้อความที่ไม่โดน cache/ทางลัด
- DeepSeek ใน cron ไม่มีเครื่องมือ (ตอบจากข้อมูลที่ส่งให้เท่านั้น)
