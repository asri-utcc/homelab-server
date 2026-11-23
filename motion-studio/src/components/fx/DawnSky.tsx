import React from 'react';
import { Easing, interpolate, random, useCurrentFrame, useVideoConfig } from 'remotion';

export interface DawnSkyProps {
  /** Progression from pre-dawn night (0) to radiant morning Dhuha light (1) */
  progress?: number;
  /** Horizontal sun position: 0..1 fraction of width, or pixels if > 1 (default 0.5) */
  sunX?: number;
  /** Starting vertical sun position at progress=0: 0..1 fraction of height, or px if > 1 (default 0.84) */
  sunYStart?: number;
  /** Ending vertical sun position at progress=1: 0..1 fraction of height, or px if > 1 (default 0.24) */
  sunYEnd?: number;
  /** Scale multiplier for solar disc & corona (default 1) */
  sunScale?: number;
  /** Show pre-dawn twinkling stars that fade as daylight rises (default true) */
  showStars?: boolean;
  /** Show layered warm horizon mist haze (default true) */
  showHorizonHaze?: boolean;
  style?: React.CSSProperties;
}

const DAWN_PALETTE = [
  '#0B1026', // 0.00 Pre-dawn deep indigo
  '#3B2A6B', // 0.25 Twilight violet
  '#F28C5B', // 0.50 Sunrise amber coral
  '#FFD9A0', // 0.75 Warm morning gold
  '#FFF4DC', // 1.00 Bright Dhuha cream
] as const;

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToCss([r, g, b]: RGB, alpha = 1): string {
  const rr = Math.round(Math.max(0, Math.min(255, r)));
  const gg = Math.round(Math.max(0, Math.min(255, g)));
  const bb = Math.round(Math.max(0, Math.min(255, b)));
  return alpha >= 1 ? `rgb(${rr}, ${gg}, ${bb})` : `rgba(${rr}, ${gg}, ${bb}, ${alpha.toFixed(3)})`;
}

function samplePalette(tRaw: number, alpha = 1): string {
  const t = Math.max(0, Math.min(1, tRaw));
  const scaled = t * (DAWN_PALETTE.length - 1);
  const idx = Math.min(DAWN_PALETTE.length - 2, Math.floor(scaled));
  const localT = scaled - idx;
  const c0 = hexToRgb(DAWN_PALETTE[idx]);
  const c1 = hexToRgb(DAWN_PALETTE[idx + 1]);
  return rgbToCss(
    [
      c0[0] + (c1[0] - c0[0]) * localT,
      c0[1] + (c1[1] - c0[1]) * localT,
      c0[2] + (c1[2] - c0[2]) * localT,
    ],
    alpha,
  );
}

function resolveCoord(value: number, axisSize: number): number {
  return value <= 1 ? value * axisSize : value;
}

const STAR_COUNT = 56;

export const DawnSky: React.FC<DawnSkyProps> = ({
  progress = 0.5,
  sunX = 0.5,
  sunYStart = 0.84,
  sunYEnd = 0.24,
  sunScale = 1,
  showStars = true,
  showHorizonHaze = true,
  style,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const p = Math.max(0, Math.min(1, progress));
  const easedP = Easing.inOut(Easing.quad)(p);
  const tSec = frame / Math.max(1, fps);

  // Staggered palette sampling creates authentic atmospheric gradient depth
  // from deep upper sky down to the warm luminous horizon.
  const zenithColor = samplePalette(p * 0.42);
  const upperMidColor = samplePalette(Math.min(1, p * 0.68 + 0.08));
  const lowerMidColor = samplePalette(Math.min(1, p * 0.9 + 0.16));
  const horizonColor = samplePalette(Math.min(1, p * 1.05 + 0.24));

  const sx = resolveCoord(sunX, width);
  const syStart = resolveCoord(sunYStart, height);
  const syEnd = resolveCoord(sunYEnd, height);
  const sy = interpolate(easedP, [0, 1], [syStart, syEnd]);

  const baseUnit = Math.min(width, height);
  const coreRadius = baseUnit * 0.085 * sunScale;
  const coronaRadius = baseUnit * 0.46 * sunScale;
  const bloomRadius = baseUnit * 0.92 * sunScale;

  const sunIntensity = interpolate(p, [0, 0.18, 0.55, 1], [0.22, 0.68, 0.95, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const starLayerOpacity = interpolate(p, [0, 0.22, 0.5], [0.85, 0.42, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const hazeWarmth = samplePalette(Math.min(1, 0.35 + p * 0.65), 0.44);
  const hazeCream = samplePalette(Math.min(1, 0.65 + p * 0.35), 0.36);

  // Subtle slow horizontal drift for atmospheric veil
  const driftX = Math.sin(tSec * 0.18) * width * 0.03;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: `linear-gradient(180deg, ${zenithColor} 0%, ${upperMidColor} 34%, ${lowerMidColor} 68%, ${horizonColor} 100%)`,
        ...style,
      }}
    >
      {/* Pre-dawn twinkling starfield that fades naturally as sunrise brightens */}
      {showStars && starLayerOpacity > 0.005 && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{
            position: 'absolute',
            inset: 0,
            opacity: starLayerOpacity,
            pointerEvents: 'none',
          }}
        >
          {Array.from({ length: STAR_COUNT }, (_, i) => {
            const x = random(`dawn-star-x-${i}`) * width;
            const y = random(`dawn-star-y-${i}`) * height * 0.62;
            const r = 0.8 + random(`dawn-star-r-${i}`) * 2.1;
            const phase = random(`dawn-star-p-${i}`) * Math.PI * 2;
            const speed = 1.1 + random(`dawn-star-s-${i}`) * 2.2;
            const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tSec * speed + phase));
            const heightFade = Math.max(0, 1 - y / (height * 0.64));
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={r}
                fill="#FFF4DC"
                opacity={twinkle * heightFade}
              />
            );
          })}
        </svg>
      )}

      {/* Wide atmospheric solar bloom */}
      <div
        style={{
          position: 'absolute',
          left: sx - bloomRadius,
          top: sy - bloomRadius,
          width: bloomRadius * 2,
          height: bloomRadius * 2,
          borderRadius: '50%',
          opacity: sunIntensity * 0.85,
          background: `radial-gradient(circle, ${samplePalette(
            Math.min(1, 0.72 + p * 0.28),
            0.52,
          )} 0%, ${samplePalette(Math.min(1, 0.5 + p * 0.4), 0.24)} 42%, rgba(255, 244, 220, 0) 74%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Mid solar corona */}
      <div
        style={{
          position: 'absolute',
          left: sx - coronaRadius,
          top: sy - coronaRadius,
          width: coronaRadius * 2,
          height: coronaRadius * 2,
          borderRadius: '50%',
          opacity: sunIntensity,
          background:
            'radial-gradient(circle, rgba(255, 250, 236, 0.92) 0%, rgba(255, 217, 160, 0.58) 32%, rgba(242, 140, 91, 0.18) 62%, rgba(242, 140, 91, 0) 78%)',
          pointerEvents: 'none',
        }}
      />

      {/* Luminous solar core */}
      <div
        style={{
          position: 'absolute',
          left: sx - coreRadius,
          top: sy - coreRadius,
          width: coreRadius * 2,
          height: coreRadius * 2,
          borderRadius: '50%',
          opacity: Math.min(1, sunIntensity + 0.12),
          background:
            'radial-gradient(circle, #FFFFFF 0%, #FFF4DC 48%, rgba(255, 217, 160, 0.65) 78%, rgba(255, 217, 160, 0) 100%)',
          boxShadow: `0 0 ${Math.round(coreRadius * 1.4)}px rgba(255, 232, 180, ${
            0.65 * sunIntensity
          })`,
          pointerEvents: 'none',
        }}
      />

      {/* Horizon atmospheric haze layers */}
      {showHorizonHaze && (
        <>
          <div
            style={{
              position: 'absolute',
              left: -width * 0.2 + driftX,
              right: -width * 0.2 - driftX,
              bottom: -height * 0.08,
              height: height * 0.42,
              background: `radial-gradient(ellipse 75% 65% at 50% 85%, ${hazeCream} 0%, ${hazeWarmth} 46%, rgba(255, 244, 220, 0) 82%)`,
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: height * 0.26,
              background: `linear-gradient(180deg, rgba(255, 244, 220, 0) 0%, ${samplePalette(
                Math.min(1, 0.55 + p * 0.45),
                0.28,
              )} 65%, ${samplePalette(Math.min(1, 0.72 + p * 0.28), 0.46)} 100%)`,
              pointerEvents: 'none',
            }}
          />
        </>
      )}
    </div>
  );
};
