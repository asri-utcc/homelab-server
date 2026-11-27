# Generative Style-Native Scene Visuals for Motion Video Studio — Design Spec

- **Date:** 2026-11-28
- **Status:** Draft (Pending User Approval)
- **Scope:** Project (`motion-studio` in `/home/dev/.local/share/motion-studio` synced to `/home/dev/projects/homelab-server/motion-studio`)
- **Reference Job:** `mwz7i0wd-4cb67c` (`5 จุดเช็กก่อนติดโซลาร์เซลล์ ไม่ให้งบบานปลาย`, `styleId: "look-46"`, 14 scenes, 83.8s)

---

## 1. Intent and Why

When a user selects a curated style in Video Studio (such as `look-46` *Pencil to Blueprint*, whose preview thumbnail features a rocket blueprint), they are choosing the **visual language, medium, and motion craft** of that style (hand-sketched graphite lines on graph paper transforming via a wet-ink cyanotype flood into crisp white engineering blueprints with dimension callouts) — **not** asking for hardcoded rockets, chairs, pill bottles, or cameras to be pasted onto unrelated topics.

In job `mwz7i0wd-4cb67c` (about residential solar rooftop investment), five compounding flaws produced a jarring, incoherent video:
1. **Hardcoded 4-Object Pool in `look-46` (`src/studio/styleDirector/batchR.tsx`):** `L46_OBJECTS` only contained `flask`, `chair`, `rocket`, and `enclosure`. Scenes about hybrid battery cost spikes (`"งบพุ่ง"`) matched the regex `/พุ่ง/` and drew a **sounding rocket** (`#5`, `#8`), while permit and tax scenes drew a **chair** (`#11`) and **camera enclosure** (`#12`).
2. **AI Vector Stage Skipped Data Scenes & Ignored Style Craft (`scripts/scene_vector.py` + `DynamicMotionStage.tsx`):** `choose_scenes(..., mode="auto")` skipped all 11 data scenes (`steps`, `compare`, `stat`, `bullets`) and only generated AI SVG for 3 scenes (`#1`, `#13`, `#14`). Worse, `StyleDirectedLayout.tsx` replaced `look-46`'s ShotComponent with a generic dark `#0F172A` card (`DynamicMotionStage`) whenever `scene.vector` existed, losing the pencil-to-blueprint ink flood effect completely.
3. **Shot Planner Forced Generic Dark Data Cards (`src/studio/styleDirector/plan.ts` + `studio_style_presets.json`):** Because `planStyleShots` required cycling through all 10 registered shots (`4 blueprint-*` + `6 data-*`) before repeating, 6 out of every 10 scenes rendered as dark `#0F172A` `dataShots.tsx` cards, clashing violently with off-white/cyanotype blueprint scenes.
4. **Delayed Title & Data Reveal (`batchR.tsx`):** `computeTimelineR` kept `ruleP` and `labelP` at `0` until `58%` of each scene (~3.5s into a 6s scene), leaving scenes blank except for the wrong object for over half their duration (and completely blank of text at the 50% storyboard keyframe).
5. **Unrelated 3D Clay Props Shrunk 2D Blueprints (`scripts/scene_art.py` + `SceneArtLayer.tsx`):** `scene_art.py` ran unconditionally on 2D styles, picking from 20 generic finance/tech props (`target-dart`, `gear-pair`, `piggy-bank`, `warning-sign` — zero solar/house/sun props), coloring them dark charcoal grey from `look-46`'s `#25262B` accent, and shrinking `look-46` to `62%` inside a floating box.

**Core Goal:** Empower AI prompts to **genuinely design custom, topic-accurate illustrations for every scene** (sun, solar rooftop house, 15° south roof angle, 1-phase vs 3-phase breaker box, hybrid battery cabinet, DC/AC conduit + SPD, PEA/MEA bi-directional meter, e-Tax 200k invoice, etc.) rendered **natively inside the chosen style's visual engine**, while offloading heavy rendering (Remotion MP4 & custom 3D Blender `bpy` assets when 3D styles are used) to Homelab Agent Hub worker nodes (`asridaytrade`).

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **100% Topic-Specific Visuals Across All Scenes:** Every non-media scene (`title`, `steps`, `bullets`, `stat`, `compare`, `quote`) receives a custom AI-designed scene illustration tailored to its exact narration and meaning.
- **Style-Native Rendering for `look-46` (Pencil to Blueprint):** Custom AI scene geometry is rendered through `look-46`'s authentic dual-layer pipeline: animated graphite pencil sketch (`#25262B` + paper tooth + construction lines) on `#ECECE6` graph paper → organic wet-ink cyanotype flood (`#1C4C8F` + `#143C76` tide line) → crisp white engineering blueprint (`#EEF4FB`) + domain-accurate dimensions and callouts.
- **Visual Cohesion Within a Video:** All 14 scenes of a `look-46` video live inside the same graph-paper-to-blueprint world (including native blueprint layouts for `bullets`/checklists and `chart`/comparisons) rather than ping-ponging to dark `#0F172A` cards.
- **Immediate Readability:** Scene titles/headers appear within the first `0.2–0.5s` (dual-ink masked seamlessly across paper and blueprint), and key blueprint flood + annotations complete by `~42–48%` of scene duration so the midpoint and second half are crystal-clear.
- **Data + Custom Vector Harmony Across Other Styles:** For other styles using `DynamicMotionStage`, data fields (`stat`, `steps`, `bullets`, `compare`, `quote`) render cleanly alongside the AI's custom vector illustration instead of being dropped or skipped.
- **Style-Aware 3D Gating + Generative `bpy` Custom 3D Props on Workers:** Pure 2D styles no longer get shrunken to 62% or polluted with 3D clay props by default. For 3D styles (or explicit `sceneArt: true`), `scene_art.py` can synthesize AST-validated custom procedural Blender `bpy` scripts for domain subjects missing from the static 20-prop library and render them on `asridaytrade`.
- **End-to-End Proof on `mwz7i0wd-4cb67c`:** Rebuild the 14-scene solar rooftop video (reusing cached `gemini:Fenrir` TTS audio at `฿0.00` extra TTS cost), offload Remotion render to `asridaytrade`, pass visual QA across all 14 keyframes, and deliver to Telegram + clickable Master links.

### Non-Goals
- Rewriting all 45 other `batchA..batchQ` style components from scratch (existing styles continue working and gain upgraded `DynamicMotionStage` data+vector support and clean 2D/3D `sceneArt` gating).
- Changing TTS voice synthesis, audio loudness/ducking (`mix_audio.py`), or video editor EDL export.

### Anti-Goals (Must Never Happen)
- **Zero Cliché Metaphor Hallucinations:** Never draw rockets for `"งบพุ่ง"`, chairs for `"ห้ามแอบติด"`, pill bottles/flasks for `"เช็ก 5 จุด"`, or cameras for `"ลดหย่อนภาษี"`. Literal domain objects always beat generic stock clichés.
- **Zero Shrunken 62% Cards + Dark Muddy 3D Blobs on 2D Styles:** Never shrink a 2D full-stage style (`look-46`, `look-30`, `look-44`, `look-45`, etc.) to paste a 3D clay prop underneath.
- **Zero Heavy Local Compute on `homelab`:** Never run full MP4 Remotion renders or heavy Blender renders directly on `homelab` when a worker node (`asridaytrade`) is online.

---

## 3. Constraints

1. **Mandatory Self-Protection & Offload Protocol:**
   - Remotion MP4 rendering MUST go through `/home/dev/.local/bin/motion-studio render` → `/home/dev/.local/bin/agent-ctl remotion` → `asridaytrade` (`ensureMotionBundle()` in `agent-hub-manager.js` automatically re-bundles `/home/dev/.local/share/motion-studio/src` when files change without restarting `lab-dashboard`).
   - Any Blender 3D rendering MUST go through `/home/dev/.local/bin/agent-ctl blender` to online workers (`asridaytrade`), falling back locally ONLY on exit code `3` (`NO_NODE`).
2. **Remotion 4 Determinism & Dependencies:**
   - Do NOT `npm install` any new packages in `/home/dev/.local/share/motion-studio`.
   - Zero `Math.random()` or `Date.now()` inside Remotion React components — all wobble/noise/animations must be 100% deterministic from `sceneIndex`, element `id`, and `localFrame`.
3. **9:16 Safe Zones & Thai Typography:**
   - Canvas is `1080×1920`. Keep primary visual & text content strictly within `x ∈ [54, 1026]`, `y ∈ [112, 1420]` (`SUBTITLE_BOTTOM_SAFE = 320`, captions occupy `y ≈ 1460..1600`).
   - Thai text requires `Noto Sans Thai` (`THAI_FONT_FAMILY`), `lineHeight >= 1.32–1.38`, and vertical padding so upper/lower Thai vowels and tone marks never clip.
4. **Live-to-Monorepo Sync & Zero-Disruption Rule:**
   - Do NOT run `pm2 restart lab-dashboard` (no `lab-dashboard` server JS changes are required; `studio_job.py` and `motion-studio/src` are loaded fresh per job/bundle).
   - Sync all modified files in `/home/dev/.local/share/motion-studio/` to `/home/dev/projects/homelab-server/motion-studio/`, scan staged diff for secrets, commit, push to `origin/main`, and notify Telegram.

---

## 4. Approaches Considered

### Approach 1 (Selected): Generative Style-Native Vector & 3D Engine Across All Scenes
- **How it works:** Upgrade `scene_vector.py` into a 2-pass AI Visual Architect (1 holistic storyboard call + parallel per-scene vector drafting for **all** scenes, layout-zone-aware). Upgrade `look-46` (`batchR.tsx`) to consume `scene.vector` natively inside `L46FloodCanvas` (rendering AI geometry as hand-drawn pencil first, then crisp white blueprint under the wet-ink flood, with native shots for all scene types including checklists & charts, and immediate dual-ink title reveal). Upgrade `DynamicMotionStage.tsx` for other styles to render structured data alongside custom AI vectors. Gate `scene_art.py` to 3D-compatible styles by default, and add AST-validated AI procedural `bpy` generation for custom 3D subjects on `asridaytrade`.
- **Trade-offs:** Adds ~35–75s of parallel AI vector planning per new uncached job, in exchange for 100% topic-accurate visuals on every scene, deterministic Remotion rendering, full scene-by-scene editability in Video Studio, and faithful preservation of each style's signature craft.

### Approach 2 (Rejected): Full Per-Job Custom `.tsx` Remotion Codegen
- **How it works:** Have an LLM write a brand-new React/Remotion `.tsx` project per video job.
- **Why rejected:** Slow (3–5 minutes + TypeScript compile-fix loops per job), fragile when editing a single scene in Video Studio (`edit-scene`), and easily drifts away from curated style specs and safe zones.

### Approach 3 (Rejected): Pure 3D Blender Renders for Every Style
- **Why rejected:** Replaces 2D graphic styles like `look-46` (Pencil to Blueprint) with 3D renders, losing the pencil-and-cyanotype medium the user specifically chose.

---

## 5. Detailed Architecture & Component Design

### 5.1 Two-Pass AI Scene Visual Architect (`scripts/scene_vector.py` — `SPEC_VERSION = 2`)

1. **Style-Aware Scene Selection (`choose_scenes`):**
   - `DYNAMIC_NATIVE_VECTOR_STYLES = {"look-46"}` (styles whose `StyleDirectorDef` sets `rendersOwnVector: true`).
   - In default `mode="auto"`:
     - If `styleId` is in `DYNAMIC_NATIVE_VECTOR_STYLES` (`look-46`): selects **ALL non-media scenes (`100%`)**, because `look-46` renders `scene.vector` natively inside its own Pencil-to-Blueprint `ShotComponent`s across every scene type.
     - If `styleId` is an illustrated/cartoon character style (`look-2`, `look-5`, `look-7`, `look-8`): selects **none** in `auto` mode so `FlatCartoonLayout` and `IllustratedLayout` keep their bespoke character staging (unless caller explicitly passes `dynamicStage: "all"`).
     - For the remaining styles (`look-1`..`look-45` outside the above): selects scenes whose planned shot is a generic `data-*` fallback (or non-style-directed custom styles) plus up to 2 non-data scenes without overriding bespoke `batchA..batchQ` signature shots (`StyleDirectedLayout` only swaps to `DynamicMotionStage` when `activeShot` is `data-*` or when `scene.vector.forceStage === true` from `mode="all"`).
   - Explicit `dynamicStage: "all"` selects 100% of non-media scenes on any style (setting `forceStage: true`); `dynamicStage: "off"` disables vector generation.

2. **Layout-Aware Safe Drawing Box (`_drawing_box_for_scene`):**
   Each scene's shot type is resolved deterministically by the exact same data-shape priority rules as `planStyleShots` (`stat` → `blueprint-dimension-stat`, `compare | quote` → `blueprint-sketch-vs-spec`, `steps` → `blueprint-process-steps`, `bullets` → `blueprint-checklist-spec`, else `blueprint-object-title`), guaranteeing 1-to-1 alignment between Python `drawingBox` planning and TypeScript Remotion rendering:
   - **`look-46` style-native blueprints:**
     - `title` (`blueprint-object-title`): `x: 110..910, y: 330..1160` (leaves top title `y: 120..300`, right height dim `x: 920..1010`, bottom width dim `y: 1180..1340`).
     - `steps` (`blueprint-process-steps`): `x: 220..860, y: 470..1030` (central blueprint diagram with up to 4 callout anchor points connected by leader lines to top/bottom numbered cards at `y: 280..450` and `y: 1120..1360`).
     - `stat` (`blueprint-dimension-stat`): `x: 160..900, y: 310..860` (leaves giant primary dimension span at `y: 920..1120` and spec title-block at `y: 1170..1380`).
     - `compare` / `quote` (`blueprint-sketch-vs-spec`): `x: 140..940, y: 310..860` (straddling `x = 540` so left half is pencil draft and right half is blueprint spec, leaving comparison columns / dual-ink quote at `y: 910..1390`).
     - `bullets` (`blueprint-checklist-spec`, new): `x: 140..940, y: 300..820` (custom blueprint diagram on upper stage + crisp numbered engineering inspection items at `y: 860..1390`).
   - **Generic `DynamicMotionStage` (other styles):**
     - Pure `title`/`icon` scenes: `x: 80..1000, y: 520..1460` (`textZone: "top"`).
     - Data scenes (`stat`, `steps`, `bullets`, `compare`, `quote`): `x: 90..990, y: 430..980` (hero illustration in middle stage, title header at `y: 136..395`, structured data panel at `y: 1010..1430`).

3. **Pass 1 — Holistic Visual Storyboard (`_ai_plan_storyboard`):**
   - Single LLM call (`sj.run_agy_with_fallback`, timeout `90s`) receiving `video_title`, `style_id`, and compact summaries of all scenes (`id`, `badge`, `title`, `subtitle`, `narration`, `visual`).
   - Returns JSON mapping each `sceneId` to:
     - `subject`: concrete physical/architectural diagram description in English/Thai (e.g., `"Cross-section of Thai residential roof tilted 15° south with 6 solar panels receiving direct sun rays, contrasted with no tree shade"`).
     - `codeTag`: short technical sheet code (e.g., `"SOLAR-01 · ROOF LOAD"`, `"ELEC-02 · 1P VS 3P"` — never `"DWG-46C · VEHICLE"`).
     - `dims`: up to 3 real domain measurements/labels relevant to the scene (`widthLabel`, `heightLabel`, `detailLabel`, e.g. `"5 kWp"`, `"10–15°"`, `"≤20 kg/m²"`).
   - **Strict Anti-Cliché Prompt Rule:** Explicitly bans unrelated stock metaphors (`rocket`, `spaceship`, `chair`, `pill bottle`, `flask`, `camera`, `dartboard`, `trophy`) unless the topic literally concerns aerospace, furniture, medicine, or photography. Every scene in the video must depict a **distinct** aspect/component of the topic.

4. **Pass 2 — Parallel High-Detail Vector Generation (`_ai_vector_spec` via `ThreadPoolExecutor(max_workers=3)`):**
   - Runs up to 3 concurrent `run_agy_with_fallback` calls so 14 scenes finish in ~40–65s.
   - Upgraded schema (`SPEC_VERSION = 2`, backward-compatible with v1):
     - `MAX_ELEMENTS = 64`, `MAX_POINTS = 64`.
     - Optional element fields: `role` (`"bg" | "construct" | "primary" | "detail" | "accent"`), `dashed` (`bool`), `rotate` (`-360..360`).
     - Top-level `meta`: `{ codeTag, widthLabel, heightLabel, detailLabel, bbox: {left, right, top, bottom}, calloutAnchors: [[x,y], ...] }`.
   - Prompt instructs the AI art director to build recognizable, multi-part technical/illustrative silhouettes (20–45 crisp geometric primitives & curves inside `drawingBox`, e.g., pitched roof rafters + solar panel grid cells + sun rays + inverter box + conduit lines + breaker switches + meter dial) with zero `<text>` elements.
   - Automatic heuristic vector fallback (`_fallback_topic_vector_spec`) if AI is disabled or times out: composes clean domain-matched schematic diagrams (solar roof/sun/grid/panel/meter/shield/chart) rather than ever falling back to rockets or chairs.

### 5.2 Style-Native Blueprint Engine for `look-46` (`src/studio/styleDirector/batchR.tsx`, `types.ts`, `plan.ts`, `StyleDirectedLayout.tsx`)

1. **`StyleDirectorDef` Capabilities (`src/studio/styleDirector/types.ts`, `StyleDirectedLayout.tsx`, `families.tsx`, `plan.ts`):**
   - Add `rendersOwnVector?: boolean` and `preferNativeShotsOnly?: boolean` to `StyleDirectorDef` (both `true` on `look-46`).
   - In `StyleDirectedLayout.tsx`:
     - When `def.rendersOwnVector` is `true` (`look-46`), always render `<ShotComponent />` so `look-46` renders `scene.vector` through its own Pencil-to-Blueprint wet-ink flood engine across all 5 native shots.
     - When `!def.rendersOwnVector` (`look-1`..`look-45`), render `<DynamicMotionStage />` only when `hasVector && (activeShot.startsWith('data-') || Boolean(scene.vector?.forceStage))` so bespoke non-`data-*` `batchA..batchQ` signature shots are preserved unless `dynamicStage: "all"` (`forceStage: true`) is explicitly requested. Similarly, in `FamilySceneRenderer` (`families.tsx`), `IllustratedLayout` (`look-5`, `look-7`, `look-8`) and `FlatCartoonLayout` (`look-2`) stay active unless `scene.vector?.forceStage` is `true`.
   - In `plan.ts`: when `def.preferNativeShotsOnly` is `true`, use **data-shape-driven native shot mapping** (`stat` → `blueprint-dimension-stat`, `bullets` → `blueprint-checklist-spec`, `steps` → `blueprint-process-steps`, `compare | quote` → `blueprint-sketch-vs-spec`, else `direction.shot` / `def.infer` / `blueprint-object-title`) instead of forcing `minUsage` round-robin or `k !== prev` across mismatched shot types. Consecutive or repeated scene types (`s4`→`s5` stats, `s13`→`s14` quotes) keep their matching native data shot so structured data is never dropped, receive incrementing `variant` indices (`0, 1, 2...`) for camera/flood variation, and stay 100% 1-to-1 aligned with `_drawing_box_for_scene` in `scene_vector.py` (including overriding stale `direction.shot` when `bullets`/`stat`/`compare`/`quote` data requires its dedicated blueprint shot).

2. **Palette & Preset Alignment (`assets/studio_style_presets.json`):**
   - Update `look-46` tokens in `studio_style_presets.json` so its base `bg` (`#1C4C8F`), `bgSecondary` (`#143C76`), `cardBg` (`#163F7A`), `fg` (`#EEF4FB`), `accent` (`#ECECE6`), `accent2` (`#7FA3C4`), and `border` (`#4B79B4`) match authentic cyanotype blueprint tones (eliminating dark `#0F172A` flashes during transitions or subtitle bars).

3. **Dual-Layer Vector Renderer (`L46VectorPencilLayer` & `L46VectorBlueprintLayer` in `batchR.tsx`):**
   - When `scene.vector?.elements` is present:
     - **Bounding-Box Auto-Fit:** Computes actual element bounds and maps cleanly into the shot's target stage region (preserving aspect ratio with safe margins, never clipping or overlapping headers/callouts).
     - **Pencil Pass (`L46VectorPencilLayer`):**
       - Construction centerlines (`role === "construct"` or auto-derived central axes) draw first in `L46.pencilSoft` (`1.35px`).
       - Primary & detail shapes (`rect`, `circle`, `ellipse`, `polygon`, `line`, `path`, `group`) render with `url(#uid-pencil-tooth)` graphite displacement, `stroke={L46.pencil}`, progressive `strokeDashoffset` reveal (`pathLength={1000}`), plus a subtle second slightly offset over-sketch pass (`opacity: 0.42`) for authentic hand-drafted feel, and light graphite cross-hatching on filled panels.
     - **Blueprint Pass (`L46VectorBlueprintLayer`, masked inside `L46FloodCanvas` wet-ink blob / vertical wave):**
       - Exact same coordinates upgrade to crisp `L46.inkWhite` (`#EEF4FB`) technical strokes (`strokeLinecap="square"`, `dashed` inner lines `strokeDasharray="8 6"`), subtle architectural blueprint washes (`rgba(238, 244, 251, 0.08..0.16)` or cyan/amber technical highlights with high readability), and a popping datum crosshair at the illustration center.
     - **Domain-Accurate Engineering Dimensions:** Uses `scene.vector.meta` (`widthLabel`, `heightLabel`, `detailLabel`, `codeTag`) — displaying real domain specs like `5 kWp`, `10–15°`, `≤ 20 กก./ตร.ม.`, `15 เมตร` instead of fake `316 cm` / `810 mm` rocket/chair measurements!

4. **Complete Native Shot Suite in `batchR.tsx` (5 Shots Covering All Scene Types):**
   - `blueprint-object-title`: Hero pencil-to-blueprint custom drawing + up to 3 domain dimensions + top-left dual-ink title & subtitle.
   - `blueprint-process-steps`: Custom blueprint diagram + up to 4 numbered callout shelves (`01`–`04`) with animated leader lines pointing to `scene.vector.meta.calloutAnchors` on the custom drawing.
   - `blueprint-dimension-stat`: Custom blueprint diagram + giant primary stat dimension span (`stat.value` + `stat.unit`) + bottom engineering specification block (`stat.label`).
   - `blueprint-sketch-vs-spec`: Wet-ink vertical wave splitting left graphite paper vs right blueprint spec — renders `compare` (left vs right columns, e.g., `ใช้ไฟเอง 4.3–4.8 บ.` vs `ขายคืน 2.20 บ.` or `ไฟ 1 เฟส` vs `ไฟ 3 เฟส`) OR dual-ink `quote`.
   - `blueprint-checklist-spec` *(new)*: Upper-stage custom blueprint diagram + lower-stage crisp blueprint engineering inspection checklist (`bullets` items `01`–`04` with technical check/warning markers and horizontal rules) — cleanly handling `s7`, `s9`, `s11` without ever needing dark `data-list` cards!

5. **Immediate Dual-Ink Title & Crisp Pacing (`computeTimelineR`):**
   - `ruleP` and `labelP` start at **frame `2`–`16`** (`~0.07s–0.5s`) instead of waiting until `58%` of the scene!
   - `L46RisingLabel` renders in **dual-ink** synchronized with the flood mask (graphite `#25262B` on paper before the flood reaches the top-left, seamlessly becoming crisp `#EEF4FB` white ink as the blueprint flood passes beneath it) so titles are readable from frame `8` through the entire scene!
   - Faster drafting & flood schedule: pencil sketch `0%..26%`, wet-ink flood `22%..42%`, dimensions & callouts `28%..46%` — guaranteeing that by `46%` (including every `50%` storyboard keyframe), the full blueprint, custom illustration, title, and data are 100% visible!

### 5.3 Data-Complete `DynamicMotionStage.tsx` for Other Styles

- When `DynamicMotionStage` renders a scene on other styles (`!def.rendersOwnVector`):
  - If the scene has `stat`, `steps`, `bullets`, `compare`, or `quote`, render:
    1. Compact top header card (`y: 136..390`) with `badge`, `title`, `subtitle`.
    2. Custom animated AI vector illustration (`scene.vector.elements`) in the central hero stage (`y: 410..1010`).
    3. Structured data panel (`y: 1030..1430`, strictly above `SAFE_BOTTOM` / subtitles):
       - `stat`: large tabular value + unit + label.
       - `steps` / `bullets`: 2–4 clean numbered/bulleted glass pills.
       - `compare`: 2-column side-by-side comparison cards (`leftTitle`/`leftItems` vs `rightTitle`/`rightItems`).
       - `quote`: stylized pull-quote card with author.
  - Pure `title`/`icon` scenes keep the existing spacious full-stage layout.

### 5.4 Style-Aware 3D Gating & Generative Blender `bpy` Props (`scripts/scene_art.py` + `scripts/scene_art_blender.py`)

1. **2D vs 3D Default Gating (`should_enable_scene_art`):**
   - `DEFAULT_3D_SCENE_ART_STYLES`: `look-10`..`look-18` (หมวดงาน 3D), `look-21` (Isometric Flow), `look-28` (3D Map Route), `look-29` (Exploded Teardown), `look-34` (App Mockup).
   - If `request.sceneArt` is `None`/`"auto"` (default), `run_scene_art_stage` runs **only** when `styleId` is in `DEFAULT_3D_SCENE_ART_STYLES`.
   - If `request.sceneArt is True` or `"force"`, it runs on any style; if `False` or `"off"`, it is disabled.
   - Result: `look-46` (and all 2D flat/ink/blueprint/editorial/print styles) renders full-screen `1080×1920` (`shotScale = 1.0`) with zero shrunken cards and zero mismatched 3D clay props!

2. **Vibrant Palette Guard + Custom AI Procedural `bpy` Builder on Workers (`scene_art.py` + `scene_art_blender.py`):**
   - When `scene_art.py` *does* run (for 3D styles or `sceneArt: true`), if a scene's topic has no strong semantic match in the 20 built-in `PROP_LIBRARY` items, `_ai_custom_bpy_code` prompts AI to write a compact, pure-geometry `build_custom_prop(mats, rng)` Python function using `scene_art_blender.py`'s existing helper API (`_new_empty`, `_add_box`, `_add_cyl`, `_add_cone`, `_add_sphere`, `_add_torus`, `_add_curve_tube`, `mats["primary"|"secondary"|"fg"|"metal"|"glass"|"glow1"|"glow2"]`).
   - **Strict AST Sandbox Validator (`validate_custom_bpy_ast`):** Parses with Python `ast.parse`, rejecting any `import`, `open`, `exec`, `eval`, `compile`, `__` dunder attribute access, or calls outside the whitelisted geometry/math functions before embedding into the job's `.py` script and dispatching via `/home/dev/.local/bin/agent-ctl blender` to `asridaytrade` (upgraded to `64` render samples on worker GPUs). If validation or remote render fails, gracefully falls back to `PROP_LIBRARY`.
   - Palette brightness guard ensures `accent` / `accent2` passed to Blender always have luminance `>= 0.18` and saturation `>= 0.25` so 3D props never look like dark charcoal lumps.

---

## 6. Verification & Delivery Plan

1. **Unit & Type Checks:**
   - Run `npx tsc --noEmit` in `/home/dev/.local/share/motion-studio` to verify zero TypeScript errors across `StudioEngine`, `batchR.tsx`, `DynamicMotionStage.tsx`, `StyleDirectedLayout.tsx`, `plan.ts`, and `types.ts`.
   - Run Python unit tests / sanity checks on `scene_vector.py` (storyboard + parallel vector spec validation + bounds clamping) and `scene_art.py` (2D style gating + AST sandbox validator).
2. **Full Rebuild of Solar Rooftop Video (`mwz7i0wd-4cb67c`) on `asridaytrade`:**
   - Clear stale `scene_art` from `mwz7i0wd-4cb67c`, generate fresh 14-scene AI blueprint vector specs (`scene_vector.py`), and run `studio_job.py rebuild --job /home/dev/.gemini/outputs/video-studio/jobs/mwz7i0wd-4cb67c` (reuses cached `gemini:Fenrir` TTS audio, dispatches Remotion render to `asridaytrade` via `agent-ctl remotion`).
3. **Mandatory Visual QA (`read_file` on Storyboard PNG):**
   - Inspect all 14 keyframes of the new storyboard PNG: verify every single scene has a custom solar/house/roof/sun/breaker/battery/conduit/contract/meter/e-Tax pencil-to-blueprint drawing, readable Thai titles & data at midpoint, zero rockets/chairs/bottles/cameras, zero shrunken grey 3D blobs, and zero safe-zone clipping.
   - Check audio loudness (`motion-studio loudness`, target `-15` to `-13` LUFS).
4. **Delivery, Repo Sync & Notification:**
   - Send finished Master MP4 to Telegram via `/home/dev/.local/bin/motion-studio send-telegram` with cost & remaining credit report, and provide inline GIF/Storyboard previews + clickable Dashboard Watch/Download links.
   - Sync `/home/dev/.local/share/motion-studio` → `/home/dev/projects/homelab-server/motion-studio`, scan diff for secrets, commit, `git push origin main`, and send system update summary via `notify-telegram.py`.

---

## 7. Builder Latitude (Left to Implementation)

- Exact coordinate padding/margins inside `L46VectorPencilLayer` / `L46VectorBlueprintLayer` auto-fit math, as long as elements stay strictly inside `x ∈ [54, 1026]` and `y ∈ [112, 1420]`.
- Exact prompt wording and retry/timeout tuning in `scene_vector.py` and `scene_art.py` (`3` parallel workers, `90–120s` per call).
- Heuristic fallback schematic shapes in `_fallback_topic_vector_spec` when `--no-ai` is used.

---

## 8. Builder Calls Recorded During Spec Review

1. **Preserve bespoke shots on `look-1`..`look-45` in `auto` mode (Builder Call):** `look-46` (`rendersOwnVector: true`) generates and renders custom AI vectors on 100% of scenes inside its own blueprint engine. On the other 45 styles, `auto` mode upgrades `data-*` fallback shots (plus up to 2 hero scenes where appropriate) with `DynamicMotionStage` without wiping out bespoke `batchA..batchQ` signature shots, `IllustratedLayout` (`look-5/7/8`), or `FlatCartoonLayout` (`look-2`) unless `dynamicStage: "all"` is explicitly set.
2. **Data-shape-driven shot mapping for `preferNativeShotsOnly` (Builder Call):** On `look-46`, `planStyleShots` maps each scene directly to the native `blueprint-*` shot matching its data payload (`stat`, `bullets`, `steps`, `compare`/`quote`, `title`) and differentiates repeated types via `variant` (`0, 1, 2...`), rather than forcing round-robin onto `blueprint-object-title` (which would drop `stat`/`quote` data and desync `drawingBox` coordinates).
3. **2D vs 3D `scene_art` default gating (Builder Call):** `scene_art.py` defaults to `off` on 2D styles (`look-46`, etc.) so 2D compositions stay 100% full-screen (`shotScale = 1.0`), while remaining active by default on 3D styles (`look-10..18`, `look-21`, `look-28`, `look-29`, `look-34`) with new AST-validated custom `bpy` procedural prop generation on `asridaytrade`.
4. **Reuse cached `gemini:Fenrir` voiceover on `mwz7i0wd-4cb67c` rebuild (Builder Call):** Since the narration and timings are already good, rebuilding `mwz7i0wd-4cb67c` reuses the existing TTS audio (`฿0.00` extra TTS spend) and focuses compute on AI blueprint drafting + `asridaytrade` Remotion rendering.
