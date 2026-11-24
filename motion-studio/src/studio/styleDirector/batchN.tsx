import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import type { StudioScene } from '../types';
import {
  FitText,
  SAFE_BOTTOM,
  STAGE_H,
  STAGE_W,
  appear,
  clamp01,
  easeOutCubic,
  sceneTexts,
  stagger,
} from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

// ============================================================================
// SHARED HELPERS FOR BATCH N (look-40 Retro CRT Glow, look-41 Oscilloscope)
// Pure, Deterministic, Inline SVG/CSS Only, Zero External Assets
// Safe stage bounds: x ∈ [54, 1026], y ∈ [112, CONTENT_BOTTOM (=1420)]
// ============================================================================

const CONTENT_BOTTOM = SAFE_BOTTOM - 120; // 1420
const SAFE_X = 54;
const SAFE_TOP = 112;
const SAFE_W = STAGE_W - SAFE_X * 2; // 972

const FONT_THAI = THAI_FONT_FAMILY;
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// Hardcoded palettes from assets/styles_catalog.json & signatures.tsx
const LOOK40 = {
  roomBg: '#04050A',
  tubeBlack: '#07090F',
  tubeGlass: '#0B0E16',
  tubeCenter: '#121724',
  bezelOuter: '#1D1815',
  bezelMid: '#2A221D',
  bezelInner: '#11141C',
  bezelRim: '#3C3129',
  phosphorCore: '#FCFBF8',
  phosphorCoral: '#FF9A90',
  phosphorRed: '#F05A4A',
  phosphorSoft: 'rgba(255, 154, 144, 0.72)',
  sysText: 'rgba(252, 251, 248, 0.82)',
  sysMuted: 'rgba(252, 251, 248, 0.56)',
  chromaRed: 'rgba(240, 90, 74, 0.48)',
  chromaCyan: 'rgba(92, 208, 255, 0.34)',
} as const;

const LOOK41 = {
  bg: '#030805',
  tubeGlow: '#09150E',
  gridDeep: '#0D2216',
  gridLine: 'rgba(70, 255, 140, 0.14)',
  gridAxis: 'rgba(70, 255, 140, 0.32)',
  trace: '#46FF8C',
  core: '#D7FFF3',
  softText: 'rgba(215, 255, 243, 0.78)',
  mutedText: 'rgba(134, 240, 178, 0.62)',
  panelBg: 'rgba(6, 18, 11, 0.76)',
  panelBorder: 'rgba(70, 255, 140, 0.28)',
} as const;

function seededHashN(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function haystackOfN(scene: StudioScene): string {
  const t = sceneTexts(scene);
  const hl = Array.isArray(scene.highlight) ? scene.highlight.join(' ') : String(scene.highlight || '');
  return [
    t.badge,
    t.title,
    t.subtitle,
    hl,
    ...t.bullets,
    scene.stat?.label || '',
    scene.stat?.delta || '',
    scene.quote?.text || '',
    scene.compare?.leftTitle || '',
    scene.compare?.rightTitle || '',
  ].join(' ');
}

function extractPointsN(scene: StudioScene, max = 4): string[] {
  const t = sceneTexts(scene);
  const out: string[] = [];

  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    for (const s of scene.steps) {
      if (typeof s === 'string') {
        if (s.trim()) out.push(s.trim());
      } else if (s?.title) {
        out.push(s.detail ? `${s.title} — ${s.detail}` : s.title);
      }
    }
  } else if (t.bullets.length > 0) {
    out.push(...t.bullets);
  } else if (scene.compare) {
    const combined = [...(scene.compare.leftItems || []), ...(scene.compare.rightItems || [])];
    for (const item of combined) {
      const clean = String(item || '').trim();
      if (clean) out.push(clean);
    }
  } else if (scene.stat) {
    if (scene.stat.label) out.push(scene.stat.label);
    if (scene.stat.delta) out.push(scene.stat.delta);
    if (t.subtitle) out.push(t.subtitle);
  } else if (scene.quote?.text) {
    out.push(scene.quote.text);
    if (scene.quote.author) out.push(`— ${scene.quote.author}`);
  } else if (t.subtitle) {
    out.push(t.subtitle);
  }

  if (out.length === 0 && t.title) out.push(t.title);
  return out.slice(0, max);
}

function parseNumericN(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw || '').replace(/,/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const val = parseFloat(m[0]);
  return Number.isFinite(val) ? val : fallback;
}

function extractPrimaryMetricN(
  scene: StudioScene,
  fallbackNum = 98,
  fallbackUnit = '%',
): { big: string; unit: string; numeric: number; label: string; delta: string; progress: number } {
  const t = sceneTexts(scene);
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const rawVal = String(scene.stat.value).trim();
    const prefix = String(scene.stat.prefix || '').trim();
    const suffix = String(scene.stat.suffix || '').trim();
    const effPrefix = prefix && !rawVal.startsWith(prefix) ? prefix : '';
    const effSuffix = suffix && !rawVal.endsWith(suffix) ? suffix : '';
    const big = `${effPrefix}${rawVal}${effSuffix}`.trim();
    const numeric = scene.stat.numericValue ?? parseNumericN(rawVal, fallbackNum);
    const absNum = Math.abs(numeric);
    const prog =
      typeof scene.stat.progress === 'number' && Number.isFinite(scene.stat.progress)
        ? clamp01(scene.stat.progress / 100)
        : absNum > 0 && absNum <= 100
          ? clamp01(absNum / 100)
          : 0.78;
    return {
      big,
      unit: String(scene.stat.unit || '').trim(),
      numeric,
      label: String(scene.stat.label || t.subtitle || t.title).trim(),
      delta: String(scene.stat.delta || '').trim(),
      progress: prog,
    };
  }
  if (t.numbers.length > 0) {
    const first = t.numbers[0];
    const numeric = parseNumericN(first, fallbackNum);
    const absNum = Math.abs(numeric);
    return {
      big: first,
      unit: '',
      numeric,
      label: t.subtitle || t.title,
      delta: t.badge || '',
      progress: absNum > 0 && absNum <= 100 ? clamp01(absNum / 100) : 0.82,
    };
  }
  return {
    big: `${fallbackNum}${fallbackUnit}`,
    unit: '',
    numeric: fallbackNum,
    label: t.title || t.subtitle || 'ON AIR',
    delta: t.badge || '',
    progress: 0.86,
  };
}

function formatTimecodeN(frame: number, fps: number): string {
  const safeFps = Math.max(1, fps || 30);
  const totalSec = Math.max(0, Math.floor(frame / safeFps));
  const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const secs = String(totalSec % 60).padStart(2, '0');
  const remFrames = String(Math.max(0, Math.floor(frame) % safeFps)).padStart(2, '0');
  return `${mins}:${secs}:${remFrames}`;
}

function highlightTextOfN(scene: StudioScene): string {
  if (!scene.highlight) return '';
  if (Array.isArray(scene.highlight)) {
    return scene.highlight.map((h) => String(h || '').trim()).filter(Boolean).join(' · ');
  }
  return String(scene.highlight).trim();
}

function phosphorShadowN(chromaPx = 1.4, intensity = 1): string {
  const c = chromaPx.toFixed(2);
  const a1 = (0.76 * intensity).toFixed(2);
  const a2 = (0.42 * intensity).toFixed(2);
  const a3 = (0.22 * intensity).toFixed(2);
  return [
    `${(-chromaPx).toFixed(2)}px 0 0 rgba(240, 90, 74, ${(0.44 * intensity).toFixed(2)})`,
    `${c}px 0 0 rgba(92, 208, 255, ${(0.30 * intensity).toFixed(2)})`,
    `0 0 8px rgba(255, 154, 144, ${a1})`,
    `0 0 22px rgba(240, 90, 74, ${a2})`,
    `0 0 42px rgba(240, 90, 74, ${a3})`,
  ].join(', ');
}

function scopeTextShadowN(intensity = 1): string {
  return [
    `0 0 8px rgba(70, 255, 140, ${(0.62 * intensity).toFixed(2)})`,
    `0 0 22px rgba(70, 255, 140, ${(0.28 * intensity).toFixed(2)})`,
  ].join(', ');
}

// ============================================================================
// LOOK-40: RETRO CRT GLOW — SHARED CRT TELEVISION STAGE & PRIMITIVES
// Dark room + vintage TV bezel + barrel-curved glass + scanlines + hum bar
// ============================================================================

const CRT_OUTER_W = SAFE_W; // 972 (x: 54..1026)
const CRT_OUTER_H = CONTENT_BOTTOM - SAFE_TOP; // 1308 (y: 112..1420)
const CRT_SCREEN_PAD_X = 28;
const CRT_SCREEN_PAD_TOP = 28;
const CRT_CONTROL_BAR_H = 88;
const CRT_SCREEN_W = CRT_OUTER_W - CRT_SCREEN_PAD_X * 2; // 916
const CRT_SCREEN_H = CRT_OUTER_H - CRT_SCREEN_PAD_TOP - CRT_CONTROL_BAR_H - 18; // 1174

/**
 * Generates an inline SVG barrel-curved rectangle path inside (0,0)-(w,h).
 * All four sides bow gently outward like a real cathode ray glass tube.
 */
function buildBarrelTubePathN(w: number, h: number, inset = 10, bow = 16): string {
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const r = 42;
  const mx = w / 2;
  const my = h / 2;
  return [
    `M ${x0 + r} ${y0 + bow * 0.45}`,
    `Q ${mx} ${y0 - bow * 0.45}, ${x1 - r} ${y0 + bow * 0.45}`,
    `Q ${x1 - bow * 0.25} ${y0 + bow * 0.25}, ${x1 - bow * 0.45} ${y0 + r}`,
    `Q ${x1 + bow * 0.45} ${my}, ${x1 - bow * 0.45} ${y1 - r}`,
    `Q ${x1 - bow * 0.25} ${y1 - bow * 0.25}, ${x1 - r} ${y1 - bow * 0.45}`,
    `Q ${mx} ${y1 + bow * 0.45}, ${x0 + r} ${y1 - bow * 0.45}`,
    `Q ${x0 + bow * 0.25} ${y1 - bow * 0.25}, ${x0 + bow * 0.45} ${y1 - r}`,
    `Q ${x0 - bow * 0.45} ${my}, ${x0 + bow * 0.45} ${y0 + r}`,
    `Q ${x0 + bow * 0.25} ${y0 + bow * 0.25}, ${x0 + r} ${y0 + bow * 0.45}`,
    'Z',
  ].join(' ');
}

const Look40CrtStage: React.FC<{
  sceneIndex: number;
  localFrame: number;
  fps: number;
  channelLabel: string;
  powerOpenProgress?: number; // 0..1 (1 = fully open)
  hotGlow?: number; // 0..1 extra warm tube bloom during startup
  noiseBoost?: number; // 0..1 extra deterministic static snow
  rollOffsetY?: number; // vertical sync roll offset in px
  children: React.ReactNode;
}> = ({
  sceneIndex,
  localFrame,
  fps,
  channelLabel,
  powerOpenProgress = 1,
  hotGlow = 0,
  noiseBoost = 0,
  rollOffsetY = 0,
  children,
}) => {
  const clipId = `l40-barrel-clip-${sceneIndex}`;
  const barrelPath = buildBarrelTubePathN(CRT_SCREEN_W, CRT_SCREEN_H, 8, 14);

  // Subtle ~1% phosphor flicker and rolling hum bar
  const flicker = 0.992 + 0.008 * Math.sin(localFrame * 1.9 + sceneIndex * 3.1);
  const humY = ((localFrame * 7.5 + sceneIndex * 180) % (CRT_SCREEN_H + 220)) - 110;
  const tc = formatTimecodeN(localFrame, fps);

  // Deterministic static snow particles (stepped every 2 frames)
  const snowTick = Math.floor(localFrame / 2);
  const snowCount = Math.round(28 + noiseBoost * 64);
  const snowDots = Array.from({ length: snowCount }, (_, i) => {
    const baseSeed = sceneIndex * 997 + snowTick * 131 + i * 37;
    const x = seededHashN(baseSeed + 1) * CRT_SCREEN_W;
    const y = seededHashN(baseSeed + 2) * CRT_SCREEN_H;
    const w = 2 + seededHashN(baseSeed + 3) * (noiseBoost > 0.2 ? 18 : 5);
    const h = 1.5 + seededHashN(baseSeed + 4) * 2;
    const op = (0.04 + seededHashN(baseSeed + 5) * 0.09) * (1 + noiseBoost * 2.2);
    return { x, y, w, h, op };
  });

  // Curved scanline arc guides (subtle barrel contour lines)
  const glassSheenOpacity = 0.055 + hotGlow * 0.04;

  return (
    <div
      style={{
        position: 'relative',
        width: STAGE_W,
        height: STAGE_H,
        overflow: 'hidden',
        backgroundColor: LOOK40.roomBg,
        fontFamily: FONT_THAI,
      }}
    >
      {/* Ambient dark room spill from CRT phosphor (multi-layer radial gradients, zero blur filter) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: [
            `radial-gradient(ellipse 68% 42% at 50% 40%, rgba(255, 154, 144, ${(0.08 + hotGlow * 0.07).toFixed(3)}) 0%, rgba(240, 90, 74, 0.03) 45%, rgba(4, 5, 10, 0) 76%)`,
            'radial-gradient(circle at 50% 38%, rgba(28, 36, 54, 0.35) 0%, rgba(4, 5, 10, 0.96) 72%)',
          ].join(', '),
          pointerEvents: 'none',
        }}
      />

      {/* Vintage CRT Television Cabinet inside strict safe bounds x∈[54,1026], y∈[112,1420] */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: SAFE_TOP,
          width: CRT_OUTER_W,
          height: CRT_OUTER_H,
          borderRadius: 42,
          background: `linear-gradient(160deg, ${LOOK40.bezelMid} 0%, ${LOOK40.bezelOuter} 48%, #120F0E 100%)`,
          border: `2px solid ${LOOK40.bezelRim}`,
          boxShadow: [
            'inset 0 2px 0 rgba(255, 224, 210, 0.14)',
            'inset 0 -6px 14px rgba(0, 0, 0, 0.72)',
            '0 28px 64px rgba(0, 0, 0, 0.78)',
          ].join(', '),
          boxSizing: 'border-box',
        }}
      >
        {/* Subtle molded woodgrain / cabinet horizontal texture lines */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 40,
            background:
              'repeating-linear-gradient(90deg, rgba(255,215,190,0.015) 0px, rgba(255,215,190,0.015) 3px, rgba(0,0,0,0.03) 3px, rgba(0,0,0,0.03) 9px)',
            pointerEvents: 'none',
          }}
        />

        {/* Recessed dark CRT bezel well */}
        <div
          style={{
            position: 'absolute',
            left: CRT_SCREEN_PAD_X - 8,
            top: CRT_SCREEN_PAD_TOP - 8,
            width: CRT_SCREEN_W + 16,
            height: CRT_SCREEN_H + 16,
            borderRadius: 34,
            background: `linear-gradient(180deg, #090A0F 0%, ${LOOK40.bezelInner} 100%)`,
            boxShadow:
              'inset 0 6px 18px rgba(0,0,0,0.92), inset 0 -2px 6px rgba(255, 196, 184, 0.08)',
          }}
        />

        {/* Curved Glass Tube Viewport */}
        <div
          style={{
            position: 'absolute',
            left: CRT_SCREEN_PAD_X,
            top: CRT_SCREEN_PAD_TOP,
            width: CRT_SCREEN_W,
            height: CRT_SCREEN_H,
            borderRadius: 30,
            overflow: 'hidden',
            backgroundColor: LOOK40.tubeBlack,
            opacity: flicker,
          }}
        >
          {/* SVG Barrel Mask & Tube Glass Depth */}
          <svg
            width={CRT_SCREEN_W}
            height={CRT_SCREEN_H}
            viewBox={`0 0 ${CRT_SCREEN_W} ${CRT_SCREEN_H}`}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
          >
            <defs>
              <clipPath id={clipId}>
                <path d={barrelPath} />
              </clipPath>
              <radialGradient id={`${clipId}-glass`} cx="50%" cy="46%" r="62%">
                <stop offset="0%" stopColor={LOOK40.tubeCenter} stopOpacity="0.95" />
                <stop offset="56%" stopColor={LOOK40.tubeGlass} stopOpacity="0.98" />
                <stop offset="100%" stopColor={LOOK40.tubeBlack} stopOpacity="1" />
              </radialGradient>
              <radialGradient id={`${clipId}-bloom`} cx="50%" cy="44%" r="54%">
                <stop
                  offset="0%"
                  stopColor={LOOK40.phosphorCoral}
                  stopOpacity={(0.12 + hotGlow * 0.16) * powerOpenProgress}
                />
                <stop
                  offset="48%"
                  stopColor={LOOK40.phosphorRed}
                  stopOpacity={(0.045 + hotGlow * 0.08) * powerOpenProgress}
                />
                <stop offset="100%" stopColor={LOOK40.tubeBlack} stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width={CRT_SCREEN_W} height={CRT_SCREEN_H} fill={LOOK40.tubeBlack} />
            <path d={barrelPath} fill={`url(#${clipId}-glass)`} />
            <path d={barrelPath} fill={`url(#${clipId}-bloom)`} />
          </svg>

          {/* Actual Broadcast Content Layer (inside barrel bounds, supports rollOffsetY) */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              transform: rollOffsetY !== 0 ? `translateY(${rollOffsetY.toFixed(1)}px)` : undefined,
            }}
          >
            {children}
          </div>

          {/* Rolling analog hum bar */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: humY,
              height: 110,
              background:
                'linear-gradient(180deg, rgba(255,154,144,0) 0%, rgba(255,154,144,0.045) 48%, rgba(252,251,248,0.06) 52%, rgba(255,154,144,0) 100%)',
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />

          {/* Fine Low-Opacity Scanlines (repeating-linear-gradient) */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                'repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 3px, rgba(0,0,0,0.22) 3px, rgba(0,0,0,0.22) 5px)',
              pointerEvents: 'none',
              zIndex: 4,
            }}
          />

          {/* Deterministic Snow Grain + Curved Glass Sheen + Barrel Edge Vignette */}
          <svg
            width={CRT_SCREEN_W}
            height={CRT_SCREEN_H}
            viewBox={`0 0 ${CRT_SCREEN_W} ${CRT_SCREEN_H}`}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}
          >
            <defs>
              <radialGradient id={`${clipId}-vig`} cx="50%" cy="50%" r="68%">
                <stop offset="56%" stopColor="#000000" stopOpacity="0" />
                <stop offset="86%" stopColor="#04050A" stopOpacity="0.46" />
                <stop offset="100%" stopColor="#020307" stopOpacity="0.86" />
              </radialGradient>
              <linearGradient id={`${clipId}-sheen`} x1="0%" y1="0%" x2="80%" y2="65%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity={glassSheenOpacity} />
                <stop offset="28%" stopColor="#FFFFFF" stopOpacity={glassSheenOpacity * 0.32} />
                <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Light snow flecks */}
            {snowDots.map((d, idx) => (
              <rect
                key={idx}
                x={d.x}
                y={d.y}
                width={d.w}
                height={d.h}
                fill={idx % 3 === 0 ? LOOK40.phosphorCoral : LOOK40.phosphorCore}
                opacity={d.op}
              />
            ))}

            {/* Diagonal CRT glass sheen */}
            <path
              d={`M 24 24 L ${CRT_SCREEN_W * 0.72} 24 L ${CRT_SCREEN_W * 0.24} ${CRT_SCREEN_H * 0.44} L 24 ${CRT_SCREEN_H * 0.34} Z`}
              fill={`url(#${clipId}-sheen)`}
            />

            {/* Barrel vignette overlay */}
            <rect width={CRT_SCREEN_W} height={CRT_SCREEN_H} fill={`url(#${clipId}-vig)`} />

            {/* Outer dark barrel mask ring to carve true curved CRT corners */}
            <path
              d={`M 0 0 H ${CRT_SCREEN_W} V ${CRT_SCREEN_H} H 0 Z ${barrelPath}`}
              fill={LOOK40.bezelInner}
              fillRule="evenodd"
            />

            {/* Subtle glass rim highlight along barrel edge */}
            <path
              d={barrelPath}
              fill="none"
              stroke="rgba(255, 190, 180, 0.16)"
              strokeWidth="2"
            />
          </svg>
        </div>

        {/* Bottom Physical TV Control Deck (inside CRT cabinet, y ends cleanly at 1420) */}
        <div
          style={{
            position: 'absolute',
            left: CRT_SCREEN_PAD_X,
            right: CRT_SCREEN_PAD_X,
            bottom: 14,
            height: CRT_CONTROL_BAR_H - 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingLeft: 14,
            paddingRight: 14,
          }}
        >
          {/* Left: Power LED + Broadcast Model Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                backgroundColor: LOOK40.phosphorRed,
                boxShadow: `0 0 10px ${LOOK40.phosphorRed}, 0 0 20px rgba(240, 90, 74, 0.55)`,
              }}
            />
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: '0.16em',
                color: 'rgba(252, 251, 248, 0.72)',
              }}
            >
              TRINI-CRT 40
            </div>
            <div
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                backgroundColor: 'rgba(7, 9, 15, 0.85)',
                border: '1px solid rgba(255, 154, 144, 0.24)',
                fontFamily: FONT_MONO,
                fontSize: 16,
                color: LOOK40.phosphorCoral,
                letterSpacing: '0.08em',
              }}
            >
              {channelLabel}
            </div>
          </div>

          {/* Center: Retro Speaker Grille Slots */}
          <svg width={210} height={30} viewBox="0 0 210 30">
            {Array.from({ length: 14 }, (_, i) => (
              <rect
                key={i}
                x={i * 15}
                y={6}
                width={6}
                height={18}
                rx={3}
                fill="#0A090A"
                stroke="rgba(255, 220, 204, 0.08)"
                strokeWidth="1"
              />
            ))}
          </svg>

          {/* Right: Rotary Channel Knobs + Timecode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 16,
                color: 'rgba(252, 251, 248, 0.50)',
                letterSpacing: '0.10em',
              }}
            >
              {tc}
            </div>
            {[0, 1].map((knob) => (
              <svg key={knob} width={34} height={34} viewBox="0 0 34 34">
                <circle cx="17" cy="17" r="15" fill="#141110" stroke="#3F342D" strokeWidth="2" />
                <circle cx="17" cy="17" r="10" fill="#231D1A" />
                <line
                  x1="17"
                  y1="17"
                  x2={knob === 0 ? 24 : 11}
                  y2={knob === 0 ? 11 : 10}
                  stroke={LOOK40.phosphorCoral}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// LOOK-40 SHOT 1: crt-power-on
// Screen powers on from bright horizontal line -> unfolds with overshoot ->
// glowing phosphor broadcast title + typed system status line with block cursor
// ============================================================================

const Look40CrtPowerOn: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);
  const headline = t.title || t.subtitle || 'ON AIR BROADCAST';
  const subText = t.subtitle && t.subtitle !== headline ? t.subtitle : highlightTextOfN(scene);
  const badgeText = t.badge || `CH-0${(sceneIndex % 9) + 1} · SIGNAL LOCKED`;
  const sysLineFull = t.badge
    ? `${t.badge} // 525i PHOSPHOR LOCK`
    : subText
      ? subText
      : 'BROADCAST SYSTEM READY · 525i LOCK';

  // Phase 1 (frames 0..4): horizontal beam swells at center
  const lineExpand = clamp01(localFrame / 4);

  // Phase 2 (frames 4..18): vertical picture unfolds with ~10% overshoot
  const unfoldSpring = spring({
    frame: Math.max(0, localFrame - 4),
    fps: safeFps,
    config: { damping: 12, stiffness: 150, mass: 0.78 },
  });
  const pictureScaleY = localFrame < 4 ? 0.015 : interpolate(unfoldSpring, [0, 1], [0.02, 1]);
  const openRatio = localFrame < 4 ? 0.05 : clamp01(unfoldSpring);

  // Tube starts "hot" during frames 4..20, then settles cleanly
  const hotGlow = localFrame < 4 ? 0.5 : Math.max(0, 1 - (localFrame - 4) / 18);
  const chromaPx = 1.2 + hotGlow * 2.4;

  // Two racing bright scan edges separating from center during power-on
  const edgeSpread = interpolate(clamp01((localFrame - 3) / 12), [0, 1], [0, CRT_SCREEN_H * 0.48]);
  const edgeAlpha = localFrame < 4 ? 0.95 : Math.max(0, 1 - (localFrame - 4) / 13);

  // System line typewriter (~1.4 frames per character) starting after frame 14
  const charsShown = Math.max(0, Math.floor((localFrame - 14) / 1.4));
  const typedSys = sysLineFull.slice(0, Math.min(sysLineFull.length, charsShown));
  const typingDone = charsShown >= sysLineFull.length;
  const cursorBlink = typingDone ? (Math.floor(localFrame / 10) % 2 === 0 ? 1 : 0.16) : 1;

  // Red indicator dot pops on when typing completes
  const redDotScale = typingDone
    ? spring({
        frame: Math.max(0, localFrame - (14 + Math.ceil(sysLineFull.length * 1.4))),
        fps: safeFps,
        config: { damping: 11, stiffness: 220, mass: 0.6 },
      })
    : 0;

  return (
    <Look40CrtStage
      sceneIndex={sceneIndex}
      localFrame={localFrame}
      fps={fps}
      channelLabel={`CH-0${(sceneIndex % 9) + 1}`}
      powerOpenProgress={openRatio}
      hotGlow={hotGlow}
      noiseBoost={hotGlow * 0.35}
    >
      {/* Power-on bright horizontal beam & separating scan edges */}
      {edgeAlpha > 0.01 && (
        <>
          <div
            style={{
              position: 'absolute',
              left: `${(1 - lineExpand) * 42}%`,
              right: `${(1 - lineExpand) * 42}%`,
              top: CRT_SCREEN_H / 2 - edgeSpread - 3,
              height: 6,
              backgroundColor: LOOK40.phosphorCore,
              boxShadow: `0 0 18px ${LOOK40.phosphorCoral}, 0 0 42px ${LOOK40.phosphorRed}`,
              opacity: edgeAlpha,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: `${(1 - lineExpand) * 42}%`,
              right: `${(1 - lineExpand) * 42}%`,
              top: CRT_SCREEN_H / 2 + edgeSpread - 3,
              height: 6,
              backgroundColor: LOOK40.phosphorCore,
              boxShadow: `0 0 18px ${LOOK40.phosphorCoral}, 0 0 42px ${LOOK40.phosphorRed}`,
              opacity: edgeAlpha,
            }}
          />
        </>
      )}

      {/* Unfolding CRT Picture Container */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scaleY(${pictureScaleY.toFixed(4)})`,
          transformOrigin: '50% 50%',
          opacity: localFrame < 3 ? 0 : 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '84px 66px 110px 66px',
          boxSizing: 'border-box',
        }}
      >
        {/* Top Broadcast Header Strip */}
        <div
          style={{
            position: 'absolute',
            top: 52,
            left: 58,
            right: 58,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid rgba(255, 154, 144, 0.22)',
            paddingBottom: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 11,
                height: 11,
                borderRadius: '50%',
                backgroundColor: LOOK40.phosphorRed,
                boxShadow: `0 0 10px ${LOOK40.phosphorRed}`,
              }}
            />
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 20,
                fontWeight: 700,
                color: LOOK40.phosphorCoral,
                letterSpacing: '0.14em',
              }}
            >
              BROADCAST · ON AIR
            </span>
          </div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 18,
              color: LOOK40.sysMuted,
              letterSpacing: '0.12em',
            }}
          >
            NTSC 525i
          </span>
        </div>

        {/* Center Hero Title (White-Hot Core + 3-Layer Coral Phosphor Bloom) */}
        <div
          style={{
            marginTop: -40,
            textAlign: 'center',
          }}
        >
          {t.badge ? (
            <div
              style={{
                display: 'inline-block',
                marginBottom: 26,
                padding: '8px 22px',
                borderRadius: 6,
                border: `1.5px solid rgba(255, 154, 144, 0.45)`,
                backgroundColor: 'rgba(240, 90, 74, 0.14)',
              }}
            >
              <FitText
                text={badgeText}
                baseSize={24}
                minSize={18}
                maxLines={1}
                lineHeight={1.36}
                color={LOOK40.phosphorCoral}
                fontWeight={700}
                fontFamily={FONT_MONO}
                align="center"
                style={{ letterSpacing: '0.08em', textShadow: phosphorShadowN(1, 0.7) }}
              />
            </div>
          ) : null}

          <FitText
            text={headline}
            baseSize={70}
            minSize={38}
            maxLines={3}
            lineHeight={1.38}
            color={LOOK40.phosphorCore}
            fontWeight={800}
            align="center"
            style={{
              letterSpacing: '0.02em',
              textShadow: phosphorShadowN(chromaPx, 1 + hotGlow * 0.4),
            }}
          />

          {/* Decorative Phosphor Horizon Divider */}
          <div
            style={{
              margin: '34px auto 30px auto',
              width: `${Math.round(interpolate(openRatio, [0, 1], [12, 74]))}%`,
              height: 3,
              background: `linear-gradient(90deg, rgba(255,154,144,0) 0%, ${LOOK40.phosphorCoral} 22%, ${LOOK40.phosphorCore} 50%, ${LOOK40.phosphorCoral} 78%, rgba(255,154,144,0) 100%)`,
              boxShadow: `0 0 14px rgba(255, 154, 144, 0.65)`,
            }}
          />

          {/* Secondary broadcast line (if present) */}
          {subText ? (
            <div style={{ marginBottom: 34, paddingLeft: 16, paddingRight: 16 }}>
              <FitText
                text={subText}
                baseSize={32}
                minSize={22}
                maxLines={3}
                lineHeight={1.42}
                color={LOOK40.phosphorCoral}
                fontWeight={600}
                align="center"
                style={{ textShadow: phosphorShadowN(1.1, 0.75) }}
              />
            </div>
          ) : null}
        </div>

        {/* Left-Anchored System Status Typing Line with Red Dot + Block Cursor */}
        <div
          style={{
            position: 'absolute',
            left: 62,
            right: 62,
            bottom: 76,
            padding: '18px 22px',
            borderRadius: 10,
            backgroundColor: 'rgba(7, 9, 15, 0.62)',
            border: '1px solid rgba(255, 154, 144, 0.24)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              flexShrink: 0,
              backgroundColor: LOOK40.phosphorRed,
              transform: `scale(${Math.max(0.35, redDotScale).toFixed(3)})`,
              opacity: typingDone ? 1 : 0.45,
              boxShadow: `0 0 10px ${LOOK40.phosphorRed}`,
            }}
          />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <span
              style={{
                fontFamily: `${FONT_MONO}, ${FONT_THAI}`,
                fontSize: 23,
                fontWeight: 600,
                lineHeight: 1.4,
                color: LOOK40.sysText,
                letterSpacing: '0.04em',
                textShadow: '0 0 8px rgba(255, 154, 144, 0.45)',
              }}
            >
              {typedSys || ' '}
            </span>
            <span
              style={{
                display: 'inline-block',
                width: 14,
                height: 24,
                backgroundColor: LOOK40.phosphorCoral,
                opacity: cursorBlink,
                boxShadow: `0 0 10px ${LOOK40.phosphorCoral}`,
              }}
            />
          </div>
        </div>
      </div>
    </Look40CrtStage>
  );
};

// ============================================================================
// LOOK-40 SHOT 2: crt-channel-list
// Teletext / Vintage TV Channel Guide menu with sweeping block cursor
// ============================================================================

const Look40CrtChannelList: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const points = extractPointsN(scene, 4);
  const safeFps = Math.max(1, fps || 30);

  // Active cursor sweeps row-by-row deterministically across duration
  const sweepSpan = Math.max(24, durationFrames - 16);
  const activeIdx = Math.min(
    points.length - 1,
    Math.floor((Math.max(0, localFrame - 8) / sweepSpan) * points.length),
  );
  const cursorBlink = Math.floor(localFrame / 8) % 2 === 0 ? 1 : 0.3;

  const headerEnter = appear(localFrame, 0, 12);

  return (
    <Look40CrtStage
      sceneIndex={sceneIndex}
      localFrame={localFrame}
      fps={fps}
      channelLabel={`P${100 + (sceneIndex + 1) * 10}`}
      hotGlow={Math.max(0, 1 - localFrame / 14) * 0.45}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: '50px 54px 56px 54px',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        {/* Teletext Top Status Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 16px',
            backgroundColor: 'rgba(240, 90, 74, 0.18)',
            borderTop: `2px solid ${LOOK40.phosphorCoral}`,
            borderBottom: `2px solid rgba(255, 154, 144, 0.42)`,
            marginBottom: 24,
            opacity: headerEnter,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 21,
              fontWeight: 700,
              color: LOOK40.phosphorCore,
              letterSpacing: '0.12em',
              textShadow: phosphorShadowN(1, 0.7),
            }}
          >
            TELETEXT P{100 + (sceneIndex + 1) * 10}
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 20,
              color: LOOK40.phosphorCoral,
              letterSpacing: '0.10em',
            }}
          >
            INDEX · {points.length} CHANNELS
          </span>
        </div>

        {/* Menu Headline */}
        <div
          style={{
            marginBottom: 28,
            transform: `translateY(${((1 - headerEnter) * 16).toFixed(1)}px)`,
            opacity: headerEnter,
          }}
        >
          <FitText
            text={t.title || t.badge || 'รายการช่องสัญญาณ'}
            baseSize={46}
            minSize={28}
            maxLines={2}
            lineHeight={1.38}
            color={LOOK40.phosphorCore}
            fontWeight={800}
            align="left"
            style={{ textShadow: phosphorShadowN(1.3, 0.9) }}
          />
        </div>

        {/* Channel Rows with Sweeping Phosphor Selector */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 18,
          }}
        >
          {points.map((item, idx) => {
            const rowIn = stagger(idx, localFrame, 6, 6, 12);
            const isActive = idx === activeIdx;
            const activeSpring = isActive
              ? spring({
                  frame: Math.max(0, localFrame - 8 - Math.floor((idx * sweepSpan) / points.length)),
                  fps: safeFps,
                  config: { damping: 14, stiffness: 180, mass: 0.7 },
                })
              : 0;
            const chNum = String(idx + 1).padStart(2, '0');
            const barStrength = 3 + ((sceneIndex + idx) % 2);

            return (
              <div
                key={idx}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  padding: '20px 22px',
                  borderRadius: 12,
                  backgroundColor: isActive
                    ? `rgba(240, 90, 74, ${(0.16 + activeSpring * 0.12).toFixed(3)})`
                    : 'rgba(13, 18, 29, 0.72)',
                  border: isActive
                    ? `2px solid ${LOOK40.phosphorCoral}`
                    : '1.5px solid rgba(255, 154, 144, 0.20)',
                  boxShadow: isActive
                    ? '0 0 24px rgba(240, 90, 74, 0.25), inset 0 0 16px rgba(255, 154, 144, 0.12)'
                    : 'none',
                  transform: `translateX(${((1 - rowIn) * -32).toFixed(1)}px)`,
                  opacity: rowIn,
                }}
              >
                {/* Block Cursor Indicator on Active Row */}
                <div
                  style={{
                    width: 14,
                    height: 36,
                    borderRadius: 2,
                    flexShrink: 0,
                    backgroundColor: isActive ? LOOK40.phosphorCore : 'rgba(255, 154, 144, 0.22)',
                    opacity: isActive ? cursorBlink : 0.4,
                    boxShadow: isActive ? `0 0 12px ${LOOK40.phosphorCoral}` : 'none',
                  }}
                />

                {/* Channel Number Pill */}
                <div
                  style={{
                    flexShrink: 0,
                    padding: '6px 12px',
                    borderRadius: 6,
                    backgroundColor: isActive ? LOOK40.phosphorRed : 'rgba(240, 90, 74, 0.16)',
                    fontFamily: FONT_MONO,
                    fontSize: 22,
                    fontWeight: 800,
                    color: LOOK40.phosphorCore,
                    letterSpacing: '0.08em',
                  }}
                >
                  CH {chNum}
                </div>

                {/* Real Thai Bullet Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item}
                    baseSize={28}
                    minSize={20}
                    maxLines={3}
                    lineHeight={1.4}
                    color={isActive ? LOOK40.phosphorCore : LOOK40.sysText}
                    fontWeight={isActive ? 700 : 500}
                    align="left"
                    style={{
                      textShadow: isActive ? phosphorShadowN(1.1, 0.85) : '0 0 6px rgba(255,154,144,0.28)',
                    }}
                  />
                </div>

                {/* Mini Signal Strength Bars */}
                <svg width={28} height={24} viewBox="0 0 28 24" style={{ flexShrink: 0 }}>
                  {[0, 1, 2, 3].map((b) => {
                    const lit = b < barStrength;
                    const bh = 6 + b * 5;
                    return (
                      <rect
                        key={b}
                        x={b * 7}
                        y={24 - bh}
                        width={4.5}
                        height={bh}
                        rx={1}
                        fill={
                          lit
                            ? isActive
                              ? LOOK40.phosphorCore
                              : LOOK40.phosphorCoral
                            : 'rgba(255, 154, 144, 0.16)'
                        }
                      />
                    );
                  })}
                </svg>
              </div>
            );
          })}
        </div>

        {/* Teletext Bottom Guide Bar */}
        <div
          style={{
            marginTop: 22,
            paddingTop: 14,
            borderTop: '1px solid rgba(255, 154, 144, 0.24)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: FONT_MONO,
            fontSize: 18,
            color: LOOK40.sysMuted,
            letterSpacing: '0.08em',
          }}
        >
          <span style={{ color: LOOK40.phosphorRed, fontWeight: 700 }}>■ SELECT</span>
          <span>▲▼ SCAN</span>
          <span style={{ color: LOOK40.phosphorCoral }}>CH 0{activeIdx + 1} LOCKED</span>
        </div>
      </div>
    </Look40CrtStage>
  );
};

// ============================================================================
// LOOK-40 SHOT 3: crt-stat-broadcast
// Big scoreboard stat with segmented CRT LED meter + broadcast lower-third bar
// ============================================================================

const Look40CrtStatBroadcast: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetricN(scene);
  const safeFps = Math.max(1, fps || 30);

  const scorePop = spring({
    frame: Math.max(0, localFrame - 4),
    fps: safeFps,
    config: { damping: 13, stiffness: 150, mass: 0.85 },
  });
  const lowerSlide = spring({
    frame: Math.max(0, localFrame - 12),
    fps: safeFps,
    config: { damping: 16, stiffness: 135, mass: 0.9 },
  });
  const meterProg = clamp01(appear(localFrame, 10, 22)) * metric.progress;
  const totalSegs = 22;
  const litSegs = Math.max(1, Math.round(meterProg * totalSegs));
  const livePulse = 0.65 + 0.35 * Math.sin(localFrame * 0.25);

  return (
    <Look40CrtStage
      sceneIndex={sceneIndex}
      localFrame={localFrame}
      fps={fps}
      channelLabel="LIVE DATA"
      hotGlow={Math.max(0, 1 - localFrame / 16) * 0.55}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: '50px 54px 52px 54px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          boxSizing: 'border-box',
        }}
      >
        {/* Top Broadcast Bug Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 18px',
              borderRadius: 6,
              backgroundColor: 'rgba(240, 90, 74, 0.22)',
              border: `1.5px solid ${LOOK40.phosphorRed}`,
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                backgroundColor: LOOK40.phosphorRed,
                opacity: livePulse,
                boxShadow: `0 0 12px ${LOOK40.phosphorRed}`,
              }}
            />
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 20,
                fontWeight: 800,
                color: LOOK40.phosphorCore,
                letterSpacing: '0.14em',
              }}
            >
              LIVE SCOREBOARD
            </span>
          </div>

          {t.badge ? (
            <div style={{ maxWidth: 420 }}>
              <FitText
                text={t.badge}
                baseSize={20}
                minSize={16}
                maxLines={1}
                lineHeight={1.36}
                color={LOOK40.phosphorCoral}
                fontWeight={700}
                fontFamily={FONT_MONO}
                align="right"
              />
            </div>
          ) : null}
        </div>

        {/* Center Hero Scoreboard Readout */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '44px 36px',
            borderRadius: 20,
            background:
              'radial-gradient(ellipse 85% 75% at 50% 45%, rgba(240, 90, 74, 0.14) 0%, rgba(11, 14, 22, 0.85) 75%)',
            border: '2px solid rgba(255, 154, 144, 0.34)',
            boxShadow: 'inset 0 0 36px rgba(240, 90, 74, 0.14)',
            transform: `scale(${interpolate(scorePop, [0, 1], [0.86, 1]).toFixed(4)})`,
            opacity: clamp01(scorePop * 1.4),
          }}
        >
          {/* Optional Unit / Metric Category */}
          {metric.unit ? (
            <div
              style={{
                marginBottom: 10,
                fontFamily: FONT_MONO,
                fontSize: 24,
                fontWeight: 700,
                color: LOOK40.phosphorCoral,
                letterSpacing: '0.24em',
                textShadow: phosphorShadowN(0.8, 0.65),
              }}
            >
              {metric.unit}
            </div>
          ) : null}

          {/* Giant Phosphor Scoreboard Number */}
          <div style={{ width: '100%' }}>
            <FitText
              text={metric.big}
              baseSize={132}
              minSize={58}
              maxLines={2}
              lineHeight={1.35}
              color={LOOK40.phosphorCore}
              fontWeight={900}
              align="center"
              style={{
                letterSpacing: '0.02em',
                textShadow: phosphorShadowN(1.8, 1.15),
              }}
            />
          </div>

          {/* Delta / Alert Pill */}
          {metric.delta ? (
            <div
              style={{
                marginTop: 18,
                padding: '8px 24px',
                borderRadius: 999,
                backgroundColor: 'rgba(240, 90, 74, 0.24)',
                border: `1.5px solid ${LOOK40.phosphorCoral}`,
              }}
            >
              <FitText
                text={metric.delta}
                baseSize={26}
                minSize={19}
                maxLines={1}
                lineHeight={1.38}
                color={LOOK40.phosphorCore}
                fontWeight={700}
                align="center"
                style={{ textShadow: phosphorShadowN(1, 0.8) }}
              />
            </div>
          ) : null}

          {/* Segmented Analog CRT VU / Progress Meter */}
          <div style={{ width: '100%', marginTop: 34 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 10,
                fontFamily: FONT_MONO,
                fontSize: 17,
                color: LOOK40.sysMuted,
                letterSpacing: '0.10em',
              }}
            >
              <span>SIGNAL LEVEL</span>
              <span style={{ color: LOOK40.phosphorCoral }}>
                {Math.round(meterProg * 100)}%
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, width: '100%' }}>
              {Array.from({ length: totalSegs }, (_, i) => {
                const isLit = i < litSegs;
                const isPeak = i >= totalSegs - 4;
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: 22,
                      borderRadius: 3,
                      backgroundColor: isLit
                        ? isPeak
                          ? LOOK40.phosphorRed
                          : LOOK40.phosphorCoral
                        : 'rgba(255, 154, 144, 0.12)',
                      boxShadow: isLit
                        ? `0 0 10px ${isPeak ? LOOK40.phosphorRed : 'rgba(255, 154, 144, 0.55)'}`
                        : 'none',
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Broadcast Lower-Third News Strip */}
        <div
          style={{
            display: 'flex',
            borderRadius: 12,
            backgroundColor: 'rgba(10, 13, 21, 0.90)',
            border: '1.5px solid rgba(255, 154, 144, 0.36)',
            boxShadow: '0 10px 28px rgba(0, 0, 0, 0.55)',
            transform: `translateX(${interpolate(lowerSlide, [0, 1], [-48, 0]).toFixed(1)}px)`,
            opacity: clamp01(lowerSlide * 1.4),
          }}
        >
          {/* Left Coral-Red Anchor Pillar */}
          <div
            style={{
              width: 14,
              flexShrink: 0,
              borderTopLeftRadius: 10,
              borderBottomLeftRadius: 10,
              backgroundColor: LOOK40.phosphorRed,
              boxShadow: `0 0 14px ${LOOK40.phosphorRed}`,
            }}
          />
          <div style={{ flex: 1, minWidth: 0, padding: '20px 26px' }}>
            <FitText
              text={t.title || metric.label}
              baseSize={34}
              minSize={22}
              maxLines={2}
              lineHeight={1.38}
              color={LOOK40.phosphorCore}
              fontWeight={800}
              align="left"
              style={{ textShadow: phosphorShadowN(1.1, 0.85) }}
            />
            {metric.label && metric.label !== t.title ? (
              <div style={{ marginTop: 8 }}>
                <FitText
                  text={metric.label}
                  baseSize={25}
                  minSize={18}
                  maxLines={2}
                  lineHeight={1.4}
                  color={LOOK40.phosphorCoral}
                  fontWeight={500}
                  align="left"
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Look40CrtStage>
  );
};

// ============================================================================
// LOOK-40 SHOT 4: crt-split-signal
// Dual-signal split screen (compare) or broadcast quote transmission with
// deterministic brief vertical sync-roll + static burst during switch
// ============================================================================

const Look40CrtSplitSignal: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);

  // Deterministic transition sync-roll & noise pulse at entry (0..9) and mid-lock (24..30)
  const entryRoll = localFrame < 9 ? Math.sin(localFrame * 1.6) * (9 - localFrame) * 3.2 : 0;
  const switchDist = Math.abs(localFrame - 27);
  const switchNoise = switchDist < 4 ? (1 - switchDist / 4) * 0.75 : 0;
  const switchRoll = switchDist < 4 ? Math.sin(localFrame * 2.7) * (4 - switchDist) * 3.5 : 0;
  const noiseBoost = Math.max(localFrame < 8 ? (1 - localFrame / 8) * 0.65 : 0, switchNoise);
  const rollOffsetY = entryRoll + switchRoll;

  const isCompare = Boolean(scene.compare);
  const isQuote = !isCompare && Boolean(scene.quote?.text);

  const deckAIn = spring({
    frame: Math.max(0, localFrame - 6),
    fps: safeFps,
    config: { damping: 15, stiffness: 145, mass: 0.85 },
  });
  const deckBIn = spring({
    frame: Math.max(0, localFrame - 16),
    fps: safeFps,
    config: { damping: 15, stiffness: 145, mass: 0.85 },
  });

  if (isCompare && scene.compare) {
    const cmp = scene.compare;
    const leftItems = (cmp.leftItems || []).slice(0, 3);
    const rightItems = (cmp.rightItems || []).slice(0, 3);
    const leftWin = cmp.winner === 'left';
    const rightWin = cmp.winner === 'right' || !cmp.winner;

    return (
      <Look40CrtStage
        sceneIndex={sceneIndex}
        localFrame={localFrame}
        fps={fps}
        channelLabel="DUAL SYNC"
        noiseBoost={noiseBoost}
        rollOffsetY={rollOffsetY}
        hotGlow={noiseBoost * 0.4}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            padding: '44px 50px 46px 50px',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            boxSizing: 'border-box',
          }}
        >
          {/* Top Broadcast Title */}
          <div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 18,
                color: LOOK40.phosphorCoral,
                letterSpacing: '0.14em',
                marginBottom: 8,
              }}
            >
              SPLIT SIGNAL · A / B MONITOR
            </div>
            <FitText
              text={t.title || `${cmp.leftTitle} vs ${cmp.rightTitle}`}
              baseSize={40}
              minSize={26}
              maxLines={2}
              lineHeight={1.38}
              color={LOOK40.phosphorCore}
              fontWeight={800}
              align="left"
              style={{ textShadow: phosphorShadowN(1.2, 0.85) }}
            />
          </div>

          {/* Monitor Deck A (Top Split) */}
          <div
            style={{
              flex: 1,
              padding: '22px 26px',
              borderRadius: 14,
              backgroundColor: 'rgba(10, 14, 22, 0.78)',
              border: leftWin
                ? `2px solid ${LOOK40.phosphorCoral}`
                : '1.5px solid rgba(252, 251, 248, 0.22)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 12,
              transform: `translateY(${interpolate(deckAIn, [0, 1], [-24, 0]).toFixed(1)}px)`,
              opacity: clamp01(deckAIn * 1.4),
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    flexShrink: 0,
                    padding: '4px 10px',
                    borderRadius: 5,
                    backgroundColor: 'rgba(252, 251, 248, 0.14)',
                    fontFamily: FONT_MONO,
                    fontSize: 18,
                    fontWeight: 700,
                    color: LOOK40.sysText,
                  }}
                >
                  SIG-A
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={cmp.leftTitle || 'แบบเดิม'}
                    baseSize={30}
                    minSize={21}
                    maxLines={1}
                    lineHeight={1.38}
                    color={LOOK40.sysText}
                    fontWeight={800}
                    align="left"
                  />
                </div>
              </div>
              {leftWin ? (
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 16,
                    fontWeight: 700,
                    color: LOOK40.phosphorCoral,
                  }}
                >
                  ★ LOCKED
                </span>
              ) : null}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {leftItems.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 20,
                      color: LOOK40.sysMuted,
                      lineHeight: 1.4,
                      flexShrink: 0,
                    }}
                  >
                    —
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FitText
                      text={item}
                      baseSize={25}
                      minSize={18}
                      maxLines={2}
                      lineHeight={1.38}
                      color={LOOK40.sysText}
                      fontWeight={500}
                      align="left"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Glowing Horizontal Sync Split Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                flex: 1,
                height: 2,
                background: `linear-gradient(90deg, rgba(255,154,144,0.12), ${LOOK40.phosphorCoral})`,
              }}
            />
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 18,
                fontWeight: 800,
                color: LOOK40.phosphorCore,
                letterSpacing: '0.16em',
                padding: '4px 14px',
                borderRadius: 6,
                backgroundColor: 'rgba(240, 90, 74, 0.28)',
                border: `1px solid ${LOOK40.phosphorCoral}`,
                textShadow: phosphorShadowN(0.9, 0.8),
              }}
            >
              VS · SYNC
            </span>
            <div
              style={{
                flex: 1,
                height: 2,
                background: `linear-gradient(90deg, ${LOOK40.phosphorCoral}, rgba(255,154,144,0.12))`,
              }}
            />
          </div>

          {/* Monitor Deck B (Bottom Split — Warm Coral Highlighted) */}
          <div
            style={{
              flex: 1,
              padding: '22px 26px',
              borderRadius: 14,
              background:
                'radial-gradient(ellipse 90% 80% at 30% 30%, rgba(240, 90, 74, 0.16) 0%, rgba(12, 14, 22, 0.86) 80%)',
              border: rightWin
                ? `2px solid ${LOOK40.phosphorCoral}`
                : '1.5px solid rgba(255, 154, 144, 0.30)',
              boxShadow: rightWin ? '0 0 26px rgba(240, 90, 74, 0.22)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 12,
              transform: `translateY(${interpolate(deckBIn, [0, 1], [24, 0]).toFixed(1)}px)`,
              opacity: clamp01(deckBIn * 1.4),
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    flexShrink: 0,
                    padding: '4px 10px',
                    borderRadius: 5,
                    backgroundColor: LOOK40.phosphorRed,
                    fontFamily: FONT_MONO,
                    fontSize: 18,
                    fontWeight: 800,
                    color: LOOK40.phosphorCore,
                  }}
                >
                  SIG-B
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={cmp.rightTitle || 'ระบบใหม่'}
                    baseSize={30}
                    minSize={21}
                    maxLines={1}
                    lineHeight={1.38}
                    color={LOOK40.phosphorCore}
                    fontWeight={800}
                    align="left"
                    style={{ textShadow: phosphorShadowN(1.1, 0.85) }}
                  />
                </div>
              </div>
              {rightWin ? (
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 16,
                    fontWeight: 800,
                    color: LOOK40.phosphorCoral,
                    letterSpacing: '0.08em',
                  }}
                >
                  ★ SIGNAL LOCK
                </span>
              ) : null}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rightItems.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 20,
                      color: LOOK40.phosphorCoral,
                      fontWeight: 800,
                      lineHeight: 1.4,
                      flexShrink: 0,
                    }}
                  >
                    ▸
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FitText
                      text={item}
                      baseSize={25}
                      minSize={18}
                      maxLines={2}
                      lineHeight={1.38}
                      color={LOOK40.phosphorCore}
                      fontWeight={600}
                      align="left"
                      style={{ textShadow: '0 0 8px rgba(255, 154, 144, 0.32)' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Look40CrtStage>
    );
  }

  // Quote / Transmission Broadcast Fallback Mode
  const quoteText = isQuote
    ? String(scene.quote?.text || '').trim()
    : t.title || t.subtitle || 'SIGNAL TRANSMISSION';
  const quoteAuthor =
    scene.quote?.author || scene.quote?.source || scene.source || t.badge || 'BROADCAST ARCHIVE';
  const quoteRole = scene.quote?.role || (isQuote && t.title && t.title !== quoteText ? t.title : '');

  return (
    <Look40CrtStage
      sceneIndex={sceneIndex}
      localFrame={localFrame}
      fps={fps}
      channelLabel="TX QUOTE"
      noiseBoost={noiseBoost}
      rollOffsetY={rollOffsetY}
      hotGlow={noiseBoost * 0.45}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: '62px 62px 62px 62px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          boxSizing: 'border-box',
        }}
      >
        {/* Top Transmission Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid rgba(255, 154, 144, 0.26)',
            paddingBottom: 14,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 20,
              fontWeight: 700,
              color: LOOK40.phosphorCoral,
              letterSpacing: '0.14em',
            }}
          >
            ● VOICE TRANSMISSION
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 18,
              color: LOOK40.sysMuted,
              letterSpacing: '0.10em',
            }}
          >
            CH-TX · STEREO
          </span>
        </div>

        {/* Center Luminous Quote Block */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 24,
            transform: `translateY(${interpolate(deckAIn, [0, 1], [28, 0]).toFixed(1)}px)`,
            opacity: clamp01(deckAIn * 1.4),
          }}
        >
          {quoteRole ? (
            <div style={{ width: '100%' }}>
              <FitText
                text={quoteRole}
                baseSize={28}
                minSize={20}
                maxLines={2}
                lineHeight={1.38}
                color={LOOK40.phosphorCoral}
                fontWeight={600}
                align="center"
                style={{ textShadow: phosphorShadowN(0.9, 0.65) }}
              />
            </div>
          ) : null}

          {/* Giant Retro Quotation Glyph */}
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 78,
              lineHeight: 0.75,
              color: LOOK40.phosphorRed,
              textShadow: phosphorShadowN(1.5, 0.9),
            }}
          >
            “
          </div>

          <div
            style={{
              width: '100%',
              padding: '28px 30px',
              borderRadius: 16,
              backgroundColor: 'rgba(240, 90, 74, 0.08)',
              borderTop: `2px solid rgba(255, 154, 144, 0.42)`,
              borderBottom: `2px solid rgba(255, 154, 144, 0.42)`,
            }}
          >
            <FitText
              text={quoteText}
              baseSize={44}
              minSize={25}
              maxLines={5}
              lineHeight={1.45}
              color={LOOK40.phosphorCore}
              fontWeight={700}
              align="center"
              style={{ textShadow: phosphorShadowN(1.4, 0.95) }}
            />
          </div>

          {/* Credit Tag */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 6,
              opacity: clamp01(deckBIn * 1.3),
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: LOOK40.phosphorRed,
                boxShadow: `0 0 10px ${LOOK40.phosphorRed}`,
              }}
            />
            <FitText
              text={quoteAuthor}
              baseSize={26}
              minSize={19}
              maxLines={2}
              lineHeight={1.38}
              color={LOOK40.phosphorCoral}
              fontWeight={700}
              align="center"
            />
          </div>
        </div>

        {/* Bottom Analog Audio Level Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          {Array.from({ length: 28 }, (_, i) => {
            const distFromCenter = Math.abs(i - 13.5) / 14;
            const wave =
              0.28 +
              (1 - distFromCenter) *
                0.72 *
                (0.5 + 0.5 * Math.sin(localFrame * 0.22 + i * 0.55 + sceneIndex));
            const h = Math.round(8 + wave * 34);
            return (
              <div
                key={i}
                style={{
                  width: 14,
                  height: h,
                  borderRadius: 2,
                  backgroundColor: wave > 0.72 ? LOOK40.phosphorCore : LOOK40.phosphorCoral,
                  opacity: 0.4 + wave * 0.55,
                  boxShadow: wave > 0.7 ? `0 0 8px ${LOOK40.phosphorCoral}` : 'none',
                }}
              />
            );
          })}
        </div>
      </div>
    </Look40CrtStage>
  );
};

// ============================================================================
// LOOK-41: OSCILLOSCOPE — WAVEFORM GENERATORS & SHARED GRATICULE STAGE
// Deep green-black CRT (#030805) + 10x8 graticule grid + phosphor trace trails
// ============================================================================

function buildWavePathN(
  kind: 'sine' | 'square' | 'saw' | 'pulse' | 'modulated',
  x0: number,
  yCenter: number,
  width: number,
  amp: number,
  cycles: number,
  phase: number,
  samples = 120,
): string {
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const x = x0 + u * width;
    const theta = u * cycles * Math.PI * 2 + phase;
    let v = 0;
    if (kind === 'sine') {
      v = Math.sin(theta);
    } else if (kind === 'modulated') {
      const env = 0.75 + 0.25 * Math.sin(u * Math.PI * 2 + phase * 0.35);
      v = env * (Math.sin(theta) + 0.32 * Math.sin(theta * 2.5 + 0.8));
    } else if (kind === 'square') {
      // Smooth band-limited square wave (5 harmonics) for authentic analog scope look
      v =
        (4 / Math.PI) *
        (Math.sin(theta) +
          Math.sin(3 * theta) / 3 +
          Math.sin(5 * theta) / 5 +
          Math.sin(7 * theta) / 7);
      v *= 0.82;
    } else if (kind === 'saw') {
      const frac = ((u * cycles + phase / (Math.PI * 2)) % 1 + 1) % 1;
      v = frac * 2 - 1;
    } else {
      // Narrow high-energy pulse train with damped undershoot
      const frac = ((u * cycles + phase / (Math.PI * 2)) % 1 + 1) % 1;
      if (frac < 0.18) {
        v = Math.sin((frac / 0.18) * Math.PI);
      } else if (frac < 0.34) {
        v = -0.28 * Math.sin(((frac - 0.18) / 0.16) * Math.PI);
      } else {
        v = 0;
      }
    }
    const y = yCenter - v * amp;
    pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

function buildLissajousPathN(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  freqX: number,
  freqY: number,
  delta: number,
  samples = 180,
): string {
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const x = cx + Math.sin(freqX * t + delta) * rx;
    const y = cy + Math.sin(freqY * t) * ry;
    pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

const Look41PhosphorPath: React.FC<{
  d: string;
  trails?: string[];
  dashLength?: number;
  drawFraction?: number;
  strokeScale?: number;
}> = ({ d, trails = [], dashLength = 2600, drawFraction = 1, strokeScale = 1 }) => {
  const frac = clamp01(drawFraction);
  const dashProps =
    frac < 0.999
      ? {
          strokeDasharray: dashLength,
          strokeDashoffset: dashLength * (1 - frac),
        }
      : {};

  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Persistence trails from recent frames */}
      {trails.map((td, idx) => {
        const trailOp = (0.08 + idx * 0.065) * frac;
        return (
          <path
            key={idx}
            d={td}
            stroke={LOOK41.trace}
            strokeWidth={3.6 * strokeScale}
            opacity={trailOp}
            {...dashProps}
          />
        );
      })}
      {/* Outer wide green phosphor halo */}
      <path
        d={d}
        stroke={LOOK41.trace}
        strokeWidth={14 * strokeScale}
        opacity={0.13}
        {...dashProps}
      />
      {/* Mid phosphor bloom */}
      <path
        d={d}
        stroke={LOOK41.trace}
        strokeWidth={6.5 * strokeScale}
        opacity={0.38}
        {...dashProps}
      />
      {/* Inner crisp bright green trace */}
      <path
        d={d}
        stroke={LOOK41.trace}
        strokeWidth={3.0 * strokeScale}
        opacity={0.92}
        {...dashProps}
      />
      {/* White-mint electron beam core */}
      <path
        d={d}
        stroke={LOOK41.core}
        strokeWidth={1.5 * strokeScale}
        opacity={0.96}
        {...dashProps}
      />
    </g>
  );
};

const Look41ScopeStage: React.FC<{
  sceneIndex: number;
  localFrame: number;
  children: React.ReactNode;
}> = ({ sceneIndex, localFrame, children }) => {
  const maskId = `l41-grid-fade-${sceneIndex}`;
  // 10×8 Graticule Grid centered in the active stage (x: 54..1026, y: 156..1356 -> 972 × 1200)
  const gx0 = SAFE_X;
  const gy0 = 160;
  const gw = SAFE_W; // 972 -> 10 cols of 97.2
  const gh = 1160; // 8 rows of 145
  const cols = 10;
  const rows = 8;
  const colStep = gw / cols;
  const rowStep = gh / rows;
  const centerX = gx0 + gw / 2;
  const centerY = gy0 + gh / 2;

  // Deterministic subtle screen grain dots (prevents dark radial gradient banding)
  const grainDots = Array.from({ length: 42 }, (_, i) => {
    const seed = sceneIndex * 313 + i * 29;
    return {
      x: seededHashN(seed + 1) * STAGE_W,
      y: seededHashN(seed + 2) * CONTENT_BOTTOM,
      r: 0.9 + seededHashN(seed + 3) * 1.1,
      op: 0.03 + seededHashN(seed + 4) * 0.05,
    };
  });

  const subtleFlicker = 0.992 + 0.008 * Math.sin(localFrame * 1.4 + sceneIndex);

  return (
    <div
      style={{
        position: 'relative',
        width: STAGE_W,
        height: STAGE_H,
        overflow: 'hidden',
        backgroundColor: LOOK41.bg,
        fontFamily: FONT_THAI,
        opacity: subtleFlicker,
      }}
    >
      {/* Center CRT Phosphor Screen Luminance (fades naturally to edges — no box border) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: [
            `radial-gradient(ellipse 64% 44% at 50% 38%, rgba(16, 48, 28, 0.72) 0%, ${LOOK41.tubeGlow} 44%, ${LOOK41.bg} 82%)`,
            'radial-gradient(circle at 50% 42%, rgba(70, 255, 140, 0.045) 0%, rgba(3, 8, 5, 0) 60%)',
          ].join(', '),
          pointerEvents: 'none',
        }}
      />

      {/* 10×8 Graticule Grid with Sub-Ticks on Center Axes, Fading Smoothly at Edges */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <defs>
          <radialGradient id={maskId} cx="50%" cy="40%" r="54%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="68%" stopColor="#FFFFFF" stopOpacity="0.82" />
            <stop offset="94%" stopColor="#FFFFFF" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <mask id={`${maskId}-m`}>
            <rect width={STAGE_W} height={STAGE_H} fill={`url(#${maskId})`} />
          </mask>
        </defs>

        <g mask={`url(#${maskId}-m)`}>
          {/* 10 vertical grid divisions */}
          {Array.from({ length: cols + 1 }, (_, c) => {
            const x = gx0 + c * colStep;
            const isCenter = c === cols / 2;
            return (
              <line
                key={`v-${c}`}
                x1={x}
                y1={gy0}
                x2={x}
                y2={gy0 + gh}
                stroke={isCenter ? LOOK41.gridAxis : LOOK41.gridLine}
                strokeWidth={isCenter ? 1.8 : 1}
              />
            );
          })}

          {/* 8 horizontal grid divisions */}
          {Array.from({ length: rows + 1 }, (_, r) => {
            const y = gy0 + r * rowStep;
            const isCenter = r === rows / 2;
            return (
              <line
                key={`h-${r}`}
                x1={gx0}
                y1={y}
                x2={gx0 + gw}
                y2={y}
                stroke={isCenter ? LOOK41.gridAxis : LOOK41.gridLine}
                strokeWidth={isCenter ? 1.8 : 1}
              />
            );
          })}

          {/* Minor subdivision tick marks along horizontal center axis (5 per division) */}
          {Array.from({ length: cols * 5 + 1 }, (_, i) => {
            if (i % 5 === 0) return null;
            const x = gx0 + (i / 5) * colStep;
            return (
              <line
                key={`xt-${i}`}
                x1={x}
                y1={centerY - 7}
                x2={x}
                y2={centerY + 7}
                stroke={LOOK41.gridAxis}
                strokeWidth={1.3}
              />
            );
          })}

          {/* Minor subdivision tick marks along vertical center axis (5 per division) */}
          {Array.from({ length: rows * 5 + 1 }, (_, i) => {
            if (i % 5 === 0) return null;
            const y = gy0 + (i / 5) * rowStep;
            return (
              <line
                key={`yt-${i}`}
                x1={centerX - 7}
                y1={y}
                x2={centerX + 7}
                y2={y}
                stroke={LOOK41.gridAxis}
                strokeWidth={1.3}
              />
            );
          })}

          {/* Subtle phosphor grain */}
          {grainDots.map((d, idx) => (
            <circle key={idx} cx={d.x} cy={d.y} r={d.r} fill={LOOK41.trace} opacity={d.op} />
          ))}
        </g>
      </svg>

      {/* Ultra-fine CRT phosphor scanlines */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 3px, rgba(0,0,0,0.16) 3px, rgba(0,0,0,0.16) 5px)',
          pointerEvents: 'none',
        }}
      />

      {/* Safe Content Area: x ∈ [54, 1026], y ∈ [112, 1420] */}
      {children}
    </div>
  );
};

// ============================================================================
// LOOK-41 SHOT 1: scope-trace-title
// Signal trace draws across screen via stroke-dashoffset -> title rises above
// the graticule baseline + single crisp instrument readout underneath
// ============================================================================

const Look41ScopeTraceTitle: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);
  const headline = t.title || t.subtitle || 'OSCILLOSCOPE TRACE';
  const subText = t.subtitle && t.subtitle !== headline ? t.subtitle : highlightTextOfN(scene);
  const readoutText = t.badge
    ? `${t.badge} · 2.0ms/DIV · TRIG LOCK`
    : 'CH1 1.0V/DIV · TIME 2.0ms/DIV · TRIG AUTO';

  // Continuous trace draws left-to-right during frames 0..22
  const drawProg = easeOutCubic(clamp01(localFrame / 22));

  // Waveform amplitude starts energetic, then settles into a steady triggered carrier wave
  const settleAmp = interpolate(clamp01((localFrame - 14) / 24), [0, 1], [156, 84]);
  const phase = localFrame * 0.16 + sceneIndex * 1.1;
  const baselineY = 820;

  const mainPath = buildWavePathN('modulated', 0, baselineY, STAGE_W, settleAmp, 3.2, phase, 140);
  const trails = [3, 2, 1].map((lag) => {
    const f = Math.max(0, localFrame - lag * 1.5);
    const a = interpolate(clamp01((f - 14) / 24), [0, 1], [156, 84]);
    return buildWavePathN('modulated', 0, baselineY, STAGE_W, a, 3.2, f * 0.16 + sceneIndex * 1.1, 120);
  });

  // Glowing beam tip position during draw-in
  const tipX = drawProg * STAGE_W;
  const tipTheta = drawProg * 3.2 * Math.PI * 2 + phase;
  const tipEnv = 0.75 + 0.25 * Math.sin(drawProg * Math.PI * 2 + phase * 0.35);
  const tipY = baselineY - tipEnv * (Math.sin(tipTheta) + 0.32 * Math.sin(tipTheta * 2.5 + 0.8)) * settleAmp;

  // Title springs up cleanly from the graticule baseline
  const titleSpring = spring({
    frame: Math.max(0, localFrame - 10),
    fps: safeFps,
    config: { damping: 14, stiffness: 135, mass: 0.82 },
  });
  const subAppear = appear(localFrame, 20, 14);
  const readoutAppear = appear(localFrame, 24, 14);

  return (
    <Look41ScopeStage sceneIndex={sceneIndex} localFrame={localFrame}>
      {/* Full-bleed continuous oscilloscope trace running edge-to-edge */}
      <svg
        width={STAGE_W}
        height={CONTENT_BOTTOM}
        viewBox={`0 0 ${STAGE_W} ${CONTENT_BOTTOM}`}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      >
        <Look41PhosphorPath
          d={mainPath}
          trails={trails}
          dashLength={2200}
          drawFraction={drawProg}
          strokeScale={1.08}
        />
        {/* Bright electron beam spot at the leading edge during draw */}
        {drawProg > 0.02 && drawProg < 0.995 && (
          <g>
            <circle cx={tipX} cy={tipY} r={16} fill={LOOK41.trace} opacity={0.28} />
            <circle cx={tipX} cy={tipY} r={6} fill={LOOK41.core} opacity={0.96} />
          </g>
        )}
      </svg>

      {/* Safe Content Overlay x ∈ [54, 1026], y ∈ [112, 1420] */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: SAFE_TOP,
          width: SAFE_W,
          height: CONTENT_BOTTOM - SAFE_TOP,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          paddingTop: 28,
          paddingBottom: 34,
          boxSizing: 'border-box',
        }}
      >
        {/* Top Trigger Status Strip */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingLeft: 12,
            paddingRight: 12,
            opacity: appear(localFrame, 2, 12),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: LOOK41.trace,
                boxShadow: `0 0 10px ${LOOK41.trace}`,
              }}
            />
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 20,
                fontWeight: 700,
                color: LOOK41.trace,
                letterSpacing: '0.14em',
              }}
            >
              TRIG&#39;D · CH1
            </span>
          </div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 19,
              color: LOOK41.mutedText,
              letterSpacing: '0.10em',
            }}
          >
            f = {(440 + sceneIndex * 60).toFixed(0)} Hz
          </span>
        </div>

        {/* Hero Title rising above the center trace */}
        <div
          style={{
            marginTop: 56,
            marginBottom: 'auto',
            padding: '0 22px',
            transform: `translateY(${interpolate(titleSpring, [0, 1], [62, 0]).toFixed(1)}px)`,
            opacity: clamp01(titleSpring * 1.4),
          }}
        >
          <FitText
            text={headline}
            baseSize={68}
            minSize={36}
            maxLines={3}
            lineHeight={1.38}
            color={LOOK41.core}
            fontWeight={800}
            align="center"
            style={{
              letterSpacing: '0.01em',
              textShadow: scopeTextShadowN(1.1),
            }}
          />
        </div>

        {/* Lower Subtitle + Single Crisp Mono Instrument Readout (well above y=1420) */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 24,
            padding: '0 24px',
          }}
        >
          {subText ? (
            <div
              style={{
                width: '100%',
                opacity: subAppear,
                transform: `translateY(${((1 - subAppear) * 20).toFixed(1)}px)`,
              }}
            >
              <FitText
                text={subText}
                baseSize={31}
                minSize={21}
                maxLines={3}
                lineHeight={1.42}
                color={LOOK41.softText}
                fontWeight={500}
                align="center"
                style={{ textShadow: scopeTextShadowN(0.6) }}
              />
            </div>
          ) : null}

          <div
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              backgroundColor: 'rgba(6, 18, 11, 0.72)',
              border: `1px solid ${LOOK41.panelBorder}`,
              opacity: readoutAppear,
            }}
          >
            <FitText
              text={readoutText}
              baseSize={21}
              minSize={16}
              maxLines={1}
              lineHeight={1.38}
              color={LOOK41.mutedText}
              fontWeight={600}
              fontFamily={`${FONT_MONO}, ${FONT_THAI}`}
              align="center"
              style={{ letterSpacing: '0.08em' }}
            />
          </div>
        </div>
      </div>
    </Look41ScopeStage>
  );
};

// ============================================================================
// LOOK-41 SHOT 2: scope-multi-channel
// CH1-CH4 multi-trace oscilloscope: each bullet has a distinct waveform
// (sine / square / saw / pulse) + phosphor trail + crisp Thai channel label
// ============================================================================

const CHANNEL_WAVE_TYPES: Array<{
  kind: 'sine' | 'square' | 'saw' | 'pulse';
  tag: string;
  freq: string;
}> = [
  { kind: 'sine', tag: 'CH1 · SINE', freq: '1.0 kHz' },
  { kind: 'square', tag: 'CH2 · SQR', freq: '2.4 kHz' },
  { kind: 'saw', tag: 'CH3 · SAW', freq: '850 Hz' },
  { kind: 'pulse', tag: 'CH4 · PULSE', freq: '500 Hz' },
];

const Look41ScopeMultiChannel: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
}) => {
  const t = sceneTexts(scene);
  const points = extractPointsN(scene, 4);
  const headerIn = appear(localFrame, 0, 12);
  const waveW = 310;
  const waveH = 104;

  return (
    <Look41ScopeStage sceneIndex={sceneIndex} localFrame={localFrame}>
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: SAFE_TOP,
          width: SAFE_W,
          height: CONTENT_BOTTOM - SAFE_TOP,
          display: 'flex',
          flexDirection: 'column',
          padding: '14px 10px 20px 10px',
          boxSizing: 'border-box',
        }}
      >
        {/* Top Scope Channel Bar + Title */}
        <div
          style={{
            marginBottom: 26,
            opacity: headerIn,
            transform: `translateY(${((1 - headerIn) * 16).toFixed(1)}px)`,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              fontFamily: FONT_MONO,
              fontSize: 19,
              color: LOOK41.trace,
              letterSpacing: '0.12em',
            }}
          >
            <span>MULTI-TRACE · {points.length} CH ACTIVE</span>
            <span style={{ color: LOOK41.mutedText }}>DC · 50Ω</span>
          </div>
          <FitText
            text={t.title || t.badge || 'วิเคราะห์สัญญาณหลายช่อง'}
            baseSize={46}
            minSize={28}
            maxLines={2}
            lineHeight={1.38}
            color={LOOK41.core}
            fontWeight={800}
            align="left"
            style={{ textShadow: scopeTextShadowN(0.95) }}
          />
        </div>

        {/* Channel Lanes (CH1..CH4) */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 20,
          }}
        >
          {points.map((item, idx) => {
            const spec = CHANNEL_WAVE_TYPES[idx % CHANNEL_WAVE_TYPES.length];
            const laneIn = stagger(idx, localFrame, 6, 6, 14);
            const drawFrac = clamp01(stagger(idx, localFrame, 5, 4, 18));
            const speed = 0.14 + idx * 0.035;
            const phase = localFrame * speed + idx * 1.4 + sceneIndex * 0.7;
            const cycles = idx === 3 ? 2.6 : 2.8 + idx * 0.4;

            const wavePath = buildWavePathN(spec.kind, 8, waveH / 2, waveW - 16, 30, cycles, phase, 96);
            const trailPaths = [2, 1].map((lag) =>
              buildWavePathN(
                spec.kind,
                8,
                waveH / 2,
                waveW - 16,
                30,
                cycles,
                Math.max(0, localFrame - lag * 1.6) * speed + idx * 1.4 + sceneIndex * 0.7,
                84,
              ),
            );

            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 22,
                  padding: '20px 22px',
                  borderRadius: 14,
                  backgroundColor: LOOK41.panelBg,
                  border: `1.5px solid ${LOOK41.panelBorder}`,
                  boxShadow: 'inset 0 0 24px rgba(70, 255, 140, 0.06)',
                  opacity: laneIn,
                  transform: `translateY(${((1 - laneIn) * 20).toFixed(1)}px)`,
                }}
              >
                {/* Left Mini Oscilloscope Trace Viewport */}
                <div
                  style={{
                    width: waveW,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontFamily: FONT_MONO,
                      fontSize: 16,
                      fontWeight: 700,
                      color: LOOK41.trace,
                      letterSpacing: '0.08em',
                    }}
                  >
                    <span>{spec.tag}</span>
                    <span style={{ color: LOOK41.mutedText }}>{spec.freq}</span>
                  </div>
                  <div
                    style={{
                      width: waveW,
                      height: waveH,
                      borderRadius: 8,
                      backgroundColor: 'rgba(3, 8, 5, 0.88)',
                      border: '1px solid rgba(70, 255, 140, 0.22)',
                      position: 'relative',
                    }}
                  >
                    <svg width={waveW} height={waveH} viewBox={`0 0 ${waveW} ${waveH}`}>
                      {/* Mini center reference line */}
                      <line
                        x1={0}
                        y1={waveH / 2}
                        x2={waveW}
                        y2={waveH / 2}
                        stroke="rgba(70, 255, 140, 0.22)"
                        strokeWidth={1}
                        strokeDasharray="4 4"
                      />
                      <Look41PhosphorPath
                        d={wavePath}
                        trails={trailPaths}
                        dashLength={900}
                        drawFraction={drawFrac}
                        strokeScale={0.78}
                      />
                    </svg>
                  </div>
                </div>

                {/* Right Real Thai Bullet Label */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item}
                    baseSize={27}
                    minSize={19}
                    maxLines={3}
                    lineHeight={1.4}
                    color={LOOK41.core}
                    fontWeight={600}
                    align="left"
                    style={{ textShadow: scopeTextShadowN(0.55) }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Telemetry Strip */}
        <div
          style={{
            marginTop: 18,
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: FONT_MONO,
            fontSize: 18,
            color: LOOK41.mutedText,
            letterSpacing: '0.10em',
            paddingLeft: 8,
            paddingRight: 8,
          }}
        >
          <span>TIMEBASE: 1.0ms/DIV</span>
          <span style={{ color: LOOK41.trace }}>ALL CHANNELS LOCKED</span>
        </div>
      </div>
    </Look41ScopeStage>
  );
};

// ============================================================================
// LOOK-41 SHOT 3: scope-measure-stat
// Precision measurement mode with dual dashed cursors (X1/X2, Y1/Y2), live
// calibrated trace, big phosphor stat readout, and instrument summary
// ============================================================================

const Look41ScopeMeasureStat: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetricN(scene);
  const safeFps = Math.max(1, fps || 30);

  const cursorLock = spring({
    frame: Math.max(0, localFrame - 6),
    fps: safeFps,
    config: { damping: 14, stiffness: 135, mass: 0.85 },
  });
  const statPop = spring({
    frame: Math.max(0, localFrame - 8),
    fps: safeFps,
    config: { damping: 13, stiffness: 150, mass: 0.82 },
  });

  // Calibrated waveform across middle band of the scope
  const traceY = 820;
  const waveAmp = 76 + metric.progress * 74;
  const phase = localFrame * 0.13 + sceneIndex * 0.9;
  const wavePath = buildWavePathN('sine', 0, traceY, STAGE_W, waveAmp, 2.5, phase, 140);
  const trailPaths = [2, 1].map((lag) =>
    buildWavePathN('sine', 0, traceY, STAGE_W, waveAmp, 2.5, Math.max(0, localFrame - lag * 1.5) * 0.13 + sceneIndex * 0.9, 120),
  );

  // Dual vertical measurement cursors sliding into lock around a full cycle
  const x1 = interpolate(cursorLock, [0, 1], [120, 278]);
  const x2 = interpolate(cursorLock, [0, 1], [960, 802]);
  // Dual horizontal peak-to-peak measurement cursors
  const yTop = interpolate(cursorLock, [0, 1], [traceY - 220, traceY - waveAmp]);
  const yBot = interpolate(cursorLock, [0, 1], [traceY + 220, traceY + waveAmp]);

  return (
    <Look41ScopeStage sceneIndex={sceneIndex} localFrame={localFrame}>
      {/* Live Waveform + Dual Measurement Cursors SVG */}
      <svg
        width={STAGE_W}
        height={CONTENT_BOTTOM}
        viewBox={`0 0 ${STAGE_W} ${CONTENT_BOTTOM}`}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      >
        {/* Shaded measurement window between X1 and X2 */}
        <rect
          x={x1}
          y={yTop}
          width={Math.max(0, x2 - x1)}
          height={Math.max(0, yBot - yTop)}
          fill="rgba(70, 255, 140, 0.06)"
        />

        {/* Triggered signal trace */}
        <Look41PhosphorPath
          d={wavePath}
          trails={trailPaths}
          dashLength={2200}
          drawFraction={appear(localFrame, 0, 18)}
          strokeScale={1.0}
        />

        {/* Dual Vertical Dashed Measurement Cursors (X1, X2) */}
        <line
          x1={x1}
          y1={620}
          x2={x1}
          y2={1040}
          stroke={LOOK41.core}
          strokeWidth={2}
          strokeDasharray="10 8"
          opacity={0.78}
        />
        <line
          x1={x2}
          y1={620}
          x2={x2}
          y2={1040}
          stroke={LOOK41.core}
          strokeWidth={2}
          strokeDasharray="10 8"
          opacity={0.78}
        />

        {/* Dual Horizontal Dashed Amplitude Cursors (Y1, Y2) */}
        <line
          x1={SAFE_X + 20}
          y1={yTop}
          x2={STAGE_W - SAFE_X - 20}
          y2={yTop}
          stroke={LOOK41.trace}
          strokeWidth={1.8}
          strokeDasharray="8 8"
          opacity={0.68}
        />
        <line
          x1={SAFE_X + 20}
          y1={yBot}
          x2={STAGE_W - SAFE_X - 20}
          y2={yBot}
          stroke={LOOK41.trace}
          strokeWidth={1.8}
          strokeDasharray="8 8"
          opacity={0.68}
        />

        {/* Cursor Crosshair Lock Nodes */}
        {[
          [x1, yTop],
          [x2, yTop],
          [x1, yBot],
          [x2, yBot],
        ].map(([cx, cy], idx) => (
          <g key={idx}>
            <circle cx={cx} cy={cy} r={6} fill={LOOK41.core} opacity={0.9} />
            <circle cx={cx} cy={cy} r={12} fill="none" stroke={LOOK41.trace} strokeWidth={1.5} opacity={0.55} />
          </g>
        ))}

        {/* Inline Cursor Tags */}
        <text x={x1 + 10} y={644} fill={LOOK41.trace} fontFamily={FONT_MONO} fontSize={18} fontWeight={700}>
          CUR X1
        </text>
        <text x={x2 - 78} y={644} fill={LOOK41.trace} fontFamily={FONT_MONO} fontSize={18} fontWeight={700}>
          CUR X2
        </text>
        <text x={SAFE_X + 26} y={yTop - 10} fill={LOOK41.core} fontFamily={FONT_MONO} fontSize={17}>
          Y1 MAX
        </text>
        <text x={SAFE_X + 26} y={yBot + 24} fill={LOOK41.core} fontFamily={FONT_MONO} fontSize={17}>
          Y2 MIN
        </text>
      </svg>

      {/* Safe Content Overlay */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: SAFE_TOP,
          width: SAFE_W,
          height: CONTENT_BOTTOM - SAFE_TOP,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '16px 12px 20px 12px',
          boxSizing: 'border-box',
        }}
      >
        {/* Top Measurement Mode Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: FONT_MONO,
            fontSize: 19,
            color: LOOK41.trace,
            letterSpacing: '0.12em',
          }}
        >
          <span>MEASURE · CURSOR LOCK</span>
          <span style={{ color: LOOK41.mutedText }}>
            ΔX = 4.20ms · PK-PK {(metric.progress * 5).toFixed(2)}V
          </span>
        </div>

        {/* Upper Center Hero Stat Readout */}
        <div
          style={{
            marginTop: 18,
            marginBottom: 'auto',
            padding: '28px 26px',
            borderRadius: 16,
            backgroundColor: 'rgba(4, 14, 8, 0.72)',
            border: `1.5px solid ${LOOK41.panelBorder}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            transform: `scale(${interpolate(statPop, [0, 1], [0.88, 1]).toFixed(4)})`,
            opacity: clamp01(statPop * 1.4),
          }}
        >
          {metric.unit ? (
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 22,
                fontWeight: 700,
                color: LOOK41.trace,
                letterSpacing: '0.20em',
                marginBottom: 4,
              }}
            >
              {metric.unit}
            </div>
          ) : null}

          <div style={{ width: '100%' }}>
            <FitText
              text={metric.big}
              baseSize={126}
              minSize={58}
              maxLines={2}
              lineHeight={1.35}
              color={LOOK41.core}
              fontWeight={900}
              align="center"
              style={{ textShadow: scopeTextShadowN(1.25) }}
            />
          </div>

          {metric.delta ? (
            <div
              style={{
                marginTop: 12,
                padding: '6px 20px',
                borderRadius: 999,
                backgroundColor: 'rgba(70, 255, 140, 0.14)',
                border: `1px solid ${LOOK41.trace}`,
              }}
            >
              <FitText
                text={metric.delta}
                baseSize={24}
                minSize={18}
                maxLines={1}
                lineHeight={1.38}
                color={LOOK41.trace}
                fontWeight={700}
                align="center"
              />
            </div>
          ) : null}
        </div>

        {/* Lower Readout Deck (safely above y=1420) */}
        <div
          style={{
            padding: '22px 26px',
            borderRadius: 14,
            backgroundColor: LOOK41.panelBg,
            borderTop: `2px solid ${LOOK41.trace}`,
            borderLeft: `1px solid ${LOOK41.panelBorder}`,
            borderRight: `1px solid ${LOOK41.panelBorder}`,
            borderBottom: `1px solid ${LOOK41.panelBorder}`,
            opacity: appear(localFrame, 12, 14),
          }}
        >
          <FitText
            text={t.title || metric.label}
            baseSize={34}
            minSize={22}
            maxLines={2}
            lineHeight={1.38}
            color={LOOK41.core}
            fontWeight={800}
            align="left"
            style={{ textShadow: scopeTextShadowN(0.75) }}
          />
          {metric.label && metric.label !== t.title ? (
            <div style={{ marginTop: 8 }}>
              <FitText
                text={metric.label}
                baseSize={25}
                minSize={18}
                maxLines={2}
                lineHeight={1.4}
                color={LOOK41.softText}
                fontWeight={500}
                align="left"
              />
            </div>
          ) : null}
        </div>
      </div>
    </Look41ScopeStage>
  );
};

// ============================================================================
// LOOK-41 SHOT 4: scope-xy-compare
// XY Lissajous Mode: rotating 2:3 harmonic figure with phosphor persistence
// trails for compare (CH-X vs CH-Y) or resonant quote readout
// ============================================================================

const Look41ScopeXyCompare: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);
  const isCompare = Boolean(scene.compare);
  const isQuote = !isCompare && Boolean(scene.quote?.text);

  // Lissajous phase rotates smoothly and deterministically with localFrame
  const delta = localFrame * 0.045 + sceneIndex * 0.8 + Math.PI / 4;
  const drawFrac = easeOutCubic(clamp01(localFrame / 22));
  const lissCx = STAGE_W / 2;
  const lissCy = isCompare ? 470 : 500;
  const lissRx = isCompare ? 230 : 250;
  const lissRy = isCompare ? 168 : 196;
  const freqX = 2;
  const freqY = 3;

  const mainLiss = buildLissajousPathN(lissCx, lissCy, lissRx, lissRy, freqX, freqY, delta, 180);
  const trailLiss = [4, 3, 2, 1].map((lag) =>
    buildLissajousPathN(
      lissCx,
      lissCy,
      lissRx,
      lissRy,
      freqX,
      freqY,
      Math.max(0, localFrame - lag * 1.4) * 0.045 + sceneIndex * 0.8 + Math.PI / 4,
      140,
    ),
  );

  // Moving electron beam head along the Lissajous curve
  const headT = (localFrame * 0.14) % (Math.PI * 2);
  const headX = lissCx + Math.sin(freqX * headT + delta) * lissRx;
  const headY = lissCy + Math.sin(freqY * headT) * lissRy;

  const cardSpring = spring({
    frame: Math.max(0, localFrame - 10),
    fps: safeFps,
    config: { damping: 15, stiffness: 140, mass: 0.85 },
  });

  return (
    <Look41ScopeStage sceneIndex={sceneIndex} localFrame={localFrame}>
      {/* XY Lissajous Plot SVG */}
      <svg
        width={STAGE_W}
        height={CONTENT_BOTTOM}
        viewBox={`0 0 ${STAGE_W} ${CONTENT_BOTTOM}`}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      >
        {/* Subtle XY crosshair ring behind Lissajous */}
        <circle
          cx={lissCx}
          cy={lissCy}
          r={Math.max(lissRx, lissRy) + 22}
          fill="none"
          stroke="rgba(70, 255, 140, 0.16)"
          strokeWidth={1.2}
          strokeDasharray="6 8"
        />
        <line
          x1={lissCx - lissRx - 42}
          y1={lissCy}
          x2={lissCx + lissRx + 42}
          y2={lissCy}
          stroke="rgba(70, 255, 140, 0.24)"
          strokeWidth={1.2}
        />
        <line
          x1={lissCx}
          y1={lissCy - lissRy - 34}
          x2={lissCx}
          y2={lissCy + lissRy + 34}
          stroke="rgba(70, 255, 140, 0.24)"
          strokeWidth={1.2}
        />

        {/* Phosphor Lissajous Curve + Persistence Trails */}
        <Look41PhosphorPath
          d={mainLiss}
          trails={trailLiss}
          dashLength={2800}
          drawFraction={drawFrac}
          strokeScale={1.05}
        />

        {/* Moving Electron Beam Spot */}
        <circle cx={headX} cy={headY} r={14} fill={LOOK41.trace} opacity={0.28} />
        <circle cx={headX} cy={headY} r={5.5} fill={LOOK41.core} opacity={0.98} />

        {/* Axis labels */}
        <text
          x={lissCx + lissRx + 14}
          y={lissCy - 10}
          fill={LOOK41.trace}
          fontFamily={FONT_MONO}
          fontSize={17}
          fontWeight={700}
        >
          X-IN
        </text>
        <text
          x={lissCx + 12}
          y={lissCy - lissRy - 14}
          fill={LOOK41.trace}
          fontFamily={FONT_MONO}
          fontSize={17}
          fontWeight={700}
        >
          Y-IN
        </text>
      </svg>

      {/* Safe Content Overlay x ∈ [54, 1026], y ∈ [112, 1420] */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: SAFE_TOP,
          width: SAFE_W,
          height: CONTENT_BOTTOM - SAFE_TOP,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '12px 10px 18px 10px',
          boxSizing: 'border-box',
        }}
      >
        {/* Top XY Mode Header + Scene Title */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontFamily: FONT_MONO,
              fontSize: 19,
              color: LOOK41.trace,
              letterSpacing: '0.12em',
              marginBottom: 10,
            }}
          >
            <span>XY MODE · LISSAJOUS 2:3</span>
            <span style={{ color: LOOK41.mutedText }}>
              Δφ = {(((delta % (Math.PI * 2)) * 180) / Math.PI).toFixed(0)}°
            </span>
          </div>
          <FitText
            text={t.title || (isCompare ? 'เปรียบเทียบสัญญาณ X / Y' : 'สัญญาณพ้องความถี่')}
            baseSize={42}
            minSize={26}
            maxLines={2}
            lineHeight={1.38}
            color={LOOK41.core}
            fontWeight={800}
            align="center"
            style={{ textShadow: scopeTextShadowN(0.95) }}
          />
        </div>

        {/* Bottom Area: Dual X/Y Comparison Cards OR Resonant Quote Card */}
        {isCompare && scene.compare ? (
          <div
            style={{
              display: 'flex',
              gap: 20,
              alignItems: 'stretch',
              transform: `translateY(${interpolate(cardSpring, [0, 1], [34, 0]).toFixed(1)}px)`,
              opacity: clamp01(cardSpring * 1.4),
            }}
          >
            {[
              {
                axis: 'CH-X',
                title: scene.compare.leftTitle || 'ฝั่ง A',
                items: (scene.compare.leftItems || []).slice(0, 3),
                isWinner: scene.compare.winner === 'left',
              },
              {
                axis: 'CH-Y',
                title: scene.compare.rightTitle || 'ฝั่ง B',
                items: (scene.compare.rightItems || []).slice(0, 3),
                isWinner: scene.compare.winner === 'right' || !scene.compare.winner,
              },
            ].map((side, sIdx) => (
              <div
                key={sIdx}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '22px 22px',
                  borderRadius: 14,
                  backgroundColor: side.isWinner ? 'rgba(9, 30, 17, 0.84)' : LOOK41.panelBg,
                  border: side.isWinner
                    ? `2px solid ${LOOK41.trace}`
                    : `1.5px solid ${LOOK41.panelBorder}`,
                  boxShadow: side.isWinner ? '0 0 24px rgba(70, 255, 140, 0.16)' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 18,
                      fontWeight: 800,
                      color: side.isWinner ? LOOK41.bg : LOOK41.trace,
                      backgroundColor: side.isWinner ? LOOK41.trace : 'rgba(70, 255, 140, 0.14)',
                      padding: '4px 10px',
                      borderRadius: 5,
                      letterSpacing: '0.08em',
                    }}
                  >
                    {side.axis}
                  </span>
                  {side.isWinner ? (
                    <span
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 15,
                        fontWeight: 700,
                        color: LOOK41.trace,
                      }}
                    >
                      ★ IN PHASE
                    </span>
                  ) : null}
                </div>

                <FitText
                  text={side.title}
                  baseSize={28}
                  minSize={20}
                  maxLines={2}
                  lineHeight={1.38}
                  color={LOOK41.core}
                  fontWeight={800}
                  align="left"
                  style={{ textShadow: side.isWinner ? scopeTextShadowN(0.8) : 'none' }}
                />

                <div
                  style={{
                    height: 1,
                    backgroundColor: side.isWinner
                      ? 'rgba(70, 255, 140, 0.42)'
                      : 'rgba(70, 255, 140, 0.18)',
                  }}
                />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {side.items.map((item, iIdx) => (
                    <div key={iIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 18,
                          color: side.isWinner ? LOOK41.trace : LOOK41.mutedText,
                          lineHeight: 1.4,
                          flexShrink: 0,
                        }}
                      >
                        {side.isWinner ? '▸' : '·'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FitText
                          text={item}
                          baseSize={23}
                          minSize={17}
                          maxLines={3}
                          lineHeight={1.4}
                          color={side.isWinner ? LOOK41.core : LOOK41.softText}
                          fontWeight={side.isWinner ? 600 : 500}
                          align="left"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Resonant Quote / Statement Readout */
          <div
            style={{
              padding: '28px 30px',
              borderRadius: 16,
              backgroundColor: LOOK41.panelBg,
              border: `1.5px solid ${LOOK41.panelBorder}`,
              borderTop: `2.5px solid ${LOOK41.trace}`,
              boxShadow: '0 0 28px rgba(70, 255, 140, 0.10)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 18,
              transform: `translateY(${interpolate(cardSpring, [0, 1], [32, 0]).toFixed(1)}px)`,
              opacity: clamp01(cardSpring * 1.4),
            }}
          >
            <FitText
              text={
                isQuote
                  ? String(scene.quote?.text || '').trim()
                  : t.subtitle || t.title || 'ทุกสัญญาณลงตัวในจังหวะเดียว'
              }
              baseSize={38}
              minSize={23}
              maxLines={5}
              lineHeight={1.45}
              color={LOOK41.core}
              fontWeight={700}
              align="center"
              style={{ textShadow: scopeTextShadowN(0.85) }}
            />

            <div
              style={{
                width: 140,
                height: 2,
                background: `linear-gradient(90deg, rgba(70,255,140,0), ${LOOK41.trace}, rgba(70,255,140,0))`,
              }}
            />

            <FitText
              text={
                scene.quote?.author ||
                scene.quote?.source ||
                scene.source ||
                t.badge ||
                'HARMONIC LOCK 2:3'
              }
              baseSize={23}
              minSize={17}
              maxLines={2}
              lineHeight={1.38}
              color={LOOK41.trace}
              fontWeight={600}
              fontFamily={`${FONT_MONO}, ${FONT_THAI}`}
              align="center"
            />
          </div>
        )}
      </div>
    </Look41ScopeStage>
  );
};

// ============================================================================
// EXPORTED REGISTRY DEFINITIONS — BATCH_N (look-40, look-41)
// ============================================================================

export const BATCH_N: StyleDirectorDef[] = [
  {
    styleId: 'look-40',
    caption: 'bar',
    shots: {
      'crt-power-on': Look40CrtPowerOn,
      'crt-channel-list': Look40CrtChannelList,
      'crt-stat-broadcast': Look40CrtStatBroadcast,
      'crt-split-signal': Look40CrtSplitSignal,
    },
    shotLabels: {
      'crt-power-on':
        'จอทีวีหลอดเรโทรเปิดจากเส้นแนวนอนสว่างแล้วคลี่เต็มจอ พร้อมหัวข้อฟอสฟอร์เรืองแสงและบรรทัดสถานะระบบพิมพ์ทีละตัว',
      'crt-channel-list':
        'รายการประเด็นสำคัญในรูปแบบเมนูช่องทีวีและเทเลเท็กซ์ พร้อมเคอร์เซอร์บล็อกฟอสฟอร์เลื่อนสแกนลงตามแถว',
      'crt-stat-broadcast':
        'หน้าจอประกาศตัวเลขสถิติขนาดใหญ่สไตล์สกอร์บอร์ดออกอากาศ พร้อมแถบวัดสัญญาณและแถบข่าวล่าง (Lower-Third)',
      'crt-split-signal':
        'จอทีวีแบ่งสัญญาณสองฝั่งสำหรับเปรียบเทียบหรือหน้าต่างคำคมออกอากาศ พร้อมจังหวะสัญญาณซ่าและภาพกลิ้งช่วงสลับช่อง',
    },
    infer: (scene) => {
      if (scene.stat) {
        return 'crt-stat-broadcast';
      }
      if (scene.compare || scene.quote?.text) {
        return 'crt-split-signal';
      }
      const t = sceneTexts(scene);
      if (t.bullets.length >= 3) {
        return 'crt-channel-list';
      }
      // Keep haystackOfN available for consistent batch classification semantics
      void haystackOfN(scene);
      return null;
    },
  },
  {
    styleId: 'look-41',
    caption: 'floating',
    shots: {
      'scope-trace-title': Look41ScopeTraceTitle,
      'scope-multi-channel': Look41ScopeMultiChannel,
      'scope-measure-stat': Look41ScopeMeasureStat,
      'scope-xy-compare': Look41ScopeXyCompare,
    },
    shotLabels: {
      'scope-trace-title':
        'เส้นสัญญาณออสซิลโลสโคปสีเขียวฟอสฟอร์วาดผ่านกริด 10×8 พร้อมหางแสงค้างภาพและหัวข้อลอยขึ้นเหนือเส้นคลื่น',
      'scope-multi-channel':
        'หน้าจอสโคปหลายช่องสัญญาณ CH1–CH4 แสดงคลื่นไซน์ สี่เหลี่ยม ฟันเลื่อย และพัลส์ ควบคู่ประเด็นสำคัญแต่ละข้อ',
      'scope-measure-stat':
        'โหมดวัดค่าสัญญาณพร้อมเคอร์เซอร์เส้นประคู่แกน X/Y แสดงตัวเลขสถิติหลักและแผงค่าอ่านจากเครื่องมือวัด',
      'scope-xy-compare':
        'โหมด XY แสดงรูปลิสซาจูส 2:3 หมุนช้าๆ พร้อมหางฟอสฟอร์ สำหรับเปรียบเทียบสองช่องสัญญาณหรือนำเสนอคำคมสำคัญ',
    },
    infer: (scene) => {
      if (scene.stat) {
        return 'scope-measure-stat';
      }
      if (scene.compare || scene.quote?.text) {
        return 'scope-xy-compare';
      }
      const t = sceneTexts(scene);
      if (t.bullets.length >= 3) {
        return 'scope-multi-channel';
      }
      return null;
    },
  },
];
