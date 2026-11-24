import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import type { StudioScene } from '../types';
import {
  FitText,
  SAFE_BOTTOM,
  STAGE_H,
  STAGE_W,
  clamp01,
  easeOutCubic,
  sceneTexts,
} from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

// ============================================================================
// BATCH R — look-46: Pencil to Blueprint (ดินสอสู่พิมพ์เขียว)
// Pure, Deterministic, Inline SVG/CSS Only, Zero External Assets
// Safe stage bounds: x ∈ [54, 1026], y ∈ [112, CONTENT_BOTTOM (=1420)]
// Zero text in bottom 1/5 (y > 1420 reserved for captions)
// ============================================================================

const CONTENT_BOTTOM = SAFE_BOTTOM - 120; // 1420
const SAFE_X = 54;
const SAFE_TOP = 112;
const SAFE_W = STAGE_W - SAFE_X * 2; // 972

const FONT_L46 = `'Barlow Semi Condensed', ${THAI_FONT_FAMILY}, sans-serif`;

const L46 = {
  paper: '#ECECE6',
  grid: '#7FA3C4',
  pencil: '#25262B',
  pencilSoft: 'rgba(37, 38, 43, 0.42)',
  pencilHatch: 'rgba(37, 38, 43, 0.56)',
  blueprint: '#1C4C8F',
  tide: '#143C76',
  inkWhite: '#EEF4FB',
  inkWhiteSoft: 'rgba(238, 244, 251, 0.72)',
  inkWhiteFaint: 'rgba(238, 244, 251, 0.22)',
  inkWhiteGridMinor: 'rgba(238, 244, 251, 0.10)',
  inkWhiteGridMajor: 'rgba(238, 244, 251, 0.20)',
} as const;

// ============================================================================
// DETERMINISTIC PRNG & EASING HELPERS (ZERO Math.random / Date)
// ============================================================================

function mulberry32R(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededHashR(seed: number): number {
  const rng = mulberry32R(Math.floor(seed * 9973) + 46091);
  return rng();
}

/** Human-hand pencil stroke easing: gentle contact, confident glide, natural deceleration */
function l46HandEase(t: number): number {
  const x = clamp01(t);
  if (x < 0.32) {
    const u = x / 0.32;
    return 0.24 * u * u;
  }
  const u = (x - 0.32) / 0.68;
  return 0.24 + 0.76 * (1 - Math.pow(1 - u, 2.5));
}

/** Ink flood easing: fast initial spread out of drawing, then slowing as paper saturates */
function l46FloodEase(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3.15);
}

function l46Progress(frame: number, start: number, dur: number): number {
  if (dur <= 0) return frame >= start ? 1 : 0;
  return clamp01((frame - start) / dur);
}

function haystackOfR(scene: StudioScene): string {
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

function extractPointsR(scene: StudioScene, max = 4): string[] {
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
  } else if (t.subtitle) {
    out.push(t.subtitle);
  }
  if (out.length === 0 && t.title) out.push(t.title);
  return out.slice(0, max);
}

function parseNumericR(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw || '').replace(/,/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const val = parseFloat(m[0]);
  return Number.isFinite(val) ? val : fallback;
}

function formatTickNumberR(raw: string, numeric: number, frac: number): string {
  const clamped = clamp01(frac);
  if (clamped >= 0.999) return raw;
  const current = numeric * clamped;
  const hasDecimal = /\.\d+/.test(raw);
  const decimals = hasDecimal ? (raw.split('.')[1]?.replace(/\D/g, '').length || 1) : 0;
  const formatted =
    decimals > 0
      ? current.toFixed(Math.min(2, decimals))
      : Math.round(current).toLocaleString('en-US');
  const m = raw.match(/^(.*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return formatted;
  return `${m[1]}${formatted}${m[3]}`;
}

function extractPrimaryStatR(scene: StudioScene): {
  display: string;
  unit: string;
  numeric: number;
  label: string;
  delta: string;
} {
  const t = sceneTexts(scene);
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const rawVal = String(scene.stat.value).trim();
    const prefix = String(scene.stat.prefix || '').trim();
    const suffix = String(scene.stat.suffix || '').trim();
    const effPrefix = prefix && !rawVal.startsWith(prefix) ? prefix : '';
    const effSuffix = suffix && !rawVal.endsWith(suffix) ? suffix : '';
    const display = `${effPrefix}${rawVal}${effSuffix}`.trim();
    const numeric = scene.stat.numericValue ?? parseNumericR(rawVal, 100);
    return {
      display,
      unit: String(scene.stat.unit || '').trim(),
      numeric,
      label: String(scene.stat.label || t.subtitle || t.title).trim(),
      delta: String(scene.stat.delta || '').trim(),
    };
  }
  if (t.numbers.length > 0) {
    const first = t.numbers[0];
    return {
      display: first,
      unit: '',
      numeric: parseNumericR(first, 100),
      label: t.subtitle || t.title,
      delta: '',
    };
  }
  return {
    display: '100%',
    unit: '',
    numeric: 100,
    label: t.subtitle || t.title || 'PRECISION SPEC',
    delta: '',
  };
}

// ============================================================================
// HAND-DRAWN PENCIL GEOMETRY GENERATORS (DETERMINISTIC)
// ============================================================================

interface L46StrokeSpec {
  d: string;
  len: number;
}

interface L46CircleSpec {
  cx: number;
  cy: number;
  r: number;
  arcStartDeg: number;
  arcEndDeg: number;
  arcLabel: string;
}

interface L46ObjectDef {
  id: 'flask' | 'chair' | 'rocket' | 'enclosure';
  code: string;
  widthLabel: string;
  widthNum: number;
  widthUnit: string;
  heightLabel: string;
  heightNum: number;
  heightUnit: string;
  detailLabel: string;
  detailNum: number;
  detailUnit: string;
  bbox: { left: number; right: number; top: number; bottom: number };
  datum: { cx: number; cy: number };
  constructionLines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  /** Exact straight/curved blueprint silhouette segments (used to derive doubled wobbly pencil + crisp blueprint) */
  outlineSegments: Array<
    | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
    | { kind: 'cubic'; x1: number; y1: number; cx1: number; cy1: number; cx2: number; cy2: number; x2: number; y2: number }
  >;
  blueprintInner: Array<
    | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; dashed?: boolean }
    | { kind: 'circle'; cx: number; cy: number; r: number; dashed?: boolean }
  >;
  jointCircles: L46CircleSpec[];
  hatchLines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  /** 4 exact points on the object for numbered process callouts (TL, TR, BL, BR) */
  calloutAnchors: Array<{ x: number; y: number }>;
  detailCallout: { ax: number; ay: number; lx: number; ly: number };
}

function l46SegmentLen(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Build a slightly wobbly hand-sketched line with overshooting ends */
function l46WobbleLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  amp = 2.3,
  overshoot = 10,
): L46StrokeSpec {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const nx = -uy;
  const ny = ux;

  const rng = mulberry32R(seed);
  const ovA = overshoot * (0.65 + rng() * 0.7);
  const ovB = overshoot * (0.65 + rng() * 0.7);
  const sx = x1 - ux * ovA;
  const sy = y1 - uy * ovA;
  const ex = x2 + ux * ovB;
  const ey = y2 + uy * ovB;

  const w1 = (rng() - 0.5) * 2 * amp;
  const w2 = (rng() - 0.5) * 2 * amp;
  const c1x = sx + (ex - sx) * 0.33 + nx * w1;
  const c1y = sy + (ey - sy) * 0.33 + ny * w1;
  const c2x = sx + (ex - sx) * 0.67 + nx * w2;
  const c2y = sy + (ey - sy) * 0.67 + ny * w2;

  return {
    d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`,
    len: dist + ovA + ovB + Math.abs(w1) + Math.abs(w2) + 8,
  };
}

/** Build a slightly wobbly hand-sketched cubic curve with slight tangent overshoots */
function l46WobbleCubic(
  x1: number,
  y1: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x2: number,
  y2: number,
  seed: number,
  amp = 2.6,
  overshoot = 7,
): L46StrokeSpec {
  const rng = mulberry32R(seed);
  const t1x = cx1 - x1;
  const t1y = cy1 - y1;
  const l1 = Math.hypot(t1x, t1y) || 1;
  const t2x = x2 - cx2;
  const t2y = y2 - cy2;
  const l2 = Math.hypot(t2x, t2y) || 1;

  const sx = x1 - (t1x / l1) * overshoot;
  const sy = y1 - (t1y / l1) * overshoot;
  const ex = x2 + (t2x / l2) * overshoot;
  const ey = y2 + (t2y / l2) * overshoot;

  const j1x = cx1 + (rng() - 0.5) * 2 * amp;
  const j1y = cy1 + (rng() - 0.5) * 2 * amp;
  const j2x = cx2 + (rng() - 0.5) * 2 * amp;
  const j2y = cy2 + (rng() - 0.5) * 2 * amp;

  const approxLen =
    l46SegmentLen(sx, sy, j1x, j1y) +
    l46SegmentLen(j1x, j1y, j2x, j2y) +
    l46SegmentLen(j2x, j2y, ex, ey);

  return {
    d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${j1x.toFixed(1)} ${j1y.toFixed(1)}, ${j2x.toFixed(1)} ${j2y.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`,
    len: approxLen + 10,
  };
}

/** Hand-drawn slightly overlapping (415 deg) construction joint circle */
function l46WobbleCircle(cx: number, cy: number, r: number, seed: number): L46StrokeSpec {
  const rng = mulberry32R(seed);
  const startAngle = rng() * Math.PI * 2;
  const totalAngle = Math.PI * 2.28; // natural hand overshoot
  const steps = 28;
  const ph1 = rng() * Math.PI * 2;
  const ph2 = rng() * Math.PI * 2;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + (i / steps) * totalAngle;
    const wobble = 1 + 0.045 * Math.sin(2 * a + ph1) + 0.025 * Math.cos(3 * a + ph2);
    const rr = r * wobble;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    d += i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return { d, len: totalAngle * r * 1.12 + 8 };
}

/** Crisp blueprint angular/radius arc replacing a pencil joint circle */
function l46BlueprintArcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const a1 = (startDeg * Math.PI) / 180;
  const a2 = (endDeg * Math.PI) / 180;
  const x1 = cx + Math.cos(a1) * r;
  const y1 = cy + Math.sin(a1) * r;
  const x2 = cx + Math.cos(a2) * r;
  const y2 = cy + Math.sin(a2) * r;
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg >= startDeg ? 1 : 0;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${largeArc} ${sweep} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

// ============================================================================
// 4 SIDE-VIEW INDUSTRIAL OBJECT DEFINITIONS (SINGLE DRAWING: PENCIL -> BLUEPRINT)
// Canonical coords: base resting strictly on y = 0, centered around x = 0
// ============================================================================

const L46_OBJECTS: readonly L46ObjectDef[] = [
  // 0: INSULATED FLASK / BOTTLE
  {
    id: 'flask',
    code: 'DWG-46A · VESSEL',
    widthLabel: 'Ø 84 mm',
    widthNum: 84,
    widthUnit: 'mm',
    heightLabel: '248 mm',
    heightNum: 248,
    heightUnit: 'mm',
    detailLabel: 'R 32',
    detailNum: 32,
    detailUnit: 'mm',
    bbox: { left: -130, right: 130, top: -468, bottom: 0 },
    datum: { cx: 0, cy: -210 },
    constructionLines: [
      { x1: 0, y1: 52, x2: 0, y2: -518 },
      { x1: -206, y1: -306, x2: 206, y2: -306 },
      { x1: -186, y1: -36, x2: 186, y2: -36 },
      { x1: -146, y1: -406, x2: 146, y2: -406 },
    ],
    outlineSegments: [
      // Left & right cylindrical walls
      { kind: 'line', x1: -130, y1: -28, x2: -130, y2: -306 },
      { kind: 'line', x1: 130, y1: -28, x2: 130, y2: -306 },
      // Chamfered base standing on ground line y = 0
      { kind: 'line', x1: -130, y1: -28, x2: -112, y2: 0 },
      { kind: 'line', x1: -112, y1: 0, x2: 112, y2: 0 },
      { kind: 'line', x1: 112, y1: 0, x2: 130, y2: -28 },
      // Tapered shoulders
      { kind: 'cubic', x1: -130, y1: -306, cx1: -130, cy1: -350, cx2: -84, cy2: -368, x2: -68, y2: -386 },
      { kind: 'cubic', x1: 130, y1: -306, cx1: 130, cy1: -350, cx2: 84, cy2: -368, x2: 68, y2: -386 },
      // Neck collar
      { kind: 'line', x1: -68, y1: -386, x2: -68, y2: -406 },
      { kind: 'line', x1: 68, y1: -386, x2: 68, y2: -406 },
      { kind: 'line', x1: -68, y1: -386, x2: 68, y2: -386 },
      // Cap body & beveled top
      { kind: 'line', x1: -76, y1: -406, x2: 76, y2: -406 },
      { kind: 'line', x1: -76, y1: -406, x2: -76, y2: -454 },
      { kind: 'line', x1: 76, y1: -406, x2: 76, y2: -454 },
      { kind: 'line', x1: -76, y1: -454, x2: -62, y2: -468 },
      { kind: 'line', x1: -62, y1: -468, x2: 62, y2: -468 },
      { kind: 'line', x1: 62, y1: -468, x2: 76, y2: -454 },
      // Structural grip seam bands
      { kind: 'line', x1: -130, y1: -268, x2: 130, y2: -268 },
      { kind: 'line', x1: -130, y1: -98, x2: 130, y2: -98 },
    ],
    blueprintInner: [
      { kind: 'line', x1: -112, y1: -38, x2: -112, y2: -298, dashed: true },
      { kind: 'line', x1: 112, y1: -38, x2: 112, y2: -298, dashed: true },
      { kind: 'line', x1: -112, y1: -38, x2: 112, y2: -38, dashed: true },
      { kind: 'line', x1: -50, y1: -414, x2: -50, y2: -450 },
      { kind: 'line', x1: 0, y1: -414, x2: 0, y2: -450 },
      { kind: 'line', x1: 50, y1: -414, x2: 50, y2: -450 },
      { kind: 'line', x1: -68, y1: -396, x2: 68, y2: -396 },
    ],
    jointCircles: [
      { cx: -98, cy: -306, r: 32, arcStartDeg: 180, arcEndDeg: 255, arcLabel: 'R32' },
      { cx: 98, cy: -306, r: 32, arcStartDeg: 285, arcEndDeg: 360, arcLabel: 'R32' },
      { cx: 68, cy: -386, r: 18, arcStartDeg: -45, arcEndDeg: 85, arcLabel: 'R18' },
      { cx: 112, cy: -18, r: 18, arcStartDeg: 10, arcEndDeg: 90, arcLabel: '45°' },
    ],
    hatchLines: [
      { x1: 86, y1: -252, x2: 122, y2: -222 },
      { x1: 80, y1: -230, x2: 124, y2: -194 },
      { x1: 78, y1: -206, x2: 124, y2: -168 },
      { x1: 80, y1: -182, x2: 124, y2: -144 },
      { x1: 82, y1: -156, x2: 124, y2: -120 },
      { x1: 86, y1: -130, x2: 122, y2: -104 },
      { x1: 86, y1: -84, x2: 122, y2: -54 },
      { x1: 86, y1: -62, x2: 120, y2: -34 },
      { x1: 42, y1: -450, x2: 70, y2: -422 },
    ],
    calloutAnchors: [
      { x: -72, y: -436 },
      { x: 106, y: -342 },
      { x: -126, y: -178 },
      { x: 114, y: -16 },
    ],
    detailCallout: { ax: 116, ay: -328, lx: 184, ly: -378 },
  },

  // 1: ARCHITECTURAL SIDE-VIEW CHAIR
  {
    id: 'chair',
    code: 'DWG-46B · SEAT',
    widthLabel: '540 mm',
    widthNum: 540,
    widthUnit: 'mm',
    heightLabel: '810 mm',
    heightNum: 810,
    heightUnit: 'mm',
    detailLabel: '104°',
    detailNum: 104,
    detailUnit: '°',
    bbox: { left: -176, right: 174, top: -438, bottom: 0 },
    datum: { cx: -14, cy: -196 },
    constructionLines: [
      { x1: 0, y1: 50, x2: 0, y2: -480 },
      { x1: -232, y1: -196, x2: 232, y2: -196 },
      { x1: -102, y1: -196, x2: -188, y2: -472 },
      { x1: -210, y1: -76, x2: 204, y2: -76 },
    ],
    outlineSegments: [
      // Rear leg continuing into backrest spine
      { kind: 'line', x1: -148, y1: 0, x2: -108, y2: -196 },
      { kind: 'line', x1: -128, y1: 0, x2: -88, y2: -196 },
      { kind: 'line', x1: -148, y1: 0, x2: -128, y2: 0 },
      // Backrest upright & shell
      { kind: 'line', x1: -108, y1: -196, x2: -174, y2: -436 },
      { kind: 'line', x1: -88, y1: -196, x2: -152, y2: -436 },
      { kind: 'line', x1: -174, y1: -436, x2: -152, y2: -436 },
      // Contoured backrest cushion pad
      { kind: 'cubic', x1: -126, y1: -292, cx1: -116, cy1: -338, cx2: -130, cy2: -386, x2: -146, y2: -428 },
      { kind: 'line', x1: -146, y1: -428, x2: -168, y2: -428 },
      { kind: 'line', x1: -126, y1: -292, x2: -140, y2: -292 },
      // Seat pan top & waterfall lip
      { kind: 'line', x1: -108, y1: -196, x2: 148, y2: -196 },
      { kind: 'cubic', x1: 148, y1: -196, cx1: 168, cy1: -196, cx2: 174, cy2: -184, x2: 166, y2: -168 },
      { kind: 'line', x1: -104, y1: -172, x2: 166, y2: -168 },
      // Front leg
      { kind: 'line', x1: 132, y1: -170, x2: 148, y2: 0 },
      { kind: 'line', x1: 112, y1: -170, x2: 128, y2: 0 },
      { kind: 'line', x1: 128, y1: 0, x2: 148, y2: 0 },
      // Cross stretcher bar
      { kind: 'line', x1: -130, y1: -84, x2: 136, y2: -84 },
      { kind: 'line', x1: -133, y1: -66, x2: 138, y2: -66 },
    ],
    blueprintInner: [
      { kind: 'line', x1: -88, y1: -184, x2: 144, y2: -184, dashed: true },
      { kind: 'circle', cx: -98, cy: -184, r: 5 },
      { kind: 'circle', cx: 122, cy: -184, r: 5 },
      { kind: 'circle', cx: -124, cy: -75, r: 4 },
      { kind: 'circle', cx: 126, cy: -75, r: 4 },
    ],
    jointCircles: [
      { cx: -98, cy: -196, r: 34, arcStartDeg: -106, arcEndDeg: 0, arcLabel: '104°' },
      { cx: 136, cy: -182, r: 24, arcStartDeg: -90, arcEndDeg: 25, arcLabel: 'R24' },
      { cx: -128, cy: -76, r: 18, arcStartDeg: -30, arcEndDeg: 80, arcLabel: 'J1' },
    ],
    hatchLines: [
      { x1: -158, y1: -414, x2: -138, y2: -396 },
      { x1: -152, y1: -392, x2: -132, y2: -374 },
      { x1: -146, y1: -370, x2: -126, y2: -352 },
      { x1: -140, y1: -348, x2: -122, y2: -332 },
      { x1: -134, y1: -326, x2: -118, y2: -312 },
      { x1: -66, y1: -192, x2: -46, y2: -174 },
      { x1: -30, y1: -192, x2: -10, y2: -174 },
      { x1: 6, y1: -192, x2: 26, y2: -174 },
      { x1: 42, y1: -192, x2: 62, y2: -174 },
      { x1: 78, y1: -192, x2: 98, y2: -174 },
    ],
    calloutAnchors: [
      { x: -156, y: -380 },
      { x: 146, y: -192 },
      { x: -126, y: -76 },
      { x: 138, y: -18 },
    ],
    detailCallout: { ax: -78, ay: -222, lx: 46, ly: -314 },
  },

  // 2: SOUNDING ROCKET / AEROSPACE VEHICLE
  {
    id: 'rocket',
    code: 'DWG-46C · VEHICLE',
    widthLabel: '316 cm',
    widthNum: 316,
    widthUnit: 'cm',
    heightLabel: '488 cm',
    heightNum: 488,
    heightUnit: 'cm',
    detailLabel: 'Ø 52',
    detailNum: 52,
    detailUnit: 'cm',
    bbox: { left: -158, right: 158, top: -488, bottom: 0 },
    datum: { cx: 0, cy: -242 },
    constructionLines: [
      { x1: 0, y1: 52, x2: 0, y2: -532 },
      { x1: -190, y1: -338, x2: 190, y2: -338 },
      { x1: -214, y1: -168, x2: 214, y2: -168 },
      { x1: -184, y1: -60, x2: 184, y2: -60 },
    ],
    outlineSegments: [
      // Ogive nosecone
      { kind: 'cubic', x1: 0, y1: -488, cx1: -44, cy1: -440, cx2: -72, cy2: -390, x2: -72, y2: -338 },
      { kind: 'cubic', x1: 0, y1: -488, cx1: 44, cy1: -440, cx2: 72, cy2: -390, x2: 72, y2: -338 },
      // Main fuselage cylinder
      { kind: 'line', x1: -72, y1: -338, x2: -72, y2: -60 },
      { kind: 'line', x1: 72, y1: -338, x2: 72, y2: -60 },
      { kind: 'line', x1: -72, y1: -60, x2: 72, y2: -60 },
      // Stage ring seams
      { kind: 'line', x1: -72, y1: -338, x2: 72, y2: -338 },
      { kind: 'line', x1: -72, y1: -222, x2: 72, y2: -222 },
      { kind: 'line', x1: -72, y1: -146, x2: 72, y2: -146 },
      // Left stabilizer fin standing on ground line y = 0
      { kind: 'line', x1: -72, y1: -168, x2: -158, y2: -46 },
      { kind: 'line', x1: -158, y1: -46, x2: -158, y2: 0 },
      { kind: 'line', x1: -158, y1: 0, x2: -72, y2: -46 },
      // Right stabilizer fin standing on ground line y = 0
      { kind: 'line', x1: 72, y1: -168, x2: 158, y2: -46 },
      { kind: 'line', x1: 158, y1: -46, x2: 158, y2: 0 },
      { kind: 'line', x1: 158, y1: 0, x2: 72, y2: -46 },
      // Nozzle bell
      { kind: 'line', x1: -44, y1: -60, x2: -60, y2: -8 },
      { kind: 'line', x1: -60, y1: -8, x2: 60, y2: -8 },
      { kind: 'line', x1: 60, y1: -8, x2: 44, y2: -60 },
    ],
    blueprintInner: [
      { kind: 'circle', cx: 0, cy: -282, r: 26 },
      { kind: 'circle', cx: 0, cy: -282, r: 16, dashed: true },
      { kind: 'line', x1: -54, y1: -210, x2: -54, y2: -158, dashed: true },
      { kind: 'line', x1: 54, y1: -210, x2: 54, y2: -158, dashed: true },
      { kind: 'line', x1: -42, y1: -34, x2: 42, y2: -34 },
      { kind: 'line', x1: 0, y1: -168, x2: 0, y2: -60 },
    ],
    jointCircles: [
      { cx: 0, cy: -282, r: 26, arcStartDeg: -40, arcEndDeg: 220, arcLabel: 'Ø52' },
      { cx: 72, cy: -168, r: 22, arcStartDeg: -10, arcEndDeg: 65, arcLabel: '54°' },
      { cx: -72, cy: -168, r: 22, arcStartDeg: 115, arcEndDeg: 190, arcLabel: '54°' },
      { cx: 0, cy: -474, r: 16, arcStartDeg: -155, arcEndDeg: -25, arcLabel: 'R16' },
    ],
    hatchLines: [
      { x1: 38, y1: -330, x2: 68, y2: -302 },
      { x1: 36, y1: -306, x2: 68, y2: -276 },
      { x1: 36, y1: -280, x2: 68, y2: -250 },
      { x1: 36, y1: -254, x2: 68, y2: -228 },
      { x1: 36, y1: -212, x2: 68, y2: -182 },
      { x1: 36, y1: -186, x2: 68, y2: -156 },
      { x1: 36, y1: -136, x2: 68, y2: -106 },
      { x1: 36, y1: -110, x2: 68, y2: -80 },
      { x1: 92, y1: -116, x2: 146, y2: -54 },
      { x1: 86, y1: -88, x2: 142, y2: -26 },
    ],
    calloutAnchors: [
      { x: -46, y: -406 },
      { x: 26, y: -282 },
      { x: -136, y: -56 },
      { x: 54, y: -22 },
    ],
    detailCallout: { ax: 24, ay: -296, lx: 148, ly: -356 },
  },

  // 3: PRECISION OPTICAL / PRODUCT ENCLOSURE
  {
    id: 'enclosure',
    code: 'DWG-46D · MODULE',
    widthLabel: '142 mm',
    widthNum: 142,
    widthUnit: 'mm',
    heightLabel: '108 mm',
    heightNum: 108,
    heightUnit: 'mm',
    detailLabel: 'Ø 46',
    detailNum: 46,
    detailUnit: 'mm',
    bbox: { left: -192, right: 194, top: -358, bottom: 0 },
    datum: { cx: -30, cy: -164 },
    constructionLines: [
      { x1: -242, y1: -164, x2: 246, y2: -164 },
      { x1: -62, y1: 50, x2: -62, y2: -408 },
      { x1: -230, y1: -310, x2: 212, y2: -310 },
      { x1: 118, y1: -280, x2: 118, y2: -48 },
    ],
    outlineSegments: [
      // Main chassis enclosure
      { kind: 'line', x1: -192, y1: -18, x2: -192, y2: -294 },
      { kind: 'line', x1: -192, y1: -294, x2: -176, y2: -310 },
      { kind: 'line', x1: -176, y1: -310, x2: 64, y2: -310 },
      { kind: 'line', x1: 64, y1: -310, x2: 64, y2: -18 },
      { kind: 'line', x1: -192, y1: -18, x2: 64, y2: -18 },
      // Isolation feet resting on ground line y = 0
      { kind: 'line', x1: -164, y1: -18, x2: -164, y2: 0 },
      { kind: 'line', x1: -164, y1: 0, x2: -108, y2: 0 },
      { kind: 'line', x1: -108, y1: 0, x2: -108, y2: -18 },
      { kind: 'line', x1: -16, y1: -18, x2: -16, y2: 0 },
      { kind: 'line', x1: -16, y1: 0, x2: 40, y2: 0 },
      { kind: 'line', x1: 40, y1: 0, x2: 40, y2: -18 },
      // Top optical turret & control dial
      { kind: 'line', x1: -144, y1: -310, x2: -126, y2: -358 },
      { kind: 'line', x1: -126, y1: -358, x2: -26, y2: -358 },
      { kind: 'line', x1: -26, y1: -358, x2: -8, y2: -310 },
      { kind: 'line', x1: 8, y1: -310, x2: 8, y2: -338 },
      { kind: 'line', x1: 8, y1: -338, x2: 52, y2: -338 },
      { kind: 'line', x1: 52, y1: -338, x2: 52, y2: -310 },
      // Stepped projecting barrel (right side)
      { kind: 'line', x1: 64, y1: -246, x2: 118, y2: -246 },
      { kind: 'line', x1: 118, y1: -246, x2: 118, y2: -82 },
      { kind: 'line', x1: 118, y1: -82, x2: 64, y2: -82 },
      { kind: 'line', x1: 118, y1: -234, x2: 174, y2: -234 },
      { kind: 'line', x1: 174, y1: -234, x2: 174, y2: -94 },
      { kind: 'line', x1: 174, y1: -94, x2: 118, y2: -94 },
      { kind: 'line', x1: 174, y1: -222, x2: 194, y2: -222 },
      { kind: 'line', x1: 194, y1: -222, x2: 194, y2: -106 },
      { kind: 'line', x1: 194, y1: -106, x2: 174, y2: -106 },
    ],
    blueprintInner: [
      { kind: 'circle', cx: -108, cy: -164, r: 46 },
      { kind: 'circle', cx: -108, cy: -164, r: 28, dashed: true },
      { kind: 'line', x1: -176, y1: -264, x2: 48, y2: -264, dashed: true },
      { kind: 'line', x1: 136, y1: -224, x2: 136, y2: -104 },
      { kind: 'line', x1: 154, y1: -224, x2: 154, y2: -104 },
      { kind: 'line', x1: 22, y1: -332, x2: 22, y2: -316 },
      { kind: 'line', x1: 38, y1: -332, x2: 38, y2: -316 },
    ],
    jointCircles: [
      { cx: -108, cy: -164, r: 46, arcStartDeg: -35, arcEndDeg: 215, arcLabel: 'Ø46' },
      { cx: 118, cy: -240, r: 18, arcStartDeg: -85, arcEndDeg: 15, arcLabel: 'R18' },
      { cx: -176, cy: -294, r: 16, arcStartDeg: 180, arcEndDeg: 270, arcLabel: 'R16' },
    ],
    hatchLines: [
      { x1: -182, y1: -76, x2: -152, y2: -24 },
      { x1: -154, y1: -76, x2: -124, y2: -24 },
      { x1: -126, y1: -76, x2: -96, y2: -24 },
      { x1: -98, y1: -76, x2: -68, y2: -24 },
      { x1: -70, y1: -76, x2: -40, y2: -24 },
      { x1: -42, y1: -76, x2: -12, y2: -24 },
      { x1: -14, y1: -76, x2: 16, y2: -24 },
      { x1: 14, y1: -76, x2: 44, y2: -24 },
      { x1: 72, y1: -124, x2: 108, y2: -88 },
      { x1: 126, y1: -130, x2: 164, y2: -98 },
    ],
    calloutAnchors: [
      { x: -76, y: -352 },
      { x: 146, y: -232 },
      { x: -152, y: -158 },
      { x: 12, y: -10 },
    ],
    detailCallout: { ax: -74, ay: -194, lx: 18, ly: -268 },
  },
];

function selectObjectR(sceneIndex: number, scene: StudioScene): L46ObjectDef {
  const text = haystackOfR(scene).toLowerCase();
  if (/(?:จรวด|อวกาศ|ดาวเทียม|บิน|พุ่ง|rocket|launch|space|orbit)/.test(text)) {
    return L46_OBJECTS[2];
  }
  if (/(?:เก้าอี้|เฟอร์นิเจอร์|สถาปัต|นั่ง|chair|furniture|architect)/.test(text)) {
    return L46_OBJECTS[1];
  }
  if (/(?:กล้อง|เลนส์|เครื่อง|อุปกรณ์|โมดูล|ฮาร์ดแวร์|camera|lens|device|module|hardware)/.test(text)) {
    return L46_OBJECTS[3];
  }
  if (/(?:ขวด|บรรจุ|ผลิตภัณฑ์|ภาชนะ|bottle|flask|product|pack)/.test(text)) {
    return L46_OBJECTS[0];
  }
  const idx = Math.floor(seededHashR(sceneIndex * 13 + 7) * L46_OBJECTS.length) % L46_OBJECTS.length;
  return L46_OBJECTS[idx];
}

// ============================================================================
// WET-INK FLOOD GEOMETRY (IRREGULAR ORGANIC EDGE + DARKER TIDE LINE)
// ============================================================================

function l46WetBlobPath(
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  samples = 144,
): string {
  if (radius <= 0.5) return '';
  const p1 = seededHashR(seed + 11) * Math.PI * 2;
  const p2 = seededHashR(seed + 23) * Math.PI * 2;
  const p3 = seededHashR(seed + 37) * Math.PI * 2;
  const p4 = seededHashR(seed + 53) * Math.PI * 2;
  const p5 = seededHashR(seed + 71) * Math.PI * 2;
  let d = '';
  for (let i = 0; i <= samples; i++) {
    const theta = (i / samples) * Math.PI * 2;
    const mod =
      1 +
      0.056 * Math.sin(3 * theta + p1) +
      0.036 * Math.sin(5 * theta + p2) +
      0.024 * Math.sin(9 * theta + p3) +
      0.015 * Math.sin(15 * theta + p4) +
      0.008 * Math.sin(25 * theta + p5);
    const r = radius * mod;
    const x = cx + Math.cos(theta) * r;
    const y = cy + Math.sin(theta) * r;
    d += i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return `${d} Z`;
}

/** Vertical organic wet-ink wave x(y) for split sketch-vs-spec shot */
function l46VerticalWaveX(y: number, baseX: number, seed: number): number {
  const p1 = seededHashR(seed + 19) * Math.PI * 2;
  const p2 = seededHashR(seed + 41) * Math.PI * 2;
  const p3 = seededHashR(seed + 67) * Math.PI * 2;
  const p4 = seededHashR(seed + 89) * Math.PI * 2;
  return (
    baseX +
    15 * Math.sin(y * 0.0075 + p1) +
    9 * Math.sin(y * 0.019 + p2) +
    5 * Math.sin(y * 0.043 + p3) +
    2.4 * Math.sin(y * 0.095 + p4)
  );
}

function l46VerticalSplitPaths(baseX: number, seed: number, steps = 96): {
  edgePath: string;
  rightFillPath: string;
  rightCssPolygon: string;
  leftCssPolygon: string;
} {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const y = (i / steps) * STAGE_H;
    pts.push({ x: l46VerticalWaveX(y, baseX, seed), y });
  }
  const edgePath = pts
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const rightFillPath = `${edgePath} L ${STAGE_W + 40} ${STAGE_H} L ${STAGE_W + 40} 0 Z`;

  const polyPtsRight = [
    ...pts.map((p) => `${((p.x / STAGE_W) * 100).toFixed(2)}% ${((p.y / STAGE_H) * 100).toFixed(2)}%`),
    '100% 100%',
    '100% 0%',
  ].join(', ');
  const polyPtsLeft = [
    '0% 0%',
    ...pts.map((p) => `${((p.x / STAGE_W) * 100).toFixed(2)}% ${((p.y / STAGE_H) * 100).toFixed(2)}%`),
    '0% 100%',
  ].join(', ');

  return {
    edgePath,
    rightFillPath,
    rightCssPolygon: `polygon(${polyPtsRight})`,
    leftCssPolygon: `polygon(${polyPtsLeft})`,
  };
}

// ============================================================================
// SHARED TIMING SCHEDULE (PROPORTIONAL TO durationFrames)
// ============================================================================

interface L46Timeline {
  /** 0..1 overall sketch progress (starts > 0 at frame 0!) */
  groundP: number;
  constructP: number;
  outlineP: number;
  jointP: number;
  hatchP: number;
  /** 0..1 flood expansion (fast then slow) */
  floodP: number;
  /** Frames relative to annotation start for springs */
  annotFrame: number;
  labelFrame: number;
  dimP: number;
  tickP: number;
  ruleP: number;
  labelP: number;
}

function computeTimelineR(localFrame: number, durationFrames: number): L46Timeline {
  const dur = Math.max(60, durationFrames);
  // Already actively sketching on frame 0
  const f = localFrame + 3.2;

  const sketchEnd = Math.round(dur * 0.37); // ~55f on 150f clip
  const holdDur = Math.max(8, Math.min(11, Math.round(dur * 0.067))); // ~10f hold
  const floodStart = sketchEnd + holdDur; // ~65f
  const floodDur = Math.max(18, Math.round(dur * 0.19)); // ~28f
  const annotStart = floodStart + Math.round(floodDur * 0.56);
  const labelStart = floodStart + Math.round(floodDur * 0.72);

  const groundP = l46HandEase(l46Progress(f, 0, Math.max(8, sketchEnd * 0.22)));
  const constructP = l46HandEase(l46Progress(f, sketchEnd * 0.05, Math.max(10, sketchEnd * 0.28)));
  const outlineP = l46Progress(f, sketchEnd * 0.18, Math.max(16, sketchEnd * 0.52));
  const jointP = l46Progress(f, sketchEnd * 0.60, Math.max(10, sketchEnd * 0.24));
  const hatchP = l46Progress(f, sketchEnd * 0.76, Math.max(9, sketchEnd * 0.24));

  const floodP = l46FloodEase(l46Progress(localFrame, floodStart, floodDur));
  const dimP = easeOutCubic(l46Progress(localFrame, annotStart + 3, Math.max(12, Math.round(dur * 0.11))));
  const tickP = easeOutCubic(l46Progress(localFrame, annotStart + 5, Math.max(14, Math.round(dur * 0.13))));
  const ruleP = easeOutCubic(l46Progress(localFrame, labelStart, Math.max(10, Math.round(dur * 0.08))));
  const labelP = easeOutCubic(l46Progress(localFrame, labelStart + 4, Math.max(11, Math.round(dur * 0.09))));

  return {
    groundP,
    constructP,
    outlineP,
    jointP,
    hatchP,
    floodP,
    annotFrame: Math.max(0, localFrame - annotStart),
    labelFrame: Math.max(0, localFrame - labelStart),
    dimP,
    tickP,
    ruleP,
    labelP,
  };
}

// ============================================================================
// SVG SUB-COMPONENTS: PAPER/BLUEPRINT GRIDS, PENCIL LAYER, BLUEPRINT LAYER
// ============================================================================

const L46Defs: React.FC<{ uid: string; sceneIndex: number }> = ({ uid, sceneIndex }) => {
  const grainSeed = 460 + ((sceneIndex * 17) % 89);
  const wetSeed = 910 + ((sceneIndex * 23) % 97);
  return (
    <defs>
      {/* Engineering graph paper minor (24px) & major (120px) grid */}
      <pattern id={`${uid}-paper-grid`} width="120" height="120" patternUnits="userSpaceOnUse">
        <path
          d="M 24 0 L 24 120 M 48 0 L 48 120 M 72 0 L 72 120 M 96 0 L 96 120 M 0 24 L 120 24 M 0 48 L 120 48 M 0 72 L 120 72 M 0 96 L 120 96"
          fill="none"
          stroke={L46.grid}
          strokeOpacity="0.16"
          strokeWidth="1"
        />
        <path
          d="M 120 0 L 0 0 0 120"
          fill="none"
          stroke={L46.grid}
          strokeOpacity="0.30"
          strokeWidth="1.4"
        />
      </pattern>

      {/* Blueprint crisp white engineering grid */}
      <pattern id={`${uid}-bp-grid`} width="120" height="120" patternUnits="userSpaceOnUse">
        <path
          d="M 24 0 L 24 120 M 48 0 L 48 120 M 72 0 L 72 120 M 96 0 L 96 120 M 0 24 L 120 24 M 0 48 L 120 48 M 0 72 L 120 72 M 0 96 L 120 96"
          fill="none"
          stroke={L46.inkWhiteGridMinor}
          strokeWidth="1"
        />
        <path
          d="M 120 0 L 0 0 0 120"
          fill="none"
          stroke={L46.inkWhiteGridMajor}
          strokeWidth="1.3"
        />
      </pattern>

      {/* Irregular wet-edge ink displacement filter (deterministic seed) */}
      <filter id={`${uid}-wet`} x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.014"
          numOctaves="3"
          seed={wetSeed}
          result="wetNoise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="wetNoise"
          scale="22"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>

      {/* Subtle graphite paper-tooth texture on pencil strokes */}
      <filter id={`${uid}-pencil-tooth`} x="-6%" y="-6%" width="112%" height="112%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.45"
          numOctaves="2"
          seed={grainSeed + 7}
          result="tooth"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="tooth"
          scale="1.6"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>

      {/* Fine overall paper grain (deterministic seed) */}
      <filter id={`${uid}-grain`} x="0%" y="0%" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.72"
          numOctaves="2"
          seed={grainSeed}
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>

      {/* Ultra-faint cyanotype paper mottling (flat noise, NO gradient) */}
      <filter id={`${uid}-mottle`} x="0%" y="0%" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.008"
          numOctaves="3"
          seed={grainSeed + 31}
        />
        <feColorMatrix
          type="matrix"
          values="0 0 0 0 0.06  0 0 0 0 0.18  0 0 0 0 0.36  0 0 0 0.065 0"
        />
      </filter>
    </defs>
  );
};

/** Renders the graphite pencil sketch layer in real drafting order */
const L46PencilObjectLayer: React.FC<{
  obj: L46ObjectDef;
  originX: number;
  groundY: number;
  scale: number;
  tl: L46Timeline;
  sceneIndex: number;
  uid: string;
}> = ({ obj, originX, groundY, scale, tl, sceneIndex, uid }) => {
  const seedBase = sceneIndex * 997 + 461;
  const groundSpan = Math.max(360, (obj.bbox.right - obj.bbox.left) * 0.92);
  const groundStroke = l46WobbleLine(-groundSpan, 0, groundSpan, 0, seedBase + 1, 1.8, 18);

  return (
    <g
      transform={`translate(${originX}, ${groundY}) scale(${scale})`}
      filter={`url(#${uid}-pencil-tooth)`}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    >
      {/* 1. Ground line */}
      <path
        d={groundStroke.d}
        stroke={L46.pencil}
        strokeOpacity="0.68"
        strokeWidth={2.2}
        strokeDasharray={groundStroke.len}
        strokeDashoffset={groundStroke.len * (1 - tl.groundP)}
      />

      {/* 2. Light construction axes */}
      {obj.constructionLines.map((ln, idx) => {
        const subP = l46HandEase(l46Progress(tl.constructP, idx * 0.14, 0.62));
        if (subP <= 0.001) return null;
        const st = l46WobbleLine(ln.x1, ln.y1, ln.x2, ln.y2, seedBase + 20 + idx * 7, 1.3, 14);
        return (
          <path
            key={`cl-${idx}`}
            d={st.d}
            stroke={L46.pencilSoft}
            strokeWidth={1.35}
            strokeDasharray={st.len}
            strokeDashoffset={st.len * (1 - subP)}
          />
        );
      })}

      {/* 3. Confident doubled wobbly outlines with overshooting ends */}
      {obj.outlineSegments.map((seg, idx) => {
        const count = obj.outlineSegments.length;
        const stStart = (idx / Math.max(1, count)) * 0.68;
        const stDur = 0.36;
        const p1 = l46HandEase(l46Progress(tl.outlineP, stStart, stDur));
        const p2 = l46HandEase(l46Progress(tl.outlineP, stStart + 0.07, stDur));
        if (p1 <= 0.001) return null;

        const pass1 =
          seg.kind === 'line'
            ? l46WobbleLine(seg.x1, seg.y1, seg.x2, seg.y2, seedBase + 100 + idx * 13, 2.2, 9)
            : l46WobbleCubic(
                seg.x1,
                seg.y1,
                seg.cx1,
                seg.cy1,
                seg.cx2,
                seg.cy2,
                seg.x2,
                seg.y2,
                seedBase + 100 + idx * 13,
                2.5,
                7,
              );
        const pass2 =
          seg.kind === 'line'
            ? l46WobbleLine(seg.x1, seg.y1, seg.x2, seg.y2, seedBase + 300 + idx * 17, 3.1, 13)
            : l46WobbleCubic(
                seg.x1,
                seg.y1,
                seg.cx1,
                seg.cy1,
                seg.cx2,
                seg.cy2,
                seg.x2,
                seg.y2,
                seedBase + 300 + idx * 17,
                3.4,
                10,
              );

        return (
          <React.Fragment key={`ol-${idx}`}>
            <path
              d={pass1.d}
              stroke={L46.pencil}
              strokeOpacity="0.92"
              strokeWidth={3.1}
              strokeDasharray={pass1.len}
              strokeDashoffset={pass1.len * (1 - p1)}
            />
            {p2 > 0.001 && (
              <path
                d={pass2.d}
                stroke={L46.pencil}
                strokeOpacity="0.46"
                strokeWidth={1.7}
                strokeDasharray={pass2.len}
                strokeDashoffset={pass2.len * (1 - p2)}
              />
            )}
          </React.Fragment>
        );
      })}

      {/* 4. Overshooting freehand joint circles */}
      {obj.jointCircles.map((jc, idx) => {
        const subP = l46HandEase(l46Progress(tl.jointP, idx * 0.16, 0.55));
        if (subP <= 0.001) return null;
        const st = l46WobbleCircle(jc.cx, jc.cy, jc.r, seedBase + 500 + idx * 29);
        return (
          <path
            key={`jc-${idx}`}
            d={st.d}
            stroke={L46.pencil}
            strokeOpacity="0.58"
            strokeWidth={1.6}
            strokeDasharray={st.len}
            strokeDashoffset={st.len * (1 - subP)}
          />
        );
      })}

      {/* 5. Quick diagonal graphite hatching strokes */}
      {obj.hatchLines.map((hl, idx) => {
        const subP = l46HandEase(l46Progress(tl.hatchP, (idx / Math.max(1, obj.hatchLines.length)) * 0.62, 0.4));
        if (subP <= 0.001) return null;
        const st = l46WobbleLine(hl.x1, hl.y1, hl.x2, hl.y2, seedBase + 700 + idx * 11, 1.5, 4);
        return (
          <path
            key={`ht-${idx}`}
            d={st.d}
            stroke={L46.pencilHatch}
            strokeWidth={1.65}
            strokeDasharray={st.len}
            strokeDashoffset={st.len * (1 - subP)}
          />
        );
      })}
    </g>
  );
};

/** Renders the crisp white blueprint technical drawing at the EXACT SAME coordinates */
const L46BlueprintObjectLayer: React.FC<{
  obj: L46ObjectDef;
  originX: number;
  groundY: number;
  scale: number;
  tl: L46Timeline;
  fps: number;
}> = ({ obj, originX, groundY, scale, tl, fps }) => {
  const groundSpan = Math.max(360, (obj.bbox.right - obj.bbox.left) * 0.92);
  const centerPop = spring({
    frame: tl.annotFrame,
    fps,
    config: { damping: 12, stiffness: 260, mass: 0.7 },
  });

  return (
    <g
      transform={`translate(${originX}, ${groundY}) scale(${scale})`}
      strokeLinecap="square"
      strokeLinejoin="miter"
      fill="none"
    >
      {/* Crisp ground datum line */}
      <line
        x1={-groundSpan}
        y1={0}
        x2={groundSpan}
        y2={0}
        stroke={L46.inkWhite}
        strokeWidth={2.4}
      />

      {/* Construction lines upgraded into crisp dash-dot center lines */}
      {obj.constructionLines.map((ln, idx) => (
        <line
          key={`bcl-${idx}`}
          x1={ln.x1}
          y1={ln.y1}
          x2={ln.x2}
          y2={ln.y2}
          stroke={L46.inkWhiteSoft}
          strokeWidth={1.5}
          strokeDasharray="28 8 4 8"
        />
      ))}

      {/* Crisp ruler-straight & true-curve blueprint outlines (NO wobble, NO overshoot, NO glow) */}
      {obj.outlineSegments.map((seg, idx) =>
        seg.kind === 'line' ? (
          <line
            key={`bol-${idx}`}
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            stroke={L46.inkWhite}
            strokeWidth={3.1}
          />
        ) : (
          <path
            key={`bol-${idx}`}
            d={`M ${seg.x1} ${seg.y1} C ${seg.cx1} ${seg.cy1}, ${seg.cx2} ${seg.cy2}, ${seg.x2} ${seg.y2}`}
            stroke={L46.inkWhite}
            strokeWidth={3.1}
          />
        ),
      )}

      {/* Technical inner lines & hidden-line dashes */}
      {obj.blueprintInner.map((item, idx) =>
        item.kind === 'line' ? (
          <line
            key={`bin-${idx}`}
            x1={item.x1}
            y1={item.y1}
            x2={item.x2}
            y2={item.y2}
            stroke={L46.inkWhite}
            strokeOpacity={item.dashed ? 0.62 : 0.85}
            strokeWidth={1.6}
            strokeDasharray={item.dashed ? '9 7' : undefined}
          />
        ) : (
          <circle
            key={`bin-${idx}`}
            cx={item.cx}
            cy={item.cy}
            r={item.r}
            stroke={L46.inkWhite}
            strokeOpacity={item.dashed ? 0.62 : 0.9}
            strokeWidth={item.dashed ? 1.4 : 2.1}
            strokeDasharray={item.dashed ? '7 6' : undefined}
          />
        ),
      )}

      {/* Joint circles upgraded into angular / radius blueprint dimension arcs */}
      {obj.jointCircles.map((jc, idx) => {
        const arcD = l46BlueprintArcPath(jc.cx, jc.cy, jc.r, jc.arcStartDeg, jc.arcEndDeg);
        const a1 = (jc.arcStartDeg * Math.PI) / 180;
        const a2 = (jc.arcEndDeg * Math.PI) / 180;
        const t1x = jc.cx + Math.cos(a1) * jc.r;
        const t1y = jc.cy + Math.sin(a1) * jc.r;
        const t2x = jc.cx + Math.cos(a2) * jc.r;
        const t2y = jc.cy + Math.sin(a2) * jc.r;
        return (
          <g key={`barc-${idx}`} stroke={L46.inkWhite} strokeOpacity="0.88">
            <path d={arcD} strokeWidth={1.6} />
            <circle cx={t1x} cy={t1y} r={2.4} fill={L46.inkWhite} stroke="none" />
            <circle cx={t2x} cy={t2y} r={2.4} fill={L46.inkWhite} stroke="none" />
            <circle cx={jc.cx} cy={jc.cy} r={2.2} fill={L46.inkWhite} stroke="none" />
          </g>
        );
      })}

      {/* Center mark datum crosshair popping into place */}
      {centerPop > 0.01 && (
        <g
          transform={`translate(${obj.datum.cx}, ${obj.datum.cy}) scale(${centerPop})`}
          stroke={L46.inkWhite}
          strokeWidth={2}
        >
          <circle cx={0} cy={0} r={11} strokeWidth={1.6} />
          <line x1={-22} y1={0} x2={-5} y2={0} />
          <line x1={5} y1={0} x2={22} y2={0} />
          <line x1={0} y1={-22} x2={0} y2={-5} />
          <line x1={0} y1={5} x2={0} y2={22} />
          <circle cx={0} cy={0} r={2.4} fill={L46.inkWhite} stroke="none" />
        </g>
      )}
    </g>
  );
};

// ============================================================================
// TECHNICAL DIMENSION LINES (DRAW OUT FROM CENTER + POPPING ARROWHEADS + TICK)
// Strictly <= 3 dimensions per shot!
// ============================================================================

const L46HorizontalDim: React.FC<{
  x1: number;
  x2: number;
  anchorY: number;
  dimY: number;
  labelNum: number;
  unit: string;
  prefix?: string;
  dimP: number;
  tickP: number;
  arrowFrame: number;
  fps: number;
  fontSize?: number;
}> = ({ x1, x2, anchorY, dimY, labelNum, unit, prefix = '', dimP, tickP, arrowFrame, fps, fontSize = 42 }) => {
  if (dimP <= 0.01) return null;
  const midX = (x1 + x2) / 2;
  const halfSpan = Math.abs(x2 - x1) / 2;
  const gapHalf = Math.min(halfSpan * 0.48, Math.max(76, fontSize * 2.15));
  const extP = clamp01(dimP * 1.45);
  const lineP = clamp01((dimP - 0.15) / 0.85);
  const arrowScale = spring({
    frame: Math.max(0, arrowFrame - 6),
    fps,
    config: { damping: 11, stiffness: 280, mass: 0.6 },
  });

  const extDir = dimY >= anchorY ? 1 : -1;
  const extStart = anchorY + extDir * 12;
  const extEnd = dimY + extDir * 16;
  const extCurr = extStart + (extEnd - extStart) * extP;

  const leftLineStart = Math.max(x1, midX - gapHalf);
  const leftLineEnd = leftLineStart - (leftLineStart - x1) * lineP;
  const rightLineStart = Math.min(x2, midX + gapHalf);
  const rightLineEnd = rightLineStart + (x2 - rightLineStart) * lineP;

  const currentVal = Math.round(labelNum * tickP);
  const displayText = `${prefix}${currentVal}${unit ? ` ${unit}` : ''}`;

  return (
    <g>
      {/* Extension lines */}
      <line x1={x1} y1={extStart} x2={x1} y2={extCurr} stroke={L46.inkWhiteSoft} strokeWidth={1.6} />
      <line x1={x2} y1={extStart} x2={x2} y2={extCurr} stroke={L46.inkWhiteSoft} strokeWidth={1.6} />

      {/* Dimension lines drawing outward from center gap */}
      {lineP > 0.01 && (
        <>
          <line x1={leftLineStart} y1={dimY} x2={leftLineEnd} y2={dimY} stroke={L46.inkWhite} strokeWidth={2.2} />
          <line x1={rightLineStart} y1={dimY} x2={rightLineEnd} y2={dimY} stroke={L46.inkWhite} strokeWidth={2.2} />
        </>
      )}

      {/* Popping crisp technical arrowheads */}
      {arrowScale > 0.02 && (
        <>
          <polygon
            points="0,0 16,-6 16,6"
            fill={L46.inkWhite}
            transform={`translate(${x1}, ${dimY}) scale(${arrowScale})`}
          />
          <polygon
            points="0,0 -16,-6 -16,6"
            fill={L46.inkWhite}
            transform={`translate(${x2}, ${dimY}) scale(${arrowScale})`}
          />
        </>
      )}

      {/* Ticking tabular dimension number */}
      <text
        x={midX}
        y={dimY + fontSize * 0.34}
        textAnchor="middle"
        fill={L46.inkWhite}
        fontFamily={FONT_L46}
        fontWeight={500}
        fontSize={fontSize}
        style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.03em' }}
      >
        {displayText}
      </text>
    </g>
  );
};

const L46VerticalDim: React.FC<{
  yTop: number;
  yBottom: number;
  anchorX: number;
  dimX: number;
  labelNum: number;
  unit: string;
  dimP: number;
  tickP: number;
  arrowFrame: number;
  fps: number;
  fontSize?: number;
}> = ({ yTop, yBottom, anchorX, dimX, labelNum, unit, dimP, tickP, arrowFrame, fps, fontSize = 42 }) => {
  if (dimP <= 0.01) return null;
  const midY = (yTop + yBottom) / 2;
  const gapHalf = Math.min(Math.abs(yBottom - yTop) * 0.28, fontSize * 1.15);
  const extP = clamp01(dimP * 1.45);
  const lineP = clamp01((dimP - 0.15) / 0.85);
  const arrowScale = spring({
    frame: Math.max(0, arrowFrame - 7),
    fps,
    config: { damping: 11, stiffness: 280, mass: 0.6 },
  });

  const extStart = anchorX + 14;
  const extEnd = dimX + 16;
  const extCurr = extStart + (extEnd - extStart) * extP;

  const topStart = midY - gapHalf;
  const topEnd = topStart - (topStart - yTop) * lineP;
  const botStart = midY + gapHalf;
  const botEnd = botStart + (yBottom - botStart) * lineP;

  const currentVal = Math.round(labelNum * tickP);
  const displayText = `${currentVal}${unit ? ` ${unit}` : ''}`;

  return (
    <g>
      <line x1={extStart} y1={yTop} x2={extCurr} y2={yTop} stroke={L46.inkWhiteSoft} strokeWidth={1.6} />
      <line x1={extStart} y1={yBottom} x2={extCurr} y2={yBottom} stroke={L46.inkWhiteSoft} strokeWidth={1.6} />

      {lineP > 0.01 && (
        <>
          <line x1={dimX} y1={topStart} x2={dimX} y2={topEnd} stroke={L46.inkWhite} strokeWidth={2.2} />
          <line x1={dimX} y1={botStart} x2={dimX} y2={botEnd} stroke={L46.inkWhite} strokeWidth={2.2} />
        </>
      )}

      {arrowScale > 0.02 && (
        <>
          <polygon
            points="0,0 -6,16 6,16"
            fill={L46.inkWhite}
            transform={`translate(${dimX}, ${yTop}) scale(${arrowScale})`}
          />
          <polygon
            points="0,0 -6,-16 6,-16"
            fill={L46.inkWhite}
            transform={`translate(${dimX}, ${yBottom}) scale(${arrowScale})`}
          />
        </>
      )}

      <text
        x={dimX}
        y={midY + fontSize * 0.34}
        textAnchor="middle"
        fill={L46.inkWhite}
        fontFamily={FONT_L46}
        fontWeight={500}
        fontSize={fontSize}
        style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.03em' }}
      >
        {displayText}
      </text>
    </g>
  );
};

/** Compact angled radius/angle leader dimension (counts as 1 of max 3 dimensions) */
const L46DetailDim: React.FC<{
  ax: number;
  ay: number;
  lx: number;
  ly: number;
  labelPrefix: string;
  labelNum: number;
  unit: string;
  dimP: number;
  tickP: number;
  arrowFrame: number;
  fps: number;
}> = ({ ax, ay, lx, ly, labelPrefix, labelNum, unit, dimP, tickP, arrowFrame, fps }) => {
  if (dimP <= 0.01) return null;
  const lineP = clamp01(dimP * 1.25);
  const shelfW = 118;
  const shelfX = lx + shelfW;
  const d1 = l46SegmentLen(ax, ay, lx, ly);
  const d2 = shelfW;
  const total = d1 + d2;
  const arrowScale = spring({
    frame: Math.max(0, arrowFrame - 8),
    fps,
    config: { damping: 12, stiffness: 280, mass: 0.6 },
  });
  const val = Math.round(labelNum * tickP);
  const txt = `${labelPrefix}${val}${unit === '°' ? '°' : unit ? ` ${unit}` : ''}`;

  return (
    <g>
      <path
        d={`M ${ax.toFixed(1)} ${ay.toFixed(1)} L ${lx.toFixed(1)} ${ly.toFixed(1)} L ${shelfX.toFixed(1)} ${ly.toFixed(1)}`}
        fill="none"
        stroke={L46.inkWhite}
        strokeWidth={2}
        strokeDasharray={total}
        strokeDashoffset={total * (1 - lineP)}
      />
      {arrowScale > 0.02 && (
        <circle
          cx={ax}
          cy={ay}
          r={4.8 * arrowScale}
          fill={L46.inkWhite}
        />
      )}
      {lineP > 0.5 && (
        <text
          x={lx + 6}
          y={ly - 10}
          textAnchor="start"
          fill={L46.inkWhite}
          fontFamily={FONT_L46}
          fontWeight={500}
          fontSize={36}
          style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.03em' }}
        >
          {txt}
        </text>
      )}
    </g>
  );
};

// ============================================================================
// RISING BLUEPRINT LABEL ABOVE THIN RULE (NO HANDWRITING, BARLOW + THAI)
// ============================================================================

const L46RisingLabel: React.FC<{
  title: string;
  subtitle?: string;
  codeTag: string;
  x: number;
  y: number;
  width: number;
  ruleP: number;
  labelP: number;
  color?: string;
  ruleColor?: string;
  baseSize?: number;
  minSize?: number;
  maxLines?: number;
}> = ({
  title,
  subtitle,
  codeTag,
  x,
  y,
  width,
  ruleP,
  labelP,
  color = L46.inkWhite,
  ruleColor = L46.inkWhiteSoft,
  baseSize = 72,
  minSize = 36,
  maxLines = 2,
}) => {
  if (ruleP <= 0.005) return null;
  const riseY = interpolate(labelP, [0, 1], [34, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        pointerEvents: 'none',
      }}
    >
      {/* Technical sheet micro-code */}
      <div
        style={{
          overflow: 'hidden',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            transform: `translateY(${(1 - labelP) * 18}px)`,
            fontFamily: FONT_L46,
            fontSize: 22,
            fontWeight: 500,
            color: ruleColor,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {codeTag}
        </div>
      </div>

      {/* Main label rising cleanly above the thin rule */}
      <div style={{ width: '100%', overflow: 'hidden', paddingBottom: 10 }}>
        <div style={{ transform: `translateY(${riseY}px)` }}>
          <FitText
            text={title}
            baseSize={baseSize}
            minSize={minSize}
            maxLines={maxLines}
            color={color}
            fontFamily={FONT_L46}
            fontWeight={600}
            align="left"
            lineHeight={1.18}
            style={{
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          />
        </div>
      </div>

      {/* Thin horizontal rule drawn first */}
      <div
        style={{
          width: `${Math.round(ruleP * 100)}%`,
          height: 2,
          backgroundColor: color,
        }}
      />

      {/* Optional compact subtitle under the rule */}
      {subtitle && labelP > 0.2 && (
        <div style={{ width: '100%', overflow: 'hidden', marginTop: 12 }}>
          <div style={{ transform: `translateY(${(1 - labelP) * 20}px)` }}>
            <FitText
              text={subtitle}
              baseSize={28}
              minSize={20}
              maxLines={2}
              color={ruleColor}
              fontFamily={FONT_L46}
              fontWeight={500}
              align="left"
              lineHeight={1.34}
              style={{ letterSpacing: '0.02em' }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// BASE FLOOD STAGE WRAPPER (SINGLE DRAWING, SPATIAL WET-INK MASK, NO CROSSFADE)
// ============================================================================

const L46FloodCanvas: React.FC<{
  uid: string;
  sceneIndex: number;
  obj: L46ObjectDef;
  originX: number;
  groundY: number;
  scale: number;
  tl: L46Timeline;
  fps: number;
  blueprintAnnotations?: React.ReactNode;
}> = ({ uid, sceneIndex, obj, originX, groundY, scale, tl, fps, blueprintAnnotations }) => {
  const floodCx = originX + obj.datum.cx * scale;
  const floodCy = groundY + obj.datum.cy * scale;
  const maxR = Math.hypot(Math.max(floodCx, STAGE_W - floodCx), Math.max(floodCy, STAGE_H - floodCy)) + 160;
  const floodR = tl.floodP * maxR;
  const blobD = floodR > 1 ? l46WetBlobPath(floodCx, floodCy, floodR, sceneIndex * 31 + 46) : '';
  const showTide = floodR > 6 && floodR < maxR * 0.98;

  return (
    <svg
      width={STAGE_W}
      height={STAGE_H}
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      style={{ position: 'absolute', inset: 0, display: 'block' }}
    >
      <L46Defs uid={uid} sceneIndex={sceneIndex} />

      {/* Spatial mask for blueprint layer: white inside expanding wet blob, black outside */}
      <mask id={`${uid}-flood-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={STAGE_W} height={STAGE_H}>
        <rect x="0" y="0" width={STAGE_W} height={STAGE_H} fill="#000000" />
        {blobD && (
          <path
            d={blobD}
            fill="#FFFFFF"
            filter={tl.floodP < 0.98 ? `url(#${uid}-wet)` : undefined}
          />
        )}
      </mask>

      {/* LAYER 1: OFF-WHITE GRAPH PAPER + FAINT GRID + GRAPHITE PENCIL DRAWING */}
      <g>
        <rect x="0" y="0" width={STAGE_W} height={STAGE_H} fill={L46.paper} />
        <rect x="0" y="0" width={STAGE_W} height={STAGE_H} fill={`url(#${uid}-paper-grid)`} />

        {/* Subtle drafting sheet corner registration ticks */}
        <g stroke={L46.grid} strokeOpacity="0.48" strokeWidth="1.5" fill="none">
          <path d="M 54 112 L 54 136 M 54 112 L 78 112" />
          <path d="M 1026 112 L 1026 136 M 1026 112 L 1002 112" />
          <path d="M 54 1420 L 54 1396 M 54 1420 L 78 1420" />
          <path d="M 1026 1420 L 1026 1396 M 1026 1420 L 1002 1420" />
        </g>

        <L46PencilObjectLayer
          obj={obj}
          originX={originX}
          groundY={groundY}
          scale={scale}
          tl={tl}
          sceneIndex={sceneIndex}
          uid={uid}
        />
      </g>

      {/* LAYER 2: FLOODED BLUEPRINT LAYER (MASKED BY WET BLOB — ZERO CROSSFADE) */}
      {blobD && (
        <g mask={`url(#${uid}-flood-mask)`}>
          {/* Flat solid blueprint blue (NO gradient) */}
          <rect x="0" y="0" width={STAGE_W} height={STAGE_H} fill={L46.blueprint} />
          {/* Ultra-faint paper mottling (flat turbulence noise, NO gradient) */}
          <rect x="0" y="0" width={STAGE_W} height={STAGE_H} filter={`url(#${uid}-mottle)`} />
          {/* Crisp blueprint engineering grid */}
          <rect x="0" y="0" width={STAGE_W} height={STAGE_H} fill={`url(#${uid}-bp-grid)`} />

          {/* Subtle blueprint sheet corner ticks */}
          <g stroke={L46.inkWhiteFaint} strokeWidth="1.5" fill="none">
            <path d="M 54 112 L 54 136 M 54 112 L 78 112" />
            <path d="M 1026 112 L 1026 136 M 1026 112 L 1002 112" />
            <path d="M 54 1420 L 54 1396 M 54 1420 L 78 1420" />
            <path d="M 1026 1420 L 1026 1396 M 1026 1420 L 1002 1420" />
          </g>

          {/* Darker tide line (#143C76) hugging just inside the wet ink boundary */}
          {showTide && (
            <g filter={`url(#${uid}-wet)`} fill="none">
              <path d={blobD} stroke={L46.tide} strokeWidth={42} strokeOpacity="0.88" />
              <path d={blobD} stroke={L46.tide} strokeWidth={18} strokeOpacity="1" />
            </g>
          )}

          {/* Exact same object upgraded to crisp white technical blueprint */}
          <L46BlueprintObjectLayer
            obj={obj}
            originX={originX}
            groundY={groundY}
            scale={scale}
            tl={tl}
            fps={fps}
          />

          {/* Dimensions & shot-specific blueprint vectors */}
          {blueprintAnnotations}
        </g>
      )}

      {/* LAYER 3: FINE DETERMINISTIC PAPER GRAIN ACROSS ENTIRE FRAME */}
      <rect
        x="0"
        y="0"
        width={STAGE_W}
        height={STAGE_H}
        filter={`url(#${uid}-grain)`}
        opacity="0.065"
        style={{ mixBlendMode: 'multiply', pointerEvents: 'none' }}
      />
    </svg>
  );
};

// ============================================================================
// SHOT 1: 'blueprint-object-title' — Object + Top-Left Label + <= 3 Dimensions
// ============================================================================

const Look46BlueprintObjectTitle: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const uid = `l46-hero-${sceneIndex}`;
  const t = sceneTexts(scene);
  const obj = selectObjectR(sceneIndex, scene);
  const tl = computeTimelineR(localFrame, durationFrames);

  // Position object slightly left of center so right-side height dimension has ample margin
  const originX = 468;
  const groundY = 1170;
  const scale = 1.18;

  const leftX = originX + obj.bbox.left * scale;
  const rightX = originX + obj.bbox.right * scale;
  const topY = groundY + obj.bbox.top * scale;
  const dimBottomY = 1272;

  const detailAx = originX + obj.detailCallout.ax * scale;
  const detailAy = groundY + obj.detailCallout.ay * scale;
  const detailLx = Math.min(720, originX + obj.detailCallout.lx * scale);
  const detailLy = Math.max(410, groundY + obj.detailCallout.ly * scale);
  const dimRightX = Math.min(946, Math.max(rightX + 132, detailLx + 196));
  const detailPrefix = obj.detailLabel.startsWith('Ø')
    ? 'Ø '
    : obj.detailLabel.startsWith('R')
      ? 'R '
      : '';

  // Align label left edge cleanly with drawing left margin (inside x ∈ [110, 970])
  const labelLeft = Math.max(108, Math.min(180, Math.round(leftX - 86)));
  const labelWidth = Math.min(860, STAGE_W - labelLeft - 84);

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', backgroundColor: L46.paper }}>
      <L46FloodCanvas
        uid={uid}
        sceneIndex={sceneIndex}
        obj={obj}
        originX={originX}
        groundY={groundY}
        scale={scale}
        tl={tl}
        fps={fps}
        blueprintAnnotations={
          <g>
            {/* Dimension 1: Overall Width below object */}
            <L46HorizontalDim
              x1={leftX}
              x2={rightX}
              anchorY={groundY}
              dimY={dimBottomY}
              labelNum={obj.widthNum}
              unit={obj.widthUnit}
              prefix={obj.widthLabel.startsWith('Ø') ? 'Ø ' : ''}
              dimP={tl.dimP}
              tickP={tl.tickP}
              arrowFrame={tl.annotFrame}
              fps={fps}
              fontSize={42}
            />
            {/* Dimension 2: Overall Height on right */}
            <L46VerticalDim
              yTop={topY}
              yBottom={groundY}
              anchorX={rightX}
              dimX={dimRightX}
              labelNum={obj.heightNum}
              unit={obj.heightUnit}
              dimP={tl.dimP}
              tickP={tl.tickP}
              arrowFrame={tl.annotFrame}
              fps={fps}
              fontSize={42}
            />
            {/* Dimension 3: Radius / Angle / Bore callout (total = 3 dimensions) */}
            <L46DetailDim
              ax={detailAx}
              ay={detailAy}
              lx={detailLx}
              ly={detailLy}
              labelPrefix={detailPrefix}
              labelNum={obj.detailNum}
              unit={obj.detailUnit}
              dimP={tl.dimP}
              tickP={tl.tickP}
              arrowFrame={tl.annotFrame}
              fps={fps}
            />
          </g>
        }
      />

      {/* Top-Left Blueprint Title rising above thin rule */}
      <L46RisingLabel
        title={t.title || obj.code}
        subtitle={t.subtitle || undefined}
        codeTag={t.badge ? `${obj.code} · ${t.badge}` : `${obj.code} · REV 01`}
        x={labelLeft}
        y={132}
        width={labelWidth}
        ruleP={tl.ruleP}
        labelP={tl.labelP}
        baseSize={74}
        minSize={38}
        maxLines={2}
      />
    </div>
  );
};

// ============================================================================
// SHOT 2: 'blueprint-process-steps' — Numbered Callouts (max 4) Pointing to Object
// ============================================================================

const Look46BlueprintProcessSteps: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const uid = `l46-steps-${sceneIndex}`;
  const t = sceneTexts(scene);
  const obj = selectObjectR(sceneIndex, scene);
  const tl = computeTimelineR(localFrame, durationFrames);
  const items = extractPointsR(scene, 4);

  const originX = 540;
  const groundY = 1005;
  const scale = 0.86;

  const leftX = originX + obj.bbox.left * scale;
  const rightX = originX + obj.bbox.right * scale;

  // 4 callout shelf positions strictly inside x ∈ [76, 1004], y ∈ [292, 1380]
  const slots = [
    { x: 78, y: 298, w: 424, shelfY: 468, elbowX: 342, align: 'left' as const },
    { x: 578, y: 298, w: 424, shelfY: 468, elbowX: 738, align: 'left' as const },
    { x: 78, y: 1168, w: 424, shelfY: 1164, elbowX: 332, align: 'left' as const },
    { x: 578, y: 1168, w: 424, shelfY: 1164, elbowX: 748, align: 'left' as const },
  ];

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', backgroundColor: L46.paper }}>
      <L46FloodCanvas
        uid={uid}
        sceneIndex={sceneIndex}
        obj={obj}
        originX={originX}
        groundY={groundY}
        scale={scale}
        tl={tl}
        fps={fps}
        blueprintAnnotations={
          <g>
            {/* Single overall width dimension (1 of max 3) */}
            <L46HorizontalDim
              x1={leftX}
              x2={rightX}
              anchorY={groundY}
              dimY={1072}
              labelNum={obj.widthNum}
              unit={obj.widthUnit}
              prefix={obj.widthLabel.startsWith('Ø') ? 'Ø ' : ''}
              dimP={tl.dimP}
              tickP={tl.tickP}
              arrowFrame={tl.annotFrame}
              fps={fps}
              fontSize={36}
            />

            {/* Crisp leader lines from each numbered callout shelf to its anchor on the object */}
            {items.map((_, idx) => {
              const slot = slots[idx];
              const anchor = obj.calloutAnchors[idx % obj.calloutAnchors.length];
              const ax = originX + anchor.x * scale;
              const ay = groundY + anchor.y * scale;
              const startX = idx % 2 === 0 ? slot.x : slot.x + slot.w;
              const elbowX = slot.elbowX;
              const shelfY = slot.shelfY;

              const itemDelay = idx * 3;
              const leaderP = easeOutCubic(l46Progress(tl.annotFrame, itemDelay, 12));
              const dotPop = spring({
                frame: Math.max(0, tl.annotFrame - itemDelay - 4),
                fps,
                config: { damping: 12, stiffness: 280, mass: 0.6 },
              });
              if (leaderP <= 0.01) return null;

              const len =
                Math.abs(elbowX - startX) + l46SegmentLen(elbowX, shelfY, ax, ay) + 8;

              return (
                <g key={`ldr-${idx}`}>
                  <path
                    d={`M ${ax.toFixed(1)} ${ay.toFixed(1)} L ${elbowX.toFixed(1)} ${shelfY.toFixed(1)} L ${startX.toFixed(1)} ${shelfY.toFixed(1)}`}
                    fill="none"
                    stroke={L46.inkWhite}
                    strokeWidth={2}
                    strokeDasharray={len}
                    strokeDashoffset={len * (1 - leaderP)}
                  />
                  {dotPop > 0.02 && (
                    <g transform={`translate(${ax}, ${ay}) scale(${dotPop})`}>
                      <circle cx={0} cy={0} r={9} fill={L46.blueprint} stroke={L46.inkWhite} strokeWidth={2} />
                      <circle cx={0} cy={0} r={3.5} fill={L46.inkWhite} />
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        }
      />

      {/* Top-Left Title Label */}
      <L46RisingLabel
        title={t.title || 'ASSEMBLY SPEC'}
        codeTag={t.badge ? `${obj.code} · ${t.badge}` : `${obj.code} · CALLOUTS`}
        x={78}
        y={122}
        width={924}
        ruleP={tl.ruleP}
        labelP={tl.labelP}
        baseSize={54}
        minSize={32}
        maxLines={2}
      />

      {/* Up to 4 Numbered Callout Cards pointing into the object */}
      {items.map((text, idx) => {
        const slot = slots[idx];
        const revealP = easeOutCubic(l46Progress(tl.annotFrame, 4 + idx * 3, 12));
        if (revealP <= 0.01) return null;
        const isUpper = idx < 2;
        const offsetY = interpolate(revealP, [0, 1], [isUpper ? 24 : -20, 0]);
        const numTag = String(idx + 1).padStart(2, '0');

        return (
          <div
            key={`call-${idx}`}
            style={{
              position: 'absolute',
              left: slot.x,
              top: isUpper ? slot.y : slot.y + 14,
              width: slot.w,
              height: isUpper ? 162 : 200,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: isUpper ? 'flex-end' : 'flex-start',
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                transform: `translateY(${offsetY}px)`,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 14,
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  minWidth: 44,
                  height: 38,
                  border: `2px solid ${L46.inkWhite}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: FONT_L46,
                  fontSize: 24,
                  fontWeight: 600,
                  color: L46.inkWhite,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.04em',
                  marginTop: 4,
                }}
              >
                {numTag}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText
                  text={text}
                  baseSize={30}
                  minSize={20}
                  maxLines={3}
                  color={L46.inkWhite}
                  fontFamily={FONT_L46}
                  fontWeight={500}
                  align="left"
                  lineHeight={1.28}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ============================================================================
// SHOT 3: 'blueprint-dimension-stat' — Stat Value as Giant Primary Dimension + Unit
// ============================================================================

const Look46BlueprintDimensionStat: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const uid = `l46-stat-${sceneIndex}`;
  const t = sceneTexts(scene);
  const obj = selectObjectR(sceneIndex, scene);
  const tl = computeTimelineR(localFrame, durationFrames);
  const stat = extractPrimaryStatR(scene);

  const originX = 486;
  const groundY = 860;
  const scale = 0.94;

  const leftX = originX + obj.bbox.left * scale;
  const rightX = originX + obj.bbox.right * scale;
  const topY = groundY + obj.bbox.top * scale;

  const spanLeft = 104;
  const spanRight = 976;
  const primaryDimY = 1030;

  const primaryArrowPop = spring({
    frame: Math.max(0, tl.annotFrame - 5),
    fps,
    config: { damping: 11, stiffness: 260, mass: 0.65 },
  });
  const extP = clamp01(tl.dimP * 1.4);
  const spanLineP = clamp01((tl.dimP - 0.14) / 0.86);

  const tickedStat = formatTickNumberR(stat.display, stat.numeric, tl.tickP);
  const detailAx = originX + obj.detailCallout.ax * scale;
  const detailAy = groundY + obj.detailCallout.ay * scale;
  const detailLx = Math.min(720, originX + obj.detailCallout.lx * scale);
  const detailLy = Math.max(365, groundY + obj.detailCallout.ly * scale);
  const dimRightX = Math.min(946, Math.max(rightX + 132, detailLx + 196));
  const detailPrefix = obj.detailLabel.startsWith('Ø')
    ? 'Ø '
    : obj.detailLabel.startsWith('R')
      ? 'R '
      : '';

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', backgroundColor: L46.paper }}>
      <L46FloodCanvas
        uid={uid}
        sceneIndex={sceneIndex}
        obj={obj}
        originX={originX}
        groundY={groundY}
        scale={scale}
        tl={tl}
        fps={fps}
        blueprintAnnotations={
          <g>
            {/* Secondary Dimension 1: Object Height */}
            <L46VerticalDim
              yTop={topY}
              yBottom={groundY}
              anchorX={rightX}
              dimX={dimRightX}
              labelNum={obj.heightNum}
              unit={obj.heightUnit}
              dimP={tl.dimP}
              tickP={tl.tickP}
              arrowFrame={tl.annotFrame}
              fps={fps}
              fontSize={36}
            />
            {/* Secondary Dimension 2: Detail Radius/Angle */}
            <L46DetailDim
              ax={detailAx}
              ay={detailAy}
              lx={detailLx}
              ly={detailLy}
              labelPrefix={detailPrefix}
              labelNum={obj.detailNum}
              unit={obj.detailUnit}
              dimP={tl.dimP}
              tickP={tl.tickP}
              arrowFrame={tl.annotFrame}
              fps={fps}
            />

            {/* PRIMARY DIMENSION (3rd of max 3): Giant measurement span beneath object */}
            {tl.dimP > 0.01 && (
              <g>
                {/* Angled drop-out extension lines from object base corners to wide primary span */}
                <path
                  d={`M ${leftX.toFixed(1)} ${(groundY + 14).toFixed(1)} L ${spanLeft} ${(groundY + 76).toFixed(1)} L ${spanLeft} ${(primaryDimY + 34).toFixed(1)}`}
                  fill="none"
                  stroke={L46.inkWhiteSoft}
                  strokeWidth={1.8}
                  strokeDasharray={360}
                  strokeDashoffset={360 * (1 - extP)}
                />
                <path
                  d={`M ${rightX.toFixed(1)} ${(groundY + 14).toFixed(1)} L ${spanRight} ${(groundY + 76).toFixed(1)} L ${spanRight} ${(primaryDimY + 34).toFixed(1)}`}
                  fill="none"
                  stroke={L46.inkWhiteSoft}
                  strokeWidth={1.8}
                  strokeDasharray={360}
                  strokeDashoffset={360 * (1 - extP)}
                />

                {/* Left & right horizontal dimension arms drawing out from center gap */}
                {spanLineP > 0.01 && (
                  <>
                    <line
                      x1={236}
                      y1={primaryDimY}
                      x2={236 - (236 - spanLeft) * spanLineP}
                      y2={primaryDimY}
                      stroke={L46.inkWhite}
                      strokeWidth={3}
                    />
                    <line
                      x1={844}
                      y1={primaryDimY}
                      x2={844 + (spanRight - 844) * spanLineP}
                      y2={primaryDimY}
                      stroke={L46.inkWhite}
                      strokeWidth={3}
                    />
                  </>
                )}

                {/* Crisp solid arrowheads */}
                {primaryArrowPop > 0.02 && (
                  <>
                    <polygon
                      points="0,0 22,-8 22,8"
                      fill={L46.inkWhite}
                      transform={`translate(${spanLeft}, ${primaryDimY}) scale(${primaryArrowPop})`}
                    />
                    <polygon
                      points="0,0 -22,-8 -22,8"
                      fill={L46.inkWhite}
                      transform={`translate(${spanRight}, ${primaryDimY}) scale(${primaryArrowPop})`}
                    />
                  </>
                )}

                {/* Architectural bottom spec frame border (strictly y <= 1392 < 1420) */}
                {tl.ruleP > 0.01 && (
                  <rect
                    x={84}
                    y={1196}
                    width={912 * tl.ruleP}
                    height={190}
                    fill="none"
                    stroke={L46.inkWhiteSoft}
                    strokeWidth={1.8}
                  />
                )}
              </g>
            )}
          </g>
        }
      />

      {/* Top-Left Title Label */}
      <L46RisingLabel
        title={t.title || 'DIMENSION SPEC'}
        codeTag={t.badge ? `${obj.code} · ${t.badge}` : `${obj.code} · METRIC`}
        x={84}
        y={124}
        width={912}
        ruleP={tl.ruleP}
        labelP={tl.labelP}
        baseSize={54}
        minSize={32}
        maxLines={2}
      />

      {/* Giant Primary Dimension Number + Unit (centered between the arrows) */}
      {tl.dimP > 0.05 && (
        <div
          style={{
            position: 'absolute',
            left: 242,
            top: 944,
            width: 596,
            height: 176,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 14, maxWidth: '100%' }}>
            <FitText
              text={tickedStat}
              baseSize={114}
              minSize={52}
              maxLines={1}
              color={L46.inkWhite}
              fontFamily={FONT_L46}
              fontWeight={600}
              align="center"
              lineHeight={1.06}
              style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}
            />
            {stat.unit && !stat.display.includes(stat.unit) && (
              <div
                style={{
                  fontFamily: FONT_L46,
                  fontSize: 44,
                  fontWeight: 500,
                  color: L46.inkWhiteSoft,
                  letterSpacing: '0.04em',
                  flexShrink: 0,
                }}
              >
                {stat.unit}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Architectural Title-Block Spec Box (y = 1208..1378 < 1420) */}
      {tl.labelP > 0.02 && (
        <div
          style={{
            position: 'absolute',
            left: 108,
            top: 1214,
            width: 864,
            height: 156,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              transform: `translateY(${(1 - tl.labelP) * 24}px)`,
            }}
          >
            <div
              style={{
                fontFamily: FONT_L46,
                fontSize: 20,
                fontWeight: 500,
                color: L46.inkWhiteSoft,
                letterSpacing: '0.12em',
                marginBottom: 6,
              }}
            >
              PRIMARY SPECIFICATION
            </div>
            <FitText
              text={stat.label || t.title}
              baseSize={34}
              minSize={22}
              maxLines={2}
              color={L46.inkWhite}
              fontFamily={FONT_L46}
              fontWeight={600}
              align="left"
              lineHeight={1.26}
            />
          </div>

          {stat.delta && (
            <div
              style={{
                flexShrink: 0,
                maxWidth: 260,
                borderLeft: `1.5px solid ${L46.inkWhiteSoft}`,
                paddingLeft: 20,
                transform: `translateY(${(1 - tl.labelP) * 24}px)`,
              }}
            >
              <div
                style={{
                  fontFamily: FONT_L46,
                  fontSize: 19,
                  fontWeight: 500,
                  color: L46.inkWhiteSoft,
                  letterSpacing: '0.1em',
                  marginBottom: 4,
                }}
              >
                DELTA / TOL
              </div>
              <FitText
                text={stat.delta}
                baseSize={32}
                minSize={20}
                maxLines={2}
                color={L46.inkWhite}
                fontFamily={FONT_L46}
                fontWeight={600}
                align="left"
                lineHeight={1.2}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// SHOT 4: 'blueprint-sketch-vs-spec' — Left Pencil, Right Blueprint in One Drawing
// Divided by Irregular Wet-Ink Edge + Darker Tide Line (for Compare or Quote)
// ============================================================================

const Look46BlueprintSketchVsSpec: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const uid = `l46-split-${sceneIndex}`;
  const t = sceneTexts(scene);
  const obj = selectObjectR(sceneIndex, scene);
  const tl = computeTimelineR(localFrame, durationFrames);

  const originX = 540;
  const groundY = 852;
  const scale = 0.94;

  // Wet-ink vertical wave sweeps from right edge (1160) and settles at exact center x = 540
  const divideBaseX = interpolate(tl.floodP, [0, 1], [1160, 540]);
  const splitSeed = sceneIndex * 43 + 464;
  const split = l46VerticalSplitPaths(divideBaseX, splitSeed);

  const rightX = originX + obj.bbox.right * scale;
  const topY = groundY + obj.bbox.top * scale;

  const detailAx = originX + Math.abs(obj.detailCallout.ax) * scale;
  const detailAy = groundY + obj.detailCallout.ay * scale;
  const detailLx = Math.min(706, originX + Math.max(88, obj.detailCallout.lx * scale));
  const detailLy = Math.max(350, groundY + obj.detailCallout.ly * scale);
  const dimRightX = Math.min(946, Math.max(rightX + 132, detailLx + 202));
  const detailPrefix = obj.detailLabel.startsWith('Ø')
    ? 'Ø '
    : obj.detailLabel.startsWith('R')
      ? 'R '
      : '';

  const isCompare = Boolean(scene.compare);
  const leftTitle = scene.compare?.leftTitle?.trim() || 'DRAFT · สเก็ตช์';
  const rightTitle = scene.compare?.rightTitle?.trim() || 'SPEC · พิมพ์เขียว';
  const leftItems = (scene.compare?.leftItems || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 3);
  const rightItems = (scene.compare?.rightItems || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 3);

  const quoteText = scene.quote?.text?.trim() || t.subtitle || t.title;
  const quoteAuthor = scene.quote?.author?.trim() || t.badge || obj.code;

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', backgroundColor: L46.paper }}>
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, display: 'block' }}
      >
        <L46Defs uid={uid} sceneIndex={sceneIndex} />

        {/* Vertical wet-ink split mask */}
        <mask id={`${uid}-split-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={STAGE_W} height={STAGE_H}>
          <rect x="0" y="0" width={STAGE_W} height={STAGE_H} fill="#000000" />
          {tl.floodP > 0.005 && (
            <path
              d={split.rightFillPath}
              fill="#FFFFFF"
              filter={`url(#${uid}-wet)`}
            />
          )}
        </mask>

        {/* LEFT / BASE LAYER: GRAPH PAPER + PENCIL SKETCH */}
        <g>
          <rect x="0" y="0" width={STAGE_W} height={STAGE_H} fill={L46.paper} />
          <rect x="0" y="0" width={STAGE_W} height={STAGE_H} fill={`url(#${uid}-paper-grid)`} />

          <g stroke={L46.grid} strokeOpacity="0.48" strokeWidth="1.5" fill="none">
            <path d="M 54 112 L 54 136 M 54 112 L 78 112" />
            <path d="M 54 1420 L 54 1396 M 54 1420 L 78 1420" />
          </g>

          <L46PencilObjectLayer
            obj={obj}
            originX={originX}
            groundY={groundY}
            scale={scale}
            tl={tl}
            sceneIndex={sceneIndex}
            uid={uid}
          />
        </g>

        {/* RIGHT / FLOODED BLUEPRINT LAYER (SAME DRAWING, MASKED BY WET EDGE) */}
        {tl.floodP > 0.005 && (
          <g mask={`url(#${uid}-split-mask)`}>
            <rect x="0" y="0" width={STAGE_W} height={STAGE_H} fill={L46.blueprint} />
            <rect x="0" y="0" width={STAGE_W} height={STAGE_H} filter={`url(#${uid}-mottle)`} />
            <rect x="0" y="0" width={STAGE_W} height={STAGE_H} fill={`url(#${uid}-bp-grid)`} />

            <g stroke={L46.inkWhiteFaint} strokeWidth="1.5" fill="none">
              <path d="M 1026 112 L 1026 136 M 1026 112 L 1002 112" />
              <path d="M 1026 1420 L 1026 1396 M 1026 1420 L 1002 1420" />
            </g>

            {/* Darker wet-ink tide line hugging the inside of the vertical divide */}
            <g filter={`url(#${uid}-wet)`} fill="none">
              <path d={split.edgePath} stroke={L46.tide} strokeWidth={40} strokeOpacity="0.88" />
              <path d={split.edgePath} stroke={L46.tide} strokeWidth={16} strokeOpacity="1" />
            </g>

            <L46BlueprintObjectLayer
              obj={obj}
              originX={originX}
              groundY={groundY}
              scale={scale}
              tl={tl}
              fps={fps}
            />

            {/* 2 Crisp blueprint dimensions on the right half (<= 3 total) */}
            <L46VerticalDim
              yTop={topY}
              yBottom={groundY}
              anchorX={rightX}
              dimX={dimRightX}
              labelNum={obj.heightNum}
              unit={obj.heightUnit}
              dimP={tl.dimP}
              tickP={tl.tickP}
              arrowFrame={tl.annotFrame}
              fps={fps}
              fontSize={36}
            />
            <L46DetailDim
              ax={detailAx}
              ay={detailAy}
              lx={detailLx}
              ly={detailLy}
              labelPrefix={detailPrefix}
              labelNum={obj.detailNum}
              unit={obj.detailUnit}
              dimP={tl.dimP}
              tickP={tl.tickP}
              arrowFrame={tl.annotFrame}
              fps={fps}
            />
          </g>
        )}

        {/* Fine deterministic paper grain across entire stage */}
        <rect
          x="0"
          y="0"
          width={STAGE_W}
          height={STAGE_H}
          filter={`url(#${uid}-grain)`}
          opacity="0.065"
          style={{ mixBlendMode: 'multiply', pointerEvents: 'none' }}
        />
      </svg>

      {/* CONTENT OVERLAY: COMPARE MODE vs QUOTE MODE (ALL TEXT <= y=1400) */}
      {isCompare ? (
        <>
          {/* Left Header on Paper Side (Graphite #25262B) */}
          <L46RisingLabel
            title={leftTitle}
            codeTag="01 · PENCIL DRAFT"
            x={76}
            y={128}
            width={420}
            ruleP={tl.ruleP}
            labelP={tl.labelP}
            color={L46.pencil}
            ruleColor={L46.pencilSoft}
            baseSize={46}
            minSize={28}
            maxLines={2}
          />

          {/* Right Header on Blueprint Side (White #EEF4FB) */}
          <L46RisingLabel
            title={rightTitle}
            codeTag="02 · BLUEPRINT SPEC"
            x={584}
            y={128}
            width={420}
            ruleP={tl.ruleP}
            labelP={tl.labelP}
            color={L46.inkWhite}
            ruleColor={L46.inkWhiteSoft}
            baseSize={46}
            minSize={28}
            maxLines={2}
          />

          {/* Left Comparison Items (y = 928..1386, pure paper side) */}
          <div
            style={{
              position: 'absolute',
              left: 76,
              top: 932,
              width: 422,
              height: 454,
              display: 'flex',
              flexDirection: 'column',
              gap: 24,
              pointerEvents: 'none',
            }}
          >
            {leftItems.map((item, idx) => {
              const p = easeOutCubic(l46Progress(tl.annotFrame, 3 + idx * 4, 12));
              if (p <= 0.01) return null;
              return (
                <div
                  key={`li-${idx}`}
                  style={{
                    overflow: 'hidden',
                    borderTop: `1.5px solid rgba(37, 38, 43, 0.32)`,
                    paddingTop: 12,
                  }}
                >
                  <div
                    style={{
                      transform: `translateY(${(1 - p) * 24}px)`,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        flexShrink: 0,
                        fontFamily: FONT_L46,
                        fontSize: 22,
                        fontWeight: 600,
                        color: L46.pencilSoft,
                        fontVariantNumeric: 'tabular-nums',
                        marginTop: 5,
                      }}
                    >
                      {`—`}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FitText
                        text={item}
                        baseSize={30}
                        minSize={21}
                        maxLines={3}
                        color={L46.pencil}
                        fontFamily={FONT_L46}
                        fontWeight={500}
                        align="left"
                        lineHeight={1.28}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right Comparison Items (y = 928..1386, pure blueprint side) */}
          <div
            style={{
              position: 'absolute',
              left: 584,
              top: 932,
              width: 422,
              height: 454,
              display: 'flex',
              flexDirection: 'column',
              gap: 24,
              pointerEvents: 'none',
            }}
          >
            {rightItems.map((item, idx) => {
              const p = easeOutCubic(l46Progress(tl.annotFrame, 5 + idx * 4, 12));
              if (p <= 0.01) return null;
              return (
                <div
                  key={`ri-${idx}`}
                  style={{
                    overflow: 'hidden',
                    borderTop: `1.5px solid ${L46.inkWhiteFaint}`,
                    paddingTop: 12,
                  }}
                >
                  <div
                    style={{
                      transform: `translateY(${(1 - p) * 24}px)`,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        flexShrink: 0,
                        fontFamily: FONT_L46,
                        fontSize: 22,
                        fontWeight: 600,
                        color: L46.inkWhiteSoft,
                        fontVariantNumeric: 'tabular-nums',
                        marginTop: 5,
                      }}
                    >
                      {String(idx + 1).padStart(2, '0')}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FitText
                        text={item}
                        baseSize={30}
                        minSize={21}
                        maxLines={3}
                        color={L46.inkWhite}
                        fontFamily={FONT_L46}
                        fontWeight={600}
                        align="left"
                        lineHeight={1.28}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {/* Quote Mode Headers */}
          <L46RisingLabel
            title={t.title || 'SKETCH'}
            codeTag="IDEA · DRAFT"
            x={76}
            y={128}
            width={420}
            ruleP={tl.ruleP}
            labelP={tl.labelP}
            color={L46.pencil}
            ruleColor={L46.pencilSoft}
            baseSize={46}
            minSize={28}
            maxLines={2}
          />
          <L46RisingLabel
            title={obj.code}
            codeTag="SPEC · BLUEPRINT"
            x={584}
            y={128}
            width={420}
            ruleP={tl.ruleP}
            labelP={tl.labelP}
            color={L46.inkWhite}
            ruleColor={L46.inkWhiteSoft}
            baseSize={44}
            minSize={26}
            maxLines={2}
          />

          {/* Synchronized Dual-Ink Quote Block: Graphite left of wet edge, Crisp White right of wet edge */}
          {tl.labelP > 0.02 && (
            <>
              {/* Paper-side graphite quote */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  clipPath: split.leftCssPolygon,
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 84,
                    top: 936,
                    width: 912,
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ transform: `translateY(${(1 - tl.labelP) * 28}px)` }}>
                    <FitText
                      text={`“${quoteText}”`}
                      baseSize={44}
                      minSize={26}
                      maxLines={4}
                      color={L46.pencil}
                      fontFamily={FONT_L46}
                      fontWeight={600}
                      align="left"
                      lineHeight={1.34}
                    />
                  </div>
                  <div
                    style={{
                      marginTop: 22,
                      width: `${Math.round(tl.ruleP * 100)}%`,
                      height: 2,
                      backgroundColor: L46.pencil,
                    }}
                  />
                </div>
              </div>

              {/* Blueprint-side crisp white quote (exact pixel coordinates, seamless ink transition) */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  clipPath: split.rightCssPolygon,
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 84,
                    top: 936,
                    width: 912,
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ transform: `translateY(${(1 - tl.labelP) * 28}px)` }}>
                    <FitText
                      text={`“${quoteText}”`}
                      baseSize={44}
                      minSize={26}
                      maxLines={4}
                      color={L46.inkWhite}
                      fontFamily={FONT_L46}
                      fontWeight={600}
                      align="left"
                      lineHeight={1.34}
                    />
                  </div>
                  <div
                    style={{
                      marginTop: 22,
                      width: `${Math.round(tl.ruleP * 100)}%`,
                      height: 2,
                      backgroundColor: L46.inkWhite,
                    }}
                  />
                </div>
              </div>

              {/* Attribution on blueprint side (y = 1304..1388 < 1420) */}
              <div
                style={{
                  position: 'absolute',
                  left: 556,
                  top: 1304,
                  width: 446,
                  overflow: 'hidden',
                  pointerEvents: 'none',
                }}
              >
                <div style={{ transform: `translateY(${(1 - tl.labelP) * 18}px)` }}>
                  <FitText
                    text={`— ${quoteAuthor}`}
                    baseSize={26}
                    minSize={16}
                    maxLines={2}
                    color={L46.inkWhite}
                    fontFamily={FONT_L46}
                    fontWeight={500}
                    align="right"
                    lineHeight={1.26}
                    style={{ letterSpacing: '0.02em', textTransform: 'uppercase' }}
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

// ============================================================================
// EXPORTED REGISTRY DEFINITIONS — BATCH_R (look-46)
// ============================================================================

const L46_PROCESS_RE = /(?:ขั้นตอน|กระบวนการ|ส่วนประกอบ|โครงสร้าง|วิธี|ระบบ|ออกแบบ|วิศวกรรม|step|process|part|spec|blueprint)/i;

// Keep safe constants referenced cleanly for audit parity with sibling batches
void CONTENT_BOTTOM;
void SAFE_TOP;
void SAFE_W;

export const BATCH_R: StyleDirectorDef[] = [
  {
    styleId: 'look-46',
    caption: 'bar',
    shots: {
      'blueprint-object-title': Look46BlueprintObjectTitle,
      'blueprint-process-steps': Look46BlueprintProcessSteps,
      'blueprint-dimension-stat': Look46BlueprintDimensionStat,
      'blueprint-sketch-vs-spec': Look46BlueprintSketchVsSpec,
    },
    shotLabels: {
      'blueprint-object-title':
        'สเก็ตช์ดินสอวัตถุด้านข้างบนกระดาษกราฟแล้วหมึกพิมพ์เขียวท่วมเปลี่ยนเป็นเส้นขาวตรงคมพร้อมระยะวัดและป้ายหัวข้อบนซ้าย',
      'blueprint-process-steps':
        'วัตถุดินสอสู่พิมพ์เขียวพร้อมเส้นชี้และป้ายคำอธิบายแบบมีหมายเลขชี้ตรงไปยังส่วนประกอบต่าง ๆ ของวัตถุสูงสุด 4 จุด',
      'blueprint-dimension-stat':
        'แบบพิมพ์เขียวที่แสดงตัวเลขสถิติหลักเป็นค่าระยะวัดขนาดใหญ่พร้อมหน่วยและลูกศรวัดระยะแบบวิศวกรรม',
      'blueprint-sketch-vs-spec':
        'ภาพวาดเดียวแบ่งด้วยแนวขอบหมึกเปียก ฝั่งซ้ายเป็นสเก็ตช์ดินสอ ฝั่งขวาเป็นแบบพิมพ์เขียว สำหรับเปรียบเทียบหรือคำคม',
    },
    infer: (scene) => {
      if (scene.stat) {
        return 'blueprint-dimension-stat';
      }
      if (scene.compare || scene.quote?.text) {
        return 'blueprint-sketch-vs-spec';
      }
      if (
        (Array.isArray(scene.bullets) && scene.bullets.length >= 3) ||
        (Array.isArray(scene.steps) && scene.steps.length >= 2)
      ) {
        return 'blueprint-process-steps';
      }
      const text = haystackOfR(scene);
      if (L46_PROCESS_RE.test(text) && scene.bullets && scene.bullets.length >= 2) {
        return 'blueprint-process-steps';
      }
      return null;
    },
  },
];
