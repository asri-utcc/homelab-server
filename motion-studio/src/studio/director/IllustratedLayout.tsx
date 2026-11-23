/**
 * IllustratedLayout — full-bleed hand-drawn scene renderer for doodle styles.
 * Replaces "static hero signature + data cards" with a per-scene staged shot.
 */
import React, { useMemo } from 'react';
import { useVideoConfig } from 'remotion';
import type { FamilySceneRendererProps } from '../families';
import { StudioScene } from '../types';
import { Caption, SHOT_COMPONENTS } from './shots';
import { DrawCtx, getDoodleTheme } from './doodleKit';
import { planAllScenes } from './plan';

export interface IllustratedLayoutProps extends FamilySceneRendererProps {
  allScenes?: StudioScene[];
}

export const IllustratedLayout: React.FC<IllustratedLayoutProps> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  styleId,
  allScenes,
}) => {
  const { fps } = useVideoConfig();
  const theme = getDoodleTheme(styleId)!;
  const scenes = allScenes && allScenes.length > sceneIndex ? allScenes : [scene];
  const plans = useMemo(() => planAllScenes(scenes), [scenes]);
  const plan = plans[Math.min(sceneIndex, plans.length - 1)] || planAllScenes([scene])[0];
  const isLast = allScenes ? sceneIndex === allScenes.length - 1 : false;
  // Lines "boil" (redrawn every 4 frames) — but freeze during the final hold of the video
  const frozen = isLast && localFrame > durationFrames - fps * 0.9;
  const seed = frozen ? 999 : Math.floor(localFrame / 4) + sceneIndex * 101;
  const ctx: DrawCtx = { theme, seed, t: localFrame, fps };
  const Shot = SHOT_COMPONENTS[plan.shot];

  // Gentle camera push-in; close-ups punch in from wider
  const p = Math.min(1, localFrame / Math.max(1, durationFrames));
  const punch = plan.shot === 'closeup' ? Math.max(0, 1 - localFrame / 10) * 0.12 : 0;
  const scale = 1 + p * 0.035 + punch;

  return (
    <div style={{ position: 'absolute', inset: 0, width: 1080, height: 1920, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${scale.toFixed(4)})`, transformOrigin: '50% 55%' }}>
        <Shot ctx={ctx} scene={scene} plan={plan} dur={durationFrames} />
      </div>
      <Caption ctx={ctx} scene={scene} />
    </div>
  );
};
