import { BATCH_A } from './batchA';
import { BATCH_B } from './batchB';
import { BATCH_C } from './batchC';
import { BATCH_D } from './batchD';
import { BATCH_E } from './batchE';
import { BATCH_F } from './batchF';
import { BATCH_G } from './batchG';
import type { StyleDirectorDef } from './types';

function normalizeId(id?: string): string {
  return (id || '').trim().toLowerCase();
}

export const STYLE_DIRECTORS: Record<string, StyleDirectorDef> = {};

for (const def of [...BATCH_A, ...BATCH_B, ...BATCH_C, ...BATCH_D, ...BATCH_E, ...BATCH_F, ...BATCH_G]) {
  const key = normalizeId(def.styleId);
  if (key) {
    STYLE_DIRECTORS[key] = def;
  }
}

export function getStyleDirector(id?: string): StyleDirectorDef | undefined {
  const key = normalizeId(id);
  return key ? STYLE_DIRECTORS[key] : undefined;
}

export function hasStyleDirector(id?: string): boolean {
  return Boolean(getStyleDirector(id));
}

export function listStyleDirectorShots(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [styleId, def] of Object.entries(STYLE_DIRECTORS)) {
    const labels: Record<string, string> = {};
    for (const shotKey of Object.keys(def.shots)) {
      labels[shotKey] = def.shotLabels?.[shotKey] || shotKey;
    }
    out[styleId] = labels;
  }
  return out;
}
