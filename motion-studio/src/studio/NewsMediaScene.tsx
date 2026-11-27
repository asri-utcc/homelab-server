import React, { useState } from 'react';
import { Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useVideoConfig } from 'remotion';
import { THAI_FONT_FAMILY } from '../components/ThaiFontLoader';
import type { ResolvedStyleTokens, StudioScene } from './types';

/**
 * TV News Broadcast layout for scenes carrying real news media (5s video clip + news photo).
 * - Video scenes play the 5s highlight clip from t=0 of the scene via <Sequence from={scene.startFrame}>,
 *   then smoothly crossfade into the poster/still photo with gentle Ken-Burns pan/zoom for the rest of the narration.
 * - Distinct crimson (#E11D48) vs royal-blue (#2563EB) broadcast chrome for domestic vs international news.
 * - Content ends comfortably above SubtitleBar (bottom: 320, y ~1460..1600) with Thai vowel-safe line-height.
 */

const MEDIA_TOP = 228;
const MEDIA_H = 608; // 1080 x 608 = 16:9

function resolveSrc(src: string): string {
  return src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/') ? src : staticFile(src);
}

function renderHighlightedTitle(
  title: string,
  highlight?: string | string[],
  accentColor = '#FACC15',
): React.ReactNode {
  const raw = Array.isArray(highlight) ? highlight.find((h) => h && title.includes(h)) || highlight[0] : highlight;
  const hl = (raw || '').trim();
  if (!hl || !title.includes(hl)) return title;
  const idx = title.indexOf(hl);
  return (
    <>
      {title.slice(0, idx)}
      <span style={{ color: accentColor }}>{hl}</span>
      {title.slice(idx + hl.length)}
    </>
  );
}

export const NewsMediaScene: React.FC<{
  scene: StudioScene;
  sceneIndex: number;
  totalScenes: number;
  tokens: ResolvedStyleTokens;
  localFrame: number;
  durationFrames: number;
}> = ({ scene, sceneIndex, totalScenes, tokens, localFrame, durationFrames }) => {
  const { fps } = useVideoConfig();
  const [videoFailed, setVideoFailed] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const media = scene.media!;
  const palette = tokens.palette;
  const label = media.label || 'ข่าวเด่น';
  const isWorld = label.includes('ต่างประเทศ') || (scene.badge || '').includes('ต่างประเทศ');
  const regionColor = isWorld ? '#2563EB' : '#E11D48';
  const regionGlow = isWorld ? 'rgba(37, 99, 235, 0.22)' : 'rgba(225, 29, 72, 0.22)';

  const enter = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 130 } });
  const textEnter = spring({ frame: Math.max(0, localFrame - 5), fps, config: { damping: 20, stiffness: 115 } });

  const panDir = sceneIndex % 2 === 0 ? 1 : -1;
  const kenBurns = interpolate(localFrame, [0, Math.max(1, durationFrames)], [1.03, 1.13], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const panX = interpolate(localFrame, [0, Math.max(1, durationFrames)], [-16 * panDir, 16 * panDir], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const clipSec = media.durationSec || 5;
  const clipFrames = Math.max(30, Math.round(clipSec * fps));
  const src = resolveSrc(media.src);
  const posterSrc = media.poster ? resolveSrc(media.poster) : '';

  const hasVideo = media.type === 'video' && !videoFailed;
  const canHoldPoster = Boolean(posterSrc) && !imgFailed;
  // Smooth 14-frame crossfade from 5s video clip to still poster frame if scene is longer than clipFrames
  const fadeStart = Math.max(15, clipFrames - 14);
  const videoOpacity =
    hasVideo && canHoldPoster && durationFrames > clipFrames + 6
      ? interpolate(localFrame, [fadeStart, clipFrames], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;
  const showLiveVideoBadge = hasVideo && videoOpacity > 0.25;

  const facts = (scene.bullets || []).filter((b) => typeof b === 'string' && b.trim()).slice(0, 3);
  const titleLen = (scene.title || '').length;
  const titleSize = titleLen > 34 ? 46 : titleLen > 24 ? 52 : 56;
  const subBadge =
    scene.badge && scene.badge !== label ? scene.badge : `ซีนข่าว ${String(sceneIndex + 1).padStart(2, '0')}`;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at 50% 18%, ${regionGlow} 0%, transparent 58%), linear-gradient(180deg, #0B101B 0%, ${palette.bg || '#111622'} 55%, #090D16 100%)`,
        fontFamily: THAI_FONT_FAMILY,
        overflow: 'hidden',
      }}
    >
      {/* Top broadcast header bar */}
      <div
        style={{
          position: 'absolute',
          top: 118,
          left: 40,
          right: 40,
          height: 86,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: enter,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              background: regionColor,
              color: '#FFFFFF',
              fontWeight: 800,
              fontSize: 30,
              lineHeight: 1.35,
              padding: '7px 20px',
              borderRadius: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            }}
          >
            {label}
          </div>
          <div
            style={{
              color: '#E2E8F0',
              fontWeight: 700,
              fontSize: 26,
              lineHeight: 1.35,
              background: 'rgba(15, 23, 42, 0.78)',
              border: '1px solid rgba(148, 163, 184, 0.25)',
              padding: '7px 16px',
              borderRadius: 10,
            }}
          >
            {subBadge}
          </div>
          {showLiveVideoBadge && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: 24,
                background: 'rgba(15, 23, 42, 0.78)',
                padding: '6px 14px',
                borderRadius: 8,
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  background: '#EF4444',
                  opacity: Math.floor(localFrame / 12) % 2 === 0 ? 1 : 0.3,
                }}
              />
              คลิปข่าว
            </div>
          )}
        </div>
        <div style={{ color: '#94A3B8', fontSize: 26, fontWeight: 700 }}>
          {String(sceneIndex + 1).padStart(2, '0')}/{String(totalScenes).padStart(2, '0')}
        </div>
      </div>

      {/* 16:9 News Media Panel */}
      <div
        style={{
          position: 'absolute',
          top: MEDIA_TOP,
          left: 0,
          width: 1080,
          height: MEDIA_H,
          overflow: 'hidden',
          background: '#050811',
          opacity: interpolate(enter, [0, 1], [0, 1]),
          transform: `translateY(${interpolate(enter, [0, 1], [32, 0]).toFixed(2)}px)`,
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
        }}
      >
        {/* Still image / poster layer (always mounted underneath when available for zero-flash crossfade) */}
        {(media.type === 'image' || canHoldPoster || videoFailed) && !imgFailed && (
          <Img
            src={media.type === 'video' && posterSrc ? posterSrc : src}
            onError={() => setImgFailed(true)}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${kenBurns.toFixed(4)}) translateX(${panX.toFixed(2)}px)`,
            }}
          />
        )}

        {/* 5-second News Video Layer anchored to scene.startFrame */}
        {hasVideo && videoOpacity > 0.01 && (
          <div style={{ position: 'absolute', inset: 0, opacity: videoOpacity }}>
            <Sequence
              from={scene.startFrame}
              durationInFrames={canHoldPoster ? clipFrames + 2 : durationFrames}
              layout="none"
            >
              <OffthreadVideo
                src={src}
                muted
                onError={() => setVideoFailed(true)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </Sequence>
          </div>
        )}

        {/* Bottom gradient vignette for source credit readability */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 120,
            background: 'linear-gradient(180deg, transparent 0%, rgba(5, 8, 17, 0.72) 100%)',
          }}
        />
        {media.credit && (
          <div
            style={{
              position: 'absolute',
              right: 20,
              bottom: 14,
              padding: '6px 14px',
              borderRadius: 8,
              background: 'rgba(15, 23, 42, 0.82)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#F1F5F9',
              fontSize: 22,
              lineHeight: 1.35,
              maxWidth: 780,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {media.credit}
          </div>
        )}
      </div>

      {/* Broadcast Accent Bar */}
      <div
        style={{
          position: 'absolute',
          top: MEDIA_TOP + MEDIA_H,
          left: 0,
          height: 8,
          width: `${(enter * 100).toFixed(1)}%`,
          background: `linear-gradient(90deg, ${regionColor} 0%, #FACC15 100%)`,
        }}
      />

      {/* News Lower-Third Headline + Key Facts */}
      <div
        style={{
          position: 'absolute',
          top: MEDIA_TOP + MEDIA_H + 34,
          left: 50,
          right: 50,
          bottom: 485,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          opacity: textEnter,
          transform: `translateY(${interpolate(textEnter, [0, 1], [24, 0]).toFixed(2)}px)`,
        }}
      >
        <div
          style={{
            color: '#FFFFFF',
            fontSize: titleSize,
            fontWeight: 800,
            lineHeight: 1.38,
            paddingTop: 4,
            textShadow: '0 4px 16px rgba(0,0,0,0.45)',
          }}
        >
          {renderHighlightedTitle(scene.title, scene.highlight, '#FACC15')}
        </div>

        {scene.subtitle && (
          <div
            style={{
              color: '#CBD5E1',
              fontSize: 32,
              fontWeight: 600,
              lineHeight: 1.42,
            }}
          >
            {scene.subtitle}
          </div>
        )}

        {facts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            {facts.map((f, i) => {
              const delayFrames = 12 + i * Math.max(10, Math.min(28, Math.round(durationFrames * 0.14)));
              const fe = spring({
                frame: Math.max(0, localFrame - delayFrames),
                fps,
                config: { damping: 20, stiffness: 130 },
              });
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 14,
                    background: 'rgba(15, 23, 42, 0.72)',
                    borderLeft: `6px solid ${regionColor}`,
                    borderRadius: '0 12px 12px 0',
                    padding: '10px 18px',
                    color: '#F8FAFC',
                    fontSize: 30,
                    fontWeight: 600,
                    lineHeight: 1.42,
                    opacity: fe,
                    transform: `translateX(${interpolate(fe, [0, 1], [-24, 0]).toFixed(2)}px)`,
                  }}
                >
                  <span>{f}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
