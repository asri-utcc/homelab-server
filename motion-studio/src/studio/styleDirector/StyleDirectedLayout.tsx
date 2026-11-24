import React, { useMemo } from 'react';
import { useVideoConfig } from 'remotion';
import type { FamilySceneRendererProps } from '../families';
import { hexToRgba, type StudioScene } from '../types';
import { STAGE_H, STAGE_W } from './kit';
import { planStyleShots } from './plan';
import { getStyleDirector } from './registry';
import { SceneArtLayer, pickArtLayout } from './SceneArtLayer';
import { DynamicMotionStage } from './DynamicMotionStage';

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

  const hasVector = Boolean(
    scene.vector &&
      Array.isArray(scene.vector.elements) &&
      scene.vector.elements.length > 0,
  );

  const art = scene.art;
  const isDataShot = activeShot.startsWith('data-');
  const artLayout = art?.src
    ? pickArtLayout(sceneIndex, variant, isDataShot, hasVector)
    : null;
  const isFramed = Boolean(artLayout && artLayout.shotScale < 1);

  const artNode =
    art?.src && artLayout ? (
      <SceneArtLayer
        art={art}
        layout={artLayout}
        sceneIndex={sceneIndex}
        variant={variant}
        isDataShot={isDataShot}
        isVectorStage={hasVector}
        localFrame={localFrame}
        durationFrames={durationFrames}
        fps={fps}
      />
    ) : null;

  const stageContent = (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `scale(${scale.toFixed(4)})`,
        transformOrigin,
      }}
    >
      {hasVector ? (
        <DynamicMotionStage
          scene={scene}
          sceneIndex={sceneIndex}
          localFrame={localFrame}
          durationFrames={durationFrames}
          fps={fps}
          tokens={tokens}
          styleId={styleId || def.styleId}
        />
      ) : (
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
      )}
    </div>
  );

  if (!isFramed || !artLayout) {
    return (
      <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
        {stageContent}
        {artNode}
      </div>
    );
  }

  const { palette, isLight, bgTreatment } = tokens;
  const backdropBase =
    bgTreatment === 'flat'
      ? palette.bg
      : `linear-gradient(165deg, ${palette.bg} 0%, ${palette.bg2} 100%)`;
  const accentWash = [
    `radial-gradient(ellipse 72% 48% at 78% 82%, ${hexToRgba(palette.accent, isLight ? 0.16 : 0.24)} 0%, transparent 72%)`,
    `radial-gradient(ellipse 64% 44% at 18% 72%, ${hexToRgba(palette.accent2, isLight ? 0.14 : 0.2)} 0%, transparent 72%)`,
  ].join(', ');

  const cardShadow = isLight
    ? `0 26px 68px rgba(15, 23, 42, 0.16), 0 0 0 2px ${hexToRgba(palette.border, 0.55)}`
    : `0 30px 80px rgba(0, 0, 0, 0.52), 0 0 0 2px ${hexToRgba(palette.accent, 0.22)}`;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      {/* Style-matched backdrop so space opened by the scaled shot card is never black */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: backdropBase,
        }}
      >
        {bgTreatment !== 'flat' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: accentWash,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* Scaled shot card wrapper (Ken-burns scale multiplies cleanly inside) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate3d(${artLayout.shotTranslate.x}px, ${artLayout.shotTranslate.y}px, 0) scale(${artLayout.shotScale.toFixed(4)})`,
          transformOrigin: artLayout.shotOrigin,
          borderRadius: 36,
          overflow: 'hidden',
          boxShadow: cardShadow,
          zIndex: 1,
        }}
      >
        {stageContent}
      </div>

      {artNode}
    </div>
  );
};
