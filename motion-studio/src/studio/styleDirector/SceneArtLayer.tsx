import React, { useState } from 'react';
import { Img, interpolate, spring, staticFile } from 'remotion';
import type { StudioScene } from '../types';
import { STAGE_H, STAGE_W } from './kit';

export type ArtSlot = 'band-left' | 'band-right' | 'band-center';

/**
 * Every directed shot keeps the bottom ~1/6 of the frame (below the subtitle bar) empty, so the 3D hero
 * lives there instead of floating over titles/cards. Rotates per scene/variant for variety.
 * (A full-frame backdrop slot was dropped: shot backgrounds are opaque and always covered it.)
 */
const SLOTS: readonly ArtSlot[] = ['band-right', 'band-left', 'band-center'];

export function pickArtSlot(sceneIndex: number, variant: number, _isDataShot: boolean): ArtSlot {
  return SLOTS[Math.abs(sceneIndex + variant * 2) % SLOTS.length];
}

export interface SceneArtLayerProps {
  art: NonNullable<StudioScene['art']>;
  sceneIndex: number;
  variant: number;
  isDataShot: boolean;
  localFrame: number;
  durationFrames: number;
  fps: number;
}

export const SceneArtLayer: React.FC<SceneArtLayerProps> = ({
  art,
  sceneIndex,
  variant,
  isDataShot,
  localFrame,
  durationFrames,
  fps,
}) => {
  const [failed, setFailed] = useState(false);

  if (!art?.src || failed) return null;

  const slot = pickArtSlot(sceneIndex, variant, isDataShot);
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

  const baseOpacity = 1;
  const opacity = baseOpacity * enterProgress * exitOpacity;
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

  let widthPx = STAGE_W * 0.38;
  let baseTransform = '';
  const posStyle: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
  };

  if (slot === 'band-right') {
    posStyle.bottom = 0;
    posStyle.right = Math.round(STAGE_W * 0.03);
  } else if (slot === 'band-left') {
    posStyle.bottom = 0;
    posStyle.left = Math.round(STAGE_W * 0.03);
  } else if (slot === 'band-center') {
    posStyle.bottom = 0;
    posStyle.left = '50%';
    baseTransform = 'translateX(-50%) ';
  }

  return (
    <div
      style={{
        ...posStyle,
        width: Math.round(widthPx),
        opacity,
        transform: `${baseTransform}translateY(${motionTranslateY.toFixed(2)}px) rotate(${motionRotateDeg.toFixed(2)}deg) scale(${enterScale.toFixed(4)})`,
        filter: 'drop-shadow(0 18px 32px rgba(0, 0, 0, 0.38))',
        zIndex: 2,
      }}
    >
      <Img
        src={resolvedSrc}
        onError={() => setFailed(true)}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          objectFit: 'contain',
        }}
      />
    </div>
  );
};
