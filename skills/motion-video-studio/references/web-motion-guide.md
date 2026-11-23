# Web & Presentation Interactive Motion Guide (HTML / CSS / SVG / Three.js)

คู่มือการนำระบบ Design Spec ทั้ง 46 สไตล์ (Palette + Typography + Layout + Motion Choreography + Anti-patterns) ไปสร้าง **Interactive Explainer / Animated Diagram / Presentation** แบบไฟล์ HTML เดียวจบ เปิดได้ในทุกเบราว์เซอร์หรือฝังใน Dashboard โดยไม่ต้องพึ่ง Remotion

## เมื่อไหร่ควรใช้โหมดนี้ (หรือทำควบคู่กับคลิป MP4)
- เมื่อผู้ใช้ต้องการ **แผนภาพอธิบายระบบแบบโต้ตอบได้** (คลิกดูทีละขั้นตอน, กด Play/Pause/Replay, hover ดูรายละเอียด)
- เมื่อต้องการใช้ประกอบ **สไลด์พรีเซนเทชัน, หน้าเว็บ, หรือแดชบอร์ด** (เช่น หน้าอธิบาย Architecture, Pipeline, ระบบไฟฟ้า/โซล่าเซลล์)
- เมื่อต้องการแชร์เป็นไฟล์เดี่ยวเบาๆ (`< 50 KB`) ที่เปิดดูลื่นระดับ 60fps บนทุกอุปกรณ์

## การแปลง Remotion Spec → Web Motion Tokens

| องค์ประกอบใน Spec | แปลงเป็น Web / CSS / SVG / JS |
| :--- | :--- |
| **ชุดสี + Negative Color Rules** | ประกาศใน `:root { --bg-top; --bg-bot; --surface; --ink; --accent-1; ... }` ห้ามเพิ่มสีนอก palette เด็ดขาด |
| **Orthographic Isometric Camera** (`look-21`, `look-29`) | ใช้ **SVG Isometric Projection** (`x = (u-v)*cos(30°)`, `y = (u+v)*sin(30°) - z`) หรือ Three.js `OrthographicCamera` — ภาพคมระดับ vector ไม่เบลอทุกความละเอียด |
| **Spring Overshoot / Crisp Landing** | ใช้ CSS `cubic-bezier(0.34, 1.56, 0.64, 1)` หรือ JS damped harmonic spring (`stiffness`, `damping`) |
| **Path Self-Drawing** | ใช้ SVG `stroke-dasharray` + `stroke-dashoffset` animate ตาม progress `0 → 1` |
| **Energy / Packet Flow** | ใช้ SVG `<animateMotion>` หรือ JS `getPointAtLength(t * totalLen)` ให้จุดพลังงาน/พัสดุวิ่งตามเส้นจริง |
| **Stagger Choreography** | ไล่ดีเลย์ทีละ `120–300ms` ตามลำดับเหตุการณ์ (เริ่ม → กลาง → จบ) |
| **Hold Frame / Replay** | มีปุ่ม Play / Pause / Step-by-Step (`01`..`06`) + Auto-loop พร้อมช่วงหยุดนิ่งท้ายรอบ 1.5 วินาที |

## สไตล์ที่เหมาะกับ Web & Presentation ที่สุด
1. **`look-21` Isometric Flow** — แผนภาพการทำงานของระบบ, โซล่าเซลล์, ซัพพลายเชน, CI/CD Pipeline
2. **`look-29` Exploded Teardown** — แยกชั้นส่วนประกอบฮาร์ดแวร์/ซอฟต์แวร์ (คลิกขยายแต่ละชั้นได้)
3. **`look-45` Swiss Grid** — หน้าสไลด์ตัวเลข KPI / สรุปผลแบบกราฟิกคมชัด
4. **`look-23` Before & After Slider** — ลากเทียบก่อน-หลังแบบ interactive จริง
5. **`look-36` Timeline** — เส้นเวลาประวัติศาสตร์/Roadmap ที่เลื่อนดูได้
6. **`look-39` Frosted UI / `look-46` Pencil to Blueprint** — หน้าเดโม UI หรือโครงร่างสถาปัตยกรรม

## กฎเหล็กสำหรับ Web Interactive Output
- สร้างเป็น **Single self-contained HTML** (Inline CSS + SVG/JS, ใช้ฟอนต์ `Noto Sans Thai` + fallback system Thai sans-serif) เปิดได้ทันทีแม้ไม่มีอินเทอร์เน็ต
- ต้องรองรับทั้ง **Desktop (16:9)** และ **Mobile (Responsive)**
- ตรวจหน้าตาจริงด้วย `/home/dev/.local/bin/lab-browser shot` (ผ่าน local HTTP server ชั่วคราวหรือตรวจสอบ DOM) เพื่อยืนยันว่าไม่มีข้อความภาษาไทยซ้อนทับ
- **กฎเหล็ก UI/Form ของ Homelab:** ห้ามใส่ค่าเริ่มต้น `admin` ในช่อง input ใดๆ เด็ดขาด
