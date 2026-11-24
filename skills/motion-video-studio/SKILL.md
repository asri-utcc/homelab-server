---
name: motion-video-studio
description: >-
  Create professional animated explainer videos, vertical 9:16 storytelling clips (Reels/TikTok/Shorts),
  Remotion + Three.js/SVG motion graphics (46 curated visual styles + documentary storytelling),
  Thai Edge-TTS voiceover with synced subtitles, auto-ducked BGM & SFX mixing, AND standalone
  interactive HTML/SVG/Three.js motion diagrams for web & presentations. Use whenever the user asks
  to create a video clip, explainer animation, storytelling video, motion graphic, or animated
  system diagram (e.g. "สร้างคลิป", "ทำวิดีโอเล่าเรื่อง", "ทำคลิปอธิบาย", "ทำแอนิเมชัน",
  "Remotion", "แผนภาพเคลื่อนไหว").
---

# Motion Video Studio (Remotion + Thai Voiceover + 46 Styles + Interactive Web)

End-to-end local video & motion-diagram production studio running on this homelab server.
Covers **all aspects**: storytelling scripts, 46 curated motion-design styles, reusable **Cinematic FX Library** (`src/components/fx`), Thai neural voiceover (`edge-tts`) with word-level karaoke subtitles, royalty-free BGM/SFX mixing with voiceover-keyed sidechain ducking & EBU R128 loudness normalization, Remotion + Three.js/SVG MP4 rendering, visual QA inspection, and interactive HTML web diagrams.

## Tool & Paths
- **CLI (always call by full path — PM2 PATH lacks `~/.local/bin`):** `/home/dev/.local/bin/motion-studio`
- **Engine workspace:** `/home/dev/.local/share/motion-studio/` (Node + Remotion 4 + Three.js + Playwright `chrome-headless-shell` 1255 (do NOT switch back to full `chromium-1255` Chrome — it causes dark flickering tile blocks in rendered frames) + Python `edge-tts` venv + FFmpeg 7)
- **Cinematic FX library:** `/home/dev/.local/share/motion-studio/src/components/fx/` (`index.ts` — 100% deterministic components using Remotion `random(seed)` / `interpolate` / `spring`, never `Math.random()`)
- **Offline fonts (`public/fonts/`):** `NotoSansThai-Regular.ttf`, `NotoSansThai-Bold.ttf`, `NotoLoopedThai-Bold.ttf`, `NotoNaskhArabic-Regular.ttf`, `NotoNaskhArabic-Bold.ttf` (loaded by `src/components/ThaiFontLoader.tsx`)
- **Audio assets (royalty-free):** `/home/dev/.local/share/motion-studio/assets/audio/`
  - **BGM:** `bgm_warm_tech.wav` (marimba + pad), `bgm_story_cinematic.wav` (documentary pad + piano-bell), **`bgm_dawn_ambient.wav`** *(pure Dsus2 drone + morning breeze — no drums, no rhythm, no melody)*
  - **SFX:** `sfx_whoosh.wav`, `sfx_pop.wav`, `sfx_chime.wav`, `sfx_spark.wav`, `sfx_click.wav`, **`sfx_riser.wav`** *(1.5s airy transition swell)*, **`sfx_shimmer.wav`** *(1.2s crystalline reveal)*, **`sfx_soft_impact.wav`** *(0.8s warm sub emphasis)*
- **Output directory:** `/home/dev/.gemini/outputs/videos/` (whitelisted for inline PNG/GIF previews in `lab-dashboard` chat)
  - **Stored on Google Drive (2026-11-23):** this path is a symlink to `/mnt/gdrive/Homelab-Videos` (rclone union of 2 × 5 TB accounts, `rclone-gdrive.service`). Keep using the `~/.gemini/outputs/videos/...` path in commands and links. If the mount is down, writes fail on purpose (bare mountpoint is read-only) — run `systemctl status rclone-gdrive` / `sudo systemctl restart rclone-gdrive`. Put scratch/work files in `/tmp`, not here.
- **Health & credit check:** `/home/dev/.local/bin/motion-studio doctor` and `/home/dev/.local/bin/motion-studio credit`

## Progressive Disclosure Reference Library (Read ONLY What You Need)
Do NOT load all reference files at once. Pick the target style/aspect first, then read ONLY the relevant file(s):

1. **Cinematic FX Kit, Scene Recipes & `DhuhaBenefits` Reference:** [references/cinematic-wow-kit.md](./references/cinematic-wow-kit.md) *(read when building cinematic FX clips, karaoke subtitles, or religious/inspirational reels)*
2. **Storytelling Documentary (แนว The Story Room 9:16):** [references/storytelling-documentary.md](./references/storytelling-documentary.md)
3. **Thai Typography, Safe Zones & Audio Rules:** [references/thai-typography-audio.md](./references/thai-typography-audio.md) *(read before every Thai video)*
4. **Interactive Web & Presentation Diagrams (HTML/SVG/Three.js):** [references/web-motion-guide.md](./references/web-motion-guide.md)
5. **46 Curated Animation Styles** *(adapted from Shaan Johari `@viashaan` / Moshikub)*:
   - **หมวด 1 — ลุคช่อง YouTube (9 แบบ):** [references/cat-youtube-looks.md](./references/cat-youtube-looks.md)
     `look-1` Glow World · `look-2` Flat Cartoon · `look-3` Hologram · `look-4` Red Relief · `look-5` Ink Doodle · `look-6` Deep Time · `look-7` Neon Silhouette · `look-8` POV Doodle · `look-9` Blue Grid
   - **หมวด 2 — งาน 3D (9 แบบ):** [references/cat-3d-objects.md](./references/cat-3d-objects.md)
     `look-10` Product Turntable · `look-11` Money Stack · `look-12` Card Flip · `look-13` Receipt · `look-14` Iceberg · `look-15` Text Thread · `look-16` Scale Lineup · `look-17` Milestone Trophy · `look-18` Donut Breakdown
   - **หมวด 3 — เปรียบเทียบและข้อมูล (9 แบบ):** [references/cat-data-compare.md](./references/cat-data-compare.md)
     `look-19` Globe Arcs · `look-20` Laptop Reveal · **`look-21` Isometric Flow** · `look-22` Notification Stack · `look-23` Before & After Slider · `look-24` Ranking Bars · `look-25` Social Post Receipt · `look-26` Day Counter · `look-27` Versus
   - **หมวด 4 — เทคนิคคลิป (9 แบบ):** [references/cat-video-tech.md](./references/cat-video-tech.md)
     `look-28` 3D Map Route · **`look-29` Exploded Teardown** · `look-30` Ink Wash · `look-31` Paper Desk · `look-32` Headline Highlight · `look-33` Stat Chart · `look-34` App Mockup · `look-35` Screen-Recording Zoom · `look-36` Timeline
   - **หมวด 5 — กราฟิกเคลื่อนไหว (10 แบบ):** [references/cat-motion-graphics.md](./references/cat-motion-graphics.md)
     `look-37` Glow Orb · `look-38` Split Type · `look-39` Frosted UI · `look-40` Apple One-Shot · `look-41` CRT Monitor · `look-42` Oscilloscope · `look-43` Magazine Cutout · `look-44` Risograph Print · `look-45` Swiss Grid · `look-46` Pencil to Blueprint

Search styles anytime via CLI: `/home/dev/.local/bin/motion-studio styles --search "isometric"`

## Cinematic FX Library (`src/components/fx`)
Import reusable deterministic FX primitives from `../../components/fx` (see [references/cinematic-wow-kit.md](./references/cinematic-wow-kit.md) for scene recipes and `DhuhaBenefits.tsx` example):

| Export | Purpose | Main Props & Defaults |
| :--- | :--- | :--- |
| **`DawnSky`** | Pre-dawn indigo → twilight → golden morning gradient + stars + sun + mist | `progress` (`0.5`), `sunX` (`0.5`), `sunYStart` (`0.84`), `sunYEnd` (`0.24`), `sunScale` (`1`), `showStars` (`true`), `showHorizonHaze` (`true`) |
| **`LightRays`** | Volumetric rotating god-ray beams (screen-blended SVG) | `count` (`12`), `color` (`'#FFD9A0'`), `intensity` (`0.45`), `originX` (`0.5`), `originY` (`0.28`), `rotationSpeed` (`3.2`), `blur` (`16`), `seed` (`'god-rays'`) |
| **`ParticleField`** | Floating luminous motes & bokeh orbs with depth parallax | `count` (`80`), `seed` (`'particles'`), `color` (`'#FFE8B6'`), `drift` (`28`), `size` (`4.5`), `opacity` (`0.85`), `bokehRatio` (`0.28`), `blendMode` (`'screen'`) |
| **`KineticTitle`** | Word-by-word Thai (`Intl.Segmenter`) spring headline with gradient keywords | `text`, `startFrame` (`0`), `highlight`, `accent` (`'#FFD166'`), `accentSecondary` (`'#FFF4DC'`), `fontSize` (`58`/`64`), `align` (`'center'`), `color` (`'#FFFFFF'`), `staggerFrames` (`3`), `fontFamily` (`THAI_FONT_FAMILY`) |
| **`transitionStyle` + `LightLeakFlash`** | Zero-black-frame scene transitions (without `@remotion/transitions`) + golden cut flash | `transitionStyle(localFrame, durationFrames, kind='lightLeak', fps=30, options?)` (`'lightLeak' \| 'zoomThrough' \| 'iris' \| 'fade'`); `LightLeakFlash`: `at` (`number \| number[]`), `durationFrames` (`18`), `color` (`'#FFD9A0'`), `secondaryColor` (`'#F28C5B'`), `intensity` (`0.92`) |
| **`CameraRig`** | Smooth cubic Ken-Burns zoom, pan, and micro-roll wrapper | `children`, `zoomFrom` (`1`), `zoomTo` (`1.08`), `panX` (`0`), `panY` (`0`), `rotate` (`[0, 0]`), `startFrame` (`0`), `durationFrames`, `origin` (`'50% 50%'`) |
| **`FilmGrainVignette`** | Deterministic SVG `feTurbulence` film grain + soft lens vignette | `grain` (`0.06`), `vignette` (`0.55`), `vignetteColor` (`'#050816'`), `grainFrequency` (`0.78`), `updateEveryFrames` (`2`) |
| **`CountUp`** | Cubic-eased tabular number counter with completion spring pop & glow | `from` (`0`), `to` (`100`), `startFrame` (`0`), `durationFrames` (`45`), `format`, `decimals` (`0`), `prefix`, `suffix`, `popScale` (`1.14`), `popGlowColor` |
| **`KaraokeSubtitle`** | Word-by-word karaoke captions synced to TTS `wordBoundaries` | `cues`, `wordBoundaries`, `sceneSpeechStartSec` (`0`), `accentColor` (`'#FFD166'`), `bottomOffset` (`280`/`88`), `theme` (`'dark' \| 'light'`), `fontSize` |
| **`ArabicText`** | RTL Arabic calligraphy (`Noto Naskh Arabic`) with RTL wipe reveal & diacritic-safe padding | `text`, `fontSize` (`46`/`54`), `color` (`'#FFF4DC'`), `glow` (`true`), `startFrame` (`0`), `durationFrames` (`36`), `progress`, `align` (`'center'`), `maxWidth` |
| **`IslamicPattern`** | Seamless rotating 8-pointed Rub el Hizb geometric lattice overlay | `opacity` (`0.08`), `rotate`, `color` (`'#FFD9A0'`), `tileSize` (`160`), `strokeWidth` (`1.2`), `rotationSpeed` (`1.2`) |

## End-to-End Video Production Workflow (Audio-First + Visual QA)

### Step 1: Match Goal → Format & Style
- **คลิปอธิบายระบบ/ขั้นตอน ("ทำงานยังไง", "เริ่มตรงไหน-จบที่ไหน"):** ใช้ `look-21` Isometric Flow + `look-29` Exploded Teardown (สัดส่วน `9:16` สำหรับมือถือ หรือ `16:9` สำหรับพรีเซนต์)
- **คลิปเล่าเรื่อง/สารคดี/ประวัติศาสตร์/สถานที่:** ใช้ `storytelling-documentary` + `look-28` 3D Map Route / `look-31` Paper Desk
- **คลิปแรงบันดาลใจ/ศาสนา/ซีนอารมณ์ระดับ Cinematic:** ใช้ **`cinematic-wow-kit.md`** (`DawnSky` + `LightRays` + `ParticleField` + `CameraRig` + `KaraokeSubtitle` + `bgm_dawn_ambient`)
- **คลิปสั้น 5–10 วิ โชว์สินค้า/ตัวเลข:** เลือกจาก `cat-3d-objects`, `cat-data-compare`, หรือ `cat-motion-graphics`
- **แผนภาพโต้ตอบบนเว็บ/สไลด์:** ทำ Interactive HTML ตาม `web-motion-guide.md` (ทำควบคู่กับคลิป MP4 ได้)

### Step 2: Script & Audio-First Timing (ห้ามเดาเฟรมเอง!)
1. วางบทเล่าเรื่องตามโครงสร้าง **Hook → Start → Step-by-Step Mechanism → End/Result → Recap/CTA** (ความเร็วไทย ~13–16 ตัวอักษร/วินาที; คลิป 45 วิ ≈ 600–700 ตัวอักษร แบ่ง 5–6 ซีน; คลิป 60–75 วิ ≈ 750–950 ตัวอักษร แบ่ง 6–7 ซีน)
2. เขียนไฟล์ `script.json` แยกแต่ละซีน พร้อม `narration`, `subtitles` (ท่อนละ 22–42 ตัวอักษร พร้อม `highlight` คำสำคัญ), `sfx`, `padAfterSec` (และฟิลด์อ้างอิง/อาหรับ เช่น `source`, `arabic`, `arabicMeaning` หากมี)
3. รัน TTS สร้างเสียงพากย์ + `timeline.json` (พร้อม `wordBoundaries` และ `speechStartSec` สำหรับ `KaraokeSubtitle`) + `subtitles.srt`:
   ```bash
   # แนะนำ (สมจริงระดับสตูดิโอ): Google Gemini 2.5 Flash/Pro TTS (ต้องมี GEMINI_API_KEY ใน /home/dev/projects/.tts.env)
   /home/dev/.local/bin/motion-studio tts /path/to/script.json -o /tmp/work_dir \
     --voice gemini:Charon --style religious --model gemini-2.5-flash-preview-tts

   # ทดสอบฟังเสียง Gemini 2.5 TTS หลายโทนพร้อมส่ง Telegram
   /home/dev/.local/bin/motion-studio gemini-test --voices Charon,Algenib,Orus --style religious --send-telegram

   # ออฟไลน์ / ฟรี: VachanaTTS Local (`vachana:th_f_1`) หรือ Edge-TTS (`en-US-AvaMultilingualNeural`, `th-TH-NiwatNeural`)
   /home/dev/.local/bin/motion-studio tts /path/to/script.json -o /tmp/work_dir --voice vachana:th_f_1 --style documentary
   ```
   *(ดูรายการเสียงและสถานะคีย์ด้วย `motion-studio tts --list-voices`; รองรับฟิลด์ `narrationPhonetic` และ `ttsPrompt` รายซีนใน `script.json` พร้อมระบบตัดเงียบแบบถนอมลมหายใจ `-55dB` และ Studio Vocal Mastering อัตโนมัติ)*

### Step 3: Build Remotion Composition Following Style Spec & Anti-Patterns
- สร้างโปรเจกต์ใน `/home/dev/.local/share/motion-studio/src/projects/<slug>/` และลงทะเบียนใน `src/Root.tsx`
- อ่านค่าความยาว ซีน `wordBoundaries` และคิวซับไตเติลจาก `timeline.json` (`calculateMetadata` หรือ `--props`)
- **บังคับใช้กฎ Spec ของสไตล์ที่เลือก:**
  - ใช้ Hex palette เป๊ะตาม Spec และเคารพ Negative Color Rules (ห้ามแอบเติมสี/glow ที่ Spec ห้าม)
  - ใช้ `ThaiFontLoader` (`NotoSansThai` / `NotoLoopedThai` / `NotoNaskhArabic`) ด้วย `lineHeight >= 1.38` (`>= 1.6` สำหรับอาหรับ) และ `paddingTop/Bottom >= 8` กันสระไทย/อาหรับแหว่ง
  - เคารพ Safe Zones (`top >= 150px`, `bottom >= 260px` สำหรับ `9:16`)
  - ใช้ Spring Physics (`spring({ fps, frame, config })`), overlapping `<Sequence>` + `transitionStyle` + `LightLeakFlash`, และ SVG/3D motion แทนการ hard-cut หรือ fade-in เฉยๆ

### Step 4: Render Video + Mix Audio (Sidechain Ducking + Loudnorm) + Measure Loudness
```bash
# 1. เรนเดอร์วิดีโอเงียบจาก Remotion (ใช้ Chromium ที่มีในเครื่องอัตโนมัติ, --concurrency=2)
/home/dev/.local/bin/motion-studio render <CompositionId> -o /tmp/work_dir/video_silent.mp4 --props /tmp/work_dir/timeline.json

# 2. ผสมเสียงพากย์ + BGM (sidechaincompress คีย์จากเสียงพากย์, --duck-db ค่าเริ่มต้น 12, ปิดได้ด้วย --no-duck)
#    + SFX + alimiter + loudnorm I=-14 TP=-1.5 LRA=11
/home/dev/.local/bin/motion-studio mix /tmp/work_dir/video_silent.mp4 /tmp/work_dir/timeline.json \
  -o /home/dev/.gemini/outputs/videos/<slug>.mp4 --bgm warm_tech --duck-db 12 --lufs -14

# 3. ตรวจความดังเสียงจริงด้วย FFmpeg ebur128 (เป้าหมาย Integrated ระหว่าง -15 ถึง -13 LUFS, True Peak <= -1.5 dBFS)
/home/dev/.local/bin/motion-studio loudness /home/dev/.gemini/outputs/videos/<slug>.mp4
```
*(สำหรับงานอิสลาม/สงบ ให้ใช้ `--bgm dawn_ambient` หรือ `--bgm none`; ปรับระดับพื้น BGM ได้ด้วย `--bgm-vol` ค่าเริ่มต้น `0.14`)*

### Step 5: Mandatory Visual QA Before Delivery
1. สร้าง Storyboard Contact Sheet + Animated GIF Preview (แนะนำส่ง `--timeline` เพื่อสกัดเฟรมกึ่งกลางทุกซีนพร้อมป้ายชื่อซีน):
   ```bash
   /home/dev/.local/bin/motion-studio preview /home/dev/.gemini/outputs/videos/<slug>.mp4 \
     -o /home/dev/.gemini/outputs/videos --prefix <slug> --timeline /tmp/work_dir/timeline.json
   ```
2. **ตรวจภาพด้วย `read_file` บน `<slug>_storyboard.png` ทุกครั้ง!** เช็กตามรายการ:
   - สระบน-ล่างและวรรณยุกต์ภาษาไทยสมบูรณ์ ไม่ตัดขอบ ไม่ซ้อนทับกัน (และข้อความอาหรับไม่แตก/ไม่ขาดตัชกีล)
   - ไม่มีองค์ประกอบหลุด Safe Zone (`top >= 150`, `bottom >= 260`) หรือป้ายบังเส้นทาง/กราฟิกหลัก
   - ทรานซิชันระหว่างซีนลื่นไหล ไม่มีเฟรมดำหรือภาพกระพริบ
   - สี แสง และสไตล์ตรงตาม Spec และไม่ละเมิดข้อห้าม (**สิ่งที่ควรเลี่ยง**)
   - ถ้าพบจุดบกพร่อง → แก้โค้ดและเรนเดอร์ใหม่ก่อนส่ง!

### Step 6: Deliver to User (Mandatory Auto-Telegram + Master Video Links + Cost Report)
ทุกครั้งที่ทำวิดีโอเสร็จ **ต้องทำครบทั้ง 4 ข้อทันทีโดยไม่ต้องรอให้ผู้ใช้สั่งซ้ำ**:
1. **ส่งไฟล์ `.mp4` พร้อมเสียงสมบูรณ์เข้า Telegram ของบังยีทุกครั้ง** *(ระบุค่าใช้จ่ายคลิปนี้เป็นบาท + ยอดเครดิตคงเหลือใน caption ด้วยเสมอ)*:
   ```bash
   /home/dev/.local/bin/motion-studio send-telegram /home/dev/.gemini/outputs/videos/<slug>.mp4 "คำอธิบายคลิป | 💸 ค่าเสียง: ฿X.XX · เครดิตคงเหลือ ~฿Y.YY"
   ```
   *(สคริปต์ `send-telegram` จะบีบอัดไฟล์สำเนา `<slug>_telegram.mp4` ให้ไม่เกิน 48 MB อัตโนมัติหาก Master ใหญ่กว่า 48 MB โดยไม่ทับไฟล์ Master)*
2. **แสดงภาพ Storyboard และ GIF พรีวิวแบบ inline ในแชต:**
   - `![พรีวิวแอนิเมชัน](/home/dev/.gemini/outputs/videos/<slug>_preview.gif)`
   - `![สรุปภาพแต่ละซีน](/home/dev/.gemini/outputs/videos/<slug>_storyboard.png)`
3. **แนบลิงก์ดูและดาวน์โหลดไฟล์ Master `.mp4` ที่คลิกได้จริงบนเว็บ Dashboard (และไฟล์ Interactive `.html` ถ้ามี) พร้อมสรุปสเปก (ขนาดไฟล์, ความยาว, ความละเอียด, สไตล์, เสียงพากย์, ค่า LUFS, และ `messageId` จาก Telegram):**
   - ดูออนไลน์ (Stream Master): `[🎬 ดูวิดีโอ Master (<slug>.mp4)](https://homelab.tail285279.ts.net/api/gemini/local-file?path=/home/dev/.gemini/outputs/videos/<slug>.mp4)`
   - ดาวน์โหลดไฟล์เต็ม: `[⬇️ ดาวน์โหลด Master (<slug>.mp4)](https://homelab.tail285279.ts.net/api/gemini/local-file?path=/home/dev/.gemini/outputs/videos/<slug>.mp4&download=1)`
   - *(สำหรับ `.html` Interactive Diagram ใช้ `/api/gemini/local-file?path=/home/dev/.gemini/outputs/videos/<slug>.html` เช่นเดียวกัน)*
4. **แจ้งค่าใช้จ่ายของคลิปนี้และยอดเครดิตคงเหลือทุกครั้ง (บังคับ):**
   - อ่านฟิลด์ `ttsCost` และ `credit` จากผลลัพธ์ JSON ของ `motion-studio tts` / `motion-studio mix` (หรือเช็กซ้ำด้วย `/home/dev/.local/bin/motion-studio credit`)
   - แจ้งให้บังยีทราบในแชตทุกครั้งว่า **คลิปนี้ใช้เงินไปกี่บาท** (`฿X.XX` จาก `ttsCost.thisRunThb` / `ttsCost.clipTotalThb`, หรือ `฿0.00 (ฟรี)` หากใช้ Edge-TTS / VachanaTTS) และ **ยอดเครดิต Gemini API คงเหลือประมาณ `~฿Y.YY`**
   - หาก `credit.isLow` (`remainingThb < 10`) ให้ขึ้นคำเตือนชัดเจนในแชตด้วยว่าเครดิตใกล้หมด (ต่ำกว่า ฿10.00) และแนะนำให้เติมเงินหรือสลับไปใช้ Edge-TTS / VachanaTTS ชั่วคราว (ระบบจะส่งแจ้งเตือนเข้า Telegram อัตโนมัติเมื่อยอดลดต่ำกว่า ฿10.00)

## Islamic & Religious Content Guidelines (แนวทางเนื้อหาศาสนาและอิสลาม)
เมื่อสร้างคลิปเกี่ยวกับอิสลาม หะดีษ อัลกุรอาน หรือคำสอนศาสนา **ต้องปฏิบัติตามกฎเหล่านี้อย่างเคร่งครัด:**
1. **ใช้เฉพาะหะดีษเศาะฮีหฺ / หะซัน และขึ้นแหล่งอ้างอิงบนจอทุกครั้ง:**
   - ตรวจสอบหมายเลขหะดีษและบันทึกผู้รายงานให้แม่นยำ (เช่น `บันทึกโดย มุสลิม 720 (อบูซัรฺ ร.ฎ.)`, `หะดีษกุดซีย์ · ติรมิซี 475 · อบูดาวูด 1289`, `บันทึกโดย บุคอรี 1981 · มุสลิม 721`, `บันทึกโดย มุสลิม 748 · อิบนุคุซัยมะฮ์ 1224`)
   - แสดงป้ายแหล่งอ้างอิงบนจอให้ชัดเจนในทุกซีนที่อ้างอิงหลักฐาน
2. **ห้ามใช้หะดีษเฎาะอีฟและห้ามโฆษณาเกินจริง:**
   - ห้ามนำหะดีษอ่อน/ไม่มีสายรายงานรับรองมาเล่า (เช่น เรื่อง `ประตูอัฎฎุฮาในสวรรค์`)
   - ห้ามใช้คำสัญญาแบบเกินจริงเรื่องความร่ำรวยทันตา ให้เน้นความหมายที่ถูกต้องตามหลักฐาน เช่น การขอบคุณต่อ 360 ข้อต่อ ความเมตตาและการดูแลคุ้มครองจากอัลลอฮ์ ﷻ และความสงบใจ
3. **ห้ามวาดภาพท่านนบี ﷺ หรือใบหน้ามนุษย์:**
   - ใช้ภาพเชิงนามธรรมและสัญลักษณ์อิสลามแทนเสมอ เช่น `DawnSky`, `LightRays`, กลุ่มดาวจุดแสง 360 จุดไร้ใบหน้า, ซุ้มมิหฺรอบ, ผืนพรมละหมาดเรขาคณิต, โดมแสง, และ `IslamicPattern` (8-pointed Rub el Hizb)
4. **BGM ต้องไม่มีจังหวะกลองหรือทำนองเครื่องดนตรี:**
   - ใช้ `--bgm dawn_ambient` (เสียงโดรนแพด + ลมยามเช้า ไม่มีกลอง/จังหวะ/เมโลดี้) ที่ `--bgm-vol 0.12`–`0.14` หรือเลือก `--bgm none`
5. **ภาษาอาหรับและคำศัพท์ไทยให้ถูกต้องสม่ำเสมอ:**
   - ข้อความอาหรับใช้ `ArabicText` (`Noto Naskh Arabic`, `direction: 'rtl'`, `lineHeight >= 1.6`, padding/clip-inset กว้างกันตัชกีลแหว่ง)
   - ใช้คำไทยให้สม่ำเสมอตลอดทั้งคลิป (เช่น `ร็อกอะฮ์`, `ศ็อลลัลลอฮุอะลัยฮิวะซัลลัม` หรือ `ﷺ`, `อัลลอฮ์ ﷻ`, `เศาะดะเกาะฮ์`, `อัลเอาวาบีน`) และปิดท้ายด้วย **`วัลลอฮุอะอฺลัม`** (`وَاللَّهُ أَعْلَمُ`)
6. **เสียงพากย์เริ่มต้นสำหรับคลิปศาสนา:**
   - ใช้เสียงผู้ชาย (`gemini:Charon`, `gemini:Algenib`, หรือ `gemini:Orus`) คู่กับ `--style religious` เป็นค่าเริ่มต้นเสมอ เว้นแต่ผู้ใช้จะระบุเสียงอื่นเอง
7. **ห้ามกระซิบและห้ามโทน ASMR:**
   - ห้ามใช้เสียงกระซิบ (never whisper), ห้าม ASMR, ห้าม breathy/intimate เด็ดขาด และซีนแรกต้องพูดด้วยระดับเสียงปกติเต็มเสียงตั้งแต่คำแรก
8. **ซับไตเติลและข้อความบนจอต้องตรงเสียงพูด:**
   - ชื่อซีน/ข้อความบนจอ (on-screen title) และซับไตเติลต้องตรงกับคำที่กำลังพูดจริงในซีนนั้น และแบ่งซับไตเติลท่อนละ **ไม่เกิน 18 ตัวอักษรไทย** ตามขอบเขตคำ/วลี
9. **โครงสร้างเนื้อหา 1 ซีนต่อ 1 ประเด็น:**
   - เรียงลำดับ **Hook → Context → Evidence (ระบุแหล่งอ้างอิงตามจริง ห้ามแต่งหมายเลขหะดีษเอง) → Takeaway → Closing** และจำกัด 1 ประเด็นหลักต่อ 1 ซีน

## Safety & Resource Rules (Homelab 4 CPU / 11 GB RAM)
- เรนเดอร์ Remotion **ทีละ 1 งาน** เท่านั้น และใช้ `--concurrency=2` เพื่อไม่ให้ RAM ชนกับ PM2/Docker/Whisper
- ห้าม `npm install` แพ็กเกจเพิ่มเติม (เช่น `@remotion/transitions`) เพื่อป้องกันเวอร์ชันชนกับ Remotion `4.0.x` ที่ล็อกไว้ — ใช้ `transitionStyle` และ `LightLeakFlash` ใน `src/components/fx` แทน
- ล้างไฟล์เก่าเกิน 7 วันได้ด้วย `/home/dev/.local/bin/motion-studio clean --days 7`
- **เครดิตสไตล์:** โครงสร้างคลัง 46 สไตล์อ้างอิงจาก Shaan Johari (`@viashaan`) และ Moshikub (ใช้เป็นคลังอ้างอิงภายในเครื่อง; หากเผยแพร่ให้ระบุเครดิต)
