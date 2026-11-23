import React, { useId } from 'react';
import { random, useCurrentFrame, useVideoConfig } from 'remotion';

export interface ParticleFieldProps {
  /** Number of floating light motes & bokeh orbs (default 80) */
  count?: number;
  /** Deterministic seed string/number (default 'particles') */
  seed?: string | number;
  /** Primary particle tint color (default '#FFE8B6') */
  color?: string;
  /** Upward drift velocity multiplier in px/sec scale (default 28) */
  drift?: number;
  /** Base particle radius in px (default 4.5) */
  size?: number;
  /** Overall layer opacity 0..1 (default 0.85) */
  opacity?: number;
  /** Ratio of soft larger bokeh orbs vs crisp motes 0..1 (default 0.28) */
  bokehRatio?: number;
  /** CSS blend mode for luminous particles (default 'screen') */
  blendMode?: React.CSSProperties['mixBlendMode'];
  style?: React.CSSProperties;
}

export const ParticleField: React.FC<ParticleFieldProps> = ({
  count = 80,
  seed = 'particles',
  color = '#FFE8B6',
  drift = 28,
  size = 4.5,
  opacity = 0.85,
  bokehRatio = 0.28,
  blendMode = 'screen',
  style,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const tSec = frame / Math.max(1, fps);
  const total = Math.max(0, Math.round(count));
  const margin = Math.max(40, size * 6);
  const spanY = height + margin * 2;
  const spanX = width + margin * 2;

  const softGradId = `pf-soft-${uid}`;
  const crispGradId = `pf-crisp-${uid}`;

  const particles = Array.from({ length: total }, (_, i) => {
    const baseKey = `${seed}-${i}`;
    const x0 = random(`${baseKey}-x`) * spanX - margin;
    const y0 = random(`${baseKey}-y`) * spanY;
    const isBokeh = random(`${baseKey}-b`) < bokehRatio;
    const sizeRand = random(`${baseKey}-s`);
    const radius = isBokeh
      ? size * (1.8 + sizeRand * 3.4)
      : size * (0.45 + sizeRand * 0.95);

    // Depth factor links speed & opacity cleanly
    const speedFactor = 0.45 + random(`${baseKey}-v`) * 1.15;
    const rawY = y0 - tSec * drift * speedFactor;
    const wrappedY = (((rawY % spanY) + spanY) % spanY) - margin;

    const swayFreq = 0.45 + random(`${baseKey}-sf`) * 0.9;
    const swayAmp = (isBokeh ? 26 : 16) * (0.4 + random(`${baseKey}-sa`) * 0.9);
    const swayPhase = random(`${baseKey}-sp`) * Math.PI * 2;
    const x = x0 + Math.sin(tSec * swayFreq + swayPhase) * swayAmp;

    const twinkleFreq = 1.4 + random(`${baseKey}-tf`) * 2.8;
    const twinklePhase = random(`${baseKey}-tp`) * Math.PI * 2;
    const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tSec * twinkleFreq + twinklePhase));

    // Gentle fade near top/bottom edges so wrapping is invisible
    const edgeFade = Math.min(
      1,
      Math.max(0, (wrappedY + margin) / (margin * 2.2)),
      Math.max(0, (height + margin - wrappedY) / (margin * 2.2)),
    );

    const baseOpacity = isBokeh
      ? 0.22 + random(`${baseKey}-o`) * 0.3
      : 0.48 + random(`${baseKey}-o`) * 0.52;

    return {
      x,
      y: wrappedY,
      r: radius,
      isBokeh,
      alpha: baseOpacity * twinkle * edgeFade,
    };
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        mixBlendMode: blendMode,
        opacity: Math.max(0, Math.min(1, opacity)),
        ...style,
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        <defs>
          <radialGradient id={softGradId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.85" />
            <stop offset="42%" stopColor={color} stopOpacity="0.34" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={crispGradId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="45%" stopColor={color} stopOpacity="0.85" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>

        {particles.map((p, idx) => (
          <circle
            key={idx}
            cx={p.x}
            cy={p.y}
            r={p.r}
            fill={`url(#${p.isBokeh ? softGradId : crispGradId})`}
            opacity={p.alpha}
          />
        ))}
      </svg>
    </div>
  );
};
