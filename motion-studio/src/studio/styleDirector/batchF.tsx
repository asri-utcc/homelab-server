import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import type { StudioScene } from '../types';
import { FitText, SAFE_BOTTOM, STAGE_H, STAGE_W, appear, clamp01, sceneTexts, stagger } from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

// ============================================================================
// SHARED CONTENT EXTRACTION & 3D GEOMETRY HELPERS (Pure, Deterministic)
// ============================================================================

const CONTENT_BOTTOM = SAFE_BOTTOM - 120;

const F_STEP_RE = /(?:ขั้นตอน|สเต็ป|ลำดับ|วิธี|เส้นทาง|ไต่|ปีน|จาก.+สู่|ระดับ|step)/i;
const F_SUMMARY_RE = /(?:สรุป|สำคัญ|ไฮไลต์|ประโยคจำ|จำไว้|หัวใจ|แก่น|บทเรียน|ปิดท้าย|สำเร็จ|ฉลอง)/i;
const F_COMPARE_RE = /(?:เทียบ|ตอนนั้น|ตอนนี้|อดีต|ปัจจุบัน|แบบเดิม|แบบใหม่|ต่างกัน|ใหญ่กว่า|เล็กกว่า|vs|เปรียบเทียบ)/i;
const F_BUDGET_RE = /(?:งบ|ออม|เก็บเงิน|เงินเดือน|กระปุก|โหล|รายจ่าย|ค่าใช้จ่าย|ลงทุน|บาท|฿)/i;

interface ResolvedPaletteF {
  bg: string;
  bg2: string;
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  border: string;
}

function paletteOf(tokens: any, defaults: ResolvedPaletteF): ResolvedPaletteF {
  const p = tokens?.palette || {};
  return {
    bg: p.bg || defaults.bg,
    bg2: p.bg2 || p.bgSecondary || defaults.bg2,
    surface: p.surface || p.cardBg || defaults.surface,
    fg: p.fg || p.text || defaults.fg,
    muted: p.muted || defaults.muted,
    accent: p.accent || defaults.accent,
    accent2: p.accent2 || defaults.accent2,
    border: p.border || defaults.border,
  };
}

function haystackOf(scene: StudioScene): string {
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

function extractPoints(scene: StudioScene, max = 4): string[] {
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

function extractShortPoints(scene: StudioScene, max = 4): string[] {
  const t = sceneTexts(scene);
  const out: string[] = [];

  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    for (const s of scene.steps) {
      const txt = typeof s === 'string' ? s.trim() : String(s?.title || '').trim();
      if (txt) out.push(txt);
    }
  } else if (t.bullets.length > 0) {
    out.push(...t.bullets);
  } else if (scene.stat) {
    if (scene.stat.label) out.push(scene.stat.label);
    if (scene.stat.delta) out.push(scene.stat.delta);
    if (t.subtitle) out.push(t.subtitle);
  } else if (scene.quote?.text) {
    out.push(scene.quote.text);
    if (scene.quote.author) out.push(scene.quote.author);
  } else if (t.subtitle) {
    out.push(t.subtitle);
  }

  if (out.length === 0 && t.title) out.push(t.title);
  return out.slice(0, max);
}

function extractPrimaryMetric(
  scene: StudioScene,
  sceneIndex: number,
): { big: string; unit: string; label: string } {
  const t = sceneTexts(scene);
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const rawVal = String(scene.stat.value).trim();
    const prefix = String(scene.stat.prefix || '').trim();
    const suffix = String(scene.stat.suffix || '').trim();
    const big = `${prefix}${rawVal}${suffix}`.trim();
    return {
      big,
      unit: String(scene.stat.unit || scene.stat.delta || '').trim(),
      label: String(scene.stat.label || t.subtitle || t.title).trim(),
    };
  }
  if (t.numbers.length > 0) {
    return {
      big: t.numbers[0],
      unit: t.badge || `ซีน ${sceneIndex + 1}`,
      label: t.subtitle || t.title,
    };
  }
  const hl = Array.isArray(scene.highlight) ? scene.highlight[0] : scene.highlight;
  if (hl && String(hl).trim().length <= 14) {
    return {
      big: String(hl).trim(),
      unit: t.badge || 'เป้าหมาย',
      label: t.subtitle || t.title,
    };
  }
  return {
    big: `${(sceneIndex + 1) * 10}x`,
    unit: t.badge || 'ระดับความต่าง',
    label: t.subtitle || t.title,
  };
}

function extractHighlightPhrase(scene: StudioScene): string {
  const hl = Array.isArray(scene.highlight) ? scene.highlight[0] : scene.highlight;
  if (hl && String(hl).trim()) return String(hl).trim();
  const t = sceneTexts(scene);
  if (scene.quote?.text) return scene.quote.text;
  if (t.numbers[0]) return t.numbers[0];
  return t.title;
}

function parseNumericToken(raw: string): number | null {
  const s = String(raw || '').replace(/,/g, '').trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const base = parseFloat(m[1]);
  if (!Number.isFinite(base) || base <= 0) return null;
  if (/ล้าน|M\b/i.test(s)) return base * 1_000_000;
  if (/แสน/.test(s)) return base * 100_000;
  if (/หมื่น/.test(s)) return base * 10_000;
  if (/พัน|K\b/i.test(s)) return base * 1_000;
  if (/B\b/i.test(s)) return base * 1_000_000_000;
  return base;
}

function extractComparePair(scene: StudioScene): {
  leftTitle: string;
  rightTitle: string;
  leftItems: string[];
  rightItems: string[];
  leftVal: string;
  rightVal: string;
} {
  const t = sceneTexts(scene);
  if (scene.compare) {
    const leftItems = (scene.compare.leftItems || []).filter(Boolean).slice(0, 3);
    const rightItems = (scene.compare.rightItems || []).filter(Boolean).slice(0, 3);
    return {
      leftTitle: scene.compare.leftTitle || scene.compare.leftLabel || 'ฝั่งเดิม',
      rightTitle: scene.compare.rightTitle || scene.compare.rightLabel || 'ฝั่งใหม่',
      leftItems,
      rightItems,
      leftVal: t.numbers[0] || '1x',
      rightVal: t.numbers[1] || '10x',
    };
  }
  const pts = extractShortPoints(scene, 4);
  const leftTitle = pts[0] || 'ระดับเริ่มต้น';
  const rightTitle = pts[1] || t.title || 'ระดับยักษ์ใหญ่';
  return {
    leftTitle,
    rightTitle,
    leftItems: pts.slice(0, 2),
    rightItems: pts.slice(1, 3).length > 0 ? pts.slice(1, 3) : [t.subtitle || t.title],
    leftVal: t.numbers[0] || '1x',
    rightVal: t.numbers[1] || (scene.stat?.value ? String(scene.stat.value) : '8x'),
  };
}

interface BreakdownSlice {
  label: string;
  pct: number;
  rawNumber?: string;
}

function extractBreakdownShares(scene: StudioScene, max = 4): BreakdownSlice[] {
  const t = sceneTexts(scene);
  const pts = extractShortPoints(scene, max);
  const fallbackLabels = ['ส่วนหลัก', 'ส่วนรอง', 'ส่วนสนับสนุน', 'สำรอง'];
  const count = Math.max(3, Math.min(max, pts.length > 1 ? pts.length : Math.max(3, t.numbers.length)));

  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    labels.push(pts[i] || fallbackLabels[i] || `ส่วนที่ ${i + 1}`);
  }

  // First try extracting explicit numbers per point, then sceneTexts().numbers
  const parsedVals: number[] = [];
  const rawNums: Array<string | undefined> = [];

  for (let i = 0; i < count; i++) {
    const ptMatch = labels[i].match(/\d+(?:[.,]\d+)?(?:\s*(?:%|฿|บาท|ล้าน|แสน|พัน|[KMB]\b))?/);
    if (ptMatch) {
      const n = parseNumericToken(ptMatch[0]);
      if (n !== null) {
        parsedVals.push(n);
        rawNums.push(ptMatch[0].trim());
        continue;
      }
    }
    if (t.numbers[i]) {
      const n = parseNumericToken(t.numbers[i]);
      if (n !== null) {
        parsedVals.push(n);
        rawNums.push(t.numbers[i]);
        continue;
      }
    }
  }

  let pcts: number[] = [];
  if (parsedVals.length === count) {
    const sum = parsedVals.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      pcts = parsedVals.map((v) => Math.max(6, Math.round((v / sum) * 100)));
    }
  } else if (parsedVals.length >= 2) {
    // Fill remaining evenly with leftover or proportional
    const totalGiven = parsedVals.reduce((a, b) => a + b, 0);
    if (totalGiven < 100 && parsedVals.every((v) => v <= 100)) {
      const rem = Math.max(10, 100 - totalGiven);
      const remCount = count - parsedVals.length;
      const each = Math.max(6, Math.round(rem / remCount));
      pcts = [...parsedVals.map((v) => Math.round(v)), ...Array(remCount).fill(each)];
    } else {
      const avg = totalGiven / parsedVals.length;
      const full = [...parsedVals, ...Array(count - parsedVals.length).fill(avg * 0.65)];
      const sum = full.reduce((a, b) => a + b, 0);
      pcts = full.map((v) => Math.max(6, Math.round((v / sum) * 100)));
    }
  } else if (parsedVals.length === 1 && parsedVals[0] > 5 && parsedVals[0] < 92) {
    const first = Math.round(parsedVals[0]);
    const rest = 100 - first;
    const remCount = count - 1;
    const base = Math.floor(rest / remCount);
    pcts = [first, ...Array(remCount).fill(base)];
  } else {
    // Clean fallback: even shares summing to 100
    const base = Math.floor(100 / count);
    pcts = Array(count).fill(base);
  }

  // Normalize exact sum to 100
  const curSum = pcts.reduce((a, b) => a + b, 0);
  if (curSum !== 100 && pcts.length > 0) {
    pcts[0] = Math.max(5, pcts[0] + (100 - curSum));
  }

  return labels.map((label, i) => ({
    label,
    pct: pcts[i] ?? Math.round(100 / count),
    rawNumber: rawNums[i],
  }));
}

function polarToXY(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function donutArcPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startDeg: number,
  endDeg: number,
): string {
  const sweep = Math.min(359.6, Math.max(0.5, endDeg - startDeg));
  const eDeg = startDeg + sweep;
  const large = sweep > 180 ? 1 : 0;
  const p1 = polarToXY(cx, cy, outerR, startDeg);
  const p2 = polarToXY(cx, cy, outerR, eDeg);
  const p3 = polarToXY(cx, cy, innerR, eDeg);
  const p4 = polarToXY(cx, cy, innerR, startDeg);
  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

// ============================================================================
// STYLE 1: look-16 — SCALE LINEUP (เรียงเทียบขนาด)
// 3D Architectural Calibration Stage • Brushed Ceramic & Steel Objects
// ============================================================================

const SCALE_DEFAULTS: ResolvedPaletteF = {
  bg: '#131722',
  bg2: '#1E2436',
  surface: '#1A2030',
  fg: '#F1F5F9',
  muted: '#94A3B8',
  accent: '#F1F2F4',
  accent2: '#D6DBE1',
  border: '#2E3852',
};

const ScaleStudioBackdrop: React.FC<{
  pal: ResolvedPaletteF;
  localFrame: number;
  floorY?: number;
  spotX?: number;
}> = ({ pal, localFrame, floorY = 1140, spotX = 540 }) => {
  const shimmer = 0.5 + 0.5 * Math.sin(localFrame * 0.05);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 920px 680px at ${spotX}px 380px, #26314A 0%, ${pal.bg2} 42%, ${pal.bg} 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="scale-floor-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#26314A" stopOpacity="0.95" />
            <stop offset="35%" stopColor="#171E2E" stopOpacity="0.98" />
            <stop offset="100%" stopColor="#0D111A" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="scale-spot-beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E2E8F0" stopOpacity={0.14 + shimmer * 0.04} />
            <stop offset="65%" stopColor="#38BDF8" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#131722" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Overhead studio softbox cone */}
        <polygon
          points={`${spotX - 240},0 ${spotX + 240},0 ${spotX + 520},${floorY + 120} ${spotX - 520},${floorY + 120}`}
          fill="url(#scale-spot-beam)"
        />

        {/* Subtle wall engineering grid */}
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={`vw-${i}`}
            x1={90 * i}
            y1={0}
            x2={90 * i}
            y2={floorY}
            stroke="#94A3B8"
            strokeOpacity={0.07}
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={`hw-${i}`}
            x1={0}
            y1={100 * i}
            x2={STAGE_W}
            y2={100 * i}
            stroke="#94A3B8"
            strokeOpacity={0.07}
            strokeWidth={1}
          />
        ))}

        {/* Perspective 3D studio floor */}
        <rect x={0} y={floorY} width={STAGE_W} height={STAGE_H - floorY} fill="url(#scale-floor-grad)" />
        <line x1={0} y1={floorY} x2={STAGE_W} y2={floorY} stroke="#64748B" strokeOpacity={0.45} strokeWidth={2} />

        {/* Perspective floor lines radiating from horizon */}
        {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((k) => {
          const topX = 540 + k * 95;
          const botX = 540 + k * 210;
          return (
            <line
              key={`pf-${k}`}
              x1={topX}
              y1={floorY}
              x2={botX}
              y2={STAGE_H}
              stroke="#38BDF8"
              strokeOpacity={0.09}
              strokeWidth={1.2}
            />
          );
        })}
        {[55, 130, 225, 345].map((dy, i) => (
          <line
            key={`ph-${i}`}
            x1={0}
            y1={floorY + dy}
            x2={STAGE_W}
            y2={floorY + dy}
            stroke="#94A3B8"
            strokeOpacity={0.08}
            strokeWidth={1}
          />
        ))}
      </svg>
    </div>
  );
};

/** 3D isometric beveled block helper rendered inside an SVG */
const IsoBlock3D: React.FC<{
  x: number;
  baseY: number;
  width: number;
  height: number;
  depth?: number;
  topColor: string;
  leftColor: string;
  rightColor: string;
  rimColor?: string;
  opacity?: number;
}> = ({
  x,
  baseY,
  width,
  height,
  depth = 28,
  topColor,
  leftColor,
  rightColor,
  rimColor = '#FFFFFF',
  opacity = 1,
}) => {
  const hw = width / 2;
  const dY = depth * 0.52;
  const topY = baseY - height;
  return (
    <g opacity={opacity}>
      {/* Soft cast floor shadow */}
      <ellipse cx={x + 12} cy={baseY + 8} rx={hw + depth * 0.55} ry={16} fill="#050811" opacity={0.55} />
      {/* Left front face */}
      <polygon
        points={`${x - hw},${topY} ${x},${topY + dY} ${x},${baseY + dY} ${x - hw},${baseY}`}
        fill={leftColor}
      />
      {/* Right front face */}
      <polygon
        points={`${x},${topY + dY} ${x + hw},${topY} ${x + hw},${baseY} ${x},${baseY + dY}`}
        fill={rightColor}
      />
      {/* Top diamond face */}
      <polygon
        points={`${x},${topY - dY} ${x + hw},${topY} ${x},${topY + dY} ${x - hw},${topY}`}
        fill={topColor}
      />
      {/* Crisp specular bevel edge */}
      <polyline
        points={`${x - hw},${topY} ${x},${topY + dY} ${x + hw},${topY}`}
        fill="none"
        stroke={rimColor}
        strokeOpacity={0.65}
        strokeWidth={2}
      />
      <line
        x1={x}
        y1={topY + dY}
        x2={x}
        y2={baseY + dY}
        stroke={rimColor}
        strokeOpacity={0.35}
        strokeWidth={1.6}
      />
    </g>
  );
};

/** look-16 Shot 1: size-lineup — เรียงวัตถุ 3 มิติจากเล็กไปใหญ่บนเส้นไม้บรรทัดพร้อมเงาคนเทียบสเกล */
const SizeLineupShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = paletteOf(tokens, SCALE_DEFAULTS);
  const t = sceneTexts(scene);
  const pts = extractShortPoints(scene, 4);
  const itemCount = Math.max(3, Math.min(4, pts.length || 3));
  const fallbackLabels = ['ระดับเริ่มต้น', 'ขนาดกลาง', 'ขนาดใหญ่', 'ขนาดมหึมา'];
  const fallbackScales = ['1x', '2.5x', '5x', '10x'];

  const floorY = 1035;
  const titleP = appear(localFrame, 3, 14);
  const rulerP = appear(localFrame, 6, 18);
  const humanSpring = spring({ frame: Math.max(0, localFrame - 6), fps, config: { damping: 14, stiffness: 140 } });

  const slots =
    itemCount === 3
      ? [
          { cx: 345, w: 96, h: 120, top: '#E2E8F0', left: '#94A3B8', right: '#CBD5E1', accent: '#38BDF8' },
          { cx: 585, w: 132, h: 255, top: '#F8FAFC', left: '#64748B', right: '#94A3B8', accent: '#60A5FA' },
          { cx: 865, w: 176, h: 430, top: '#FFFFFF', left: '#38BDF8', right: '#0284C7', accent: '#F59E0B' },
        ]
      : [
          { cx: 300, w: 80, h: 98, top: '#E2E8F0', left: '#94A3B8', right: '#CBD5E1', accent: '#38BDF8' },
          { cx: 480, w: 104, h: 195, top: '#F1F5F9', left: '#64748B', right: '#94A3B8', accent: '#60A5FA' },
          { cx: 680, w: 130, h: 315, top: '#F8FAFC', left: '#475569', right: '#7C8DA6', accent: '#818CF8' },
          { cx: 905, w: 158, h: 448, top: '#FFFFFF', left: '#38BDF8', right: '#0284C7', accent: '#F59E0B' },
        ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <ScaleStudioBackdrop pal={pal} localFrame={localFrame} floorY={floorY} spotX={640} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 68,
          right: 68,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [24, 0])}px)`,
        }}
      >
        {t.badge ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <span
              style={{
                padding: '8px 22px',
                borderRadius: 999,
                background: 'rgba(56, 189, 248, 0.14)',
                border: '1.5px solid rgba(56, 189, 248, 0.48)',
                color: '#7DD3FC',
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              📏 {t.badge}
            </span>
          </div>
        ) : null}
        <FitText text={t.title} baseSize={60} minSize={38} maxLines={2} color={pal.fg} fontWeight={800} />
        {t.subtitle ? (
          <div style={{ marginTop: 10 }}>
            <FitText text={t.subtitle} baseSize={28} minSize={20} maxLines={2} color={pal.muted} fontWeight={500} />
          </div>
        ) : null}
      </div>

      {/* Main 3D Lineup SVG Stage */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="sl-human-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#B45309" />
          </linearGradient>
          <linearGradient id="sl-ruler-bar" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#1E293B" />
            <stop offset="50%" stopColor="#334155" />
            <stop offset="100%" stopColor="#1E293B" />
          </linearGradient>
        </defs>

        {/* Horizontal dashed reference elevation lines */}
        {[120, 240, 360, 480].map((dh, idx) => (
          <g key={dh} opacity={rulerP * 0.45}>
            <line
              x1={72}
              y1={floorY - dh}
              x2={1010}
              y2={floorY - dh}
              stroke="#64748B"
              strokeWidth={1.2}
              strokeDasharray="6 10"
            />
            <text
              x={76}
              y={floorY - dh - 8}
              fill="#94A3B8"
              fontSize={18}
              fontFamily={THAI_FONT_FAMILY}
              fontWeight={600}
            >
              {`${(idx + 1) * 2}m`}
            </text>
          </g>
        ))}

        {/* Human Silhouette for scale reference on far left */}
        <g
          transform={`translate(148, ${floorY}) scale(${humanSpring})`}
          opacity={clamp01(humanSpring)}
        >
          <ellipse cx={0} cy={6} rx={36} ry={10} fill="#050811" opacity={0.6} />
          {/* Head */}
          <circle cx={0} cy={-136} r={14} fill="url(#sl-human-grad)" />
          {/* Torso */}
          <path
            d="M -18,-116 C -18,-122 18,-122 18,-116 L 14,-62 L -14,-62 Z"
            fill="url(#sl-human-grad)"
          />
          {/* Arms */}
          <rect x={-26} y={-114} width={8} height={46} rx={4} fill="#D97706" />
          <rect x={18} y={-114} width={8} height={46} rx={4} fill="#D97706" />
          {/* Legs */}
          <rect x={-13} y={-64} width={10} height={64} rx={4} fill="#B45309" />
          <rect x={3} y={-64} width={10} height={64} rx={4} fill="#B45309" />
          {/* Scale callout bracket */}
          <line x1={-40} y1={-150} x2={-40} y2={0} stroke="#F59E0B" strokeWidth={2} />
          <line x1={-47} y1={-150} x2={-33} y2={-150} stroke="#F59E0B" strokeWidth={2} />
          <line x1={-47} y1={0} x2={-33} y2={0} stroke="#F59E0B" strokeWidth={2} />
          <text
            x={0}
            y={-164}
            textAnchor="middle"
            fill="#FCD34D"
            fontSize={20}
            fontWeight={800}
            fontFamily={THAI_FONT_FAMILY}
          >
            คน (สเกล)
          </text>
        </g>

        {/* 3D Scaled Objects lined up small -> large */}
        {slots.map((slot, i) => {
          const sp = spring({
            frame: Math.max(0, localFrame - (10 + i * 7)),
            fps,
            config: { damping: 13, stiffness: 135 },
          });
          const curH = Math.max(8, slot.h * sp);
          const scaleLabel = t.numbers[i] || fallbackScales[i];
          const topY = floorY - curH;

          return (
            <g key={i}>
              <IsoBlock3D
                x={slot.cx}
                baseY={floorY}
                width={slot.w}
                height={curH}
                depth={Math.round(slot.w * 0.28)}
                topColor={slot.top}
                leftColor={slot.left}
                rightColor={slot.right}
                rimColor="#FFFFFF"
                opacity={clamp01(sp * 1.3)}
              />

              {/* Glowing measurement pill above each object */}
              <g opacity={appear(localFrame, 16 + i * 7, 12)}>
                <line
                  x1={slot.cx}
                  y1={topY - 22}
                  x2={slot.cx}
                  y2={topY - 62}
                  stroke={slot.accent}
                  strokeWidth={2.5}
                  strokeDasharray="4 4"
                />
                <circle cx={slot.cx} cy={topY - 22} r={5} fill={slot.accent} />
                <rect
                  x={slot.cx - 56}
                  y={topY - 104}
                  width={112}
                  height={40}
                  rx={12}
                  fill="#0F172A"
                  stroke={slot.accent}
                  strokeWidth={2}
                />
                <text
                  x={slot.cx}
                  y={topY - 77}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize={22}
                  fontWeight={800}
                  fontFamily={THAI_FONT_FAMILY}
                >
                  {scaleLabel.slice(0, 10)}
                </text>
              </g>
            </g>
          );
        })}

        {/* Precision Ruler Bar along the baseline */}
        <g opacity={rulerP}>
          <rect
            x={64}
            y={floorY + 26}
            width={952 * rulerP}
            height={36}
            rx={8}
            fill="url(#sl-ruler-bar)"
            stroke="#475569"
            strokeWidth={1.5}
          />
          {Array.from({ length: 39 }).map((_, idx) => {
            const tx = 84 + idx * 24;
            const isMajor = idx % 5 === 0;
            if (tx > 64 + 952 * rulerP) return null;
            return (
              <line
                key={idx}
                x1={tx}
                y1={floorY + 26}
                x2={tx}
                y2={floorY + (isMajor ? 46 : 37)}
                stroke={isMajor ? '#38BDF8' : '#94A3B8'}
                strokeWidth={isMajor ? 2.2 : 1.2}
              />
            );
          })}
        </g>
      </svg>

      {/* Bottom Legend Cards mapped to each lined-up object (stays above CONTENT_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          top: 1116,
          left: 52,
          right: 52,
          display: 'grid',
          gridTemplateColumns: `repeat(${itemCount === 3 ? 3 : 2}, minmax(0, 1fr))`,
          gap: 12,
          alignItems: 'stretch',
        }}
      >
        {slots.map((slot, i) => {
          const p = stagger(i, localFrame, 6, 18, 14);
          const label = pts[i] || fallbackLabels[i];
          const isThreeCol = itemCount === 3;
          return (
            <div
              key={i}
              style={{
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [18, 0])}px)`,
                background: 'rgba(26, 32, 48, 0.90)',
                border: `1.5px solid ${i === slots.length - 1 ? '#38BDF8' : pal.border}`,
                borderRadius: 18,
                padding: isThreeCol ? '12px 14px' : '12px 16px',
                display: 'flex',
                flexDirection: isThreeCol ? 'column' : 'row',
                alignItems: isThreeCol ? 'stretch' : 'flex-start',
                gap: isThreeCol ? 8 : 12,
                boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
                minWidth: 0,
                minHeight: isThreeCol ? 132 : 96,
                height: 'auto',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: slot.accent,
                    color: '#0F172A',
                    fontFamily: THAI_FONT_FAMILY,
                    fontSize: 18,
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </div>
                {isThreeCol ? (
                  <span
                    style={{
                      fontFamily: THAI_FONT_FAMILY,
                      fontSize: 16,
                      fontWeight: 800,
                      color: slot.accent,
                    }}
                  >
                    {t.numbers[i] || fallbackScales[i]}
                  </span>
                ) : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText
                  text={label}
                  baseSize={isThreeCol ? 19 : 21}
                  minSize={isThreeCol ? 15 : 16}
                  maxLines={isThreeCol ? 4 : 3}
                  lineHeight={1.28}
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
  );
};

/** look-16 Shot 2: zoom-ladder — ซูมไล่ระดับจากวัตถุเล็กไปใหญ่ทีละขั้น */
const ZoomLadderShot: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames, fps, tokens }) => {
  const pal = paletteOf(tokens, SCALE_DEFAULTS);
  const t = sceneTexts(scene);
  const pts = extractShortPoints(scene, 4);
  const count = Math.max(3, Math.min(4, pts.length || 3));
  const defaults = ['จุดเริ่มต้นขนาดจิ๋ว', 'ขยายตัวระดับกลาง', 'เติบโตเต็มสเกล', 'ระดับมหภาคสูงสุด'];
  const zoomTags = ['1x', '5x', '25x', '100x'];

  const titleP = appear(localFrame, 3, 14);
  const sweepProg = clamp01(interpolate(localFrame, [10, Math.max(55, durationFrames - 15)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));

  const rungs =
    count === 3
      ? [
          { x: 215, y: 1280, r: 44, cardX: 335, cardY: 1205, color: '#94A3B8' },
          { x: 470, y: 950, r: 78, cardX: 595, cardY: 865, color: '#38BDF8' },
          { x: 775, y: 585, r: 122, cardX: 110, cardY: 495, color: '#F59E0B' },
        ]
      : [
          { x: 185, y: 1295, r: 36, cardX: 290, cardY: 1225, color: '#94A3B8' },
          { x: 375, y: 1035, r: 58, cardX: 488, cardY: 965, color: '#60A5FA' },
          { x: 605, y: 765, r: 86, cardX: 110, cardY: 695, color: '#38BDF8' },
          { x: 835, y: 485, r: 116, cardX: 110, cardY: 415, color: '#F59E0B' },
        ];

  // Active optical reticle position gliding along rungs
  const segFloat = sweepProg * (rungs.length - 1);
  const segIdx = Math.min(rungs.length - 2, Math.floor(segFloat));
  const segT = segFloat - segIdx;
  const retX = interpolate(segT, [0, 1], [rungs[segIdx].x, rungs[segIdx + 1].x]);
  const retY = interpolate(segT, [0, 1], [rungs[segIdx].y, rungs[segIdx + 1].y]);
  const retR = interpolate(segT, [0, 1], [rungs[segIdx].r + 22, rungs[segIdx + 1].r + 22]);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <ScaleStudioBackdrop pal={pal} localFrame={localFrame} floorY={1410} spotX={740} />

      {/* Title Block */}
      <div
        style={{
          position: 'absolute',
          top: 90,
          left: 68,
          right: 68,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [20, 0])}px)`,
        }}
      >
        {t.badge ? (
          <div style={{ marginBottom: 10 }}>
            <span
              style={{
                padding: '7px 20px',
                borderRadius: 999,
                background: 'rgba(245, 158, 11, 0.16)',
                border: '1.5px solid rgba(245, 158, 11, 0.55)',
                color: '#FCD34D',
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              🔍 {t.badge}
            </span>
          </div>
        ) : null}
        <FitText text={t.title} baseSize={56} minSize={36} maxLines={2} color={pal.fg} fontWeight={800} align="left" />
      </div>

      {/* 3D Zoom Ladder SVG */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="zl-sphere-silver" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="45%" stopColor="#CBD5E1" />
            <stop offset="85%" stopColor="#475569" />
            <stop offset="100%" stopColor="#1E293B" />
          </radialGradient>
          <radialGradient id="zl-sphere-cyan" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#E0F2FE" />
            <stop offset="45%" stopColor="#38BDF8" />
            <stop offset="85%" stopColor="#0369A1" />
            <stop offset="100%" stopColor="#0C4A6E" />
          </radialGradient>
          <radialGradient id="zl-sphere-gold" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#FEF3C7" />
            <stop offset="45%" stopColor="#F59E0B" />
            <stop offset="85%" stopColor="#B45309" />
            <stop offset="100%" stopColor="#451A03" />
          </radialGradient>
        </defs>

        {/* Optical zoom projection cones connecting each rung to the next */}
        {rungs.slice(0, -1).map((r1, i) => {
          const r2 = rungs[i + 1];
          const p = appear(localFrame, 10 + i * 9, 14);
          return (
            <g key={`cone-${i}`} opacity={p * 0.45}>
              <line
                x1={r1.x - r1.r * 0.6}
                y1={r1.y - r1.r * 0.6}
                x2={r2.x - r2.r * 0.65}
                y2={r2.y - r2.r * 0.65}
                stroke="#38BDF8"
                strokeWidth={2}
                strokeDasharray="8 8"
              />
              <line
                x1={r1.x + r1.r * 0.6}
                y1={r1.y + r1.r * 0.6}
                x2={r2.x + r2.r * 0.65}
                y2={r2.y + r2.r * 0.65}
                stroke="#38BDF8"
                strokeWidth={2}
                strokeDasharray="8 8"
              />
              <line
                x1={r1.x}
                y1={r1.y}
                x2={r2.x}
                y2={r2.y}
                stroke="#7DD3FC"
                strokeWidth={3}
                opacity={0.7}
              />
            </g>
          );
        })}

        {/* 3D Spheres + Pedestal Rings at each zoom rung */}
        {rungs.map((rg, i) => {
          const sp = spring({
            frame: Math.max(0, localFrame - (6 + i * 8)),
            fps,
            config: { damping: 13, stiffness: 145 },
          });
          const gradId =
            i === rungs.length - 1 ? 'url(#zl-sphere-gold)' : i >= rungs.length - 2 ? 'url(#zl-sphere-cyan)' : 'url(#zl-sphere-silver)';
          const tag = t.numbers[i] || zoomTags[i] || `${i + 1}x`;

          return (
            <g key={`rung-${i}`} transform={`translate(${rg.x}, ${rg.y}) scale(${sp})`}>
              {/* Tilted 3D calibration ring */}
              <ellipse
                cx={0}
                cy={rg.r * 0.72}
                rx={rg.r * 1.18}
                ry={rg.r * 0.34}
                fill="none"
                stroke={rg.color}
                strokeWidth={2.5}
                strokeOpacity={0.55}
              />
              {/* Soft shadow */}
              <ellipse cx={8} cy={rg.r * 0.78} rx={rg.r * 0.85} ry={rg.r * 0.24} fill="#050811" opacity={0.55} />
              {/* 3D glossy sphere */}
              <circle cx={0} cy={0} r={rg.r} fill={gradId} />
              {/* Specular reflection highlight */}
              <ellipse
                cx={-rg.r * 0.3}
                cy={-rg.r * 0.32}
                rx={rg.r * 0.26}
                ry={rg.r * 0.14}
                transform={`rotate(-32 ${-rg.r * 0.3} ${-rg.r * 0.32})`}
                fill="#FFFFFF"
                opacity={0.58}
              />
              {/* Magnification badge */}
              <rect
                x={-48}
                y={-22}
                width={96}
                height={40}
                rx={12}
                fill="rgba(15, 23, 42, 0.82)"
                stroke={rg.color}
                strokeWidth={2}
              />
              <text
                x={0}
                y={6}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize={22}
                fontWeight={900}
                fontFamily={THAI_FONT_FAMILY}
              >
                {tag.slice(0, 8)}
              </text>
            </g>
          );
        })}

        {/* Animated optical zoom reticle tracking up the ladder */}
        <g transform={`translate(${retX}, ${retY})`} opacity={appear(localFrame, 12, 10)}>
          <circle
            cx={0}
            cy={0}
            r={retR}
            fill="none"
            stroke="#38BDF8"
            strokeWidth={3}
            strokeDasharray="24 14"
            transform={`rotate(${localFrame * 1.2})`}
          />
          <line x1={-retR - 14} y1={0} x2={-retR + 8} y2={0} stroke="#FCD34D" strokeWidth={3} />
          <line x1={retR - 8} y1={0} x2={retR + 14} y2={0} stroke="#FCD34D" strokeWidth={3} />
          <line x1={0} y1={-retR - 14} x2={0} y2={-retR + 8} stroke="#FCD34D" strokeWidth={3} />
          <line x1={0} y1={retR - 8} x2={0} y2={retR + 14} stroke="#FCD34D" strokeWidth={3} />
        </g>
      </svg>

      {/* Callout Labels for each zoom rung (all above SAFE_BOTTOM) */}
      {rungs.map((rg, i) => {
        const p = stagger(i, localFrame, 8, 12, 14);
        const text = pts[i] || defaults[i];
        return (
          <div
            key={`lbl-${i}`}
            style={{
              position: 'absolute',
              left: rg.cardX,
              top: rg.cardY,
              width: 430,
              opacity: p,
              transform: `translateX(${interpolate(p, [0, 1], [i >= 2 ? -24 : 24, 0])}px)`,
              background: 'rgba(20, 26, 40, 0.90)',
              border: `1.8px solid ${rg.color}`,
              borderRadius: 18,
              padding: '14px 20px',
              boxShadow: '0 14px 30px rgba(0,0,0,0.42)',
            }}
          >
            <div
              style={{
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 19,
                fontWeight: 800,
                color: rg.color,
                marginBottom: 4,
              }}
            >
              ขั้นที่ {i + 1} • ซูม {t.numbers[i] || zoomTags[i]}
            </div>
            <FitText text={text} baseSize={23} minSize={17} maxLines={3} lineHeight={1.28} color={pal.fg} fontWeight={700} align="left" />
          </div>
        );
      })}
    </div>
  );
};

/** look-16 Shot 3: stack-tower — ซ้อนวัตถุ 3 มิติเป็นหอคอยเทียบกับตัวเลขสถิติยักษ์ */
const StackTowerShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = paletteOf(tokens, SCALE_DEFAULTS);
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetric(scene, sceneIndex);
  const pts = extractShortPoints(scene, 3);
  const titleP = appear(localFrame, 2, 14);
  const statP = spring({ frame: Math.max(0, localFrame - 10), fps, config: { damping: 14, stiffness: 130 } });

  const layerCount = 7;
  const baseFloorY = 1285;
  const layerStep = 80;
  const towerX = 300;
  const topReachedY = baseFloorY - layerCount * layerStep;

  const paletteLayers = [
    { top: '#CBD5E1', left: '#475569', right: '#64748B' },
    { top: '#E2E8F0', left: '#334155', right: '#64748B' },
    { top: '#BAE6FD', left: '#0369A1', right: '#0284C7' },
    { top: '#7DD3FC', left: '#0284C7', right: '#0EA5E9' },
    { top: '#38BDF8', left: '#0369A1', right: '#0284C7' },
    { top: '#FDE68A', left: '#D97706', right: '#F59E0B' },
    { top: '#FEF3C7', left: '#F59E0B', right: '#FBBF24' },
  ];

  const laserProgress = appear(localFrame, 18, 22);
  const currentLaserY = interpolate(laserProgress, [0, 1], [baseFloorY, topReachedY]);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <ScaleStudioBackdrop pal={pal} localFrame={localFrame} floorY={1300} spotX={320} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 92,
          left: 68,
          right: 68,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [22, 0])}px)`,
        }}
      >
        {t.badge ? (
          <div style={{ marginBottom: 10 }}>
            <span
              style={{
                padding: '7px 20px',
                borderRadius: 999,
                background: 'rgba(56, 189, 248, 0.14)',
                border: '1.5px solid rgba(56, 189, 248, 0.45)',
                color: '#7DD3FC',
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              🏗️ {t.badge}
            </span>
          </div>
        ) : null}
        <FitText text={t.title} baseSize={56} minSize={36} maxLines={2} color={pal.fg} fontWeight={800} align="left" />
      </div>

      {/* 3D Stacked Tower + Vertical Measurement Pole */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Circular 3D Studio Plinth */}
        <ellipse cx={towerX} cy={baseFloorY + 26} rx={195} ry={44} fill="#050811" opacity={0.65} />
        <ellipse cx={towerX} cy={baseFloorY + 14} rx={180} ry={38} fill="#1E293B" stroke="#475569" strokeWidth={2.5} />
        <ellipse cx={towerX} cy={baseFloorY + 4} rx={172} ry={32} fill="#26314A" stroke="#64748B" strokeWidth={1.5} />

        {/* Stacked 3D Isometric Slabs dropping from above */}
        {Array.from({ length: layerCount }).map((_, i) => {
          const sp = spring({
            frame: Math.max(0, localFrame - (4 + i * 4)),
            fps,
            config: { damping: 12, stiffness: 155 },
          });
          const dropOffset = interpolate(sp, [0, 1], [-180, 0]);
          const targetY = baseFloorY - i * layerStep + dropOffset;
          const colors = paletteLayers[i % paletteLayers.length];
          const slabW = 240 - i * 10;
          return (
            <IsoBlock3D
              key={i}
              x={towerX}
              baseY={targetY}
              width={slabW}
              height={64}
              depth={44}
              topColor={colors.top}
              leftColor={colors.left}
              rightColor={colors.right}
              rimColor="#FFFFFF"
              opacity={clamp01(sp * 1.6)}
            />
          );
        })}

        {/* Vertical laser height gauge pole */}
        <line x1={515} y1={baseFloorY + 10} x2={515} y2={topReachedY - 20} stroke="#475569" strokeWidth={3} />
        <line x1={515} y1={baseFloorY + 10} x2={515} y2={currentLaserY} stroke="#38BDF8" strokeWidth={5} />
        {Array.from({ length: 8 }).map((_, idx) => {
          const ty = baseFloorY - idx * layerStep;
          return (
            <line
              key={idx}
              x1={504}
              y1={ty}
              x2={526}
              y2={ty}
              stroke={ty >= currentLaserY ? '#38BDF8' : '#64748B'}
              strokeWidth={2.5}
            />
          );
        })}
        {/* Horizontal laser pointer to the giant stat */}
        <line
          x1={towerX + 90}
          y1={currentLaserY}
          x2={550}
          y2={currentLaserY}
          stroke="#F59E0B"
          strokeWidth={3}
          strokeDasharray="8 6"
          opacity={laserProgress}
        />
        <circle cx={515} cy={currentLaserY} r={8} fill="#F59E0B" opacity={laserProgress} />
      </svg>

      {/* Right-Side Giant Stat Display & Supporting Points (strictly <= CONTENT_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          top: 340,
          left: 550,
          right: 52,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          gap: 14,
        }}
      >
        <div
          style={{
            opacity: clamp01(statP),
            transform: `scale(${interpolate(statP, [0, 1], [0.85, 1])})`,
            background: 'linear-gradient(155deg, rgba(30, 41, 59, 0.94), rgba(15, 23, 42, 0.96))',
            border: '2px solid rgba(56, 189, 248, 0.6)',
            borderRadius: 26,
            padding: '18px 22px',
            boxShadow: '0 22px 44px rgba(0,0,0,0.45)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 21,
              fontWeight: 700,
              color: '#7DD3FC',
              marginBottom: 4,
            }}
          >
            ระดับความสูงรวม
          </div>
          <FitText text={metric.big} baseSize={76} minSize={44} maxLines={1} color="#FDE68A" fontWeight={900} align="left" lineHeight={1.1} />
          {metric.unit ? (
            <div style={{ marginTop: 4 }}>
              <FitText text={metric.unit} baseSize={24} minSize={17} maxLines={2} lineHeight={1.25} color="#38BDF8" fontWeight={800} align="left" />
            </div>
          ) : null}
          <div style={{ marginTop: 8, borderTop: '1px solid rgba(148,163,184,0.22)', paddingTop: 8 }}>
            <FitText text={metric.label} baseSize={22} minSize={16} maxLines={3} lineHeight={1.28} color={pal.fg} fontWeight={600} align="left" />
          </div>
        </div>

        {/* Supporting callout stack (auto-height cards, all fit cleanly <= CONTENT_BOTTOM) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pts.slice(0, 3).map((pt, i) => {
            const p = stagger(i, localFrame, 7, 20, 14);
            return (
              <div
                key={i}
                style={{
                  opacity: p,
                  transform: `translateX(${interpolate(p, [0, 1], [28, 0])}px)`,
                  background: 'rgba(26, 32, 48, 0.88)',
                  borderLeft: `5px solid ${i === 0 ? '#F59E0B' : '#38BDF8'}`,
                  borderRadius: 14,
                  padding: '13px 16px',
                  minHeight: 74,
                  height: 'auto',
                  flexShrink: 0,
                }}
              >
                <FitText
                  text={pt}
                  baseSize={21}
                  minSize={16}
                  maxLines={3}
                  lineHeight={1.28}
                  color={pal.fg}
                  fontWeight={700}
                  align="left"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** look-16 Shot 4: side-by-side-giant — เทียบวัตถุเล็กกับวัตถุยักษ์ข้างกันให้เห็นความต่างชัดเจน */
const SideBySideGiantShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = paletteOf(tokens, SCALE_DEFAULTS);
  const t = sceneTexts(scene);
  const pair = extractComparePair(scene);
  const titleP = appear(localFrame, 2, 14);
  const smallSp = spring({ frame: Math.max(0, localFrame - 8), fps, config: { damping: 14, stiffness: 150 } });
  const giantSp = spring({ frame: Math.max(0, localFrame - 14), fps, config: { damping: 13, stiffness: 115 } });
  const arcP = appear(localFrame, 24, 16);

  const floorY = 1055;
  const smallH = Math.max(10, 118 * smallSp);
  const giantH = Math.max(14, 500 * giantSp);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <ScaleStudioBackdrop pal={pal} localFrame={localFrame} floorY={floorY} spotX={740} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 90,
          left: 64,
          right: 64,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [20, 0])}px)`,
        }}
      >
        <FitText text={t.title} baseSize={56} minSize={36} maxLines={2} color={pal.fg} fontWeight={800} />
      </div>

      {/* 3D Small vs Giant Monolith Comparison Stage */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Left small pedestal */}
        <ellipse cx={265} cy={floorY + 12} rx={120} ry={24} fill="#1E293B" stroke="#475569" strokeWidth={2} />
        {/* Right giant pedestal */}
        <ellipse cx={765} cy={floorY + 16} rx={210} ry={38} fill="#1E293B" stroke="#38BDF8" strokeWidth={2.5} />

        {/* Small 3D Object on Left */}
        <IsoBlock3D
          x={265}
          baseY={floorY + 4}
          width={110}
          height={smallH}
          depth={34}
          topColor="#E2E8F0"
          leftColor="#64748B"
          rightColor="#94A3B8"
          rimColor="#FFFFFF"
          opacity={clamp01(smallSp * 1.4)}
        />

        {/* Giant 3D Monolith on Right */}
        <IsoBlock3D
          x={765}
          baseY={floorY + 4}
          width={248}
          height={giantH}
          depth={66}
          topColor="#FEF3C7"
          leftColor="#0284C7"
          rightColor="#38BDF8"
          rimColor="#FFFFFF"
          opacity={clamp01(giantSp * 1.3)}
        />

        {/* Architectural horizontal ribs on the giant monolith */}
        {[0.25, 0.5, 0.75].map((frac, idx) => {
          const ry = floorY + 4 - giantH * frac;
          return (
            <polyline
              key={idx}
              points={`${765 - 124},${ry} ${765},${ry + 34} ${765 + 124},${ry}`}
              fill="none"
              stroke="#E0F2FE"
              strokeOpacity={0.38 * giantSp}
              strokeWidth={2}
            />
          );
        })}

        {/* Curved comparison arrow bridging small top -> giant top */}
        <g opacity={arcP}>
          <path
            d={`M 290 ${floorY - smallH - 42} Q 460 ${floorY - giantH - 70} 615 ${floorY - giantH + 22}`}
            fill="none"
            stroke="#F59E0B"
            strokeWidth={4}
            strokeDasharray="10 8"
          />
          <polygon
            points={`615,${floorY - giantH + 22} 596,${floorY - giantH + 10} 602,${floorY - giantH + 34}`}
            fill="#F59E0B"
          />
          {/* Floating VS / Ratio Pill */}
          <rect x={390} y={floorY - giantH + 8} width={144} height={52} rx={26} fill="#F59E0B" />
          <text
            x={462}
            y={floorY - giantH + 42}
            textAnchor="middle"
            fill="#0F172A"
            fontSize={26}
            fontWeight={900}
            fontFamily={THAI_FONT_FAMILY}
          >
            VS ต่างชัด
          </text>
        </g>

        {/* Floating Value Badges above each object */}
        <g opacity={appear(localFrame, 16, 12)}>
          <rect x={185} y={floorY - smallH - 102} width={160} height={46} rx={14} fill="#0F172A" stroke="#94A3B8" strokeWidth={2} />
          <text x={265} y={floorY - smallH - 71} textAnchor="middle" fill="#E2E8F0" fontSize={26} fontWeight={800} fontFamily={THAI_FONT_FAMILY}>
            {pair.leftVal.slice(0, 10)}
          </text>
        </g>
        <g opacity={appear(localFrame, 22, 12)}>
          <rect x={675} y={floorY - giantH - 106} width={180} height={52} rx={14} fill="#0F172A" stroke="#F59E0B" strokeWidth={2.5} />
          <text x={765} y={floorY - giantH - 71} textAnchor="middle" fill="#FDE68A" fontSize={30} fontWeight={900} fontFamily={THAI_FONT_FAMILY}>
            {pair.rightVal.slice(0, 10)}
          </text>
        </g>
      </svg>

      {/* Bottom Side-by-Side Comparison Cards (safely above CONTENT_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          top: 1110,
          left: 52,
          right: 52,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 20,
          alignItems: 'stretch',
        }}
      >
        <div
          style={{
            opacity: appear(localFrame, 14, 14),
            background: 'rgba(26, 32, 48, 0.90)',
            border: '1.8px solid #475569',
            borderRadius: 22,
            padding: '16px 20px',
            minHeight: 120,
            height: 'auto',
          }}
        >
          <FitText text={pair.leftTitle} baseSize={26} minSize={19} maxLines={2} lineHeight={1.28} color="#CBD5E1" fontWeight={800} align="left" />
          {pair.leftItems[0] && pair.leftItems[0] !== pair.leftTitle ? (
            <div style={{ marginTop: 8 }}>
              <FitText text={pair.leftItems[0]} baseSize={21} minSize={16} maxLines={3} lineHeight={1.28} color={pal.muted} fontWeight={500} align="left" />
            </div>
          ) : null}
        </div>

        <div
          style={{
            opacity: appear(localFrame, 20, 14),
            background: 'linear-gradient(150deg, rgba(14, 116, 144, 0.32), rgba(26, 32, 48, 0.94))',
            border: '2px solid #38BDF8',
            borderRadius: 22,
            padding: '16px 20px',
            minHeight: 120,
            height: 'auto',
            boxShadow: '0 14px 32px rgba(56, 189, 248, 0.16)',
          }}
        >
          <FitText text={pair.rightTitle} baseSize={26} minSize={19} maxLines={2} lineHeight={1.28} color="#FDE68A" fontWeight={800} align="left" />
          {pair.rightItems[0] && pair.rightItems[0] !== pair.rightTitle ? (
            <div style={{ marginTop: 8 }}>
              <FitText text={pair.rightItems[0]} baseSize={21} minSize={16} maxLines={3} lineHeight={1.28} color={pal.fg} fontWeight={600} align="left" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 2: look-17 — MILESTONE TROPHY (ถ้วยรางวัล)
// Championship Emerald & Brushed 3D Gold Award Stage
// ============================================================================

const TROPHY_DEFAULTS: ResolvedPaletteF = {
  bg: '#0E1A17',
  bg2: '#144234',
  surface: '#132721',
  fg: '#F8FAFC',
  muted: '#A7C4BA',
  accent: '#144234',
  accent2: '#09221B',
  border: '#2A594A',
};

const TrophyStageBackdrop: React.FC<{
  pal: ResolvedPaletteF;
  localFrame: number;
  spotX?: number;
  spotY?: number;
}> = ({ pal, localFrame, spotX = 540, spotY = 520 }) => {
  const pulse = 0.5 + 0.5 * Math.sin(localFrame * 0.06);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 840px 760px at ${spotX}px ${spotY}px, ${pal.accent} 0%, #0D2920 44%, ${pal.bg} 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="tr-beam-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FDE68A" stopOpacity={0.22 + pulse * 0.05} />
            <stop offset="55%" stopColor="#F59E0B" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#09221B" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Twin championship spotlights */}
        <polygon points="180,0 380,0 760,1520 320,1520" fill="url(#tr-beam-gold)" />
        <polygon points="700,0 900,0 760,1520 320,1520" fill="url(#tr-beam-gold)" />

        {/* Subtle golden bokeh sparkles */}
        {[
          [120, 260, 4],
          [940, 220, 5],
          [190, 540, 3.5],
          [890, 480, 4.5],
          [110, 920, 4],
          [960, 860, 3.5],
          [240, 1260, 4.5],
          [840, 1290, 4],
          [520, 290, 3.5],
          [710, 340, 3],
        ].map(([x, y, r], i) => {
          const tw = 0.3 + 0.7 * Math.abs(Math.sin(localFrame * 0.08 + i * 1.4));
          return <circle key={i} cx={x} cy={y} r={r} fill="#FDE68A" opacity={tw * 0.65} />;
        })}
      </svg>
    </div>
  );
};

const CONFETTI_SEEDS: ReadonlyArray<[number, number, number, number, string]> = [
  [120, 220, 18, 10, '#FDE68A'],
  [210, 150, 14, 22, '#34D399'],
  [320, 280, 20, 10, '#F59E0B'],
  [440, 190, 16, 16, '#FFFFFF'],
  [650, 170, 18, 10, '#FBBF24'],
  [770, 250, 15, 22, '#34D399'],
  [880, 160, 20, 12, '#FDE68A'],
  [960, 310, 14, 18, '#F59E0B'],
  [160, 460, 16, 10, '#FBBF24'],
  [910, 490, 18, 12, '#FFFFFF'],
  [260, 610, 14, 14, '#34D399'],
  [820, 630, 16, 10, '#FDE68A'],
];

/** look-17 Shot 1: trophy-podium — ถ้วยรางวัลทองคำ 3 มิติบนแท่นโพเดียมพร้อมพลุกระดาษและตัวเลขเป้าหมาย */
const TrophyPodiumShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = paletteOf(tokens, TROPHY_DEFAULTS);
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetric(scene, sceneIndex);
  const pts = extractShortPoints(scene, 2);

  const titleP = appear(localFrame, 2, 14);
  const podiumSp = spring({ frame: Math.max(0, localFrame - 4), fps, config: { damping: 14, stiffness: 135 } });
  const trophySp = spring({ frame: Math.max(0, localFrame - 10), fps, config: { damping: 12, stiffness: 125 } });
  const floatY = Math.sin(localFrame * 0.08) * 6;
  const shineX = interpolate(localFrame % 75, [0, 75], [-180, 260]);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <TrophyStageBackdrop pal={pal} localFrame={localFrame} spotX={540} spotY={660} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 72,
          left: 64,
          right: 64,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [20, 0])}px)`,
        }}
      >
        {t.badge ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <span
              style={{
                padding: '8px 24px',
                borderRadius: 999,
                background: 'rgba(245, 158, 11, 0.16)',
                border: '1.5px solid rgba(251, 191, 36, 0.65)',
                color: '#FDE68A',
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 22,
                fontWeight: 800,
              }}
            >
              🏆 {t.badge}
            </span>
          </div>
        ) : null}
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={2} color="#FFFFFF" fontWeight={800} />
      </div>

      {/* Giant Goal / Milestone Number Halo */}
      <div
        style={{
          position: 'absolute',
          top: 256,
          left: 80,
          right: 80,
          opacity: appear(localFrame, 12, 14),
          transform: `scale(${interpolate(appear(localFrame, 12, 14), [0, 1], [0.85, 1])})`,
          textShadow: '0 8px 32px rgba(245, 158, 11, 0.45)',
        }}
      >
        <FitText text={metric.big} baseSize={114} minSize={62} maxLines={1} color="#FDE68A" fontWeight={900} />
        {metric.unit ? (
          <FitText text={metric.unit} baseSize={30} minSize={20} maxLines={1} color="#6EE7B7" fontWeight={800} />
        ) : null}
      </div>

      {/* 3D Championship Trophy + Emerald Marble Podium + Falling Confetti */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="tp-gold-cup" x1="0" y1="0" x2="1" y2="0.8">
            <stop offset="0%" stopColor="#FEF3C7" />
            <stop offset="28%" stopColor="#FBBF24" />
            <stop offset="65%" stopColor="#D97706" />
            <stop offset="100%" stopColor="#78350F" />
          </linearGradient>
          <linearGradient id="tp-gold-rim" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#B45309" />
            <stop offset="45%" stopColor="#FEF3C7" />
            <stop offset="100%" stopColor="#92400E" />
          </linearGradient>
          <linearGradient id="tp-podium-top" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1E604B" />
            <stop offset="100%" stopColor="#0E3328" />
          </linearGradient>
          <linearGradient id="tp-podium-front" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#144234" />
            <stop offset="100%" stopColor="#071B15" />
          </linearGradient>
          <radialGradient id="tp-aura" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FDE68A" stopOpacity="0.42" />
            <stop offset="55%" stopColor="#F59E0B" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#0E1A17" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Golden radial aura behind trophy */}
        <circle cx={540} cy={715} r={280 * trophySp} fill="url(#tp-aura)" />

        {/* Falling 3D confetti ribbons */}
        {CONFETTI_SEEDS.map(([sx, sy, w, h, col], i) => {
          const y = (sy + localFrame * (3.2 + (i % 3) * 0.9)) % 1180;
          const x = sx + Math.sin(localFrame * 0.08 + i) * 26;
          const rot = localFrame * (3 + (i % 4)) + i * 35;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={3}
              fill={col}
              opacity={0.85 * appear(localFrame, 8, 12)}
              transform={`rotate(${rot} ${x + w / 2} ${y + h / 2})`}
            />
          );
        })}

        {/* Tiered 3D Emerald & Gold Podium */}
        <g transform={`translate(540, ${interpolate(podiumSp, [0, 1], [1260, 1015])})`} opacity={clamp01(podiumSp)}>
          {/* Floor shadow */}
          <ellipse cx={0} cy={175} rx={340} ry={46} fill="#040D0A" opacity={0.75} />
          {/* Lower wide step */}
          <polygon points="-300,72 300,72 330,156 -330,156" fill="#0A241C" stroke="#2A594A" strokeWidth={2} />
          <polygon points="-275,44 275,44 300,72 -300,72" fill="#185140" />
          {/* Main central podium block */}
          <rect x={-215} y={-24} width={430} height={106} rx={12} fill="url(#tp-podium-front)" stroke="#F59E0B" strokeWidth={2.5} />
          <polygon points="-192,-56 192,-56 215,-24 -215,-24" fill="url(#tp-podium-top)" stroke="#FDE68A" strokeOpacity={0.5} strokeWidth={1.8} />
          {/* Golden plaque on podium front */}
          <rect x={-148} y={6} width={296} height={54} rx={10} fill="url(#tp-gold-rim)" />
          <rect x={-142} y={11} width={284} height={44} rx={7} fill="#0F2C22" />
          <text
            x={0}
            y={41}
            textAnchor="middle"
            fill="#FDE68A"
            fontSize={24}
            fontWeight={800}
            fontFamily={THAI_FONT_FAMILY}
          >
            MILESTONE ACHIEVED
          </text>
        </g>

        {/* Sculpted 3D Golden Championship Trophy */}
        <g
          transform={`translate(540, ${765 + floatY}) scale(${trophySp})`}
          opacity={clamp01(trophySp)}
        >
          {/* Trophy base shadow on podium */}
          <ellipse cx={0} cy={205} rx={115} ry={22} fill="#040D0A" opacity={0.62} />

          {/* Left & Right 3D curved golden handles */}
          <path
            d="M -112,-145 C -215,-145 -215,-10 -100,15"
            fill="none"
            stroke="url(#tp-gold-cup)"
            strokeWidth={24}
            strokeLinecap="round"
          />
          <path
            d="M 112,-145 C 215,-145 215,-10 100,15"
            fill="none"
            stroke="url(#tp-gold-cup)"
            strokeWidth={24}
            strokeLinecap="round"
          />

          {/* Stem & Pedestal Foot */}
          <rect x={-26} y={35} width={52} height={95} rx={10} fill="url(#tp-gold-cup)" />
          <ellipse cx={0} cy={88} rx={44} ry={16} fill="url(#tp-gold-rim)" />
          <path d="M -88,162 C -78,125 78,125 88,162 L 106,192 L -106,192 Z" fill="url(#tp-gold-cup)" />
          <rect x={-114} y={184} width={228} height={22} rx={8} fill="url(#tp-gold-rim)" />

          {/* Main Cup Bowl */}
          <path
            d="M -132,-180 L 132,-180 C 128,-20 82,58 0,58 C -82,58 -128,-20 -132,-180 Z"
            fill="url(#tp-gold-cup)"
            stroke="#FEF3C7"
            strokeOpacity={0.55}
            strokeWidth={2.5}
          />
          {/* Top Rim Ellipse */}
          <ellipse cx={0} cy={-180} rx={132} ry={24} fill="#FEF3C7" stroke="#D97706" strokeWidth={4} />
          <ellipse cx={0} cy={-180} rx={114} ry={16} fill="#92400E" opacity={0.78} />

          {/* Moving specular highlight bar across cup */}
          <path
            d={`M ${shineX - 24},-168 L ${shineX + 18},-168 L ${shineX - 22},38 L ${shineX - 60},38 Z`}
            fill="#FFFFFF"
            opacity={0.22}
          />

          {/* Embossed 3D Star Crest on Cup Center */}
          <polygon
            points="0,-116 14,-82 50,-82 21,-60 32,-26 0,-46 -32,-26 -21,-60 -50,-82 -14,-82"
            fill="#FEF3C7"
            stroke="#B45309"
            strokeWidth={3}
          />
        </g>
      </svg>

      {/* Bottom Milestone Summary Strip (strictly <= CONTENT_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          top: 1192,
          left: 60,
          right: 60,
          minHeight: 108,
          height: 'auto',
          opacity: appear(localFrame, 18, 14),
          background: 'rgba(13, 39, 31, 0.90)',
          border: '1.8px solid rgba(251, 191, 36, 0.55)',
          borderRadius: 22,
          padding: '14px 24px',
          boxShadow: '0 16px 34px rgba(0,0,0,0.45)',
        }}
      >
        <FitText text={metric.label} baseSize={26} minSize={19} maxLines={2} lineHeight={1.28} color="#FFFFFF" fontWeight={700} />
        {pts[0] && pts[0] !== metric.label ? (
          <div style={{ marginTop: 6 }}>
            <FitText text={pts[0]} baseSize={21} minSize={16} maxLines={3} lineHeight={1.28} color="#A7F3D0" fontWeight={500} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** look-17 Shot 2: progress-mountain — ปีนยอดเขา 3 มิติผ่านธงเช็กพอยต์ทีละขั้นสู่ยอดเป้าหมาย */
const ProgressMountainShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = paletteOf(tokens, TROPHY_DEFAULTS);
  const t = sceneTexts(scene);
  const pts = extractShortPoints(scene, 4);
  const count = Math.max(3, Math.min(4, pts.length || 3));
  const defaults = ['จุดเริ่มต้นฐานเขา', 'ผ่านด่านแรก', 'เร่งสปีดสู่ยอด', 'พิชิตยอดเป้าหมาย'];

  const titleP = appear(localFrame, 2, 14);
  const pathProg = appear(localFrame, 8, 28);

  const checkpoints =
    count === 3
      ? [
          { x: 225, y: 1280, cardX: 300, cardY: 1215, labelSide: 'right' as const },
          { x: 515, y: 945, cardX: 590, cardY: 875, labelSide: 'right' as const },
          { x: 785, y: 545, cardX: 90, cardY: 485, labelSide: 'left' as const },
        ]
      : [
          { x: 190, y: 1295, cardX: 268, cardY: 1235, labelSide: 'right' as const },
          { x: 395, y: 1055, cardX: 475, cardY: 990, labelSide: 'right' as const },
          { x: 605, y: 800, cardX: 76, cardY: 735, labelSide: 'left' as const },
          { x: 805, y: 515, cardX: 76, cardY: 455, labelSide: 'left' as const },
        ];

  const trailD = checkpoints.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <TrophyStageBackdrop pal={pal} localFrame={localFrame} spotX={790} spotY={460} />

      {/* Title Header */}
      <div
        style={{
          position: 'absolute',
          top: 86,
          left: 64,
          right: 64,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [18, 0])}px)`,
        }}
      >
        {t.badge ? (
          <div style={{ marginBottom: 10 }}>
            <span
              style={{
                padding: '7px 20px',
                borderRadius: 999,
                background: 'rgba(16, 185, 129, 0.16)',
                border: '1.5px solid rgba(52, 211, 153, 0.55)',
                color: '#6EE7B7',
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              ⛰️ {t.badge}
            </span>
          </div>
        ) : null}
        <FitText text={t.title} baseSize={54} minSize={36} maxLines={2} color="#FFFFFF" fontWeight={800} align="left" />
      </div>

      {/* 3D Faceted Low-Poly Mountain + Golden Climbing Trail + Flags */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="pm-face-lit" x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#1E6A52" />
            <stop offset="100%" stopColor="#0D3529" />
          </linearGradient>
          <linearGradient id="pm-face-dark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0D3529" />
            <stop offset="100%" stopColor="#061712" />
          </linearGradient>
          <linearGradient id="pm-peak-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FEF3C7" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          <radialGradient id="pm-sun-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FDE68A" stopOpacity="0.48" />
            <stop offset="60%" stopColor="#F59E0B" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#0E1A17" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Sun halo behind summit */}
        <circle cx={805} cy={510} r={240} fill="url(#pm-sun-glow)" />

        {/* Background secondary mountain */}
        <polygon points="-40,1480 280,900 580,1480" fill="#0A241D" opacity={0.85} />
        <polygon points="280,900 410,1480 580,1480" fill="#071914" opacity={0.9} />

        {/* Main 3D faceted hero mountain */}
        <polygon points="40,1490 805,520 710,1490" fill="url(#pm-face-lit)" />
        <polygon points="805,520 1120,1490 710,1490" fill="url(#pm-face-dark)" />
        {/* Mid ridge bevel */}
        <polygon points="395,1085 805,520 660,1180" fill="#257B60" opacity={0.42} />
        {/* Golden sunlit snowcap on peak */}
        <polygon points="736,608 805,520 848,650 792,624" fill="url(#pm-peak-gold)" />
        <polygon points="805,520 886,668 848,650" fill="#D97706" />

        {/* Animated Golden Trail Climbing Up the Ridge */}
        <path
          d={trailD}
          fill="none"
          stroke="#FDE68A"
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="1400"
          strokeDashoffset={1400 * (1 - pathProg)}
        />

        {/* 3D Checkpoint Flags planting along the climb */}
        {checkpoints.map((cp, i) => {
          const sp = spring({
            frame: Math.max(0, localFrame - (8 + i * 8)),
            fps,
            config: { damping: 12, stiffness: 150 },
          });
          const isPeak = i === checkpoints.length - 1;
          const wave = Math.sin(localFrame * 0.14 + i * 1.2) * 6;
          const flagCol = isPeak ? '#F59E0B' : '#34D399';

          return (
            <g key={i} transform={`translate(${cp.x}, ${cp.y}) scale(${sp})`}>
              {/* Glowing node dot */}
              <circle cx={0} cy={0} r={isPeak ? 16 : 12} fill="#FDE68A" stroke="#09221B" strokeWidth={4} />
              {/* Flagpole */}
              <line x1={0} y1={0} x2={0} y2={isPeak ? -108 : -84} stroke="#FEF3C7" strokeWidth={5} strokeLinecap="round" />
              {/* Waving 3D pennant flag */}
              <path
                d={`M 2,${isPeak ? -106 : -82} Q ${36},${(isPeak ? -106 : -82) + wave} ${isPeak ? 74 : 60},${(isPeak ? -88 : -66) - wave * 0.6} L 2,${isPeak ? -64 : -48} Z`}
                fill={flagCol}
                stroke="#FFFFFF"
                strokeOpacity={0.5}
                strokeWidth={1.5}
              />
              {/* Step number inside flag */}
              <text
                x={22}
                y={isPeak ? -78 : -58}
                fill="#09221B"
                fontSize={20}
                fontWeight={900}
                fontFamily={THAI_FONT_FAMILY}
              >
                {isPeak ? '★' : i + 1}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Checkpoint Cards anchored to each flag (safely above SAFE_BOTTOM) */}
      {checkpoints.map((cp, i) => {
        const p = stagger(i, localFrame, 8, 12, 14);
        const isPeak = i === checkpoints.length - 1;
        const text = pts[i] || defaults[i];
        return (
          <div
            key={`cp-${i}`}
            style={{
              position: 'absolute',
              left: cp.cardX,
              top: cp.cardY,
              width: 440,
              opacity: p,
              transform: `translateX(${interpolate(p, [0, 1], [cp.labelSide === 'right' ? 28 : -28, 0])}px)`,
              background: isPeak ? 'linear-gradient(145deg, rgba(180, 83, 9, 0.42), rgba(13, 39, 31, 0.94))' : 'rgba(13, 39, 31, 0.90)',
              border: `2px solid ${isPeak ? '#FBBF24' : '#34D399'}`,
              borderRadius: 18,
              padding: '14px 20px',
              boxShadow: '0 14px 28px rgba(0,0,0,0.45)',
            }}
          >
            <div
              style={{
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 19,
                fontWeight: 800,
                color: isPeak ? '#FDE68A' : '#6EE7B7',
                marginBottom: 4,
              }}
            >
              {isPeak ? '🏆 ยอดเป้าหมาย' : `เช็กพอยต์ ${i + 1}`}
            </div>
            <FitText text={text} baseSize={22} minSize={16} maxLines={3} lineHeight={1.28} color="#FFFFFF" fontWeight={700} align="left" />
          </div>
        );
      })}
    </div>
  );
};

/** look-17 Shot 3: medal-wall — กำแพงเหรียญรางวัล 3 มิติแสดงทีละเหรียญตามประเด็นสำคัญ */
const MedalWallShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = paletteOf(tokens, TROPHY_DEFAULTS);
  const t = sceneTexts(scene);
  const pts = extractPoints(scene, 4);
  const count = Math.max(3, Math.min(4, pts.length || 3));
  const defaults = ['ความสำเร็จหลักข้อที่ 1', 'มาตรฐานระดับสูงข้อที่ 2', 'รางวัลแห่งความทุ่มเทข้อที่ 3', 'ก้าวต่อไปที่ยิ่งใหญ่'];

  const titleP = appear(localFrame, 2, 14);

  const medalsMeta = [
    { ribbon: '#10B981', rim: '#FDE68A', core: '#F59E0B', dark: '#92400E', rank: '01' },
    { ribbon: '#38BDF8', rim: '#F8FAFC', core: '#CBD5E1', dark: '#475569', rank: '02' },
    { ribbon: '#F59E0B', rim: '#FED7AA', core: '#EA580C', dark: '#7C2D12', rank: '03' },
    { ribbon: '#A855F7', rim: '#FDE68A', core: '#EAB308', dark: '#854D0E', rank: '04' },
  ];

  const positions =
    count === 3
      ? [
          { cx: 540, cy: 515, cardTop: 640, cardLeft: 170, cardW: 740 },
          { cx: 295, cy: 995, cardTop: 1120, cardLeft: 64, cardW: 455 },
          { cx: 785, cy: 995, cardTop: 1120, cardLeft: 560, cardW: 455 },
        ]
      : [
          { cx: 295, cy: 520, cardTop: 640, cardLeft: 64, cardW: 455 },
          { cx: 785, cy: 520, cardTop: 640, cardLeft: 560, cardW: 455 },
          { cx: 295, cy: 995, cardTop: 1120, cardLeft: 64, cardW: 455 },
          { cx: 785, cy: 995, cardTop: 1120, cardLeft: 560, cardW: 455 },
        ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <TrophyStageBackdrop pal={pal} localFrame={localFrame} spotX={540} spotY={780} />

      {/* Museum velvet display frame border */}
      <div
        style={{
          position: 'absolute',
          top: 54,
          left: 36,
          right: 36,
          height: CONTENT_BOTTOM - 54,
          border: '2px solid rgba(251, 191, 36, 0.32)',
          borderRadius: 34,
          background: 'rgba(8, 25, 20, 0.35)',
          pointerEvents: 'none',
        }}
      />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 86,
          left: 68,
          right: 68,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [18, 0])}px)`,
        }}
      >
        {t.badge ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <span
              style={{
                padding: '7px 22px',
                borderRadius: 999,
                background: 'rgba(245, 158, 11, 0.16)',
                border: '1.5px solid rgba(251, 191, 36, 0.55)',
                color: '#FDE68A',
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              🏅 {t.badge}
            </span>
          </div>
        ) : null}
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={2} color="#FFFFFF" fontWeight={800} />
      </div>

      {/* 3D Medals hanging from brass pegs on velvet display wall */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Horizontal brass display rails */}
        <line x1={96} y1={345} x2={984} y2={345} stroke="#D97706" strokeWidth={5} strokeLinecap="round" opacity={0.7} />
        <line x1={96} y1={820} x2={984} y2={820} stroke="#D97706" strokeWidth={5} strokeLinecap="round" opacity={0.7} />

        {positions.map((pos, i) => {
          const meta = medalsMeta[i % medalsMeta.length];
          const sp = spring({
            frame: Math.max(0, localFrame - (6 + i * 7)),
            fps,
            config: { damping: 11, stiffness: 135 },
          });
          const swingDeg = Math.sin(localFrame * 0.09 + i * 1.3) * 3.5 * (1 - clamp01(localFrame / 140) * 0.5);
          const pivotY = pos.cy - 175;
          const sheenPos = interpolate((localFrame + i * 18) % 80, [0, 80], [-110, 110]);

          return (
            <g
              key={i}
              transform={`translate(${pos.cx}, ${pivotY}) rotate(${swingDeg}) scale(${sp})`}
              opacity={clamp01(sp * 1.4)}
            >
              {/* Brass wall peg */}
              <circle cx={0} cy={0} r={11} fill="#FDE68A" stroke="#92400E" strokeWidth={3} />
              {/* V-shaped pleated silk ribbon */}
              <polygon points="-32,8 0,108 32,8 14,8 0,68 -14,8" fill={meta.ribbon} opacity={0.92} />
              <polygon points="-24,8 -10,8 0,64 -6,82" fill="#FFFFFF" opacity={0.18} />
              {/* Brass clasp ring */}
              <circle cx={0} cy={104} r={14} fill="none" stroke="#FDE68A" strokeWidth={5} />
              {/* Drop shadow on velvet wall */}
              <circle cx={8} cy={184} r={82} fill="#040D0A" opacity={0.55} />
              {/* 3D Medallion outer rim */}
              <circle cx={0} cy={176} r={82} fill={meta.dark} />
              <circle cx={0} cy={176} r={76} fill={meta.core} stroke={meta.rim} strokeWidth={4} />
              {/* Inner recessed coin ring */}
              <circle cx={0} cy={176} r={60} fill="none" stroke={meta.dark} strokeWidth={3} strokeDasharray="6 4" />
              {/* Specular sheen band */}
              <line
                x1={sheenPos - 26}
                y1={110}
                x2={sheenPos + 26}
                y2={242}
                stroke="#FFFFFF"
                strokeOpacity={0.28}
                strokeWidth={18}
              />
              {/* Star + Rank Number */}
              <polygon
                points="0,126 8,144 27,144 12,155 18,173 0,162 -18,173 -12,155 -27,144 -8,144"
                fill={meta.rim}
              />
              <text
                x={0}
                y={214}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize={30}
                fontWeight={900}
                fontFamily={THAI_FONT_FAMILY}
              >
                {meta.rank}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Engraved Brass Plaques beneath each Medal */}
      {positions.map((pos, i) => {
        const p = stagger(i, localFrame, 7, 14, 14);
        const text = pts[i] || defaults[i];
        return (
          <div
            key={`plaque-${i}`}
            style={{
              position: 'absolute',
              left: pos.cardLeft,
              top: pos.cardTop,
              width: pos.cardW,
              opacity: p,
              transform: `translateY(${interpolate(p, [0, 1], [16, 0])}px)`,
              background: 'linear-gradient(160deg, rgba(20, 66, 52, 0.92), rgba(9, 34, 27, 0.96))',
              border: '1.8px solid rgba(251, 191, 36, 0.6)',
              borderRadius: 20,
              padding: '14px 18px',
              boxShadow: '0 14px 26px rgba(0,0,0,0.42)',
            }}
          >
            <FitText text={text} baseSize={24} minSize={17} maxLines={4} lineHeight={1.28} color="#FFFFFF" fontWeight={700} />
          </div>
        );
      })}
    </div>
  );
};

/** look-17 Shot 4: celebration-burst — พลุและสายรุ้งทองระเบิดฉลองพร้อมข้อความสรุปความสำเร็จ */
const CelebrationBurstShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = paletteOf(tokens, TROPHY_DEFAULTS);
  const t = sceneTexts(scene);
  const heroPhrase = extractHighlightPhrase(scene);
  const metric = extractPrimaryMetric(scene, sceneIndex);
  const pts = extractShortPoints(scene, 2);

  const burstSp = spring({ frame: Math.max(0, localFrame - 4), fps, config: { damping: 11, stiffness: 120 } });
  const crestSp = spring({ frame: Math.max(0, localFrame - 8), fps, config: { damping: 13, stiffness: 135 } });
  const titleP = appear(localFrame, 12, 14);
  const subP = appear(localFrame, 20, 14);

  const cx = 540;
  const cy = 620;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <TrophyStageBackdrop pal={pal} localFrame={localFrame} spotX={cx} spotY={cy} />

      {/* Fireworks & Starburst Explosion SVG */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="cb-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FEF3C7" stopOpacity="0.68" />
            <stop offset="40%" stopColor="#F59E0B" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#09221B" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cb-crest-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FEF3C7" />
            <stop offset="45%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#92400E" />
          </linearGradient>
        </defs>

        {/* Central explosion glow */}
        <circle cx={cx} cy={cy} r={420 * burstSp} fill="url(#cb-core-glow)" />

        {/* Rotating radial victory rays */}
        <g transform={`translate(${cx}, ${cy}) rotate(${localFrame * 0.4}) scale(${burstSp})`} opacity={0.35}>
          {Array.from({ length: 16 }).map((_, i) => {
            const ang = (i * 360) / 16;
            return (
              <polygon
                key={i}
                points="0,0 -16,-480 16,-480"
                fill={i % 2 === 0 ? '#FDE68A' : '#34D399'}
                transform={`rotate(${ang})`}
              />
            );
          })}
        </g>

        {/* Three Fireworks Bursts exploding at staggered positions */}
        {[
          { fx: 210, fy: 310, r: 140, delay: 4, col: '#FDE68A' },
          { fx: 870, fy: 350, r: 155, delay: 10, col: '#34D399' },
          { fx: 540, fy: 240, r: 120, delay: 16, col: '#FBBF24' },
        ].map((fw, idx) => {
          const p = clamp01((localFrame - fw.delay) / 28);
          const fade = p < 0.7 ? 1 : interpolate(p, [0.7, 1], [1, 0.35]);
          return (
            <g key={idx} transform={`translate(${fw.fx}, ${fw.fy})`} opacity={p > 0 ? fade : 0}>
              {Array.from({ length: 12 }).map((_, k) => {
                const rad = (k * 30 * Math.PI) / 180;
                const inner = fw.r * 0.25 * p;
                const outer = fw.r * p;
                return (
                  <g key={k}>
                    <line
                      x1={Math.cos(rad) * inner}
                      y1={Math.sin(rad) * inner}
                      x2={Math.cos(rad) * outer}
                      y2={Math.sin(rad) * outer}
                      stroke={fw.col}
                      strokeWidth={4}
                      strokeLinecap="round"
                    />
                    <circle cx={Math.cos(rad) * outer} cy={Math.sin(rad) * outer} r={5} fill="#FFFFFF" />
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Floating 3D Golden Victory Shield / Star Crest */}
        <g transform={`translate(${cx}, ${cy - 40}) scale(${crestSp})`}>
          {/* Outer laurel ring */}
          <circle cx={0} cy={0} r={168} fill="none" stroke="#FDE68A" strokeWidth={4} strokeDasharray="16 10" opacity={0.75} />
          {/* 3D Shield Emblem */}
          <path
            d="M 0,-138 L 116,-92 L 100,44 C 86,104 0,146 0,146 C 0,146 -86,104 -100,44 L -116,-92 Z"
            fill="url(#cb-crest-gold)"
            stroke="#FEF3C7"
            strokeWidth={5}
          />
          <path
            d="M 0,-116 L 94,-78 L 80,36 C 68,84 0,120 0,120 C 0,120 -68,84 -80,36 L -94,-78 Z"
            fill="#0E3328"
          />
          {/* Inner 3D Star */}
          <polygon
            points="0,-78 18,-26 74,-26 28,8 46,62 0,28 -46,62 -28,8 -74,-26 -18,-26"
            fill="url(#cb-crest-gold)"
            stroke="#FEF3C7"
            strokeWidth={3}
          />
        </g>

        {/* Celebratory Confetti Shower */}
        {CONFETTI_SEEDS.map(([sx, sy, w, h, col], i) => {
          const y = (sy + localFrame * (4.1 + (i % 3))) % 1460;
          const x = sx + Math.cos(localFrame * 0.09 + i) * 30;
          const rot = localFrame * 5 + i * 40;
          return (
            <rect
              key={`c-${i}`}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={3}
              fill={col}
              opacity={0.88 * appear(localFrame, 6, 10)}
              transform={`rotate(${rot} ${x + w / 2} ${y + h / 2})`}
            />
          );
        })}
      </svg>

      {/* Top Badge */}
      {t.badge ? (
        <div
          style={{
            position: 'absolute',
            top: 96,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            opacity: appear(localFrame, 2, 12),
          }}
        >
          <span
            style={{
              padding: '9px 26px',
              borderRadius: 999,
              background: 'rgba(245, 158, 11, 0.22)',
              border: '2px solid #FBBF24',
              color: '#FEF3C7',
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 24,
              fontWeight: 800,
            }}
          >
            🎉 {t.badge}
          </span>
        </div>
      ) : null}

      {/* Hero Summary Card Below Crest (safely above CONTENT_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          top: 822,
          left: 60,
          right: 60,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div
          style={{
            width: '100%',
            opacity: titleP,
            transform: `translateY(${interpolate(titleP, [0, 1], [24, 0])}px)`,
            background: 'linear-gradient(155deg, rgba(20, 66, 52, 0.94), rgba(9, 34, 27, 0.96))',
            border: '2.5px solid #FBBF24',
            borderRadius: 28,
            padding: '24px 30px',
            boxShadow: '0 22px 48px rgba(0,0,0,0.52)',
          }}
        >
          <FitText text={t.title} baseSize={52} minSize={32} maxLines={2} lineHeight={1.28} color="#FEF3C7" fontWeight={900} />
          {heroPhrase && heroPhrase !== t.title ? (
            <div style={{ marginTop: 12 }}>
              <FitText text={heroPhrase} baseSize={32} minSize={20} maxLines={3} lineHeight={1.28} color="#FFFFFF" fontWeight={700} />
            </div>
          ) : null}
        </div>

        {/* Takeaway Strip / Stat Pill */}
        <div
          style={{
            width: '100%',
            opacity: subP,
            transform: `translateY(${interpolate(subP, [0, 1], [18, 0])}px)`,
            display: 'flex',
            justifyContent: 'center',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              maxWidth: '100%',
              padding: '12px 26px',
              borderRadius: 999,
              background: 'linear-gradient(90deg, #F59E0B, #FBBF24)',
              color: '#09221B',
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 26,
              fontWeight: 900,
              textAlign: 'center',
              boxShadow: '0 10px 24px rgba(245, 158, 11, 0.35)',
            }}
          >
            ★ {metric.big} {metric.unit}
          </div>
          {pts[0] && pts[0] !== heroPhrase && pts[0] !== t.title ? (
            <div
              style={{
                width: '100%',
                background: 'rgba(13, 39, 31, 0.85)',
                border: '1.5px solid rgba(52, 211, 153, 0.45)',
                borderRadius: 18,
                padding: '14px 24px',
              }}
            >
              <FitText text={pts[0]} baseSize={24} minSize={18} maxLines={3} lineHeight={1.28} color="#A7F3D0" fontWeight={600} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 3: look-18 — DONUT BREAKDOWN (โดนัทแจกแจง)
// High-Contrast 3D Obsidian & Jewel-Finance Data Studio
// ============================================================================

const DONUT_DEFAULTS: ResolvedPaletteF = {
  bg: '#131722',
  bg2: '#1E2436',
  surface: '#1A2030',
  fg: '#FFFFFF',
  muted: '#94A3B8',
  accent: '#FFFFFF',
  accent2: '#111418',
  border: '#2E3852',
};

const DONUT_SLICE_COLORS: ReadonlyArray<{ top: string; side: string; light: string; text: string }> = [
  { top: '#10B981', side: '#047857', light: '#6EE7B7', text: '#022C22' },
  { top: '#38BDF8', side: '#0369A1', light: '#BAE6FD', text: '#082F49' },
  { top: '#F59E0B', side: '#B45309', light: '#FDE68A', text: '#451A03' },
  { top: '#A855F7', side: '#6B21A8', light: '#E9D5FF', text: '#2E1065' },
  { top: '#F43F5E', side: '#BE123C', light: '#FECDD3', text: '#4C0519' },
];

const DonutStudioBackdrop: React.FC<{
  pal: ResolvedPaletteF;
  localFrame: number;
  glowX?: number;
  glowY?: number;
}> = ({ pal, localFrame, glowX = 540, glowY = 640 }) => {
  const drift = Math.sin(localFrame * 0.04) * 14;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 860px 760px at ${glowX + drift}px ${glowY}px, #242E47 0%, ${pal.bg2} 42%, ${pal.bg} 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Clean finance data-studio grid */}
        {Array.from({ length: 13 }).map((_, i) => (
          <line
            key={`dgv-${i}`}
            x1={i * 90}
            y1={0}
            x2={i * 90}
            y2={STAGE_H}
            stroke="#FFFFFF"
            strokeOpacity={0.045}
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: 20 }).map((_, i) => (
          <line
            key={`dgh-${i}`}
            x1={0}
            y1={i * 96}
            x2={STAGE_W}
            y2={i * 96}
            stroke="#FFFFFF"
            strokeOpacity={0.045}
            strokeWidth={1}
          />
        ))}
        {/* Subtle studio radial calibration rings */}
        <circle cx={glowX} cy={glowY} r={340} fill="none" stroke="#FFFFFF" strokeOpacity={0.05} strokeWidth={1.5} />
        <circle cx={glowX} cy={glowY} r={470} fill="none" stroke="#FFFFFF" strokeOpacity={0.035} strokeWidth={1} strokeDasharray="10 12" />
      </svg>
    </div>
  );
};

/** look-18 Shot 1: donut-build — กราฟโดนัท 3 มิติค่อยๆ วาดทีละชิ้นพร้อมป้ายเปอร์เซ็นต์ */
const DonutBuildShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = paletteOf(tokens, DONUT_DEFAULTS);
  const t = sceneTexts(scene);
  const slices = extractBreakdownShares(scene, 4);
  const metric = extractPrimaryMetric(scene, sceneIndex);

  const titleP = appear(localFrame, 2, 14);
  const centerSp = spring({ frame: Math.max(0, localFrame - 6), fps, config: { damping: 14, stiffness: 140 } });

  const cx = 540;
  const cy = 605;
  const outerR = 225;
  const innerR = 126;
  const depthY = 24;

  // Compute start/end angles for each slice
  let accDeg = 0;
  const geom = slices.map((sl, i) => {
    const startDeg = accDeg;
    const sweepDeg = (sl.pct / 100) * 360;
    accDeg += sweepDeg;
    return {
      ...sl,
      startDeg,
      sweepDeg,
      midDeg: startDeg + sweepDeg / 2,
      colors: DONUT_SLICE_COLORS[i % DONUT_SLICE_COLORS.length],
    };
  });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <DonutStudioBackdrop pal={pal} localFrame={localFrame} glowX={cx} glowY={cy} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 86,
          left: 64,
          right: 64,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [18, 0])}px)`,
        }}
      >
        {t.badge ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <span
              style={{
                padding: '7px 22px',
                borderRadius: 999,
                background: 'rgba(255, 255, 255, 0.10)',
                border: '1.5px solid rgba(255, 255, 255, 0.35)',
                color: '#FFFFFF',
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              🍩 {t.badge}
            </span>
          </div>
        ) : null}
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={2} color={pal.fg} fontWeight={800} />
      </div>

      {/* 3D Extruded Sweeping Donut Chart */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Floor cast shadow beneath 3D donut */}
        <ellipse cx={cx} cy={cy + outerR + 36} rx={240 * centerSp} ry={34 * centerSp} fill="#050811" opacity={0.62} />

        {/* Subtle empty track ring */}
        <circle cx={cx} cy={cy + depthY} r={(outerR + innerR) / 2} fill="none" stroke="#1E293B" strokeWidth={outerR - innerR} opacity={0.55} />
        <circle cx={cx} cy={cy} r={(outerR + innerR) / 2} fill="none" stroke="#26314A" strokeWidth={outerR - innerR} opacity={0.45} />

        {/* 3D Extruded Depth Skirt (drawn first underneath) */}
        {geom.map((g, i) => {
          const p = appear(localFrame, 6 + i * 9, 18);
          if (p <= 0.01) return null;
          const endDeg = g.startDeg + Math.max(2, (g.sweepDeg - 2.2) * p);
          return (
            <path
              key={`side-${i}`}
              d={donutArcPath(cx, cy + depthY, outerR, innerR, g.startDeg + 1, endDeg)}
              fill={g.colors.side}
            />
          );
        })}

        {/* 3D Top Glossy Donut Segments */}
        {geom.map((g, i) => {
          const p = appear(localFrame, 6 + i * 9, 18);
          if (p <= 0.01) return null;
          const endDeg = g.startDeg + Math.max(2, (g.sweepDeg - 2.2) * p);
          return (
            <g key={`top-${i}`}>
              <path
                d={donutArcPath(cx, cy, outerR, innerR, g.startDeg + 1, endDeg)}
                fill={g.colors.top}
                stroke="#0F172A"
                strokeWidth={2.5}
              />
              {/* Specular inner bevel arc */}
              <path
                d={donutArcPath(cx, cy, outerR - 8, outerR - 22, g.startDeg + 2, endDeg - 1)}
                fill="#FFFFFF"
                opacity={0.22}
              />
            </g>
          );
        })}

        {/* Outer % Floating Badges with leader ticks */}
        {geom.map((g, i) => {
          const p = appear(localFrame, 16 + i * 9, 12);
          if (p <= 0.01) return null;
          const anchor = polarToXY(cx, cy, outerR + 8, g.midDeg);
          const badgePos = polarToXY(cx, cy, outerR + 68, g.midDeg);
          const bx = Math.max(84, Math.min(STAGE_W - 84, badgePos.x));
          const by = Math.max(320, Math.min(970, badgePos.y));
          return (
            <g key={`pct-${i}`} opacity={p}>
              <line x1={anchor.x} y1={anchor.y} x2={bx} y2={by} stroke={g.colors.light} strokeWidth={2.5} />
              <circle cx={anchor.x} cy={anchor.y} r={5} fill={g.colors.light} />
              <rect x={bx - 52} y={by - 24} width={104} height={46} rx={14} fill="#0F172A" stroke={g.colors.top} strokeWidth={2.5} />
              <text
                x={bx}
                y={by + 8}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize={25}
                fontWeight={900}
                fontFamily={THAI_FONT_FAMILY}
              >
                {`${g.pct}%`}
              </text>
            </g>
          );
        })}

        {/* Center 3D Hub Plate */}
        <g transform={`translate(${cx}, ${cy}) scale(${centerSp})`}>
          <circle cx={0} cy={12} r={122} fill="#080B12" opacity={0.6} />
          <circle cx={0} cy={0} r={118} fill="#111827" stroke="#334155" strokeWidth={3} />
          <circle cx={0} cy={0} r={104} fill="none" stroke="#FFFFFF" strokeOpacity={0.14} strokeWidth={1.5} />
        </g>
      </svg>

      {/* Center Hub HTML Overlay (auto-wrapping Thai/English text without SVG truncation) */}
      <div
        style={{
          position: 'absolute',
          left: cx - 102,
          top: cy - 102,
          width: 204,
          height: 204,
          borderRadius: 999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '12px 14px',
          textAlign: 'center',
          transform: `scale(${centerSp})`,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 19,
            fontWeight: 700,
            color: '#94A3B8',
            lineHeight: 1.2,
          }}
        >
          สัดส่วนรวม
        </div>
        <div style={{ width: '100%', marginTop: 2 }}>
          <FitText
            text={scene.stat?.value ? String(scene.stat.value) : '100%'}
            baseSize={42}
            minSize={26}
            maxLines={1}
            lineHeight={1.1}
            color="#FFFFFF"
            fontWeight={900}
          />
        </div>
        <div style={{ width: '100%', marginTop: 4 }}>
          <FitText
            text={metric.unit || `${slices.length} หมวดหมู่`}
            baseSize={17}
            minSize={13}
            maxLines={2}
            lineHeight={1.22}
            color="#34D399"
            fontWeight={700}
          />
        </div>
      </div>

      {/* Breakdown Legend Cards (safely above CONTENT_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          top: 948,
          left: 52,
          right: 52,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          alignItems: 'stretch',
        }}
      >
        {geom.map((g, i) => {
          const p = stagger(i, localFrame, 6, 18, 14);
          return (
            <div
              key={`leg-${i}`}
              style={{
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [18, 0])}px)`,
                background: 'rgba(26, 32, 48, 0.92)',
                border: `1.8px solid ${g.colors.top}`,
                borderRadius: 20,
                padding: '12px 16px',
                boxShadow: '0 12px 26px rgba(0,0,0,0.38)',
                minWidth: 0,
                minHeight: 120,
                height: 'auto',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 5, background: g.colors.top }} />
                    <span style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 23, fontWeight: 900, color: g.colors.light }}>
                      {g.pct}%
                    </span>
                  </div>
                  {g.rawNumber ? (
                    <span style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 18, fontWeight: 700, color: pal.muted }}>
                      {g.rawNumber}
                    </span>
                  ) : null}
                </div>
                <FitText text={g.label} baseSize={21} minSize={16} maxLines={3} lineHeight={1.28} color="#FFFFFF" fontWeight={700} align="left" />
              </div>
              {/* Mini animated share bar */}
              <div style={{ marginTop: 8, height: 7, borderRadius: 99, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                <div style={{ width: `${g.pct * p}%`, height: '100%', background: g.colors.top, borderRadius: 99 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-18 Shot 2: exploded-donut — ดึงชิ้นส่วนโดนัท 3 มิติชิ้นหลักออกมาซูมขยายพร้อมคำอธิบาย */
const ExplodedDonutShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = paletteOf(tokens, DONUT_DEFAULTS);
  const t = sceneTexts(scene);
  const slices = extractBreakdownShares(scene, 4);

  // Pick largest slice as the hero exploded slice
  let heroIdx = 0;
  for (let i = 1; i < slices.length; i++) {
    if (slices[i].pct > slices[heroIdx].pct) heroIdx = i;
  }

  const titleP = appear(localFrame, 2, 14);
  const pullSp = spring({ frame: Math.max(0, localFrame - 12), fps, config: { damping: 12, stiffness: 125 } });
  const cardP = appear(localFrame, 18, 14);

  const cx = 540;
  const cy = 572;
  const outerR = 210;
  const innerR = 112;
  const depthY = 24;

  // Rotate slices so hero slice centers cleanly around 155 deg (lower-right / bottom spotlight)
  const heroSweep = (slices[heroIdx].pct / 100) * 360;
  let accDeg = 180 - heroSweep / 2;
  const ordered = [
    { ...slices[heroIdx], origIdx: heroIdx, isHero: true },
    ...slices.filter((_, i) => i !== heroIdx).map((s, idx) => ({ ...s, origIdx: idx >= heroIdx ? idx + 1 : idx, isHero: false })),
  ];

  const geom = ordered.map((sl, i) => {
    const startDeg = accDeg;
    const sweepDeg = (sl.pct / 100) * 360;
    accDeg += sweepDeg;
    return {
      ...sl,
      startDeg,
      sweepDeg,
      midDeg: startDeg + sweepDeg / 2,
      colors: DONUT_SLICE_COLORS[i % DONUT_SLICE_COLORS.length],
    };
  });

  const hero = geom[0];
  const pullDist = 44 * pullSp;
  const heroRad = ((hero.midDeg - 90) * Math.PI) / 180;
  const heroDx = Math.cos(heroRad) * pullDist;
  const heroDy = Math.sin(heroRad) * pullDist;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <DonutStudioBackdrop pal={pal} localFrame={localFrame} glowX={cx} glowY={cy + 30} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 84,
          left: 64,
          right: 64,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [18, 0])}px)`,
        }}
      >
        {t.badge ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <span
              style={{
                padding: '7px 22px',
                borderRadius: 999,
                background: 'rgba(16, 185, 129, 0.16)',
                border: '1.5px solid rgba(52, 211, 153, 0.55)',
                color: '#6EE7B7',
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 22,
                fontWeight: 800,
              }}
            >
              🔎 {t.badge}
            </span>
          </div>
        ) : null}
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={2} color="#FFFFFF" fontWeight={800} />
      </div>

      {/* 3D Donut with Hero Exploded Slice */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="ed-hero-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={hero.colors.top} stopOpacity="0.42" />
            <stop offset="100%" stopColor="#131722" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Non-hero muted/secondary slices */}
        {geom.slice(1).map((g, idx) => (
          <g key={`rest-${idx}`} opacity={0.78}>
            <path
              d={donutArcPath(cx, cy + depthY, outerR, innerR, g.startDeg + 1.5, g.startDeg + g.sweepDeg - 1.5)}
              fill={g.colors.side}
              opacity={0.75}
            />
            <path
              d={donutArcPath(cx, cy, outerR, innerR, g.startDeg + 1.5, g.startDeg + g.sweepDeg - 1.5)}
              fill={g.colors.top}
              stroke="#0F172A"
              strokeWidth={2.5}
              opacity={0.72}
            />
          </g>
        ))}

        {/* Spotlight Halo behind Exploded Slice */}
        <circle cx={cx + heroDx} cy={cy + heroDy + 120} r={220 * pullSp} fill="url(#ed-hero-glow)" />

        {/* Exploded Hero 3D Slice pulling outward */}
        <g transform={`translate(${heroDx}, ${heroDy})`}>
          {/* Deep 3D extruded wall */}
          <path
            d={donutArcPath(cx, cy + depthY + 8, outerR + 12, innerR - 6, hero.startDeg, hero.startDeg + hero.sweepDeg)}
            fill={hero.colors.side}
          />
          {/* Top glowing wedge */}
          <path
            d={donutArcPath(cx, cy, outerR + 12, innerR - 6, hero.startDeg, hero.startDeg + hero.sweepDeg)}
            fill={hero.colors.top}
            stroke="#FFFFFF"
            strokeWidth={3.5}
          />
          {/* Specular highlight band */}
          <path
            d={donutArcPath(cx, cy, outerR + 2, outerR - 18, hero.startDeg + 3, hero.startDeg + hero.sweepDeg - 3)}
            fill="#FFFFFF"
            opacity={0.32}
          />
          {/* Percentage label floating on the exploded wedge */}
          {(() => {
            const p = polarToXY(cx, cy, (outerR + innerR) / 2 + 4, hero.midDeg);
            return (
              <text
                x={p.x}
                y={p.y + 12}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize={40}
                fontWeight={900}
                fontFamily={THAI_FONT_FAMILY}
              >
                {`${hero.pct}%`}
              </text>
            );
          })()}
        </g>

        {/* Connector beam from exploded wedge down to Zoom Explanation Card */}
        <g opacity={cardP}>
          <line
            x1={cx + heroDx}
            y1={cy + heroDy + outerR + 36}
            x2={cx}
            y2={900}
            stroke={hero.colors.light}
            strokeWidth={3.5}
            strokeDasharray="8 6"
          />
          <circle cx={cx} cy={900} r={8} fill={hero.colors.light} />
        </g>
      </svg>

      {/* Featured Zoom Inspection Card + Secondary Slice Chips (above CONTENT_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          top: 902,
          left: 52,
          right: 52,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            opacity: cardP,
            transform: `translateY(${interpolate(cardP, [0, 1], [24, 0])}px)`,
            background: 'linear-gradient(155deg, rgba(16, 185, 129, 0.22), rgba(20, 26, 40, 0.96))',
            border: `2.5px solid ${hero.colors.top}`,
            borderRadius: 24,
            padding: '16px 24px',
            boxShadow: '0 20px 44px rgba(0,0,0,0.48)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span
              style={{
                padding: '6px 18px',
                borderRadius: 999,
                background: hero.colors.top,
                color: hero.colors.text,
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 21,
                fontWeight: 900,
              }}
            >
              ก้อนหลัก • {hero.pct}%
            </span>
            {hero.rawNumber ? (
              <span style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 23, fontWeight: 800, color: hero.colors.light }}>
                {hero.rawNumber}
              </span>
            ) : null}
          </div>
          <FitText text={hero.label} baseSize={32} minSize={21} maxLines={3} lineHeight={1.28} color="#FFFFFF" fontWeight={800} align="left" />
          {t.subtitle && t.subtitle !== hero.label ? (
            <div style={{ marginTop: 8 }}>
              <FitText text={t.subtitle} baseSize={22} minSize={17} maxLines={2} lineHeight={1.28} color="#CBD5E1" fontWeight={500} align="left" />
            </div>
          ) : null}
        </div>

        {/* Remaining slices compact comparison row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.max(2, geom.length - 1)}, minmax(0, 1fr))`,
            gap: 14,
            alignItems: 'stretch',
          }}
        >
          {geom.slice(1).map((g, i) => {
            const p = stagger(i, localFrame, 6, 22, 12);
            return (
              <div
                key={`chip-${i}`}
                style={{
                  opacity: p,
                  background: 'rgba(26, 32, 48, 0.90)',
                  border: `1.5px solid ${g.colors.top}`,
                  borderRadius: 18,
                  padding: '14px 18px',
                  minHeight: 136,
                  height: 'auto',
                  minWidth: 0,
                }}
              >
                <div style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 24, fontWeight: 900, color: g.colors.light, marginBottom: 4 }}>
                  {g.pct}%
                </div>
                <FitText text={g.label} baseSize={20} minSize={16} maxLines={4} lineHeight={1.28} color="#E2E8F0" fontWeight={600} align="left" />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** look-18 Shot 3: coin-jars — โหลเหรียญ 3 มิติแยกสัดส่วนงบประมาณตามหมวดหมู่ */
const CoinJarsShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = paletteOf(tokens, DONUT_DEFAULTS);
  const t = sceneTexts(scene);
  const slices = extractBreakdownShares(scene, 3);
  const jarCount = Math.min(3, slices.length);
  const jars = slices.slice(0, jarCount);

  const titleP = appear(localFrame, 2, 14);
  const shelfY = 990;
  const jarPositions = jarCount === 3 ? [210, 540, 870] : [330, 750];
  const jarW = 220;
  const jarH = 370;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <DonutStudioBackdrop pal={pal} localFrame={localFrame} glowX={540} glowY={700} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 68,
          left: 64,
          right: 64,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [18, 0])}px)`,
        }}
      >
        {t.badge ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <span
              style={{
                padding: '6px 20px',
                borderRadius: 999,
                background: 'rgba(245, 158, 11, 0.16)',
                border: '1.5px solid rgba(251, 191, 36, 0.55)',
                color: '#FDE68A',
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 21,
                fontWeight: 800,
              }}
            >
              🪙 {t.badge}
            </span>
          </div>
        ) : null}
        <FitText text={t.title} baseSize={50} minSize={32} maxLines={2} color="#FFFFFF" fontWeight={800} />
        {t.subtitle ? (
          <div style={{ marginTop: 6 }}>
            <FitText text={t.subtitle} baseSize={24} minSize={18} maxLines={2} lineHeight={1.28} color={pal.muted} fontWeight={500} />
          </div>
        ) : null}
      </div>

      {/* 3D Glass Coin Jars on Studio Shelf */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="cj-glass" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
            <stop offset="22%" stopColor="#E2E8F0" stopOpacity="0.08" />
            <stop offset="78%" stopColor="#94A3B8" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.18" />
          </linearGradient>
          <linearGradient id="cj-lid" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#475569" />
            <stop offset="35%" stopColor="#CBD5E1" />
            <stop offset="70%" stopColor="#64748B" />
            <stop offset="100%" stopColor="#334155" />
          </linearGradient>
          <linearGradient id="cj-shelf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#334155" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>
        </defs>

        {/* 3D Floating Studio Shelf */}
        <polygon points={`46,${shelfY} 1034,${shelfY} 1054,${shelfY + 32} 26,${shelfY + 32}`} fill="#1E293B" stroke="#475569" strokeWidth={1.5} />
        <rect x={26} y={shelfY + 32} width={1028} height={26} rx={6} fill="url(#cj-shelf)" />

        {/* Each 3D Glass Jar with Stacked 3D Coins */}
        {jars.map((jar, i) => {
          const jx = jarPositions[i];
          const colors = DONUT_SLICE_COLORS[i % DONUT_SLICE_COLORS.length];
          const jarSp = spring({
            frame: Math.max(0, localFrame - (5 + i * 7)),
            fps,
            config: { damping: 14, stiffness: 135 },
          });
          const coinCount = Math.max(3, Math.round((jar.pct / 100) * 16));
          const jarTopY = shelfY - jarH;

          return (
            <g key={i} transform={`translate(${jx}, 0)`} opacity={clamp01(jarSp * 1.4)}>
              {/* Shadow on shelf */}
              <ellipse cx={0} cy={shelfY + 4} rx={jarW * 0.52} ry={18} fill="#050811" opacity={0.62} />

              {/* Metallic screw lid */}
              <rect x={-78} y={jarTopY - 34} width={156} height={36} rx={10} fill="url(#cj-lid)" stroke="#E2E8F0" strokeOpacity={0.5} strokeWidth={1.5} />
              <line x1={-70} y1={jarTopY - 22} x2={70} y2={jarTopY - 22} stroke="#1E293B" strokeOpacity={0.45} strokeWidth={2} />
              <line x1={-70} y1={jarTopY - 10} x2={70} y2={jarTopY - 10} stroke="#1E293B" strokeOpacity={0.45} strokeWidth={2} />

              {/* Jar Glass Body Back */}
              <rect
                x={-jarW / 2}
                y={jarTopY}
                width={jarW}
                height={jarH}
                rx={36}
                fill="rgba(15, 23, 42, 0.52)"
                stroke="rgba(226, 232, 240, 0.42)"
                strokeWidth={3}
              />

              {/* Stacked 3D Metallic Coins rising inside the jar */}
              {Array.from({ length: coinCount }).map((_, cIdx) => {
                const cSp = spring({
                  frame: Math.max(0, localFrame - (12 + i * 6 + cIdx * 1.6)),
                  fps,
                  config: { damping: 14, stiffness: 180 },
                });
                const cyPos = shelfY - 26 - cIdx * 18 - interpolate(cSp, [0, 1], [120, 0]);
                const wobbleX = ((cIdx * 7 + i * 11) % 13) - 6;
                return (
                  <g key={cIdx} opacity={clamp01(cSp * 1.6)}>
                    {/* Coin 3D ridged edge */}
                    <rect
                      x={wobbleX - 76}
                      y={cyPos - 4}
                      width={152}
                      height={14}
                      rx={6}
                      fill={colors.side}
                    />
                    {/* Coin glossy elliptical top */}
                    <ellipse
                      cx={wobbleX}
                      cy={cyPos - 4}
                      rx={76}
                      ry={14}
                      fill={colors.top}
                      stroke={colors.light}
                      strokeWidth={1.6}
                    />
                  </g>
                );
              })}

              {/* Front Glass Specular Overlay */}
              <rect x={-jarW / 2} y={jarTopY} width={jarW} height={jarH} rx={36} fill="url(#cj-glass)" />
              <rect x={-jarW / 2 + 18} y={jarTopY + 28} width={16} height={jarH - 60} rx={8} fill="#FFFFFF" opacity={0.22} />

              {/* Floating % Badge above Jar Lid */}
              <g opacity={appear(localFrame, 14 + i * 7, 12)}>
                <rect
                  x={-72}
                  y={jarTopY - 108}
                  width={144}
                  height={56}
                  rx={18}
                  fill="#0F172A"
                  stroke={colors.top}
                  strokeWidth={3}
                />
                <text
                  x={0}
                  y={jarTopY - 71}
                  textAnchor="middle"
                  fill={colors.light}
                  fontSize={34}
                  fontWeight={900}
                  fontFamily={THAI_FONT_FAMILY}
                >
                  {`${jar.pct}%`}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      {/* Jar Category Labels below Shelf (strictly <= CONTENT_BOTTOM, no clipping) */}
      <div
        style={{
          position: 'absolute',
          top: shelfY + 72,
          left: 48,
          right: 48,
          display: 'grid',
          gridTemplateColumns: `repeat(${jarCount}, minmax(0, 1fr))`,
          gap: 14,
          alignItems: 'stretch',
        }}
      >
        {jars.map((jar, i) => {
          const colors = DONUT_SLICE_COLORS[i % DONUT_SLICE_COLORS.length];
          const p = stagger(i, localFrame, 7, 16, 14);
          return (
            <div
              key={`j-lbl-${i}`}
              style={{
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [16, 0])}px)`,
                background: 'rgba(26, 32, 48, 0.92)',
                borderTop: `5px solid ${colors.top}`,
                borderRadius: 18,
                padding: '14px 15px',
                boxShadow: '0 12px 24px rgba(0,0,0,0.4)',
                minWidth: 0,
                minHeight: 152,
                height: 'auto',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <FitText
                text={jar.label}
                baseSize={19}
                minSize={15}
                maxLines={4}
                lineHeight={1.28}
                color="#FFFFFF"
                fontWeight={800}
              />
              {jar.rawNumber ? (
                <div style={{ flexShrink: 0 }}>
                  <FitText text={jar.rawNumber} baseSize={19} minSize={15} maxLines={1} color={colors.light} fontWeight={700} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-18 Shot 4: budget-stack-bar — แท่งสัดส่วน 100% แบบ 3 มิติเปรียบเทียบสองกลุ่ม */
const BudgetStackBarShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = paletteOf(tokens, DONUT_DEFAULTS);
  const t = sceneTexts(scene);
  const pair = extractComparePair(scene);
  const rightSlices = extractBreakdownShares(scene, 4);

  // Build contrasting Group A (left) shares vs Group B (right) shares summing to 100%
  const leftBase = [52, 28, 12, 8].slice(0, rightSlices.length);
  const leftSum = leftBase.reduce((a, b) => a + b, 0);
  const leftPcts = leftBase.map((v, idx) =>
    idx === 0 ? v + (100 - leftSum) : v,
  );

  const titleP = appear(localFrame, 2, 14);
  const colTop = 395;
  const colH = 575;
  const colW = 210;
  const leftX = 165;
  const rightX = 705;

  // Compute segment vertical ranges for both 100% stacked bars
  let accL = colTop;
  let accR = colTop;
  const segments = rightSlices.map((sl, i) => {
    const lPct = leftPcts[i] ?? Math.round(100 / rightSlices.length);
    const rPct = sl.pct;
    const lH = (lPct / 100) * colH;
    const rH = (rPct / 100) * colH;
    const seg = {
      label: sl.label,
      lPct,
      rPct,
      lY: accL,
      lH,
      rY: accR,
      rH,
      colors: DONUT_SLICE_COLORS[i % DONUT_SLICE_COLORS.length],
    };
    accL += lH;
    accR += rH;
    return seg;
  });

  const barSp = spring({ frame: Math.max(0, localFrame - 6), fps, config: { damping: 14, stiffness: 120 } });
  const ribbonP = appear(localFrame, 16, 18);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <DonutStudioBackdrop pal={pal} localFrame={localFrame} glowX={540} glowY={760} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 82,
          left: 64,
          right: 64,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [18, 0])}px)`,
        }}
      >
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={2} color="#FFFFFF" fontWeight={800} />
      </div>

      {/* Group Column Titles above the two 100% stacked columns */}
      <div
        style={{
          position: 'absolute',
          top: 302,
          left: leftX - 40,
          width: colW + 80,
          opacity: appear(localFrame, 6, 12),
        }}
      >
        <FitText text={pair.leftTitle} baseSize={30} minSize={21} maxLines={2} color="#CBD5E1" fontWeight={800} />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 302,
          left: rightX - 40,
          width: colW + 80,
          opacity: appear(localFrame, 10, 12),
        }}
      >
        <FitText text={pair.rightTitle} baseSize={30} minSize={21} maxLines={2} color="#6EE7B7" fontWeight={900} />
      </div>

      {/* Dual 3D 100% Stacked Columns + Connecting Proportion Flow Ribbons */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Floor cast shadows */}
        <ellipse cx={leftX + colW / 2} cy={colTop + colH + 22} rx={126} ry={22} fill="#050811" opacity={0.6} />
        <ellipse cx={rightX + colW / 2} cy={colTop + colH + 22} rx={126} ry={22} fill="#050811" opacity={0.6} />

        {/* Semi-transparent Bezier Flow Ribbons bridging Left -> Right */}
        {segments.map((seg, i) => {
          const x1 = leftX + colW;
          const x2 = rightX;
          const mx = (x1 + x2) / 2;
          const d = [
            `M ${x1} ${seg.lY}`,
            `C ${mx} ${seg.lY}, ${mx} ${seg.rY}, ${x2} ${seg.rY}`,
            `L ${x2} ${seg.rY + seg.rH}`,
            `C ${mx} ${seg.rY + seg.rH}, ${mx} ${seg.lY + seg.lH}, ${x1} ${seg.lY + seg.lH}`,
            'Z',
          ].join(' ');
          return <path key={`rib-${i}`} d={d} fill={seg.colors.top} opacity={0.22 * ribbonP} />;
        })}

        {/* Left & Right 3D Stacked Bars */}
        {segments.map((seg, i) => {
          const lTopCur = colTop + colH - (colTop + colH - seg.lY) * barSp;
          const lHCur = seg.lH * barSp;
          const rTopCur = colTop + colH - (colTop + colH - seg.rY) * barSp;
          const rHCur = seg.rH * barSp;

          return (
            <g key={`bar-${i}`}>
              {/* Left Column 3D Block */}
              <rect
                x={leftX}
                y={lTopCur}
                width={colW}
                height={Math.max(2, lHCur - 3)}
                rx={10}
                fill={seg.colors.top}
                stroke="#0F172A"
                strokeWidth={2.5}
              />
              {/* 3D Side Shading + Specular Strip */}
              <rect x={leftX + colW - 32} y={lTopCur} width={32} height={Math.max(2, lHCur - 3)} rx={6} fill={seg.colors.side} opacity={0.65} />
              <rect x={leftX + 14} y={lTopCur + 6} width={14} height={Math.max(2, lHCur - 16)} rx={6} fill="#FFFFFF" opacity={0.26} />
              {lHCur > 36 ? (
                <text
                  x={leftX + colW / 2 - 8}
                  y={lTopCur + lHCur / 2 + 10}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize={30}
                  fontWeight={900}
                  fontFamily={THAI_FONT_FAMILY}
                >
                  {`${seg.lPct}%`}
                </text>
              ) : null}

              {/* Right Column 3D Block */}
              <rect
                x={rightX}
                y={rTopCur}
                width={colW}
                height={Math.max(2, rHCur - 3)}
                rx={10}
                fill={seg.colors.top}
                stroke="#FFFFFF"
                strokeOpacity={0.35}
                strokeWidth={2}
              />
              <rect x={rightX + colW - 32} y={rTopCur} width={32} height={Math.max(2, rHCur - 3)} rx={6} fill={seg.colors.side} opacity={0.65} />
              <rect x={rightX + 14} y={rTopCur + 6} width={14} height={Math.max(2, rHCur - 16)} rx={6} fill="#FFFFFF" opacity={0.28} />
              {rHCur > 36 ? (
                <text
                  x={rightX + colW / 2 - 8}
                  y={rTopCur + rHCur / 2 + 10}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize={30}
                  fontWeight={900}
                  fontFamily={THAI_FONT_FAMILY}
                >
                  {`${seg.rPct}%`}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* 100% Scale Markers on outer edges */}
        <text x={leftX - 24} y={colTop + 14} textAnchor="end" fill="#94A3B8" fontSize={20} fontWeight={700} fontFamily={THAI_FONT_FAMILY}>
          100%
        </text>
        <text x={leftX - 24} y={colTop + colH} textAnchor="end" fill="#94A3B8" fontSize={20} fontWeight={700} fontFamily={THAI_FONT_FAMILY}>
          0%
        </text>
      </svg>

      {/* Bottom Legend Grid explaining each colored segment (above CONTENT_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          top: 1030,
          left: 52,
          right: 52,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          alignItems: 'stretch',
        }}
      >
        {segments.map((seg, i) => {
          const p = stagger(i, localFrame, 6, 18, 14);
          const diff = seg.rPct - seg.lPct;
          const diffText = diff === 0 ? 'คงที่' : `${diff > 0 ? '+' : ''}${diff}%`;
          return (
            <div
              key={`bl-${i}`}
              style={{
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [14, 0])}px)`,
                background: 'rgba(26, 32, 48, 0.92)',
                border: `1.5px solid ${seg.colors.top}`,
                borderRadius: 18,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                minHeight: 108,
                height: 'auto',
              }}
            >
              <div style={{ width: 14, height: 48, borderRadius: 6, background: seg.colors.top, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText text={seg.label} baseSize={21} minSize={16} maxLines={3} lineHeight={1.28} color="#FFFFFF" fontWeight={700} align="left" />
                <div style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 18, fontWeight: 800, color: seg.colors.light, marginTop: 4 }}>
                  {seg.lPct}% → {seg.rPct}% ({diffText})
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// BATCH F EXPORT — 3 Styles × 4 Shots = 12 Distinct 3D Compositions
// ============================================================================

export const BATCH_F: StyleDirectorDef[] = [
  {
    styleId: 'look-16',
    shots: {
      'size-lineup': SizeLineupShot,
      'zoom-ladder': ZoomLadderShot,
      'stack-tower': StackTowerShot,
      'side-by-side-giant': SideBySideGiantShot,
    },
    shotLabels: {
      'size-lineup': 'เรียงวัตถุ 3 มิติจากเล็กไปใหญ่บนเส้นไม้บรรทัดพร้อมเงาคนเทียบสเกล',
      'zoom-ladder': 'ซูมไล่ระดับจากวัตถุเล็กไปใหญ่ทีละขั้นพร้อมวงเล็งขยายสเกล',
      'stack-tower': 'ซ้อนวัตถุ 3 มิติเป็นหอคอยเทียบความสูงกับตัวเลขสถิติยักษ์',
      'side-by-side-giant': 'เทียบวัตถุเล็กกับวัตถุยักษ์ข้างกันให้เห็นความต่างชัดเจน',
    },
    infer: (scene) => {
      const text = haystackOf(scene);
      if (scene.compare || F_COMPARE_RE.test(text)) {
        return 'side-by-side-giant';
      }
      if (F_STEP_RE.test(text) || (Array.isArray(scene.steps) && scene.steps.length > 0)) {
        return 'zoom-ladder';
      }
      if (scene.stat || /(?:เท่า|ซ้อน|สูง|กอง|ชั้น|รวม|\d+\s*(?:ล้าน|แสน|พัน|%|x))/i.test(text)) {
        return 'stack-tower';
      }
      if ((Array.isArray(scene.bullets) && scene.bullets.length >= 2) || /(?:ขนาด|สเกล|เรียง|ใหญ่|เล็ก)/i.test(text)) {
        return 'size-lineup';
      }
      return null;
    },
  },
  {
    styleId: 'look-17',
    shots: {
      'trophy-podium': TrophyPodiumShot,
      'progress-mountain': ProgressMountainShot,
      'medal-wall': MedalWallShot,
      'celebration-burst': CelebrationBurstShot,
    },
    shotLabels: {
      'trophy-podium': 'ถ้วยรางวัลทองคำ 3 มิติบนแท่นโพเดียมพร้อมพลุกระดาษและตัวเลขเป้าหมาย',
      'progress-mountain': 'ปีนยอดเขา 3 มิติผ่านธงเช็กพอยต์ทีละขั้นสู่ยอดเป้าหมาย',
      'medal-wall': 'กำแพงเหรียญรางวัล 3 มิติแสดงทีละเหรียญตามประเด็นสำคัญ',
      'celebration-burst': 'พลุและสายรุ้งทองระเบิดฉลองพร้อมข้อความสรุปความสำเร็จ',
    },
    infer: (scene) => {
      const text = haystackOf(scene);
      if (F_STEP_RE.test(text) || (Array.isArray(scene.steps) && scene.steps.length > 0)) {
        return 'progress-mountain';
      }
      if (F_SUMMARY_RE.test(text) || scene.quote?.text) {
        return 'celebration-burst';
      }
      if (scene.stat || /(?:เป้า|ยอด|ล้าน|อันดับ|สถิติ|รางวัล|\d+%)/i.test(text)) {
        return 'trophy-podium';
      }
      if (Array.isArray(scene.bullets) && scene.bullets.length >= 2) {
        return 'medal-wall';
      }
      return null;
    },
  },
  {
    styleId: 'look-18',
    shots: {
      'donut-build': DonutBuildShot,
      'exploded-donut': ExplodedDonutShot,
      'coin-jars': CoinJarsShot,
      'budget-stack-bar': BudgetStackBarShot,
    },
    shotLabels: {
      'donut-build': 'กราฟโดนัท 3 มิติค่อยๆ วาดทีละชิ้นพร้อมป้ายเปอร์เซ็นต์',
      'exploded-donut': 'ดึงชิ้นส่วนโดนัท 3 มิติชิ้นหลักออกมาซูมขยายพร้อมคำอธิบาย',
      'coin-jars': 'โหลเหรียญ 3 มิติแยกสัดส่วนงบประมาณตามหมวดหมู่',
      'budget-stack-bar': 'แท่งสัดส่วน 100% แบบ 3 มิติเปรียบเทียบสองกลุ่ม',
    },
    infer: (scene) => {
      const text = haystackOf(scene);
      if (scene.compare || F_COMPARE_RE.test(text)) {
        return 'budget-stack-bar';
      }
      if (F_BUDGET_RE.test(text)) {
        return 'coin-jars';
      }
      if (F_SUMMARY_RE.test(text) || /(?:ส่วนสำคัญ|ก้อนใหญ่|เจาะลึก|ส่วนใหญ่)/i.test(text)) {
        return 'exploded-donut';
      }
      if (scene.stat || /(?:%|เปอร์เซ็นต์|สัดส่วน|แบ่ง|แจกแจง|โครงสร้าง)/i.test(text)) {
        return 'donut-build';
      }
      return null;
    },
  },
];
