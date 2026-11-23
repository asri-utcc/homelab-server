import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { THAI_FONT_FAMILY } from '../ThaiFontLoader';

export interface KineticTitleProps {
  /** Thai or multilingual headline text */
  text: string;
  /** Frame at which word-by-word entrance begins (default 0) */
  startFrame?: number;
  /** Highlight accent color used for gradient + glow (default '#FFD166') */
  accent?: string;
  /** Secondary gradient color for highlighted text (default '#FFF4DC') */
  accentSecondary?: string;
  /** Word or phrase (or array of phrases) to emphasize with gradient + glow */
  highlight?: string | string[];
  /** Font size in px (defaults adaptively to orientation: 58 portrait / 64 landscape) */
  fontSize?: number;
  /** Text alignment (default 'center') */
  align?: 'left' | 'center' | 'right';
  /** Base text color for non-highlighted words (default '#FFFFFF') */
  color?: string;
  /** Frames between consecutive word entrances (default 3) */
  staggerFrames?: number;
  /** Font weight (default 700) */
  fontWeight?: number;
  /** Custom font family override (default THAI_FONT_FAMILY) */
  fontFamily?: string;
  /** Optional max width in px */
  maxWidth?: number;
  style?: React.CSSProperties;
}

function withAlpha(color: string, alphaHex: string): string {
  const c = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return `${c}${alphaHex}`;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    const exp = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    return `${exp}${alphaHex}`;
  }
  return c;
}

interface SegmentedToken {
  text: string;
  isHighlighted: boolean;
  isWhitespace: boolean;
}

type SegmenterLike = {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
};

function segmentThaiText(input: string): string[] {
  if (!input) return [];
  const IntlObj = Intl as unknown as {
    Segmenter?: new (
      locale: string,
      options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
    ) => SegmenterLike;
  };
  if (typeof IntlObj.Segmenter === 'function') {
    const seg = new IntlObj.Segmenter('th', { granularity: 'word' });
    const out: string[] = [];
    for (const part of seg.segment(input)) {
      if (part.segment) out.push(part.segment);
    }
    return out;
  }
  return input.split(/(\s+)/).filter(Boolean);
}

function tokenizeWithHighlights(text: string, highlight?: string | string[]): SegmentedToken[] {
  const highlights = (Array.isArray(highlight) ? highlight : highlight ? [highlight] : [])
    .map((h) => h.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  type Span = { text: string; isHighlighted: boolean };
  let spans: Span[] = [{ text, isHighlighted: false }];

  for (const kw of highlights) {
    const next: Span[] = [];
    for (const sp of spans) {
      if (sp.isHighlighted || !sp.text.includes(kw)) {
        next.push(sp);
        continue;
      }
      const parts = sp.text.split(kw);
      parts.forEach((p, idx) => {
        if (p) next.push({ text: p, isHighlighted: false });
        if (idx < parts.length - 1) next.push({ text: kw, isHighlighted: true });
      });
    }
    spans = next;
  }

  const tokens: SegmentedToken[] = [];
  for (const sp of spans) {
    const pieces = segmentThaiText(sp.text);
    for (const piece of pieces) {
      tokens.push({
        text: piece,
        isHighlighted: sp.isHighlighted,
        isWhitespace: /^\s+$/.test(piece),
      });
    }
  }
  return tokens;
}

export const KineticTitle: React.FC<KineticTitleProps> = ({
  text,
  startFrame = 0,
  accent = '#FFD166',
  accentSecondary = '#FFF4DC',
  highlight,
  fontSize,
  align = 'center',
  color = '#FFFFFF',
  staggerFrames = 3,
  fontWeight = 700,
  fontFamily = THAI_FONT_FAMILY,
  maxWidth,
  style,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const resolvedFontSize = fontSize ?? (width > height ? 64 : 58);
  const resolvedMaxWidth = maxWidth ?? Math.round(width * 0.88);
  const tokens = tokenizeWithHighlights(text, highlight);

  const justifyContent =
    align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  let wordIdx = 0;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: resolvedMaxWidth,
        margin: align === 'center' ? '0 auto' : undefined,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent,
        alignItems: 'baseline',
        fontFamily,
        fontSize: resolvedFontSize,
        fontWeight,
        lineHeight: 1.44,
        paddingTop: 12,
        paddingBottom: 12,
        textAlign: align,
        overflow: 'visible',
        ...style,
      }}
    >
      {tokens.map((tok, i) => {
        if (tok.isWhitespace) {
          return (
            <span key={i} style={{ whiteSpace: 'pre' }}>
              {tok.text}
            </span>
          );
        }

        const delay = startFrame + wordIdx * staggerFrames;
        wordIdx += 1;

        const local = Math.max(0, frame - delay);
        const progress =
          frame < delay
            ? 0
            : spring({
                frame: local,
                fps,
                config: { damping: 14, stiffness: 175, mass: 0.72 },
              });

        const y = interpolate(progress, [0, 1], [34, 0]);
        const opacity = interpolate(progress, [0, 0.55], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const blurPx = interpolate(progress, [0, 1], [9, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const scale = interpolate(progress, [0, 1], [0.92, 1]);

        if (tok.isHighlighted) {
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                whiteSpace: 'pre',
                opacity,
                transform: `translate3d(0, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`,
                filter:
                  blurPx > 0.15
                    ? `blur(${blurPx.toFixed(2)}px) drop-shadow(0 0 18px ${withAlpha(accent, '99')})`
                    : `drop-shadow(0 0 18px ${withAlpha(accent, '99')}) drop-shadow(0 4px 14px rgba(0,0,0,0.45))`,
                backgroundImage: `linear-gradient(135deg, ${accentSecondary} 0%, ${accent} 58%, ${accentSecondary} 100%)`,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: accent,
                // Extra vertical breathing prevents Thai upper tone marks & lower vowels from clipping under background-clip:text
                paddingTop: 10,
                paddingBottom: 10,
                marginTop: -10,
                marginBottom: -10,
                lineHeight: 1.44,
              }}
            >
              {tok.text}
            </span>
          );
        }

        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              whiteSpace: 'pre',
              color,
              opacity,
              transform: `translate3d(0, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`,
              filter: blurPx > 0.15 ? `blur(${blurPx.toFixed(2)}px)` : 'none',
              textShadow: '0 6px 24px rgba(5, 8, 22, 0.55)',
              paddingTop: 8,
              paddingBottom: 8,
              marginTop: -8,
              marginBottom: -8,
              lineHeight: 1.44,
            }}
          >
            {tok.text}
          </span>
        );
      })}
    </div>
  );
};
