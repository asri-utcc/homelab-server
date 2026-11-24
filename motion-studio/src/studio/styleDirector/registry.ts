import { BATCH_A } from './batchA';
import { BATCH_B } from './batchB';
import { BATCH_C } from './batchC';
import { BATCH_D } from './batchD';
import { BATCH_E } from './batchE';
import { BATCH_F } from './batchF';
import { BATCH_G } from './batchG';
import { BATCH_H } from './batchH';
import { BATCH_I } from './batchI';
import { BATCH_J } from './batchJ';
import { BATCH_K } from './batchK';
import { BATCH_L } from './batchL';
import { BATCH_M } from './batchM';
import { BATCH_N } from './batchN';
import { BATCH_O } from './batchO';
import { BATCH_P } from './batchP';
import { BATCH_Q } from './batchQ';
import { BATCH_R } from './batchR';
import type { StyleDirectorDef } from './types';

function normalizeId(id?: string): string {
  return (id || '').trim().toLowerCase();
}

export const STYLE_DIRECTORS: Record<string, StyleDirectorDef> = {};

for (const def of [...BATCH_A, ...BATCH_B, ...BATCH_C, ...BATCH_D, ...BATCH_E, ...BATCH_F, ...BATCH_G, ...BATCH_H, ...BATCH_I, ...BATCH_J, ...BATCH_K, ...BATCH_L, ...BATCH_M, ...BATCH_N, ...BATCH_O, ...BATCH_P, ...BATCH_Q, ...BATCH_R]) {
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
