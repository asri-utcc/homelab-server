import React from 'react';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { THAI_FONT_FAMILY } from '../ThaiFontLoader';

export interface CountUpProps {
  /** Starting numeric value (default 0) */
  from?: number;
  /** Ending target numeric value (default 100) */
  to?: number;
  /** Frame when count-up begins (default 0) */
  startFrame?: number;
  /** Duration of the count animation in frames (default 45) */
  durationFrames?: number;
  /** Custom formatter for the displayed number */
  format?: (value: number) => string;
  /** Number of decimal places for default formatter (default 0) */
  decimals?: number;
  /** Optional prefix text (e.g. '+') */
  prefix?: string;
  /** Optional suffix text (e.g. ' ข้อต่อ') */
  suffix?: string;
  /** Peak scale factor for the completion spring pop (default 1.14) */
  popScale?: number;
  /** Optional glow color pulsing on completion pop */
  popGlowColor?: string;
  style?: React.CSSProperties;
}

export const CountUp: React.FC<CountUpProps> = ({
  from = 0,
  to = 100,
  startFrame = 0,
  durationFrames = 45,
  format,
  decimals = 0,
  prefix = '',
  suffix = '',
  popScale = 1.14,
  popGlowColor,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const dur = Math.max(1, durationFrames);
  const endFrame = startFrame + dur;

  const rawT = interpolate(frame, [startFrame, endFrame], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const easedT = Easing.out(Easing.cubic)(rawT);
  const currentValue = from + (to - from) * easedT;

  // Completion spring pop pulse: rises rapidly to popScale then settles smoothly back to 1.0
  let scale = 1;
  let glowStrength = 0;
  if (frame >= endFrame) {
    const postFrame = frame - endFrame;
    const popIn = spring({
      frame: postFrame,
      fps,
      config: { damping: 10, stiffness: 260, mass: 0.6 },
    });
    const settle = spring({
      frame: Math.max(0, postFrame - 4),
      fps,
      config: { damping: 14, stiffness: 160, mass: 0.8 },
    });
    const pulse = Math.max(0, popIn - settle * 0.92);
    scale = 1 + pulse * (popScale - 1);
    glowStrength = Math.max(0, Math.min(1, pulse * 1.4));
  }

  const formatted = format
    ? format(currentValue)
    : decimals > 0
      ? currentValue.toLocaleString('en-US', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      : Math.round(currentValue).toLocaleString('en-US');

  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: THAI_FONT_FAMILY,
        fontVariantNumeric: 'tabular-nums',
        transform: `scale(${scale.toFixed(4)})`,
        transformOrigin: 'center center',
        filter:
          popGlowColor && glowStrength > 0.02
            ? `drop-shadow(0 0 ${(22 * glowStrength).toFixed(1)}px ${popGlowColor})`
            : undefined,
        ...style,
      }}
    >
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};
