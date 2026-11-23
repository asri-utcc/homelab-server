import React from 'react';
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export type TransitionKind = 'lightLeak' | 'zoomThrough' | 'iris' | 'fade';

export interface TransitionOptions {
  /** Custom enter transition duration in frames (default ~0.4s) */
  inFrames?: number;
  /** Custom exit transition duration in frames (default ~0.36s) */
  outFrames?: number;
  /** Skip entrance transition (useful for first scene) */
  skipIn?: boolean;
  /** Skip exit transition (useful for final scene) */
  skipOut?: boolean;
}

export interface TransitionResult extends React.CSSProperties {
  opacity: number;
  transform: string;
  filter: string;
  clipPath?: string;
}

/**
 * Computes enter & exit cinematic styles for a scene without @remotion/transitions.
 * Pair 'lightLeak' with <LightLeakFlash at={cutFrame} /> for seamless zero-black-frame transitions.
 */
export function transitionStyle(
  localFrame: number,
  durationFrames: number,
  kind: TransitionKind = 'lightLeak',
  fps = 30,
  options?: TransitionOptions,
): TransitionResult {
  const safeDur = Math.max(2, durationFrames);
  const maxHalf = Math.max(1, Math.floor(safeDur / 3));
  const inDur = options?.skipIn
    ? 0
    : Math.max(1, Math.min(options?.inFrames ?? Math.round(fps * 0.4), maxHalf));
  const outDur = options?.skipOut
    ? 0
    : Math.max(1, Math.min(options?.outFrames ?? Math.round(fps * 0.36), maxHalf));

  const inProgress =
    inDur <= 0
      ? 1
      : Easing.out(Easing.cubic)(
          interpolate(localFrame, [0, inDur], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        );

  const outStart = Math.max(inDur, safeDur - outDur);
  const outProgress =
    outDur <= 0 || localFrame <= outStart
      ? 0
      : Easing.in(Easing.cubic)(
          interpolate(localFrame, [outStart, safeDur], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        );

  if (kind === 'fade') {
    const opacity = inProgress * (1 - outProgress);
    return {
      opacity,
      transform: 'scale(1)',
      filter: 'none',
    };
  }

  if (kind === 'zoomThrough') {
    const inScale = interpolate(inProgress, [0, 1], [0.92, 1]);
    const outScale = interpolate(outProgress, [0, 1], [1, 1.09]);
    const scale = inScale * outScale;
    const blur = interpolate(inProgress, [0, 1], [7, 0]) + interpolate(outProgress, [0, 1], [0, 7]);
    const opacity =
      interpolate(inProgress, [0, 0.85], [0, 1], { extrapolateRight: 'clamp' }) *
      interpolate(outProgress, [0.15, 1], [1, 0], { extrapolateLeft: 'clamp' });

    return {
      opacity,
      transform: `scale(${scale.toFixed(4)})`,
      filter: blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : 'none',
    };
  }

  if (kind === 'iris') {
    const inRadius = interpolate(inProgress, [0, 1], [8, 125]);
    const outRadius = interpolate(outProgress, [0, 1], [125, 8]);
    const radius = outProgress > 0 ? outRadius : inRadius;
    const scale =
      interpolate(inProgress, [0, 1], [1.05, 1]) * interpolate(outProgress, [0, 1], [1, 0.96]);
    const opacity =
      interpolate(inProgress, [0, 0.35], [0, 1], { extrapolateRight: 'clamp' }) *
      interpolate(outProgress, [0.65, 1], [1, 0], { extrapolateLeft: 'clamp' });

    return {
      opacity,
      transform: `scale(${scale.toFixed(4)})`,
      filter: 'none',
      clipPath: radius >= 124 ? 'none' : `circle(${radius.toFixed(1)}% at 50% 50%)`,
    };
  }

  // Default: 'lightLeak' — golden brightness swell + subtle scale & softness
  const inScale = interpolate(inProgress, [0, 1], [1.04, 1]);
  const outScale = interpolate(outProgress, [0, 1], [1, 1.03]);
  const brightness =
    1 +
    interpolate(inProgress, [0, 1], [0.35, 0]) +
    interpolate(outProgress, [0, 1], [0, 0.3]);
  const blur =
    interpolate(inProgress, [0, 1], [4.5, 0]) + interpolate(outProgress, [0, 1], [0, 4]);
  const opacity =
    interpolate(inProgress, [0, 0.75], [0, 1], { extrapolateRight: 'clamp' }) *
    interpolate(outProgress, [0.25, 1], [1, 0], { extrapolateLeft: 'clamp' });

  const filterParts: string[] = [];
  if (Math.abs(brightness - 1) > 0.01) filterParts.push(`brightness(${brightness.toFixed(3)})`);
  if (blur > 0.15) filterParts.push(`blur(${blur.toFixed(2)}px)`);

  return {
    opacity,
    transform: `scale(${(inScale * outScale).toFixed(4)})`,
    filter: filterParts.length ? filterParts.join(' ') : 'none',
  };
}

export interface LightLeakFlashProps {
  /** Frame index (or array of frame indices) where scene cut light-leak flash peaks */
  at: number | number[];
  /** Total duration of each golden flash in frames (default 18) */
  durationFrames?: number;
  /** Primary golden flash color (default '#FFD9A0') */
  color?: string;
  /** Secondary amber/warm leak tint (default '#F28C5B') */
  secondaryColor?: string;
  /** Peak intensity 0..1 (default 0.92) */
  intensity?: number;
  style?: React.CSSProperties;
}

function withAlpha(color: string, alphaHex: string): string {
  const c = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return `${c}${alphaHex}`;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}${alphaHex}`;
  }
  return c;
}

export const LightLeakFlash: React.FC<LightLeakFlashProps> = ({
  at,
  durationFrames = 18,
  color = '#FFD9A0',
  secondaryColor = '#F28C5B',
  intensity = 0.92,
  style,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const cutFrames = Array.isArray(at) ? at : [at];
  const half = Math.max(2, durationFrames / 2);

  // Find strongest active flash peak around current frame
  let peak = 0;
  let signedDelta = 0;
  for (const cut of cutFrames) {
    const delta = frame - cut;
    const dist = Math.abs(delta);
    if (dist < half) {
      const normalized = 1 - dist / half;
      const eased = Easing.out(Easing.quad)(normalized);
      if (eased > peak) {
        peak = eased;
        signedDelta = delta / half; // -1..1 sweep across frame
      }
    }
  }

  if (peak <= 0.005) return null;

  const sweepX = width * (0.5 + signedDelta * 0.32);
  const sweepY = height * (0.44 - signedDelta * 0.08);
  const bloomSize = Math.max(width, height) * (0.85 + peak * 0.45);
  const alpha = Math.max(0, Math.min(1, peak * intensity));

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        mixBlendMode: 'screen',
        opacity: alpha,
        zIndex: 80,
        ...style,
      }}
    >
      {/* Sweeping diagonal golden light leak wash (oversized horizontally to avoid translate3d edge seams) */}
      <div
        style={{
          position: 'absolute',
          left: -Math.round(width * 0.25),
          right: -Math.round(width * 0.25),
          top: -120,
          bottom: -120,
          background: `linear-gradient(125deg, rgba(255,244,220,0) 10%, ${withAlpha(secondaryColor, '88')} 38%, ${withAlpha(color, 'DD')} 52%, rgba(255,255,255,0.85) 60%, ${withAlpha(color, '66')} 74%, rgba(255,244,220,0) 92%)`,
          transform: `translate3d(${(signedDelta * width * 0.18).toFixed(1)}px, 0, 0)`,
        }}
      />

      {/* Intense central warm bloom */}
      <div
        style={{
          position: 'absolute',
          left: sweepX - bloomSize / 2,
          top: sweepY - bloomSize / 2,
          width: bloomSize,
          height: bloomSize,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(255, 255, 250, 0.92) 0%, ${withAlpha(color, 'B8')} 28%, ${withAlpha(secondaryColor, '44')} 56%, rgba(255,244,220,0) 74%)`,
        }}
      />

      {/* Horizontal anamorphic cinema lens streak */}
      <div
        style={{
          position: 'absolute',
          left: -width * 0.1,
          right: -width * 0.1,
          top: sweepY - height * 0.025,
          height: height * 0.05,
          background: `linear-gradient(90deg, rgba(255,244,220,0) 0%, ${withAlpha(color, 'BB')} 35%, #FFFFFF 50%, ${withAlpha(color, 'BB')} 65%, rgba(255,244,220,0) 100%)`,
          filter: 'blur(14px)',
          opacity: 0.78,
        }}
      />
    </div>
  );
};
