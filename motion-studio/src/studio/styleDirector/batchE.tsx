import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import type { StudioScene } from '../types';
import { FitText as BaseFitText, SAFE_BOTTOM, STAGE_H, STAGE_W, appear, sceneTexts, stagger } from './kit';
import type { FitTextProps } from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

const CONTENT_BOTTOM = SAFE_BOTTOM - 120; // 1420 — keep all cards/text strictly above subtitle zone (y≈1440–1600)

/**
 * Thai-safe proportional font-size wrapper around kit FitText.
 * Prevents kit's computeTitleSize() 40–44px floor from inflating small card/bullet text
 * when Thai sentences exceed 34 characters.
 */
function computeSafeFontSizeE(text: string, baseSize: number, minSize: number): number {
  const len = String(text || '').trim().length;
  let size = baseSize;
  if (baseSize >= 70) {
    if (len > 14) size = Math.round(baseSize * 0.56);
    else if (len > 9) size = Math.round(baseSize * 0.72);
    else if (len > 6) size = Math.round(baseSize * 0.86);
  } else if (baseSize >= 46) {
    if (len > 55) size = baseSize - 14;
    else if (len > 40) size = baseSize - 9;
    else if (len > 28) size = baseSize - 4;
  } else {
    if (len > 95) size = baseSize - 6;
    else if (len > 65) size = baseSize - 4;
    else if (len > 44) size = baseSize - 2;
    else if (len > 30) size = baseSize - 1;
  }
  return Math.max(minSize, Math.min(baseSize, size));
}

const FitText: React.FC<FitTextProps> = ({
  text,
  baseSize = 48,
  minSize = 24,
  lineHeight = 1.3,
  style,
  ...rest
}) => {
  const safeSize = computeSafeFontSizeE(text, baseSize, minSize);
  return (
    <BaseFitText
      text={text}
      baseSize={baseSize}
      minSize={minSize}
      lineHeight={Math.max(1.28, lineHeight)}
      style={{ fontSize: safeSize, ...style }}
      {...rest}
    />
  );
};

// ============================================================================
// SHARED CONTENT EXTRACTION HELPERS (Pure, Deterministic, Zero External Assets)
// ============================================================================

const STEP_RE = /(?:ขั้นตอน|สเต็ป|ลำดับ|วิธี|เส้นทาง|ไหล|วงจร|ส่งต่อ|จาก.+สู่|step)/i;
const COMPARE_RE = /(?:เทียบ|เปรียบ|ต่างกัน|vs|แบบเดิม|แบบใหม่|ซ้าย|ขวา|คุ้มกว่า|ดีกว่า)/i;
const SUMMARY_RE = /(?:สรุป|สำคัญ|ไฮไลต์|ประโยคจำ|จำไว้|หัวใจ|แก่น|บทเรียน)/i;
const PRICE_RE = /(?:ราคา|บาท|฿|ลด|ส่วนลด|โปร|ฟรี|คุ้ม|ประหยัด|เครดิต|เงินคืน|รางวัล|โบนัส)/i;
const SPEC_RE = /(?:สเปก|ขนาด|ความเร็ว|กำลัง|วัตต์|แรงม้า|มม\.|ซม\.|กม\.|อุณหภูมิ|แรงดัน|ตัวเลข|สถิติ)/i;

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
    scene.stat?.unit || '',
    scene.stat?.delta || '',
    scene.quote?.text || '',
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
    if (scene.stat.unit) out.push(`${scene.stat.value} ${scene.stat.unit}`.trim());
    if (scene.stat.label) out.push(scene.stat.label);
    if (scene.stat.delta) out.push(scene.stat.delta);
  } else if (scene.quote?.text) {
    out.push(scene.quote.text);
    if (scene.quote.author) out.push(scene.quote.author);
  } else if (t.subtitle) {
    out.push(t.subtitle);
  }

  if (out.length === 0 && t.title) out.push(t.title);
  return out.slice(0, max);
}

function extractPrimaryMetric(scene: StudioScene, sceneIndex: number): { big: string; unit: string; label: string } {
  const t = sceneTexts(scene);
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const prefix = String(scene.stat.prefix || '').trim();
    const suffix = String(scene.stat.suffix || '').trim();
    const raw = String(scene.stat.value).trim();
    const big = `${prefix}${raw}${suffix}`;
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
  if (hl && String(hl).trim().length <= 16) {
    return {
      big: String(hl).trim(),
      unit: t.badge || 'จุดเด่นหลัก',
      label: t.subtitle || t.title,
    };
  }
  return {
    big: String(sceneIndex + 1).padStart(2, '0'),
    unit: t.badge || 'ข้อเสนอพิเศษ',
    label: t.subtitle || t.title,
  };
}

function extractComparePair(scene: StudioScene): {
  leftTitle: string;
  leftItems: string[];
  rightTitle: string;
  rightItems: string[];
  winner: 'left' | 'right';
} {
  if (scene.compare) {
    return {
      leftTitle: scene.compare.leftTitle || 'แบบมาตรฐาน',
      leftItems: (scene.compare.leftItems || []).slice(0, 3),
      rightTitle: scene.compare.rightTitle || 'แบบพรีเมียม',
      rightItems: (scene.compare.rightItems || []).slice(0, 3),
      winner: scene.compare.winner || 'right',
    };
  }
  const pts = extractShortPoints(scene, 6);
  const mid = Math.max(1, Math.ceil(pts.length / 2));
  const leftItems = pts.slice(0, mid);
  const rightItems = pts.slice(mid);
  const t = sceneTexts(scene);
  return {
    leftTitle: 'แผนทั่วไป',
    leftItems: leftItems.length > 0 ? leftItems : [t.title || 'สิทธิประโยชน์พื้นฐาน'],
    rightTitle: 'แผนอัปเกรด',
    rightItems: rightItems.length > 0 ? rightItems : [t.subtitle || 'รับสิทธิพิเศษเหนือระดับ'],
    winner: 'right',
  };
}

/** Generate crisp SVG path for a mechanical spur gear centered at (0,0) */
function createGearPath(outerR: number, innerR: number, teeth: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const a1 = a0 + step * 0.16;
    const a2 = a0 + step * 0.34;
    const a3 = a0 + step * 0.56;
    const a4 = a0 + step * 0.74;
    const p0x = Math.cos(a0) * innerR;
    const p0y = Math.sin(a0) * innerR;
    const p1x = Math.cos(a1) * outerR;
    const p1y = Math.sin(a1) * outerR;
    const p2x = Math.cos(a2) * outerR;
    const p2y = Math.sin(a2) * outerR;
    const p3x = Math.cos(a3) * innerR;
    const p3y = Math.sin(a3) * innerR;
    const p4x = Math.cos(a4) * innerR;
    const p4y = Math.sin(a4) * innerR;
    pts.push(
      `${i === 0 ? 'M' : 'L'} ${p0x.toFixed(1)} ${p0y.toFixed(1)} ` +
        `L ${p1x.toFixed(1)} ${p1y.toFixed(1)} ` +
        `L ${p2x.toFixed(1)} ${p2y.toFixed(1)} ` +
        `L ${p3x.toFixed(1)} ${p3y.toFixed(1)} ` +
        `L ${p4x.toFixed(1)} ${p4y.toFixed(1)}`,
    );
  }
  return `${pts.join(' ')} Z`;
}

// ============================================================================
// STYLE 1: look-9 — BLUE GRID (ตารางสีน้ำเงิน / ภาพเขียนเทคนิค)
// ============================================================================

function getBlueGridPalette(tokens: any) {
  const p = tokens?.palette || {};
  return {
    bgDeep: '#071D3D',
    bgMid: p.accent2 || '#0B417D',
    bgLight: p.accent || '#1E5A9C',
    line: p.fg || '#F8FAFC',
    cyan: '#67E8F9',
    amber: '#FCD34D',
    muted: '#93C5FD',
    cardBg: 'rgba(7, 29, 61, 0.78)',
    border: 'rgba(186, 230, 253, 0.55)',
  };
}

/** Shared engineering blueprint grid, registration marks, and drafting frame */
const BlueprintBackdrop: React.FC<{
  tokens: any;
  localFrame: number;
  uid: string;
  dwgCode: string;
  scaleLabel?: string;
}> = ({ tokens, localFrame, uid, dwgCode, scaleLabel = 'SCALE 1:1' }) => {
  const pal = getBlueGridPalette(tokens);
  const scanY = ((localFrame * 3.2) % (CONTENT_BOTTOM + 200)) - 100;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at 50% 34%, ${pal.bgLight} 0%, ${pal.bgMid} 44%, ${pal.bgDeep} 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <pattern id={`bp-minor-${uid}`} width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(186,230,253,0.11)" strokeWidth="1" />
          </pattern>
          <pattern id={`bp-major-${uid}`} width="120" height="120" patternUnits="userSpaceOnUse">
            <rect width="120" height="120" fill={`url(#bp-minor-${uid})`} />
            <path d="M 120 0 L 0 0 0 120" fill="none" stroke="rgba(186,230,253,0.28)" strokeWidth="1.4" />
          </pattern>
          <linearGradient id={`bp-scan-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#67E8F9" stopOpacity="0" />
            <stop offset="50%" stopColor="#67E8F9" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#67E8F9" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid layers */}
        <rect width={STAGE_W} height={STAGE_H} fill={`url(#bp-major-${uid})`} />

        {/* Subtle drafting scanner sweep */}
        <rect x={0} y={scanY} width={STAGE_W} height={90} fill={`url(#bp-scan-${uid})`} />

        {/* Outer technical border above CONTENT_BOTTOM */}
        <rect
          x={32}
          y={44}
          width={STAGE_W - 64}
          height={CONTENT_BOTTOM - 64}
          fill="none"
          stroke="rgba(224,242,254,0.52)"
          strokeWidth={2}
        />
        <rect
          x={40}
          y={52}
          width={STAGE_W - 80}
          height={CONTENT_BOTTOM - 80}
          fill="none"
          stroke="rgba(224,242,254,0.22)"
          strokeWidth={1}
        />

        {/* Corner registration crosshairs */}
        {[
          [56, 68],
          [STAGE_W - 56, 68],
          [56, CONTENT_BOTTOM - 36],
          [STAGE_W - 56, CONTENT_BOTTOM - 36],
        ].map(([cx, cy], idx) => (
          <g key={idx} stroke={pal.cyan} strokeWidth={1.5} opacity={0.7}>
            <line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} />
            <line x1={cx} y1={cy - 10} x2={cx} y2={cy + 10} />
            <circle cx={cx} cy={cy} r={5} fill="none" />
          </g>
        ))}

        {/* Ruler ticks along left and right margins */}
        {Array.from({ length: 13 }).map((_, i) => {
          const y = 140 + i * 95;
          return (
            <g key={i} stroke="rgba(224,242,254,0.45)" strokeWidth={1.2}>
              <line x1={32} y1={y} x2={46} y2={y} />
              <line x1={STAGE_W - 46} y1={y} x2={STAGE_W - 32} y2={y} />
            </g>
          );
        })}

        {/* Top engineering metadata strip */}
        <text
          x={74}
          y={76}
          fill={pal.cyan}
          fontSize={16}
          fontWeight={700}
          fontFamily="monospace"
          letterSpacing={2}
        >
          {dwgCode}
        </text>
        <text
          x={STAGE_W - 74}
          y={76}
          textAnchor="end"
          fill="rgba(224,242,254,0.75)"
          fontSize={15}
          fontWeight={600}
          fontFamily="monospace"
          letterSpacing={1.5}
        >
          {scaleLabel} · UNIT: MM
        </text>
      </svg>
    </div>
  );
};

/** look-9 Shot 1: gear-mechanism — เฟืองกลไกหมุนประสานกันพร้อมป้ายชื่อแต่ละประเด็น */
const GearMechanismShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = getBlueGridPalette(tokens);
  const t = sceneTexts(scene);
  const points = extractShortPoints(scene, 4);
  const enter = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 130 } });

  // Interlocking gears: teeth counts chosen for realistic speed ratios
  // Gear A (big center-left): 16 teeth, R=158 -> angular speed = +1.0
  // Gear B (upper-right): 12 teeth, R=120 -> speed = -16/12 = -1.333
  // Gear C (lower-right): 10 teeth, R=102 -> speed = +16/10 = +1.6
  // Gear D (small top-left): 8 teeth, R=82 -> speed = -16/8 = -2.0
  const baseRot = localFrame * 0.9;
  const gears = [
    { cx: 390, cy: 600, outer: 148, inner: 124, teeth: 16, rot: baseRot, accent: pal.cyan, code: 'G-01' },
    { cx: 632, cy: 504, outer: 112, inner: 90, teeth: 12, rot: -baseRot * (16 / 12) + 14, accent: pal.line, code: 'G-02' },
    { cx: 626, cy: 740, outer: 98, inner: 78, teeth: 10, rot: baseRot * (16 / 10) + 8, accent: pal.amber, code: 'G-03' },
    { cx: 300, cy: 402, outer: 76, inner: 58, teeth: 8, rot: -baseRot * 2 + 22, accent: pal.muted, code: 'G-04' },
  ];

  // Flexible 2-column grid metrics (ends comfortably ≤ CONTENT_BOTTOM=1420)
  const gridTop = 900;
  const cardGap = 16;
  const cardMinH = points.length <= 2 ? 190 : 172;

  // Callout leader anchors aligned with the 2-column grid cells
  const labelSlots: Array<{ x: number; y: number; w: number; gx: number; gy: number }> = [
    { x: 64, y: gridTop, w: 468, gx: 390, gy: 600 },
    { x: 548, y: gridTop, w: 468, gx: 626, gy: 740 },
    { x: 64, y: gridTop + cardMinH + cardGap, w: 468, gx: 300, gy: 402 },
    { x: 548, y: gridTop + cardMinH + cardGap, w: 468, gx: 632, gy: 504 },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <BlueprintBackdrop
        tokens={tokens}
        localFrame={localFrame}
        uid="gear"
        dwgCode={`DWG-09A · MECH-${String(sceneIndex + 1).padStart(2, '0')}`}
        scaleLabel="TORQUE 1:1.6"
      />

      {/* Title Block Header */}
      <div
        style={{
          position: 'absolute',
          top: 98,
          left: 68,
          right: 68,
          opacity: appear(localFrame, 2, 14),
          transform: `translateY(${interpolate(appear(localFrame, 2, 14), [0, 1], [-18, 0])}px)`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
          <div
            style={{
              padding: '6px 16px',
              border: `1.5px solid ${pal.cyan}`,
              background: 'rgba(103, 232, 249, 0.14)',
              color: pal.cyan,
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            {t.badge || 'กลไกการทำงาน'}
          </div>
          <div style={{ flex: 1, height: 1.5, background: 'rgba(186,230,253,0.45)' }} />
          <div style={{ color: pal.muted, fontFamily: 'monospace', fontSize: 18 }}>RPM: 48.0</div>
        </div>
        <FitText text={t.title} baseSize={54} minSize={30} maxLines={2} color={pal.line} fontWeight={800} align="left" />
        {t.subtitle ? (
          <div style={{ marginTop: 8 }}>
            <FitText text={t.subtitle} baseSize={28} minSize={20} maxLines={2} color={pal.muted} fontWeight={500} align="left" />
          </div>
        ) : null}
      </div>

      {/* Mechanical Gear Assembly SVG */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Centerlines & dimension guides */}
        <line x1={120} y1={600} x2={960} y2={600} stroke="rgba(186,230,253,0.3)" strokeWidth={1.5} strokeDasharray="16 8 4 8" />
        <line x1={390} y1={300} x2={390} y2={860} stroke="rgba(186,230,253,0.3)" strokeWidth={1.5} strokeDasharray="16 8 4 8" />

        {/* Dimension arrow across main assembly */}
        <g opacity={appear(localFrame, 10, 14)} stroke={pal.cyan} strokeWidth={1.5}>
          <line x1={190} y1={314} x2={790} y2={314} />
          <line x1={190} y1={300} x2={190} y2={328} />
          <line x1={790} y1={300} x2={790} y2={328} />
          <polygon points="190,314 204,308 204,320" fill={pal.cyan} />
          <polygon points="790,314 776,308 776,320" fill={pal.cyan} />
          <rect x={424} y={300} width={132} height={28} fill={pal.bgDeep} stroke={pal.cyan} strokeWidth={1} />
          <text x={490} y={320} textAnchor="middle" fill={pal.cyan} fontSize={16} fontFamily="monospace" fontWeight={700}>
            Ø 600.0 mm
          </text>
        </g>

        {/* Leader lines from gears to bottom 2-column callout grid */}
        {points.map((_, idx) => {
          const slot = labelSlots[idx];
          if (!slot) return null;
          const p = stagger(idx, localFrame, 6, 10, 14);
          const isRow2 = idx >= 2;
          const anchorX = isRow2 ? (idx % 2 === 0 ? slot.x : slot.x + slot.w) : slot.x + slot.w * 0.5;
          const anchorY = isRow2 ? slot.y + cardMinH * 0.5 : slot.y;
          const elbowY = isRow2 ? anchorY : gridTop - 22;
          const midX = isRow2 ? (idx % 2 === 0 ? 48 : STAGE_W - 48) : slot.gx;
          return (
            <g key={`leader-${idx}`} opacity={p * 0.78}>
              <polyline
                points={
                  isRow2
                    ? `${slot.gx},${slot.gy} ${midX},${slot.gy} ${midX},${elbowY} ${anchorX},${anchorY}`
                    : `${slot.gx},${slot.gy} ${slot.gx},${elbowY} ${anchorX},${elbowY} ${anchorX},${anchorY}`
                }
                fill="none"
                stroke={pal.cyan}
                strokeWidth={1.8}
                strokeDasharray="6 5"
              />
              <circle cx={slot.gx} cy={slot.gy} r={6} fill={pal.amber} />
            </g>
          );
        })}

        {/* Gears */}
        {gears.map((g, i) => {
          const gSpring = spring({ frame: Math.max(0, localFrame - i * 4), fps, config: { damping: 14, stiffness: 130 } });
          const pathD = createGearPath(g.outer, g.inner, g.teeth);
          const pitchR = (g.outer + g.inner) * 0.5;
          const hubR = g.inner * 0.34;
          const spokeR = g.inner * 0.72;
          return (
            <g key={g.code} transform={`translate(${g.cx}, ${g.cy}) scale(${gSpring})`}>
              {/* Outer pitch circle */}
              <circle cx={0} cy={0} r={pitchR} fill="none" stroke="rgba(186,230,253,0.35)" strokeWidth={1.2} strokeDasharray="6 6" />
              {/* Rotating gear body */}
              <g transform={`rotate(${g.rot})`}>
                <path
                  d={pathD}
                  fill="rgba(14, 52, 106, 0.72)"
                  stroke={g.accent}
                  strokeWidth={2.8}
                  strokeLinejoin="round"
                />
                <circle cx={0} cy={0} r={spokeR} fill="none" stroke="rgba(224,242,254,0.45)" strokeWidth={1.8} />
                {/* 4 spokes / cutouts */}
                {[0, 90, 180, 270].map((deg) => (
                  <line
                    key={deg}
                    x1={Math.cos((deg * Math.PI) / 180) * hubR}
                    y1={Math.sin((deg * Math.PI) / 180) * hubR}
                    x2={Math.cos((deg * Math.PI) / 180) * spokeR}
                    y2={Math.sin((deg * Math.PI) / 180) * spokeR}
                    stroke={g.accent}
                    strokeWidth={3}
                  />
                ))}
                {/* Center hub & keyway */}
                <circle cx={0} cy={0} r={hubR} fill={pal.bgDeep} stroke={g.accent} strokeWidth={2.5} />
                <rect x={-5} y={-hubR + 2} width={10} height={10} fill={g.accent} />
              </g>
              {/* Static center tag */}
              <circle cx={0} cy={0} r={8} fill={pal.line} />
              <text
                x={0}
                y={-g.outer - 12}
                textAnchor="middle"
                fill={g.accent}
                fontSize={16}
                fontFamily="monospace"
                fontWeight={700}
                opacity={enter}
              >
                {g.code} ({g.teeth}T)
              </text>
            </g>
          );
        })}

        {/* Curved rotation direction arc around main gear */}
        <path
          d="M 215 512 A 188 188 0 0 1 330 416"
          fill="none"
          stroke={pal.amber}
          strokeWidth={2.5}
          strokeDasharray="10 6"
          opacity={0.85}
        />
        <polygon points="335,413 318,413 326,427" fill={pal.amber} opacity={0.85} />
      </svg>

      {/* Flexible 2-Column Grid of Part Callout Cards (strictly non-overlapping, ends ≤ CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: gridTop,
          left: 64,
          width: 952,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: cardGap,
        }}
      >
        {points.map((pt, idx) => {
          const p = stagger(idx, localFrame, 6, 10, 14);
          const code = gears[idx]?.code || `G-0${idx + 1}`;
          return (
            <div
              key={idx}
              style={{
                minHeight: cardMinH,
                padding: '14px 18px',
                background: pal.cardBg,
                border: `1.8px solid ${idx === 0 ? pal.cyan : pal.border}`,
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                display: 'flex',
                flexDirection: 'column',
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [18, 0])}px)`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
                <span style={{ color: pal.cyan, fontFamily: 'monospace', fontSize: 18, fontWeight: 700 }}>
                  [{code}] PART 0{idx + 1}
                </span>
                <span style={{ width: 10, height: 10, background: idx === 2 ? pal.amber : pal.cyan, display: 'inline-block' }} />
              </div>
              <FitText
                text={pt}
                baseSize={21}
                minSize={16}
                maxLines={4}
                lineHeight={1.28}
                color={pal.line}
                fontWeight={700}
                align="left"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-9 Shot 2: cutaway — ภาพตัดขวางกลไกพร้อมลายแรเงาและลูกศรชี้ส่วนประกอบ */
const CutawayShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = getBlueGridPalette(tokens);
  const t = sceneTexts(scene);
  const points = extractPoints(scene, 4);
  const reveal = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 120 } });
  const pistonOffset = Math.sin(localFrame * 0.14) * 34;
  const pulse = 0.6 + 0.4 * Math.sin(localFrame * 0.18);

  // 4 callout targets inside the cutaway machine housing (flexible card height, ends ≤ CONTENT_BOTTOM=1420)
  const calloutTargets = [
    { tx: 340, ty: 530, bx: 510, by: 390, label: 'SEC-A' },
    { tx: 385, ty: 690, bx: 510, by: 625, label: 'SEC-B' },
    { tx: 340, ty: 850, bx: 510, by: 860, label: 'SEC-C' },
    { tx: 290, ty: 1015, bx: 510, by: 1095, label: 'SEC-D' },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <BlueprintBackdrop
        tokens={tokens}
        localFrame={localFrame}
        uid="cutaway"
        dwgCode={`DWG-09B · SECTION A-A #${String(sceneIndex + 1).padStart(2, '0')}`}
        scaleLabel="CUTAWAY 2:1"
      />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 68,
          right: 68,
          opacity: appear(localFrame, 2, 14),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span
            style={{
              padding: '5px 14px',
              background: 'rgba(252, 211, 77, 0.16)',
              border: `1.5px solid ${pal.amber}`,
              color: pal.amber,
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 21,
              fontWeight: 700,
            }}
          >
            {t.badge || 'ภาพตัดขวางโครงสร้าง'}
          </span>
          <span style={{ color: pal.muted, fontFamily: 'monospace', fontSize: 17 }}>CROSS-SECTION VIEW</span>
        </div>
        <FitText text={t.title} baseSize={52} minSize={30} maxLines={2} color={pal.line} fontWeight={800} align="left" />
      </div>

      {/* Cutaway Blueprint Drawing (Left Column) + Callout Arrows */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <pattern id="bp-hatch-cutaway" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="14" stroke="rgba(186,230,253,0.52)" strokeWidth="2" />
          </pattern>
        </defs>

        <g transform={`translate(285, 785) scale(${reveal}) translate(-285, -815)`}>
          {/* Outer housing cutaway shell with 45-degree engineering section hatch */}
          <path
            d="M 110 470 L 460 470 L 460 540 L 420 540 L 420 1100 L 460 1100 L 460 1180 L 110 1180 L 110 1100 L 150 1100 L 150 540 L 110 540 Z"
            fill="url(#bp-hatch-cutaway)"
            stroke={pal.line}
            strokeWidth={3}
          />

          {/* Inner hollow chamber */}
          <rect x={175} y={535} width={220} height={575} fill={pal.bgDeep} stroke={pal.cyan} strokeWidth={2.4} />

          {/* Top intake valve assembly */}
          <rect x={235} y={420} width={100} height={50} fill="rgba(103,232,249,0.18)" stroke={pal.cyan} strokeWidth={2.2} />
          <line x1={285} y1={390} x2={285} y2={1240} stroke="rgba(186,230,253,0.45)" strokeWidth={1.4} strokeDasharray="14 6 4 6" />

          {/* Upper cooling fins */}
          {[560, 595, 630].map((fy, i) => (
            <g key={i} stroke={pal.line} strokeWidth={2}>
              <line x1={120} y1={fy} x2={150} y2={fy} />
              <line x1={420} y1={fy} x2={450} y2={fy} />
            </g>
          ))}

          {/* Animated inner core / reciprocating piston */}
          <g transform={`translate(0, ${pistonOffset})`}>
            <rect
              x={198}
              y={650}
              width={174}
              height={130}
              rx={6}
              fill="rgba(30, 90, 156, 0.85)"
              stroke={pal.amber}
              strokeWidth={3}
            />
            {/* Piston compression rings */}
            <line x1={198} y1={676} x2={372} y2={676} stroke={pal.line} strokeWidth={2.5} />
            <line x1={198} y1={698} x2={372} y2={698} stroke={pal.line} strokeWidth={2.5} />
            {/* Energy core glow inside piston */}
            <circle cx={285} cy={740} r={22} fill={pal.cyan} opacity={pulse * 0.55} />
            <circle cx={285} cy={740} r={10} fill={pal.line} />
            {/* Connecting rod */}
            <rect x={273} y={780} width={24} height={195} fill="rgba(186,230,253,0.22)" stroke={pal.line} strokeWidth={2.2} />
          </g>

          {/* Lower crankshaft flywheel */}
          <circle cx={285} cy={1020} r={66} fill="rgba(103,232,249,0.12)" stroke={pal.cyan} strokeWidth={2.5} />
          <circle cx={285} cy={1020} r={22} fill={pal.bgDeep} stroke={pal.amber} strokeWidth={2.5} />
          <g transform={`translate(285, 1020) rotate(${localFrame * 3.5})`}>
            <line x1={-56} y1={0} x2={56} y2={0} stroke={pal.cyan} strokeWidth={2} />
            <line x1={0} y1={-56} x2={0} y2={56} stroke={pal.cyan} strokeWidth={2} />
            <circle cx={42} cy={0} r={8} fill={pal.amber} />
          </g>

          {/* Vertical dimension measurement on left side */}
          <g stroke={pal.muted} strokeWidth={1.4}>
            <line x1={82} y1={470} x2={82} y2={1180} />
            <line x1={70} y1={470} x2={96} y2={470} />
            <line x1={70} y1={1180} x2={96} y2={1180} />
            <text
              x={68}
              y={825}
              fill={pal.muted}
              fontSize={16}
              fontFamily="monospace"
              textAnchor="middle"
              transform="rotate(-90 68 825)"
            >
              H = 710.0 mm
            </text>
          </g>
        </g>

        {/* Callout Arrows from Cutaway Parts to Right-hand Annotations */}
        {points.map((_, idx) => {
          const target = calloutTargets[idx];
          if (!target) return null;
          const p = stagger(idx, localFrame, 7, 8, 14);
          return (
            <g key={`arrow-${idx}`} opacity={p}>
              <polyline
                points={`${target.tx},${target.ty} ${target.bx - 36},${target.by + 68} ${target.bx},${target.by + 68}`}
                fill="none"
                stroke={idx === 1 ? pal.amber : pal.cyan}
                strokeWidth={2.2}
              />
              <circle cx={target.tx} cy={target.ty} r={7} fill={idx === 1 ? pal.amber : pal.cyan} />
              <circle cx={target.tx} cy={target.ty} r={14} fill="none" stroke={idx === 1 ? pal.amber : pal.cyan} strokeWidth={1.4} opacity={0.6} />
            </g>
          );
        })}
      </svg>

      {/* Right-hand Technical Callout Boxes (flexible height, strictly above CONTENT_BOTTOM=1420) */}
      {points.map((pt, idx) => {
        const target = calloutTargets[idx];
        if (!target) return null;
        const p = stagger(idx, localFrame, 7, 8, 14);
        const accent = idx === 1 ? pal.amber : pal.cyan;
        return (
          <div
            key={idx}
            style={{
              position: 'absolute',
              left: target.bx,
              top: target.by,
              width: STAGE_W - target.bx - 56,
              minHeight: 162,
              padding: '15px 18px',
              background: pal.cardBg,
              border: `1.8px solid ${accent}`,
              borderLeft: `6px solid ${accent}`,
              display: 'flex',
              flexDirection: 'column',
              opacity: p,
              transform: `translateX(${interpolate(p, [0, 1], [28, 0])}px)`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, flexShrink: 0 }}>
              <span style={{ color: accent, fontFamily: 'monospace', fontSize: 17, fontWeight: 700 }}>{target.label}</span>
              <span style={{ color: pal.muted, fontFamily: 'monospace', fontSize: 15 }}>LAYER 0{idx + 1}</span>
            </div>
            <FitText text={pt} baseSize={22} minSize={16} maxLines={4} lineHeight={1.28} color={pal.line} fontWeight={700} align="left" />
          </div>
        );
      })}
    </div>
  );
};

/** look-9 Shot 3: flow-schematic — ผังวงจร/ท่อส่งสัญญาณไหลทีละขั้น */
const FlowSchematicShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = getBlueGridPalette(tokens);
  const t = sceneTexts(scene);
  const steps = extractPoints(scene, 4);
  const count = Math.max(1, steps.length);

  // Serpentine schematic node positions (alternating left/right, ends at 370 + 3*255 + 185 = 1320 ≤ CONTENT_BOTTOM=1420)
  const nodes = steps.map((text, i) => {
    const isLeft = i % 2 === 0;
    const x = isLeft ? 105 : 420;
    const y = 370 + i * 255;
    const w = 555;
    const h = 185;
    const portX = isLeft ? 210 : 870;
    const portY = y + h / 2;
    return { text, i, isLeft, x, y, w, h, portX, portY };
  });

  // Animated signal pulse progress along the circuit
  const signalCycle = (localFrame % 90) / 90;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <BlueprintBackdrop
        tokens={tokens}
        localFrame={localFrame}
        uid="flow"
        dwgCode={`DWG-09C · CIRCUIT FLOW #${String(sceneIndex + 1).padStart(2, '0')}`}
        scaleLabel="SIGNAL BUS 5V"
      />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 68,
          right: 68,
          opacity: appear(localFrame, 2, 14),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span
            style={{
              padding: '5px 16px',
              border: `1.5px solid ${pal.cyan}`,
              background: 'rgba(103, 232, 249, 0.14)',
              color: pal.cyan,
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 21,
              fontWeight: 700,
            }}
          >
            {t.badge || 'ผังการไหลของระบบ'}
          </span>
          <span style={{ color: pal.muted, fontFamily: 'monospace', fontSize: 17 }}>
            {count} NODES ACTIVE
          </span>
        </div>
        <FitText text={t.title} baseSize={52} minSize={30} maxLines={2} color={pal.line} fontWeight={800} align="left" />
      </div>

      {/* Orthogonal Circuit / Pipe Schematic SVG */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Background schematic bus lines */}
        <line x1={82} y1={340} x2={82} y2={CONTENT_BOTTOM - 16} stroke="rgba(186,230,253,0.22)" strokeWidth={2} />
        <line x1={998} y1={340} x2={998} y2={CONTENT_BOTTOM - 16} stroke="rgba(186,230,253,0.22)" strokeWidth={2} />

        {/* Orthogonal pipes connecting step i -> step i+1 */}
        {nodes.slice(0, -1).map((curr, idx) => {
          const next = nodes[idx + 1];
          const p = stagger(idx, localFrame, 8, 10, 16);
          const startX = curr.isLeft ? curr.x + curr.w : curr.x;
          const startY = curr.y + curr.h * 0.5;
          const midX = curr.isLeft ? 915 : 165;
          const endX = next.isLeft ? next.x : next.x + next.w;
          const endY = next.y + next.h * 0.5;
          const midY = (startY + endY) * 0.5;

          const pipePath = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${midY} L ${curr.isLeft ? 915 : 165} ${endY} L ${endX} ${endY}`;
          const dotT = (signalCycle * count - idx + count) % 1;
          const dotY = interpolate(dotT, [0, 1], [startY, endY]);

          return (
            <g key={`pipe-${idx}`} opacity={p}>
              {/* Outer pipe casing */}
              <path d={pipePath} fill="none" stroke="rgba(186,230,253,0.32)" strokeWidth={12} strokeLinejoin="round" />
              {/* Inner glowing signal flow */}
              <path
                d={pipePath}
                fill="none"
                stroke={pal.cyan}
                strokeWidth={3.2}
                strokeDasharray="18 14"
                strokeDashoffset={-localFrame * 4}
                strokeLinejoin="round"
              />
              {/* Valve / regulator diamond at mid-run */}
              <g transform={`translate(${midX}, ${midY})`}>
                <polygon points="0,-16 16,0 0,16 -16,0" fill={pal.bgDeep} stroke={pal.amber} strokeWidth={2.2} />
                <circle cx={0} cy={0} r={4} fill={pal.amber} />
              </g>
              {/* Moving energy pulse dot */}
              <circle cx={midX} cy={dotY} r={8} fill={pal.amber} />
              <circle cx={midX} cy={dotY} r={15} fill={pal.amber} opacity={0.28} />
            </g>
          );
        })}

        {/* Input power arrow at top of Node 1 */}
        {nodes[0] ? (
          <g opacity={appear(localFrame, 4, 12)}>
            <line x1={nodes[0].x + 70} y1={325} x2={nodes[0].x + 70} y2={nodes[0].y} stroke={pal.amber} strokeWidth={3} />
            <polygon
              points={`${nodes[0].x + 70},${nodes[0].y} ${nodes[0].x + 60},${nodes[0].y - 16} ${nodes[0].x + 80},${nodes[0].y - 16}`}
              fill={pal.amber}
            />
            <text x={nodes[0].x + 90} y={352} fill={pal.amber} fontFamily="monospace" fontSize={16} fontWeight={700}>
              INPUT SIGNAL
            </text>
          </g>
        ) : null}
      </svg>

      {/* Schematic Station Cards */}
      {nodes.map((node) => {
        const sc = spring({ frame: Math.max(0, localFrame - node.i * 7), fps, config: { damping: 15, stiffness: 140 } });
        const active = Math.floor(signalCycle * count) === node.i;
        return (
          <div
            key={node.i}
            style={{
              position: 'absolute',
              left: node.x,
              top: node.y,
              width: node.w,
              minHeight: node.h,
              padding: '16px 22px',
              background: active ? 'rgba(14, 64, 122, 0.92)' : pal.cardBg,
              border: `2px solid ${active ? pal.amber : pal.cyan}`,
              boxShadow: active ? '0 0 28px rgba(252, 211, 77, 0.22)' : 'none',
              transform: `scale(${interpolate(sc, [0, 1], [0.92, 1])})`,
              opacity: sc,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    border: `2px solid ${active ? pal.amber : pal.cyan}`,
                    color: active ? pal.amber : pal.cyan,
                    fontFamily: 'monospace',
                    fontSize: 18,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {String(node.i + 1).padStart(2, '0')}
                </div>
                <span style={{ color: pal.muted, fontFamily: 'monospace', fontSize: 16 }}>
                  STAGE-{String(node.i + 1).padStart(2, '0')} // {active ? 'ACTIVE' : 'READY'}
                </span>
              </div>
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: active ? pal.amber : pal.cyan,
                }}
              />
            </div>
            <FitText text={node.text} baseSize={22} minSize={16} maxLines={4} lineHeight={1.28} color={pal.line} fontWeight={700} align="left" />
          </div>
        );
      })}
    </div>
  );
};

/** look-9 Shot 4: spec-sheet — ตารางสเปกเทคนิคพร้อมเส้นบอกขนาดและตัวเลขหลักใหญ่ */
const SpecSheetShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = getBlueGridPalette(tokens);
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetric(scene, sceneIndex);
  const specs = extractPoints(scene, 4);
  const heroSpring = spring({ frame: Math.max(0, localFrame - 4), fps, config: { damping: 14, stiffness: 125 } });
  const stampSpring = spring({ frame: Math.max(0, localFrame - 20), fps, config: { damping: 12, stiffness: 180 } });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <BlueprintBackdrop
        tokens={tokens}
        localFrame={localFrame}
        uid="spec"
        dwgCode={`SPEC-09D · DATASHEET #${String(sceneIndex + 1).padStart(2, '0')}`}
        scaleLabel="TOL ±0.01"
      />

      {/* Top Engineering Title Block */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 68,
          right: 68,
          opacity: appear(localFrame, 2, 14),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span
            style={{
              padding: '5px 16px',
              background: 'rgba(103, 232, 249, 0.14)',
              border: `1.5px solid ${pal.cyan}`,
              color: pal.cyan,
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 21,
              fontWeight: 700,
            }}
          >
            {t.badge || 'ตารางสเปกเทคนิค'}
          </span>
          <span style={{ color: pal.muted, fontFamily: 'monospace', fontSize: 16 }}>ISO-9001 VERIFIED</span>
        </div>
        <FitText text={t.title} baseSize={50} minSize={30} maxLines={2} color={pal.line} fontWeight={800} align="left" />
      </div>

      {/* Dimension Lines & Blueprint Graphic around Hero Number */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Top horizontal dimension line */}
        <g stroke={pal.cyan} strokeWidth={1.6} opacity={heroSpring}>
          <line x1={92} y1={326} x2={988} y2={326} />
          <line x1={92} y1={312} x2={92} y2={342} />
          <line x1={988} y1={312} x2={988} y2={342} />
          <polygon points="92,326 108,320 108,332" fill={pal.cyan} />
          <polygon points="988,326 972,320 972,332" fill={pal.cyan} />
          <rect x={464} y={312} width={152} height={28} fill={pal.bgDeep} stroke={pal.cyan} strokeWidth={1} />
          <text x={540} y={332} textAnchor="middle" fill={pal.cyan} fontFamily="monospace" fontSize={15} fontWeight={700}>
            W = 896.0 mm
          </text>
        </g>

        {/* Left vertical dimension line for hero stat box */}
        <g stroke={pal.muted} strokeWidth={1.4} opacity={heroSpring}>
          <line x1={68} y1={340} x2={68} y2={608} />
          <line x1={58} y1={340} x2={78} y2={340} />
          <line x1={58} y1={608} x2={78} y2={608} />
        </g>

        {/* Decorative mini orthographic schematic gauge inside hero card right */}
        <g transform={`translate(860, 474) scale(${heroSpring})`} opacity={0.85}>
          <circle cx={0} cy={0} r={86} fill="none" stroke="rgba(186,230,253,0.3)" strokeWidth={2} strokeDasharray="8 6" />
          <circle
            cx={0}
            cy={0}
            r={68}
            fill="none"
            stroke={pal.cyan}
            strokeWidth={5}
            strokeDasharray={`${Math.round(427 * 0.72)} 427`}
            transform={`rotate(${-90 + localFrame * 1.2})`}
          />
          <circle cx={0} cy={0} r={42} fill="none" stroke={pal.amber} strokeWidth={1.8} />
          <line x1={-96} y1={0} x2={96} y2={0} stroke="rgba(186,230,253,0.35)" strokeWidth={1.2} />
          <line x1={0} y1={-96} x2={0} y2={96} stroke="rgba(186,230,253,0.35)" strokeWidth={1.2} />
          <text x={0} y={6} textAnchor="middle" fill={pal.amber} fontFamily="monospace" fontSize={18} fontWeight={800}>
            SPEC
          </text>
        </g>
      </svg>

      {/* Hero Big Stat / Measurement Box */}
      <div
        style={{
          position: 'absolute',
          top: 340,
          left: 92,
          width: 896,
          minHeight: 268,
          background: pal.cardBg,
          border: `2.4px solid ${pal.cyan}`,
          padding: '20px 36px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          transform: `scale(${interpolate(heroSpring, [0, 1], [0.94, 1])})`,
          opacity: heroSpring,
        }}
      >
        <div style={{ color: pal.cyan, fontFamily: 'monospace', fontSize: 18, letterSpacing: 2, marginBottom: 6 }}>
          PRIMARY PARAMETER // {metric.unit || 'MEASURED'}
        </div>
        <div style={{ maxWidth: 620 }}>
          <FitText text={metric.big} baseSize={100} minSize={48} maxLines={1} color={pal.amber} fontWeight={900} align="left" />
        </div>
        <div style={{ maxWidth: 620, marginTop: 6 }}>
          <FitText text={metric.label} baseSize={26} minSize={18} maxLines={2} lineHeight={1.28} color={pal.line} fontWeight={700} align="left" />
        </div>
      </div>

      {/* Technical Specification Table (strictly above stamp & CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: 634,
          left: 92,
          width: 896,
          border: `2px solid ${pal.border}`,
          background: pal.cardBg,
        }}
      >
        {/* Table Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 24px',
            background: 'rgba(103, 232, 249, 0.14)',
            borderBottom: `1.5px solid ${pal.cyan}`,
            fontFamily: 'monospace',
            fontSize: 18,
            fontWeight: 700,
            color: pal.cyan,
          }}
        >
          <span style={{ width: 110 }}>ITEM</span>
          <span style={{ flex: 1 }}>SPECIFICATION DETAIL</span>
          <span style={{ width: 110, textAlign: 'right' }}>STATUS</span>
        </div>

        {/* Spec Rows */}
        {specs.map((row, i) => {
          const p = stagger(i, localFrame, 6, 12, 14);
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '14px 24px',
                borderBottom: i < specs.length - 1 ? '1px solid rgba(186,230,253,0.22)' : 'none',
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [-22, 0])}px)`,
              }}
            >
              <span style={{ width: 110, fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: pal.muted }}>
                SP-0{i + 1}
              </span>
              <div style={{ flex: 1, paddingRight: 16 }}>
                <FitText text={row} baseSize={22} minSize={16} maxLines={3} lineHeight={1.28} color={pal.line} fontWeight={700} align="left" />
              </div>
              <span
                style={{
                  width: 98,
                  padding: '5px 0',
                  textAlign: 'center',
                  border: `1.5px solid ${pal.cyan}`,
                  color: pal.cyan,
                  fontFamily: 'monospace',
                  fontSize: 16,
                  fontWeight: 800,
                }}
              >
                PASS ✓
              </span>
            </div>
          );
        })}
      </div>

      {/* Bottom Right Approved Engineering Stamp (strictly above CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: CONTENT_BOTTOM - 64,
          right: 92,
          padding: '10px 22px',
          border: `2.5px solid ${pal.amber}`,
          color: pal.amber,
          fontFamily: 'monospace',
          fontSize: 18,
          fontWeight: 800,
          letterSpacing: 2,
          transform: `rotate(-4deg) scale(${stampSpring})`,
          opacity: stampSpring,
        }}
      >
        APPROVED · REV 0{sceneIndex + 1}
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 2: look-10 — PRODUCT TURNTABLE (แท่นหมุนสินค้า / สตูดิโอโชว์สินค้า)
// ============================================================================

function getTurntablePalette(tokens: any) {
  const p = tokens?.palette || {};
  return {
    bg: p.bg || '#FAF6EE',
    bgSecondary: p.bgSecondary || '#EFE8D8',
    fg: p.fg || '#1E1B18',
    muted: p.muted || '#6B6257',
    accent: p.accent || '#111318',
    accent2: p.accent2 || '#2A2D36',
    cardBg: p.cardBg || '#FFFFFF',
    border: p.border || '#DCD2C0',
    gold: '#C68B3C',
    rimLight: '#FFFDF7',
    coral: '#D9534F',
  };
}

/** Studio cyclorama backdrop with overhead softbox glow and floor horizon */
const StudioTurntableBackdrop: React.FC<{
  tokens: any;
  uid: string;
  mood?: 'bright' | 'spotlight';
  horizonY?: number;
}> = ({ tokens, uid, mood = 'bright', horizonY = 1040 }) => {
  const pal = getTurntablePalette(tokens);
  const isSpot = mood === 'spotlight';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: isSpot
          ? 'radial-gradient(ellipse at 50% 24%, #2B2A28 0%, #171615 55%, #0D0C0B 100%)'
          : `radial-gradient(ellipse at 50% 22%, #FFFFFF 0%, ${pal.bg} 48%, ${pal.bgSecondary} 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id={`st-floor-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isSpot ? '#252320' : pal.bgSecondary} stopOpacity="0.95" />
            <stop offset="100%" stopColor={isSpot ? '#0F0E0D' : '#E2D8C4'} stopOpacity="1" />
          </linearGradient>
          <radialGradient id={`st-softbox-${uid}`} cx="50%" cy="0%" r="70%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity={isSpot ? '0.22' : '0.85'} />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Overhead studio softbox glow */}
        <rect x={0} y={0} width={STAGE_W} height={680} fill={`url(#st-softbox-${uid})`} />

        {/* Studio cyclorama floor plane */}
        <rect x={0} y={horizonY} width={STAGE_W} height={STAGE_H - horizonY} fill={`url(#st-floor-${uid})`} />
        <line
          x1={0}
          y1={horizonY}
          x2={STAGE_W}
          y2={horizonY}
          stroke={isSpot ? 'rgba(255,255,255,0.12)' : 'rgba(130,115,95,0.22)'}
          strokeWidth={1.5}
        />

        {/* Subtle studio camera framing corners */}
        {[
          [44, 58, 1, 1],
          [STAGE_W - 44, 58, -1, 1],
          [44, CONTENT_BOTTOM - 36, 1, -1],
          [STAGE_W - 44, CONTENT_BOTTOM - 36, -1, -1],
        ].map(([x, y, dx, dy], idx) => (
          <path
            key={idx}
            d={`M ${x} ${y + dy * 28} L ${x} ${y} L ${x + dx * 28} ${y}`}
            fill="none"
            stroke={isSpot ? 'rgba(255,255,255,0.28)' : 'rgba(30,27,24,0.24)'}
            strokeWidth={2}
          />
        ))}
      </svg>
    </div>
  );
};

/** Illustrated luxury matte-obsidian & brushed-metal studio product (device / smart bottle / speaker) */
const StudioProductIllustration: React.FC<{
  uid: string;
  specShift?: number;
  highlightGold?: string;
}> = ({ uid, specShift = 0, highlightGold = '#C68B3C' }) => {
  const sheenX = -110 + specShift * 140;
  return (
    <g>
      <defs>
        <linearGradient id={`prod-body-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#14161B" />
          <stop offset="22%" stopColor="#2D313B" />
          <stop offset="48%" stopColor="#191C22" />
          <stop offset="80%" stopColor="#0E1014" />
          <stop offset="100%" stopColor="#242830" />
        </linearGradient>
        <linearGradient id={`prod-cap-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8E7043" />
          <stop offset="35%" stopColor="#F3D69B" />
          <stop offset="68%" stopColor={highlightGold} />
          <stop offset="100%" stopColor="#6E5128" />
        </linearGradient>
        <linearGradient id={`prod-sheen-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`prod-clip-${uid}`}>
          <rect x={-118} y={-215} width={236} height={415} rx={38} />
        </clipPath>
      </defs>

      {/* Main matte-obsidian monolith body */}
      <rect x={-118} y={-215} width={236} height={415} rx={38} fill={`url(#prod-body-${uid})`} stroke="#3B404D" strokeWidth={2.5} />

      {/* Top metallic champagne crown ring */}
      <rect x={-86} y={-258} width={172} height={46} rx={16} fill={`url(#prod-cap-${uid})`} stroke="#F5DFB0" strokeWidth={1.6} />
      <ellipse cx={0} cy={-252} rx={68} ry={9} fill="#FFF8E7" opacity={0.45} />

      {/* Subtle gold trim collar */}
      <rect x={-118} y={-168} width={236} height={9} fill={`url(#prod-cap-${uid})`} />

      {/* Center precision glass display / optical ring */}
      <circle cx={0} cy={-44} r={62} fill="#090B0E" stroke={`url(#prod-cap-${uid})`} strokeWidth={4} />
      <circle cx={0} cy={-44} r={44} fill="#121722" stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} />
      <circle cx={-16} cy={-60} r={14} fill="#FFFFFF" opacity={0.18} />
      <circle cx={0} cy={-44} r={16} fill="#38BDF8" opacity={0.75} />
      <circle cx={0} cy={-44} r={7} fill="#E0F2FE" />

      {/* Micro-perforated acoustic / ventilation grille lines */}
      {[56, 74, 92, 110, 128].map((gy, idx) => (
        <line
          key={idx}
          x1={-76}
          y1={gy}
          x2={76}
          y2={gy}
          stroke="rgba(255,255,255,0.16)"
          strokeWidth={4}
          strokeLinecap="round"
        />
      ))}

      {/* Subtle status indicator LED */}
      <rect x={-22} y={156} width={44} height={6} rx={3} fill={highlightGold} opacity={0.9} />

      {/* Rim light edge reflections */}
      <path d="M -112 -180 L -112 162" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" opacity={0.35} />
      <path d="M 112 -180 L 112 162" stroke="#F3D69B" strokeWidth={2.5} strokeLinecap="round" opacity={0.32} />

      {/* Moving studio specular reflection band */}
      <g clipPath={`url(#prod-clip-${uid})`}>
        <rect x={sheenX} y={-230} width={74} height={450} fill={`url(#prod-sheen-${uid})`} transform="skewX(-12)" />
      </g>
    </g>
  );
};

/** look-10 Shot 1: turntable-spin — สินค้าหมุนโชว์บนแท่นหมุนพร้อมแสงริมไลต์และมุมองศา */
const TurntableSpinShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = getTurntablePalette(tokens);
  const t = sceneTexts(scene);
  const points = extractShortPoints(scene, 3);
  const enter = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 130 } });

  // Simulate smooth 3D turntable rotation using cosine width compression + subtle skew + specular shift
  const angleRad = localFrame * 0.055;
  const angleDeg = Math.round(((localFrame * 3.15) % 360 + 360) % 360);
  const scaleX = 0.72 + 0.28 * Math.abs(Math.cos(angleRad));
  const skewY = Math.sin(angleRad) * 4.5;
  const specShift = Math.sin(angleRad);
  const hoverY = Math.sin(localFrame * 0.09) * 6;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <StudioTurntableBackdrop tokens={tokens} uid="spin" mood="bright" horizonY={980} />

      {/* Editorial Studio Header */}
      <div
        style={{
          position: 'absolute',
          top: 86,
          left: 68,
          right: 68,
          textAlign: 'center',
          opacity: appear(localFrame, 2, 14),
          transform: `translateY(${interpolate(appear(localFrame, 2, 14), [0, 1], [-16, 0])}px)`,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 20px',
            borderRadius: 999,
            background: pal.accent,
            color: '#FAF6EE',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 700,
            marginBottom: 14,
          }}
        >
          <span>360° STUDIO SHOWCASE</span>
          {t.badge ? <span>· {t.badge}</span> : null}
        </div>
        <FitText text={t.title} baseSize={56} minSize={32} maxLines={2} color={pal.fg} fontWeight={800} align="center" />
        {t.subtitle ? (
          <div style={{ marginTop: 8 }}>
            <FitText text={t.subtitle} baseSize={29} minSize={20} maxLines={2} color={pal.muted} fontWeight={500} align="center" />
          </div>
        ) : null}
      </div>

      {/* Turntable Plinth + Rotating Product SVG */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="tt-shadow-spin" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1E1B18" stopOpacity="0.42" />
            <stop offset="65%" stopColor="#1E1B18" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#1E1B18" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="tt-plinth-side" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#C9BFA9" />
            <stop offset="35%" stopColor="#F4EFE4" />
            <stop offset="70%" stopColor="#D6CCB6" />
            <stop offset="100%" stopColor="#A99F8B" />
          </linearGradient>
        </defs>

        {/* Turntable drop shadow on studio floor */}
        <ellipse cx={540} cy={1046} rx={360 * enter} ry={74 * enter} fill="url(#tt-shadow-spin)" />

        {/* Motorized Turntable Plinth Base */}
        <g transform={`translate(540, 990) scale(${enter})`}>
          {/* Cylinder side */}
          <path d="M -310 0 L -310 46 A 310 62 0 0 0 310 46 L 310 0 Z" fill="url(#tt-plinth-side)" stroke="#B7AC96" strokeWidth={2} />
          {/* Top platter face */}
          <ellipse cx={0} cy={0} rx={310} ry={62} fill="#FAF6EE" stroke="#C8BCA6" strokeWidth={2.5} />
          <ellipse cx={0} cy={0} rx={262} ry={50} fill="none" stroke={pal.gold} strokeWidth={2} strokeDasharray="10 10" />

          {/* Rotating degree ticks around the platter */}
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * Math.PI * 2) / 12 + angleRad;
            const x1 = Math.cos(a) * 274;
            const y1 = Math.sin(a) * 53;
            const x2 = Math.cos(a) * 296;
            const y2 = Math.sin(a) * 58;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={i % 3 === 0 ? pal.accent : pal.muted}
                strokeWidth={i % 3 === 0 ? 3 : 1.6}
                opacity={0.75}
              />
            );
          })}

          {/* Soft contact shadow directly under product */}
          <ellipse cx={0} cy={-4} rx={138 * scaleX} ry={28} fill="#1E1B18" opacity={0.32} />
        </g>

        {/* 360 degree orbital arrow guide */}
        <path
          d="M 210 990 A 340 72 0 0 0 870 990"
          fill="none"
          stroke={pal.gold}
          strokeWidth={2.4}
          strokeDasharray="12 8"
          opacity={0.7 * enter}
        />

        {/* Rotating Product on Turntable */}
        <g
          transform={`translate(540, ${752 + hoverY}) scale(${enter * scaleX}, ${enter}) skewY(${skewY})`}
        >
          <StudioProductIllustration uid="spin" specShift={specShift} highlightGold={pal.gold} />
        </g>

        {/* Degree readout pill on right of turntable */}
        <g transform="translate(860, 1070)" opacity={enter}>
          <rect x={-72} y={-22} width={144} height={44} rx={22} fill={pal.accent} />
          <text x={0} y={7} textAnchor="middle" fill="#FAF6EE" fontFamily="monospace" fontSize={20} fontWeight={700}>
            {String(angleDeg).padStart(3, '0')}° ROT
          </text>
        </g>
      </svg>

      {/* Bottom Sleek Feature Strip (strictly above CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: 1118,
          left: 64,
          right: 64,
          display: 'flex',
          gap: 18,
          justifyContent: 'center',
          alignItems: 'stretch',
        }}
      >
        {points.map((pt, idx) => {
          const p = stagger(idx, localFrame, 6, 12, 14);
          return (
            <div
              key={idx}
              style={{
                flex: 1,
                minHeight: 150,
                padding: '16px 18px',
                borderRadius: 22,
                background: pal.cardBg,
                border: `1.5px solid ${pal.border}`,
                boxShadow: '0 14px 32px rgba(30, 27, 24, 0.08)',
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [24, 0])}px)`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: pal.accent,
                    color: '#FAF6EE',
                    fontFamily: 'monospace',
                    fontSize: 15,
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  0{idx + 1}
                </span>
                <span style={{ color: pal.gold, fontFamily: 'monospace', fontSize: 15, fontWeight: 700 }}>
                  SPEC #{sceneIndex + 1}.{idx + 1}
                </span>
              </div>
              <FitText text={pt} baseSize={20} minSize={15} maxLines={4} lineHeight={1.28} color={pal.fg} fontWeight={700} align="left" />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-10 Shot 2: hotspot-callouts — จุดฮอตสปอตบนตัวสินค้าพร้อมเส้นชี้จุดเด่นรอบชิ้นงาน */
const HotspotCalloutsShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = getTurntablePalette(tokens);
  const t = sceneTexts(scene);
  const points = extractShortPoints(scene, 4);
  const enter = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 135 } });
  const pulse = 1 + 0.35 * Math.sin(localFrame * 0.16);

  // 4 hotspot coordinates on the centered product + alternating left/right callout boxes (non-overlapping x∈[48,1032])
  const hotspots: Array<{
    hx: number;
    hy: number;
    bx: number;
    by: number;
    bw: number;
    side: 'left' | 'right';
  }> = [
    { hx: 512, hy: 590, bx: 48, by: 375, bw: 360, side: 'left' },
    { hx: 576, hy: 695, bx: 672, by: 515, bw: 360, side: 'right' },
    { hx: 486, hy: 835, bx: 48, by: 805, bw: 360, side: 'left' },
    { hx: 572, hy: 940, bx: 672, by: 955, bw: 360, side: 'right' },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <StudioTurntableBackdrop tokens={tokens} uid="hotspot" mood="bright" horizonY={1120} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 84,
          left: 68,
          right: 68,
          textAlign: 'center',
          opacity: appear(localFrame, 2, 14),
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '6px 18px',
            borderRadius: 999,
            border: `1.5px solid ${pal.gold}`,
            color: pal.gold,
            background: 'rgba(198, 139, 60, 0.1)',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          {t.badge || 'สำรวจจุดเด่นรอบชิ้นงาน'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={30} maxLines={2} color={pal.fg} fontWeight={800} align="center" />
      </div>

      {/* Product + Pedestal + Hotspot Pins & Leader Lines */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Pedestal shadow & thin disk */}
        <ellipse cx={540} cy={1068} rx={215 * enter} ry={40 * enter} fill="#1E1B18" opacity={0.18} />
        <ellipse cx={540} cy={1050} rx={190 * enter} ry={34 * enter} fill="#EFE8D8" stroke="#C8BCA6" strokeWidth={2} />

        {/* Centered Product */}
        <g transform={`translate(540, 800) scale(${enter * 0.86})`}>
          <StudioProductIllustration uid="hotspot" specShift={Math.sin(localFrame * 0.04) * 0.4} highlightGold={pal.gold} />
        </g>

        {/* Hotspot leader lines + animated pulsing pins */}
        {points.map((_, idx) => {
          const hs = hotspots[idx];
          if (!hs) return null;
          const p = stagger(idx, localFrame, 7, 8, 14);
          const edgeX = hs.side === 'left' ? hs.bx + hs.bw : hs.bx;
          const edgeY = hs.by + 74;
          const elbowX = hs.side === 'left' ? edgeX + 34 : edgeX - 34;

          return (
            <g key={`hs-${idx}`} opacity={p}>
              <polyline
                points={`${hs.hx},${hs.hy} ${elbowX},${edgeY} ${edgeX},${edgeY}`}
                fill="none"
                stroke={pal.accent}
                strokeWidth={2.4}
              />
              {/* Pulsing ring */}
              <circle cx={hs.hx} cy={hs.hy} r={18 * pulse} fill="none" stroke={pal.gold} strokeWidth={2.2} opacity={0.55} />
              <circle cx={hs.hx} cy={hs.hy} r={11} fill={pal.gold} stroke="#FFFFFF" strokeWidth={3} />
              <circle cx={edgeX} cy={edgeY} r={5} fill={pal.accent} />
            </g>
          );
        })}
      </svg>

      {/* Callout Feature Cards */}
      {points.map((pt, idx) => {
        const hs = hotspots[idx];
        if (!hs) return null;
        const p = stagger(idx, localFrame, 7, 8, 14);
        return (
          <div
            key={idx}
            style={{
              position: 'absolute',
              left: hs.bx,
              top: hs.by,
              width: hs.bw,
              padding: '16px 18px',
              borderRadius: 20,
              background: pal.cardBg,
              border: `1.5px solid ${pal.border}`,
              borderTop: `4px solid ${pal.gold}`,
              boxShadow: '0 14px 32px rgba(30, 27, 24, 0.1)',
              opacity: p,
              transform: `translateX(${interpolate(p, [0, 1], [hs.side === 'left' ? -24 : 24, 0])}px)`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  padding: '2px 10px',
                  borderRadius: 999,
                  background: pal.accent,
                  color: '#FAF6EE',
                  fontFamily: 'monospace',
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                PIN 0{idx + 1}
              </span>
            </div>
            <FitText text={pt} baseSize={21} minSize={16} maxLines={4} lineHeight={1.28} color={pal.fg} fontWeight={700} align="left" />
          </div>
        );
      })}

      {/* Bottom subtitle caption bar if present (strictly above CONTENT_BOTTOM=1420) */}
      {t.subtitle ? (
        <div
          style={{
            position: 'absolute',
            top: 1275,
            left: 84,
            right: 84,
            padding: '14px 24px',
            borderRadius: 18,
            background: 'rgba(255,255,255,0.82)',
            border: `1px solid ${pal.border}`,
            opacity: appear(localFrame, 18, 14),
          }}
        >
          <FitText text={t.subtitle} baseSize={22} minSize={16} maxLines={2} lineHeight={1.28} color={pal.muted} fontWeight={600} align="center" />
        </div>
      ) : null}
    </div>
  );
};

/** look-10 Shot 3: exploded-features — แยกชิ้นส่วนสินค้าเป็นชั้นลอยแนวตั้งพร้อมอธิบายแต่ละชั้น */
const ExplodedFeaturesShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = getTurntablePalette(tokens);
  const t = sceneTexts(scene);
  const points = extractPoints(scene, 4);
  const explode = spring({ frame: Math.max(0, localFrame - 4), fps, config: { damping: 15, stiffness: 110 } });

  // 4 distinct hardware layers separated vertically along an isometric center axis
  const layers = [
    {
      name: 'OPTIC SHELL',
      baseY: 600,
      targetY: 435,
      topFill: '#E5E7EB',
      sideFill: '#9CA3AF',
      accent: '#38BDF8',
    },
    {
      name: 'CORE MODULE',
      baseY: 670,
      targetY: 675,
      topFill: '#1E293B',
      sideFill: '#0F172A',
      accent: pal.gold,
    },
    {
      name: 'POWER CELL',
      baseY: 740,
      targetY: 915,
      topFill: '#D4B077',
      sideFill: '#9C7A44',
      accent: '#1E1B18',
    },
    {
      name: 'DOCK CHASSIS',
      baseY: 810,
      targetY: 1155,
      topFill: '#2A2D36',
      sideFill: '#111318',
      accent: pal.gold,
    },
  ];

  const layerCount = Math.min(4, Math.max(2, points.length));
  const activeLayers = layers.slice(0, layerCount);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <StudioTurntableBackdrop tokens={tokens} uid="exploded" mood="bright" horizonY={1290} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 84,
          left: 68,
          right: 68,
          opacity: appear(localFrame, 2, 14),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span
            style={{
              padding: '6px 16px',
              borderRadius: 999,
              background: pal.accent,
              color: '#FAF6EE',
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            {t.badge || 'แยกโครงสร้างทีละชั้น'}
          </span>
          <span style={{ color: pal.muted, fontFamily: 'monospace', fontSize: 16 }}>EXPLODED VIEW</span>
        </div>
        <FitText text={t.title} baseSize={52} minSize={30} maxLines={2} color={pal.fg} fontWeight={800} align="left" />
      </div>

      {/* Isometric Exploded Product Layers (Left Column) */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Vertical center alignment guide axis */}
        <line
          x1={235}
          y1={360}
          x2={235}
          y2={1310}
          stroke={pal.gold}
          strokeWidth={2}
          strokeDasharray="10 8"
          opacity={0.65 * explode}
        />

        {/* Floor shadow under exploded stack */}
        <ellipse cx={235} cy={1305} rx={148} ry={30} fill="#1E1B18" opacity={0.18 * explode} />

        {/* Draw layers bottom-to-top so upper layers visually float above lower layers */}
        {[...activeLayers].reverse().map((layer, revIdx) => {
          const idx = activeLayers.length - 1 - revIdx;
          const cy = interpolate(explode, [0, 1], [layer.baseY, layer.targetY]);
          const hover = Math.sin(localFrame * 0.08 + idx * 1.1) * 4;
          const y = cy + hover;

          return (
            <g key={layer.name}>
              {/* Isometric slab / disk representing hardware layer */}
              <g transform={`translate(235, ${y})`}>
                {/* Drop shadow beneath each floating layer */}
                <ellipse cx={0} cy={48} rx={114} ry={28} fill="#1E1B18" opacity={0.12} />
                {/* 3D thickness edge */}
                <path
                  d="M -128 0 L 0 52 L 128 0 L 128 26 L 0 78 L -128 26 Z"
                  fill={layer.sideFill}
                  stroke="rgba(255,255,255,0.22)"
                  strokeWidth={1.5}
                />
                {/* Top isometric diamond face */}
                <polygon
                  points="0,-52 128,0 0,52 -128,0"
                  fill={layer.topFill}
                  stroke={layer.accent}
                  strokeWidth={2.4}
                />
                {/* Inner detail ring / chip pattern per layer */}
                <polygon
                  points="0,-28 72,0 0,28 -72,0"
                  fill="none"
                  stroke={layer.accent}
                  strokeWidth={1.8}
                  opacity={0.8}
                />
                <circle cx={0} cy={0} r={13} fill={layer.accent} opacity={0.85} />
              </g>

              {/* Horizontal connector from layer to right feature card */}
              <line
                x1={364}
                y1={y + 8}
                x2={432}
                y2={y + 8}
                stroke={pal.gold}
                strokeWidth={2.2}
                strokeDasharray="6 4"
                opacity={stagger(idx, localFrame, 6, 8, 12)}
              />
              <circle cx={364} cy={y + 8} r={6} fill={pal.gold} opacity={stagger(idx, localFrame, 6, 8, 12)} />
            </g>
          );
        })}
      </svg>

      {/* Feature Cards aligned with each Exploded Layer */}
      {activeLayers.map((layer, idx) => {
        const pt = points[idx] || '';
        const p = stagger(idx, localFrame, 6, 8, 14);
        const cy = interpolate(explode, [0, 1], [layer.baseY, layer.targetY]);
        return (
          <div
            key={layer.name}
            style={{
              position: 'absolute',
              left: 432,
              top: cy - 64,
              width: STAGE_W - 432 - 52,
              minHeight: 128,
              padding: '14px 20px',
              borderRadius: 18,
              background: pal.cardBg,
              border: `1.5px solid ${pal.border}`,
              borderLeft: `6px solid ${pal.gold}`,
              boxShadow: '0 12px 28px rgba(30, 27, 24, 0.08)',
              opacity: p,
              transform: `translateX(${interpolate(p, [0, 1], [26, 0])}px)`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: pal.gold, fontFamily: 'monospace', fontSize: 15, fontWeight: 800 }}>
                LAYER 0{idx + 1} · {layer.name}
              </span>
            </div>
            <FitText text={pt} baseSize={21} minSize={16} maxLines={4} lineHeight={1.28} color={pal.fg} fontWeight={700} align="left" />
          </div>
        );
      })}
    </div>
  );
};

/** look-10 Shot 4: price-reveal — สปอตไลต์ส่องตัวสินค้าพร้อมป้ายราคา/ตัวเลขหลักขนาดใหญ่ */
const PriceRevealShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = getTurntablePalette(tokens);
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetric(scene, sceneIndex);
  const bullets = extractShortPoints(scene, 3);

  const spotIn = appear(localFrame, 0, 16);
  const prodSpring = spring({ frame: Math.max(0, localFrame - 4), fps, config: { damping: 15, stiffness: 120 } });
  const tagSpring = spring({ frame: Math.max(0, localFrame - 12), fps, config: { damping: 12, stiffness: 150 } });
  const tagSwing = Math.sin(localFrame * 0.1) * 2.8;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <StudioTurntableBackdrop tokens={tokens} uid="price" mood="spotlight" horizonY={940} />

      {/* Dramatic Overhead Spotlight Cone + Pedestal + Product */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="spot-beam-price" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFF8E7" stopOpacity="0.46" />
            <stop offset="55%" stopColor="#F3D69B" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#0D0C0B" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="spot-pool-price" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F3D69B" stopOpacity="0.42" />
            <stop offset="60%" stopColor="#C68B3C" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#0D0C0B" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Spotlight beam from top center */}
        <polygon points="440,0 640,0 920,1040 160,1040" fill="url(#spot-beam-price)" opacity={spotIn} />

        {/* Floor spotlight pool */}
        <ellipse cx={332} cy={918} rx={285 * spotIn} ry={58 * spotIn} fill="url(#spot-pool-price)" />

        {/* Dark obsidian turntable pedestal */}
        <g transform={`translate(332, 882) scale(${prodSpring})`}>
          <path d="M -190 0 L -190 34 A 190 38 0 0 0 190 34 L 190 0 Z" fill="#18191D" stroke={pal.gold} strokeWidth={2} />
          <ellipse cx={0} cy={0} rx={190} ry={38} fill="#25272E" stroke="#F3D69B" strokeWidth={2} />
        </g>

        {/* Product under spotlight (left-center so price tag shines on right) */}
        <g transform={`translate(332, 682) scale(${prodSpring * 0.84})`}>
          <StudioProductIllustration uid="price" specShift={Math.sin(localFrame * 0.06) * 0.5} highlightGold="#F3D69B" />
        </g>

        {/* Hanging metallic cord for luxury price tag */}
        <line
          x1={774}
          y1={310}
          x2={774}
          y2={445}
          stroke="#F3D69B"
          strokeWidth={3}
          opacity={tagSpring}
        />
        <circle cx={774} cy={445} r={10} fill="#0D0C0B" stroke="#F3D69B" strokeWidth={3} opacity={tagSpring} />
      </svg>

      {/* Top Title in Moody Spotlight Studio */}
      <div
        style={{
          position: 'absolute',
          top: 86,
          left: 68,
          right: 68,
          textAlign: 'center',
          opacity: appear(localFrame, 2, 14),
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '6px 20px',
            borderRadius: 999,
            border: '1.5px solid #F3D69B',
            color: '#F3D69B',
            background: 'rgba(198, 139, 60, 0.16)',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          {t.badge || 'ข้อเสนอพิเศษ'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={30} maxLines={2} color="#FAF6EE" fontWeight={800} align="center" />
      </div>

      {/* Swinging Luxury Price Tag / Big Number Card */}
      <div
        style={{
          position: 'absolute',
          top: 435,
          left: 528,
          width: 492,
          padding: '28px 26px 24px',
          borderRadius: 26,
          background: 'linear-gradient(155deg, #272522 0%, #151412 100%)',
          border: '2.5px solid #F3D69B',
          boxShadow: '0 24px 56px rgba(0, 0, 0, 0.55), 0 0 36px rgba(243, 214, 155, 0.22)',
          transformOrigin: '50% 0%',
          transform: `scale(${tagSpring}) rotate(${tagSwing}deg)`,
          opacity: tagSpring,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: '#0D0C0B',
            border: '3px solid #F3D69B',
            margin: '-14px auto 14px',
          }}
        />
        <div style={{ color: '#F3D69B', fontFamily: 'monospace', fontSize: 18, letterSpacing: 2, marginBottom: 6 }}>
          {metric.unit || 'SPECIAL OFFER'}
        </div>
        <FitText text={metric.big} baseSize={92} minSize={44} maxLines={1} color="#FFFFFF" fontWeight={900} align="center" />
        <div style={{ height: 1.5, background: 'rgba(243, 214, 155, 0.35)', margin: '14px 0 12px' }} />
        <FitText text={metric.label} baseSize={22} minSize={16} maxLines={3} lineHeight={1.28} color="#E7DFCE" fontWeight={700} align="center" />
      </div>

      {/* Value Bullet Chips / Spec Checklist at Bottom (3rd row strictly ≤ CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: 995,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {bullets.slice(0, 3).map((b, i) => {
          const p = stagger(i, localFrame, 6, 16, 14);
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                minHeight: 70,
                padding: '13px 20px',
                borderRadius: 18,
                background: 'rgba(255, 250, 240, 0.08)',
                border: '1.5px solid rgba(243, 214, 155, 0.32)',
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [20, 0])}px)`,
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: '#F3D69B',
                  color: '#151412',
                  fontWeight: 900,
                  fontSize: 18,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                ✓
              </span>
              <div style={{ flex: 1 }}>
                <FitText text={b} baseSize={22} minSize={16} maxLines={3} lineHeight={1.28} color="#FAF6EE" fontWeight={700} align="left" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 3: look-12 — CARD FLIP (พลิกบัตร / บัตรเครดิตและบัตรสิทธิพิเศษเงาวาว)
// ============================================================================

function getCardFlipPalette(tokens: any) {
  const p = tokens?.palette || {};
  return {
    bg: p.bg || '#131722',
    bgSecondary: p.bgSecondary || '#1E2436',
    fg: p.fg || '#F1F5F9',
    muted: p.muted || '#94A3B8',
    accent: p.accent || '#EEF0F3',
    border: p.border || '#2E3852',
    gold: '#F5C563',
    goldDark: '#B98324',
    cyan: '#38BDF8',
    emerald: '#34D399',
    violet: '#A78BFA',
    rose: '#FB7185',
  };
}

/** Dark luxury fintech lounge backdrop with subtle grid & floating light bokeh */
const CardStudioBackdrop: React.FC<{
  tokens: any;
  localFrame: number;
  uid: string;
  glowColor?: string;
}> = ({ tokens, localFrame, uid, glowColor = 'rgba(245, 197, 99, 0.22)' }) => {
  const pal = getCardFlipPalette(tokens);
  const float1 = Math.sin(localFrame * 0.04) * 18;
  const float2 = Math.cos(localFrame * 0.035) * 22;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at 50% 38%, ${glowColor} 0%, ${pal.bgSecondary} 44%, ${pal.bg} 78%, #090C14 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <pattern id={`cf-grid-${uid}`} width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(255,255,255,0.045)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={STAGE_W} height={STAGE_H} fill={`url(#cf-grid-${uid})`} />

        {/* Subtle ambient bokeh orbs */}
        <circle cx={190 + float1} cy={320} r={140} fill={pal.cyan} opacity={0.07} />
        <circle cx={880 - float2} cy={1120} r={180} fill={pal.gold} opacity={0.07} />
        <circle cx={540} cy={760 + float1 * 0.6} r={240} fill={pal.violet} opacity={0.05} />
      </svg>
    </div>
  );
};

/** Realistic metallic EMV smart card chip + contactless NFC wave SVG */
const EmvChipIcon: React.FC<{ size?: number; gold?: boolean }> = ({ size = 64, gold = true }) => (
  <svg width={size} height={size * 0.74} viewBox="0 0 64 48">
    <rect
      x={2}
      y={2}
      width={60}
      height={44}
      rx={8}
      fill={gold ? '#E5B95C' : '#CBD5E1'}
      stroke={gold ? '#FFF1C2' : '#F8FAFC'}
      strokeWidth={2}
    />
    <line x1={2} y1={17} x2={22} y2={17} stroke="rgba(30,27,24,0.45)" strokeWidth={1.8} />
    <line x1={2} y1={31} x2={22} y2={31} stroke="rgba(30,27,24,0.45)" strokeWidth={1.8} />
    <line x1={42} y1={17} x2={62} y2={17} stroke="rgba(30,27,24,0.45)" strokeWidth={1.8} />
    <line x1={42} y1={31} x2={62} y2={31} stroke="rgba(30,27,24,0.45)" strokeWidth={1.8} />
    <rect x={22} y={10} width={20} height={28} rx={4} fill="none" stroke="rgba(30,27,24,0.45)" strokeWidth={1.8} />
  </svg>
);

const ContactlessIcon: React.FC<{ color?: string; size?: number }> = ({ color = 'rgba(255,255,255,0.72)', size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 36 36">
    <path d="M 10 13 A 9 9 0 0 1 10 23" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
    <path d="M 16 9 A 14 14 0 0 1 16 27" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
    <path d="M 22 5 A 20 20 0 0 1 22 31" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
  </svg>
);

/** look-12 Shot 1: card-flip — บัตรพรีเมียมพลิกจากด้านหน้าไปด้านหลังเผยข้อความและข้อเสนอหลัก */
const CardFlipShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = getCardFlipPalette(tokens);
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetric(scene, sceneIndex);
  const points = extractShortPoints(scene, 3);

  // Smooth card entrance + 180-degree Y-axis flip starting at frame 12
  const enter = spring({ frame: localFrame, fps, config: { damping: 15, stiffness: 130 } });
  const flipP = spring({ frame: Math.max(0, localFrame - 12), fps, config: { damping: 16, stiffness: 95 } });
  const angle = interpolate(flipP, [0, 1], [0, 180]);
  const isBack = angle >= 90;
  // Use cosine scaleX for crisp deterministic 3D flip across all Chromium/Remotion renderers
  const cosScaleX = Math.max(0.03, Math.abs(Math.cos((angle * Math.PI) / 180)));
  const liftScale = 1 + Math.sin((angle * Math.PI) / 180) * 0.08;
  const sheenPos = interpolate((localFrame % 75) / 75, [0, 1], [-260, 1100]);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <CardStudioBackdrop tokens={tokens} localFrame={localFrame} uid="flip" glowColor="rgba(245, 197, 99, 0.24)" />

      {/* Top Header */}
      <div
        style={{
          position: 'absolute',
          top: 90,
          left: 68,
          right: 68,
          textAlign: 'center',
          opacity: appear(localFrame, 2, 14),
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 22px',
            borderRadius: 999,
            border: `1.5px solid ${pal.gold}`,
            background: 'rgba(245, 197, 99, 0.14)',
            color: pal.gold,
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 700,
            marginBottom: 14,
          }}
        >
          <span>★</span>
          <span>{t.badge || 'พลิกบัตรเปิดข้อเสนอ'}</span>
        </div>
        <FitText text={t.title} baseSize={54} minSize={30} maxLines={2} color={pal.fg} fontWeight={800} align="center" />
      </div>

      {/* Flipping Hero Credit / Reward Card */}
      <div
        style={{
          position: 'absolute',
          top: 320,
          left: 86,
          width: 908,
          height: 464,
          transform: `scale(${enter * liftScale}) scaleX(${cosScaleX})`,
          transformOrigin: '50% 50%',
        }}
      >
        {!isBack ? (
          /* FRONT FACE: Sleek Obsidian & Gold Metal VIP Card */
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              borderRadius: 36,
              overflow: 'hidden',
              background: 'linear-gradient(135deg, #272D3D 0%, #141824 52%, #0B0E17 100%)',
              border: `2.5px solid ${pal.gold}`,
              boxShadow: '0 32px 80px rgba(0, 0, 0, 0.65), 0 0 42px rgba(245, 197, 99, 0.22)',
              padding: '30px 40px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            {/* Glossy diagonal sheen */}
            <div
              style={{
                position: 'absolute',
                top: -120,
                left: sheenPos,
                width: 190,
                height: 820,
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)',
                transform: 'rotate(24deg)',
                pointerEvents: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: `linear-gradient(135deg, ${pal.gold}, ${pal.goldDark})`,
                  }}
                />
                <span style={{ color: pal.gold, fontFamily: 'monospace', fontSize: 22, fontWeight: 800, letterSpacing: 3 }}>
                  VIP REWARD CARD
                </span>
              </div>
              <ContactlessIcon color={pal.gold} size={40} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              <EmvChipIcon size={82} gold />
              <div style={{ flex: 1 }}>
                <FitText text={t.title} baseSize={42} minSize={24} maxLines={2} color="#FFFFFF" fontWeight={800} align="left" />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <span style={{ color: 'rgba(255,255,255,0.72)', fontFamily: 'monospace', fontSize: 26, letterSpacing: 5 }}>
                4820 •••• •••• 9012
              </span>
              <span style={{ color: pal.gold, fontFamily: 'monospace', fontSize: 20, fontWeight: 700 }}>
                TAP TO FLIP ↻
              </span>
            </div>
          </div>
        ) : (
          /* BACK FACE: Revealed Offer / Main Message */
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              borderRadius: 36,
              overflow: 'hidden',
              background: 'linear-gradient(145deg, #1E293B 0%, #111827 55%, #1E1B4B 100%)',
              border: `3px solid ${pal.cyan}`,
              boxShadow: '0 32px 80px rgba(0, 0, 0, 0.7), 0 0 54px rgba(56, 189, 248, 0.28)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Magnetic stripe across top of card back */}
            <div style={{ height: 52, marginTop: 22, background: '#07090F', borderTop: '1px solid #334155', borderBottom: '1px solid #334155' }} />

            {/* Diagonal glossy shine */}
            <div
              style={{
                position: 'absolute',
                top: -120,
                left: sheenPos,
                width: 190,
                height: 820,
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                transform: 'rotate(24deg)',
                pointerEvents: 'none',
              }}
            />

            {/* Signature / CVV + Revealed Main Offer */}
            <div style={{ flex: 1, padding: '18px 40px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
                <div
                  style={{
                    flex: 1,
                    padding: '10px 20px',
                    borderRadius: 12,
                    background: 'rgba(241, 245, 249, 0.92)',
                    color: '#0F172A',
                    fontFamily: THAI_FONT_FAMILY,
                    fontSize: 22,
                    fontWeight: 800,
                  }}
                >
                  {metric.unit || 'สิทธิ์ที่ได้รับ'}
                </div>
                <div
                  style={{
                    padding: '10px 22px',
                    borderRadius: 12,
                    background: pal.gold,
                    color: '#0F172A',
                    fontFamily: 'monospace',
                    fontSize: 22,
                    fontWeight: 900,
                  }}
                >
                  CVV {String(700 + sceneIndex * 37)}
                </div>
              </div>

              <div style={{ textAlign: 'center', margin: '6px 0' }}>
                <FitText text={metric.big} baseSize={92} minSize={44} maxLines={1} color={pal.gold} fontWeight={900} align="center" />
                <div style={{ marginTop: 6 }}>
                  <FitText text={metric.label} baseSize={28} minSize={19} maxLines={2} lineHeight={1.28} color="#FFFFFF" fontWeight={700} align="center" />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: pal.cyan, fontFamily: 'monospace', fontSize: 18 }}>
                <span>VALID THRU 12/29</span>
                <span>VERIFIED OFFER ✓</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Flip Status Indicator + Supporting Benefit Pills Below Card (3rd item strictly ≤ CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: 824,
          left: 68,
          right: 68,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {points.slice(0, 3).map((pt, idx) => {
          const p = stagger(idx, localFrame, 6, 18, 14);
          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                minHeight: 76,
                padding: '14px 20px',
                borderRadius: 20,
                background: 'rgba(30, 36, 54, 0.84)',
                border: `1.5px solid ${idx === 0 ? pal.gold : pal.border}`,
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [24, 0])}px)`,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  background: idx === 0 ? pal.gold : 'rgba(56, 189, 248, 0.2)',
                  color: idx === 0 ? '#0F172A' : pal.cyan,
                  fontFamily: 'monospace',
                  fontSize: 18,
                  fontWeight: 900,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                0{idx + 1}
              </div>
              <div style={{ flex: 1 }}>
                <FitText text={pt} baseSize={22} minSize={17} maxLines={3} lineHeight={1.28} color={pal.fg} fontWeight={700} align="left" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-12 Shot 2: card-fan — ไพ่/บัตรสิทธิพิเศษกางออกเป็นพัด แต่ละใบแทน 1 ประเด็น */
const CardFanShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = getCardFlipPalette(tokens);
  const t = sceneTexts(scene);
  const points = extractShortPoints(scene, 4);
  const fanSpring = spring({ frame: Math.max(0, localFrame - 4), fps, config: { damping: 14, stiffness: 115 } });
  const sheenPos = interpolate((localFrame % 80) / 80, [0, 1], [-180, 620]);

  const cardThemes = [
    {
      name: 'PLATINUM',
      bg: 'linear-gradient(145deg, #334155 0%, #0F172A 100%)',
      border: '#CBD5E1',
      accent: '#E2E8F0',
    },
    {
      name: 'EMERALD',
      bg: 'linear-gradient(145deg, #065F46 0%, #022C22 100%)',
      border: '#34D399',
      accent: '#6EE7B7',
    },
    {
      name: 'GOLD VIP',
      bg: 'linear-gradient(145deg, #92400E 0%, #451A03 100%)',
      border: '#F5C563',
      accent: '#FDE68A',
    },
    {
      name: 'SAPPHIRE',
      bg: 'linear-gradient(145deg, #1E3A8A 0%, #172554 100%)',
      border: '#38BDF8',
      accent: '#7DD3FC',
    },
  ];

  const count = Math.max(1, points.length);
  const mid = (count - 1) / 2;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <CardStudioBackdrop tokens={tokens} localFrame={localFrame} uid="fan" glowColor="rgba(56, 189, 248, 0.22)" />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 86,
          left: 68,
          right: 68,
          textAlign: 'center',
          opacity: appear(localFrame, 2, 14),
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '7px 20px',
            borderRadius: 999,
            background: 'rgba(56, 189, 248, 0.16)',
            border: `1.5px solid ${pal.cyan}`,
            color: pal.cyan,
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          {t.badge || 'รวมสิทธิพิเศษในมือคุณ'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={30} maxLines={2} color={pal.fg} fontWeight={800} align="center" />
        {t.subtitle ? (
          <div style={{ marginTop: 8 }}>
            <FitText text={t.subtitle} baseSize={28} minSize={20} maxLines={2} color={pal.muted} fontWeight={500} align="center" />
          </div>
        ) : null}
      </div>

      {/* Fanned Poker-Hand Visual Card Arc (Upper Stage) */}
      <div style={{ position: 'absolute', top: 355, left: 0, width: STAGE_W, height: 445 }}>
        {points.map((pt, i) => {
          const offset = i - mid;
          const theme = cardThemes[i % cardThemes.length];
          const rot = offset * 13 * fanSpring;
          const tx = offset * 126 * fanSpring;
          const ty = Math.abs(offset) * 28 * fanSpring;
          const cardW = 304;
          const cardH = 395;

          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: STAGE_W / 2 - cardW / 2,
                top: 24,
                width: cardW,
                height: cardH,
                borderRadius: 28,
                overflow: 'hidden',
                background: theme.bg,
                border: `2.4px solid ${theme.border}`,
                boxShadow: '0 24px 52px rgba(0, 0, 0, 0.55)',
                transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg)`,
                transformOrigin: '50% 95%',
                padding: '26px 24px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                zIndex: 10 + i,
              }}
            >
              {/* Sweeping glossy sheen */}
              <div
                style={{
                  position: 'absolute',
                  top: -80,
                  left: sheenPos - i * 45,
                  width: 90,
                  height: 580,
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)',
                  transform: 'rotate(20deg)',
                  pointerEvents: 'none',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: theme.accent, fontFamily: 'monospace', fontSize: 16, fontWeight: 800 }}>
                  {theme.name}
                </span>
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: `1.5px solid ${theme.border}`,
                    color: theme.accent,
                    fontFamily: 'monospace',
                    fontSize: 15,
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {i + 1}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <EmvChipIcon size={54} gold={i % 2 === 0} />
                <ContactlessIcon color={theme.accent} size={28} />
              </div>

              <div>
                <FitText text={pt} baseSize={21} minSize={15} maxLines={4} lineHeight={1.28} color="#FFFFFF" fontWeight={700} align="left" />
              </div>

              <div style={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace', fontSize: 14, letterSpacing: 2 }}>
                •••• 0{i + 1}88
              </div>
            </div>
          );
        })}
      </div>

      {/* Crisp Readable Card Legend Grid Below the Fan (strictly above CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: 855,
          left: 64,
          right: 64,
          display: 'grid',
          gridTemplateColumns: count <= 2 ? '1fr' : '1fr 1fr',
          gap: 16,
        }}
      >
        {points.map((pt, i) => {
          const theme = cardThemes[i % cardThemes.length];
          const p = stagger(i, localFrame, 6, 12, 14);
          return (
            <div
              key={i}
              style={{
                minHeight: 126,
                padding: '15px 18px',
                borderRadius: 22,
                background: 'rgba(22, 28, 44, 0.9)',
                border: `1.8px solid ${theme.border}`,
                borderTop: `5px solid ${theme.border}`,
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [24, 0])}px)`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: theme.accent, fontFamily: 'monospace', fontSize: 16, fontWeight: 800 }}>
                  CARD 0{i + 1} · {theme.name}
                </span>
                <span style={{ color: theme.border, fontSize: 18 }}>◆</span>
              </div>
              <FitText text={pt} baseSize={21} minSize={16} maxLines={3} lineHeight={1.28} color={pal.fg} fontWeight={700} align="left" />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-12 Shot 3: scratch-reveal — บัตรขูดฟอยล์สีเงิน/ทองค่อยๆ ขูดเผยตัวเลขหรือรางวัลใหญ่ */
const ScratchRevealShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = getCardFlipPalette(tokens);
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetric(scene, sceneIndex);
  const bullets = extractShortPoints(scene, 3);

  const cardEnter = spring({ frame: localFrame, fps, config: { damping: 15, stiffness: 125 } });
  // Scratch progress from frame 8 to frame 44 (0..1)
  const scratchP = Math.max(0, Math.min(1, (localFrame - 8) / 36));
  const revealWidth = interpolate(scratchP, [0, 1], [0, 740]);
  const coinX = 170 + revealWidth;
  const coinY = 605 + Math.sin(scratchP * Math.PI * 6) * 42;
  const coinVisible = scratchP > 0.02 && scratchP < 0.98;
  const sparkleScale = spring({ frame: Math.max(0, localFrame - 34), fps, config: { damping: 10, stiffness: 180 } });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <CardStudioBackdrop tokens={tokens} localFrame={localFrame} uid="scratch" glowColor="rgba(245, 197, 99, 0.28)" />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 88,
          left: 68,
          right: 68,
          textAlign: 'center',
          opacity: appear(localFrame, 2, 14),
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '7px 22px',
            borderRadius: 999,
            background: 'rgba(245, 197, 99, 0.16)',
            border: `1.5px solid ${pal.gold}`,
            color: pal.gold,
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          {t.badge || 'ขูดบัตรรับสิทธิ์พิเศษ'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={30} maxLines={2} color={pal.fg} fontWeight={800} align="center" />
      </div>

      {/* Physical Scratch Card Frame */}
      <div
        style={{
          position: 'absolute',
          top: 318,
          left: 84,
          width: 912,
          height: 500,
          borderRadius: 36,
          background: 'linear-gradient(145deg, #1F2937 0%, #0F172A 100%)',
          border: `3px solid ${pal.gold}`,
          boxShadow: '0 32px 76px rgba(0, 0, 0, 0.65), 0 0 46px rgba(245, 197, 99, 0.22)',
          transform: `scale(${cardEnter})`,
          overflow: 'hidden',
        }}
      >
        {/* Card Top Strip */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '18px 40px 12px',
          }}
        >
          <span style={{ color: pal.gold, fontFamily: 'monospace', fontSize: 20, fontWeight: 800, letterSpacing: 2.5 }}>
            ★ GOLDEN SCRATCH PASS
          </span>
          <span style={{ color: pal.muted, fontFamily: 'monospace', fontSize: 18 }}>
            NO. 00{sceneIndex + 1}92
          </span>
        </div>

        {/* Scratch Window Area */}
        <div
          style={{
            position: 'relative',
            margin: '6px 46px 14px',
            height: 278,
            borderRadius: 24,
            overflow: 'hidden',
            background: 'radial-gradient(circle at 50% 45%, #FFFBEB 0%, #FDE68A 52%, #F59E0B 100%)',
            border: '3px dashed rgba(146, 64, 14, 0.45)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '18px 32px',
          }}
        >
          {/* Revealed Prize Content Underneath */}
          <div style={{ color: '#78350F', fontFamily: THAI_FONT_FAMILY, fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
            {metric.unit || 'รางวัล / ข้อเสนอที่เปิดได้'}
          </div>
          <FitText text={metric.big} baseSize={98} minSize={46} maxLines={1} color="#1E1B18" fontWeight={900} align="center" />
          <div style={{ marginTop: 6, maxWidth: 680 }}>
            <FitText text={metric.label} baseSize={26} minSize={18} maxLines={2} lineHeight={1.28} color="#451A03" fontWeight={700} align="center" />
          </div>

          {/* Metallic Silver-Foil Overlay that shrinks from left-to-right as coin scratches */}
          {scratchP < 0.99 ? (
            <div
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                width: `${Math.max(0, (1 - scratchP) * 100)}%`,
                background:
                  'repeating-linear-gradient(135deg, #CBD5E1 0px, #94A3B8 14px, #E2E8F0 28px, #64748B 42px)',
                boxShadow: '-8px 0 22px rgba(0,0,0,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  color: '#1E293B',
                  fontFamily: 'monospace',
                  fontSize: 26,
                  fontWeight: 900,
                  letterSpacing: 4,
                  whiteSpace: 'nowrap',
                  opacity: 0.72,
                }}
              >
                SCRATCH HERE ✦
              </span>
            </div>
          ) : null}
        </div>

        {/* Bottom Card Footer */}
        <div
          style={{
            padding: '8px 46px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ color: pal.muted, fontFamily: THAI_FONT_FAMILY, fontSize: 21, fontWeight: 600 }}>
            {scratchP >= 0.95 ? 'เปิดเผยสิทธิ์เรียบร้อยแล้ว!' : 'กำลังขูดฟอยล์เปิดเผยข้อเสนอ...'}
          </span>
          <span style={{ color: pal.gold, fontFamily: 'monospace', fontSize: 20, fontWeight: 800 }}>
            {Math.round(scratchP * 100)}%
          </span>
        </div>
      </div>

      {/* Animated Scratching Gold Coin + Celebratory Sparkles SVG */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {coinVisible ? (
          <g transform={`translate(${coinX}, ${coinY}) rotate(${localFrame * 6})`}>
            <circle cx={0} cy={0} r={46} fill="#F5C563" stroke="#FEF3C7" strokeWidth={5} />
            <circle cx={0} cy={0} r={34} fill="none" stroke="#B45309" strokeWidth={2.5} strokeDasharray="6 4" />
            <text x={0} y={10} textAnchor="middle" fill="#78350F" fontSize={30} fontWeight={900} fontFamily="monospace">
              ฿
            </text>
          </g>
        ) : null}

        {/* Sparkle bursts once revealed */}
        {[
          [140, 395],
          [940, 415],
          [160, 848],
          [920, 828],
        ].map(([sx, sy], idx) => (
          <g
            key={idx}
            transform={`translate(${sx}, ${sy}) scale(${sparkleScale * (0.85 + 0.2 * Math.sin(localFrame * 0.2 + idx))})`}
            opacity={sparkleScale}
          >
            <path d="M 0 -24 L 6 -6 L 24 0 L 6 6 L 0 24 L -6 6 L -24 0 L -6 -6 Z" fill={idx % 2 === 0 ? pal.gold : pal.cyan} />
          </g>
        ))}
      </svg>

      {/* Supporting Details Below Card (strictly above CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: 856,
          left: 84,
          right: 84,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {bullets.slice(0, 3).map((b, i) => {
          const p = stagger(i, localFrame, 6, 20, 14);
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                minHeight: 74,
                padding: '14px 20px',
                borderRadius: 20,
                background: 'rgba(30, 36, 54, 0.85)',
                border: `1.5px solid ${pal.border}`,
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [22, 0])}px)`,
              }}
            >
              <span style={{ color: pal.gold, fontSize: 24, flexShrink: 0 }}>✦</span>
              <div style={{ flex: 1 }}>
                <FitText text={b} baseSize={22} minSize={17} maxLines={3} lineHeight={1.28} color={pal.fg} fontWeight={700} align="left" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-12 Shot 4: compare-cards — บัตรสองใบวางเทียบกันซ้าย-ขวา พร้อมป้าย VS และไฮไลต์ใบที่คุ้มกว่า */
const CompareCardsShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = getCardFlipPalette(tokens);
  const t = sceneTexts(scene);
  const cmp = extractComparePair(scene);

  const leftSpring = spring({ frame: Math.max(0, localFrame - 4), fps, config: { damping: 15, stiffness: 125 } });
  const rightSpring = spring({ frame: Math.max(0, localFrame - 10), fps, config: { damping: 14, stiffness: 125 } });
  const vsSpring = spring({ frame: Math.max(0, localFrame - 16), fps, config: { damping: 11, stiffness: 170 } });
  const sheenPos = interpolate((localFrame % 85) / 85, [0, 1], [-180, 620]);

  const leftWins = cmp.winner === 'left';
  const rightWins = cmp.winner === 'right';

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <CardStudioBackdrop tokens={tokens} localFrame={localFrame} uid="compare" glowColor="rgba(56, 189, 248, 0.2)" />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 84,
          left: 68,
          right: 68,
          textAlign: 'center',
          opacity: appear(localFrame, 2, 14),
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '7px 22px',
            borderRadius: 999,
            background: 'rgba(245, 197, 99, 0.14)',
            border: `1.5px solid ${pal.gold}`,
            color: pal.gold,
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          {t.badge || 'เปรียบเทียบบัตร 2 ระดับ'}
        </div>
        <FitText text={t.title} baseSize={52} minSize={30} maxLines={2} color={pal.fg} fontWeight={800} align="center" />
      </div>

      {/* Side-by-Side Comparison Cards (strictly ends ≤ CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: 336,
          left: 48,
          right: 48,
          height: CONTENT_BOTTOM - 336 - 16,
          display: 'flex',
          gap: 28,
          alignItems: 'stretch',
        }}
      >
        {/* LEFT CARD */}
        <div
          style={{
            position: 'relative',
            flex: 1,
            borderRadius: 32,
            overflow: 'hidden',
            background: leftWins
              ? 'linear-gradient(160deg, #1E3A5F 0%, #0F172A 100%)'
              : 'linear-gradient(160deg, #242A38 0%, #111520 100%)',
            border: `2.5px solid ${leftWins ? pal.gold : '#475569'}`,
            boxShadow: leftWins ? '0 24px 60px rgba(245, 197, 99, 0.24)' : '0 20px 44px rgba(0,0,0,0.45)',
            padding: '26px 24px',
            display: 'flex',
            flexDirection: 'column',
            transform: `translateX(${interpolate(leftSpring, [0, 1], [-60, 0])}px) scale(${leftSpring})`,
            opacity: leftSpring,
          }}
        >
          {/* Mini card visual header */}
          <div
            style={{
              height: 200,
              flexShrink: 0,
              borderRadius: 22,
              background: leftWins
                ? 'linear-gradient(135deg, #B98324 0%, #78350F 100%)'
                : 'linear-gradient(135deg, #334155 0%, #1E293B 100%)',
              border: `1.5px solid ${leftWins ? pal.gold : '#64748B'}`,
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              marginBottom: 20,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#E2E8F0', fontFamily: 'monospace', fontSize: 16, fontWeight: 800 }}>
                {leftWins ? '★ BEST CHOICE' : 'TIER A'}
              </span>
              <ContactlessIcon color="rgba(255,255,255,0.65)" size={26} />
            </div>
            <EmvChipIcon size={50} gold={leftWins} />
            <FitText text={cmp.leftTitle} baseSize={28} minSize={20} maxLines={2} lineHeight={1.28} color="#FFFFFF" fontWeight={800} align="left" />
          </div>

          {/* Left Items List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
            {cmp.leftItems.map((item, i) => {
              const p = stagger(i, localFrame, 6, 12, 14);
              return (
                <div
                  key={i}
                  style={{
                    padding: '15px 16px',
                    borderRadius: 18,
                    background: 'rgba(15, 23, 42, 0.58)',
                    border: '1px solid rgba(148, 163, 184, 0.25)',
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    opacity: p,
                  }}
                >
                  <span style={{ color: leftWins ? pal.emerald : pal.muted, fontSize: 22, fontWeight: 900 }}>
                    {leftWins ? '✓' : '•'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <FitText text={item} baseSize={21} minSize={16} maxLines={3} lineHeight={1.28} color={pal.fg} fontWeight={700} align="left" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT CARD (Highlighted / Glossy) */}
        <div
          style={{
            position: 'relative',
            flex: 1,
            borderRadius: 32,
            overflow: 'hidden',
            background: rightWins
              ? 'linear-gradient(160deg, #1E293B 0%, #0F172A 55%, #1E1B4B 100%)'
              : 'linear-gradient(160deg, #242A38 0%, #111520 100%)',
            border: `2.8px solid ${rightWins ? pal.gold : '#475569'}`,
            boxShadow: rightWins ? '0 26px 64px rgba(245, 197, 99, 0.28)' : '0 20px 44px rgba(0,0,0,0.45)',
            padding: '26px 24px',
            display: 'flex',
            flexDirection: 'column',
            transform: `translateX(${interpolate(rightSpring, [0, 1], [60, 0])}px) scale(${rightSpring})`,
            opacity: rightSpring,
          }}
        >
          {/* Animated glossy sheen on winning card */}
          {rightWins ? (
            <div
              style={{
                position: 'absolute',
                top: -120,
                left: sheenPos,
                width: 110,
                height: 1260,
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent)',
                transform: 'rotate(18deg)',
                pointerEvents: 'none',
              }}
            />
          ) : null}

          {/* Mini card visual header */}
          <div
            style={{
              height: 200,
              flexShrink: 0,
              borderRadius: 22,
              background: rightWins
                ? 'linear-gradient(135deg, #D97706 0%, #92400E 50%, #451A03 100%)'
                : 'linear-gradient(135deg, #334155 0%, #1E293B 100%)',
              border: `2px solid ${rightWins ? pal.gold : '#64748B'}`,
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              marginBottom: 20,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#FEF3C7', fontFamily: 'monospace', fontSize: 16, fontWeight: 900 }}>
                {rightWins ? '★ RECOMMENDED' : 'TIER B'}
              </span>
              <ContactlessIcon color="#FEF3C7" size={26} />
            </div>
            <EmvChipIcon size={50} gold />
            <FitText text={cmp.rightTitle} baseSize={28} minSize={20} maxLines={2} lineHeight={1.28} color="#FFFFFF" fontWeight={800} align="left" />
          </div>

          {/* Right Items List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
            {cmp.rightItems.map((item, i) => {
              const p = stagger(i, localFrame, 6, 16, 14);
              return (
                <div
                  key={i}
                  style={{
                    padding: '15px 16px',
                    borderRadius: 18,
                    background: 'rgba(245, 197, 99, 0.11)',
                    border: `1.5px solid ${rightWins ? 'rgba(245, 197, 99, 0.48)' : 'rgba(148, 163, 184, 0.25)'}`,
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    opacity: p,
                  }}
                >
                  <span style={{ color: pal.emerald, fontSize: 22, fontWeight: 900 }}>✓</span>
                  <div style={{ flex: 1 }}>
                    <FitText text={item} baseSize={21} minSize={16} maxLines={3} lineHeight={1.28} color="#FFFFFF" fontWeight={700} align="left" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Glowing Center VS Medallion */}
      <div
        style={{
          position: 'absolute',
          top: 432,
          left: STAGE_W / 2 - 44,
          width: 88,
          height: 88,
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${pal.gold}, ${pal.goldDark})`,
          border: '4px solid #0F172A',
          boxShadow: '0 0 36px rgba(245, 197, 99, 0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#0F172A',
          fontFamily: 'monospace',
          fontSize: 30,
          fontWeight: 900,
          transform: `scale(${vsSpring})`,
          zIndex: 30,
        }}
      >
        VS
      </div>
    </div>
  );
};

// ============================================================================
// EXPORT BATCH_E: look-9 (Blue Grid), look-10 (Product turntable), look-12 (Card flip)
// ============================================================================

export const BATCH_E: StyleDirectorDef[] = [
  {
    styleId: 'look-9',
    shots: {
      'gear-mechanism': GearMechanismShot,
      cutaway: CutawayShot,
      'flow-schematic': FlowSchematicShot,
      'spec-sheet': SpecSheetShot,
    },
    shotLabels: {
      'gear-mechanism': 'เฟืองกลไกหลายตัวหมุนประสานกันพร้อมป้ายชื่อแต่ละประเด็น',
      cutaway: 'ภาพตัดขวางกลไกแบบพิมพ์เขียวพร้อมลายแรเงาและลูกศรชี้ส่วนประกอบ',
      'flow-schematic': 'ผังวงจรและท่อส่งสัญญาณไหลทีละขั้นพร้อมจุดวาล์ว',
      'spec-sheet': 'ตารางสเปกเทคนิคพร้อมเส้นบอกขนาดและตัวเลขหลักใหญ่',
    },
    infer: (scene) => {
      const text = haystackOf(scene);
      if (scene.stat || SPEC_RE.test(text) || /(?:%|เท่า|ล้าน|อันดับ|\d+\+)/.test(text)) {
        return 'spec-sheet';
      }
      if (STEP_RE.test(text) || (Array.isArray(scene.steps) && scene.steps.length > 0)) {
        return 'flow-schematic';
      }
      if (/(?:ผ่า|ตัดขวาง|โครงสร้าง|ภายใน|ส่วนประกอบ|แกน|ชั้น)/.test(text) || SUMMARY_RE.test(text)) {
        return 'cutaway';
      }
      if ((Array.isArray(scene.bullets) && scene.bullets.length >= 2) || /(?:กลไก|เฟือง|หมุน|ขับเคลื่อน|ทำงาน)/.test(text)) {
        return 'gear-mechanism';
      }
      return null;
    },
  },
  {
    styleId: 'look-10',
    shots: {
      'turntable-spin': TurntableSpinShot,
      'hotspot-callouts': HotspotCalloutsShot,
      'exploded-features': ExplodedFeaturesShot,
      'price-reveal': PriceRevealShot,
    },
    shotLabels: {
      'turntable-spin': 'แท่นหมุนโชว์สินค้า 360 องศาในสตูดิโอพร้อมแสงริมไลต์และเงาตกกระทบ',
      'hotspot-callouts': 'จุดฮอตสปอตบนตัวสินค้าพร้อมเส้นชี้จุดเด่นรอบชิ้นงาน',
      'exploded-features': 'แยกชิ้นส่วนสินค้าเป็นชั้นลอยแนวตั้งพร้อมคำอธิบายแต่ละชั้น',
      'price-reveal': 'สปอตไลต์ส่องตัวสินค้าพร้อมป้ายราคาหรือตัวเลขหลักขนาดใหญ่',
    },
    infer: (scene) => {
      const text = haystackOf(scene);
      if (scene.stat || PRICE_RE.test(text) || /(?:%|เท่า|บาท|฿)/.test(text)) {
        return 'price-reveal';
      }
      if (STEP_RE.test(text) || (Array.isArray(scene.steps) && scene.steps.length > 0) || /(?:ชั้น|แยกส่วน|ประกอบ|โครงสร้าง|วัสดุ)/.test(text)) {
        return 'exploded-features';
      }
      if ((Array.isArray(scene.bullets) && scene.bullets.length >= 2) || /(?:จุดเด่น|ฟีเจอร์|คุณสมบัติ|ฟังก์ชัน|ข้อดี)/.test(text)) {
        return 'hotspot-callouts';
      }
      if (/(?:เปิดตัว|สินค้า|ดีไซน์|รอบด้าน|หมุน|รุ่นใหม่)/.test(text)) {
        return 'turntable-spin';
      }
      return null;
    },
  },
  {
    styleId: 'look-12',
    shots: {
      'card-flip': CardFlipShot,
      'card-fan': CardFanShot,
      'scratch-reveal': ScratchRevealShot,
      'compare-cards': CompareCardsShot,
    },
    shotLabels: {
      'card-flip': 'บัตรพรีเมียมพลิกจากด้านหน้าไปด้านหลังเผยข้อความและข้อเสนอหลัก',
      'card-fan': 'บัตรสิทธิพิเศษหลายใบกางออกเป็นพัด แต่ละใบแสดงหนึ่งประเด็นสำคัญ',
      'scratch-reveal': 'บัตรขูดฟอยล์สีเงินค่อยๆ ขูดเผยตัวเลขหรือรางวัลใหญ่ด้านใน',
      'compare-cards': 'บัตรสองใบวางเทียบกันซ้าย-ขวาพร้อมป้าย VS และไฮไลต์ใบที่คุ้มกว่า',
    },
    infer: (scene) => {
      const text = haystackOf(scene);
      if (scene.compare || COMPARE_RE.test(text)) {
        return 'compare-cards';
      }
      if (scene.stat || PRICE_RE.test(text) || /(?:ขูด|ลุ้น|รางวัล|%|บาท|฿)/.test(text)) {
        return 'scratch-reveal';
      }
      if ((Array.isArray(scene.bullets) && scene.bullets.length >= 2) || (Array.isArray(scene.steps) && scene.steps.length > 0)) {
        return 'card-fan';
      }
      if (/(?:พลิก|เปิดเผย|ความลับ|ข้อเสนอ|เฉลย|บัตร)/.test(text) || SUMMARY_RE.test(text)) {
        return 'card-flip';
      }
      return null;
    },
  },
];
