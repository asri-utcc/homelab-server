import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { IsoBox, IsoShadow, isoProject } from '../components/IsometricPrimitives';
import { THAI_FONT_FAMILY } from '../components/ThaiFontLoader';
import { ResolvedStyleTokens, StudioScene, hexToRgba } from './types';

// ============================================================================
// TYPES & PLACEMENT METADATA
// ============================================================================

export type SignaturePlacement = 'under' | 'over' | 'hero';

export interface SignatureRendererProps {
  tokens: ResolvedStyleTokens;
  frame: number;
  sceneIndex: number;
  width: number;
  height: number;
  placement: SignaturePlacement;
  scene?: StudioScene;
  localFrame?: number;
  totalScenes?: number;
}

export type SignatureComponent = React.FC<SignatureRendererProps>;

export interface StyleSignatureProps {
  styleId: string;
  tokens: ResolvedStyleTokens;
  frame: number;
  sceneIndex: number;
  width: number;
  height: number;
  placement?: SignaturePlacement;
  scene?: StudioScene;
  localFrame?: number;
  totalScenes?: number;
}

/**
 * Hero viewport bounds strictly inside y=260..1360 (never entering subtitle zone y=1380..1620).
 * Area = 1024 * 956 = 978,944 px² = 47.2% of the 1080x1920 frame (>= 40% spec).
 */
export const HERO_STAGE_BOUNDS = {
  x: 28,
  y: 260,
  width: 1024,
  height: 956,
  rx: 32,
} as const;

/**
 * Primary layer placement for each of the 46 styles.
 * - 'hero':  large central hero artwork inside y=260..1360 (replaces placeholder icon card)
 * - 'under': rendered between StudioBackground and FamilySceneRenderer
 * - 'over':  rendered above FamilySceneRenderer and below Subtitle layer
 */
export const SIGNATURE_PLACEMENTS: Record<string, SignaturePlacement> = {
  'look-1': 'hero',
  'look-2': 'under',
  'look-3': 'hero',
  'look-4': 'hero',
  'look-5': 'hero',
  'look-6': 'hero',
  'look-7': 'hero',
  'look-8': 'hero',
  'look-9': 'hero',
  'look-10': 'hero',
  'look-11': 'hero',
  'look-12': 'hero',
  'look-13': 'hero',
  'look-14': 'hero',
  'look-15': 'hero',
  'look-16': 'hero',
  'look-17': 'hero',
  'look-18': 'hero',
  'look-19': 'hero',
  'look-20': 'hero',
  'look-21': 'hero',
  'look-22': 'hero',
  'look-23': 'hero',
  'look-24': 'hero',
  'look-25': 'hero',
  'look-26': 'hero',
  'look-27': 'hero',
  'look-28': 'hero',
  'look-29': 'hero',
  'look-30': 'hero',
  'look-31': 'hero',
  'look-32': 'hero',
  'look-33': 'hero',
  'look-34': 'hero',
  'look-35': 'hero',
  'look-36': 'hero',
  'look-37': 'hero',
  'look-38': 'hero',
  'look-39': 'hero',
  'look-40': 'hero',
  'look-41': 'hero',
  'look-42': 'hero',
  'look-43': 'hero',
  'look-44': 'hero',
  'look-45': 'hero',
  'look-46': 'hero',
};

/**
 * Per-style readable header/caption accent pairs harmonized with each hero visual
 * and guaranteed to read crisply against its outer StudioBackground.
 */
export const HERO_STYLE_ACCENTS: Record<string, { accent: string; accent2: string }> = {
  'look-1': { accent: '#FF5FB2', accent2: '#3BE3C6' },
  'look-3': { accent: '#38E8FF', accent2: '#FF4D4F' },
  'look-4': { accent: '#FF4D47', accent2: '#E2E8F0' },
  'look-5': { accent: '#1D1B1A', accent2: '#E1191F' },
  'look-6': { accent: '#EEB86F', accent2: '#FCFADA' },
  'look-7': { accent: '#FF4D6D', accent2: '#FDE68A' },
  'look-8': { accent: '#D8C3A5', accent2: '#5EEAD4' },
  'look-9': { accent: '#38BDF8', accent2: '#FB923C' },
  'look-10': { accent: '#1E293B', accent2: '#64748B' },
  'look-11': { accent: '#4ADE80', accent2: '#CBD5E1' },
  'look-12': { accent: '#38BDF8', accent2: '#E2E8F0' },
  'look-13': { accent: '#38BDF8', accent2: '#F8FAFC' },
  'look-14': { accent: '#7DD3FC', accent2: '#F0F9FF' },
  'look-15': { accent: '#60A5FA', accent2: '#E2E8F0' },
  'look-16': { accent: '#E2E8F0', accent2: '#94A3B8' },
  'look-17': { accent: '#34D399', accent2: '#E2E8F0' },
  'look-18': { accent: '#10B981', accent2: '#60A5FA' },
  'look-19': { accent: '#FB923C', accent2: '#38BDF8' },
  'look-20': { accent: '#60A5FA', accent2: '#E2E8F0' },
  'look-21': { accent: '#34D399', accent2: '#FB7185' },
  'look-22': { accent: '#34D399', accent2: '#38BDF8' },
  'look-23': { accent: '#38BDF8', accent2: '#F8FAFC' },
  'look-24': { accent: '#FF5A36', accent2: '#9DB89E' },
  'look-25': { accent: '#38BDF8', accent2: '#F43F5E' },
  'look-26': { accent: '#EF4444', accent2: '#F8FAFC' },
  'look-27': { accent: '#3D7BFF', accent2: '#FF7A30' },
  'look-28': { accent: '#3B82F6', accent2: '#EF4444' },
  'look-29': { accent: '#FF5A2A', accent2: '#1E293B' },
  'look-30': { accent: '#C82824', accent2: '#1B1A18' },
  'look-31': { accent: '#2D684C', accent2: '#DC2626' },
  'look-32': { accent: '#A3E635', accent2: '#F8FAFC' },
  'look-33': { accent: '#FF6B2B', accent2: '#22C55E' },
  'look-34': { accent: '#0F172A', accent2: '#2563EB' },
  'look-35': { accent: '#0F766E', accent2: '#1B1C20' },
  'look-36': { accent: '#38BDF8', accent2: '#E2E8F0' },
  'look-37': { accent: '#F696DE', accent2: '#FBF6F8' },
  'look-38': { accent: '#FF8A5C', accent2: '#9FD8FF' },
  'look-39': { accent: '#FF3B30', accent2: '#E2E8F0' },
  'look-40': { accent: '#FF9A90', accent2: '#F05A4A' },
  'look-41': { accent: '#46FF8C', accent2: '#D7FFF3' },
  'look-42': { accent: '#EF4444', accent2: '#E2E8F0' },
  'look-43': { accent: '#60A5FA', accent2: '#F4F5FA' },
  'look-44': { accent: '#FF48B0', accent2: '#60A5FA' },
  'look-45': { accent: '#F03820', accent2: '#F0F0E8' },
  'look-46': { accent: '#60A5FA', accent2: '#EEF4FB' },
};

export function hasHeroSignature(styleId?: string): boolean {
  const norm = (styleId || '').trim().toLowerCase();
  if (!norm || norm === 'look-2') return false;
  return SIGNATURE_PLACEMENTS[norm] === 'hero';
}

export function getHeroStyleAccent(
  styleId: string,
  tokens: ResolvedStyleTokens,
): { accent: string; accent2: string } {
  const norm = (styleId || '').trim().toLowerCase();
  return (
    HERO_STYLE_ACCENTS[norm] || {
      accent: tokens.palette.accentReadable,
      accent2: tokens.palette.accent2,
    }
  );
}

// ============================================================================
// DETERMINISTIC HELPERS & HERO STAGE FRAME
// ============================================================================

function hashSeed(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeOutCubic(t: number): number {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}

const SvgLayer: React.FC<{
  width: number;
  height: number;
  opacity?: number;
  mixBlendMode?: React.CSSProperties['mixBlendMode'];
  children: React.ReactNode;
}> = ({ width, height, opacity = 1, mixBlendMode, children }) => (
  <AbsoluteFill style={{ pointerEvents: 'none', opacity, mixBlendMode }}>
    <svg
      width={width}
      height={height}
      viewBox="0 0 1080 1920"
      preserveAspectRatio="xMidYMid slice"
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      {children}
    </svg>
  </AbsoluteFill>
);

/**
 * Clipped Hero Stage container bounded strictly to x=28..1052, y=260..1216 (47.2% of frame).
 * Guarantees zero overlap with Top Header (y<250) and Subtitle Zone (y=1380..1620).
 */
const HeroStage: React.FC<{
  id: string;
  width: number;
  height: number;
  borderColor?: string;
  shadowColor?: string;
  defs?: React.ReactNode;
  children: React.ReactNode;
}> = ({
  id,
  width,
  height,
  borderColor = 'rgba(255,255,255,0.16)',
  shadowColor = 'rgba(0,0,0,0.42)',
  defs,
  children,
}) => {
  const { x, y, width: w, height: h, rx } = HERO_STAGE_BOUNDS;
  const clipId = `hero-clip-${id}`;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg
        width={width}
        height={height}
        viewBox="0 0 1080 1920"
        preserveAspectRatio="xMidYMid slice"
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={x} y={y} width={w} height={h} rx={rx} />
          </clipPath>
          {defs}
        </defs>
        {/* Subtle grounded stage shadow (stays well above y=1240, never touching y=1380) */}
        <rect x={x + 6} y={y + 12} width={w - 12} height={h} rx={rx} fill={shadowColor} opacity={0.45} />
        <g clipPath={`url(#${clipId})`}>{children}</g>
        {/* Crisp outer bezel */}
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={rx}
          fill="none"
          stroke={borderColor}
          strokeWidth={2.5}
        />
      </svg>
    </AbsoluteFill>
  );
};

// ============================================================================
// LOOK-1 .. LOOK-10 (YOUTUBE LOOKS & HERO WORLDS — FULL HERO STAGE)
// ============================================================================

/** look-1: Glow World — Kurzgesagt-inspired split magenta AI core crystal over violet grid island */
const SigLook1GlowWorld: SignatureComponent = ({ frame, width, height }) => {
  const split = easeOutCubic(clamp01((frame - 12) / 36));
  const bob = Math.sin(frame * 0.055) * 12;
  const crackGap = 8 + split * 44;
  const pulse = 0.88 + Math.sin(frame * 0.08) * 0.12;
  const rotOrbit = frame * 0.032;

  return (
    <HeroStage
      id="look1"
      width={width}
      height={height}
      borderColor="rgba(192,132,252,0.42)"
      defs={
        <>
          <linearGradient id="h1-space" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#140C40" />
            <stop offset="65%" stopColor="#2A1E78" />
            <stop offset="100%" stopColor="#1E145A" />
          </linearGradient>
          <radialGradient id="h1-pink-aura" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF5FB2" stopOpacity="0.62" />
            <stop offset="48%" stopColor="#E2369A" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#2A1E78" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="h1-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="28%" stopColor="#FACB22" stopOpacity="0.95" />
            <stop offset="62%" stopColor="#F36A23" stopOpacity="0.58" />
            <stop offset="100%" stopColor="#F36A23" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="h1-grid-bloom" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FACB22" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#F36A23" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#3C30A0" stopOpacity="0" />
          </radialGradient>
          <pattern id="h1-dots" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx={4} cy={4} r={1.4} fill="#FFFFFF" opacity={0.14} />
            <circle cx={12} cy={12} r={1.1} fill="#3BE3C6" opacity={0.1} />
          </pattern>
        </>
      }
    >
      {/* Deep violet illustrated cosmos */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h1-space)" />

      {/* Soft background light rays radiating behind crystal */}
      <g opacity={0.22}>
        <polygon points="540,650 180,260 360,260" fill="#FF5FB2" />
        <polygon points="540,650 720,260 920,260" fill="#FACB22" />
        <polygon points="540,650 1052,440 1052,610" fill="#3BE3C6" />
        <polygon points="540,650 28,440 28,600" fill="#A855F7" />
      </g>

      {/* Round twinkling stars & far floating flat purple rocks */}
      {Array.from({ length: 34 }, (_, i) => {
        const sx = 55 + hashSeed(i * 11 + 1) * 970;
        const sy = 285 + hashSeed(i * 17 + 3) * 520;
        const sr = 2 + hashSeed(i * 23 + 5) * 4.5;
        return (
          <circle
            key={i}
            cx={sx}
            cy={sy}
            r={sr}
            fill={i % 6 === 0 ? '#3BE3C6' : i % 5 === 0 ? '#FACB22' : '#FFFFFF'}
            opacity={0.45 + Math.sin(frame * 0.08 + i) * 0.35}
          />
        );
      })}
      {/* Far rounded asteroid rocks (flat 2-tone, no outlines) */}
      <g transform={`translate(160, ${(415 + Math.sin(frame * 0.04) * 8).toFixed(1)})`}>
        <ellipse cx={0} cy={0} rx={52} ry={34} fill="#4635A6" />
        <ellipse cx={-12} cy={-8} rx={32} ry={18} fill="#624EC9" />
      </g>
      <g transform={`translate(905, ${(395 - Math.sin(frame * 0.045) * 9).toFixed(1)})`}>
        <ellipse cx={0} cy={0} rx={44} ry={28} fill="#3F2E98" />
        <ellipse cx={-10} cy={-6} rx={26} ry={14} fill="#5C48BE" />
      </g>

      {/* Large floating violet perspective Grid Island */}
      <g transform="translate(540, 955)">
        {/* Island thick underside (2 flat violet tones) */}
        <path
          d="M -430 0 Q -420 115 -190 155 Q 0 185 190 155 Q 420 115 430 0 Z"
          fill="#22176E"
        />
        <path
          d="M -430 0 Q -360 72 -180 102 Q 0 128 180 102 Q 360 72 430 0 Z"
          fill="#2E2287"
        />
        {/* Island top diamond-rounded plateau */}
        <polygon points="-430,0 0,-138 430,0 0,138" fill="#3C30A0" />
        <polygon points="-430,0 0,-138 430,0 0,138" fill="url(#h1-dots)" />
        {/* Crisp violet grid lines on plateau */}
        {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((i) => {
          const t = i / 5;
          return (
            <React.Fragment key={i}>
              <line
                x1={-430 * (1 - Math.abs(t)) + t * 215}
                y1={t * 69}
                x2={430 * (1 - Math.abs(t)) + t * 215}
                y2={-138 + Math.abs(t) * 138 + t * 69}
                stroke="#2A1D8D"
                strokeWidth={2.6}
              />
              <line
                x1={-215 + i * 54}
                y1={-69 + i * 17.5}
                x2={215 + i * 54}
                y2={69 + i * 17.5}
                stroke="#2A1D8D"
                strokeWidth={2.6}
              />
            </React.Fragment>
          );
        })}
        {/* Warm golden-orange light blooming across the grid from the split core */}
        <ellipse cx={0} cy={-8} rx={320} ry={96} fill="url(#h1-grid-bloom)" opacity={0.9 * pulse} />
        {/* Power energy cables feeding pedestal */}
        <path d="M -320 22 Q -170 46 -98 8" fill="none" stroke="#3BE3C6" strokeWidth={6} strokeLinecap="round" opacity={0.85} />
        <path d="M 320 22 Q 170 46 98 8" fill="none" stroke="#FACB22" strokeWidth={6} strokeLinecap="round" opacity={0.9} />
        {/* Pedestal + glowing ring */}
        <ellipse cx={0} cy={12} rx={126} ry={40} fill="#1E145A" />
        <ellipse cx={0} cy={4} rx={114} ry={34} fill="none" stroke={split > 0.6 ? '#FACB22' : '#3BE3C6'} strokeWidth={7} />
        <ellipse cx={0} cy={2} rx={84} ry={24} fill="#5040BA" />
      </g>

      {/* MASSIVE SPLIT MAGENTA-PINK AI CORE CRYSTAL (flat tones, zero outlines, glowing hot core) */}
      <g transform={`translate(540, ${(635 + bob).toFixed(1)})`}>
        {/* Soft pink outer aura */}
        <circle cx={0} cy={0} r={320 * pulse} fill="url(#h1-pink-aura)" />
        {/* Glowing hot yellow-orange core bloom between halves */}
        <circle cx={0} cy={0} r={195 * (0.65 + 0.35 * split) * pulse} fill="url(#h1-core-glow)" />

        {/* Glowing thin orbit ellipses + orbiting dots */}
        <ellipse cx={0} cy={0} rx={270} ry={98} fill="none" stroke="#3BE3C6" strokeWidth={3} strokeDasharray="16 10" opacity={0.78} transform="rotate(-18)" />
        <ellipse cx={0} cy={0} rx={235} ry={82} fill="none" stroke="#FACB22" strokeWidth={3} opacity={0.75} transform="rotate(22)" />
        {[0, 1, 2, 3].map((idx) => {
          const ang = rotOrbit + idx * (Math.PI / 2);
          const rx = idx % 2 === 0 ? 270 : 235;
          const ry = idx % 2 === 0 ? 98 : 82;
          const tilt = idx % 2 === 0 ? -0.31 : 0.38;
          const lx = Math.cos(ang) * rx;
          const ly = Math.sin(ang) * ry;
          const ox = lx * Math.cos(tilt) - ly * Math.sin(tilt);
          const oy = lx * Math.sin(tilt) + ly * Math.cos(tilt);
          return (
            <circle
              key={idx}
              cx={ox}
              cy={oy}
              r={idx % 2 === 0 ? 11 : 8}
              fill={idx % 2 === 0 ? '#3BE3C6' : '#FFFBEB'}
            />
          );
        })}

        {/* LEFT CRYSTAL HALF (flat 3-tone magenta: #FF5FB2 / #E2369A / #6F1A7E) */}
        <g transform={`translate(${(-crackGap).toFixed(1)}, 0) rotate(${(-split * 7).toFixed(1)})`}>
          {/* Outer lit facet */}
          <polygon points="0,-245 -168,-45 -58,215 0,165" fill="#FF5FB2" />
          {/* Mid flat facet */}
          <polygon points="0,-245 -88,-30 -32,190 0,165" fill="#E2369A" />
          {/* Shaded violet facet */}
          <polygon points="-168,-45 -88,-30 -32,190 -58,215" fill="#6F1A7E" />
          {/* Glowing cut inner face (orange -> yellow -> white) */}
          <polygon points="0,-220 26,-100 28,90 0,152 -24,78 -20,-105" fill="#F36A23" />
          <polygon points="0,-170 16,-75 18,65 0,115 -14,55 -12,-75" fill="#FACB22" />
          {/* Crescent light highlight */}
          <path d="M -138 -36 Q -95 -120 -24 -195" fill="none" stroke="#FFE4F2" strokeWidth={8} strokeLinecap="round" opacity={0.75} />
        </g>

        {/* RIGHT CRYSTAL HALF */}
        <g transform={`translate(${crackGap.toFixed(1)}, 0) rotate(${(split * 8).toFixed(1)})`}>
          <polygon points="0,-245 168,-45 58,215 0,165" fill="#E2369A" />
          <polygon points="0,-245 96,-35 42,195 0,165" fill="#9D2486" />
          <polygon points="168,-45 96,-35 42,195 58,215" fill="#6F1A7E" />
          {/* Glowing interior cut rim */}
          <polygon points="0,-220 22,-95 20,78 0,152 -26,88 -24,-98" fill="#F36A23" />
          <polygon points="0,-165 13,-70 12,58 0,112 -14,62 -14,-72" fill="#FACB22" />
        </g>

        {/* Blazing White-Hot AI Core Sphere & Circuit Traces */}
        <circle cx={0} cy={-10} r={54 + split * 14} fill="#FACB22" opacity={0.95} />
        <circle cx={0} cy={-10} r={34 + split * 10} fill="#FFFFFF" />
        {/* Crisp circuit nodes radiating inside core */}
        <path d="M -52 -55 L -26 -30 M 52 -55 L 26 -30 M -58 45 L -28 22 M 58 45 L 28 22" stroke="#FFFFFF" strokeWidth={4.5} strokeLinecap="round" opacity={0.9} />
        <circle cx={-56} cy={-59} r={7} fill="#3BE3C6" />
        <circle cx={56} cy={-59} r={7} fill="#3BE3C6" />
        <circle cx={-62} cy={49} r={7} fill="#FACB22" />
        <circle cx={62} cy={49} r={7} fill="#FACB22" />

        {/* Floating crystal shards */}
        <polygon points="-220,-165 -194,-140 -212,-112 -236,-138" fill="#FF5FB2" />
        <polygon points="215,-145 242,-122 222,-96 198,-118" fill="#E2369A" />
        <polygon points="228,92 248,112 226,134 208,110" fill="#3BE3C6" />
      </g>

      {/* Dark rounded foreground parallax rocks & plants framing bottom corners */}
      <path d="M 28 1216 L 28 1065 Q 115 1030 185 1115 Q 245 1150 285 1216 Z" fill="#0E082C" />
      <path d="M 96 1110 Q 70 1010 112 970 Q 138 1030 125 1115 Z" fill="#1A104B" />
      <path d="M 1052 1216 L 1052 1055 Q 950 1020 882 1105 Q 825 1148 778 1216 Z" fill="#0E082C" />
      <path d="M 968 1098 Q 994 1002 952 962 Q 925 1025 942 1105 Z" fill="#1A104B" />

      {/* One small rounded capsule label pill with yellow dot (Kurzgesagt signature) */}
      <g transform="translate(540, 1148)">
        <rect x={-136} y={-28} width={272} height={56} rx={28} fill="#140C40" />
        <circle cx={-98} cy={0} r={9} fill="#FACB22" />
        <text x={12} y={9} textAnchor="middle" fill="#FFFFFF" fontSize={26} fontFamily={THAI_FONT_FAMILY} fontWeight={800} letterSpacing={1.2}>
          AI CORE · ACTIVE
        </text>
      </g>
    </HeroStage>
  );
};

/** look-2: Flat Cartoon — full custom layout handled in flatCartoon.tsx (DO NOT TOUCH) */
const SigLook2FlatCartoon: SignatureComponent = () => null;

/** look-3: Hologram — Fern-inspired 3D translucent ice-blue architectural campus + red target truck & route */
const SigLook3Hologram: SignatureComponent = ({ frame, width, height }) => {
  const routeProg = easeOutCubic(clamp01((frame - 8) / 42));
  const scanOffset = ((frame * 3.2) % 90) - 45;
  const ringPulse = (frame % 40) / 40;
  const cx = 535;
  const cy = 790;

  return (
    <HeroStage
      id="look3"
      width={width}
      height={height}
      borderColor="rgba(56,232,255,0.42)"
      defs={
        <>
          <radialGradient id="h3-fog" cx="50%" cy="56%" r="55%">
            <stop offset="0%" stopColor="#172734" stopOpacity="0.95" />
            <stop offset="68%" stopColor="#07111C" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#03070D" stopOpacity="1" />
          </radialGradient>
          <radialGradient id="h3-red-pool" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF3B3F" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#CF3538" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="h3-cyan-pool" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38E8FF" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#0C3F78" stopOpacity="0" />
          </radialGradient>
          <pattern id="h3-frost" width="12" height="12" patternUnits="userSpaceOnUse">
            <circle cx={3} cy={3} r={0.9} fill="#E0F4FF" opacity={0.28} />
            <circle cx={9} cy={8} r={0.7} fill="#85C9FB" opacity={0.22} />
          </pattern>
        </>
      }
    >
      {/* Pure black stage with dark midnight-navy atmospheric fog */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h3-fog)" />

      {/* Glossy dark campus base slab with faint cyan floor reflection */}
      <polygon
        points="540,490 995,725 540,985 85,725"
        fill="rgba(12, 63, 120, 0.22)"
        stroke="#38E8FF"
        strokeWidth={2}
        strokeOpacity={0.55}
      />
      {/* Internal campus road lines */}
      <polygon
        points="210,730 540,552 870,730 540,910"
        fill="none"
        stroke="rgba(133, 201, 251, 0.34)"
        strokeWidth={1.8}
        strokeDasharray="10 8"
      />

      {/* Cyan vehicle floor glow pools */}
      <ellipse cx={370} cy={765} rx={62} ry={28} fill="url(#h3-cyan-pool)" />
      <ellipse cx={690} cy={715} rx={58} ry={26} fill="url(#h3-cyan-pool)" />
      {/* HOT RED glow pool under target truck */}
      <ellipse cx={500} cy={815} rx={86} ry={38} fill="url(#h3-red-pool)" />

      {/* Translucent Ice-Blue Data Center Main Hall (back-left) */}
      <IsoBox
        x={-210}
        y={-150}
        z={0}
        dx={190}
        dy={120}
        dz={115}
        cx={cx}
        cy={cy}
        topColor="rgba(133,201,251,0.52)"
        leftColor="rgba(105,179,232,0.34)"
        rightColor="rgba(12,63,120,0.48)"
        stroke="#38E8FF"
        strokeWidth={2}
      />
      {/* Rooftop AC/Cooling modules */}
      <IsoBox x={-185} y={-125} z={115} dx={42} dy={42} dz={22} cx={cx} cy={cy} topColor="#BAE6FD" leftColor="#69B3E8" rightColor="#0C3F78" stroke="#85C9FB" strokeWidth={1.4} />
      <IsoBox x={-125} y={-125} z={115} dx={42} dy={42} dz={22} cx={cx} cy={cy} topColor="#BAE6FD" leftColor="#69B3E8" rightColor="#0C3F78" stroke="#85C9FB" strokeWidth={1.4} />

      {/* Tall Server Annex Tower (back-right) */}
      <IsoBox
        x={35}
        y={-175}
        z={0}
        dx={135}
        dy={125}
        dz={165}
        cx={cx}
        cy={cy}
        topColor="rgba(133,201,251,0.55)"
        leftColor="rgba(105,179,232,0.35)"
        rightColor="rgba(12,63,120,0.52)"
        stroke="#38E8FF"
        strokeWidth={2}
      />
      {/* Loading Bay Wing (right) */}
      <IsoBox
        x={125}
        y={-25}
        z={0}
        dx={110}
        dy={115}
        dz={82}
        cx={cx}
        cy={cy}
        topColor="rgba(133,201,251,0.48)"
        leftColor="rgba(105,179,232,0.3)"
        rightColor="rgba(12,63,120,0.45)"
        stroke="#38E8FF"
        strokeWidth={2}
      />
      {/* Red glowing target bay door */}
      <polygon points="732,756 764,774 764,812 732,794" fill="rgba(255,59,63,0.75)" stroke="#FCA5A5" strokeWidth={2} />

      {/* Perimeter Security Gatehouse (front-left) */}
      <IsoBox
        x={-235}
        y={55}
        z={0}
        dx={76}
        dy={64}
        dz={58}
        cx={cx}
        cy={cy}
        topColor="rgba(133,201,251,0.5)"
        leftColor="rgba(105,179,232,0.3)"
        rightColor="rgba(12,63,120,0.46)"
        stroke="#38E8FF"
        strokeWidth={1.8}
      />

      {/* Secondary cyan holo-vehicle */}
      <IsoBox x={-130} y={10} z={4} dx={66} dy={32} dz={28} cx={cx} cy={cy} topColor="#85C9FB" leftColor="#38BDF8" rightColor="#0C3F78" stroke="#38E8FF" strokeWidth={1.6} />

      {/* GLOWING NEON RED ROUTE PATH from Gate -> Target Truck -> Bay 04 */}
      <path
        d="M 278 825 L 408 890 L 502 820 L 620 865 L 748 794"
        fill="none"
        stroke="#CF3538"
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.34}
        strokeDasharray="650"
        strokeDashoffset={650 * (1 - routeProg)}
      />
      <path
        d="M 278 825 L 408 890 L 502 820 L 620 865 L 748 794"
        fill="none"
        stroke="#FF4D4F"
        strokeWidth={5.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="650"
        strokeDashoffset={650 * (1 - routeProg)}
      />
      <path
        d="M 278 825 L 408 890 L 502 820 L 620 865 L 748 794"
        fill="none"
        stroke="#FFE4E6"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="650"
        strokeDashoffset={650 * (1 - routeProg)}
      />

      {/* Pulsing target ring at Loading Bay 04 */}
      <g transform="translate(748, 794)">
        <ellipse cx={0} cy={0} rx={16 + ringPulse * 38} ry={8 + ringPulse * 18} fill="none" stroke="#FF4D4F" strokeWidth={2.5} opacity={1 - ringPulse} />
        <ellipse cx={0} cy={0} rx={14} ry={7} fill="none" stroke="#FFE4E6" strokeWidth={2.5} />
      </g>

      {/* THE KEY OBJECT: Hot-Red Illuminated Hologram Delivery Truck */}
      <IsoBox
        x={-48}
        y={52}
        z={6}
        dx={88}
        dy={40}
        dz={44}
        cx={cx}
        cy={cy}
        topColor="#FF6B6E"
        leftColor="#CF3538"
        rightColor="#881337"
        stroke="#FFE4E6"
        strokeWidth={2.2}
      />
      <IsoBox
        x={42}
        y={56}
        z={6}
        dx={28}
        dy={32}
        dz={32}
        cx={cx}
        cy={cy}
        topColor="#FCA5A5"
        leftColor="#EF4444"
        rightColor="#9F1239"
        stroke="#FFFFFF"
        strokeWidth={2}
      />
      {/* Vertical hot scanline sweeping across target truck */}
      <line
        x1={498 + scanOffset * 0.6}
        y1={752}
        x2={498 + scanOffset * 0.6}
        y2={842}
        stroke="#FFE4E6"
        strokeWidth={3}
        opacity={0.9}
      />

      {/* Frosted fine grain over holo model */}
      <polygon points="540,490 995,725 540,985 85,725" fill="url(#h3-frost)" />

      {/* Three crisp White Mono Hairline Labels sitting cleanly in black space (NOT on bright model) */}
      {/* Label 1: Top above campus */}
      <g>
        <circle cx={635} cy={518} r={6} fill="none" stroke="#FFFFFF" strokeWidth={2.2} />
        <line x1={635} y1={512} x2={635} y2={360} stroke="rgba(238,248,255,0.75)" strokeWidth={1.8} />
        <text x={652} y={376} fill="#EEF8FF" fontSize={25} fontFamily="monospace" fontWeight={700}>
          DATA CAMPUS · SECTOR 4
        </text>
        <text x={652} y={406} fill="#85C9FB" fontSize={20} fontFamily="monospace">
          02:14:08 UTC
        </text>
      </g>
      {/* Label 2: Bottom-left in black margin */}
      <g>
        <circle cx={278} cy={825} r={6} fill="none" stroke="#FFFFFF" strokeWidth={2.2} />
        <line x1={278} y1={831} x2={278} y2={1088} stroke="rgba(238,248,255,0.75)" strokeWidth={1.8} />
        <text x={110} y={1126} fill="#EEF8FF" fontSize={24} fontFamily="monospace" fontWeight={700}>
          GATE 02 ENTRY
        </text>
        <text x={110} y={1156} fill="#85C9FB" fontSize={19} fontFamily="monospace">
          UNIT DETECTED
        </text>
      </g>
      {/* Label 3: Bottom-right in black margin */}
      <g>
        <circle cx={748} cy={794} r={6} fill="#FF4D4F" stroke="#FFFFFF" strokeWidth={2.2} />
        <line x1={748} y1={800} x2={748} y2={1088} stroke="rgba(255,130,130,0.85)" strokeWidth={1.8} />
        <text x={748} y={1126} textAnchor="middle" fill="#FFE4E6" fontSize={24} fontFamily="monospace" fontWeight={700}>
          LOADING BAY 04
        </text>
        <text x={748} y={1156} textAnchor="middle" fill="#FF6B6E" fontSize={19} fontFamily="monospace">
          ROUTE LOCKED · 02:18
        </text>
      </g>
    </HeroStage>
  );
};

/** look-4: Red Relief — IMPERIAL-inspired dark embossed relief map, crimson flood, white card, dashed sea route */
const SigLook4RedRelief: SignatureComponent = ({ frame, width, height }) => {
  const flood = easeOutCubic(clamp01((frame - 6) / 28));
  const route = easeOutCubic(clamp01((frame - 16) / 36));
  const ping = (frame % 36) / 36;

  return (
    <HeroStage
      id="look4"
      width={width}
      height={height}
      borderColor="rgba(255,77,71,0.45)"
      defs={
        <>
          <radialGradient id="h4-red-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF3B30" stopOpacity="0.6" />
            <stop offset="60%" stopColor="#9A0A14" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#030303" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="h4-red-land" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FF5A50" />
            <stop offset="48%" stopColor="#D61F28" />
            <stop offset="100%" stopColor="#7A0710" />
          </linearGradient>
          <linearGradient id="h4-charcoal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7E828A" />
            <stop offset="42%" stopColor="#2E3036" />
            <stop offset="100%" stopColor="#0B0B0D" />
          </linearGradient>
        </>
      }
    >
      {/* Pure black sea */}
      <rect x={28} y={260} width={1024} height={956} fill="#030303" />

      {/* Perspective thin white sea coordinate grid */}
      {[120, 260, 400, 540, 680, 820, 960].map((x, idx) => (
        <line
          key={`vx-${x}`}
          x1={540 + (x - 540) * 0.72}
          y1={260}
          x2={540 + (x - 540) * 1.18}
          y2={1216}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={1.2}
        />
      ))}
      {[340, 460, 595, 745, 910, 1090].map((y) => (
        <line key={`hy-${y}`} x1={28} y1={y} x2={1052} y2={y} stroke="rgba(255,255,255,0.14)" strokeWidth={1.2} />
      ))}

      {/* Upper-Right Destination Embossed Landmass (Charcoal + Lit Ridges) */}
      <g>
        <path
          d="M 620 260 L 1052 260 L 1052 585 Q 920 595 845 555 Q 748 538 710 470 Q 645 435 612 365 Z"
          fill="url(#h4-charcoal)"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth={1.8}
        />
        {/* Illuminated topographic mountain ridges (side-lit from west) */}
        <path d="M 730 330 L 825 390 L 785 450 L 710 415 Z" fill="#9CA3AF" opacity={0.42} />
        <path d="M 855 345 L 975 415 L 920 495 L 820 440 Z" fill="#A8A8A8" opacity={0.36} />
        <path d="M 785 450 L 920 495 L 875 540 L 755 495 Z" fill="#0A0A0A" opacity={0.7} />
      </g>

      {/* Soft crimson coastal glow spilling onto black sea */}
      <ellipse cx={435} cy={870} rx={440} ry={280} fill="url(#h4-red-halo)" opacity={0.3 + 0.7 * flood} />

      {/* Main Lower-Left Embossed Landmass + Crimson Flooded Territory */}
      <g>
        {/* Outer charcoal continent relief */}
        <path
          d="M 28 545 Q 165 555 280 618 Q 375 638 455 712 Q 615 732 720 825 Q 785 925 695 1045 Q 525 1135 280 1125 Q 130 1100 28 1060 Z"
          fill="url(#h4-charcoal)"
          stroke="rgba(255,255,255,0.24)"
          strokeWidth={2}
        />
        {/* Glowing Crimson Flooded Territory */}
        <path
          d="M 65 628 Q 205 635 322 688 Q 445 715 588 785 Q 690 855 660 985 Q 510 1075 295 1068 Q 145 1035 65 955 Z"
          fill="url(#h4-red-land)"
          opacity={0.25 + 0.75 * flood}
          stroke="#FF4D47"
          strokeWidth={3.8}
        />
        {/* Exaggerated relief mountain ridges inside crimson territory */}
        <polygon points="180,760 285,715 355,815 245,845" fill="#FF7970" opacity={0.58 * flood} />
        <polygon points="285,715 395,775 355,815" fill="#5A060C" opacity={0.62 * flood} />
        <polygon points="340,860 475,805 565,910 420,945" fill="#FF6B62" opacity={0.5 * flood} />
        <polygon points="475,805 600,875 565,910" fill="#4C050A" opacity={0.68 * flood} />
        {/* White dashed border line */}
        <path
          d="M 120 638 Q 275 685 415 752 Q 520 818 618 892"
          fill="none"
          stroke="rgba(255,255,255,0.62)"
          strokeWidth={2.5}
          strokeDasharray="12 10"
        />
      </g>

      {/* Neon-Red Route drawing across land + glowing dashes over black sea to destination */}
      <path
        d="M 355 865 Q 485 755 575 660"
        fill="none"
        stroke="#FF2933"
        strokeWidth={11}
        strokeLinecap="round"
        opacity={0.35}
        strokeDasharray="360"
        strokeDashoffset={360 * (1 - route)}
      />
      <path
        d="M 355 865 Q 485 755 575 660"
        fill="none"
        stroke="#FF2933"
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray="360"
        strokeDashoffset={360 * (1 - route)}
      />
      {/* Dashed neon red sea crossing */}
      <path
        d="M 575 660 Q 670 572 805 462"
        fill="none"
        stroke="#FF2933"
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray="18 16"
        opacity={route > 0.45 ? 0.95 : 0.25}
      />
      <path
        d="M 575 660 Q 670 572 805 462"
        fill="none"
        stroke="#FECDD3"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeDasharray="18 16"
        opacity={route > 0.45 ? 0.9 : 0.2}
      />

      {/* Origin & Destination Markers */}
      <circle cx={355} cy={865} r={10} fill="#FFFFFF" stroke="#FF2933" strokeWidth={4} />
      <g transform="translate(805, 462)">
        <circle cx={0} cy={0} r={12 + ping * 34} fill="none" stroke="#FFFFFF" strokeWidth={2.5} opacity={1 - ping} />
        <circle cx={0} cy={0} r={11} fill="#FFFFFF" stroke="#FF2933" strokeWidth={3.5} />
      </g>

      {/* Chalky White Uppercase Place Names */}
      <text x={1012} y={422} textAnchor="end" fill="#F8FAFC" fontSize={30} fontFamily="sans-serif" fontWeight={900} letterSpacing={3} opacity={0.94}>
        NORTH PORT
      </text>
      <text x={148} y={715} fill="#F8FAFC" fontSize={34} fontFamily="sans-serif" fontWeight={900} letterSpacing={5} opacity={0.94}>
        CAPITAL
      </text>

      {/* Dropped Off-White Archival Evidence Card with Engraved Emblem */}
      <g transform="translate(265, 920) rotate(-6)">
        <rect x={8} y={12} width={285} height={195} rx={6} fill="rgba(0,0,0,0.52)" />
        <rect x={0} y={0} width={285} height={195} rx={4} fill="#EDEAE3" stroke="#24221F" strokeWidth={3} />
        <rect x={10} y={10} width={265} height={175} fill="none" stroke="#24221F" strokeWidth={1.2} />
        {/* Red corner stamp pin */}
        <rect x={215} y={-8} width={54} height={24} rx={2} fill="#C2232E" />
        <text x={242} y={9} textAnchor="middle" fill="#FFFFFF" fontSize={13} fontFamily="monospace" fontWeight={800}>
          1842
        </text>
        {/* Engraved circular laurel emblem */}
        <circle cx={142} cy={92} r={42} fill="none" stroke="#24221F" strokeWidth={2.2} strokeDasharray="5 4" />
        <circle cx={142} cy={92} r={32} fill="none" stroke="#24221F" strokeWidth={1.8} />
        <polygon points="142,68 156,104 128,104" fill="none" stroke="#24221F" strokeWidth={2.4} />
        <text x={142} y={36} textAnchor="middle" fill="#24221F" fontSize={16} fontFamily="serif" fontWeight={700} letterSpacing={2}>
          CAMPAIGN RECORD
        </text>
        <text x={142} y={164} textAnchor="middle" fill="#57534E" fontSize={15} fontFamily="monospace" fontWeight={700}>
          13.75°N · 100.50°E
        </text>
      </g>
    </HeroStage>
  );
};

/** look-5: Ink Doodle — Ink Explainer side-on flat scene, round white stick figure with brown hair, red X on phone */
const SigLook5InkDoodle: SignatureComponent = ({ frame, width, height }) => {
  const boil = Math.sin(Math.floor(frame / 5) * 2.1) * 2.2;
  const xDraw = easeOutCubic(clamp01((frame - 14) / 22));
  const ink = '#1D1B1A';

  return (
    <HeroStage
      id="look5"
      width={width}
      height={height}
      borderColor="#1D1B1A"
      shadowColor="rgba(29,27,26,0.22)"
    >
      {/* Pure Flat Sky Blue (no gradients, no shadows — authentic Ink Explainer) */}
      <rect x={28} y={260} width={1024} height={470} fill="#A9E2EC" />

      {/* Hand-drawn wobbly white clouds */}
      <g stroke={ink} strokeWidth={3.5} fill="#FFFFFF" strokeLinejoin="round">
        <path d={`M 120 390 Q 115 ${355 + boil} 152 352 Q 175 322 222 336 Q 260 326 272 360 Q 302 365 292 392 Z`} />
        <path d={`M 730 375 Q 726 ${342 - boil} 765 340 Q 795 312 842 328 Q 885 320 895 352 Q 928 358 916 378 Z`} />
      </g>

      {/* Flat distant green hills */}
      <path d="M 28 730 Q 245 615 470 715 Q 740 605 1052 708 L 1052 770 L 28 770 Z" fill="#A8D08D" stroke={ink} strokeWidth={3.5} />
      {/* Flat grass strip */}
      <rect x={28} y={765} width={1024} height={95} fill="#7DB25C" />
      <line x1={28} y1={765} x2={1052} y2={765} stroke={ink} strokeWidth={3.5} />

      {/* Warm grey sidewalk with thin slab lines */}
      <rect x={28} y={860} width={1024} height={155} fill="#D2CEC5" />
      <line x1={28} y1={860} x2={1052} y2={860} stroke={ink} strokeWidth={3.5} />
      {[210, 440, 670, 890].map((sx) => (
        <line key={sx} x1={sx} y1={860} x2={sx - 32} y2={1015} stroke={ink} strokeWidth={2.5} opacity={0.55} />
      ))}

      {/* Grey Road with crisp dashed white center line */}
      <rect x={28} y={1015} width={1024} height={201} fill="#7E848B" />
      <line x1={28} y1={1015} x2={1052} y2={1015} stroke={ink} strokeWidth={4} />
      <line x1={65} y1={1115} x2={1020} y2={1115} stroke="#FFFFFF" strokeWidth={11} strokeDasharray="64 46" />

      {/* Left Doodle Tree */}
      <g>
        <path d="M 155 885 L 165 725 L 195 725 L 205 885 Z" fill="#8C5E3C" stroke={ink} strokeWidth={4} />
        <path
          d={`M 98 730 Q 74 662 125 628 Q 145 568 205 582 Q 268 575 278 638 Q 312 678 265 732 Z`}
          fill="#6CA555"
          stroke={ink}
          strokeWidth={4}
        />
      </g>

      {/* Right Bus Stop Sign */}
      <g transform="translate(920, 610)">
        <line x1={0} y1={0} x2={0} y2={285} stroke={ink} strokeWidth={5} />
        <rect x={-42} y={-28} width={84} height={84} rx={10} fill="#FFFFFF" stroke={ink} strokeWidth={4} />
        <rect x={-26} y={-8} width={52} height={34} rx={5} fill="#FACC15" stroke={ink} strokeWidth={3} />
        <circle cx={-14} cy={30} r={6} fill={ink} />
        <circle cx={14} cy={30} r={6} fill={ink} />
      </g>

      {/* Wooden Bench in middle-left */}
      <g transform="translate(275, 765)">
        <rect x={0} y={0} width={330} height={46} rx={6} fill="#B07A4C" stroke={ink} strokeWidth={4} />
        <rect x={-8} y={66} width={346} height={32} rx={6} fill="#C28B59" stroke={ink} strokeWidth={4} />
        <line x1={30} y1={46} x2={30} y2={160} stroke={ink} strokeWidth={6} strokeLinecap="round" />
        <line x1={300} y1={46} x2={300} y2={160} stroke={ink} strokeWidth={6} strokeLinecap="round" />
      </g>

      {/* BIG ROUND WHITE-HEADED STICK PERSON (6-7px ink — thickest line in scene!) */}
      <g transform={`translate(435, ${(745 + boil * 0.5).toFixed(1)})`}>
        {/* Body torso */}
        <path d="M 0 -5 L -2 95" fill="none" stroke={ink} strokeWidth={7} strokeLinecap="round" />
        {/* Legs sitting on bench */}
        <path d="M -2 95 L -48 118 L -55 182" fill="none" stroke={ink} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M -2 95 L 48 118 L 56 182" fill="none" stroke={ink} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        {/* Black oval shoes */}
        <ellipse cx={-66} cy={186} rx={18} ry={9} fill={ink} />
        <ellipse cx={68} cy={186} rx={18} ry={9} fill={ink} />
        {/* Shrugging Arms + White Mitten Hands */}
        <path d="M 0 22 Q -54 58 -92 16" fill="none" stroke={ink} strokeWidth={6.5} strokeLinecap="round" />
        <path d="M 0 22 Q 56 58 94 14" fill="none" stroke={ink} strokeWidth={6.5} strokeLinecap="round" />
        <circle cx={-98} cy={8} r={16} fill="#FFFFFF" stroke={ink} strokeWidth={5.5} />
        <circle cx={100} cy={6} r={16} fill="#FFFFFF" stroke={ink} strokeWidth={5.5} />
        {/* Big Pure White Round Head */}
        <circle cx={0} cy={-74} r={74} fill="#FFFFFF" stroke={ink} strokeWidth={7} />
        {/* Messy Curved Brown Hair (#6A4126) */}
        <path
          d="M -68 -108 Q -58 -164 -16 -146 Q 12 -178 46 -144 Q 82 -156 70 -106 Q 36 -124 -8 -118 Q -42 -124 -68 -108 Z"
          fill="#6A4126"
          stroke={ink}
          strokeWidth={5.5}
          strokeLinejoin="round"
        />
        {/* Dot eyes, raised brows, shrugging mouth */}
        <path d="M -34 -96 Q -22 -108 -10 -98" fill="none" stroke={ink} strokeWidth={4.5} strokeLinecap="round" />
        <path d="M 10 -98 Q 24 -108 36 -96" fill="none" stroke={ink} strokeWidth={4.5} strokeLinecap="round" />
        <ellipse cx={-20} cy={-76} rx={6} ry={9} fill={ink} />
        <ellipse cx={22} cy={-76} rx={6} ry={9} fill={ink} />
        <path d="M -14 -44 Q 2 -52 18 -42" fill="none" stroke={ink} strokeWidth={5} strokeLinecap="round" />
      </g>

      {/* Swirling wind lines & blowing paper sheet */}
      <path d="M 110 510 Q 250 475 340 505 Q 375 516 360 490 Q 345 470 318 488" fill="none" stroke={ink} strokeWidth={3.2} strokeLinecap="round" opacity={0.75} />
      <g transform={`translate(${(255 + Math.sin(frame * 0.09) * 14).toFixed(1)}, 455) rotate(-18)`}>
        <rect x={-26} y={-32} width={52} height={64} fill="#FFFFFF" stroke={ink} strokeWidth={3.5} />
        <line x1={-14} y1={-12} x2={14} y2={-12} stroke={ink} strokeWidth={2.5} />
        <line x1={-14} y1={4} x2={10} y2={4} stroke={ink} strokeWidth={2.5} />
      </g>

      {/* POPPED-UP SMARTPHONE + BOLD RED MARKER X SLASH (#E1191F) */}
      <g transform="translate(745, 580) rotate(6)">
        <rect x={-76} y={-124} width={152} height={248} rx={22} fill="#FFFFFF" stroke={ink} strokeWidth={6} />
        <rect x={-60} y={-92} width={120} height={178} rx={8} fill="#E0F2FE" stroke={ink} strokeWidth={3.5} />
        <circle cx={0} cy={104} r={10} fill="none" stroke={ink} strokeWidth={3.5} />
        {/* Bold Red Marker X Slash */}
        <path
          d="M -105 -125 L 108 122"
          fill="none"
          stroke="#E1191F"
          strokeWidth={22}
          strokeLinecap="round"
          strokeDasharray="340"
          strokeDashoffset={340 * (1 - xDraw)}
        />
        <path
          d="M 105 -125 L -108 122"
          fill="none"
          stroke="#E1191F"
          strokeWidth={22}
          strokeLinecap="round"
          strokeDasharray="340"
          strokeDashoffset={340 * (1 - Math.max(0, xDraw * 1.4 - 0.4))}
        />
      </g>

      {/* One small handwritten label box (Patrick Hand / hand-drawn aesthetic) */}
      <g transform="translate(88, 305)">
        <rect x={0} y={0} width={290} height={62} rx={8} fill="#FFFFFF" stroke={ink} strokeWidth={4.5} />
        <text x={145} y={40} textAnchor="middle" fill={ink} fontSize={26} fontFamily={THAI_FONT_FAMILY} fontWeight={800}>
          WAIT... NO PHONE!
        </text>
      </g>
    </HeroStage>
  );
};

/** look-6: Deep Time — letterboxed cosmic black hole, bent smoky amber accretion disk & tidal star stream */
const SigLook6DeepTime: SignatureComponent = ({ frame, width, height }) => {
  const rot = frame * 0.65;
  const yearVal = Math.min(1000000000, Math.round(easeOutCubic(clamp01(frame / 52)) * 1000000000));
  const pulse = 0.92 + Math.sin(frame * 0.05) * 0.08;

  return (
    <HeroStage
      id="look6"
      width={width}
      height={height}
      borderColor="rgba(238,184,111,0.38)"
      defs={
        <>
          <radialGradient id="h6-halo" cx="50%" cy="50%" r="50%">
            <stop offset="44%" stopColor="#000000" stopOpacity="1" />
            <stop offset="53%" stopColor="#FFF1E0" stopOpacity="0.98" />
            <stop offset="62%" stopColor="#EEB86F" stopOpacity="0.72" />
            <stop offset="78%" stopColor="#B26D3C" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#070504" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="h6-disk" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#613821" stopOpacity="0.1" />
            <stop offset="22%" stopColor="#B26D3C" stopOpacity="0.88" />
            <stop offset="50%" stopColor="#FCFADA" stopOpacity="0.98" />
            <stop offset="78%" stopColor="#EEB86F" stopOpacity="0.88" />
            <stop offset="100%" stopColor="#613821" stopOpacity="0.1" />
          </linearGradient>
          <radialGradient id="h6-star" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="42%" stopColor="#FCFADA" stopOpacity="0.95" />
            <stop offset="74%" stopColor="#EEB86F" stopOpacity="0.52" />
            <stop offset="100%" stopColor="#B26D3C" stopOpacity="0" />
          </radialGradient>
        </>
      }
    >
      {/* Near-black cosmic backdrop */}
      <rect x={28} y={260} width={1024} height={956} fill="#070504" />

      {/* Pinpoint cosmic starfield */}
      {Array.from({ length: 72 }, (_, i) => {
        const sx = 40 + hashSeed(i * 13 + 7) * 1000;
        const sy = 330 + hashSeed(i * 19 + 11) * 800;
        const sr = 0.8 + hashSeed(i * 29 + 3) * 2.1;
        return <circle key={i} cx={sx} cy={sy} r={sr} fill="#FFF8EC" opacity={0.3 + hashSeed(i * 7) * 0.65} />;
      })}

      {/* COLOSSAL BLACK HOLE + GRAVITATIONALLY LENSED ACCRETION DISK */}
      <g transform="translate(555, 710)">
        {/* Outer smoky orange nebula glow */}
        <ellipse cx={0} cy={0} rx={460 * pulse} ry={280 * pulse} fill="url(#h6-halo)" opacity={0.55} />

        {/* Gravitationally bent FAR side of disk arching UP over the top of the black hole */}
        <path
          d="M -395 16 C -310 -255, 310 -255, 395 16"
          fill="none"
          stroke="#613821"
          strokeWidth={74}
          strokeLinecap="round"
          opacity={0.75}
        />
        <path
          d="M -375 12 C -285 -220, 285 -220, 375 12"
          fill="none"
          stroke="#B26D3C"
          strokeWidth={46}
          strokeLinecap="round"
          opacity={0.85}
        />
        <path
          d="M -340 8 C -250 -195, 250 -195, 340 8"
          fill="none"
          stroke="#EEB86F"
          strokeWidth={22}
          strokeLinecap="round"
          opacity={0.92}
        />
        <path
          d="M -295 4 C -210 -174, 210 -174, 295 4"
          fill="none"
          stroke="#FCFADA"
          strokeWidth={7}
          strokeLinecap="round"
          opacity={0.95}
        />

        {/* Lower gravitational lens halo */}
        <path
          d="M -245 35 C -185 205, 185 205, 245 35"
          fill="none"
          stroke="#B26D3C"
          strokeWidth={28}
          opacity={0.58}
        />
        <path
          d="M -220 35 C -165 182, 165 182, 220 35"
          fill="none"
          stroke="#EEB86F"
          strokeWidth={10}
          opacity={0.78}
        />

        {/* Event Horizon Pure Black Shadow + Razor-Thin White-Gold Photon Ring */}
        <circle cx={0} cy={0} r={168} fill="url(#h6-halo)" />
        <circle cx={0} cy={0} r={134} fill="#000000" />
        <circle cx={0} cy={0} r={136} fill="none" stroke="#FFF1E0" strokeWidth={3.8} opacity={0.96} />
        <circle cx={0} cy={0} r={141} fill="none" stroke="#EEB86F" strokeWidth={2} opacity={0.62} />

        {/* Foreground Accretion Disk sweeping IN FRONT of the black hole shadow */}
        <g transform="rotate(-11)">
          <ellipse cx={0} cy={22} rx={455} ry={66} fill="none" stroke="#613821" strokeWidth={46} opacity={0.65} />
          <ellipse cx={0} cy={18} rx={425} ry={54} fill="none" stroke="url(#h6-disk)" strokeWidth={28} />
          <ellipse cx={0} cy={16} rx={375} ry={40} fill="none" stroke="#FCFADA" strokeWidth={8} opacity={0.9} strokeDasharray="340 60 180 40" strokeDashoffset={-rot * 2.5} />
        </g>

        {/* Disrupted Star being torn into a white-hot smoky tidal gas torrent */}
        <path
          d="M -370 245 C -335 165, -245 90, -145 55 C -55 25, 120 30, 215 10"
          fill="none"
          stroke="#B26D3C"
          strokeWidth={34}
          strokeLinecap="round"
          opacity={0.62}
        />
        <path
          d="M -370 245 C -335 165, -245 90, -145 55 C -55 25, 120 30, 215 10"
          fill="none"
          stroke="#EEB86F"
          strokeWidth={16}
          strokeLinecap="round"
          opacity={0.86}
        />
        <path
          d="M -370 245 C -335 165, -245 90, -145 55"
          fill="none"
          stroke="#FCFADA"
          strokeWidth={7}
          strokeLinecap="round"
        />
        {/* Luminous tearing star core at lower-left */}
        <circle cx={-370} cy={245} r={72} fill="url(#h6-star)" />
        <ellipse cx={-370} cy={245} rx={30} ry={18} fill="#FFFFFF" transform="rotate(-32, -370, 245)" />
      </g>

      {/* Solid Black Cinema Letterbox Bars (top & bottom of hero stage, strictly y<=1216) */}
      <rect x={28} y={260} width={1024} height={68} fill="#020202" />
      <rect x={28} y={1138} width={1024} height={78} fill="#020202" />
      <line x1={28} y1={328} x2={1052} y2={328} stroke="rgba(255,241,224,0.16)" strokeWidth={1.2} />
      <line x1={28} y1={1138} x2={1052} y2={1138} stroke="rgba(255,241,224,0.16)" strokeWidth={1.2} />

      {/* Documentary Deep-Time Caption in Lower Letterbox Bar */}
      <text x={540} y={1185} textAnchor="middle" fill="#B6B6B4" fontSize={23} fontFamily="monospace" letterSpacing={1.5}>
        Year {yearVal.toLocaleString('en-US')}  |  A wandering black hole tears the star
      </text>
    </HeroStage>
  );
};

/** look-7: Neon Silhouette — moody plum room, sunset skyline window, lamp cone, red rim-lit silhouette with white eyes */
const SigLook7NeonSilhouette: SignatureComponent = ({ frame, width, height }) => {
  const sway = Math.sin(frame * 0.04) * 3.5;
  const eyeScale = frame > 25 ? 1.18 : 1.0;

  return (
    <HeroStage
      id="look7"
      width={width}
      height={height}
      borderColor="rgba(255,77,109,0.48)"
      defs={
        <>
          <linearGradient id="h7-wall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B234A" />
            <stop offset="65%" stopColor="#23142F" />
            <stop offset="100%" stopColor="#120A1A" />
          </linearGradient>
          <linearGradient id="h7-sunset" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#261942" />
            <stop offset="38%" stopColor="#7C2D5E" />
            <stop offset="72%" stopColor="#E85D75" />
            <stop offset="100%" stopColor="#F59E6C" />
          </linearGradient>
          <linearGradient id="h7-cone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FDE68A" stopOpacity="0.44" />
            <stop offset="60%" stopColor="#FDE68A" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#FDE68A" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="h7-rim-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF3B6B" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#FF3B6B" stopOpacity="0" />
          </radialGradient>
        </>
      }
    >
      {/* Dusky plum interior room */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h7-wall)" />

      {/* Panoramic Window onto Hazy Sunset City Skyline */}
      <rect x={82} y={336} width={916} height={470} rx={6} fill="url(#h7-sunset)" stroke="#170F1D" strokeWidth={12} />
      {/* Distant haze skyline layer */}
      <path
        d="M 82 806 L 82 655 L 156 655 L 156 595 L 228 595 L 228 670 L 315 670 L 315 545 L 402 545 L 402 640 L 495 640 L 495 570 L 580 570 L 580 658 L 690 658 L 690 520 L 775 520 L 775 628 L 878 628 L 878 585 L 998 585 L 998 806 Z"
        fill="#3A1D42"
        opacity={0.75}
      />
      {/* Closer dark city skyline */}
      <path
        d="M 82 806 L 82 710 L 185 710 L 185 640 L 270 640 L 270 725 L 390 725 L 390 618 L 475 618 L 475 715 L 620 715 L 620 638 L 718 638 L 718 708 L 845 708 L 845 655 L 998 655 L 998 806 Z"
        fill="#190E24"
      />
      {/* Tiny warm glowing city windows */}
      {[208, 232, 412, 438, 642, 670, 868, 902].map((wx, i) => (
        <React.Fragment key={wx}>
          <rect x={wx} y={672 + (i % 2) * 18} width={10} height={14} fill="#FDE68A" opacity={0.85} />
          <rect x={wx} y={704 + (i % 3) * 14} width={10} height={14} fill="#FDBA74" opacity={0.72} />
        </React.Fragment>
      ))}
      {/* Window mullions */}
      <line x1={388} y1={336} x2={388} y2={806} stroke="#170F1D" strokeWidth={10} />
      <line x1={692} y1={336} x2={692} y2={806} stroke="#170F1D" strokeWidth={10} />

      {/* Hanging Pendant Lamp + Dusty Volumetric Light Cone */}
      <g transform={`translate(345, 290) rotate(${(sway * 0.4).toFixed(1)})`}>
        <line x1={0} y1={0} x2={0} y2={165} stroke="#120B18" strokeWidth={6} />
        <polygon points="-58,205 58,205 295,880 -265,880" fill="url(#h7-cone)" />
        <path d="M -64 205 L -22 162 L 22 162 L 64 205 Z" fill="#140C1C" stroke="#FF4D6D" strokeWidth={2.5} />
        <ellipse cx={0} cy={205} rx={52} ry={10} fill="#FEF08A" opacity={0.85} />
        {/* Floating dust specks inside cone */}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const dx = -120 + hashSeed(i * 9 + 2) * 240;
          const dy = 270 + ((hashSeed(i * 15 + 4) * 480 + frame * 0.9) % 480);
          return <circle key={i} cx={dx} cy={dy} r={2.4} fill="#FEF3C7" opacity={0.55} />;
        })}
      </g>

      {/* Dark Noir Desk Surface */}
      <rect x={28} y={955} width={1024} height={261} fill="#110918" />
      <line x1={28} y1={955} x2={1052} y2={955} stroke="#FF4D6D" strokeWidth={2.5} opacity={0.65} />
      {/* Desk laptop glow & coffee mug silhouette */}
      <polygon points="340,955 485,955 462,882 325,882" fill="#09050F" stroke="#F472B6" strokeWidth={2} />
      <rect x={225} y={908} width={44} height={47} rx={6} fill="#09050F" stroke="#FF4D6D" strokeWidth={2} />

      {/* HERO ROUND-HEADED SILHOUETTE CHARACTER WITH CORAL-RED RIM LIGHT & TWO WHITE EYES */}
      <g transform="translate(650, 815)">
        {/* Soft coral neon back-aura */}
        <circle cx={-12} cy={-110} r={175} fill="url(#h7-rim-glow)" />
        {/* Shoulders & Torso */}
        <path
          d="M -165 255 C -158 75, -108 -18, 0 -24 C 108 -18, 158 75, 165 255 Z"
          fill="#07050B"
          stroke="#FF3B6B"
          strokeWidth={5.5}
        />
        {/* Large Round Silhouette Head */}
        <circle cx={0} cy={-125} r={104} fill="#07050B" stroke="#FF3B6B" strokeWidth={5.5} />
        {/* Bright coral-white rim highlight along left edge facing lamp/window */}
        <path d="M -92 -175 A 104 104 0 0 1 -14 -228" fill="none" stroke="#FDA4AF" strokeWidth={6} strokeLinecap="round" />
        <path d="M -135 80 C -124 20, -90 -15, -34 -22" fill="none" stroke="#FDA4AF" strokeWidth={5} strokeLinecap="round" />
        {/* TWO EXPRESSIVE WIDE WHITE EYES */}
        <ellipse cx={-34} cy={-130} rx={16 * eyeScale} ry={21 * eyeScale} fill="#FFFFFF" />
        <ellipse cx={26} cy={-130} rx={16 * eyeScale} ry={21 * eyeScale} fill="#FFFFFF" />
      </g>

      {/* Blurred Dark Foreground Potted Plant Silhouette (left corner depth) */}
      <g opacity={0.92}>
        <path d="M 28 1216 L 28 840 Q 130 895 162 1030 Q 195 965 255 995 Q 202 1095 230 1216 Z" fill="#06040A" />
        <path d="M 48 995 Q 155 830 225 875 Q 165 965 95 1040 Z" fill="#09060F" />
      </g>

      {/* Subtle top & bottom noir cinema bars + spaced capitals tag */}
      <rect x={28} y={260} width={1024} height={46} fill="#050308" />
      <rect x={28} y={1172} width={1024} height={44} fill="#050308" />
      <text x={540} y={291} textAnchor="middle" fill="#FDA4AF" fontSize={19} fontFamily="monospace" fontWeight={700} letterSpacing={8}>
        MIDNIGHT SHIFT
      </text>
    </HeroStage>
  );
};

/** look-8: POV Doodle — painterly muted grey-green wall, sand desk, thick brown marker lines, frazzled round white head */
const SigLook8POVDoodle: SignatureComponent = ({ frame, width, height }) => {
  const wobble = Math.sin(Math.floor(frame / 4) * 2.1) * 2.4;
  const sweatY = (frame * 2.8) % 52;
  const clockAng = (frame * 9) % 360;
  const dayNum = Math.min(30, 1 + Math.floor(frame / 2));
  const ink = '#33201C';

  return (
    <HeroStage
      id="look8"
      width={width}
      height={height}
      borderColor="#33201C"
      defs={
        <pattern id="h8-paper" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx={5} cy={7} r={1.2} fill="#33201C" opacity={0.07} />
          <circle cx={16} cy={17} r={1.0} fill="#33201C" opacity={0.05} />
        </pattern>
      }
    >
      {/* Flat muted painterly grey-green wall (#B2B392) */}
      <rect x={28} y={260} width={1024} height={675} fill="#B2B392" />
      {/* Flat warm sand desk (#D8C3A5) */}
      <rect x={28} y={935} width={1024} height={281} fill="#D8C3A5" />
      {/* Subtle dry-brush paper speckle */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h8-paper)" />

      {/* Thick hand-drawn desk horizon line */}
      <path d={`M 28 935 Q 540 ${928 + wobble} 1052 938`} fill="none" stroke={ink} strokeWidth={8} strokeLinecap="round" />

      {/* Wall Clock (left) spinning fast to show time passing */}
      <g transform="translate(185, 435)">
        <circle cx={0} cy={0} r={74} fill="#F5EFE4" stroke={ink} strokeWidth={7.5} />
        {[0, 90, 180, 270].map((a) => (
          <line
            key={a}
            x1={Math.cos((a * Math.PI) / 180) * 52}
            y1={Math.sin((a * Math.PI) / 180) * 52}
            x2={Math.cos((a * Math.PI) / 180) * 64}
            y2={Math.sin((a * Math.PI) / 180) * 64}
            stroke={ink}
            strokeWidth={5}
            strokeLinecap="round"
          />
        ))}
        <line x1={0} y1={0} x2={Math.cos((clockAng * Math.PI) / 180) * 44} y2={Math.sin((clockAng * Math.PI) / 180) * 44} stroke={ink} strokeWidth={6} strokeLinecap="round" />
        <line x1={0} y1={0} x2={Math.cos(((clockAng * 0.25) * Math.PI) / 180) * 30} y2={Math.sin(((clockAng * 0.25) * Math.PI) / 180) * 30} stroke="#A84A32" strokeWidth={6} strokeLinecap="round" />
        <circle cx={0} cy={0} r={7} fill={ink} />
      </g>

      {/* Flipping Wall Calendar (right) */}
      <g transform="translate(805, 365) rotate(3)">
        <rect x={0} y={0} width={168} height={175} rx={12} fill="#F5EFE4" stroke={ink} strokeWidth={7} />
        <rect x={0} y={0} width={168} height={46} rx={10} fill="#B85D43" stroke={ink} strokeWidth={7} />
        <text x={84} y={32} textAnchor="middle" fill="#F5EFE4" fontSize={22} fontFamily="monospace" fontWeight={800}>
          DAY
        </text>
        <text x={84} y={136} textAnchor="middle" fill={ink} fontSize={74} fontFamily="sans-serif" fontWeight={900}>
          {dayNum}
        </text>
      </g>

      {/* HERO POV DOODLE CHARACTER — Facing Camera, Teal Sweater, Big Round White Head */}
      <g transform={`translate(540, ${(740 + wobble * 0.5).toFixed(1)})`}>
        {/* Muted Teal Sweater Shoulders (#3B7A7A) */}
        <path
          d="M -225 225 C -215 80, -145 5, 0 0 C 145 5, 215 80, 225 225 Z"
          fill="#3B7A7A"
          stroke={ink}
          strokeWidth={8.5}
          strokeLinejoin="round"
        />
        {/* Sweater collar */}
        <path d="M -52 10 Q 0 54 52 10" fill="none" stroke={ink} strokeWidth={7} strokeLinecap="round" />

        {/* Big Round White Doodle Head */}
        <circle cx={0} cy={-125} r={146} fill="#FFFDF7" stroke={ink} strokeWidth={9} />

        {/* Thick Expressive Raised Eyebrows */}
        <path d="M -88 -192 Q -52 -218 -18 -182" fill="none" stroke={ink} strokeWidth={11} strokeLinecap="round" />
        <path d="M 18 -182 Q 52 -218 88 -192" fill="none" stroke={ink} strokeWidth={11} strokeLinecap="round" />

        {/* Wide Frazzled Eyes + Stress Under-Eye Lines */}
        <circle cx={-48} cy={-140} r={22} fill="#FFFFFF" stroke={ink} strokeWidth={6} />
        <circle cx={-48} cy={-140} r={8.5} fill={ink} />
        <circle cx={48} cy={-140} r={22} fill="#FFFFFF" stroke={ink} strokeWidth={6} />
        <circle cx={48} cy={-140} r={8.5} fill={ink} />
        <path d="M -72 -108 Q -48 -98 -28 -108" fill="none" stroke={ink} strokeWidth={4} strokeLinecap="round" />
        <path d="M 28 -108 Q 48 -98 72 -108" fill="none" stroke={ink} strokeWidth={4} strokeLinecap="round" />

        {/* Gritted-Teeth Grimace Mouth */}
        <rect x={-58} y={-82} width={116} height={38} rx={16} fill="#FFFFFF" stroke={ink} strokeWidth={6.5} />
        <line x1={-56} y1={-63} x2={56} y2={-63} stroke={ink} strokeWidth={4.5} />
        {[-28, 0, 28].map((tx) => (
          <line key={tx} x1={tx} y1={-80} x2={tx} y2={-46} stroke={ink} strokeWidth={4} />
        ))}

        {/* Bouncing Sweat Drops */}
        <path
          d={`M 122 ${-190 + sweatY * 0.4} Q 138 ${-160 + sweatY * 0.4} 122 ${-148 + sweatY * 0.4} Q 106 ${-160 + sweatY * 0.4} 122 ${-190 + sweatY * 0.4} Z`}
          fill="#93C5C5"
          stroke={ink}
          strokeWidth={4.5}
        />
        <path
          d={`M -134 ${-155 + sweatY * 0.3} Q -120 ${-132 + sweatY * 0.3} -134 ${-120 + sweatY * 0.3} Q -148 ${-132 + sweatY * 0.3} -134 ${-155 + sweatY * 0.3} Z`}
          fill="#93C5C5"
          stroke={ink}
          strokeWidth={4.5}
        />

        {/* Expressive hands raised near cheeks/desk */}
        <path d="M -185 170 Q -195 75 -148 42 Q -120 28 -110 62 L -115 170 Z" fill="#FFFDF7" stroke={ink} strokeWidth={7.5} strokeLinejoin="round" />
        <path d="M 185 170 Q 195 75 148 42 Q 120 28 110 62 L 115 170 Z" fill="#FFFDF7" stroke={ink} strokeWidth={7.5} strokeLinejoin="round" />
      </g>

      {/* Desk Props: Open Laptop Back (center-bottom), Steaming Mug (left), Crumpled Paper (right) */}
      <g transform="translate(540, 1085)">
        <polygon points="-210,120 -175,-95 175,-95 210,120" fill="#7C8588" stroke={ink} strokeWidth={8} strokeLinejoin="round" />
        <circle cx={0} cy={12} r={22} fill="#B2B392" stroke={ink} strokeWidth={5} />
      </g>
      {/* Steaming Coffee Mug */}
      <g transform="translate(175, 1025)">
        <rect x={-45} y={-20} width={90} height={105} rx={12} fill="#C86D51" stroke={ink} strokeWidth={7} />
        <path d="M 45 4 Q 82 4 82 32 Q 82 62 45 62" fill="none" stroke={ink} strokeWidth={7} />
        <path d="M -18 -42 Q -28 -68 -10 -86 M 14 -40 Q 26 -64 8 -84" fill="none" stroke={ink} strokeWidth={4.5} strokeLinecap="round" opacity={0.7} />
      </g>
      {/* Crumpled Paper Stack */}
      <g transform="translate(885, 1065)">
        <path d="M -52 20 L -38 -25 L 0 -42 L 42 -22 L 54 18 L 12 38 Z" fill="#F5EFE4" stroke={ink} strokeWidth={6} strokeLinejoin="round" />
        <path d="M -22 -14 L 8 4 L 28 -10" fill="none" stroke={ink} strokeWidth={4} />
      </g>
    </HeroStage>
  );
};

/** look-9: Blue Grid — deep cobalt engineering grid + white clay 3D cutaway machine + glowing orange-to-red flow lines */
const SigLook9BlueGrid: SignatureComponent = ({ frame, width, height }) => {
  const flowDash = -(frame * 5.2);
  const pulse = 0.8 + Math.sin(frame * 0.1) * 0.2;
  const cx = 530;
  const cy = 785;

  return (
    <HeroStage
      id="look9"
      width={width}
      height={height}
      borderColor="rgba(147,197,253,0.48)"
      defs={
        <>
          <radialGradient id="h9-bg" cx="50%" cy="48%" r="62%">
            <stop offset="0%" stopColor="#1E5A9C" />
            <stop offset="100%" stopColor="#092E5E" />
          </radialGradient>
          <pattern id="h9-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(147,197,253,0.2)" strokeWidth={1.2} />
            <path d="M 24 0 L 24 48 M 0 24 L 48 24" fill="none" stroke="rgba(147,197,253,0.08)" strokeWidth={0.8} />
          </pattern>
          <linearGradient id="h9-flow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FDE047" />
            <stop offset="35%" stopColor="#FB923C" />
            <stop offset="68%" stopColor="#EF4444" />
            <stop offset="100%" stopColor="#FB923C" />
          </linearGradient>
        </>
      }
    >
      {/* Deep Engineering Blueprint Blue + Fine Grid */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h9-bg)" />
      <rect x={28} y={260} width={1024} height={956} fill="url(#h9-grid)" />

      {/* Top Engineering Dimension Bar */}
      <line x1={76} y1={312} x2={1004} y2={312} stroke="rgba(219,234,254,0.45)" strokeWidth={1.5} />
      <line x1={76} y1={300} x2={76} y2={324} stroke="#DBEAFE" strokeWidth={2} />
      <line x1={1004} y1={300} x2={1004} y2={324} stroke="#DBEAFE" strokeWidth={2} />
      <text x={540} y={302} textAnchor="middle" fill="#DBEAFE" fontSize={18} fontFamily="monospace" letterSpacing={3}>
        CUTAWAY SCHEMATIC // SCALE 1:10 // THERMAL FLOW
      </text>

      {/* Soft contact shadow under clay machine */}
      <IsoShadow x={-160} y={-120} dx={320} dy={240} cx={cx} cy={cy + 30} opacity={0.34} />

      {/* MATTE WHITE CLAY 3D ISOMETRIC CUTAWAY MACHINE */}
      {/* Base Chassis Block */}
      <IsoBox x={-160} y={-110} z={0} dx={320} dy={220} dz={42} cx={cx} cy={cy} topColor="#F1F5F9" leftColor="#CBD5E1" rightColor="#94A3B8" stroke="#64748B" strokeWidth={1.2} />
      {/* Back-Left Upper Housing Wall */}
      <IsoBox x={-150} y={-105} z={42} dx={150} dy={205} dz={165} cx={cx} cy={cy} topColor="#FFFFFF" leftColor="#E2E8F0" rightColor="#94A3B8" stroke="#64748B" strokeWidth={1.2} />
      {/* Back-Right Upper Housing Wall (leaving front-right quarter CUT AWAY!) */}
      <IsoBox x={0} y={-105} z={42} dx={150} dy={95} dz={165} cx={cx} cy={cy} topColor="#FFFFFF" leftColor="#CBD5E1" rightColor="#94A3B8" stroke="#64748B" strokeWidth={1.2} />

      {/* Exposed Internal Chamber inside the 90° Cutaway */}
      <IsoBox x={8} y={-6} z={46} dx={122} dy={94} dz={32} cx={cx} cy={cy} topColor="#334155" leftColor="#1E293B" rightColor="#0F172A" />
      {/* Internal Clay Compression Rotor / Core Cylinders */}
      <IsoBox x={28} y={8} z={78} dx={82} dy={66} dz={86} cx={cx} cy={cy} topColor="#FEE2E2" leftColor="#FCA5A5" rightColor="#EF4444" stroke="#B91C1C" strokeWidth={1.5} />
      <IsoBox x={44} y={22} z={164} dx={50} dy={38} dz={28} cx={cx} cy={cy} topColor="#FFFFFF" leftColor="#CBD5E1" rightColor="#94A3B8" />
      {/* Top Intake Manifold Block */}
      <IsoBox x={-110} y={-70} z={207} dx={96} dy={96} dz={52} cx={cx} cy={cy} topColor="#FFFFFF" leftColor="#E2E8F0" rightColor="#94A3B8" />

      {/* GLOWING ORANGE-TO-DEEP-RED ANIMATED FLOW STREAMLINES POURING THROUGH CUTAWAY */}
      {/* Glow Halo Paths */}
      <path
        d="M 118 595 C 240 595, 315 628, 415 675 C 495 712, 575 745, 622 728 C 700 700, 795 660, 965 655"
        fill="none"
        stroke="#EF4444"
        strokeWidth={22}
        strokeLinecap="round"
        opacity={0.28 * pulse}
      />
      {/* 3 Primary Energy/Airflow Streamlines */}
      {[
        'M 105 568 C 235 568, 315 605, 425 658 C 510 698, 585 724, 645 702 C 725 672, 815 632, 975 628',
        'M 105 608 C 238 608, 322 642, 425 692 C 512 732, 585 756, 650 732 C 730 704, 822 666, 975 662',
        'M 105 648 C 242 648, 330 678, 428 724 C 515 765, 588 785, 655 762 C 735 734, 828 700, 975 696',
      ].map((d, idx) => (
        <React.Fragment key={idx}>
          <path d={d} fill="none" stroke="url(#h9-flow)" strokeWidth={idx === 1 ? 8 : 5.5} strokeLinecap="round" opacity={0.92} />
          <path
            d={d}
            fill="none"
            stroke="#FEF08A"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray="36 84"
            strokeDashoffset={flowDash - idx * 32}
          />
        </React.Fragment>
      ))}

      {/* Three Crisp White Capital Callouts on Thin Leader Lines */}
      {/* Callout 1: INTAKE */}
      <g>
        <circle cx={382} cy={535} r={6} fill="#FFFFFF" />
        <polyline points="382,535 288,430 112,430" fill="none" stroke="#FFFFFF" strokeWidth={2.2} />
        <text x={112} y={416} fill="#FFFFFF" fontSize={23} fontFamily="monospace" fontWeight={800} letterSpacing={2}>
          01 · INTAKE
        </text>
      </g>
      {/* Callout 2: CORE COMPRESSION */}
      <g>
        <circle cx={596} cy={740} r={6} fill="#FEF08A" stroke="#EF4444" strokeWidth={2.5} />
        <polyline points="596,740 735,990 975,990" fill="none" stroke="#FFFFFF" strokeWidth={2.2} />
        <text x={975} y={976} textAnchor="end" fill="#FFFFFF" fontSize={23} fontFamily="monospace" fontWeight={800} letterSpacing={2}>
          02 · THERMAL CORE
        </text>
      </g>
      {/* Callout 3: EXHAUST */}
      <g>
        <circle cx={815} cy={662} r={6} fill="#FFFFFF" />
        <polyline points="815,662 860,445 990,445" fill="none" stroke="#FFFFFF" strokeWidth={2.2} />
        <text x={990} y={431} textAnchor="end" fill="#FFFFFF" fontSize={23} fontFamily="monospace" fontWeight={800} letterSpacing={2}>
          03 · EXHAUST
        </text>
      </g>
    </HeroStage>
  );
};

/** look-10: Product Turntable — graphite luxury studio, dark turntable disc, 3D studio hardware, 4 hairline callouts */
const SigLook10Turntable: SignatureComponent = ({ frame, width, height }) => {
  const sheenX = Math.sin(frame * 0.055) * 195;
  const rimShift = Math.sin(frame * 0.05) * 12;

  return (
    <HeroStage
      id="look10"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.38)"
      defs={
        <>
          <linearGradient id="h10-studio" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#090A0C" />
            <stop offset="68%" stopColor="#161920" />
            <stop offset="100%" stopColor="#0B0D11" />
          </linearGradient>
          <radialGradient id="h10-floor-pool" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#475569" stopOpacity="0.45" />
            <stop offset="60%" stopColor="#1E293B" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#090A0C" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="h10-body" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#CBD5E1" />
            <stop offset="12%" stopColor="#262B36" />
            <stop offset="48%" stopColor="#11141B" />
            <stop offset="86%" stopColor="#2E3545" />
            <stop offset="100%" stopColor="#E2E8F0" />
          </linearGradient>
          <linearGradient id="h10-chrome" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#64748B" />
            <stop offset="32%" stopColor="#F8FAFC" />
            <stop offset="56%" stopColor="#475569" />
            <stop offset="84%" stopColor="#E2E8F0" />
            <stop offset="100%" stopColor="#334155" />
          </linearGradient>
          <linearGradient id="h10-disc" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#0B0E14" />
            <stop offset="50%" stopColor="#334155" />
            <stop offset="100%" stopColor="#0B0E14" />
          </linearGradient>
        </>
      }
    >
      {/* Near-black luxury graphite studio backdrop */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h10-studio)" />

      {/* Soft overhead studio light pool on floor */}
      <ellipse cx={540} cy={1000} rx={450} ry={130} fill="url(#h10-floor-pool)" />

      {/* Top Centered Product Studio Heading */}
      <text x={540} y={328} textAnchor="middle" fill="#94A3B8" fontSize={20} fontFamily="monospace" fontWeight={700} letterSpacing={6}>
        STUDIO EDITION · 360° TURNTABLE
      </text>

      {/* DARK ROTATING TURNTABLE DISC */}
      <g transform="translate(540, 965)">
        {/* Contact shadow */}
        <ellipse cx={0} cy={38} rx={365} ry={78} fill="#000000" opacity={0.72} />
        {/* Disc side cylinder bevel */}
        <path d="M -345 0 L -345 26 A 345 64 0 0 0 345 26 L 345 0 Z" fill="#0F131A" stroke="#475569" strokeWidth={1.5} />
        {/* Disc top surface */}
        <ellipse cx={0} cy={0} rx={345} ry={64} fill="url(#h10-disc)" stroke="#94A3B8" strokeWidth={2} />
        <ellipse cx={0} cy={-4} rx={300} ry={50} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={1.5} />
        {/* Rotating specular sheen on turntable rim */}
        <ellipse cx={sheenX} cy={-4} rx={82} ry={11} fill="#FFFFFF" opacity={0.34} />
        {/* Faint inverted floor reflection */}
        <ellipse cx={0} cy={10} rx={138} ry={24} fill="#000000" opacity={0.62} />
      </g>

      {/* HERO 3D STUDIO HARDWARE PRODUCT (Flagship Matte Obsidian + Brushed Titanium Cylinder) */}
      <g transform="translate(540, 725)">
        {/* Subtle left/right vertical studio rim highlights */}
        <rect x={-136} y={-230} width={272} height={440} rx={48} fill="url(#h10-body)" stroke="#94A3B8" strokeWidth={2.2} />
        {/* Top brushed-titanium bevel cap */}
        <ellipse cx={0} cy={-212} rx={124} ry={28} fill="url(#h10-chrome)" stroke="#F8FAFC" strokeWidth={1.5} />
        <ellipse cx={0} cy={-212} rx={76} ry={16} fill="#0F172A" stroke="#64748B" strokeWidth={1.5} />
        {/* Precision machined titanium mid-ring */}
        <rect x={-138} y={-68} width={276} height={36} fill="url(#h10-chrome)" />
        {/* Optical Precision Lens / Acoustic Dial */}
        <circle cx={rimShift * 0.4} cy={-122} r={44} fill="#07090E" stroke="#E2E8F0" strokeWidth={3.5} />
        <circle cx={rimShift * 0.4} cy={-122} r={28} fill="#1E293B" stroke="#38BDF8" strokeWidth={2} />
        <circle cx={rimShift * 0.4 - 10} cy={-132} r={7} fill="#FFFFFF" opacity={0.85} />
        {/* Micro-perforated lower acoustic mesh */}
        {Array.from({ length: 5 }, (_, row) =>
          Array.from({ length: 9 }, (_, col) => (
            <circle
              key={`${row}-${col}`}
              cx={-92 + col * 23}
              cy={18 + row * 28}
              r={4}
              fill="#090B10"
              stroke="rgba(148,163,184,0.32)"
              strokeWidth={1}
            />
          )),
        )}
        {/* Sharp dual edge specular lines */}
        <line x1={-126} y1={-190} x2={-126} y2={175} stroke="#FFFFFF" strokeWidth={3} opacity={0.62} />
        <line x1={126} y1={-190} x2={126} y2={175} stroke="#CBD5E1" strokeWidth={2.5} opacity={0.5} />
      </g>

      {/* 4 ALTERNATING CRISP HAIRLINE SPEC CALLOUTS (left/right) */}
      {/* Spec 1: Top-Left */}
      <g>
        <circle cx={406} cy={550} r={6} fill="#FFFFFF" />
        <line x1={406} y1={550} x2={106} y2={550} stroke="rgba(255,255,255,0.68)" strokeWidth={1.8} />
        <text x={106} y={536} fill="#FFFFFF" fontSize={36} fontFamily="sans-serif" fontWeight={800}>
          360°
        </text>
        <text x={106} y={578} fill="#94A3B8" fontSize={16} fontFamily="monospace" letterSpacing={2}>
          SPATIAL FIELD
        </text>
      </g>
      {/* Spec 2: Top-Right */}
      <g>
        <circle cx={674} cy={615} r={6} fill="#FFFFFF" />
        <line x1={674} y1={615} x2={974} y2={615} stroke="rgba(255,255,255,0.68)" strokeWidth={1.8} />
        <text x={974} y={601} textAnchor="end" fill="#FFFFFF" fontSize={36} fontFamily="sans-serif" fontWeight={800}>
          0.2 ms
        </text>
        <text x={974} y={643} textAnchor="end" fill="#94A3B8" fontSize={16} fontFamily="monospace" letterSpacing={2}>
          ZERO LATENCY
        </text>
      </g>
      {/* Spec 3: Bottom-Left */}
      <g>
        <circle cx={406} cy={785} r={6} fill="#FFFFFF" />
        <line x1={406} y1={785} x2={106} y2={785} stroke="rgba(255,255,255,0.68)" strokeWidth={1.8} />
        <text x={106} y={771} fill="#FFFFFF" fontSize={36} fontFamily="sans-serif" fontWeight={800}>
          48 dB
        </text>
        <text x={106} y={813} fill="#94A3B8" fontSize={16} fontFamily="monospace" letterSpacing={2}>
          SILENT CORE
        </text>
      </g>
      {/* Spec 4: Bottom-Right */}
      <g>
        <circle cx={674} cy={850} r={6} fill="#FFFFFF" />
        <line x1={674} y1={850} x2={974} y2={850} stroke="rgba(255,255,255,0.68)" strokeWidth={1.8} />
        <text x={974} y={836} textAnchor="end" fill="#FFFFFF" fontSize={36} fontFamily="sans-serif" fontWeight={800}>
          120 W
        </text>
        <text x={974} y={878} textAnchor="end" fill="#94A3B8" fontSize={16} fontFamily="monospace" letterSpacing={2}>
          PEAK OUTPUT
        </text>
      </g>
    </HeroStage>
  );
};

// ============================================================================
// LOOK-11 .. LOOK-23 (3D EXPLAINER, DATA METAPHORS & UI — FULL HERO STAGE)
// ============================================================================

/** look-11: Money Stack — clean light studio + big pallet piled high with crisp white-banded banknote stacks */
const SigLook11MoneyStack: SignatureComponent = ({ frame, width, height }) => {
  const layers = Math.min(8, 4 + Math.floor(frame / 10));
  const totalVal = Math.min(1000000, Math.round(easeOutCubic(clamp01(frame / 52)) * 1000000));
  const dropBounce = Math.sin(frame * 0.14) * 5;
  const cx = 540;
  const cy = 900;

  // Render a single pale grey-green banknote brick with crisp white paper strap band
  const renderBillBrick = (bx: number, by: number, bz: number, key: string) => {
    const dx = 134;
    const dy = 86;
    const dz = 34;
    const [b1x, b1y] = isoProject(bx + dx * 0.36, by, bz + dz, cx, cy);
    const [b2x, b2y] = isoProject(bx + dx * 0.64, by, bz + dz, cx, cy);
    const [b3x, b3y] = isoProject(bx + dx * 0.64, by + dy, bz + dz, cx, cy);
    const [b4x, b4y] = isoProject(bx + dx * 0.36, by + dy, bz + dz, cx, cy);
    const [s3x, s3y] = isoProject(bx + dx * 0.64, by + dy, bz, cx, cy);
    const [s4x, s4y] = isoProject(bx + dx * 0.36, by + dy, bz, cx, cy);

    return (
      <g key={key}>
        <IsoBox
          x={bx}
          y={by}
          z={bz}
          dx={dx}
          dy={dy}
          dz={dz}
          cx={cx}
          cy={cy}
          topColor="#C5DFC8"
          leftColor="#9BC4A2"
          rightColor="#7BA884"
          stroke="#5B8564"
          strokeWidth={1.2}
        />
        {/* Crisp white currency strap band wrapping top & front face */}
        <polygon points={`${b1x},${b1y} ${b2x},${b2y} ${b3x},${b3y} ${b4x},${b4y}`} fill="#FFFFFF" opacity={0.96} />
        <polygon points={`${b4x},${b4y} ${b3x},${b3y} ${s3x},${s3y} ${s4x},${s4y}`} fill="#E2E8F0" opacity={0.96} />
      </g>
    );
  };

  return (
    <HeroStage
      id="look11"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.45)"
      defs={
        <linearGradient id="h11-studio" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F3F5F7" />
          <stop offset="68%" stopColor="#E6EAEE" />
          <stop offset="100%" stopColor="#D8DEE6" />
        </linearGradient>
      }
    >
      {/* Clean cool light-grey seamless studio */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h11-studio)" />

      {/* Soft grounded studio shadow under pallet */}
      <IsoShadow x={-172} y={-148} dx={344} dy={296} cx={cx} cy={cy + 26} opacity={0.22} />

      {/* Low Dark-Slate Shipping Pallet */}
      <IsoBox x={-172} y={-148} z={0} dx={344} dy={296} dz={26} cx={cx} cy={cy} topColor="#475569" leftColor="#334155" rightColor="#1E293B" stroke="#0F172A" strokeWidth={1.2} />
      {/* Pallet base runner blocks */}
      <IsoBox x={-172} y={-148} z={-16} dx={62} dy={296} dz={16} cx={cx} cy={cy} topColor="#334155" leftColor="#1E293B" rightColor="#0F172A" />
      <IsoBox x={110} y={-148} z={-16} dx={62} dy={296} dz={16} cx={cx} cy={cy} topColor="#334155" leftColor="#1E293B" rightColor="#0F172A" />

      {/* MASSIVE TOWER OF CASH BRICKS (2x3 grid per layer x 9 layers!) */}
      {Array.from({ length: layers }, (_, layerIdx) => {
        const z = 26 + layerIdx * 37;
        const isTop = layerIdx === layers - 1;
        // Back-to-front painter's order (increasing x + y)
        const slots: Array<[number, number]> = [
          [-148, -134],
          [10, -134],
          [-148, -36],
          [10, -36],
          [-148, 62],
          [10, 62],
        ];
        return (
          <g key={layerIdx}>
            {slots.map(([sx, sy], sIdx) => {
              const extraZ = isTop && sIdx === 5 ? Math.max(0, 16 + dropBounce) : 0;
              return renderBillBrick(sx, sy, z + extraZ, `b-${layerIdx}-${sIdx}`);
            })}
          </g>
        );
      })}

      {/* Crisp Studio Counter Directly Underneath Pallet */}
      <text x={540} y={1132} textAnchor="middle" fill="#64748B" fontSize={19} fontFamily="monospace" fontWeight={700} letterSpacing={4}>
        CASH STACK VALUE
      </text>
      <text x={540} y={1192} textAnchor="middle" fill="#059669" fontSize={58} fontFamily="sans-serif" fontWeight={900} letterSpacing={-1}>
        ${totalVal.toLocaleString('en-US')}
      </text>
    </HeroStage>
  );
};

/** look-12: Card Flip — pale grey studio wall, huge 3D satin-black metal membership card + 3 popping perk ticks */
const SigLook12CardFlip: SignatureComponent = ({ frame, width, height }) => {
  const sheen = ((frame * 11) % 860) - 240;
  const tilt = Math.sin(frame * 0.045) * 4;
  const perks = [
    'Unlimited 4K Motion Exports',
    'Priority Render Queue & Presets',
    'Full Commercial License Included',
  ];

  return (
    <HeroStage
      id="look12"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.42)"
      defs={
        <>
          <linearGradient id="h12-wall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EEF0F3" />
            <stop offset="100%" stopColor="#DDE2E8" />
          </linearGradient>
          <linearGradient id="h12-card" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#262A34" />
            <stop offset="48%" stopColor="#101319" />
            <stop offset="100%" stopColor="#1D222D" />
          </linearGradient>
          <linearGradient id="h12-edge" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#64748B" />
            <stop offset="50%" stopColor="#F8FAFC" />
            <stop offset="100%" stopColor="#475569" />
          </linearGradient>
          <clipPath id="h12-card-clip">
            <rect x={-340} y={-205} width={680} height={410} rx={30} />
          </clipPath>
        </>
      }
    >
      {/* Clean pale grey studio wall */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h12-wall)" />

      {/* HUGE FLOATING BLACK METAL MEMBERSHIP CARD WITH 3D THICKNESS EDGE */}
      <g transform={`translate(540, 565) rotate(${(-5 + tilt * 0.35).toFixed(2)})`}>
        {/* Soft grounded shadow cast on wall behind card */}
        <rect x={-322} y={-168} width={668} height={408} rx={34} fill="rgba(15, 23, 42, 0.22)" />
        {/* 3D Machined Silver-Graphite Edge Thickness */}
        <rect x={-334} y={-194} width={680} height={410} rx={30} fill="url(#h12-edge)" />
        {/* Card Front/Back Satin Black Metal Face */}
        <rect x={-340} y={-205} width={680} height={410} rx={30} fill="url(#h12-card)" stroke="#94A3B8" strokeWidth={2.5} />

        {/* Sweeping Studio Specular Highlight Ribbon */}
        <g clipPath="url(#h12-card-clip)">
          <polygon
            points={`${sheen - 260},-240 ${sheen - 150},-240 ${sheen - 310},240 ${sheen - 420},240`}
            fill="#FFFFFF"
            opacity={0.14}
          />
          <polygon
            points={`${sheen - 120},-240 ${sheen - 92},-240 ${sheen - 252},240 ${sheen - 280},240`}
            fill="#FFFFFF"
            opacity={0.22}
          />
        </g>

        {/* Crisp Brand Mark + Geometric Emblem in Electric Cyan (NO gold per catalog avoid) */}
        <g transform="translate(-282, -148)">
          <rect x={0} y={0} width={54} height={54} rx={14} fill="#0EA5E9" />
          <polygon points="27,10 42,27 27,44 12,27" fill="#FFFFFF" />
          <text x={72} y={36} fill="#E2E8F0" fontSize={24} fontFamily="monospace" fontWeight={700} letterSpacing={4}>
            STUDIO BLACK
          </text>
        </g>
        {/* Brushed silver contactless waves top-right */}
        <g transform="translate(274, -120)" stroke="#94A3B8" strokeWidth={3} fill="none" strokeLinecap="round">
          <path d="M -8 -14 A 18 18 0 0 1 -8 14" />
          <path d="M 4 -22 A 28 28 0 0 1 4 22" />
          <path d="M 16 -30 A 38 38 0 0 1 16 30" />
        </g>

        {/* HUGE Tier Title & Price on Satin Card */}
        <text x={-282} y={42} fill="#FFFFFF" fontSize={68} fontFamily="sans-serif" fontWeight={900} letterSpacing={2}>
          PRO TIER
        </text>
        <text x={-282} y={108} fill="#38BDF8" fontSize={36} fontFamily="monospace" fontWeight={800}>
          $99 / MONTH
        </text>
        <text x={286} y={148} textAnchor="end" fill="#94A3B8" fontSize={20} fontFamily="monospace" letterSpacing={3}>
          MEMBER · 004821
        </text>
      </g>

      {/* 3 CRISP PERK ROWS WITH POPPING CHECKMARK CIRCLES UNDERNEATH */}
      <g transform="translate(155, 868)">
        {perks.map((label, idx) => {
          const p = easeOutCubic(clamp01((frame - 16 - idx * 8) / 16));
          const y = idx * 102;
          return (
            <g key={idx} transform={`translate(0, ${(y + (1 - p) * 20).toFixed(1)})`} opacity={0.25 + 0.75 * p}>
              <rect x={0} y={0} width={770} height={82} rx={20} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={2} />
              <circle cx={48} cy={41} r={22} fill="#0EA5E9" />
              <path d="M 38 41 L 45 48 L 59 33" fill="none" stroke="#FFFFFF" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
              <text x={92} y={50} fill="#0F172A" fontSize={28} fontFamily="sans-serif" fontWeight={700}>
                {label}
              </text>
            </g>
          );
        })}
      </g>
    </HeroStage>
  );
};

/** look-13: Receipt — dark midnight-blue studio, sleek charcoal POS printer + long serrated thermal receipt */
const SigLook13Receipt: SignatureComponent = ({ frame, width, height }) => {
  const feed = 520 + easeOutCubic(clamp01(frame / 44)) * 215; // ~735px tall at frame 60!
  const rx = 310;
  const rw = 460;
  const ry = 420;
  const teeth = 23;
  const toothW = rw / teeth;

  let zig = `M ${rx} ${ry} L ${rx + rw} ${ry} L ${rx + rw} ${ry + feed}`;
  for (let i = teeth; i >= 1; i--) {
    const tx = rx + i * toothW;
    zig += ` L ${tx - toothW * 0.5} ${ry + feed - 13} L ${tx - toothW} ${ry + feed}`;
  }
  zig += ' Z';

  const items = [
    { name: '01  MOTION ENGINE', price: '1,200.00' },
    { name: '02  STYLE PRESETS', price: '2,450.00' },
    { name: '03  VOICEOVER MIX', price: '  890.00' },
    { name: '04  4K MASTERING ', price: '1,460.00' },
  ];

  return (
    <HeroStage
      id="look13"
      width={width}
      height={height}
      borderColor="rgba(56,189,248,0.36)"
      defs={
        <>
          <radialGradient id="h13-studio" cx="50%" cy="22%" r="72%">
            <stop offset="0%" stopColor="#172540" />
            <stop offset="55%" stopColor="#0C1322" />
            <stop offset="100%" stopColor="#06090F" />
          </radialGradient>
          <linearGradient id="h13-paper" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#DCE3EC" />
            <stop offset="8%" stopColor="#FFFFFF" />
            <stop offset="88%" stopColor="#F8FAFC" />
            <stop offset="100%" stopColor="#E8EEF5" />
          </linearGradient>
        </>
      }
    >
      {/* Dark midnight-blue studio lit by soft overhead key light */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h13-studio)" />

      {/* SLEEK CHARCOAL THERMAL POS PRINTER AT TOP */}
      <g transform="translate(540, 365)">
        {/* Printer shadow */}
        <ellipse cx={0} cy={78} rx={340} ry={28} fill="#000000" opacity={0.55} />
        {/* Charcoal Printer Housing */}
        <rect x={-325} y={-78} width={650} height={152} rx={26} fill="#1E2430" stroke="#475569" strokeWidth={2.5} />
        {/* Black Glass Top Panel */}
        <rect x={-295} y={-62} width={590} height={74} rx={16} fill="#090D16" stroke="#334155" strokeWidth={1.5} />
        {/* Specular glass reflection streak */}
        <line x1={-255} y1={-46} x2={120} y2={-46} stroke="rgba(255,255,255,0.18)" strokeWidth={6} strokeLinecap="round" />
        {/* Status LEDs */}
        <circle cx={255} cy={-26} r={7} fill="#22C55E" />
        <circle cx={228} cy={-26} r={6} fill="#38BDF8" opacity={0.75} />
        <text x={-268} y={-18} fill="#94A3B8" fontSize={18} fontFamily="monospace" fontWeight={700} letterSpacing={3}>
          THERMAL POS · 80MM
        </text>
        {/* Recessed dark paper feed slot */}
        <rect x={-255} y={38} width={510} height={24} rx={12} fill="#020617" stroke="#334155" strokeWidth={2} />
      </g>

      {/* LONG BRIGHT-WHITE SERRATED THERMAL PAPER RECEIPT FEEDING OUT */}
      {/* Cast paper shadow */}
      <rect x={rx + 14} y={ry + 10} width={rw} height={feed - 10} fill="rgba(0,0,0,0.45)" />
      {/* Serrated paper sheet */}
      <path d={zig} fill="url(#h13-paper)" stroke="#CBD5E1" strokeWidth={1.8} />
      {/* Subtle curl shadow directly under slot */}
      <rect x={rx} y={ry} width={rw} height={22} fill="rgba(15,23,42,0.16)" />

      {/* Crisp Monospace Receipt Contents */}
      <text x={540} y={ry + 68} textAnchor="middle" fill="#0F172A" fontSize={30} fontFamily="monospace" fontWeight={900} letterSpacing={3}>
        STUDIO RECEIPT
      </text>
      <text x={540} y={ry + 100} textAnchor="middle" fill="#64748B" fontSize={18} fontFamily="monospace">
        ORDER #0482 · 23 NOV · 09:41
      </text>
      <line x1={rx + 28} y1={ry + 124} x2={rx + rw - 28} y2={ry + 124} stroke="#94A3B8" strokeWidth={2.5} strokeDasharray="8 6" />

      {items.map((it, idx) => {
        const iy = ry + 178 + idx * 66;
        return (
          <g key={it.name}>
            <text x={rx + 32} y={iy} fill="#1E293B" fontSize={22} fontFamily="monospace" fontWeight={700}>
              {it.name}
            </text>
            <text x={rx + rw - 32} y={iy} textAnchor="end" fill="#0F172A" fontSize={22} fontFamily="monospace" fontWeight={800}>
              {it.price}
            </text>
          </g>
        );
      })}

      {/* Double Rule */}
      <line x1={rx + 28} y1={ry + 432} x2={rx + rw - 28} y2={ry + 432} stroke="#0F172A" strokeWidth={2.5} />
      <line x1={rx + 28} y1={ry + 442} x2={rx + rw - 28} y2={ry + 442} stroke="#0F172A" strokeWidth={2.5} />

      {/* BIG BOLD TOTAL */}
      <text x={rx + 32} y={ry + 506} fill="#0F172A" fontSize={34} fontFamily="monospace" fontWeight={900}>
        TOTAL
      </text>
      <text x={rx + rw - 32} y={ry + 506} textAnchor="end" fill="#0284C7" fontSize={40} fontFamily="monospace" fontWeight={900}>
        ฿6,000.00
      </text>
      <line x1={rx + 28} y1={ry + 536} x2={rx + rw - 28} y2={ry + 536} stroke="#94A3B8" strokeWidth={2} strokeDasharray="8 6" />

      {/* Realistic crisp Barcode */}
      <g transform={`translate(${rx + 56}, ${ry + 564})`}>
        {Array.from({ length: 34 }, (_, i) => {
          const bw = hashSeed(i * 11 + 5) > 0.55 ? 6 : 2.8;
          return <rect key={i} x={i * 10.2} y={0} width={bw} height={74} fill="#0F172A" />;
        })}
        <text x={174} y={98} textAnchor="middle" fill="#64748B" fontSize={16} fontFamily="monospace" letterSpacing={5}>
          8 850123 004829
        </text>
      </g>
    </HeroStage>
  );
};

/** look-14: Iceberg — full-stage over-under waterline split, faceted low-poly tip above & huge deep glacial mass below */
const SigLook14Iceberg: SignatureComponent = ({ frame, width, height }) => {
  const wave = Math.sin(frame * 0.06) * 8;
  const waterY = 532;

  return (
    <HeroStage
      id="look14"
      width={width}
      height={height}
      borderColor="rgba(125,211,252,0.52)"
      defs={
        <>
          <linearGradient id="h14-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EFF8FE" />
            <stop offset="100%" stopColor="#CBE7F8" />
          </linearGradient>
          <linearGradient id="h14-ocean" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#26A9DB" />
            <stop offset="32%" stopColor="#0C6EA8" />
            <stop offset="72%" stopColor="#074173" />
            <stop offset="100%" stopColor="#041F3D" />
          </linearGradient>
        </>
      }
    >
      {/* ABOVE WATER: Crisp Pale Arctic Sky */}
      <rect x={28} y={260} width={1024} height={waterY - 260} fill="url(#h14-sky)" />

      {/* BELOW WATER: Luminous Aqua to Deep Abyssal Cobalt Sea */}
      <rect x={28} y={waterY} width={1024} height={1216 - waterY} fill="url(#h14-ocean)" />

      {/* Subtle diagonal underwater sunlight shafts */}
      <g opacity={0.14}>
        <polygon points="180,532 340,532 240,1216 40,1216" fill="#BAE6FD" />
        <polygon points="560,532 740,532 610,1216 430,1216" fill="#7DD3FC" />
        <polygon points="840,532 970,532 880,1216 740,1216" fill="#38BDF8" />
      </g>

      {/* ABOVE-WATER FACETED LOW-POLY SNOW TIP (intentionally small ~18% visible) */}
      <g>
        <polygon points="348,534 495,335 552,534" fill="#FFFFFF" />
        <polygon points="495,335 612,418 552,534" fill="#DFF2FD" />
        <polygon points="612,418 698,534 552,534" fill="#B6E1F8" />
        <polygon points="348,534 422,425 495,335" fill="#F8FCFF" />
      </g>

      {/* MASSIVE UNDERWATER LOW-POLY GLACIAL ICEBERG (brighter than surrounding sea, faceted depth!) */}
      <g>
        {/* Upper submerged shelf */}
        <polygon points="348,534 552,534 468,742 225,685" fill="#A5E3FA" />
        <polygon points="552,534 698,534 832,715 590,775" fill="#7DD3FC" />
        <polygon points="552,534 590,775 468,742" fill="#BAE6FD" />
        {/* Mid colossal faceted core */}
        <polygon points="225,685 468,742 395,975 182,885" fill="#5AC5F5" />
        <polygon points="468,742 590,775 568,1015 395,975" fill="#7DD3FC" />
        <polygon points="590,775 832,715 865,910 568,1015" fill="#38BDF8" />
        {/* Deep abyssal keel */}
        <polygon points="182,885 395,975 478,1185 315,1095" fill="#2098D4" />
        <polygon points="395,975 568,1015 478,1185" fill="#38BDF8" />
        <polygon points="568,1015 865,910 685,1125 478,1185" fill="#0E77B5" />
        {/* Facet ridge highlights */}
        <polyline points="495,335 552,534 590,775 568,1015 478,1185" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={2.2} />
      </g>

      {/* Crisp Animated White Waterline Surface */}
      <path
        d={`M 28 ${waterY + wave} Q 284 ${waterY - 14 - wave} 540 ${waterY + wave} T 1052 ${waterY + wave}`}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={6}
      />
      <path
        d={`M 28 ${waterY + 12 + wave} Q 284 ${waterY - 2 - wave} 540 ${waterY + 12 + wave} T 1052 ${waterY + 12 + wave}`}
        fill="none"
        stroke="#BAE6FD"
        strokeWidth={2.5}
        opacity={0.75}
      />

      {/* Horizontal Dashed Depth Slice Lines + Crisp White Pill Labels */}
      {[
        { y: 405, x: 740, label: 'VISIBLE 10%', dark: true },
        { y: 715, x: 740, label: 'LAYER 01 · SYSTEMS', dark: false },
        { y: 925, x: 740, label: 'LAYER 02 · STRATEGY', dark: false },
        { y: 1110, x: 740, label: 'LAYER 03 · ROOT CAUSE', dark: false },
      ].map((row, i) => (
        <g key={row.label}>
          {i > 0 && (
            <line
              x1={78}
              y1={row.y}
              x2={680}
              y2={row.y}
              stroke="rgba(224,242,254,0.42)"
              strokeWidth={2}
              strokeDasharray="10 10"
            />
          )}
          <rect
            x={row.x - 10}
            y={row.y - 24}
            width={284}
            height={48}
            rx={24}
            fill={row.dark ? '#0F172A' : '#FFFFFF'}
            opacity={0.95}
          />
          <text
            x={row.x + 132}
            y={row.y + 7}
            textAnchor="middle"
            fill={row.dark ? '#FFFFFF' : '#0C4A6E'}
            fontSize={20}
            fontFamily="monospace"
            fontWeight={800}
          >
            {row.label}
          </text>
        </g>
      ))}
    </HeroStage>
  );
};

/** look-15: Text Thread — receding pale blue-grey grid floor + floating 3D chat bubbles with soft shadows (no phone frame) */
const SigLook15TextThread: SignatureComponent = ({ frame, width, height }) => {
  const dotIdx = Math.floor(frame / 10) % 3;

  return (
    <HeroStage
      id="look15"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.45)"
      defs={
        <linearGradient id="h15-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F8FAFC" />
          <stop offset="32%" stopColor="#EDF1F7" />
          <stop offset="100%" stopColor="#D7E0EC" />
        </linearGradient>
      }
    >
      {/* Pale blue-grey receding perspective grid floor (no phone frame!) */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h15-floor)" />
      {/* Receding perspective vertical grid lines */}
      {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((i) => (
        <line
          key={`p-${i}`}
          x1={540 + i * 68}
          y1={260}
          x2={540 + i * 168}
          y2={1216}
          stroke="#CBD5E1"
          strokeWidth={1.6}
          opacity={0.78}
        />
      ))}
      {/* Horizontal perspective grid lines */}
      {[320, 395, 485, 590, 710, 845, 995, 1160].map((y, idx) => (
        <line key={`h-${y}`} x1={28} y1={y} x2={1052} y2={y} stroke="#CBD5E1" strokeWidth={1.4 + idx * 0.15} opacity={0.45 + idx * 0.07} />
      ))}

      {/* FLOATING 3D CHAT MESSAGE BUBBLES WITH SOFT FLOOR SHADOWS */}
      {/* Bubble 1 (oldest, furthest, incoming left white) */}
      <g transform="translate(120, 330)">
        <rect x={14} y={24} width={480} height={88} rx={30} fill="rgba(15,23,42,0.12)" />
        <rect x={0} y={0} width={480} height={88} rx={30} fill="#FFFFFF" stroke="#E2E8F0" strokeWidth={2} />
        <polygon points="8,76 -16,92 34,86" fill="#FFFFFF" />
        <text x={34} y={54} fill="#1E293B" fontSize={29} fontFamily={THAI_FONT_FAMILY} fontWeight={700}>
          ข้อมูลชุดใหม่พร้อมแล้วหรือยัง?
        </text>
      </g>

      {/* Bubble 2 (outgoing right vibrant blue) */}
      <g transform="translate(465, 472)">
        <rect x={14} y={24} width={495} height={92} rx={30} fill="rgba(37,99,235,0.22)" />
        <rect x={0} y={0} width={495} height={92} rx={30} fill="#2563EB" />
        <polygon points="487,78 512,94 460,88" fill="#2563EB" />
        <text x={34} y={56} fill="#FFFFFF" fontSize={30} fontFamily={THAI_FONT_FAMILY} fontWeight={700}>
          พร้อมแล้วครับ ตัวเลขพุ่งเกินเป้า!
        </text>
      </g>

      {/* Bubble 3 (incoming left white) */}
      <g transform="translate(96, 622)">
        <rect x={16} y={26} width={520} height={96} rx={32} fill="rgba(15,23,42,0.13)" />
        <rect x={0} y={0} width={520} height={96} rx={32} fill="#FFFFFF" stroke="#E2E8F0" strokeWidth={2} />
        <polygon points="8,82 -18,98 36,92" fill="#FFFFFF" />
        <text x={36} y={59} fill="#1E293B" fontSize={31} fontFamily={THAI_FONT_FAMILY} fontWeight={700}>
          สรุปตัวเลขสำคัญให้ดูหน่อยได้ไหม
        </text>
      </g>

      {/* Bubble 4: HERO OVERSIZED KEY MESSAGE (closest, boldest!) */}
      <g transform="translate(275, 782)">
        <rect x={18} y={32} width={705} height={148} rx={38} fill="rgba(37,99,235,0.26)" />
        <rect x={0} y={0} width={705} height={148} rx={38} fill="#1D4ED8" stroke="#60A5FA" strokeWidth={2.5} />
        <polygon points="695,126 725,148 662,140" fill="#1D4ED8" />
        <text x={44} y={66} fill="#BFDBFE" fontSize={22} fontFamily="monospace" fontWeight={700} letterSpacing={2}>
          KEY INSIGHT · LIVE
        </text>
        <text x={44} y={116} fill="#FFFFFF" fontSize={40} fontFamily={THAI_FONT_FAMILY} fontWeight={800}>
          เติบโต +340% ภายใน 30 วัน!
        </text>
      </g>

      {/* Read receipt stamp */}
      <text x={968} y={968} textAnchor="end" fill="#64748B" fontSize={22} fontFamily="monospace" fontWeight={700}>
        Read · 09:41
      </text>

      {/* Animated "..." Typing Indicator Pill floating bottom-left */}
      <g transform="translate(104, 1020)">
        <rect x={12} y={22} width={196} height={84} rx={42} fill="rgba(15,23,42,0.12)" />
        <rect x={0} y={0} width={196} height={84} rx={42} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={2} />
        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            cx={56 + i * 42}
            cy={42 + (i === dotIdx ? -7 : 0)}
            r={i === dotIdx ? 12 : 9}
            fill={i === dotIdx ? '#2563EB' : '#94A3B8'}
          />
        ))}
      </g>
    </HeroStage>
  );
};

/** look-16: Scale Lineup — matte white clay size comparison row on pale grey studio with uniform black baseline labels */
const SigLook16ScaleLineup: SignatureComponent = ({ frame, width, height }) => {
  const rise = easeOutCubic(clamp01(frame / 42));
  const baseY = 1042;

  return (
    <HeroStage
      id="look16"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.45)"
      defs={
        <linearGradient id="h16-studio" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F1F2F4" />
          <stop offset="76%" stopColor="#E4E7EC" />
          <stop offset="100%" stopColor="#D3D8DF" />
        </linearGradient>
      }
    >
      {/* Clean pale grey matte architectural studio */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h16-studio)" />

      {/* Subtle architectural elevation guide lines */}
      {[
        { y: 940, lbl: '10m' },
        { y: 785, lbl: '50m' },
        { y: 580, lbl: '150m' },
        { y: 370, lbl: '320m' },
      ].map((g) => (
        <g key={g.lbl}>
          <line x1={108} y1={g.y} x2={1016} y2={g.y} stroke="#CBD5E1" strokeWidth={1.5} strokeDasharray="6 8" />
          <text x={52} y={g.y + 6} fill="#64748B" fontSize={16} fontFamily="monospace" fontWeight={700}>
            {g.lbl}
          </text>
        </g>
      ))}

      {/* Crisp Floor Horizon Line */}
      <line x1={52} y1={baseY} x2={1028} y2={baseY} stroke="#94A3B8" strokeWidth={2.5} />

      {/* 1. TINY DARK-CLAY HUMAN (so it stays crisp when tiny!) — 1.7m */}
      <g transform={`translate(140, ${baseY})`}>
        <ellipse cx={0} cy={4} rx={24} ry={7} fill="rgba(15,23,42,0.22)" />
        <g transform={`scale(1, ${(0.4 + 0.6 * rise).toFixed(3)})`}>
          <circle cx={0} cy={-56} r={10} fill="#334155" />
          <rect x={-9} y={-44} width={18} height={24} rx={6} fill="#334155" />
          <rect x={-8} y={-20} width={6} height={20} rx={2} fill="#1E293B" />
          <rect x={2} y={-20} width={6} height={20} rx={2} fill="#1E293B" />
        </g>
        <text x={0} y={44} textAnchor="middle" fill="#0F172A" fontSize={21} fontFamily="sans-serif" fontWeight={800}>HUMAN</text>
        <text x={0} y={74} textAnchor="middle" fill="#64748B" fontSize={19} fontFamily="monospace" fontWeight={700}>1.7 m</text>
      </g>

      {/* 2. MATTE WHITE CLAY HOUSE — 6m */}
      <g transform={`translate(285, ${baseY})`}>
        <ellipse cx={6} cy={5} rx={58} ry={11} fill="rgba(15,23,42,0.18)" />
        <g transform={`scale(1, ${(0.4 + 0.6 * rise).toFixed(3)})`}>
          <rect x={-46} y={-88} width={62} height={88} fill="#FFFFFF" />
          <rect x={16} y={-88} width={34} height={88} fill="#CBD5E1" />
          <polygon points="-54,-88 -15,-138 24,-88" fill="#F8FAFC" />
          <polygon points="-15,-138 24,-88 54,-88 18,-138" fill="#B8C3D0" />
        </g>
        <text x={0} y={44} textAnchor="middle" fill="#0F172A" fontSize={21} fontFamily="sans-serif" fontWeight={800}>HOUSE</text>
        <text x={0} y={74} textAnchor="middle" fill="#64748B" fontSize={19} fontFamily="monospace" fontWeight={700}>6 m</text>
      </g>

      {/* 3. MATTE WHITE CLAY MONUMENT / WIND TOWER — 45m */}
      <g transform={`translate(462, ${baseY})`}>
        <ellipse cx={8} cy={6} rx={68} ry={13} fill="rgba(15,23,42,0.18)" />
        <g transform={`scale(1, ${(0.35 + 0.65 * rise).toFixed(3)})`}>
          <polygon points="-54,0 -24,-245 0,-295 0,0" fill="#FFFFFF" />
          <polygon points="0,-295 24,-245 54,0 0,0" fill="#C4CDD8" />
          <rect x={-64} y={-24} width={64} height={24} fill="#F8FAFC" />
          <rect x={0} y={-24} width={64} height={24} fill="#B4BFC9" />
        </g>
        <text x={0} y={44} textAnchor="middle" fill="#0F172A" fontSize={21} fontFamily="sans-serif" fontWeight={800}>STATUE</text>
        <text x={0} y={74} textAnchor="middle" fill="#64748B" fontSize={19} fontFamily="monospace" fontWeight={700}>45 m</text>
      </g>

      {/* 4. MATTE WHITE CLAY ROCKET / TOWER — 120m */}
      <g transform={`translate(665, ${baseY})`}>
        <ellipse cx={12} cy={7} rx={78} ry={15} fill="rgba(15,23,42,0.18)" />
        <g transform={`scale(1, ${(0.3 + 0.7 * rise).toFixed(3)})`}>
          <path d="M -42 0 L -42 -360 Q -42 -435 0 -468 L 0 0 Z" fill="#FFFFFF" />
          <path d="M 0 -468 Q 42 -435 42 -360 L 42 0 L 0 0 Z" fill="#C2CBD6" />
          {/* Clay fins */}
          <polygon points="-42,-90 -72,0 -42,0" fill="#E2E8F0" />
          <polygon points="42,-90 72,0 42,0" fill="#94A3B8" />
        </g>
        <text x={0} y={44} textAnchor="middle" fill="#0F172A" fontSize={21} fontFamily="sans-serif" fontWeight={800}>ROCKET</text>
        <text x={0} y={74} textAnchor="middle" fill="#64748B" fontSize={19} fontFamily="monospace" fontWeight={700}>120 m</text>
      </g>

      {/* 5. MONUMENTAL MATTE WHITE CLAY SKYSCRAPER — 320m */}
      <g transform={`translate(888, ${baseY})`}>
        <ellipse cx={14} cy={8} rx={98} ry={17} fill="rgba(15,23,42,0.22)" />
        <g transform={`scale(1, ${(0.25 + 0.75 * rise).toFixed(3)})`}>
          {/* Stepped matte clay skyscraper (bright left front, grey shaded right side) */}
          <rect x={-74} y={-490} width={74} height={490} fill="#FFFFFF" />
          <rect x={0} y={-490} width={74} height={490} fill="#C2CBD6" />
          <rect x={-52} y={-585} width={52} height={95} fill="#FFFFFF" />
          <rect x={0} y={-585} width={52} height={95} fill="#B8C3D0" />
          <polygon points="-24,-585 0,-672 0,-585" fill="#F8FAFC" />
          <polygon points="0,-672 24,-585 0,-585" fill="#94A3B8" />
          {/* Spire needle */}
          <line x1={0} y1={-672} x2={0} y2={-735} stroke="#64748B" strokeWidth={5} strokeLinecap="round" />
        </g>
        <text x={0} y={44} textAnchor="middle" fill="#0F172A" fontSize={21} fontFamily="sans-serif" fontWeight={800}>TOWER</text>
        <text x={0} y={74} textAnchor="middle" fill="#0284C7" fontSize={19} fontFamily="monospace" fontWeight={800}>320 m</text>
      </g>
    </HeroStage>
  );
};

/** look-17: Milestone Trophy — deep emerald studio, obsidian stone plinth, polished silver award plaque + chrome odometer */
const SigLook17Trophy: SignatureComponent = ({ frame, width, height }) => {
  const sweep = ((frame * 10) % 720) - 200;
  const countVal = Math.min(100000, Math.round(easeOutCubic(clamp01(frame / 48)) * 100000));
  const digits = String(countVal).padStart(6, '0').split('');

  return (
    <HeroStage
      id="look17"
      width={width}
      height={height}
      borderColor="rgba(52,211,153,0.42)"
      defs={
        <>
          <radialGradient id="h17-green-studio" cx="50%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#1A5442" />
            <stop offset="58%" stopColor="#0E3026" />
            <stop offset="100%" stopColor="#061611" />
          </radialGradient>
          <linearGradient id="h17-silver" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F8FAFC" />
            <stop offset="28%" stopColor="#94A3B8" />
            <stop offset="56%" stopColor="#FFFFFF" />
            <stop offset="82%" stopColor="#64748B" />
            <stop offset="100%" stopColor="#E2E8F0" />
          </linearGradient>
          <linearGradient id="h17-wheel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1E293B" />
            <stop offset="25%" stopColor="#0F172A" />
            <stop offset="50%" stopColor="#1E293B" />
            <stop offset="75%" stopColor="#0F172A" />
            <stop offset="100%" stopColor="#020617" />
          </linearGradient>
          <clipPath id="h17-plaque-clip">
            <rect x={240} y={322} width={600} height={665} rx={44} />
          </clipPath>
        </>
      }
    >
      {/* Deep emerald studio backdrop (NO confetti, NO gold per catalog avoid!) */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h17-green-studio)" />

      {/* Subtle studio floor horizon & cast shadow */}
      <ellipse cx={540} cy={1130} rx={420} ry={58} fill="#020A07" opacity={0.78} />

      {/* NEAR-BLACK OBSIDIAN STONE PLINTH */}
      <g transform="translate(540, 1020)">
        <polygon points="-320,0 320,0 360,128 -360,128" fill="#0B0F12" stroke="#1E293B" strokeWidth={2} />
        <polygon points="-320,0 320,0 295,-30 -295,-30" fill="#182328" stroke="#34D399" strokeWidth={1.5} strokeOpacity={0.45} />
      </g>

      {/* MONUMENTAL POLISHED SILVER AWARD PLAQUE */}
      {/* Metallic mirror outer frame */}
      <rect x={240} y={322} width={600} height={665} rx={44} fill="url(#h17-silver)" stroke="#FFFFFF" strokeWidth={3} />
      {/* Sweeping Studio Strip-Light Reflections across Polished Silver */}
      <g clipPath="url(#h17-plaque-clip)">
        <polygon
          points={`${240 + sweep},310 ${315 + sweep},310 ${155 + sweep},995 ${80 + sweep},995`}
          fill="#FFFFFF"
          opacity={0.34}
        />
        <polygon
          points={`${345 + sweep},310 ${372 + sweep},310 ${212 + sweep},995 ${185 + sweep},995`}
          fill="#FFFFFF"
          opacity={0.45}
        />
      </g>

      {/* Recessed Matte-Black Satin Inner Panel */}
      <rect x={278} y={362} width={524} height={585} rx={28} fill="#0B0E14" stroke="#64748B" strokeWidth={2.5} />

      {/* Crisp Chrome Crest / Trophy Emblem at Top */}
      <g transform="translate(540, 480)">
        <path d="M -58 -48 L 58 -48 L 38 26 L -38 26 Z" fill="url(#h17-silver)" stroke="#FFFFFF" strokeWidth={2} />
        <path d="M -56 -34 C -88 -32 -86 12 -44 14" fill="none" stroke="#CBD5E1" strokeWidth={7} strokeLinecap="round" />
        <path d="M 56 -34 C 88 -32 86 12 44 14" fill="none" stroke="#CBD5E1" strokeWidth={7} strokeLinecap="round" />
        <rect x={-14} y={26} width={28} height={34} fill="#94A3B8" />
        <rect x={-46} y={56} width={92} height={14} rx={4} fill="url(#h17-silver)" />
      </g>

      {/* Thin Chrome Horizontal Rules Framing Odometer Wheels */}
      <line x1={326} y1={594} x2={754} y2={594} stroke="#94A3B8" strokeWidth={2.2} />
      <line x1={326} y1={752} x2={754} y2={752} stroke="#94A3B8" strokeWidth={2.2} />

      {/* RAISED CHROME ODOMETER COUNTER WHEELS */}
      <g transform="translate(324, 622)">
        {digits.map((d, idx) => {
          const x = idx * 69 + (idx >= 3 ? 22 : 0);
          return (
            <React.Fragment key={idx}>
              {idx === 3 && (
                <text x={x - 15} y={88} fill="#CBD5E1" fontSize={44} fontFamily="monospace" fontWeight={900}>
                  ,
                </text>
              )}
              <rect x={x} y={0} width={58} height={102} rx={10} fill="url(#h17-wheel)" stroke="#64748B" strokeWidth={2} />
              <line x1={x + 4} y1={51} x2={x + 54} y2={51} stroke="rgba(255,255,255,0.12)" strokeWidth={1.5} />
              <text x={x + 29} y={74} textAnchor="middle" fill="#F8FAFC" fontSize={60} fontFamily="monospace" fontWeight={900}>
                {d}
              </text>
            </React.Fragment>
          );
        })}
      </g>

      {/* Tracked-Caps Silver Milestone Subtitle */}
      <text x={540} y={818} textAnchor="middle" fill="#E2E8F0" fontSize={26} fontFamily="monospace" fontWeight={700} letterSpacing={8}>
        MILESTONE
      </text>
      <text x={540} y={864} textAnchor="middle" fill="#34D399" fontSize={20} fontFamily="monospace" fontWeight={700} letterSpacing={5}>
        CREATOR AWARD · VERIFIED
      </text>
    </HeroStage>
  );
};

/** look-18: Donut Breakdown — crisp white studio, thick 6-slice donut with pulled-out emerald hero slice + legend rows */
const SigLook18Donut: SignatureComponent = ({ frame, width, height }) => {
  const sweep = easeOutCubic(clamp01(frame / 36));
  const pull = easeOutCubic(clamp01((frame - 22) / 18)) * 28;
  const cx = 540;
  const cy = 572;
  const R = 196;
  const strokeW = 72;
  const circ = 2 * Math.PI * R;

  const slices = [
    { name: 'Growth Core', pct: 34, color: '#10B981', hero: true },
    { name: 'Product R&D', pct: 20, color: '#64748B', hero: false },
    { name: 'Operations', pct: 16, color: '#3898A8', hero: false },
    { name: 'Marketing', pct: 13, color: '#86A891', hero: false },
    { name: 'Infra & Cloud', pct: 10, color: '#94A3B8', hero: false },
    { name: 'Reserve', pct: 7, color: '#C98A97', hero: false },
  ];

  let cumPct = 0;
  const totalDisplay = Math.round(100 * sweep);

  return (
    <HeroStage
      id="look18"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.38)"
      defs={
        <linearGradient id="h18-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#EBF0F5" />
        </linearGradient>
      }
    >
      {/* Clean Crisp White-to-Cool-Grey Studio Backdrop */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h18-bg)" />

      {/* Top Mini Context Header */}
      <text x={540} y={316} textAnchor="middle" fill="#64748B" fontSize={20} fontFamily="monospace" fontWeight={700} letterSpacing={4}>
        BUDGET ALLOCATION BREAKDOWN
      </text>

      {/* Empty Pale Ring Base */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#E2E8F0" strokeWidth={strokeW} />

      {/* 6 ANIMATED DONUT SLICES (Hero Emerald Slice Pulled 28px Outward with Soft Shadow!) */}
      {slices.map((s) => {
        const startPct = cumPct;
        cumPct += s.pct;
        const gap = 1.6;
        const visPct = Math.max(0.5, (s.pct - gap) * sweep);
        const dashLen = (visPct / 100) * circ;
        const startAngleDeg = -90 + (startPct / 100) * 360;
        const midAngleRad = ((-90 + ((startPct + s.pct * 0.5) / 100) * 360) * Math.PI) / 180;
        const ox = s.hero ? Math.cos(midAngleRad) * pull : 0;
        const oy = s.hero ? Math.sin(midAngleRad) * pull : 0;

        return (
          <g key={s.name} transform={`translate(${ox.toFixed(1)}, ${oy.toFixed(1)})`}>
            {s.hero && (
              <circle
                cx={cx + 6}
                cy={cy + 12}
                r={R}
                fill="none"
                stroke="rgba(16, 185, 129, 0.24)"
                strokeWidth={strokeW + 4}
                strokeLinecap="round"
                strokeDasharray={`${dashLen} ${circ}`}
                transform={`rotate(${startAngleDeg}, ${cx + 6}, ${cy + 12})`}
              />
            )}
            <circle
              cx={cx}
              cy={cy}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={s.hero ? strokeW + 4 : strokeW}
              strokeLinecap="round"
              strokeDasharray={`${dashLen} ${circ}`}
              opacity={s.hero ? 1 : 0.86}
              transform={`rotate(${startAngleDeg}, ${cx}, ${cy})`}
            />
          </g>
        );
      })}

      {/* Center Tabular Total inside Donut */}
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#0F172A" fontSize={74} fontFamily="sans-serif" fontWeight={900}>
        {totalDisplay}%
      </text>
      <text x={cx} y={cy + 52} textAnchor="middle" fill="#64748B" fontSize={20} fontFamily="monospace" fontWeight={700} letterSpacing={3}>
        TOTAL SHARE
      </text>

      {/* 2x3 COLOR-CODED LEGEND GRID UNDERNEATH (Hero Slice in Pale-Green Pill!) */}
      <g transform="translate(88, 868)">
        {slices.map((s, idx) => {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const x = col * 462;
          const y = row * 102;
          return (
            <g key={s.name} transform={`translate(${x}, ${y})`}>
              <rect
                x={0}
                y={0}
                width={442}
                height={82}
                rx={20}
                fill={s.hero ? '#DCFCE7' : '#FFFFFF'}
                stroke={s.hero ? '#10B981' : '#E2E8F0'}
                strokeWidth={s.hero ? 2.8 : 1.8}
              />
              <rect x={22} y={24} width={34} height={34} rx={9} fill={s.color} />
              <text x={74} y={50} fill={s.hero ? '#065F46' : '#334155'} fontSize={25} fontFamily="sans-serif" fontWeight={700}>
                {s.name}
              </text>
              <text x={418} y={52} textAnchor="end" fill={s.hero ? '#059669' : '#0F172A'} fontSize={30} fontFamily="monospace" fontWeight={900}>
                {s.pct}%
              </text>
            </g>
          );
        })}
      </g>
    </HeroStage>
  );
};

/** look-19: Globe Arcs — deep navy dotted-continent 3D globe + glowing orange flight arcs with landing ripple rings */
const SigLook19GlobeArcs: SignatureComponent = ({ frame, width, height }) => {
  const arcProg = easeOutCubic(clamp01(frame / 44));
  const routesCount = Math.min(48, Math.round(arcProg * 48));
  const ripple = (frame % 38) / 38;
  const gx = 540;
  const gy = 788;
  const R = 345;

  // Deterministic dotted continents on facing hemisphere (Asia, Europe, Africa, Australia clusters)
  const landClusters: Array<[number, number, number, number]> = [
    [0.24, -0.22, 0.34, 0.24], // Asia
    [-0.18, -0.34, 0.24, 0.16], // Europe
    [-0.12, 0.14, 0.24, 0.3], // Africa
    [0.44, 0.34, 0.2, 0.16], // Australia
    [-0.58, -0.18, 0.22, 0.28], // Americas edge
  ];
  const landDots: Array<{ x: number; y: number; r: number; op: number }> = [];
  for (let i = 0; i < 230; i++) {
    const c = landClusters[i % landClusters.length];
    const u = (hashSeed(i * 17 + 3) * 2 - 1) * c[2];
    const v = (hashSeed(i * 29 + 7) * 2 - 1) * c[3];
    if ((u * u) / (c[2] * c[2]) + (v * v) / (c[3] * c[3]) > 1) continue;
    const nx = c[0] + u + Math.sin(frame * 0.008) * 0.04;
    const ny = c[1] + v;
    const dist2 = nx * nx + ny * ny;
    if (dist2 < 0.86) {
      landDots.push({
        x: gx + nx * R,
        y: gy + ny * R,
        r: 2.6 + (1 - dist2) * 1.4,
        op: 0.45 + (1 - dist2) * 0.5,
      });
    }
  }

  // Hub (Bangkok/Asia) -> 5 global destinations
  const hub: [number, number] = [gx + 115, gy + 18];
  const arcs: Array<{ to: [number, number]; ctrl: [number, number]; city: string }> = [
    { to: [gx - 125, gy - 145], ctrl: [gx - 25, gy - 285], city: 'LON' },
    { to: [gx - 185, gy + 85], ctrl: [gx - 65, gy - 65], city: 'CPT' },
    { to: [gx + 225, gy - 115], ctrl: [gx + 210, gy - 210], city: 'TYO' },
    { to: [gx + 195, gy + 175], ctrl: [gx + 255, gy + 75], city: 'SYD' },
    { to: [gx - 245, gy - 55], ctrl: [gx - 95, gy - 220], city: 'NYC' },
  ];

  return (
    <HeroStage
      id="look19"
      width={width}
      height={height}
      borderColor="rgba(56,189,248,0.38)"
      defs={
        <>
          <linearGradient id="h19-space" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0E1830" />
            <stop offset="100%" stopColor="#05070C" />
          </linearGradient>
          <radialGradient id="h19-ocean" cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#16294E" />
            <stop offset="68%" stopColor="#0B162C" />
            <stop offset="100%" stopColor="#050914" />
          </radialGradient>
        </>
      }
    >
      {/* Deep navy space background */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h19-space)" />

      {/* Top Mono Metric Counter Above Globe */}
      <text x={540} y={322} textAnchor="middle" fill="#7DD3FC" fontSize={20} fontFamily="monospace" fontWeight={700} letterSpacing={5}>
        ACTIVE GLOBAL NETWORK
      </text>
      <text x={540} y={396} textAnchor="middle" fill="#FFFFFF" fontSize={64} fontFamily="sans-serif" fontWeight={900}>
        {routesCount} <tspan fill="#FB923C" fontSize={40}>ROUTES</tspan>
      </text>

      {/* MASSIVE DARK NAVY DATA GLOBE WITH THIN SOFT BLUE RIM */}
      <circle cx={gx} cy={gy} r={R} fill="url(#h19-ocean)" stroke="#38BDF8" strokeWidth={3} strokeOpacity={0.75} />

      {/* Faint Latitude & Longitude Curves */}
      {[-220, -110, 0, 110, 220].map((dy) => {
        const rx = Math.sqrt(Math.max(1, R * R - dy * dy));
        return (
          <ellipse key={dy} cx={gx} cy={gy + dy} rx={rx} ry={rx * 0.16} fill="none" stroke="rgba(56,189,248,0.16)" strokeWidth={1.2} />
        );
      })}
      {[85, 190, 285].map((rx) => (
        <ellipse key={rx} cx={gx} cy={gy} rx={rx} ry={R} fill="none" stroke="rgba(56,189,248,0.15)" strokeWidth={1.2} />
      ))}

      {/* Dotted Landmass Continents */}
      {landDots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#E2E8F0" opacity={d.op} />
      ))}

      {/* 5 GLOWING ORANGE CURVED FLIGHT/DATA ARCS + LANDING RINGS & PINS */}
      {arcs.map((a, idx) => {
        const d = `M ${hub[0]} ${hub[1]} Q ${a.ctrl[0]} ${a.ctrl[1]} ${a.to[0]} ${a.to[1]}`;
        return (
          <g key={a.city}>
            <path d={d} fill="none" stroke="#FF7A1A" strokeWidth={10} strokeLinecap="round" opacity={0.28} strokeDasharray="650" strokeDashoffset={650 * (1 - arcProg)} />
            <path d={d} fill="none" stroke="#FB923C" strokeWidth={4.5} strokeLinecap="round" strokeDasharray="650" strokeDashoffset={650 * (1 - arcProg)} />
            <path d={d} fill="none" stroke="#FEF08A" strokeWidth={1.8} strokeLinecap="round" strokeDasharray="24 44" strokeDashoffset={-(frame * 4 + idx * 18)} />
            {/* Thin landing ripple ring & crisp white pin */}
            <circle cx={a.to[0]} cy={a.to[1]} r={8 + ripple * 26} fill="none" stroke="#FFFFFF" strokeWidth={2} opacity={1 - ripple} />
            <circle cx={a.to[0]} cy={a.to[1]} r={7} fill="#FFFFFF" stroke="#FB923C" strokeWidth={3} />
            <text x={a.to[0]} y={a.to[1] - 16} textAnchor="middle" fill="#F8FAFC" fontSize={17} fontFamily="monospace" fontWeight={800}>
              {a.city}
            </text>
          </g>
        );
      })}

      {/* Origin Hub Beacon */}
      <circle cx={hub[0]} cy={hub[1]} r={16} fill="rgba(251,146,60,0.35)" />
      <circle cx={hub[0]} cy={hub[1]} r={9} fill="#FFFFFF" stroke="#FF7A1A" strokeWidth={3.5} />
    </HeroStage>
  );
};

/** look-20: Laptop Reveal — soft light-grey studio sweep, large sleek silver laptop with live landing page & clicking cursor */
const SigLook20Laptop: SignatureComponent = ({ frame, width, height }) => {
  const clickPhase = (frame % 50) / 50;
  const cursorX = 520 + Math.sin(frame * 0.04) * 16;
  const cursorY = 678 + Math.cos(frame * 0.04) * 8;
  const pressed = clickPhase > 0.35 && clickPhase < 0.55;

  return (
    <HeroStage
      id="look20"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.45)"
      defs={
        <>
          <linearGradient id="h20-studio" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F5F5F7" />
            <stop offset="72%" stopColor="#EAECEF" />
            <stop offset="100%" stopColor="#DCE0E6" />
          </linearGradient>
          <linearGradient id="h20-metal" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#CBD5E1" />
            <stop offset="18%" stopColor="#F8FAFC" />
            <stop offset="50%" stopColor="#DCE2EA" />
            <stop offset="84%" stopColor="#F8FAFC" />
            <stop offset="100%" stopColor="#94A3B8" />
          </linearGradient>
        </>
      }
    >
      {/* Clean soft light-grey Apple studio sweep */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h20-studio)" />

      {/* Soft grounded studio contact shadow */}
      <ellipse cx={540} cy={975} rx={445} ry={42} fill="rgba(15, 23, 42, 0.22)" />

      {/* MASSIVE SLEEK MODERN SILVER LAPTOP */}
      {/* Outer Brushed Aluminum Screen Lid */}
      <rect x={144} y={348} width={792} height={515} rx={28} fill="url(#h20-metal)" stroke="#94A3B8" strokeWidth={2.5} />
      {/* Black Glass Screen Bezel */}
      <rect x={156} y={360} width={768} height={492} rx={20} fill="#090D16" />
      {/* Tiny top camera dot */}
      <circle cx={540} cy={375} r={4.5} fill="#334155" />

      {/* LIVE BRIGHT PRODUCT LANDING PAGE ON LAPTOP SCREEN */}
      <g>
        <rect x={176} y={392} width={728} height={442} rx={8} fill="#FFFFFF" />
        {/* Website Top Nav */}
        <rect x={176} y={392} width={728} height={54} fill="#F8FAFC" />
        <line x1={176} y1={446} x2={904} y2={446} stroke="#E2E8F0" strokeWidth={1.5} />
        <circle cx={210} cy={419} r={11} fill="#2563EB" />
        <rect x={232} y={412} width={88} height={14} rx={7} fill="#0F172A" />
        <rect x={685} y={414} width={54} height={10} rx={5} fill="#94A3B8" />
        <rect x={754} y={414} width={54} height={10} rx={5} fill="#94A3B8" />
        <rect x={822} y={407} width={64} height={24} rx={12} fill="#0F172A" />

        {/* Landing Page Hero Copy */}
        <text x={540} y={518} textAnchor="middle" fill="#0F172A" fontSize={44} fontFamily="sans-serif" fontWeight={900}>
          Build Smarter. Ship Faster.
        </text>
        <text x={540} y={556} textAnchor="middle" fill="#64748B" fontSize={21} fontFamily="sans-serif" fontWeight={600}>
          All-in-one visual workflow engine for modern teams
        </text>

        {/* Interactive Primary CTA Button (presses on click!) */}
        <g transform={`translate(540, ${(610 + (pressed ? 3 : 0)).toFixed(1)}) scale(${pressed ? 0.96 : 1})`}>
          <rect x={-118} y={-28} width={236} height={56} rx={28} fill="#2563EB" />
          <text x={0} y={8} textAnchor="middle" fill="#FFFFFF" fontSize={23} fontFamily="sans-serif" fontWeight={800}>
            Get Started →
          </text>
        </g>

        {/* Product UI Showcase Cards below CTA */}
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(${218 + i * 224}, 676)`}>
            <rect x={0} y={0} width={196} height={132} rx={14} fill="#F1F5F9" stroke="#E2E8F0" strokeWidth={1.8} />
            <rect x={16} y={16} width={164} height={64} rx={8} fill={i === 1 ? '#DBEAFE' : '#E2E8F0'} />
            <rect x={16} y={94} width={118} height={11} rx={5} fill="#334155" />
            <rect x={16} y={112} width={82} height={8} rx={4} fill="#94A3B8" />
          </g>
        ))}

        {/* Animated Crisp Pointer Cursor Clicking Button */}
        <g transform={`translate(${cursorX.toFixed(1)}, ${cursorY.toFixed(1)})`}>
          {pressed && <circle cx={0} cy={0} r={24} fill="none" stroke="#2563EB" strokeWidth={3} opacity={0.75} />}
          <polygon points="0,0 0,38 11,29 20,44 27,40 18,25 31,24" fill="#0F172A" stroke="#FFFFFF" strokeWidth={2.5} strokeLinejoin="round" />
        </g>
      </g>

      {/* SLEEK SILVER ALUMINUM KEYBOARD DECK & BASE */}
      <polygon points="144,863 936,863 1018,950 62,950" fill="url(#h20-metal)" stroke="#94A3B8" strokeWidth={2} />
      {/* Dark recessed keyboard grid */}
      <polygon points="212,876 868,876 896,916 184,916" fill="#1E293B" />
      {/* Glass trackpad */}
      <polygon points="445,922 635,922 646,942 434,942" fill="#CBD5E1" stroke="#94A3B8" strokeWidth={1.5} />
      {/* Front aluminum base lip & thumb notch */}
      <path d="M 62 950 L 1018 950 L 1002 970 Q 540 976 78 970 Z" fill="#94A3B8" />
      <rect x={476} y={950} width={128} height={9} rx={4} fill="#64748B" />

      {/* Centered Clean Product Title Under Laptop */}
      <text x={540} y={1088} textAnchor="middle" fill="#0F172A" fontSize={40} fontFamily="sans-serif" fontWeight={900}>
        STUDIO PRO WORKSPACE
      </text>
      <text x={540} y={1134} textAnchor="middle" fill="#64748B" fontSize={23} fontFamily="monospace" fontWeight={700} letterSpacing={2}>
        DESIGNED FOR INSTANT LAUNCH
      </text>
    </HeroStage>
  );
};

/** look-21: Isometric Flow — soft off-white diorama, white slab, dark zigzag road, 3 colorful buildings, van & step pills */
const SigLook21IsoFlow: SignatureComponent = ({ frame, width, height }) => {
  const vanT = clamp01((frame % 110) / 85);
  const cx = 540;
  const cy = 795;

  // Compute van position along 3-segment zigzag path on slab top (z=26)
  let vx = -220;
  let vy = -65;
  if (vanT < 0.5) {
    const u = vanT * 2;
    vx = -210 + u * 210;
    vy = -65 + u * 115;
  } else {
    const u = (vanT - 0.5) * 2;
    vx = u * 215;
    vy = 50 - u * 40;
  }

  // Project road points on top of white slab (z=26)
  const r0 = isoProject(-245, -75, 27, cx, cy);
  const r1 = isoProject(-95, -75, 27, cx, cy);
  const r2 = isoProject(-10, 60, 27, cx, cy);
  const r3 = isoProject(235, 15, 27, cx, cy);
  const roadPath = `M ${r0[0]} ${r0[1]} L ${r1[0]} ${r1[1]} L ${r2[0]} ${r2[1]} L ${r3[0]} ${r3[1]}`;

  return (
    <HeroStage
      id="look21"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.45)"
      defs={
        <linearGradient id="h21-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F5F8FC" />
          <stop offset="100%" stopColor="#E2E8F0" />
        </linearGradient>
      }
    >
      {/* Soft Off-White Orthographic Studio Background */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h21-bg)" />

      {/* Ground Contact Shadow under Isometric Slab */}
      <IsoShadow x={-265} y={-175} dx={530} dy={350} cx={cx} cy={cy + 30} opacity={0.16} />

      {/* LARGE WHITE ORTHOGRAPHIC ISOMETRIC BASEPLATE SLAB */}
      <IsoBox x={-265} y={-175} z={0} dx={530} dy={350} dz={26} cx={cx} cy={cy} topColor="#FFFFFF" leftColor="#E2E8F0" rightColor="#CBD5E1" stroke="#CBD5E1" strokeWidth={1.5} />

      {/* Dark Asphalt Zig-Zag Road with Crisp Dashed White Center Line */}
      <path d={roadPath} fill="none" stroke="#334155" strokeWidth={46} strokeLinecap="round" strokeLinejoin="round" />
      <path d={roadPath} fill="none" stroke="#FFFFFF" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="16 14" />

      {/* STEP 1 BUILDING: MINT TOY-LIKE BLOCK WITH WHITE ROOF */}
      <IsoShadow x={-230} y={-155} z={26} dx={112} dy={102} cx={cx} cy={cy} offset={10} opacity={0.14} />
      <IsoBox x={-230} y={-155} z={26} dx={112} dy={102} dz={118} cx={cx} cy={cy} topColor="#6EE7B7" leftColor="#34D399" rightColor="#059669" />
      <IsoBox x={-236} y={-161} z={144} dx={124} dy={114} dz={18} cx={cx} cy={cy} topColor="#FFFFFF" leftColor="#E2E8F0" rightColor="#CBD5E1" />

      {/* STEP 2 BUILDING: SKY-BLUE TOY-LIKE BLOCK WITH WHITE ROOF */}
      <IsoShadow x={-52} y={-125} z={26} dx={118} dy={108} cx={cx} cy={cy} offset={10} opacity={0.14} />
      <IsoBox x={-52} y={-125} z={26} dx={118} dy={108} dz={154} cx={cx} cy={cy} topColor="#60A5FA" leftColor="#3B82F6" rightColor="#1D4ED8" />
      <IsoBox x={-58} y={-131} z={180} dx={130} dy={120} dz={18} cx={cx} cy={cy} topColor="#FFFFFF" leftColor="#E2E8F0" rightColor="#CBD5E1" />

      {/* STEP 3 BUILDING: CORAL TOY-LIKE BLOCK WITH WHITE ROOF */}
      <IsoShadow x={120} y={-110} z={26} dx={114} dy={104} cx={cx} cy={cy} offset={10} opacity={0.14} />
      <IsoBox x={120} y={-110} z={26} dx={114} dy={104} dz={132} cx={cx} cy={cy} topColor="#FDA4AF" leftColor="#FB7185" rightColor="#E11D48" />
      <IsoBox x={114} y={-116} z={158} dx={126} dy={116} dz={18} cx={cx} cy={cy} topColor="#FFFFFF" leftColor="#E2E8F0" rightColor="#CBD5E1" />

      {/* CUTE ISOMETRIC DELIVERY VAN MOVING ALONG ZIG-ZAG ROAD */}
      <IsoBox x={vx - 26} y={vy - 16} z={28} dx={56} dy={32} dz={32} cx={cx} cy={cy} topColor="#FEF08A" leftColor="#FACC15" rightColor="#CA8A04" stroke="#713F12" strokeWidth={1.2} />
      <IsoBox x={vx + 22} y={vy - 12} z={28} dx={18} dy={24} dz={22} cx={cx} cy={cy} topColor="#FFFFFF" leftColor="#93C5FD" rightColor="#3B82F6" />

      {/* THREE CRISP WHITE FLOATING STEP LABEL PILLS (01, 02, GREEN CHECK!) */}
      {[
        { x: 350, y: 468, lineEnd: 112, num: '01', name: 'COLLECT', time: '0.2s', bg: '#10B981' },
        { x: 540, y: 378, lineEnd: 116, num: '02', name: 'PROCESS', time: '0.8s', bg: '#2563EB' },
        { x: 755, y: 505, lineEnd: 108, num: '✓', name: 'DELIVER', time: 'DONE', bg: '#16A34A' },
      ].map((p) => (
        <g key={p.name} transform={`translate(${p.x}, ${p.y})`}>
          <line x1={0} y1={34} x2={0} y2={p.lineEnd} stroke="#94A3B8" strokeWidth={2.5} strokeDasharray="5 5" />
          <circle cx={0} cy={p.lineEnd} r={5} fill={p.bg} />
          <rect x={-106} y={-34} width={212} height={68} rx={34} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={2} />
          <circle cx={-68} cy={0} r={22} fill={p.bg} />
          <text x={-68} y={8} textAnchor="middle" fill="#FFFFFF" fontSize={22} fontFamily="monospace" fontWeight={900}>
            {p.num}
          </text>
          <text x={-34} y={-2} fill="#0F172A" fontSize={20} fontFamily="sans-serif" fontWeight={800}>
            {p.name}
          </text>
          <text x={-34} y={20} fill="#64748B" fontSize={15} fontFamily="monospace" fontWeight={700}>
            {p.time}
          </text>
        </g>
      ))}
    </HeroStage>
  );
};

/** look-22: Notification Stack — dark soft blue-teal lock-screen wallpaper + big clock + frosted summary bar + stacked order cards */
const SigLook22Notifications: SignatureComponent = ({ frame, width, height }) => {
  const totalBaht = 42500 + Math.min(24, Math.floor(frame / 2)) * 1290;
  const orderCount = 24 + Math.min(24, Math.floor(frame / 2));

  const cards = [
    { app: 'SHOP STUDIO', time: 'now', msg: 'New order: ฿1,490 · 2 items', color: '#22C55E' },
    { app: 'SHOP STUDIO', time: 'now', msg: 'New order: ฿2,850 · 4 items', color: '#10B981' },
    { app: 'SHOP STUDIO', time: '1m ago', msg: 'New order: ฿890 · 1 item', color: '#38BDF8' },
    { app: 'SHOP STUDIO', time: '2m ago', msg: 'New order: ฿3,200 · 3 items', color: '#22C55E' },
  ];

  return (
    <HeroStage
      id="look22"
      width={width}
      height={height}
      borderColor="rgba(56,189,248,0.45)"
      defs={
        <>
          <linearGradient id="h22-wall" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0F4C5C" />
            <stop offset="52%" stopColor="#0E2A5A" />
            <stop offset="100%" stopColor="#08152E" />
          </linearGradient>
          <radialGradient id="h22-aurora" cx="30%" cy="22%" r="60%">
            <stop offset="0%" stopColor="#2DD4BF" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#0E2A5A" stopOpacity="0" />
          </radialGradient>
        </>
      }
    >
      {/* Lush Dark Blue & Teal Lock-Screen Wallpaper (no phone frame, edge-to-edge lock screen!) */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h22-wall)" />
      <rect x={28} y={260} width={1024} height={956} fill="url(#h22-aurora)" />

      {/* Top Status Strip (9:41 + Signal + Battery) */}
      <text x={82} y={310} fill="#FFFFFF" fontSize={22} fontFamily="monospace" fontWeight={700}>
        09:41
      </text>
      <g transform="translate(918, 290)">
        <rect x={0} y={0} width={58} height={26} rx={7} fill="none" stroke="#FFFFFF" strokeWidth={2.5} opacity={0.85} />
        <rect x={5} y={5} width={44} height={16} rx={4} fill="#4ADE80" />
      </g>

      {/* Lock-Screen Date & BIG Clock */}
      <text x={540} y={362} textAnchor="middle" fill="#BAE6FD" fontSize={24} fontFamily="sans-serif" fontWeight={600} letterSpacing={2}>
        Monday, 23 November
      </text>
      <text x={540} y={462} textAnchor="middle" fill="#FFFFFF" fontSize={106} fontFamily="sans-serif" fontWeight={800} letterSpacing={2}>
        09:41
      </text>

      {/* FROSTED SUMMARY BAR (App icon + Today + Order Count + Rolling Total) */}
      <g transform="translate(94, 502)">
        <rect x={0} y={0} width={892} height={92} rx={28} fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.34)" strokeWidth={2} />
        <rect x={20} y={18} width={56} height={56} rx={16} fill="#10B981" />
        <path d="M 36 47 L 45 56 L 62 37" fill="none" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
        <text x={96} y={42} fill="#FFFFFF" fontSize={26} fontFamily="sans-serif" fontWeight={800}>
          Today
        </text>
        <text x={96} y={70} fill="#BAE6FD" fontSize={20} fontFamily="monospace" fontWeight={700}>
          {orderCount} orders received
        </text>
        <text x={864} y={58} textAnchor="end" fill="#4ADE80" fontSize={40} fontFamily="monospace" fontWeight={900}>
          ฿{totalBaht.toLocaleString('en-US')}
        </text>
      </g>

      {/* TUCKED OLDER NOTIFICATION CARDS (Smaller & Darker Behind Stack for 3D Depth) */}
      <rect x={164} y={1074} width={752} height={68} rx={24} fill="rgba(15, 23, 42, 0.54)" stroke="rgba(255,255,255,0.14)" strokeWidth={1.5} />
      <rect x={128} y={1046} width={824} height={76} rx={26} fill="rgba(15, 23, 42, 0.72)" stroke="rgba(255,255,255,0.22)" strokeWidth={1.6} />

      {/* 4 ACTIVE STACKED FROSTED-GLASS ORDER NOTIFICATION CARDS */}
      {cards.map((c, idx) => {
        const drop = easeOutCubic(clamp01((frame - idx * 6) / 14));
        const y = 616 + idx * 108 - (1 - drop) * 28;
        return (
          <g key={idx} transform={`translate(94, ${y.toFixed(1)})`} opacity={0.2 + 0.8 * drop}>
            <rect
              x={0}
              y={0}
              width={892}
              height={96}
              rx={26}
              fill="rgba(15, 23, 42, 0.76)"
              stroke="rgba(255,255,255,0.32)"
              strokeWidth={2}
            />
            <rect x={20} y={20} width={56} height={56} rx={16} fill={c.color} />
            <circle cx={48} cy={48} r={14} fill="none" stroke="#FFFFFF" strokeWidth={4} />
            <text x={96} y={42} fill="#E2E8F0" fontSize={21} fontFamily="monospace" fontWeight={800} letterSpacing={1.5}>
              {c.app}
            </text>
            <text x={864} y={42} textAnchor="end" fill="#94A3B8" fontSize={20} fontFamily="monospace" fontWeight={600}>
              {c.time}
            </text>
            <text x={96} y={76} fill="#FFFFFF" fontSize={28} fontFamily="sans-serif" fontWeight={700}>
              {c.msg}
            </text>
          </g>
        );
      })}

      {/* Popping "+24 more" Pill at Bottom */}
      <g transform="translate(540, 1172)">
        <rect x={-124} y={-24} width={248} height={48} rx={24} fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.38)" strokeWidth={1.8} />
        <text x={0} y={8} textAnchor="middle" fill="#FFFFFF" fontSize={22} fontFamily="monospace" fontWeight={800}>
          +24 more orders
        </text>
      </g>
    </HeroStage>
  );
};

/** look-23: Before and After Slider — pale grey studio, big browser window comparing dated vs modern site with 50/50 handle */
const SigLook23Slider: SignatureComponent = ({ frame, width, height }) => {
  const bx = 76;
  const by = 312;
  const bw = 928;
  const bh = 852;
  // Sweeps gracefully and settles right near center 50/50 split around frame 60!
  const splitFrac = 0.5 + Math.sin(frame * 0.05) * 0.14 * Math.exp(-Math.max(0, frame - 35) * 0.04);
  const splitX = bx + bw * splitFrac;

  return (
    <HeroStage
      id="look23"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.45)"
      defs={
        <>
          <linearGradient id="h23-studio" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EEF1F6" />
            <stop offset="100%" stopColor="#DCE2EC" />
          </linearGradient>
          <clipPath id="h23-after-clip">
            <rect x={splitX} y={by + 58} width={bx + bw - splitX} height={bh - 58} />
          </clipPath>
          <clipPath id="h23-window-clip">
            <rect x={bx} y={by} width={bw} height={bh} rx={24} />
          </clipPath>
        </>
      }
    >
      {/* Clean pale cool-grey studio background */}
      <rect x={28} y={260} width={1024} height={956} fill="url(#h23-studio)" />

      {/* Soft layered shadow under massive browser window */}
      <rect x={bx + 12} y={by + 20} width={bw} height={bh} rx={26} fill="rgba(15, 23, 42, 0.18)" />

      {/* MASSIVE BROWSER WINDOW */}
      <g clipPath="url(#h23-window-clip)">
        {/* Top Browser Chrome Bar */}
        <rect x={bx} y={by} width={bw} height={58} fill="#E2E8F0" />
        <circle cx={bx + 32} cy={by + 29} r={9} fill="#FF5F56" />
        <circle cx={bx + 60} cy={by + 29} r={9} fill="#FFBD2E" />
        <circle cx={bx + 88} cy={by + 29} r={9} fill="#27C93F" />
        <rect x={bx + 240} y={by + 13} width={448} height={32} rx={10} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={1.5} />
        <text x={bx + 464} y={by + 35} textAnchor="middle" fill="#64748B" fontSize={18} fontFamily="monospace">
          https://yourbrand.studio
        </text>

        {/* FULL BASE LAYER = "BEFORE" (Dated Clunky 2005 Website) */}
        <g>
          <rect x={bx} y={by + 58} width={bw} height={bh - 58} fill="#D4D8DF" />
          {/* Dated bevelled blue header bar */}
          <rect x={bx} y={by + 58} width={bw} height={96} fill="#3B5998" />
          <text x={bx + 34} y={by + 116} fill="#FEF08A" fontSize={36} fontFamily="serif" fontWeight={700}>
            WELCOME TO OUR SITE!
          </text>
          {/* Dated clunky yellow alert strip */}
          <rect x={bx + 26} y={by + 174} width={bw - 52} height={58} fill="#FEF08A" stroke="#DC2626" strokeWidth={3} />
          <text x={bx + 46} y={by + 211} fill="#991B1B" fontSize={23} fontFamily="serif" fontWeight={700}>
            *** CLICK HERE FOR SPECIAL DEALS ***
          </text>
          {/* Cluttered grey table boxes on left */}
          <rect x={bx + 26} y={by + 256} width={380} height={240} fill="#E5E7EB" stroke="#6B7280" strokeWidth={2.5} />
          <rect x={bx + 26} y={by + 256} width={380} height={42} fill="#9CA3AF" />
          <text x={bx + 44} y={by + 284} fill="#111827" fontSize={20} fontFamily="serif" fontWeight={700}>
            Old Menu Links
          </text>
          {[328, 366, 404, 442].map((ly, i) => (
            <text key={ly} x={bx + 44} y={by + ly} fill="#1D4ED8" fontSize={22} fontFamily="serif" textDecoration="underline">
              » Page Link #{i + 1} (2009)
            </text>
          ))}
          {/* Ugly dense lower block */}
          <rect x={bx + 26} y={by + 522} width={380} height={290} fill="#F3F4F6" stroke="#6B7280" strokeWidth={2.5} />
          {[562, 594, 626, 658, 690, 722, 754].map((ly) => (
            <rect key={ly} x={bx + 44} y={by + ly} width={320} height={14} fill="#9CA3AF" />
          ))}
        </g>

        {/* TOP CLIPPED LAYER = "AFTER" (Modern Warm-White Editorial Redesign!) */}
        <g clipPath="url(#h23-after-clip)">
          <rect x={bx} y={by + 58} width={bw} height={bh - 58} fill="#FFFDF9" />
          {/* Clean minimalist modern nav */}
          <line x1={bx} y1={by + 132} x2={bx + bw} y2={by + 132} stroke="#E5E7EB" strokeWidth={1.5} />
          <rect x={bx + 760} y={by + 78} width={132} height={38} rx={19} fill="#0F172A" />
          <text x={bx + 826} y={by + 103} textAnchor="middle" fill="#FFFFFF" fontSize={18} fontFamily="sans-serif" fontWeight={700}>
            Book Now
          </text>
          {/* Modern Hero Editorial Section on Right Half */}
          <text x={bx + 498} y={by + 225} fill="#0284C7" fontSize={20} fontFamily="monospace" fontWeight={800} letterSpacing={3}>
            NEW EXPERIENCE
          </text>
          <text x={bx + 498} y={by + 288} fill="#0F172A" fontSize={52} fontFamily="sans-serif" fontWeight={900}>
            Clean. Fast.
          </text>
          <text x={bx + 498} y={by + 348} fill="#0F172A" fontSize={52} fontFamily="sans-serif" fontWeight={900}>
            Effortless.
          </text>
          <text x={bx + 498} y={by + 398} fill="#64748B" fontSize={21} fontFamily="sans-serif" fontWeight={600}>
            Redesigned for +2.8x conversion
          </text>
          {/* Modern Primary Accent CTA */}
          <rect x={bx + 498} y={by + 434} width={220} height={58} rx={29} fill="#0EA5E9" />
          <text x={bx + 608} y={by + 471} textAnchor="middle" fill="#FFFFFF" fontSize={23} fontFamily="sans-serif" fontWeight={800}>
            Explore Studio →
          </text>
          {/* 2 Elevated Modern Metric Cards Below */}
          {[
            { title: '+280%', sub: 'Conversion', accent: '#0EA5E9' },
            { title: '0.4s', sub: 'Page Load', accent: '#10B981' },
          ].map((c, idx) => (
            <g key={c.title} transform={`translate(${bx + 498 + idx * 198}, ${by + 548})`}>
              <rect x={0} y={0} width={182} height={240} rx={22} fill="#FFFFFF" stroke="#E2E8F0" strokeWidth={2} />
              <rect x={22} y={24} width={44} height={44} rx={12} fill={hexToRgba(c.accent, 0.16)} />
              <circle cx={44} cy={46} r={11} fill={c.accent} />
              <text x={22} y={142} fill="#0F172A" fontSize={40} fontFamily="sans-serif" fontWeight={900}>
                {c.title}
              </text>
              <text x={22} y={180} fill="#64748B" fontSize={20} fontFamily="sans-serif" fontWeight={600}>
                {c.sub}
              </text>
            </g>
          ))}
        </g>

        {/* Crisp Corner Badges inside Browser */}
        <rect x={bx + 24} y={by + bh - 68} width={144} height={44} rx={22} fill="rgba(15,23,42,0.84)" />
        <text x={bx + 96} y={by + bh - 40} textAnchor="middle" fill="#E2E8F0" fontSize={19} fontFamily="monospace" fontWeight={800}>
          BEFORE
        </text>
        <rect x={bx + bw - 168} y={by + bh - 68} width={144} height={44} rx={22} fill="#0EA5E9" />
        <text x={bx + bw - 96} y={by + bh - 40} textAnchor="middle" fill="#FFFFFF" fontSize={19} fontFamily="monospace" fontWeight={800}>
          AFTER
        </text>

        {/* CRISP WHITE VERTICAL SPLIT DIVIDER + TACTILE ROUND HANDLE */}
        <line x1={splitX} y1={by + 58} x2={splitX} y2={by + bh} stroke="rgba(15,23,42,0.28)" strokeWidth={12} />
        <line x1={splitX} y1={by + 58} x2={splitX} y2={by + bh} stroke="#FFFFFF" strokeWidth={6} />
        <g transform={`translate(${splitX.toFixed(1)}, ${by + bh * 0.54})`}>
          <circle cx={0} cy={4} r={38} fill="rgba(15,23,42,0.28)" />
          <circle cx={0} cy={0} r={36} fill="#FFFFFF" stroke="#0F172A" strokeWidth={3.5} />
          <path d="M -16 0 L -5 -10 M -16 0 L -5 10 M 16 0 L 5 -10 M 16 0 L 5 10" stroke="#0F172A" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>

      {/* Browser Outer Frame Stroke */}
      <rect x={bx} y={by} width={bw} height={bh} rx={24} fill="none" stroke="#94A3B8" strokeWidth={2.5} />
    </HeroStage>
  );
};

/** look-24: Ranking Bars — full-stage animated racing horizontal bar chart with vivid orange hero bar */
const SigLook24RankingBars: SignatureComponent = ({ frame, width, height }) => {
  const t = easeOutCubic(clamp01(frame / 58));
  const year = 2021 + Math.floor(t * 5);
  const bars = [
    { label: 'AI Cloud', value: 34 + t * 54, color: '#FF5A36', hero: true, rank: 0 },
    { label: 'Mobile OS', value: 66 + t * 6, color: '#7F93B5', hero: false, rank: 1 },
    { label: 'E-Comm', value: 58 + t * 8, color: '#9DB89E', hero: false, rank: 2 },
    { label: 'FinTech', value: 48 + t * 9, color: '#8AA7B3', hero: false, rank: 3 },
    { label: 'Streaming', value: 41 + t * 6, color: '#B4A7C5', hero: false, rank: 4 },
    { label: 'Hardware', value: 33 + t * 5, color: '#D3A8AE', hero: false, rank: 5 },
  ];
  const chartLeft = 228;
  const chartMaxW = 680;
  const barStartY = 448;
  const barPitch = 104;

  return (
    <HeroStage
      id="look24"
      width={width}
      height={height}
      borderColor="rgba(226,232,240,0.85)"
      defs={
        <linearGradient id="h24-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#EFF2F6" />
        </linearGradient>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h24-bg)" />

      {/* Header */}
      <text x={72} y={328} fill="#111418" fontSize={40} fontFamily="sans-serif" fontWeight={900} letterSpacing={-0.8}>
        Global Market Share Race
      </text>
      <text x={72} y={362} fill="#7B8491" fontSize={21} fontFamily="sans-serif" fontWeight={600}>
        Annual share of digital spend (%) · 2021–2026
      </text>

      {/* Vertical percentage gridlines & top ticks */}
      {[0, 20, 40, 60, 80, 100].map((pct) => {
        const gx = chartLeft + (pct / 100) * chartMaxW;
        return (
          <g key={pct}>
            <line x1={gx} y1={418} x2={gx} y2={1064} stroke="#CBD5E1" strokeWidth={1.5} strokeDasharray={pct === 0 ? undefined : '4 6'} opacity={0.75} />
            <text x={gx} y={406} textAnchor="middle" fill="#94A3B8" fontSize={17} fontFamily="monospace" fontWeight={700}>
              {pct}%
            </text>
          </g>
        );
      })}

      {/* 6 racing horizontal bars */}
      {bars.map((b, i) => {
        const y = barStartY + i * barPitch;
        const w = (b.value / 100) * chartMaxW;
        return (
          <g key={b.label}>
            <text
              x={chartLeft - 18}
              y={y + 44}
              textAnchor="end"
              fill={b.hero ? '#111418' : '#475569'}
              fontSize={b.hero ? 26 : 23}
              fontFamily="sans-serif"
              fontWeight={b.hero ? 900 : 700}
            >
              {b.label}
            </text>
            {/* Bar track subtle backdrop */}
            <rect x={chartLeft} y={y + 4} width={chartMaxW} height={64} rx={12} fill="#E2E8F0" opacity={0.35} />
            {/* Bar with square left base and rounded right cap */}
            <path
              d={`M ${chartLeft} ${y + 4} H ${(chartLeft + w - 16).toFixed(1)} Q ${(chartLeft + w).toFixed(1)} ${y + 4} ${(chartLeft + w).toFixed(1)} ${y + 20} V ${y + 52} Q ${(chartLeft + w).toFixed(1)} ${y + 68} ${(chartLeft + w - 16).toFixed(1)} ${y + 68} H ${chartLeft} Z`}
              fill={b.color}
            />
            {b.hero && (
              <rect x={chartLeft + 14} y={y + 18} width={54} height={36} rx={8} fill="rgba(255,255,255,0.24)" />
            )}
            {b.hero && (
              <text x={chartLeft + 41} y={y + 43} textAnchor="middle" fill="#FFFFFF" fontSize={20} fontFamily="monospace" fontWeight={900}>
                #1
              </text>
            )}
            <text
              x={chartLeft + w + 16}
              y={y + 45}
              fill={b.hero ? '#FF5A36' : '#334155'}
              fontSize={b.hero ? 30 : 25}
              fontFamily="monospace"
              fontWeight={900}
            >
              {b.value.toFixed(1)}%
            </text>
          </g>
        );
      })}

      {/* Bottom-left editorial footnote */}
      <line x1={72} y1={1098} x2={1008} y2={1098} stroke="#CBD5E1" strokeWidth={1.5} />
      <text x={72} y={1138} fill="#111418" fontSize={23} fontFamily="sans-serif" fontWeight={800}>
        Leader overtakes top category
      </text>
      <text x={72} y={1170} fill="#64748B" fontSize={19} fontFamily="sans-serif" fontWeight={600}>
        Fastest 5-year climb across all segments
      </text>

      {/* Huge watermark year bottom-right */}
      <text x={1006} y={1188} textAnchor="end" fill="#CBD5E1" fontSize={118} fontFamily="monospace" fontWeight={900} letterSpacing={-4}>
        {year}
      </text>
    </HeroStage>
  );
};

/** look-25: Social Post Receipt — clean white post card + red underline + ticking counters + stacked replies */
const SigLook25SocialPost: SignatureComponent = ({ frame, width, height }) => {
  const underlineProg = easeOutCubic(clamp01((frame - 10) / 30));
  const reply1 = easeOutCubic(clamp01((frame - 22) / 22));
  const reply2 = easeOutCubic(clamp01((frame - 36) / 22));
  const likes = 14820 + Math.floor(frame * 19);
  const reposts = 3410 + Math.floor(frame * 5);

  return (
    <HeroStage
      id="look25"
      width={width}
      height={height}
      borderColor="rgba(203,213,225,0.8)"
      defs={
        <>
          <linearGradient id="h25-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F1F3F6" />
            <stop offset="100%" stopColor="#E2E8F0" />
          </linearGradient>
          <radialGradient id="h25-orb" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#93C5FD" stopOpacity="0" />
          </radialGradient>
        </>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h25-bg)" />
      <circle cx={860} cy={410} r={280} fill="url(#h25-orb)" />
      <circle cx={190} cy={1040} r={240} fill="url(#h25-orb)" />

      {/* Main White Social Post Receipt Card */}
      <rect x={92} y={322} width={896} height={476} rx={30} fill="#0F172A" opacity={0.07} transform="translate(0, 14)" />
      <rect x={92} y={322} width={896} height={476} rx={30} fill="#FFFFFF" stroke="#E2E8F0" strokeWidth={2.5} />

      {/* Author header */}
      <circle cx={166} cy={394} r={38} fill="#0F172A" />
      <text x={166} y={406} textAnchor="middle" fill="#FFFFFF" fontSize={30} fontFamily="sans-serif" fontWeight={900}>
        AR
      </text>
      <text x={222} y={386} fill="#0F172A" fontSize={29} fontFamily="sans-serif" fontWeight={900}>
        Alex Rivera
      </text>
      {/* Verified blue badge */}
      <circle cx={402} cy={376} r={14} fill="#1D9BF0" />
      <path d="M 395 376 L 400 381 L 410 370" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <text x={222} y={418} fill="#64748B" fontSize={22} fontFamily="monospace" fontWeight={600}>
        @alexrivera · 2h · PUBLIC RECORD
      </text>
      <rect x={812} y={366} width={132} height={42} rx={21} fill="#FEE2E2" />
      <text x={878} y={393} textAnchor="middle" fill="#DC2626" fontSize={18} fontFamily="monospace" fontWeight={800}>
        RECEIPT
      </text>

      {/* Post body copy */}
      <text x={136} y={498} fill="#0F172A" fontSize={35} fontFamily="sans-serif" fontWeight={700}>
        “We will never lock core features behind
      </text>
      <text x={136} y={554} fill="#0F172A" fontSize={35} fontFamily="sans-serif" fontWeight={800}>
        a paid subscription — that’s a promise.”
      </text>
      {/* Animated red marker underline under key quote */}
      <path
        d="M 136 568 Q 450 578 810 564"
        fill="none"
        stroke="#EF4444"
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray="690"
        strokeDashoffset={690 * (1 - underlineProg)}
      />
      <text x={136} y={626} fill="#64748B" fontSize={22} fontFamily="monospace" fontWeight={600}>
        09:14 AM · Mar 14, 2024 · Archived Snapshot
      </text>

      {/* Divider + Live Engagement Counters */}
      <line x1={136} y1={666} x2={944} y2={666} stroke="#E2E8F0" strokeWidth={2} />
      <g transform="translate(136, 706)">
        <rect x={0} y={0} width={246} height={58} rx={16} fill="#FFF1F2" />
        <text x={24} y={38} fill="#E11D48" fontSize={26} fontFamily="monospace" fontWeight={900}>
          ♥ {likes.toLocaleString()}
        </text>
        <rect x={268} y={0} width={236} height={58} rx={16} fill="#ECFDF5" />
        <text x={292} y={38} fill="#059669" fontSize={26} fontFamily="monospace" fontWeight={900}>
          ↻ {reposts.toLocaleString()}
        </text>
        <rect x={526} y={0} width={218} height={58} rx={16} fill="#EFF6FF" />
        <text x={550} y={38} fill="#2563EB" fontSize={26} fontFamily="monospace" fontWeight={900}>
          💬 1,942
        </text>
      </g>

      {/* Stacked Comment Receipt 1 */}
      <g transform={`translate(0, ${((1 - reply1) * 32).toFixed(1)})`} opacity={reply1}>
        <rect x={128} y={832} width={860} height={144} rx={24} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={2} />
        <circle cx={182} cy={888} r={24} fill="#38BDF8" />
        <text x={222} y={882} fill="#0F172A" fontSize={23} fontFamily="sans-serif" fontWeight={800}>
          @tech_watcher
        </text>
        <text x={402} y={882} fill="#94A3B8" fontSize={20} fontFamily="monospace">
          · 14m ago
        </text>
        <text x={222} y={928} fill="#334155" fontSize={25} fontFamily="sans-serif" fontWeight={600}>
          Aged like milk. Pricing page updated today → $29/mo.
        </text>
      </g>

      {/* Stacked Comment Receipt 2 */}
      <g transform={`translate(0, ${((1 - reply2) * 36).toFixed(1)})`} opacity={reply2}>
        <rect x={164} y={998} width={824} height={144} rx={24} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={2} />
        <circle cx={218} cy={1054} r={24} fill="#F43F5E" />
        <text x={258} y={1048} fill="#0F172A" fontSize={23} fontFamily="sans-serif" fontWeight={800}>
          @data_receipts
        </text>
        <text x={442} y={1048} fill="#94A3B8" fontSize={20} fontFamily="monospace">
          · 4m ago
        </text>
        <text x={258} y={1094} fill="#334155" fontSize={25} fontFamily="sans-serif" fontWeight={600}>
          Screenshot saved before they deleted the thread.
        </text>
      </g>
    </HeroStage>
  );
};

/** look-26: Day Counter — massive red DAY + giant flipping day number + monthly checkmark calendar */
const SigLook26DayCounter: SignatureComponent = ({ frame, width, height }) => {
  const day = 1 + (Math.floor(frame / 4) % 18);
  const flipPhase = (frame % 16) / 16;
  const flipShade = Math.sin(flipPhase * Math.PI) * 0.14;
  const cols = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <HeroStage
      id="look26"
      width={width}
      height={height}
      borderColor="rgba(226,232,240,0.9)"
      defs={
        <linearGradient id="h26-paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F3F3F1" />
        </linearGradient>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h26-paper)" />

      {/* Top Challenge Header */}
      <text x={78} y={326} fill="#74746F" fontSize={22} fontFamily="monospace" fontWeight={800} letterSpacing={4}>
        30-DAY CONSISTENCY CHALLENGE
      </text>
      <line x1={78} y1={346} x2={1002} y2={346} stroke="#E5E5E0" strokeWidth={2} />

      {/* Giant Red DAY + Flipping Number */}
      <text x={78} y={556} fill="#E5383B" fontSize={224} fontFamily="sans-serif" fontWeight={900} letterSpacing={-8}>
        DAY
      </text>
      {/* Flip Counter Mechanical Card */}
      <g transform="translate(612, 372)">
        <rect x={0} y={0} width={388} height={224} rx={24} fill="#111111" />
        <rect x={0} y={112} width={388} height={112} rx={24} fill="#1E1E1E" />
        <rect x={0} y={112} width={388} height={28} fill="#1E1E1E" />
        <text x={194} y={182} textAnchor="middle" fill="#FFFFFF" fontSize={196} fontFamily="monospace" fontWeight={900} letterSpacing={-8}>
          {String(day).padStart(2, '0')}
        </text>
        {/* Split flip hinge line */}
        <line x1={0} y1={112} x2={388} y2={112} stroke="#000000" strokeWidth={6} />
        <rect x={0} y={114} width={388} height={110} rx={22} fill={`rgba(0,0,0,${flipShade.toFixed(3)})`} />
        <circle cx={18} cy={112} r={7} fill="#E5383B" />
        <circle cx={370} cy={112} r={7} fill="#E5383B" />
      </g>

      {/* Monthly Calendar Block */}
      <rect x={78} y={634} width={924} height={536} rx={24} fill="#FFFFFF" stroke="#E5E5E0" strokeWidth={2.5} />
      <text x={116} y={692} fill="#111111" fontSize={36} fontFamily="sans-serif" fontWeight={900} letterSpacing={2}>
        OCTOBER
      </text>
      <text x={964} y={692} textAnchor="end" fill="#E5383B" fontSize={24} fontFamily="monospace" fontWeight={800}>
        {day} / 30 STREAK ✓
      </text>

      {/* Weekday headers */}
      {cols.map((c, idx) => (
        <text key={idx} x={156 + idx * 124} y={744} textAnchor="middle" fill="#8F8F8B" fontSize={21} fontFamily="monospace" fontWeight={800}>
          {c}
        </text>
      ))}
      <line x1={108} y1={762} x2={972} y2={762} stroke="#ECECE7" strokeWidth={2} />

      {/* 30 Calendar Cells with hand-drawn red checkmarks & circle on current day */}
      {Array.from({ length: 28 }).map((_, idx) => {
        const dNum = idx + 1;
        const col = idx % 7;
        const row = Math.floor(idx / 7);
        const cx = 156 + col * 124;
        const cy = 816 + row * 88;
        const isPast = dNum < day;
        const isCurrent = dNum === day;
        return (
          <g key={dNum}>
            <text
              x={cx}
              y={cy + 9}
              textAnchor="middle"
              fill={isPast ? '#C4C4BE' : isCurrent ? '#111111' : '#52524E'}
              fontSize={28}
              fontFamily="monospace"
              fontWeight={isCurrent ? 900 : 700}
            >
              {dNum}
            </text>
            {isPast && (
              <path
                d={`M ${cx - 24} ${cy + 2} L ${cx - 5} ${cy + 20} L ${cx + 28} ${cy - 20}`}
                fill="none"
                stroke="#E5383B"
                strokeWidth={7}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {isCurrent && (
              <ellipse
                cx={cx}
                cy={cy}
                rx={36}
                ry={31}
                fill="none"
                stroke="#E5383B"
                strokeWidth={6}
                transform={`rotate(-8, ${cx}, ${cy})`}
              />
            )}
          </g>
        );
      })}
    </HeroStage>
  );
};

/** look-27: Versus — sports broadcast Tale of the Tape blue vs orange split arena */
const SigLook27Versus: SignatureComponent = ({ frame, width, height }) => {
  const grow = easeOutCubic(clamp01(frame / 44));
  const pulse = 1 + Math.sin(frame * 0.1) * 0.04;
  const rows = [
    { label: 'SPEED', left: 88, right: 64, win: 'left' },
    { label: 'VALUE', left: 62, right: 92, win: 'right' },
    { label: 'BATTERY', left: 84, right: 74, win: 'left' },
    { label: 'DISPLAY', left: 78, right: 95, win: 'right' },
    { label: 'OVERALL', left: 91, right: 86, win: 'left' },
  ];

  return (
    <HeroStage
      id="look27"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.32)"
      defs={
        <>
          <radialGradient id="h27-left" cx="12%" cy="45%" r="55%">
            <stop offset="0%" stopColor="#3D7BFF" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#0B0D12" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="h27-right" cx="88%" cy="45%" r="55%">
            <stop offset="0%" stopColor="#FF7A30" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#0B0D12" stopOpacity="0" />
          </radialGradient>
        </>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="#0B0D12" />
      <rect x={28} y={260} width={520} height={956} fill="url(#h27-left)" />
      <rect x={532} y={260} width={520} height={956} fill="url(#h27-right)" />

      {/* Subtle slanted center broadcast seam */}
      <line x1={556} y1={260} x2={524} y2={1216} stroke="rgba(255,255,255,0.12)" strokeWidth={3} />

      {/* Contender Headers */}
      <rect x={76} y={316} width={360} height={112} rx={20} fill="rgba(61,123,255,0.16)" stroke="#3D7BFF" strokeWidth={3} />
      <text x={256} y={366} textAnchor="middle" fill="#93C5FD" fontSize={19} fontFamily="monospace" fontWeight={800} letterSpacing={3}>
        CONTENDER A
      </text>
      <text x={256} y={406} textAnchor="middle" fill="#FFFFFF" fontSize={34} fontFamily="sans-serif" fontWeight={900}>
        PRO MODEL
      </text>

      <rect x={644} y={316} width={360} height={112} rx={20} fill="rgba(255,122,48,0.16)" stroke="#FF7A30" strokeWidth={3} />
      <text x={824} y={366} textAnchor="middle" fill="#FDBA74" fontSize={19} fontFamily="monospace" fontWeight={800} letterSpacing={3}>
        CONTENDER B
      </text>
      <text x={824} y={406} textAnchor="middle" fill="#FFFFFF" fontSize={34} fontFamily="sans-serif" fontWeight={900}>
        AIR MODEL
      </text>

      {/* Center VS Crest */}
      <g transform={`translate(540, 372) scale(${pulse.toFixed(3)})`}>
        <polygon points="0,-58 52,-26 52,26 0,58 -52,26 -52,-26" fill="#0B0D12" stroke="#FFFFFF" strokeWidth={3.5} />
        <text x={0} y={14} textAnchor="middle" fill="#FFFFFF" fontSize={38} fontFamily="sans-serif" fontWeight={900}>
          VS
        </text>
      </g>

      {/* 5 Tale-of-the-Tape Comparison Rows */}
      {rows.map((r, i) => {
        const y = 492 + i * 134;
        const lw = (r.left / 100) * 320 * grow;
        const rw = (r.right / 100) * 320 * grow;
        return (
          <g key={r.label}>
            {/* Row category pill centered */}
            <text x={540} y={y} textAnchor="middle" fill="#94A3B8" fontSize={20} fontFamily="monospace" fontWeight={800} letterSpacing={3}>
              {r.label}
            </text>
            {/* Track backgrounds */}
            <rect x={160} y={y + 18} width={366} height={44} rx={10} fill="rgba(255,255,255,0.06)" />
            <rect x={554} y={y + 18} width={366} height={44} rx={10} fill="rgba(255,255,255,0.06)" />
            {/* Left blue bar growing left from center */}
            <rect x={526 - lw} y={y + 18} width={lw} height={44} rx={10} fill="#3D7BFF" opacity={r.win === 'left' ? 1 : 0.55} />
            {/* Right orange bar growing right from center */}
            <rect x={554} y={y + 18} width={rw} height={44} rx={10} fill="#FF7A30" opacity={r.win === 'right' ? 1 : 0.55} />

            {/* Scores & Winner Checkmarks */}
            <text x={144} y={y + 49} textAnchor="end" fill={r.win === 'left' ? '#FFFFFF' : '#64748B'} fontSize={28} fontFamily="monospace" fontWeight={900}>
              {r.left}
            </text>
            <text x={936} y={y + 49} fill={r.win === 'right' ? '#FFFFFF' : '#64748B'} fontSize={28} fontFamily="monospace" fontWeight={900}>
              {r.right}
            </text>

            {r.win === 'left' ? (
              <g transform={`translate(76, ${y + 40})`}>
                <circle cx={0} cy={0} r={16} fill="#3D7BFF" />
                <path d="M -7 0 L -2 6 L 8 -6" fill="none" stroke="#FFFFFF" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            ) : (
              <g transform={`translate(1004, ${y + 40})`}>
                <circle cx={0} cy={0} r={16} fill="#FF7A30" />
                <path d="M -7 0 L -2 6 L 8 -6" fill="none" stroke="#FFFFFF" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}
          </g>
        );
      })}
    </HeroStage>
  );
};

/** look-28: 3D Map Route — clean light 3D mobile map city + animated blue route + red pin + trip card */
const SigLook28MapRoute: SignatureComponent = ({ frame, width, height }) => {
  const routeProg = easeOutCubic(clamp01(frame / 48));
  const pinDrop = easeOutCubic(clamp01((frame - 32) / 18));
  const gpsPulse = 1 + Math.sin(frame * 0.14) * 0.25;

  return (
    <HeroStage
      id="look28"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.45)"
      defs={
        <linearGradient id="h28-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EEF0F3" />
          <stop offset="40%" stopColor="#E4E9EE" />
          <stop offset="100%" stopColor="#DCE3EA" />
        </linearGradient>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h28-sky)" />

      {/* River cutting diagonally across map */}
      <path d="M 28 640 C 310 590 660 720 1052 570 L 1052 675 C 660 820 310 695 28 745 Z" fill="#8EC6EE" />
      {/* Green Park block */}
      <polygon points="90,460 360,390 470,510 210,590" fill="#C9E5BD" />
      {[
        [170, 490],
        [240, 465],
        [310, 445],
        [265, 520],
        [355, 495],
      ].map(([tx, ty], i) => (
        <circle key={i} cx={tx} cy={ty} r={22} fill="#9FCF8E" stroke="#86BC74" strokeWidth={2} />
      ))}

      {/* Clean Road Grid */}
      <path d="M 28 910 L 1052 450" stroke="#F7F7F5" strokeWidth={34} />
      <path d="M 160 260 L 820 1216" stroke="#F7F7F5" strokeWidth={28} />
      <path d="M 28 530 L 1052 980" stroke="#FFE3A3" strokeWidth={30} />
      <path d="M 480 260 L 1052 720" stroke="#F7F7F5" strokeWidth={22} />

      {/* Isometric Off-White City Buildings */}
      <IsoBox x={-170} y={-110} z={0} dx={85} dy={75} dz={68} cx={540} cy={610} topColor="#FBFBFA" leftColor="#ECEAE4" rightColor="#D8D5CD" />
      <IsoBox x={-40} y={-160} z={0} dx={95} dy={80} dz={112} cx={540} cy={610} topColor="#FFFFFF" leftColor="#ECEAE4" rightColor="#D4D1C8" />
      <IsoBox x={110} y={-120} z={0} dx={80} dy={70} dz={86} cx={540} cy={610} topColor="#FBFBFA" leftColor="#E6E3DC" rightColor="#CFCCC3" />
      <IsoBox x={-210} y={70} z={0} dx={90} dy={80} dz={56} cx={540} cy={780} topColor="#FBFBFA" leftColor="#ECEAE4" rightColor="#D8D5CD" />
      <IsoBox x={70} y={80} z={0} dx={110} dy={85} dz={94} cx={540} cy={780} topColor="#FFFFFF" leftColor="#E8E5DE" rightColor="#D0CDC4" />
      <IsoBox x={210} y={-30} z={0} dx={80} dy={80} dz={72} cx={540} cy={780} topColor="#FBFBFA" leftColor="#ECEAE4" rightColor="#D6D3CB" />

      {/* Animated Google-Maps Blue Route with White Casing */}
      <path
        d="M 190 950 L 430 835 L 550 675 L 710 595 L 845 430"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={22}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="1100"
        strokeDashoffset={1100 * (1 - routeProg)}
      />
      <path
        d="M 190 950 L 430 835 L 550 675 L 710 595 L 845 430"
        fill="none"
        stroke="#1A73E8"
        strokeWidth={13}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="1100"
        strokeDashoffset={1100 * (1 - routeProg)}
      />

      {/* Origin Pulsing Blue GPS Dot */}
      <circle cx={190} cy={950} r={24 * gpsPulse} fill="rgba(26,115,232,0.24)" />
      <circle cx={190} cy={950} r={14} fill="#1A73E8" stroke="#FFFFFF" strokeWidth={5} />

      {/* Destination Red Drop Pin */}
      <g transform={`translate(845, ${(420 - (1 - pinDrop) * 56).toFixed(1)})`}>
        <ellipse cx={0} cy={14} rx={18} ry={8} fill="rgba(15,23,42,0.22)" />
        <path d="M 0 10 C -30 -24 -30 -64 0 -64 C 30 -64 30 -24 0 10 Z" fill="#EA4335" stroke="#FFFFFF" strokeWidth={4} />
        <circle cx={0} cy={-36} r={11} fill="#FFFFFF" />
      </g>

      {/* Clean Map Labels */}
      <g transform="translate(86, 892)">
        <rect x={0} y={0} width={152} height={38} rx={19} fill="rgba(255,255,255,0.92)" />
        <text x={76} y={26} textAnchor="middle" fill="#1E293B" fontSize={19} fontFamily="sans-serif" fontWeight={800}>
          Your Location
        </text>
      </g>
      <g transform="translate(720, 314)">
        <rect x={0} y={0} width={250} height={44} rx={22} fill="rgba(255,255,255,0.96)" stroke="#FECACA" strokeWidth={2} />
        <text x={125} y={29} textAnchor="middle" fill="#DC2626" fontSize={21} fontFamily="sans-serif" fontWeight={900}>
          Central Hub · Goal
        </text>
      </g>

      {/* Floating Bottom Trip Card */}
      <rect x={76} y={1034} width={928} height={140} rx={28} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={2} />
      <text x={118} y={1104} fill="#121417" fontSize={52} fontFamily="sans-serif" fontWeight={900} letterSpacing={-1}>
        12 min
      </text>
      <text x={324} y={1102} fill="#1A73E8" fontSize={28} fontFamily="monospace" fontWeight={800}>
        (4.8 km)
      </text>
      <text x={118} y={1144} fill="#64748B" fontSize={22} fontFamily="sans-serif" fontWeight={600}>
        Fastest route via River Bridge · Light traffic
      </text>
      <rect x={796} y={1068} width={172} height={70} rx={35} fill="#1A73E8" />
      <text x={882} y={1112} textAnchor="middle" fill="#FFFFFF" fontSize={25} fontFamily="sans-serif" fontWeight={900}>
        GO NOW
      </text>
    </HeroStage>
  );
};

/** look-29: Exploded Teardown — graphite studio 3D exploded hardware layers + orange numbered spec callouts */
const SigLook29Exploded: SignatureComponent = ({ frame, width, height }) => {
  const sep = easeOutCubic(clamp01(frame / 42)) * 34;
  const cx = 330;
  const baseCy = 980;
  const layers = [
    { num: '01', name: 'Top Keycap Shell', spec: 'PBT MATTE · 1.4MM', z: 260 + sep * 2.4, dz: 24, top: '#F1F5F9', left: '#CBD5E1', right: '#94A3B8', callY: 382 },
    { num: '02', name: 'Switch Plate', spec: 'ANODIZED ALU · ORANGE', z: 195 + sep * 1.8, dz: 18, top: '#FF5A2A', left: '#EA580C', right: '#C2410C', callY: 516 },
    { num: '03', name: 'Logic PCB', spec: '4-LAYER · ARM M4', z: 130 + sep * 1.2, dz: 16, top: '#14B8A6', left: '#0D9488', right: '#0F766E', callY: 650 },
    { num: '04', name: 'Li-Po Cell', spec: '4000 MAH · 3.85V', z: 68 + sep * 0.6, dz: 18, top: '#64748B', left: '#475569', right: '#334155', callY: 784 },
    { num: '05', name: 'CNC Chassis', spec: '6063 ALUMINUM BASE', z: 0, dz: 26, top: '#334155', left: '#1E293B', right: '#0F172A', callY: 918 },
  ];

  return (
    <HeroStage
      id="look29"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.28)"
      defs={
        <radialGradient id="h29-bg" cx="38%" cy="48%" r="65%">
          <stop offset="0%" stopColor="#2A2D33" />
          <stop offset="100%" stopColor="#0A0A0C" />
        </radialGradient>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h29-bg)" />

      {/* Central vertical assembly guide axis */}
      <line x1={cx} y1={310} x2={cx} y2={1040} stroke="rgba(255,255,255,0.22)" strokeWidth={2} strokeDasharray="7 7" />

      {/* Ground shadow */}
      <IsoShadow x={-110} y={-110} dx={220} dy={220} cx={cx} cy={baseCy + 18} opacity={0.48} />

      {/* Exploded hardware layers from bottom to top */}
      {[...layers].reverse().map((l) => (
        <IsoBox
          key={l.num}
          x={-105}
          y={-105}
          z={l.z}
          dx={210}
          dy={210}
          dz={l.dz}
          cx={cx}
          cy={baseCy}
          topColor={l.top}
          leftColor={l.left}
          rightColor={l.right}
          stroke="rgba(255,255,255,0.16)"
          strokeWidth={1.5}
        />
      ))}

      {/* Right Column Numbered Spec Callouts */}
      {layers.map((l) => {
        const [ax, ay] = isoProject(105, -20, l.z + l.dz / 2, cx, baseCy);
        return (
          <g key={l.num}>
            <polyline
              points={`${ax.toFixed(1)},${ay.toFixed(1)} 565,${l.callY} 618,${l.callY}`}
              fill="none"
              stroke="#64748B"
              strokeWidth={2}
            />
            <circle cx={ax} cy={ay} r={5.5} fill="#FFFFFF" stroke="#FF5A2A" strokeWidth={2.5} />
            <text x={632} y={l.callY - 8} fill="#FF5A2A" fontSize={22} fontFamily="monospace" fontWeight={900}>
              {l.num}
            </text>
            <text x={674} y={l.callY - 8} fill="#ECEEF1" fontSize={26} fontFamily="sans-serif" fontWeight={800}>
              {l.name}
            </text>
            <text x={674} y={l.callY + 22} fill="#A3A8B0" fontSize={17} fontFamily="monospace" fontWeight={600}>
              {l.spec}
            </text>
          </g>
        );
      })}

      {/* Bottom-left Teardown Title Block */}
      <rect x={76} y={1086} width={12} height={74} rx={4} fill="#FF5A2A" />
      <text x={106} y={1122} fill="#ECEEF1" fontSize={36} fontFamily="sans-serif" fontWeight={900}>
        5 layers, opened
      </text>
      <text x={106} y={1154} fill="#A3A8B0" fontSize={19} fontFamily="monospace" fontWeight={700} letterSpacing={2}>
        HARDWARE TEARDOWN · SCALE 1:1
      </text>
    </HeroStage>
  );
};

/** look-30: Ink Wash — handmade washi paper + sumi-e mountains + vertical title + vermilion hanko seal */
const SigLook30InkWash: SignatureComponent = ({ frame, width, height }) => {
  const mist = Math.sin(frame * 0.03) * 24;
  const sealPop = easeOutCubic(clamp01((frame - 16) / 22));

  return (
    <HeroStage
      id="look30"
      width={width}
      height={height}
      borderColor="rgba(27,26,24,0.22)"
      defs={
        <>
          <linearGradient id="h30-paper" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F3EFE6" />
            <stop offset="100%" stopColor="#E6DFD1" />
          </linearGradient>
          <linearGradient id="h30-mt1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1B1A18" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#1B1A18" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="h30-mt2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1B1A18" stopOpacity="0.56" />
            <stop offset="100%" stopColor="#1B1A18" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="h30-mt3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1B1A18" stopOpacity="0.88" />
            <stop offset="100%" stopColor="#1B1A18" stopOpacity="0.32" />
          </linearGradient>
        </>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h30-paper)" />

      {/* Soft Ink Sun / Moon Wash */}
      <circle cx={310} cy={470} r={96} fill="#C82824" opacity={0.14} />
      <circle cx={310} cy={470} r={62} fill="#C82824" opacity={0.22} />

      {/* Layered Sumi-e Mountains */}
      <path
        d={`M 28 1216 L 28 730 Q ${210 + mist} 470 420 670 T 790 560 T 1052 720 L 1052 1216 Z`}
        fill="url(#h30-mt1)"
      />
      <path
        d={`M 28 1216 L 28 860 Q ${280 - mist} 620 530 790 T 910 680 L 1052 820 L 1052 1216 Z`}
        fill="url(#h30-mt2)"
      />
      <path
        d={`M 28 1216 L 28 1005 Q ${220 + mist * 0.6} 820 470 960 T 860 920 L 1052 1020 L 1052 1216 Z`}
        fill="url(#h30-mt3)"
      />

      {/* Drifting Pale Mist Ribbons */}
      <ellipse cx={420 + mist} cy={870} rx={360} ry={42} fill="#F3EFE6" opacity={0.55} />
      <ellipse cx={690 - mist} cy={1010} rx={340} ry={38} fill="#F3EFE6" opacity={0.48} />

      {/* Ink Brush Pine Branch top-left */}
      <path d="M 28 360 Q 160 390 280 352 Q 350 330 412 344" fill="none" stroke="#1B1A18" strokeWidth={8} strokeLinecap="round" opacity={0.82} />
      <path d="M 180 374 Q 230 415 290 422" fill="none" stroke="#1B1A18" strokeWidth={5} strokeLinecap="round" opacity={0.76} />

      {/* Subtle Flying Cranes */}
      {[
        [490, 460, 1],
        [540, 430, 0.8],
        [585, 455, 0.7],
      ].map(([bx, by, sc], i) => (
        <path
          key={i}
          d={`M ${bx - 18 * sc} ${by} Q ${bx - 6 * sc} ${by - 12 * sc} ${bx} ${by} Q ${bx + 6 * sc} ${by - 12 * sc} ${bx + 18 * sc} ${by}`}
          fill="none"
          stroke="#1B1A18"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ))}

      {/* Vertical Vector Brush Calligraphy Column right side (font-independent sumi-e strokes) */}
      <line x1={942} y1={332} x2={942} y2={880} stroke="rgba(27,26,24,0.32)" strokeWidth={2} />
      <g fill="none" stroke="#1B1A18" strokeLinecap="round" strokeLinejoin="round">
        {/* Brush glyph 1 (Mountain 山) */}
        <path d="M 878 364 L 878 430 M 844 388 L 844 430 L 912 426 L 912 384" strokeWidth={8} />
        {/* Brush glyph 2 (Water 水) */}
        <path d="M 878 468 L 878 544 L 866 534 M 842 496 L 862 492 L 844 528 M 910 486 L 888 504 L 914 532" strokeWidth={7.5} />
        {/* Brush glyph 3 (Mist / Sky 天) */}
        <path d="M 848 584 L 908 580 M 840 612 L 916 608 M 878 584 Q 876 628 844 654 M 878 614 Q 892 638 914 654" strokeWidth={7.5} />
        {/* Brush glyph 4 (Spirit 心) */}
        <path d="M 846 704 Q 842 722 836 732 M 860 698 Q 862 738 898 738 L 906 724 M 878 692 L 886 704 M 908 698 L 918 714" strokeWidth={7.5} />
      </g>

      {/* Vermilion Red Hanko Seal Stamp (vector carved seal emblem) */}
      <g transform={`translate(838, 792) scale(${(0.85 + 0.15 * sealPop).toFixed(3)})`} opacity={sealPop}>
        <rect x={0} y={0} width={80} height={80} rx={8} fill="#C82824" />
        <rect x={8} y={8} width={64} height={64} fill="none" stroke="#F8F4EC" strokeWidth={3} />
        <path
          d="M 22 22 V 58 M 22 36 H 38 M 22 52 H 38 M 46 22 H 58 V 44 H 46 Z M 46 22 V 58"
          fill="none"
          stroke="#F8F4EC"
          strokeWidth={4}
          strokeLinecap="square"
        />
      </g>
    </HeroStage>
  );
};

/** look-31: Paper Desk — top-down green cutting mat + printed documentary evidence + red marker circle */
const SigLook31PaperDesk: SignatureComponent = ({ frame, width, height }) => {
  const circleDraw = easeOutCubic(clamp01((frame - 12) / 30));
  const hiDraw = easeOutCubic(clamp01((frame - 24) / 26));

  return (
    <HeroStage
      id="look31"
      width={width}
      height={height}
      borderColor="rgba(236,232,180,0.45)"
      defs={
        <>
          <radialGradient id="h31-mat" cx="50%" cy="48%" r="65%">
            <stop offset="0%" stopColor="#327354" />
            <stop offset="100%" stopColor="#245A40" />
          </radialGradient>
          <pattern id="h31-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#ECE8B4" strokeWidth={1.1} opacity={0.26} />
          </pattern>
        </>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h31-mat)" />
      <rect x={28} y={260} width={1024} height={956} fill="url(#h31-grid)" />

      {/* Cutting mat ruler numbers along top */}
      {[10, 20, 30, 40, 50, 60, 70, 80].map((n, i) => (
        <text key={n} x={116 + i * 116} y={294} fill="#ECE8B4" fontSize={16} fontFamily="monospace" fontWeight={700} opacity={0.62}>
          {n}
        </text>
      ))}

      {/* Back tilted evidence sheet */}
      <g transform="translate(545, 760) rotate(5)">
        <rect x={-350} y={-340} width={700} height={680} rx={6} fill="rgba(0,0,0,0.28)" transform="translate(10, 14)" />
        <rect x={-350} y={-340} width={700} height={680} rx={6} fill="#F4EFE2" stroke="#D6CFC0" strokeWidth={2} />
      </g>

      {/* Main Printed Documentary Report */}
      <g transform="translate(520, 742) rotate(-2.5)">
        <rect x={-360} y={-355} width={720} height={710} rx={6} fill="rgba(0,0,0,0.3)" transform="translate(12, 16)" />
        <rect x={-360} y={-355} width={720} height={710} rx={6} fill="#FDFBF5" stroke="#E2DCD0" strokeWidth={2} />

        {/* Document masthead */}
        <text x={-310} y={-292} fill="#64748B" fontSize={18} fontFamily="monospace" fontWeight={800} letterSpacing={3}>
          EXHIBIT A · FIELD REPORT 2026
        </text>
        <line x1={-310} y1={-274} x2={310} y2={-274} stroke="#1E293B" strokeWidth={3} />
        <text x={-310} y={-216} fill="#0F172A" fontSize={40} fontFamily="serif" fontWeight={900}>
          Key Finding on Cost Surge
        </text>

        {/* Yellow highlighter sweep */}
        <rect x={-314} y={-172} width={540 * hiDraw} height={34} rx={4} fill="rgba(250,204,21,0.58)" />
        <text x={-310} y={-146} fill="#1E293B" fontSize={24} fontFamily="serif" fontWeight={700}>
          Operating costs rose 3.4x faster than baseline
        </text>
        <text x={-310} y={-106} fill="#475569" fontSize={22} fontFamily="serif">
          across all audited regional hubs during Q4.
        </text>

        {/* Embedded Evidence Mini-Chart */}
        <rect x={-310} y={-56} width={620} height={240} rx={8} fill="#F1F5F9" stroke="#CBD5E1" strokeWidth={1.5} />
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const bh = [48, 62, 74, 96, 134, 186][i];
          return (
            <rect
              key={i}
              x={-268 + i * 94}
              y={156 - bh}
              width={56}
              height={bh}
              rx={4}
              fill={i === 5 ? '#DC2626' : '#334155'}
            />
          );
        })}

        {/* Hand-drawn Red Marker Circle around final spike */}
        <ellipse
          cx={230}
          cy={62}
          rx={72}
          ry={116}
          fill="none"
          stroke="#DC2626"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray="620"
          strokeDashoffset={620 * (1 - circleDraw)}
          transform="rotate(-8, 230, 62)"
        />

        {/* Bottom printed text bars */}
        <rect x={-310} y={222} width={580} height={14} rx={4} fill="#CBD5E1" />
        <rect x={-310} y={252} width={490} height={14} rx={4} fill="#CBD5E1" />
        <rect x={-310} y={282} width={360} height={14} rx={4} fill="#CBD5E1" />
      </g>

      {/* Pinned Yellow Sticky Note + Red Evidence String */}
      <path d="M 178 360 Q 520 430 886 356" fill="none" stroke="#DC2626" strokeWidth={4} />
      <circle cx={178} cy={360} r={14} fill="#DC2626" stroke="#FFFFFF" strokeWidth={3} />
      <g transform="translate(806, 336) rotate(7)">
        <rect x={0} y={0} width={186} height={164} rx={4} fill="#FDE047" stroke="#EAB308" strokeWidth={2} />
        <circle cx={90} cy={22} r={12} fill="#DC2626" stroke="#FFFFFF" strokeWidth={2.5} />
        <text x={22} y={76} fill="#1E293B" fontSize={23} fontFamily="sans-serif" fontWeight={800}>
          VERIFY #3.4x
        </text>
        <text x={22} y={114} fill="#475569" fontSize={20} fontFamily="sans-serif" fontWeight={700}>
          Source: Q4
        </text>
      </g>
    </HeroStage>
  );
};

/** look-32: Headline Highlight — dark article wall + tilted news sheet + lime highlighter + proof quote */
const SigLook32Highlight: SignatureComponent = ({ frame, width, height }) => {
  const hi1 = easeOutCubic(clamp01((frame - 10) / 24));
  const hi2 = easeOutCubic(clamp01((frame - 26) / 24));
  const quotePop = easeOutCubic(clamp01((frame - 34) / 20));

  return (
    <HeroStage
      id="look32"
      width={width}
      height={height}
      borderColor="rgba(163,230,53,0.38)"
    >
      <rect x={28} y={260} width={1024} height={956} fill="#15181C" />

      {/* Out-of-focus background article cards wall */}
      {[
        [44, 290, 310, 260],
        [384, 280, 320, 240],
        [734, 296, 300, 260],
        [52, 910, 300, 270],
        [720, 920, 310, 260],
      ].map(([ax, ay, aw, ah], i) => (
        <g key={i} opacity={0.14}>
          <rect x={ax} y={ay} width={aw} height={ah} rx={12} fill="#E9EAEC" />
          <rect x={ax + 20} y={ay + 24} width={aw - 40} height={24} rx={4} fill="#94A3B8" />
          <rect x={ax + 20} y={ay + 64} width={aw - 80} height={14} rx={4} fill="#94A3B8" />
          <rect x={ax + 20} y={ay + 90} width={aw - 60} height={14} rx={4} fill="#94A3B8" />
        </g>
      ))}

      {/* Main Tilted News Article Sheet */}
      <g transform="translate(534, 710) rotate(-3)">
        <rect x={-405} y={-340} width={810} height={660} rx={18} fill="rgba(0,0,0,0.48)" transform="translate(14, 18)" />
        <rect x={-405} y={-340} width={810} height={660} rx={18} fill="#FCFCFA" stroke="#D9DBDE" strokeWidth={2} />

        {/* Masthead */}
        <text x={-355} y={-282} fill="#64748B" fontSize={19} fontFamily="monospace" fontWeight={800} letterSpacing={3}>
          THE GLOBAL DISPATCH · INVESTIGATIVE DESK
        </text>
        <line x1={-355} y1={-262} x2={355} y2={-262} stroke="#16181B" strokeWidth={3} />

        {/* Bold Headline */}
        <text x={-355} y={-196} fill="#16181B" fontSize={44} fontFamily="serif" fontWeight={900}>
          Inside the Algorithm Shift That
        </text>
        <text x={-355} y={-142} fill="#16181B" fontSize={44} fontFamily="serif" fontWeight={900}>
          Rewrote Creator Economics
        </text>
        <text x={-355} y={-98} fill="#64748B" fontSize={20} fontFamily="sans-serif" fontWeight={600}>
          By Editorial Staff · Updated 18 minutes ago
        </text>

        {/* Body lines + Animated Lime-Green Highlighter Swipes */}
        <rect x={-355} y={-64} width={680} height={14} rx={4} fill="#E2E8F0" />
        <rect x={-358} y={-24} width={690 * hi1} height={44} rx={6} fill="#BEF264" />
        <text x={-350} y={8} fill="#16181B" fontSize={28} fontFamily="serif" fontWeight={800}>
          Internal memos confirm organic reach dropped 62%
        </text>

        <rect x={-358} y={36} width={540 * hi2} height={44} rx={6} fill="#BEF264" />
        <text x={-350} y={68} fill="#16181B" fontSize={28} fontFamily="serif" fontWeight={800}>
          within 48 hours of the quiet policy rollout.
        </text>

        <rect x={-355} y={114} width={660} height={14} rx={4} fill="#E2E8F0" />
        <rect x={-355} y={146} width={610} height={14} rx={4} fill="#E2E8F0" />
        <rect x={-355} y={178} width={520} height={14} rx={4} fill="#E2E8F0" />
      </g>

      {/* Pop-up Source Proof Card lower-right */}
      <g transform={`translate(460, ${(960 + (1 - quotePop) * 40).toFixed(1)})`} opacity={quotePop}>
        <rect x={0} y={0} width={548} height={192} rx={22} fill="#0F172A" stroke="#A3E635" strokeWidth={3} />
        <rect x={24} y={24} width={162} height={32} rx={16} fill="rgba(163,230,53,0.18)" />
        <text x={105} y={46} textAnchor="middle" fill="#A3E635" fontSize={17} fontFamily="monospace" fontWeight={800}>
          VERIFIED SOURCE
        </text>
        <text x={24} y={100} fill="#F8FAFC" fontSize={25} fontFamily="sans-serif" fontWeight={800}>
          “Confirmed in Q3 Filing · Page 14”
        </text>
        <text x={24} y={142} fill="#94A3B8" fontSize={20} fontFamily="monospace">
          DOC ID #8841-B · ARCHIVED
        </text>
      </g>
    </HeroStage>
  );
};

/** look-33: Stat Chart — dark financial terminal big KPI + glowing line turning orange at inflection point */
const SigLook33StatChart: SignatureComponent = ({ frame, width, height }) => {
  const prog = easeOutCubic(clamp01(frame / 50));
  const val = (1.12 + prog * 3.7).toFixed(2);
  const splitX = 635;

  return (
    <HeroStage
      id="look33"
      width={width}
      height={height}
      borderColor="rgba(255,107,43,0.34)"
      defs={
        <>
          <linearGradient id="h33-area-o" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF6B2B" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#FF6B2B" stopOpacity="0" />
          </linearGradient>
          <clipPath id="h33-pre">
            <rect x={80} y={480} width={splitX - 80} height={600} />
          </clipPath>
          <clipPath id="h33-post">
            <rect x={splitX} y={480} width={400} height={600} />
          </clipPath>
        </>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="#0A0B0D" />

      {/* Top Financial KPI Block */}
      <text x={78} y={326} fill="#8B9098" fontSize={22} fontFamily="monospace" fontWeight={800} letterSpacing={3}>
        ANNUALIZED REVENUE · USD
      </text>
      <text x={78} y={438} fill="#F4F5F6" fontSize={112} fontFamily="monospace" fontWeight={900} letterSpacing={-4}>
        ${val}M
      </text>
      <rect x={630} y={364} width={196} height={54} rx={14} fill="rgba(255,107,43,0.18)" stroke="#FF6B2B" strokeWidth={2} />
      <text x={728} y={400} textAnchor="middle" fill="#FF6B2B" fontSize={28} fontFamily="monospace" fontWeight={900}>
        +214.6%
      </text>

      {/* Subtle 7% white terminal grid */}
      {[540, 670, 800, 930, 1060].map((gy, idx) => (
        <g key={gy}>
          <line x1={80} y1={gy} x2={992} y2={gy} stroke="rgba(255,255,255,0.08)" strokeWidth={1.5} />
          <text x={992} y={gy - 10} textAnchor="end" fill="#4A4F57" fontSize={18} fontFamily="monospace" fontWeight={700}>
            {['$5M', '$4M', '$3M', '$2M', '$1M'][idx]}
          </text>
        </g>
      ))}

      {/* Vertical Inflection Point Marker */}
      <line x1={splitX} y1={504} x2={splitX} y2={1060} stroke="#FF6B2B" strokeWidth={2.5} strokeDasharray="8 8" opacity={0.8} />
      <rect x={splitX - 116} y={472} width={232} height={42} rx={21} fill="#FF6B2B" />
      <text x={splitX} y={500} textAnchor="middle" fill="#0A0B0D" fontSize={19} fontFamily="monospace" fontWeight={900}>
        AI LAUNCH EVENT
      </text>

      {/* Area fill after inflection point */}
      <g clipPath="url(#h33-post)" opacity={prog}>
        <path
          d="M 635 840 L 745 735 L 855 628 L 968 538 L 968 1060 L 635 1060 Z"
          fill="url(#h33-area-o)"
        />
      </g>

      {/* Main Chart Line — White/Grey before inflection, Vivid Orange after */}
      <g clipPath="url(#h33-pre)">
        <path
          d="M 88 1018 L 220 992 L 355 964 L 495 928 L 635 840 L 745 735 L 855 628 L 968 538"
          fill="none"
          stroke="#CBD5E1"
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="1300"
          strokeDashoffset={1300 * (1 - prog)}
        />
      </g>
      <g clipPath="url(#h33-post)">
        <path
          d="M 88 1018 L 220 992 L 355 964 L 495 928 L 635 840 L 745 735 L 855 628 L 968 538"
          fill="none"
          stroke="#FF6B2B"
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="1300"
          strokeDashoffset={1300 * (1 - prog)}
        />
      </g>

      {/* Glowing Inflection & Peak Nodes */}
      <circle cx={splitX} cy={840} r={14} fill="#FF6B2B" stroke="#FFFFFF" strokeWidth={4} />
      <circle cx={968} cy={538} r={22} fill="rgba(255,107,43,0.3)" />
      <circle cx={968} cy={538} r={10} fill="#FFFFFF" stroke="#FF6B2B" strokeWidth={5} />

      {/* X-axis years & Source */}
      {['2021', '2022', '2023', '2024', '2025', '2026'].map((yr, idx) => (
        <text key={yr} x={100 + idx * 172} y={1106} fill="#8B9098" fontSize={21} fontFamily="monospace" fontWeight={700}>
          {yr}
        </text>
      ))}
      <text x={78} y={1166} fill="#4A4F57" fontSize={18} fontFamily="monospace" fontWeight={700}>
        SOURCE: TERMINAL ANALYTICS · REAL-TIME INDEX
      </text>
    </HeroStage>
  );
};

/** look-34: App Mockup — studio blue-grey sweep + sleek tilted smartphone + floating UI cards */
const SigLook34AppMockup: SignatureComponent = ({ frame, width, height }) => {
  const floatY = Math.sin(frame * 0.06) * 10;
  const pop = easeOutCubic(clamp01(frame / 36));

  return (
    <HeroStage
      id="look34"
      width={width}
      height={height}
      borderColor="rgba(148,163,184,0.45)"
      defs={
        <>
          <linearGradient id="h34-studio" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#CFD8E2" />
            <stop offset="55%" stopColor="#DFE6EE" />
            <stop offset="100%" stopColor="#C8D3DF" />
          </linearGradient>
          <radialGradient id="h34-spot" cx="50%" cy="46%" r="48%">
            <stop offset="0%" stopColor="#F8FAFC" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#DFE6EE" stopOpacity="0" />
          </radialGradient>
        </>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h34-studio)" />
      <circle cx={540} cy={720} r={420} fill="url(#h34-spot)" />

      {/* Ground studio shadow */}
      <ellipse cx={540} cy={1135} rx={210} ry={28} fill="rgba(15,23,42,0.16)" />

      {/* Center Sleek Smartphone */}
      <g transform={`translate(540, ${(734 + floatY * 0.5).toFixed(1)}) rotate(-3)`}>
        {/* Outer Titanium Bezel */}
        <rect x={-196} y={-376} width={392} height={752} rx={58} fill="#0F172A" stroke="#64748B" strokeWidth={7} />
        {/* Inner App Screen */}
        <rect x={-176} y={-356} width={352} height={712} rx={44} fill="#F8FAFC" />
        {/* Dynamic Island */}
        <rect x={-52} y={-338} width={104} height={24} rx={12} fill="#0F172A" />

        {/* App Header */}
        <text x={-144} y={-278} fill="#64748B" fontSize={18} fontFamily="sans-serif" fontWeight={700}>
          Good morning, Alex
        </text>
        <text x={-144} y={-240} fill="#0E1116" fontSize={30} fontFamily="sans-serif" fontWeight={900}>
          Portfolio Hub
        </text>
        <circle cx={128} cy={-258} r={22} fill="#2563EB" />

        {/* Primary Balance Card */}
        <rect x={-144} y={-206} width={288} height={164} rx={24} fill="#0F172A" />
        <text x={-118} y={-166} fill="#94A3B8" fontSize={17} fontFamily="monospace" fontWeight={700}>
          TOTAL BALANCE
        </text>
        <text x={-118} y={-114} fill="#FFFFFF" fontSize={44} fontFamily="monospace" fontWeight={900}>
          $28,450
        </text>
        <path d="M -118 -72 L -62 -86 L -12 -68 L 44 -102 L 116 -124" fill="none" stroke="#38BDF8" strokeWidth={5} strokeLinecap="round" />

        {/* Quick Action Pills */}
        {['Send', 'Swap', 'Earn'].map((act, i) => (
          <g key={act} transform={`translate(${-144 + i * 98}, -20)`}>
            <rect x={0} y={0} width={88} height={54} rx={16} fill="#E2E8F0" />
            <text x={44} y={34} textAnchor="middle" fill="#0F172A" fontSize={18} fontFamily="sans-serif" fontWeight={800}>
              {act}
            </text>
          </g>
        ))}

        {/* Recent Activity Rows */}
        {[
          { t: 'Stripe Pay', v: '+$4,200', c: '#16A34A' },
          { t: 'Cloud Host', v: '-$148', c: '#0F172A' },
          { t: 'Design Pro', v: '+$960', c: '#16A34A' },
        ].map((row, idx) => (
          <g key={row.t} transform={`translate(-144, ${58 + idx * 82})`}>
            <rect x={0} y={0} width={288} height={68} rx={18} fill="#FFFFFF" stroke="#E2E8F0" strokeWidth={2} />
            <circle cx={34} cy={34} r={16} fill={idx === 1 ? '#F1F5F9' : '#DCFCE7'} />
            <text x={64} y={40} fill="#0F172A" fontSize={19} fontFamily="sans-serif" fontWeight={800}>
              {row.t}
            </text>
            <text x={270} y={40} textAnchor="end" fill={row.c} fontSize={19} fontFamily="monospace" fontWeight={900}>
              {row.v}
            </text>
          </g>
        ))}
      </g>

      {/* Floating Pop-out UI Card 1 (Top-Left) */}
      <g transform={`translate(66, ${(388 - floatY).toFixed(1)}) scale(${(0.86 + 0.14 * pop).toFixed(3)})`}>
        <rect x={0} y={0} width={274} height={116} rx={24} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={2} />
        <text x={24} y={44} fill="#64748B" fontSize={18} fontFamily="monospace" fontWeight={700}>
          MONTHLY GROWTH
        </text>
        <text x={24} y={92} fill="#16A34A" fontSize={40} fontFamily="monospace" fontWeight={900}>
          +38.4% ↑
        </text>
      </g>

      {/* Floating Pop-out UI Card 2 (Top-Right) */}
      <g transform={`translate(734, ${(468 + floatY).toFixed(1)}) scale(${(0.86 + 0.14 * pop).toFixed(3)})`}>
        <rect x={0} y={0} width={280} height={106} rx={24} fill="#0F172A" stroke="#38BDF8" strokeWidth={2.5} />
        <circle cx={42} cy={53} r={18} fill="#2563EB" />
        <text x={74} y={46} fill="#FFFFFF" fontSize={21} fontFamily="sans-serif" fontWeight={800}>
          Instant Sync
        </text>
        <text x={74} y={76} fill="#94A3B8" fontSize={17} fontFamily="monospace">
          v4.2 · 99.9% UP
        </text>
      </g>

      {/* Floating Pop-out UI Card 3 (Bottom-Right) */}
      <g transform={`translate(706, ${(940 - floatY * 0.8).toFixed(1)}) scale(${(0.86 + 0.14 * pop).toFixed(3)})`}>
        <rect x={0} y={0} width={306} height={124} rx={24} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={2} />
        <text x={26} y={46} fill="#0F172A" fontSize={22} fontFamily="sans-serif" fontWeight={900}>
          Goal Reached 🎉
        </text>
        <rect x={26} y={70} width={254} height={16} rx={8} fill="#E2E8F0" />
        <rect x={26} y={70} width={224} height={16} rx={8} fill="#2563EB" />
      </g>
    </HeroStage>
  );
};

/** look-35: Screen-Recording Zoom — soft mint backdrop + dark macOS window + magnified CTA button + clicking cursor */
const SigLook35ScreenZoom: SignatureComponent = ({ frame, width, height }) => {
  const glide = easeOutCubic(clamp01(frame / 42));
  const ripple = ((frame % 40) / 40);
  const curX = interpolate(glide, [0, 1], [340, 742]);
  const curY = interpolate(glide, [0, 1], [940, 814]);

  return (
    <HeroStage
      id="look35"
      width={width}
      height={height}
      borderColor="rgba(15,118,110,0.32)"
      defs={
        <linearGradient id="h35-mint" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E3EFE9" />
          <stop offset="55%" stopColor="#B8D7D6" />
          <stop offset="100%" stopColor="#9CC4BD" />
        </linearGradient>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h35-mint)" />

      {/* Dark-Mode macOS Desktop Window */}
      <rect x={82} y={326} width={916} height={630} rx={22} fill="rgba(15,23,42,0.28)" transform="translate(0, 18)" />
      <rect x={82} y={326} width={916} height={630} rx={22} fill="#1B1C20" stroke="#33353B" strokeWidth={2.5} />

      {/* Window Titlebar */}
      <path d="M 82 348 Q 82 326 104 326 H 976 Q 998 326 998 348 V 382 H 82 Z" fill="#212227" />
      <circle cx={116} cy={354} r={9} fill="#FF5F56" />
      <circle cx={146} cy={354} r={9} fill="#FFBD2E" />
      <circle cx={176} cy={354} r={9} fill="#27C93F" />
      <rect x={340} y={340} width={400} height={28} rx={8} fill="#1B1C20" />
      <text x={540} y={360} textAnchor="middle" fill="#9CA3AF" fontSize={16} fontFamily="monospace">
        studio.app / workflow / deploy
      </text>

      {/* Left Sidebar */}
      <rect x={82} y={382} width={206} height={574} fill="#212227" />
      <line x1={288} y1={382} x2={288} y2={956} stroke="#33353B" strokeWidth={2} />
      {['Overview', 'Automations', 'Analytics', 'Deployments', 'Settings'].map((nav, i) => (
        <g key={nav} transform={`translate(102, ${412 + i * 58})`}>
          <rect x={0} y={0} width={166} height={42} rx={10} fill={i === 3 ? '#2D3039' : 'transparent'} />
          <text x={18} y={27} fill={i === 3 ? '#FFFFFF' : '#9CA3AF'} fontSize={19} fontFamily="sans-serif" fontWeight={i === 3 ? 800 : 600}>
            {nav}
          </text>
        </g>
      ))}

      {/* Main Workspace Panels */}
      <rect x={320} y={414} width={644} height={184} rx={16} fill="#26272C" stroke="#33353B" strokeWidth={2} />
      <text x={352} y={462} fill="#FFFFFF" fontSize={26} fontFamily="sans-serif" fontWeight={800}>
        Production Release v2.8
      </text>
      <text x={352} y={498} fill="#9CA3AF" fontSize={19} fontFamily="monospace">
        All 42 checks passed · Ready to publish globally
      </text>
      <rect x={352} y={528} width={580} height={14} rx={7} fill="#1B1C20" />
      <rect x={352} y={528} width={510} height={14} rx={7} fill="#10B981" />

      <rect x={320} y={624} width={304} height={294} rx={16} fill="#26272C" stroke="#33353B" strokeWidth={2} />
      <rect x={346} y={656} width={180} height={18} rx={6} fill="#3F424D" />
      <rect x={346} y={692} width={240} height={14} rx={6} fill="#33353B" />
      <rect x={346} y={720} width={210} height={14} rx={6} fill="#33353B" />

      {/* Zoomed-in Spotlight Callout Card on Right */}
      <rect x={542} y={688} width={452} height={296} rx={28} fill="rgba(0,0,0,0.45)" transform="translate(0, 14)" />
      <rect x={542} y={688} width={452} height={296} rx={28} fill="#1E2028" stroke="#38BDF8" strokeWidth={4} />
      <text x={576} y={736} fill="#38BDF8" fontSize={18} fontFamily="monospace" fontWeight={800} letterSpacing={2}>
        ZOOM 2.4× · STEP 02
      </text>

      {/* Magnified Primary CTA Button */}
      <rect x={578} y={770} width={380} height={92} rx={20} fill="#0EA5E9" />
      <text x={768} y={827} textAnchor="middle" fill="#FFFFFF" fontSize={32} fontFamily="sans-serif" fontWeight={900}>
        Publish Now →
      </text>
      <text x={578} y={914} fill="#94A3B8" fontSize={19} fontFamily="monospace">
        Click to push live to all nodes
      </text>

      {/* Animated Click Ripple & Crisp Pointer Cursor */}
      <g transform={`translate(${curX.toFixed(1)}, ${curY.toFixed(1)})`}>
        <circle cx={0} cy={0} r={16 + ripple * 54} fill="none" stroke="#FFFFFF" strokeWidth={4} opacity={1 - ripple} />
        <polygon points="0,0 0,48 14,37 25,56 34,51 23,32 40,30" fill="#FFFFFF" stroke="#0F172A" strokeWidth={3.5} strokeLinejoin="round" />
      </g>

      {/* Bottom Tutorial Hint Pill */}
      <rect x={280} y={1064} width={520} height={74} rx={37} fill="#0F172A" opacity={0.92} />
      <text x={540} y={1110} textAnchor="middle" fill="#F8FAFC" fontSize={25} fontFamily="sans-serif" fontWeight={800}>
        Step 2: Click “Publish Now” to go live
      </text>
    </HeroStage>
  );
};

/** look-36: Timeline — cool off-white perspective grid + full-length timeline rail + standing milestone cards */
const SigLook36Timeline: SignatureComponent = ({ frame, width, height }) => {
  const prog = easeOutCubic(clamp01(frame / 48));
  const milestones = [
    { yr: '2021', title: 'Seed Launch', desc: 'First 10K users', x: 185, y: 925, cardY: 470, done: true },
    { yr: '2023', title: 'Global Scale', desc: '40+ countries', x: 420, y: 845, cardY: 600, done: true },
    { yr: '2025', title: 'AI Engine', desc: '10× faster core', x: 660, y: 762, cardY: 450, done: true },
    { yr: '2026', title: 'Where We Are', desc: '1M+ active now', x: 900, y: 680, cardY: 360, done: true, active: true },
  ];

  return (
    <HeroStage
      id="look36"
      width={width}
      height={height}
      borderColor="rgba(203,213,225,0.85)"
      defs={
        <linearGradient id="h36-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F5F6F8" />
          <stop offset="100%" stopColor="#E3E6EB" />
        </linearGradient>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h36-bg)" />

      {/* Subtle Perspective Floor Grid fading into horizon */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const y = 690 + i * 78;
        return <line key={i} x1={28} y1={y} x2={1052} y2={y} stroke="#CBD5E1" strokeWidth={1.5} opacity={0.35 + i * 0.08} />;
      })}
      {[-3, -2, -1, 0, 1, 2, 3].map((i) => (
        <line key={i} x1={540 + i * 110} y1={650} x2={540 + i * 280} y2={1216} stroke="#CBD5E1" strokeWidth={1.5} opacity={0.45} />
      ))}

      {/* Header */}
      <text x={78} y={334} fill="#0E1116" fontSize={36} fontFamily="sans-serif" fontWeight={900}>
        5-Year Journey
      </text>
      <text x={78} y={368} fill="#6A717C" fontSize={21} fontFamily="monospace" fontWeight={700}>
        MILESTONES FROM 2021 → TODAY
      </text>

      {/* Full-length Perspective Timeline Rail */}
      <line x1={96} y1={955} x2={988} y2={650} stroke="#B7BEC8" strokeWidth={12} strokeLinecap="round" />
      <line
        x1={96}
        y1={955}
        x2={96 + (988 - 96) * prog}
        y2={955 + (650 - 955) * prog}
        stroke="#0E1116"
        strokeWidth={12}
        strokeLinecap="round"
      />

      {/* Standing Milestone Cards & Stems */}
      {milestones.map((m, idx) => {
        const reveal = easeOutCubic(clamp01((frame - idx * 8) / 22));
        return (
          <g key={m.yr} opacity={reveal}>
            {/* Vertical Stem */}
            <line x1={m.x} y1={m.y} x2={m.x} y2={m.cardY + 130} stroke={m.active ? '#2563EB' : '#64748B'} strokeWidth={3} strokeDasharray="6 5" />
            {/* Node on Rail */}
            {m.active && <circle cx={m.x} cy={m.y} r={26} fill="rgba(37,99,235,0.22)" />}
            <circle cx={m.x} cy={m.y} r={14} fill={m.active ? '#2563EB' : '#0E1116'} stroke="#FFFFFF" strokeWidth={4} />
            {/* Year below rail */}
            <text x={m.x} y={m.y + 48} textAnchor="middle" fill={m.active ? '#2563EB' : '#0E1116'} fontSize={28} fontFamily="monospace" fontWeight={900}>
              {m.yr}
            </text>

            {/* Standing Card */}
            <g transform={`translate(${m.x - 108}, ${(m.cardY + (1 - reveal) * 24).toFixed(1)})`}>
              <rect
                x={0}
                y={0}
                width={216}
                height={132}
                rx={18}
                fill={m.active ? '#0E1116' : '#FFFFFF'}
                stroke={m.active ? '#2563EB' : '#CBD5E1'}
                strokeWidth={m.active ? 3 : 2}
              />
              <text x={20} y={40} fill={m.active ? '#60A5FA' : '#2563EB'} fontSize={17} fontFamily="monospace" fontWeight={800}>
                {m.active ? '● NOW' : `STEP 0${idx + 1}`}
              </text>
              <text x={20} y={76} fill={m.active ? '#FFFFFF' : '#0E1116'} fontSize={23} fontFamily="sans-serif" fontWeight={900}>
                {m.title}
              </text>
              <text x={20} y={108} fill={m.active ? '#CBD5E1' : '#6A717C'} fontSize={18} fontFamily="sans-serif" fontWeight={600}>
                {m.desc}
              </text>
            </g>
          </g>
        );
      })}
    </HeroStage>
  );
};

/** look-37: Glow Orb — calm minimalist near-black + breathing luminous rose-white orb + thin drifting rings */
const SigLook37GlowOrb: SignatureComponent = ({ frame, width, height }) => {
  const breathe = 1 + Math.sin(frame * 0.055) * 0.08;
  const drift = Math.sin(frame * 0.03) * 18;
  const drift2 = Math.cos(frame * 0.028) * 16;

  return (
    <HeroStage
      id="look37"
      width={width}
      height={height}
      borderColor="rgba(246,150,222,0.28)"
      defs={
        <>
          <radialGradient id="h37-bg" cx="50%" cy="44%" r="60%">
            <stop offset="0%" stopColor="#260A16" />
            <stop offset="55%" stopColor="#13050B" />
            <stop offset="100%" stopColor="#070304" />
          </radialGradient>
          <radialGradient id="h37-orb" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FBF6F8" stopOpacity="1" />
            <stop offset="28%" stopColor="#F696DE" stopOpacity="0.92" />
            <stop offset="58%" stopColor="#9D2C5C" stopOpacity="0.45" />
            <stop offset="82%" stopColor="#531829" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#070304" stopOpacity="0" />
          </radialGradient>
        </>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h37-bg)" />

      {/* 7 Delicate Thin Drifting Outline Circles (some clipped at edges) */}
      <circle cx={140 + drift} cy={420} r={148} fill="none" stroke="rgba(246,239,242,0.16)" strokeWidth={1.6} />
      <circle cx={930 - drift} cy={460} r={190} fill="none" stroke="rgba(246,239,242,0.14)" strokeWidth={1.6} />
      <circle cx={210 - drift2} cy={980} r={170} fill="none" stroke="rgba(246,239,242,0.12)" strokeWidth={1.5} />
      <circle cx={880 + drift2} cy={960} r={130} fill="none" stroke="rgba(246,239,242,0.16)" strokeWidth={1.5} />
      <circle cx={540} cy={650} r={245 * breathe} fill="none" stroke="rgba(246,239,242,0.22)" strokeWidth={1.5} />
      <circle cx={540} cy={650} r={330} fill="none" stroke="rgba(246,239,242,0.12)" strokeWidth={1.2} strokeDasharray="8 12" />

      {/* Breathing Luminous Orb above center */}
      <g transform={`translate(540, 650) scale(${breathe.toFixed(3)})`}>
        <circle cx={0} cy={0} r={240} fill="url(#h37-orb)" />
        <circle cx={0} cy={0} r={76} fill="#FBF6F8" opacity={0.92} />
      </g>

      {/* Calm Minimalist Single-Line Statement */}
      <text x={540} y={1020} textAnchor="middle" fill="#F6EFF2" fontSize={58} fontFamily="sans-serif" fontWeight={500} letterSpacing={-1.5}>
        Quiet clarity.
      </text>
      <text x={540} y={1068} textAnchor="middle" fill="rgba(246,239,242,0.48)" fontSize={20} fontFamily="monospace" letterSpacing={5}>
        BREATHE · FOCUS · BEGIN
      </text>
    </HeroStage>
  );
};

/** look-38: Frosted Glass UI — twilight bokeh backdrop + frosted glass search bar & stacked result cards */
const SigLook38FrostedGlass: SignatureComponent = ({ frame, width, height }) => {
  const drift = Math.sin(frame * 0.04) * 26;
  const cursorOn = Math.floor(frame / 14) % 2 === 0;
  const activeIdx = Math.floor((frame % 120) / 40) % 3;
  const results = [
    { title: 'Design System Tokens', sub: 'Workspace · Updated 2m ago', icon: '✦' },
    { title: 'Quarterly Metrics Deck', sub: 'Analytics · 14 slides', icon: '◈' },
    { title: 'Launch Video Script', sub: 'Studio · Ready to render', icon: '▶' },
    { title: 'Team Roadmap 2026', sub: 'Planning · Shared', icon: '◎' },
  ];

  return (
    <HeroStage
      id="look38"
      width={width}
      height={height}
      borderColor="rgba(255,255,255,0.34)"
      defs={
        <>
          <linearGradient id="h38-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0E2A3D" />
            <stop offset="50%" stopColor="#1F5A6E" />
            <stop offset="100%" stopColor="#162942" />
          </linearGradient>
          <radialGradient id="h38-coral" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF8A5C" stopOpacity="0.82" />
            <stop offset="100%" stopColor="#FF8A5C" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="h38-rose" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E3558A" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#E3558A" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="h38-sky" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#9FD8FF" stopOpacity="0.58" />
            <stop offset="100%" stopColor="#9FD8FF" stopOpacity="0" />
          </radialGradient>
        </>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h38-bg)" />

      {/* Warm Out-of-Focus Twilight Bokeh Orbs */}
      <circle cx={230 + drift} cy={430} r={260} fill="url(#h38-coral)" />
      <circle cx={850 - drift} cy={690} r={290} fill="url(#h38-rose)" />
      <circle cx={340 - drift * 0.7} cy={1040} r={250} fill="url(#h38-sky)" />

      {/* Frosted Glass Search Pill (85% width, rounded 48px) */}
      <rect x={102} y={376} width={876} height={110} rx={55} fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.55)" strokeWidth={2.5} />
      <circle cx={162} cy={431} r={20} fill="none" stroke="#F8F9FB" strokeWidth={4} />
      <line x1={177} y1={446} x2={192} y2={461} stroke="#F8F9FB" strokeWidth={4.5} strokeLinecap="round" />
      <text x={218} y={445} fill="#F8F9FB" fontSize={36} fontFamily="sans-serif" fontWeight={700}>
        How to build smarter workflow
      </text>
      <rect x={734} y={406} width={4} height={48} rx={2} fill="#9FD8FF" opacity={cursorOn ? 1 : 0.15} />
      <rect x={872} y={408} width={74} height={46} rx={14} fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} />
      <text x={909} y={438} textAnchor="middle" fill="#F8F9FB" fontSize={20} fontFamily="monospace" fontWeight={700}>
        ⌘K
      </text>

      {/* Stacked Frosted Glass Results Panel */}
      <rect x={102} y={518} width={876} height={588} rx={32} fill="rgba(15,23,42,0.34)" stroke="rgba(255,255,255,0.42)" strokeWidth={2.5} />
      {results.map((r, i) => {
        const y = 544 + i * 136;
        const isSel = i === activeIdx;
        return (
          <g key={r.title}>
            {isSel && (
              <rect
                x={124}
                y={y}
                width={832}
                height={118}
                rx={22}
                fill="rgba(255,255,255,0.22)"
                stroke="rgba(159,216,255,0.68)"
                strokeWidth={2}
              />
            )}
            <rect x={150} y={y + 23} width={72} height={72} rx={20} fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.38)" strokeWidth={1.8} />
            <text x={186} y={y + 69} textAnchor="middle" fill="#F8F9FB" fontSize={30} fontFamily="sans-serif">
              {r.icon}
            </text>
            <text x={248} y={y + 54} fill="#F8F9FB" fontSize={32} fontFamily="sans-serif" fontWeight={800}>
              {r.title}
            </text>
            <text x={248} y={y + 90} fill="rgba(248,249,251,0.72)" fontSize={22} fontFamily="sans-serif" fontWeight={600}>
              {r.sub}
            </text>
            {isSel && (
              <text x={920} y={y + 68} textAnchor="end" fill="#9FD8FF" fontSize={24} fontFamily="monospace" fontWeight={800}>
                OPEN ↵
              </text>
            )}
          </g>
        );
      })}
    </HeroStage>
  );
};

/** look-39: Apple One-Take — crisp light #EEEEEC stage + single morphing carrier card + red focal dot + bold headline */
const SigLook39AppleOneTake: SignatureComponent = ({ frame, width, height }) => {
  const morph = easeOutCubic(clamp01(frame / 44));
  const ringR = 110 + morph * 64;

  return (
    <HeroStage
      id="look39"
      width={width}
      height={height}
      borderColor="rgba(17,17,19,0.12)"
      defs={
        <linearGradient id="h39-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="#EEEEEC" />

      {/* Precision Keynote Concentric Hairline Rings */}
      <circle cx={540} cy={628} r={ringR + 96} fill="none" stroke="rgba(17,17,19,0.08)" strokeWidth={2} />
      <circle cx={540} cy={628} r={ringR + 184} fill="none" stroke="rgba(17,17,19,0.05)" strokeWidth={2} />

      {/* Central White Carrier Card */}
      <rect x={164} y={366} width={752} height={476} rx={44} fill="rgba(17,17,19,0.08)" transform="translate(0, 18)" />
      <rect x={164} y={366} width={752} height={476} rx={44} fill="#FBFBF9" stroke="rgba(17,17,19,0.08)" strokeWidth={2} />

      {/* Top Status Bar inside Carrier */}
      <circle cx={224} cy={424} r={10} fill="#FF3B30" />
      <text x={250} y={432} fill="#111113" fontSize={22} fontFamily="sans-serif" fontWeight={700}>
        Live Engine · One Continuous Take
      </text>
      <text x={856} y={432} textAnchor="end" fill="#6E6E73" fontSize={22} fontFamily="monospace" fontWeight={700}>
        00:{String(Math.floor(frame / 2) % 60).padStart(2, '0')}
      </text>

      {/* Blue Gradient Content Tile morphing wide */}
      <rect x={212} y={474} width={330 + morph * 64} height={240} rx={28} fill="url(#h39-tile)" />
      <text x={246} y={548} fill="#FFFFFF" fontSize={22} fontFamily="sans-serif" fontWeight={700} opacity={0.85}>
        PERFORMANCE
      </text>
      <text x={246} y={644} fill="#FFFFFF" fontSize={88} fontFamily="sans-serif" fontWeight={900} letterSpacing={-3}>
        4.2×
      </text>

      {/* Right Side Precision Metric Stack */}
      <rect x={636} y={474} width={232} height={110} rx={24} fill="#F2F2F0" />
      <text x={664} y={518} fill="#6E6E73" fontSize={18} fontFamily="sans-serif" fontWeight={700}>
        LATENCY
      </text>
      <text x={664} y={562} fill="#111113" fontSize={36} fontFamily="monospace" fontWeight={900}>
        12 ms
      </text>

      <rect x={636} y={604} width={232} height={110} rx={24} fill="#F2F2F0" />
      <text x={664} y={648} fill="#6E6E73" fontSize={18} fontFamily="sans-serif" fontWeight={700}>
        EFFICIENCY
      </text>
      <text x={664} y={692} fill="#111113" fontSize={36} fontFamily="monospace" fontWeight={900}>
        99.4%
      </text>

      {/* Continuous Morphing Progress Pill */}
      <rect x={212} y={752} width={656} height={36} rx={18} fill="#E5E5E3" />
      <rect x={212} y={752} width={180 + morph * 476} height={36} rx={18} fill="#111113" />

      {/* Giant Tight-Tracked Apple Keynote Closing Word */}
      <text x={540} y={1044} textAnchor="middle" fill="#111113" fontSize={124} fontFamily="sans-serif" fontWeight={900} letterSpacing={-5}>
        Seamless.
      </text>
      <text x={540} y={1102} textAnchor="middle" fill="#6E6E73" fontSize={26} fontFamily="sans-serif" fontWeight={600}>
        Every state grows out of the last — zero cuts.
      </text>
    </HeroStage>
  );
};

/** look-40: Retro CRT Glow — curved phosphor TV tube + scanlines + glowing warm coral-white broadcast title */
const SigLook40RetroCRT: SignatureComponent = ({ frame, width, height }) => {
  const barY = 260 + ((frame * 9) % 956);
  const blink = Math.floor(frame / 15) % 2 === 0;

  return (
    <HeroStage
      id="look40"
      width={width}
      height={height}
      borderColor="rgba(255,154,144,0.42)"
      defs={
        <>
          <radialGradient id="h40-tube" cx="50%" cy="46%" r="58%">
            <stop offset="0%" stopColor="#1B1F30" />
            <stop offset="62%" stopColor="#0B0E16" />
            <stop offset="100%" stopColor="#05060A" />
          </radialGradient>
          <pattern id="h40-scan" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect x={0} y={0} width={6} height={2.5} fill="rgba(0,0,0,0.42)" />
          </pattern>
          <radialGradient id="h40-bloom" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF9A90" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#FF9A90" stopOpacity="0" />
          </radialGradient>
        </>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h40-tube)" />

      {/* Soft Phosphor Bloom behind Title */}
      <ellipse cx={540} cy={670} rx={420} ry={210} fill="url(#h40-bloom)" />

      {/* Curved Inner CRT Glass Bezel */}
      <rect x={72} y={304} width={936} height={868} rx={72} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={5} />
      <rect x={88} y={320} width={904} height={836} rx={62} fill="none" stroke="rgba(255,154,144,0.22)" strokeWidth={2} />

      {/* Wide Retro-Futuristic Broadcast Title (Stacked 2 Lines) */}
      <text
        x={540}
        y={628}
        textAnchor="middle"
        fill="#FF9A90"
        fontSize={86}
        fontFamily="sans-serif"
        fontWeight={900}
        letterSpacing={10}
        opacity={0.45}
      >
        NEXT EPISODE
      </text>
      <text
        x={540}
        y={625}
        textAnchor="middle"
        fill="#FCFBF8"
        fontSize={86}
        fontFamily="sans-serif"
        fontWeight={900}
        letterSpacing={10}
      >
        NEXT EPISODE
      </text>

      <text
        x={540}
        y={744}
        textAnchor="middle"
        fill="#FF9A90"
        fontSize={74}
        fontFamily="sans-serif"
        fontWeight={900}
        letterSpacing={12}
        opacity={0.48}
      >
        ON AIR · 2026
      </text>
      <text
        x={540}
        y={741}
        textAnchor="middle"
        fill="#FCFBF8"
        fontSize={74}
        fontFamily="sans-serif"
        fontWeight={900}
        letterSpacing={12}
      >
        ON AIR · 2026
      </text>

      {/* Left-aligned Mono System Status Line with Blinking Red Dot */}
      <g transform="translate(226, 868)">
        <circle cx={0} cy={-8} r={10} fill="#F05A4A" opacity={blink ? 1 : 0.25} />
        <text x={24} y={0} fill="rgba(252,251,248,0.82)" fontSize={26} fontFamily="monospace" fontWeight={700} letterSpacing={4}>
          CH 03 // SIGNAL LOCKED · STEREO
        </text>
      </g>

      {/* Rolling Refresh Bar & Scanlines */}
      <rect x={28} y={barY} width={1024} height={74} fill="rgba(255,154,144,0.08)" />
      <rect x={28} y={260} width={1024} height={956} fill="url(#h40-scan)" />
    </HeroStage>
  );
};

/** look-41: Oscilloscope — full-size dark phosphor scope + graticule grid + bright green signal trace */
const SigLook41Oscilloscope: SignatureComponent = ({ frame, width, height }) => {
  const pts1: string[] = [];
  const pts2: string[] = [];
  for (let x = 28; x <= 1052; x += 8) {
    const u = (x - 28) / 1024;
    const env = Math.sin(u * Math.PI);
    const t = x * 0.022 + frame * 0.14;
    const y1 = 700 + (Math.sin(t) * 145 + Math.sin(t * 2.5) * 58 + Math.cos(t * 0.7) * 28) * env;
    const y2 = 700 + (Math.cos(t * 0.85) * 90 + Math.sin(t * 3.1) * 32) * env;
    pts1.push(`${x},${y1.toFixed(1)}`);
    pts2.push(`${x},${y2.toFixed(1)}`);
  }

  return (
    <HeroStage
      id="look41"
      width={width}
      height={height}
      borderColor="rgba(70,255,140,0.42)"
      defs={
        <radialGradient id="h41-tube" cx="50%" cy="48%" r="58%">
          <stop offset="0%" stopColor="#0D2216" />
          <stop offset="65%" stopColor="#07140D" />
          <stop offset="100%" stopColor="#030805" />
        </radialGradient>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="url(#h41-tube)" />

      {/* Square Graticule Grid fading softly */}
      {Array.from({ length: 11 }).map((_, i) => {
        const gx = 90 + i * 90;
        return <line key={`vx-${i}`} x1={gx} y1={310} x2={gx} y2={1120} stroke="rgba(70,255,140,0.16)" strokeWidth={1.5} />;
      })}
      {Array.from({ length: 10 }).map((_, i) => {
        const gy = 340 + i * 80;
        return <line key={`hy-${i}`} x1={70} y1={gy} x2={1010} y2={gy} stroke="rgba(70,255,140,0.16)" strokeWidth={1.5} />;
      })}

      {/* Center Axes with Fine Measurement Ticks */}
      <line x1={28} y1={700} x2={1052} y2={700} stroke="rgba(70,255,140,0.42)" strokeWidth={2} />
      <line x1={540} y1={290} x2={540} y2={1140} stroke="rgba(70,255,140,0.42)" strokeWidth={2} />
      {Array.from({ length: 21 }).map((_, i) => (
        <line key={`tx-${i}`} x1={90 + i * 45} y1={692} x2={90 + i * 45} y2={708} stroke="rgba(70,255,140,0.55)" strokeWidth={1.8} />
      ))}

      {/* Secondary Harmonic Ghost Trace */}
      <polyline points={pts2.join(' ')} fill="none" stroke="rgba(70,255,140,0.28)" strokeWidth={4} strokeLinecap="round" />

      {/* Primary Phosphor Beam Trace (Outer Bloom + Core) */}
      <polyline points={pts1.join(' ')} fill="none" stroke="rgba(70,255,140,0.28)" strokeWidth={24} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={pts1.join(' ')} fill="none" stroke="#46FF8C" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={pts1.join(' ')} fill="none" stroke="#D7FFF3" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />

      {/* Geometric Signal Callout Badge */}
      <text x={540} y={468} textAnchor="middle" fill="#46FF8C" fontSize={68} fontFamily="monospace" fontWeight={900} letterSpacing={14} opacity={0.32}>
        RESONANCE
      </text>
      <text x={540} y={465} textAnchor="middle" fill="#D7FFF3" fontSize={68} fontFamily="monospace" fontWeight={900} letterSpacing={14}>
        RESONANCE
      </text>

      {/* Bottom Scope Telemetry Readouts */}
      <rect x={86} y={1088} width={908} height={74} rx={16} fill="rgba(3,8,5,0.72)" stroke="rgba(70,255,140,0.34)" strokeWidth={2} />
      <text x={118} y={1134} fill="#46FF8C" fontSize={22} fontFamily="monospace" fontWeight={800}>
        CH1 5.0V/DIV
      </text>
      <text x={540} y={1134} textAnchor="middle" fill="#D7FFF3" fontSize={22} fontFamily="monospace" fontWeight={800}>
        FREQ 440.0 Hz · LOCKED
      </text>
      <text x={962} y={1134} textAnchor="end" fill="#46FF8C" fontSize={22} fontFamily="monospace" fontWeight={800}>
        TIME 2.0ms
      </text>
    </HeroStage>
  );
};

/** look-42: Magazine Layout and Note — cool off-white print page + serif headline + duotone photo + red pen note */
const SigLook42MagazineNote: SignatureComponent = ({ frame, width, height }) => {
  const penDraw = easeOutCubic(clamp01((frame - 12) / 32));

  return (
    <HeroStage
      id="look42"
      width={width}
      height={height}
      borderColor="rgba(27,30,37,0.22)"
      defs={
        <linearGradient id="h42-duo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#242E46" />
          <stop offset="65%" stopColor="#52627E" />
          <stop offset="100%" stopColor="#E2E7EC" />
        </linearGradient>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="#EAEDED" />

      {/* Top Editorial Folio Hairline */}
      <text x={82} y={316} fill="#525B68" fontSize={18} fontFamily="serif" letterSpacing={5} fontWeight={700}>
        THE MODERN REVIEW
      </text>
      <text x={998} y={316} textAnchor="end" fill="#525B68" fontSize={18} fontFamily="monospace" fontWeight={700}>
        ISSUE 04 — P. 18
      </text>
      <line x1={82} y1={334} x2={998} y2={334} stroke="#1B1E25" strokeWidth={2} />

      {/* Two-line High-Contrast Editorial Serif Headline */}
      <text x={82} y={428} fill="#1B1E25" fontSize={78} fontFamily="serif" fontWeight={700} letterSpacing={-2}>
        The Quiet Art of
      </text>
      <text x={176} y={512} fill="#1B1E25" fontSize={78} fontFamily="serif" fontStyle="italic" fontWeight={700} letterSpacing={-2}>
        Deliberate Design
      </text>

      {/* Left Duotone Photo Block */}
      <rect x={82} y={562} width={452} height={470} fill="url(#h42-duo)" />
      {/* Architectural silhouette inside duotone photo */}
      <polygon points="82,1032 230,720 382,1032" fill="#182032" opacity={0.75} />
      <polygon points="274,1032 426,660 534,880 534,1032" fill="#242E46" opacity={0.85} />
      <circle cx={438} cy={642} r={44} fill="#E2E7EC" opacity={0.85} />
      <text x={82} y={1064} fill="#525B68" fontSize={18} fontFamily="serif" fontStyle="italic">
        Fig 01. Studio light across raw concrete geometry.
      </text>

      {/* Right Narrow Editorial Body Column */}
      <text x={580} y={592} fill="#1B1E25" fontSize={23} fontFamily="serif" fontWeight={700}>
        Why Restraint Wins
      </text>
      {[
        'Great pages breathe. Rather than',
        'filling every pixel with noise,',
        'editorial craft pairs crisp type',
        'with generous paper margins.',
        'One intentional mark guides the',
        'reader straight to the insight.',
      ].map((line, i) => (
        <text key={i} x={580} y={638 + i * 38} fill="#2C323D" fontSize={22} fontFamily="serif">
          {line}
        </text>
      ))}
      {/* Red Pen Underline on key phrase */}
      <path
        d="M 580 798 Q 740 806 902 794"
        fill="none"
        stroke="#C42E26"
        strokeWidth={4.5}
        strokeLinecap="round"
        strokeDasharray="340"
        strokeDashoffset={340 * (1 - penDraw)}
      />

      {/* Hand-drawn Red Fountain Pen Margin Note + Curved Arrow into Photo */}
      <g opacity={penDraw}>
        <text x={786} y={962} textAnchor="middle" fill="#C42E26" fontSize={36} fontFamily="serif" fontStyle="italic" fontWeight={700} transform="rotate(-6, 786, 962)">
          Notice the light!
        </text>
        <ellipse
          cx={786}
          cy={952}
          rx={152}
          ry={46}
          fill="none"
          stroke="#C42E26"
          strokeWidth={4}
          strokeDasharray="680"
          strokeDashoffset={680 * (1 - penDraw)}
          transform="rotate(-5, 786, 952)"
        />
        <path
          d="M 632 946 Q 540 930 468 852"
          fill="none"
          stroke="#C42E26"
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeDasharray="240"
          strokeDashoffset={240 * (1 - penDraw)}
        />
        <path d="M 468 852 L 496 858 M 468 852 L 474 880" fill="none" stroke="#C42E26" strokeWidth={4.5} strokeLinecap="round" />
      </g>
    </HeroStage>
  );
};

/** look-43: Blue Editorial — electric Yves-Klein ultramarine #2433F0 magazine cover with sliced white type */
const SigLook43BlueEditorial: SignatureComponent = ({ frame, width, height }) => {
  const slide = easeOutCubic(clamp01(frame / 36));
  const sliceShift = Math.sin(frame * 0.04) * 14;

  return (
    <HeroStage
      id="look43"
      width={width}
      height={height}
      borderColor="rgba(244,245,250,0.45)"
    >
      {/* Pure Electric Ultramarine Blue #2433F0 */}
      <rect x={28} y={260} width={1024} height={956} fill="#2433F0" />

      {/* Editorial Corner Crop Marks */}
      <path d="M 68 332 L 68 296 L 104 296 M 976 296 L 1012 296 L 1012 332 M 68 1144 L 68 1180 L 104 1180 M 976 1180 L 1012 1180 L 1012 1144" fill="none" stroke="rgba(244,245,250,0.72)" strokeWidth={3} />

      {/* Top Kicker above full-width hairline */}
      <text x={88} y={376} fill="#F4F5FA" fontSize={28} fontFamily="sans-serif" fontWeight={900} letterSpacing={-0.5}>
        manifesto / 04
      </text>
      <text x={992} y={376} textAnchor="end" fill="rgba(244,245,250,0.78)" fontSize={22} fontFamily="monospace" fontWeight={700}>
        VOL. 2026
      </text>
      <line x1={88} y1={398} x2={992} y2={398} stroke="rgba(244,245,250,0.55)" strokeWidth={2.5} />

      {/* Giant Italic Display Serif Word piercing the hairline */}
      <g transform={`translate(${((1 - slide) * -40).toFixed(1)}, 0)`}>
        <text x={82} y={626} fill="#F4F5FA" fontSize={248} fontFamily="serif" fontStyle="italic" fontWeight={700} letterSpacing={-10}>
          future
        </text>
      </g>

      {/* Sliced Diagonal Accent Strip */}
      <polygon
        points={`28,${672 + sliceShift} 1052,${614 + sliceShift} 1052,${634 + sliceShift} 28,${692 + sliceShift}`}
        fill="rgba(244,245,250,0.22)"
      />

      {/* Right-aligned Grotesk Statement on second shorter hairline */}
      <text x={992} y={778} textAnchor="end" fill="#F4F5FA" fontSize={62} fontFamily="sans-serif" fontWeight={900} letterSpacing={-2.5}>
        is built in public
      </text>
      <line x1={380} y1={804} x2={992} y2={804} stroke="rgba(244,245,250,0.55)" strokeWidth={2.5} />

      {/* Lower Giant Italic Word + Baseline Grotesk */}
      <g transform={`translate(${((1 - slide) * 40).toFixed(1)}, 0)`}>
        <text x={118} y={1028} fill="#F4F5FA" fontSize={216} fontFamily="serif" fontStyle="italic" fontWeight={700} letterSpacing={-8}>
          now.
        </text>
      </g>
      <text x={992} y={1018} textAnchor="end" fill="#F4F5FA" fontSize={44} fontFamily="sans-serif" fontWeight={900} letterSpacing={-1.5}>
        no filter.
      </text>

      {/* Closing Baseline Hairline */}
      <line x1={88} y1={1084} x2={992} y2={1084} stroke="rgba(244,245,250,0.55)" strokeWidth={2.5} />
      <text x={88} y={1130} fill="rgba(244,245,250,0.8)" fontSize={22} fontFamily="monospace" fontWeight={700} letterSpacing={2}>
        EDITION ULTRAMARINE · PRINT STUDIO
      </text>
    </HeroStage>
  );
};

/** look-44: Risograph — two-ink pink & blue stop-motion poster with overlapping multiply circles & halftone dots */
const SigLook44Risograph: SignatureComponent = ({ frame, width, height }) => {
  // Authentic stepped stop-motion offset
  const step = Math.floor(frame / 8);
  const misX = 12 + (step % 3) * 4;
  const misY = 8 + ((step + 1) % 3) * 3;
  const pink = '#FF48B0';
  const blue = '#3255A4';

  return (
    <HeroStage
      id="look44"
      width={width}
      height={height}
      borderColor="rgba(50,85,164,0.35)"
      defs={
        <>
          <pattern id="h44-stripe" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
            <rect x={0} y={0} width={10} height={22} fill={blue} opacity={0.9} />
          </pattern>
          <pattern id="h44-grain" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx={4} cy={4} r={1.6} fill={pink} opacity={0.22} />
            <circle cx={11} cy={10} r={1.4} fill={blue} opacity={0.18} />
          </pattern>
        </>
      }
    >
      <rect x={28} y={260} width={1024} height={956} fill="#EDEFEE" />
      <rect x={28} y={260} width={1024} height={956} fill="url(#h44-grain)" />

      {/* Four-corner Print Registration Marks ⊕ */}
      {[
        [82, 314],
        [998, 314],
        [82, 1162],
        [998, 1162],
      ].map(([rx, ry], idx) => (
        <g key={idx} transform={`translate(${rx}, ${ry})`}>
          <circle cx={0} cy={0} r={14} fill="none" stroke={pink} strokeWidth={2.5} />
          <line x1={-22} y1={0} x2={22} y2={0} stroke={blue} strokeWidth={2.5} />
          <line x1={0} y1={-22} x2={0} y2={22} stroke={blue} strokeWidth={2.5} />
        </g>
      ))}

      {/* Bold Condensed Poster Headline (Two-Ink Misregistered) */}
      <text x={540 + misX * 0.5} y={432 + misY * 0.4} textAnchor="middle" fill={pink} fontSize={124} fontFamily="sans-serif" fontWeight={900} letterSpacing={6} opacity={0.85}>
        RISO PRINT
      </text>
      <text x={540} y={428} textAnchor="middle" fill={blue} fontSize={124} fontFamily="sans-serif" fontWeight={900} letterSpacing={6} style={{ mixBlendMode: 'multiply' }}>
        RISO PRINT
      </text>

      {/* Two Large Overlapping Two-Ink Circles (Multiply -> Deep Purple #32186F) */}
      <circle cx={420} cy={700} r={195} fill={pink} opacity={0.92} />
      <circle cx={640 + misX} cy={700 + misY} r={195} fill={blue} opacity={0.9} style={{ mixBlendMode: 'multiply' }} />

      {/* Knock-out Paper Word punched through the shapes */}
      <text x={540} y={728} textAnchor="middle" fill="#EDEFEE" fontSize={92} fontFamily="sans-serif" fontWeight={900} letterSpacing={8}>
        LIVE
      </text>

      {/* Diagonal Striped Band with Second Word */}
      <rect x={96} y={932} width={888} height={82} fill="url(#h44-stripe)" />
      <rect x={312} y={944} width={456} height={58} fill={pink} />
      <text x={540} y={986} textAnchor="middle" fill="#EDEFEE" fontSize={38} fontFamily="monospace" fontWeight={900} letterSpacing={6}>
        TWO-INK EDITION
      </text>

      {/* Progressive Halftone Dot Row growing left-to-right */}
      {Array.from({ length: 12 }).map((_, i) => (
        <circle
          key={i}
          cx={136 + i * 74}
          cy={1092}
          r={6 + i * 2.2}
          fill={i % 2 === 0 ? blue : pink}
        />
      ))}
    </HeroStage>
  );
};

/** look-45: Swiss Grid — strict 4-column modular square grid + Signal Red block + pure black circle + bold left type */
const SigLook45SwissGrid: SignatureComponent = ({ frame, width, height }) => {
  const snap = easeOutCubic(clamp01(frame / 32));
  const cols = [28, 284, 540, 796, 1052];
  const rows = [260, 499, 738, 977, 1216];

  return (
    <HeroStage
      id="look45"
      width={width}
      height={height}
      borderColor="rgba(16,16,16,0.35)"
    >
      <rect x={28} y={260} width={1024} height={956} fill="#F0F0E8" />

      {/* Bold Signal Red Module Block top-right (2 cols × 1.5 rows, bleeding to edge) */}
      <rect x={540} y={260} width={512} height={478} fill="#F03820" />

      {/* Strict Swiss 4-Column Modular Hairlines */}
      {cols.map((x) => (
        <line key={x} x1={x} y1={260} x2={x} y2={1216} stroke="#101010" strokeWidth={2} />
      ))}
      {rows.map((y) => (
        <line key={y} x1={28} y1={y} x2={1052} y2={y} stroke="#101010" strokeWidth={2} />
      ))}

      {/* Pure Geometric Black Circle snapped cleanly to upper-left module (zero text overlap) */}
      <circle cx={284} cy={432} r={116 * snap} fill="#101010" />
      <circle cx={284} cy={432} r={44 * snap} fill="#F0F0E8" />

      {/* Grid Metadata Indices */}
      <text x={52} y={316} fill="#101010" fontSize={30} fontFamily="sans-serif" fontWeight={900}>
        01 / 04
      </text>
      <text x={566} y={316} fill="#F0F0E8" fontSize={30} fontFamily="sans-serif" fontWeight={900}>
        ZÜRICH · 1958
      </text>
      <text x={566} y={360} fill="rgba(240,240,232,0.85)" fontSize={22} fontFamily="monospace" fontWeight={700}>
        INTERNATIONAL STYLE
      </text>

      {/* Massive Left-Aligned Swiss Typography locked to Grid Baselines */}
      <text x={52} y={712} fill="#101010" fontSize={148} fontFamily="sans-serif" fontWeight={900} letterSpacing={-7}>
        Form
      </text>
      <text x={52} y={950} fill="#101010" fontSize={148} fontFamily="sans-serif" fontWeight={900} letterSpacing={-7}>
        follows
      </text>
      <text x={52} y={1184} fill="#F03820" fontSize={148} fontFamily="sans-serif" fontWeight={900} letterSpacing={-7}>
        order.
      </text>

      {/* Clean Right Column Spec Block */}
      <text x={818} y={806} fill="#101010" fontSize={22} fontFamily="sans-serif" fontWeight={800}>
        MODULAR GRID
      </text>
      <text x={818} y={840} fill="#101010" fontSize={20} fontFamily="monospace" fontWeight={600}>
        4 COLS × 4 ROWS
      </text>
      <text x={818} y={872} fill="#101010" fontSize={20} fontFamily="monospace" fontWeight={600}>
        STRICT BASELINE
      </text>
    </HeroStage>
  );
};

/** look-46: Pencil to Blueprint — graph paper graphite sketch flooding into cobalt technical blueprint */
const SigLook46PencilBlueprint: SignatureComponent = ({ frame, width, height }) => {
  // Dramatic mid-transition sweep so both graphite sketch and cobalt blueprint shine clearly
  const floodX = interpolate(frame % 150, [0, 60, 120, 150], [260, 585, 860, 260]);

  const renderEngineeredObject = (isBlueprint: boolean) => {
    const stroke = isBlueprint ? '#EEF4FB' : '#25262B';
    const dimStroke = isBlueprint ? '#93C5FD' : '#64748B';
    const fillMain = isBlueprint ? 'rgba(238,244,251,0.1)' : 'rgba(37,38,43,0.06)';
    return (
      <g>
        {/* Ground baseline */}
        <line x1={120} y1={980} x2={960} y2={980} stroke={stroke} strokeWidth={3} />
        {/* Precision Industrial Camera / Optical Housing Side-View */}
        <rect x={240} y={560} width={520} height={420} rx={24} fill={fillMain} stroke={stroke} strokeWidth={isBlueprint ? 4 : 5} />
        {/* Top Viewfinder Prism */}
        <polygon points="340,560 400,455 620,455 675,560" fill={fillMain} stroke={stroke} strokeWidth={isBlueprint ? 4 : 5} />
        {/* Side Shutter Dial */}
        <rect x={684} y={516} width={64} height={44} rx={6} fill={fillMain} stroke={stroke} strokeWidth={3.5} />
        {/* Main Optical Lens Barrel */}
        <circle cx={495} cy={770} r={148} fill={fillMain} stroke={stroke} strokeWidth={isBlueprint ? 4.5 : 5.5} />
        <circle cx={495} cy={770} r={104} fill="none" stroke={stroke} strokeWidth={3} strokeDasharray={isBlueprint ? '10 6' : undefined} />
        <circle cx={495} cy={770} r={58} fill="none" stroke={stroke} strokeWidth={2.5} />
        {/* Optical Center Crosshair */}
        <line x1={315} y1={770} x2={675} y2={770} stroke={dimStroke} strokeWidth={1.8} strokeDasharray="8 6" />
        <line x1={495} y1={590} x2={495} y2={950} stroke={dimStroke} strokeWidth={1.8} strokeDasharray="8 6" />

        {/* Technical Dimension Lines & Measurements */}
        {/* Right Height Dimension */}
        <line x1={822} y1={560} x2={822} y2={980} stroke={dimStroke} strokeWidth={2.5} />
        <line x1={804} y1={560} x2={840} y2={560} stroke={dimStroke} strokeWidth={2.5} />
        <line x1={804} y1={980} x2={840} y2={980} stroke={dimStroke} strokeWidth={2.5} />
        <text x={854} y={780} fill={stroke} fontSize={30} fontFamily="monospace" fontWeight={800}>
          142 mm
        </text>

        {/* Bottom Width Dimension */}
        <line x1={240} y1={1046} x2={760} y2={1046} stroke={dimStroke} strokeWidth={2.5} />
        <line x1={240} y1={1028} x2={240} y2={1064} stroke={dimStroke} strokeWidth={2.5} />
        <line x1={760} y1={1028} x2={760} y2={1064} stroke={dimStroke} strokeWidth={2.5} />
        <text x={500} y={1098} textAnchor="middle" fill={stroke} fontSize={32} fontFamily="monospace" fontWeight={800}>
          240 mm · Ø 96 mm
        </text>
      </g>
    );
  };

  return (
    <HeroStage
      id="look46"
      width={width}
      height={height}
      borderColor="rgba(147,197,253,0.48)"
      defs={
        <>
          <pattern id="h46-graph-paper" width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#7FA3C4" strokeWidth={1} opacity={0.35} />
          </pattern>
          <pattern id="h46-graph-bp" width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#93C5FD" strokeWidth={1} opacity={0.28} />
          </pattern>
          <clipPath id="h46-bp-clip">
            <polygon points={`28,260 ${floodX.toFixed(1)},260 ${(floodX - 110).toFixed(1)},1216 28,1216`} />
          </clipPath>
        </>
      }
    >
      {/* Base Layer: Graph Paper + Graphite Pencil Sketch */}
      <rect x={28} y={260} width={1024} height={956} fill="#ECECE6" />
      <rect x={28} y={260} width={1024} height={956} fill="url(#h46-graph-paper)" />
      <text x={82} y={356} fill="#25262B" fontSize={54} fontFamily="sans-serif" fontWeight={800} letterSpacing={4}>
        CONCEPT SKETCH
      </text>
      <line x1={82} y1={374} x2={520} y2={374} stroke="#25262B" strokeWidth={2.5} />
      {renderEngineeredObject(false)}

      {/* Clipped Flooding Layer: Cobalt Blueprint + Crisp White Technical Lines */}
      <g clipPath="url(#h46-bp-clip)">
        <rect x={28} y={260} width={1024} height={956} fill="#1C4C8F" />
        <rect x={28} y={260} width={1024} height={956} fill="url(#h46-graph-bp)" />
        <text x={82} y={356} fill="#EEF4FB" fontSize={54} fontFamily="sans-serif" fontWeight={800} letterSpacing={4}>
          BLUEPRINT SPEC
        </text>
        <line x1={82} y1={374} x2={540} y2={374} stroke="#EEF4FB" strokeWidth={2.5} />
        {renderEngineeredObject(true)}
      </g>

      {/* Ink Flood Transition Wave Edge */}
      <line
        x1={floodX}
        y1={260}
        x2={floodX - 110}
        y2={1216}
        stroke="#143C76"
        strokeWidth={14}
        opacity={0.7}
      />
      <line
        x1={floodX}
        y1={260}
        x2={floodX - 110}
        y2={1216}
        stroke="#93C5FD"
        strokeWidth={3.5}
        strokeDasharray="16 8"
      />
    </HeroStage>
  );
};

// ============================================================================
// REGISTRY OF ALL 46 STYLE SIGNATURES
// ============================================================================

export const SIGNATURES: Record<string, SignatureComponent> = {
  'look-1': SigLook1GlowWorld,
  'look-2': SigLook2FlatCartoon,
  'look-3': SigLook3Hologram,
  'look-4': SigLook4RedRelief,
  'look-5': SigLook5InkDoodle,
  'look-6': SigLook6DeepTime,
  'look-7': SigLook7NeonSilhouette,
  'look-8': SigLook8POVDoodle,
  'look-9': SigLook9BlueGrid,
  'look-10': SigLook10Turntable,
  'look-11': SigLook11MoneyStack,
  'look-12': SigLook12CardFlip,
  'look-13': SigLook13Receipt,
  'look-14': SigLook14Iceberg,
  'look-15': SigLook15TextThread,
  'look-16': SigLook16ScaleLineup,
  'look-17': SigLook17Trophy,
  'look-18': SigLook18Donut,
  'look-19': SigLook19GlobeArcs,
  'look-20': SigLook20Laptop,
  'look-21': SigLook21IsoFlow,
  'look-22': SigLook22Notifications,
  'look-23': SigLook23Slider,
  'look-24': SigLook24RankingBars,
  'look-25': SigLook25SocialPost,
  'look-26': SigLook26DayCounter,
  'look-27': SigLook27Versus,
  'look-28': SigLook28MapRoute,
  'look-29': SigLook29Exploded,
  'look-30': SigLook30InkWash,
  'look-31': SigLook31PaperDesk,
  'look-32': SigLook32Highlight,
  'look-33': SigLook33StatChart,
  'look-34': SigLook34AppMockup,
  'look-35': SigLook35ScreenZoom,
  'look-36': SigLook36Timeline,
  'look-37': SigLook37GlowOrb,
  'look-38': SigLook38FrostedGlass,
  'look-39': SigLook39AppleOneTake,
  'look-40': SigLook40RetroCRT,
  'look-41': SigLook41Oscilloscope,
  'look-42': SigLook42MagazineNote,
  'look-43': SigLook43BlueEditorial,
  'look-44': SigLook44Risograph,
  'look-45': SigLook45SwissGrid,
  'look-46': SigLook46PencilBlueprint,
};

export function getSignaturePlacement(styleId: string): SignaturePlacement {
  return SIGNATURE_PLACEMENTS[styleId] ?? 'under';
}

// ============================================================================
// MAIN DISPATCHER COMPONENT
// ============================================================================

export const StyleSignature: React.FC<StyleSignatureProps> = ({
  styleId,
  tokens,
  frame,
  sceneIndex,
  width,
  height,
  placement,
  scene,
  localFrame,
  totalScenes,
}) => {
  const normalizedId = (styleId || '').trim().toLowerCase();
  const Comp = SIGNATURES[normalizedId];
  if (!Comp) return null;

  const targetPlacement = getSignaturePlacement(normalizedId);
  if (placement && placement !== targetPlacement) {
    return null;
  }

  return (
    <Comp
      tokens={tokens}
      frame={frame}
      sceneIndex={sceneIndex}
      width={width}
      height={height}
      placement={targetPlacement}
      scene={scene}
      localFrame={localFrame}
      totalScenes={totalScenes}
    />
  );
};
