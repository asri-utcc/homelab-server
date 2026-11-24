import React, { useMemo } from 'react';
import { useVideoConfig } from 'remotion';
import type { FamilySceneRendererProps } from '../families';
import type { StudioScene } from '../types';
import { STAGE_H, STAGE_W } from './kit';
import { planStyleShots } from './plan';
import { getStyleDirector } from './registry';
import { SceneArtLayer, pickArtSlot } from './SceneArtLayer';

export interface StyleDirectedLayoutProps extends FamilySceneRendererProps {
  allScenes?: StudioScene[];
}

const ODD_VARIANT_ORIGINS = ['32% 38%', '68% 42%', '36% 62%', '64% 36%'] as const;

export const StyleDirectedLayout: React.FC<StyleDirectedLayoutProps> = ({
  scene,
  sceneIndex,
  tokens,
  localFrame,
  durationFrames,
  styleId,
  allScenes,
}) => {
  const { fps } = useVideoConfig();
  const def = getStyleDirector(styleId);
  const scenes = allScenes && allScenes.length > sceneIndex ? allScenes : [scene];

  const shotPlan = useMemo(() => (def ? planStyleShots(def, scenes) : []), [def, scenes]);

  if (!def) return null;

  const shotKeys = Object.keys(def.shots);
  const fallbackShot = shotKeys[0] || '';
  const planned = shotPlan[Math.min(sceneIndex, Math.max(0, shotPlan.length - 1))];
  const plannedShot = planned?.shot || fallbackShot;
  const hasPlannedShot = Boolean(def.shots[plannedShot]);
  const activeShot = hasPlannedShot ? plannedShot : fallbackShot;
  const variant = hasPlannedShot ? (planned?.variant ?? 0) : 0;
  const ShotComponent = def.shots[activeShot];

  if (!ShotComponent) return null;

  const p = Math.min(1, Math.max(0, localFrame / Math.max(1, durationFrames)));
  const isOddVariant = variant % 2 === 1;
  const scale = isOddVariant ? 1.03 - p * 0.03 : 1 + p * 0.03;
  const transformOrigin = isOddVariant
    ? ODD_VARIANT_ORIGINS[Math.floor(variant / 2) % ODD_VARIANT_ORIGINS.length]
    : '50% 50%';

  const art = scene.art;
  const isDataShot = activeShot.startsWith('data-');
  const artSlot = art?.src ? pickArtSlot(sceneIndex, variant, isDataShot) : null;
  const artNode =
    art?.src && artSlot ? (
      <SceneArtLayer
        art={art}
        sceneIndex={sceneIndex}
        variant={variant}
        isDataShot={isDataShot}
        localFrame={localFrame}
        durationFrames={durationFrames}
        fps={fps}
      />
    ) : null;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${scale.toFixed(4)})`,
          transformOrigin,
        }}
      >
        <ShotComponent
          scene={scene}
          sceneIndex={sceneIndex}
          localFrame={localFrame}
          durationFrames={durationFrames}
          fps={fps}
          tokens={tokens}
          styleId={styleId || def.styleId}
          shot={activeShot}
          variant={variant}
        />
      </div>
      {artNode}
    </div>
  );
};
