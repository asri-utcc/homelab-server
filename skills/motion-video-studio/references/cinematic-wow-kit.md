# Cinematic Wow Kit & Scene FX Recipes

คู่มืออ้างอิงสำหรับสร้างวิดีโอ Remotion ระดับ Cinematic บน `motion-studio` (`/home/dev/.local/share/motion-studio/`) โดยใช้คลังคอมโพเนนต์สำเร็จรูปที่ `src/components/fx/` ร่วมกับระบบเสียง sidechain-ducked และคำบรรยายคาราโอเกะระดับคำ

> **กฎเหล็กด้านเทคนิค:**
> 1. **100% Deterministic:** คอมโพเนนต์ FX ทั้งหมดใช้ `random(seed)` ของ Remotion ร่วมกับ `interpolate` / `spring` / `Easing` — **ห้ามใช้ `Math.random()`** เพื่อให้ทุก worker เรนเดอร์เฟรมตรงกันเป๊ะ
> 2. **ห้าม `npm install @remotion/transitions`:** ใช้ `transitionStyle` + `LightLeakFlash` ร่วมกับ `<Sequence>` แบบซ้อนเฟรม (`OVERLAP_HALF`) แทน เพื่อไม่ให้เวอร์ชันชนกับ Remotion `4.0.x`
> 3. **ปกป้องสระไทย & อาหรับ:** ใช้ `ThaiFontLoader` (โหลดทั้ง `Noto Sans Thai`, `Noto Looped Thai` และ `Noto Naskh Arabic` จาก `public/fonts/`) พร้อม `lineHeight >= 1.4` (ไทย) และ `>= 1.6` (อาหรับ)

---

## 1. สถาปัตยกรรมเลเยอร์ระดับ Cinematic (Z-Layer Stack)

จัดลำดับเลเยอร์จากล่างขึ้นบนใน Root Composition เพื่อให้ภาพมีมิติลึก ฉากหลังไม่แข็งทื่อ และไม่มีเฟรมดำระหว่างเปลี่ยนซีน:

```tsx
<AbsoluteFill style={{ backgroundColor: '#0B1026', overflow: 'hidden' }}>
  <ThaiFontLoader />

  {/* Layer 1: Continuous Living Backdrop inside CameraRig (เคลื่อนไหวต่อเนื่องตลอดคลิป) */}
  <CameraRig zoomFrom={1.0} zoomTo={1.06} panY={[14, -18]} durationFrames={totalFrames}>
    <DawnSky progress={skyProgress} sunYStart={0.84} sunYEnd={0.24} />
    <IslamicPattern opacity={0.085} color="#FFE6A7" rotationSpeed={0.9} />
    <LightRays intensity={0.45} originY={sunOriginY} seed="rays" />
    <ParticleField count={78} seed="motes" bokehRatio={0.3} />
  </CameraRig>

  {/* Layer 2: Atmospheric Edge Contrast Scrim (กันตัวอักษรจมเมื่อฉากหลังสว่างขึ้น) */}
  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(...)' }} />

  {/* Layer 3: Overlapping Cross-Faded Scene Sequences (OVERLAP_HALF = 7 เฟรม) */}
  {scenes.map((scene, idx) => (
    <Sequence key={scene.id} from={renderStart} durationInFrames={renderDur}>
      <SceneContent ... /> {/* ใช้ transitionStyle(localFrame, renderDur, kind, fps) */}
    </Sequence>
  ))}

  {/* Layer 4: Golden Light-Leak Flash Bridging Scene Cuts (zIndex: 80) */}
  <LightLeakFlash at={cutFrames} durationFrames={20} intensity={0.78} />

  {/* Layer 5: Word-Level Karaoke Subtitles in Safe Zone (zIndex: 60) */}
  <KaraokeSubtitle
    cues={allCues}
    wordBoundaries={activeScene?.wordBoundaries}
    sceneSpeechStartSec={activeScene?.speechStartSec ?? 0}
    bottomOffset={275}
  />

  {/* Layer 6: Cinema Film Grain + Soft Lens Vignette (zIndex: 90) */}
  <FilmGrainVignette grain={0.045} vignette={0.44} updateEveryFrames={2} />
</AbsoluteFill>
```

---

## 2. คู่มือพร็อพคอมโพเนนต์ `src/components/fx` (`index.ts`)

### 2.1 Atmosphere & Backdrop
- **`DawnSky`** (`DawnSkyProps`)
  - ไล่สีท้องฟ้า 5 ระยะ: Pre-dawn `#0B1026` (`0.00`) → Twilight `#3B2A6B` (`0.25`) → Sunrise `#F28C5B` (`0.50`) → Morning Gold `#FFD9A0` (`0.75`) → Bright Cream `#FFF4DC` (`1.00`) พร้อมดาวระยิบตอนเช้ามืด, วงแสงดวงอาทิตย์ 3 ชั้น และหมอกขอบฟ้า
  - Props: `progress` (`0.5`), `sunX` (`0.5`), `sunYStart` (`0.84`), `sunYEnd` (`0.24`), `sunScale` (`1`), `showStars` (`true`), `showHorizonHaze` (`true`), `style`
  - **เคล็ดลับ:** ค่อยๆ `interpolate` ค่า `progress` จาก `0.04` → `0.76` (แทน `1.0`) เพื่อให้ครึ่งหลังของคลิปยังคงความตัดกัน (contrast) ระหว่างตัวอักษรขาว/ทองกับฉากหลัง
- **`LightRays`** (`LightRaysProps`)
  - ลำแสงพาดฟ้าหมุนช้าแบบ volumetric SVG (`mixBlendMode: 'screen'`)
  - Props: `count` (`12`), `color` (`'#FFD9A0'`), `intensity` (`0.45`), `originX` (`0.5`), `originY` (`0.28`), `rotationSpeed` (`3.2` deg/s), `blur` (`16`), `seed` (`'god-rays'`), `style`
  - **เคล็ดลับ:** ผูก `originY` ให้เคลื่อนที่ตามดวงอาทิตย์ของ `DawnSky`
- **`ParticleField`** (`ParticleFieldProps`)
  - ฝุ่นแสงลอยขึ้น + วงโบเก้เบลอพร้อม twinkle แบบ deterministic
  - Props: `count` (`80`), `seed` (`'particles'`), `color` (`'#FFE8B6'`), `drift` (`28`), `size` (`4.5`), `opacity` (`0.85`), `bokehRatio` (`0.28`), `blendMode` (`'screen'`), `style`
- **`IslamicPattern`** (`IslamicPatternProps`)
  - ลวดลายเรขาคณิตอิสลามดาว 8 แฉก (Rub el Hizb) แบบ tile เชื่อมต่อกันอัตโนมัติและหมุนได้
  - Props: `opacity` (`0.08`), `rotate` (หากไม่ส่งจะหมุนตามเวลา), `color` (`'#FFD9A0'`), `tileSize` (`160`), `strokeWidth` (`1.2`), `rotationSpeed` (`1.2`), `style`

### 2.2 Camera, Transitions & Finishing
- **`CameraRig`** (`CameraRigProps`)
  - ห่อหุ้มฉากหลังหรือเวทีภาพด้วย Ken Burns (cubic ease-in-out zoom + pan + micro-rotate)
  - Props: `children`, `zoomFrom` (`1`), `zoomTo` (`1.08`), `panX` (`0` หรือ `[from, to]`), `panY` (`0` หรือ `[from, to]`), `rotate` (`[0, 0]`), `startFrame` (`0`), `durationFrames` (default `durationInFrames`), `origin` (`'50% 50%'`), `style`
- **`transitionStyle` + `LightLeakFlash`** (`TransitionKind`, `TransitionOptions`, `LightLeakFlashProps`)
  - `transitionStyle(localFrame, durationFrames, kind = 'lightLeak', fps = 30, options?)`: คืนค่า `{ opacity, transform, filter, clipPath? }` สำหรับ 4 โหมด: `'lightLeak'`, `'zoomThrough'`, `'iris'`, `'fade'` และรองรับ `options: { inFrames, outFrames, skipIn, skipOut }`
  - `LightLeakFlash`: แฟลชแสงสีทอง+เลนส์ anamorphic พาดผ่านจุดตัดซีน (`at: number | number[]`, `durationFrames` `18`, `color` `'#FFD9A0'`, `secondaryColor` `'#F28C5B'`, `intensity` `0.92`, `style`)
  - **สูตรไร้เฟรมดำ (Zero-Black-Frame Cut):** ขยายช่วง `<Sequence>` ของแต่ละซีนเข้าหากันด้วย `OVERLAP_HALF = 7` เฟรม (`renderStart = scene.startFrame - 7`, `renderEnd = scene.endFrame + 7`) แล้ววาง `<LightLeakFlash at={cutFrames} />` ทับจุดรอยต่อ
- **`FilmGrainVignette`** (`FilmGrainVignetteProps`)
  - เกรนฟิล์ม `feTurbulence` เปลี่ยน seed ทุก N เฟรม + ขอบมืด radial vignette
  - Props: `grain` (`0.06`), `vignette` (`0.55`), `vignetteColor` (`'#050816'`), `grainFrequency` (`0.78`), `updateEveryFrames` (`2`), `style`

### 2.3 Typography, Numbers & Subtitles
- **`KineticTitle`** (`KineticTitleProps`)
  - ตัดคำไทยด้วย `Intl.Segmenter('th', { granularity: 'word' })` แล้วเด้งคำทีละคำด้วย `spring` + blur-resolve พร้อมทำ gradient + glow เฉพาะคำใน `highlight` และกันพื้นที่แนวตั้ง (`paddingTop: 10, paddingBottom: 10`) ป้องกันวรรณยุกต์ขาดใต้ `background-clip: text`
  - Props: `text`, `startFrame` (`0`), `accent` (`'#FFD166'`), `accentSecondary` (`'#FFF4DC'`), `highlight` (`string | string[]`), `fontSize` (`58` portrait / `64` landscape), `align` (`'center'`), `color` (`'#FFFFFF'`), `staggerFrames` (`3`), `fontWeight` (`700`), `fontFamily` (`THAI_FONT_FAMILY`), `maxWidth`, `style`
- **`CountUp`** (`CountUpProps`)
  - ตัวนับตัวเลขแบบ cubic ease-out ใช้ `tabular-nums` และมี spring pop + drop-shadow glow เมื่อนับถึงเป้าหมาย
  - Props: `from` (`0`), `to` (`100`), `startFrame` (`0`), `durationFrames` (`45`), `format`, `decimals` (`0`), `prefix` (`''`), `suffix` (`''`), `popScale` (`1.14`), `popGlowColor`, `style`
- **`ArabicText`** (`ArabicTextProps`)
  - ข้อความอาหรับด้วย `Noto Naskh Arabic` (`dir="rtl"`, `lang="ar"`, `lineHeight: 1.7`) พร้อมเอฟเฟกต์เปิดเผยตัวอักษรจากขวาไปซ้าย (`inset(-28px -28px -28px leftClipPct%)`) เพื่อไม่ให้สระ/ตัชกีลถูกตัด
  - Props: `text`, `fontSize` (`46` portrait / `54` landscape), `color` (`'#FFF4DC'`), `glow` (`true`), `startFrame` (`0`), `durationFrames` (`36`), `progress`, `fontWeight` (`700`), `align` (`'center'`), `maxWidth`, `style`
- **`KaraokeSubtitle`** (`KaraokeSubtitleProps`, `WordBoundary`, `SubtitleCue`)
  - ซับไตเติลแก้วใส 2 บรรทัดใน Safe Zone ที่ไฮไลต์คำกำลังพูดแบบคำต่อคำจาก `wordBoundaries` ของ `timeline.json` (รองรับทั้ง `WordBoundary` และ fallback เมื่อเป็น `SentenceBoundary` หรือคำตัวเลขที่สะกดต่างจากคำอ่าน)
  - Props: `cues`, `wordBoundaries`, `sceneSpeechStartSec` (`0`), `accentColor` (`'#FFD166'`), `bottomOffset` (`280` portrait / `88` landscape), `theme` (`'dark' | 'light'`), `fontSize`, `style`

---

## 3. สูตรประกอบ FX ตามประเภทซีน (Scene Recipes)

| ประเภทซีน | สูตร FX & Motion | การเชื่อมซีน (Transition) | เสียงประกอบ (SFX Pairing) |
| :--- | :--- | :--- | :--- |
| **A. Hook / Big Stat Reveal (0–5 วิ)** | `DawnSky` (`0.04→0.16`) + `ParticleField` + `KineticTitle` (`staggerFrames: 2`) + ภาพ SVG กลุ่มดาว/โครงสร้างแบบ `random(seed)` + **`CountUp`** (`popScale: 1.15`, `popGlowColor`) | `skipIn: true`, `outFrames: 14` (`lightLeak`) | `riser` (`0.0s`) → `shimmer` (จังหวะตัวเลขครบเป้า) |
| **B. Convergence / Core Insight** | อนุภาค/จุดแสงหมุนวนจากวงนอกเข้าสู่ลูกแสงกลาง (`interpolate` + `spring`) + กรอบกระจก `CalligraphyCard` ที่หุ้ม `ArabicText` + คำแปลไทย | `zoomThrough` + `LightLeakFlash` บน `cutFrame` | `soft_impact` (`0.0s`) → `shimmer` (ช่วงลูกแสงสว่างสุด) |
| **C. Journey Arc / Protection Dome** | เส้นโค้ง SVG `strokeDasharray`/`strokeDashoffset` วาดตามดวงอาทิตย์เคลื่อนจากซ้ายไปขวา + เสาแสง `spring` เรียงลำดับ + `LightRays` เชื่อมกับ `sunOriginY` | `lightLeak` + `LightLeakFlash` | `riser` (`0.0s`) → `chime` (เมื่อเส้นโค้งครบวง) |
| **D. 3–4 Key Takeaways (Card Flip)** | `perspective: 1200` + การ์ด glassmorphism พลิกแกน X (`rotateX: -72deg → 0deg`) ทีละใบด้วย `spring` + เน้นการ์ดพระเอกด้วยขอบทอง + `scale` pulse เบาๆ | `zoomThrough` + `LightLeakFlash` | `soft_impact` (`0.0s`) → `shimmer` (การ์ดสำคัญเด้ง) |
| **E. Spiritual / Cultural Centerpiece** | `IslamicPattern` หมุนช้า + วงคลื่นแผ่รัศมี 4 ชั้น + ดาว 8 แฉกหมุนแกนกลาง + `ArabicText` ขนาดใหญ่ (`fontSize: 62`) | `lightLeak` + `LightLeakFlash` | `riser` (`0.0s`) → `shimmer` |
| **F. Practical Dial / Options Selector** | หน้าปัดครึ่งวงกลม SVG พร้อมขีดสเกล แถบช่วงเวลาหลัก + แถบเวลาประเสริฐ + หมุดดวงอาทิตย์วิ่งตามโค้ง + การ์ดตัวเลือก `spring` 3 ใบ | `zoomThrough` + `LightLeakFlash` | `soft_impact` (`0.0s`) → `chime` (การ์ดครบ 3 ใบ) |
| **G. 7-Day Streak CTA / Outro** | วงแหวนความคืบหน้า `strokeDashoffset` สว่างทีละโหนด (`1→7`) พร้อมเครื่องหมายถูก `spring` + `ArabicText` ปิดท้าย (`وَاللَّهُ أَعْلَمُ`) + hold ท้ายคลิป | `skipOut: true`, hold นิ่ง 1.8s | `shimmer` (`0.2s`) → `chime` → `spark` |

### โครงสร้าง Audio & Mix มาตรฐาน (ตรงกับ `scripts/mix_audio.py`)
- **BGM Selection:**
  - Tech / Explainer / Diagram → `--bgm warm_tech`
  - Documentary / Historical / Storytelling → `--bgm story_cinematic`
  - Islamic / Contemplative / Dawn → `--bgm dawn_ambient` *(หรือ `--bgm none`; ห้ามมีกลองหรือทำนองเครื่องดนตรี)*
- **Pipeline Mixing (`mix_audio.py`):**
  1. ขยายเสียงพากย์เล็กน้อย (`volume=1.08`) และแยกสัญญาณคีย์ `[nkey]` ด้วย `asplit=2[vo][nkey]`
  2. ตัดความยาว BGM ให้ตรงคลิป ปรับ `--bgm-vol` (ค่าเริ่มต้น `0.14`) ใส่ `afade in 1.0s / out 2.2s`
  3. กดเสียง BGM ลงอัตโนมัติเฉพาะตอนพูดด้วย `sidechaincompress` ที่คีย์จาก `[nkey]` (`--duck-db 12` เป็นค่าเริ่มต้น, ปิดได้ด้วย `--no-duck`)
  4. รวมเสียงพากย์ + BGM + SFX แล้วผ่าน `alimiter=limit=0.95` และ `loudnorm=I=-14.0:TP=-1.5:LRA=11`
  5. ยืนยันผลลัพธ์ด้วย `motion-studio loudness <final.mp4>` ให้ Integrated LUFS อยู่ระหว่าง `-15` ถึง `-13` LUFS

---

## 4. กรณีศึกษาฉบับสมบูรณ์: `DhuhaBenefits.tsx`

ไฟล์ต้นแบบจริง: `/home/dev/.local/share/motion-studio/src/projects/dhuha-benefits/DhuhaBenefits.tsx` (2,388 บรรทัด) และ `/home/dev/.local/share/motion-studio/src/projects/dhuha-benefits/script.json` (7 ซีน, `1080×1920 @30fps`, ลงทะเบียนใน `src/Root.tsx`)

### จุดเด่นที่นำ `cinematic-wow-kit` มาใช้งานจริง:
1. **Continuous Sky Journey + CameraRig (`DhuhaBenefits`, บรรทัด 2255–2323):**
   - `skyProgress` ไล่จาก `0.04` (ครามรุ่งอรุณ) → `0.76` (ทองอ่อนยามสาย) ตลอดความยาวคลิป และคำนวณ `sunOriginY` (`0.84 → 0.24`) ส่งให้ทั้ง `DawnSky` และ `LightRays`
   - วาง `DawnSky`, `IslamicPattern`, `LightRays` และ `ParticleField` (`seed="dhuha-motes"`) ไว้ใน `<CameraRig zoomFrom={1.0} zoomTo={1.06} panY={[14, -18]}>` พร้อม Contrast Scrim ทับอีกชั้น
2. **Overlapping Transitions + Zero Black Frames (`OVERLAP_HALF = 7`, บรรทัด 194, 2337–2367):**
   - แต่ละซีนขยาย `Sequence` เกยกัน `±7` เฟรม (`skipIn` ในซีนแรก, `skipOut` ในซีนสุดท้าย) สลับโหมด `SCENE_TRANSITIONS` ระหว่าง `'lightLeak'` และ `'zoomThrough'` แล้ววาง `<LightLeakFlash at={cutFrames} durationFrames={20} intensity={0.78} />` เชื่อมทุกจุดตัด
3. **Strict Portrait Safe Zones (`DhuhaSceneContent`, บรรทัด 2041–2236):**
   - **Top Header (`top: 156` >= `150px`):** ป้ายบทที่ `01 / 07` + จุดความคืบหน้า 7 จุด
   - **Main Stage (`top: 222` ถึง `bottom: 515`):** `KineticTitle` (`staggerFrames={2}`), แคปซูลหัวข้อย่อย (`THAI_LOOPED_FAMILY`), และ Hero Visual
   - **Source Citation Pill (`bottom: 446`):** ป้ายแหล่งอ้างอิงหะดีษเศาะฮีหฺบนจอทุกซีน (เช่น `บันทึกโดย มุสลิม 720 (อบูซัรฺ ร.ฎ.)`)
   - **Karaoke Subtitles (`bottomOffset: 275` >= `260px`):** `<KaraokeSubtitle cues={allCues} wordBoundaries={activeScene?.wordBoundaries} sceneSpeechStartSec={activeScene?.speechStartSec ?? activeScene?.startSec ?? 0} />`
4. **Abstract Sacred Visuals + Arabic Calligraphy (`CalligraphyCard`, บรรทัด 216–296):**
   - ซีน 1 (`Scene1Joints360`): จุดแสง deterministic 360 จุดเรียงเป็นกลุ่มดาวไร้ใบหน้า + `CountUp` (`0 → 360`)
   - ซีน 2 (`Scene2TwoRakaat`): จุดแสงหมุนวนรวมเป็นลูกแสง 1 ดวงในซุ้มมิหฺรอบ + พรมละหมาดเรขาคณิต + `ArabicText`
   - ซีน 3 (`Scene3QudsiShield`): โดมแสงคุ้มครองวาดตามแนวดวงอาทิตย์จาก `ต้นวัน` → `ท้ายวัน` + 4 เสาแสง
   - ซีน 4 (`Scene4ThreeWasiyyah`): การ์ดคำสั่งเสีย 3 ใบพลิก `rotateX` ทีละใบ เน้นข้อที่ 2 (`ละหมาดฎุฮา 2 ร็อกอะฮ์`)
   - ซีน 5 (`Scene5Awwabin`): ดาว 8 แฉก Rub el Hizb หมุนช้าเหนือเนินทรายยามสาย + `ArabicText` (`صَلَاةُ الْأَوَّابِينَ`)
   - ซีน 6 (`Scene6TimeRakaat`): หน้าปัดเวลาฎุฮา (หลังตะวันขึ้น +15–20 นาที ถึงก่อนซุฮรี 10 นาที) + ตัวเลือก `2 · 4 · 8` ร็อกอะฮ์
   - ซีน 7 (`Scene7ChallengeCTA`): วงแหวนสตรีค `7 วัน` สว่างทีละวัน + ปิดท้ายด้วย `وَاللَّهُ أَعْلَمُ` (`วัลลอฮุอะอฺลัม`)

### คำสั่งผลิตและตรวจ QA สำหรับ `DhuhaBenefits`
```bash
# 1. Audio-first TTS (ได้ timeline.json พร้อม wordBoundaries)
/home/dev/.local/bin/motion-studio tts \
  /home/dev/.local/share/motion-studio/src/projects/dhuha-benefits/script.json \
  -o /tmp/dhuha_work --voice th-TH-PremwadeeNeural --rate +2%

# 2. Render วิดีโอเงียบ (--concurrency=2 อัตโนมัติ)
/home/dev/.local/bin/motion-studio render DhuhaBenefits \
  -o /tmp/dhuha_work/video_silent.mp4 --props /tmp/dhuha_work/timeline.json

# 3. Mix เสียงพากย์ + dawn_ambient (sidechain duck 12dB) + SFX + loudnorm (-14 LUFS)
/home/dev/.local/bin/motion-studio mix \
  /tmp/dhuha_work/video_silent.mp4 /tmp/dhuha_work/timeline.json \
  -o /home/dev/.gemini/outputs/videos/dhuha_benefits.mp4 \
  --bgm dawn_ambient --bgm-vol 0.13 --duck-db 12 --lufs -14

# 4. ตรวจ LUFS จริง + สร้าง Storyboard 7 ซีนพร้อมป้ายชื่อสำหรับตรวจด้วย read_file
/home/dev/.local/bin/motion-studio loudness /home/dev/.gemini/outputs/videos/dhuha_benefits.mp4
/home/dev/.local/bin/motion-studio preview /home/dev/.gemini/outputs/videos/dhuha_benefits.mp4 \
  -o /home/dev/.gemini/outputs/videos --prefix dhuha_benefits --timeline /tmp/dhuha_work/timeline.json
```
