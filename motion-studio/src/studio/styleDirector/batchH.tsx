import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import { contrastRatio, hexToRgba, type StudioScene } from '../types';
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
// SHARED HELPERS FOR BATCH H (look-19, look-20, look-21)
// Pure, Deterministic, Inline SVG/CSS Only, Zero External Assets
// Strict Safe Area: x in [48, 1032], y in [110, 1420] (CONTENT_BOTTOM = 1420)
// ============================================================================

const CONTENT_BOTTOM = SAFE_BOTTOM - 120; // 1420
const FONT_THAI = THAI_FONT_FAMILY;
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const H_COMPARE_RE = /(?:เทียบ|เปรียบเทียบ|ระหว่าง|ฝั่ง|ก่อน|หลัง|แบบเดิม|แบบใหม่|ต่างกัน|vs|ขาไป|ขากลับ)/i;
const H_STEP_RE = /(?:ขั้นตอน|สเต็ป|ลำดับ|วิธี|เส้นทาง|สายพาน|โฟลว์|กระบวนการ|ซัพพลาย|ส่งมอบ|step)/i;
const H_LAYER_RE = /(?:ชั้น|เลเยอร์|โครงสร้าง|สถาปัตยกรรม|เบื้องหลัง|องค์ประกอบ|ระบบพื้นฐาน|stack|layer)/i;
const H_SUMMARY_RE = /(?:สรุป|สำคัญ|ไฮไลต์|ประโยคจำ|จำไว้|หัวใจ|แก่น|บทเรียน|คำคม|ผลลัพธ์)/i;
const H_STAT_RE = /(?:สถิติ|ยอด|เติบโต|เพิ่มขึ้น|ลดลง|ตัวเลข|อันดับ|ล้าน|แสน|พัน|%|เท่า|\d+x)/i;
const H_HUB_RE = /(?:เครือข่าย|ฮับ|ศูนย์กลาง|กระจาย|เชื่อมต่อ|ทั่วโลก|ภูมิภาค|ประเทศ|เมือง|router|hub)/i;
const H_WEB_RE = /(?:เว็บ|ฟีเจอร์|แอป|คลิก|เบราว์เซอร์|หน้าจอ|เครื่องมือ|ซอฟต์แวร์|แพลตฟอร์ม|saas|app)/i;
const H_DASH_RE = /(?:แดชบอร์ด|กราฟ|วิเคราะห์|มอนิเตอร์|เรียลไทม์|รายงาน|dashboard|metric)/i;

interface PaletteH {
  bg: string;
  bg2: string;
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  accent3: string;
  border: string;
}

function safeColor(candidate: unknown, fallback: string): string {
  return typeof candidate === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(candidate.trim())
    ? candidate.trim()
    : fallback;
}

function resolvePaletteH(tokens: any, defaults: PaletteH): PaletteH {
  const p = tokens?.palette || {};
  const bg = safeColor(p.bg, defaults.bg);
  const bg2 = safeColor(p.bg2 || p.bgSecondary, defaults.bg2);
  const surface = safeColor(p.surface || p.cardBg, defaults.surface);
  let fg = safeColor(p.fg || p.text, defaults.fg);
  if (contrastRatio(fg, bg) < 4.5) fg = defaults.fg;

  let muted = safeColor(p.muted, defaults.muted);
  if (contrastRatio(muted, bg) < 4.2) muted = defaults.muted;

  let accent = safeColor(p.accentReadable || p.accent, defaults.accent);
  if (contrastRatio(accent, bg) < 4.5) accent = defaults.accent;

  let accent2 = safeColor(p.accent2, defaults.accent2);
  if (contrastRatio(accent2, bg) < 4.5 || accent2.toUpperCase() === accent.toUpperCase()) {
    accent2 = defaults.accent2;
  }

  const border = safeColor(p.border, defaults.border);
  return {
    bg,
    bg2,
    surface,
    fg,
    muted,
    accent,
    accent2,
    accent3: defaults.accent3,
    border,
  };
}

/** Deterministic pseudo-random [0, 1) from integer seed */
function hashSeed(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function haystackH(scene: StudioScene): string {
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

function extractPointsH(scene: StudioScene, max = 4): string[] {
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

function extractPrimaryMetricH(
  scene: StudioScene,
  sceneIndex: number,
  fallbackBig = '99.9%',
  fallbackUnit = 'GLOBAL SYNC',
): { big: string; unit: string; label: string; delta: string; progress: number } {
  const t = sceneTexts(scene);
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const rawVal = String(scene.stat.value).trim();
    const prefix = String(scene.stat.prefix || '').trim();
    const suffix = String(scene.stat.suffix || '').trim();
    const big = `${prefix}${rawVal}${suffix}`.trim();
    return {
      big,
      unit: String(scene.stat.unit || '').trim() || fallbackUnit,
      label: String(scene.stat.label || t.subtitle || t.title).trim(),
      delta: String(scene.stat.delta || '+42%').trim(),
      progress: typeof scene.stat.progress === 'number' ? clamp01(scene.stat.progress / 100) : 0.84,
    };
  }
  if (t.numbers.length > 0) {
    return {
      big: t.numbers[0],
      unit: t.badge || fallbackUnit,
      label: t.subtitle || t.title,
      delta: t.numbers[1] || '+36%',
      progress: 0.78,
    };
  }
  return {
    big: fallbackBig,
    unit: t.badge || `NODE 0${sceneIndex + 1}`,
    label: t.subtitle || t.title,
    delta: '+28%',
    progress: 0.76,
  };
}

function extractComparePairH(scene: StudioScene): {
  leftTitle: string;
  rightTitle: string;
  leftItems: string[];
  rightItems: string[];
  leftBadge: string;
  rightBadge: string;
} {
  const t = sceneTexts(scene);
  if (scene.compare) {
    const leftItems = (scene.compare.leftItems || []).filter(Boolean).slice(0, 3);
    const rightItems = (scene.compare.rightItems || []).filter(Boolean).slice(0, 3);
    return {
      leftTitle: scene.compare.leftTitle || scene.compare.leftLabel || 'เส้นทางเดิม',
      rightTitle: scene.compare.rightTitle || scene.compare.rightLabel || 'เส้นทางใหม่',
      leftItems: leftItems.length > 0 ? leftItems : [t.subtitle || t.title],
      rightItems: rightItems.length > 0 ? rightItems : [t.title],
      leftBadge: scene.compare.leftLabel || t.numbers[0] || 'MODE A',
      rightBadge: scene.compare.rightLabel || t.numbers[1] || 'MODE B',
    };
  }
  const pts = extractPointsH(scene, 4);
  const half = Math.max(1, Math.ceil(pts.length / 2));
  const leftItems = pts.slice(0, half);
  const rightItems = pts.slice(half).length > 0 ? pts.slice(half) : [t.subtitle || t.title];
  return {
    leftTitle: 'จุดตั้งต้น / ฝั่งเดิม',
    rightTitle: 'เป้าหมาย / ฝั่งใหม่',
    leftItems,
    rightItems,
    leftBadge: t.numbers[0] || 'BASE',
    rightBadge: t.numbers[1] || 'FAST',
  };
}

/** Evaluate point on quadratic Bezier curve at parameter t in [0, 1] */
function quadBezierPoint(
  p0: [number, number],
  ctrl: [number, number],
  p1: [number, number],
  t: number,
): [number, number] {
  const u = 1 - t;
  const x = u * u * p0[0] + 2 * u * t * ctrl[0] + t * t * p1[0];
  const y = u * u * p0[1] + 2 * u * t * ctrl[1] + t * t * p1[1];
  return [x, y];
}

/** Evaluate point along multi-segment polyline at normalized progress t in [0, 1] */
function polylinePoint(pts: Array<[number, number]>, t: number): [number, number] {
  if (pts.length === 0) return [0, 0];
  if (pts.length === 1) return pts[0];
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const d = Math.hypot(dx, dy);
    segLens.push(d);
    total += d;
  }
  if (total <= 0) return pts[0];
  const target = clamp01(t) * total;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    const len = segLens[i];
    if (acc + len >= target || i === segLens.length - 1) {
      const localT = len > 0 ? clamp01((target - acc) / len) : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * localT,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * localT,
      ];
    }
    acc += len;
  }
  return pts[pts.length - 1];
}

/** Parse numeric magnitude from string for relative bar/tower scaling */
function parseMagnitudeH(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/,/g, '').trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  if (/ล้าน|M\b/i.test(s)) return val * 1_000_000;
  if (/แสน/.test(s)) return val * 100_000;
  if (/หมื่น/.test(s)) return val * 10_000;
  if (/พัน|K\b/i.test(s)) return val * 1_000;
  return val;
}

/** Shared safe header component positioned inside y >= 112 and x in [52, 1028] */
const StageHeader: React.FC<{
  badge?: string;
  title: string;
  subtitle?: string;
  fg: string;
  muted: string;
  accent: string;
  localFrame: number;
  compact?: boolean;
  badgePrefix?: string;
}> = ({ badge, title, subtitle, fg, muted, accent, localFrame, compact = false, badgePrefix }) => {
  const p = appear(localFrame, 1, 13);
  return (
    <div
      style={{
        position: 'absolute',
        top: 112,
        left: 52,
        right: 52,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [18, 0])}px)`,
        zIndex: 8,
      }}
    >
      {badge ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: compact ? 8 : 10 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 18px',
              borderRadius: 999,
              background: hexToRgba(accent, 0.14),
              border: `1.5px solid ${hexToRgba(accent, 0.52)}`,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: accent,
                boxShadow: `0 0 10px ${accent}`,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: FONT_THAI,
                fontSize: 20,
                fontWeight: 700,
                color: '#F8FAFC',
                lineHeight: 1.3,
              }}
            >
              {badgePrefix ? `${badgePrefix} ${badge}` : badge}
            </span>
          </div>
        </div>
      ) : null}
      <FitText
        text={title}
        baseSize={compact ? 48 : 54}
        minSize={32}
        maxLines={2}
        color={fg}
        fontWeight={800}
        lineHeight={1.28}
      />
      {subtitle ? (
        <div style={{ marginTop: compact ? 6 : 8 }}>
          <FitText
            text={subtitle}
            baseSize={compact ? 22 : 24}
            minSize={17}
            maxLines={2}
            color={muted}
            fontWeight={500}
            lineHeight={1.32}
          />
        </div>
      ) : null}
    </div>
  );
};

// ============================================================================
// STYLE 1: look-19 — GLOBE ARCS (เส้นโค้งบนลูกโลก)
// Space Telemetry Command • 3D-Shaded Data Globe • Luminous Bezier Arcs
// ============================================================================

const GLOBE_DEFAULTS: PaletteH = {
  bg: '#070D1D',
  bg2: '#0F172A',
  surface: '#111C34',
  fg: '#F8FAFC',
  muted: '#CBD5E1',
  accent: '#38BDF8',
  accent2: '#F59E0B',
  accent3: '#34D399',
  border: '#1E3A5F',
};

const GlobeSpaceBackdrop: React.FC<{
  pal: PaletteH;
  localFrame: number;
  glowY?: number;
  uid: string;
}> = ({ pal, localFrame, glowY = 620, uid }) => {
  const pulse = 0.5 + 0.5 * Math.sin(localFrame * 0.06);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 860px 660px at 540px ${glowY}px, ${hexToRgba(pal.accent, 0.16)} 0%, ${pal.bg2} 46%, ${pal.bg} 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id={`${uid}-nebula`} cx="50%" cy="35%" r="55%">
            <stop offset="0%" stopColor={pal.accent} stopOpacity={0.14 + pulse * 0.05} />
            <stop offset="55%" stopColor={pal.accent2} stopOpacity={0.04} />
            <stop offset="100%" stopColor={pal.bg} stopOpacity={0} />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={STAGE_W} height={STAGE_H} fill={`url(#${uid}-nebula)`} />
        {/* Fine telemetry grid */}
        {Array.from({ length: 10 }).map((_, i) => (
          <line
            key={`gv-${i}`}
            x1={108 * (i + 1)}
            y1={100}
            x2={108 * (i + 1)}
            y2={CONTENT_BOTTOM}
            stroke={pal.accent}
            strokeOpacity={0.06}
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: 11 }).map((_, i) => (
          <line
            key={`gh-${i}`}
            x1={48}
            y1={120 + i * 125}
            x2={1032}
            y2={120 + i * 125}
            stroke={pal.accent}
            strokeOpacity={0.06}
            strokeWidth={1}
          />
        ))}
        {/* Deterministic twinkling starfield */}
        {Array.from({ length: 46 }).map((_, i) => {
          const sx = 30 + hashSeed(i * 19 + 5) * (STAGE_W - 60);
          const sy = 90 + hashSeed(i * 31 + 11) * (CONTENT_BOTTOM - 100);
          const sr = 1.2 + hashSeed(i * 43 + 3) * 2.1;
          const tw = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(localFrame * 0.09 + i * 1.7));
          return <circle key={`st-${i}`} cx={sx} cy={sy} r={sr} fill="#E0F2FE" opacity={tw} />;
        })}
        {/* Subtle orbital frame brackets inside safe margin */}
        <path
          d="M 52 152 L 52 114 L 92 114 M 988 114 L 1028 114 L 1028 152 M 52 1372 L 52 1410 L 92 1410 M 988 1410 L 1028 1410 L 1028 1372"
          fill="none"
          stroke={pal.accent}
          strokeOpacity={0.32}
          strokeWidth={2}
        />
      </svg>
    </div>
  );
};

/** Reusable 3D-shaded dotted globe SVG group */
const DottedGlobeGroup: React.FC<{
  cx: number;
  cy: number;
  r: number;
  localFrame: number;
  uid: string;
  accent: string;
  accent2: string;
}> = ({ cx, cy, r, localFrame, uid, accent, accent2 }) => {
  const rotShift = Math.sin(localFrame * 0.014) * 0.09;
  const orbitDeg = (localFrame * 0.45) % 360;

  const landClusters: Array<[number, number, number, number]> = [
    [0.24, -0.22, 0.34, 0.24],
    [-0.18, -0.34, 0.25, 0.16],
    [-0.12, 0.14, 0.24, 0.30],
    [0.44, 0.34, 0.20, 0.16],
    [-0.56, -0.16, 0.22, 0.28],
  ];

  const dots: Array<{ x: number; y: number; rad: number; op: number; tint: string }> = [];
  for (let i = 0; i < 180; i++) {
    const c = landClusters[i % landClusters.length];
    const u = (hashSeed(i * 17 + 3) * 2 - 1) * c[2];
    const v = (hashSeed(i * 29 + 7) * 2 - 1) * c[3];
    if ((u * u) / (c[2] * c[2]) + (v * v) / (c[3] * c[3]) > 1) continue;
    const nx = c[0] + u + rotShift;
    const ny = c[1] + v;
    const d2 = nx * nx + ny * ny;
    if (d2 < 0.86) {
      dots.push({
        x: cx + nx * r,
        y: cy + ny * r,
        rad: 2.1 + (1 - d2) * 1.3,
        op: 0.38 + (1 - d2) * 0.56,
        tint: i % 11 === 0 ? accent : '#DCEAFE',
      });
    }
  }

  return (
    <g>
      <defs>
        <radialGradient id={`${uid}-ocean`} cx="36%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1A3562" />
          <stop offset="56%" stopColor="#0D1C3A" />
          <stop offset="100%" stopColor="#050B18" />
        </radialGradient>
        <radialGradient id={`${uid}-atmo`} cx="50%" cy="50%" r="50%">
          <stop offset="76%" stopColor={accent} stopOpacity="0" />
          <stop offset="93%" stopColor={accent} stopOpacity="0.24" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Atmospheric outer halo */}
      <circle cx={cx} cy={cy} r={r * 1.16} fill={`url(#${uid}-atmo)`} />
      {/* Slowly rotating orbital telemetry ring */}
      <g transform={`rotate(${orbitDeg.toFixed(2)} ${cx} ${cy})`}>
        <circle
          cx={cx}
          cy={cy}
          r={r + 22}
          fill="none"
          stroke={accent}
          strokeOpacity={0.28}
          strokeWidth={1.6}
          strokeDasharray="10 14"
        />
        <circle cx={cx + r + 22} cy={cy} r={4.5} fill={accent2} />
        <circle cx={cx - r - 22} cy={cy} r={3.5} fill={accent} />
      </g>

      {/* Main 3D-shaded ocean sphere */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={`url(#${uid}-ocean)`}
        stroke={accent}
        strokeOpacity={0.72}
        strokeWidth={2.5}
      />

      {/* Latitude ellipses */}
      {[-0.64, -0.32, 0, 0.32, 0.64].map((f) => {
        const dy = f * r;
        const rx = Math.sqrt(Math.max(1, r * r - dy * dy));
        return (
          <ellipse
            key={`lat-${f}`}
            cx={cx}
            cy={cy + dy}
            rx={rx}
            ry={rx * 0.17}
            fill="none"
            stroke={accent}
            strokeOpacity={0.18}
            strokeWidth={1.1}
          />
        );
      })}

      {/* Longitude ellipses with subtle animated shift */}
      {[0.24, 0.56, 0.84].map((f, idx) => {
        const shift = Math.sin(localFrame * 0.015 + idx) * 0.06;
        const rx = Math.max(12, r * (f + shift));
        return (
          <ellipse
            key={`lon-${idx}`}
            cx={cx}
            cy={cy}
            rx={rx}
            ry={r}
            fill="none"
            stroke={accent}
            strokeOpacity={0.16}
            strokeWidth={1.1}
          />
        );
      })}

      {/* Dotted landmass clusters */}
      {dots.map((d, i) => (
        <circle key={`ld-${i}`} cx={d.x} cy={d.y} r={d.rad} fill={d.tint} opacity={d.op} />
      ))}

      {/* Crisp upper-left specular rim highlight */}
      <path
        d={`M ${(cx - r * 0.72).toFixed(1)} ${(cy - r * 0.64).toFixed(1)} A ${r} ${r} 0 0 1 ${(cx + r * 0.36).toFixed(1)} ${(cy - r * 0.91).toFixed(1)}`}
        fill="none"
        stroke="#E0F2FE"
        strokeOpacity={0.42}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </g>
  );
};

/** look-19 Shot 1: globe-arcs — ลูกโลก 3 มิติหมุนช้าๆ พร้อมเส้นโค้งเรืองแสงเชื่อมศูนย์กลางโลกและการ์ดสรุป */
const GlobeArcsShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = resolvePaletteH(tokens, GLOBE_DEFAULTS);
  const t = sceneTexts(scene);
  const pts = extractPointsH(scene, 3);
  const globeSpring = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 120 } });
  const arcProg = easeOutCubic(clamp01((localFrame - 2) / 28));

  const gx = 540;
  const gy = 602;
  const R = 258;
  const hub: [number, number] = [gx + 76, gy + 16];

  const routes: Array<{
    code: string;
    to: [number, number];
    ctrl: [number, number];
    color: string;
  }> = [
    { code: 'LON', to: [gx - 122, gy - 118], ctrl: [gx - 28, gy - 238], color: pal.accent },
    { code: 'TYO', to: [gx + 186, gy - 82], ctrl: [gx + 178, gy - 178], color: pal.accent2 },
    { code: 'NYC', to: [gx - 196, gy - 18], ctrl: [gx - 80, gy - 185], color: pal.accent3 },
    { code: 'SYD', to: [gx + 148, gy + 150], ctrl: [gx + 215, gy + 64], color: '#A78BFA' },
  ];

  const cardColors = [pal.accent, pal.accent2, pal.accent3];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <GlobeSpaceBackdrop pal={pal} localFrame={localFrame} glowY={gy} uid="g19s1" />

      <StageHeader
        badge={t.badge}
        title={t.title}
        subtitle={t.subtitle}
        fg={pal.fg}
        muted={pal.muted}
        accent={pal.accent}
        localFrame={localFrame}
      />

      {/* Main 3D Globe + Luminous Bezier Arcs SVG */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <g
          transform={`translate(${gx}, ${gy}) scale(${(0.92 + globeSpring * 0.08).toFixed(4)}) translate(${-gx}, ${-gy})`}
          opacity={clamp01(globeSpring * 1.2)}
        >
          <DottedGlobeGroup
            cx={gx}
            cy={gy}
            r={R}
            localFrame={localFrame}
            uid="g19s1"
            accent={pal.accent}
            accent2={pal.accent2}
          />

          {/* Glowing Bezier arcs + moving light packets + landing radar ripples */}
          {routes.map((rt, idx) => {
            const d = `M ${hub[0]} ${hub[1]} Q ${rt.ctrl[0]} ${rt.ctrl[1]} ${rt.to[0]} ${rt.to[1]}`;
            const packetT = ((localFrame * 0.024) + idx * 0.27) % 1;
            const [px, py] = quadBezierPoint(hub, rt.ctrl, rt.to, packetT);
            const ripple = ((localFrame + idx * 11) % 36) / 36;

            return (
              <g key={rt.code}>
                <path
                  d={d}
                  fill="none"
                  stroke={rt.color}
                  strokeWidth={9}
                  strokeLinecap="round"
                  opacity={0.22}
                  strokeDasharray="600"
                  strokeDashoffset={600 * (1 - arcProg)}
                />
                <path
                  d={d}
                  fill="none"
                  stroke={rt.color}
                  strokeWidth={3.6}
                  strokeLinecap="round"
                  strokeDasharray="600"
                  strokeDashoffset={600 * (1 - arcProg)}
                />
                {/* Moving luminous signal packet */}
                {arcProg > 0.35 ? (
                  <g>
                    <circle cx={px} cy={py} r={10} fill={rt.color} opacity={0.35} />
                    <circle cx={px} cy={py} r={4.5} fill="#FFFFFF" />
                  </g>
                ) : null}
                {/* Landing radar ripple */}
                <circle
                  cx={rt.to[0]}
                  cy={rt.to[1]}
                  r={7 + ripple * 24}
                  fill="none"
                  stroke={rt.color}
                  strokeWidth={2}
                  opacity={(1 - ripple) * arcProg}
                />
                <circle cx={rt.to[0]} cy={rt.to[1]} r={6} fill="#FFFFFF" stroke={rt.color} strokeWidth={3} />
                {/* Short IATA node code */}
                <rect
                  x={rt.to[0] - 28}
                  y={rt.to[1] - 32}
                  width={56}
                  height={22}
                  rx={6}
                  fill="#070D1D"
                  fillOpacity={0.85}
                  stroke={rt.color}
                  strokeOpacity={0.7}
                  strokeWidth={1.2}
                />
                <text
                  x={rt.to[0]}
                  y={rt.to[1] - 16}
                  textAnchor="middle"
                  fill="#F8FAFC"
                  fontSize={14}
                  fontWeight={800}
                  fontFamily={FONT_MONO}
                >
                  {rt.code}
                </text>
              </g>
            );
          })}

          {/* Origin Hub Beacon (BKK) */}
          <circle cx={hub[0]} cy={hub[1]} r={16 + 4 * Math.sin(localFrame * 0.14)} fill={hexToRgba(pal.accent2, 0.3)} />
          <circle cx={hub[0]} cy={hub[1]} r={8.5} fill="#FFFFFF" stroke={pal.accent2} strokeWidth={3.5} />
          <rect
            x={hub[0] - 28}
            y={hub[1] + 14}
            width={56}
            height={22}
            rx={6}
            fill={pal.accent2}
          />
          <text
            x={hub[0]}
            y={hub[1] + 30}
            textAnchor="middle"
            fill="#070D1D"
            fontSize={14}
            fontWeight={900}
            fontFamily={FONT_MONO}
          >
            BKK
          </text>
        </g>

        {/* Compact corner HUD badges inside stage */}
        <g opacity={appear(localFrame, 6, 12)}>
          <rect x={68} y={322} width={164} height={48} rx={12} fill="#0B1429" fillOpacity={0.88} stroke={pal.border} strokeWidth={1.4} />
          <text x={86} y={342} fill={pal.accent} fontSize={13} fontFamily={FONT_MONO} fontWeight={700}>
            ORBITAL LINK
          </text>
          <text x={86} y={361} fill="#F8FAFC" fontSize={16} fontFamily={FONT_MONO} fontWeight={800}>
            {`${routes.length} ACTIVE ARCS`}
          </text>

          <rect x={848} y={322} width={164} height={48} rx={12} fill="#0B1429" fillOpacity={0.88} stroke={pal.border} strokeWidth={1.4} />
          <text x={866} y={342} fill={pal.accent3} fontSize={13} fontFamily={FONT_MONO} fontWeight={700}>
            SIGNAL SYNC
          </text>
          <text x={866} y={361} fill="#F8FAFC" fontSize={16} fontFamily={FONT_MONO} fontWeight={800}>
            {`${Math.round(92 + 7 * Math.sin(localFrame * 0.05))}.8% LIVE`}
          </text>
        </g>
      </svg>

      {/* Bottom Summary Cards (strictly within y <= 1400) */}
      <div
        style={{
          position: 'absolute',
          top: 906,
          left: 52,
          right: 52,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {pts.map((pt, i) => {
          const p = stagger(i, localFrame, 6, 10, 14);
          const col = cardColors[i % cardColors.length];
          return (
            <div
              key={i}
              style={{
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [18, 0])}px)`,
                background: hexToRgba(pal.surface, 0.92),
                border: `1.5px solid ${hexToRgba(col, 0.45)}`,
                borderLeft: `6px solid ${col}`,
                borderRadius: 16,
                padding: '13px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                minHeight: 84,
                height: 'auto',
                boxShadow: '0 10px 26px rgba(2, 6, 23, 0.45)',
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: hexToRgba(col, 0.18),
                  border: `1.5px solid ${col}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: FONT_MONO,
                  fontSize: 19,
                  fontWeight: 900,
                  color: col,
                  flexShrink: 0,
                }}
              >
                {`0${i + 1}`}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText
                  text={pt}
                  baseSize={24}
                  minSize={18}
                  maxLines={3}
                  color={pal.fg}
                  fontWeight={600}
                  align="left"
                  lineHeight={1.34}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-19 Shot 2: corridor-telemetry — แผนที่เส้นทางเชื่อมต่อสองฝั่งพร้อมเส้นโค้งเปรียบเทียบระยะทาง/ความเร็ว */
const CorridorTelemetryShot: React.FC<StyleShotArgs> = ({ scene, localFrame, tokens }) => {
  const pal = resolvePaletteH(tokens, GLOBE_DEFAULTS);
  const t = sceneTexts(scene);
  const cmp = extractComparePairH(scene);
  const arcProg = easeOutCubic(clamp01((localFrame - 2) / 26));

  const leftHub: [number, number] = [208, 558];
  const rightHub: [number, number] = [872, 558];
  const fastCtrl: [number, number] = [540, 355];
  const slowCtrl: [number, number] = [540, 695];

  const fastPacketT = (localFrame * 0.032) % 1;
  const slowPacketT = (localFrame * 0.014) % 1;
  const [fpx, fpy] = quadBezierPoint(leftHub, fastCtrl, rightHub, fastPacketT);
  const [spx, spy] = quadBezierPoint(leftHub, slowCtrl, rightHub, slowPacketT);
  const ripple = (localFrame % 36) / 36;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <GlobeSpaceBackdrop pal={pal} localFrame={localFrame} glowY={540} uid="g19s2" />

      <StageHeader
        badge={t.badge}
        title={t.title}
        subtitle={t.subtitle}
        fg={pal.fg}
        muted={pal.muted}
        accent={pal.accent}
        localFrame={localFrame}
        compact
      />

      {/* Dual Corridor Orbital Map Panel (y: 298..748) */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="g19s2-panel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0E1B36" />
            <stop offset="100%" stopColor="#081022" />
          </linearGradient>
          <linearGradient id="g19s2-fast" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={pal.accent} />
            <stop offset="100%" stopColor={pal.accent3} />
          </linearGradient>
        </defs>

        <rect
          x={52}
          y={298}
          width={976}
          height={446}
          rx={24}
          fill="url(#g19s2-panel)"
          stroke={pal.border}
          strokeWidth={1.8}
        />

        {/* Curved planetary horizon grid lines inside corridor map */}
        {[-95, -45, 5, 55, 105].map((dy, idx) => (
          <path
            key={idx}
            d={`M 76 ${558 + dy} Q 540 ${478 + dy * 0.7} 1004 ${558 + dy}`}
            fill="none"
            stroke={pal.accent}
            strokeOpacity={0.14}
            strokeWidth={1.1}
          />
        ))}
        {[220, 380, 540, 700, 860].map((vx) => (
          <line
            key={vx}
            x1={vx}
            y1={320}
            x2={vx}
            y2={722}
            stroke={pal.accent}
            strokeOpacity={0.10}
            strokeWidth={1}
            strokeDasharray="4 8"
          />
        ))}

        {/* Lower Baseline / Legacy Corridor Arc (Amber) */}
        <path
          d={`M ${leftHub[0]} ${leftHub[1]} Q ${slowCtrl[0]} ${slowCtrl[1]} ${rightHub[0]} ${rightHub[1]}`}
          fill="none"
          stroke={pal.accent2}
          strokeWidth={4}
          strokeDasharray="10 10"
          strokeOpacity={0.78 * arcProg}
        />
        <circle cx={spx} cy={spy} r={9} fill={pal.accent2} opacity={0.32 * arcProg} />
        <circle cx={spx} cy={spy} r={4.5} fill="#FEF08A" opacity={arcProg} />

        {/* Upper Express / Direct Corridor Arc (Cyan -> Emerald) */}
        <path
          d={`M ${leftHub[0]} ${leftHub[1]} Q ${fastCtrl[0]} ${fastCtrl[1]} ${rightHub[0]} ${rightHub[1]}`}
          fill="none"
          stroke="url(#g19s2-fast)"
          strokeWidth={12}
          strokeLinecap="round"
          opacity={0.22}
          strokeDasharray="900"
          strokeDashoffset={900 * (1 - arcProg)}
        />
        <path
          d={`M ${leftHub[0]} ${leftHub[1]} Q ${fastCtrl[0]} ${fastCtrl[1]} ${rightHub[0]} ${rightHub[1]}`}
          fill="none"
          stroke="url(#g19s2-fast)"
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeDasharray="900"
          strokeDashoffset={900 * (1 - arcProg)}
        />
        <circle cx={fpx} cy={fpy} r={13} fill={pal.accent3} opacity={0.35 * arcProg} />
        <circle cx={fpx} cy={fpy} r={5.5} fill="#FFFFFF" opacity={arcProg} />

        {/* Corridor Telemetry Pills */}
        <g opacity={appear(localFrame, 10, 12)}>
          <rect x={442} y={400} width={196} height={38} rx={19} fill="#07182B" stroke={pal.accent3} strokeWidth={1.8} />
          <text x={540} y={425} textAnchor="middle" fill={pal.accent3} fontSize={17} fontFamily={FONT_MONO} fontWeight={800}>
            {`ROUTE B • ${cmp.rightBadge.slice(0, 8)}`}
          </text>

          <rect x={442} y={648} width={196} height={38} rx={19} fill="#1D1508" stroke={pal.accent2} strokeWidth={1.8} />
          <text x={540} y={673} textAnchor="middle" fill={pal.accent2} fontSize={17} fontFamily={FONT_MONO} fontWeight={800}>
            {`ROUTE A • ${cmp.leftBadge.slice(0, 8)}`}
          </text>
        </g>

        {/* Left & Right Hemisphere Hub Beacons */}
        {[
          { pt: leftHub, code: 'NODE A', color: pal.accent2 },
          { pt: rightHub, code: 'NODE B', color: pal.accent3 },
        ].map((h, i) => (
          <g key={i}>
            <circle
              cx={h.pt[0]}
              cy={h.pt[1]}
              r={18 + ripple * 30}
              fill="none"
              stroke={h.color}
              strokeWidth={2}
              opacity={1 - ripple}
            />
            <circle cx={h.pt[0]} cy={h.pt[1]} r={24} fill={hexToRgba(h.color, 0.22)} />
            <circle cx={h.pt[0]} cy={h.pt[1]} r={11} fill="#FFFFFF" stroke={h.color} strokeWidth={4} />
            <rect
              x={h.pt[0] - 46}
              y={h.pt[1] + 22}
              width={92}
              height={26}
              rx={8}
              fill="#070D1D"
              stroke={h.color}
              strokeWidth={1.5}
            />
            <text
              x={h.pt[0]}
              y={h.pt[1] + 40}
              textAnchor="middle"
              fill="#F8FAFC"
              fontSize={15}
              fontFamily={FONT_MONO}
              fontWeight={800}
            >
              {h.code}
            </text>
          </g>
        ))}
      </svg>

      {/* Two-Column Comparison Telemetry Cards (y: 770..1395) */}
      <div
        style={{
          position: 'absolute',
          top: 768,
          left: 52,
          right: 52,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 18,
          alignItems: 'start',
        }}
      >
        {[
          {
            title: cmp.leftTitle,
            badge: cmp.leftBadge,
            items: cmp.leftItems,
            color: pal.accent2,
            tag: 'CORRIDOR A',
          },
          {
            title: cmp.rightTitle,
            badge: cmp.rightBadge,
            items: cmp.rightItems,
            color: pal.accent3,
            tag: 'CORRIDOR B',
          },
        ].map((col, idx) => {
          const p = stagger(idx, localFrame, 8, 8, 14);
          return (
            <div
              key={idx}
              style={{
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [22, 0])}px)`,
                background: hexToRgba(pal.surface, 0.94),
                border: `2px solid ${hexToRgba(col.color, idx === 1 ? 0.72 : 0.42)}`,
                borderRadius: 20,
                padding: '18px 18px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                minHeight: 360,
                height: 'auto',
                boxShadow: `0 14px 32px rgba(2, 6, 23, 0.45)`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 15,
                    fontWeight: 800,
                    color: col.color,
                    letterSpacing: 1,
                  }}
                >
                  {col.tag}
                </span>
                <span
                  style={{
                    padding: '4px 12px',
                    borderRadius: 999,
                    background: hexToRgba(col.color, 0.18),
                    border: `1px solid ${col.color}`,
                    fontFamily: FONT_MONO,
                    fontSize: 15,
                    fontWeight: 800,
                    color: '#F8FAFC',
                  }}
                >
                  {col.badge.slice(0, 12)}
                </span>
              </div>

              <FitText
                text={col.title}
                baseSize={26}
                minSize={19}
                maxLines={2}
                color={pal.fg}
                fontWeight={800}
                align="left"
                lineHeight={1.3}
              />

              <div style={{ height: 2, background: hexToRgba(col.color, 0.35), borderRadius: 2 }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {col.items.map((item, k) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        background: col.color,
                        marginTop: 10,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FitText
                        text={item}
                        baseSize={21}
                        minSize={16}
                        maxLines={3}
                        color={pal.fg}
                        fontWeight={500}
                        align="left"
                        lineHeight={1.34}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-19 Shot 3: hub-constellation — เครือข่ายฮับโลกกระจายเส้นโค้งสู่ภูมิภาคพร้อมตัวเลข stat เด่นกลางฮับ */
const HubConstellationShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = resolvePaletteH(tokens, GLOBE_DEFAULTS);
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetricH(scene, sceneIndex, '48+', 'GLOBAL HUBS');
  const pts = extractPointsH(scene, 4);
  const hubSpring = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 130 } });

  const cx = 540;
  const cy = 576;
  const sweepDeg = (localFrame * 2.2) % 360;

  const nodes: Array<{ code: string; x: number; y: number; ctrl: [number, number]; color: string }> = [
    { code: 'AMER', x: 184, y: 404, ctrl: [320, 420], color: pal.accent },
    { code: 'EMEA', x: 896, y: 404, ctrl: [760, 420], color: pal.accent2 },
    { code: 'APAC', x: 184, y: 748, ctrl: [320, 720], color: pal.accent3 },
    { code: 'OCE', x: 896, y: 748, ctrl: [760, 720], color: '#A78BFA' },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <GlobeSpaceBackdrop pal={pal} localFrame={localFrame} glowY={cy} uid="g19s3" />

      <StageHeader
        badge={t.badge}
        title={t.title}
        fg={pal.fg}
        muted={pal.muted}
        accent={pal.accent}
        localFrame={localFrame}
        compact
      />

      {/* Constellation Network Stage (y: 280..855) */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="g19s3-core" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#1B396A" />
            <stop offset="70%" stopColor="#0C1933" />
            <stop offset="100%" stopColor="#070D1D" />
          </radialGradient>
        </defs>

        {/* Concentric radar rings */}
        {[155, 228, 300].map((rr, i) => (
          <circle
            key={rr}
            cx={cx}
            cy={cy}
            r={rr}
            fill="none"
            stroke={pal.accent}
            strokeOpacity={0.22 - i * 0.05}
            strokeWidth={1.4}
            strokeDasharray={i === 1 ? '8 10' : undefined}
          />
        ))}

        {/* Rotating radar sweep arm */}
        <g transform={`rotate(${sweepDeg.toFixed(1)} ${cx} ${cy})`}>
          <path
            d={`M ${cx} ${cy} L ${cx} ${cy - 295} A 295 295 0 0 1 ${cx + 120} ${cy - 268} Z`}
            fill={pal.accent}
            opacity={0.09}
          />
          <line x1={cx} y1={cy} x2={cx} y2={cy - 295} stroke={pal.accent} strokeOpacity={0.45} strokeWidth={2} />
        </g>

        {/* Curved constellation links from central hub to 4 satellite hubs */}
        {nodes.map((nd, idx) => {
          const arcP = appear(localFrame, 4 + idx * 4, 16);
          const d = `M ${cx} ${cy} Q ${nd.ctrl[0]} ${nd.ctrl[1]} ${nd.x} ${nd.y}`;
          const ptOut = quadBezierPoint([cx, cy], nd.ctrl, [nd.x, nd.y], ((localFrame * 0.025) + idx * 0.25) % 1);
          const ptIn = quadBezierPoint([nd.x, nd.y], nd.ctrl, [cx, cy], ((localFrame * 0.02) + idx * 0.4 + 0.5) % 1);
          const ripple = ((localFrame + idx * 9) % 34) / 34;

          return (
            <g key={nd.code} opacity={arcP}>
              <path d={d} fill="none" stroke={nd.color} strokeWidth={8} opacity={0.18} />
              <path d={d} fill="none" stroke={nd.color} strokeWidth={3} strokeDasharray="8 6" />
              <circle cx={ptOut[0]} cy={ptOut[1]} r={5.5} fill="#FFFFFF" />
              <circle cx={ptIn[0]} cy={ptIn[1]} r={4} fill={nd.color} />

              {/* Satellite node hexagon/circle */}
              <circle cx={nd.x} cy={nd.y} r={22 + ripple * 20} fill="none" stroke={nd.color} strokeWidth={1.8} opacity={1 - ripple} />
              <circle cx={nd.x} cy={nd.y} r={38} fill="#0A1429" stroke={nd.color} strokeWidth={2.5} />
              <text
                x={nd.x}
                y={nd.y + 6}
                textAnchor="middle"
                fill="#F8FAFC"
                fontSize={16}
                fontFamily={FONT_MONO}
                fontWeight={800}
              >
                {nd.code}
              </text>
            </g>
          );
        })}

        {/* Central Hub Sphere */}
        <g transform={`translate(${cx}, ${cy}) scale(${(0.86 + hubSpring * 0.14).toFixed(4)}) translate(${-cx}, ${-cy})`}>
          <circle cx={cx} cy={cy} r={126} fill={hexToRgba(pal.accent, 0.14)} />
          <circle cx={cx} cy={cy} r={112} fill="url(#g19s3-core)" stroke={pal.accent} strokeWidth={3.5} />
          <circle cx={cx} cy={cy} r={100} fill="none" stroke={pal.accent2} strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="6 6" />
        </g>
      </svg>

      {/* Center Hub HTML Stat Overlay (Thai-safe unit + crisp number) */}
      <div
        style={{
          position: 'absolute',
          top: cy - 72,
          left: cx - 102,
          width: 204,
          height: 144,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          opacity: clamp01(hubSpring * 1.2),
        }}
      >
        <FitText
          text={metric.big}
          baseSize={50}
          minSize={28}
          maxLines={1}
          color="#FFFFFF"
          fontWeight={900}
          lineHeight={1.15}
        />
        <FitText
          text={metric.unit}
          baseSize={19}
          minSize={14}
          maxLines={2}
          color={pal.accent}
          fontWeight={700}
          lineHeight={1.28}
        />
      </div>

      {/* Bottom Metric Highlight + Regional Point Cards (y: 854..1395) */}
      <div
        style={{
          position: 'absolute',
          top: 856,
          left: 52,
          right: 52,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Stat Label Highlight Strip */}
        <div
          style={{
            opacity: appear(localFrame, 8, 12),
            background: hexToRgba(pal.accent, 0.12),
            border: `1.5px solid ${hexToRgba(pal.accent, 0.45)}`,
            borderRadius: 16,
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <FitText
              text={metric.label}
              baseSize={23}
              minSize={17}
              maxLines={2}
              color={pal.fg}
              fontWeight={700}
              align="left"
              lineHeight={1.32}
            />
          </div>
          <span
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              background: hexToRgba(pal.accent3, 0.18),
              border: `1.5px solid ${pal.accent3}`,
              fontFamily: FONT_MONO,
              fontSize: 17,
              fontWeight: 800,
              color: pal.accent3,
              flexShrink: 0,
            }}
          >
            {metric.delta.slice(0, 12)}
          </span>
        </div>

        {/* 2-Column Node Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: pts.length <= 2 ? '1fr' : '1fr 1fr',
            gap: 14,
          }}
        >
          {pts.map((pt, i) => {
            const p = stagger(i, localFrame, 6, 12, 14);
            const nd = nodes[i % nodes.length];
            return (
              <div
                key={i}
                style={{
                  opacity: p,
                  transform: `translateY(${interpolate(p, [0, 1], [16, 0])}px)`,
                  background: hexToRgba(pal.surface, 0.92),
                  border: `1.5px solid ${hexToRgba(nd.color, 0.42)}`,
                  borderRadius: 16,
                  padding: '13px 16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  minHeight: 108,
                  height: 'auto',
                }}
              >
                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: 8,
                    background: hexToRgba(nd.color, 0.18),
                    border: `1px solid ${nd.color}`,
                    fontFamily: FONT_MONO,
                    fontSize: 14,
                    fontWeight: 800,
                    color: nd.color,
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {nd.code}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={pt}
                    baseSize={pts.length <= 2 ? 23 : 21}
                    minSize={16}
                    maxLines={3}
                    color={pal.fg}
                    fontWeight={600}
                    align="left"
                    lineHeight={1.34}
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

/** look-19 Shot 4: flight-board — บอร์ดเส้นทางระดับโลกพร้อมมินิโกลบสำหรับฉากหลายขั้นตอน/bullet */
const FlightBoardShot: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames, tokens }) => {
  const pal = resolvePaletteH(tokens, GLOBE_DEFAULTS);
  const t = sceneTexts(scene);
  const pts = extractPointsH(scene, 4);
  const routeCodes = ['BKK → TYO', 'SIN → LON', 'HKG → NYC', 'DXB → SYD'];
  const routeColors = [pal.accent, pal.accent2, pal.accent3, '#A78BFA'];

  const activeIdx = Math.min(
    Math.max(0, pts.length - 1),
    Math.floor((localFrame / Math.max(1, durationFrames)) * Math.max(1, pts.length)),
  );
  const miniProg = easeOutCubic(clamp01(localFrame / 20));

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <GlobeSpaceBackdrop pal={pal} localFrame={localFrame} glowY={400} uid="g19s4" />

      <StageHeader
        badge={t.badge}
        title={t.title}
        fg={pal.fg}
        muted={pal.muted}
        accent={pal.accent}
        localFrame={localFrame}
        compact
      />

      {/* Top Mini-Globe Telemetry Banner (y: 274..504) */}
      <div
        style={{
          position: 'absolute',
          top: 274,
          left: 52,
          right: 52,
          height: 224,
          borderRadius: 22,
          background: hexToRgba(pal.surface, 0.92),
          border: `1.5px solid ${hexToRgba(pal.accent, 0.42)}`,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          padding: '16px 22px',
          opacity: appear(localFrame, 3, 12),
          boxShadow: '0 14px 34px rgba(2, 6, 23, 0.45)',
        }}
      >
        {/* Mini 3D Globe SVG */}
        <svg width={196} height={196} viewBox="0 0 196 196" style={{ flexShrink: 0 }}>
          <DottedGlobeGroup
            cx={98}
            cy={98}
            r={74}
            localFrame={localFrame}
            uid="g19s4-mini"
            accent={pal.accent}
            accent2={pal.accent2}
          />
          <path
            d="M 52 110 Q 96 42 148 82"
            fill="none"
            stroke={pal.accent2}
            strokeWidth={3}
            strokeDasharray="160"
            strokeDashoffset={160 * (1 - miniProg)}
          />
          <path
            d="M 62 76 Q 108 134 146 116"
            fill="none"
            stroke={pal.accent3}
            strokeWidth={2.5}
            strokeDasharray="160"
            strokeDashoffset={160 * (1 - miniProg)}
          />
          <circle cx={52} cy={110} r={4.5} fill="#FFFFFF" stroke={pal.accent2} strokeWidth={2} />
          <circle cx={148} cy={82} r={4.5} fill="#FFFFFF" stroke={pal.accent2} strokeWidth={2} />
        </svg>

        {/* Right Telemetry Overview */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 800, color: pal.accent, letterSpacing: 1.5 }}>
              GLOBAL FLIGHT BOARD
            </span>
            <span
              style={{
                padding: '4px 12px',
                borderRadius: 999,
                background: hexToRgba(pal.accent3, 0.18),
                border: `1px solid ${pal.accent3}`,
                fontFamily: FONT_MONO,
                fontSize: 14,
                fontWeight: 800,
                color: pal.accent3,
              }}
            >
              {`${pts.length} SECTORS`}
            </span>
          </div>
          <FitText
            text={t.subtitle || scene.stat?.label || t.title}
            baseSize={24}
            minSize={18}
            maxLines={3}
            color={pal.fg}
            fontWeight={600}
            align="left"
            lineHeight={1.34}
          />
          <div style={{ display: 'flex', gap: 12 }}>
            {['LAT 13.7°N', 'LON 100.5°E', 'UTC+7'].map((meta) => (
              <span
                key={meta}
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 14,
                  fontWeight: 700,
                  color: pal.muted,
                  background: '#070D1D',
                  padding: '4px 10px',
                  borderRadius: 8,
                  border: `1px solid ${pal.border}`,
                }}
              >
                {meta}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Departure / Route Telemetry Board (y: 520..1395) */}
      <div
        style={{
          position: 'absolute',
          top: 520,
          left: 52,
          right: 52,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* Board Column Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 18px',
            borderRadius: 12,
            background: '#0B1326',
            border: `1px solid ${pal.border}`,
            fontFamily: FONT_MONO,
            fontSize: 15,
            fontWeight: 800,
            color: pal.muted,
            letterSpacing: 1.2,
          }}
        >
          <span>ROUTE / STEP</span>
          <span>TELEMETRY DETAIL</span>
          <span>STATUS</span>
        </div>

        {/* Route Rows */}
        {pts.map((pt, i) => {
          const p = stagger(i, localFrame, 6, 8, 14);
          const col = routeColors[i % routeColors.length];
          const isActive = i === activeIdx;
          return (
            <div
              key={i}
              style={{
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [-24, 0])}px)`,
                background: isActive ? hexToRgba(col, 0.14) : hexToRgba(pal.surface, 0.92),
                border: `1.8px solid ${isActive ? col : hexToRgba(pal.border, 0.85)}`,
                borderRadius: 16,
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                minHeight: 112,
                height: 'auto',
                boxShadow: isActive ? `0 0 24px ${hexToRgba(col, 0.25)}` : '0 8px 20px rgba(2, 6, 23, 0.35)',
              }}
            >
              {/* Route Code Badge */}
              <div
                style={{
                  width: 126,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 16,
                    fontWeight: 900,
                    color: col,
                  }}
                >
                  {`0${i + 1} • FL-${19 + i}`}
                </span>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 13,
                    fontWeight: 700,
                    color: pal.muted,
                  }}
                >
                  {routeCodes[i % routeCodes.length]}
                </span>
              </div>

              {/* Thai Detail */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText
                  text={pt}
                  baseSize={23}
                  minSize={17}
                  maxLines={3}
                  color={pal.fg}
                  fontWeight={600}
                  align="left"
                  lineHeight={1.34}
                />
              </div>

              {/* Live Status Pill */}
              <div
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  background: isActive ? col : hexToRgba(col, 0.16),
                  color: isActive ? '#070D1D' : col,
                  fontFamily: FONT_MONO,
                  fontSize: 13,
                  fontWeight: 900,
                  flexShrink: 0,
                }}
              >
                {isActive ? 'ACTIVE' : 'READY'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 2: look-20 — LAPTOP REVEAL (เปิดฝาแล็ปท็อป)
// Dark Studio Keynote • Brushed Platinum Aluminum Chassis • Crisp SaaS UI
// ============================================================================

const LAPTOP_DEFAULTS: PaletteH = {
  bg: '#0B1120',
  bg2: '#0F172A',
  surface: '#162033',
  fg: '#F8FAFC',
  muted: '#CBD5E1',
  accent: '#38BDF8',
  accent2: '#818CF8',
  accent3: '#34D399',
  border: '#334155',
};

const LaptopStudioBackdrop: React.FC<{
  pal: PaletteH;
  localFrame: number;
  uid: string;
  beamY?: number;
}> = ({ pal, localFrame, uid, beamY = 480 }) => {
  const glowPulse = 0.5 + 0.5 * Math.sin(localFrame * 0.05);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 880px 640px at 540px ${beamY}px, #1B2942 0%, ${pal.bg2} 48%, ${pal.bg} 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id={`${uid}-beam`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E4E6EA" stopOpacity={0.14 + glowPulse * 0.04} />
            <stop offset="55%" stopColor={pal.accent} stopOpacity="0.06" />
            <stop offset="100%" stopColor={pal.bg} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-floor`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1E293B" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#070B14" stopOpacity="0.96" />
          </linearGradient>
        </defs>
        {/* Overhead keynote light cone */}
        <polygon points="310,0 770,0 1020,1040 60,1040" fill={`url(#${uid}-beam)`} />
        {/* Studio reflection floor plane */}
        <rect x={0} y={960} width={STAGE_W} height={STAGE_H - 960} fill={`url(#${uid}-floor)`} />
        <line x1={48} y1={960} x2={1032} y2={960} stroke="#94A3B8" strokeOpacity={0.22} strokeWidth={1.5} />
      </svg>
    </div>
  );
};

/** look-20 Shot 1: lid-open-hero — แล็ปท็อปมุมเพอร์สเปกทีฟค่อยๆ เปิดฝาพร้อมแสงสาดและป้ายฟีเจอร์ */
const LidOpenHeroShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = resolvePaletteH(tokens, LAPTOP_DEFAULTS);
  const t = sceneTexts(scene);
  const pts = extractPointsH(scene, 3);
  const metric = extractPrimaryMetricH(scene, 0, 'PRO', 'LAUNCH');

  const lidSpring = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 105 } });
  const lidTilt = interpolate(lidSpring, [0, 1], [58, 0]);
  const screenGlow = clamp01(lidSpring * 1.15);
  const clickPhase = (localFrame % 48) / 48;
  const pressed = clickPhase > 0.4 && clickPhase < 0.56;
  const cursorX = 415 + Math.sin(localFrame * 0.06) * 14;
  const cursorY = 232 + Math.cos(localFrame * 0.05) * 6;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <LaptopStudioBackdrop pal={pal} localFrame={localFrame} uid="g20s1" beamY={520} />

      <StageHeader
        badge={t.badge}
        title={t.title}
        subtitle={t.subtitle}
        fg={pal.fg}
        muted={pal.muted}
        accent={pal.accent}
        localFrame={localFrame}
      />

      {/* Upward screen illumination halo behind laptop */}
      <div
        style={{
          position: 'absolute',
          top: 290,
          left: 110,
          width: 860,
          height: 520,
          background: `radial-gradient(ellipse 68% 60% at 50% 62%, ${hexToRgba(pal.accent, 0.34 * screenGlow)} 0%, ${hexToRgba(pal.accent2, 0.14 * screenGlow)} 50%, transparent 78%)`,
          pointerEvents: 'none',
        }}
      />

      {/* 3D Perspective Laptop Assembly (y: 332..928) */}
      <div
        style={{
          position: 'absolute',
          top: 332,
          left: 96,
          width: 888,
          height: 590,
          perspective: 1400,
        }}
      >
        {/* Opening Lid (Platinum Aluminum Shell + Black Glass Bezel + Live UI) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 52,
            width: 784,
            height: 486,
            borderRadius: '26px 26px 10px 10px',
            background: 'linear-gradient(135deg, #F5F5F7 0%, #D5DAE2 45%, #E4E6EA 72%, #94A3B8 100%)',
            padding: 12,
            transformOrigin: '50% 100%',
            transform: `rotateX(${lidTilt.toFixed(2)}deg)`,
            boxShadow: `0 -18px 54px ${hexToRgba(pal.accent, 0.22 * screenGlow)}, 0 18px 42px rgba(0,0,0,0.55)`,
          }}
        >
          {/* Black Glass Screen Bezel */}
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '18px 18px 6px 6px',
              background: '#080C15',
              padding: '22px 18px 18px',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Camera Dot */}
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 8,
                height: 8,
                borderRadius: 999,
                background: '#334155',
              }}
            />

            {/* Illuminated Live SaaS Product Screen */}
            <div
              style={{
                flex: 1,
                borderRadius: 12,
                background: 'linear-gradient(155deg, #0F1A30 0%, #0B1222 100%)',
                border: `1px solid ${hexToRgba(pal.accent, 0.35)}`,
                position: 'relative',
                overflow: 'hidden',
                padding: '16px 22px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                opacity: screenGlow,
              }}
            >
              {/* Screen Top Nav Bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: '#EF4444' }} />
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: '#F59E0B' }} />
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: '#22C55E' }} />
                  <span style={{ marginLeft: 10, fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700, color: '#94A3B8' }}>
                    workspace.studio
                  </span>
                </div>
                <span
                  style={{
                    padding: '4px 12px',
                    borderRadius: 999,
                    background: hexToRgba(pal.accent3, 0.18),
                    color: pal.accent3,
                    fontFamily: FONT_MONO,
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                >
                  {`${metric.big.slice(0, 10)} LIVE`}
                </span>
              </div>

              {/* Screen Hero Copy */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '4px 12px' }}>
                <FitText
                  text={t.title}
                  baseSize={30}
                  minSize={20}
                  maxLines={2}
                  color="#F8FAFC"
                  fontWeight={800}
                  lineHeight={1.28}
                />
                {/* Interactive Primary CTA Pill */}
                <div
                  style={{
                    padding: '10px 28px',
                    borderRadius: 999,
                    background: `linear-gradient(90deg, ${pal.accent}, ${pal.accent2})`,
                    color: '#070D1D',
                    fontFamily: FONT_THAI,
                    fontSize: 20,
                    fontWeight: 800,
                    transform: `scale(${pressed ? 0.94 : 1})`,
                    boxShadow: `0 6px 24px ${hexToRgba(pal.accent, 0.45)}`,
                  }}
                >
                  เปิดใช้งานทันที →
                </div>
              </div>

              {/* Mini Screen Telemetry Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {[
                  { k: 'SPEED', v: '99.4%', c: pal.accent },
                  { k: 'ACTIVE', v: metric.big.slice(0, 8), c: pal.accent3 },
                  { k: 'SYNC', v: 'REALTIME', c: pal.accent2 },
                ].map((m, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: 'rgba(15, 23, 42, 0.85)',
                      border: `1px solid ${hexToRgba(m.c, 0.35)}`,
                      borderRadius: 10,
                      padding: '8px 12px',
                    }}
                  >
                    <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: '#94A3B8', fontWeight: 700 }}>{m.k}</div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 17, color: m.c, fontWeight: 900, marginTop: 2 }}>{m.v}</div>
                  </div>
                ))}
              </div>

              {/* Diagonal Glass Reflection Glint */}
              <div
                style={{
                  position: 'absolute',
                  top: -40,
                  left: -90 + localFrame * 5,
                  width: 140,
                  height: 520,
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.09), transparent)',
                  transform: 'rotate(24deg)',
                  pointerEvents: 'none',
                }}
              />

              {/* Animated Cursor on Screen */}
              <svg
                width={740}
                height={430}
                viewBox="0 0 740 430"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                <g transform={`translate(${cursorX.toFixed(1)}, ${cursorY.toFixed(1)})`}>
                  {pressed ? (
                    <circle cx={0} cy={0} r={20} fill="none" stroke={pal.accent} strokeWidth={2.5} opacity={0.8} />
                  ) : null}
                  <polygon
                    points="0,0 0,30 9,23 16,35 21,32 14,20 25,19"
                    fill="#FFFFFF"
                    stroke="#0F172A"
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                </g>
              </svg>
            </div>
          </div>
        </div>

        {/* Sleek Platinum Aluminum Keyboard Deck & Base */}
        <svg
          width={888}
          height={120}
          viewBox="0 0 888 120"
          style={{ position: 'absolute', top: 478, left: 0 }}
        >
          <defs>
            <linearGradient id="g20s1-deck" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#94A3B8" />
              <stop offset="16%" stopColor="#F5F5F7" />
              <stop offset="50%" stopColor="#E4E6EA" />
              <stop offset="84%" stopColor="#F5F5F7" />
              <stop offset="100%" stopColor="#94A3B8" />
            </linearGradient>
          </defs>
          {/* Contact studio shadow */}
          <ellipse cx={444} cy={92} rx={425} ry={22} fill="#020617" opacity={0.72} />
          {/* Sloped aluminum deck */}
          <polygon points="52,6 836,6 882,66 6,66" fill="url(#g20s1-deck)" stroke="#CBD5E1" strokeWidth={1.5} />
          {/* Recessed dark keyboard well */}
          <polygon points="122,14 766,14 790,42 98,42" fill="#1E293B" />
          {/* Glass trackpad */}
          <polygon points="354,47 534,47 542,60 346,60" fill="#CBD5E1" stroke="#94A3B8" strokeWidth={1.2} />
          {/* Front CNC aluminum lip + thumb notch */}
          <path d="M 6 66 L 882 66 L 866 84 Q 444 90 22 84 Z" fill="#94A3B8" />
          <rect x={386} y={66} width={116} height={8} rx={4} fill="#475569" />
        </svg>
      </div>

      {/* Floating Feature Spec Pills below Laptop (y: 944..1395) */}
      <div
        style={{
          position: 'absolute',
          top: 944,
          left: 52,
          right: 52,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {pts.map((pt, i) => {
          const p = stagger(i, localFrame, 6, 12, 14);
          const accentCol = i === 0 ? pal.accent : i === 1 ? pal.accent2 : pal.accent3;
          return (
            <div
              key={i}
              style={{
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [18, 0])}px)`,
                background: 'rgba(22, 32, 51, 0.90)',
                border: `1.5px solid ${hexToRgba(accentCol, 0.45)}`,
                borderRadius: 16,
                padding: '13px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                minHeight: 82,
                height: 'auto',
                boxShadow: '0 10px 26px rgba(2, 6, 23, 0.42)',
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  background: `linear-gradient(135deg, ${accentCol}, #E4E6EA)`,
                  color: '#0B1120',
                  fontFamily: FONT_MONO,
                  fontSize: 17,
                  fontWeight: 900,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {`0${i + 1}`}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText
                  text={pt}
                  baseSize={23}
                  minSize={18}
                  maxLines={3}
                  color={pal.fg}
                  fontWeight={600}
                  align="left"
                  lineHeight={1.34}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-20 Shot 2: browser-showcase — หน้าต่างเบราว์เซอร์ macOS เต็มตาพร้อม URL bar แอนิเมชัน เคอร์เซอร์คลิกและการ์ดฟีเจอร์ 3 รายการ */
const BrowserShowcaseShot: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteH(tokens, LAPTOP_DEFAULTS);
  const t = sceneTexts(scene);
  const pts = extractPointsH(scene, 3);
  const winSpring = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 135 } });

  const fullUrl = 'https://product.studio/features/live';
  const typedLen = Math.max(8, Math.min(fullUrl.length, Math.round(easeOutCubic(clamp01(localFrame / 24)) * fullUrl.length)));
  const activeCard = Math.min(
    Math.max(0, pts.length - 1),
    Math.floor((localFrame / Math.max(1, durationFrames)) * Math.max(1, pts.length)),
  );

  // Smooth cursor gliding onto active feature card
  const targetCursorY = 248 + activeCard * 134;
  const cursorX = 835 + Math.sin(localFrame * 0.08) * 18;
  const cursorY = targetCursorY + Math.cos(localFrame * 0.07) * 8;
  const clickRipple = (localFrame % 32) / 32;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <LaptopStudioBackdrop pal={pal} localFrame={localFrame} uid="g20s2" beamY={420} />

      <StageHeader
        badge={t.badge}
        title={t.title}
        fg={pal.fg}
        muted={pal.muted}
        accent={pal.accent}
        localFrame={localFrame}
        compact
      />

      {/* Full-Width macOS Browser Window (y: 274..1390) */}
      <div
        style={{
          position: 'absolute',
          top: 274,
          left: 52,
          right: 52,
          borderRadius: 24,
          background: '#0F172A',
          border: '2px solid #94A3B8',
          boxShadow: `0 24px 60px rgba(2, 6, 23, 0.72), 0 0 36px ${hexToRgba(pal.accent, 0.16)}`,
          transform: `translateY(${interpolate(winSpring, [0, 1], [34, 0])}px) scale(${(0.95 + winSpring * 0.05).toFixed(4)})`,
          opacity: clamp01(winSpring * 1.25),
          overflow: 'hidden',
        }}
      >
        {/* Brushed Platinum macOS Chrome Bar */}
        <div
          style={{
            height: 58,
            background: 'linear-gradient(180deg, #F5F5F7 0%, #D9DEE6 100%)',
            borderBottom: '1.5px solid #94A3B8',
            padding: '0 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 9 }}>
            <span style={{ width: 14, height: 14, borderRadius: 999, background: '#EF4444' }} />
            <span style={{ width: 14, height: 14, borderRadius: 999, background: '#F59E0B' }} />
            <span style={{ width: 14, height: 14, borderRadius: 999, background: '#22C55E' }} />
          </div>

          {/* Animated URL Bar */}
          <div
            style={{
              flex: 1,
              height: 36,
              borderRadius: 10,
              background: '#FFFFFF',
              border: '1px solid #CBD5E1',
              padding: '0 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#16A34A', fontSize: 15, fontWeight: 900 }}>●</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
                {fullUrl.slice(0, typedLen)}
              </span>
            </div>
            <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 800, color: '#2563EB' }}>HTTPS</span>
          </div>
        </div>

        {/* Browser Page Content */}
        <div style={{ padding: '22px 24px 26px', position: 'relative', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Hero Spotlight Banner Inside Browser */}
          <div
            style={{
              borderRadius: 18,
              background: 'linear-gradient(135deg, #16233B 0%, #101A2F 100%)',
              border: `1.5px solid ${hexToRgba(pal.accent, 0.38)}`,
              padding: '18px 22px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 18,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 14,
                  fontWeight: 800,
                  color: pal.accent,
                  letterSpacing: 1.2,
                }}
              >
                INTERACTIVE WORKSPACE
              </span>
              <FitText
                text={t.subtitle || scene.stat?.label || t.title}
                baseSize={26}
                minSize={19}
                maxLines={3}
                color={pal.fg}
                fontWeight={700}
                align="left"
                lineHeight={1.32}
              />
            </div>

            {/* Live CTA + Mini Sparkline */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, flexShrink: 0 }}>
              <div
                style={{
                  padding: '9px 20px',
                  borderRadius: 12,
                  background: pal.accent,
                  color: '#0B1120',
                  fontFamily: FONT_MONO,
                  fontSize: 16,
                  fontWeight: 900,
                }}
              >
                LAUNCH ↗
              </div>
              <svg width={136} height={38} viewBox="0 0 136 38">
                <polyline
                  points="4,32 28,24 52,27 78,14 104,16 132,6"
                  fill="none"
                  stroke={pal.accent3}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx={132} cy={6} r={4.5} fill="#FFFFFF" stroke={pal.accent3} strokeWidth={2.5} />
              </svg>
            </div>
          </div>

          {/* 3 Feature Cards inside Browser */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {pts.map((pt, i) => {
              const p = stagger(i, localFrame, 6, 10, 14);
              const col = i === 0 ? pal.accent : i === 1 ? pal.accent2 : pal.accent3;
              const isSelected = i === activeCard;
              return (
                <div
                  key={i}
                  style={{
                    opacity: p,
                    transform: `translateY(${interpolate(p, [0, 1], [16, 0])}px)`,
                    background: isSelected ? hexToRgba(col, 0.14) : '#141E33',
                    border: `2px solid ${isSelected ? col : pal.border}`,
                    borderRadius: 16,
                    padding: '15px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    minHeight: 106,
                    height: 'auto',
                    boxShadow: isSelected ? `0 0 22px ${hexToRgba(col, 0.25)}` : 'none',
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 14,
                      background: isSelected ? col : hexToRgba(col, 0.18),
                      color: isSelected ? '#0B1120' : col,
                      fontFamily: FONT_MONO,
                      fontSize: 20,
                      fontWeight: 900,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {`0${i + 1}`}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FitText
                      text={pt}
                      baseSize={24}
                      minSize={18}
                      maxLines={3}
                      color={pal.fg}
                      fontWeight={600}
                      align="left"
                      lineHeight={1.34}
                    />
                  </div>
                  <div
                    style={{
                      padding: '5px 12px',
                      borderRadius: 999,
                      background: hexToRgba(col, 0.2),
                      color: col,
                      fontFamily: FONT_MONO,
                      fontSize: 13,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {isSelected ? 'ACTIVE' : 'READY'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Animated Pointer Cursor Clicking Active Feature Card */}
          <svg
            width={976}
            height={780}
            viewBox="0 0 976 780"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <g transform={`translate(${cursorX.toFixed(1)}, ${cursorY.toFixed(1)})`}>
              <circle
                cx={0}
                cy={0}
                r={8 + clickRipple * 26}
                fill="none"
                stroke={pal.accent}
                strokeWidth={2.5}
                opacity={1 - clickRipple}
              />
              <polygon
                points="0,0 0,34 10,26 18,40 24,36 16,22 29,21"
                fill="#FFFFFF"
                stroke="#0B1120"
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
};

/** look-20 Shot 3: split-dashboard — จอแล็ปท็อปแสดงแดชบอร์ด 2 คอลัมน์ (กราฟ/สถิติเด่น + รายการเปรียบเทียบ/จุดเด่น) */
const SplitDashboardShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = resolvePaletteH(tokens, LAPTOP_DEFAULTS);
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetricH(scene, sceneIndex, '94.8%', 'PERFORMANCE');
  const cmp = extractComparePairH(scene);
  const frameSpring = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 130 } });
  const chartProg = easeOutCubic(clamp01((localFrame - 4) / 26));

  const chartPts: Array<[number, number]> = [
    [16, 134],
    [82, 114],
    [148, 122],
    [214, 78],
    [280, 86],
    [346, 44],
    [412, 24],
  ];
  const polyStr = chartPts.map((p) => `${p[0]},${p[1]}`).join(' ');
  const areaStr = `16,154 ${polyStr} 412,154`;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <LaptopStudioBackdrop pal={pal} localFrame={localFrame} uid="g20s3" beamY={440} />

      <StageHeader
        badge={t.badge}
        title={t.title}
        fg={pal.fg}
        muted={pal.muted}
        accent={pal.accent}
        localFrame={localFrame}
        compact
      />

      {/* Wide Platinum Aluminum Laptop Frame (y: 274..1380) */}
      <div
        style={{
          position: 'absolute',
          top: 274,
          left: 52,
          right: 52,
          opacity: clamp01(frameSpring * 1.25),
          transform: `translateY(${interpolate(frameSpring, [0, 1], [28, 0])}px)`,
        }}
      >
        {/* Outer Brushed Silver Display Chassis */}
        <div
          style={{
            borderRadius: '26px 26px 12px 12px',
            background: 'linear-gradient(135deg, #F5F5F7 0%, #D4DAE3 48%, #E4E6EA 76%, #94A3B8 100%)',
            padding: 10,
            boxShadow: '0 22px 54px rgba(2, 6, 23, 0.65)',
          }}
        >
          {/* Black Glass Bezel */}
          <div
            style={{
              borderRadius: '18px 18px 8px 8px',
              background: '#080C16',
              padding: '18px 16px 16px',
            }}
          >
            {/* Dashboard Viewport */}
            <div
              style={{
                borderRadius: 14,
                background: '#0E1729',
                border: `1px solid ${pal.border}`,
                padding: '18px 20px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {/* Dashboard Header Strip */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: pal.accent3, boxShadow: `0 0 10px ${pal.accent3}` }} />
                  <span style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: 800, color: '#E2E8F0', letterSpacing: 1 }}>
                    ANALYTICS DASHBOARD
                  </span>
                </div>
                <span
                  style={{
                    padding: '4px 12px',
                    borderRadius: 999,
                    background: hexToRgba(pal.accent3, 0.16),
                    border: `1px solid ${pal.accent3}`,
                    fontFamily: FONT_MONO,
                    fontSize: 14,
                    fontWeight: 800,
                    color: pal.accent3,
                  }}
                >
                  {metric.delta.slice(0, 12)}
                </span>
              </div>

              {/* Top KPI + Live Spline Chart Row */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1.15fr',
                  gap: 16,
                  background: '#131F36',
                  border: `1px solid ${hexToRgba(pal.accent, 0.35)}`,
                  borderRadius: 16,
                  padding: '16px 18px',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 800, color: pal.accent, letterSpacing: 1 }}>
                    {metric.unit.slice(0, 18)}
                  </span>
                  <FitText
                    text={metric.big}
                    baseSize={54}
                    minSize={32}
                    maxLines={1}
                    color="#FFFFFF"
                    fontWeight={900}
                    align="left"
                    lineHeight={1.15}
                  />
                  <FitText
                    text={metric.label}
                    baseSize={21}
                    minSize={16}
                    maxLines={3}
                    color={pal.muted}
                    fontWeight={500}
                    align="left"
                    lineHeight={1.32}
                  />
                </div>

                {/* Live Animated Spline + Bar Chart SVG */}
                <svg width={430} height={166} viewBox="0 0 430 166" style={{ width: '100%', height: 166 }}>
                  <defs>
                    <linearGradient id="g20s3-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={pal.accent} stopOpacity="0.42" />
                      <stop offset="100%" stopColor={pal.accent} stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  {[34, 74, 114, 154].map((gy) => (
                    <line key={gy} x1={12} y1={gy} x2={418} y2={gy} stroke="#334155" strokeWidth={1} strokeDasharray="4 6" />
                  ))}
                  {/* Background mini volume bars */}
                  {chartPts.map((pt, idx) => {
                    const bh = Math.max(10, (154 - pt[1]) * 0.45 * chartProg);
                    return (
                      <rect
                        key={idx}
                        x={pt[0] - 12}
                        y={154 - bh}
                        width={24}
                        height={bh}
                        rx={4}
                        fill={hexToRgba(pal.accent2, 0.25)}
                      />
                    );
                  })}
                  <polygon points={areaStr} fill="url(#g20s3-area)" opacity={chartProg} />
                  <polyline
                    points={polyStr}
                    fill="none"
                    stroke={pal.accent}
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="600"
                    strokeDashoffset={600 * (1 - chartProg)}
                  />
                  {chartPts.map((pt, idx) => (
                    <circle
                      key={`dot-${idx}`}
                      cx={pt[0]}
                      cy={pt[1]}
                      r={idx === chartPts.length - 1 ? 6.5 : 4}
                      fill={idx === chartPts.length - 1 ? pal.accent3 : '#FFFFFF'}
                      stroke={pal.accent}
                      strokeWidth={2}
                      opacity={appear(localFrame, 8 + idx * 3, 8)}
                    />
                  ))}
                </svg>
              </div>

              {/* 2-Column Split Comparison / Insight Panels */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
                {[
                  { title: cmp.leftTitle, items: cmp.leftItems, color: pal.accent2, tag: 'PANEL A' },
                  { title: cmp.rightTitle, items: cmp.rightItems, color: pal.accent3, tag: 'PANEL B' },
                ].map((col, idx) => {
                  const p = stagger(idx, localFrame, 7, 10, 14);
                  return (
                    <div
                      key={idx}
                      style={{
                        opacity: p,
                        transform: `translateY(${interpolate(p, [0, 1], [16, 0])}px)`,
                        background: '#131F36',
                        border: `1.5px solid ${hexToRgba(col.color, 0.48)}`,
                        borderRadius: 16,
                        padding: '15px 16px 18px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        minHeight: 330,
                        height: 'auto',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 800, color: col.color }}>{col.tag}</span>
                        <span style={{ width: 28, height: 4, borderRadius: 4, background: col.color }} />
                      </div>
                      <FitText
                        text={col.title}
                        baseSize={24}
                        minSize={18}
                        maxLines={2}
                        color={pal.fg}
                        fontWeight={800}
                        align="left"
                        lineHeight={1.3}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                        {col.items.map((item, k) => (
                          <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 999,
                                background: col.color,
                                marginTop: 10,
                                flexShrink: 0,
                              }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <FitText
                                text={item}
                                baseSize={20}
                                minSize={16}
                                maxLines={3}
                                color={pal.fg}
                                fontWeight={500}
                                align="left"
                                lineHeight={1.34}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Slim Platinum Aluminum Chin Base Lip */}
        <div
          style={{
            margin: '0 auto',
            width: '100%',
            height: 28,
            borderRadius: '0 0 18px 18px',
            background: 'linear-gradient(90deg, #94A3B8 0%, #F5F5F7 20%, #E4E6EA 50%, #F5F5F7 80%, #94A3B8 100%)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            boxShadow: '0 16px 34px rgba(2, 6, 23, 0.72)',
          }}
        >
          <div style={{ width: 120, height: 8, borderRadius: '0 0 8px 8px', background: '#64748B' }} />
        </div>
      </div>
    </div>
  );
};

/** look-20 Shot 4: window-cascade — หน้าต่างแอปแบบ Glass ซ้อนกัน 2–3 ชั้นเลื่อนเปิดตัวตามลำดับขั้น */
const WindowCascadeShot: React.FC<StyleShotArgs> = ({ scene, localFrame, tokens }) => {
  const pal = resolvePaletteH(tokens, LAPTOP_DEFAULTS);
  const t = sceneTexts(scene);
  const isQuote = Boolean(scene.quote?.text);
  const pts = isQuote
    ? [scene.quote!.text, ...(scene.quote?.author ? [`— ${scene.quote.author}${scene.quote.role ? ` (${scene.quote.role})` : ''}`] : [])]
    : extractPointsH(scene, 3);

  const windowMeta = [
    { app: '01 • CORE LAYER', accent: pal.accent, tag: 'INIT' },
    { app: '02 • ENGINE VIEW', accent: pal.accent2, tag: 'PROCESS' },
    { app: '03 • LIVE OUTPUT', accent: pal.accent3, tag: 'READY' },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <LaptopStudioBackdrop pal={pal} localFrame={localFrame} uid="g20s4" beamY={560} />

      <StageHeader
        badge={t.badge}
        title={t.title}
        subtitle={!isQuote ? t.subtitle : undefined}
        fg={pal.fg}
        muted={pal.muted}
        accent={pal.accent}
        localFrame={localFrame}
      />

      {/* Ambient Glass Depth Guide Rail Behind Windows */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <line
          x1={108}
          y1={360}
          x2={108}
          y2={1320}
          stroke={pal.accent}
          strokeOpacity={0.22}
          strokeWidth={2}
          strokeDasharray="6 10"
        />
        <line
          x1={972}
          y1={360}
          x2={972}
          y2={1320}
          stroke={pal.accent2}
          strokeOpacity={0.22}
          strokeWidth={2}
          strokeDasharray="6 10"
        />
      </svg>

      {/* Stepped Cascading Glass App Windows (non-overlapping vertical spacing, strictly y <= 1395) */}
      <div
        style={{
          position: 'absolute',
          top: isQuote ? 345 : 316,
          left: 52,
          right: 52,
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        {pts.map((pt, i) => {
          const p = stagger(i, localFrame, 8, 6, 16);
          const meta = windowMeta[i % windowMeta.length];
          const indentL = isQuote ? i * 28 : i * 24;
          const indentR = isQuote ? (pts.length - 1 - i) * 28 : (pts.length - 1 - i) * 24;
          const floatY = Math.sin(localFrame * 0.05 + i * 1.4) * 3;

          return (
            <div
              key={i}
              style={{
                marginLeft: indentL,
                marginRight: indentR,
                opacity: p,
                transform: `translateY(${(interpolate(p, [0, 1], [34, 0]) + floatY).toFixed(1)}px)`,
                borderRadius: 22,
                background: 'linear-gradient(155deg, rgba(28, 41, 66, 0.94) 0%, rgba(15, 23, 42, 0.96) 100%)',
                border: `1.8px solid ${hexToRgba(meta.accent, 0.56)}`,
                boxShadow: `0 20px 44px rgba(2, 6, 23, 0.58), 0 0 28px ${hexToRgba(meta.accent, 0.14)}`,
                overflow: 'hidden',
              }}
            >
              {/* Glass Window Title Bar */}
              <div
                style={{
                  height: 46,
                  padding: '0 18px',
                  background: 'linear-gradient(90deg, rgba(245, 245, 247, 0.14), rgba(228, 230, 234, 0.06))',
                  borderBottom: `1px solid ${hexToRgba(meta.accent, 0.28)}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 7 }}>
                    <span style={{ width: 11, height: 11, borderRadius: 999, background: '#EF4444' }} />
                    <span style={{ width: 11, height: 11, borderRadius: 999, background: '#F59E0B' }} />
                    <span style={{ width: 11, height: 11, borderRadius: 999, background: '#22C55E' }} />
                  </div>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 800, color: '#E2E8F0', letterSpacing: 1 }}>
                    {isQuote ? (i === 0 ? 'KEYNOTE QUOTE' : 'ATTRIBUTION') : meta.app}
                  </span>
                </div>
                <span
                  style={{
                    padding: '3px 11px',
                    borderRadius: 999,
                    background: hexToRgba(meta.accent, 0.2),
                    border: `1px solid ${meta.accent}`,
                    fontFamily: FONT_MONO,
                    fontSize: 12,
                    fontWeight: 800,
                    color: meta.accent,
                  }}
                >
                  {meta.tag}
                </span>
              </div>

              {/* Window Body */}
              <div
                style={{
                  padding: isQuote && i === 0 ? '26px 26px 28px' : '18px 22px 22px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  minHeight: isQuote && i === 0 ? 180 : 122,
                  height: 'auto',
                }}
              >
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 15,
                    background: hexToRgba(meta.accent, 0.16),
                    border: `1.5px solid ${meta.accent}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: FONT_MONO,
                    fontSize: 22,
                    fontWeight: 900,
                    color: meta.accent,
                    flexShrink: 0,
                  }}
                >
                  {isQuote && i === 0 ? '“' : `0${i + 1}`}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={pt}
                    baseSize={isQuote && i === 0 ? 32 : 25}
                    minSize={18}
                    maxLines={isQuote && i === 0 ? 5 : 3}
                    color={pal.fg}
                    fontWeight={isQuote && i === 0 ? 700 : 600}
                    align="left"
                    lineHeight={1.36}
                  />
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
// STYLE 3: look-21 — ISOMETRIC FLOW (ไอโซเมตริกโฟลว์)
// 30° Orthographic Isometric Architecture • Luminous Energy Conduits
// ============================================================================

const ISO_DEFAULTS: PaletteH = {
  bg: '#131722',
  bg2: '#1E2436',
  surface: '#1A2030',
  fg: '#F1F5F9',
  muted: '#CBD5E1',
  accent: '#34D399',
  accent2: '#38BDF8',
  accent3: '#F59E0B',
  border: '#2E3852',
};

const COS30 = 0.8660254;
const SIN30 = 0.5;

/** Exact 30-degree orthographic isometric projection */
function isoPt(ix: number, iy: number, iz: number, cx: number, cy: number): [number, number] {
  return [cx + (ix - iy) * COS30, cy + (ix + iy) * SIN30 - iz];
}

function ptsToAttr(pts: Array<[number, number]>): string {
  return pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
}

/** 30° Isometric 3-Face Shaded Cube with Grounded Shadow & Crisp Specular Bevel */
const IsoCube30: React.FC<{
  ix: number;
  iy: number;
  iz: number;
  dx: number;
  dy: number;
  dz: number;
  cx: number;
  cy: number;
  topColor: string;
  leftColor: string;
  rightColor: string;
  rimColor?: string;
  shadowOpacity?: number;
  opacity?: number;
}> = ({
  ix,
  iy,
  iz,
  dx,
  dy,
  dz,
  cx,
  cy,
  topColor,
  leftColor,
  rightColor,
  rimColor = '#FFFFFF',
  shadowOpacity = 0.35,
  opacity = 1,
}) => {
  const b00 = isoPt(ix, iy, iz, cx, cy);
  const b10 = isoPt(ix + dx, iy, iz, cx, cy);
  const b11 = isoPt(ix + dx, iy + dy, iz, cx, cy);
  const b01 = isoPt(ix, iy + dy, iz, cx, cy);

  const t00 = isoPt(ix, iy, iz + dz, cx, cy);
  const t10 = isoPt(ix + dx, iy, iz + dz, cx, cy);
  const t11 = isoPt(ix + dx, iy + dy, iz + dz, cx, cy);
  const t01 = isoPt(ix, iy + dy, iz + dz, cx, cy);

  const shOff = 10;
  const s00 = isoPt(ix + shOff, iy + shOff, Math.max(0, iz - 2), cx, cy);
  const s10 = isoPt(ix + dx + shOff, iy + shOff, Math.max(0, iz - 2), cx, cy);
  const s11 = isoPt(ix + dx + shOff, iy + dy + shOff, Math.max(0, iz - 2), cx, cy);
  const s01 = isoPt(ix + shOff, iy + dy + shOff, Math.max(0, iz - 2), cx, cy);

  return (
    <g opacity={opacity}>
      {shadowOpacity > 0 ? (
        <polygon points={ptsToAttr([s00, s10, s11, s01])} fill="#060913" opacity={shadowOpacity} />
      ) : null}
      {/* Left-front face (+y side) */}
      <polygon points={ptsToAttr([b01, b11, t11, t01])} fill={leftColor} />
      {/* Right-front face (+x side) */}
      <polygon points={ptsToAttr([b10, b11, t11, t10])} fill={rightColor} />
      {/* Top diamond face */}
      <polygon points={ptsToAttr([t00, t10, t11, t01])} fill={topColor} />
      {/* Specular ridge highlights */}
      <polyline
        points={ptsToAttr([t01, t11, t10])}
        fill="none"
        stroke={rimColor}
        strokeOpacity={0.62}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <line
        x1={t11[0]}
        y1={t11[1]}
        x2={b11[0]}
        y2={b11[1]}
        stroke={rimColor}
        strokeOpacity={0.34}
        strokeWidth={1.4}
      />
    </g>
  );
};

const IsoGridBackdrop: React.FC<{
  pal: PaletteH;
  localFrame: number;
  uid: string;
}> = ({ pal, localFrame, uid }) => {
  const shimmer = 0.5 + 0.5 * Math.sin(localFrame * 0.05);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 840px 620px at 540px 540px, #252E47 0%, ${pal.bg2} 45%, ${pal.bg} 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id={`${uid}-glow`} cx="50%" cy="32%" r="48%">
            <stop offset="0%" stopColor={pal.accent2} stopOpacity={0.14 + shimmer * 0.04} />
            <stop offset="100%" stopColor={pal.bg} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={STAGE_W} height={STAGE_H} fill={`url(#${uid}-glow)`} />
        {/* Crisp 30° isometric architectural background grid */}
        {Array.from({ length: 16 }).map((_, i) => {
          const offset = (i - 7) * 120;
          return (
            <g key={i} stroke="#94A3B8" strokeOpacity={0.07} strokeWidth={1}>
              <line x1={offset} y1={120} x2={offset + 1200 * COS30} y2={120 + 1200 * SIN30} />
              <line x1={STAGE_W - offset} y1={120} x2={STAGE_W - offset - 1200 * COS30} y2={120 + 1200 * SIN30} />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/** look-21 Shot 1: conveyor-pipeline — สายพาน/โฟลว์ไอโซเมตริก 3–4 สถานีพร้อมแพ็กเก็ตพลังงานวิ่งผ่านและป้ายคำอธิบาย */
const ConveyorPipelineShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = resolvePaletteH(tokens, ISO_DEFAULTS);
  const t = sceneTexts(scene);
  const pts = extractPointsH(scene, 4);
  const stationCount = Math.max(3, Math.min(4, pts.length));

  const cx = 540;
  const cy = 620;
  const baseZ = 24;

  const stationSpecs =
    stationCount === 3
      ? [
          { ix: -195, iy: -65, dz: 88, top: '#6EE7B7', left: '#34D399', right: '#059669', col: '#34D399' },
          { ix: -45, iy: -10, dz: 112, top: '#7DD3FC', left: '#38BDF8', right: '#0284C7', col: '#38BDF8' },
          { ix: 105, iy: -65, dz: 132, top: '#FCD34D', left: '#F59E0B', right: '#B45309', col: '#F59E0B' },
        ]
      : [
          { ix: -215, iy: -85, dz: 78, top: '#6EE7B7', left: '#34D399', right: '#059669', col: '#34D399' },
          { ix: -90, iy: 10, dz: 102, top: '#7DD3FC', left: '#38BDF8', right: '#0284C7', col: '#38BDF8' },
          { ix: 35, iy: -85, dz: 120, top: '#C4B5FD', left: '#8B5CF6', right: '#5B21B6', col: '#A78BFA' },
          { ix: 155, iy: 10, dz: 140, top: '#FCD34D', left: '#F59E0B', right: '#B45309', col: '#F59E0B' },
        ];

  // Track points connecting the front of each isometric station
  const trackPts: Array<[number, number]> = stationSpecs.map((s) =>
    isoPt(s.ix + 38, s.iy + 96, baseZ + 2, cx, cy),
  );
  const trackD = trackPts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const trackProg = easeOutCubic(clamp01((localFrame - 2) / 22));

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <IsoGridBackdrop pal={pal} localFrame={localFrame} uid="g21s1" />

      <StageHeader
        badge={t.badge}
        title={t.title}
        subtitle={t.subtitle}
        fg={pal.fg}
        muted={pal.muted}
        accent={pal.accent}
        localFrame={localFrame}
        compact
      />

      {/* Isometric Conveyor Pipeline Stage (y: 280..865) */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Main Isometric Baseplate Slab */}
        <IsoCube30
          ix={-255}
          iy={-140}
          iz={0}
          dx={510}
          dy={290}
          dz={baseZ}
          cx={cx}
          cy={cy}
          topColor="#253048"
          leftColor="#1B2336"
          rightColor="#121826"
          rimColor="#64748B"
          shadowOpacity={0.55}
        />

        {/* Conveyor Track Conduit */}
        <path
          d={trackD}
          fill="none"
          stroke="#0F172A"
          strokeWidth={34}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={trackD}
          fill="none"
          stroke={pal.accent2}
          strokeWidth={10}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.28 * trackProg}
        />
        <path
          d={trackD}
          fill="none"
          stroke={pal.accent}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="14 14"
          strokeDashoffset={-(localFrame * 3.2)}
          opacity={trackProg}
        />

        {/* 3D Isometric Station Blocks popping up sequentially */}
        {stationSpecs.map((s, idx) => {
          const sp = spring({
            frame: Math.max(0, localFrame - (3 + idx * 5)),
            fps,
            config: { damping: 12, stiffness: 145 },
          });
          const curDz = Math.max(6, s.dz * sp);
          const capTop = isoPt(s.ix + 38, s.iy + 38, baseZ + curDz + 14, cx, cy);

          return (
            <g key={idx}>
              <IsoCube30
                ix={s.ix}
                iy={s.iy}
                iz={baseZ}
                dx={76}
                dy={76}
                dz={curDz}
                cx={cx}
                cy={cy}
                topColor={s.top}
                leftColor={s.left}
                rightColor={s.right}
                opacity={clamp01(sp * 1.4)}
              />
              {/* Crisp white architectural roof cap */}
              <IsoCube30
                ix={s.ix - 4}
                iy={s.iy - 4}
                iz={baseZ + curDz}
                dx={84}
                dy={84}
                dz={12}
                cx={cx}
                cy={cy}
                topColor="#F8FAFC"
                leftColor="#CBD5E1"
                rightColor="#94A3B8"
                shadowOpacity={0}
                opacity={clamp01(sp * 1.3)}
              />
              {/* Floating station number pin */}
              <g opacity={appear(localFrame, 10 + idx * 5, 10)}>
                <line
                  x1={capTop[0]}
                  y1={capTop[1] - 4}
                  x2={capTop[0]}
                  y2={capTop[1] - 38}
                  stroke={s.col}
                  strokeWidth={2}
                  strokeDasharray="3 4"
                />
                <circle cx={capTop[0]} cy={capTop[1] - 54} r={20} fill="#0F172A" stroke={s.col} strokeWidth={2.5} />
                <text
                  x={capTop[0]}
                  y={capTop[1] - 48}
                  textAnchor="middle"
                  fill="#F8FAFC"
                  fontSize={16}
                  fontFamily={FONT_MONO}
                  fontWeight={900}
                >
                  {`0${idx + 1}`}
                </text>
              </g>
            </g>
          );
        })}

        {/* Animated Luminous Energy Packets gliding along the isometric conveyor */}
        {[0, 0.34, 0.68].map((phase, idx) => {
          const pT = ((localFrame * 0.015) + phase) % 1;
          const [px, py] = polylinePoint(trackPts, pT);
          const pCol = idx === 0 ? '#FEF08A' : idx === 1 ? '#38BDF8' : '#34D399';
          return (
            <g key={`pkt-${idx}`} opacity={trackProg}>
              <circle cx={px} cy={py} r={16} fill={pCol} opacity={0.28} />
              <polygon
                points={`${px},${py - 10} ${px + 12},${py - 3} ${px},${py + 4} ${px - 12},${py - 3}`}
                fill="#FFFFFF"
                stroke={pCol}
                strokeWidth={2}
              />
              <polygon
                points={`${px - 12},${py - 3} ${px},${py + 4} ${px},${py + 12} ${px - 12},${py + 5}`}
                fill={pCol}
              />
              <polygon
                points={`${px + 12},${py - 3} ${px},${py + 4} ${px},${py + 12} ${px + 12},${py + 5}`}
                fill={pal.bg2}
              />
            </g>
          );
        })}
      </svg>

      {/* Station Explanation Cards (y: 882..1395) */}
      <div
        style={{
          position: 'absolute',
          top: 882,
          left: 52,
          right: 52,
          display: stationCount <= 3 ? 'flex' : 'grid',
          flexDirection: stationCount <= 3 ? 'column' : undefined,
          gridTemplateColumns: stationCount === 4 ? '1fr 1fr' : undefined,
          gap: 13,
        }}
      >
        {pts.slice(0, stationCount).map((pt, i) => {
          const p = stagger(i, localFrame, 6, 10, 14);
          const s = stationSpecs[i % stationSpecs.length];
          return (
            <div
              key={i}
              style={{
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [18, 0])}px)`,
                background: hexToRgba(pal.surface, 0.94),
                border: `1.6px solid ${hexToRgba(s.col, 0.48)}`,
                borderLeft: `6px solid ${s.col}`,
                borderRadius: 16,
                padding: '13px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                minHeight: stationCount <= 3 ? 88 : 114,
                height: 'auto',
                boxShadow: '0 10px 24px rgba(5, 8, 17, 0.42)',
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 11,
                  background: hexToRgba(s.col, 0.18),
                  border: `1.5px solid ${s.col}`,
                  color: s.col,
                  fontFamily: FONT_MONO,
                  fontSize: 17,
                  fontWeight: 900,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {`0${i + 1}`}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText
                  text={pt}
                  baseSize={stationCount <= 3 ? 23 : 21}
                  minSize={16}
                  maxLines={3}
                  color={pal.fg}
                  fontWeight={600}
                  align="left"
                  lineHeight={1.34}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-21 Shot 2: layered-stack — บล็อกสถาปัตยกรรมไอโซเมตริก 3–4 ชั้นลอยแยกแนวตั้งพร้อมเส้นโยงการ์ดอธิบาย */
const LayeredStackShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = resolvePaletteH(tokens, ISO_DEFAULTS);
  const t = sceneTexts(scene);
  const pts = extractPointsH(scene, 4);
  const layerCount = Math.max(3, Math.min(4, pts.length));

  const explodeSpring = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 115 } });
  const stackCx = 252;
  const baseCy = 1140;

  const layerStyles = [
    { top: '#6EE7B7', left: '#34D399', right: '#059669', col: '#34D399', code: 'L-01' },
    { top: '#7DD3FC', left: '#38BDF8', right: '#0284C7', col: '#38BDF8', code: 'L-02' },
    { top: '#C4B5FD', left: '#8B5CF6', right: '#5B21B6', col: '#A78BFA', code: 'L-03' },
    { top: '#FCD34D', left: '#F59E0B', right: '#B45309', col: '#F59E0B', code: 'L-04' },
  ];

  // Top-down display order: layer 0 at top -> layer N-1 at bottom so visual aligns 1:1 with cards
  const zStep = layerCount === 3 ? 248 : 196;
  const topY = layerCount === 3 ? 355 : 320;
  const cardGap = layerCount === 3 ? 34 : 20;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <IsoGridBackdrop pal={pal} localFrame={localFrame} uid="g21s2" />

      <StageHeader
        badge={t.badge}
        title={t.title}
        subtitle={t.subtitle}
        fg={pal.fg}
        muted={pal.muted}
        accent={pal.accent2}
        localFrame={localFrame}
        compact
      />

      {/* Left Column: Exploded Isometric Architectural Stack + Connector Lines */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Central glowing vertical data spine */}
        <line
          x1={stackCx}
          y1={360}
          x2={stackCx}
          y2={1220}
          stroke={pal.accent2}
          strokeOpacity={0.35}
          strokeWidth={3}
          strokeDasharray="8 10"
          strokeDashoffset={-(localFrame * 2.4)}
        />

        {/* Draw layers bottom-to-top for correct painter's algorithm overlap */}
        {Array.from({ length: layerCount })
          .map((_, i) => layerCount - 1 - i)
          .map((i) => {
            const revIdx = layerCount - 1 - i;
            const st = layerStyles[i % layerStyles.length];
            const zVal = revIdx * zStep * (0.45 + 0.55 * explodeSpring) + Math.sin(localFrame * 0.06 + i) * 5;
            const cyBase = baseCy - (layerCount === 3 ? 110 : 50);
            const rightTip = isoPt(110, -110, zVal + 14, stackCx, cyBase);
            const cardTargetY = topY + i * (layerCount === 3 ? 248 : 206) + 64;

            return (
              <g key={i}>
                {/* Leader line from isometric plate to right explanation card */}
                <polyline
                  points={`${rightTip[0].toFixed(1)},${rightTip[1].toFixed(1)} ${(rightTip[0] + 24).toFixed(1)},${rightTip[1].toFixed(1)} 458,${cardTargetY.toFixed(1)}`}
                  fill="none"
                  stroke={st.col}
                  strokeOpacity={0.7 * appear(localFrame, 8 + i * 5, 12)}
                  strokeWidth={2.2}
                  strokeDasharray="5 5"
                />
                <circle cx={458} cy={cardTargetY} r={5} fill={st.col} opacity={appear(localFrame, 10 + i * 5, 10)} />

                {/* Floating Isometric Architectural Slab */}
                <IsoCube30
                  ix={-102}
                  iy={-102}
                  iz={zVal}
                  dx={204}
                  dy={204}
                  dz={28}
                  cx={stackCx}
                  cy={cyBase}
                  topColor={st.top}
                  leftColor={st.left}
                  rightColor={st.right}
                  shadowOpacity={0.28}
                />
                {/* Inner micro-module cube on top of slab */}
                <IsoCube30
                  ix={-42}
                  iy={-42}
                  iz={zVal + 28}
                  dx={84}
                  dy={84}
                  dz={16}
                  cx={stackCx}
                  cy={cyBase}
                  topColor="#F8FAFC"
                  leftColor="#CBD5E1"
                  rightColor="#94A3B8"
                  shadowOpacity={0.14}
                />
              </g>
            );
          })}

        {/* Ascending glowing energy pulses along central vertical spine */}
        {[0, 0.35, 0.7].map((off, k) => {
          const py = 1200 - (((localFrame * 5 + off * 800) % 820));
          return (
            <g key={k}>
              <circle cx={stackCx} cy={py} r={10} fill={pal.accent2} opacity={0.26} />
              <circle cx={stackCx} cy={py} r={4.5} fill="#FFFFFF" />
            </g>
          );
        })}
      </svg>

      {/* Right Column: Layer Explanation Cards (x: 472..1028, y: topY..1390) */}
      <div
        style={{
          position: 'absolute',
          top: topY,
          left: 472,
          right: 52,
          display: 'flex',
          flexDirection: 'column',
          gap: cardGap,
        }}
      >
        {pts.slice(0, layerCount).map((pt, i) => {
          const p = stagger(i, localFrame, 6, 8, 14);
          const st = layerStyles[i % layerStyles.length];
          return (
            <div
              key={i}
              style={{
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [24, 0])}px)`,
                background: hexToRgba(pal.surface, 0.94),
                border: `1.8px solid ${hexToRgba(st.col, 0.55)}`,
                borderLeft: `6px solid ${st.col}`,
                borderRadius: 18,
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minHeight: layerCount === 3 ? 196 : 168,
                height: 'auto',
                boxShadow: '0 12px 28px rgba(5, 8, 17, 0.45)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span
                  style={{
                    padding: '4px 11px',
                    borderRadius: 8,
                    background: hexToRgba(st.col, 0.18),
                    border: `1px solid ${st.col}`,
                    fontFamily: FONT_MONO,
                    fontSize: 14,
                    fontWeight: 900,
                    color: st.col,
                  }}
                >
                  {`LAYER ${st.code}`}
                </span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700, color: pal.muted }}>
                  {`TIER ${layerCount - i}`}
                </span>
              </div>
              <FitText
                text={pt}
                baseSize={23}
                minSize={17}
                maxLines={4}
                color={pal.fg}
                fontWeight={600}
                align="left"
                lineHeight={1.35}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-21 Shot 3: hub-router — แท่นไอโซเมตริกศูนย์กลางกระจายโฟลว์สู่บล็อกปลายทางพร้อมตัวเลขไฮไลต์ */
const HubRouterShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = resolvePaletteH(tokens, ISO_DEFAULTS);
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetricH(scene, sceneIndex, '10x', 'ROUTING');
  const isCompare = Boolean(scene.compare);
  const cmp = extractComparePairH(scene);
  const pts = extractPointsH(scene, 4);

  const cx = 540;
  const cy = 602;
  const hubSpring = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 130 } });
  const floatZ = Math.sin(localFrame * 0.08) * 6;

  const satellites = [
    { ix: -225, iy: -115, top: '#6EE7B7', left: '#34D399', right: '#059669', col: '#34D399', code: 'OUT-A' },
    { ix: 155, iy: -115, top: '#7DD3FC', left: '#38BDF8', right: '#0284C7', col: '#38BDF8', code: 'OUT-B' },
    { ix: -225, iy: 120, top: '#FCD34D', left: '#F59E0B', right: '#B45309', col: '#F59E0B', code: 'OUT-C' },
    { ix: 155, iy: 120, top: '#C4B5FD', left: '#8B5CF6', right: '#5B21B6', col: '#A78BFA', code: 'OUT-D' },
  ];

  const centerAnchor = isoPt(0, 0, 26, cx, cy);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <IsoGridBackdrop pal={pal} localFrame={localFrame} uid="g21s3" />

      <StageHeader
        badge={t.badge}
        title={t.title}
        fg={pal.fg}
        muted={pal.muted}
        accent={pal.accent}
        localFrame={localFrame}
        compact
      />

      {/* Isometric Central Hub Router Diorama (y: 280..858) */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Base Platform */}
        <IsoCube30
          ix={-260}
          iy={-175}
          iz={0}
          dx={520}
          dy={375}
          dz={20}
          cx={cx}
          cy={cy}
          topColor="#212B42"
          leftColor="#171E2F"
          rightColor="#101524"
          rimColor="#475569"
          shadowOpacity={0.55}
        />

        {/* Luminous 30° Branch Channels from Center Hub to Satellites */}
        {satellites.map((sat, idx) => {
          const targetPt = isoPt(sat.ix + 36, sat.iy + 36, 24, cx, cy);
          const midPt: [number, number] = [
            centerAnchor[0] + (targetPt[0] - centerAnchor[0]) * 0.5,
            centerAnchor[1] + (targetPt[1] - centerAnchor[1]) * 0.5,
          ];
          const pktT = ((localFrame * 0.025) + idx * 0.25) % 1;
          const [px, py] = polylinePoint([centerAnchor, midPt, targetPt], pktT);

          return (
            <g key={sat.code}>
              <line
                x1={centerAnchor[0]}
                y1={centerAnchor[1]}
                x2={targetPt[0]}
                y2={targetPt[1]}
                stroke={sat.col}
                strokeOpacity={0.28}
                strokeWidth={12}
                strokeLinecap="round"
              />
              <line
                x1={centerAnchor[0]}
                y1={centerAnchor[1]}
                x2={targetPt[0]}
                y2={targetPt[1]}
                stroke={sat.col}
                strokeWidth={3.5}
                strokeDasharray="10 10"
                strokeDashoffset={-(localFrame * 3)}
              />
              <circle cx={px} cy={py} r={10} fill={sat.col} opacity={0.35} />
              <circle cx={px} cy={py} r={4.5} fill="#FFFFFF" />
            </g>
          );
        })}

        {/* Back Satellites first for painter's order */}
        {satellites.slice(0, 2).map((sat, idx) => {
          const sp = spring({ frame: Math.max(0, localFrame - (6 + idx * 4)), fps, config: { damping: 14, stiffness: 140 } });
          return (
            <IsoCube30
              key={sat.code}
              ix={sat.ix}
              iy={sat.iy}
              iz={20}
              dx={72}
              dy={72}
              dz={Math.max(8, 66 * sp)}
              cx={cx}
              cy={cy}
              topColor={sat.top}
              leftColor={sat.left}
              rightColor={sat.right}
              opacity={clamp01(sp * 1.3)}
            />
          );
        })}

        {/* Elevated Central Isometric Core Router */}
        <IsoCube30
          ix={-68}
          iy={-68}
          iz={20}
          dx={136}
          dy={136}
          dz={Math.max(12, 92 * hubSpring)}
          cx={cx}
          cy={cy}
          topColor="#F8FAFC"
          leftColor="#CBD5E1"
          rightColor="#64748B"
          rimColor="#FFFFFF"
        />
        {/* Hovering Glowing Core Prism */}
        <IsoCube30
          ix={-40}
          iy={-40}
          iz={122 + floatZ}
          dx={80}
          dy={80}
          dz={44}
          cx={cx}
          cy={cy}
          topColor="#A7F3D0"
          leftColor={pal.accent}
          rightColor="#047857"
          shadowOpacity={0.2}
          opacity={clamp01(hubSpring * 1.3)}
        />

        {/* Front Satellites after center for painter's order */}
        {satellites.slice(2, 4).map((sat, idx) => {
          const sp = spring({ frame: Math.max(0, localFrame - (12 + idx * 4)), fps, config: { damping: 14, stiffness: 140 } });
          return (
            <IsoCube30
              key={sat.code}
              ix={sat.ix}
              iy={sat.iy}
              iz={20}
              dx={72}
              dy={72}
              dz={Math.max(8, 66 * sp)}
              cx={cx}
              cy={cy}
              topColor={sat.top}
              leftColor={sat.left}
              rightColor={sat.right}
              opacity={clamp01(sp * 1.3)}
            />
          );
        })}
      </svg>

      {/* Center Floating Metric Pill Overlay */}
      <div
        style={{
          position: 'absolute',
          top: 298,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 26px',
          borderRadius: 999,
          background: 'rgba(15, 23, 42, 0.92)',
          border: `2px solid ${pal.accent}`,
          boxShadow: `0 0 28px ${hexToRgba(pal.accent, 0.35)}`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          opacity: appear(localFrame, 6, 12),
        }}
      >
        <span style={{ fontFamily: FONT_MONO, fontSize: 34, fontWeight: 900, color: '#FFFFFF' }}>
          {metric.big.slice(0, 12)}
        </span>
        <span style={{ fontFamily: FONT_THAI, fontSize: 20, fontWeight: 700, color: pal.accent }}>
          {metric.unit.slice(0, 18)}
        </span>
      </div>

      {/* Bottom Output Cards (y: 868..1395) */}
      {isCompare ? (
        <div
          style={{
            position: 'absolute',
            top: 868,
            left: 52,
            right: 52,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
          }}
        >
          {[
            { title: cmp.leftTitle, items: cmp.leftItems, color: pal.accent3, tag: 'BRANCH A' },
            { title: cmp.rightTitle, items: cmp.rightItems, color: pal.accent, tag: 'BRANCH B' },
          ].map((col, idx) => {
            const p = stagger(idx, localFrame, 8, 10, 14);
            return (
              <div
                key={idx}
                style={{
                  opacity: p,
                  transform: `translateY(${interpolate(p, [0, 1], [18, 0])}px)`,
                  background: hexToRgba(pal.surface, 0.94),
                  border: `1.8px solid ${hexToRgba(col.color, 0.55)}`,
                  borderRadius: 18,
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  minHeight: 340,
                  height: 'auto',
                }}
              >
                <span style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 800, color: col.color }}>{col.tag}</span>
                <FitText
                  text={col.title}
                  baseSize={24}
                  minSize={18}
                  maxLines={2}
                  color={pal.fg}
                  fontWeight={800}
                  align="left"
                  lineHeight={1.3}
                />
                {col.items.map((item, k) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: col.color, marginTop: 10, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FitText
                        text={item}
                        baseSize={20}
                        minSize={16}
                        maxLines={3}
                        color={pal.fg}
                        fontWeight={500}
                        align="left"
                        lineHeight={1.34}
                      />
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            position: 'absolute',
            top: 868,
            left: 52,
            right: 52,
            display: pts.length <= 3 ? 'flex' : 'grid',
            flexDirection: pts.length <= 3 ? 'column' : undefined,
            gridTemplateColumns: pts.length === 4 ? '1fr 1fr' : undefined,
            gap: 14,
          }}
        >
          {pts.map((pt, i) => {
            const p = stagger(i, localFrame, 6, 10, 14);
            const sat = satellites[i % satellites.length];
            return (
              <div
                key={i}
                style={{
                  opacity: p,
                  transform: `translateY(${interpolate(p, [0, 1], [16, 0])}px)`,
                  background: hexToRgba(pal.surface, 0.94),
                  border: `1.6px solid ${hexToRgba(sat.col, 0.5)}`,
                  borderRadius: 16,
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  minHeight: pts.length <= 3 ? 90 : 120,
                  height: 'auto',
                }}
              >
                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: 8,
                    background: hexToRgba(sat.col, 0.18),
                    border: `1px solid ${sat.col}`,
                    fontFamily: FONT_MONO,
                    fontSize: 13,
                    fontWeight: 900,
                    color: sat.col,
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {sat.code}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={pt}
                    baseSize={pts.length <= 3 ? 23 : 21}
                    minSize={16}
                    maxLines={3}
                    color={pal.fg}
                    fontWeight={600}
                    align="left"
                    lineHeight={1.34}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** look-21 Shot 4: kpi-towers — เสาสถาปัตยกรรม/แท่งไอโซเมตริก 3 มิติสูงไล่ระดับเรืองแสงสำหรับตัวเลขสำคัญและสรุปผล */
const KpiTowersShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = resolvePaletteH(tokens, ISO_DEFAULTS);
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetricH(scene, sceneIndex, '+180%', 'KPI GROWTH');
  const pts = extractPointsH(scene, 4);

  const cx = 540;
  const cy = 720;

  // Derive relative heights from numbers if available, else clean ascending growth curve
  const parsedMags = [0, 1, 2, 3].map((i) => parseMagnitudeH(t.numbers[i]));
  const hasRealMags = parsedMags.filter((v) => v !== null).length >= 2;
  const maxMag = Math.max(1, ...parsedMags.map((v) => v ?? 0));
  const defaultHeights = [104, 174, 252, 332];

  const towers = [
    { ix: -190, iy: 16, top: '#7DD3FC', left: '#38BDF8', right: '#0284C7', col: '#38BDF8', tag: 'Q1' },
    { ix: -78, iy: -16, top: '#C4B5FD', left: '#8B5CF6', right: '#5B21B6', col: '#A78BFA', tag: 'Q2' },
    { ix: 34, iy: -48, top: '#FCD34D', left: '#F59E0B', right: '#B45309', col: '#F59E0B', tag: 'Q3' },
    { ix: 146, iy: -80, top: '#6EE7B7', left: '#34D399', right: '#059669', col: '#34D399', tag: 'Q4' },
  ].map((tw, idx) => {
    const h =
      hasRealMags && parsedMags[idx] !== null
        ? Math.round(92 + ((parsedMags[idx]! / maxMag) * 240))
        : defaultHeights[idx];
    const capVal = t.numbers[idx] ? t.numbers[idx].slice(0, 8) : `${(idx + 1) * 25}%`;
    return { ...tw, targetH: h, capVal };
  });

  const trendProg = easeOutCubic(clamp01((localFrame - 12) / 22));
  const trendPts = towers.map((tw) => isoPt(tw.ix + 34, tw.iy + 34, 24 + tw.targetH + 34, cx, cy));
  const trendD = trendPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <IsoGridBackdrop pal={pal} localFrame={localFrame} uid="g21s4" />

      <StageHeader
        badge={t.badge}
        title={t.title}
        subtitle={t.subtitle}
        fg={pal.fg}
        muted={pal.muted}
        accent={pal.accent}
        localFrame={localFrame}
        compact
      />

      {/* 3D Isometric KPI Skyline Stage (y: 295..890) */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Stepped Architectural Plinth */}
        <IsoCube30
          ix={-245}
          iy={-120}
          iz={0}
          dx={490}
          dy={220}
          dz={24}
          cx={cx}
          cy={cy}
          topColor="#253048"
          leftColor="#1B2336"
          rightColor="#121826"
          rimColor="#64748B"
          shadowOpacity={0.55}
        />

        {/* Rising Glowing Isometric KPI Towers */}
        {towers.map((tw, idx) => {
          const sp = spring({
            frame: Math.max(0, localFrame - (4 + idx * 5)),
            fps,
            config: { damping: 13, stiffness: 135 },
          });
          const curH = Math.max(10, tw.targetH * sp);
          const capCenter = isoPt(tw.ix + 34, tw.iy + 34, 24 + curH, cx, cy);

          return (
            <g key={tw.tag}>
              <IsoCube30
                ix={tw.ix}
                iy={tw.iy}
                iz={24}
                dx={68}
                dy={68}
                dz={curH}
                cx={cx}
                cy={cy}
                topColor={tw.top}
                leftColor={tw.left}
                rightColor={tw.right}
                opacity={clamp01(sp * 1.35)}
              />
              {/* Floating numeric badge above each tower */}
              <g opacity={appear(localFrame, 12 + idx * 5, 10)}>
                <rect
                  x={capCenter[0] - 46}
                  y={capCenter[1] - 58}
                  width={92}
                  height={32}
                  rx={10}
                  fill="#0B1120"
                  stroke={tw.col}
                  strokeWidth={2}
                />
                <text
                  x={capCenter[0]}
                  y={capCenter[1] - 37}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize={16}
                  fontFamily={FONT_MONO}
                  fontWeight={900}
                >
                  {tw.capVal}
                </text>
              </g>
            </g>
          );
        })}

        {/* Ascending Luminous Growth Trajectory Curve */}
        <path
          d={trendD}
          fill="none"
          stroke={pal.accent}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="600"
          strokeDashoffset={600 * (1 - trendProg)}
          opacity={0.9}
        />
        {trendPts.map((pt, idx) => (
          <circle
            key={`tp-${idx}`}
            cx={pt[0]}
            cy={pt[1]}
            r={5.5}
            fill="#FFFFFF"
            stroke={pal.accent}
            strokeWidth={2.5}
            opacity={appear(localFrame, 16 + idx * 4, 8)}
          />
        ))}
      </svg>

      {/* Hero KPI Metric Pill Floating Upper-Left of Skyline */}
      <div
        style={{
          position: 'absolute',
          top: 298,
          left: 52,
          maxWidth: 330,
          padding: '12px 18px',
          borderRadius: 18,
          background: 'rgba(15, 23, 42, 0.92)',
          border: `2px solid ${pal.accent}`,
          boxShadow: `0 12px 30px rgba(5, 8, 17, 0.55)`,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          opacity: appear(localFrame, 6, 12),
        }}
      >
        <FitText
          text={metric.unit}
          baseSize={14}
          minSize={12}
          maxLines={2}
          color={pal.accent}
          fontWeight={800}
          align="left"
          lineHeight={1.28}
        />
        <span style={{ fontFamily: FONT_MONO, fontSize: 38, fontWeight: 900, color: '#FFFFFF', lineHeight: 1.08 }}>
          {metric.big.slice(0, 10)}
        </span>
        {metric.delta ? (
          <FitText
            text={metric.delta}
            baseSize={14}
            minSize={12}
            maxLines={2}
            color={pal.accent3}
            fontWeight={700}
            align="left"
            lineHeight={1.28}
          />
        ) : null}
      </div>

      {/* Bottom Summary & KPI Takeaway Cards (y: 908..1395) */}
      <div
        style={{
          position: 'absolute',
          top: 908,
          left: 52,
          right: 52,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Summary Highlight Strip */}
        <div
          style={{
            opacity: appear(localFrame, 10, 12),
            background: hexToRgba(pal.accent, 0.13),
            border: `1.6px solid ${hexToRgba(pal.accent, 0.48)}`,
            borderRadius: 16,
            padding: '12px 18px',
          }}
        >
          <FitText
            text={scene.quote?.text || metric.label}
            baseSize={24}
            minSize={18}
            maxLines={2}
            color={pal.fg}
            fontWeight={700}
            align="left"
            lineHeight={1.32}
          />
        </div>

        {/* Takeaway Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: pts.length <= 2 ? '1fr' : '1fr 1fr',
            gap: 13,
          }}
        >
          {pts.map((pt, i) => {
            const p = stagger(i, localFrame, 6, 12, 14);
            const tw = towers[i % towers.length];
            return (
              <div
                key={i}
                style={{
                  opacity: p,
                  transform: `translateY(${interpolate(p, [0, 1], [16, 0])}px)`,
                  background: hexToRgba(pal.surface, 0.94),
                  border: `1.5px solid ${hexToRgba(tw.col, 0.48)}`,
                  borderRadius: 16,
                  padding: '13px 16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  minHeight: 102,
                  height: 'auto',
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: tw.col,
                    marginTop: 7,
                    flexShrink: 0,
                    boxShadow: `0 0 10px ${tw.col}`,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={pt}
                    baseSize={pts.length <= 2 ? 23 : 21}
                    minSize={16}
                    maxLines={3}
                    color={pal.fg}
                    fontWeight={600}
                    align="left"
                    lineHeight={1.34}
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
// BATCH H EXPORT — 3 Styles × 4 Shots = 12 Distinct Compositions
// ============================================================================

export const BATCH_H: StyleDirectorDef[] = [
  {
    styleId: 'look-19',
    shots: {
      'globe-arcs': GlobeArcsShot,
      'corridor-telemetry': CorridorTelemetryShot,
      'hub-constellation': HubConstellationShot,
      'flight-board': FlightBoardShot,
    },
    shotLabels: {
      'globe-arcs': 'ลูกโลก 3 มิติหมุนช้าๆ พร้อมเส้นโค้งเรืองแสงเชื่อมศูนย์กลางโลกและการ์ดสรุป',
      'corridor-telemetry': 'แผนที่เส้นทางเชื่อมต่อสองฝั่งพร้อมโค้งเปรียบเทียบระยะทางและความเร็ว',
      'hub-constellation': 'เครือข่ายฮับโลกกระจายเส้นโค้งสู่ภูมิภาคพร้อมตัวเลขสถิติเด่นกลางฮับ',
      'flight-board': 'บอร์ดเส้นทางระดับโลกและมินิโกลบสำหรับฉากหลายขั้นตอนหรือรายการสำคัญ',
    },
    infer: (scene) => {
      const text = haystackH(scene);
      if (scene.compare || H_COMPARE_RE.test(text)) {
        return 'corridor-telemetry';
      }
      if ((Array.isArray(scene.steps) && scene.steps.length > 0) || H_STEP_RE.test(text)) {
        return 'flight-board';
      }
      if (scene.stat || H_HUB_RE.test(text) || H_STAT_RE.test(text)) {
        return 'hub-constellation';
      }
      if (Array.isArray(scene.bullets) && scene.bullets.length >= 3) {
        return 'flight-board';
      }
      return null;
    },
  },
  {
    styleId: 'look-20',
    shots: {
      'lid-open-hero': LidOpenHeroShot,
      'browser-showcase': BrowserShowcaseShot,
      'split-dashboard': SplitDashboardShot,
      'window-cascade': WindowCascadeShot,
    },
    shotLabels: {
      'lid-open-hero': 'แล็ปท็อปอะลูมิเนียมเปิดฝาสาดแสงโชว์หน้า Hero และป้ายฟีเจอร์ลอย',
      'browser-showcase': 'หน้าต่างเบราว์เซอร์ macOS พร้อม URL bar แอนิเมชัน เคอร์เซอร์คลิกและการ์ดฟีเจอร์',
      'split-dashboard': 'จอแล็ปท็อปแสดงแดชบอร์ด 2 คอลัมน์ กราฟสถิติเด่นและข้อมูลเปรียบเทียบ',
      'window-cascade': 'หน้าต่างแอปแบบ Glass ซ้อนกัน 2–3 ชั้นเลื่อนเปิดตัวตามลำดับขั้น',
    },
    infer: (scene) => {
      const text = haystackH(scene);
      if (scene.compare || scene.stat || H_DASH_RE.test(text) || H_COMPARE_RE.test(text)) {
        return 'split-dashboard';
      }
      if (scene.quote?.text || (Array.isArray(scene.steps) && scene.steps.length > 0) || H_SUMMARY_RE.test(text)) {
        return 'window-cascade';
      }
      if (H_WEB_RE.test(text) || (Array.isArray(scene.bullets) && scene.bullets.length >= 2)) {
        return 'browser-showcase';
      }
      return null;
    },
  },
  {
    styleId: 'look-21',
    shots: {
      'conveyor-pipeline': ConveyorPipelineShot,
      'layered-stack': LayeredStackShot,
      'hub-router': HubRouterShot,
      'kpi-towers': KpiTowersShot,
    },
    shotLabels: {
      'conveyor-pipeline': 'สายพานไอโซเมตริก 3–4 สถานีพร้อมแพ็กเก็ตพลังงานวิ่งผ่านและป้ายคำอธิบาย',
      'layered-stack': 'บล็อกสถาปัตยกรรมไอโซเมตริก 3–4 ชั้นลอยแยกแนวตั้งพร้อมเส้นโยงการ์ดอธิบาย',
      'hub-router': 'แท่นไอโซเมตริกศูนย์กลางกระจายโฟลว์สู่บล็อกปลายทางพร้อมตัวเลขไฮไลต์',
      'kpi-towers': 'เสาแท่งไอโซเมตริก 3 มิติสูงไล่ระดับเรืองแสงสำหรับตัวเลขสำคัญและสรุปผล',
    },
    infer: (scene) => {
      const text = haystackH(scene);
      if (scene.compare || H_COMPARE_RE.test(text) || H_HUB_RE.test(text)) {
        return 'hub-router';
      }
      if (scene.stat || H_STAT_RE.test(text) || H_SUMMARY_RE.test(text)) {
        return 'kpi-towers';
      }
      if (H_LAYER_RE.test(text)) {
        return 'layered-stack';
      }
      if ((Array.isArray(scene.steps) && scene.steps.length > 0) || H_STEP_RE.test(text)) {
        return 'conveyor-pipeline';
      }
      return null;
    },
  },
];
