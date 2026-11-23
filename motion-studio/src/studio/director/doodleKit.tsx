/**
 * Doodle Kit — hand-drawn character rig, props and text mounts shared by the
 * illustrated styles (look-8 POV Doodle, look-5 Ink Doodle, look-7 Neon Silhouette).
 * One rig, three rendering themes: thick wobbly marker, thin black ink, black silhouette + neon rim.
 */
import React from 'react';
import { THAI_FONT_FAMILY, THAI_HAND_FAMILY } from '../../components/ThaiFontLoader';
import { CastRole, Mood, Pose, PropName } from './plan';

// ============================================================================
// THEMES
// ============================================================================

export type DoodleMode = 'marker' | 'ink' | 'silhouette';

export interface DoodleTheme {
  id: string;
  mode: DoodleMode;
  ink: string;
  skin: string;
  hair?: string;
  body: 'blob' | 'stick';
  wall: string;
  wallLow: string;
  floor: string;
  floorFront: string;
  sky: string;
  skyLow: string;
  ground: string;
  groundFront: string;
  garments: Record<CastRole, string>;
  accent: string;
  good: string;
  paper: string;
  paperLine: string;
  board: string;
  textInk: string;
  captionColor: string;
  captionFont: string;
  bodyFont: string;
  bubbleFill: string;
  bubbleText: string;
  rim?: string;
  lamp?: string;
  /** stroke widths */
  sw: { char: number; limb: number; prop: number; fine: number };
  grain: number;
}

export const DOODLE_THEMES: Record<string, DoodleTheme> = {
  'look-8': {
    id: 'look-8',
    mode: 'marker',
    ink: '#33201C',
    skin: '#ECEBE7',
    body: 'blob',
    wall: '#B2B392',
    wallLow: '#A4A584',
    floor: '#CDBD95',
    floorFront: '#B5A27A',
    sky: '#C9CDB4',
    skyLow: '#DCD6BC',
    ground: '#9EA37D',
    groundFront: '#8B8F6B',
    garments: {
      hero: '#5B8E86',
      interviewer: '#6E6A7E',
      boss: '#8E6F55',
      friend: '#A07E5A',
      crowd: '#ECEBE7',
    },
    accent: '#9A443C',
    good: '#4A776F',
    paper: '#F3EEE3',
    paperLine: '#C9BFAE',
    board: '#F5F2EA',
    textInk: '#33201C',
    captionColor: '#33201C',
    captionFont: THAI_HAND_FAMILY,
    bodyFont: THAI_HAND_FAMILY,
    bubbleFill: '#F7F3EA',
    bubbleText: '#33201C',
    sw: { char: 10, limb: 22, prop: 7.5, fine: 4.5 },
    grain: 0.09,
  },
  'look-5': {
    id: 'look-5',
    mode: 'ink',
    ink: '#1D1B1A',
    skin: '#FFFFFF',
    hair: '#6A4126',
    body: 'stick',
    wall: '#EAF6F7',
    wallLow: '#D8EEF1',
    floor: '#D2CEC5',
    floorFront: '#C4BFB4',
    sky: '#A9E2EC',
    skyLow: '#C9EEF3',
    ground: '#7DB25C',
    groundFront: '#D2CEC5',
    garments: {
      hero: '#FFFFFF',
      interviewer: '#3B5B92',
      boss: '#B07A4C',
      friend: '#6CA555',
      crowd: '#FFFFFF',
    },
    accent: '#E1191F',
    good: '#3E8E3A',
    paper: '#FFFFFF',
    paperLine: '#BFD8DD',
    board: '#FFFFFF',
    textInk: '#1D1B1A',
    captionColor: '#1D1B1A',
    captionFont: THAI_HAND_FAMILY,
    bodyFont: THAI_HAND_FAMILY,
    bubbleFill: '#FFFFFF',
    bubbleText: '#1D1B1A',
    sw: { char: 6.5, limb: 6.5, prop: 3.8, fine: 3 },
    grain: 0,
  },
  'look-7': {
    id: 'look-7',
    mode: 'silhouette',
    ink: '#08070B',
    skin: '#08070B',
    body: 'blob',
    wall: '#48304F',
    wallLow: '#170F1D',
    floor: '#1C1222',
    floorFront: '#120B16',
    sky: '#2F2A57',
    skyLow: '#EE8F67',
    ground: '#1C1222',
    groundFront: '#120B16',
    garments: {
      hero: '#2B6470',
      interviewer: '#3A2A44',
      boss: '#4A2A2A',
      friend: '#2E3D5C',
      crowd: '#08070B',
    },
    accent: '#FF5A44',
    good: '#FFC383',
    paper: '#2A1E30',
    paperLine: '#4A3752',
    board: '#21172A',
    textInk: '#FFE2B4',
    captionColor: '#FFF1DC',
    captionFont: THAI_FONT_FAMILY,
    bodyFont: THAI_FONT_FAMILY,
    bubbleFill: '#1A1220',
    bubbleText: '#FFE2B4',
    rim: '#FF5A44',
    lamp: '#FFE2B4',
    sw: { char: 0, limb: 18, prop: 4, fine: 3 },
    grain: 0.06,
  },
};

export function getDoodleTheme(styleId?: string): DoodleTheme | null {
  if (!styleId) return null;
  return DOODLE_THEMES[styleId.trim().toLowerCase()] || null;
}

export function isIllustratedStyle(styleId?: string): boolean {
  return getDoodleTheme(styleId) !== null;
}

// ============================================================================
// HAND-DRAWN "BOIL" HELPERS
// ============================================================================

export interface DrawCtx {
  theme: DoodleTheme;
  /** changes every few frames → lines re-drawn slightly differently ("boiling") */
  seed: number;
  /** local frame inside the scene */
  t: number;
  fps: number;
}

export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** Tiny jitter for line boil; silhouette & frozen ctx do not boil */
export function jit(ctx: DrawCtx, k: number, amp = 1.6): number {
  if (ctx.theme.mode === 'silhouette') return 0;
  return (hash01(ctx.seed * 13.7 + k * 3.1) - 0.5) * 2 * amp;
}

export function boil(ctx: DrawCtx, k: number, amp = 1.4, rotAmp = 0.5): string {
  return `translate(${jit(ctx, k, amp).toFixed(2)} ${jit(ctx, k + 50, amp).toFixed(2)}) rotate(${jit(ctx, k + 90, rotAmp).toFixed(2)})`;
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function easeOutBack(t: number): number {
  const c = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(c - 1, 3) + c1 * Math.pow(c - 1, 2);
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 3);
}

/** Pop-in scale for an element appearing at `start` frames */
export function popIn(t: number, start: number, dur = 12): number {
  if (t < start) return 0;
  return Math.max(0, easeOutBack((t - start) / dur));
}

/** Wobbly rounded rectangle path (hand-drawn box) */
export function wobRect(ctx: DrawCtx, x: number, y: number, w: number, h: number, r: number, k: number, amp = 2.2): string {
  const j = (i: number) => jit(ctx, k + i, amp);
  return [
    `M ${x + r + j(1)} ${y + j(2)}`,
    `L ${x + w - r + j(3)} ${y + j(4)}`,
    `Q ${x + w + j(5)} ${y + j(6)} ${x + w + j(7)} ${y + r + j(8)}`,
    `L ${x + w + j(9)} ${y + h - r + j(10)}`,
    `Q ${x + w + j(11)} ${y + h + j(12)} ${x + w - r + j(13)} ${y + h + j(14)}`,
    `L ${x + r + j(15)} ${y + h + j(16)}`,
    `Q ${x + j(17)} ${y + h + j(18)} ${x + j(19)} ${y + h - r + j(20)}`,
    `L ${x + j(21)} ${y + r + j(22)}`,
    `Q ${x + j(23)} ${y + j(24)} ${x + r + j(1)} ${y + j(2)}`,
    'Z',
  ].join(' ');
}

/** Wobbly line path between two points */
export function wobLine(ctx: DrawCtx, x1: number, y1: number, x2: number, y2: number, k: number, amp = 2): string {
  const mx = (x1 + x2) / 2 + jit(ctx, k, amp * 1.6);
  const my = (y1 + y2) / 2 + jit(ctx, k + 1, amp * 1.6);
  return `M ${x1 + jit(ctx, k + 2, amp)} ${y1 + jit(ctx, k + 3, amp)} Q ${mx} ${my} ${x2 + jit(ctx, k + 4, amp)} ${y2 + jit(ctx, k + 5, amp)}`;
}

// ============================================================================
// TEXT FITTING (Thai-aware)
// ============================================================================

const THAI_COMBINING = /[ัิ-ฺ็-๎]/g;

export function visualLength(text: string): number {
  return text.replace(THAI_COMBINING, '').length;
}

/** Largest font size (px) that fits `text` in a w×h box, given an average glyph width ratio */
export function fitFontSize(text: string, w: number, h: number, max: number, min = 22, lineHeight = 1.32): number {
  const paras = text.split('\n').map((p) => Math.max(1, visualLength(p)));
  for (let size = max; size >= min; size -= 2) {
    const perLine = Math.max(1, Math.floor(w / (size * 0.66)));
    // Thai wraps at word boundaries, so allow ~15% slack per wrapped paragraph
    const lines = paras.reduce((acc, len) => acc + (len <= perLine ? 1 : Math.ceil((len * 1.15) / perLine)), 0);
    if (lines * size * lineHeight <= h) return size;
  }
  return min;
}

export const HandText: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  max?: number;
  min?: number;
  color: string;
  font: string;
  weight?: number;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'center' | 'bottom';
  /** 0..1 write-on reveal (left→right) */
  reveal?: number;
  rotate?: number;
  highlight?: string;
  highlightColor?: string;
  shadow?: string;
  lineHeight?: number;
}> = ({
  x,
  y,
  w,
  h,
  text,
  max = 64,
  min = 22,
  color,
  font,
  weight = 700,
  align = 'center',
  valign = 'center',
  reveal = 1,
  rotate = 0,
  highlight,
  highlightColor,
  shadow,
  lineHeight = 1.3,
}) => {
  const size = fitFontSize(text, w, h, max, min, lineHeight);
  const r = clamp01(reveal);
  let content: React.ReactNode = text;
  if (highlight && highlightColor && text.includes(highlight)) {
    const idx = text.indexOf(highlight);
    content = (
      <>
        {text.slice(0, idx)}
        <span style={{ color: highlightColor, textDecoration: 'underline', textDecorationThickness: Math.max(3, size * 0.08), textUnderlineOffset: size * 0.16 }}>
          {highlight}
        </span>
        {text.slice(idx + highlight.length)}
      </>
    );
  }
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        display: 'flex',
        alignItems: valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center',
        justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        clipPath: r >= 1 ? undefined : `inset(-20% ${((1 - r) * 100).toFixed(1)}% -20% -4%)`,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: '100%',
          fontFamily: font,
          fontWeight: weight,
          fontSize: size,
          lineHeight,
          color,
          textAlign: align,
          textShadow: shadow,
          wordBreak: 'normal',
          overflowWrap: 'anywhere',
          whiteSpace: 'pre-line',
        }}
      >
        {content}
      </div>
    </div>
  );
};

// ============================================================================
// CHARACTER RIG
// ============================================================================

type Pt = [number, number];

interface ArmPose {
  le: Pt;
  lh: Pt;
  re: Pt;
  rh: Pt;
}

function armPose(pose: Pose, dir: number, t: number): ArmPose {
  const typing = Math.floor(t / 3) % 2 === 0 ? 0 : 7;
  switch (pose) {
    case 'type':
      return { le: [-112, 118], lh: [-58, 168 + typing], re: [112, 118], rh: [58, 168 + (7 - typing)] };
    case 'point':
      return { le: [-112, 110], lh: [-120, 182], re: [165 * (dir || 1), 8], rh: [240 * (dir || 1), -46] };
    case 'shrug':
      return { le: [-150, 96], lh: [-205, 8], re: [150, 96], rh: [205, 8] };
    case 'cheer': {
      const pump = Math.sin(t * 0.35) * 14;
      return { le: [-132, -58], lh: [-150, -196 - pump], re: [132, -58], rh: [150, -196 + pump] };
    }
    case 'facepalm':
      return { le: [-112, 110], lh: [-120, 182], re: [96, 62], rh: [34, -98] };
    case 'think':
      return { le: [-60, 122], lh: [42, 112], re: [84, 112], rh: [26, -22] };
    case 'wave': {
      const w = Math.sin(t * 0.4) * 30;
      return { le: [-112, 110], lh: [-120, 182], re: [172, -26], rh: [192 + w, -152] };
    }
    case 'hold':
      return { le: [-112, 112], lh: [-58, 78], re: [112, 112], rh: [58, 78] };
    case 'present': {
      const d = dir || 1;
      return { le: [-112 * d, 110], lh: [-120 * d, 182], re: [162 * d, 30], rh: [236 * d, -58] };
    }
    case 'stand':
    default:
      return { le: [-112, 110], lh: [-120, 184], re: [112, 110], rh: [120, 184] };
  }
}

export interface PersonProps {
  ctx: DrawCtx;
  x: number;
  y: number;
  s?: number;
  role?: CastRole;
  pose?: Pose;
  mood?: Mood;
  /** -1 = looking left, 0 = camera, 1 = looking right */
  facing?: -1 | 0 | 1;
  legs?: boolean;
  /** distinct id offset for boil seeds */
  k?: number;
  /** override garment colour */
  garment?: string;
  flipX?: boolean;
}

const Face: React.FC<{ ctx: DrawCtx; mood: Mood; fx: number; hy: number; r: number; k: number }> = ({
  ctx,
  mood,
  fx,
  hy,
  r,
  k,
}) => {
  const { theme } = ctx;
  const ink = theme.ink;
  const sc = r / 92;
  const sw = theme.mode === 'ink' ? 4.5 : 9.5;
  const browW = theme.mode === 'ink' ? 5 : 12;
  const ex = 36 * sc;
  const ey = hy + 6 * sc;
  const g = (dx: number, dy: number) => `translate(${fx + dx} ${dy})`;

  if (theme.mode === 'silhouette') {
    // White eyes only — the mood lives in their shape
    const eye = (side: number) => {
      const cx = fx + side * ex;
      if (mood === 'happy') {
        return <path key={side} d={`M ${cx - 16 * sc} ${ey + 6} Q ${cx} ${ey - 16 * sc} ${cx + 16 * sc} ${ey + 6}`} fill="none" stroke="#FFFFFF" strokeWidth={7 * sc} strokeLinecap="round" />;
      }
      if (mood === 'tired' || mood === 'smug') {
        return <path key={side} d={`M ${cx - 17 * sc} ${ey} A ${17 * sc} ${11 * sc} 0 0 0 ${cx + 17 * sc} ${ey} Z`} fill="#FFFFFF" />;
      }
      const big = mood === 'shock' || mood === 'panic' ? 1.45 : mood === 'worried' ? 1.15 : 1;
      return <ellipse key={side} cx={cx} cy={ey} rx={14 * sc * big} ry={19 * sc * big} fill="#FFFFFF" />;
    };
    return <g>{eye(-1)}{eye(1)}</g>;
  }

  const brows = (() => {
    const bL = (d: string) => <path d={d} fill="none" stroke={ink} strokeWidth={browW * sc} strokeLinecap="round" />;
    const yb = hy - 42 * sc;
    switch (mood) {
      case 'confident':
        return <g transform={g(0, 0)}>{bL(`M ${-62 * sc} ${yb - 4} L ${-14 * sc} ${yb + 8}`)}{bL(`M ${14 * sc} ${yb + 8} L ${62 * sc} ${yb - 4}`)}</g>;
      case 'worried':
        return <g transform={g(0, 0)}>{bL(`M ${-62 * sc} ${yb + 8} Q ${-40 * sc} ${yb - 6} ${-14 * sc} ${yb - 14}`)}{bL(`M ${14 * sc} ${yb - 14} Q ${40 * sc} ${yb - 6} ${62 * sc} ${yb + 8}`)}</g>;
      case 'panic':
      case 'shock':
        return <g transform={g(0, -14 * sc)}>{bL(`M ${-66 * sc} ${yb} Q ${-40 * sc} ${yb - 30 * sc} ${-12 * sc} ${yb - 8}`)}{bL(`M ${12 * sc} ${yb - 8} Q ${40 * sc} ${yb - 30 * sc} ${66 * sc} ${yb}`)}</g>;
      case 'happy':
        return <g transform={g(0, -8 * sc)}>{bL(`M ${-60 * sc} ${yb} Q ${-38 * sc} ${yb - 18 * sc} ${-16 * sc} ${yb}`)}{bL(`M ${16 * sc} ${yb} Q ${38 * sc} ${yb - 18 * sc} ${60 * sc} ${yb}`)}</g>;
      case 'think':
        return <g transform={g(0, 0)}>{bL(`M ${-60 * sc} ${yb + 2} L ${-16 * sc} ${yb + 4}`)}{bL(`M ${14 * sc} ${yb - 6} Q ${40 * sc} ${yb - 26 * sc} ${64 * sc} ${yb - 8}`)}</g>;
      case 'smug':
        return <g transform={g(0, 0)}>{bL(`M ${-62 * sc} ${yb + 6} L ${-16 * sc} ${yb + 6}`)}{bL(`M ${16 * sc} ${yb - 4} Q ${40 * sc} ${yb - 18 * sc} ${62 * sc} ${yb - 6}`)}</g>;
      case 'tired':
      default:
        return <g transform={g(0, 0)}>{bL(`M ${-60 * sc} ${yb - 6} L ${-16 * sc} ${yb + 6}`)}{bL(`M ${16 * sc} ${yb + 6} L ${60 * sc} ${yb - 6}`)}</g>;
    }
  })();

  const eyes = (() => {
    if (mood === 'panic' || mood === 'shock') {
      const rr = (mood === 'panic' ? 21 : 19) * sc;
      return (
        <g>
          {[-1, 1].map((sd) => (
            <g key={sd}>
              <circle cx={fx + sd * ex} cy={ey} r={rr} fill="#FFFFFF" stroke={ink} strokeWidth={sw * 0.7 * sc} />
              <circle cx={fx + sd * ex + jit(ctx, k + sd, 1.2)} cy={ey + jit(ctx, k + sd + 4, 1.2)} r={(mood === 'panic' ? 5 : 7) * sc} fill={ink} />
            </g>
          ))}
          {mood === 'panic' && (
            <>
              <path d={`M ${fx - ex - 18 * sc} ${ey + 30 * sc} Q ${fx - ex} ${ey + 38 * sc} ${fx - ex + 18 * sc} ${ey + 30 * sc}`} fill="none" stroke={ink} strokeWidth={3.5 * sc} strokeLinecap="round" opacity={0.8} />
              <path d={`M ${fx + ex - 18 * sc} ${ey + 30 * sc} Q ${fx + ex} ${ey + 38 * sc} ${fx + ex + 18 * sc} ${ey + 30 * sc}`} fill="none" stroke={ink} strokeWidth={3.5 * sc} strokeLinecap="round" opacity={0.8} />
            </>
          )}
        </g>
      );
    }
    if (mood === 'happy') {
      return (
        <g>
          {[-1, 1].map((sd) => (
            <path key={sd} d={`M ${fx + sd * ex - 15 * sc} ${ey + 5 * sc} Q ${fx + sd * ex} ${ey - 14 * sc} ${fx + sd * ex + 15 * sc} ${ey + 5 * sc}`} fill="none" stroke={ink} strokeWidth={sw * 0.75 * sc} strokeLinecap="round" />
          ))}
        </g>
      );
    }
    if (mood === 'tired' || mood === 'smug') {
      return (
        <g>
          {[-1, 1].map((sd) => (
            <g key={sd}>
              <circle cx={fx + sd * ex} cy={ey + 4 * sc} r={8 * sc} fill={ink} />
              <path d={`M ${fx + sd * ex - 17 * sc} ${ey - 3 * sc} L ${fx + sd * ex + 17 * sc} ${ey - 3 * sc}`} stroke={ink} strokeWidth={sw * 0.7 * sc} strokeLinecap="round" />
            </g>
          ))}
          {mood === 'tired' && [-1, 1].map((sd) => (
            <path key={`b${sd}`} d={`M ${fx + sd * ex - 16 * sc} ${ey + 22 * sc} Q ${fx + sd * ex} ${ey + 30 * sc} ${fx + sd * ex + 16 * sc} ${ey + 22 * sc}`} fill="none" stroke={ink} strokeWidth={3.5 * sc} strokeLinecap="round" opacity={0.7} />
          ))}
        </g>
      );
    }
    const look = mood === 'think' ? 6 * sc : 0;
    return (
      <g>
        {[-1, 1].map((sd) => (
          <ellipse key={sd} cx={fx + sd * ex + look} cy={ey - look} rx={theme.mode === 'ink' ? 7 * sc : 9 * sc} ry={theme.mode === 'ink' ? 10 * sc : 10 * sc} fill={ink} />
        ))}
      </g>
    );
  })();

  const my = hy + 52 * sc;
  const mouth = (() => {
    switch (mood) {
      case 'panic':
        return (
          <g>
            <rect x={fx - 46 * sc} y={my - 16 * sc} width={92 * sc} height={32 * sc} rx={13 * sc} fill="#FFFFFF" stroke={ink} strokeWidth={sw * 0.65 * sc} />
            <line x1={fx - 44 * sc} y1={my} x2={fx + 44 * sc} y2={my} stroke={ink} strokeWidth={3.5 * sc} />
            {[-22, 0, 22].map((dx) => (
              <line key={dx} x1={fx + dx * sc} y1={my - 15 * sc} x2={fx + dx * sc} y2={my + 15 * sc} stroke={ink} strokeWidth={3 * sc} />
            ))}
          </g>
        );
      case 'shock':
        return <ellipse cx={fx} cy={my + 4 * sc} rx={16 * sc} ry={22 * sc} fill={ink} />;
      case 'happy':
        return <path d={`M ${fx - 40 * sc} ${my - 12 * sc} Q ${fx} ${my + 44 * sc} ${fx + 40 * sc} ${my - 12 * sc} Z`} fill={ink} stroke={ink} strokeWidth={sw * 0.5 * sc} strokeLinejoin="round" />;
      case 'worried':
        return <path d={`M ${fx - 30 * sc} ${my} Q ${fx - 15 * sc} ${my - 9 * sc} ${fx} ${my} Q ${fx + 15 * sc} ${my + 9 * sc} ${fx + 30 * sc} ${my}`} fill="none" stroke={ink} strokeWidth={sw * 0.65 * sc} strokeLinecap="round" />;
      case 'smug':
      case 'confident':
        return <path d={`M ${fx - 28 * sc} ${my + 2 * sc} Q ${fx + 4 * sc} ${my + 14 * sc} ${fx + 32 * sc} ${my - 8 * sc}`} fill="none" stroke={ink} strokeWidth={sw * 0.65 * sc} strokeLinecap="round" />;
      case 'think':
        return <path d={`M ${fx - 6 * sc} ${my + 4 * sc} L ${fx + 24 * sc} ${my}`} fill="none" stroke={ink} strokeWidth={sw * 0.65 * sc} strokeLinecap="round" />;
      case 'tired':
      default:
        return <path d={`M ${fx - 22 * sc} ${my + 4 * sc} L ${fx + 22 * sc} ${my + 4 * sc}`} fill="none" stroke={ink} strokeWidth={sw * 0.65 * sc} strokeLinecap="round" />;
    }
  })();

  const sweatN = mood === 'panic' ? 2 : mood === 'worried' ? 1 : 0;
  const drop = (ctx.t * 2.2) % 40;
  const sweat = Array.from({ length: sweatN }).map((_, i) => {
    const sx = fx + (i === 0 ? 1 : -1) * (r * 0.95);
    const sy = hy - r * 0.45 + drop * 0.5 + i * 18;
    return (
      <path
        key={i}
        d={`M ${sx} ${sy - 22 * sc} Q ${sx + 13 * sc} ${sy} ${sx} ${sy + 9 * sc} Q ${sx - 13 * sc} ${sy} ${sx} ${sy - 22 * sc} Z`}
        fill="#9CCBD1"
        stroke={ink}
        strokeWidth={3.5 * sc}
      />
    );
  });

  const blush =
    mood === 'happy' ? (
      <g opacity={0.35}>
        <ellipse cx={fx - 62 * sc} cy={ey + 28 * sc} rx={16 * sc} ry={9 * sc} fill={theme.accent} />
        <ellipse cx={fx + 62 * sc} cy={ey + 28 * sc} rx={16 * sc} ry={9 * sc} fill={theme.accent} />
      </g>
    ) : null;

  return (
    <g>
      {blush}
      {brows}
      {eyes}
      {mouth}
      {sweat}
    </g>
  );
};

/** Hair / accessory doodles by role */
const RoleExtras: React.FC<{ ctx: DrawCtx; role: CastRole; hy: number; r: number; fx: number; silhouette: boolean }> = ({
  ctx,
  role,
  hy,
  r,
  fx,
  silhouette,
}) => {
  const { theme } = ctx;
  const ink = theme.ink;
  const sc = r / 92;
  const hairColor = theme.hair || ink;
  const out: React.ReactNode[] = [];
  if (theme.hair && role !== 'interviewer') {
    // messy brown hair tufts (look-5)
    const tufts = role === 'boss' ? 3 : 6;
    for (let i = 0; i < tufts; i++) {
      const a = Math.PI * (1.12 + (i / (tufts - 1)) * 0.76);
      const hx = fx * 0.3 + Math.cos(a) * r * 0.92;
      const hyy = hy + Math.sin(a) * r * 0.92;
      out.push(
        <path
          key={`h${i}`}
          d={`M ${hx - 22 * sc} ${hyy + 10 * sc} Q ${hx} ${hyy - 34 * sc} ${hx + 24 * sc} ${hyy + 6 * sc} Z`}
          fill={hairColor}
          stroke={ink}
          strokeWidth={theme.sw.fine}
          strokeLinejoin="round"
        />,
      );
    }
  }
  if (role === 'interviewer' && !silhouette) {
    // glasses
    const ey = hy + 6 * sc;
    out.push(
      <g key="glasses" fill="none" stroke={ink} strokeWidth={theme.mode === 'ink' ? 3.5 : 6 * sc}>
        <circle cx={fx - 36 * sc} cy={ey} r={25 * sc} />
        <circle cx={fx + 36 * sc} cy={ey} r={25 * sc} />
        <path d={`M ${fx - 11 * sc} ${ey} L ${fx + 11 * sc} ${ey}`} />
      </g>,
    );
    if (!theme.hair) {
      out.push(
        <path key="part" d={`M ${fx - r * 0.85} ${hy - r * 0.35} Q ${fx - r * 0.2} ${hy - r * 1.25} ${fx + r * 0.85} ${hy - r * 0.45} Q ${fx + r * 0.1} ${hy - r * 0.8} ${fx - r * 0.85} ${hy - r * 0.35} Z`} fill={ink} opacity={0.9} />,
      );
    }
  }
  if (role === 'boss' && !silhouette) {
    out.push(
      <path key="stache" d={`M ${fx - 34 * sc} ${hy + 40 * sc} Q ${fx} ${hy + 22 * sc} ${fx + 34 * sc} ${hy + 40 * sc} Q ${fx} ${hy + 34 * sc} ${fx - 34 * sc} ${hy + 40 * sc} Z`} fill={ink} />,
    );
  }
  if (role === 'friend' && !theme.hair && !silhouette) {
    out.push(
      <path key="curl" d={`M ${fx - 40 * sc} ${hy - r * 0.92} q 14 -30 30 -6 q 14 -30 30 -4 q 14 -26 26 4`} fill="none" stroke={ink} strokeWidth={theme.sw.fine * 1.4} strokeLinecap="round" />,
    );
  }
  return <g>{out}</g>;
};

export const Person: React.FC<PersonProps> = ({
  ctx,
  x,
  y,
  s = 1,
  role = 'hero',
  pose = 'stand',
  mood = 'confident',
  facing = 0,
  legs = false,
  k = 0,
  garment,
  flipX = false,
}) => {
  const { theme, t } = ctx;
  const silhouette = theme.mode === 'silhouette';
  const stick = theme.body === 'stick';
  const ink = theme.ink;
  const cloth = garment || theme.garments[role];
  const dir = facing;
  const arms = armPose(pose, dir === 0 ? 1 : dir, t);
  const r = stick ? 74 : 92;
  const hy = stick ? -82 : -104;
  const fx = dir * 20;
  const bob = Math.sin((t + k * 7) * 0.13) * 3;
  const headTilt = pose === 'think' ? -6 : pose === 'shrug' ? 5 * (dir || 1) : jit(ctx, k + 300, 1.2);
  const charSW = silhouette ? 0 : theme.sw.char;
  const limb = theme.sw.limb;
  const shoulderL: Pt = stick ? [0, 22] : [-78, 40];
  const shoulderR: Pt = stick ? [0, 22] : [78, 40];
  const handR = stick ? 13 : 19;

  const arm = (sh: Pt, el: Pt, hd: Pt, key: string) => {
    const d = `M ${sh[0]} ${sh[1]} Q ${el[0]} ${el[1]} ${hd[0]} ${hd[1]}`;
    if (stick) {
      return (
        <g key={key}>
          <path d={d} fill="none" stroke={ink} strokeWidth={limb} strokeLinecap="round" />
          <circle cx={hd[0]} cy={hd[1]} r={handR} fill="#FFFFFF" stroke={ink} strokeWidth={theme.sw.fine} />
        </g>
      );
    }
    if (silhouette) {
      return (
        <g key={key}>
          <path d={d} fill="none" stroke={ink} strokeWidth={limb} strokeLinecap="round" />
          <circle cx={hd[0]} cy={hd[1]} r={handR} fill={ink} />
        </g>
      );
    }
    return (
      <g key={key}>
        <path d={d} fill="none" stroke={ink} strokeWidth={limb + charSW * 0.9} strokeLinecap="round" />
        <path d={d} fill="none" stroke={cloth} strokeWidth={limb - 2} strokeLinecap="round" />
        <circle cx={hd[0]} cy={hd[1]} r={handR} fill={theme.skin} stroke={ink} strokeWidth={charSW * 0.75} />
      </g>
    );
  };

  const torso = stick ? (
    <g>
      <path d={`M 0 -6 L ${jit(ctx, k + 7, 2)} 150`} stroke={ink} strokeWidth={limb} strokeLinecap="round" />
      {role === 'interviewer' || role === 'boss' ? (
        <path d="M 0 10 L -10 40 L 0 70 L 10 40 Z" fill={cloth} stroke={ink} strokeWidth={theme.sw.fine} />
      ) : null}
    </g>
  ) : (
    <g>
      <path
        d={`M -108 178 C -104 46 -64 4 0 2 C 64 4 104 46 108 178 Z`}
        fill={silhouette ? ink : cloth}
        stroke={silhouette ? 'none' : ink}
        strokeWidth={charSW}
        strokeLinejoin="round"
      />
      {!silhouette && role === 'hero' && (
        <g stroke={ink} strokeWidth={charSW * 0.55} strokeLinecap="round" fill="none">
          <path d="M -46 10 Q 0 50 46 10" />
          <path d="M -18 32 L -22 78" />
          <path d="M 18 32 L 22 78" />
        </g>
      )}
      {silhouette && role === 'hero' && (
        <g stroke="#E7E2D6" strokeWidth={3} strokeLinecap="round" opacity={0.85}>
          <path d="M -16 30 L -20 76" />
          <path d="M 16 30 L 20 76" />
        </g>
      )}
      {!silhouette && (role === 'interviewer' || role === 'boss') && (
        <g>
          <path d="M -30 6 L 0 44 L 30 6" fill="#F3EEE3" stroke={ink} strokeWidth={charSW * 0.5} strokeLinejoin="round" />
          <path d="M 0 40 L -13 64 L 0 128 L 13 64 Z" fill={theme.accent} stroke={ink} strokeWidth={charSW * 0.5} strokeLinejoin="round" />
        </g>
      )}
    </g>
  );

  const legsEl = legs ? (
    stick ? (
      <g>
        <path d="M 0 148 L -38 292" stroke={ink} strokeWidth={limb} strokeLinecap="round" />
        <path d="M 0 148 L 38 292" stroke={ink} strokeWidth={limb} strokeLinecap="round" />
        <ellipse cx={-46} cy={296} rx={22} ry={10} fill={ink} />
        <ellipse cx={46} cy={296} rx={22} ry={10} fill={ink} />
      </g>
    ) : (
      <g>
        <path d="M -40 170 L -46 330" stroke={ink} strokeWidth={limb + 8} strokeLinecap="round" />
        <path d="M 40 170 L 46 330" stroke={ink} strokeWidth={limb + 8} strokeLinecap="round" />
        <ellipse cx={-58} cy={336} rx={36} ry={15} fill={ink} />
        <ellipse cx={58} cy={336} rx={36} ry={15} fill={ink} />
      </g>
    )
  ) : null;

  const body = (
    <g>
      {legsEl}
      {torso}
      {/* back arm first, front arm after head for gestures crossing the face */}
      {arm(shoulderL, arms.le, arms.lh, 'la')}
      <g transform={`rotate(${headTilt} 0 ${hy})`}>
        <circle
          cx={0}
          cy={hy}
          r={r}
          fill={silhouette ? ink : theme.skin}
          stroke={silhouette ? 'none' : ink}
          strokeWidth={stick ? theme.sw.char : charSW * 1.05}
        />
        <RoleExtras ctx={ctx} role={role} hy={hy} r={r} fx={fx} silhouette={silhouette} />
        <Face ctx={ctx} mood={mood} fx={fx} hy={hy} r={r} k={k} />
      </g>
      {arm(shoulderR, arms.re, arms.rh, 'ra')}
    </g>
  );

  const flip = flipX ? -1 : 1;
  const outer = `translate(${x} ${y + bob}) scale(${s * flip} ${s})`;

  if (silhouette && theme.rim) {
    return (
      <g transform={outer}>
        <g transform="translate(7 -3)" filter="url(#dd-rim)" opacity={0.95}>
          <RimCopy>{body}</RimCopy>
        </g>
        <g transform={boil(ctx, k, 0.8, 0.2)}>{body}</g>
      </g>
    );
  }

  return (
    <g transform={outer}>
      <g transform={boil(ctx, k, 1.2, 0.35)}>{body}</g>
    </g>
  );
};

/** Renders children as a flat rim-colour shape (used behind silhouettes for the neon edge) */
const RimCopy: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <g filter="url(#dd-rimfill)">{children}</g>
);

/** Shared <defs> every illustrated scene needs (rim glow, paper grain, soft shadow) */
export const DoodleDefs: React.FC<{ theme: DoodleTheme }> = ({ theme }) => (
  <defs>
    <filter id="dd-rimfill" x="-20%" y="-20%" width="140%" height="140%">
      <feFlood floodColor={theme.rim || theme.accent} result="c" />
      <feComposite in="c" in2="SourceAlpha" operator="in" />
    </filter>
    <filter id="dd-rim" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" />
    </filter>
    <filter id="dd-soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="18" />
    </filter>
    <pattern id="dd-grain" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx={4} cy={6} r={1.3} fill={theme.ink} opacity={0.5} />
      <circle cx={17} cy={19} r={1.1} fill={theme.ink} opacity={0.4} />
      <circle cx={21} cy={4} r={0.8} fill={theme.ink} opacity={0.35} />
      <circle cx={9} cy={21} r={0.9} fill="#FFFFFF" opacity={0.5} />
    </pattern>
    <linearGradient id="dd-dusk" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#2F2A57" />
      <stop offset="45%" stopColor="#B3687C" />
      <stop offset="78%" stopColor="#EE8F67" />
      <stop offset="100%" stopColor="#FFD7A0" />
    </linearGradient>
    <radialGradient id="dd-room" cx="50%" cy="35%" r="75%">
      <stop offset="0%" stopColor={theme.wall} />
      <stop offset="100%" stopColor={theme.wallLow} />
    </radialGradient>
    <radialGradient id="dd-lamp" cx="50%" cy="0%" r="100%">
      <stop offset="0%" stopColor={theme.lamp || '#FFFFFF'} stopOpacity={0.55} />
      <stop offset="100%" stopColor={theme.lamp || '#FFFFFF'} stopOpacity={0} />
    </radialGradient>
  </defs>
);

// ============================================================================
// PROPS
// ============================================================================

export interface PropProps {
  ctx: DrawCtx;
  name: PropName;
  x: number;
  y: number;
  s?: number;
  k?: number;
  /** text for calendar day / clock speed etc. */
  label?: string;
  rot?: number;
}

export const Prop: React.FC<PropProps> = ({ ctx, name, x, y, s = 1, k = 0, label, rot = 0 }) => {
  const { theme, t } = ctx;
  const ink = theme.ink;
  const sil = theme.mode === 'silhouette';
  const sw = theme.sw.prop;
  const fill = (c: string) => (sil ? shadeForSilhouette(c) : c);
  const strokeC = sil ? (theme.rim || ink) : ink;
  const common = { stroke: strokeC, strokeWidth: sil ? 2.5 : sw, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  let el: React.ReactNode = null;

  switch (name) {
    case 'laptop':
      el = (
        <g>
          <path d="M -150 70 L -125 -95 L 125 -95 L 150 70 Z" fill={fill('#4B4B4B')} {...common} />
          <circle cx={0} cy={-10} r={18} fill={fill(theme.wall)} {...common} strokeWidth={sw * 0.6} />
          <path d="M -175 70 L 175 70 L 160 96 L -160 96 Z" fill={fill('#6A6A6A')} {...common} />
        </g>
      );
      break;
    case 'mug':
      el = (
        <g>
          <path d="M -40 -50 L 40 -50 L 34 50 L -34 50 Z" fill={fill('#F3EEE3')} {...common} />
          <path d="M -38 -16 L 38 -16 L 36 14 L -36 14 Z" fill={fill('#8E6F55')} {...common} strokeWidth={sw * 0.6} />
          <path d="M 38 -26 Q 72 -20 66 6 Q 60 28 36 24" fill="none" {...common} />
          {!sil && <path d={`M -12 -64 Q -24 -86 -8 -${100 + jit(ctx, k, 4)} M 14 -62 Q 26 -84 10 -98`} fill="none" {...common} strokeWidth={sw * 0.5} opacity={0.6} />}
        </g>
      );
      break;
    case 'cup-tower': {
      const n = 3 + (label ? Math.min(4, Number(label) || 0) : 2);
      el = (
        <g>
          {Array.from({ length: n }).map((_, i) => {
            const row = Math.floor(Math.sqrt(2 * i + 0.25) - 0.5);
            const cy = -row * 62;
            const cx = (i - row * (row + 1) / 2) * 56 - row * 0 - 28 * (2 - row) + 28;
            const drop = i === n - 1 ? Math.max(0, 60 - t * 4) : 0;
            return (
              <g key={i} transform={`translate(${cx + jit(ctx, k + i, 1.5)} ${cy - drop}) rotate(${i === n - 1 ? jit(ctx, k + 9, 6) : 0})`}>
                <path d="M -24 -30 L 24 -30 L 19 28 L -19 28 Z" fill={fill('#F3EEE3')} {...common} strokeWidth={sw * 0.75} />
                <path d="M -22 -6 L 22 -6 L 20 10 L -20 10 Z" fill={fill('#8E6F55')} stroke="none" />
              </g>
            );
          })}
        </g>
      );
      break;
    }
    case 'calendar':
      el = (
        <g transform={`rotate(${3 + jit(ctx, k, 1)})`}>
          <path d={wobRect(ctx, -86, -92, 172, 184, 12, k)} fill={fill(theme.paper)} {...common} />
          <path d={wobRect(ctx, -86, -92, 172, 50, 10, k + 30)} fill={fill(theme.accent)} {...common} />
          <text x={0} y={-58} textAnchor="middle" fill={sil ? theme.textInk : '#F3EEE3'} fontSize={26} fontWeight={800} fontFamily={theme.bodyFont}>
            DAY
          </text>
          <text x={0} y={52} textAnchor="middle" fill={sil ? theme.textInk : ink} fontSize={label && label.length > 2 ? 60 : 82} fontWeight={800} fontFamily={theme.bodyFont}>
            {label || '1'}
          </text>
        </g>
      );
      break;
    case 'clock': {
      const ang = t * 7 + k * 40;
      el = (
        <g>
          <circle cx={0} cy={0} r={72} fill={fill(theme.paper)} {...common} />
          {[0, 90, 180, 270].map((a) => (
            <line key={a} x1={Math.cos((a * Math.PI) / 180) * 50} y1={Math.sin((a * Math.PI) / 180) * 50} x2={Math.cos((a * Math.PI) / 180) * 62} y2={Math.sin((a * Math.PI) / 180) * 62} {...common} strokeWidth={sw * 0.7} />
          ))}
          <line x1={0} y1={0} x2={Math.cos((ang * Math.PI) / 180) * 46} y2={Math.sin((ang * Math.PI) / 180) * 46} {...common} />
          <line x1={0} y1={0} x2={Math.cos(((ang / 12 - 90) * Math.PI) / 180) * 30} y2={Math.sin(((ang / 12 - 90) * Math.PI) / 180) * 30} stroke={theme.accent} strokeWidth={sw} strokeLinecap="round" />
          <circle cx={0} cy={0} r={6} fill={strokeC} />
        </g>
      );
      break;
    }
    case 'resume':
      el = (
        <g transform={`rotate(${-4 + jit(ctx, k, 1)})`}>
          <path d={wobRect(ctx, -80, -105, 160, 210, 6, k)} fill={fill(theme.paper)} {...common} />
          <circle cx={-42} cy={-62} r={22} fill={fill(theme.wall)} {...common} strokeWidth={sw * 0.6} />
          {[-70, -50].map((yy) => (
            <path key={yy} d={wobLine(ctx, -8, yy, 58, yy, k + yy)} fill="none" {...common} strokeWidth={sw * 0.6} />
          ))}
          {[-10, 15, 40, 65].map((yy) => (
            <path key={yy} d={wobLine(ctx, -58, yy, 58, yy, k + yy)} fill="none" {...common} strokeWidth={sw * 0.5} opacity={0.75} />
          ))}
        </g>
      );
      break;
    case 'chair':
      el = (
        <g>
          <path d={wobRect(ctx, -70, -150, 140, 150, 18, k)} fill={fill('#7C6A5A')} {...common} />
          <path d={wobRect(ctx, -86, 0, 172, 36, 10, k + 20)} fill={fill('#6A5A4C')} {...common} />
          <path d="M -66 36 L -74 150 M 66 36 L 74 150" fill="none" {...common} />
        </g>
      );
      break;
    case 'phone':
      el = (
        <g>
          <path d={wobRect(ctx, -58, -108, 116, 216, 18, k)} fill={fill('#2B2B2E')} {...common} />
          <rect x={-46} y={-90} width={92} height={172} rx={8} fill={sil ? '#3B2C46' : theme.paper} />
          {[-62, -36, -10].map((yy, i) => (
            <rect key={yy} x={-36 + (i % 2) * 18} y={yy} width={56} height={18} rx={8} fill={i % 2 ? theme.accent : theme.good} opacity={0.85} />
          ))}
        </g>
      );
      break;
    case 'bulb': {
      const glow = 0.5 + Math.sin(t * 0.3) * 0.25;
      el = (
        <g>
          {!sil && (
            <g opacity={glow}>
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                <path key={a} d={wobLine(ctx, Math.cos((a * Math.PI) / 180) * 78, Math.sin((a * Math.PI) / 180) * 78 - 20, Math.cos((a * Math.PI) / 180) * 104, Math.sin((a * Math.PI) / 180) * 104 - 20, k + a)} fill="none" {...common} strokeWidth={sw * 0.8} />
              ))}
            </g>
          )}
          <path d="M 0 -84 C 52 -84 66 -34 44 -2 C 30 18 28 26 28 44 L -28 44 C -28 26 -30 18 -44 -2 C -66 -34 -52 -84 0 -84 Z" fill={sil ? '#FFE2B4' : '#F6E7A8'} {...common} />
          <path d="M -26 52 L 26 52 M -22 66 L 22 66" fill="none" {...common} />
        </g>
      );
      break;
    }
    case 'money':
      el = (
        <g>
          {[0, 1, 2].map((i) => (
            <path key={i} d={wobRect(ctx, -86, -20 - i * 30, 172, 40, 6, k + i * 10)} fill={fill('#9DB58A')} {...common} />
          ))}
          <circle cx={0} cy={-66} r={14} fill="none" {...common} strokeWidth={sw * 0.6} />
          {[[-120, 20], [112, 26], [128, -6]].map(([cx, cy], i) => (
            <g key={i}>
              <ellipse cx={cx} cy={cy} rx={30} ry={14} fill={fill('#E4C46A')} {...common} />
            </g>
          ))}
          <text x={0} y={-54} textAnchor="middle" fontSize={34} fontWeight={800} fill={strokeC} fontFamily={theme.bodyFont}>
            ฿
          </text>
        </g>
      );
      break;
    case 'trophy':
      el = (
        <g>
          <path d="M -62 -90 L 62 -90 Q 62 10 0 26 Q -62 10 -62 -90 Z" fill={fill('#E4C46A')} {...common} />
          <path d="M -62 -70 Q -110 -66 -96 -28 Q -86 -6 -50 -10 M 62 -70 Q 110 -66 96 -28 Q 86 -6 50 -10" fill="none" {...common} />
          <path d="M -14 26 L 14 26 L 18 60 L -18 60 Z" fill={fill('#E4C46A')} {...common} />
          <path d={wobRect(ctx, -52, 60, 104, 30, 6, k)} fill={fill('#8E6F55')} {...common} />
        </g>
      );
      break;
    case 'plant':
      el = (
        <g>
          {[-40, -12, 18, 44].map((a, i) => (
            <path key={i} d={`M 0 0 Q ${a} -60 ${a * 1.6} -${110 + i * 8} Q ${a * 0.4} -60 0 0 Z`} fill={fill('#6F8F5B')} {...common} strokeWidth={sw * 0.7} />
          ))}
          <path d="M -48 0 L 48 0 L 38 80 L -38 80 Z" fill={fill('#9A6A4C')} {...common} />
        </g>
      );
      break;
    case 'window':
      el = (
        <g>
          <path d={wobRect(ctx, -130, -150, 260, 300, 8, k)} fill={sil ? 'url(#dd-dusk)' : theme.sky} {...common} />
          <path d="M 0 -150 L 0 150 M -130 0 L 130 0" fill="none" {...common} />
          {!sil && (
            <g opacity={0.7}>
              <rect x={-110} y={40} width={40} height={110} fill={theme.wallLow} />
              <rect x={-60} y={70} width={50} height={80} fill={theme.wallLow} />
              <rect x={30} y={20} width={46} height={130} fill={theme.wallLow} />
            </g>
          )}
        </g>
      );
      break;
    case 'briefcase':
      el = (
        <g>
          <path d="M -36 -66 L -36 -86 L 36 -86 L 36 -66" fill="none" {...common} />
          <path d={wobRect(ctx, -100, -66, 200, 130, 14, k)} fill={fill('#8E6F55')} {...common} />
          <path d="M -100 -10 L 100 -10" fill="none" {...common} strokeWidth={sw * 0.7} />
          <rect x={-14} y={-20} width={28} height={22} rx={4} fill={fill('#E4C46A')} {...common} strokeWidth={sw * 0.5} />
        </g>
      );
      break;
    case 'rocket': {
      const lift = Math.min(40, t * 1.2);
      el = (
        <g transform={`translate(0 ${-lift})`}>
          <path d="M 0 -120 C 46 -80 46 0 32 50 L -32 50 C -46 0 -46 -80 0 -120 Z" fill={fill(theme.paper)} {...common} />
          <circle cx={0} cy={-38} r={18} fill={fill(theme.sky)} {...common} strokeWidth={sw * 0.7} />
          <path d="M -32 10 L -62 64 L -30 50 M 32 10 L 62 64 L 30 50" fill={fill(theme.accent)} {...common} />
          <path d={`M -18 56 Q 0 ${110 + jit(ctx, k, 10)} 18 56 Z`} fill="#F2A65A" {...common} strokeWidth={sw * 0.6} />
        </g>
      );
      break;
    }
    case 'chart': {
      const grow = clamp01(t / 24);
      const bars = [40, 70, 58, 110];
      el = (
        <g>
          <path d={`M -110 70 L -110 -110 M -110 70 L 120 70`} fill="none" {...common} />
          {bars.map((b, i) => (
            <path key={i} d={wobRect(ctx, -92 + i * 52, 70 - b * grow, 38, Math.max(2, b * grow), 4, k + i * 9)} fill={i === 3 ? theme.accent : fill(theme.good)} {...common} strokeWidth={sw * 0.7} />
          ))}
          <path d={`M -80 ${30 - 20 * grow} L -20 ${-10 * grow} L 40 ${-4 * grow} L 100 ${-60 * grow}`} fill="none" stroke={theme.accent} strokeWidth={sw} strokeLinecap="round" />
        </g>
      );
      break;
    }
    case 'question':
      el = (
        <text x={0} y={40} textAnchor="middle" fontSize={140} fontWeight={800} fill={sil ? theme.rim || theme.accent : theme.accent} stroke={sil ? 'none' : ink} strokeWidth={4} fontFamily={theme.captionFont} transform={`rotate(${jit(ctx, k, 6)})`}>
          ?
        </text>
      );
      break;
    case 'check':
      el = <path d={`M -60 0 L -16 46 L 70 -60`} fill="none" stroke={theme.good} strokeWidth={sw * 2.6} strokeLinecap="round" strokeLinejoin="round" />;
      break;
    case 'cross':
      el = (
        <g stroke={theme.accent} strokeWidth={sw * 2.6} strokeLinecap="round">
          <path d={wobLine(ctx, -56, -56, 56, 56, k)} fill="none" />
          <path d={wobLine(ctx, 56, -56, -56, 56, k + 9)} fill="none" />
        </g>
      );
      break;
    case 'robot':
      el = (
        <g>
          <path d="M 0 -120 L 0 -92" {...common} />
          <circle cx={0} cy={-126} r={10} fill={theme.accent} {...common} strokeWidth={sw * 0.6} />
          <path d={wobRect(ctx, -76, -92, 152, 112, 22, k)} fill={fill('#B7C3C8')} {...common} />
          <circle cx={-30} cy={-40} r={14} fill={sil ? '#FFE2B4' : '#FFFFFF'} {...common} strokeWidth={sw * 0.6} />
          <circle cx={30} cy={-40} r={14} fill={sil ? '#FFE2B4' : '#FFFFFF'} {...common} strokeWidth={sw * 0.6} />
          <path d="M -30 -2 L 30 -2" fill="none" {...common} strokeWidth={sw * 0.6} />
          <path d={wobRect(ctx, -60, 28, 120, 90, 14, k + 40)} fill={fill('#9AA9B0')} {...common} />
        </g>
      );
      break;
    case 'book':
      el = (
        <g>
          <path d="M 0 -60 Q -60 -80 -110 -60 L -110 60 Q -60 40 0 60 Z" fill={fill(theme.paper)} {...common} />
          <path d="M 0 -60 Q 60 -80 110 -60 L 110 60 Q 60 40 0 60 Z" fill={fill(theme.paper)} {...common} />
          {[-30, -6, 18].map((yy) => (
            <path key={yy} d={`M -90 ${yy} Q -50 ${yy - 10} -16 ${yy}`} fill="none" {...common} strokeWidth={sw * 0.45} opacity={0.7} />
          ))}
        </g>
      );
      break;
    case 'star':
      el = (
        <path
          d="M 0 -70 L 20 -22 L 70 -20 L 30 12 L 44 62 L 0 34 L -44 62 L -30 12 L -70 -20 L -20 -22 Z"
          fill={sil ? '#FFC383' : '#E4C46A'}
          {...common}
          transform={`rotate(${(t * 2) % 360})`}
        />
      );
      break;
    case 'heart':
      el = <path d="M 0 60 C -90 0 -70 -70 -20 -60 C 0 -56 0 -40 0 -36 C 0 -40 0 -56 20 -60 C 70 -70 90 0 0 60 Z" fill={theme.accent} {...common} />;
      break;
    case 'fire':
      el = (
        <g>
          <path d={`M 0 70 C -70 60 -70 -10 -30 -50 C -30 -10 -10 -10 -6 -30 C 0 -70 20 -90 30 -${110 + jit(ctx, k, 8)} C 40 -60 80 -30 70 20 C 64 54 40 70 0 70 Z`} fill="#F2A65A" {...common} />
          <path d="M 0 60 C -30 50 -30 10 -6 -10 C 0 20 20 10 22 0 C 40 30 30 58 0 60 Z" fill="#F6E7A8" {...common} strokeWidth={sw * 0.6} />
        </g>
      );
      break;
    default:
      el = null;
  }

  return <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s}) ${boil(ctx, k + 700, 1.1, 0.4)}`}>{el}</g>;
};

/** In silhouette mode props are dark plum shapes lit only by their rim */
function shadeForSilhouette(_c: string): string {
  return '#1A1220';
}

// ============================================================================
// TEXT MOUNTS (bubbles, sticky notes, paper, boards)
// ============================================================================

/** Speech bubble path: wobbly rounded box with a tail pointing at (tx, ty) */
export function bubblePath(ctx: DrawCtx, x: number, y: number, w: number, h: number, tx: number, ty: number, k: number): string {
  const r = Math.min(46, h / 2.4);
  const base = wobRect(ctx, x, y, w, h, r, k, 2.4);
  const cx = Math.max(x + r + 30, Math.min(x + w - r - 30, tx));
  const bottom = ty > y + h;
  const by = bottom ? y + h - 2 : y + 2;
  const tail = `M ${cx - 26} ${by} L ${tx + jit(ctx, k + 77, 3)} ${ty} L ${cx + 26} ${by} Z`;
  return `${base} ${tail}`;
}

export const ThoughtCloud: React.FC<{ ctx: DrawCtx; x: number; y: number; w: number; h: number; tx: number; ty: number; k: number; fill: string }> = ({
  ctx,
  x,
  y,
  w,
  h,
  tx,
  ty,
  k,
  fill,
}) => {
  const { theme } = ctx;
  const bumps = 9;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const circles = Array.from({ length: bumps }).map((_, i) => {
    const a = (i / bumps) * Math.PI * 2;
    return { x: cx + Math.cos(a) * (w / 2 - 40), y: cy + Math.sin(a) * (h / 2 - 34), r: 58 + jit(ctx, k + i, 6) };
  });
  const sw = theme.mode === 'silhouette' ? 3 : theme.sw.prop;
  const st = theme.mode === 'silhouette' ? theme.rim || theme.accent : theme.ink;
  return (
    <g>
      {circles.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={c.r} fill={fill} stroke={st} strokeWidth={sw} />
      ))}
      <ellipse cx={cx} cy={cy} rx={w / 2 - 34} ry={h / 2 - 28} fill={fill} />
      {[0.35, 0.62, 0.84].map((p, i) => (
        <circle key={`d${i}`} cx={cx + (tx - cx) * p} cy={y + h + (ty - y - h) * p} r={20 - i * 6} fill={fill} stroke={st} strokeWidth={sw * 0.8} />
      ))}
    </g>
  );
};
