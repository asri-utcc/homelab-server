import React from 'react';
import {
  buildSacredProps,
  normalizeSkyMode,
  SacredStoryReel,
} from '../../templates/SacredStoryReel';
import type {
  SacredIconName,
  SacredScene,
  SacredSceneKind,
  SacredScriptInput,
  SacredStoryProps,
  SkyMode,
} from '../../templates/SacredStoryReel';
import scriptData from './script.json';

const rawScript = scriptData as unknown as SacredScriptInput;

export const DEFAULT_LAST_THIRD_PROPS: SacredStoryProps = buildSacredProps(rawScript, {
  defaultSkyMode: 'night',
});

const SCRIPT_SCENE_META = new Map<string, Partial<SacredScene>>();
for (const sc of DEFAULT_LAST_THIRD_PROPS.scenes) {
  SCRIPT_SCENE_META.set(sc.id, {
    kind: sc.kind as SacredSceneKind | undefined,
    icon: sc.icon as SacredIconName | undefined,
    source: sc.source,
    arabic: sc.arabic,
    arabicMeaning: sc.arabicMeaning,
    highlight: sc.highlight,
    statValue: sc.statValue,
    statPrefix: sc.statPrefix,
    statSuffix: sc.statSuffix,
    statLabel: sc.statLabel,
  });
}

export const LastThirdNight: React.FC<SacredStoryProps> = (props) => {
  const incomingScenes =
    props.scenes && props.scenes.length > 0 ? props.scenes : DEFAULT_LAST_THIRD_PROPS.scenes;

  // Merge optional visual metadata (kind, icon, highlight, stat*, source, arabic) from script.json
  // when rendering with a TTS timeline.json that omits custom scene fields.
  const mergedScenes: SacredScene[] = incomingScenes.map((sc) => {
    const meta = SCRIPT_SCENE_META.get(sc.id);
    if (!meta) return sc;
    return {
      ...sc,
      kind: sc.kind ?? meta.kind,
      icon: sc.icon ?? meta.icon,
      source: sc.source || meta.source,
      arabic: sc.arabic || meta.arabic,
      arabicMeaning: sc.arabicMeaning || meta.arabicMeaning,
      highlight: sc.highlight ?? meta.highlight,
      statValue: sc.statValue ?? meta.statValue,
      statPrefix: sc.statPrefix ?? meta.statPrefix,
      statSuffix: sc.statSuffix ?? meta.statSuffix,
      statLabel: sc.statLabel ?? meta.statLabel,
    };
  });

  const skyMode: SkyMode = normalizeSkyMode(
    props.skyMode ?? rawScript.skyMode,
    DEFAULT_LAST_THIRD_PROPS.skyMode ?? 'night',
  );

  return (
    <SacredStoryReel
      {...props}
      skyMode={skyMode}
      scenes={mergedScenes}
      cues={props.cues && props.cues.length > 0 ? props.cues : DEFAULT_LAST_THIRD_PROPS.cues}
    />
  );
};
