---
name: daily-news-broadcast
description: Daily News Broadcast v2 — สร้างคลิปรายการข่าวเช้าแบบผู้ประกาศข่าวทีวี (6 ข่าว ไทย+ต่างประเทศ ข่าวละ 2 ซีน ~3.5 นาที) พร้อมภาพ og:image และคลิปข่าวจริง 5–10 วินาที, freshness guard, ส่ง Telegram อัตโนมัติ ผ่าน /home/dev/projects/daily-news-clip.py + Video Studio (contentMode news). ใช้เมื่อผู้ใช้ขอ 'สรุปข่าว', 'คลิปข่าวเช้า', 'ข่าวเด็ดเมื่อวาน', 'daily news', 'news broadcast' หรือให้รันซ้ำหรือแก้คลิปข่าว
---

# Daily News Broadcast v2

สกิลสำหรับรัน ตรวจสอบ และแก้ไขงานสร้างคลิปรายการสรุปข่าวเช้าแบบผู้ประกาศข่าวทีวีอัตโนมัติบน Homelab ผ่าน `/home/dev/projects/daily-news-clip.py` และ Video Studio Pipeline (`studio_job.py` + `news_media.py`)

## สถานะ
- **Daily News Broadcast v2** ผ่านการอนุมัติจากผู้ใช้เมื่อ **2026-11-27** ให้ใช้เป็นมาตรฐานรายการข่าวทุกเช้า (baseline commit `feb514d` ใน repo `/home/dev/projects/homelab-server`)
- **คำเตือน:** ห้ามรัน `daily-news-clip.py` แบบเต็มโดยไม่จำเป็นระหว่างการทดสอบ/ตรวจงาน (ใช้ทรัพยากรสูงและเสียโควตา) ให้ใช้ `--dry-run` แทนเมื่อต้องการตรวจเฉพาะการสร้าง payload

## Quick Start
รันด้วย full path (Cron และ PM2 ไม่มี `~/.local/bin` ใน `PATH` เริ่มต้น):

```bash
# 1) รันมาตรฐาน (ข่าวเมื่อวานตามเวลา Asia/Bangkok, 210s, look-32, warm_tech, ส่ง Telegram)
/usr/bin/python3 /home/dev/projects/daily-news-clip.py

# 2) ระบุวันที่และพารามิเตอร์เอง
/usr/bin/python3 /home/dev/projects/daily-news-clip.py --date 2026-11-26 --duration 210 --style look-32 --bgm warm_tech

# 3) Dry-run: สร้างเฉพาะโฟลเดอร์งาน + request.json / job.json โดยไม่เรียก studio_job.py
/usr/bin/python3 /home/dev/projects/daily-news-clip.py --date 2026-11-26 --dry-run

# 4) รันครบ pipeline แต่ไม่ส่งผลลัพธ์เข้า Telegram
/usr/bin/python3 /home/dev/projects/daily-news-clip.py --date 2026-11-26 --no-telegram
```

**ตัวเลือก CLI ที่รองรับ (`parse_args`):**
- `--date YYYY-MM-DD`: วันที่ของข่าว (ค่าเริ่มต้น: เมื่อวานตามเวลา `Asia/Bangkok`)
- `--duration <sec>`: ความยาวเป้าหมายเป็นวินาที `12`–`300` (ค่าเริ่มต้น: `210`)
- `--style <id>`: รหัสสไตล์ Video Studio รูปแบบ `^[a-z0-9-]{6,40}$` (ค่าเริ่มต้น: `look-32`)
- `--bgm <preset>`: `warm_tech` (ค่าเริ่มต้น), `story_cinematic`, `dawn_ambient`, `none`
- `--dry-run`: สร้างเฉพาะโฟลเดอร์งานและ `request.json`/`job.json`
- `--no-telegram`: ปิดการส่งข้อความสรุปเข้า Telegram

## ค่ามาตรฐาน v2
| พารามิเตอร์ | ค่ามาตรฐาน | หมายเหตุจากโค้ดจริง |
|---|---|---|
| ความยาวเป้าหมาย | `210` วินาที (~3.5 นาที) | โหมดข่าว (`contentMode == "news"`) ขยายได้สูงสุด `300` วินาที |
| จำนวนซีน | `14` ซีน | `studio_job.py` กำหนด `14` ซีนเมื่อ `duration_sec >= 140` (เปิด 1 + 6×2 + ปิด 1) |
| สไตล์ภาพ | `look-32` | ตั้งค่าผ่าน `DEFAULT_STYLE` |
| เพลงประกอบ (`bgm`) | `warm_tech` | อนุญาต: `warm_tech`, `story_cinematic`, `dawn_ambient`, `none` |
| เสียงบรรยาย | `gravitas` | น้ำเสียงผู้ประกาศข่าวจริงจัง ชัดเจน (`is_news_request` ใช้ `gravitas`) |
| โหมดงาน | `contentMode: "news"`, `newsMedia: true` | แนบ `storyDate` (`YYYY-MM-DD`) และ `mode: "oneshot"` ใน `request.json` |

**โครงสร้างเนื้อหาข่าว (`build_topic()`, `build_notes()`):**
- คัด **6 ข่าวเด่น** ของวันเป้าหมาย (ข่าวในประเทศไทย และข่าวต่างประเทศ **อย่างละอย่างน้อย 2 ข่าว**) ครอบคลุมประเด็นใหญ่ เช่น การเมือง เศรษฐกิจ เหตุการณ์ใหญ่ เทคโนโลยี กีฬา สังคม
- **ข่าวละ 2 ซีน** เล่าแบบผู้ประกาศข่าวทีวีให้เข้าใจเรื่องราวครบ:
  - **ซีน 1:** เกิดอะไรขึ้น ที่ไหน เมื่อไร ใครเกี่ยวข้อง รายละเอียดเหตุการณ์และตัวเลขสำคัญจากแหล่งข่าวจริง
  - **ซีน 2:** เบื้องหลังที่มาที่ไป สาเหตุ ผลกระทบต่อประชาชน/เศรษฐกิจ ท่าทีของหน่วยงาน และสิ่งที่ต้องติดตามต่อ
- มี **ซีนเปิด** ทักทายบอกวันที่และภาพรวมข่าวเด่น + **ซีนปิด** สั้นๆ
- **ข้อห้ามเด็ดขาด:** ห้ามใช้ข่าวเก่ากว่าวันที่กำหนด, ห้ามแต่งตัวเลข/สถิติเอง (ต้องมี URL หน้าข่าวจริง), ห้ามเขียนสั้นแบบสไลด์ผู้บริหารหรือสรุปท่องจำ, ห้ามมีคำคมหรือสรุป 3 คำ และห้ามมีคำต้องห้ามกลุ่มศาสนา (`assert_non_religious()`)

## Pipeline
ลำดับการทำงานตั้งแต่ต้นจนจบ:
1. **Lock & Idempotency (`acquire_lock`)**: จับ lock ที่ `/tmp/daily-news-clip.lock` ด้วย `fcntl.flock` ป้องกันการรันซ้อน; หากงาน `daily-news-YYYYMMDD` มี `status == "done"` แล้วจะข้าม (`[skip]`)
2. **เตรียมโฟลเดอร์งาน**:
   - สร้าง `/home/dev/.gemini/outputs/video-studio/jobs/daily-news-YYYYMMDD/`
   - เขียน `request.json` (`id`, `topic`, `styleId`, `durationSec`, `mode`, `bgm`, `sendTelegram`, `notes`, `contentMode`, `newsMedia`, `storyDate`) และ `job.json` แบบ atomic
   - หากมีงานเดิมที่ไม่ `done` และยังไม่มี `script.json` จะเรียก `archive_failed_job()` ย้ายไป `daily-news-YYYYMMDD-retryN` แล้วเริ่มใหม่
3. **เปิดงาน Video Studio (`studio_job.py oneshot`)**: รันผ่าน `/home/dev/.local/share/motion-studio/venv/bin/python /home/dev/.local/share/motion-studio/scripts/studio_job.py oneshot --job <job_dir>` (timeout `3600` วินาที, ไม่ตั้ง `MOTION_REMOTE_RENDER` เพื่อเปิด offload อัตโนมัติ)
4. **News Research + Freshness Guard**:
   - `build_news_research_prompt()` สั่งค้นข่าวจริงพร้อม URL ต้นฉบับ 1–2 ลิงก์และคำค้น YouTube 1 วลี
   - `ensure_fresh_news()` เรียก `check_research_freshness(max_age_days=3)` ตรวจ `page_published_date()` ของทุกลิงก์; ถ้าพบข่าวปีเก่า/เก่ากว่าเกณฑ์ จะบันทึกของเดิมไว้ที่ `research_stale.md` แล้วสั่ง re-research **1 ครั้ง** (หากรอบสองข่าวสดที่ใช้ได้ `ok2 < 4` จะ raise error ทันที)
5. **Script (`build_script_prompt(news=True)`)**: สร้าง `script.json` แบบ 14 ซีน (ความยาว narration ไม่ต่ำกว่า 80% ของเป้ารวม, สไตล์เสียง `gravitas`)
6. **ภาพและคลิปข่าวจริง (`attach_news_media`)**:
   - ดึงภาพปกบทความจริง (`fetch_article_image()` จาก `og:image`)
   - ค้นคลิปข่าว YouTube (`search_news_video()`) และดาวน์โหลดตัดเป็นคลิปสั้นไม่มีเสียง (`download_clip()` ใช้ `uvx yt-dlp` + `--dateafter`, `-an`, ความยาวคลิปตามตั้งค่าในโมดูล 5–10 วินาที พร้อมสร้าง `_poster.jpg` / `_frame2.jpg`)
   - เก็บไฟล์ไว้ที่ `/home/dev/.local/share/motion-studio/public/news-media/<slug>/` (`_prune_old()` เก็บเฉพาะ **3 งานล่าสุด**) และเรนเดอร์ใน Remotion ผ่าน `NewsMediaScene.tsx`
7. **TTS → Render → Mix → Preview**: สร้างเสียงบรรยาย, offload งานเรนเดอร์ไปยัง worker nodes ผ่าน `motion-studio` / `/home/dev/.local/bin/agent-ctl`, มิกซ์เสียง BGM, สร้าง preview และส่งออกวิดีโอไปยัง `/home/dev/.gemini/outputs/videos/`
8. **Telegram Notification**: อ่านยอดเครดิต (`read_credit_info()`) แล้วส่งรายงานผล HTML (`format_success_html()` / `format_error_html()` ผ่าน `send_telegram_html()`)

## Cron
ตั้งเวลารันอัตโนมัติทุกเช้า **07:30 น.** (`HOMELAB_CRON` id `daily_news_clip`):

```cron
30 7 * * * /usr/bin/python3 /home/dev/projects/daily-news-clip.py >> /home/dev/projects/lab-dashboard/cron-logs/daily_news_clip.log 2>&1
```

- **Log path:** `/home/dev/projects/lab-dashboard/cron-logs/daily_news_clip.log`
- **ข้อห้าม:** ห้ามแก้ cron นี้โดยไม่ได้รับคำสั่ง และห้าม `pm2 restart lab-dashboard`

## งานล้มหรือรันต่อ (Resume)
1. **ตรวจ Lock ก่อนรันใหม่เสมอ:**
   ```bash
   ls -l /tmp/daily-news-clip.lock && fuser /tmp/daily-news-clip.lock 2>/dev/null || true
   ```
2. **รันต่ออัตโนมัติหรือสั่ง CLI `resume`:**
   - หากงานเดิมใน `/home/dev/.gemini/outputs/video-studio/jobs/daily-news-YYYYMMDD/` มี `script.json` อยู่แล้ว เมื่อรัน `daily-news-clip.py` ซ้ำ สคริปต์จะสลับไปโหมด `resume` ในโฟลเดอร์เดิมให้อัตโนมัติ (ข้ามขั้นที่ output ใหม่กว่า input)
   - หรือสั่ง `studio_job.py resume` โดยตรง:
     ```bash
     /home/dev/.local/share/motion-studio/venv/bin/python /home/dev/.local/share/motion-studio/scripts/studio_job.py resume --job /home/dev/.gemini/outputs/video-studio/jobs/daily-news-YYYYMMDD
     ```
   - หากงานเดิมพังตั้งแต่ช่วงวิจัยข่าว (ยังไม่มี `script.json`) `daily-news-clip.py` จะย้ายงานเดิมไป `<jobId>-retryN` แล้วเริ่มสร้างใหม่ให้เอง
3. **สั่งผ่านหน้าเว็บ Video Studio:** กดปุ่ม **`▶️ ทำงานต่อ`** บนการ์ดงาน (เรียก `POST /jobs/<id>/resume`)

## Troubleshooting
- **ได้ข่าวปีเก่า / วันตรงกันแต่คนละปี:**
  - ตรวจสอบ `research_stale.md` และ log `[news-fresh]` ใน `job_dir/log.txt`
  - `ensure_fresh_news()` + `check_research_freshness(max_age_days=3)` จะคัดข่าวที่ URL หรือ `page_published_date()` เก่าเกินออกและ re-research 1 ครั้ง (ถ้าข่าวสด `< 4` งานจะ fail เพื่อกันข่าวเก่าออกอากาศ)
- **ก๊อปปี้วิดีโอผ่าน symlink แล้วพัง:**
  - `/home/dev/.gemini/outputs/videos` เป็น **symlink** ไปยัง `/mnt/gdrive/Homelab-Videos` — ก่อน copy หรือส่งไฟล์ให้ตรวจ path จริงด้วย `readlink -f /home/dev/.gemini/outputs/videos/<file>.mp4` เสมอ
- **โควตา AGY 429 / Rate Limit:**
  - `studio_job.py` ใช้ `run_agy_with_fallback()` สลับโมเดลสำรองให้อัตโนมัติ หากล้มทุกโมเดลให้รอโควตาฟื้นแล้วสั่ง `resume` ต่อจากจุดเดิม
- **Error คำต้องห้ามกลุ่มศาสนา (`assert_non_religious`):**
  - ระบบตรวจ `RELIGIOUS_KEYWORDS` ใน `topic` และ `notes` ก่อนเริ่มงานเพื่อไม่ให้ข่าวชนกับ religious mode — หลีกเลี่ยงการใช้คำในกลุ่มดังกล่าวใน prompt ข่าว

## กฎส่งงาน (บังคับ)
1. **ส่งคลิปเข้า Telegram อัตโนมัติทุกครั้ง:** ใช้ `/home/dev/.local/bin/motion-studio send-telegram /home/dev/.gemini/outputs/videos/<slug>.mp4 "<caption>"` (หรือปล่อยให้ `daily-news-clip.py` ส่งสรุป HTML ผ่าน `notify-telegram.py`; `send-telegram` จะบีบอัดสำเนา `_telegram.mp4` ให้ไม่เกิน 48 MB อัตโนมัติโดยคง Master ไว้)
2. **แนบลิงก์ Master Video & Download ในแชทเสมอ:**
   - Watch/Stream: `https://homelab.tail285279.ts.net/api/gemini/local-file?path=/home/dev/.gemini/outputs/videos/<slug>.mp4`
   - Download: `https://homelab.tail285279.ts.net/api/gemini/local-file?path=/home/dev/.gemini/outputs/videos/<slug>.mp4&download=1`
3. **รายงานค่าใช้จ่ายต่อคลิป (THB) และเครดิตคงเหลือ:** ตรวจจากผลลัพธ์งานหรือ `/home/dev/.local/bin/motion-studio credit` และ **เตือนผู้ใช้ชัดเจนหากเครดิตคงเหลือ `< 10` THB** (`LOW_CREDIT_THB = 10.0`)
4. **Offload งานหนักเสมอ:** ห้ามเรนเดอร์ Remotion/FFmpeg หนักบน `homelab` ให้ offload ไปเครื่องลูกข่ายผ่าน `motion-studio` / `/home/dev/.local/bin/agent-ctl` เสมอ (ดูสกิล `offload-jobs` และ `motion-video-studio`; ห้ามตั้ง `MOTION_REMOTE_RENDER=off`)

## ไฟล์ที่เกี่ยวข้อง
- **สคริปต์หลัก (Live & Monorepo):** `/home/dev/projects/daily-news-clip.py`, `/home/dev/projects/homelab-server/scripts/daily-news-clip.py`
- **Pipeline & News Media:** `/home/dev/.local/share/motion-studio/scripts/studio_job.py`, `/home/dev/.local/share/motion-studio/scripts/news_media.py`, `/home/dev/.local/share/motion-studio/src/studio/NewsMediaScene.tsx`
- **CLI & แจ้งเตือน:** `/home/dev/.local/bin/motion-studio`, `/home/dev/.local/bin/agent-ctl`, `/home/dev/projects/notify-telegram.py`
- **Outputs & Media Cache:** `/home/dev/.gemini/outputs/video-studio/jobs/`, `/home/dev/.gemini/outputs/videos` (`-> /mnt/gdrive/Homelab-Videos`), `/home/dev/.local/share/motion-studio/public/news-media/`
- **Cron Log & Lock:** `/home/dev/projects/lab-dashboard/cron-logs/daily_news_clip.log`, `/tmp/daily-news-clip.lock`
- **สกิลและเอกสารอ้างอิง:** `/home/dev/.gemini/antigravity-cli/skills/motion-video-studio/SKILL.md`, `/home/dev/.gemini/antigravity-cli/skills/offload-jobs/SKILL.md`, `/home/dev/.claude/CLAUDE.md`, `/home/dev/projects/homelab-server/CLAUDE.md`, `/home/dev/projects/homelab-server/AGENTS.md`, `/home/dev/.gemini/MEMORY.md`
