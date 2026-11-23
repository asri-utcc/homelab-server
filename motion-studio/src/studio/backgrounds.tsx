import React, { useId } from 'react';
import { AbsoluteFill, random, useVideoConfig } from 'remotion';
import {
  ResolvedStyleTokens,
  StyleTokens,
  hexToRgba,
  resolveStyleTokens,
} from './types';

interface StudioBackgroundProps {
  tokens: StyleTokens | ResolvedStyleTokens;
  frame: number;
}

// Precomputed deterministic starfield particles (seed-fixed, never Math.random)
const STAR_DATA = Array.from({ length: 84 }, (_, i) => {
  const layer = i % 3; // 0: far, 1: mid, 2: near
  return {
    x: random(`se-star-x-${i}`) * 1080,
    y: random(`se-star-y-${i}`) * 1920,
    r: (layer === 0 ? 1.2 : layer === 1 ? 2.1 : 3.2) + random(`se-star-r-${i}`) * 1.4,
    phase: random(`se-star-p-${i}`) * Math.PI * 2,
    speed: 0.7 + random(`se-star-s-${i}`) * 1.8,
    drift: layer === 0 ? 0.14 : layer === 1 ? 0.34 : 0.62,
    isDiamond: i < 10,
    tint: i % 5 === 0 ? 'accent' : i % 7 === 0 ? 'accent2' : 'star',
  };
});

// Precomputed deterministic paper fibers & subtle speckles
const PAPER_FIBERS = Array.from({ length: 46 }, (_, i) => {
  const x = random(`se-pf-x-${i}`) * 1080;
  const y = random(`se-pf-y-${i}`) * 1920;
  const len = 18 + random(`se-pf-l-${i}`) * 46;
  const ang = random(`se-pf-a-${i}`) * Math.PI * 2;
  return {
    x1: x,
    y1: y,
    x2: x + Math.cos(ang) * len,
    y2: y + Math.sin(ang) * len,
    op: 0.03 + random(`se-pf-o-${i}`) * 0.055,
  };
});

const PAPER_SPECKS = Array.from({ length: 110 }, (_, i) => ({
  cx: random(`se-ps-x-${i}`) * 1080,
  cy: random(`se-ps-y-${i}`) * 1920,
  r: 0.8 + random(`se-ps-r-${i}`) * 1.6,
  op: 0.035 + random(`se-ps-o-${i}`) * 0.07,
}));

// Precomputed deterministic noise stipple tile points (120x120 repeatable pattern)
const NOISE_TILE_DOTS = Array.from({ length: 96 }, (_, i) => ({
  x: random(`se-nt-x-${i}`) * 120,
  y: random(`se-nt-y-${i}`) * 120,
  r: 0.6 + random(`se-nt-r-${i}`) * 1.0,
  op: 0.04 + random(`se-nt-o-${i}`) * 0.1,
  bright: i % 2 === 0,
}));

function isResolved(t: StyleTokens | ResolvedStyleTokens): t is ResolvedStyleTokens {
  return typeof (t as ResolvedStyleTokens).isLight === 'boolean';
}

export const StudioBackground: React.FC<StudioBackgroundProps> = ({ tokens, frame }) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { width, height, fps } = useVideoConfig();
  const r = isResolved(tokens) ? tokens : resolveStyleTokens(tokens);
  const { palette, bgTreatment, isLight, motionIntensity, vignette, glowIntensity } = r;

  const tSec = frame / Math.max(1, fps);
  const driftPhase = tSec * 0.45 * motionIntensity;
  const blob1X = 50 + Math.sin(driftPhase) * 10;
  const blob1Y = 26 + Math.cos(driftPhase * 0.8) * 6;
  const blob2X = 50 + Math.cos(driftPhase * 0.7 + 1.2) * 14;
  const blob2Y = 78 + Math.sin(driftPhase * 0.9) * 5;

  const vignetteHex = isLight ? palette.border : '#02040D';
  const vignetteStrength = isLight ? vignette * 0.42 : vignette * 0.72;

  return (
    <AbsoluteFill
      style={{
        background:
          bgTreatment === 'flat'
            ? palette.bg
            : `linear-gradient(180deg, ${palette.bg} 0%, ${palette.bg2} 100%)`,
        overflow: 'hidden',
      }}
    >
      {/* 0. FLAT TREATMENT (Pure Solid Color — Zero Gradients, Zero Grain, Zero Vignette) */}
      {bgTreatment === 'flat' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: palette.bg,
          }}
        />
      )}

      {/* 1. GRADIENT TREATMENT */}
      {bgTreatment === 'gradient' && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: -80,
              background: [
                `radial-gradient(ellipse 68% 46% at ${blob1X.toFixed(1)}% ${blob1Y.toFixed(1)}%, ${hexToRgba(palette.accent, isLight ? 0.18 : 0.28 + glowIntensity * 0.12)} 0%, transparent 72%)`,
                `radial-gradient(ellipse 64% 48% at ${blob2X.toFixed(1)}% ${blob2Y.toFixed(1)}%, ${hexToRgba(palette.accent2, isLight ? 0.15 : 0.24)} 0%, transparent 74%)`,
              ].join(', '),
            }}
          />
          <svg
            width={width}
            height={height}
            viewBox="0 0 1080 1920"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <defs>
              <linearGradient id={`grad-sheen-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={palette.accent} stopOpacity={isLight ? 0.06 : 0.09} />
                <stop offset="50%" stopColor={palette.fg} stopOpacity={0} />
                <stop offset="100%" stopColor={palette.accent2} stopOpacity={isLight ? 0.06 : 0.1} />
              </linearGradient>
            </defs>
            <rect width={1080} height={1920} fill={`url(#grad-sheen-${uid})`} />
            {/* Soft sweeping contour bands */}
            <path
              d={`M -60 ${560 + Math.sin(driftPhase) * 26} Q 540 ${410 + Math.cos(driftPhase) * 32} 1140 ${620 - Math.sin(driftPhase) * 24}`}
              fill="none"
              stroke={hexToRgba(palette.accent, isLight ? 0.14 : 0.18)}
              strokeWidth={2}
            />
            <path
              d={`M -60 ${1360 - Math.cos(driftPhase) * 22} Q 540 ${1510 + Math.sin(driftPhase) * 26} 1140 ${1300 + Math.cos(driftPhase) * 22}`}
              fill="none"
              stroke={hexToRgba(palette.accent2, isLight ? 0.12 : 0.16)}
              strokeWidth={2}
            />
          </svg>
        </>
      )}

      {/* 2. GRID TREATMENT (Architectural / Data / Isometric Blueprint) */}
      {bgTreatment === 'grid' && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(ellipse 75% 52% at 50% 38%, ${hexToRgba(palette.accent, isLight ? 0.1 : 0.18)} 0%, transparent 72%)`,
            }}
          />
          <svg
            width={width}
            height={height}
            viewBox="0 0 1080 1920"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <defs>
              <pattern
                id={`grid-minor-${uid}`}
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
                patternTransform={`translate(0, ${((frame * 0.25 * motionIntensity) % 40).toFixed(2)})`}
              >
                <path
                  d="M 40 0 L 0 0 0 40"
                  fill="none"
                  stroke={palette.border}
                  strokeWidth={1}
                  strokeOpacity={isLight ? 0.34 : 0.22}
                />
              </pattern>
              <pattern
                id={`grid-major-${uid}`}
                width="160"
                height="160"
                patternUnits="userSpaceOnUse"
                patternTransform={`translate(0, ${((frame * 0.25 * motionIntensity) % 160).toFixed(2)})`}
              >
                <path
                  d="M 160 0 L 0 0 0 160"
                  fill="none"
                  stroke={palette.accent}
                  strokeWidth={1.3}
                  strokeOpacity={isLight ? 0.22 : 0.24}
                />
                {/* Crisp registration crosshairs at major intersections */}
                <line
                  x1="0"
                  y1="-6"
                  x2="0"
                  y2="6"
                  stroke={palette.accent}
                  strokeWidth={1.5}
                  strokeOpacity={isLight ? 0.42 : 0.48}
                />
                <line
                  x1="-6"
                  y1="0"
                  x2="6"
                  y2="0"
                  stroke={palette.accent}
                  strokeWidth={1.5}
                  strokeOpacity={isLight ? 0.42 : 0.48}
                />
              </pattern>
              <radialGradient id={`grid-fade-${uid}`} cx="50%" cy="46%" r="60%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
                <stop offset="72%" stopColor="#FFFFFF" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.18" />
              </radialGradient>
              <mask id={`grid-mask-${uid}`}>
                <rect width={1080} height={1920} fill={`url(#grid-fade-${uid})`} />
              </mask>
            </defs>
            <g mask={`url(#grid-mask-${uid})`}>
              <rect width={1080} height={1920} fill={`url(#grid-minor-${uid})`} />
              <rect width={1080} height={1920} fill={`url(#grid-major-${uid})`} />
            </g>
            {/* Subtle structural framing hairlines */}
            <line
              x1={44}
              y1={148}
              x2={1036}
              y2={148}
              stroke={hexToRgba(palette.border, 0.55)}
              strokeWidth={1}
            />
            <line
              x1={44}
              y1={1740}
              x2={1036}
              y2={1740}
              stroke={hexToRgba(palette.border, 0.55)}
              strokeWidth={1}
            />
          </svg>
        </>
      )}

      {/* 3. PAPER TREATMENT (Tactile Editorial Print & Fibers) */}
      {bgTreatment === 'paper' && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(ellipse 80% 56% at 50% 42%, ${hexToRgba(palette.accent, isLight ? 0.08 : 0.14)} 0%, transparent 74%)`,
            }}
          />
          <svg
            width={width}
            height={height}
            viewBox="0 0 1080 1920"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <defs>
              <pattern id={`paper-stipple-${uid}`} width="24" height="24" patternUnits="userSpaceOnUse">
                <circle
                  cx="4"
                  cy="6"
                  r="0.85"
                  fill={isLight ? palette.fg : '#FFFFFF'}
                  opacity={isLight ? 0.045 : 0.05}
                />
                <circle
                  cx="16"
                  cy="18"
                  r="0.7"
                  fill={isLight ? palette.muted : palette.accent}
                  opacity={isLight ? 0.045 : 0.05}
                />
              </pattern>
            </defs>
            <rect width={1080} height={1920} fill={`url(#paper-stipple-${uid})`} />
            {/* Subtle horizontal editorial notebook lines */}
            {Array.from({ length: 18 }, (_, i) => (
              <line
                key={i}
                x1={56}
                y1={160 + i * 94}
                x2={1024}
                y2={160 + i * 94}
                stroke={palette.border}
                strokeWidth={1}
                strokeOpacity={isLight ? 0.24 : 0.14}
              />
            ))}
            {/* Organic deterministic paper pulp fibers */}
            {PAPER_FIBERS.map((f, idx) => (
              <line
                key={`f-${idx}`}
                x1={f.x1.toFixed(1)}
                y1={f.y1.toFixed(1)}
                x2={f.x2.toFixed(1)}
                y2={f.y2.toFixed(1)}
                stroke={isLight ? '#8C7A60' : palette.muted}
                strokeWidth={1}
                strokeLinecap="round"
                opacity={f.op}
              />
            ))}
            {/* Deterministic mineral specks */}
            {PAPER_SPECKS.map((s, idx) => (
              <circle
                key={`s-${idx}`}
                cx={s.cx.toFixed(1)}
                cy={s.cy.toFixed(1)}
                r={s.r.toFixed(1)}
                fill={idx % 3 === 0 ? palette.accent : palette.fg}
                opacity={s.op}
              />
            ))}
            {/* Fine editorial outer margin frame */}
            <rect
              x={36}
              y={36}
              width={1008}
              height={1848}
              rx={10}
              fill="none"
              stroke={palette.border}
              strokeWidth={1.5}
              strokeOpacity={isLight ? 0.58 : 0.34}
            />
          </svg>
        </>
      )}

      {/* 4. STARFIELD TREATMENT (Cosmic Parallax + Soft Nebula) */}
      {bgTreatment === 'starfield' && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: -60,
              background: [
                `radial-gradient(ellipse 66% 42% at ${blob1X.toFixed(1)}% ${blob1Y.toFixed(1)}%, ${hexToRgba(palette.accent, isLight ? 0.18 : 0.26 + glowIntensity * 0.14)} 0%, transparent 72%)`,
                `radial-gradient(ellipse 58% 44% at ${blob2X.toFixed(1)}% ${blob2Y.toFixed(1)}%, ${hexToRgba(palette.accent2, isLight ? 0.14 : 0.22 + glowIntensity * 0.1)} 0%, transparent 74%)`,
              ].join(', '),
            }}
          />
          <svg
            width={width}
            height={height}
            viewBox="0 0 1080 1920"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            {/* Subtle large orbital ellipses in background */}
            <g transform={`rotate(${(tSec * 2.5 * motionIntensity).toFixed(2)} 540 960)`}>
              <ellipse
                cx={540}
                cy={960}
                rx={460}
                ry={680}
                fill="none"
                stroke={palette.accent}
                strokeWidth={1.4}
                strokeDasharray="10 18"
                strokeOpacity={isLight ? 0.16 : 0.22}
              />
            </g>
            <g transform={`rotate(${(-tSec * 1.8 * motionIntensity - 24).toFixed(2)} 540 960)`}>
              <ellipse
                cx={540}
                cy={960}
                rx={390}
                ry={590}
                fill="none"
                stroke={palette.accent2}
                strokeWidth={1.2}
                strokeDasharray="6 16"
                strokeOpacity={isLight ? 0.14 : 0.18}
              />
            </g>
            {/* Twinkling deterministic parallax stars */}
            {STAR_DATA.map((st, idx) => {
              const yPos = ((st.y - frame * st.drift * motionIntensity) % 1920 + 1920) % 1920;
              const twinkle = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(tSec * st.speed + st.phase));
              const fill =
                st.tint === 'accent'
                  ? palette.accent
                  : st.tint === 'accent2'
                    ? palette.accent2
                    : isLight
                      ? palette.fg
                      : '#FFFFFF';
              const alpha = twinkle * (isLight ? 0.36 : 0.85);

              if (st.isDiamond) {
                const arm = st.r * 2.5;
                return (
                  <g key={idx} transform={`translate(${st.x.toFixed(1)}, ${yPos.toFixed(1)})`} opacity={alpha.toFixed(3)}>
                    <polygon
                      points={`0,${-arm} ${arm * 0.26},${-arm * 0.26} ${arm},0 ${arm * 0.26},${arm * 0.26} 0,${arm} ${-arm * 0.26},${arm * 0.26} ${-arm},0 ${-arm * 0.26},${-arm * 0.26}`}
                      fill={fill}
                    />
                  </g>
                );
              }
              return (
                <circle
                  key={idx}
                  cx={st.x.toFixed(1)}
                  cy={yPos.toFixed(1)}
                  r={st.r.toFixed(2)}
                  fill={fill}
                  opacity={alpha.toFixed(3)}
                />
              );
            })}
          </svg>
        </>
      )}

      {/* 5. NOISE TREATMENT (Documentary Film Stipple + Topographic Rings) */}
      {bgTreatment === 'noise' && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(ellipse 72% 52% at 50% 34%, ${hexToRgba(palette.accent, isLight ? 0.1 : 0.16)} 0%, transparent 72%)`,
            }}
          />
          <svg
            width={width}
            height={height}
            viewBox="0 0 1080 1920"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <defs>
              <pattern
                id={`noise-dots-${uid}`}
                width="120"
                height="120"
                patternUnits="userSpaceOnUse"
                patternTransform={`translate(${((Math.floor(frame / 2) * 37) % 120)}, ${((Math.floor(frame / 2) * 53) % 120)})`}
              >
                {NOISE_TILE_DOTS.map((d, i) => (
                  <circle
                    key={i}
                    cx={d.x.toFixed(1)}
                    cy={d.y.toFixed(1)}
                    r={d.r.toFixed(2)}
                    fill={d.bright ? '#FFFFFF' : '#000000'}
                    opacity={(d.op * (isLight ? 0.55 : 0.85)).toFixed(3)}
                  />
                ))}
              </pattern>
            </defs>
            {/* Subtle documentary topographic contour arcs */}
            {[260, 400, 550, 720, 910].map((rad, i) => (
              <ellipse
                key={i}
                cx={540 + Math.sin(driftPhase + i) * 14}
                cy={880 + Math.cos(driftPhase * 0.7 + i) * 12}
                rx={rad}
                ry={rad * 1.18}
                fill="none"
                stroke={palette.border}
                strokeWidth={1.2}
                strokeDasharray={i % 2 === 0 ? 'none' : '8 12'}
                strokeOpacity={isLight ? 0.24 : 0.18}
              />
            ))}
            <rect width={1080} height={1920} fill={`url(#noise-dots-${uid})`} />
          </svg>
        </>
      )}

      {/* 6. SPOTLIGHT TREATMENT (Dramatic Stage Cone & Floor Glow) */}
      {bgTreatment === 'spotlight' && (
        <>
          <svg
            width={width}
            height={height}
            viewBox="0 0 1080 1920"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <defs>
              <linearGradient id={`spot-cone-${uid}`} x1="50%" y1="0%" x2="50%" y2="100%">
                <stop
                  offset="0%"
                  stopColor={palette.accent}
                  stopOpacity={isLight ? 0.24 : 0.34 + glowIntensity * 0.15}
                />
                <stop
                  offset="48%"
                  stopColor={palette.accent2}
                  stopOpacity={isLight ? 0.1 : 0.16}
                />
                <stop offset="100%" stopColor={palette.bg} stopOpacity="0" />
              </linearGradient>
              <radialGradient id={`spot-pool-${uid}`} cx="50%" cy="50%" r="50%">
                <stop
                  offset="0%"
                  stopColor={palette.accent}
                  stopOpacity={isLight ? 0.22 : 0.3}
                />
                <stop offset="62%" stopColor={palette.accent2} stopOpacity={0.08} />
                <stop offset="100%" stopColor={palette.bg} stopOpacity="0" />
              </radialGradient>
            </defs>
            {/* Primary overhead spotlight beam */}
            <polygon
              points={`${(440 + Math.sin(driftPhase) * 32).toFixed(1)},0 ${(640 + Math.sin(driftPhase) * 32).toFixed(1)},0 1060,1520 20,1520`}
              fill={`url(#spot-cone-${uid})`}
            />
            {/* Secondary crisp inner beam */}
            <polygon
              points={`${(490 + Math.sin(driftPhase) * 20).toFixed(1)},0 ${(590 + Math.sin(driftPhase) * 20).toFixed(1)},0 860,1440 220,1440`}
              fill={`url(#spot-cone-${uid})`}
              opacity={0.55}
            />
            {/* Stage center illumination pool */}
            <ellipse cx={540} cy={920} rx={520} ry={420} fill={`url(#spot-pool-${uid})`} />
            {/* Clean lower floor horizon arc */}
            <ellipse
              cx={540}
              cy={1560}
              rx={440}
              ry={72}
              fill="none"
              stroke={hexToRgba(palette.accent, isLight ? 0.2 : 0.28)}
              strokeWidth={1.6}
            />
          </svg>
        </>
      )}

      {/* Subtle Vignette Layer (Always keeps center crisp and legible; skipped for flat) */}
      {bgTreatment !== 'flat' && vignetteStrength > 0.01 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `radial-gradient(ellipse 78% 72% at 50% 47%, transparent 48%, ${hexToRgba(vignetteHex, vignetteStrength * 0.45)} 80%, ${hexToRgba(vignetteHex, vignetteStrength)} 100%)`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
