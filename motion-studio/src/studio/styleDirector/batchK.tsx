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
// SHARED HELPERS FOR BATCH K (look-33 Stat Chart, look-34 App Mockup)
// Pure, Deterministic, Inline SVG/CSS Only, Zero External Assets
// Safe stage bounds: x ∈ [54, 1026], y ∈ [112, CONTENT_BOTTOM (=1420)]
// ============================================================================

const CONTENT_BOTTOM = SAFE_BOTTOM - 120; // 1420
const SAFE_X = 54;
const SAFE_W = STAGE_W - SAFE_X * 2; // 972
const SAFE_TOP = 112;

const FONT_THAI = THAI_FONT_FAMILY;
const FONT_NUM = "'Inter', 'Plus Jakarta Sans', 'Noto Sans Thai', sans-serif";
const FONT_MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

// Regex classifiers for intelligent shot inference
const K_EVENT_RE =
  /(?:เหตุการณ์|จุดเปลี่ยน|หลังจาก|พลิกเกม|จุดพลิกผัน|เปลี่ยนผ่าน|ก่อนหน้า|inflection|turning\s*point|milestone|event|pivot)/i;
const K_COMPARE_RE =
  /(?:เทียบ|เปรียบเทียบ|ก่อนและหลัง|ก่อน-หลัง|แบบเดิม|แบบใหม่|ต่างกัน|vs\.?|before|after|compare)/i;
const K_ONBOARD_RE =
  /(?:ขั้นตอน|สเต็ป|เริ่มต้นใช้งาน|ติดตั้ง|ตั้งค่า|onboarding|step-by-step|setup|walkthrough)/i;
const K_APP_HERO_RE =
  /(?:เปิดตัวแอป|แอปพลิเคชัน|หน้าจอแอป|ม็อกอัป|แดชบอร์ด|อินเทอร์เฟซ|app\s*launch|mockup|product\s*demo)/i;

function seededHashK(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

function stringSeedK(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 10000;
}

function haystackOfK(scene: StudioScene): string {
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

function extractPointsK(scene: StudioScene, max = 4): string[] {
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

function extractStepObjectsK(
  scene: StudioScene,
  fallbackLabels: string[],
  max = 4,
): Array<{ tag: string; title: string; detail: string }> {
  const out: Array<{ tag: string; title: string; detail: string }> = [];
  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    scene.steps.slice(0, max).forEach((s, idx) => {
      if (typeof s === 'string') {
        out.push({
          tag: fallbackLabels[idx] || `0${idx + 1}`,
          title: s.trim(),
          detail: '',
        });
      } else if (s?.title) {
        out.push({
          tag: s.step || fallbackLabels[idx] || `0${idx + 1}`,
          title: s.title.trim(),
          detail: (s.detail || '').trim(),
        });
      }
    });
  } else {
    const pts = extractPointsK(scene, max);
    pts.forEach((p, idx) => {
      out.push({
        tag: fallbackLabels[idx] || `0${idx + 1}`,
        title: p,
        detail: '',
      });
    });
  }
  return out;
}

interface ParsedStatK {
  prefix: string;
  target: number;
  decimals: number;
  useComma: boolean;
  suffix: string;
  unit: string;
  label: string;
  delta: string;
  progress: number;
}

function formatNumberK(val: number, decimals: number, useComma: boolean): string {
  const safeVal = Number.isFinite(val) ? val : 0;
  const fixed = safeVal.toFixed(Math.max(0, Math.min(3, decimals)));
  if (!useComma) return fixed;
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function parseStatValueK(
  scene: StudioScene,
  sceneIndex: number,
  defaultTarget: number,
  defaultUnit: string,
): ParsedStatK {
  const t = sceneTexts(scene);
  const st = scene.stat;

  if (st && st.value !== undefined && String(st.value).trim() !== '') {
    const raw = String(st.value).trim();
    const m = raw.match(/^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
    let prefix = String(st.prefix || '').trim();
    let numStr = '';
    let suffix = String(st.suffix || '').trim();
    if (m) {
      if (!prefix && m[1]) prefix = m[1].trim();
      numStr = m[2];
      if (!suffix && m[3]) suffix = m[3].trim();
    }
    const cleanNum = numStr.replace(/,/g, '');
    const parsedNum =
      typeof st.numericValue === 'number' && Number.isFinite(st.numericValue)
        ? st.numericValue
        : cleanNum
          ? parseFloat(cleanNum)
          : defaultTarget;
    const target = Number.isFinite(parsedNum) ? parsedNum : defaultTarget;
    const decPart = cleanNum.includes('.') ? cleanNum.split('.')[1] : '';
    const decimals = Math.min(2, decPart.length);
    const useComma = numStr.includes(',') || Math.abs(target) >= 1000;
    const unit = String(st.unit || '').trim();
    const progress =
      typeof st.progress === 'number' && Number.isFinite(st.progress)
        ? clamp01(st.progress / 100)
        : suffix.includes('%') || unit.includes('%')
          ? clamp01(target / 100)
          : 0.84;

    return {
      prefix,
      target,
      decimals,
      useComma,
      suffix,
      unit: unit && !suffix.includes(unit) ? unit : '',
      label: String(st.label || t.subtitle || t.title).trim(),
      delta: String(st.delta || '').trim(),
      progress,
    };
  }

  if (t.numbers.length > 0) {
    const first = t.numbers[0];
    const m = first.match(/^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
    const numStr = m ? m[2] : '';
    const cleanNum = numStr.replace(/,/g, '');
    const target = cleanNum ? parseFloat(cleanNum) : defaultTarget;
    const decPart = cleanNum.includes('.') ? cleanNum.split('.')[1] : '';
    return {
      prefix: m && m[1] ? m[1].trim() : '',
      target: Number.isFinite(target) ? target : defaultTarget,
      decimals: Math.min(2, decPart.length),
      useComma: numStr.includes(',') || Math.abs(target) >= 1000,
      suffix: m && m[3] ? m[3].trim() : '',
      unit: '',
      label: t.subtitle || t.title,
      delta: '',
      progress: first.includes('%') ? clamp01(target / 100) : 0.82,
    };
  }

  const seededTarget = defaultTarget + (sceneIndex % 5) * 14;
  return {
    prefix: '',
    target: seededTarget,
    decimals: 0,
    useComma: seededTarget >= 1000,
    suffix: defaultUnit === '%' ? '%' : '',
    unit: defaultUnit === '%' ? '' : defaultUnit,
    label: t.subtitle || t.title || 'ดัชนีการเติบโตหลัก',
    delta: '+24.6%',
    progress: 0.86,
  };
}

function extractComparePairK(
  scene: StudioScene,
  defaultLeft: string,
  defaultRight: string,
): { leftTitle: string; rightTitle: string; leftItems: string[]; rightItems: string[] } {
  const t = sceneTexts(scene);
  if (scene.compare) {
    const leftItems = (scene.compare.leftItems || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 3);
    const rightItems = (scene.compare.rightItems || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 3);
    return {
      leftTitle: String(scene.compare.leftTitle || scene.compare.leftLabel || defaultLeft).trim(),
      rightTitle: String(scene.compare.rightTitle || scene.compare.rightLabel || defaultRight).trim(),
      leftItems: leftItems.length > 0 ? leftItems : ['ค่าเฉลี่ยช่วงก่อนหน้า'],
      rightItems: rightItems.length > 0 ? rightItems : ['ผลลัพธ์ใหม่ที่เติบโตชัดเจน'],
    };
  }
  const pts = extractPointsK(scene, 4);
  if (pts.length >= 2) {
    const half = Math.ceil(pts.length / 2);
    return {
      leftTitle: defaultLeft,
      rightTitle: defaultRight,
      leftItems: pts.slice(0, Math.min(2, half)),
      rightItems: pts.slice(half, half + 2),
    };
  }
  return {
    leftTitle: defaultLeft,
    rightTitle: defaultRight,
    leftItems: [pts[0] || t.subtitle || 'ฐานข้อมูลเดิมก่อนปรับปรุง'],
    rightItems: [t.title || 'ผลลัพธ์หลังปรับกลยุทธ์'],
  };
}

function polylineLengthK(pts: Array<[number, number]>): number {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return total;
}

function samplePolylineK(
  pts: Array<[number, number]>,
  tRaw: number,
): { x: number; y: number } {
  const t = clamp01(tRaw);
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return { x: pts[0][0], y: pts[0][1] };

  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segLens.push(len);
    total += len;
  }
  if (total <= 0) return { x: pts[0][0], y: pts[0][1] };

  let target = t * total;
  for (let i = 0; i < segLens.length; i++) {
    const len = segLens[i];
    if (target <= len || i === segLens.length - 1) {
      const ratio = len > 0 ? clamp01(target / len) : 0;
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      return {
        x: x1 + (x2 - x1) * ratio,
        y: y1 + (y2 - y1) * ratio,
      };
    }
    target -= len;
  }
  const last = pts[pts.length - 1];
  return { x: last[0], y: last[1] };
}

function pointsToSvgAttrK(pts: Array<[number, number]>): string {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function buildGrowthSeriesK(seed: number, count: number, pivotIdx: number): number[] {
  const vals: number[] = [];
  for (let i = 0; i < count; i++) {
    const jitter = (seededHashK(seed + i * 17.3) - 0.5) * 0.055;
    if (i <= pivotIdx) {
      const frac = pivotIdx > 0 ? i / pivotIdx : 0;
      const base = 0.14 + frac * 0.16 + jitter;
      vals.push(Math.max(0.08, Math.min(0.38, base)));
    } else {
      const frac = (i - pivotIdx) / Math.max(1, count - 1 - pivotIdx);
      const eased = 1 - Math.pow(1 - frac, 1.55);
      const base = 0.34 + eased * 0.62 + jitter * 0.65;
      vals.push(Math.max(0.32, Math.min(0.98, base)));
    }
  }
  vals[count - 1] = 0.96;
  return vals;
}

// ============================================================================
// STYLE 1: look-33 — STAT CHART (กราฟสถิติ)
// Near-black terminal (#0A0B0D) • White grid (0.07) • Crisp text (#F4F5F6)
// Muted label (#8B9098) • Source (#4A4F57) • Soft white line (#E9EBEE)
// Single Chromatic Accent: Hot Orange (#FF5B1F) after event ONLY
// ============================================================================

const L33_BG = '#0A0B0D';
const L33_SURFACE = '#111317';
const L33_SURFACE_2 = '#161920';
const L33_FG = '#F4F5F6';
const L33_LABEL = '#8B9098';
const L33_SOURCE = '#4A4F57';
const L33_LINE_PRE = '#E9EBEE';
const L33_ORANGE = '#FF5B1F';
const L33_GRID = 'rgba(255, 255, 255, 0.07)';
const L33_HAIRLINE = 'rgba(255, 255, 255, 0.09)';

const MONTHS_MONO_K = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const Look33TerminalHeader: React.FC<{
  badge: string;
  rightCode: string;
  localFrame: number;
}> = ({ badge, rightCode, localFrame }) => {
  const p = appear(localFrame, 0, 10);
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE_X,
        top: SAFE_TOP,
        width: SAFE_W,
        opacity: p,
        transform: `translateY(${(1 - p) * -10}px)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 14,
          borderBottom: `1px solid ${L33_HAIRLINE}`,
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
          {/* Minimal geometric terminal mark (pure monochrome) */}
          <svg width="24" height="24" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <rect x="2" y="2" width="20" height="20" rx="3" fill="none" stroke={L33_LINE_PRE} strokeWidth="1.8" />
            <rect x="6" y="13" width="3" height="5" fill={L33_LINE_PRE} />
            <rect x="10.5" y="9" width="3" height="9" fill={L33_LINE_PRE} />
            <rect x="15" y="6" width="3" height="12" fill={L33_LINE_PRE} />
          </svg>
          <div style={{ minWidth: 0, flex: 1 }}>
            <FitText
              text={badge || 'ANALYTICS TERMINAL'}
              baseSize={22}
              minSize={17}
              maxLines={1}
              lineHeight={1.3}
              color={L33_FG}
              fontWeight={700}
              align="left"
            />
          </div>
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: '0.12em',
            color: L33_LABEL,
            flexShrink: 0,
            textTransform: 'uppercase',
          }}
        >
          {rightCode}
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-33 Shot 1: 'counter-line'
// Huge tabular counter synced to line tip; line turns #FF5B1F at event pivot
// ----------------------------------------------------------------------------
const Look33CounterLine: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps }) => {
  const t = sceneTexts(scene);
  const parsed = parseStatValueK(scene, sceneIndex, 248, '%');
  const seed = stringSeedK(`${scene.id}-${t.title}-${sceneIndex}`);

  const safeDur = Math.max(45, durationFrames);
  const drawEnd = Math.max(28, Math.min(safeDur - 18, Math.round(safeDur * 0.72)));

  // Smooth non-linear timeline: steady before pivot, accelerates after pivot, eases gently to end
  const rawT = interpolate(localFrame, [0, drawEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const lineProgress = easeOutCubic(rawT);

  const countPts = 12;
  const pivotIdx = 5;
  const values = buildGrowthSeriesK(seed, countPts, pivotIdx);

  // Chart geometry inside SVG (972 × 540)
  const chartW = SAFE_W;
  const chartH = 540;
  const padL = 16;
  const padR = 112; // room for right-side Y-axis + forecast strip
  const padT = 56;
  const padB = 56;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const dataPlotW = plotW * 0.87; // right 13% is hatched forecast zone

  const allPts: Array<[number, number]> = values.map((v, i) => {
    const x = padL + (i / (countPts - 1)) * dataPlotW;
    const y = padT + (1 - v) * plotH;
    return [x, y];
  });

  const prePts = allPts.slice(0, pivotIdx + 1);
  const postPts = allPts.slice(pivotIdx);

  const preLen = polylineLengthK(prePts);
  const postLen = polylineLengthK(postPts);
  const totalLen = Math.max(1, preLen + postLen);
  const pivotFrac = preLen / totalLen;

  const drawnLen = lineProgress * totalLen;
  const preDrawn = Math.min(preLen, drawnLen);
  const postDrawn = Math.max(0, drawnLen - preLen);

  const isPostEvent = lineProgress >= pivotFrac;
  const tipPos = samplePolylineK(allPts, lineProgress);

  // Value under the line tip drives the giant tabular counter (never wobbles or overshoots)
  const tipNorm = clamp01((padT + plotH - tipPos.y) / Math.max(1, plotH));
  const minValNorm = values[0];
  const maxValNorm = values[countPts - 1];
  const countRatio = clamp01((tipNorm - minValNorm * 0.55) / Math.max(0.01, maxValNorm - minValNorm * 0.55));
  const currentNum = lineProgress >= 0.999 ? parsed.target : parsed.target * countRatio;
  const formattedCount = formatNumberK(currentNum, parsed.decimals, parsed.useComma);

  // Active month readout synced to tip X
  const monthIdx = Math.min(11, Math.max(0, Math.round(lineProgress * 11)));
  const activeMonthLabel = `${MONTHS_MONO_K[monthIdx]} · 2025`;

  // Event marker ring & callout snap-in at exact moment line crosses pivot
  const pivotFrame = Math.round(drawEnd * Math.pow(1 - (1 - pivotFrac), 1 / 3));
  const eventPop = isPostEvent
    ? spring({
        frame: Math.max(0, localFrame - Math.max(4, pivotFrame - 2)),
        fps,
        config: { damping: 14, stiffness: 210, mass: 0.7 },
      })
    : 0;

  // Delta chip pops with slight overshoot once counter lands
  const deltaPop =
    localFrame >= drawEnd - 4
      ? spring({
          frame: Math.max(0, localFrame - (drawEnd - 4)),
          fps,
          config: { damping: 12, stiffness: 220, mass: 0.75 },
        })
      : 0;

  // End-point ping ring
  const pingFrac = interpolate(localFrame, [drawEnd, drawEnd + 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const pivotPt = allPts[pivotIdx];
  const endPt = allPts[allPts.length - 1];

  const preAreaD = [
    `M ${prePts[0][0].toFixed(1)} ${(padT + plotH).toFixed(1)}`,
    ...prePts.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`),
    `L ${prePts[prePts.length - 1][0].toFixed(1)} ${(padT + plotH).toFixed(1)}`,
    'Z',
  ].join(' ');

  const postAreaD = [
    `M ${postPts[0][0].toFixed(1)} ${(padT + plotH).toFixed(1)}`,
    ...postPts.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`),
    `L ${postPts[postPts.length - 1][0].toFixed(1)} ${(padT + plotH).toFixed(1)}`,
    'Z',
  ].join(' ');

  const deltaText = parsed.delta || `+${Math.round(42 + seededHashK(seed + 5) * 48)}%`;
  const impactLine = t.bullets[0] || t.subtitle || t.title;
  const calloutText =
    t.bullets[1] ||
    (Array.isArray(scene.highlight) ? scene.highlight[0] : scene.highlight) ||
    'จุดเร่งตัวหลังปรับระบบ';
  const sourceLine = scene.source ? `SOURCE: ${scene.source}` : 'SERIES INDEX · VERIFIED METRIC FEED';

  const gradWhiteId = `l33-cl-w-${sceneIndex}`;
  const gradOrangeId = `l33-cl-o-${sceneIndex}`;
  const hatchId = `l33-cl-h-${sceneIndex}`;
  const clipFillId = `l33-cl-cf-${sceneIndex}`;

  const yTicks = [1, 0.75, 0.5, 0.25, 0];

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width: STAGE_W,
        height: STAGE_H,
        backgroundColor: L33_BG,
        overflow: 'hidden',
      }}
    >
      <Look33TerminalHeader badge={t.badge || 'STAT TERMINAL'} rightCode="SERIES · 12M" localFrame={localFrame} />

      {/* Metric Label + Giant Tabular Counter */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 188,
          width: SAFE_W,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <FitText
            text={parsed.label || t.title || 'ดัชนีสถิติสำคัญ'}
            baseSize={30}
            minSize={22}
            maxLines={2}
            lineHeight={1.32}
            color={L33_LABEL}
            fontWeight={600}
            align="left"
          />
        </div>

        {/* Giant Tabular Figure */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            marginTop: 4,
            fontFamily: FONT_NUM,
            fontVariantNumeric: 'tabular-nums',
            color: L33_FG,
            lineHeight: 1.05,
          }}
        >
          {parsed.prefix ? (
            <span
              style={{
                fontSize: 64,
                fontWeight: 800,
                color: L33_LABEL,
                transform: 'translateY(-36px)',
                display: 'inline-block',
              }}
            >
              {parsed.prefix}
            </span>
          ) : null}
          <span
            style={{
              fontSize: formattedCount.length > 7 ? 116 : formattedCount.length > 5 ? 136 : 158,
              fontWeight: 900,
              letterSpacing: '-0.04em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formattedCount}
          </span>
          {parsed.suffix ? (
            <span
              style={{
                fontSize: 82,
                fontWeight: 800,
                color: isPostEvent ? L33_ORANGE : L33_LINE_PRE,
                letterSpacing: '-0.02em',
              }}
            >
              {parsed.suffix}
            </span>
          ) : null}
          {parsed.unit ? (
            <span
              style={{
                fontFamily: FONT_THAI,
                fontSize: 42,
                fontWeight: 700,
                color: L33_LABEL,
                marginLeft: 6,
              }}
            >
              {parsed.unit}
            </span>
          ) : null}
        </div>

        {/* Sub-row: Orange delta chip + 1-line impact + dynamic date */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            marginTop: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 16px',
                borderRadius: 8,
                backgroundColor: L33_ORANGE,
                color: '#0A0B0D',
                fontFamily: FONT_MONO,
                fontSize: 22,
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
                transform: `scale(${deltaPop.toFixed(3)})`,
                opacity: clamp01(deltaPop * 1.4),
              }}
            >
              <span>▲</span>
              <span>{deltaText}</span>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <FitText
                text={impactLine}
                baseSize={24}
                minSize={18}
                maxLines={1}
                lineHeight={1.32}
                color={L33_LABEL}
                fontWeight={500}
                align="left"
              />
            </div>
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '0.1em',
              color: isPostEvent ? L33_FG : L33_LABEL,
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
            }}
          >
            {activeMonthLabel}
          </div>
        </div>
      </div>

      {/* Main Chart Container (y=505..1045) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 505,
          width: chartW,
          height: chartH,
        }}
      >
        <svg width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`} style={{ display: 'block' }}>
          <defs>
            <linearGradient id={gradWhiteId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={L33_LINE_PRE} stopOpacity="0.16" />
              <stop offset="100%" stopColor={L33_LINE_PRE} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={gradOrangeId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={L33_ORANGE} stopOpacity="0.22" />
              <stop offset="100%" stopColor={L33_ORANGE} stopOpacity="0" />
            </linearGradient>
            <pattern id={hatchId} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="12" stroke="#FFFFFF" strokeOpacity="0.06" strokeWidth="2" />
            </pattern>
            <clipPath id={clipFillId}>
              <rect x={padL} y={0} width={Math.max(0, tipPos.x - padL)} height={chartH} />
            </clipPath>
          </defs>

          {/* Horizontal Grid Lines (white opacity 0.07) + Right Mono Axis Ticks */}
          {yTicks.map((tick, idx) => {
            const y = padT + (1 - tick) * plotH;
            const axisVal = formatNumberK(parsed.target * tick, parsed.decimals > 0 ? 1 : 0, parsed.useComma);
            return (
              <g key={idx}>
                <line x1={padL} y1={y} x2={padL + plotW} y2={y} stroke={L33_GRID} strokeWidth="1.5" />
                <text
                  x={chartW - 6}
                  y={y + 5}
                  textAnchor="end"
                  fill={L33_SOURCE}
                  fontFamily={FONT_MONO}
                  fontSize="16"
                  fontWeight="600"
                >
                  {axisVal}
                </text>
              </g>
            );
          })}

          {/* Vertical Grid Lines & Month Labels */}
          {[0, 3, 6, 9, 11].map((mIdx) => {
            const x = padL + (mIdx / (countPts - 1)) * dataPlotW;
            return (
              <g key={mIdx}>
                <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke={L33_GRID} strokeWidth="1" />
                <text
                  x={x}
                  y={padT + plotH + 34}
                  textAnchor="middle"
                  fill={L33_SOURCE}
                  fontFamily={FONT_MONO}
                  fontSize="16"
                  fontWeight="600"
                >
                  {MONTHS_MONO_K[mIdx]}
                </text>
              </g>
            );
          })}

          {/* Hatched Unreported / Forecast Zone on Right */}
          <rect
            x={padL + dataPlotW + 8}
            y={padT}
            width={Math.max(20, plotW - dataPlotW - 8)}
            height={plotH}
            fill={`url(#${hatchId})`}
          />
          <line
            x1={padL + dataPlotW + 8}
            y1={padT}
            x2={padL + dataPlotW + 8}
            y2={padT + plotH}
            stroke={L33_GRID}
            strokeWidth="1.2"
            strokeDasharray="4 6"
          />

          {/* Area Fills Clipped to Tip X */}
          <g clipPath={`url(#${clipFillId})`}>
            <path d={preAreaD} fill={`url(#${gradWhiteId})`} />
            {isPostEvent ? <path d={postAreaD} fill={`url(#${gradOrangeId})`} /> : null}
          </g>

          {/* Subtle Vertical Dashed Cursor Tracking Tip */}
          <line
            x1={tipPos.x}
            y1={padT}
            x2={tipPos.x}
            y2={padT + plotH}
            stroke={isPostEvent ? L33_ORANGE : L33_LINE_PRE}
            strokeOpacity="0.22"
            strokeWidth="1.5"
            strokeDasharray="5 6"
          />

          {/* Pre-Event Line (#E9EBEE) */}
          <polyline
            points={pointsToSvgAttrK(prePts)}
            fill="none"
            stroke={L33_LINE_PRE}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={preLen}
            strokeDashoffset={Math.max(0, preLen - preDrawn)}
          />

          {/* Post-Event Line (#FF5B1F — appears ONLY after pivot!) */}
          {isPostEvent ? (
            <polyline
              points={pointsToSvgAttrK(postPts)}
              fill="none"
              stroke={L33_ORANGE}
              strokeWidth="5.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={postLen}
              strokeDashoffset={Math.max(0, postLen - postDrawn)}
            />
          ) : null}

          {/* Pivot Event Ring & Leader Line */}
          {isPostEvent ? (
            <g>
              <line
                x1={pivotPt[0]}
                y1={pivotPt[1]}
                x2={pivotPt[0]}
                y2={pivotPt[1] - 110 * clamp01(eventPop)}
                stroke={L33_ORANGE}
                strokeWidth="2"
                strokeDasharray="4 4"
              />
              <circle
                cx={pivotPt[0]}
                cy={pivotPt[1]}
                r={12 + (1 - clamp01(eventPop)) * 10}
                fill="none"
                stroke={L33_ORANGE}
                strokeWidth="2.5"
                strokeOpacity={clamp01(eventPop)}
              />
              <circle cx={pivotPt[0]} cy={pivotPt[1]} r="6.5" fill={L33_ORANGE} />
            </g>
          ) : null}

          {/* Leading Moving Tip Dot */}
          <circle
            cx={tipPos.x}
            cy={tipPos.y}
            r={isPostEvent ? 8 : 6.5}
            fill={isPostEvent ? L33_ORANGE : L33_LINE_PRE}
            stroke={L33_BG}
            strokeWidth="2.5"
          />

          {/* End-Point Landing Ping Ring */}
          {lineProgress >= 0.99 && pingFrac > 0 ? (
            <circle
              cx={endPt[0]}
              cy={endPt[1]}
              r={8 + pingFrac * 28}
              fill="none"
              stroke={L33_ORANGE}
              strokeWidth="2.5"
              strokeOpacity={(1 - pingFrac) * 0.85}
            />
          ) : null}
        </svg>

        {/* HTML Callout Overlay at Event Pivot (Thai-safe FitText) */}
        {isPostEvent ? (
          <div
            style={{
              position: 'absolute',
              left: Math.max(12, Math.min(chartW - 360, pivotPt[0] - 165)),
              top: Math.max(8, pivotPt[1] - 215),
              width: 330,
              padding: '12px 16px',
              borderRadius: 10,
              backgroundColor: L33_SURFACE_2,
              border: `1px solid ${L33_ORANGE}`,
              transform: `scale(${(0.86 + 0.14 * clamp01(eventPop)).toFixed(3)})`,
              opacity: clamp01(eventPop),
            }}
          >
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: L33_ORANGE,
                marginBottom: 4,
              }}
            >
              KEY INFLECTION · {MONTHS_MONO_K[pivotIdx]}
            </div>
            <FitText
              text={calloutText}
              baseSize={22}
              minSize={17}
              maxLines={2}
              lineHeight={1.32}
              color={L33_FG}
              fontWeight={700}
              align="left"
            />
          </div>
        ) : null}
      </div>

      {/* Bottom Insight Panel & Source Footer (strictly <= 1420) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 1082,
          width: SAFE_W,
          opacity: appear(localFrame, 10, 14),
        }}
      >
        <div
          style={{
            backgroundColor: L33_SURFACE,
            border: `1px solid ${L33_HAIRLINE}`,
            borderLeft: `4px solid ${isPostEvent ? L33_ORANGE : L33_LINE_PRE}`,
            borderRadius: 12,
            padding: '22px 26px',
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: isPostEvent ? L33_ORANGE : L33_LABEL,
              marginBottom: 8,
            }}
          >
            HEADLINE TAKEAWAY
          </div>
          <FitText
            text={t.title || parsed.label}
            baseSize={34}
            minSize={24}
            maxLines={2}
            lineHeight={1.32}
            color={L33_FG}
            fontWeight={800}
            align="left"
          />
          {t.subtitle && t.subtitle !== impactLine ? (
            <div style={{ marginTop: 8 }}>
              <FitText
                text={t.subtitle}
                baseSize={24}
                minSize={18}
                maxLines={2}
                lineHeight={1.32}
                color={L33_LABEL}
                fontWeight={500}
                align="left"
              />
            </div>
          ) : null}
        </div>

        <div
          style={{
            marginTop: 18,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: FONT_MONO,
            fontSize: 16,
            letterSpacing: '0.08em',
            color: L33_SOURCE,
          }}
        >
          <span>{sourceLine}</span>
          <span>UNIT: TABULAR · LIVE</span>
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-33 Shot 2: 'event-marker'
// Vertical inflection marker + callout card; line shifts white → #FF5B1F
// ----------------------------------------------------------------------------
const Look33EventMarker: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps }) => {
  const t = sceneTexts(scene);
  const pts = extractPointsK(scene, 4);
  const seed = stringSeedK(`ev-${scene.id}-${t.title}-${sceneIndex}`);

  const safeDur = Math.max(45, durationFrames);
  const drawEnd = Math.max(26, Math.min(safeDur - 16, Math.round(safeDur * 0.68)));
  const rawT = interpolate(localFrame, [0, drawEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const lineProgress = easeOutCubic(rawT);

  const countPts = 13;
  const pivotIdx = 6;
  const values = buildGrowthSeriesK(seed + 19, countPts, pivotIdx);

  const chartW = SAFE_W;
  const chartH = 510;
  const padL = 16;
  const padR = 96;
  const padT = 56;
  const padB = 50;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const allPts: Array<[number, number]> = values.map((v, i) => [
    padL + (i / (countPts - 1)) * plotW,
    padT + (1 - v) * plotH,
  ]);
  const prePts = allPts.slice(0, pivotIdx + 1);
  const postPts = allPts.slice(pivotIdx);

  const preLen = polylineLengthK(prePts);
  const postLen = polylineLengthK(postPts);
  const totalLen = Math.max(1, preLen + postLen);
  const pivotFrac = preLen / totalLen;

  const drawnLen = lineProgress * totalLen;
  const preDrawn = Math.min(preLen, drawnLen);
  const postDrawn = Math.max(0, drawnLen - preLen);
  const isPostEvent = lineProgress >= pivotFrac;

  const pivotPt = allPts[pivotIdx];
  const tipPos = samplePolylineK(allPts, lineProgress);

  const markerPop = isPostEvent
    ? spring({
        frame: Math.max(0, localFrame - Math.round(drawEnd * 0.24)),
        fps,
        config: { damping: 13, stiffness: 200, mass: 0.75 },
      })
    : 0;

  const beforeText = scene.compare?.leftItems?.[0] || pts[0] || t.subtitle || 'แนวโน้มคงที่ก่อนจุดเปลี่ยนสำคัญ';
  const afterText = scene.compare?.rightItems?.[0] || pts[1] || t.title || 'เส้นกราฟเร่งตัวชัดเจนหลังเกิดเหตุการณ์';
  const eventLabel =
    (Array.isArray(scene.highlight) ? scene.highlight[0] : scene.highlight) ||
    scene.stat?.label ||
    t.badge ||
    'จุดเปลี่ยนสำคัญ';

  const gradPostId = `l33-ev-o-${sceneIndex}`;
  const clipEvId = `l33-ev-c-${sceneIndex}`;

  const postAreaD = [
    `M ${postPts[0][0].toFixed(1)} ${(padT + plotH).toFixed(1)}`,
    ...postPts.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`),
    `L ${postPts[postPts.length - 1][0].toFixed(1)} ${(padT + plotH).toFixed(1)}`,
    'Z',
  ].join(' ');

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width: STAGE_W,
        height: STAGE_H,
        backgroundColor: L33_BG,
        overflow: 'hidden',
      }}
    >
      <Look33TerminalHeader badge={t.badge || 'EVENT TIMELINE'} rightCode="INFLECTION · LOG" localFrame={localFrame} />

      {/* Title Block */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 190,
          width: SAFE_W,
          opacity: appear(localFrame, 2, 12),
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 99,
              backgroundColor: isPostEvent ? L33_ORANGE : L33_LINE_PRE,
              display: 'inline-block',
            }}
          />
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: isPostEvent ? L33_ORANGE : L33_LABEL,
            }}
          >
            {isPostEvent ? 'POST-EVENT REGIME SHIFT' : 'PRE-EVENT BASELINE'}
          </span>
        </div>

        <FitText
          text={t.title || 'จุดเปลี่ยนที่ทำให้กราฟพลิกทิศทาง'}
          baseSize={46}
          minSize={30}
          maxLines={2}
          lineHeight={1.3}
          color={L33_FG}
          fontWeight={800}
          align="left"
        />
        {t.subtitle ? (
          <div style={{ marginTop: 10 }}>
            <FitText
              text={t.subtitle}
              baseSize={26}
              minSize={19}
              maxLines={2}
              lineHeight={1.32}
              color={L33_LABEL}
              fontWeight={500}
              align="left"
            />
          </div>
        ) : null}
      </div>

      {/* Main Event Chart (y=425..935) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 425,
          width: chartW,
          height: chartH,
        }}
      >
        <svg width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`} style={{ display: 'block' }}>
          <defs>
            <linearGradient id={gradPostId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={L33_ORANGE} stopOpacity="0.24" />
              <stop offset="100%" stopColor={L33_ORANGE} stopOpacity="0" />
            </linearGradient>
            <clipPath id={clipEvId}>
              <rect x={pivotPt[0]} y={0} width={Math.max(0, tipPos.x - pivotPt[0])} height={chartH} />
            </clipPath>
          </defs>

          {/* Horizontal Grid Lines (white 0.07) */}
          {[0, 0.25, 0.5, 0.75, 1].map((g, idx) => {
            const y = padT + (1 - g) * plotH;
            return (
              <g key={idx}>
                <line x1={padL} y1={y} x2={padL + plotW} y2={y} stroke={L33_GRID} strokeWidth="1.5" />
                <text
                  x={chartW - 8}
                  y={y + 5}
                  textAnchor="end"
                  fill={L33_SOURCE}
                  fontFamily={FONT_MONO}
                  fontSize="16"
                  fontWeight="600"
                >
                  {`${Math.round(g * 100)}`}
                </text>
              </g>
            );
          })}

          {/* Vertical Event Marker Line */}
          <line
            x1={pivotPt[0]}
            y1={padT - 20}
            x2={pivotPt[0]}
            y2={padT + plotH}
            stroke={isPostEvent ? L33_ORANGE : L33_SOURCE}
            strokeWidth={isPostEvent ? '2.5' : '1.5'}
            strokeDasharray="6 6"
          />

          {/* Bottom Axis Labels */}
          <text x={padL + 10} y={padT + plotH + 34} fill={L33_SOURCE} fontFamily={FONT_MONO} fontSize="16" fontWeight="600">
            T-6M
          </text>
          <text
            x={pivotPt[0]}
            y={padT + plotH + 34}
            textAnchor="middle"
            fill={isPostEvent ? L33_ORANGE : L33_LABEL}
            fontFamily={FONT_MONO}
            fontSize="17"
            fontWeight="700"
          >
            EVENT T0
          </text>
          <text
            x={padL + plotW}
            y={padT + plotH + 34}
            textAnchor="end"
            fill={L33_SOURCE}
            fontFamily={FONT_MONO}
            fontSize="16"
            fontWeight="600"
          >
            T+6M
          </text>

          {/* Post-Event Shaded Area */}
          {isPostEvent ? (
            <g clipPath={`url(#${clipEvId})`}>
              <path d={postAreaD} fill={`url(#${gradPostId})`} />
            </g>
          ) : null}

          {/* Pre-Event Line (#E9EBEE) */}
          <polyline
            points={pointsToSvgAttrK(prePts)}
            fill="none"
            stroke={L33_LINE_PRE}
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={preLen}
            strokeDashoffset={Math.max(0, preLen - preDrawn)}
          />

          {/* Post-Event Line (#FF5B1F) */}
          {isPostEvent ? (
            <polyline
              points={pointsToSvgAttrK(postPts)}
              fill="none"
              stroke={L33_ORANGE}
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={postLen}
              strokeDashoffset={Math.max(0, postLen - postDrawn)}
            />
          ) : null}

          {/* Event Node Pulse Ring */}
          {isPostEvent ? (
            <g>
              <circle
                cx={pivotPt[0]}
                cy={pivotPt[1]}
                r={14 + (1 - clamp01(markerPop)) * 12}
                fill="none"
                stroke={L33_ORANGE}
                strokeWidth="2.5"
              />
              <circle cx={pivotPt[0]} cy={pivotPt[1]} r="8" fill={L33_ORANGE} stroke={L33_BG} strokeWidth="2.5" />
            </g>
          ) : null}

          {/* Active Moving Tip */}
          <circle
            cx={tipPos.x}
            cy={tipPos.y}
            r="7.5"
            fill={isPostEvent ? L33_ORANGE : L33_LINE_PRE}
            stroke={L33_BG}
            strokeWidth="2.5"
          />
        </svg>

        {/* Event Callout Card Anchored Above Pivot */}
        <div
          style={{
            position: 'absolute',
            left: Math.max(8, Math.min(chartW - 390, pivotPt[0] - 190)),
            top: 10,
            width: 380,
            padding: '14px 18px',
            borderRadius: 12,
            backgroundColor: L33_SURFACE_2,
            border: `1.5px solid ${isPostEvent ? L33_ORANGE : L33_HAIRLINE}`,
            transform: `translateY(${(1 - clamp01(markerPop)) * 12}px) scale(${(0.9 + 0.1 * clamp01(markerPop)).toFixed(3)})`,
            opacity: isPostEvent ? clamp01(markerPop) : 0.45,
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: isPostEvent ? L33_ORANGE : L33_LABEL,
              marginBottom: 4,
            }}
          >
            EVENT MARKER · T0
          </div>
          <FitText
            text={eventLabel}
            baseSize={25}
            minSize={18}
            maxLines={2}
            lineHeight={1.32}
            color={L33_FG}
            fontWeight={800}
            align="left"
          />
        </div>
      </div>

      {/* Before / After Phase Cards (y=980..1345) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 980,
          width: SAFE_W,
          display: 'flex',
          gap: 22,
        }}
      >
        <div
          style={{
            flex: 1,
            backgroundColor: L33_SURFACE,
            border: `1px solid ${L33_HAIRLINE}`,
            borderTop: `3px solid ${L33_LINE_PRE}`,
            borderRadius: 12,
            padding: '22px 24px',
            opacity: appear(localFrame, 6, 12),
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: L33_LABEL,
              marginBottom: 10,
            }}
          >
            01 · BEFORE EVENT
          </div>
          <FitText
            text={beforeText}
            baseSize={27}
            minSize={20}
            maxLines={4}
            lineHeight={1.34}
            color={L33_LINE_PRE}
            fontWeight={700}
            align="left"
          />
        </div>

        <div
          style={{
            flex: 1,
            backgroundColor: L33_SURFACE,
            border: `1px solid ${isPostEvent ? 'rgba(255,91,31,0.45)' : L33_HAIRLINE}`,
            borderTop: `3px solid ${isPostEvent ? L33_ORANGE : L33_SOURCE}`,
            borderRadius: 12,
            padding: '22px 24px',
            opacity: isPostEvent ? clamp01(markerPop) : 0.35,
            transform: `translateY(${(1 - clamp01(markerPop)) * 10}px)`,
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: isPostEvent ? L33_ORANGE : L33_SOURCE,
              marginBottom: 10,
            }}
          >
            02 · AFTER EVENT
          </div>
          <FitText
            text={afterText}
            baseSize={27}
            minSize={20}
            maxLines={4}
            lineHeight={1.34}
            color={L33_FG}
            fontWeight={700}
            align="left"
          />
        </div>
      </div>

      {/* Footer Source */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 1372,
          width: SAFE_W,
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: FONT_MONO,
          fontSize: 16,
          letterSpacing: '0.08em',
          color: L33_SOURCE,
        }}
      >
        <span>{scene.source ? `SOURCE: ${scene.source}` : 'EVENT IMPACT ANALYSIS · TERMINAL VIEW'}</span>
        <span>DELTA SHIFT · LIVE</span>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-33 Shot 3: 'bar-compare'
// Left soft-white (#E9EBEE) vs Right hot-orange (#FF5B1F) comparative bars
// ----------------------------------------------------------------------------
const Look33BarCompare: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const cmp = extractComparePairK(scene, 'แบบเดิม', 'แบบใหม่');
  const seed = stringSeedK(`cmp-${scene.id}-${t.title}-${sceneIndex}`);

  // Try to parse numeric values from compare items or fallback to clean contrast ratio
  const numRe = /(\d[\d,]*(?:\.\d+)?)/;
  const leftMatch = cmp.leftItems.join(' ').match(numRe);
  const rightMatch = cmp.rightItems.join(' ').match(numRe);
  const leftVal = leftMatch ? parseFloat(leftMatch[1].replace(/,/g, '')) : 38 + (seed % 14);
  const rightVal = rightMatch ? parseFloat(rightMatch[1].replace(/,/g, '')) : Math.max(leftVal + 36, 84 + (seed % 14));
  const maxVal = Math.max(leftVal, rightVal, 1);

  const leftFrac = clamp01(leftVal / maxVal);
  const rightFrac = clamp01(rightVal / maxVal);

  const leftGrow = spring({
    frame: Math.max(0, localFrame - 6),
    fps,
    config: { damping: 16, stiffness: 120, mass: 0.9 },
  });
  const rightGrow = spring({
    frame: Math.max(0, localFrame - 16),
    fps,
    config: { damping: 15, stiffness: 130, mass: 0.9 },
  });
  const diffPop = spring({
    frame: Math.max(0, localFrame - 28),
    fps,
    config: { damping: 13, stiffness: 200, mass: 0.7 },
  });

  const leftDisplay = formatNumberK(leftVal * clamp01(leftGrow), leftVal % 1 !== 0 ? 1 : 0, leftVal >= 1000);
  const rightDisplay = formatNumberK(rightVal * clamp01(rightGrow), rightVal % 1 !== 0 ? 1 : 0, rightVal >= 1000);

  const pctDiff = leftVal > 0 ? Math.round(((rightVal - leftVal) / leftVal) * 100) : 100;
  const diffLabel = scene.stat?.delta || `${pctDiff >= 0 ? '+' : ''}${pctDiff}%`;

  const chartW = SAFE_W;
  const chartH = 440;
  const baseY = 390;
  const maxBarH = 290;
  const leftBarH = Math.max(24, leftFrac * maxBarH * clamp01(leftGrow));
  const rightBarH = Math.max(24, rightFrac * maxBarH * clamp01(rightGrow));

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width: STAGE_W,
        height: STAGE_H,
        backgroundColor: L33_BG,
        overflow: 'hidden',
      }}
    >
      <Look33TerminalHeader badge={t.badge || 'COMPARATIVE BENCHMARK'} rightCode="A/B · DELTA" localFrame={localFrame} />

      {/* Title & Delta Pill */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 190,
          width: SAFE_W,
          opacity: appear(localFrame, 2, 12),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 10 }}>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: L33_LABEL,
            }}
          >
            SIDE-BY-SIDE METRIC COMPARISON
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 8,
              backgroundColor: L33_ORANGE,
              color: L33_BG,
              fontFamily: FONT_MONO,
              fontSize: 20,
              fontWeight: 800,
              fontVariantNumeric: 'tabular-nums',
              transform: `scale(${clamp01(diffPop).toFixed(3)})`,
            }}
          >
            <span>▲</span>
            <span>{diffLabel}</span>
          </span>
        </div>

        <FitText
          text={t.title || `${cmp.leftTitle} เทียบกับ ${cmp.rightTitle}`}
          baseSize={44}
          minSize={28}
          maxLines={2}
          lineHeight={1.3}
          color={L33_FG}
          fontWeight={800}
          align="left"
        />
      </div>

      {/* Bar Chart Stage (y=360..800) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 360,
          width: chartW,
          height: chartH,
        }}
      >
        <svg width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`} style={{ display: 'block' }}>
          {/* Reference Horizontal Gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((g, idx) => {
            const y = baseY - g * maxBarH;
            return (
              <g key={idx}>
                <line x1={0} y1={y} x2={chartW - 76} y2={y} stroke={L33_GRID} strokeWidth="1.5" />
                <text
                  x={chartW - 6}
                  y={y + 5}
                  textAnchor="end"
                  fill={L33_SOURCE}
                  fontFamily={FONT_MONO}
                  fontSize="16"
                  fontWeight="600"
                >
                  {formatNumberK(maxVal * g, 0, maxVal >= 1000)}
                </text>
              </g>
            );
          })}

          {/* Baseline Rule */}
          <line x1={0} y1={baseY} x2={chartW - 76} y2={baseY} stroke="rgba(255,255,255,0.22)" strokeWidth="2" />

          {/* Left Bar — Soft White (#E9EBEE) */}
          <rect
            x={130}
            y={baseY - leftBarH}
            width={220}
            height={leftBarH}
            rx="8"
            fill={L33_LINE_PRE}
          />
          <text
            x={240}
            y={baseY - leftBarH - 22}
            textAnchor="middle"
            fill={L33_FG}
            fontFamily={FONT_NUM}
            fontSize="48"
            fontWeight="900"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {leftDisplay}
          </text>

          {/* Right Bar — Hot Orange (#FF5B1F) */}
          <rect
            x={510}
            y={baseY - rightBarH}
            width={220}
            height={rightBarH}
            rx="8"
            fill={L33_ORANGE}
          />
          <text
            x={620}
            y={baseY - rightBarH - 22}
            textAnchor="middle"
            fill={L33_ORANGE}
            fontFamily={FONT_NUM}
            fontSize="52"
            fontWeight="900"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {rightDisplay}
          </text>

          {/* Gap Connector Bracket between tops */}
          {diffPop > 0.15 ? (
            <g opacity={clamp01(diffPop)}>
              <line
                x1={356}
                y1={baseY - leftBarH}
                x2={498}
                y2={baseY - leftBarH}
                stroke={L33_SOURCE}
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <line
                x1={430}
                y1={baseY - leftBarH}
                x2={430}
                y2={baseY - rightBarH}
                stroke={L33_ORANGE}
                strokeWidth="2.5"
              />
              <polygon
                points={`430,${baseY - rightBarH - 4} 423,${baseY - rightBarH + 10} 437,${baseY - rightBarH + 10}`}
                fill={L33_ORANGE}
              />
            </g>
          ) : null}
        </svg>

        {/* HTML Column Labels Below Baseline */}
        <div
          style={{
            position: 'absolute',
            left: 60,
            top: baseY + 12,
            width: 360,
          }}
        >
          <FitText
            text={cmp.leftTitle}
            baseSize={26}
            minSize={19}
            maxLines={1}
            lineHeight={1.3}
            color={L33_LINE_PRE}
            fontWeight={700}
            align="center"
          />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 440,
            top: baseY + 12,
            width: 360,
          }}
        >
          <FitText
            text={cmp.rightTitle}
            baseSize={26}
            minSize={19}
            maxLines={1}
            lineHeight={1.3}
            color={L33_ORANGE}
            fontWeight={800}
            align="center"
          />
        </div>
      </div>

      {/* Comparison Breakdown Lists (y=845..1345) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 845,
          width: SAFE_W,
          display: 'flex',
          gap: 22,
        }}
      >
        {/* Left List */}
        <div
          style={{
            flex: 1,
            backgroundColor: L33_SURFACE,
            border: `1px solid ${L33_HAIRLINE}`,
            borderTop: `3px solid ${L33_LINE_PRE}`,
            borderRadius: 12,
            padding: '22px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 700, color: L33_LABEL, letterSpacing: '0.1em' }}>
            BASELINE · A
          </div>
          {cmp.leftItems.map((item, idx) => {
            const p = stagger(idx, localFrame, 6, 10, 12);
            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  opacity: p,
                  transform: `translateY(${(1 - p) * 10}px)`,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    backgroundColor: L33_LINE_PRE,
                    marginTop: 12,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item}
                    baseSize={25}
                    minSize={19}
                    maxLines={3}
                    lineHeight={1.34}
                    color={L33_FG}
                    fontWeight={600}
                    align="left"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Right List */}
        <div
          style={{
            flex: 1,
            backgroundColor: L33_SURFACE,
            border: `1px solid rgba(255,91,31,0.35)`,
            borderTop: `3px solid ${L33_ORANGE}`,
            borderRadius: 12,
            padding: '22px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 700, color: L33_ORANGE, letterSpacing: '0.1em' }}>
            OUTPERFORM · B
          </div>
          {cmp.rightItems.map((item, idx) => {
            const p = stagger(idx, localFrame, 6, 16, 12);
            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  opacity: p,
                  transform: `translateY(${(1 - p) * 10}px)`,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    backgroundColor: L33_ORANGE,
                    marginTop: 12,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item}
                    baseSize={25}
                    minSize={19}
                    maxLines={3}
                    lineHeight={1.34}
                    color={L33_FG}
                    fontWeight={700}
                    align="left"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 1372,
          width: SAFE_W,
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: FONT_MONO,
          fontSize: 16,
          letterSpacing: '0.08em',
          color: L33_SOURCE,
        }}
      >
        <span>{scene.source ? `SOURCE: ${scene.source}` : 'BENCHMARK TERMINAL · TABULAR SCALE'}</span>
        <span>COMPARE · 2 SERIES</span>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-33 Shot 4: 'ticker-rows'
// Bullets rendered as terminal watchlist rows with mini sparkline & delta
// ----------------------------------------------------------------------------
const Look33TickerRows: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames }) => {
  const t = sceneTexts(scene);
  const rawPts = extractPointsK(scene, 5);
  const rows = rawPts.length > 0 ? rawPts : [t.title || 'ดัชนีชี้วัดหลัก'];
  const seed = stringSeedK(`tkr-${scene.id}-${t.title}-${sceneIndex}`);

  const safeDur = Math.max(40, durationFrames);
  const featuredIdx = rows.length - 1; // highlight final/top breakout row in #FF5B1F

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width: STAGE_W,
        height: STAGE_H,
        backgroundColor: L33_BG,
        overflow: 'hidden',
      }}
    >
      {/* Subtle full-stage terminal grid lines (white 0.07) */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {[240, 440, 640, 840, 1040, 1240].map((y) => (
          <line key={y} x1={SAFE_X} y1={y} x2={SAFE_X + SAFE_W} y2={y} stroke={L33_GRID} strokeWidth="1" />
        ))}
      </svg>

      <Look33TerminalHeader badge={t.badge || 'TERMINAL WATCHLIST'} rightCode={`ROWS · 0${rows.length}`} localFrame={localFrame} />

      {/* Title Block */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 192,
          width: SAFE_W,
          opacity: appear(localFrame, 2, 12),
        }}
      >
        <FitText
          text={t.title || 'สรุปตัวชี้วัดและรายการสำคัญ'}
          baseSize={44}
          minSize={28}
          maxLines={2}
          lineHeight={1.3}
          color={L33_FG}
          fontWeight={800}
          align="left"
        />
        {t.subtitle ? (
          <div style={{ marginTop: 8 }}>
            <FitText
              text={t.subtitle}
              baseSize={25}
              minSize={19}
              maxLines={2}
              lineHeight={1.32}
              color={L33_LABEL}
              fontWeight={500}
              align="left"
            />
          </div>
        ) : null}
      </div>

      {/* Column Headers */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 388,
          width: SAFE_W,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 10,
          borderBottom: `1px solid ${L33_HAIRLINE}`,
          fontFamily: FONT_MONO,
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: L33_SOURCE,
        }}
      >
        <span style={{ flex: 1 }}>IDX / METRIC ITEM</span>
        <span style={{ width: 156, textAlign: 'center' }}>TREND</span>
        <span style={{ width: 146, textAlign: 'right' }}>DELTA</span>
      </div>

      {/* Terminal Rows (y=432..1235) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 432,
          width: SAFE_W,
          display: 'flex',
          flexDirection: 'column',
          gap: rows.length >= 5 ? 14 : 18,
        }}
      >
        {rows.map((text, idx) => {
          const isAccent = idx === featuredIdx;
          const p = stagger(idx, localFrame, 7, 5, 14);
          const sparkDraw = interpolate(
            localFrame,
            [8 + idx * 7, Math.min(safeDur - 10, 32 + idx * 7)],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );

          // Deterministic 7-point mini sparkline
          const sparkW = 144;
          const sparkH = 48;
          const sparkPts: Array<[number, number]> = Array.from({ length: 7 }).map((_, j) => {
            const frac = j / 6;
            const noise = (seededHashK(seed + idx * 41 + j * 13) - 0.5) * 0.24;
            const trend = isAccent ? 0.18 + Math.pow(frac, 1.35) * 0.76 : 0.3 + frac * 0.42 + noise;
            const norm = clamp01(trend);
            return [6 + frac * (sparkW - 12), sparkH - 6 - norm * (sparkH - 12)];
          });
          const sparkLen = polylineLengthK(sparkPts);
          const tip = samplePolylineK(sparkPts, easeOutCubic(sparkDraw));

          // Extract any number from bullet text, else deterministic delta
          const mNum = text.match(/([+-]?\d+(?:[.,]\d+)?\s*(?:%|x|เท่า|K|M|฿)?)/i);
          const fallbackDelta = `+${(14 + idx * 9 + Math.round(seededHashK(seed + idx * 7) * 18)).toFixed(0)}%`;
          const deltaStr = mNum ? mNum[1].trim() : fallbackDelta;

          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                padding: rows.length >= 5 ? '18px 20px' : '22px 24px',
                borderRadius: 12,
                backgroundColor: isAccent ? L33_SURFACE_2 : L33_SURFACE,
                border: `1px solid ${isAccent ? 'rgba(255,91,31,0.48)' : L33_HAIRLINE}`,
                borderLeft: `4px solid ${isAccent ? L33_ORANGE : L33_LINE_PRE}`,
                opacity: p,
                transform: `translateX(${(1 - p) * -18}px)`,
              }}
            >
              {/* Mono Index */}
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 20,
                  fontWeight: 700,
                  color: isAccent ? L33_ORANGE : L33_LABEL,
                  fontVariantNumeric: 'tabular-nums',
                  width: 38,
                  flexShrink: 0,
                }}
              >
                {`0${idx + 1}`}
              </div>

              {/* Thai Row Label */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText
                  text={text}
                  baseSize={rows.length >= 5 ? 25 : 28}
                  minSize={19}
                  maxLines={2}
                  lineHeight={1.32}
                  color={L33_FG}
                  fontWeight={isAccent ? 800 : 600}
                  align="left"
                />
              </div>

              {/* Mini Sparkline */}
              <div style={{ width: sparkW, height: sparkH, flexShrink: 0 }}>
                <svg width={sparkW} height={sparkH} viewBox={`0 0 ${sparkW} ${sparkH}`}>
                  <line
                    x1={4}
                    y1={sparkH / 2}
                    x2={sparkW - 4}
                    y2={sparkH / 2}
                    stroke={L33_GRID}
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <polyline
                    points={pointsToSvgAttrK(sparkPts)}
                    fill="none"
                    stroke={isAccent ? L33_ORANGE : L33_LINE_PRE}
                    strokeWidth={isAccent ? '3.5' : '2.5'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={sparkLen}
                    strokeDashoffset={Math.max(0, sparkLen * (1 - easeOutCubic(sparkDraw)))}
                  />
                  <circle cx={tip.x} cy={tip.y} r={isAccent ? 4.5 : 3.5} fill={isAccent ? L33_ORANGE : L33_LINE_PRE} />
                </svg>
              </div>

              {/* Tabular Delta Pill */}
              <div
                style={{
                  width: 132,
                  flexShrink: 0,
                  display: 'flex',
                  justifyContent: 'flex-end',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    padding: '7px 14px',
                    borderRadius: 8,
                    backgroundColor: isAccent ? L33_ORANGE : 'rgba(233,235,238,0.1)',
                    color: isAccent ? L33_BG : L33_LINE_PRE,
                    fontFamily: FONT_MONO,
                    fontSize: 20,
                    fontWeight: 800,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {deltaStr}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Summary Strip (strictly <= 1420) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 1280,
          width: SAFE_W,
          padding: '18px 22px',
          borderRadius: 12,
          backgroundColor: L33_SURFACE,
          border: `1px solid ${L33_HAIRLINE}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          opacity: appear(localFrame, 18, 12),
        }}
      >
        <span style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 700, color: L33_ORANGE, letterSpacing: '0.1em' }}>
          SUMMARY · {rows.length} SIGNALS
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 16, color: L33_SOURCE, letterSpacing: '0.08em' }}>
          {scene.source ? `SRC: ${scene.source}` : 'TABULAR FEED · ACTIVE'}
        </span>
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 2: look-34 — APP MOCKUP (ม็อกอัปแอป)
// Studio backdrop: #dfe6ee → #cfd8e2 + soft spotlight #f4f7fa behind phone
// Ink: #0e1116 • Label: #7a818c • Accent: Emerald Green #0e9f6e
// Soft Chip: #e3f6ee • Cards & Screen: Pure White #FFFFFF
// NEVER uses cream bg from tokens!
// ============================================================================

const L34_BG_TOP = '#dfe6ee';
const L34_BG_BOT = '#cfd8e2';
const L34_LIGHT = '#f4f7fa';
const L34_INK = '#0e1116';
const L34_LABEL = '#7a818c';
const L34_GREEN = '#0e9f6e';
const L34_CHIP = '#e3f6ee';
const L34_WHITE = '#FFFFFF';
const L34_BORDER = '#E4EAF0';

const Look34StudioBackdrop: React.FC<{
  localFrame: number;
  patternId: string;
}> = ({ localFrame, patternId }) => {
  const drift = Math.sin(localFrame * 0.03) * 14;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(180deg, ${L34_BG_TOP} 0%, ${L34_BG_BOT} 76%, #c3ceda 100%)`,
        overflow: 'hidden',
      }}
    >
      {/* Studio Softbox Radial Light (#f4f7fa) Behind Phone */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 720,
          width: 960,
          height: 960,
          transform: `translate(-50%, -50%) translateX(${drift.toFixed(1)}px)`,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${L34_LIGHT} 0%, rgba(244,247,250,0.68) 42%, rgba(223,230,238,0) 74%)`,
        }}
      />
      {/* Subtle Studio Horizon Floor Tone */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 1210,
          bottom: 0,
          background: 'linear-gradient(180deg, rgba(186,198,212,0) 0%, rgba(168,182,198,0.34) 38%, rgba(154,170,188,0.45) 100%)',
        }}
      />
      {/* Ultra-fine deterministic studio micro-grain */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <pattern id={patternId} width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="6" r="0.8" fill="#0e1116" fillOpacity="0.035" />
            <circle cx="16" cy="18" r="0.7" fill="#ffffff" fillOpacity="0.16" />
          </pattern>
        </defs>
        <rect width={STAGE_W} height={STAGE_H} fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
};

interface PhoneFrameProps {
  width?: number;
  height?: number;
  rotateYDeg: number;
  rotateXDeg?: number;
  rotateZDeg?: number;
  floatY?: number;
  glintProgress: number; // 0..1 specular sweep along bezel
  children: React.ReactNode;
}

/** Realistic CSS 3D Phone Frame (460×940 default, borderRadius 64, notch, specular edge & floor shadow) */
const Look34PhoneShell: React.FC<PhoneFrameProps> = ({
  width = 460,
  height = 940,
  rotateYDeg,
  rotateXDeg = 3,
  rotateZDeg = 0,
  floatY = 0,
  glintProgress,
  children,
}) => {
  // Floor shadow widens as phone turns closer to front-facing (0 deg)
  const facing = Math.cos((rotateYDeg * Math.PI) / 180);
  const shadowScaleX = 0.72 + 0.32 * Math.max(0, facing);
  const sideThickness = Math.max(6, Math.round(Math.abs(rotateYDeg) * 0.42));

  return (
    <div style={{ position: 'relative', width, height: height + 54, perspective: 1600 }}>
      {/* Soft Studio Floor Shadow Beneath Phone */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 4,
          width: width * 0.92,
          height: 56,
          transform: `translateX(-50%) scaleX(${shadowScaleX.toFixed(3)})`,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at center, rgba(14,17,22,0.34) 0%, rgba(14,17,22,0.14) 48%, rgba(14,17,22,0) 76%)',
          filter: 'blur(8px)',
        }}
      />

      {/* 3D Rotated Hardware Body */}
      <div
        style={{
          position: 'relative',
          width,
          height,
          borderRadius: 64,
          transformStyle: 'preserve-3d',
          transform: `translateY(${floatY.toFixed(1)}px) rotateY(${rotateYDeg.toFixed(2)}deg) rotateX(${rotateXDeg.toFixed(1)}deg) rotateZ(${rotateZDeg.toFixed(1)}deg)`,
          background: 'linear-gradient(145deg, #2C333F 0%, #171B22 45%, #0D1015 100%)',
          padding: 13,
          boxShadow: [
            `${rotateYDeg < 0 ? sideThickness : -sideThickness}px 18px 46px rgba(14,17,22,0.28)`,
            '0 34px 68px rgba(14,17,22,0.22)',
            'inset 0 0 0 2px rgba(255,255,255,0.22)',
          ].join(', '),
        }}
      >
        {/* Metallic Edge Rim Glint Sweeping During Turn */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 64,
            pointerEvents: 'none',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: -80,
              top: `${(-20 + glintProgress * 140).toFixed(1)}%`,
              width: width + 160,
              height: 110,
              transform: 'rotate(-18deg)',
              background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.26) 50%, rgba(255,255,255,0) 100%)',
              opacity: glintProgress > 0.02 && glintProgress < 0.98 ? 0.85 : 0,
            }}
          />
        </div>

        {/* Inner Crisp White Screen */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: 52,
            backgroundColor: L34_WHITE,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'inset 0 0 0 1px rgba(14,17,22,0.06)',
          }}
        >
          {/* Status Bar & Dynamic Island Notch */}
          <div
            style={{
              position: 'relative',
              height: 54,
              padding: '0 26px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: FONT_NUM,
                fontSize: 16,
                fontWeight: 700,
                color: L34_INK,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              9:41
            </span>
            {/* Camera Notch Pill */}
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: 12,
                transform: 'translateX(-50%)',
                width: 124,
                height: 32,
                borderRadius: 18,
                backgroundColor: '#0B0D11',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingRight: 11,
              }}
            >
              <div
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle at 35% 35%, #3B4963 0%, #141923 70%)',
                }}
              />
            </div>
            {/* Signal + Battery SVG */}
            <svg width="56" height="14" viewBox="0 0 56 14">
              <rect x="0" y="8" width="3.5" height="6" rx="1" fill={L34_INK} />
              <rect x="5.5" y="5.5" width="3.5" height="8.5" rx="1" fill={L34_INK} />
              <rect x="11" y="3" width="3.5" height="11" rx="1" fill={L34_INK} />
              <rect x="16.5" y="0.5" width="3.5" height="13.5" rx="1" fill={L34_INK} />
              <rect x="28" y="2" width="23" height="10" rx="2.5" fill="none" stroke={L34_INK} strokeWidth="1.5" />
              <rect x="30" y="4" width="16" height="6" rx="1" fill={L34_GREEN} />
              <rect x="52.5" y="5" width="2" height="4" rx="1" fill={L34_INK} />
            </svg>
          </div>

          {/* Screen Body */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
            {children}
          </div>

          {/* Subtle Diagonal Glass Sheen Overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background:
                'linear-gradient(125deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 28%, rgba(255,255,255,0) 48%)',
            }}
          />

          {/* Bottom Home Indicator Pill */}
          <div
            style={{
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <div style={{ width: 126, height: 5, borderRadius: 99, backgroundColor: 'rgba(14,17,22,0.22)' }} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-34 Shot 1: 'phone-hero-rotate'
// 460×940 phone rotates rotateY(-35deg → 0deg) via spring in perspective 1600
// ----------------------------------------------------------------------------
const Look34PhoneHeroRotate: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const parsed = parseStatValueK(scene, sceneIndex, 12840, '฿');
  const pts = extractPointsK(scene, 3);
  const rows = pts.length > 0 ? pts : ['ซิงก์ข้อมูลแบบเรียลไทม์', 'แจ้งเตือนอัตโนมัติทันที', 'สรุปผลชัดเจนในหน้าเดียว'];
  const seed = stringSeedK(`ph-${scene.id}-${t.title}-${sceneIndex}`);

  // Heavy physical spring from -35deg to 0deg (already in frame on frame 0!)
  const turnSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 13, stiffness: 86, mass: 1.15 },
  });
  const rotateY = -35 * (1 - turnSpring);
  const floatY = Math.sin(localFrame * 0.055) * 6 * clamp01(turnSpring);
  const glintProgress = interpolate(localFrame, [2, 28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // In-screen animations build as phone settles
  const countT = easeOutCubic(
    interpolate(localFrame, [6, 36], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  );
  const displayNum = formatNumberK(parsed.target * countT, parsed.decimals, parsed.useComma);
  const chipPop = spring({
    frame: Math.max(0, localFrame - 32),
    fps,
    config: { damping: 12, stiffness: 210, mass: 0.7 },
  });
  const chartDraw = easeOutCubic(
    interpolate(localFrame, [10, 42], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  );

  // Mini screen sparkline
  const sparkPts: Array<[number, number]> = Array.from({ length: 9 }).map((_, i) => {
    const frac = i / 8;
    const wave = Math.sin(frac * 4.5 + (seed % 5)) * 12;
    return [12 + frac * 356, 108 - frac * 70 + wave];
  });
  const sparkLen = polylineLengthK(sparkPts);
  const sparkTip = samplePolylineK(sparkPts, chartDraw);
  const gradId = `l34-hero-g-${sceneIndex}`;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look34StudioBackdrop localFrame={localFrame} patternId={`l34-bg1-${sceneIndex}`} />

      {/* Top Studio Headline Block (y=112..282) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: SAFE_TOP,
          width: SAFE_W,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: appear(localFrame, 0, 12),
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 18px',
            borderRadius: 99,
            backgroundColor: L34_CHIP,
            marginBottom: 12,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: L34_GREEN }} />
          <FitText
            text={t.badge || 'APP LAUNCH · STUDIO PREVIEW'}
            baseSize={21}
            minSize={16}
            maxLines={1}
            lineHeight={1.3}
            color={L34_GREEN}
            fontWeight={800}
            align="center"
          />
        </div>
        <FitText
          text={t.title || 'ประสบการณ์แอปที่ออกแบบมาเพื่อความชัดเจน'}
          baseSize={44}
          minSize={28}
          maxLines={2}
          lineHeight={1.3}
          color={L34_INK}
          fontWeight={800}
          align="center"
        />
      </div>

      {/* Centered 460×940 3D Phone (y=305..1299, safely inside y <= 1420) */}
      <div
        style={{
          position: 'absolute',
          left: (STAGE_W - 460) / 2,
          top: 305,
        }}
      >
        <Look34PhoneShell
          width={460}
          height={940}
          rotateYDeg={rotateY}
          rotateXDeg={3}
          rotateZDeg={0}
          floatY={floatY}
          glintProgress={glintProgress}
        >
          <div style={{ padding: '12px 24px 10px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
            {/* App Top Bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 11,
                    backgroundColor: L34_GREEN,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18">
                    <path d="M3 12 L7 8 L10 11 L15 5" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontFamily: FONT_THAI, fontSize: 15, fontWeight: 700, color: L34_INK, lineHeight: 1.35 }}>ภาพรวมบัญชี</div>
                  <div style={{ fontFamily: FONT_NUM, fontSize: 12, fontWeight: 600, color: L34_LABEL }}>Live Dashboard</div>
                </div>
              </div>
              <div
                style={{
                  padding: '5px 11px',
                  borderRadius: 99,
                  backgroundColor: L34_CHIP,
                  color: L34_GREEN,
                  fontFamily: FONT_NUM,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                LIVE
              </div>
            </div>

            {/* Hero Balance / Metric inside Phone */}
            <div>
              <div style={{ marginBottom: 4 }}>
                <FitText
                  text={parsed.label || t.subtitle || 'ยอดรวมและผลลัพธ์ล่าสุด'}
                  baseSize={18}
                  minSize={15}
                  maxLines={1}
                  lineHeight={1.32}
                  color={L34_LABEL}
                  fontWeight={600}
                  align="left"
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontFamily: FONT_NUM,
                    fontSize: displayNum.length > 6 ? 46 : 54,
                    fontWeight: 900,
                    letterSpacing: '-0.03em',
                    color: L34_INK,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {`${parsed.prefix}${displayNum}${parsed.suffix}`}
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    borderRadius: 99,
                    backgroundColor: L34_CHIP,
                    color: L34_GREEN,
                    fontFamily: FONT_NUM,
                    fontSize: 15,
                    fontWeight: 800,
                    fontVariantNumeric: 'tabular-nums',
                    transform: `scale(${clamp01(chipPop).toFixed(3)})`,
                  }}
                >
                  ▲ {parsed.delta || '+18.4%'}
                </span>
              </div>
            </div>

            {/* Mini Interactive Line Chart Card */}
            <div
              style={{
                borderRadius: 20,
                backgroundColor: '#F7F9FB',
                border: `1px solid ${L34_BORDER}`,
                padding: '12px 10px 8px',
              }}
            >
              <svg width="380" height="126" viewBox="0 0 380 126" style={{ width: '100%', height: 'auto', display: 'block' }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={L34_GREEN} stopOpacity="0.22" />
                    <stop offset="100%" stopColor={L34_GREEN} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[30, 68, 106].map((y) => (
                  <line key={y} x1="12" y1={y} x2="368" y2={y} stroke="#E2E8F0" strokeWidth="1" strokeDasharray="3 4" />
                ))}
                <path
                  d={`M ${sparkPts[0][0]} 120 ${sparkPts.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')} L ${sparkPts[sparkPts.length - 1][0]} 120 Z`}
                  fill={`url(#${gradId})`}
                  opacity={chartDraw}
                />
                <polyline
                  points={pointsToSvgAttrK(sparkPts)}
                  fill="none"
                  stroke={L34_GREEN}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={sparkLen}
                  strokeDashoffset={Math.max(0, sparkLen * (1 - chartDraw))}
                />
                <circle cx={sparkTip.x} cy={sparkTip.y} r="6" fill={L34_GREEN} stroke="#FFFFFF" strokeWidth="2.5" />
                {/* Dark Pill Value Tag */}
                <rect x={Math.max(12, Math.min(286, sparkTip.x - 42))} y={Math.max(2, sparkTip.y - 30)} width="84" height="22" rx="11" fill={L34_INK} />
                <text
                  x={Math.max(54, Math.min(328, sparkTip.x))}
                  y={Math.max(17, sparkTip.y - 15)}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontFamily={FONT_NUM}
                  fontSize="11"
                  fontWeight="700"
                >
                  {`${parsed.prefix}${displayNum}`}
                </text>
              </svg>
            </div>

            {/* Segmented Tab Switcher */}
            <div
              style={{
                display: 'flex',
                backgroundColor: '#EEF2F6',
                borderRadius: 12,
                padding: 4,
                gap: 4,
              }}
            >
              {['ภาพรวม', 'สถิติ', 'กิจกรรม'].map((tab, i) => (
                <div
                  key={tab}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    padding: '7px 4px',
                    borderRadius: 9,
                    backgroundColor: i === 0 ? L34_WHITE : 'transparent',
                    color: i === 0 ? L34_INK : L34_LABEL,
                    fontFamily: FONT_THAI,
                    fontSize: 15,
                    lineHeight: 1.35,
                    fontWeight: i === 0 ? 700 : 500,
                    boxShadow: i === 0 ? '0 2px 6px rgba(14,17,22,0.08)' : 'none',
                  }}
                >
                  {tab}
                </div>
              ))}
            </div>

            {/* 3 Activity / Feature Rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.slice(0, 3).map((item, idx) => {
                const rp = stagger(idx, localFrame, 6, 16, 12);
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 16,
                      backgroundColor: '#F8FAFC',
                      border: `1px solid ${L34_BORDER}`,
                      opacity: rp,
                      transform: `translateY(${(1 - rp) * 16}px)`,
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 11,
                        backgroundColor: L34_CHIP,
                        color: L34_GREEN,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: FONT_NUM,
                        fontSize: 15,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {`0${idx + 1}`}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FitText
                        text={item}
                        baseSize={19}
                        minSize={15}
                        maxLines={2}
                        lineHeight={1.32}
                        color={L34_INK}
                        fontWeight={600}
                        align="left"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* App Bottom Navigation Bar */}
            <div
              style={{
                marginTop: 'auto',
                paddingTop: 10,
                borderTop: `1px solid ${L34_BORDER}`,
                display: 'flex',
                justifyContent: 'space-around',
                alignItems: 'center',
              }}
            >
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    backgroundColor: idx === 0 ? L34_CHIP : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: idx === 0 ? 4 : 99,
                      backgroundColor: idx === 0 ? L34_GREEN : '#B8C2CE',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </Look34PhoneShell>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-34 Shot 2: 'floating-ui-cards'
// 3–4 white UI cards morph & pop around the 3D phone with gentle parallax
// ----------------------------------------------------------------------------
const Look34FloatingUiCards: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const rawPts = extractPointsK(scene, 4);
  const cards =
    rawPts.length >= 3
      ? rawPts
      : [
          rawPts[0] || t.title || 'แจ้งเตือนอัจฉริยะแบบเรียลไทม์',
          rawPts[1] || t.subtitle || 'ติดตามสถิติเติบโตได้ทุกวัน',
          rawPts[2] || 'ความคืบหน้าครบทุกเป้าหมาย',
        ];
  const seed = stringSeedK(`fc-${scene.id}-${t.title}-${sceneIndex}`);

  const turnSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 88, mass: 1.1 },
  });
  const rotateY = -30 + 20 * turnSpring; // lands in sleek 3/4 view (-10deg)
  const phoneFloat = Math.sin(localFrame * 0.05) * 5;
  const cardFloat = Math.sin(localFrame * 0.05 + 0.7) * 9; // foreground cards float slightly more (parallax)
  const glintProgress = interpolate(localFrame, [2, 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Staggered spring pops with ~10% overshoot (morph-pop, NOT passive fade)
  const c1Pop = spring({ frame: Math.max(0, localFrame - 10), fps, config: { damping: 11, stiffness: 185, mass: 0.72 } });
  const c2Pop = spring({ frame: Math.max(0, localFrame - 20), fps, config: { damping: 11, stiffness: 185, mass: 0.72 } });
  const c3Pop = spring({ frame: Math.max(0, localFrame - 30), fps, config: { damping: 11, stiffness: 185, mass: 0.72 } });
  const c4Pop = spring({ frame: Math.max(0, localFrame - 38), fps, config: { damping: 11, stiffness: 185, mass: 0.72 } });

  const ringSweep = easeOutCubic(
    interpolate(localFrame, [32, 58], [0, 0.86], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  );
  const ringR = 26;
  const ringCirc = 2 * Math.PI * ringR;

  const miniBars = [0.38, 0.56, 0.48, 0.72, 0.96];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look34StudioBackdrop localFrame={localFrame} patternId={`l34-bg2-${sceneIndex}`} />

      {/* Top Compact Studio Header (y=112..255) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: SAFE_TOP,
          width: SAFE_W,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: appear(localFrame, 0, 10),
        }}
      >
        <div
          style={{
            padding: '6px 16px',
            borderRadius: 99,
            backgroundColor: L34_CHIP,
            marginBottom: 10,
          }}
        >
          <FitText
            text={t.badge || 'KEY FEATURES · UI CARDS'}
            baseSize={20}
            minSize={16}
            maxLines={1}
            lineHeight={1.3}
            color={L34_GREEN}
            fontWeight={800}
            align="center"
          />
        </div>
        <FitText
          text={t.title || 'ฟีเจอร์หลักครบจบในหน้าจอเดียว'}
          baseSize={42}
          minSize={28}
          maxLines={2}
          lineHeight={1.3}
          color={L34_INK}
          fontWeight={800}
          align="center"
        />
      </div>

      {/* Center 3D Phone (430×870) */}
      <div
        style={{
          position: 'absolute',
          left: (STAGE_W - 430) / 2,
          top: 325,
        }}
      >
        <Look34PhoneShell
          width={430}
          height={870}
          rotateYDeg={rotateY}
          rotateXDeg={3}
          rotateZDeg={-1.5}
          floatY={phoneFloat}
          glintProgress={glintProgress}
        >
          <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 800, color: L34_INK, lineHeight: 1.35 }}>แดชบอร์ด</div>
              <div
                style={{
                  padding: '4px 10px',
                  borderRadius: 99,
                  backgroundColor: L34_CHIP,
                  color: L34_GREEN,
                  fontFamily: FONT_NUM,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                ACTIVE
              </div>
            </div>

            {/* Clean Inner Balance Block */}
            <div style={{ padding: '18px 16px', borderRadius: 20, backgroundColor: '#F6F9FC', border: `1px solid ${L34_BORDER}` }}>
              <div style={{ fontFamily: FONT_NUM, fontSize: 13, fontWeight: 600, color: L34_LABEL, marginBottom: 4 }}>
                PERFORMANCE INDEX
              </div>
              <div style={{ fontFamily: FONT_NUM, fontSize: 44, fontWeight: 900, color: L34_INK, fontVariantNumeric: 'tabular-nums' }}>
                {`${92 + (seed % 7)}.4%`}
              </div>
              <div style={{ marginTop: 10, height: 8, borderRadius: 99, backgroundColor: '#E2E8F0', overflow: 'hidden' }}>
                <div style={{ width: '84%', height: '100%', borderRadius: 99, backgroundColor: L34_GREEN }} />
              </div>
            </div>

            {/* Placeholder Skeleton UI Rows inside phone so floating cards own the focus */}
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 14,
                  backgroundColor: '#F8FAFC',
                  border: `1px solid ${L34_BORDER}`,
                }}
              >
                <div style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: i === 0 ? L34_CHIP : '#E9EEF4' }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ width: `${65 + ((i * 11) % 25)}%`, height: 10, borderRadius: 6, backgroundColor: '#D5DEE8' }} />
                  <div style={{ width: '42%', height: 8, borderRadius: 6, backgroundColor: '#E7EDF4' }} />
                </div>
                <div style={{ width: 44, height: 18, borderRadius: 99, backgroundColor: i % 2 === 0 ? L34_CHIP : '#EDF1F6' }} />
              </div>
            ))}
          </div>
        </Look34PhoneShell>
      </div>

      {/* FLOATING CARD 1 (Top-Left): Notification Card emerging from camera capsule */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 300,
          width: 446,
          padding: '18px 20px',
          borderRadius: 24,
          backgroundColor: L34_WHITE,
          border: `1px solid rgba(14,17,22,0.06)`,
          boxShadow: '0 22px 48px rgba(14,17,22,0.14), 0 4px 12px rgba(14,17,22,0.06)',
          transformOrigin: '88% 20%',
          transform: `translateY(${cardFloat.toFixed(1)}px) scale(${Math.max(0.01, c1Pop).toFixed(3)}) rotate(-1.5deg)`,
          opacity: c1Pop > 0.02 ? 1 : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              backgroundColor: L34_CHIP,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d="M4 9.5 L7.5 13 L14 5.5" fill="none" stroke={L34_GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span style={{ fontFamily: FONT_NUM, fontSize: 15, fontWeight: 700, color: L34_GREEN, letterSpacing: '0.04em' }}>
            FEATURE 01
          </span>
          <span style={{ marginLeft: 'auto', fontFamily: FONT_NUM, fontSize: 13, color: L34_LABEL }}>NOW</span>
        </div>
        <FitText
          text={cards[0]}
          baseSize={24}
          minSize={18}
          maxLines={3}
          lineHeight={1.34}
          color={L34_INK}
          fontWeight={700}
          align="left"
        />
      </div>

      {/* FLOATING CARD 2 (Mid-Right): Stat Card with Mini Rising Bar Chart */}
      <div
        style={{
          position: 'absolute',
          left: STAGE_W - SAFE_X - 442,
          top: 525,
          width: 442,
          padding: '20px 22px',
          borderRadius: 24,
          backgroundColor: L34_WHITE,
          border: `1px solid rgba(14,17,22,0.06)`,
          boxShadow: '0 24px 52px rgba(14,17,22,0.16), 0 6px 14px rgba(14,17,22,0.06)',
          transformOrigin: '15% 50%',
          transform: `translateY(${(-cardFloat * 0.8).toFixed(1)}px) scale(${Math.max(0.01, c2Pop).toFixed(3)}) rotate(1.2deg)`,
          opacity: c2Pop > 0.02 ? 1 : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span
            style={{
              padding: '5px 12px',
              borderRadius: 99,
              backgroundColor: L34_CHIP,
              color: L34_GREEN,
              fontFamily: FONT_NUM,
              fontSize: 15,
              fontWeight: 800,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            ▲ +34.8%
          </span>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 42 }}>
            {miniBars.map((h, i) => {
              const bp = stagger(i, localFrame, 3, 24, 10);
              return (
                <div
                  key={i}
                  style={{
                    width: 11,
                    height: Math.max(6, Math.round(h * 40 * bp)),
                    borderRadius: 4,
                    backgroundColor: i === miniBars.length - 1 ? L34_GREEN : '#DCE4EC',
                  }}
                />
              );
            })}
          </div>
        </div>
        <FitText
          text={cards[1]}
          baseSize={24}
          minSize={18}
          maxLines={3}
          lineHeight={1.34}
          color={L34_INK}
          fontWeight={700}
          align="left"
        />
      </div>

      {/* FLOATING CARD 3 (Lower-Left): Progress Ring Card */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 830,
          width: 452,
          padding: '20px 22px',
          borderRadius: 24,
          backgroundColor: L34_WHITE,
          border: `1px solid rgba(14,17,22,0.06)`,
          boxShadow: '0 24px 52px rgba(14,17,22,0.16), 0 6px 14px rgba(14,17,22,0.06)',
          transformOrigin: '80% 45%',
          transform: `translateY(${(cardFloat * 0.9).toFixed(1)}px) scale(${Math.max(0.01, c3Pop).toFixed(3)}) rotate(-1.2deg)`,
          opacity: c3Pop > 0.02 ? 1 : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 66, height: 66, position: 'relative', flexShrink: 0 }}>
            <svg width="66" height="66" viewBox="0 0 66 66">
              <circle cx="33" cy="33" r={ringR} fill="none" stroke={L34_CHIP} strokeWidth="7" />
              <circle
                cx="33"
                cy="33"
                r={ringR}
                fill="none"
                stroke={L34_GREEN}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={ringCirc}
                strokeDashoffset={ringCirc * (1 - ringSweep)}
                transform="rotate(-90 33 33)"
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: FONT_NUM,
                fontSize: 15,
                fontWeight: 800,
                color: L34_INK,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {`${Math.round(ringSweep * 100)}%`}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT_NUM, fontSize: 14, fontWeight: 700, color: L34_LABEL, marginBottom: 4 }}>
              GOAL PROGRESS
            </div>
            <FitText
              text={cards[2]}
              baseSize={23}
              minSize={18}
              maxLines={3}
              lineHeight={1.34}
              color={L34_INK}
              fontWeight={700}
              align="left"
            />
          </div>
        </div>
      </div>

      {/* OPTIONAL FLOATING CARD 4 (Bottom-Right when 4+ bullets exist, strictly y <= 1380) */}
      {cards[3] ? (
        <div
          style={{
            position: 'absolute',
            left: STAGE_W - SAFE_X - 442,
            top: 1090,
            width: 442,
            padding: '18px 22px',
            borderRadius: 24,
            backgroundColor: L34_WHITE,
            border: `1px solid rgba(14,17,22,0.06)`,
            boxShadow: '0 22px 46px rgba(14,17,22,0.14), 0 4px 12px rgba(14,17,22,0.06)',
            transformOrigin: '20% 40%',
            transform: `translateY(${(-cardFloat * 0.7).toFixed(1)}px) scale(${Math.max(0.01, c4Pop).toFixed(3)}) rotate(1deg)`,
            opacity: c4Pop > 0.02 ? 1 : 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: 99,
                backgroundColor: L34_CHIP,
                color: L34_GREEN,
                fontFamily: FONT_NUM,
                fontSize: 14,
                fontWeight: 800,
              }}
            >
              04 · READY
            </span>
          </div>
          <FitText
            text={cards[3]}
            baseSize={23}
            minSize={18}
            maxLines={3}
            lineHeight={1.34}
            color={L34_INK}
            fontWeight={700}
            align="left"
          />
        </div>
      ) : null}
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-34 Shot 3: 'kpi-screen'
// Big stat KPI on phone screen + emerald chip + crisp mini chart
// ----------------------------------------------------------------------------
const Look34KpiScreen: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const parsed = parseStatValueK(scene, sceneIndex, 94.6, '%');
  const pts = extractPointsK(scene, 2);
  const seed = stringSeedK(`kpi-${scene.id}-${t.title}-${sceneIndex}`);

  const turnSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 92, mass: 1.1 },
  });
  const rotateY = -32 * (1 - turnSpring);
  const floatY = Math.sin(localFrame * 0.05) * 5;
  const glintProgress = interpolate(localFrame, [2, 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const countT = easeOutCubic(
    interpolate(localFrame, [6, 36], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  );
  const displayNum = formatNumberK(parsed.target * countT, parsed.decimals, parsed.useComma);
  const chipPop = spring({
    frame: Math.max(0, localFrame - 32),
    fps,
    config: { damping: 11, stiffness: 215, mass: 0.7 },
  });
  const chartDraw = easeOutCubic(
    interpolate(localFrame, [8, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  );

  // Smooth rising curve inside KPI screen
  const curvePts: Array<[number, number]> = Array.from({ length: 10 }).map((_, i) => {
    const frac = i / 9;
    const bump = Math.sin(frac * 3.8 + (seed % 4)) * 10;
    return [14 + frac * 352, 134 - Math.pow(frac, 1.15) * 96 + bump];
  });
  const curveLen = polylineLengthK(curvePts);
  const curveTip = samplePolylineK(curvePts, chartDraw);
  const gradId = `l34-kpi-g-${sceneIndex}`;

  const leftPillPop = spring({ frame: Math.max(0, localFrame - 22), fps, config: { damping: 12, stiffness: 190, mass: 0.75 } });
  const rightPillPop = spring({ frame: Math.max(0, localFrame - 30), fps, config: { damping: 12, stiffness: 190, mass: 0.75 } });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look34StudioBackdrop localFrame={localFrame} patternId={`l34-bg3-${sceneIndex}`} />

      {/* Top Studio Header (y=112..265) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: SAFE_TOP,
          width: SAFE_W,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: appear(localFrame, 0, 10),
        }}
      >
        <div
          style={{
            padding: '6px 16px',
            borderRadius: 99,
            backgroundColor: L34_CHIP,
            marginBottom: 10,
          }}
        >
          <FitText
            text={t.badge || 'LIVE KPI METRICS'}
            baseSize={20}
            minSize={16}
            maxLines={1}
            lineHeight={1.3}
            color={L34_GREEN}
            fontWeight={800}
            align="center"
          />
        </div>
        <FitText
          text={t.title || parsed.label || 'ผลลัพธ์สำคัญแบบเรียลไทม์'}
          baseSize={42}
          minSize={28}
          maxLines={2}
          lineHeight={1.3}
          color={L34_INK}
          fontWeight={800}
          align="center"
        />
      </div>

      {/* Center 460×940 Phone (y=295..1289) */}
      <div
        style={{
          position: 'absolute',
          left: (STAGE_W - 460) / 2,
          top: 295,
        }}
      >
        <Look34PhoneShell
          width={460}
          height={940}
          rotateYDeg={rotateY}
          rotateXDeg={2.5}
          rotateZDeg={0}
          floatY={floatY}
          glintProgress={glintProgress}
        >
          <div style={{ padding: '14px 24px 12px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
            {/* Timeframe Switcher */}
            <div style={{ display: 'flex', backgroundColor: '#EEF2F6', borderRadius: 12, padding: 4 }}>
              {['7D', '30D', '90D', '1Y'].map((tf, i) => (
                <div
                  key={tf}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    padding: '6px 0',
                    borderRadius: 9,
                    backgroundColor: i === 1 ? L34_WHITE : 'transparent',
                    color: i === 1 ? L34_INK : L34_LABEL,
                    fontFamily: FONT_NUM,
                    fontSize: 14,
                    fontWeight: 700,
                    boxShadow: i === 1 ? '0 2px 6px rgba(14,17,22,0.08)' : 'none',
                  }}
                >
                  {tf}
                </div>
              ))}
            </div>

            {/* Huge Tabular KPI Card */}
            <div
              style={{
                padding: '22px 20px',
                borderRadius: 24,
                backgroundColor: '#F7FAF9',
                border: `1.5px solid ${L34_CHIP}`,
                textAlign: 'center',
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <FitText
                  text={parsed.label || 'ตัวชี้วัดหลัก'}
                  baseSize={20}
                  minSize={16}
                  maxLines={2}
                  lineHeight={1.32}
                  color={L34_LABEL}
                  fontWeight={600}
                  align="center"
                />
              </div>

              <div
                style={{
                  fontFamily: FONT_NUM,
                  fontSize: displayNum.length > 6 ? 56 : 70,
                  fontWeight: 900,
                  letterSpacing: '-0.035em',
                  color: L34_INK,
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.05,
                }}
              >
                {`${parsed.prefix}${displayNum}${parsed.suffix}`}
              </div>

              {parsed.unit ? (
                <div style={{ marginTop: 4 }}>
                  <FitText
                    text={parsed.unit}
                    baseSize={22}
                    minSize={16}
                    maxLines={1}
                    lineHeight={1.3}
                    color={L34_LABEL}
                    fontWeight={700}
                    align="center"
                  />
                </div>
              ) : null}

              {/* Emerald Green Delta Chip */}
              <div
                style={{
                  marginTop: 14,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 16px',
                  borderRadius: 99,
                  backgroundColor: L34_CHIP,
                  color: L34_GREEN,
                  fontFamily: FONT_NUM,
                  fontSize: 17,
                  fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums',
                  transform: `scale(${clamp01(chipPop).toFixed(3)})`,
                }}
              >
                <span>▲</span>
                <span>{parsed.delta || '+28.4% vs เดือนก่อน'}</span>
              </div>
            </div>

            {/* Crisp Mini Chart */}
            <div
              style={{
                borderRadius: 20,
                backgroundColor: '#F8FAFC',
                border: `1px solid ${L34_BORDER}`,
                padding: '10px 8px 6px',
              }}
            >
              <svg width="380" height="150" viewBox="0 0 380 150" style={{ width: '100%', height: 'auto', display: 'block' }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={L34_GREEN} stopOpacity="0.24" />
                    <stop offset="100%" stopColor={L34_GREEN} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[34, 74, 114].map((y) => (
                  <line key={y} x1="14" y1={y} x2="366" y2={y} stroke="#E4EAF0" strokeWidth="1" strokeDasharray="3 4" />
                ))}
                <path
                  d={`M ${curvePts[0][0]} 142 ${curvePts.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')} L ${curvePts[curvePts.length - 1][0]} 142 Z`}
                  fill={`url(#${gradId})`}
                  opacity={chartDraw}
                />
                <polyline
                  points={pointsToSvgAttrK(curvePts)}
                  fill="none"
                  stroke={L34_GREEN}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={curveLen}
                  strokeDashoffset={Math.max(0, curveLen * (1 - chartDraw))}
                />
                <circle cx={curveTip.x} cy={curveTip.y} r="7" fill={L34_GREEN} stroke="#FFFFFF" strokeWidth="2.5" />
              </svg>
            </div>

            {/* Progress Target Bar */}
            <div style={{ padding: '14px 16px', borderRadius: 16, backgroundColor: '#F8FAFC', border: `1px solid ${L34_BORDER}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontFamily: FONT_THAI, fontSize: 16, fontWeight: 700, color: L34_INK, lineHeight: 1.35 }}>เป้าหมายประจำรอบ</span>
                <span style={{ fontFamily: FONT_NUM, fontSize: 16, fontWeight: 800, color: L34_GREEN, fontVariantNumeric: 'tabular-nums' }}>
                  {`${Math.round(parsed.progress * 100 * countT)}%`}
                </span>
              </div>
              <div style={{ height: 10, borderRadius: 99, backgroundColor: '#E4EAF0', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${(parsed.progress * 100 * countT).toFixed(1)}%`,
                    height: '100%',
                    borderRadius: 99,
                    backgroundColor: L34_GREEN,
                  }}
                />
              </div>
            </div>

            {/* Bottom Key Takeaway Row */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 16,
                backgroundColor: L34_WHITE,
                border: `1px solid ${L34_BORDER}`,
              }}
            >
              <FitText
                text={pts[0] || t.subtitle || 'เติบโตต่อเนื่องอย่างมีเสถียรภาพ'}
                baseSize={19}
                minSize={15}
                maxLines={2}
                lineHeight={1.32}
                color={L34_INK}
                fontWeight={600}
                align="left"
              />
            </div>
          </div>
        </Look34PhoneShell>
      </div>

      {/* Left Flanking Studio KPI Pill (x=54..286) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 560,
          width: 230,
          padding: '16px 18px',
          borderRadius: 22,
          backgroundColor: L34_WHITE,
          boxShadow: '0 20px 44px rgba(14,17,22,0.14)',
          transform: `translateY(${(-floatY * 1.2).toFixed(1)}px) scale(${Math.max(0.01, leftPillPop).toFixed(3)})`,
          opacity: leftPillPop > 0.02 ? 1 : 0,
        }}
      >
        <div style={{ fontFamily: FONT_NUM, fontSize: 13, fontWeight: 700, color: L34_LABEL, marginBottom: 4 }}>STATUS</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: L34_GREEN }} />
          <span style={{ fontFamily: FONT_THAI, fontSize: 20, fontWeight: 800, color: L34_INK, lineHeight: 1.35 }}>อัปเดตสด</span>
        </div>
      </div>

      {/* Right Flanking Studio KPI Pill (x=796..1026) */}
      <div
        style={{
          position: 'absolute',
          left: STAGE_W - SAFE_X - 230,
          top: 840,
          width: 230,
          padding: '16px 18px',
          borderRadius: 22,
          backgroundColor: L34_WHITE,
          boxShadow: '0 20px 44px rgba(14,17,22,0.14)',
          transform: `translateY(${(floatY * 1.2).toFixed(1)}px) scale(${Math.max(0.01, rightPillPop).toFixed(3)})`,
          opacity: rightPillPop > 0.02 ? 1 : 0,
        }}
      >
        <div style={{ fontFamily: FONT_NUM, fontSize: 13, fontWeight: 700, color: L34_LABEL, marginBottom: 4 }}>GROWTH</div>
        <div style={{ fontFamily: FONT_NUM, fontSize: 26, fontWeight: 900, color: L34_GREEN, fontVariantNumeric: 'tabular-nums' }}>
          {parsed.delta || '+28.4%'}
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-34 Shot 4: 'onboarding-steps'
// Steps rendered as polished app onboarding screen with progress dots
// ----------------------------------------------------------------------------
const Look34OnboardingSteps: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps }) => {
  const t = sceneTexts(scene);
  const rawSteps = extractStepObjectsK(scene, ['01', '02', '03', '04'], 4);
  const steps =
    rawSteps.length > 0
      ? rawSteps
      : [
          { tag: '01', title: t.title || 'เชื่อมต่อบัญชีของคุณ', detail: '' },
          { tag: '02', title: t.subtitle || 'ตั้งค่าเป้าหมายที่ต้องการ', detail: '' },
          { tag: '03', title: 'เริ่มต้นใช้งานได้ทันที', detail: '' },
        ];

  const turnSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 90, mass: 1.1 },
  });
  const rotateY = -28 * (1 - turnSpring);
  const floatY = Math.sin(localFrame * 0.05) * 5;
  const glintProgress = interpolate(localFrame, [2, 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Active onboarding step advances smoothly through the scene
  const safeDur = Math.max(45, durationFrames);
  const activeFloat = interpolate(localFrame, [10, Math.max(26, safeDur - 14)], [0, steps.length - 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const activeIdx = Math.min(steps.length - 1, Math.max(0, Math.round(activeFloat)));

  const badgePop = spring({ frame: Math.max(0, localFrame - 18), fps, config: { damping: 12, stiffness: 190, mass: 0.72 } });
  const donePop = spring({ frame: Math.max(0, localFrame - 28), fps, config: { damping: 12, stiffness: 190, mass: 0.72 } });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look34StudioBackdrop localFrame={localFrame} patternId={`l34-bg4-${sceneIndex}`} />

      {/* Top Studio Header (y=112..265) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: SAFE_TOP,
          width: SAFE_W,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: appear(localFrame, 0, 10),
        }}
      >
        <div
          style={{
            padding: '6px 16px',
            borderRadius: 99,
            backgroundColor: L34_CHIP,
            marginBottom: 10,
          }}
        >
          <FitText
            text={t.badge || `ONBOARDING · ${steps.length} ขั้นตอน`}
            baseSize={20}
            minSize={16}
            maxLines={1}
            lineHeight={1.3}
            color={L34_GREEN}
            fontWeight={800}
            align="center"
          />
        </div>
        <FitText
          text={t.title || 'เริ่มต้นใช้งานง่ายๆ ในไม่กี่ขั้นตอน'}
          baseSize={42}
          minSize={28}
          maxLines={2}
          lineHeight={1.3}
          color={L34_INK}
          fontWeight={800}
          align="center"
        />
      </div>

      {/* Center 460×940 Phone (y=295..1289) */}
      <div
        style={{
          position: 'absolute',
          left: (STAGE_W - 460) / 2,
          top: 295,
        }}
      >
        <Look34PhoneShell
          width={460}
          height={940}
          rotateYDeg={rotateY}
          rotateXDeg={2.5}
          rotateZDeg={0}
          floatY={floatY}
          glintProgress={glintProgress}
        >
          <div style={{ padding: '14px 24px 12px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
            {/* Onboarding Progress Dots */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {steps.map((_, i) => {
                  const isActive = i === activeIdx;
                  const isDone = i < activeIdx;
                  return (
                    <div
                      key={i}
                      style={{
                        width: isActive ? 34 : 10,
                        height: 10,
                        borderRadius: 99,
                        backgroundColor: isActive || isDone ? L34_GREEN : '#DCE3EC',
                      }}
                    />
                  );
                })}
              </div>
              <span
                style={{
                  fontFamily: FONT_NUM,
                  fontSize: 14,
                  fontWeight: 700,
                  color: L34_LABEL,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {`${activeIdx + 1} / ${steps.length}`}
              </span>
            </div>

            {/* Clean Emerald Hero Illustration Card inside Phone */}
            <div
              style={{
                borderRadius: 22,
                backgroundColor: L34_CHIP,
                padding: '18px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 18,
                  backgroundColor: L34_GREEN,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: '0 8px 18px rgba(14,159,110,0.28)',
                }}
              >
                <svg width="28" height="28" viewBox="0 0 28 28">
                  <path
                    d="M6 14.5 L11.5 20 L22 8.5"
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_NUM, fontSize: 13, fontWeight: 800, color: L34_GREEN, letterSpacing: '0.06em' }}>
                  {`STEP 0${activeIdx + 1}`}
                </div>
                <FitText
                  text={steps[activeIdx]?.title || 'พร้อมเริ่มใช้งาน'}
                  baseSize={21}
                  minSize={16}
                  maxLines={2}
                  lineHeight={1.32}
                  color={L34_INK}
                  fontWeight={800}
                  align="left"
                />
              </div>
            </div>

            {/* Step Checklist Items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: steps.length >= 4 ? 10 : 13 }}>
              {steps.map((st, idx) => {
                const isDone = idx <= activeIdx;
                const isCurrent = idx === activeIdx;
                const sp = stagger(idx, localFrame, 6, 8, 12);
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: steps.length >= 4 ? '12px 14px' : '15px 16px',
                      borderRadius: 18,
                      backgroundColor: isCurrent ? L34_WHITE : '#F8FAFC',
                      border: `1.5px solid ${isCurrent ? L34_GREEN : L34_BORDER}`,
                      boxShadow: isCurrent ? '0 10px 22px rgba(14,159,110,0.12)' : 'none',
                      opacity: sp,
                      transform: `translateY(${(1 - sp) * 14}px)`,
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 99,
                        backgroundColor: isDone ? L34_GREEN : '#E6ECF2',
                        color: isDone ? L34_WHITE : L34_LABEL,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: FONT_NUM,
                        fontSize: 15,
                        fontWeight: 800,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {isDone ? '✓' : idx + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FitText
                        text={st.detail ? `${st.title} — ${st.detail}` : st.title}
                        baseSize={steps.length >= 4 ? 19 : 21}
                        minSize={16}
                        maxLines={2}
                        lineHeight={1.32}
                        color={L34_INK}
                        fontWeight={isCurrent ? 800 : 600}
                        align="left"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Primary CTA Button inside Screen */}
            <div
              style={{
                marginTop: 'auto',
                padding: '15px 20px',
                borderRadius: 16,
                backgroundColor: L34_GREEN,
                textAlign: 'center',
                boxShadow: '0 10px 20px rgba(14,159,110,0.28)',
              }}
            >
              <FitText
                text={activeIdx === steps.length - 1 ? 'เริ่มต้นใช้งานเลย' : 'ขั้นตอนถัดไป →'}
                baseSize={21}
                minSize={17}
                maxLines={1}
                lineHeight={1.3}
                color={L34_WHITE}
                fontWeight={800}
                align="center"
              />
            </div>
          </div>
        </Look34PhoneShell>
      </div>

      {/* Flanking Floating Step Counter Pill (Left) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: 470,
          width: 226,
          padding: '16px 18px',
          borderRadius: 22,
          backgroundColor: L34_WHITE,
          boxShadow: '0 20px 44px rgba(14,17,22,0.14)',
          transform: `translateY(${(-floatY * 1.1).toFixed(1)}px) scale(${Math.max(0.01, badgePop).toFixed(3)})`,
          opacity: badgePop > 0.02 ? 1 : 0,
        }}
      >
        <div style={{ fontFamily: FONT_NUM, fontSize: 13, fontWeight: 700, color: L34_LABEL, marginBottom: 4 }}>PROGRESS</div>
        <div style={{ fontFamily: FONT_NUM, fontSize: 28, fontWeight: 900, color: L34_INK, fontVariantNumeric: 'tabular-nums' }}>
          {`${activeIdx + 1} / ${steps.length}`}
        </div>
      </div>

      {/* Flanking Floating Ready Pill (Right) */}
      <div
        style={{
          position: 'absolute',
          left: STAGE_W - SAFE_X - 226,
          top: 930,
          width: 226,
          padding: '16px 18px',
          borderRadius: 22,
          backgroundColor: L34_WHITE,
          boxShadow: '0 20px 44px rgba(14,17,22,0.14)',
          transform: `translateY(${(floatY * 1.1).toFixed(1)}px) scale(${Math.max(0.01, donePop).toFixed(3)})`,
          opacity: donePop > 0.02 ? 1 : 0,
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '4px 10px',
            borderRadius: 99,
            backgroundColor: L34_CHIP,
            color: L34_GREEN,
            fontFamily: FONT_NUM,
            fontSize: 13,
            fontWeight: 800,
            marginBottom: 6,
          }}
        >
          READY
        </div>
        <div style={{ fontFamily: FONT_THAI, fontSize: 19, fontWeight: 800, color: L34_INK, lineHeight: 1.35 }}>ทำตามได้ทันที</div>
      </div>
    </div>
  );
};

// ============================================================================
// EXPORTED REGISTRY DEFINITIONS — BATCH_K (look-33, look-34)
// ============================================================================

export const BATCH_K: StyleDirectorDef[] = [
  {
    styleId: 'look-33',
    caption: 'bar',
    shots: {
      'counter-line': Look33CounterLine,
      'event-marker': Look33EventMarker,
      'bar-compare': Look33BarCompare,
      'ticker-rows': Look33TickerRows,
    },
    shotLabels: {
      'counter-line': 'ตัวเลขสถิติขนาดใหญ่นับขึ้นแบบ tabular พร้อมเส้นกราฟที่วาดซ้ายไปขวาและเปลี่ยนเป็นสีส้มตรงจุดเปลี่ยน',
      'event-marker': 'เส้นแนวตั้งบอกจุดเหตุการณ์สำคัญพร้อมการ์ดป้ายอธิบาย และเส้นกราฟเปลี่ยนจากขาวเป็นส้มหลังจุดนั้น',
      'bar-compare': 'กราฟแท่งเปรียบเทียบซ้ายสีขาวนวลกับขวาสีส้มพร้อมตัวเลขส่วนต่างและรายการสรุปสองฝั่ง',
      'ticker-rows': 'รายการประเด็นแบบแถวหน้าจอเทอร์มินัลพร้อมกราฟสปาร์กไลน์ขนาดเล็กและป้ายเดลต้าแต่ละแถว',
    },
    infer: (scene) => {
      const text = haystackOfK(scene);
      if (scene.stat) {
        return 'counter-line';
      }
      if (scene.compare) {
        return 'bar-compare';
      }
      if (K_EVENT_RE.test(text)) {
        return 'event-marker';
      }
      if (Array.isArray(scene.bullets) && scene.bullets.length >= 3) {
        return 'ticker-rows';
      }
      if (K_COMPARE_RE.test(text)) {
        return 'bar-compare';
      }
      return null;
    },
  },
  {
    styleId: 'look-34',
    caption: 'bar',
    shots: {
      'phone-hero-rotate': Look34PhoneHeroRotate,
      'floating-ui-cards': Look34FloatingUiCards,
      'kpi-screen': Look34KpiScreen,
      'onboarding-steps': Look34OnboardingSteps,
    },
    shotLabels: {
      'phone-hero-rotate': 'มือถือ 3D หมุนสปริงเข้ามุมบนฉากสตูดิโอฟ้าเทาพร้อมหน้าจอแอป UI จริงและตัวเลขนับขึ้น',
      'floating-ui-cards': 'การ์ด UI สีขาว 3–4 ใบเด้งออกมารอบมือถือ 3D พร้อมกราฟแท่งจิ๋ว วงแหวนความคืบหน้า และพารัลแลกซ์',
      'kpi-screen': 'หน้าจอ KPI แสดงตัวเลขสถิติใหญ่ ชิปส่วนต่างสีเขียว และกราฟเส้นขนาดเล็กบนมือถือสตูดิโอ',
      'onboarding-steps': 'หน้าจอ Onboarding แสดงขั้นตอนทีละข้อพร้อมจุดบอกความคืบหน้าและปุ่มเริ่มใช้งานบนมือถือ 3D',
    },
    infer: (scene) => {
      const text = haystackOfK(scene);
      if (scene.stat) {
        return 'kpi-screen';
      }
      if (Array.isArray(scene.steps) && scene.steps.length >= 3) {
        return 'onboarding-steps';
      }
      if (Array.isArray(scene.bullets) && scene.bullets.length >= 2) {
        return 'floating-ui-cards';
      }
      if (K_ONBOARD_RE.test(text)) {
        return 'onboarding-steps';
      }
      if (K_APP_HERO_RE.test(text)) {
        return 'phone-hero-rotate';
      }
      return null;
    },
  },
];
