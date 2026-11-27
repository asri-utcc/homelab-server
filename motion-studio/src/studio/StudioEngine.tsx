import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { SubtitleBar, SubtitleCue } from '../components/SubtitleBar';
import { THAI_FONT_FAMILY, ThaiFontLoader } from '../components/ThaiFontLoader';
import { StudioBackground } from './backgrounds';
import { FamilySceneRenderer } from './families';
import { NewsMediaScene } from './NewsMediaScene';
import { StyleSignature, hasHeroSignature } from './signatures';
import { isIllustratedStyle } from './director/doodleKit';
import { hasStyleDirector } from './styleDirector/registry';
import {
  DEFAULT_STUDIO_PROPS,
  ResolvedStyleTokens,
  StudioProps,
  StudioScene,
  TransitionType,
  hexToRgba,
  resolveStyleTokens,
} from './types';

export { DEFAULT_STUDIO_PROPS };
export type { StudioProps };

const TRANSITION_FRAMES = 12; // Within 10-14 frames spec
const SUBTITLE_BOTTOM_SAFE = 320; // Bottom safe zone >= 320px

// ============================================================================
// TRANSITION COMPUTATION (Zero-Black-Frame Overlap)
// ============================================================================

function computeTransitionLayerStyle(
  kind: TransitionType,
  progress: number,
  role: 'in' | 'out',
  motionIntensity: number,
): React.CSSProperties {
  const p = Math.max(0, Math.min(1, progress));
  const eased = role === 'in' ? Easing.out(Easing.cubic)(p) : Easing.inOut(Easing.cubic)(p);
  const inv = 1 - eased;

  if (kind === 'cut') {
    return role === 'in' ? { opacity: 1 } : { opacity: 0 };
  }

  if (kind === 'slide') {
    const shift = Math.round(140 * motionIntensity);
    return role === 'in'
      ? {
          opacity: interpolate(p, [0, 0.65], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(${(inv * shift).toFixed(1)}px, 0, 0)`,
        }
      : {
          opacity: interpolate(p, [0.25, 1], [1, 0], { extrapolateLeft: 'clamp' }),
          transform: `translate3d(${(-eased * shift * 0.65).toFixed(1)}px, 0, 0)`,
        };
  }

  if (kind === 'zoom') {
    return role === 'in'
      ? {
          opacity: interpolate(p, [0, 0.7], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `scale(${interpolate(eased, [0, 1], [0.92, 1]).toFixed(4)})`,
        }
      : {
          opacity: interpolate(p, [0.2, 1], [1, 0], { extrapolateLeft: 'clamp' }),
          transform: `scale(${interpolate(eased, [0, 1], [1, 1.07]).toFixed(4)})`,
        };
  }

  if (kind === 'wipe') {
    return role === 'in'
      ? {
          opacity: 1,
          clipPath: `inset(0 ${(inv * 100).toFixed(1)}% 0 0)`,
        }
      : {
          opacity: interpolate(p, [0.6, 1], [1, 0.3], { extrapolateLeft: 'clamp' }),
        };
  }

  if (kind === 'iris') {
    const radius = interpolate(eased, [0, 1], [6, 125]);
    return role === 'in'
      ? {
          opacity: interpolate(p, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' }),
          clipPath: radius >= 124 ? 'none' : `circle(${radius.toFixed(1)}% at 50% 50%)`,
        }
      : {
          opacity: interpolate(p, [0.5, 1], [1, 0], { extrapolateLeft: 'clamp' }),
        };
  }

  if (kind === 'spring') {
    return role === 'in'
      ? {
          opacity: interpolate(p, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(0, ${(inv * 56 * motionIntensity).toFixed(1)}px, 0) scale(${interpolate(eased, [0, 1], [0.94, 1]).toFixed(4)})`,
        }
      : {
          opacity: interpolate(p, [0.2, 1], [1, 0], { extrapolateLeft: 'clamp' }),
          transform: `translate3d(0, ${(-eased * 36 * motionIntensity).toFixed(1)}px, 0) scale(${interpolate(eased, [0, 1], [1, 0.96]).toFixed(4)})`,
        };
  }

  if (kind === 'lightLeak') {
    return role === 'in'
      ? {
          opacity: interpolate(p, [0, 0.72], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `scale(${interpolate(eased, [0, 1], [1.035, 1]).toFixed(4)})`,
        }
      : {
          opacity: interpolate(p, [0.25, 1], [1, 0], { extrapolateLeft: 'clamp' }),
          transform: `scale(${interpolate(eased, [0, 1], [1, 1.03]).toFixed(4)})`,
        };
  }

  // Default: 'fade'
  return role === 'in'
    ? {
        opacity: eased,
        transform: `scale(${interpolate(eased, [0, 1], [0.985, 1]).toFixed(4)})`,
      }
    : {
        opacity: inv,
      };
}

// ============================================================================
// SUBTITLE RENDERERS (floating | bar | karaoke | none)
// ============================================================================

type ThaiSegmenterLike = {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
};

const THAI_SUB_SEGMENTER: ThaiSegmenterLike | null = (() => {
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

function splitSubWords(text: string): string[] {
  if (!text) return [];
  if (THAI_SUB_SEGMENTER) {
    const out: string[] = [];
    for (const part of THAI_SUB_SEGMENTER.segment(text)) {
      if (part.segment) out.push(part.segment);
    }
    return out;
  }
  return text.split(/(\s+)/).filter(Boolean);
}

const FloatingSubtitle: React.FC<{
  cues: SubtitleCue[];
  tokens: ResolvedStyleTokens;
}> = ({ cues, tokens }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const active = cues.find((c) => frame >= c.startFrame && frame <= c.endFrame);
  if (!active) return null;

  const localFrame = frame - active.startFrame;
  const remaining = active.endFrame - frame;
  const enter = spring({
    frame: localFrame,
    fps,
    config: { damping: 18, stiffness: 210, mass: 0.7 },
  });
  const fadeOut = interpolate(remaining, [0, 5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity =
    interpolate(localFrame, [0, 5], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }) * fadeOut;
  const ty = interpolate(enter, [0, 1], [12, 0]);

  const { palette, isLight, subtitle } = tokens;
  const hiColor = subtitle.accentColor;
  const textShadow = isLight
    ? `0 2px 14px ${hexToRgba(palette.bg, 0.96)}, 0 0 6px ${hexToRgba(palette.bg, 0.92)}`
    : '0 4px 20px rgba(0, 0, 0, 0.92), 0 1px 4px rgba(0, 0, 0, 0.95)';

  const kw = active.highlight?.trim() || '';
  const hasKw = kw.length > 0 && active.text.includes(kw);

  return (
    <div
      style={{
        position: 'absolute',
        left: 72,
        right: 72,
        bottom: SUBTITLE_BOTTOM_SAFE,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 60,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translate3d(0, ${ty.toFixed(1)}px, 0)`,
          color: palette.fg,
          fontFamily: THAI_FONT_FAMILY,
          fontWeight: 700,
          fontSize: active.text.length > 36 ? 34 : 38,
          lineHeight: 1.48,
          textAlign: 'center',
          textShadow,
          maxWidth: 920,
          paddingTop: 8,
          paddingBottom: 8,
          wordBreak: 'keep-all',
        }}
      >
        {hasKw
          ? active.text.split(kw).map((part, idx, arr) => (
              <React.Fragment key={idx}>
                {part}
                {idx < arr.length - 1 && (
                  <span
                    style={{
                      color: hiColor,
                      borderBottom: `4px solid ${hiColor}`,
                      paddingBottom: 2,
                    }}
                  >
                    {kw}
                  </span>
                )}
              </React.Fragment>
            ))
          : active.text}
      </div>
    </div>
  );
};

const StudioKaraokeSubtitle: React.FC<{
  cues: SubtitleCue[];
  tokens: ResolvedStyleTokens;
}> = ({ cues, tokens }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const active = cues.find((c) => frame >= c.startFrame && frame <= c.endFrame);
  if (!active) return null;

  const localFrame = frame - active.startFrame;
  const dur = Math.max(6, active.endFrame - active.startFrame);
  const pop = spring({
    frame: localFrame,
    fps,
    config: { damping: 16, stiffness: 210, mass: 0.7 },
  });
  const exitOp = interpolate(localFrame, [Math.max(1, dur - 5), dur], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity =
    interpolate(localFrame, [0, 5], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }) * exitOp;
  const ty = interpolate(pop, [0, 1], [14, 0]);
  const scale = interpolate(pop, [0, 1], [0.96, 1]);

  const { palette, isLight, subtitle } = tokens;
  const hiColor = isLight ? '#FDE047' : subtitle.accentColor;
  const hiText = '#0F172A';

  const kw = active.highlight?.trim() || '';

  // Keep cue.highlight as one contiguous badge while splitting non-highlight spans into Thai words
  type SubToken = { text: string; isHighlight: boolean; isWs: boolean };
  const rawSpans: Array<{ text: string; isHighlight: boolean }> =
    kw && active.text.includes(kw)
      ? active.text.split(kw).flatMap((part, idx, arr) => {
          const out: Array<{ text: string; isHighlight: boolean }> = [];
          if (part) out.push({ text: part, isHighlight: false });
          if (idx < arr.length - 1) out.push({ text: kw, isHighlight: true });
          return out;
        })
      : [{ text: active.text, isHighlight: false }];

  const subTokens: SubToken[] = [];
  for (const sp of rawSpans) {
    if (sp.isHighlight) {
      subTokens.push({ text: sp.text, isHighlight: true, isWs: false });
    } else {
      for (const piece of splitSubWords(sp.text)) {
        subTokens.push({ text: piece, isHighlight: false, isWs: /^\s+$/.test(piece) });
      }
    }
  }

  const nonEmptyIndices: number[] = [];
  subTokens.forEach((tok, idx) => {
    if (!tok.isWs) nonEmptyIndices.push(idx);
  });
  const progress = Math.max(0, Math.min(0.999, localFrame / Math.max(1, dur)));
  const activePos = Math.min(
    Math.max(0, nonEmptyIndices.length - 1),
    Math.floor(progress * nonEmptyIndices.length),
  );
  const activeWordTokenIdx = nonEmptyIndices[activePos] ?? -1;

  return (
    <div
      style={{
        position: 'absolute',
        left: 56,
        right: 56,
        bottom: SUBTITLE_BOTTOM_SAFE,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 60,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translate3d(0, ${ty.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`,
          backgroundColor: isLight ? 'rgba(20, 26, 40, 0.92)' : 'rgba(8, 12, 28, 0.88)',
          color: '#FFFFFF',
          fontFamily: THAI_FONT_FAMILY,
          fontWeight: 700,
          fontSize: active.text.length > 42 ? 32 : 36,
          lineHeight: 1.5,
          textAlign: 'center',
          padding: '15px 30px 17px 30px',
          borderRadius: 24,
          border: `2px solid ${hexToRgba(palette.accent, 0.45)}`,
          boxShadow: '0 14px 36px rgba(2, 6, 23, 0.42)',
          maxWidth: 960,
          wordBreak: 'keep-all',
        }}
      >
        <div style={{ paddingTop: 6, paddingBottom: 6 }}>
          {subTokens.map((tok, idx) => {
            if (tok.isWs) {
              return (
                <span key={idx} style={{ whiteSpace: 'pre' }}>
                  {tok.text}
                </span>
              );
            }

            const isCurrent = idx === activeWordTokenIdx;
            const isSpoken = idx < activeWordTokenIdx;

            if (tok.isHighlight) {
              return (
                <span
                  key={idx}
                  style={{
                    display: 'inline',
                    backgroundColor: hiColor,
                    color: hiText,
                    borderRadius: 9,
                    padding: '2px 10px',
                    margin: '0 3px',
                  }}
                >
                  {tok.text}
                </span>
              );
            }

            return (
              <span
                key={idx}
                style={{
                  display: 'inline',
                  color: isCurrent
                    ? hiColor
                    : isSpoken
                      ? '#FFFFFF'
                      : 'rgba(241, 245, 249, 0.72)',
                  textShadow: isCurrent ? `0 0 14px ${hexToRgba(hiColor, 0.55)}` : 'none',
                }}
              >
                {tok.text}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPOSITION: STUDIO ENGINE
// ============================================================================

export const StudioEngine: React.FC<StudioProps> = (props) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const baseTokens = resolveStyleTokens(props.style || DEFAULT_STUDIO_PROPS.style);
  const scenes: StudioScene[] =
    props.scenes && props.scenes.length > 0 ? props.scenes : DEFAULT_STUDIO_PROPS.scenes;

  // Locate active scene index from frame
  let activeIdx = scenes.findIndex((s) => frame >= s.startFrame && frame < s.endFrame);
  if (activeIdx < 0) {
    activeIdx = frame < scenes[0].startFrame ? 0 : scenes.length - 1;
  }
  const activeScene = scenes[activeIdx];
  const prevScene = activeIdx > 0 ? scenes[activeIdx - 1] : null;

  const activeTokens = activeScene.family
    ? resolveStyleTokens({ ...props.style, family: activeScene.family })
    : baseTokens;

  const localFrame = Math.max(0, frame - activeScene.startFrame);
  const activeDur = Math.max(1, activeScene.endFrame - activeScene.startFrame);

  // Determine whether we are in the 12-frame cross-scene transition window
  const transDur = Math.min(TRANSITION_FRAMES, Math.max(6, Math.floor(activeDur / 3)));
  const inTransition = prevScene !== null && localFrame < transDur && activeTokens.transition !== 'cut';
  const transProgress = inTransition ? localFrame / transDur : 1;

  const prevTokens =
    prevScene && prevScene.family
      ? resolveStyleTokens({ ...props.style, family: prevScene.family })
      : baseTokens;

  // Merge top-level cues with scene-level cues (supporting both timeline shapes)
  const mergedCues: SubtitleCue[] =
    props.cues && props.cues.length > 0
      ? props.cues
      : scenes.flatMap((s) => s.cues || []);

  // Subtle light-leak wash overlay when transition === 'lightLeak'
  const leakAlpha =
    inTransition && activeTokens.transition === 'lightLeak'
      ? Math.sin(transProgress * Math.PI) * 0.52
      : 0;

  // Resolve style signature ID (props.styleId -> props.style.id -> tokens.signature fallback)
  const resolvedStyleId =
    props.styleId ||
    props.style?.id ||
    (activeTokens as ResolvedStyleTokens & { signature?: string }).signature ||
    '';

  const normalizedStyleId = resolvedStyleId.trim().toLowerCase();
  const isFlatCartoon = activeTokens.family === 'flat-cartoon' || normalizedStyleId === 'look-2';
  const isIllustrated = isIllustratedStyle(normalizedStyleId);
  const isStyleDirected = hasStyleDirector(normalizedStyleId);
  const isFullScene = isIllustrated || isStyleDirected;
  const hasHero = !isFlatCartoon && !isFullScene && hasHeroSignature(normalizedStyleId);
  const prevHasHero =
    prevTokens.family !== 'flat-cartoon' &&
    normalizedStyleId !== 'look-2' &&
    !isFullScene &&
    hasHeroSignature(normalizedStyleId);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: activeTokens.palette.bg,
        fontFamily: THAI_FONT_FAMILY,
        overflow: 'hidden',
      }}
    >
      <ThaiFontLoader />

      {/* Layer 0: Deterministic Background Treatment */}
      <StudioBackground tokens={activeTokens} frame={frame} />

      {/* Layer 0.5: Style Signature Hero or Underlay (per-style visual identity) */}
      {resolvedStyleId && !isFullScene && (
        <StyleSignature
          styleId={resolvedStyleId}
          tokens={activeTokens}
          scene={activeScene}
          localFrame={localFrame}
          totalScenes={scenes.length}
          frame={frame}
          sceneIndex={activeIdx}
          width={width}
          height={height}
          placement={hasHero ? 'hero' : 'under'}
        />
      )}

      {/* Layer 1A: Outgoing Previous Scene during cross-transition (Zero black frames) */}
      {inTransition && prevScene && (
        <AbsoluteFill
          style={{
            ...computeTransitionLayerStyle(
              activeTokens.transition,
              transProgress,
              'out',
              activeTokens.motionIntensity,
            ),
            pointerEvents: 'none',
          }}
        >
          {prevScene.media?.src ? (
            <NewsMediaScene
              scene={prevScene}
              sceneIndex={activeIdx - 1}
              totalScenes={scenes.length}
              tokens={prevTokens}
              localFrame={Math.max(0, frame - prevScene.startFrame)}
              durationFrames={Math.max(1, prevScene.endFrame - prevScene.startFrame)}
            />
          ) : (
            <FamilySceneRenderer
              scene={prevScene}
              sceneIndex={activeIdx - 1}
              totalScenes={scenes.length}
              tokens={prevTokens}
              localFrame={Math.max(0, frame - prevScene.startFrame)}
              durationFrames={Math.max(1, prevScene.endFrame - prevScene.startFrame)}
              styleId={resolvedStyleId}
              hasHero={prevHasHero}
              allScenes={scenes}
            />
          )}
        </AbsoluteFill>
      )}

      {/* Layer 1B: Active Scene */}
      <AbsoluteFill
        style={
          inTransition
            ? computeTransitionLayerStyle(
                activeTokens.transition,
                transProgress,
                'in',
                activeTokens.motionIntensity,
              )
            : undefined
        }
      >
        {activeScene.media?.src ? (
          <NewsMediaScene
            scene={activeScene}
            sceneIndex={activeIdx}
            totalScenes={scenes.length}
            tokens={activeTokens}
            localFrame={localFrame}
            durationFrames={activeDur}
          />
        ) : (
          <FamilySceneRenderer
            scene={activeScene}
            sceneIndex={activeIdx}
            totalScenes={scenes.length}
            tokens={activeTokens}
            localFrame={localFrame}
            durationFrames={activeDur}
            styleId={resolvedStyleId}
            hasHero={hasHero}
            allScenes={scenes}
          />
        )}
      </AbsoluteFill>

      {/* Layer 1.5: Style Signature Overlay (non-hero styles only; above scene, below subtitles) */}
      {resolvedStyleId && !hasHero && !isFullScene && (
        <StyleSignature
          styleId={resolvedStyleId}
          tokens={activeTokens}
          scene={activeScene}
          localFrame={localFrame}
          totalScenes={scenes.length}
          frame={frame}
          sceneIndex={activeIdx}
          width={width}
          height={height}
          placement="over"
        />
      )}

      {/* Layer 2: Optional Light-Leak Transition Wash */}
      {leakAlpha > 0.01 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            opacity: leakAlpha,
            background: `linear-gradient(125deg, transparent 15%, ${hexToRgba(activeTokens.palette.accent, 0.72)} 48%, ${hexToRgba('#FFFFFF', 0.85)} 56%, ${hexToRgba(activeTokens.palette.accent2, 0.5)} 74%, transparent 92%)`,
            mixBlendMode: 'screen',
            zIndex: 55,
          }}
        />
      )}

      {/* Layer 3: Subtitle Layer (Bottom Safe >= 320px) — illustrated & style-directed styles use solid bar for readability */}
      {activeTokens.subtitle.mode === 'floating' && !isFullScene && (
        <FloatingSubtitle cues={mergedCues} tokens={activeTokens} />
      )}
      {(activeTokens.subtitle.mode === 'bar' || (isFullScene && activeTokens.subtitle.mode === 'floating')) && (
        <SubtitleBar
          cues={mergedCues}
          theme={activeTokens.subtitle.theme}
          accentColor={activeTokens.subtitle.accentColor}
          bottomOffset={SUBTITLE_BOTTOM_SAFE}
        />
      )}
      {activeTokens.subtitle.mode === 'karaoke' && (
        <StudioKaraokeSubtitle cues={mergedCues} tokens={activeTokens} />
      )}
    </AbsoluteFill>
  );
};
