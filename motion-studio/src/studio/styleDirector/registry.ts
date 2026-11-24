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
import { DATA_SHOT_LABELS, DATA_SHOTS } from './dataShots';
import type { StyleDirectorDef } from './types';

function normalizeId(id?: string): string {
  return (id || '').trim().toLowerCase();
}

function mergeKeepingExisting<T>(
  primary: Record<string, T> | undefined,
  extra: Record<string, T> | undefined,
): Record<string, T> {
  const merged: Record<string, T> = { ...(primary || {}) };
  if (!extra) return merged;
  for (const [k, v] of Object.entries(extra)) {
    if (!Object.prototype.hasOwnProperty.call(merged, k)) {
      merged[k] = v;
    }
  }
  return merged;
}

const _directors: Record<string, StyleDirectorDef> = {};
let _initialized = false;

/**
 * Lazily populate merged StyleDirector definitions so circular imports
 * (e.g. plan -> dataShots -> kit -> families -> registry) never read
 * uninitialized DATA_SHOTS or BATCH_* bindings at module evaluation time.
 */
function ensureInitialized(): Record<string, StyleDirectorDef> {
  if (_initialized) return _directors;

  const batches: ReadonlyArray<StyleDirectorDef[] | undefined> = [
    BATCH_A,
    BATCH_B,
    BATCH_C,
    BATCH_D,
    BATCH_E,
    BATCH_F,
    BATCH_G,
    BATCH_H,
    BATCH_I,
    BATCH_J,
    BATCH_K,
    BATCH_L,
    BATCH_M,
    BATCH_N,
    BATCH_O,
    BATCH_P,
    BATCH_Q,
    BATCH_R,
  ];

  const dataShots = DATA_SHOTS;
  const dataLabels = DATA_SHOT_LABELS;
  const ready = Boolean(dataShots && dataLabels && batches.every((b) => Array.isArray(b)));

  for (const batch of batches) {
    if (!Array.isArray(batch)) continue;
    for (const def of batch) {
      const key = normalizeId(def.styleId);
      if (key) {
        _directors[key] = {
          ...def,
          shots: mergeKeepingExisting(def.shots, dataShots),
          shotLabels: mergeKeepingExisting(def.shotLabels, dataLabels),
        };
      }
    }
  }

  if (ready) {
    _initialized = true;
  }
  return _directors;
}

export const STYLE_DIRECTORS: Record<string, StyleDirectorDef> = new Proxy(_directors, {
  get(_target, prop, receiver) {
    return Reflect.get(ensureInitialized(), prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(ensureInitialized(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(ensureInitialized());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(ensureInitialized(), prop);
  },
  set(_target, prop, value, receiver) {
    return Reflect.set(ensureInitialized(), prop, value, receiver);
  },
  deleteProperty(_target, prop) {
    return Reflect.deleteProperty(ensureInitialized(), prop);
  },
});

export function getStyleDirector(id?: string): StyleDirectorDef | undefined {
  const key = normalizeId(id);
  return key ? ensureInitialized()[key] : undefined;
}

export function hasStyleDirector(id?: string): boolean {
  return Boolean(getStyleDirector(id));
}

export function listStyleDirectorShots(): Record<string, Record<string, string>> {
  const directors = ensureInitialized();
  const out: Record<string, Record<string, string>> = {};
  for (const [styleId, def] of Object.entries(directors)) {
    const labels: Record<string, string> = {};
    for (const shotKey of Object.keys(def.shots)) {
      labels[shotKey] = def.shotLabels?.[shotKey] || shotKey;
    }
    out[styleId] = labels;
  }
  return out;
}
