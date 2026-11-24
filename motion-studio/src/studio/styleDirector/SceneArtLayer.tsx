import React, { useState } from 'react';
import { Img, interpolate, spring, staticFile } from 'remotion';
import type { StudioScene } from '../types';
import { STAGE_W } from './kit';

export type ArtLayoutName = 'stack-bottom' | 'split-right' | 'split-left' | 'hero-corner';

export interface ArtPlacement {
  left?: number;
  right?: number;
  centerX?: boolean;
  top?: number;
  bottom?: number;
  widthFrac: number;
}

export interface ArtLayout {
  name: ArtLayoutName;
  shotScale: number;
  shotOrigin: string;
  shotTranslate: { x: number; y: number };
  art: ArtPlacement;
}

/**
 * Picks an art-aware composition layout so 3D props read as large heroes without obscuring
 * the main title or the subtitle bar (StudioEngine places SubtitleBar at bottom: 320, y ~1460..1600, zIndex: 50).
 *
 * - Data shots and DynamicMotionStage vector scenes keep full-bleed framing ('hero-corner', 48% width).
 * - Standard directed shots rotate through 'stack-bottom' (70% width), 'split-right' (58% width),
 *   and 'split-left' (58% width), scaling the shot into a framed card to open generous stage space.
 */
const FRAMED_LAYOUTS: readonly ('stack-bottom' | 'split-right' | 'split-left')[] = [
  'stack-bottom',
  'split-right',
  'split-left',
];

export function pickArtLayout(
  sceneIndex: number,
  variant: number,
  isDataShot: boolean,
  isVectorStage = false,
): ArtLayout {
  if (isDataShot || isVectorStage) {
    const placeRight = Math.abs(sceneIndex + variant) % 2 === 0;
    return {
      name: 'hero-corner',
      shotScale: 1,
      shotOrigin: '50% 50%',
      shotTranslate: { x: 0, y: 0 },
      art: placeRight
        ? { right: 20, bottom: 20, widthFrac: 0.48 }
        : { left: 20, bottom: 20, widthFrac: 0.48 },
    };
  }

  const chosen = FRAMED_LAYOUTS[Math.abs(sceneIndex) % FRAMED_LAYOUTS.length];

  if (chosen === 'stack-bottom') {
    return {
      name: 'stack-bottom',
      shotScale: 0.8,
      shotOrigin: '50% 0%',
      shotTranslate: { x: 0, y: 0 },
      art: { centerX: true, bottom: 48, widthFrac: 0.7 },
    };
  }

  if (chosen === 'split-right') {
    return {
      name: 'split-right',
      shotScale: 0.74,
      shotOrigin: '0% 10%',
      shotTranslate: { x: 24, y: 0 },
      art: { right: 8, top: 920, widthFrac: 0.58 },
    };
  }

  // 'split-left': mirror of 'split-right'
  return {
    name: 'split-left',
    shotScale: 0.74,
    shotOrigin: '100% 10%',
    shotTranslate: { x: -24, y: 0 },
    art: { left: 8, top: 920, widthFrac: 0.58 },
  };
}

export interface SceneArtLayerProps {
  art: NonNullable<StudioScene['art']>;
  layout?: ArtLayout;
  sceneIndex?: number;
  variant?: number;
  isDataShot?: boolean;
  isVectorStage?: boolean;
  localFrame: number;
  durationFrames: number;
  fps: number;
}

export const SceneArtLayer: React.FC<SceneArtLayerProps> = ({
  art,
  layout,
  sceneIndex = 0,
  variant = 0,
  isDataShot = false,
  isVectorStage = false,
  localFrame,
  durationFrames,
  fps,
}) => {
  const [failed, setFailed] = useState(false);

  if (!art?.src || failed) return null;

  const resolvedLayout =
    layout || pickArtLayout(sceneIndex, variant, isDataShot, isVectorStage);
  const resolvedSrc =
    art.src.startsWith('http://') || art.src.startsWith('https://') || art.src.startsWith('/')
      ? art.src
      : staticFile(art.src);

  const safeFps = Math.max(1, fps);
  const enterFrames = Math.max(1, Math.round(safeFps * 0.5));
  const enterProgress = spring({
    frame: localFrame,
    fps: safeFps,
    config: { damping: 16, stiffness: 120 },
    durationInFrames: enterFrames,
  });

  const fadeOutFrames = Math.max(1, Math.round(safeFps * 0.4));
  const fadeOutStart = Math.max(0, durationFrames - fadeOutFrames);
  const exitOpacity =
    durationFrames > fadeOutFrames
      ? interpolate(localFrame, [fadeOutStart, durationFrames], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;

  const opacity = enterProgress * exitOpacity;
  const enterScale = interpolate(enterProgress, [0, 1], [0.85, 1]);

  const tSec = localFrame / safeFps;
  const hint = art.motionHint || 'float';
  let motionTranslateY = 0;
  let motionRotateDeg = 0;

  if (hint === 'spin') {
    motionRotateDeg = Math.sin(tSec * 1.8) * 6;
  } else if (hint === 'rise') {
    motionTranslateY = interpolate(localFrame, [0, Math.max(1, Math.round(safeFps * 0.7))], [40, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  } else {
    motionTranslateY = Math.sin(tSec * 2.2) * 14;
  }

  const widthPx = Math.round(STAGE_W * resolvedLayout.art.widthFrac);
  let baseTransform = '';
  const posStyle: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
  };

  if (resolvedLayout.art.centerX) {
    posStyle.left = '50%';
    baseTransform = 'translateX(-50%) ';
  } else {
    if (typeof resolvedLayout.art.left === 'number') {
      posStyle.left = Math.round(resolvedLayout.art.left);
    }
    if (typeof resolvedLayout.art.right === 'number') {
      posStyle.right = Math.round(resolvedLayout.art.right);
    }
  }

  if (typeof resolvedLayout.art.top === 'number') {
    posStyle.top = Math.round(resolvedLayout.art.top);
  } else if (typeof resolvedLayout.art.bottom === 'number') {
    posStyle.bottom = Math.round(resolvedLayout.art.bottom);
  }

  // Ground shadow subtly shrinks when the object floats higher
  const shadowScale = Math.max(0.82, Math.min(1.08, 1 + motionTranslateY * 0.004));
  const shadowHeight = Math.max(28, Math.round(widthPx * 0.11));

  return (
    <div
      style={{
        ...posStyle,
        width: widthPx,
        opacity,
        transform: `${baseTransform}scale(${enterScale.toFixed(4)})`,
        zIndex: 2,
      }}
    >
      {/* Ground shadow ellipse beneath the 3D prop */}
      <div
        style={{
          position: 'absolute',
          left: '14%',
          right: '14%',
          bottom: Math.round(widthPx * 0.03),
          height: shadowHeight,
          borderRadius: '50%',
          background:
            'radial-gradient(ellipse at center, rgba(0, 0, 0, 0.34) 0%, rgba(0, 0, 0, 0.14) 50%, rgba(0, 0, 0, 0) 76%)',
          filter: 'blur(12px)',
          transform: `scale(${shadowScale.toFixed(3)})`,
          pointerEvents: 'none',
        }}
      />
      <Img
        src={resolvedSrc}
        onError={() => setFailed(true)}
        style={{
          position: 'relative',
          width: '100%',
          height: 'auto',
          display: 'block',
          objectFit: 'contain',
          transform: `translateY(${motionTranslateY.toFixed(2)}px) rotate(${motionRotateDeg.toFixed(2)}deg)`,
          filter: 'drop-shadow(0 18px 32px rgba(0, 0, 0, 0.38))',
        }}
      />
    </div>
  );
};
