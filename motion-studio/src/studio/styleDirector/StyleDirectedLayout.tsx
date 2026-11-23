import React, { useMemo } from 'react';
import { useVideoConfig } from 'remotion';
import type { FamilySceneRendererProps } from '../families';
import type { StudioScene } from '../types';
import { STAGE_H, STAGE_W } from './kit';
import { pickStyleShots } from './plan';
import { getStyleDirector } from './registry';

export interface StyleDirectedLayoutProps extends FamilySceneRendererProps {
  allScenes?: StudioScene[];
}

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

  const shotPlan = useMemo(() => (def ? pickStyleShots(def, scenes) : []), [def, scenes]);

  if (!def) return null;

  const shotKeys = Object.keys(def.shots);
  const fallbackShot = shotKeys[0] || '';
  const plannedShot = shotPlan[Math.min(sceneIndex, Math.max(0, shotPlan.length - 1))] || fallbackShot;
  const activeShot = def.shots[plannedShot] ? plannedShot : fallbackShot;
  const ShotComponent = def.shots[activeShot];

  if (!ShotComponent) return null;

  const p = Math.min(1, Math.max(0, localFrame / Math.max(1, durationFrames)));
  const scale = 1 + p * 0.03;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${scale.toFixed(4)})`,
          transformOrigin: '50% 50%',
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
        />
      </div>
    </div>
  );
};
