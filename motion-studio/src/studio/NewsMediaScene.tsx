import React, { useState } from 'react';
import { Img, Loop, OffthreadVideo, interpolate, spring, staticFile, useVideoConfig } from 'remotion';
import { THAI_FONT_FAMILY } from '../components/ThaiFontLoader';
import type { ResolvedStyleTokens, StudioScene } from './types';

/**
 * News-broadcast layout for scenes that carry real media (photo or short clip from the story).
 * Media panel (16:9 full-bleed) on top, headline + key facts below; the engine's subtitle bar
 * (bottom: 320, y ~1460..1600) stays clear because content ends at y ~1420.
 */

const MEDIA_TOP = 236;
const MEDIA_H = 608; // 1080 x 608 = 16:9

function resolveSrc(src: string): string {
  return src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/') ? src : staticFile(src);
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
  const [failed, setFailed] = useState(false);
  const media = scene.media!;
  const palette = tokens.palette;
  const accent = palette.accent || '#E11D48';

  const enter = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 120 } });
  const textEnter = spring({ frame: Math.max(0, localFrame - 6), fps, config: { damping: 20, stiffness: 110 } });
  const kenBurns = interpolate(localFrame, [0, Math.max(1, durationFrames)], [1.04, 1.14], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const panX = interpolate(localFrame, [0, Math.max(1, durationFrames)], [-14, 14], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const clipFrames = Math.max(15, Math.round((media.durationSec || 8) * fps));
  const src = resolveSrc(media.src);
  const isVideo = media.type === 'video' && !failed;
  const facts = (scene.bullets || []).filter((b) => typeof b === 'string' && b.trim()).slice(0, 3);
  const label = media.label || scene.badge || 'ข่าว';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(180deg, ${palette.bg} 0%, ${palette.surface} 100%)`,
        fontFamily: THAI_FONT_FAMILY,
        overflow: 'hidden',
      }}
    >
      {/* Top strip: section label + counter */}
      <div
        style={{
          position: 'absolute',
          top: 120,
          left: 40,
          right: 40,
          height: 84,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: enter,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              background: '#E11D48',
              color: '#fff',
              fontWeight: 800,
              fontSize: 34,
              padding: '8px 22px',
              borderRadius: 10,
              letterSpacing: 0.5,
            }}
          >
            {label}
          </div>
          {isVideo && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: '#fff',
                fontWeight: 700,
                fontSize: 26,
                background: 'rgba(0,0,0,0.45)',
                padding: '6px 14px',
                borderRadius: 8,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  background: '#EF4444',
                  opacity: Math.floor(localFrame / 15) % 2 === 0 ? 1 : 0.35,
                }}
              />
              ภาพเหตุการณ์
            </div>
          )}
        </div>
        <div style={{ color: palette.muted, fontSize: 28, fontWeight: 700 }}>
          {String(sceneIndex + 1).padStart(2, '0')} / {String(totalScenes).padStart(2, '0')}
        </div>
      </div>

      {/* Media panel */}
      <div
        style={{
          position: 'absolute',
          top: MEDIA_TOP,
          left: 0,
          width: 1080,
          height: MEDIA_H,
          overflow: 'hidden',
          background: '#000',
          opacity: interpolate(enter, [0, 1], [0, 1]),
          transform: `translateY(${interpolate(enter, [0, 1], [40, 0]).toFixed(2)}px)`,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}
      >
        {isVideo ? (
          <Loop durationInFrames={clipFrames}>
            <OffthreadVideo
              src={src}
              muted
              onError={() => setFailed(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </Loop>
        ) : (
          <Img
            src={media.type === 'video' && media.poster ? resolveSrc(media.poster) : src}
            onError={() => setFailed(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${kenBurns.toFixed(4)}) translateX(${panX.toFixed(2)}px)`,
            }}
          />
        )}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 120,
            background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.6))',
          }}
        />
        {media.credit && (
          <div
            style={{
              position: 'absolute',
              right: 18,
              bottom: 14,
              padding: '5px 14px',
              borderRadius: 8,
              background: 'rgba(15,23,42,0.78)',
              color: '#F1F5F9',
              fontSize: 22,
              maxWidth: 760,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {media.credit}
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', top: MEDIA_TOP + MEDIA_H, left: 0, height: 8, width: `${(enter * 100).toFixed(1)}%`, background: accent }} />

      {/* Headline + facts */}
      <div
        style={{
          position: 'absolute',
          top: MEDIA_TOP + MEDIA_H + 44,
          left: 56,
          right: 56,
          bottom: 500,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          opacity: textEnter,
          transform: `translateY(${interpolate(textEnter, [0, 1], [26, 0]).toFixed(2)}px)`,
        }}
      >
        <div style={{ color: palette.fg, fontSize: 60, fontWeight: 800, lineHeight: 1.32 }}>{scene.title}</div>
        {scene.subtitle && (
          <div style={{ color: palette.muted, fontSize: 34, fontWeight: 600, lineHeight: 1.45 }}>{scene.subtitle}</div>
        )}
        {facts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 6 }}>
            {facts.map((f, i) => {
              const fe = spring({ frame: Math.max(0, localFrame - 14 - i * 8), fps, config: { damping: 20 } });
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 14,
                    color: palette.fg,
                    fontSize: 32,
                    fontWeight: 600,
                    lineHeight: 1.4,
                    opacity: fe,
                    transform: `translateX(${interpolate(fe, [0, 1], [-24, 0]).toFixed(2)}px)`,
                  }}
                >
                  <span style={{ width: 12, height: 12, marginTop: 16, borderRadius: 3, background: accent, flexShrink: 0 }} />
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
