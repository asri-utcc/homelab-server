import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { THAI_FONT_FAMILY } from '../ThaiFontLoader';
import type { SubtitleCue } from '../SubtitleBar';

export type { SubtitleCue };

export interface WordBoundary {
  type?: string;
  /** Offset from speech start in seconds (emitted by scripts/tts_pipeline.py) */
  offsetSec?: number;
  /** Raw offset in either 100ns ticks (edge-tts native) or seconds */
  offset?: number;
  /** Duration in seconds (emitted by scripts/tts_pipeline.py) */
  durationSec?: number;
  /** Raw duration in either 100ns ticks (edge-tts native) or seconds */
  duration?: number;
  text: string;
}

export interface KaraokeSubtitleProps {
  /** Subtitle cues with startFrame/endFrame */
  cues: SubtitleCue[];
  /** Optional TTS word/sentence timing boundaries for word-by-word karaoke highlight */
  wordBoundaries?: WordBoundary[];
  /** Absolute scene speech start time in seconds (from timeline scene.speechStartSec) */
  sceneSpeechStartSec?: number;
  /** Highlight accent color (default '#FFD166') */
  accentColor?: string;
  /** Distance from bottom edge in px (default 280 for 9:16 Safe Zone; auto-scales in 16:9 if omitted) */
  bottomOffset?: number;
  /** Visual glass theme (default 'dark') */
  theme?: 'dark' | 'light';
  /** Base font size override in px */
  fontSize?: number;
  style?: React.CSSProperties;
}

interface NormalizedBoundary {
  startSec: number;
  endSec: number;
  text: string;
  isWord: boolean;
}

type SegmenterLike = {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
};

function toSeconds(secVal?: number, rawVal?: number): number {
  if (typeof secVal === 'number' && Number.isFinite(secVal)) {
    return secVal;
  }
  if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
    // edge-tts raw ticks are in 100-nanosecond units (10_000_000 ticks = 1 second).
    // Any value > 10_000 is reliably ticks rather than seconds.
    return rawVal > 10_000 ? rawVal / 10_000_000 : rawVal;
  }
  return 0;
}

function segmentWords(text: string): string[] {
  if (!text) return [];
  const IntlObj = Intl as unknown as {
    Segmenter?: new (
      locale: string,
      options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
    ) => SegmenterLike;
  };
  if (typeof IntlObj.Segmenter === 'function') {
    const seg = new IntlObj.Segmenter('th', { granularity: 'word' });
    const out: string[] = [];
    for (const part of seg.segment(text)) {
      if (part.segment) out.push(part.segment);
    }
    return out;
  }
  return text.split(/(\s+)/).filter(Boolean);
}

function withAlpha(color: string, alphaHex: string): string {
  const c = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return `${c}${alphaHex}`;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}${alphaHex}`;
  }
  return c;
}

function normalizeText(str: string): string {
  return str.replace(/[\s\u200B.,!?:"'“”‘’()[\]—–\-·•]/g, '').toLowerCase();
}

function normalizeBoundaries(
  boundaries: WordBoundary[],
  sceneSpeechStartSec: number,
): NormalizedBoundary[] {
  const mapped: NormalizedBoundary[] = boundaries
    .map((b) => {
      const relStart = toSeconds(b.offsetSec, b.offset);
      const dur = Math.max(0.06, toSeconds(b.durationSec, b.duration));
      return {
        startSec: sceneSpeechStartSec + relStart,
        endSec: sceneSpeechStartSec + relStart + dur,
        text: (b.text ?? '').trim(),
        isWord: b.type !== 'SentenceBoundary',
      };
    })
    .filter((b) => b.text.length > 0);

  const wordOnly = mapped.filter((b) => b.isWord);
  const chosen = wordOnly.length > 0 ? wordOnly : mapped;
  return chosen.sort((a, b) => a.startSec - b.startSec);
}

export const KaraokeSubtitle: React.FC<KaraokeSubtitleProps> = ({
  cues = [],
  wordBoundaries,
  sceneSpeechStartSec = 0,
  accentColor = '#FFD166',
  bottomOffset,
  theme = 'dark',
  fontSize,
  style,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const active = cues.find((c) => frame >= c.startFrame && frame <= c.endFrame);
  if (!active) return null;

  const isLandscape = width > height;
  const resolvedBottom = bottomOffset ?? (isLandscape ? 88 : 280);

  const localFrame = frame - active.startFrame;
  const pop = spring({
    frame: localFrame,
    fps,
    config: { damping: 16, stiffness: 220, mass: 0.7 },
  });
  const translateY = interpolate(pop, [0, 1], [16, 0]);
  const scale = interpolate(pop, [0, 1], [0.95, 1]);
  const boxOpacity = interpolate(localFrame, [0, 5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Auto-fit font size so Thai captions cleanly stay within 1-2 lines
  const charCount = active.text.length;
  const autoFontSize = isLandscape
    ? charCount > 70
      ? 34
      : charCount > 52
        ? 38
        : 42
    : charCount > 62
      ? 30
      : charCount > 44
        ? 34
        : 38;
  const resolvedFontSize = fontSize ?? autoFontSize;

  const isLight = theme === 'light';
  const glassBg = isLight ? 'rgba(20, 28, 44, 0.76)' : 'rgba(10, 15, 34, 0.62)';
  const glassBorder = isLight
    ? '1.5px solid rgba(255, 255, 255, 0.24)'
    : '1.5px solid rgba(255, 232, 185, 0.24)';
  const fgColor = '#FFFFFF';
  const dimColor = 'rgba(255, 255, 255, 0.74)';

  const hasWordBoundaries = Array.isArray(wordBoundaries) && wordBoundaries.length > 0;

  const renderFallbackHighlight = () => {
    const kw = active.highlight?.trim();
    if (!kw || !active.text.includes(kw)) {
      return <span>{active.text}</span>;
    }
    const parts = active.text.split(kw);
    return (
      <>
        {parts.map((part, idx) => (
          <React.Fragment key={idx}>
            {part}
            {idx < parts.length - 1 && (
              <span
                style={{
                  color: accentColor,
                  borderBottom: `3px solid ${accentColor}`,
                  paddingBottom: 2,
                  textShadow: `0 0 14px ${withAlpha(accentColor, '88')}`,
                }}
              >
                {kw}
              </span>
            )}
          </React.Fragment>
        ))}
      </>
    );
  };

  const renderKaraokeWords = () => {
    const boundaries = normalizeBoundaries(wordBoundaries ?? [], sceneSpeechStartSec);
    if (boundaries.length === 0) {
      return renderFallbackHighlight();
    }

    const currentSec = frame / Math.max(1, fps);
    const cueStartSec = active.startFrame / Math.max(1, fps);
    const cueEndSec = Math.max(cueStartSec + 0.05, active.endFrame / Math.max(1, fps));
    const cueProgress = Math.max(
      0,
      Math.min(1, (currentSec - cueStartSec) / (cueEndSec - cueStartSec)),
    );

    const tokens = segmentWords(active.text);
    const wordIndices: number[] = [];
    tokens.forEach((tok, idx) => {
      if (tok.trim().length > 0) wordIndices.push(idx);
    });
    if (wordIndices.length === 0) return <span>{active.text}</span>;

    // Pick currently active spoken boundary (prefer exact match, else latest started within cue window)
    let activeBoundary: NormalizedBoundary | undefined = boundaries.find(
      (b) => currentSec >= b.startSec - 0.03 && currentSec <= b.endSec + 0.04,
    );
    if (!activeBoundary) {
      for (let i = boundaries.length - 1; i >= 0; i -= 1) {
        const b = boundaries[i];
        if (b.startSec <= currentSec && b.endSec >= cueStartSec - 0.25) {
          activeBoundary = b;
          break;
        }
      }
    }

    // Determine active token index: match boundary text near expected proportional cue position
    let activeWordPos = -1;
    const expectedWordPos = Math.min(
      wordIndices.length - 1,
      Math.floor(cueProgress * wordIndices.length),
    );

    if (activeBoundary && activeBoundary.isWord) {
      const needle = normalizeText(activeBoundary.text);
      if (needle.length > 0) {
        let bestDist = Infinity;
        wordIndices.forEach((tokIdx, pos) => {
          const cand = normalizeText(tokens[tokIdx]);
          if (!cand) return;
          if (cand === needle || cand.includes(needle) || needle.includes(cand)) {
            const dist = Math.abs(pos - expectedWordPos);
            if (dist < bestDist) {
              bestDist = dist;
              activeWordPos = pos;
            }
          }
        });
      }
    }

    // Fallback to timing-weighted progression through cue tokens when narration phrasing/numbers differ
    // or when edge-tts returned SentenceBoundary spans
    if (activeWordPos < 0) {
      const weights = wordIndices.map((idx) => Math.max(1, tokens[idx].trim().length));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const targetWeight = cueProgress * totalWeight;
      let acc = 0;
      activeWordPos = wordIndices.length - 1;
      for (let pos = 0; pos < weights.length; pos += 1) {
        acc += weights[pos];
        if (acc >= targetWeight) {
          activeWordPos = pos;
          break;
        }
      }
    }

    const activeTokenIndex = wordIndices[activeWordPos];
    const kw = active.highlight?.trim() ?? '';
    const kwStart = kw ? active.text.indexOf(kw) : -1;
    const kwEnd = kwStart >= 0 ? kwStart + kw.length : -1;

    let charOffset = 0;

    return (
      <>
        {tokens.map((tok, idx) => {
          const tokStart = charOffset;
          const tokEnd = charOffset + tok.length;
          charOffset = tokEnd;

          if (!tok.trim()) {
            return (
              <span key={idx} style={{ whiteSpace: 'pre' }}>
                {tok}
              </span>
            );
          }
          const isCurrent = idx === activeTokenIndex;
          const isSpoken = idx < activeTokenIndex;
          const isKeyConcept = kwStart >= 0 && tokStart < kwEnd && tokEnd > kwStart;

          return (
            <span
              key={idx}
              style={{
                display: 'inline',
                color: isCurrent ? accentColor : isSpoken ? fgColor : dimColor,
                backgroundColor: isCurrent ? withAlpha(accentColor, '26') : 'transparent',
                borderRadius: isCurrent ? 8 : 0,
                padding: isCurrent ? '2px 5px' : '0',
                boxShadow: isCurrent ? `0 0 0 1px ${withAlpha(accentColor, '55')}` : 'none',
                textShadow: isCurrent
                  ? `0 0 16px ${withAlpha(accentColor, 'AA')}, 0 2px 8px rgba(0,0,0,0.6)`
                  : '0 2px 8px rgba(0,0,0,0.45)',
                borderBottom:
                  !isCurrent && isKeyConcept
                    ? `2px solid ${withAlpha(accentColor, '88')}`
                    : undefined,
              }}
            >
              {tok}
            </span>
          );
        })}
      </>
    );
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: isLandscape ? 120 : 48,
        right: isLandscape ? 120 : 48,
        bottom: resolvedBottom,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 60,
        ...style,
      }}
    >
      <div
        style={{
          opacity: boxOpacity,
          transform: `translate3d(0, ${translateY.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`,
          backgroundColor: glassBg,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          color: fgColor,
          fontFamily: THAI_FONT_FAMILY,
          fontWeight: 700,
          fontSize: resolvedFontSize,
          lineHeight: 1.48,
          letterSpacing: 0.2,
          textAlign: 'center',
          padding: '16px 30px 18px 30px',
          borderRadius: 24,
          border: glassBorder,
          boxShadow:
            '0 16px 40px rgba(4, 8, 24, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
          maxWidth: isLandscape ? Math.round(width * 0.78) : Math.round(width * 0.9),
          wordBreak: 'keep-all',
        }}
      >
        <div
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            paddingTop: 6,
            paddingBottom: 6,
          }}
        >
          {hasWordBoundaries ? renderKaraokeWords() : renderFallbackHighlight()}
        </div>
      </div>
    </div>
  );
};
