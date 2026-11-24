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
  /**
   * 0 = ใช้ช็อตนี้ครั้งแรก, 1+ = ใช้ซ้ำครั้งที่ n
   * ช็อตควรเปลี่ยนมุมกล้อง/สลับด้าน/จัดวางใหม่ตามค่านี้
   */
  variant?: number;
}

export interface StyleDirectorDef {
  styleId: string;
  shots: Record<string, React.FC<StyleShotArgs>>;
  shotLabels: Record<string, string>;
  infer?: (scene: StudioScene) => string | null;
  caption?: 'bar' | 'floating' | 'none';
}
