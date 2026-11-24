# Thai Typography, Safe Zones & Audio Pipeline Reference

## 1. ฟอนต์ภาษาไทยบนเซิร์ฟเวอร์นี้ (พร้อมใช้แบบ Offline 100%)
ฟอนต์ถูกคัดลอกไว้ใน `/home/dev/.local/share/motion-studio/public/fonts/` เพื่อให้ Remotion โหลดผ่าน `staticFile('fonts/...')` ได้ทันทีโดยไม่ต้องรอ Google Fonts:
- `NotoSansThai-Regular.ttf` (`weight: 400`) — เนื้อหา, คำอธิบายย่อย
- `NotoSansThai-Bold.ttf` (`weight: 700`) — หัวข้อ, ป้ายขั้นตอน, ซับไตเติล (คม อ่านง่าย ทันสมัย)
- `NotoLoopedThai-Bold.ttf` (`weight: 700`) — ฟอนต์มีหัว อ่านชัดมากสำหรับข้อความสารคดีหรือผู้ชมทุกวัย

### กฎการจัดวางตัวอักษรไทยใน Remotion (ป้องกันสระขาด/ทับกัน)
1. **`lineHeight` อย่างน้อย `1.35` – `1.45`** (ภาษาไทยมีสระบน 2 ชั้น เช่น `ี้`, `ั้` และสระล่าง `ุ`, `ู` ถ้าใช้ `lineHeight: 1.0` แบบภาษาอังกฤษ สระจะชนกันทันที)
2. **ห้ามใส่ `overflow: 'hidden'` ชิดขอบข้อความโดยไม่มี `paddingTop: 8, paddingBottom: 8`** ไม่งั้นวรรณยุกต์ด้านบนจะถูกตัดแหว่ง
3. **ความยาวซับไตเติลต่อก้อน:** ควรอยู่ที่ **22–42 ตัวอักษรไทย** (ไม่เกิน 2 บรรทัด) เพื่อให้อ่านจบได้ภายใน 2–3.5 วินาที
4. **ความเร็วเสียงพูดไทยธรรมชาติ:** ประมาณ **13–16 ตัวอักษรไทย / วินาที** (ที่ `rate: +5%` ถึง `+10%`)
   - คลิป 30 วินาที ≈ 380–450 ตัวอักษรไทย (4–5 ซีน)
   - คลิป 45–50 วินาที ≈ 580–720 ตัวอักษรไทย (5–6 ซีน)
   - คลิป 60 วินาที ≈ 750–900 ตัวอักษรไทย (6–7 ซีน)

## 2. สัดส่วนและ Safe Zones

| รูปแบบ | ความละเอียด | FPS | Top Safe | Bottom Safe | Right Safe | เหมาะกับ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **9:16 Vertical** | `1080 × 1920` | `30` | `150px` | `260px` | `110px` | TikTok, Reels, YouTube Shorts |
| **16:9 Landscape** | `1920 × 1080` | `30` | `70px` | `120px` | `80px` | YouTube, สไลด์พรีเซนต์ |
| **1:1 Square** | `1080 × 1080` | `30` | `80px` | `140px` | `80px` | Facebook / IG Feed |

## 3. เสียงพากย์ไทย (Multi-Engine: Gemini 2.5 TTS / VachanaTTS / Edge-TTS)
รองรับ 3 เครื่องยนต์ใน `motion-studio tts` พร้อมระบบถนอมลมหายใจท้ายประโยค (`-55dB` + fade 30ms) และ Vocal Mastering อัตโนมัติ:
- **Google Gemini 2.5 TTS (`gemini:<Voice>`, แนะนำสูงสุดด้านความสมจริง):**
  - โมเดล: `gemini-2.5-flash-preview-tts` (เร็ว มี Free Tier ใน Google AI Studio) หรือ `gemini-2.5-pro-preview-tts` (Paid, อารมณ์ละเอียดสูงสุด)
  - เสียงยอดนิยม: `gemini:Aoede` (หญิงอบอุ่น), `gemini:Sulafat` (หญิงอ่อนโยน/ผ่อนคลาย/ไลฟ์สไตล์), `gemini:Kore` (หญิงชัดถ้อยชัดคำ/อธิบาย), `gemini:Charon` (ชายสุขุม/แนะนำศาสนา/สารคดี), `gemini:Algenib` (ชายนุ่มลึก), `gemini:Orus` (ชายหนักแน่น), `gemini:Puck` (ชายสดใส)
  - สไตล์ (`--style`): `religious` (แนะนำสำหรับคลิปศาสนา/ธรรมะ), `documentary`, `explainer`, `storytelling`, `warm`, `spiritual` หรือกำหนด `ttsPrompt` เฉพาะซีน + `narrationPhonetic` แยกคำอ่านพากย์ออกจากซับไตเติลได้ใน `script.json`
  - คีย์ API: เก็บไว้ที่ `/home/dev/projects/.tts.env` (`GEMINI_API_KEY=...`, `chmod 600`) ซึ่งใช้ร่วมกับ `stt-service` ได้ทันที
- **Local VachanaTTS (`vachana:th_f_1`, `th_f_2`, `th_m_1`, `th_m_2`):** ฟรี ออฟไลน์ 100% ผ่าน `stt-service`
- **Microsoft Edge Neural TTS (`en-US-AvaMultilingualNeural`, `en-US-AndrewMultilingualNeural`, `th-TH-NiwatNeural`, `th-TH-PremwadeeNeural`):** ฟรีผ่านอินเทอร์เน็ต *(หมายเหตุ: `Premwadee` อาจไม่เสถียรเป็นบางช่วง)*

### การคำนวณเฟรมจากเสียงจริง (Audio-First Timing)
**ห้ามเดาความยาวซีนแบบสุ่ม!** ให้รัน TTS ก่อนเสมอ:
1. เขียนไฟล์ `script.json` แบ่งเป็นซีน (`id`, `title`, `narration`, `subtitles`, `sfx`, `padAfterSec`)
2. รัน `/home/dev/.local/bin/motion-studio tts script.json -o <work_dir>`
3. ระบบจะสร้าง:
   - `narration_full.wav` (เสียงพากย์รวมทุกซีนพร้อมช่วงเว้นหายใจที่แม่นยำ)
   - `timeline.json` (ระบุ `startSec`, `endSec`, `startFrame`, `durationFrames`, `totalFrames`, และ `cues` ของซับไตเติลแต่ละบรรทัดแบบเป๊ะระดับมิลลิวินาที!)
   - `subtitles.srt` (ไฟล์ซับมาตรฐาน)
4. Remotion อ่าน `timeline.json` ผ่าน props ทำให้ภาพ แอนิเมชัน และซับไตเติล **ตรงจังหวะเสียงพูด 100% ทุกเฟรม**

## 4. ระบบผสมเสียง BGM & SFX (`motion-studio mix`)
ไฟล์เสียงสังเคราะห์ปลอดลิขสิทธิ์ 100% ใน `/home/dev/.local/share/motion-studio/assets/audio/`:
- **BGM:**
  - `bgm_warm_tech.wav` — โทนโมเดิร์น อบอุ่น สดใส (เหมาะกับ Tech/Explainer/Solar/Isometric)
  - `bgm_story_cinematic.wav` — โทนสารคดี น่าค้นหา (เหมาะกับ The Story Room / ประวัติศาสตร์)
- **SFX:**
  - `sfx_whoosh.wav` — เปลี่ยนซีน / กล้องเลื่อน
  - `sfx_pop.wav` — ป้าย/การ์ด/อาคารเด้งขึ้น
  - `sfx_chime.wav` — จบขั้นตอน / ติ๊กถูกสีเขียว / สรุปผล
  - `sfx_spark.wav` — จังหวะพลังงาน/แปลงไฟ/ไฮไลต์สำคัญ
  - `sfx_click.wav` — สวิตช์เปิด / ปุ่มกด UI

**มาตรฐานความดังเสียงผสม:**
- เสียงพากย์ (Voiceover): Normalize ประมาณ `-16 LUFS` (เด่นชัดที่สุด)
- เพลงพื้นหลัง (BGM): `-20 dB` ใต้เสียงพูด พร้อม Fade-in 1.0s และ Fade-out 2.0s
- SFX: `-10 dB` ถึง `-14 dB` สั้นคมไม่กลบคำพูด
