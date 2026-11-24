import React from 'react';
import { interpolate, spring, useVideoConfig } from 'remotion';
import { IsoBox, IsoLabelPill, IsoShadow } from '../components/IsometricPrimitives';
import { THAI_FONT_FAMILY } from '../components/ThaiFontLoader';
import { SceneVisual } from './sceneVisuals';
import { FlatCartoonLayout } from './flatCartoon';
import { IllustratedLayout } from './director/IllustratedLayout';
import { isIllustratedStyle } from './director/doodleKit';
import { StyleDirectedLayout } from './styleDirector/StyleDirectedLayout';
import { DynamicMotionStage } from './styleDirector/DynamicMotionStage';
import { hasStyleDirector } from './styleDirector/registry';
import { getHeroStyleAccent, hasHeroSignature } from './signatures';
import {
  ResolvedStyleTokens,
  StudioScene,
  hexToRgba,
  normalizeSceneVisual,
  shadeHex,
} from './types';

export interface FamilySceneRendererProps {
  scene: StudioScene;
  sceneIndex: number;
  totalScenes: number;
  tokens: ResolvedStyleTokens;
  localFrame: number;
  durationFrames: number;
  styleId?: string;
  hasHero?: boolean;
  /** all scenes of the video (lets illustrated styles plan shots without repeats) */
  allScenes?: StudioScene[];
}

function isPlaceholderIconOrTitle(scene: StudioScene): boolean {
  const vt = normalizeSceneVisual(scene);
  if (vt === 'title' || vt === 'icon') return true;
  if (vt === 'image' && (!scene.imageUrl || !scene.imageUrl.trim())) return true;
  return false;
}

/**
 * Clean typographic body for title/icon scenes when rendered inside a non-hero family layout.
 * Never renders the generic compass/spark icon.
 */
const CleanTypoSceneBody: React.FC<{
  scene: StudioScene;
  tokens: ResolvedStyleTokens;
  localFrame: number;
  compact?: boolean;
}> = ({ scene, tokens, localFrame, compact = false }) => {
  const { fps } = useVideoConfig();
  const { palette, isLight, motionIntensity, springConfig } = tokens;
  const enter = spring({ frame: Math.max(0, localFrame - 4), fps, config: springConfig });
  const chips = (scene.bullets || []).slice(0, 3);
  const accent = palette.accentReadable;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: compact ? 16 : 24,
        padding: compact ? '14px 20px' : '24px 32px',
        opacity: interpolate(enter, [0, 0.65], [0, 1], { extrapolateRight: 'clamp' }),
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [18 * motionIntensity, 0]).toFixed(1)}px, 0)`,
      }}
    >
      <div
        style={{
          width: Math.round(interpolate(enter, [0, 1], [24, 150])),
          height: 5,
          borderRadius: 99,
          background: `linear-gradient(90deg, ${accent} 0%, ${palette.accent2} 100%)`,
        }}
      />
      {(scene.subtitle || scene.bullets?.[0]) && (
        <div
          style={{
            maxWidth: 780,
            textAlign: 'center',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: compact ? 30 : 38,
            fontWeight: 700,
            lineHeight: 1.48,
            color: palette.fg,
            paddingTop: 6,
            paddingBottom: 6,
          }}
        >
          {scene.subtitle || scene.bullets?.[0]}
        </div>
      )}
      {chips.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 12,
            maxWidth: 820,
          }}
        >
          {chips.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '10px 20px',
                borderRadius: 999,
                backgroundColor: hexToRgba(palette.surface, isLight ? 0.96 : 0.78),
                border: `2px solid ${hexToRgba(idx % 2 === 0 ? accent : palette.accent2, 0.55)}`,
                color: palette.fg,
                fontFamily: THAI_FONT_FAMILY,
                fontSize: compact ? 21 : 24,
                fontWeight: 700,
                lineHeight: 1.4,
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  backgroundColor: idx % 2 === 0 ? accent : palette.accent2,
                  flexShrink: 0,
                }}
              />
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// SHARED THAI HIGHLIGHTED HEADLINE HELPER (Safe for Upper/Lower Thai Vowels)
// ============================================================================

type ThaiSegmenterLike = {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
};

const THAI_SEGMENTER: ThaiSegmenterLike | null = (() => {
  const IntlObj = Intl as unknown as {
    Segmenter?: new (
      locale: string,
      options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
    ) => ThaiSegmenterLike;
  };
  return typeof IntlObj.Segmenter === 'function'
    ? new IntlObj.Segmenter('th', { granularity: 'word' })
    : null;
})();

const THAI_KEEP_WHOLE_WORDS = new Set([
  'สตูดิโอ',
  'สตอรี่',
  'สตอรี่บอร์ด',
  'วิดีโอ',
  'โปรเจกต์',
  'โมชัน',
  'แอนิเมชัน',
  'เรนเดอร์',
  'คอนเทนต์',
  'กราฟิก',
  'ดีไซน์',
  'สไตล์',
  'ไอเดีย',
  'เอไอ',
  'ริโซ',
  'สวิส',
  'ระดับ',
  'ระบบ',
  'สเต็ป',
  'วิกฤต',
  'อวาตาร์',
  'โพเดียม',
  'ไฮไลต์',
  'คิวอาร์',
  'ไทม์ไลน์',
  'แพลตฟอร์ม',
  'เทคโนโลยี',
  'คอมพิวเตอร์',
  'อินเตอร์เน็ต',
  'ดิจิทัล',
  'ซอฟต์แวร์',
  'ฮาร์ดแวร์',
  'นิตยสาร',
  'คอมเมนต์',
  'แคปชัน',
  'แบนเนอร์',
  'สไลเดอร์',
  'สกอร์บอร์ด',
  'โฮโลแกรม',
  'ม็อกอัป',
  'คัทเอาต์',
]);

export function splitThaiWords(text: string): string[] {
  if (!text) return [];
  if (!THAI_SEGMENTER) {
    return text.split(/(\s+)/).filter(Boolean);
  }

  const raw: string[] = [];
  for (const part of THAI_SEGMENTER.segment(text)) {
    if (part.segment) raw.push(part.segment);
  }

  // Merge common Thai loanwords & compound terms that Intl.Segmenter splits mid-word
  const dictMerged: string[] = [];
  for (let i = 0; i < raw.length; ) {
    let matched = 0;
    for (let k = Math.min(4, raw.length - i); k >= 2; k--) {
      const joined = raw.slice(i, i + k).join('');
      if (THAI_KEEP_WHOLE_WORDS.has(joined)) {
        dictMerged.push(joined);
        i += k;
        matched = k;
        break;
      }
    }
    if (!matched) {
      dictMerged.push(raw[i]);
      i += 1;
    }
  }

  // Structural Thai syllable safety: never isolate a single leading consonant or trailing mark/karan cluster
  const out: string[] = [];
  for (let i = 0; i < dictMerged.length; i++) {
    const tok = dictMerged[i];
    if (/^[ก-ฮ]$/.test(tok) && i + 1 < dictMerged.length && /^[\u0E01-\u0E5B]/.test(dictMerged[i + 1])) {
      dictMerged[i + 1] = tok + dictMerged[i + 1];
      continue;
    }
    if (
      out.length > 0 &&
      /[\u0E01-\u0E5B]$/.test(out[out.length - 1]) &&
      (/^[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(tok) || /^[ก-ฮ]{1,3}\u0E4C$/.test(tok))
    ) {
      out[out.length - 1] += tok;
      continue;
    }
    out.push(tok);
  }
  return out;
}

export function renderHighlightedText(
  text: string,
  highlight: string | string[] | undefined,
  accentColor: string,
  highlightStyle?: React.CSSProperties,
): React.ReactNode {
  const list = (Array.isArray(highlight) ? highlight : highlight ? [highlight] : [])
    .map((h) => h.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (list.length === 0) return text;

  let parts: Array<{ text: string; hl: boolean }> = [{ text, hl: false }];
  for (const kw of list) {
    const next: Array<{ text: string; hl: boolean }> = [];
    for (const seg of parts) {
      if (seg.hl || !seg.text.includes(kw)) {
        next.push(seg);
        continue;
      }
      const split = seg.text.split(kw);
      split.forEach((p, idx) => {
        if (p) next.push({ text: p, hl: false });
        if (idx < split.length - 1) next.push({ text: kw, hl: true });
      });
    }
    parts = next;
  }

  return parts.map((seg, i) =>
    seg.hl ? (
      <span key={i} style={{ color: accentColor, ...highlightStyle }}>
        {seg.text}
      </span>
    ) : (
      <React.Fragment key={i}>{seg.text}</React.Fragment>
    ),
  );
}

export function computeTitleSize(title: string, base: number): number {
  const len = title.length;
  if (len > 48) return Math.max(40, base - 12);
  if (len > 34) return Math.max(44, base - 6);
  return base;
}

// ============================================================================
// FAMILY 1: GLOW-WORLD (Luminous Layered Glass + Aura + Orbit Flourishes)
// ============================================================================

const GlowWorldLayout: React.FC<FamilySceneRendererProps> = ({
  scene,
  tokens,
  localFrame,
  durationFrames,
}) => {
  const { fps } = useVideoConfig();
  const { palette, isLight, motionIntensity, springConfig, glowIntensity } = tokens;

  const headSp = spring({ frame: localFrame, fps, config: springConfig });
  const stageSp = spring({ frame: Math.max(0, localFrame - 5), fps, config: springConfig });
  const titleSize = computeTitleSize(scene.title, 54);

  return (
    <div
      style={{
        position: 'absolute',
        top: 185,
        bottom: 560,
        left: 64,
        right: 64,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
      }}
    >
      {/* Glowing Pill Badge */}
      {scene.badge && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 26px',
            borderRadius: 999,
            backgroundColor: hexToRgba(palette.surface, isLight ? 0.92 : 0.72),
            border: `2px solid ${hexToRgba(palette.accent, 0.72)}`,
            boxShadow: `0 0 ${Math.round(18 + glowIntensity * 20)}px ${hexToRgba(palette.accent, isLight ? 0.16 : 0.34)}`,
            opacity: interpolate(headSp, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }),
            transform: `scale(${interpolate(headSp, [0, 1], [0.88, 1]).toFixed(4)})`,
          }}
        >
          <span
            style={{
              width: 11,
              height: 11,
              borderRadius: '50%',
              backgroundColor: palette.accent,
              boxShadow: `0 0 12px ${palette.accent}`,
            }}
          />
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 25,
              fontWeight: 700,
              lineHeight: 1.4,
              color: palette.accent,
              letterSpacing: 0.4,
            }}
          >
            {scene.badge}
          </span>
        </div>
      )}

      {/* Luminous Title */}
      <div
        style={{
          width: '100%',
          maxWidth: 920,
          textAlign: 'center',
          fontFamily: THAI_FONT_FAMILY,
          fontSize: titleSize,
          fontWeight: 800,
          lineHeight: 1.42,
          color: palette.fg,
          paddingTop: 8,
          paddingBottom: 8,
          textShadow: isLight
            ? 'none'
            : `0 6px 24px ${hexToRgba('#000000', 0.55)}`,
          opacity: interpolate(headSp, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(0, ${interpolate(headSp, [0, 1], [20 * motionIntensity, 0]).toFixed(1)}px, 0)`,
        }}
      >
        {renderHighlightedText(scene.title, scene.highlight, palette.accent, {
          textShadow: isLight
            ? 'none'
            : `0 0 22px ${hexToRgba(palette.accent, 0.65)}`,
        })}
      </div>

      {/* Luminous Floating Glass Stage */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          width: '100%',
          borderRadius: 34,
          backgroundColor: hexToRgba(palette.surface, isLight ? 0.86 : 0.58),
          border: `2px solid ${hexToRgba(palette.accent, isLight ? 0.35 : 0.44)}`,
          boxShadow: [
            `0 24px 60px ${hexToRgba('#040618', isLight ? 0.1 : 0.48)}`,
            `0 0 ${Math.round(28 + glowIntensity * 34)}px ${hexToRgba(palette.accent, isLight ? 0.1 : 0.2)}`,
            `inset 0 1px 0 ${hexToRgba('#FFFFFF', isLight ? 0.7 : 0.2)}`,
          ].join(', '),
          padding: 22,
          overflow: 'hidden',
          opacity: interpolate(stageSp, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(0, ${interpolate(stageSp, [0, 1], [28 * motionIntensity, 0]).toFixed(1)}px, 0) scale(${interpolate(stageSp, [0, 1], [0.95, 1]).toFixed(4)})`,
        }}
      >
        {/* Inner ambient top glow */}
        <div
          style={{
            position: 'absolute',
            left: '15%',
            right: '15%',
            top: -80,
            height: 180,
            borderRadius: '50%',
            background: `radial-gradient(ellipse, ${hexToRgba(palette.accent, isLight ? 0.14 : 0.26)} 0%, transparent 72%)`,
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', zIndex: 2, width: '100%', height: '100%' }}>
          {isPlaceholderIconOrTitle(scene) ? (
            <CleanTypoSceneBody scene={scene} tokens={tokens} localFrame={localFrame} />
          ) : (
            <SceneVisual
              scene={scene}
              tokens={tokens}
              localFrame={localFrame}
              durationFrames={durationFrames}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// FAMILY 2: EDITORIAL-PAPER (Print Masthead + Hairline Rules + Offset Shadow)
// ============================================================================

const EditorialPaperLayout: React.FC<FamilySceneRendererProps> = ({
  scene,
  sceneIndex,
  totalScenes,
  tokens,
  localFrame,
  durationFrames,
}) => {
  const { fps } = useVideoConfig();
  const { palette, isLight, motionIntensity, springConfig } = tokens;

  const headSp = spring({ frame: localFrame, fps, config: springConfig });
  const cardSp = spring({ frame: Math.max(0, localFrame - 6), fps, config: springConfig });
  const titleSize = computeTitleSize(scene.title, 54);
  const shadowColor = isLight ? hexToRgba(palette.fg, 0.16) : hexToRgba('#000000', 0.46);

  return (
    <div
      style={{
        position: 'absolute',
        top: 185,
        bottom: 560,
        left: 68,
        right: 68,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* Editorial Top Masthead Rule */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: `3px solid ${palette.fg}`,
          borderBottom: `1.5px solid ${palette.border}`,
          padding: '10px 4px',
          opacity: interpolate(headSp, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 10,
              height: 10,
              backgroundColor: palette.accent,
              display: 'inline-block',
            }}
          />
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 23,
              fontWeight: 700,
              lineHeight: 1.4,
              color: palette.accent,
              letterSpacing: 0.6,
            }}
          >
            {scene.badge || `บทที่ ${String(sceneIndex + 1).padStart(2, '0')}`}
          </span>
        </div>
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 21,
            fontWeight: 700,
            color: palette.muted,
            letterSpacing: 2,
          }}
        >
          {String(sceneIndex + 1).padStart(2, '0')} / {String(totalScenes).padStart(2, '0')}
        </span>
      </div>

      {/* Crisp Editorial Headline */}
      <div
        style={{
          fontFamily: THAI_FONT_FAMILY,
          fontSize: titleSize,
          fontWeight: 700,
          lineHeight: 1.44,
          color: palette.fg,
          textAlign: 'left',
          paddingTop: 8,
          paddingBottom: 8,
          opacity: interpolate(headSp, [0, 0.65], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(0, ${interpolate(headSp, [0, 1], [16 * motionIntensity, 0]).toFixed(1)}px, 0)`,
        }}
      >
        {renderHighlightedText(scene.title, scene.highlight, palette.accent, {
          borderBottom: `5px solid ${hexToRgba(palette.accent, 0.45)}`,
          paddingBottom: 2,
        })}
      </div>

      {/* Print-Sheet Card with Hard Offset Shadow & Corner Crop Marks */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          width: '100%',
          borderRadius: 12,
          backgroundColor: palette.surface,
          border: `2.5px solid ${palette.fg}`,
          boxShadow: `10px 10px 0px ${shadowColor}`,
          padding: 22,
          opacity: interpolate(cardSp, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(0, ${interpolate(cardSp, [0, 1], [22 * motionIntensity, 0]).toFixed(1)}px, 0)`,
        }}
      >
        {/* Subtle Corner Registration Marks */}
        <svg
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <line x1={12} y1={12} x2={28} y2={12} stroke={palette.accent} strokeWidth={2.5} />
          <line x1={12} y1={12} x2={12} y2={28} stroke={palette.accent} strokeWidth={2.5} />
        </svg>
        <div style={{ position: 'relative', zIndex: 2, width: '100%', height: '100%' }}>
          {isPlaceholderIconOrTitle(scene) ? (
            <CleanTypoSceneBody scene={scene} tokens={tokens} localFrame={localFrame} />
          ) : (
            <SceneVisual
              scene={scene}
              tokens={tokens}
              localFrame={localFrame}
              durationFrames={durationFrames}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// FAMILY 3: DATA-BOARD (Swiss Telemetry Cockpit + Structured Bento Frame)
// ============================================================================

const DataBoardLayout: React.FC<FamilySceneRendererProps> = ({
  scene,
  sceneIndex,
  totalScenes,
  tokens,
  localFrame,
  durationFrames,
}) => {
  const { fps } = useVideoConfig();
  const { palette, isLight, motionIntensity, springConfig } = tokens;

  const headSp = spring({ frame: localFrame, fps, config: springConfig });
  const boardSp = spring({ frame: Math.max(0, localFrame - 5), fps, config: springConfig });
  const titleSize = computeTitleSize(scene.title, 50);

  return (
    <div
      style={{
        position: 'absolute',
        top: 185,
        bottom: 560,
        left: 60,
        right: 60,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {/* Telemetry Status Strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 18px',
          borderRadius: 14,
          backgroundColor: hexToRgba(palette.surface, isLight ? 0.92 : 0.8),
          border: `1.5px solid ${palette.border}`,
          opacity: interpolate(headSp, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              backgroundColor: palette.accent,
            }}
          />
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 22,
              fontWeight: 700,
              lineHeight: 1.4,
              color: palette.accent,
            }}
          >
            {scene.badge || 'DATA INSIGHT'}
          </span>
        </div>

        {/* Segmented Progress Indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {Array.from({ length: Math.min(8, Math.max(1, totalScenes)) }, (_, i) => (
            <div
              key={i}
              style={{
                width: i === sceneIndex ? 26 : 10,
                height: 8,
                borderRadius: 99,
                backgroundColor:
                  i === sceneIndex
                    ? palette.accent
                    : i < sceneIndex
                      ? palette.accent2
                      : hexToRgba(palette.border, 0.7),
              }}
            />
          ))}
        </div>
      </div>

      {/* Left-Aligned Analytical Headline with Vertical Accent Rail */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 18,
          opacity: interpolate(headSp, [0, 0.65], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(${interpolate(headSp, [0, 1], [-18 * motionIntensity, 0]).toFixed(1)}px, 0, 0)`,
        }}
      >
        <div
          style={{
            width: 8,
            borderRadius: 99,
            background: `linear-gradient(180deg, ${palette.accent} 0%, ${palette.accent2} 100%)`,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            fontFamily: THAI_FONT_FAMILY,
            fontSize: titleSize,
            fontWeight: 800,
            lineHeight: 1.42,
            color: palette.fg,
            paddingTop: 6,
            paddingBottom: 6,
          }}
        >
          {renderHighlightedText(scene.title, scene.highlight, palette.accent)}
        </div>
      </div>

      {/* Structured Dashboard Panel */}
      <div
        style={{
          flex: 1,
          width: '100%',
          borderRadius: 22,
          backgroundColor: hexToRgba(palette.surface, isLight ? 0.96 : 0.76),
          border: `2px solid ${palette.border}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: isLight
            ? '0 16px 40px rgba(15, 23, 42, 0.08)'
            : '0 20px 50px rgba(2, 6, 23, 0.45)',
          opacity: interpolate(boardSp, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(0, ${interpolate(boardSp, [0, 1], [24 * motionIntensity, 0]).toFixed(1)}px, 0)`,
        }}
      >
        {/* Panel Top Chrome Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 22px',
            borderBottom: `1.5px solid ${palette.border}`,
            backgroundColor: hexToRgba(palette.bg2, isLight ? 0.65 : 0.55),
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: palette.accent }} />
            <span style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: palette.accent2 }} />
            <span style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: palette.border }} />
          </div>
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: 18,
              fontWeight: 700,
              color: palette.muted,
              letterSpacing: 1.5,
            }}
          >
            PANEL · {String(sceneIndex + 1).padStart(2, '0')}
          </span>
        </div>

        {/* Panel Body */}
        <div style={{ flex: 1, padding: 18 }}>
          {isPlaceholderIconOrTitle(scene) ? (
            <CleanTypoSceneBody scene={scene} tokens={tokens} localFrame={localFrame} />
          ) : (
            <SceneVisual
              scene={scene}
              tokens={tokens}
              localFrame={localFrame}
              durationFrames={durationFrames}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// FAMILY 4: KINETIC-TYPE (Poster Watermark + Word-by-Word Kinetic Pop)
// ============================================================================

const KineticTypeLayout: React.FC<FamilySceneRendererProps> = ({
  scene,
  sceneIndex,
  tokens,
  localFrame,
  durationFrames,
}) => {
  const { fps } = useVideoConfig();
  const { palette, motionIntensity, springConfig } = tokens;

  const badgeSp = spring({ frame: localFrame, fps, config: springConfig });
  const stageSp = spring({ frame: Math.max(0, localFrame - 8), fps, config: springConfig });
  const titleSize = computeTitleSize(scene.title, 62);

  // Tokenize title with Thai word segmenter for crisp word-by-word kinetic entrance
  const hlList = (
    Array.isArray(scene.highlight) ? scene.highlight : scene.highlight ? [scene.highlight] : []
  )
    .map((h) => h.trim())
    .filter(Boolean);

  let spans: Array<{ text: string; hl: boolean }> = [{ text: scene.title, hl: false }];
  for (const kw of hlList) {
    const next: Array<{ text: string; hl: boolean }> = [];
    for (const sp of spans) {
      if (sp.hl || !sp.text.includes(kw)) {
        next.push(sp);
        continue;
      }
      const parts = sp.text.split(kw);
      parts.forEach((p, idx) => {
        if (p) next.push({ text: p, hl: false });
        if (idx < parts.length - 1) next.push({ text: kw, hl: true });
      });
    }
    spans = next;
  }

  const wordTokens: Array<{ text: string; hl: boolean; ws: boolean }> = [];
  for (const sp of spans) {
    for (const piece of splitThaiWords(sp.text)) {
      wordTokens.push({ text: piece, hl: sp.hl, ws: /^\s+$/.test(piece) });
    }
  }

  let wordIdx = 0;

  return (
    <div
      style={{
        position: 'absolute',
        top: 185,
        bottom: 560,
        left: 62,
        right: 62,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* Oversized Poster Watermark Number */}
      <div
        style={{
          position: 'absolute',
          right: -6,
          top: -28,
          fontFamily: THAI_FONT_FAMILY,
          fontSize: 220,
          fontWeight: 900,
          lineHeight: 1,
          color: hexToRgba(palette.accent, 0.11),
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {String(sceneIndex + 1).padStart(2, '0')}
      </div>

      {/* High-Contrast Solid Block Badge */}
      {scene.badge && (
        <div
          style={{
            alignSelf: 'flex-start',
            padding: '10px 24px',
            borderRadius: 8,
            backgroundColor: palette.accent,
            color: palette.accentOnFill,
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 25,
            fontWeight: 800,
            lineHeight: 1.38,
            letterSpacing: 0.5,
            transform: `scale(${interpolate(badgeSp, [0, 1], [0.85, 1]).toFixed(4)})`,
            opacity: interpolate(badgeSp, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }),
          }}
        >
          {scene.badge}
        </div>
      )}

      {/* Kinetic Word-by-Word Title */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          fontFamily: THAI_FONT_FAMILY,
          fontSize: titleSize,
          fontWeight: 800,
          lineHeight: 1.44,
          paddingTop: 10,
          paddingBottom: 10,
          overflow: 'visible',
        }}
      >
        {wordTokens.map((tok, i) => {
          if (tok.ws) {
            return (
              <span key={i} style={{ whiteSpace: 'pre' }}>
                {tok.text}
              </span>
            );
          }
          const delay = wordIdx * 2;
          wordIdx += 1;
          const sp = spring({
            frame: Math.max(0, localFrame - delay),
            fps,
            config: {
              damping: Math.max(10, springConfig.damping - 2),
              stiffness: Math.min(280, springConfig.stiffness + 35),
              mass: 0.68,
            },
          });
          const ty = interpolate(sp, [0, 1], [28 * motionIntensity, 0]);
          const op = interpolate(sp, [0, 0.45], [0, 1], { extrapolateRight: 'clamp' });

          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                whiteSpace: 'pre',
                color: tok.hl ? palette.accent : palette.fg,
                opacity: op,
                transform: `translate3d(0, ${ty.toFixed(1)}px, 0)`,
                paddingTop: 8,
                paddingBottom: 8,
                marginTop: -8,
                marginBottom: -8,
                lineHeight: 1.44,
                borderBottom: tok.hl ? `6px solid ${palette.accent2}` : undefined,
              }}
            >
              {tok.text}
            </span>
          );
        })}
      </div>

      {/* Bold Poster Accent Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            height: 7,
            width: Math.round(interpolate(badgeSp, [0, 1], [30, 190])),
            backgroundColor: palette.accent,
            borderRadius: 4,
          }}
        />
        <div
          style={{
            height: 7,
            width: 44,
            backgroundColor: palette.accent2,
            borderRadius: 4,
          }}
        />
      </div>

      {/* Graphic Poster Visual Area (Thick Left Accent Rail) */}
      <div
        style={{
          flex: 1,
          width: '100%',
          borderLeft: `6px solid ${hexToRgba(palette.accent, 0.8)}`,
          paddingLeft: 20,
          opacity: interpolate(stageSp, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(0, ${interpolate(stageSp, [0, 1], [24 * motionIntensity, 0]).toFixed(1)}px, 0)`,
        }}
      >
        {isPlaceholderIconOrTitle(scene) ? (
          <CleanTypoSceneBody scene={scene} tokens={tokens} localFrame={localFrame} />
        ) : (
          <SceneVisual
            scene={scene}
            tokens={tokens}
            localFrame={localFrame}
            durationFrames={durationFrames}
          />
        )}
      </div>
    </div>
  );
};

// ============================================================================
// FAMILY 5: ISO-3D (True 30° Orthographic IsometricPrimitives + Matte Stage)
// ============================================================================

const Iso3DLayout: React.FC<FamilySceneRendererProps> = ({
  scene,
  sceneIndex,
  tokens,
  localFrame,
  durationFrames,
}) => {
  const { fps } = useVideoConfig();
  const { palette, isLight, motionIntensity, springConfig } = tokens;

  const headSp = spring({ frame: localFrame, fps, config: springConfig });
  const isoSp = spring({ frame: Math.max(0, localFrame - 3), fps, config: springConfig });
  const cardSp = spring({ frame: Math.max(0, localFrame - 7), fps, config: springConfig });
  const titleSize = computeTitleSize(scene.title, 50);

  const tSec = localFrame / Math.max(1, fps);
  const float1 = Math.sin(tSec * 2.6 * motionIntensity) * (7 * motionIntensity);
  const float2 = Math.cos(tSec * 2.1 * motionIntensity + 1.1) * (6 * motionIntensity);

  // Matte 3-tone directional lighting faces for IsoBox
  const baseTop = isLight ? shadeHex(palette.surface, 0.98) : shadeHex(palette.surface, 1.25);
  const baseLeft = isLight ? shadeHex(palette.bg2, 0.92) : shadeHex(palette.surface, 0.92);
  const baseRight = isLight ? shadeHex(palette.bg2, 0.82) : shadeHex(palette.bg, 0.85);

  const accTop = shadeHex(palette.accent, 1.12);
  const accLeft = palette.accent;
  const accRight = shadeHex(palette.accent, 0.72);

  const acc2Top = shadeHex(palette.accent2, 1.12);
  const acc2Left = palette.accent2;
  const acc2Right = shadeHex(palette.accent2, 0.72);

  const pillBadge = String(sceneIndex + 1).padStart(2, '0');
  const pillLabel = (scene.badge || 'ISOMETRIC FLOW').slice(0, 22);

  return (
    <div
      style={{
        position: 'absolute',
        top: 185,
        bottom: 560,
        left: 60,
        right: 60,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
      }}
    >
      {/* Crisp Centered Title */}
      <div
        style={{
          width: '100%',
          textAlign: 'center',
          fontFamily: THAI_FONT_FAMILY,
          fontSize: titleSize,
          fontWeight: 800,
          lineHeight: 1.42,
          color: palette.fg,
          paddingTop: 6,
          paddingBottom: 6,
          opacity: interpolate(headSp, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(0, ${interpolate(headSp, [0, 1], [18 * motionIntensity, 0]).toFixed(1)}px, 0)`,
        }}
      >
        {renderHighlightedText(scene.title, scene.highlight, palette.accent)}
      </div>

      {/* True Orthographic 30° Isometric Diorama (using IsometricPrimitives.tsx) */}
      <div
        style={{
          width: 960,
          height: 290,
          flexShrink: 0,
          opacity: interpolate(isoSp, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `scale(${interpolate(isoSp, [0, 1], [0.9, 1]).toFixed(4)})`,
        }}
      >
        <svg width={960} height={290} viewBox="0 0 960 290" style={{ overflow: 'visible' }}>
          {/* Base Orthographic Platform Shadow + Slab */}
          <IsoShadow x={-120} y={-90} z={0} dx={240} dy={180} cx={480} cy={175} offset={14} opacity={isLight ? 0.14 : 0.35} />
          <IsoBox
            x={-120}
            y={-90}
            z={0}
            dx={240}
            dy={180}
            dz={24}
            topColor={baseTop}
            leftColor={baseLeft}
            rightColor={baseRight}
            cx={480}
            cy={175}
            stroke={hexToRgba(palette.border, 0.6)}
            strokeWidth={1.2}
          />

          {/* Secondary Raised Module Left */}
          <IsoShadow x={-96} y={-60} z={24} dx={76} dy={76} cx={480} cy={175} offset={8} opacity={0.16} />
          <IsoBox
            x={-96}
            y={-60}
            z={26 + float2}
            dx={76}
            dy={76}
            dz={48}
            topColor={acc2Top}
            leftColor={acc2Left}
            rightColor={acc2Right}
            cx={480}
            cy={175}
          />

          {/* Hero Central Floating Accent Prism */}
          <IsoShadow x={-16} y={-50} z={24} dx={82} dy={82} cx={480} cy={175} offset={10} opacity={0.18} />
          <IsoBox
            x={-16}
            y={-50}
            z={34 + float1}
            dx={82}
            dy={82}
            dz={72}
            topColor={accTop}
            leftColor={accLeft}
            rightColor={accRight}
            cx={480}
            cy={175}
          />

          {/* Small Kinetic Accent Satellite Block */}
          <IsoBox
            x={46}
            y={28}
            z={28 - float2 * 0.8}
            dx={44}
            dy={44}
            dz={32}
            topColor={baseTop}
            leftColor={acc2Left}
            rightColor={acc2Right}
            cx={480}
            cy={175}
          />

          {/* Clean Look-21 Capsule Label from IsometricPrimitives */}
          <IsoLabelPill
            sx={740}
            sy={78}
            badge={pillBadge}
            title={pillLabel}
            badgeColor={palette.accent}
            scale={interpolate(isoSp, [0, 1], [0.7, 0.94])}
            fontFamily={THAI_FONT_FAMILY}
          />
        </svg>
      </div>

      {/* Matte Layered Isometric Content Card */}
      <div
        style={{
          flex: 1,
          width: '100%',
          borderRadius: 28,
          backgroundColor: hexToRgba(palette.surface, isLight ? 0.95 : 0.78),
          border: `2px solid ${palette.border}`,
          boxShadow: isLight
            ? '0 14px 36px rgba(30, 41, 59, 0.1)'
            : '0 18px 46px rgba(2, 6, 23, 0.45)',
          padding: '14px 18px',
          opacity: interpolate(cardSp, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(0, ${interpolate(cardSp, [0, 1], [22 * motionIntensity, 0]).toFixed(1)}px, 0)`,
        }}
      >
        {isPlaceholderIconOrTitle(scene) ? (
          <CleanTypoSceneBody scene={scene} tokens={tokens} localFrame={localFrame} compact />
        ) : (
          <SceneVisual
            scene={scene}
            tokens={tokens}
            localFrame={localFrame}
            durationFrames={durationFrames}
            compact
          />
        )}
      </div>
    </div>
  );
};

// ============================================================================
// FAMILY 6: DOCUMENTARY-CARD (StorytellingTemplate Inspired Tilted Evidence Card)
// ============================================================================

const DocumentaryCardLayout: React.FC<FamilySceneRendererProps> = ({
  scene,
  sceneIndex,
  tokens,
  localFrame,
  durationFrames,
}) => {
  const { fps } = useVideoConfig();
  const { palette, isLight, motionIntensity, springConfig } = tokens;

  const headSp = spring({ frame: localFrame, fps, config: springConfig });
  const cardSp = spring({
    frame: Math.max(0, localFrame - 4),
    fps,
    config: { damping: 14, stiffness: 155, mass: 0.8 },
  });
  const tilt = (sceneIndex % 2 === 0 ? -1.8 : 1.8) * Math.min(1.2, motionIntensity);
  const titleSize = computeTitleSize(scene.title, 54);

  // Documentary evidence card always has crisp archival mount border
  const mountBorderColor = isLight ? '#FFFFFF' : '#F8FAFC';

  return (
    <div
      style={{
        position: 'absolute',
        top: 185,
        bottom: 560,
        left: 62,
        right: 62,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 22,
      }}
    >
      {/* Documentary Chapter Tag */}
      {scene.badge && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 14,
            opacity: interpolate(headSp, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' }),
          }}
        >
          <span style={{ width: 34, height: 3, backgroundColor: palette.accent, borderRadius: 2 }} />
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 24,
              fontWeight: 700,
              lineHeight: 1.4,
              letterSpacing: 1.2,
              color: palette.accent,
            }}
          >
            {scene.badge}
          </span>
          <span style={{ width: 34, height: 3, backgroundColor: palette.accent, borderRadius: 2 }} />
        </div>
      )}

      {/* Editorial Documentary Headline (Keyword Highlighted like StorytellingTemplate) */}
      <div
        style={{
          width: '100%',
          maxWidth: 920,
          textAlign: 'center',
          fontFamily: THAI_FONT_FAMILY,
          fontSize: titleSize,
          fontWeight: 700,
          lineHeight: 1.42,
          color: palette.fg,
          paddingTop: 8,
          paddingBottom: 8,
          textShadow: isLight ? 'none' : '0 6px 22px rgba(0, 0, 0, 0.62)',
          opacity: interpolate(headSp, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(0, ${interpolate(headSp, [0, 1], [16 * motionIntensity, 0]).toFixed(1)}px, 0)`,
        }}
      >
        {renderHighlightedText(scene.title, scene.highlight, palette.accent)}
      </div>

      {/* Tilted Photo-Mount Documentary Evidence Card */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          width: '96%',
          backgroundColor: mountBorderColor,
          padding: 16,
          borderRadius: 24,
          boxShadow: '0 28px 64px rgba(0, 0, 0, 0.48)',
          transform: `scale(${interpolate(cardSp, [0, 1], [0.84, 1]).toFixed(4)}) rotate(${tilt.toFixed(2)}deg)`,
          opacity: interpolate(cardSp, [0, 0.45], [0, 1], { extrapolateRight: 'clamp' }),
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Top Archival Pin Dot */}
        <div
          style={{
            position: 'absolute',
            top: -12,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 24,
            height: 24,
            borderRadius: '50%',
            backgroundColor: palette.accent,
            border: `4px solid ${mountBorderColor}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.38)',
            zIndex: 4,
          }}
        />

        {/* Inner Evidence Canvas */}
        <div
          style={{
            flex: 1,
            width: '100%',
            borderRadius: 14,
            backgroundColor: palette.bg,
            border: `1.5px solid ${palette.border}`,
            padding: 18,
            overflow: 'hidden',
          }}
        >
          {isPlaceholderIconOrTitle(scene) ? (
            <CleanTypoSceneBody scene={scene} tokens={tokens} localFrame={localFrame} />
          ) : (
            <SceneVisual
              scene={scene}
              tokens={tokens}
              localFrame={localFrame}
              durationFrames={durationFrames}
            />
          )}
        </div>

        {/* Bottom Archival Caption Strip on White Mount */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 8px 2px 8px',
          }}
        >
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: 18,
              fontWeight: 700,
              color: '#475569',
              letterSpacing: 1.5,
            }}
          >
            ARCHIVE #{String(sceneIndex + 1).padStart(2, '0')}
          </span>
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 20,
              fontWeight: 700,
              color: '#1E293B',
              lineHeight: 1.4,
            }}
          >
            {scene.source || scene.badge || 'หลักฐานประกอบเรื่องเล่า'}
          </span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// HERO-SIGNATURE SCENE LAYOUT (Fits cleanly around the y=260..1216 Hero Stage)
// ============================================================================

const HeroStyleSceneLayout: React.FC<FamilySceneRendererProps> = ({
  scene,
  sceneIndex,
  totalScenes,
  tokens,
  localFrame,
  durationFrames,
  styleId,
}) => {
  const { fps } = useVideoConfig();
  const { palette, isLight, motionIntensity, springConfig, family } = tokens;
  const heroAcc = getHeroStyleAccent(styleId || '', tokens);
  const accent = heroAcc.accent;
  const accent2 = heroAcc.accent2;

  const headSp = spring({ frame: localFrame, fps, config: springConfig });
  const capSp = spring({ frame: Math.max(0, localFrame - 6), fps, config: springConfig });

  const isPlaceholder = isPlaceholderIconOrTitle(scene);
  const titleBase = scene.title.length > 28 ? 40 : scene.title.length > 18 ? 46 : 52;
  const leftAligned =
    family === 'editorial-paper' || family === 'data-board' || family === 'kinetic-type';

  const captionText = (scene.subtitle || scene.bullets?.[0] || '').trim();
  const compactChips = (scene.bullets || []).filter((b) => b && b !== captionText).slice(0, 2);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* TOP HEADER ZONE: strictly y = 62 .. 246 (clear above Hero Stage y = 260) */}
      <div
        style={{
          position: 'absolute',
          top: 62,
          left: 36,
          right: 36,
          height: 184,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: leftAligned ? 'flex-start' : 'center',
          gap: 10,
          overflow: 'hidden',
          opacity: interpolate(headSp, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(0, ${interpolate(headSp, [0, 1], [14 * motionIntensity, 0]).toFixed(1)}px, 0)`,
        }}
      >
        {/* Top Metadata / Badge Strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: leftAligned ? 'space-between' : 'center',
            width: leftAligned ? '100%' : 'auto',
            gap: 12,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 9,
              padding: '6px 18px',
              borderRadius: family === 'editorial-paper' ? 6 : 999,
              backgroundColor: hexToRgba(palette.surface, isLight ? 0.92 : 0.72),
              border: `1.5px solid ${hexToRgba(accent, isLight ? 0.55 : 0.65)}`,
              boxShadow: isLight
                ? '0 4px 12px rgba(15, 23, 42, 0.06)'
                : `0 0 18px ${hexToRgba(accent, 0.18)}`,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: family === 'editorial-paper' ? 2 : '50%',
                backgroundColor: accent,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 21,
                fontWeight: 700,
                lineHeight: 1.35,
                color: accent,
                letterSpacing: 0.4,
                whiteSpace: 'nowrap',
              }}
            >
              {scene.badge || `SCENE ${String(sceneIndex + 1).padStart(2, '0')}`}
            </span>
          </div>

          {leftAligned && totalScenes > 1 && (
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: 19,
                fontWeight: 700,
                color: palette.muted,
                letterSpacing: 1.8,
              }}
            >
              {String(sceneIndex + 1).padStart(2, '0')} / {String(totalScenes).padStart(2, '0')}
            </span>
          )}
        </div>

        {/* Crisp Compact Headline */}
        <div
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: leftAligned ? 'flex-start' : 'center',
            gap: 14,
          }}
        >
          {family === 'data-board' && (
            <div
              style={{
                width: 7,
                borderRadius: 99,
                background: `linear-gradient(180deg, ${accent} 0%, ${accent2} 100%)`,
                flexShrink: 0,
                marginTop: 6,
                marginBottom: 6,
              }}
            />
          )}
          <div
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: titleBase,
              fontWeight: 800,
              lineHeight: 1.34,
              color: palette.fg,
              textAlign: leftAligned ? 'left' : 'center',
              paddingTop: 4,
              paddingBottom: 4,
              textShadow: isLight ? 'none' : '0 4px 18px rgba(0, 0, 0, 0.55)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {renderHighlightedText(scene.title, scene.highlight, accent)}
          </div>
        </div>
      </div>

      {/* SMALL CAPTION CARD (title/icon placeholder scenes): strictly y = 1230 .. 1358 */}
      {isPlaceholder && captionText && (
        <div
          style={{
            position: 'absolute',
            top: 1230,
            left: 32,
            right: 32,
            height: 128,
            display: 'flex',
            alignItems: 'center',
            opacity: interpolate(capSp, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' }),
            transform: `translate3d(0, ${interpolate(capSp, [0, 1], [16 * motionIntensity, 0]).toFixed(1)}px, 0)`,
          }}
        >
          <div
            style={{
              width: '100%',
              maxHeight: 126,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 18,
              padding: '14px 24px',
              borderRadius: family === 'editorial-paper' ? 12 : 22,
              backgroundColor: hexToRgba(palette.surface, isLight ? 0.95 : 0.84),
              border: `2px solid ${hexToRgba(accent, isLight ? 0.42 : 0.48)}`,
              borderLeft: `8px solid ${accent}`,
              boxShadow: isLight
                ? '0 10px 26px rgba(15, 23, 42, 0.08)'
                : '0 14px 32px rgba(2, 6, 23, 0.48)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                flex: 1,
                fontFamily: THAI_FONT_FAMILY,
                fontSize: captionText.length > 52 ? 24 : 27,
                fontWeight: 700,
                lineHeight: 1.4,
                color: palette.fg,
                paddingTop: 3,
                paddingBottom: 3,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {captionText}
            </div>

            {compactChips.length > 0 && captionText.length <= 46 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                {compactChips.slice(0, 2).map((chip, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 999,
                      backgroundColor: hexToRgba(idx === 0 ? accent : accent2, isLight ? 0.14 : 0.2),
                      border: `1px solid ${hexToRgba(idx === 0 ? accent : accent2, 0.45)}`,
                      color: idx === 0 ? accent : palette.fg,
                      fontFamily: THAI_FONT_FAMILY,
                      fontSize: 17,
                      fontWeight: 700,
                      lineHeight: 1.32,
                      whiteSpace: 'nowrap',
                      maxWidth: 230,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {chip}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* STRUCTURED DATA VISUAL CARD (bullets/stat/steps/compare/quote/real image): y = 768 .. 1358 */}
      {!isPlaceholder && (
        <div
          style={{
            position: 'absolute',
            top: 768,
            left: 32,
            right: 32,
            bottom: 562,
            borderRadius: family === 'editorial-paper' ? 14 : 26,
            backgroundColor: hexToRgba(palette.surface, isLight ? 0.94 : 0.86),
            border: `2px solid ${hexToRgba(accent, 0.5)}`,
            boxShadow: isLight
              ? '0 16px 38px rgba(15, 23, 42, 0.12)'
              : '0 20px 48px rgba(2, 6, 23, 0.56)',
            padding: '14px 18px',
            overflow: 'hidden',
            opacity: interpolate(capSp, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' }),
            transform: `translate3d(0, ${interpolate(capSp, [0, 1], [22 * motionIntensity, 0]).toFixed(1)}px, 0)`,
          }}
        >
          <SceneVisual
            scene={scene}
            tokens={tokens}
            localFrame={localFrame}
            durationFrames={durationFrames}
            compact
          />
        </div>
      )}
    </div>
  );
};

// ============================================================================
// DISPATCHER
// ============================================================================

export const FamilySceneRenderer: React.FC<FamilySceneRendererProps> = (props) => {
  if (!hasStyleDirector(props.styleId) && props.scene.vector?.elements?.length) {
    return <DynamicMotionStage {...props} />;
  }
  if (isIllustratedStyle(props.styleId)) {
    return <IllustratedLayout {...props} />;
  }
  if (props.tokens.family === 'flat-cartoon') {
    return <FlatCartoonLayout {...props} />;
  }
  if (hasStyleDirector(props.styleId)) {
    return <StyleDirectedLayout {...props} />;
  }
  if (props.hasHero || (props.styleId && hasHeroSignature(props.styleId))) {
    return <HeroStyleSceneLayout {...props} />;
  }
  switch (props.tokens.family) {
    case 'glow-world':
      return <GlowWorldLayout {...props} />;
    case 'editorial-paper':
      return <EditorialPaperLayout {...props} />;
    case 'data-board':
      return <DataBoardLayout {...props} />;
    case 'kinetic-type':
      return <KineticTypeLayout {...props} />;
    case 'iso-3d':
      return <Iso3DLayout {...props} />;
    case 'documentary-card':
      return <DocumentaryCardLayout {...props} />;
  }
};
