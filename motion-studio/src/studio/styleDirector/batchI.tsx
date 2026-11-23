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
// SHARED HELPERS FOR BATCH I (look-26, look-28, look-29)
// Pure, Deterministic, Inline SVG/CSS Only, Zero External Assets
// Safe stage bounds: x ∈ [54, 1026], y ∈ [112, CONTENT_BOTTOM (=1420)]
// ============================================================================

const CONTENT_BOTTOM = SAFE_BOTTOM - 120; // 1420
const SAFE_X = 54;
const SAFE_TOP = 112;

const FONT_THAI = THAI_FONT_FAMILY;
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// Regex classifiers for intelligent shot inference
const I_STEP_RE = /(?:ขั้นตอน|สเต็ป|ลำดับ|สัปดาห์|ทีละวัน|ทีละขั้น|ระยะที่|เส้นทาง|จาก.+สู่|milestone|week|step)/i;
const I_SUMMARY_RE = /(?:สรุป|สำคัญ|ไฮไลต์|ประโยคจำ|จำไว้|หัวใจ|แก่น|บทเรียน|ปิดท้าย|สำเร็จ|ครบ|พิชิต|ผลลัพธ์)/i;
const I_COMPARE_RE = /(?:เทียบ|ก่อน|หลัง|ตอนนั้น|ตอนนี้|อดีต|ปัจจุบัน|แบบเดิม|แบบใหม่|ต่างกัน|vs|before|after|เปรียบเทียบ)/i;
const I_GRID_RE = /(?:ตาราง|สะสม|นิสัย|ประจำวัน|ทุกวัน|เช็กลิสต์|รูทีน|วินัย|ต่อเนื่อง|30\s*วัน|habit|streak|grid)/i;
const I_DAY_FLIP_RE = /(?:วัน|day|นับถอยหลัง|ชาเลนจ์|challenge|ครบ|ตัวเลข|สถิติ)/i;
const I_WAYPOINT_RE = /(?:จุดแวะ|จุดพัก|หมุด|สถานี|จุดที่|ปักหมุด|waypoint|stop|checkpoint|3\s*จุด)/i;
const I_ELEV_RE = /(?:ความสูง|ระดับ|เนิน|กราฟ|สถิติ|ระยะทาง|ไต่|พุ่ง|เติบโต|ขึ้นเขา|%|กม\.|km|เมตร|เทียบ)/i;
const I_AERIAL_RE = /(?:เป้าหมาย|พิกัด|โฟกัส|ดาวเทียม|โซน|พื้นที่|เรดาร์|ศูนย์กลาง|จุดสำคัญ|target|zone|radar)/i;
const I_CITY_ROUTE_RE = /(?:เส้นทาง|แผนที่|เมือง|เดินทาง|นำทาง|ถนน|route|map|gps|ทิศทาง)/i;
const I_EXPLODE_RE = /(?:แยกชิ้น|เลเยอร์|ชั้น|โครงสร้าง|ส่วนประกอบ|แกะกล่อง|ข้างใน|ภายใน|layer|explode)/i;
const I_CUTAWAY_RE = /(?:ผ่าครึ่ง|แกนใน|ชั้นนอก|สเปก|ประสิทธิภาพ|กำลัง|ความจุ|เปรียบเทียบ|cutaway|spec|core)/i;
const I_BOM_RE = /(?:รายการ|อุปกรณ์|ชิ้นส่วน|เครื่องมือ|องค์ประกอบ|ทั้งหมด|วัสดุ|สรุป|bom|knolling|kit)/i;
const I_CALLOUT_RE = /(?:ชี้จุด|ฟังก์ชัน|หน้าที่|ทำงานยังไง|กลไก|ระบบ|จุดเด่น|callout|assembly)/i;

interface PaletteI {
  bg: string;
  bg2: string;
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  border: string;
}

function resolvePaletteI(tokens: any, fallback: PaletteI): PaletteI {
  const p = tokens?.palette || {};
  return {
    bg: typeof p.bg === 'string' && p.bg ? p.bg : fallback.bg,
    bg2:
      typeof p.bg2 === 'string' && p.bg2
        ? p.bg2
        : typeof p.bgSecondary === 'string' && p.bgSecondary
          ? p.bgSecondary
          : fallback.bg2,
    surface:
      typeof p.surface === 'string' && p.surface
        ? p.surface
        : typeof p.cardBg === 'string' && p.cardBg
          ? p.cardBg
          : fallback.surface,
    fg:
      typeof p.fg === 'string' && p.fg
        ? p.fg
        : typeof p.text === 'string' && p.text
          ? p.text
          : fallback.fg,
    muted: typeof p.muted === 'string' && p.muted ? p.muted : fallback.muted,
    accent: typeof p.accent === 'string' && p.accent ? p.accent : fallback.accent,
    accent2: typeof p.accent2 === 'string' && p.accent2 ? p.accent2 : fallback.accent2,
    border: typeof p.border === 'string' && p.border ? p.border : fallback.border,
  };
}

function haystackOfI(scene: StudioScene): string {
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

function extractPointsI(scene: StudioScene, max = 4): string[] {
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

function extractStepObjectsI(
  scene: StudioScene,
  fallbackLabels: string[],
  max = 4,
): Array<{ tag: string; text: string }> {
  const out: Array<{ tag: string; text: string }> = [];
  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    scene.steps.slice(0, max).forEach((s, idx) => {
      if (typeof s === 'string') {
        out.push({ tag: fallbackLabels[idx] || `ขั้นที่ ${idx + 1}`, text: s.trim() });
      } else if (s?.title) {
        const text = s.detail ? `${s.title} — ${s.detail}` : s.title;
        out.push({ tag: s.step || fallbackLabels[idx] || `ขั้นที่ ${idx + 1}`, text });
      }
    });
  } else {
    const pts = extractPointsI(scene, max);
    pts.forEach((p, idx) => {
      out.push({ tag: fallbackLabels[idx] || `ข้อที่ ${idx + 1}`, text: p });
    });
  }
  return out;
}

function parseNumericI(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw || '').replace(/,/g, '');
  const m = s.match(/\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const val = parseFloat(m[0]);
  return Number.isFinite(val) ? val : fallback;
}

function extractPrimaryMetricI(
  scene: StudioScene,
  sceneIndex: number,
  defaultNum: number,
  defaultUnit: string,
): { big: string; unit: string; numeric: number; label: string; delta: string; progress: number } {
  const t = sceneTexts(scene);
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const rawVal = String(scene.stat.value).trim();
    const prefix = String(scene.stat.prefix || '').trim();
    const suffix = String(scene.stat.suffix || '').trim();
    const big = `${prefix}${rawVal}${suffix}`.trim();
    const numeric = scene.stat.numericValue ?? parseNumericI(rawVal, defaultNum);
    const prog =
      typeof scene.stat.progress === 'number' && Number.isFinite(scene.stat.progress)
        ? clamp01(scene.stat.progress / 100)
        : numeric > 0 && numeric <= 100
          ? clamp01(numeric / 100)
          : 0.86;
    return {
      big,
      unit: String(scene.stat.unit || defaultUnit).trim(),
      numeric,
      label: String(scene.stat.label || t.subtitle || t.title).trim(),
      delta: String(scene.stat.delta || '').trim(),
      progress: prog,
    };
  }
  if (t.numbers.length > 0) {
    const first = t.numbers[0];
    const numeric = parseNumericI(first, defaultNum);
    const prog = first.includes('%') ? clamp01(numeric / 100) : clamp01(Math.min(100, Math.max(25, numeric)) / 100);
    return {
      big: first,
      unit: defaultUnit,
      numeric,
      label: t.subtitle || t.title,
      delta: '',
      progress: prog,
    };
  }
  const seeded = defaultNum + sceneIndex * 3;
  return {
    big: `${seeded}`,
    unit: defaultUnit,
    numeric: seeded,
    label: t.subtitle || t.title,
    delta: '',
    progress: 0.88,
  };
}

function extractComparePairI(
  scene: StudioScene,
  defaultLeft: string,
  defaultRight: string,
): { leftTitle: string; rightTitle: string; leftItems: string[]; rightItems: string[] } {
  const t = sceneTexts(scene);
  if (scene.compare) {
    const leftItems = (scene.compare.leftItems || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 2);
    const rightItems = (scene.compare.rightItems || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 2);
    return {
      leftTitle: String(scene.compare.leftTitle || scene.compare.leftLabel || defaultLeft).trim(),
      rightTitle: String(scene.compare.rightTitle || scene.compare.rightLabel || defaultRight).trim(),
      leftItems: leftItems.length > 0 ? leftItems : ['จุดเริ่มต้นที่ยังไม่เป็นระบบ'],
      rightItems: rightItems.length > 0 ? rightItems : ['ผลลัพธ์ชัดเจนและวัดผลได้จริง'],
    };
  }
  const pts = extractPointsI(scene, 4);
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
    leftItems: [pts[0] || t.subtitle || 'จุดเริ่มต้นก่อนลงมือทำจริง'],
    rightItems: [t.title || 'ผลลัพธ์เมื่อทำต่อเนื่องครบเป้าหมาย'],
  };
}

function pad2(n: number): string {
  const clamped = Math.max(0, Math.min(999, Math.round(n)));
  return clamped < 10 ? `0${clamped}` : `${clamped}`;
}

/** Piecewise-linear point interpolation along a polyline */
function samplePolyline(
  pts: Array<[number, number]>,
  tRaw: number,
): { x: number; y: number; angleDeg: number } {
  const t = clamp01(tRaw);
  if (pts.length === 0) return { x: 0, y: 0, angleDeg: 0 };
  if (pts.length === 1) return { x: pts[0][0], y: pts[0][1], angleDeg: 0 };

  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    segLens.push(len);
    total += len;
  }
  if (total <= 0) return { x: pts[0][0], y: pts[0][1], angleDeg: 0 };

  let target = t * total;
  for (let i = 0; i < segLens.length; i++) {
    const len = segLens[i];
    if (target <= len || i === segLens.length - 1) {
      const ratio = len > 0 ? clamp01(target / len) : 0;
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const x = x1 + (x2 - x1) * ratio;
      const y = y1 + (y2 - y1) * ratio;
      const angleDeg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      return { x, y, angleDeg };
    }
    target -= len;
  }
  const last = pts[pts.length - 1];
  return { x: last[0], y: last[1], angleDeg: 0 };
}

function polylineLength(pts: Array<[number, number]>): number {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return total;
}

// ============================================================================
// STYLE 1: look-26 — DAY COUNTER (ตัวนับวัน)
// Midnight Slate (#0D1321–#0F172A) • Crisp Split-Flap Plates (#FFFFFF/#F3F3F1)
// Amber Streak (#F59E0B) & Emerald Progress (#10B981)
// ============================================================================

const LOOK26_DEFAULTS: PaletteI = {
  bg: '#0D1321',
  bg2: '#0F172A',
  surface: '#162033',
  fg: '#F8FAFC',
  muted: '#94A3B8',
  accent: '#FFFFFF',
  accent2: '#F3F3F1',
  border: '#2B3B55',
};

const DayCounterBackdrop: React.FC<{
  pal: PaletteI;
  localFrame: number;
  glowColor?: string;
  glowY?: number;
  patternId: string;
}> = ({ pal, localFrame, glowColor = '#F59E0B', glowY = 540, patternId }) => {
  const pulse = 0.5 + 0.5 * Math.sin(localFrame * 0.06);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 880px 640px at 540px ${glowY}px, ${glowColor}24 0%, ${pal.bg2} 46%, ${pal.bg} 100%)`,
        overflow: 'hidden',
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <pattern id={patternId} width="44" height="44" patternUnits="userSpaceOnUse">
            <circle cx="22" cy="22" r="1.4" fill="#64748B" fillOpacity="0.28" />
          </pattern>
        </defs>
        <rect width={STAGE_W} height={STAGE_H} fill={`url(#${patternId})`} />
        {/* Subtle mechanical vertical side ticks */}
        {Array.from({ length: 24 }).map((_, i) => {
          const y = 130 + i * 54;
          const major = i % 4 === 0;
          return (
            <g key={i} opacity={major ? 0.32 : 0.14}>
              <line x1={18} y1={y} x2={major ? 34 : 26} y2={y} stroke="#94A3B8" strokeWidth={major ? 2 : 1.2} />
              <line x1={STAGE_W - (major ? 34 : 26)} y1={y} x2={STAGE_W - 18} y2={y} stroke="#94A3B8" strokeWidth={major ? 2 : 1.2} />
            </g>
          );
        })}
        {/* Ambient horizon beam */}
        <ellipse
          cx={540}
          cy={glowY}
          rx={420}
          ry={180}
          fill={glowColor}
          fillOpacity={0.05 + pulse * 0.03}
        />
      </svg>
    </div>
  );
};

/** Single mechanical split-flap digit plate with crisp flip hinge & 3D mid-flip animation */
const SplitFlapPlate: React.FC<{
  char: string;
  prevChar: string;
  flipFrac: number; // 0..1 within current flip tick
  plateBg: string;
  plateBg2: string;
  width?: number;
  height?: number;
  fontSize?: number;
}> = ({ char, prevChar, flipFrac, plateBg, plateBg2, width = 188, height = 248, fontSize = 152 }) => {
  const halfH = height / 2;
  const isFlipping = char !== prevChar && flipFrac > 0.02 && flipFrac < 0.98;
  const topScaleY = isFlipping && flipFrac < 0.5 ? Math.max(0.04, 1 - flipFrac * 2) : 1;
  const botScaleY = isFlipping && flipFrac >= 0.5 ? Math.max(0.04, (flipFrac - 0.5) * 2) : 1;

  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        borderRadius: 22,
        background: '#090E1A',
        padding: 4,
        boxShadow: '0 22px 44px rgba(0,0,0,0.62), inset 0 1px 0 rgba(255,255,255,0.12)',
      }}
    >
      {/* Static Top Half (shows incoming char) */}
      <div
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          right: 4,
          height: halfH - 5,
          borderRadius: '18px 18px 4px 4px',
          background: `linear-gradient(180deg, ${plateBg} 0%, ${plateBg2} 100%)`,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize,
            fontWeight: 900,
            color: '#0F172A',
            lineHeight: `${height - 8}px`,
            letterSpacing: -4,
            userSelect: 'none',
          }}
        >
          {char}
        </span>
      </div>

      {/* Static Bottom Half (shows prevChar during first half of flip, char once past halfway) */}
      <div
        style={{
          position: 'absolute',
          bottom: 4,
          left: 4,
          right: 4,
          height: halfH - 5,
          borderRadius: '4px 4px 18px 18px',
          background: `linear-gradient(180deg, #E2E5EA 0%, ${plateBg2} 30%, ${plateBg} 100%)`,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize,
            fontWeight: 900,
            color: '#0F172A',
            lineHeight: `${height - 8}px`,
            letterSpacing: -4,
            userSelect: 'none',
          }}
        >
          {isFlipping && flipFrac < 0.5 ? prevChar : char}
        </span>
      </div>

      {/* Active Falling Top Flap (first half of flip) */}
      {isFlipping && flipFrac < 0.5 ? (
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: 4,
            right: 4,
            height: halfH - 5,
            borderRadius: '18px 18px 4px 4px',
            background: `linear-gradient(180deg, ${plateBg} 0%, #D7DCE3 100%)`,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            transformOrigin: '50% 100%',
            transform: `scaleY(${topScaleY.toFixed(3)})`,
            zIndex: 4,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize,
              fontWeight: 900,
              color: '#0F172A',
              lineHeight: `${height - 8}px`,
              letterSpacing: -4,
            }}
          >
            {prevChar}
          </span>
        </div>
      ) : null}

      {/* Active Landing Bottom Flap (second half of flip) */}
      {isFlipping && flipFrac >= 0.5 ? (
        <div
          style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            right: 4,
            height: halfH - 5,
            borderRadius: '4px 4px 18px 18px',
            background: `linear-gradient(180deg, #ECEFF3 0%, ${plateBg} 100%)`,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            transformOrigin: '50% 0%',
            transform: `scaleY(${botScaleY.toFixed(3)})`,
            zIndex: 4,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize,
              fontWeight: 900,
              color: '#0F172A',
              lineHeight: `${height - 8}px`,
              letterSpacing: -4,
            }}
          >
            {char}
          </span>
        </div>
      ) : null}

      {/* Crisp Metallic Split Hinge Line & Side Pins */}
      <div
        style={{
          position: 'absolute',
          left: 4,
          right: 4,
          top: halfH - 2,
          height: 4,
          background: '#090E1A',
          zIndex: 6,
          boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 10,
          top: halfH - 9,
          width: 10,
          height: 18,
          borderRadius: 4,
          background: 'linear-gradient(180deg, #94A3B8, #334155)',
          zIndex: 7,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 10,
          top: halfH - 9,
          width: 10,
          height: 18,
          borderRadius: 4,
          background: 'linear-gradient(180deg, #94A3B8, #334155)',
          zIndex: 7,
        }}
      />
    </div>
  );
};

/** look-26 / shot 1: flip-calendar — giant mechanical split-flap day/number counter + streak flame + summary cards */
const Look26FlipCalendar: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteI(tokens, LOOK26_DEFAULTS);
  const txt = sceneTexts(scene);
  const pts = extractPointsI(scene, 3);
  const metric = extractPrimaryMetricI(scene, sceneIndex, 30, 'วัน');

  // Target integer to count up to on the split-flap display (clamped to 2–3 digits)
  const rawTarget = Math.max(1, Math.min(999, Math.round(metric.numeric)));
  const startVal = rawTarget > 1 ? 1 : 0;
  const flipEndFrame = Math.max(24, Math.min(54, Math.round(durationFrames * 0.48)));
  const countP = easeOutCubic(clamp01((localFrame - 5) / flipEndFrame));
  const exactFloat = startVal + (rawTarget - startVal) * countP;
  const currentNum = Math.round(exactFloat);
  const prevNum = Math.max(startVal, currentNum - 1);
  const flipFrac = exactFloat - Math.floor(exactFloat);

  const digitCount = rawTarget >= 100 ? 3 : 2;
  const curStr = String(currentNum).padStart(digitCount, '0');
  const prevStr = String(prevNum).padStart(digitCount, '0');

  const headerP = appear(localFrame, 2, 13);
  const unitSpring = spring({ frame: Math.max(0, localFrame - 3), fps, config: { damping: 15, stiffness: 150 } });
  const lockBump =
    localFrame >= flipEndFrame + 5
      ? spring({ frame: localFrame - (flipEndFrame + 5), fps, config: { damping: 10, stiffness: 220 } })
      : 0;
  const streakPulse = 0.88 + 0.12 * Math.sin(localFrame * 0.22);

  const summaryItems = pts.length > 0 ? pts.slice(0, 3) : [txt.subtitle || txt.title || 'ลงมือทำอย่างสม่ำเสมอทุกวัน'];
  const plateBg = pal.accent || '#FFFFFF';
  const plateBg2 = pal.accent2 || '#F3F3F1';

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <DayCounterBackdrop pal={pal} localFrame={localFrame} glowColor="#F59E0B" glowY={560} patternId="i26-fc-dots" />

      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          zIndex: 4,
        }}
      >
        {/* Header */}
        <div
          style={{
            opacity: headerP,
            transform: `translateY(${((1 - headerP) * -16).toFixed(1)}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 20px',
              borderRadius: 999,
              background: 'rgba(245, 158, 11, 0.16)',
              border: '1.5px solid rgba(245, 158, 11, 0.6)',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 99, background: '#F59E0B', boxShadow: '0 0 12px #F59E0B' }} />
            <span style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 800, color: '#FCD34D' }}>
              {txt.badge || 'ตัวนับวันชาเลนจ์ · SPLIT-FLAP'}
            </span>
          </div>
          <FitText
            text={txt.title || 'สะสมวินัยทีละวันจนเห็นผลลัพธ์'}
            baseSize={48}
            minSize={30}
            maxLines={2}
            lineHeight={1.28}
            color={pal.fg}
          />
        </div>

        {/* Mechanical Split-Flap Housing */}
        <div
          style={{
            transform: `translateY(${((1 - unitSpring) * 44).toFixed(1)}px) scale(${(0.94 + unitSpring * 0.06 + lockBump * 0.015).toFixed(4)})`,
            borderRadius: 34,
            background: 'linear-gradient(165deg, #25334D 0%, #151F33 52%, #0C1322 100%)',
            border: `2px solid ${pal.border}`,
            padding: '22px 26px 26px',
            boxShadow: '0 34px 72px rgba(0,0,0,0.58), inset 0 1px 0 rgba(255,255,255,0.12)',
          }}
        >
          {/* Top Housing Header Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 20,
              paddingBottom: 14,
              borderBottom: '1.5px solid rgba(148,163,184,0.18)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  padding: '6px 16px',
                  borderRadius: 10,
                  background: '#EF4444',
                  fontFamily: FONT_MONO,
                  fontSize: 22,
                  fontWeight: 900,
                  color: '#FFFFFF',
                  letterSpacing: 2,
                  boxShadow: '0 6px 16px rgba(239,68,68,0.45)',
                }}
              >
                DAY
              </div>
              <span style={{ fontFamily: FONT_MONO, fontSize: 20, fontWeight: 700, color: '#94A3B8', letterSpacing: 1.5 }}>
                TRACKER · {pad2(startVal)} → {pad2(rawTarget)}
              </span>
            </div>

            {/* Live Streak Flame Chip */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 16px',
                borderRadius: 999,
                background: 'rgba(16, 185, 129, 0.16)',
                border: '1.5px solid rgba(16, 185, 129, 0.6)',
                transform: `scale(${streakPulse.toFixed(3)})`,
              }}
            >
              <svg width={20} height={22} viewBox="0 0 24 26" fill="none">
                <path
                  d="M12.5 2C12.5 2 18 7.5 18 14C18 18.4 15.2 22 11.5 22C7.8 22 5 18.8 5 14.8C5 12 6.8 9.2 8.4 7.5C8.4 10 9.6 11.4 10.6 11.8C10.2 8.4 12.5 2 12.5 2Z"
                  fill="#F59E0B"
                />
                <path
                  d="M11.6 12.5C11.6 12.5 14.5 15 14.5 17.8C14.5 19.8 13.2 21 11.5 21C9.8 21 8.5 19.7 8.5 17.8C8.5 16 9.9 14 11.6 12.5Z"
                  fill="#FEF08A"
                />
              </svg>
              <span style={{ fontFamily: FONT_THAI, fontSize: 20, fontWeight: 800, color: '#6EE7B7' }}>
                {metric.delta || `${currentNum} ${metric.unit}ติด`}
              </span>
            </div>
          </div>

          {/* Giant Split-Flap Digit Row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: digitCount === 3 ? 18 : 26,
              padding: '6px 0 18px',
            }}
          >
            {curStr.split('').map((ch, idx) => (
              <SplitFlapPlate
                key={idx}
                char={ch}
                prevChar={prevStr[idx] || ch}
                flipFrac={flipFrac}
                plateBg={plateBg}
                plateBg2={plateBg2}
                width={digitCount === 3 ? 174 : 214}
                height={244}
                fontSize={digitCount === 3 ? 142 : 168}
              />
            ))}
          </div>

          {/* Unit & Progress Bar Footer inside Housing */}
          <div
            style={{
              borderRadius: 18,
              background: 'rgba(13, 19, 33, 0.72)',
              border: '1px solid rgba(148,163,184,0.2)',
              padding: '14px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText
                  text={metric.label || txt.subtitle || 'เป้าหมายชาเลนจ์ต่อเนื่อง'}
                  baseSize={23}
                  minSize={17}
                  maxLines={2}
                  lineHeight={1.28}
                  color="#E2E8F0"
                  fontWeight={700}
                  align="left"
                />
              </div>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 26,
                  fontWeight: 900,
                  color: '#F59E0B',
                  flexShrink: 0,
                }}
              >
                {metric.big}
              </span>
            </div>
            <div style={{ height: 12, borderRadius: 99, background: '#1E293B', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${(clamp01(countP * metric.progress) * 100).toFixed(1)}%`,
                  borderRadius: 99,
                  background: 'linear-gradient(90deg, #F59E0B 0%, #10B981 100%)',
                  boxShadow: '0 0 16px rgba(16,185,129,0.55)',
                }}
              />
            </div>
          </div>
        </div>

        {/* Bottom Summary Cards (auto-height, strictly above CONTENT_BOTTOM) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {summaryItems.map((item, idx) => {
            const p = stagger(idx, localFrame, 6, 16, 14);
            const accentCol = idx === 0 ? '#F59E0B' : idx === 1 ? '#10B981' : '#38BDF8';
            return (
              <div
                key={idx}
                style={{
                  opacity: p,
                  transform: `translateY(${((1 - p) * 20).toFixed(1)}px)`,
                  borderRadius: 20,
                  background: 'rgba(22, 32, 51, 0.92)',
                  border: `1.5px solid ${idx === 0 ? `${accentCol}88` : pal.border}`,
                  padding: '13px 18px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                  minHeight: 74,
                  height: 'auto',
                  boxShadow: '0 12px 28px rgba(0,0,0,0.34)',
                }}
              >
                <div
                  style={{
                    minWidth: 42,
                    height: 38,
                    borderRadius: 11,
                    background: `${accentCol}22`,
                    border: `1.5px solid ${accentCol}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: FONT_MONO,
                    fontSize: 19,
                    fontWeight: 900,
                    color: accentCol,
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  0{idx + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item}
                    baseSize={24}
                    minSize={18}
                    maxLines={3}
                    lineHeight={1.3}
                    color={pal.fg}
                    fontWeight={700}
                    align="left"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** look-26 / shot 2: streak-grid — 30-day habit contribution grid lighting up sequentially + 2–3 insight cards */
const Look26StreakGrid: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteI(tokens, LOOK26_DEFAULTS);
  const txt = sceneTexts(scene);
  const pts = extractPointsI(scene, 3);
  const metric = extractPrimaryMetricI(scene, sceneIndex, 30, 'วัน');

  const totalDays = 30;
  const targetFilled = Math.max(12, Math.min(30, Math.round(metric.numeric <= 30 ? metric.numeric : 30)));
  const headerP = appear(localFrame, 2, 13);
  const boardP = appear(localFrame, 4, 14);
  const waveEnd = Math.max(28, Math.min(62, Math.round(durationFrames * 0.56)));
  const litFloat = easeOutCubic(clamp01((localFrame - 6) / waveEnd)) * targetFilled;
  const litCount = Math.min(targetFilled, Math.floor(litFloat));

  const cards = pts.length > 0 ? pts.slice(0, 3) : [txt.subtitle || txt.title || 'ทำต่อเนื่องทุกวันสร้างผลลัพธ์ทวีคูณ'];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <DayCounterBackdrop pal={pal} localFrame={localFrame} glowColor="#10B981" glowY={520} patternId="i26-sg-dots" />

      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          zIndex: 4,
        }}
      >
        {/* Header */}
        <div
          style={{
            opacity: headerP,
            transform: `translateY(${((1 - headerP) * -16).toFixed(1)}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 20px',
              borderRadius: 999,
              background: 'rgba(16, 185, 129, 0.16)',
              border: '1.5px solid rgba(16, 185, 129, 0.6)',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#10B981', boxShadow: '0 0 10px #10B981' }} />
            <span style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 800, color: '#6EE7B7' }}>
              {txt.badge || 'ตารางสะสมชาเลนจ์ 30 วัน'}
            </span>
          </div>
          <FitText
            text={txt.title || 'บันทึกวินัย 30 วันต่อเนื่อง'}
            baseSize={48}
            minSize={30}
            maxLines={2}
            lineHeight={1.28}
            color={pal.fg}
          />
        </div>

        {/* 30-Day Habit Contribution Grid Board */}
        <div
          style={{
            opacity: boardP,
            transform: `translateY(${((1 - boardP) * 28).toFixed(1)}px)`,
            borderRadius: 28,
            background: 'rgba(19, 29, 49, 0.94)',
            border: `2px solid ${pal.border}`,
            padding: '20px 24px 22px',
            boxShadow: '0 28px 60px rgba(0,0,0,0.52)',
          }}
        >
          {/* Board Top Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                style={{
                  padding: '5px 14px',
                  borderRadius: 10,
                  background: pal.accent || '#FFFFFF',
                  color: '#0F172A',
                  fontFamily: FONT_MONO,
                  fontSize: 19,
                  fontWeight: 900,
                }}
              >
                DAY 01–30
              </span>
              <span style={{ fontFamily: FONT_THAI, fontSize: 20, fontWeight: 700, color: '#CBD5E1' }}>
                ความสม่ำเสมอรายวัน
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 34, fontWeight: 900, color: '#34D399' }}>
                {pad2(litCount)}
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 21, fontWeight: 700, color: '#64748B' }}>/{totalDays}</span>
            </div>
          </div>

          {/* 6x5 Habit Contribution Cells */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
              gap: 11,
            }}
          >
            {Array.from({ length: totalDays }).map((_, i) => {
              const dayNum = i + 1;
              const isLit = dayNum <= litCount;
              const isMilestone = dayNum === 7 || dayNum === 14 || dayNum === 21 || dayNum === 30;
              const cellDelay = 6 + (i / totalDays) * waveEnd;
              const pop = isLit
                ? spring({ frame: Math.max(0, localFrame - cellDelay), fps, config: { damping: 12, stiffness: 220 } })
                : 0;

              // Ramp color from soft emerald -> bright emerald -> milestone amber
              const tier = i < 10 ? '#059669' : i < 20 ? '#10B981' : '#34D399';
              const bgCol = !isLit
                ? '#1A263D'
                : isMilestone
                  ? 'linear-gradient(145deg, #F59E0B, #D97706)'
                  : `linear-gradient(145deg, ${tier}, #047857)`;
              const borderCol = !isLit
                ? 'rgba(71, 85, 105, 0.55)'
                : isMilestone
                  ? '#FDE68A'
                  : 'rgba(110, 231, 183, 0.72)';

              return (
                <div
                  key={dayNum}
                  style={{
                    height: 68,
                    borderRadius: 14,
                    background: bgCol,
                    border: `1.5px solid ${borderCol}`,
                    transform: `scale(${(isLit ? 0.88 + pop * 0.12 : 1).toFixed(3)})`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    boxShadow: isLit
                      ? isMilestone
                        ? '0 0 20px rgba(245,158,11,0.48)'
                        : '0 6px 14px rgba(16,185,129,0.28)'
                      : 'none',
                  }}
                >
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 20,
                      fontWeight: 900,
                      color: isLit ? (isMilestone ? '#0F172A' : '#FFFFFF') : '#64748B',
                      lineHeight: 1,
                    }}
                  >
                    {pad2(dayNum)}
                  </span>
                  {isLit ? (
                    <svg width={18} height={14} viewBox="0 0 18 14" fill="none">
                      <path
                        d="M2.5 7.2L6.8 11.4L15.5 2.6"
                        stroke={isMilestone ? '#0F172A' : '#ECFDF5'}
                        strokeWidth={2.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: '#334155' }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Intensity Legend Strip */}
          <div
            style={{
              marginTop: 16,
              paddingTop: 12,
              borderTop: '1px solid rgba(148,163,184,0.16)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 600, color: '#94A3B8' }}>ระดับวินัย:</span>
              {['#1A263D', '#059669', '#10B981', '#34D399', '#F59E0B'].map((c, idx) => (
                <span key={idx} style={{ width: 22, height: 14, borderRadius: 4, background: c, border: '1px solid rgba(255,255,255,0.2)' }} />
              ))}
              <span style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 700, color: '#FCD34D', marginLeft: 4 }}>
                หมุดสัปดาห์
              </span>
            </div>
            <span style={{ fontFamily: FONT_MONO, fontSize: 20, fontWeight: 800, color: '#6EE7B7' }}>
              {Math.round((litCount / totalDays) * 100)}% DONE
            </span>
          </div>
        </div>

        {/* Bottom Insight Cards (2–3 items, auto-height, safe above CONTENT_BOTTOM) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cards.map((pt, idx) => {
            const p = stagger(idx, localFrame, 7, 16, 14);
            const badgeBg = idx === 0 ? '#10B981' : idx === 1 ? '#F59E0B' : '#38BDF8';
            return (
              <div
                key={idx}
                style={{
                  opacity: p,
                  transform: `translateY(${((1 - p) * 20).toFixed(1)}px)`,
                  borderRadius: 20,
                  background: 'rgba(22, 32, 51, 0.92)',
                  border: `1.5px solid ${pal.border}`,
                  padding: '13px 18px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                  minHeight: 74,
                  height: 'auto',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: badgeBg,
                    color: '#0B1120',
                    fontFamily: FONT_MONO,
                    fontSize: 20,
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {idx + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={pt}
                    baseSize={24}
                    minSize={18}
                    maxLines={3}
                    lineHeight={1.3}
                    color={pal.fg}
                    fontWeight={700}
                    align="left"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** look-26 / shot 3: milestone-track — day/week progression track with bouncing checkmarks */
const Look26MilestoneTrack: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteI(tokens, LOOK26_DEFAULTS);
  const txt = sceneTexts(scene);
  const defaultDayTags = ['DAY 01', 'DAY 07', 'DAY 21', 'DAY 30'];
  const rawSteps = extractStepObjectsI(scene, defaultDayTags, 4);
  const steps =
    rawSteps.length >= 2
      ? rawSteps
      : [
          { tag: 'DAY 01', text: rawSteps[0]?.text || txt.title || 'เริ่มต้นสร้างนิสัยใหม่วันแรก' },
          { tag: 'DAY 07', text: txt.subtitle || 'ผ่านสัปดาห์แรกจนเริ่มเข้าจังหวะ' },
          { tag: 'DAY 30', text: 'เห็นความเปลี่ยนแปลงชัดเจนและต่อเนื่อง' },
        ];

  const headerP = appear(localFrame, 2, 13);
  const trackP = easeOutCubic(clamp01((localFrame - 6) / Math.max(26, Math.min(54, durationFrames * 0.55))));

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <DayCounterBackdrop pal={pal} localFrame={localFrame} glowColor="#10B981" glowY={480} patternId="i26-mt-dots" />

      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          zIndex: 4,
        }}
      >
        {/* Header */}
        <div
          style={{
            opacity: headerP,
            transform: `translateY(${((1 - headerP) * -16).toFixed(1)}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 20px',
              borderRadius: 999,
              background: 'rgba(245, 158, 11, 0.16)',
              border: '1.5px solid rgba(245, 158, 11, 0.6)',
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 19, fontWeight: 900, color: '#F59E0B' }}>▸▸</span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 800, color: '#FCD34D' }}>
              {txt.badge || 'แทร็กความคืบหน้าทีละขั้น'}
            </span>
          </div>
          <FitText
            text={txt.title || 'เส้นทางความคืบหน้าทีละสัปดาห์'}
            baseSize={48}
            minSize={30}
            maxLines={2}
            lineHeight={1.28}
            color={pal.fg}
          />
        </div>

        {/* Horizontal Progress Strip */}
        <div
          style={{
            borderRadius: 22,
            background: 'rgba(22, 32, 51, 0.92)',
            border: `1.5px solid ${pal.border}`,
            padding: '16px 22px',
            opacity: appear(localFrame, 4, 12),
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            {steps.map((st, idx) => {
              const active = trackP >= idx / Math.max(1, steps.length - 1) - 0.05;
              return (
                <span
                  key={idx}
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 18,
                    fontWeight: 900,
                    color: active ? (idx === steps.length - 1 ? '#FCD34D' : '#6EE7B7') : '#64748B',
                  }}
                >
                  {defaultDayTags[idx] || `D0${idx + 1}`}
                </span>
              );
            })}
          </div>
          <div style={{ position: 'relative', height: 14, borderRadius: 99, background: '#0F172A', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${(trackP * 100).toFixed(1)}%`,
                borderRadius: 99,
                background: 'linear-gradient(90deg, #10B981 0%, #34D399 60%, #F59E0B 100%)',
                boxShadow: '0 0 18px rgba(16,185,129,0.6)',
              }}
            />
          </div>
        </div>

        {/* Vertical Milestone Step List with Animated Spine & Checkmark Nodes */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
          {/* Vertical Spine Line */}
          <div
            style={{
              position: 'absolute',
              left: 41,
              top: 34,
              bottom: 34,
              width: 5,
              borderRadius: 99,
              background: '#1E293B',
            }}
          >
            <div
              style={{
                width: '100%',
                height: `${(trackP * 100).toFixed(1)}%`,
                borderRadius: 99,
                background: 'linear-gradient(180deg, #10B981 0%, #F59E0B 100%)',
                boxShadow: '0 0 14px rgba(16,185,129,0.55)',
              }}
            />
          </div>

          {steps.map((st, idx) => {
            const delay = 8 + idx * 10;
            const cardP = appear(localFrame, delay, 14);
            const pinSp = spring({
              frame: Math.max(0, localFrame - (delay + 4)),
              fps,
              config: { damping: 11, stiffness: 200 },
            });
            const isFinal = idx === steps.length - 1;
            const nodeColor = isFinal ? '#F59E0B' : '#10B981';

            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  position: 'relative',
                  zIndex: 2,
                }}
              >
                {/* Bouncing Checkmark Node */}
                <div
                  style={{
                    width: 86,
                    height: 86,
                    borderRadius: 24,
                    background: isFinal
                      ? 'linear-gradient(145deg, #F59E0B, #D97706)'
                      : 'linear-gradient(145deg, #10B981, #059669)',
                    border: `3px solid ${isFinal ? '#FEF3C7' : '#D1FAE5'}`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    flexShrink: 0,
                    transform: `scale(${(0.4 + pinSp * 0.6).toFixed(3)})`,
                    opacity: clamp01(pinSp * 1.4),
                    boxShadow: `0 12px 28px ${nodeColor}44`,
                  }}
                >
                  <svg width={32} height={26} viewBox="0 0 32 26" fill="none">
                    <path
                      d="M4 13.5L12 21.5L28 5"
                      stroke="#0B1120"
                      strokeWidth={4.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: 900, color: '#0B1120' }}>
                    {defaultDayTags[idx] || `D0${idx + 1}`}
                  </span>
                </div>

                {/* Milestone Card */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    opacity: cardP,
                    transform: `translateX(${((1 - cardP) * 26).toFixed(1)}px)`,
                    borderRadius: 22,
                    background: isFinal ? 'rgba(30, 41, 59, 0.96)' : 'rgba(22, 32, 51, 0.92)',
                    border: `1.5px solid ${isFinal ? '#F59E0B' : pal.border}`,
                    padding: '14px 20px',
                    minHeight: 102,
                    height: 'auto',
                    boxShadow: '0 14px 32px rgba(0,0,0,0.38)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 10 }}>
                    <span
                      style={{
                        padding: '3px 12px',
                        borderRadius: 8,
                        background: pal.accent || '#FFFFFF',
                        color: '#0F172A',
                        fontFamily: FONT_THAI,
                        fontSize: 17,
                        fontWeight: 800,
                      }}
                    >
                      {st.tag}
                    </span>
                    <span style={{ fontFamily: FONT_THAI, fontSize: 17, fontWeight: 800, color: isFinal ? '#FCD34D' : '#6EE7B7' }}>
                      {isFinal ? 'เป้าหมายสำเร็จ ★' : 'ผ่านขั้นนี้แล้ว ✓'}
                    </span>
                  </div>
                  <FitText
                    text={st.text}
                    baseSize={24}
                    minSize={18}
                    maxLines={3}
                    lineHeight={1.3}
                    color={pal.fg}
                    fontWeight={700}
                    align="left"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** look-26 / shot 4: challenge-ring — radial progress ring (%) + before-after comparison or closing quote */
const Look26ChallengeRing: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteI(tokens, LOOK26_DEFAULTS);
  const txt = sceneTexts(scene);
  const metric = extractPrimaryMetricI(scene, sceneIndex, 100, '%');
  const pts = extractPointsI(scene, 3);

  const headerP = appear(localFrame, 2, 13);
  const ringSweepP = easeOutCubic(clamp01((localFrame - 5) / Math.max(24, Math.min(52, durationFrames * 0.52))));
  const targetPct = Math.max(15, Math.min(100, Math.round(metric.progress * 100)));
  const curPct = Math.round(targetPct * ringSweepP);

  const radius = 166;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - (curPct / 100));
  const tipRad = ((curPct / 100) * 360 - 90) * (Math.PI / 180);
  const tipX = 240 + radius * Math.cos(tipRad);
  const tipY = 230 + radius * Math.sin(tipRad);

  const showCompare = Boolean(scene.compare) || I_COMPARE_RE.test(haystackOfI(scene));
  const pair = extractComparePairI(scene, 'วันแรก (DAY 01)', 'ครบเป้าหมาย (DAY 30)');
  const quoteText = scene.quote?.text || txt.subtitle || pts[0] || txt.title;
  const centerSpring = spring({ frame: Math.max(0, localFrame - 6), fps, config: { damping: 14, stiffness: 150 } });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <DayCounterBackdrop pal={pal} localFrame={localFrame} glowColor="#10B981" glowY={470} patternId="i26-cr-dots" />

      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          zIndex: 4,
        }}
      >
        {/* Header */}
        <div
          style={{
            opacity: headerP,
            transform: `translateY(${((1 - headerP) * -16).toFixed(1)}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 20px',
              borderRadius: 999,
              background: 'rgba(16, 185, 129, 0.16)',
              border: '1.5px solid rgba(16, 185, 129, 0.6)',
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 19, fontWeight: 900, color: '#34D399' }}>◉</span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 800, color: '#6EE7B7' }}>
              {txt.badge || 'สรุปความสำเร็จของชาเลนจ์'}
            </span>
          </div>
          <FitText
            text={txt.title || 'พิชิตเป้าหมายครบ 100%'}
            baseSize={48}
            minSize={30}
            maxLines={2}
            lineHeight={1.28}
            color={pal.fg}
          />
        </div>

        {/* Hero Progress Ring Board */}
        <div
          style={{
            borderRadius: 30,
            background: 'rgba(20, 30, 48, 0.92)',
            border: `2px solid ${pal.border}`,
            padding: '16px 22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            boxShadow: '0 28px 60px rgba(0,0,0,0.52)',
          }}
        >
          {/* Left Side Metric Chip */}
          <div
            style={{
              width: 196,
              borderRadius: 20,
              background: 'rgba(13, 19, 33, 0.78)',
              border: '1.5px solid rgba(245, 158, 11, 0.48)',
              padding: '16px 14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              opacity: appear(localFrame, 10, 12),
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 800, color: '#FCD34D', letterSpacing: 1 }}>
              STREAK
            </span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 40, fontWeight: 900, color: '#FFFFFF', lineHeight: 1.05 }}>
              {metric.big.length <= 7 ? metric.big : `${curPct}%`}
            </span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 700, color: '#94A3B8' }}>
              ต่อเนื่องไม่ขาด
            </span>
          </div>

          {/* Center SVG Radial Gauge */}
          <div style={{ position: 'relative', width: 480, height: 456, flexShrink: 0 }}>
            <svg width={480} height={456} viewBox="0 0 480 456">
              <defs>
                <linearGradient id="i26-cr-arc" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#10B981" />
                  <stop offset="60%" stopColor="#34D399" />
                  <stop offset="100%" stopColor="#F59E0B" />
                </linearGradient>
              </defs>
              {/* Outer 60-tick dial */}
              {Array.from({ length: 60 }).map((_, i) => {
                const ang = ((i * 6 - 90) * Math.PI) / 180;
                const major = i % 5 === 0;
                const r1 = major ? 196 : 202;
                const r2 = 212;
                const active = i / 60 <= curPct / 100;
                return (
                  <line
                    key={i}
                    x1={240 + r1 * Math.cos(ang)}
                    y1={230 + r1 * Math.sin(ang)}
                    x2={240 + r2 * Math.cos(ang)}
                    y2={230 + r2 * Math.sin(ang)}
                    stroke={active ? '#34D399' : '#334155'}
                    strokeWidth={major ? 3 : 1.6}
                    strokeLinecap="round"
                  />
                );
              })}
              {/* Base Track */}
              <circle cx={240} cy={230} r={radius} fill="none" stroke="#1E293B" strokeWidth={24} />
              {/* Animated Progress Arc */}
              <circle
                cx={240}
                cy={230}
                r={radius}
                fill="none"
                stroke="url(#i26-cr-arc)"
                strokeWidth={24}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 240 230)"
              />
              {/* Glowing Tip Orb */}
              <circle cx={tipX} cy={tipY} r={16} fill="#F59E0B" fillOpacity={0.32} />
              <circle cx={tipX} cy={tipY} r={9} fill="#FFFFFF" stroke="#F59E0B" strokeWidth={4} />
            </svg>

            {/* Center Crisp Split-Flap Readout */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                transform: `scale(${(0.86 + centerSpring * 0.14).toFixed(3)})`,
              }}
            >
              <div
                style={{
                  padding: '10px 24px',
                  borderRadius: 18,
                  background: pal.accent || '#FFFFFF',
                  boxShadow: '0 14px 32px rgba(0,0,0,0.45)',
                  borderBottom: '4px solid #CBD5E1',
                }}
              >
                <span style={{ fontFamily: FONT_MONO, fontSize: 72, fontWeight: 900, color: '#0F172A', lineHeight: 1 }}>
                  {curPct}%
                </span>
              </div>
              <span style={{ fontFamily: FONT_THAI, fontSize: 22, fontWeight: 800, color: '#6EE7B7', marginTop: 12 }}>
                ความสำเร็จสะสม
              </span>
            </div>
          </div>

          {/* Right Side Metric Chip */}
          <div
            style={{
              width: 196,
              borderRadius: 20,
              background: 'rgba(13, 19, 33, 0.78)',
              border: '1.5px solid rgba(16, 185, 129, 0.48)',
              padding: '16px 14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              opacity: appear(localFrame, 12, 12),
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 800, color: '#6EE7B7', letterSpacing: 1 }}>
              STATUS
            </span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 38, fontWeight: 900, color: '#34D399', lineHeight: 1.05 }}>
              {curPct >= 95 ? 'WIN' : 'ON'}
            </span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 700, color: '#94A3B8' }}>
              {metric.delta || 'ตามแผนเป๊ะ'}
            </span>
          </div>
        </div>

        {/* Bottom Compare Pair OR Closing Quote Card */}
        {showCompare ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            {/* Before Column */}
            <div
              style={{
                opacity: appear(localFrame, 14, 14),
                borderRadius: 22,
                background: 'rgba(30, 24, 38, 0.92)',
                border: '1.5px solid rgba(239, 68, 68, 0.5)',
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                height: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 99, background: '#EF4444' }} />
                <FitText
                  text={pair.leftTitle}
                  baseSize={22}
                  minSize={17}
                  maxLines={2}
                  lineHeight={1.28}
                  color="#FCA5A5"
                  fontWeight={800}
                  align="left"
                />
              </div>
              {pair.leftItems.map((it, i) => (
                <FitText
                  key={i}
                  text={`• ${it}`}
                  baseSize={21}
                  minSize={17}
                  maxLines={3}
                  lineHeight={1.3}
                  color="#E2E8F0"
                  fontWeight={600}
                  align="left"
                />
              ))}
            </div>

            {/* After Column */}
            <div
              style={{
                opacity: appear(localFrame, 18, 14),
                borderRadius: 22,
                background: 'rgba(13, 38, 36, 0.94)',
                border: '1.5px solid rgba(16, 185, 129, 0.65)',
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                height: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 99, background: '#10B981' }} />
                <FitText
                  text={pair.rightTitle}
                  baseSize={22}
                  minSize={17}
                  maxLines={2}
                  lineHeight={1.28}
                  color="#6EE7B7"
                  fontWeight={800}
                  align="left"
                />
              </div>
              {pair.rightItems.map((it, i) => (
                <FitText
                  key={i}
                  text={`✓ ${it}`}
                  baseSize={21}
                  minSize={17}
                  maxLines={3}
                  lineHeight={1.3}
                  color="#F8FAFC"
                  fontWeight={700}
                  align="left"
                />
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                opacity: appear(localFrame, 14, 14),
                borderRadius: 24,
                background: 'linear-gradient(145deg, rgba(22,32,51,0.96), rgba(15,23,42,0.96))',
                border: '2px solid rgba(245, 158, 11, 0.6)',
                padding: '18px 24px',
                boxShadow: '0 18px 40px rgba(0,0,0,0.42)',
                height: 'auto',
              }}
            >
              <div style={{ fontFamily: FONT_MONO, fontSize: 34, fontWeight: 900, color: '#F59E0B', lineHeight: 0.7, marginBottom: 8 }}>
                “
              </div>
              <FitText
                text={quoteText}
                baseSize={28}
                minSize={20}
                maxLines={4}
                lineHeight={1.32}
                color="#FFFFFF"
                fontWeight={800}
                align="left"
              />
              {scene.quote?.author ? (
                <div style={{ marginTop: 10 }}>
                  <FitText
                    text={`— ${scene.quote.author}`}
                    baseSize={20}
                    minSize={16}
                    maxLines={2}
                    lineHeight={1.28}
                    color="#FCD34D"
                    fontWeight={700}
                    align="right"
                  />
                </div>
              ) : null}
            </div>
            {pts.length >= 2 ? (
              <div
                style={{
                  opacity: appear(localFrame, 20, 14),
                  borderRadius: 18,
                  background: 'rgba(16, 185, 129, 0.14)',
                  border: '1.5px solid rgba(16, 185, 129, 0.5)',
                  padding: '12px 18px',
                  height: 'auto',
                }}
              >
                <FitText
                  text={`✓ ${pts[1]}`}
                  baseSize={22}
                  minSize={17}
                  maxLines={3}
                  lineHeight={1.3}
                  color="#D1FAE5"
                  fontWeight={700}
                  align="left"
                />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 2: look-28 — 3D MAP ROUTE (เส้นทางบนแผนที่ 3D)
// Deep Midnight Cartography (#131722–#1E2436)
// Marble/Cream 3D Isometric Buildings (#ECEAE4/#F7F7F5)
// Glowing Coral (#FF6B4A) / Cyan (#38BDF8) / Gold (#F59E0B) Route & Pins
// ============================================================================

const LOOK28_DEFAULTS: PaletteI = {
  bg: '#131722',
  bg2: '#1E2436',
  surface: '#1A2030',
  fg: '#F1F5F9',
  muted: '#94A3B8',
  accent: '#ECEAE4',
  accent2: '#F7F7F5',
  border: '#2E3852',
};

const MapRouteBackdrop: React.FC<{
  pal: PaletteI;
  localFrame: number;
  glowColor?: string;
  glowY?: number;
}> = ({ pal, localFrame, glowColor = '#FF6B4A', glowY = 560 }) => {
  const drift = Math.sin(localFrame * 0.04) * 14;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 920px 680px at 540px ${glowY}px, ${glowColor}1E 0%, ${pal.bg2} 48%, ${pal.bg} 100%)`,
        overflow: 'hidden',
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Topographic contour ellipses */}
        {[240, 380, 520, 680, 860].map((r, idx) => (
          <ellipse
            key={idx}
            cx={540 + (idx % 2 === 0 ? drift : -drift)}
            cy={glowY}
            rx={r}
            ry={r * 0.56}
            fill="none"
            stroke="#38BDF8"
            strokeOpacity={0.07}
            strokeWidth={1.4}
            strokeDasharray={idx % 2 === 0 ? 'none' : '8 10'}
          />
        ))}
        {/* Subtle compass crosshairs */}
        <line x1={540} y1={60} x2={540} y2={STAGE_H - 60} stroke="#64748B" strokeOpacity={0.08} strokeWidth={1} />
        <line x1={60} y1={glowY} x2={STAGE_W - 60} y2={glowY} stroke="#64748B" strokeOpacity={0.08} strokeWidth={1} />
      </svg>
    </div>
  );
};

/** Marble/Cream 3D Isometric City Building primitive inside an SVG */
const IsoBuilding3D: React.FC<{
  cx: number;
  baseY: number;
  w: number;
  d: number;
  h: number;
  topCol?: string;
  leftCol?: string;
  rightCol?: string;
  highlight?: boolean;
}> = ({
  cx,
  baseY,
  w,
  d,
  h,
  topCol = '#F7F7F5',
  leftCol = '#DEDBD2',
  rightCol = '#B7B2A6',
  highlight = false,
}) => {
  const hw = w / 2;
  const hd = d / 2;
  const topY = baseY - h;
  return (
    <g>
      {/* Cast ground shadow */}
      <polygon
        points={`${cx},${baseY + hd} ${cx + hw + h * 0.24},${baseY + 4} ${cx + h * 0.24},${baseY - hd + 4} ${cx - hw},${baseY}`}
        fill="#070A12"
        fillOpacity={0.45}
      />
      {/* Left vertical wall */}
      <polygon
        points={`${cx - hw},${topY} ${cx},${topY + hd} ${cx},${baseY + hd} ${cx - hw},${baseY}`}
        fill={leftCol}
      />
      {/* Right vertical wall */}
      <polygon
        points={`${cx},${topY + hd} ${cx + hw},${topY} ${cx + hw},${baseY} ${cx},${baseY + hd}`}
        fill={rightCol}
      />
      {/* Top roof diamond */}
      <polygon
        points={`${cx},${topY - hd} ${cx + hw},${topY} ${cx},${topY + hd} ${cx - hw},${topY}`}
        fill={topCol}
      />
      {/* Subtle architectural roof rim */}
      <polyline
        points={`${cx - hw},${topY} ${cx},${topY + hd} ${cx + hw},${topY}`}
        fill="none"
        stroke={highlight ? '#FF6B4A' : '#FFFFFF'}
        strokeOpacity={highlight ? 0.95 : 0.72}
        strokeWidth={highlight ? 2.4 : 1.3}
      />
      {/* Architectural window stripes on taller buildings */}
      {h >= 54 ? (
        <g opacity={0.28}>
          {[0.28, 0.52, 0.76].map((frac, idx) => {
            const wy = topY + h * frac;
            return (
              <g key={idx}>
                <line x1={cx - hw + 7} y1={wy} x2={cx - 6} y2={wy + hd - 5} stroke="#334155" strokeWidth={2.5} />
                <line x1={cx + 6} y1={wy + hd - 5} x2={cx + hw - 7} y2={wy} stroke="#1E293B" strokeWidth={2.5} />
              </g>
            );
          })}
        </g>
      ) : null}
    </g>
  );
};

/** 3D Teardrop Map Pin inside SVG */
const MapPin3D: React.FC<{
  x: number;
  y: number;
  color: string;
  label: string;
  scale?: number;
  pulse?: number;
}> = ({ x, y, color, label, scale = 1, pulse = 0 }) => {
  return (
    <g transform={`translate(${x.toFixed(1)}, ${y.toFixed(1)}) scale(${scale.toFixed(3)})`}>
      {/* Pulsing ground radar ring */}
      <ellipse
        cx={0}
        cy={2}
        rx={16 + pulse * 26}
        ry={8 + pulse * 13}
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeOpacity={(1 - pulse) * 0.85}
      />
      <ellipse cx={0} cy={2} rx={12} ry={6} fill={color} fillOpacity={0.35} />
      {/* Vertical Pin Stem Glow */}
      <line x1={0} y1={0} x2={0} y2={-16} stroke={color} strokeWidth={3} />
      {/* Pin Teardrop Head */}
      <path
        d="M 0,-12 C -18,-32 -24,-46 -24,-58 A 24,24 0 1,1 24,-58 C 24,-46 18,-32 0,-12 Z"
        fill={color}
        stroke="#FFFFFF"
        strokeWidth={2.6}
      />
      <circle cx={0} cy={-58} r={14} fill="#0F172A" />
      <text
        x={0}
        y={-52}
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize={16}
        fontWeight={900}
        fontFamily={FONT_MONO}
      >
        {label}
      </text>
    </g>
  );
};

/** look-28 / shot 1: tilted-city-route — tilted 3D marble city map + glowing animated route + moving nav orb + summary cards */
const Look28TiltedCityRoute: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteI(tokens, LOOK28_DEFAULTS);
  const txt = sceneTexts(scene);
  const pts = extractPointsI(scene, 3);
  const metric = extractPrimaryMetricI(scene, sceneIndex, 12, 'กม.');

  const headerP = appear(localFrame, 2, 13);
  const mapP = appear(localFrame, 4, 15);
  const routeDrawP = easeOutCubic(clamp01((localFrame - 10) / Math.max(28, Math.min(64, durationFrames * 0.62))));

  const routePts: Array<[number, number]> = [
    [176, 448],
    [326, 372],
    [452, 428],
    [618, 336],
    [544, 248],
    [764, 156],
  ];
  const pathD = routePts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt[0]} ${pt[1]}`).join(' ');
  const totalLen = polylineLength(routePts);
  const navPos = samplePolyline(routePts, routeDrawP);
  const pulse = (localFrame % 36) / 36;

  // Back-to-front painter's order deterministic isometric marble city blocks
  const buildings = [
    { cx: 230, baseY: 192, w: 72, d: 38, h: 66, hi: false },
    { cx: 365, baseY: 170, w: 86, d: 44, h: 98, hi: false },
    { cx: 510, baseY: 158, w: 74, d: 38, h: 72, hi: false },
    { cx: 655, baseY: 174, w: 82, d: 42, h: 86, hi: false },
    { cx: 836, baseY: 222, w: 94, d: 48, h: 112, hi: true },
    { cx: 158, baseY: 282, w: 76, d: 40, h: 58, hi: false },
    { cx: 308, baseY: 268, w: 84, d: 44, h: 94, hi: false },
    { cx: 438, baseY: 276, w: 76, d: 40, h: 62, hi: false },
    { cx: 690, baseY: 284, w: 88, d: 44, h: 88, hi: false },
    { cx: 816, baseY: 362, w: 86, d: 44, h: 76, hi: false },
    { cx: 248, baseY: 386, w: 78, d: 40, h: 54, hi: false },
    { cx: 682, baseY: 426, w: 92, d: 46, h: 82, hi: false },
    { cx: 420, baseY: 504, w: 86, d: 44, h: 62, hi: false },
    { cx: 562, baseY: 492, w: 74, d: 38, h: 52, hi: false },
  ];

  const cards = pts.length > 0 ? pts.slice(0, 3) : [txt.subtitle || txt.title || 'เส้นทางชัดเจนจากจุดเริ่มต้นสู่ปลายทาง'];
  const marbleTop = pal.accent2 || '#F7F7F5';
  const marbleLeft = pal.accent || '#ECEAE4';

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <MapRouteBackdrop pal={pal} localFrame={localFrame} glowColor="#FF6B4A" glowY={540} />

      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          zIndex: 4,
        }}
      >
        {/* Header */}
        <div
          style={{
            opacity: headerP,
            transform: `translateY(${((1 - headerP) * -16).toFixed(1)}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 20px',
              borderRadius: 999,
              background: 'rgba(255, 107, 74, 0.16)',
              border: '1.5px solid rgba(255, 107, 74, 0.6)',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 99, background: '#FF6B4A', boxShadow: '0 0 12px #FF6B4A' }} />
            <span style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 800, color: '#FCA5A5' }}>
              {txt.badge || 'แผนที่เส้นทาง 3D · ROUTE VIEW'}
            </span>
          </div>
          <FitText
            text={txt.title || 'เจาะลึกเส้นทางจากจุดเริ่มสู่เป้าหมาย'}
            baseSize={48}
            minSize={30}
            maxLines={2}
            lineHeight={1.28}
            color={pal.fg}
          />
        </div>

        {/* 3D Tilted Isometric City Map Stage */}
        <div
          style={{
            position: 'relative',
            height: 556,
            borderRadius: 28,
            background: 'linear-gradient(170deg, #1E263B 0%, #141928 100%)',
            border: `2px solid ${pal.border}`,
            overflow: 'hidden',
            opacity: mapP,
            boxShadow: '0 30px 68px rgba(0,0,0,0.55)',
          }}
        >
          <svg width={972} height={556} viewBox="0 0 972 556" style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <linearGradient id="i28-tcr-route" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#38BDF8" />
                <stop offset="50%" stopColor="#FF6B4A" />
                <stop offset="100%" stopColor="#F59E0B" />
              </linearGradient>
              <linearGradient id="i28-tcr-slab" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#242E46" />
                <stop offset="100%" stopColor="#161D2F" />
              </linearGradient>
            </defs>

            {/* Isometric Map Base Slab */}
            <polygon points="486,44 934,274 486,512 38,274" fill="url(#i28-tcr-slab)" stroke="#3B496B" strokeWidth={2} />
            <polygon points="38,274 486,512 486,534 38,296" fill="#0F1422" />
            <polygon points="934,274 486,512 486,534 934,296" fill="#0B0F1A" />

            {/* Isometric Street Grid Lines */}
            {[-3, -2, -1, 0, 1, 2, 3].map((k) => {
              const off = k * 56;
              return (
                <g key={k} opacity={0.35}>
                  <line
                    x1={170 + off}
                    y1={206 + off * 0.52}
                    x2={560 + off}
                    y2={408 + off * 0.52}
                    stroke="#475A80"
                    strokeWidth={k === 0 ? 4 : 2}
                  />
                  <line
                    x1={230 + off}
                    y1={368 - off * 0.52}
                    x2={640 + off}
                    y2={154 - off * 0.52}
                    stroke="#475A80"
                    strokeWidth={k === 0 ? 4 : 2}
                  />
                </g>
              );
            })}

            {/* Subtle River Ribbon */}
            <path
              d="M 108 310 Q 330 220 510 310 T 880 245"
              fill="none"
              stroke="#1E4B7A"
              strokeWidth={28}
              strokeOpacity={0.55}
              strokeLinecap="round"
            />

            {/* 3D Marble City Buildings */}
            {buildings.map((b, idx) => {
              const sp = spring({
                frame: Math.max(0, localFrame - (4 + idx * 2)),
                fps,
                config: { damping: 14, stiffness: 155 },
              });
              return (
                <IsoBuilding3D
                  key={idx}
                  cx={b.cx}
                  baseY={b.baseY}
                  w={b.w}
                  d={b.d}
                  h={Math.max(8, b.h * sp)}
                  topCol={marbleTop}
                  leftCol={marbleLeft}
                  rightCol="#C4BFAF"
                  highlight={b.hi}
                />
              );
            })}

            {/* Glowing Route Glow Underlay + Core Path */}
            <path
              d={pathD}
              fill="none"
              stroke="#FF6B4A"
              strokeWidth={18}
              strokeOpacity={0.28}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={totalLen}
              strokeDashoffset={totalLen * (1 - routeDrawP)}
            />
            <path
              d={pathD}
              fill="none"
              stroke="url(#i28-tcr-route)"
              strokeWidth={8}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={totalLen}
              strokeDashoffset={totalLen * (1 - routeDrawP)}
            />
            {/* Dashed Center Highway Line */}
            <path
              d={pathD}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={2}
              strokeOpacity={0.8}
              strokeDasharray="8 12"
              strokeDashoffset={-localFrame * 2}
            />

            {/* Origin Pin A */}
            <MapPin3D
              x={routePts[0][0]}
              y={routePts[0][1]}
              color="#38BDF8"
              label="A"
              scale={spring({ frame: Math.max(0, localFrame - 8), fps, config: { damping: 12, stiffness: 200 } })}
              pulse={pulse}
            />

            {/* Destination Pin B */}
            <MapPin3D
              x={routePts[routePts.length - 1][0]}
              y={routePts[routePts.length - 1][1]}
              color="#FF6B4A"
              label="B"
              scale={spring({ frame: Math.max(0, localFrame - 24), fps, config: { damping: 12, stiffness: 190 } })}
              pulse={(pulse + 0.5) % 1}
            />

            {/* Moving Glowing Navigator Beacon along Route */}
            <g transform={`translate(${navPos.x.toFixed(1)}, ${navPos.y.toFixed(1)})`}>
              <circle r={20} fill="#F59E0B" fillOpacity={0.28} />
              <circle r={10} fill="#FFFFFF" stroke="#FF6B4A" strokeWidth={4} />
            </g>
          </svg>

          {/* Top-Left Compact Telemetry Pill */}
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 18,
              padding: '7px 14px',
              borderRadius: 12,
              background: 'rgba(13, 19, 33, 0.86)',
              border: '1px solid rgba(56, 189, 248, 0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 99, background: '#38BDF8', boxShadow: '0 0 10px #38BDF8' }} />
            <span style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: '#BAE6FD' }}>
              3D NAV · {Math.round(routeDrawP * 100)}%
            </span>
          </div>

          {/* Bottom-Right Distance/Stat Pill */}
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              right: 18,
              padding: '8px 16px',
              borderRadius: 14,
              background: 'rgba(13, 19, 33, 0.90)',
              border: '1.5px solid rgba(245, 158, 11, 0.55)',
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 26, fontWeight: 900, color: '#FCD34D' }}>
              {metric.big}
            </span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 700, color: '#E2E8F0' }}>
              {metric.unit}
            </span>
          </div>
        </div>

        {/* Bottom Summary Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cards.map((pt, idx) => {
            const p = stagger(idx, localFrame, 6, 18, 14);
            const dotCol = idx === 0 ? '#38BDF8' : idx === 1 ? '#FF6B4A' : '#F59E0B';
            return (
              <div
                key={idx}
                style={{
                  opacity: p,
                  transform: `translateY(${((1 - p) * 18).toFixed(1)}px)`,
                  borderRadius: 20,
                  background: 'rgba(26, 32, 48, 0.94)',
                  border: `1.5px solid ${idx === 0 ? `${dotCol}77` : pal.border}`,
                  padding: '13px 18px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                  minHeight: 72,
                  height: 'auto',
                }}
              >
                <div
                  style={{
                    minWidth: 40,
                    height: 36,
                    borderRadius: 10,
                    background: `${dotCol}22`,
                    border: `1.5px solid ${dotCol}`,
                    color: dotCol,
                    fontFamily: FONT_MONO,
                    fontSize: 18,
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  0{idx + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={pt}
                    baseSize={23}
                    minSize={17}
                    maxLines={3}
                    lineHeight={1.3}
                    color={pal.fg}
                    fontWeight={700}
                    align="left"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** look-28 / shot 2: waypoint-stops — 3D map corridor with 3 sequential bouncing pins (01/02/03) + 3 explanation cards */
const Look28WaypointStops: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = resolvePaletteI(tokens, LOOK28_DEFAULTS);
  const txt = sceneTexts(scene);
  const defaultTags = ['จุดที่ 01', 'จุดที่ 02', 'จุดที่ 03'];
  const rawSteps = extractStepObjectsI(scene, defaultTags, 3);
  const stops = [0, 1, 2].map((i) => ({
    tag: rawSteps[i]?.tag || defaultTags[i],
    text:
      rawSteps[i]?.text ||
      (i === 0
        ? txt.title || 'จุดเริ่มต้นสำคัญของเส้นทาง'
        : i === 1
          ? txt.subtitle || 'จุดเปลี่ยนผ่านที่ต้องวางแผนให้แม่นยำ'
          : 'จุดหมายปลายทางที่สร้างผลลัพธ์สูงสุด'),
    color: i === 0 ? '#FF6B4A' : i === 1 ? '#38BDF8' : '#F59E0B',
    pinCode: `0${i + 1}`,
  }));

  const headerP = appear(localFrame, 2, 13);
  const pinCoords: Array<[number, number]> = [
    [206, 336],
    [486, 224],
    [774, 296],
  ];
  const seg1P = easeOutCubic(clamp01((localFrame - 10) / 18));
  const seg2P = easeOutCubic(clamp01((localFrame - 24) / 18));
  const pulse = (localFrame % 34) / 34;

  const seg1Len = Math.hypot(pinCoords[1][0] - pinCoords[0][0], pinCoords[1][1] - pinCoords[0][1]) * 1.15;
  const seg2Len = Math.hypot(pinCoords[2][0] - pinCoords[1][0], pinCoords[2][1] - pinCoords[1][1]) * 1.15;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <MapRouteBackdrop pal={pal} localFrame={localFrame} glowColor="#38BDF8" glowY={480} />

      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          zIndex: 4,
        }}
      >
        {/* Header */}
        <div
          style={{
            opacity: headerP,
            transform: `translateY(${((1 - headerP) * -16).toFixed(1)}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 20px',
              borderRadius: 999,
              background: 'rgba(56, 189, 248, 0.16)',
              border: '1.5px solid rgba(56, 189, 248, 0.58)',
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900, color: '#38BDF8' }}>01·02·03</span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 800, color: '#BAE6FD' }}>
              {txt.badge || 'หมุดหมายสำคัญบนเส้นทาง 3D'}
            </span>
          </div>
          <FitText
            text={txt.title || '3 จุดแวะสำคัญที่ต้องรู้'}
            baseSize={48}
            minSize={30}
            maxLines={2}
            lineHeight={1.28}
            color={pal.fg}
          />
        </div>

        {/* 3D Isometric Corridor Map with 3 Landmark Pedestals & Pins */}
        <div
          style={{
            height: 454,
            borderRadius: 28,
            background: 'linear-gradient(175deg, #1E273D 0%, #131826 100%)',
            border: `2px solid ${pal.border}`,
            overflow: 'hidden',
            position: 'relative',
            boxShadow: '0 28px 60px rgba(0,0,0,0.52)',
          }}
        >
          <svg width={972} height={454} viewBox="0 0 972 454" style={{ position: 'absolute', inset: 0 }}>
            {/* Base Isometric Terrain Platform */}
            <polygon points="486,44 926,226 486,412 46,226" fill="#1C2438" stroke="#33415C" strokeWidth={2} />
            <polygon points="46,226 486,412 486,432 46,246" fill="#0F1422" />
            <polygon points="926,226 486,412 486,432 926,246" fill="#0B0F1A" />

            {/* Background marble accent blocks */}
            <IsoBuilding3D cx={340} baseY={186} w={66} d={34} h={46} topCol={pal.accent2} leftCol={pal.accent} rightCol="#B8B3A7" />
            <IsoBuilding3D cx={640} baseY={180} w={70} d={36} h={58} topCol={pal.accent2} leftCol={pal.accent} rightCol="#B8B3A7" />
            <IsoBuilding3D cx={496} baseY={346} w={74} d={38} h={42} topCol={pal.accent2} leftCol={pal.accent} rightCol="#B8B3A7" />

            {/* 3 Highlighted Marble Waypoint Pedestals */}
            {pinCoords.map(([px, py], i) => {
              const sp = spring({
                frame: Math.max(0, localFrame - (5 + i * 12)),
                fps,
                config: { damping: 14, stiffness: 160 },
              });
              return (
                <IsoBuilding3D
                  key={i}
                  cx={px}
                  baseY={py + 32}
                  w={104}
                  d={52}
                  h={Math.max(10, 44 * sp)}
                  topCol="#FFFFFF"
                  leftCol="#ECEAE4"
                  rightCol="#C8C3B8"
                  highlight
                />
              );
            })}

            {/* Glowing Route Segment 01 -> 02 */}
            <path
              d={`M ${pinCoords[0][0]} ${pinCoords[0][1]} Q 320 220 ${pinCoords[1][0]} ${pinCoords[1][1]}`}
              fill="none"
              stroke="#FF6B4A"
              strokeWidth={7}
              strokeLinecap="round"
              strokeDasharray={seg1Len}
              strokeDashoffset={seg1Len * (1 - seg1P)}
            />
            {/* Glowing Route Segment 02 -> 03 */}
            <path
              d={`M ${pinCoords[1][0]} ${pinCoords[1][1]} Q 650 198 ${pinCoords[2][0]} ${pinCoords[2][1]}`}
              fill="none"
              stroke="#38BDF8"
              strokeWidth={7}
              strokeLinecap="round"
              strokeDasharray={seg2Len}
              strokeDashoffset={seg2Len * (1 - seg2P)}
            />

            {/* 3 Sequential Bouncing Pins */}
            {pinCoords.map(([px, py], i) => {
              const delay = 8 + i * 14;
              const sp = spring({
                frame: Math.max(0, localFrame - delay),
                fps,
                config: { damping: 10, stiffness: 190 },
              });
              const dropY = interpolate(sp, [0, 1], [-85, 0]);
              return (
                <g key={i} opacity={clamp01((localFrame - delay + 2) / 6)}>
                  <MapPin3D
                    x={px}
                    y={py - 12 + dropY}
                    color={stops[i].color}
                    label={stops[i].pinCode}
                    scale={0.6 + sp * 0.52}
                    pulse={(pulse + i * 0.33) % 1}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        {/* 3 Waypoint Explanation Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {stops.map((st, idx) => {
            const p = stagger(idx, localFrame, 10, 10, 14);
            return (
              <div
                key={idx}
                style={{
                  opacity: p,
                  transform: `translateX(${((1 - p) * 26).toFixed(1)}px)`,
                  borderRadius: 22,
                  background: 'rgba(26, 32, 48, 0.94)',
                  border: `1.5px solid ${st.color}88`,
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 16,
                  minHeight: 96,
                  height: 'auto',
                  boxShadow: '0 14px 30px rgba(0,0,0,0.38)',
                }}
              >
                <div
                  style={{
                    minWidth: 74,
                    padding: '10px 10px',
                    borderRadius: 14,
                    background: st.color,
                    color: '#0B1120',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 900, letterSpacing: 1 }}>PIN</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 28, fontWeight: 900, lineHeight: 1 }}>
                    {st.pinCode}
                  </span>
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <FitText
                    text={st.tag}
                    baseSize={20}
                    minSize={16}
                    maxLines={2}
                    lineHeight={1.28}
                    color={st.color}
                    fontWeight={800}
                    align="left"
                  />
                  <FitText
                    text={st.text}
                    baseSize={24}
                    minSize={18}
                    maxLines={3}
                    lineHeight={1.3}
                    color={pal.fg}
                    fontWeight={700}
                    align="left"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** look-28 / shot 3: elevation-profile — 3D extruded terrain cross-section & altitude curve + stat/compare cards */
const Look28ElevationProfile: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteI(tokens, LOOK28_DEFAULTS);
  const txt = sceneTexts(scene);
  const metric = extractPrimaryMetricI(scene, sceneIndex, 2450, 'ม.');
  const pts = extractPointsI(scene, 4);
  const showCompare = Boolean(scene.compare);
  const pair = extractComparePairI(scene, 'จุดเริ่มต้น', 'จุดสูงสุด');

  const headerP = appear(localFrame, 2, 13);
  const drawP = easeOutCubic(clamp01((localFrame - 8) / Math.max(26, Math.min(54, durationFrames * 0.56))));

  const ridgePts: Array<[number, number]> = [
    [94, 412],
    [224, 374],
    [354, 388],
    [484, 294],
    [614, 310],
    [744, 198],
    [884, 152],
  ];
  const backRidgePts: Array<[number, number]> = ridgePts.map(([x, y]) => [x + 28, y - 24]);
  const ridgePath = ridgePts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const frontArea = `${ridgePath} L 884 446 L 94 446 Z`;
  const topRibbon = [
    ...ridgePts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`),
    ...[...backRidgePts].reverse().map((p) => `L ${p[0]} ${p[1]}`),
    'Z',
  ].join(' ');
  const ridgeLen = polylineLength(ridgePts);
  const climber = samplePolyline(ridgePts, drawP);

  const markers = [
    { idx: 0, code: 'BASE', alt: '0%' },
    { idx: 3, code: 'MID', alt: '52%' },
    { idx: 6, code: 'PEAK', alt: metric.big.length <= 7 ? metric.big : '100%' },
  ];

  const dataCards = pts.length > 0 ? pts.slice(0, 4) : [txt.subtitle || txt.title || 'ระดับความสูงและอัตราเร่งเพิ่มขึ้นต่อเนื่อง'];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <MapRouteBackdrop pal={pal} localFrame={localFrame} glowColor="#F59E0B" glowY={520} />

      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          zIndex: 4,
        }}
      >
        {/* Header */}
        <div
          style={{
            opacity: headerP,
            transform: `translateY(${((1 - headerP) * -16).toFixed(1)}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 20px',
              borderRadius: 999,
              background: 'rgba(245, 158, 11, 0.16)',
              border: '1.5px solid rgba(245, 158, 11, 0.6)',
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900, color: '#F59E0B' }}>▲</span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 800, color: '#FCD34D' }}>
              {txt.badge || 'กราฟระดับความสูงเส้นทาง 3D'}
            </span>
          </div>
          <FitText
            text={txt.title || 'ไต่ระดับความสูงเทียบข้อมูลสำคัญ'}
            baseSize={48}
            minSize={30}
            maxLines={2}
            lineHeight={1.28}
            color={pal.fg}
          />
        </div>

        {/* 3D Terrain Elevation Cross-Section Panel */}
        <div
          style={{
            position: 'relative',
            height: 516,
            borderRadius: 28,
            background: 'linear-gradient(175deg, #1E2538 0%, #121725 100%)',
            border: `2px solid ${pal.border}`,
            overflow: 'hidden',
            boxShadow: '0 28px 60px rgba(0,0,0,0.52)',
          }}
        >
          {/* Floating Stat Readout Top-Left */}
          <div
            style={{
              position: 'absolute',
              top: 20,
              left: 24,
              zIndex: 5,
              padding: '12px 20px',
              borderRadius: 18,
              background: 'rgba(15, 23, 42, 0.88)',
              border: '1.5px solid rgba(255, 107, 74, 0.55)',
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 48, fontWeight: 900, color: '#FFFFFF', lineHeight: 1 }}>
              {metric.big}
            </span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 22, fontWeight: 800, color: '#FF6B4A' }}>
              {metric.unit}
            </span>
            {metric.delta ? (
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 18,
                  fontWeight: 800,
                  color: '#34D399',
                  background: 'rgba(16,185,129,0.16)',
                  padding: '3px 10px',
                  borderRadius: 8,
                }}
              >
                {metric.delta}
              </span>
            ) : null}
          </div>

          <svg width={972} height={516} viewBox="0 0 972 516" style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <linearGradient id="i28-ep-face" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF6B4A" stopOpacity="0.48" />
                <stop offset="55%" stopColor="#38BDF8" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#131722" stopOpacity="0.92" />
              </linearGradient>
              <linearGradient id="i28-ep-ribbon" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#DCD7CC" />
                <stop offset="100%" stopColor="#F7F7F5" />
              </linearGradient>
              <linearGradient id="i28-ep-line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#38BDF8" />
                <stop offset="55%" stopColor="#FF6B4A" />
                <stop offset="100%" stopColor="#F59E0B" />
              </linearGradient>
            </defs>

            {/* Horizontal Altitude Grid Lines */}
            {[160, 232, 304, 376, 446].map((gy, idx) => (
              <g key={gy} opacity={0.35}>
                <line x1={68} y1={gy} x2={920} y2={gy} stroke="#475569" strokeWidth={1.2} strokeDasharray="6 8" />
                <text x={32} y={gy + 5} fill="#94A3B8" fontSize={14} fontFamily={FONT_MONO} fontWeight={700}>
                  {`${(4 - idx) * 25}%`}
                </text>
              </g>
            ))}

            {/* 3D Slanted Marble Top Ridge Ribbon */}
            <path d={topRibbon} fill="url(#i28-ep-ribbon)" fillOpacity={0.85 * drawP} />

            {/* Front Extruded Terrain Cliff Face */}
            <path d={frontArea} fill="url(#i28-ep-face)" opacity={drawP} />

            {/* Vertical Section Ribs */}
            {ridgePts.map(([rx, ry], i) => (
              <line
                key={i}
                x1={rx}
                y1={ry}
                x2={rx}
                y2={446}
                stroke="#F8FAFC"
                strokeOpacity={0.14 * drawP}
                strokeWidth={1.5}
              />
            ))}

            {/* Glowing Elevation Curve */}
            <path
              d={ridgePath}
              fill="none"
              stroke="url(#i28-ep-line)"
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={ridgeLen}
              strokeDashoffset={ridgeLen * (1 - drawP)}
            />

            {/* Altitude Needles & Milestones */}
            {markers.map((mk, idx) => {
              const [mx, my] = ridgePts[mk.idx];
              const mSp = spring({
                frame: Math.max(0, localFrame - (12 + idx * 10)),
                fps,
                config: { damping: 12, stiffness: 190 },
              });
              return (
                <g key={mk.code} opacity={clamp01(mSp)}>
                  <line x1={mx} y1={my} x2={mx} y2={my - 48} stroke="#F59E0B" strokeWidth={2} strokeDasharray="4 4" />
                  <circle cx={mx} cy={my} r={7} fill="#FFFFFF" stroke="#FF6B4A" strokeWidth={3} />
                  <rect x={mx - 44} y={my - 80} width={88} height={32} rx={9} fill="#0F172A" stroke="#F59E0B" strokeWidth={1.6} />
                  <text x={mx} y={my - 59} textAnchor="middle" fill="#FCD34D" fontSize={16} fontWeight={900} fontFamily={FONT_MONO}>
                    {mk.alt}
                  </text>
                  <text x={mx} y={474} textAnchor="middle" fill="#94A3B8" fontSize={16} fontWeight={800} fontFamily={FONT_MONO}>
                    {mk.code}
                  </text>
                </g>
              );
            })}

            {/* Moving Climber Orb */}
            <g transform={`translate(${climber.x.toFixed(1)}, ${climber.y.toFixed(1)})`}>
              <circle r={18} fill="#FF6B4A" fillOpacity={0.32} />
              <circle r={9} fill="#FFFFFF" stroke="#FF6B4A" strokeWidth={3.5} />
            </g>
          </svg>
        </div>

        {/* Bottom 2-Column Data / Comparison Cards */}
        {showCompare ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            {[
              { title: pair.leftTitle, items: pair.leftItems, accent: '#38BDF8' },
              { title: pair.rightTitle, items: pair.rightItems, accent: '#FF6B4A' },
            ].map((col, ci) => (
              <div
                key={ci}
                style={{
                  opacity: stagger(ci, localFrame, 8, 14, 14),
                  borderRadius: 22,
                  background: 'rgba(26, 32, 48, 0.94)',
                  border: `1.5px solid ${col.accent}77`,
                  padding: '15px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  minHeight: 140,
                  height: 'auto',
                }}
              >
                <FitText
                  text={col.title}
                  baseSize={22}
                  minSize={17}
                  maxLines={2}
                  lineHeight={1.28}
                  color={col.accent}
                  fontWeight={800}
                  align="left"
                />
                {col.items.map((it, ii) => (
                  <FitText
                    key={ii}
                    text={`• ${it}`}
                    baseSize={21}
                    minSize={17}
                    maxLines={3}
                    lineHeight={1.3}
                    color={pal.fg}
                    fontWeight={600}
                    align="left"
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: dataCards.length >= 2 ? 'repeat(2, minmax(0, 1fr))' : '1fr',
              gap: 14,
            }}
          >
            {dataCards.map((pt, idx) => {
              const p = stagger(idx, localFrame, 6, 14, 14);
              const col = idx % 3 === 0 ? '#FF6B4A' : idx % 3 === 1 ? '#38BDF8' : '#F59E0B';
              return (
                <div
                  key={idx}
                  style={{
                    opacity: p,
                    transform: `translateY(${((1 - p) * 18).toFixed(1)}px)`,
                    borderRadius: 20,
                    background: 'rgba(26, 32, 48, 0.94)',
                    border: `1.5px solid ${pal.border}`,
                    padding: '14px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    minHeight: 98,
                    height: 'auto',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: col }} />
                    <span style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 800, color: col }}>
                      ELEV 0{idx + 1}
                    </span>
                  </div>
                  <FitText
                    text={pt}
                    baseSize={22}
                    minSize={17}
                    maxLines={3}
                    lineHeight={1.3}
                    color={pal.fg}
                    fontWeight={700}
                    align="left"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

/** look-28 / shot 4: aerial-zone-pin — satellite/vector zoom target with rotating radar sweep + telemetry summary panel */
const Look28AerialZonePin: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = resolvePaletteI(tokens, LOOK28_DEFAULTS);
  const txt = sceneTexts(scene);
  const pts = extractPointsI(scene, 3);
  const metric = extractPrimaryMetricI(scene, sceneIndex, 98, '%');

  const headerP = appear(localFrame, 2, 13);
  const zoomP = easeOutCubic(clamp01((localFrame - 4) / 28));
  const mapScale = interpolate(zoomP, [0, 1], [0.88, 1.04]);
  const radarAngle = (localFrame * 3.4) % 360;
  const ringPulse1 = (localFrame % 40) / 40;
  const ringPulse2 = ((localFrame + 20) % 40) / 40;
  const lockSpring = spring({ frame: Math.max(0, localFrame - 12), fps, config: { damping: 13, stiffness: 180 } });

  // Top-down satellite marble/cream vector blocks around target center (486, 268)
  const blocks = [
    { x: 140, y: 78, w: 120, h: 72, hi: false },
    { x: 290, y: 66, w: 136, h: 86, hi: false },
    { x: 554, y: 72, w: 148, h: 78, hi: false },
    { x: 734, y: 82, w: 112, h: 90, hi: false },
    { x: 118, y: 184, w: 138, h: 92, hi: false },
    { x: 294, y: 192, w: 110, h: 110, hi: false },
    { x: 432, y: 214, w: 108, h: 108, hi: true }, // Central target zone block
    { x: 576, y: 188, w: 124, h: 104, hi: false },
    { x: 738, y: 204, w: 120, h: 84, hi: false },
    { x: 152, y: 316, w: 118, h: 96, hi: false },
    { x: 304, y: 338, w: 126, h: 84, hi: false },
    { x: 562, y: 332, w: 138, h: 90, hi: false },
    { x: 732, y: 326, w: 110, h: 94, hi: false },
  ];

  const summaryItems = pts.length > 0 ? pts.slice(0, 3) : [txt.subtitle || txt.title || 'โฟกัสจุดยุทธศาสตร์สำคัญของเป้าหมาย'];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <MapRouteBackdrop pal={pal} localFrame={localFrame} glowColor="#38BDF8" glowY={510} />

      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          zIndex: 4,
        }}
      >
        {/* Header */}
        <div
          style={{
            opacity: headerP,
            transform: `translateY(${((1 - headerP) * -16).toFixed(1)}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 20px',
              borderRadius: 999,
              background: 'rgba(56, 189, 248, 0.16)',
              border: '1.5px solid rgba(56, 189, 248, 0.6)',
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900, color: '#38BDF8' }}>◎</span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 800, color: '#BAE6FD' }}>
              {txt.badge || 'ล็อกพิกัดมุมมองดาวเทียม'}
            </span>
          </div>
          <FitText
            text={txt.title || 'ซูมเจาะลึกพื้นที่เป้าหมายสำคัญ'}
            baseSize={48}
            minSize={30}
            maxLines={2}
            lineHeight={1.28}
            color={pal.fg}
          />
        </div>

        {/* Satellite Vector Map & Radar Lock Viewport */}
        <div
          style={{
            position: 'relative',
            height: 526,
            borderRadius: 28,
            background: '#111622',
            border: `2px solid ${pal.border}`,
            overflow: 'hidden',
            boxShadow: '0 28px 60px rgba(0,0,0,0.55)',
          }}
        >
          <svg
            width={972}
            height={526}
            viewBox="0 0 972 526"
            style={{
              position: 'absolute',
              inset: 0,
              transform: `scale(${mapScale.toFixed(4)})`,
              transformOrigin: '50% 50%',
            }}
          >
            <defs>
              <radialGradient id="i28-az-radar" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.34" />
                <stop offset="100%" stopColor="#38BDF8" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Street Arterial Grid */}
            {[168, 316, 486, 656, 804].map((vx) => (
              <line key={`v-${vx}`} x1={vx} y1={0} x2={vx} y2={526} stroke="#232E47" strokeWidth={vx === 486 ? 12 : 6} />
            ))}
            {[164, 268, 398].map((hy) => (
              <line key={`h-${hy}`} x1={0} y1={hy} x2={972} y2={hy} stroke="#232E47" strokeWidth={hy === 268 ? 12 : 6} />
            ))}

            {/* Top-Down Marble City Footprints */}
            {blocks.map((b, idx) => (
              <g key={idx}>
                <rect x={b.x + 6} y={b.y + 6} width={b.w} height={b.h} rx={8} fill="#080B12" fillOpacity={0.55} />
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  rx={8}
                  fill={b.hi ? '#F7F7F5' : '#ECEAE4'}
                  fillOpacity={b.hi ? 0.96 : 0.24}
                  stroke={b.hi ? '#FF6B4A' : '#94A3B8'}
                  strokeWidth={b.hi ? 3.5 : 1.2}
                  strokeOpacity={b.hi ? 1 : 0.35}
                />
              </g>
            ))}

            {/* Rotating Radar Sweep Wedge */}
            <g transform={`rotate(${radarAngle.toFixed(1)} 486 268)`}>
              <path d="M 486 268 L 486 58 A 210 210 0 0 1 634 120 Z" fill="url(#i28-az-radar)" />
              <line x1={486} y1={268} x2={486} y2={58} stroke="#38BDF8" strokeWidth={2.5} strokeOpacity={0.85} />
            </g>

            {/* Concentric Radar Calibration Rings */}
            {[86, 152, 214].map((r) => (
              <circle
                key={r}
                cx={486}
                cy={268}
                r={r}
                fill="none"
                stroke="#38BDF8"
                strokeOpacity={0.35}
                strokeWidth={1.6}
                strokeDasharray="6 8"
              />
            ))}

            {/* Expanding Pulse Waves */}
            <circle
              cx={486}
              cy={268}
              r={28 + ringPulse1 * 185}
              fill="none"
              stroke="#FF6B4A"
              strokeWidth={3}
              strokeOpacity={(1 - ringPulse1) * 0.85}
            />
            <circle
              cx={486}
              cy={268}
              r={28 + ringPulse2 * 185}
              fill="none"
              stroke="#38BDF8"
              strokeWidth={2.5}
              strokeOpacity={(1 - ringPulse2) * 0.75}
            />

            {/* Target Crosshair Reticle */}
            <g transform={`translate(486, 268) scale(${(0.75 + lockSpring * 0.25).toFixed(3)})`}>
              <line x1={-46} y1={0} x2={-18} y2={0} stroke="#FF6B4A" strokeWidth={3} />
              <line x1={18} y1={0} x2={46} y2={0} stroke="#FF6B4A" strokeWidth={3} />
              <line x1={0} y1={-46} x2={0} y2={-18} stroke="#FF6B4A" strokeWidth={3} />
              <line x1={0} y1={18} x2={0} y2={46} stroke="#FF6B4A" strokeWidth={3} />
              <circle r={16} fill="#FF6B4A" stroke="#FFFFFF" strokeWidth={3.5} />
              <circle r={5} fill="#FFFFFF" />
            </g>
          </svg>

          {/* Viewfinder Corner Brackets & Telemetry HUD */}
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 18,
              padding: '6px 14px',
              borderRadius: 10,
              background: 'rgba(13, 19, 33, 0.88)',
              border: '1px solid rgba(56, 189, 248, 0.5)',
              fontFamily: FONT_MONO,
              fontSize: 16,
              fontWeight: 800,
              color: '#7DD3FC',
            }}
          >
            SAT-LOCK · 13.756°N 100.501°E
          </div>
          <div
            style={{
              position: 'absolute',
              top: 16,
              right: 18,
              padding: '6px 14px',
              borderRadius: 10,
              background: 'rgba(255, 107, 74, 0.18)',
              border: '1px solid rgba(255, 107, 74, 0.65)',
              fontFamily: FONT_MONO,
              fontSize: 16,
              fontWeight: 900,
              color: '#FCA5A5',
            }}
          >
            ZOOM {(14 + zoomP * 4.5).toFixed(1)}X
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: 18,
              padding: '6px 14px',
              borderRadius: 10,
              background: 'rgba(13, 19, 33, 0.88)',
              border: '1px solid rgba(245, 158, 11, 0.5)',
              fontFamily: FONT_MONO,
              fontSize: 16,
              fontWeight: 800,
              color: '#FCD34D',
            }}
          >
            SIGNAL · {metric.big}
          </div>
        </div>

        {/* Bottom Telemetry Summary Panel */}
        <div
          style={{
            borderRadius: 24,
            background: 'rgba(21, 28, 44, 0.96)',
            border: `1.5px solid ${pal.border}`,
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            height: 'auto',
            boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: 10,
              borderBottom: '1px solid rgba(148,163,184,0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 11, height: 11, borderRadius: 99, background: '#10B981', boxShadow: '0 0 10px #10B981' }} />
              <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900, color: '#6EE7B7', letterSpacing: 1 }}>
                TELEMETRY BRIEFING
              </span>
            </div>
            <span style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 700, color: '#94A3B8' }}>
              ประเด็นสำคัญในพื้นที่
            </span>
          </div>

          {summaryItems.map((item, idx) => {
            const p = stagger(idx, localFrame, 6, 14, 14);
            const tagCol = idx === 0 ? '#FF6B4A' : idx === 1 ? '#38BDF8' : '#F59E0B';
            return (
              <div
                key={idx}
                style={{
                  opacity: p,
                  transform: `translateY(${((1 - p) * 14).toFixed(1)}px)`,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <span
                  style={{
                    minWidth: 34,
                    height: 30,
                    borderRadius: 8,
                    background: `${tagCol}22`,
                    border: `1.5px solid ${tagCol}`,
                    color: tagCol,
                    fontFamily: FONT_MONO,
                    fontSize: 16,
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 3,
                  }}
                >
                  0{idx + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item}
                    baseSize={24}
                    minSize={18}
                    maxLines={3}
                    lineHeight={1.3}
                    color={pal.fg}
                    fontWeight={700}
                    align="left"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 3: look-29 — EXPLODED TEARDOWN (แยกชิ้นส่วน)
// Warm Editorial Drafting Paper (#FAF6EE/#EFE8D8)
// Deep Charcoal Ink (#1E1B18/#2A2D33) • Crisp White Cards (#FFFFFF)
// Brass (#B47B2B) & Terracotta Brick (#C84B31) Accents
// CRITICAL: Light background -> ALL body & header typography MUST be dark ink (#1E1B18)
// ============================================================================

const LOOK29_DEFAULTS: PaletteI = {
  bg: '#FAF6EE',
  bg2: '#EFE8D8',
  surface: '#FFFFFF',
  fg: '#1E1B18',
  muted: '#5C5347',
  accent: '#2A2D33',
  accent2: '#0A0A0C',
  border: '#D5C8B3',
};

const TEARDOWN_BRICK = '#C84B31';
const TEARDOWN_BRASS = '#A66B1F';
const TEARDOWN_INK = '#1E1B18';
const TEARDOWN_MUTED = '#574E44';

const TeardownPaperBackdrop: React.FC<{
  pal: PaletteI;
  plateCode: string;
  patternId: string;
}> = ({ pal, plateCode, patternId }) => {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(180deg, ${pal.bg} 0%, ${pal.bg2} 100%)`,
        overflow: 'hidden',
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <pattern id={patternId} width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#C7BBA6" strokeOpacity="0.32" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={STAGE_W} height={STAGE_H} fill={`url(#${patternId})`} />

        {/* Editorial Magazine Double Margin Frame */}
        <rect
          x={26}
          y={26}
          width={STAGE_W - 52}
          height={STAGE_H - 52}
          fill="none"
          stroke={TEARDOWN_INK}
          strokeOpacity={0.22}
          strokeWidth={1.6}
        />
        <rect
          x={34}
          y={34}
          width={STAGE_W - 68}
          height={STAGE_H - 68}
          fill="none"
          stroke={TEARDOWN_INK}
          strokeOpacity={0.12}
          strokeWidth={1}
        />

        {/* Drafting Registration Crop Marks */}
        {[
          [26, 94],
          [STAGE_W - 26, 94],
          [26, CONTENT_BOTTOM + 14],
          [STAGE_W - 26, CONTENT_BOTTOM + 14],
        ].map(([cx, cy], idx) => (
          <g key={idx} opacity={0.45}>
            <line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} stroke={TEARDOWN_INK} strokeWidth={1.5} />
            <line x1={cx} y1={cy - 10} x2={cx} y2={cy + 10} stroke={TEARDOWN_INK} strokeWidth={1.5} />
          </g>
        ))}

        {/* Editorial Top Plate Running Index */}
        <text
          x={54}
          y={72}
          fill={TEARDOWN_MUTED}
          fontSize={16}
          fontWeight={800}
          fontFamily={FONT_MONO}
          letterSpacing={2}
        >
          TECHNICAL ARCHIVE · {plateCode}
        </text>
        <text
          x={STAGE_W - 54}
          y={72}
          textAnchor="end"
          fill={TEARDOWN_BRICK}
          fontSize={16}
          fontWeight={800}
          fontFamily={FONT_MONO}
          letterSpacing={1.5}
        >
          SCALE 1:1 · REV.29
        </text>
        <line x1={54} y1={84} x2={STAGE_W - 54} y2={84} stroke={TEARDOWN_INK} strokeOpacity={0.25} strokeWidth={1.5} />
      </svg>
    </div>
  );
};

/** Isometric Technical Hardware Slab for Exploded Views */
const IsoTechnicalSlab: React.FC<{
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  thickness: number;
  topFill: string;
  leftFill: string;
  rightFill: string;
  strokeCol?: string;
  detailKind: number;
}> = ({ cx, cy, rx, ry, thickness, topFill, leftFill, rightFill, strokeCol = TEARDOWN_INK, detailKind }) => {
  const topPts = `${cx},${cy - ry} ${cx + rx},${cy} ${cx},${cy + ry} ${cx - rx},${cy}`;
  const leftPts = `${cx - rx},${cy} ${cx},${cy + ry} ${cx},${cy + ry + thickness} ${cx - rx},${cy + thickness}`;
  const rightPts = `${cx},${cy + ry} ${cx + rx},${cy} ${cx + rx},${cy + thickness} ${cx},${cy + ry + thickness}`;

  return (
    <g>
      <polygon points={leftPts} fill={leftFill} stroke={strokeCol} strokeWidth={2} strokeLinejoin="round" />
      <polygon points={rightPts} fill={rightFill} stroke={strokeCol} strokeWidth={2} strokeLinejoin="round" />
      <polygon points={topPts} fill={topFill} stroke={strokeCol} strokeWidth={2.2} strokeLinejoin="round" />

      {/* Distinct engineering micro-detail per layer */}
      {detailKind === 0 ? (
        // Top Protective Lens/Shield with specular drafting lines
        <g>
          <polygon
            points={`${cx},${cy - ry * 0.62} ${cx + rx * 0.62},${cy} ${cx},${cy + ry * 0.62} ${cx - rx * 0.62},${cy}`}
            fill="none"
            stroke={TEARDOWN_BRICK}
            strokeWidth={2}
            strokeDasharray="6 4"
          />
          <line x1={cx - rx * 0.45} y1={cy - ry * 0.1} x2={cx + rx * 0.2} y2={cy - ry * 0.42} stroke={strokeCol} strokeOpacity={0.45} strokeWidth={2} />
        </g>
      ) : null}
      {detailKind === 1 ? (
        // Precision Optical/Mechanical Core Rings
        <g>
          <ellipse cx={cx} cy={cy} rx={rx * 0.42} ry={ry * 0.42} fill="#FAF6EE" stroke={TEARDOWN_BRICK} strokeWidth={2.5} />
          <ellipse cx={cx} cy={cy} rx={rx * 0.2} ry={ry * 0.2} fill={TEARDOWN_BRICK} />
        </g>
      ) : null}
      {detailKind === 2 ? (
        // Circuit / Logic Grid Traces
        <g>
          <polygon
            points={`${cx},${cy - ry * 0.36} ${cx + rx * 0.36},${cy} ${cx},${cy + ry * 0.36} ${cx - rx * 0.36},${cy}`}
            fill={TEARDOWN_INK}
          />
          {[-28, 0, 28].map((d, i) => (
            <line
              key={i}
              x1={cx - rx * 0.55 + d * 0.3}
              y1={cy + d * 0.25}
              x2={cx + rx * 0.55 + d * 0.3}
              y2={cy + d * 0.25}
              stroke={TEARDOWN_BRASS}
              strokeWidth={2}
            />
          ))}
        </g>
      ) : null}
      {detailKind === 3 ? (
        // Structural Base Chassis with corner bolt recesses
        <g>
          {[
            [cx, cy - ry * 0.68],
            [cx + rx * 0.68, cy],
            [cx, cy + ry * 0.68],
            [cx - rx * 0.68, cy],
          ].map(([bx, by], i) => (
            <circle key={i} cx={bx} cy={by} r={5} fill="#FAF6EE" stroke={TEARDOWN_INK} strokeWidth={2} />
          ))}
        </g>
      ) : null}
    </g>
  );
};

/** look-29 / shot 1: vertical-explode — 4 vertically exploded layers along dashed guide axes + leader lines + spec cards */
const Look29VerticalExplode: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteI(tokens, LOOK29_DEFAULTS);
  const txt = sceneTexts(scene);
  const defaultLayerNames = ['ชั้นที่ 01 · โครงนอก', 'ชั้นที่ 02 · แกนกลาง', 'ชั้นที่ 03 · แผงควบคุม', 'ชั้นที่ 04 · ฐานรองรับ'];
  const rawSteps = extractStepObjectsI(scene, defaultLayerNames, 4);
  const layerCount = Math.max(3, Math.min(4, rawSteps.length || 4));
  const layers = Array.from({ length: layerCount }).map((_, idx) => ({
    code: `L-0${idx + 1}`,
    tag: rawSteps[idx]?.tag || defaultLayerNames[idx],
    text: rawSteps[idx]?.text || (idx === 0 ? txt.title : txt.subtitle || defaultLayerNames[idx]),
  }));

  const headerP = appear(localFrame, 2, 13);
  const explodeSp = spring({
    frame: Math.max(0, localFrame - 6),
    fps,
    config: { damping: 14, stiffness: 110 },
  });
  const floatWave = Math.sin(localFrame * 0.08) * 5;
  const totalCanvasH = layerCount === 4 ? 890 : 760;

  const layerColors = [
    { top: '#FFFFFF', left: '#E6DEC9', right: '#D3C7AE' },
    { top: '#FCE8DF', left: '#E49B86', right: '#C84B31' },
    { top: '#F5E7CE', left: '#D4A85F', right: '#A66B1F' },
    { top: '#D8DADF', left: '#6B7280', right: '#2A2D33' },
  ];

  // Collapsed vs exploded vertical positions (matching right-side card centers)
  const centerCollapsedY = totalCanvasH * 0.48;
  const stepGapY = layerCount === 4 ? 216 : 244;
  const startTopY = 104;
  const layerYs = layers.map((_, idx) => {
    const targetY = startTopY + idx * stepGapY;
    return interpolate(explodeSp, [0, 1], [centerCollapsedY + idx * 24 - 36, targetY]) + (idx % 2 === 0 ? floatWave : -floatWave);
  });

  // Subtle caption fade
  const footP = appear(localFrame, Math.min(28, Math.round(durationFrames * 0.3)), 14);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <TeardownPaperBackdrop pal={pal} plateCode="FIG. 01 · EXPLODED VIEW" patternId="i29-ve-grid" />

      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          zIndex: 4,
        }}
      >
        {/* Header (Dark Ink on Warm Paper) */}
        <div
          style={{
            opacity: headerP,
            transform: `translateY(${((1 - headerP) * -14).toFixed(1)}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 18px',
              borderRadius: 6,
              background: TEARDOWN_INK,
              color: '#FAF6EE',
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900, color: '#F5B096' }}>EXPLODED</span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 20, fontWeight: 800, color: '#FAF6EE' }}>
              {txt.badge || 'แยกชิ้นส่วนทีละเลเยอร์'}
            </span>
          </div>
          <FitText
            text={txt.title || 'ชำแหละโครงสร้างภายในทีละชั้น'}
            baseSize={46}
            minSize={28}
            maxLines={2}
            lineHeight={1.28}
            color={TEARDOWN_INK}
          />
        </div>

        {/* Main Split Exploded Diagram + Leader Lines + Spec Cards */}
        <div style={{ position: 'relative', minHeight: totalCanvasH, display: 'flex', alignItems: 'stretch', gap: 18 }}>
          {/* Left Exploded SVG Axis Stage */}
          <div style={{ width: 414, flexShrink: 0, position: 'relative' }}>
            <svg width={442} height={totalCanvasH} viewBox={`0 0 442 ${totalCanvasH}`} style={{ overflow: 'visible' }}>
              {/* Vertical Dashed Alignment Guides */}
              {[90, 204, 318].map((gx, i) => (
                <line
                  key={i}
                  x1={gx}
                  y1={42}
                  x2={gx}
                  y2={totalCanvasH - 36}
                  stroke={TEARDOWN_INK}
                  strokeOpacity={i === 1 ? 0.36 : 0.22}
                  strokeWidth={i === 1 ? 2 : 1.4}
                  strokeDasharray="7 7"
                />
              ))}

              {/* Render Bottom-to-Top so upper layers overlap cleanly */}
              {[...layers].reverse().map((_, revIdx) => {
                const idx = layers.length - 1 - revIdx;
                const ly = layerYs[idx];
                const col = layerColors[idx % layerColors.length];
                const lineP = appear(localFrame, 12 + idx * 6, 12);
                return (
                  <g key={idx}>
                    {/* Horizontal Leader Line extending to right card */}
                    <g opacity={lineP}>
                      <line
                        x1={328}
                        y1={ly}
                        x2={434}
                        y2={ly}
                        stroke={idx === 1 ? TEARDOWN_BRICK : TEARDOWN_INK}
                        strokeWidth={2.2}
                        strokeDasharray="5 4"
                      />
                      <circle cx={328} cy={ly} r={6} fill={idx === 1 ? TEARDOWN_BRICK : TEARDOWN_INK} />
                      <circle cx={434} cy={ly} r={5} fill="#FFFFFF" stroke={TEARDOWN_INK} strokeWidth={2.2} />
                    </g>

                    {/* Isometric Slab */}
                    <IsoTechnicalSlab
                      cx={204}
                      cy={ly}
                      rx={122}
                      ry={58}
                      thickness={22}
                      topFill={col.top}
                      leftFill={col.left}
                      rightFill={col.right}
                      detailKind={idx}
                    />

                    {/* Crisp Part Code Pill on Left Margin */}
                    <g transform={`translate(16, ${(ly - 14).toFixed(1)})`}>
                      <rect width={58} height={28} rx={5} fill={TEARDOWN_INK} />
                      <text x={29} y={19} textAnchor="middle" fill="#FAF6EE" fontSize={14} fontWeight={900} fontFamily={FONT_MONO}>
                        {layers[idx].code}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Right Specification Callout Cards (auto-height, dark ink on crisp white) */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-around',
              gap: 14,
              paddingTop: 14,
              paddingBottom: 14,
            }}
          >
            {layers.map((layer, idx) => {
              const p = stagger(idx, localFrame, 6, 12, 14);
              const badgeColor = idx === 1 ? TEARDOWN_BRICK : idx === 2 ? TEARDOWN_BRASS : TEARDOWN_INK;
              return (
                <div
                  key={idx}
                  style={{
                    opacity: p,
                    transform: `translateX(${((1 - p) * 24).toFixed(1)}px)`,
                    borderRadius: 14,
                    background: '#FFFFFF',
                    border: `2px solid ${TEARDOWN_INK}`,
                    boxShadow: '5px 5px 0px #D5C8B3',
                    padding: '13px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    minHeight: 120,
                    height: 'auto',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: 5,
                        background: badgeColor,
                        color: '#FFFFFF',
                        fontFamily: FONT_MONO,
                        fontSize: 16,
                        fontWeight: 900,
                      }}
                    >
                      {layer.code}
                    </span>
                    <span style={{ fontFamily: FONT_THAI, fontSize: 17, fontWeight: 800, color: TEARDOWN_MUTED }}>
                      ชั้นที่ 0{idx + 1}
                    </span>
                  </div>
                  <FitText
                    text={layer.text}
                    baseSize={22}
                    minSize={17}
                    maxLines={3}
                    lineHeight={1.3}
                    color={TEARDOWN_INK}
                    fontWeight={700}
                    align="left"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Editorial Spec Footnote (if subtitle exists & space permits) */}
        {txt.subtitle && layerCount <= 3 ? (
          <div
            style={{
              opacity: footP,
              borderRadius: 14,
              background: '#FFFFFF',
              border: `1.5px solid ${TEARDOWN_INK}`,
              padding: '12px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              height: 'auto',
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 900, color: TEARDOWN_BRICK, flexShrink: 0 }}>
              NOTE //
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <FitText
                text={txt.subtitle}
                baseSize={22}
                minSize={17}
                maxLines={3}
                lineHeight={1.3}
                color={TEARDOWN_INK}
                fontWeight={700}
                align="left"
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** look-29 / shot 2: assembly-callouts — central isometric core assembly with 01–03 callout pins + editorial cards */
const Look29AssemblyCallouts: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = resolvePaletteI(tokens, LOOK29_DEFAULTS);
  const txt = sceneTexts(scene);
  const defaultTags = ['ส่วนประกอบ 01', 'ส่วนประกอบ 02', 'ส่วนประกอบ 03'];
  const rawSteps = extractStepObjectsI(scene, defaultTags, 3);
  const callouts = [0, 1, 2].map((i) => ({
    code: `0${i + 1}`,
    tag: rawSteps[i]?.tag || defaultTags[i],
    text:
      rawSteps[i]?.text ||
      (i === 0
        ? txt.title || 'ชุดครอบด้านบนป้องกันแรงกระแทกและฝุ่น'
        : i === 1
          ? txt.subtitle || 'แกนประมวลผลกลางออกแบบเพื่อความแม่นยำสูง'
          : 'ฐานโครงสร้างยึดแน่นและระบายความร้อนได้เร็ว'),
    accent: i === 0 ? TEARDOWN_BRICK : i === 1 ? TEARDOWN_BRASS : TEARDOWN_INK,
  }));

  const headerP = appear(localFrame, 2, 13);
  const coreSpring = spring({ frame: Math.max(0, localFrame - 4), fps, config: { damping: 14, stiffness: 130 } });
  const breathe = Math.sin(localFrame * 0.07) * 5;

  const pinTargets = [
    { ax: 486, ay: 144 + breathe, px: 224, py: 108, code: '01', col: TEARDOWN_BRICK },
    { ax: 564, ay: 238, px: 774, py: 186, code: '02', col: TEARDOWN_BRASS },
    { ax: 416, ay: 320 - breathe * 0.5, px: 204, py: 358, code: '03', col: TEARDOWN_INK },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <TeardownPaperBackdrop pal={pal} plateCode="FIG. 02 · ASSEMBLY CALLOUTS" patternId="i29-ac-grid" />

      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          zIndex: 4,
        }}
      >
        {/* Header */}
        <div
          style={{
            opacity: headerP,
            transform: `translateY(${((1 - headerP) * -14).toFixed(1)}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 18px',
              borderRadius: 6,
              background: TEARDOWN_BRICK,
              color: '#FFFFFF',
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900 }}>CALLOUT 01–03</span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 20, fontWeight: 800 }}>
              {txt.badge || 'ชี้จุดกลไกสำคัญ'}
            </span>
          </div>
          <FitText
            text={txt.title || '3 จุดสำคัญของโครงสร้างแกนกลาง'}
            baseSize={46}
            minSize={28}
            maxLines={2}
            lineHeight={1.28}
            color={TEARDOWN_INK}
          />
        </div>

        {/* Central Technical Drafting Board */}
        <div
          style={{
            height: 452,
            borderRadius: 18,
            background: '#FFFFFF',
            border: `2px solid ${TEARDOWN_INK}`,
            boxShadow: '6px 6px 0px #D5C8B3',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <svg width={972} height={452} viewBox="0 0 972 452">
            {/* Blueprint Calibration Compass Rings */}
            <circle cx={486} cy={234} r={178} fill="none" stroke="#C7BBA6" strokeWidth={1.6} strokeDasharray="6 6" />
            <circle cx={486} cy={234} r={134} fill="#FAF6EE" stroke={TEARDOWN_INK} strokeOpacity={0.22} strokeWidth={1.4} />
            <line x1={120} y1={234} x2={852} y2={234} stroke="#C7BBA6" strokeWidth={1.2} />
            <line x1={486} y1={32} x2={486} y2={426} stroke="#C7BBA6" strokeWidth={1.2} />

            {/* Dimension Ruler Bar at bottom of canvas */}
            <g opacity={0.65}>
              <line x1={276} y1={418} x2={696} y2={418} stroke={TEARDOWN_INK} strokeWidth={1.6} />
              <line x1={276} y1={410} x2={276} y2={426} stroke={TEARDOWN_INK} strokeWidth={1.6} />
              <line x1={696} y1={410} x2={696} y2={426} stroke={TEARDOWN_INK} strokeWidth={1.6} />
              <rect x={432} y={404} width={108} height={26} fill="#FFFFFF" />
              <text x={486} y={422} textAnchor="middle" fill={TEARDOWN_INK} fontSize={15} fontWeight={800} fontFamily={FONT_MONO}>
                420 MM
              </text>
            </g>

            {/* Stacked Isometric Precision Core Mechanism */}
            <g transform={`translate(486, 234) scale(${(0.76 + coreSpring * 0.24).toFixed(3)}) translate(-486, -234)`}>
              {/* Base Manifold */}
              <IsoTechnicalSlab
                cx={486}
                cy={304 - breathe * 0.5}
                rx={144}
                ry={68}
                thickness={28}
                topFill="#E8E3D8"
                leftFill="#6B7280"
                rightFill="#2A2D33"
                detailKind={3}
              />
              {/* Middle Brass Core Ring */}
              <IsoTechnicalSlab
                cx={486}
                cy={232}
                rx={116}
                ry={54}
                thickness={26}
                topFill="#F7EAD2"
                leftFill="#D4A455"
                rightFill="#A66B1F"
                detailKind={1}
              />
              {/* Top Cap Module */}
              <IsoTechnicalSlab
                cx={486}
                cy={152 + breathe}
                rx={106}
                ry={48}
                thickness={20}
                topFill="#FFFFFF"
                leftFill="#F0CFC4"
                rightFill="#C84B31"
                detailKind={0}
              />
            </g>

            {/* Numbered Leader Callout Pins 01, 02, 03 */}
            {pinTargets.map((pt, idx) => {
              const sp = spring({
                frame: Math.max(0, localFrame - (10 + idx * 10)),
                fps,
                config: { damping: 11, stiffness: 200 },
              });
              const elbowX = pt.px < 486 ? pt.px + 72 : pt.px - 72;
              return (
                <g key={pt.code} opacity={clamp01(sp * 1.4)}>
                  <polyline
                    points={`${pt.ax},${pt.ay} ${elbowX},${pt.py} ${pt.px},${pt.py}`}
                    fill="none"
                    stroke={pt.col}
                    strokeWidth={2.6}
                  />
                  <circle cx={pt.ax} cy={pt.ay} r={6} fill={pt.col} stroke="#FFFFFF" strokeWidth={2} />
                  <g transform={`translate(${pt.px}, ${pt.py}) scale(${(0.5 + sp * 0.5).toFixed(3)})`}>
                    <circle r={26} fill={pt.col} stroke="#FFFFFF" strokeWidth={3} />
                    <text y={8} textAnchor="middle" fill="#FFFFFF" fontSize={21} fontWeight={900} fontFamily={FONT_MONO}>
                      {pt.code}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>

        {/* 3 Numbered Editorial Callout Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {callouts.map((c, idx) => {
            const p = stagger(idx, localFrame, 8, 12, 14);
            return (
              <div
                key={idx}
                style={{
                  opacity: p,
                  transform: `translateY(${((1 - p) * 18).toFixed(1)}px)`,
                  borderRadius: 16,
                  background: '#FFFFFF',
                  border: `2px solid ${TEARDOWN_INK}`,
                  boxShadow: '5px 5px 0px #D5C8B3',
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 16,
                  minHeight: 96,
                  height: 'auto',
                }}
              >
                <div
                  style={{
                    minWidth: 62,
                    height: 62,
                    borderRadius: 12,
                    background: c.accent,
                    color: '#FFFFFF',
                    fontFamily: FONT_MONO,
                    fontSize: 28,
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {c.code}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <FitText
                    text={c.tag}
                    baseSize={20}
                    minSize={16}
                    maxLines={2}
                    lineHeight={1.28}
                    color={c.accent === TEARDOWN_INK ? TEARDOWN_MUTED : c.accent}
                    fontWeight={800}
                    align="left"
                  />
                  <FitText
                    text={c.text}
                    baseSize={24}
                    minSize={18}
                    maxLines={3}
                    lineHeight={1.3}
                    color={TEARDOWN_INK}
                    fontWeight={700}
                    align="left"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** look-29 / shot 3: cutaway-spec — half-section cutaway diagram (outer/mid/inner core) + spec bars & stat/compare cards */
const Look29CutawaySpec: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteI(tokens, LOOK29_DEFAULTS);
  const txt = sceneTexts(scene);
  const metric = extractPrimaryMetricI(scene, sceneIndex, 94, '%');
  const pts = extractPointsI(scene, 4);
  const showCompare = Boolean(scene.compare);
  const pair = extractComparePairI(scene, 'โครงสร้างเดิม', 'โครงสร้างใหม่');

  const headerP = appear(localFrame, 2, 13);
  const sliceP = easeOutCubic(clamp01((localFrame - 6) / Math.max(24, Math.min(48, durationFrames * 0.5))));
  const corePulse = 0.85 + 0.15 * Math.sin(localFrame * 0.16);
  const barSpring = spring({ frame: Math.max(0, localFrame - 10), fps, config: { damping: 16, stiffness: 120 } });

  const specBars = [
    { label: 'ชั้นนอก (SHELL)', pct: 92, col: TEARDOWN_INK },
    { label: 'ชั้นกลาง (SHIELD)', pct: 78, col: TEARDOWN_BRASS },
    { label: 'แกนใน (CORE)', pct: Math.max(60, Math.round(metric.progress * 100)), col: TEARDOWN_BRICK },
  ];

  const cards = pts.length > 0 ? pts.slice(0, 4) : [txt.subtitle || txt.title || 'โครงสร้างหลายชั้นออกแบบให้ทำงานประสานกันอย่างลงตัว'];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <TeardownPaperBackdrop pal={pal} plateCode="FIG. 03 · CROSS-SECTION" patternId="i29-cs-grid" />

      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          zIndex: 4,
        }}
      >
        {/* Header */}
        <div
          style={{
            opacity: headerP,
            transform: `translateY(${((1 - headerP) * -14).toFixed(1)}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 18px',
              borderRadius: 6,
              background: TEARDOWN_INK,
              color: '#FAF6EE',
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900, color: '#E9B872' }}>SECTION A-A</span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 20, fontWeight: 800 }}>
              {txt.badge || 'ภาพผ่าครึ่งเจาะสเปกภายใน'}
            </span>
          </div>
          <FitText
            text={txt.title || 'ผ่าโครงสร้างชั้นนอกถึงแกนใน'}
            baseSize={46}
            minSize={28}
            maxLines={2}
            lineHeight={1.28}
            color={TEARDOWN_INK}
          />
        </div>

        {/* Main Cutaway Technical Frame */}
        <div
          style={{
            borderRadius: 18,
            background: '#FFFFFF',
            border: `2px solid ${TEARDOWN_INK}`,
            boxShadow: '6px 6px 0px #D5C8B3',
            padding: '18px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            minHeight: 454,
          }}
        >
          {/* Left: Half-Section Cutaway SVG */}
          <div style={{ width: 516, height: 422, flexShrink: 0 }}>
            <svg width={516} height={422} viewBox="0 0 516 422">
              <defs>
                <pattern id="i29-cs-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="10" stroke="#1E1B18" strokeWidth="2.2" strokeOpacity="0.45" />
                </pattern>
              </defs>

              {/* Soft drafting background circle */}
              <circle cx={244} cy={214} r={186} fill="#FAF6EE" stroke="#D5C8B3" strokeWidth={1.6} strokeDasharray="6 6" />

              {/* Outer Shell Full Circle */}
              <circle cx={244} cy={214} r={164} fill="#2A2D33" stroke={TEARDOWN_INK} strokeWidth={3} />
              {/* Cutaway Quadrant Slice revealing Mid & Core */}
              <path
                d={`M 244 214 L 244 50 A 164 164 0 0 1 408 214 Z`}
                fill="#FFFFFF"
                stroke={TEARDOWN_INK}
                strokeWidth={2.5}
              />
              {/* Outer Shell Cut Cross-Hatch Wall */}
              <path
                d={`M 244 50 A 164 164 0 0 1 408 214 L 368 214 A 124 124 0 0 0 244 90 Z`}
                fill="url(#i29-cs-hatch)"
                stroke={TEARDOWN_INK}
                strokeWidth={2}
              />

              {/* Mid Brass Shield Layer */}
              <circle
                cx={244}
                cy={214}
                r={124 * (0.65 + sliceP * 0.35)}
                fill="#D4A455"
                stroke={TEARDOWN_INK}
                strokeWidth={2.5}
              />
              {/* Cutaway slice of Mid Layer */}
              <path
                d={`M 244 90 A 124 124 0 0 1 368 214 L 324 214 A 80 80 0 0 0 244 134 Z`}
                fill="#F7EAD2"
                stroke={TEARDOWN_INK}
                strokeWidth={2}
              />

              {/* Inner Terracotta Core */}
              <circle
                cx={244}
                cy={214}
                r={76 * (0.6 + sliceP * 0.4)}
                fill={TEARDOWN_BRICK}
                stroke={TEARDOWN_INK}
                strokeWidth={2.5}
              />
              {/* Core Pulse Center */}
              <circle cx={244} cy={214} r={34 * corePulse} fill="#FAF6EE" fillOpacity={0.92} />
              <circle cx={244} cy={214} r={14} fill={TEARDOWN_INK} />

              {/* Cutaway Dimension Callout Lines */}
              <g opacity={sliceP}>
                {/* Outer label */}
                <line x1={352} y1={98} x2={418} y2={62} stroke={TEARDOWN_INK} strokeWidth={2} />
                <circle cx={352} cy={98} r={5} fill={TEARDOWN_INK} />
                <rect x={418} y={46} width={86} height={30} rx={5} fill={TEARDOWN_INK} />
                <text x={461} y={66} textAnchor="middle" fill="#FAF6EE" fontSize={14} fontWeight={900} fontFamily={FONT_MONO}>
                  OUTER
                </text>

                {/* Mid label */}
                <line x1={328} y1={146} x2={418} y2={146} stroke={TEARDOWN_BRASS} strokeWidth={2} />
                <circle cx={328} cy={146} r={5} fill={TEARDOWN_BRASS} />
                <rect x={418} y={131} width={86} height={30} rx={5} fill={TEARDOWN_BRASS} />
                <text x={461} y={151} textAnchor="middle" fill="#FFFFFF" fontSize={14} fontWeight={900} fontFamily={FONT_MONO}>
                  MID
                </text>

                {/* Core label */}
                <line x1={276} y1={214} x2={418} y2={258} stroke={TEARDOWN_BRICK} strokeWidth={2} />
                <circle cx={276} cy={214} r={5} fill={TEARDOWN_BRICK} />
                <rect x={418} y={243} width={86} height={30} rx={5} fill={TEARDOWN_BRICK} />
                <text x={461} y={263} textAnchor="middle" fill="#FFFFFF" fontSize={14} fontWeight={900} fontFamily={FONT_MONO}>
                  CORE
                </text>
              </g>
            </svg>
          </div>

          {/* Right: Key Metric + Spec Meter Bars */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div
              style={{
                borderRadius: 14,
                background: '#FAF6EE',
                border: `2px solid ${TEARDOWN_INK}`,
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <span style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 800, color: TEARDOWN_MUTED, letterSpacing: 1 }}>
                KEY SPECIFICATION
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: FONT_MONO, fontSize: 64, fontWeight: 900, color: TEARDOWN_BRICK, lineHeight: 1 }}>
                  {metric.big}
                </span>
                <span style={{ fontFamily: FONT_THAI, fontSize: 22, fontWeight: 800, color: TEARDOWN_INK }}>
                  {metric.unit}
                </span>
              </div>
              {metric.delta ? (
                <span style={{ fontFamily: FONT_THAI, fontSize: 19, fontWeight: 800, color: TEARDOWN_BRASS }}>
                  ▲ {metric.delta}
                </span>
              ) : null}
            </div>

            {/* 3 Spec Meter Bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {specBars.map((sb, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 800, color: TEARDOWN_INK }}>
                      {sb.label}
                    </span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900, color: sb.col }}>
                      {Math.round(sb.pct * barSpring)}%
                    </span>
                  </div>
                  <div style={{ height: 14, borderRadius: 4, background: '#EFE8D8', border: `1.5px solid ${TEARDOWN_INK}`, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${(sb.pct * barSpring).toFixed(1)}%`,
                        background: sb.col,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom 2-Column Spec / Compare Cards */}
        {showCompare ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            {[
              { title: pair.leftTitle, items: pair.leftItems, accent: TEARDOWN_INK },
              { title: pair.rightTitle, items: pair.rightItems, accent: TEARDOWN_BRICK },
            ].map((col, ci) => (
              <div
                key={ci}
                style={{
                  opacity: stagger(ci, localFrame, 8, 14, 14),
                  borderRadius: 16,
                  background: '#FFFFFF',
                  border: `2px solid ${col.accent}`,
                  boxShadow: '5px 5px 0px #D5C8B3',
                  padding: '14px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  minHeight: 130,
                  height: 'auto',
                }}
              >
                <FitText
                  text={col.title}
                  baseSize={22}
                  minSize={17}
                  maxLines={2}
                  lineHeight={1.28}
                  color={col.accent}
                  fontWeight={800}
                  align="left"
                />
                {col.items.map((it, ii) => (
                  <FitText
                    key={ii}
                    text={`• ${it}`}
                    baseSize={21}
                    minSize={17}
                    maxLines={3}
                    lineHeight={1.3}
                    color={TEARDOWN_INK}
                    fontWeight={600}
                    align="left"
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: cards.length >= 2 ? 'repeat(2, minmax(0, 1fr))' : '1fr',
              gap: 14,
            }}
          >
            {cards.map((pt, idx) => {
              const p = stagger(idx, localFrame, 6, 14, 14);
              const tagCol = idx % 2 === 0 ? TEARDOWN_BRICK : TEARDOWN_BRASS;
              return (
                <div
                  key={idx}
                  style={{
                    opacity: p,
                    transform: `translateY(${((1 - p) * 16).toFixed(1)}px)`,
                    borderRadius: 16,
                    background: '#FFFFFF',
                    border: `2px solid ${TEARDOWN_INK}`,
                    boxShadow: '4px 4px 0px #D5C8B3',
                    padding: '13px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    minHeight: 96,
                    height: 'auto',
                  }}
                >
                  <span style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 900, color: tagCol }}>
                    SPEC 0{idx + 1}
                  </span>
                  <FitText
                    text={pt}
                    baseSize={22}
                    minSize={17}
                    maxLines={3}
                    lineHeight={1.3}
                    color={TEARDOWN_INK}
                    fontWeight={700}
                    align="left"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

/** Top-down orthographic Knolling hardware part drawings for look-29 shot 4 */
const KnollingPartSvg: React.FC<{ kind: number; progress: number }> = ({ kind, progress }) => {
  const k = kind % 4;
  return (
    <svg width={180} height={110} viewBox="0 0 180 110" style={{ transform: `scale(${(0.75 + progress * 0.25).toFixed(3)})` }}>
      {k === 0 && (
        // PRT-01: Precision Frame Bezel
        <g>
          <rect x={22} y={14} width={136} height={82} rx={12} fill="#EFE8D8" stroke={TEARDOWN_INK} strokeWidth={2.5} />
          <rect x={38} y={28} width={104} height={54} rx={6} fill="#FFFFFF" stroke={TEARDOWN_BRICK} strokeWidth={2.2} strokeDasharray="5 3" />
          {[
            [30, 22],
            [150, 22],
            [30, 88],
            [150, 88],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={3.5} fill={TEARDOWN_INK} />
          ))}
        </g>
      )}
      {k === 1 && (
        // PRT-02: Precision Brass Rotor Gear
        <g>
          <circle cx={90} cy={55} r={40} fill="#F7EAD2" stroke={TEARDOWN_INK} strokeWidth={2.5} />
          <circle cx={90} cy={55} r={26} fill="#D4A455" stroke={TEARDOWN_INK} strokeWidth={2} />
          <circle cx={90} cy={55} r={10} fill="#FFFFFF" stroke={TEARDOWN_INK} strokeWidth={2.2} />
          {Array.from({ length: 8 }).map((_, i) => {
            const ang = (i * 45 * Math.PI) / 180;
            return (
              <line
                key={i}
                x1={90 + 36 * Math.cos(ang)}
                y1={55 + 36 * Math.sin(ang)}
                x2={90 + 46 * Math.cos(ang)}
                y2={55 + 46 * Math.sin(ang)}
                stroke={TEARDOWN_INK}
                strokeWidth={5}
                strokeLinecap="round"
              />
            );
          })}
        </g>
      )}
      {k === 2 && (
        // PRT-03: Logic Board / Silicon Chip Matrix
        <g>
          <rect x={30} y={18} width={120} height={74} rx={8} fill="#2A2D33" stroke={TEARDOWN_INK} strokeWidth={2.5} />
          <rect x={64} y={32} width={52} height={46} rx={5} fill={TEARDOWN_BRICK} stroke="#FAF6EE" strokeWidth={2} />
          {[28, 42, 56, 70, 84].map((py, i) => (
            <g key={i}>
              <line x1={38} y1={py} x2={60} y2={py} stroke="#E9B872" strokeWidth={2.2} />
              <line x1={120} y1={py} x2={142} y2={py} stroke="#E9B872" strokeWidth={2.2} />
            </g>
          ))}
        </g>
      )}
      {k === 3 && (
        // PRT-04: Power Cell & Fastener Set
        <g>
          <rect x={24} y={24} width={88} height={62} rx={10} fill="#FFFFFF" stroke={TEARDOWN_INK} strokeWidth={2.5} />
          <rect x={112} y={40} width={10} height={30} rx={3} fill={TEARDOWN_INK} />
          <rect x={34} y={34} width={52} height={42} rx={5} fill={TEARDOWN_BRASS} />
          <circle cx={148} cy={36} r={12} fill="#EFE8D8" stroke={TEARDOWN_INK} strokeWidth={2.2} />
          <line x1={142} y1={36} x2={154} y2={36} stroke={TEARDOWN_INK} strokeWidth={2.2} />
          <circle cx={148} cy={74} r={12} fill="#EFE8D8" stroke={TEARDOWN_INK} strokeWidth={2.2} />
          <line x1={142} y1={74} x2={154} y2={74} stroke={TEARDOWN_INK} strokeWidth={2.2} />
        </g>
      )}
    </svg>
  );
};

/** look-29 / shot 4: knolling-bom — Knolling flat-lay 2x2 Bill of Materials grid + numbered part boxes + summary bar */
const Look29KnollingBom: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = resolvePaletteI(tokens, LOOK29_DEFAULTS);
  const txt = sceneTexts(scene);
  const pts = extractPointsI(scene, 4);
  const fallbackParts = [
    txt.title || 'โครงหลักที่ออกแบบเพื่อความแข็งแรง',
    txt.subtitle || 'ชุดขับเคลื่อนและกลไกการทำงานหลัก',
    'แผงควบคุมที่จัดการระบบได้แม่นยำ',
    'ชุดพลังงานและจุดยึดพร้อมใช้งานทันที',
  ];

  const bomItems = [0, 1, 2, 3].map((i) => ({
    code: `PRT-0${i + 1}`,
    qty: i === 3 ? '×4' : i === 1 ? '×2' : '×1',
    text: pts[i] || fallbackParts[i],
    accent: i === 0 ? TEARDOWN_BRICK : i === 1 ? TEARDOWN_BRASS : TEARDOWN_INK,
  }));

  const headerP = appear(localFrame, 2, 13);
  const summaryText =
    scene.quote?.text ||
    txt.subtitle ||
    (pts.length > 0 ? `ครบทั้ง ${bomItems.length} ชิ้นส่วนสำคัญ ประกอบเข้าด้วยกันอย่างลงตัว` : txt.title);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <TeardownPaperBackdrop pal={pal} plateCode="FIG. 04 · BILL OF MATERIALS" patternId="i29-kb-grid" />

      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          zIndex: 4,
        }}
      >
        {/* Header */}
        <div
          style={{
            opacity: headerP,
            transform: `translateY(${((1 - headerP) * -14).toFixed(1)}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 18px',
              borderRadius: 6,
              background: TEARDOWN_INK,
              color: '#FAF6EE',
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900, color: '#F5B096' }}>BOM · 04 PCS</span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 20, fontWeight: 800 }}>
              {txt.badge || 'ตารางจัดเรียงชิ้นส่วน Knolling'}
            </span>
          </div>
          <FitText
            text={txt.title || 'รวมองค์ประกอบทั้งหมดในชุดเดียว'}
            baseSize={46}
            minSize={28}
            maxLines={2}
            lineHeight={1.28}
            color={TEARDOWN_INK}
          />
        </div>

        {/* 2x2 Knolling Flat-Lay Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 16,
            alignItems: 'stretch',
          }}
        >
          {bomItems.map((item, idx) => {
            const p = stagger(idx, localFrame, 6, 8, 14);
            const svgSp = spring({
              frame: Math.max(0, localFrame - (10 + idx * 6)),
              fps,
              config: { damping: 13, stiffness: 165 },
            });
            return (
              <div
                key={item.code}
                style={{
                  opacity: p,
                  transform: `translateY(${((1 - p) * 20).toFixed(1)}px)`,
                  borderRadius: 16,
                  background: '#FFFFFF',
                  border: `2px solid ${TEARDOWN_INK}`,
                  boxShadow: '5px 5px 0px #D5C8B3',
                  padding: '12px 16px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  minHeight: 242,
                  height: 'auto',
                }}
              >
                {/* Part Index Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1.5px dashed #D5C8B3',
                    paddingBottom: 8,
                  }}
                >
                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: 5,
                      background: item.accent,
                      color: '#FFFFFF',
                      fontFamily: FONT_MONO,
                      fontSize: 16,
                      fontWeight: 900,
                    }}
                  >
                    {item.code}
                  </span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900, color: TEARDOWN_MUTED }}>
                    QTY {item.qty}
                  </span>
                </div>

                {/* Knolling Flat-Lay Vector Drawing */}
                <div
                  style={{
                    height: 112,
                    borderRadius: 10,
                    background: '#FAF6EE',
                    border: '1px solid #E5DAC6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <KnollingPartSvg kind={idx} progress={clamp01(svgSp)} />
                </div>

                {/* Part Description */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item.text}
                    baseSize={21}
                    minSize={16}
                    maxLines={3}
                    lineHeight={1.28}
                    color={TEARDOWN_INK}
                    fontWeight={700}
                    align="left"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Editorial Summary Bar (auto-flowing below grid, guaranteed no overlap) */}
        <div
          style={{
            opacity: appear(localFrame, 22, 14),
            borderRadius: 16,
            background: TEARDOWN_INK,
            color: '#FAF6EE',
            padding: '16px 22px',
            boxShadow: '5px 5px 0px #C84B31',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            minHeight: 88,
            height: 'auto',
          }}
        >
          <div
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              background: TEARDOWN_BRICK,
              color: '#FFFFFF',
              fontFamily: FONT_MONO,
              fontSize: 18,
              fontWeight: 900,
              flexShrink: 0,
            }}
          >
            SUMMARY
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FitText
              text={summaryText}
              baseSize={23}
              minSize={17}
              maxLines={3}
              lineHeight={1.3}
              color="#FAF6EE"
              fontWeight={700}
              align="left"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// EXPORTED REGISTRY DEFINITIONS — BATCH_I (look-26, look-28, look-29)
// ============================================================================

export const BATCH_I: StyleDirectorDef[] = [
  {
    styleId: 'look-26',
    shots: {
      'flip-calendar': Look26FlipCalendar,
      'streak-grid': Look26StreakGrid,
      'milestone-track': Look26MilestoneTrack,
      'challenge-ring': Look26ChallengeRing,
    },
    shotLabels: {
      'flip-calendar': 'ปฏิทินพลิกกลไก split-flap ขนาดใหญ่พลิกตัวเลขวัน/ตัวเลขสำคัญพร้อมป้ายไฟ streak และการ์ดสรุป',
      'streak-grid': 'ตารางชาเลนจ์ 30 วันแบบ Habit Contribution Grid ที่แต่ละช่องค่อยๆ สว่างไล่สีพร้อมการ์ดประเด็น',
      'milestone-track': 'แทร็กความคืบหน้าทีละวันและสัปดาห์พร้อมหมุดเช็กถูกเด้งขึ้นทีละขั้น',
      'challenge-ring': 'วงแหวนความสำเร็จของชาเลนจ์แสดงเปอร์เซ็นต์พร้อมเทียบก่อน-หลังหรือคำคมปิดท้าย',
    },
    infer: (scene) => {
      const text = haystackOfI(scene);
      if ((Array.isArray(scene.steps) && scene.steps.length > 0) || I_STEP_RE.test(text)) {
        return 'milestone-track';
      }
      if (scene.quote?.text || scene.compare || I_COMPARE_RE.test(text) || I_SUMMARY_RE.test(text)) {
        return 'challenge-ring';
      }
      if (I_GRID_RE.test(text) || (Array.isArray(scene.bullets) && scene.bullets.length >= 3)) {
        return 'streak-grid';
      }
      if (scene.stat || I_DAY_FLIP_RE.test(text)) {
        return 'flip-calendar';
      }
      return null;
    },
  },
  {
    styleId: 'look-28',
    shots: {
      'tilted-city-route': Look28TiltedCityRoute,
      'waypoint-stops': Look28WaypointStops,
      'elevation-profile': Look28ElevationProfile,
      'aerial-zone-pin': Look28AerialZonePin,
    },
    shotLabels: {
      'tilted-city-route': 'แผนที่เมือง 3D เอียงพร้อมตึกไอโซเมตริกสีหินอ่อน เส้นทางเรืองแสง และจุดนำทางเคลื่อนที่',
      'waypoint-stops': 'เส้นทางบนแผนที่ 3D พร้อมหมุดปัก 3 จุด (Pin 01/02/03) เด้งขึ้นตามลำดับและการ์ดอธิบาย',
      'elevation-profile': 'ภาพตัดขวางเส้นทางและกราฟระดับความสูง 3D พร้อมตัวเลขสถิติและข้อมูลเปรียบเทียบ',
      'aerial-zone-pin': 'มุมมองดาวเทียมซูมเป้าหมายพร้อมวงคลื่นเรดาร์และแผง telemetry สรุปประเด็นสำคัญ',
    },
    infer: (scene) => {
      const text = haystackOfI(scene);
      if ((Array.isArray(scene.steps) && scene.steps.length > 0) || I_WAYPOINT_RE.test(text)) {
        return 'waypoint-stops';
      }
      if (scene.stat || scene.compare || I_ELEV_RE.test(text) || I_COMPARE_RE.test(text)) {
        return 'elevation-profile';
      }
      if (scene.quote?.text || I_AERIAL_RE.test(text) || I_SUMMARY_RE.test(text)) {
        return 'aerial-zone-pin';
      }
      if (I_CITY_ROUTE_RE.test(text)) {
        return 'tilted-city-route';
      }
      return null;
    },
  },
  {
    styleId: 'look-29',
    shots: {
      'vertical-explode': Look29VerticalExplode,
      'assembly-callouts': Look29AssemblyCallouts,
      'cutaway-spec': Look29CutawaySpec,
      'knolling-bom': Look29KnollingBom,
    },
    shotLabels: {
      'vertical-explode': 'ไดอะแกรมแยกชิ้นส่วน 3–4 เลเยอร์ลอยแยกตามแกนแนวตั้งด้วยเส้นประพร้อมเส้นโยงและการ์ดระบุหน้าที่',
      'assembly-callouts': 'ภาพโครงสร้างแกนกลางพร้อมหมุดหมายเลข 01–03 ชี้ออกไปยังการ์ดคำอธิบายบนกระดาษร่างเทคนิค',
      'cutaway-spec': 'ภาพผ่าครึ่งโชว์ชั้นนอก-ชั้นกลาง-แกนในพร้อมแถบสเปกและตัวเลขสำคัญ',
      'knolling-bom': 'การจัดเรียงชิ้นส่วนแบบ Knolling ในตารางสเปก (Bill of Materials) พร้อมกรอบหมายเลขชิ้นส่วนและบทสรุป',
    },
    infer: (scene) => {
      const text = haystackOfI(scene);
      if (scene.stat || scene.compare || I_CUTAWAY_RE.test(text) || I_COMPARE_RE.test(text)) {
        return 'cutaway-spec';
      }
      if (scene.quote?.text || I_BOM_RE.test(text) || I_SUMMARY_RE.test(text)) {
        return 'knolling-bom';
      }
      if ((Array.isArray(scene.steps) && scene.steps.length >= 4) || I_EXPLODE_RE.test(text)) {
        return 'vertical-explode';
      }
      if ((Array.isArray(scene.steps) && scene.steps.length === 3) || I_CALLOUT_RE.test(text)) {
        return 'assembly-callouts';
      }
      return null;
    },
  },
];
