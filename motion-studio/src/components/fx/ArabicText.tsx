import React from 'react';
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { ARABIC_FONT_FAMILY } from '../ThaiFontLoader';

export interface ArabicTextProps {
  /** Arabic script text (with optional tashkeel/diacritics) */
  text: string;
  /** Font size in px (defaults adaptively: 46 portrait / 54 landscape) */
  fontSize?: number;
  /** Text color (default '#FFF4DC') */
  color?: string;
  /** Warm luminous glow: true for default gold glow, CSS color string, or false to disable (default true) */
  glow?: boolean | string;
  /** Frame when right-to-left reveal begins (ignored if progress prop is supplied; default 0) */
  startFrame?: number;
  /** Reveal duration in frames (ignored if progress prop is supplied; default 36) */
  durationFrames?: number;
  /** Optional explicit reveal progress 0..1 overriding frame-based reveal */
  progress?: number;
  /** Font weight (default 700) */
  fontWeight?: number;
  /** Horizontal alignment (default 'center') */
  align?: 'center' | 'right' | 'left';
  /** Optional max width in px */
  maxWidth?: number;
  style?: React.CSSProperties;
}

export const ArabicText: React.FC<ArabicTextProps> = ({
  text,
  fontSize,
  color = '#FFF4DC',
  glow = true,
  startFrame = 0,
  durationFrames = 36,
  progress,
  fontWeight = 700,
  align = 'center',
  maxWidth,
  style,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const resolvedFontSize = fontSize ?? (width > height ? 54 : 46);
  const resolvedMaxWidth = maxWidth ?? Math.round(width * 0.86);

  const rawProgress =
    typeof progress === 'number'
      ? Math.max(0, Math.min(1, progress))
      : interpolate(frame, [startFrame, startFrame + Math.max(1, durationFrames)], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

  const reveal = Easing.out(Easing.cubic)(rawProgress);
  // Clip from the left inward so Arabic script unveils naturally from right to left (RTL)
  const leftClipPct = (1 - reveal) * 100;
  const opacity = interpolate(reveal, [0, 0.15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const glowColor =
    typeof glow === 'string' ? glow : glow ? 'rgba(255, 217, 160, 0.58)' : '';
  const textShadow = glowColor
    ? `0 0 22px ${glowColor}, 0 0 42px ${glowColor}, 0 4px 16px rgba(5, 8, 22, 0.65)`
    : '0 4px 16px rgba(5, 8, 22, 0.55)';

  return (
    <div
      dir="rtl"
      lang="ar"
      style={{
        direction: 'rtl',
        unicodeBidi: 'isolate',
        fontFamily: ARABIC_FONT_FAMILY,
        fontSize: resolvedFontSize,
        fontWeight,
        lineHeight: 1.7,
        color,
        textAlign: align,
        maxWidth: resolvedMaxWidth,
        margin: align === 'center' ? '0 auto' : undefined,
        paddingTop: 12,
        paddingBottom: 14,
        paddingLeft: 14,
        paddingRight: 14,
        opacity,
        textShadow,
        // Generous negative top/right/bottom inset ensures diacritics & glow are never cropped
        clipPath:
          leftClipPct <= 0.1 ? 'none' : `inset(-28px -28px -28px ${leftClipPct.toFixed(2)}%)`,
        ...style,
      }}
    >
      {text}
    </div>
  );
};
