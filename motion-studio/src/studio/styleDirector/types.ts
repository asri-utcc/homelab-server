import React from 'react';
import type { StudioScene } from '../types';

export interface StyleShotArgs {
  scene: StudioScene;
  sceneIndex: number;
  localFrame: number;
  durationFrames: number;
  fps: number;
  tokens: any;
  styleId: string;
  shot: string;
}

export interface StyleDirectorDef {
  styleId: string;
  shots: Record<string, React.FC<StyleShotArgs>>;
  shotLabels: Record<string, string>;
  infer?: (scene: StudioScene) => string | null;
  caption?: 'bar' | 'floating' | 'none';
}
