import React from 'react';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import { splitThaiWords } from '../families';
import type { StudioScene } from '../types';
import {
  FitText,
  SAFE_BOTTOM,
  STAGE_H,
  STAGE_W,
  clamp01,
  sceneTexts,
} from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

// ============================================================================
// SHARED CONSTANTS & HELPERS FOR BATCH P
// look-44: Risograph (ภาพพิมพ์ริโซ)
// Two-colour risograph poster printing itself on twos (15fps stepped on 30fps)
// Pure, Deterministic, Inline SVG/CSS Only, Zero External Assets, Zero Gradients
// Safe stage bounds: x ∈ [54, 1026], y ∈ [112, CONTENT_BOTTOM (=1420)]
// ============================================================================

const CONTENT_BOTTOM_P = SAFE_BOTTOM - 120; // 1420
const SAFE_X_P = 54;
const SAFE_TOP_P = 112;
const SAFE_W_P = STAGE_W - SAFE_X_P * 2; // 972
const SAFE_H_P = CONTENT_BOTTOM_P - SAFE_TOP_P; // 1308

const L44_FONT = `'Bricolage Grotesque', ${THAI_FONT_FAMILY}, sans-serif`;

// Strict 2-ink Risograph palette on cool off-white paper (#EDEFEE)
// Overlap deep violet (~#32186F) is created purely by mix-blend-mode: multiply
const L44_COLORS = {
  paper: '#EDEFEE',
  paperFiber: '#D8DDDD',
  paperCloud: '#E2E6E5',
  pink: '#FF48B0',
  blue: '#3255A4',
} as const;

const L44_LIST_RE = /(?:ฟีเจอร์|คุณสมบัติ|จุดเด่น|ขั้นตอน|รายการ|เช็กลิสต์|ข้อ|lineup|feature|step|list)/i;

/** Deterministic Mulberry32 PRNG */
function mulberry32P(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Step frame on twos: every drawing holds for 2 frames */
function onTwosP(localFrame: number): { drawIndex: number; t: number } {
  const clamped = Math.max(0, Math.floor(localFrame));
  const drawIndex = Math.floor(clamped / 2);
  return { drawIndex, t: drawIndex * 2 };
}

function easeOutCubicP(x: number): number {
  const c = clamp01(x);
  return 1 - Math.pow(1 - c, 3);
}

interface RisoTransformP {
  visible: boolean;
  scale: number;
  rotateDeg: number;
  tx: number;
  ty: number;
}

/**
 * Stamp entry (on twos): lands big at 110-116% tilted 2-4 deg,
 * undershoots ~9% (0.91), then settles in 4-5 stepped drawings.
 */
function stampMotionP(
  t: number,
  delay: number,
  tiltDeg: number,
  initialScale = 1.14,
): RisoTransformP {
  if (t < delay) {
    return { visible: false, scale: initialScale, rotateDeg: tiltDeg, tx: 0, ty: 0 };
  }
  const step = Math.floor((t - delay) / 2);
  const scales = [initialScale, 0.91, 1.036, 0.986, 1.0];
  const rots = [tiltDeg, -tiltDeg * 0.42, tiltDeg * 0.16, -tiltDeg * 0.05, 0];
  const idx = Math.min(step, scales.length - 1);
  return {
    visible: true,
    scale: scales[idx],
    rotateDeg: rots[idx],
    tx: 0,
    ty: 0,
  };
}

/**
 * Slide entry (on twos): enters from off-frame with 8-12% spring overshoot,
 * then settles in 5 stepped drawings.
 */
function slideOvershootP(
  t: number,
  delay: number,
  fromX: number,
  fromY: number,
  overshootRatio = 0.1,
): RisoTransformP {
  if (t < delay) {
    return { visible: false, scale: 1, rotateDeg: 0, tx: fromX, ty: fromY };
  }
  const step = Math.floor((t - delay) / 2);
  const mults = [0.46, -overshootRatio, overshootRatio * 0.36, -overshootRatio * 0.11, 0];
  const idx = Math.min(step, mults.length - 1);
  return {
    visible: true,
    scale: 1,
    rotateDeg: 0,
    tx: fromX * mults[idx],
    ty: fromY * mults[idx],
  };
}

function toTransformCssP(tr: RisoTransformP): string {
  return `translate3d(${tr.tx.toFixed(1)}px, ${tr.ty.toFixed(1)}px, 0) rotate(${tr.rotateDeg.toFixed(2)}deg) scale(${tr.scale.toFixed(3)})`;
}

function toSvgTransformP(tr: RisoTransformP, cx: number, cy: number): string {
  return `translate(${(cx + tr.tx).toFixed(1)} ${(cy + tr.ty).toFixed(1)}) rotate(${tr.rotateDeg.toFixed(2)}) scale(${tr.scale.toFixed(3)}) translate(${(-cx).toFixed(1)} ${(-cy).toFixed(1)})`;
}

interface PlateOffsetsP {
  pinkX: number;
  pinkY: number;
  blueX: number;
  blueY: number;
  pinkSeed: number;
  blueSeed: number;
  stripeShift: number;
}

/**
 * Computes plate misregistration (2-4px base + 1-2px re-rolled per drawing)
 * plus the mid-shot plate slip (20-30px apart then springs back past register).
 */
function computePlateOffsetsP(
  t: number,
  drawIndex: number,
  durationFrames: number,
  sceneIndex: number,
): PlateOffsetsP {
  const rng = mulberry32P(sceneIndex * 997 + drawIndex * 37 + 19);

  // Base 2-4px static misregistration between pink & blue plates
  const basePinkX = -1.7;
  const basePinkY = -1.3;
  const baseBlueX = 1.7;
  const baseBlueY = 1.3;

  // Fresh print jitter on every drawing (1-2px)
  const jitterPinkX = (rng() - 0.5) * 2.2;
  const jitterPinkY = (rng() - 0.5) * 1.8;
  const jitterBlueX = (rng() - 0.5) * 2.2;
  const jitterBlueY = (rng() - 0.5) * 1.8;

  // Mid-shot plate slip: hold >=1s before & after when scene is ~5s,
  // and keep clear of QA sampling frames (at 0.35 and at 0.90)
  const safeDur = Math.max(60, durationFrames || 90);
  const rawSlipStart = Math.max(38, Math.round(safeDur * 0.52));
  const slipStart = Math.floor(rawSlipStart / 2) * 2;
  const slipDraw = Math.floor((t - slipStart) / 2);

  let slipX = 0;
  let slipY = 0;
  if (t >= slipStart) {
    // Pink moves +slipX, Blue moves -slipX -> total separation 2*|slipX| = 26-28px at peak
    const stepsX = [-13.5, -11.0, 5.2, -2.4, 0.9, 0];
    const stepsY = [-6.2, -5.0, 2.5, -1.1, 0.4, 0];
    if (slipDraw >= 0 && slipDraw < stepsX.length) {
      slipX = stepsX[slipDraw];
      slipY = stepsY[slipDraw];
    }
  }

  // Deterministic grain seeds that change every 2 frames (per drawIndex)
  const pinkSeed = ((drawIndex + 1 + sceneIndex * 17) % 899) + 1;
  const blueSeed = ((drawIndex + 43 + sceneIndex * 29) % 899) + 1;

  // Slow creeping diagonal stripe phase during holds (on twos)
  const stripeShift = (drawIndex * 3) % 28;

  return {
    pinkX: basePinkX + jitterPinkX + slipX,
    pinkY: basePinkY + jitterPinkY + slipY,
    blueX: baseBlueX + jitterBlueX - slipX,
    blueY: baseBlueY + jitterBlueY - slipY,
    pinkSeed,
    blueSeed,
    stripeShift,
  };
}

function haystackOfP(scene: StudioScene): string {
  const txt = sceneTexts(scene);
  const hl = Array.isArray(scene.highlight)
    ? scene.highlight.join(' ')
    : String(scene.highlight || '');
  return [
    txt.badge,
    txt.title,
    txt.subtitle,
    hl,
    ...txt.bullets,
    scene.stat?.label || '',
    scene.stat?.delta || '',
    scene.quote?.text || '',
    scene.compare?.leftTitle || '',
    scene.compare?.rightTitle || '',
  ].join(' ');
}

function extractPointsP(scene: StudioScene, max = 4): string[] {
  const txt = sceneTexts(scene);
  const out: string[] = [];

  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    for (const s of scene.steps) {
      if (typeof s === 'string') {
        if (s.trim()) out.push(s.trim());
      } else if (s?.title) {
        out.push(s.detail ? `${s.title} — ${s.detail}` : s.title);
      }
    }
  } else if (txt.bullets.length > 0) {
    out.push(...txt.bullets);
  } else if (scene.compare) {
    const combined = [...(scene.compare.leftItems || []), ...(scene.compare.rightItems || [])];
    for (const item of combined) {
      const clean = String(item || '').trim();
      if (clean) out.push(clean);
    }
  } else if (scene.stat) {
    if (scene.stat.label) out.push(scene.stat.label);
    if (scene.stat.delta) out.push(scene.stat.delta);
    if (txt.subtitle) out.push(txt.subtitle);
  } else if (scene.quote?.text) {
    out.push(scene.quote.text);
    if (scene.quote.author) out.push(`— ${scene.quote.author}`);
  } else if (txt.subtitle) {
    out.push(txt.subtitle);
  }

  if (out.length === 0 && txt.title) out.push(txt.title);
  return out.slice(0, max);
}

function parseNumericP(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw || '').replace(/,/g, '');
  const m = s.match(/\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const val = parseFloat(m[0]);
  return Number.isFinite(val) ? val : fallback;
}

interface PrimaryMetricP {
  big: string;
  prefix: string;
  suffix: string;
  decimals: number;
  useCommas: boolean;
  numeric: number;
  unit: string;
  label: string;
  delta: string;
  progress: number;
}

function extractPrimaryMetricP(scene: StudioScene, fallbackNum = 88): PrimaryMetricP {
  const txt = sceneTexts(scene);

  const parseParts = (rawBig: string, explicitNumeric?: number) => {
    const cleaned = rawBig.trim();
    const match = cleaned.match(/^([^0-9-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
    if (match) {
      const prefix = match[1] || '';
      const numStr = match[2] || '';
      const suffix = match[3] || '';
      const useCommas = numStr.includes(',');
      const decMatch = numStr.match(/\.(\d+)/);
      const decimals = decMatch ? decMatch[1].length : 0;
      const numeric = explicitNumeric ?? parseNumericP(numStr, fallbackNum);
      return { prefix, suffix, useCommas, decimals, numeric };
    }
    return {
      prefix: '',
      suffix: '',
      useCommas: false,
      decimals: 0,
      numeric: explicitNumeric ?? fallbackNum,
    };
  };

  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const rawVal = String(scene.stat.value).trim();
    const pref = String(scene.stat.prefix || '').trim();
    const suff = String(scene.stat.suffix || '').trim();
    const effPrefix = pref && !rawVal.startsWith(pref) ? pref : '';
    const effSuffix = suff && !rawVal.endsWith(suff) ? suff : '';
    const big = `${effPrefix}${rawVal}${effSuffix}`.trim();
    const parts = parseParts(big, scene.stat.numericValue);
    const prog =
      typeof scene.stat.progress === 'number' && Number.isFinite(scene.stat.progress)
        ? clamp01(scene.stat.progress / 100)
        : parts.numeric > 0 && parts.numeric <= 100
          ? clamp01(parts.numeric / 100)
          : 0.84;
    return {
      big,
      ...parts,
      unit: String(scene.stat.unit || '').trim(),
      label: String(scene.stat.label || txt.subtitle || txt.title).trim(),
      delta: String(scene.stat.delta || '').trim(),
      progress: prog,
    };
  }

  if (txt.numbers.length > 0) {
    const first = txt.numbers[0];
    const parts = parseParts(first);
    return {
      big: first,
      ...parts,
      unit: '',
      label: txt.subtitle || txt.title || 'ข้อมูลสำคัญ',
      delta: txt.badge || '',
      progress: parts.numeric > 0 && parts.numeric <= 100 ? clamp01(parts.numeric / 100) : 0.78,
    };
  }

  return {
    big: `${fallbackNum}%`,
    prefix: '',
    suffix: '%',
    decimals: 0,
    useCommas: false,
    numeric: fallbackNum,
    unit: '',
    label: txt.subtitle || txt.title || 'ตัวเลขสำคัญ',
    delta: txt.badge || '',
    progress: 0.88,
  };
}

function formatAnimatedStatP(metric: PrimaryMetricP, progress01: number): string {
  if (progress01 >= 0.999) return metric.big;
  const val = metric.numeric * clamp01(progress01);
  let numStr =
    metric.decimals > 0
      ? val.toFixed(metric.decimals)
      : String(Math.round(val));
  if (metric.useCommas) {
    const [intPart, decPart] = numStr.split('.');
    const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    numStr = decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
  }
  return `${metric.prefix}${numStr}${metric.suffix}`;
}

function extractHighlightWordP(scene: StudioScene): string {
  const txt = sceneTexts(scene);
  if (Array.isArray(scene.highlight)) {
    const first = scene.highlight.map((s) => String(s || '').trim()).find(Boolean);
    if (first && first.length <= 18) return first;
  } else if (typeof scene.highlight === 'string' && scene.highlight.trim()) {
    const h = scene.highlight.trim();
    if (h.length <= 18) return h;
  }
  if (txt.badge && txt.badge.length <= 16) return txt.badge;
  const words = splitThaiWords(txt.title || txt.subtitle || '');
  if (words.length >= 2) {
    const candidate = words.slice(0, 2).join('').trim();
    if (candidate.length <= 16) return candidate;
  }
  if (words.length >= 1 && words[0].length <= 16) return words[0];
  return 'PRINT';
}

function extractBandPhraseP(scene: StudioScene): string {
  const txt = sceneTexts(scene);
  if (txt.subtitle) return txt.subtitle;
  if (txt.bullets.length > 0) return txt.bullets[0];
  if (txt.badge) return txt.badge;
  const words = splitThaiWords(txt.title);
  if (words.length >= 3) {
    return words.slice(Math.ceil(words.length / 2)).join('').trim();
  }
  return txt.title || 'RISOGRAPH EDITION';
}

// ============================================================================
// SHARED RISOGRAPH STAGE & TWO-PLATE ENGINE
// ============================================================================

interface Look44StageIds {
  pinkHalftoneLight: string;
  pinkHalftoneMid: string;
  pinkHalftoneHeavy: string;
  blueHalftoneLight: string;
  blueHalftoneMid: string;
  blueHalftoneHeavy: string;
  pinkStripe: string;
  blueStripe: string;
  pinkGrain: string;
  blueGrain: string;
}

function makeStageIdsP(uid: string): Look44StageIds {
  return {
    pinkHalftoneLight: `l44-p-ht-l-${uid}`,
    pinkHalftoneMid: `l44-p-ht-m-${uid}`,
    pinkHalftoneHeavy: `l44-p-ht-h-${uid}`,
    blueHalftoneLight: `l44-b-ht-l-${uid}`,
    blueHalftoneMid: `l44-b-ht-m-${uid}`,
    blueHalftoneHeavy: `l44-b-ht-h-${uid}`,
    pinkStripe: `l44-p-str-${uid}`,
    blueStripe: `l44-b-str-${uid}`,
    pinkGrain: `l44-p-grn-${uid}`,
    blueGrain: `l44-b-grn-${uid}`,
  };
}

interface Look44RisoStageProps {
  uid: string;
  sceneIndex: number;
  drawIndex: number;
  offsets: PlateOffsetsP;
  pinkSvg: React.ReactNode;
  blueSvg: React.ReactNode;
  pinkHtml?: React.ReactNode;
  blueHtml?: React.ReactNode;
  knockoutHtml?: React.ReactNode;
}

/**
 * Renders cool off-white paper (#EDEFEE) with subtle cool fibers & stray ink specks,
 * followed by two physically separate ink plates (Fluorescent Pink #FF48B0 & Medium Blue #3255A4)
 * composited with mix-blend-mode: multiply so overlapping ink naturally forms deep violet (~#32186F).
 */
const Look44RisoStage: React.FC<Look44RisoStageProps> = ({
  uid,
  sceneIndex,
  drawIndex,
  offsets,
  pinkSvg,
  blueSvg,
  pinkHtml,
  blueHtml,
  knockoutHtml,
}) => {
  const ids = makeStageIdsP(uid);

  // Deterministic paper fibers (static per scene) & stray ink specks (subtle shift on twos)
  const fiberRng = mulberry32P(sceneIndex * 1009 + 73);
  const fibers = Array.from({ length: 22 }, (_, i) => {
    const x1 = Math.round(fiberRng() * STAGE_W);
    const y1 = Math.round(fiberRng() * STAGE_H);
    const len = 18 + Math.round(fiberRng() * 54);
    const ang = fiberRng() * Math.PI * 2;
    const x2 = Math.round(x1 + Math.cos(ang) * len);
    const y2 = Math.round(y1 + Math.sin(ang) * len);
    const cx = Math.round((x1 + x2) / 2 + (fiberRng() - 0.5) * 14);
    const cy = Math.round((y1 + y2) / 2 + (fiberRng() - 0.5) * 14);
    return { key: i, d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`, w: (0.7 + fiberRng() * 0.9).toFixed(2) };
  });

  // Subtle cool paper clouds (flat low-opacity cool organic ellipses — zero gradients)
  const cloudRng = mulberry32P(sceneIndex * 733 + 11);
  const clouds = Array.from({ length: 8 }, (_, i) => ({
    key: i,
    cx: Math.round(cloudRng() * STAGE_W),
    cy: Math.round(cloudRng() * STAGE_H),
    rx: 140 + Math.round(cloudRng() * 210),
    ry: 110 + Math.round(cloudRng() * 190),
    rot: Math.round(cloudRng() * 180),
  }));

  // Stray ink specks (few tiny deterministic dots in pink & blue)
  const speckRng = mulberry32P(sceneIndex * 419 + drawIndex * 13 + 5);
  const pinkSpecks = Array.from({ length: 11 }, (_, i) => ({
    key: i,
    cx: Math.round(30 + speckRng() * (STAGE_W - 60)),
    cy: Math.round(60 + speckRng() * (CONTENT_BOTTOM_P - 40)),
    r: (1.1 + speckRng() * 1.9).toFixed(1),
  }));
  const blueSpecks = Array.from({ length: 11 }, (_, i) => ({
    key: i,
    cx: Math.round(30 + speckRng() * (STAGE_W - 60)),
    cy: Math.round(60 + speckRng() * (CONTENT_BOTTOM_P - 40)),
    r: (1.1 + speckRng() * 1.9).toFixed(1),
  }));

  // Paper-white micro pinholes scattered across ink zones (re-rolled every 2 frames)
  const pinholeRng = mulberry32P(sceneIndex * 613 + drawIndex * 53 + 29);
  const pinholes = Array.from({ length: 68 }, (_, i) => ({
    key: i,
    cx: Math.round(SAFE_X_P + pinholeRng() * SAFE_W_P),
    cy: Math.round(SAFE_TOP_P + pinholeRng() * SAFE_H_P),
    rx: (0.9 + pinholeRng() * 1.7).toFixed(1),
    ry: (0.7 + pinholeRng() * 1.4).toFixed(1),
    rot: Math.round(pinholeRng() * 180),
  }));

  return (
    <div
      style={{
        position: 'relative',
        width: STAGE_W,
        height: STAGE_H,
        backgroundColor: L44_COLORS.paper,
        overflow: 'hidden',
        isolation: 'isolate',
        fontFamily: L44_FONT,
      }}
    >
      {/* Shared SVG Defs (Halftone screen angles 15° & 75°, 12px pitch, Grain filters) */}
      <svg
        width={0}
        height={0}
        style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <defs>
          {/* Pink Halftone Patterns — 12px pitch, 15 deg screen angle */}
          <pattern
            id={ids.pinkHalftoneLight}
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(15)"
          >
            <circle cx="6" cy="6" r="2.2" fill={L44_COLORS.pink} />
          </pattern>
          <pattern
            id={ids.pinkHalftoneMid}
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(15)"
          >
            <circle cx="6" cy="6" r="3.4" fill={L44_COLORS.pink} />
          </pattern>
          <pattern
            id={ids.pinkHalftoneHeavy}
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(15)"
          >
            <circle cx="6" cy="6" r="4.6" fill={L44_COLORS.pink} />
          </pattern>

          {/* Blue Halftone Patterns — 12px pitch, 75 deg screen angle */}
          <pattern
            id={ids.blueHalftoneLight}
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(75)"
          >
            <circle cx="6" cy="6" r="2.2" fill={L44_COLORS.blue} />
          </pattern>
          <pattern
            id={ids.blueHalftoneMid}
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(75)"
          >
            <circle cx="6" cy="6" r="3.4" fill={L44_COLORS.blue} />
          </pattern>
          <pattern
            id={ids.blueHalftoneHeavy}
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(75)"
          >
            <circle cx="6" cy="6" r="4.6" fill={L44_COLORS.blue} />
          </pattern>

          {/* Creeping Diagonal Stripes (on-twos shift) */}
          <pattern
            id={ids.pinkStripe}
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(-35) translate(${offsets.stripeShift} 0)`}
          >
            <rect x="0" y="0" width="12" height="28" fill={L44_COLORS.pink} />
          </pattern>
          <pattern
            id={ids.blueStripe}
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(-35) translate(${offsets.stripeShift + 14} 0)`}
          >
            <rect x="0" y="0" width="9" height="28" fill={L44_COLORS.blue} />
          </pattern>

          {/* Mottled Ink Grain & Ragged Edge Filter — Pink Plate (re-rolled every 2 frames) */}
          <filter
            id={ids.pinkGrain}
            x="-4%"
            y="-4%"
            width="108%"
            height="108%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.065 0.085"
              numOctaves={2}
              seed={offsets.pinkSeed}
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale={3.0}
              xChannelSelector="R"
              yChannelSelector="G"
              result="ragged"
            />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.42"
              numOctaves={1}
              seed={offsets.pinkSeed + 101}
              result="speckNoise"
            />
            <feComponentTransfer in="speckNoise" result="speckAlpha">
              <feFuncA type="discrete" tableValues="0 1 1 1 1 1 1 1 1 1" />
            </feComponentTransfer>
            <feComposite in="ragged" in2="speckAlpha" operator="in" />
          </filter>

          {/* Mottled Ink Grain & Ragged Edge Filter — Blue Plate (re-rolled every 2 frames) */}
          <filter
            id={ids.blueGrain}
            x="-4%"
            y="-4%"
            width="108%"
            height="108%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.065 0.085"
              numOctaves={2}
              seed={offsets.blueSeed}
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale={3.0}
              xChannelSelector="R"
              yChannelSelector="G"
              result="ragged"
            />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.44"
              numOctaves={1}
              seed={offsets.blueSeed + 107}
              result="speckNoise"
            />
            <feComponentTransfer in="speckNoise" result="speckAlpha">
              <feFuncA type="discrete" tableValues="0 1 1 1 1 1 1 1 1 1" />
            </feComponentTransfer>
            <feComposite in="ragged" in2="speckAlpha" operator="in" />
          </filter>
        </defs>
      </svg>

      {/* LAYER 0: Cool Off-White Paper Clouding & Fine Cellulose Fibers */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {clouds.map((c) => (
          <ellipse
            key={c.key}
            cx={c.cx}
            cy={c.cy}
            rx={c.rx}
            ry={c.ry}
            fill={L44_COLORS.paperCloud}
            opacity={0.42}
            transform={`rotate(${c.rot} ${c.cx} ${c.cy})`}
          />
        ))}
        {fibers.map((f) => (
          <path
            key={f.key}
            d={f.d}
            fill="none"
            stroke={L44_COLORS.paperFiber}
            strokeWidth={f.w}
            strokeLinecap="round"
            opacity={0.78}
          />
        ))}
      </svg>

      {/* LAYER 1: FLUORESCENT PINK PLATE (#FF48B0) — mix-blend-mode: multiply */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          mixBlendMode: 'multiply',
          transform: `translate3d(${offsets.pinkX.toFixed(2)}px, ${offsets.pinkY.toFixed(2)}px, 0)`,
          pointerEvents: 'none',
        }}
      >
        <svg
          width={STAGE_W}
          height={STAGE_H}
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          style={{ position: 'absolute', inset: 0 }}
        >
          <g filter={`url(#${ids.pinkGrain})`}>
            {pinkSvg}
            {/* Subtle top poster crop ticks (kept strictly above y=1440) */}
            <path
              d={`M ${SAFE_X_P - 18} ${SAFE_TOP_P - 26} H ${SAFE_X_P + 4} M ${SAFE_X_P - 18} ${SAFE_TOP_P - 26} V ${SAFE_TOP_P - 4}`}
              stroke={L44_COLORS.pink}
              strokeWidth={2}
              fill="none"
              opacity={0.65}
            />
            <path
              d={`M ${STAGE_W - SAFE_X_P + 18} ${SAFE_TOP_P - 26} H ${STAGE_W - SAFE_X_P - 4} M ${STAGE_W - SAFE_X_P + 18} ${SAFE_TOP_P - 26} V ${SAFE_TOP_P - 4}`}
              stroke={L44_COLORS.pink}
              strokeWidth={2}
              fill="none"
              opacity={0.65}
            />
          </g>
          {/* Stray pink ink specks */}
          {pinkSpecks.map((s) => (
            <circle key={s.key} cx={s.cx} cy={s.cy} r={s.r} fill={L44_COLORS.pink} opacity={0.75} />
          ))}
        </svg>
        {pinkHtml && (
          <div style={{ position: 'absolute', inset: 0 }}>{pinkHtml}</div>
        )}
      </div>

      {/* LAYER 2: MEDIUM BLUE PLATE (#3255A4) — mix-blend-mode: multiply */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          mixBlendMode: 'multiply',
          transform: `translate3d(${offsets.blueX.toFixed(2)}px, ${offsets.blueY.toFixed(2)}px, 0)`,
          pointerEvents: 'none',
        }}
      >
        <svg
          width={STAGE_W}
          height={STAGE_H}
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          style={{ position: 'absolute', inset: 0 }}
        >
          <g filter={`url(#${ids.blueGrain})`}>
            {blueSvg}
            <path
              d={`M ${SAFE_X_P - 18} ${CONTENT_BOTTOM_P + 22} H ${SAFE_X_P + 4} M ${SAFE_X_P - 18} ${CONTENT_BOTTOM_P + 22} V ${CONTENT_BOTTOM_P}`}
              stroke={L44_COLORS.blue}
              strokeWidth={2}
              fill="none"
              opacity={0.65}
            />
            <path
              d={`M ${STAGE_W - SAFE_X_P + 18} ${CONTENT_BOTTOM_P + 22} H ${STAGE_W - SAFE_X_P - 4} M ${STAGE_W - SAFE_X_P + 18} ${CONTENT_BOTTOM_P + 22} V ${CONTENT_BOTTOM_P}`}
              stroke={L44_COLORS.blue}
              strokeWidth={2}
              fill="none"
              opacity={0.65}
            />
          </g>
          {/* Stray blue ink specks */}
          {blueSpecks.map((s) => (
            <circle key={s.key} cx={s.cx} cy={s.cy} r={s.r} fill={L44_COLORS.blue} opacity={0.75} />
          ))}
        </svg>
        {blueHtml && (
          <div style={{ position: 'absolute', inset: 0 }}>{blueHtml}</div>
        )}
      </div>

      {/* LAYER 3: PAPER KNOCKOUT LAYER (Unprinted #EDEFEE paper showing through ink stencils) */}
      {knockoutHtml && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {knockoutHtml}
        </div>
      )}

      {/* LAYER 4: PAPER-WHITE MICRO PINHOLES (Re-rolled on twos for tactile ink mottle) */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {pinholes.map((p) => (
          <ellipse
            key={p.key}
            cx={p.cx}
            cy={p.cy}
            rx={p.rx}
            ry={p.ry}
            fill={L44_COLORS.paper}
            opacity={0.82}
            transform={`rotate(${p.rot} ${p.cx} ${p.cy})`}
          />
        ))}
      </svg>
    </div>
  );
};

// ============================================================================
// REUSABLE RISOGRAPHIC SVG MOTIFS (REGISTRATION MARK, HALFTONE DOT RAMP)
// ============================================================================

const Look44RegCross: React.FC<{ cx: number; cy: number; r?: number; color: string }> = ({
  cx,
  cy,
  r = 16,
  color,
}) => (
  <g stroke={color} strokeWidth={2.5} fill="none">
    <circle cx={cx} cy={cy} r={r} />
    <line x1={cx - r - 8} y1={cy} x2={cx + r + 8} y2={cy} />
    <line x1={cx} y1={cy - r - 8} x2={cx} y2={cy + r + 8} />
  </g>
);

/**
 * Row of halftone dots growing from small (left) to large (right).
 * Drawn separately on Pink and Blue plates so overlap creates violet depth.
 */
const Look44DotRampPlate: React.FC<{
  x: number;
  y: number;
  width: number;
  count: number;
  plate: 'pink' | 'blue';
  t: number;
  baseDelay: number;
  maxRadius?: number;
}> = ({ x, y, width, count, plate, t, baseDelay, maxRadius = 26 }) => {
  const color = plate === 'pink' ? L44_COLORS.pink : L44_COLORS.blue;
  const stepX = count > 1 ? width / (count - 1) : 0;
  const yOffset = plate === 'pink' ? -5 : 7;

  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const frac = count > 1 ? i / (count - 1) : 1;
        const r = 4.2 + Math.pow(frac, 1.25) * (maxRadius - 4.2);
        const cx = x + i * stepX;
        const cy = y + yOffset;
        const itemDelay = baseDelay + Math.floor(i / 2) * 2;
        const tr = stampMotionP(t, itemDelay, plate === 'pink' ? -2.2 : 2.2, 1.15);
        if (!tr.visible) return null;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill={color}
            transform={toSvgTransformP(tr, cx, cy)}
          />
        );
      })}
    </g>
  );
};

// ============================================================================
// SHOT 1: 'riso-poster-title' — Full-width headline + 2 overlapping circles
//         + diagonal stripe band with second word + growing halftone dot ramp
// ============================================================================

const Look44RisoPosterTitle: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
}) => {
  const { drawIndex, t } = onTwosP(localFrame);
  const offsets = computePlateOffsetsP(t, drawIndex, durationFrames, sceneIndex);
  const uid = `title-${sceneIndex}`;
  const ids = makeStageIdsP(uid);

  const txt = sceneTexts(scene);
  const mainTitle = txt.title || 'ภาพพิมพ์ริโซสองหมึก';
  const bandPhrase = extractBandPhraseP(scene);
  const knockoutWord = extractHighlightWordP(scene);
  const editionLabel = txt.badge || `RISO PRINT · NO. 0${(sceneIndex % 9) + 1}`;

  // Staggered on-twos choreography (4-6 frames apart in reading order; frame 0 already has ink!)
  const headerTr = stampMotionP(t, 0, -2.0, 1.11);
  const titleTr = stampMotionP(t, 0, -2.8, 1.14);
  const pinkCircleTr = stampMotionP(t, 6, -3.2, 1.15);
  const blueCircleTr = slideOvershootP(t, 10, 420, 0, 0.11);
  const knockoutTr = stampMotionP(t, 14, 2.6, 1.13);
  const bandTr = slideOvershootP(t, 18, -560, 0, 0.1);
  const rampDelay = 24;

  // Centerpiece overlapping circles geometry
  const pinkCx = 408;
  const pinkCy = 694;
  const blueCx = 672;
  const blueCy = 720;
  const circleR = 202;

  // Diagonal stripe band geometry
  const bandY = 972;
  const bandH = 186;

  const renderHeadline = (color: string) => (
    <div
      style={{
        position: 'absolute',
        left: SAFE_X_P,
        top: 184,
        width: SAFE_W_P,
        height: 274,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: titleTr.visible ? 1 : 0,
        transform: toTransformCssP(titleTr),
        transformOrigin: '50% 50%',
      }}
    >
      <FitText
        text={mainTitle}
        baseSize={94}
        minSize={52}
        maxLines={3}
        color={color}
        fontFamily={L44_FONT}
        fontWeight={800}
        align="center"
        lineHeight={1.18}
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.02em',
          width: '100%',
        }}
      />
    </div>
  );

  const pinkSvg = (
    <g>
      {/* Top-left halftone corner block (visible on frame 0) */}
      {headerTr.visible && (
        <g transform={toSvgTransformP(headerTr, SAFE_X_P + 190, SAFE_TOP_P + 26)}>
          <rect
            x={SAFE_X_P}
            y={SAFE_TOP_P}
            width={396}
            height={50}
            fill={`url(#${ids.pinkHalftoneMid})`}
          />
          <rect
            x={SAFE_X_P}
            y={SAFE_TOP_P}
            width={396}
            height={50}
            fill="none"
            stroke={L44_COLORS.pink}
            strokeWidth={4}
          />
        </g>
      )}

      {/* Top-right registration mark */}
      <Look44RegCross cx={STAGE_W - SAFE_X_P - 24} cy={SAFE_TOP_P + 25} r={14} color={L44_COLORS.pink} />

      {/* Top horizontal ink rule under header */}
      <rect x={SAFE_X_P} y={172} width={SAFE_W_P} height={4} fill={L44_COLORS.pink} />

      {/* Left overlapping hero circle — Fluorescent Pink solid + halftone halo */}
      {pinkCircleTr.visible && (
        <g transform={toSvgTransformP(pinkCircleTr, pinkCx, pinkCy)}>
          <circle
            cx={pinkCx - 16}
            cy={pinkCy - 12}
            r={circleR + 18}
            fill={`url(#${ids.pinkHalftoneLight})`}
          />
          <circle cx={pinkCx} cy={pinkCy} r={circleR} fill={L44_COLORS.pink} />
          <circle
            cx={pinkCx}
            cy={pinkCy}
            r={circleR - 22}
            fill="none"
            stroke={L44_COLORS.pink}
            strokeWidth={5}
            strokeDasharray="16 10"
          />
        </g>
      )}

      {/* Diagonal Stripe Band — Pink creeping stripes */}
      {bandTr.visible && (
        <g transform={toSvgTransformP(bandTr, STAGE_W / 2, bandY + bandH / 2)}>
          <rect
            x={SAFE_X_P}
            y={bandY}
            width={SAFE_W_P}
            height={bandH}
            fill={`url(#${ids.pinkStripe})`}
          />
          <rect
            x={SAFE_X_P}
            y={bandY}
            width={SAFE_W_P}
            height={bandH}
            fill="none"
            stroke={L44_COLORS.pink}
            strokeWidth={5}
          />
          {/* Inner core bar behind second phrase (multiplies with Blue core bar into violet) */}
          <rect
            x={SAFE_X_P + 46}
            y={bandY + 28}
            width={SAFE_W_P - 92}
            height={bandH - 56}
            fill={L44_COLORS.pink}
          />
        </g>
      )}

      {/* Bottom growing halftone dot ramp — Pink plate */}
      <Look44DotRampPlate
        x={SAFE_X_P + 24}
        y={1282}
        width={SAFE_W_P - 48}
        count={12}
        plate="pink"
        t={t}
        baseDelay={rampDelay}
        maxRadius={29}
      />

      {/* Bottom register rule above empty bottom fifth */}
      <rect x={SAFE_X_P} y={1382} width={SAFE_W_P} height={4} fill={L44_COLORS.pink} />
    </g>
  );

  const blueSvg = (
    <g>
      {/* Top-right edition stamp frame */}
      {headerTr.visible && (
        <g transform={toSvgTransformP(headerTr, STAGE_W - SAFE_X_P - 170, SAFE_TOP_P + 25)}>
          <rect
            x={STAGE_W - SAFE_X_P - 290}
            y={SAFE_TOP_P + 4}
            width={220}
            height={42}
            fill={L44_COLORS.blue}
          />
        </g>
      )}

      <Look44RegCross cx={STAGE_W - SAFE_X_P - 24} cy={SAFE_TOP_P + 25} r={14} color={L44_COLORS.blue} />

      {/* Top horizontal ink rule (overprints with pink rule -> violet) */}
      <rect x={SAFE_X_P} y={172} width={SAFE_W_P} height={4} fill={L44_COLORS.blue} />

      {/* Right overlapping hero circle — Medium Blue solid + 75° halftone halo */}
      {blueCircleTr.visible && (
        <g transform={toSvgTransformP(blueCircleTr, blueCx, blueCy)}>
          <circle
            cx={blueCx + 18}
            cy={blueCy + 14}
            r={circleR + 18}
            fill={`url(#${ids.blueHalftoneLight})`}
          />
          <circle cx={blueCx} cy={blueCy} r={circleR} fill={L44_COLORS.blue} />
          <circle
            cx={blueCx}
            cy={blueCy}
            r={circleR - 20}
            fill={`url(#${ids.blueHalftoneHeavy})`}
          />
        </g>
      )}

      {/* Diagonal Stripe Band — Blue creeping stripes + core bar */}
      {bandTr.visible && (
        <g transform={toSvgTransformP(bandTr, STAGE_W / 2, bandY + bandH / 2)}>
          <rect
            x={SAFE_X_P}
            y={bandY}
            width={SAFE_W_P}
            height={bandH}
            fill={`url(#${ids.blueStripe})`}
          />
          <rect
            x={SAFE_X_P + 46}
            y={bandY + 28}
            width={SAFE_W_P - 92}
            height={bandH - 56}
            fill={L44_COLORS.blue}
          />
        </g>
      )}

      {/* Bottom growing halftone dot ramp — Blue plate */}
      <Look44DotRampPlate
        x={SAFE_X_P + 24}
        y={1282}
        width={SAFE_W_P - 48}
        count={12}
        plate="blue"
        t={t}
        baseDelay={rampDelay + 2}
        maxRadius={29}
      />

      {/* Bottom register rule */}
      <rect x={SAFE_X_P} y={1382} width={SAFE_W_P} height={4} fill={L44_COLORS.blue} />
    </g>
  );

  const pinkHtml = (
    <>
      {renderHeadline(L44_COLORS.pink)}
      {/* Top-left badge text overprinted for crisp violet */}
      {headerTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: SAFE_X_P + 14,
            top: SAFE_TOP_P + 4,
            width: 368,
            height: 42,
            display: 'flex',
            alignItems: 'center',
            transform: toTransformCssP(headerTr),
          }}
        >
          <FitText
            text={editionLabel}
            baseSize={22}
            minSize={15}
            maxLines={1}
            color={L44_COLORS.pink}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="left"
            lineHeight={1.2}
            style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}
          />
        </div>
      )}
    </>
  );

  const blueHtml = (
    <>
      {renderHeadline(L44_COLORS.blue)}
      {headerTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: SAFE_X_P + 14,
            top: SAFE_TOP_P + 4,
            width: 368,
            height: 42,
            display: 'flex',
            alignItems: 'center',
            transform: toTransformCssP(headerTr),
          }}
        >
          <FitText
            text={editionLabel}
            baseSize={22}
            minSize={15}
            maxLines={1}
            color={L44_COLORS.blue}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="left"
            lineHeight={1.2}
            style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}
          />
        </div>
      )}
    </>
  );

  const knockoutHtml = (
    <>
      {/* Top-right edition number knocked out to paper inside Blue bar */}
      {headerTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: STAGE_W - SAFE_X_P - 290,
            top: SAFE_TOP_P + 4,
            width: 220,
            height: 42,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `translate3d(${offsets.blueX.toFixed(1)}px, ${offsets.blueY.toFixed(1)}px, 0) ${toTransformCssP(headerTr)}`,
          }}
        >
          <FitText
            text={`2-INK · P${String(sceneIndex + 1).padStart(2, '0')}`}
            baseSize={22}
            minSize={18}
            maxLines={1}
            color={L44_COLORS.paper}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="center"
            lineHeight={1.2}
            style={{ letterSpacing: '0.06em' }}
          />
        </div>
      )}

      {/* Short word knocked out through the center of the overlapping circles revealing #EDEFEE paper */}
      {knockoutTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: 256,
            top: 632,
            width: 568,
            height: 156,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: toTransformCssP(knockoutTr),
            transformOrigin: '50% 50%',
          }}
        >
          <FitText
            text={knockoutWord}
            baseSize={64}
            minSize={34}
            maxLines={2}
            color={L44_COLORS.paper}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="center"
            lineHeight={1.22}
            style={{ letterSpacing: '0.04em', textTransform: 'uppercase', width: '100%' }}
          />
        </div>
      )}

      {/* Second word/phrase knocked out inside the multiplied core of the diagonal stripe band */}
      {bandTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: SAFE_X_P + 66,
            top: bandY + 32,
            width: SAFE_W_P - 132,
            height: bandH - 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: toTransformCssP(bandTr),
          }}
        >
          <FitText
            text={bandPhrase}
            baseSize={42}
            minSize={26}
            maxLines={2}
            color={L44_COLORS.paper}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="center"
            lineHeight={1.26}
            style={{ width: '100%' }}
          />
        </div>
      )}
    </>
  );

  return (
    <Look44RisoStage
      uid={uid}
      sceneIndex={sceneIndex}
      drawIndex={drawIndex}
      offsets={offsets}
      pinkSvg={pinkSvg}
      blueSvg={blueSvg}
      pinkHtml={pinkHtml}
      blueHtml={blueHtml}
      knockoutHtml={knockoutHtml}
    />
  );
};

// ============================================================================
// SHOT 2: 'riso-lineup-list' — Bullets/steps stamped row-by-row as 2-ink tags
// ============================================================================

const Look44RisoLineupList: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
}) => {
  const { drawIndex, t } = onTwosP(localFrame);
  const offsets = computePlateOffsetsP(t, drawIndex, durationFrames, sceneIndex);
  const uid = `list-${sceneIndex}`;
  const ids = makeStageIdsP(uid);

  const txt = sceneTexts(scene);
  const title = txt.title || 'รายการสำคัญ';
  const kicker = txt.badge || `LINEUP · 0${(sceneIndex % 9) + 1}`;
  const items = extractPointsP(scene, 4);

  const headerTr = stampMotionP(t, 0, -2.2, 1.12);
  const dividerTr = slideOvershootP(t, 4, -520, 0, 0.1);

  const listTop = 376;
  const listAreaH = 850;
  const rowGap = 24;
  const rowCount = Math.max(1, items.length);
  const rowH = Math.min(200, Math.floor((listAreaH - rowGap * (rowCount - 1)) / rowCount));

  const rowMotions = items.map((_, i) => {
    const delay = 6 + i * 6;
    if (i % 2 === 0) {
      return stampMotionP(t, delay, i % 4 === 0 ? -2.4 : 2.2, 1.12);
    }
    return slideOvershootP(t, delay, i % 4 === 1 ? 460 : -460, 0, 0.1);
  });

  const renderTitle = (color: string) => (
    <div
      style={{
        position: 'absolute',
        left: SAFE_X_P,
        top: 176,
        width: SAFE_W_P,
        height: 152,
        display: 'flex',
        alignItems: 'center',
        opacity: headerTr.visible ? 1 : 0,
        transform: toTransformCssP(headerTr),
        transformOrigin: '0% 50%',
      }}
    >
      <FitText
        text={title}
        baseSize={64}
        minSize={38}
        maxLines={2}
        color={color}
        fontFamily={L44_FONT}
        fontWeight={800}
        align="left"
        lineHeight={1.2}
        style={{ width: '100%' }}
      />
    </div>
  );

  const renderRowTexts = (color: string) => (
    <>
      {items.map((item, i) => {
        const y = listTop + i * (rowH + rowGap);
        const tr = rowMotions[i];
        if (!tr.visible) return null;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: SAFE_X_P + 136,
              top: y + 14,
              width: SAFE_W_P - 166,
              height: rowH - 28,
              display: 'flex',
              alignItems: 'center',
              transform: toTransformCssP(tr),
              transformOrigin: '50% 50%',
            }}
          >
            <FitText
              text={item}
              baseSize={rowCount <= 3 ? 40 : 34}
              minSize={22}
              maxLines={rowCount <= 3 ? 3 : 2}
              color={color}
              fontFamily={L44_FONT}
              fontWeight={800}
              align="left"
              lineHeight={1.26}
              style={{ width: '100%' }}
            />
          </div>
        );
      })}
    </>
  );

  const pinkSvg = (
    <g>
      {/* Top kicker halftone pill */}
      {headerTr.visible && (
        <rect
          x={SAFE_X_P}
          y={SAFE_TOP_P}
          width={384}
          height={46}
          fill={L44_COLORS.pink}
          transform={toSvgTransformP(headerTr, SAFE_X_P + 192, SAFE_TOP_P + 23)}
        />
      )}
      <Look44RegCross cx={STAGE_W - SAFE_X_P - 24} cy={SAFE_TOP_P + 23} r={14} color={L44_COLORS.pink} />

      {/* Creeping diagonal stripe divider */}
      {dividerTr.visible && (
        <rect
          x={SAFE_X_P}
          y={336}
          width={SAFE_W_P}
          height={22}
          fill={`url(#${ids.pinkStripe})`}
          transform={toSvgTransformP(dividerTr, STAGE_W / 2, 347)}
        />
      )}

      {/* Lineup rows — Pink plate */}
      {items.map((_, i) => {
        const y = listTop + i * (rowH + rowGap);
        const tr = rowMotions[i];
        if (!tr.visible) return null;
        const isPinkPrimary = i % 2 === 0;
        const badgeCx = SAFE_X_P + 58;
        const badgeCy = y + rowH / 2;
        return (
          <g key={i} transform={toSvgTransformP(tr, STAGE_W / 2, badgeCy)}>
            {/* Halftone right accent strip */}
            <rect
              x={SAFE_X_P + 116}
              y={y + 8}
              width={SAFE_W_P - 116}
              height={rowH - 16}
              fill={isPinkPrimary ? `url(#${ids.pinkHalftoneLight})` : 'none'}
              stroke={L44_COLORS.pink}
              strokeWidth={isPinkPrimary ? 5 : 3}
            />
            {/* Index circle — overlapping with Blue circle to make violet rim/core */}
            <circle
              cx={badgeCx - (isPinkPrimary ? 0 : 12)}
              cy={badgeCy}
              r={46}
              fill={isPinkPrimary ? L44_COLORS.pink : `url(#${ids.pinkHalftoneHeavy})`}
            />
          </g>
        );
      })}

      {/* Bottom growing dot ramp */}
      <Look44DotRampPlate
        x={SAFE_X_P + 22}
        y={1314}
        width={SAFE_W_P - 44}
        count={12}
        plate="pink"
        t={t}
        baseDelay={6 + rowCount * 6}
        maxRadius={24}
      />
      <rect x={SAFE_X_P} y={1390} width={SAFE_W_P} height={4} fill={L44_COLORS.pink} />
    </g>
  );

  const blueSvg = (
    <g>
      {headerTr.visible && (
        <rect
          x={SAFE_X_P}
          y={SAFE_TOP_P}
          width={384}
          height={46}
          fill={L44_COLORS.blue}
          transform={toSvgTransformP(headerTr, SAFE_X_P + 192, SAFE_TOP_P + 23)}
        />
      )}
      <Look44RegCross cx={STAGE_W - SAFE_X_P - 24} cy={SAFE_TOP_P + 23} r={14} color={L44_COLORS.blue} />

      {dividerTr.visible && (
        <rect
          x={SAFE_X_P}
          y={336}
          width={SAFE_W_P}
          height={22}
          fill={`url(#${ids.blueStripe})`}
          transform={toSvgTransformP(dividerTr, STAGE_W / 2, 347)}
        />
      )}

      {/* Lineup rows — Blue plate */}
      {items.map((_, i) => {
        const y = listTop + i * (rowH + rowGap);
        const tr = rowMotions[i];
        if (!tr.visible) return null;
        const isBluePrimary = i % 2 === 1;
        const badgeCx = SAFE_X_P + 58;
        const badgeCy = y + rowH / 2;
        return (
          <g key={i} transform={toSvgTransformP(tr, STAGE_W / 2, badgeCy)}>
            <rect
              x={SAFE_X_P + 116}
              y={y + 8}
              width={SAFE_W_P - 116}
              height={rowH - 16}
              fill={isBluePrimary ? `url(#${ids.blueHalftoneLight})` : 'none'}
              stroke={L44_COLORS.blue}
              strokeWidth={isBluePrimary ? 5 : 3}
            />
            <circle
              cx={badgeCx + (isBluePrimary ? 0 : 12)}
              cy={badgeCy}
              r={46}
              fill={isBluePrimary ? L44_COLORS.blue : `url(#${ids.blueHalftoneHeavy})`}
            />
          </g>
        );
      })}

      <Look44DotRampPlate
        x={SAFE_X_P + 22}
        y={1314}
        width={SAFE_W_P - 44}
        count={12}
        plate="blue"
        t={t}
        baseDelay={8 + rowCount * 6}
        maxRadius={24}
      />
      <rect x={SAFE_X_P} y={1390} width={SAFE_W_P} height={4} fill={L44_COLORS.blue} />
    </g>
  );

  const pinkHtml = (
    <>
      {renderTitle(L44_COLORS.pink)}
      {renderRowTexts(L44_COLORS.pink)}
    </>
  );

  const blueHtml = (
    <>
      {renderTitle(L44_COLORS.blue)}
      {renderRowTexts(L44_COLORS.blue)}
    </>
  );

  const knockoutHtml = (
    <>
      {/* Kicker knocked out of multiplied violet header tag */}
      {headerTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: SAFE_X_P + 12,
            top: SAFE_TOP_P + 2,
            width: 360,
            height: 42,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: toTransformCssP(headerTr),
          }}
        >
          <FitText
            text={kicker}
            baseSize={22}
            minSize={15}
            maxLines={1}
            color={L44_COLORS.paper}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="center"
            lineHeight={1.2}
            style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}
          />
        </div>
      )}

      {/* Index numerals knocked out of each 2-ink circle */}
      {items.map((_, i) => {
        const y = listTop + i * (rowH + rowGap);
        const tr = rowMotions[i];
        if (!tr.visible) return null;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: SAFE_X_P + 12,
              top: y + rowH / 2 - 26,
              width: 92,
              height: 52,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: toTransformCssP(tr),
            }}
          >
            <FitText
              text={String(i + 1).padStart(2, '0')}
              baseSize={38}
              minSize={28}
              maxLines={1}
              color={L44_COLORS.paper}
              fontFamily={L44_FONT}
              fontWeight={800}
              align="center"
              lineHeight={1.15}
              style={{ letterSpacing: '0.04em' }}
            />
          </div>
        );
      })}
    </>
  );

  return (
    <Look44RisoStage
      uid={uid}
      sceneIndex={sceneIndex}
      drawIndex={drawIndex}
      offsets={offsets}
      pinkSvg={pinkSvg}
      blueSvg={blueSvg}
      pinkHtml={pinkHtml}
      blueHtml={blueHtml}
      knockoutHtml={knockoutHtml}
    />
  );
};

// ============================================================================
// SHOT 3: 'riso-big-stat' — Giant 2-ink number counting up on twos + caption
// ============================================================================

const Look44RisoBigStat: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
}) => {
  const { drawIndex, t } = onTwosP(localFrame);
  const offsets = computePlateOffsetsP(t, drawIndex, durationFrames, sceneIndex);
  const uid = `stat-${sceneIndex}`;
  const ids = makeStageIdsP(uid);

  const txt = sceneTexts(scene);
  const metric = extractPrimaryMetricP(scene, 88);
  const title = txt.title || 'สถิติสำคัญ';
  const badge = txt.badge || `RISO STAT · 0${(sceneIndex % 9) + 1}`;

  // Staggered on-twos entrances
  const headerTr = stampMotionP(t, 0, -2.0, 1.12);
  const pinkOrbTr = stampMotionP(t, 4, -3.0, 1.14);
  const blueOrbTr = slideOvershootP(t, 8, 440, 0, 0.11);
  const numTr = stampMotionP(t, 6, -3.2, 1.16);
  const unitTr = stampMotionP(t, 14, 2.5, 1.12);
  const meterDelay = 16;
  const descTr = slideOvershootP(t, 20, -520, 0, 0.1);
  const deltaTr = stampMotionP(t, 26, -3.5, 1.14);

  // On-twos count-up over 24 frames (12 stepped drawings)
  const countProgress = easeOutCubicP((t - 4) / 24);
  const animatedBig = formatAnimatedStatP(metric, countProgress);

  // Halftone dot meter parameters (14 dots representing 0..100%)
  const dotCount = 14;
  const filledDots = Math.max(1, Math.round(metric.progress * dotCount * countProgress));

  const renderHeaderTitle = (color: string) => (
    <div
      style={{
        position: 'absolute',
        left: SAFE_X_P,
        top: 174,
        width: SAFE_W_P,
        height: 136,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: headerTr.visible ? 1 : 0,
        transform: toTransformCssP(headerTr),
      }}
    >
      <FitText
        text={title}
        baseSize={56}
        minSize={34}
        maxLines={2}
        color={color}
        fontFamily={L44_FONT}
        fontWeight={800}
        align="center"
        lineHeight={1.22}
        style={{ width: '100%' }}
      />
    </div>
  );

  const renderGiantStat = (color: string) => (
    <div
      style={{
        position: 'absolute',
        left: SAFE_X_P + 24,
        top: 442,
        width: SAFE_W_P - 48,
        height: 230,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: numTr.visible ? 1 : 0,
        transform: toTransformCssP(numTr),
        transformOrigin: '50% 50%',
      }}
    >
      <FitText
        text={animatedBig}
        baseSize={174}
        minSize={86}
        maxLines={1}
        color={color}
        fontFamily={L44_FONT}
        fontWeight={800}
        align="center"
        lineHeight={1.08}
        style={{ letterSpacing: '0.02em', width: '100%', fontVariantNumeric: 'tabular-nums' }}
      />
    </div>
  );

  const renderDescription = (color: string) => (
    <div
      style={{
        position: 'absolute',
        left: SAFE_X_P + 40,
        top: 1094,
        width: SAFE_W_P - 80,
        height: 204,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: descTr.visible ? 1 : 0,
        transform: toTransformCssP(descTr),
      }}
    >
      <FitText
        text={metric.label}
        baseSize={42}
        minSize={26}
        maxLines={3}
        color={color}
        fontFamily={L44_FONT}
        fontWeight={800}
        align="center"
        lineHeight={1.28}
        style={{ width: '100%' }}
      />
    </div>
  );

  const pinkSvg = (
    <g>
      {headerTr.visible && (
        <rect
          x={SAFE_X_P}
          y={SAFE_TOP_P}
          width={320}
          height={44}
          fill={`url(#${ids.pinkHalftoneMid})`}
          stroke={L44_COLORS.pink}
          strokeWidth={4}
          transform={toSvgTransformP(headerTr, SAFE_X_P + 160, SAFE_TOP_P + 22)}
        />
      )}
      <Look44RegCross cx={STAGE_W - SAFE_X_P - 24} cy={SAFE_TOP_P + 22} r={14} color={L44_COLORS.pink} />

      {/* Left halftone orb behind giant number */}
      {pinkOrbTr.visible && (
        <g transform={toSvgTransformP(pinkOrbTr, 370, 588)}>
          <circle cx={370} cy={588} r={224} fill={`url(#${ids.pinkHalftoneLight})`} />
          <circle cx={370} cy={588} r={182} fill="none" stroke={L44_COLORS.pink} strokeWidth={8} />
        </g>
      )}

      {/* Unit knockout pill — Pink half */}
      {metric.unit && unitTr.visible && (
        <rect
          x={340}
          y={714}
          width={400}
          height={64}
          fill={L44_COLORS.pink}
          transform={toSvgTransformP(unitTr, 540, 746)}
        />
      )}

      {/* Halftone Dot Progress Meter — Pink plate */}
      {Array.from({ length: dotCount }, (_, i) => {
        const cx = SAFE_X_P + 36 + (i * (SAFE_W_P - 72)) / (dotCount - 1);
        const cy = 928;
        const r = 12 + (i / (dotCount - 1)) * 12;
        const dTr = stampMotionP(t, meterDelay + Math.floor(i / 2) * 2, -2.0, 1.14);
        if (!dTr.visible) return null;
        const active = i < filledDots;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy - 3}
            r={r}
            fill={active ? L44_COLORS.pink : 'none'}
            stroke={L44_COLORS.pink}
            strokeWidth={3.5}
            transform={toSvgTransformP(dTr, cx, cy - 3)}
          />
        );
      })}

      {/* Description Frame — Pink creeping stripe header + border */}
      {descTr.visible && (
        <g transform={toSvgTransformP(descTr, STAGE_W / 2, 1185)}>
          <rect
            x={SAFE_X_P}
            y={1030}
            width={SAFE_W_P}
            height={36}
            fill={`url(#${ids.pinkStripe})`}
          />
          <rect
            x={SAFE_X_P}
            y={1066}
            width={SAFE_W_P}
            height={264}
            fill={`url(#${ids.pinkHalftoneLight})`}
            stroke={L44_COLORS.pink}
            strokeWidth={5}
          />
        </g>
      )}

      {/* Delta stamp badge (bottom-right of description card) */}
      {metric.delta && deltaTr.visible && (
        <rect
          x={STAGE_W - SAFE_X_P - 340}
          y={1310}
          width={324}
          height={58}
          fill={L44_COLORS.pink}
          transform={toSvgTransformP(deltaTr, STAGE_W - SAFE_X_P - 178, 1339)}
        />
      )}

      <rect x={SAFE_X_P} y={1394} width={SAFE_W_P} height={4} fill={L44_COLORS.pink} />
    </g>
  );

  const blueSvg = (
    <g>
      <Look44RegCross cx={STAGE_W - SAFE_X_P - 24} cy={SAFE_TOP_P + 22} r={14} color={L44_COLORS.blue} />

      {/* Right halftone orb behind giant number (overlaps pink orb in center) */}
      {blueOrbTr.visible && (
        <g transform={toSvgTransformP(blueOrbTr, 710, 608)}>
          <circle cx={710} cy={608} r={224} fill={`url(#${ids.blueHalftoneLight})`} />
          <circle
            cx={710}
            cy={608}
            r={186}
            fill="none"
            stroke={L44_COLORS.blue}
            strokeWidth={7}
            strokeDasharray="18 12"
          />
        </g>
      )}

      {/* Unit knockout pill — Blue half (multiplies with Pink into deep violet) */}
      {metric.unit && unitTr.visible && (
        <rect
          x={340}
          y={714}
          width={400}
          height={64}
          fill={L44_COLORS.blue}
          transform={toSvgTransformP(unitTr, 540, 746)}
        />
      )}

      {/* Halftone Dot Progress Meter — Blue plate */}
      {Array.from({ length: dotCount }, (_, i) => {
        const cx = SAFE_X_P + 36 + (i * (SAFE_W_P - 72)) / (dotCount - 1);
        const cy = 928;
        const r = 12 + (i / (dotCount - 1)) * 12;
        const dTr = stampMotionP(t, meterDelay + 2 + Math.floor(i / 2) * 2, 2.0, 1.14);
        if (!dTr.visible) return null;
        const active = i < filledDots;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy + 3}
            r={r}
            fill={active ? L44_COLORS.blue : 'none'}
            stroke={L44_COLORS.blue}
            strokeWidth={3.5}
            transform={toSvgTransformP(dTr, cx, cy + 3)}
          />
        );
      })}

      {/* Description Frame — Blue creeping stripe header + border */}
      {descTr.visible && (
        <g transform={toSvgTransformP(descTr, STAGE_W / 2, 1185)}>
          <rect
            x={SAFE_X_P}
            y={1030}
            width={SAFE_W_P}
            height={36}
            fill={`url(#${ids.blueStripe})`}
          />
          <rect
            x={SAFE_X_P}
            y={1066}
            width={SAFE_W_P}
            height={264}
            fill="none"
            stroke={L44_COLORS.blue}
            strokeWidth={5}
          />
        </g>
      )}

      {/* Delta stamp badge — Blue plate overprints Pink into violet */}
      {metric.delta && deltaTr.visible && (
        <rect
          x={STAGE_W - SAFE_X_P - 340}
          y={1310}
          width={324}
          height={58}
          fill={L44_COLORS.blue}
          transform={toSvgTransformP(deltaTr, STAGE_W - SAFE_X_P - 178, 1339)}
        />
      )}

      <rect x={SAFE_X_P} y={1394} width={SAFE_W_P} height={4} fill={L44_COLORS.blue} />
    </g>
  );

  const pinkHtml = (
    <>
      {headerTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: SAFE_X_P + 14,
            top: SAFE_TOP_P + 2,
            width: 292,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            transform: toTransformCssP(headerTr),
          }}
        >
          <FitText
            text={badge}
            baseSize={22}
            minSize={17}
            maxLines={1}
            color={L44_COLORS.pink}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="left"
            lineHeight={1.2}
            style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}
          />
        </div>
      )}
      {renderHeaderTitle(L44_COLORS.pink)}
      {renderGiantStat(L44_COLORS.pink)}
      {renderDescription(L44_COLORS.pink)}
    </>
  );

  const blueHtml = (
    <>
      {headerTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: SAFE_X_P + 14,
            top: SAFE_TOP_P + 2,
            width: 292,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            transform: toTransformCssP(headerTr),
          }}
        >
          <FitText
            text={badge}
            baseSize={22}
            minSize={17}
            maxLines={1}
            color={L44_COLORS.blue}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="left"
            lineHeight={1.2}
            style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}
          />
        </div>
      )}
      {renderHeaderTitle(L44_COLORS.blue)}
      {renderGiantStat(L44_COLORS.blue)}
      {renderDescription(L44_COLORS.blue)}
    </>
  );

  const knockoutHtml = (
    <>
      {metric.unit && unitTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: 356,
            top: 720,
            width: 368,
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: toTransformCssP(unitTr),
          }}
        >
          <FitText
            text={metric.unit}
            baseSize={34}
            minSize={22}
            maxLines={1}
            color={L44_COLORS.paper}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="center"
            lineHeight={1.2}
            style={{ letterSpacing: '0.04em' }}
          />
        </div>
      )}

      {metric.delta && deltaTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: STAGE_W - SAFE_X_P - 332,
            top: 1316,
            width: 308,
            height: 46,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: toTransformCssP(deltaTr),
          }}
        >
          <FitText
            text={metric.delta}
            baseSize={26}
            minSize={18}
            maxLines={1}
            color={L44_COLORS.paper}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="center"
            lineHeight={1.2}
          />
        </div>
      )}
    </>
  );

  return (
    <Look44RisoStage
      uid={uid}
      sceneIndex={sceneIndex}
      drawIndex={drawIndex}
      offsets={offsets}
      pinkSvg={pinkSvg}
      blueSvg={blueSvg}
      pinkHtml={pinkHtml}
      blueHtml={blueHtml}
      knockoutHtml={knockoutHtml}
    />
  );
};

// ============================================================================
// SHOT 4: 'riso-split-compare' — Two sides (Pink vs Blue) overlapping center
//         OR bold two-ink Quote / Manifesto print
// ============================================================================

const Look44RisoSplitCompare: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
}) => {
  const { drawIndex, t } = onTwosP(localFrame);
  const offsets = computePlateOffsetsP(t, drawIndex, durationFrames, sceneIndex);
  const uid = `cmp-${sceneIndex}`;
  const ids = makeStageIdsP(uid);

  const txt = sceneTexts(scene);
  const isQuoteMode = Boolean(scene.quote?.text) && !scene.compare;

  // --------------------------------------------------------------------------
  // MODE B: QUOTE / MANIFESTO POSTER
  // --------------------------------------------------------------------------
  if (isQuoteMode) {
    const quoteText = String(scene.quote?.text || txt.title || 'งานพิมพ์สองหมึกที่มีชีวิต').trim();
    const author = String(scene.quote?.author || scene.quote?.source || txt.subtitle || 'RISO PRESS').trim();
    const role = String(scene.quote?.role || '').trim();
    const badge = txt.badge || `QUOTE EDITION · 0${(sceneIndex % 9) + 1}`;

    const headerTr = stampMotionP(t, 0, -2.0, 1.11);
    const pinkOrbTr = stampMotionP(t, 4, -3.0, 1.15);
    const blueOrbTr = slideOvershootP(t, 8, 420, 0, 0.1);
    const frameTr = stampMotionP(t, 12, -2.2, 1.12);
    const authorBandTr = slideOvershootP(t, 18, -520, 0, 0.11);

    const renderQuoteText = (color: string) => (
      <div
        style={{
          position: 'absolute',
          left: SAFE_X_P + 58,
          top: 420,
          width: SAFE_W_P - 116,
          height: 510,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: frameTr.visible ? 1 : 0,
          transform: toTransformCssP(frameTr),
        }}
      >
        <FitText
          text={quoteText}
          baseSize={56}
          minSize={32}
          maxLines={5}
          color={color}
          fontFamily={L44_FONT}
          fontWeight={800}
          align="center"
          lineHeight={1.3}
          style={{ width: '100%' }}
        />
      </div>
    );

    const pinkSvg = (
      <g>
        {headerTr.visible && (
          <rect
            x={SAFE_X_P}
            y={SAFE_TOP_P}
            width={340}
            height={46}
            fill={L44_COLORS.pink}
            transform={toSvgTransformP(headerTr, SAFE_X_P + 170, SAFE_TOP_P + 23)}
          />
        )}
        <Look44RegCross cx={STAGE_W - SAFE_X_P - 24} cy={SAFE_TOP_P + 23} r={14} color={L44_COLORS.pink} />

        {/* Overlapping Pink Halftone Circle behind quote */}
        {pinkOrbTr.visible && (
          <circle
            cx={340}
            cy={660}
            r={275}
            fill={`url(#${ids.pinkHalftoneMid})`}
            transform={toSvgTransformP(pinkOrbTr, 340, 660)}
          />
        )}

        {/* Quote Poster Frame — Pink border + giant open quote mark */}
        {frameTr.visible && (
          <g transform={toSvgTransformP(frameTr, STAGE_W / 2, 675)}>
            <rect
              x={SAFE_X_P + 18}
              y={346}
              width={SAFE_W_P - 36}
              height={648}
              fill="none"
              stroke={L44_COLORS.pink}
              strokeWidth={8}
            />
            <text
              x={SAFE_X_P + 50}
              y={446}
              fill={L44_COLORS.pink}
              fontFamily={L44_FONT}
              fontWeight={800}
              fontSize={132}
            >
              “
            </text>
            <text
              x={STAGE_W - SAFE_X_P - 122}
              y={986}
              fill={L44_COLORS.pink}
              fontFamily={L44_FONT}
              fontWeight={800}
              fontSize={132}
            >
              ”
            </text>
          </g>
        )}

        {/* Attribution Diagonal Stripe Band — Pink */}
        {authorBandTr.visible && (
          <g transform={toSvgTransformP(authorBandTr, STAGE_W / 2, 1144)}>
            <rect
              x={SAFE_X_P}
              y={1070}
              width={SAFE_W_P}
              height={148}
              fill={`url(#${ids.pinkStripe})`}
            />
            <rect
              x={SAFE_X_P + 64}
              y={1094}
              width={SAFE_W_P - 128}
              height={100}
              fill={L44_COLORS.pink}
            />
          </g>
        )}

        <Look44DotRampPlate
          x={SAFE_X_P + 22}
          y={1314}
          width={SAFE_W_P - 44}
          count={12}
          plate="pink"
          t={t}
          baseDelay={22}
          maxRadius={24}
        />
        <rect x={SAFE_X_P} y={1390} width={SAFE_W_P} height={4} fill={L44_COLORS.pink} />
      </g>
    );

    const blueSvg = (
      <g>
        {headerTr.visible && (
          <rect
            x={SAFE_X_P}
            y={SAFE_TOP_P}
            width={340}
            height={46}
            fill={L44_COLORS.blue}
            transform={toSvgTransformP(headerTr, SAFE_X_P + 170, SAFE_TOP_P + 23)}
          />
        )}
        <Look44RegCross cx={STAGE_W - SAFE_X_P - 24} cy={SAFE_TOP_P + 23} r={14} color={L44_COLORS.blue} />

        {/* Overlapping Blue Halftone Circle */}
        {blueOrbTr.visible && (
          <circle
            cx={740}
            cy={690}
            r={275}
            fill={`url(#${ids.blueHalftoneMid})`}
            transform={toSvgTransformP(blueOrbTr, 740, 690)}
          />
        )}

        {/* Quote Poster Frame — Blue border + quote marks */}
        {frameTr.visible && (
          <g transform={toSvgTransformP(frameTr, STAGE_W / 2, 675)}>
            <rect
              x={SAFE_X_P + 18}
              y={346}
              width={SAFE_W_P - 36}
              height={648}
              fill="none"
              stroke={L44_COLORS.blue}
              strokeWidth={8}
            />
            <text
              x={SAFE_X_P + 50}
              y={446}
              fill={L44_COLORS.blue}
              fontFamily={L44_FONT}
              fontWeight={800}
              fontSize={132}
            >
              “
            </text>
            <text
              x={STAGE_W - SAFE_X_P - 122}
              y={986}
              fill={L44_COLORS.blue}
              fontFamily={L44_FONT}
              fontWeight={800}
              fontSize={132}
            >
              ”
            </text>
          </g>
        )}

        {/* Attribution Diagonal Stripe Band — Blue */}
        {authorBandTr.visible && (
          <g transform={toSvgTransformP(authorBandTr, STAGE_W / 2, 1144)}>
            <rect
              x={SAFE_X_P}
              y={1070}
              width={SAFE_W_P}
              height={148}
              fill={`url(#${ids.blueStripe})`}
            />
            <rect
              x={SAFE_X_P + 64}
              y={1094}
              width={SAFE_W_P - 128}
              height={100}
              fill={L44_COLORS.blue}
            />
          </g>
        )}

        <Look44DotRampPlate
          x={SAFE_X_P + 22}
          y={1314}
          width={SAFE_W_P - 44}
          count={12}
          plate="blue"
          t={t}
          baseDelay={24}
          maxRadius={24}
        />
        <rect x={SAFE_X_P} y={1390} width={SAFE_W_P} height={4} fill={L44_COLORS.blue} />
      </g>
    );

    const knockoutHtml = (
      <>
        {headerTr.visible && (
          <div
            style={{
              position: 'absolute',
              left: SAFE_X_P + 12,
              top: SAFE_TOP_P + 2,
              width: 316,
              height: 42,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: toTransformCssP(headerTr),
            }}
          >
            <FitText
              text={badge}
              baseSize={22}
              minSize={17}
              maxLines={1}
              color={L44_COLORS.paper}
              fontFamily={L44_FONT}
              fontWeight={800}
              align="center"
              lineHeight={1.2}
              style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}
            />
          </div>
        )}

        {/* Clean #EDEFEE knocked-out paper window inside quote frame so text stays razor sharp */}
        {frameTr.visible && (
          <div
            style={{
              position: 'absolute',
              left: SAFE_X_P + 40,
              top: 416,
              width: SAFE_W_P - 80,
              height: 516,
              backgroundColor: L44_COLORS.paper,
              opacity: 0.92,
              transform: toTransformCssP(frameTr),
              zIndex: 0,
            }}
          />
        )}

        {/* Overprinted quote text rendered inside a local isolated multiply stack above the paper cutout */}
        {frameTr.visible && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              isolation: 'isolate',
              zIndex: 1,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                mixBlendMode: 'multiply',
                transform: `translate3d(${offsets.pinkX.toFixed(2)}px, ${offsets.pinkY.toFixed(2)}px, 0)`,
              }}
            >
              {renderQuoteText(L44_COLORS.pink)}
            </div>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                mixBlendMode: 'multiply',
                transform: `translate3d(${offsets.blueX.toFixed(2)}px, ${offsets.blueY.toFixed(2)}px, 0)`,
              }}
            >
              {renderQuoteText(L44_COLORS.blue)}
            </div>
          </div>
        )}

        {/* Author knocked out on violet attribution bar */}
        {authorBandTr.visible && (
          <div
            style={{
              position: 'absolute',
              left: SAFE_X_P + 84,
              top: 1100,
              width: SAFE_W_P - 168,
              height: 88,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              transform: toTransformCssP(authorBandTr),
              zIndex: 2,
            }}
          >
            <FitText
              text={`— ${author}${role ? ` · ${role}` : ''}`}
              baseSize={34}
              minSize={22}
              maxLines={2}
              color={L44_COLORS.paper}
              fontFamily={L44_FONT}
              fontWeight={800}
              align="center"
              lineHeight={1.24}
              style={{ width: '100%' }}
            />
          </div>
        )}
      </>
    );

    return (
      <Look44RisoStage
        uid={uid}
        sceneIndex={sceneIndex}
        drawIndex={drawIndex}
        offsets={offsets}
        pinkSvg={pinkSvg}
        blueSvg={blueSvg}
        knockoutHtml={knockoutHtml}
      />
    );
  }

  // --------------------------------------------------------------------------
  // MODE A: SPLIT COMPARE — Pink Plate (Left) vs Blue Plate (Right),
  // overlapping at center into deep violet (~#32186F)
  // --------------------------------------------------------------------------
  const fallbackPts = extractPointsP(scene, 4);
  const leftTitle = String(scene.compare?.leftTitle || scene.compare?.leftLabel || 'ฝั่งซ้าย').trim();
  const rightTitle = String(scene.compare?.rightTitle || scene.compare?.rightLabel || 'ฝั่งขวา').trim();
  const leftItems = (
    scene.compare?.leftItems?.length
      ? scene.compare.leftItems
      : fallbackPts.slice(0, Math.max(1, Math.ceil(fallbackPts.length / 2)))
  )
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  const rightItems = (
    scene.compare?.rightItems?.length
      ? scene.compare.rightItems
      : fallbackPts.slice(Math.ceil(fallbackPts.length / 2))
  )
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 3);

  const winner = scene.compare?.winner;
  const mainTitle = txt.title || `${leftTitle} vs ${rightTitle}`;
  const kicker = txt.badge || `SPLIT PRINT · 0${(sceneIndex % 9) + 1}`;

  const headerTr = stampMotionP(t, 0, -2.0, 1.12);
  const leftPanelTr = slideOvershootP(t, 6, -520, 0, 0.1);
  const rightPanelTr = slideOvershootP(t, 12, 520, 0, 0.1);
  const vsTr = stampMotionP(t, 16, -3.5, 1.16);
  const winnerTr = stampMotionP(t, 22, winner === 'left' ? -3.0 : 3.0, 1.15);

  // Panels intentionally overlap 36px at the center (x = 522..558) -> multiplies into deep violet seam!
  const panelTop = 340;
  const panelH = 858;
  const leftX = SAFE_X_P; // 54
  const panelW = 504; // 54 + 504 = 558
  const rightX = STAGE_W - SAFE_X_P - panelW; // 522

  const renderMainTitle = (color: string) => (
    <div
      style={{
        position: 'absolute',
        left: SAFE_X_P,
        top: 170,
        width: SAFE_W_P,
        height: 142,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: headerTr.visible ? 1 : 0,
        transform: toTransformCssP(headerTr),
      }}
    >
      <FitText
        text={mainTitle}
        baseSize={56}
        minSize={34}
        maxLines={2}
        color={color}
        fontFamily={L44_FONT}
        fontWeight={800}
        align="center"
        lineHeight={1.2}
        style={{ width: '100%' }}
      />
    </div>
  );

  // Both side item lists are overprinted in Pink+Blue (violet) for >10:1 readability on halftone panels
  const renderCompareItems = (color: string) => (
    <>
      {/* Left items (inside Pink panel, staying clear of central overlap seam) */}
      {leftPanelTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: leftX + 26,
            top: panelTop + 148,
            width: panelW - 78,
            height: panelH - 180,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-around',
            gap: 18,
            transform: toTransformCssP(leftPanelTr),
          }}
        >
          {leftItems.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <span
                style={{
                  fontFamily: L44_FONT,
                  fontSize: 28,
                  fontWeight: 800,
                  color,
                  lineHeight: 1.25,
                  flexShrink: 0,
                }}
              >
                •
              </span>
              <FitText
                text={item}
                baseSize={32}
                minSize={21}
                maxLines={3}
                color={color}
                fontFamily={L44_FONT}
                fontWeight={800}
                align="left"
                lineHeight={1.28}
                style={{ flex: 1 }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Right items (inside Blue panel, staying clear of central overlap seam) */}
      {rightPanelTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: rightX + 52,
            top: panelTop + 148,
            width: panelW - 78,
            height: panelH - 180,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-around',
            gap: 18,
            transform: toTransformCssP(rightPanelTr),
          }}
        >
          {rightItems.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <span
                style={{
                  fontFamily: L44_FONT,
                  fontSize: 28,
                  fontWeight: 800,
                  color,
                  lineHeight: 1.25,
                  flexShrink: 0,
                }}
              >
                •
              </span>
              <FitText
                text={item}
                baseSize={32}
                minSize={21}
                maxLines={3}
                color={color}
                fontFamily={L44_FONT}
                fontWeight={800}
                align="left"
                lineHeight={1.28}
                style={{ flex: 1 }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );

  const pinkSvg = (
    <g>
      {headerTr.visible && (
        <rect
          x={SAFE_X_P}
          y={SAFE_TOP_P}
          width={310}
          height={44}
          fill={L44_COLORS.pink}
          transform={toSvgTransformP(headerTr, SAFE_X_P + 155, SAFE_TOP_P + 22)}
        />
      )}
      <Look44RegCross cx={STAGE_W - SAFE_X_P - 24} cy={SAFE_TOP_P + 22} r={14} color={L44_COLORS.pink} />

      {/* Left Pink Panel — light 15° halftone body + solid Pink header + ragged border */}
      {leftPanelTr.visible && (
        <g transform={toSvgTransformP(leftPanelTr, leftX + panelW / 2, panelTop + panelH / 2)}>
          <rect
            x={leftX}
            y={panelTop}
            width={panelW}
            height={panelH}
            fill={`url(#${ids.pinkHalftoneLight})`}
          />
          <rect
            x={leftX}
            y={panelTop}
            width={panelW}
            height={116}
            fill={L44_COLORS.pink}
          />
          <rect
            x={leftX}
            y={panelTop}
            width={panelW}
            height={panelH}
            fill="none"
            stroke={L44_COLORS.pink}
            strokeWidth={7}
          />
        </g>
      )}

      {/* Center Venn VS Circle — Pink Left Circle */}
      {vsTr.visible && (
        <circle
          cx={512}
          cy={panelTop + 58}
          r={52}
          fill={L44_COLORS.pink}
          transform={toSvgTransformP(vsTr, 540, panelTop + 58)}
        />
      )}

      {/* Optional Winner Stamp — Pink half */}
      {winner && winnerTr.visible && (
        <rect
          x={winner === 'left' ? leftX + 34 : rightX + 64}
          y={panelTop + panelH - 76}
          width={240}
          height={54}
          fill={L44_COLORS.pink}
          transform={toSvgTransformP(
            winnerTr,
            (winner === 'left' ? leftX + 34 : rightX + 64) + 120,
            panelTop + panelH - 49,
          )}
        />
      )}

      {/* Bottom Creeping Stripes + Halftone Dot Ramp */}
      <rect x={SAFE_X_P} y={1228} width={SAFE_W_P} height={24} fill={`url(#${ids.pinkStripe})`} />
      <Look44DotRampPlate
        x={SAFE_X_P + 22}
        y={1318}
        width={SAFE_W_P - 44}
        count={12}
        plate="pink"
        t={t}
        baseDelay={18}
        maxRadius={24}
      />
      <rect x={SAFE_X_P} y={1390} width={SAFE_W_P} height={4} fill={L44_COLORS.pink} />
    </g>
  );

  const blueSvg = (
    <g>
      {headerTr.visible && (
        <rect
          x={SAFE_X_P}
          y={SAFE_TOP_P}
          width={310}
          height={44}
          fill={L44_COLORS.blue}
          transform={toSvgTransformP(headerTr, SAFE_X_P + 155, SAFE_TOP_P + 22)}
        />
      )}
      <Look44RegCross cx={STAGE_W - SAFE_X_P - 24} cy={SAFE_TOP_P + 22} r={14} color={L44_COLORS.blue} />

      {/* Right Blue Panel — light 75° halftone body + solid Blue header + ragged border */}
      {rightPanelTr.visible && (
        <g transform={toSvgTransformP(rightPanelTr, rightX + panelW / 2, panelTop + panelH / 2)}>
          <rect
            x={rightX}
            y={panelTop}
            width={panelW}
            height={panelH}
            fill={`url(#${ids.blueHalftoneLight})`}
          />
          <rect
            x={rightX}
            y={panelTop}
            width={panelW}
            height={116}
            fill={L44_COLORS.blue}
          />
          <rect
            x={rightX}
            y={panelTop}
            width={panelW}
            height={panelH}
            fill="none"
            stroke={L44_COLORS.blue}
            strokeWidth={7}
          />
        </g>
      )}

      {/* Center Venn VS Circle — Blue Right Circle (multiplies with Pink circle into violet core) */}
      {vsTr.visible && (
        <circle
          cx={568}
          cy={panelTop + 58}
          r={52}
          fill={L44_COLORS.blue}
          transform={toSvgTransformP(vsTr, 540, panelTop + 58)}
        />
      )}

      {/* Optional Winner Stamp — Blue half (multiplies into violet) */}
      {winner && winnerTr.visible && (
        <rect
          x={winner === 'left' ? leftX + 34 : rightX + 64}
          y={panelTop + panelH - 76}
          width={240}
          height={54}
          fill={L44_COLORS.blue}
          transform={toSvgTransformP(
            winnerTr,
            (winner === 'left' ? leftX + 34 : rightX + 64) + 120,
            panelTop + panelH - 49,
          )}
        />
      )}

      <rect x={SAFE_X_P} y={1228} width={SAFE_W_P} height={24} fill={`url(#${ids.blueStripe})`} />
      <Look44DotRampPlate
        x={SAFE_X_P + 22}
        y={1318}
        width={SAFE_W_P - 44}
        count={12}
        plate="blue"
        t={t}
        baseDelay={20}
        maxRadius={24}
      />
      <rect x={SAFE_X_P} y={1390} width={SAFE_W_P} height={4} fill={L44_COLORS.blue} />
    </g>
  );

  const pinkHtml = (
    <>
      {renderMainTitle(L44_COLORS.pink)}
      {renderCompareItems(L44_COLORS.pink)}
    </>
  );

  const blueHtml = (
    <>
      {renderMainTitle(L44_COLORS.blue)}
      {renderCompareItems(L44_COLORS.blue)}
    </>
  );

  const knockoutHtml = (
    <>
      {headerTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: SAFE_X_P + 12,
            top: SAFE_TOP_P + 2,
            width: 286,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: toTransformCssP(headerTr),
          }}
        >
          <FitText
            text={kicker}
            baseSize={22}
            minSize={17}
            maxLines={1}
            color={L44_COLORS.paper}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="center"
            lineHeight={1.2}
            style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}
          />
        </div>
      )}

      {/* Left Pink Column Header knocked out to paper */}
      {leftPanelTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: leftX + 20,
            top: panelTop + 14,
            width: panelW - 96,
            height: 88,
            display: 'flex',
            alignItems: 'center',
            transform: `translate3d(${offsets.pinkX.toFixed(1)}px, ${offsets.pinkY.toFixed(1)}px, 0) ${toTransformCssP(leftPanelTr)}`,
          }}
        >
          <FitText
            text={leftTitle}
            baseSize={36}
            minSize={22}
            maxLines={2}
            color={L44_COLORS.paper}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="left"
            lineHeight={1.2}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {/* Right Blue Column Header knocked out to paper */}
      {rightPanelTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: rightX + 76,
            top: panelTop + 14,
            width: panelW - 96,
            height: 88,
            display: 'flex',
            alignItems: 'center',
            transform: `translate3d(${offsets.blueX.toFixed(1)}px, ${offsets.blueY.toFixed(1)}px, 0) ${toTransformCssP(rightPanelTr)}`,
          }}
        >
          <FitText
            text={rightTitle}
            baseSize={36}
            minSize={22}
            maxLines={2}
            color={L44_COLORS.paper}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="right"
            lineHeight={1.2}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {/* Central VS knocked out of the multiplied violet Venn core */}
      {vsTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: 492,
            top: panelTop + 26,
            width: 96,
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: toTransformCssP(vsTr),
          }}
        >
          <FitText
            text="VS"
            baseSize={36}
            minSize={28}
            maxLines={1}
            color={L44_COLORS.paper}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="center"
            lineHeight={1.1}
            style={{ letterSpacing: '0.06em' }}
          />
        </div>
      )}

      {/* Optional Winner Label knocked out */}
      {winner && winnerTr.visible && (
        <div
          style={{
            position: 'absolute',
            left: (winner === 'left' ? leftX + 34 : rightX + 64) + 12,
            top: panelTop + panelH - 70,
            width: 216,
            height: 42,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: toTransformCssP(winnerTr),
          }}
        >
          <FitText
            text="★ เด่นกว่า"
            baseSize={26}
            minSize={20}
            maxLines={1}
            color={L44_COLORS.paper}
            fontFamily={L44_FONT}
            fontWeight={800}
            align="center"
            lineHeight={1.2}
          />
        </div>
      )}
    </>
  );

  return (
    <Look44RisoStage
      uid={uid}
      sceneIndex={sceneIndex}
      drawIndex={drawIndex}
      offsets={offsets}
      pinkSvg={pinkSvg}
      blueSvg={blueSvg}
      pinkHtml={pinkHtml}
      blueHtml={blueHtml}
      knockoutHtml={knockoutHtml}
    />
  );
};

// ============================================================================
// EXPORTED REGISTRY DEFINITIONS — BATCH_P (look-44)
// ============================================================================

export const BATCH_P: StyleDirectorDef[] = [
  {
    styleId: 'look-44',
    caption: 'floating',
    shots: {
      'riso-poster-title': Look44RisoPosterTitle,
      'riso-lineup-list': Look44RisoLineupList,
      'riso-big-stat': Look44RisoBigStat,
      'riso-split-compare': Look44RisoSplitCompare,
    },
    shotLabels: {
      'riso-poster-title':
        'โปสเตอร์ริโซสองหมึก (ชมพูสะท้อนแสงและน้ำเงิน) หัวข้อเต็มกว้าง วงกลมสองวงซ้อนเป็นม่วง แถบลายทแยงคืบช้า ๆ และแถวจุดฮาล์ฟโทนไล่ขนาดแบบ on-twos',
      'riso-lineup-list':
        'ป้ายรายการสองหมึกปั๊มและสไลด์ลงทีละแถวแบบสต็อปโมชัน on-twos พร้อมวงกลมเลขข้อเจาะทะลุกระดาษและเพลตเหลื่อม',
      'riso-big-stat':
        'ตัวเลขสถิติยักษ์พิมพ์ซ้อนสองหมึกนับขึ้นแบบ on-twos บนวงกลมฮาล์ฟโทนซ้อนกัน พร้อมแถบจุดฮาล์ฟโทนและกรอบคำอธิบายลายทแยง',
      'riso-split-compare':
        'โปสเตอร์แบ่งสองฝั่งชมพูกับน้ำเงินที่ซ้อนกันตรงกลางเป็นสีม่วงเข้ม หรือหน้าคำคมสองหมึกพร้อมแถบลายทแยงและเพลตดีดแยกกลางช็อต',
    },
    infer: (scene) => {
      if (scene.stat) {
        return 'riso-big-stat';
      }
      if (scene.compare || scene.quote?.text) {
        return 'riso-split-compare';
      }
      if (
        (Array.isArray(scene.bullets) && scene.bullets.length >= 3) ||
        (Array.isArray(scene.steps) && scene.steps.length >= 2)
      ) {
        return 'riso-lineup-list';
      }
      const text = haystackOfP(scene);
      if (L44_LIST_RE.test(text) && scene.bullets && scene.bullets.length >= 2) {
        return 'riso-lineup-list';
      }
      return null;
    },
  },
];
