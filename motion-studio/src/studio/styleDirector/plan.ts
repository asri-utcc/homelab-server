import type { StudioScene } from '../types';
import { dataShotForScene } from './dataShots';
import type { StyleDirectorDef } from './types';

export interface PlannedStyleShot {
  shot: string;
  variant: number;
}

const DATA_PREFIX = 'data-';

function isDataShot(shotKey: string): boolean {
  return shotKey.startsWith(DATA_PREFIX);
}

function normalizeShotKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function readDirectedShot(scene: StudioScene): string {
  const raw = (scene as StudioScene & { direction?: { shot?: unknown } }).direction?.shot;
  return normalizeShotKey(raw);
}

function resolveKey(raw: unknown, keyByLower: Map<string, string>): string {
  const norm = normalizeShotKey(raw);
  return norm ? keyByLower.get(norm) || '' : '';
}

function pickFirstPreferUnclaimed(candidates: string[], claimed: Set<string>): string | null {
  if (candidates.length === 0) return null;
  for (const k of candidates) {
    if (!claimed.has(k)) return k;
  }
  return candidates[0];
}

/**
 * Plan concrete shot IDs and repeat variant indices for every scene in a style-directed video.
 *
 * Rules (100% deterministic):
 *  (a) Budget: never repeat a shot until every available shot key has been used in the current round
 *      (chosen shot always has usage === minUsage across all keys).
 *  (b) Candidate priority within the eligible pool:
 *      direction.shot -> def.infer(scene) -> dataShotForScene(scene)
 *      -> unused style-specific shot (non-'data-*') -> unused data shot ('data-*') -> least-used shot.
 *  (c) Never repeat the exact same shot on consecutive scenes when >1 shot exists.
 *  (d) Prefer style-specific shots (non-'data-*') on the first (hook) and last (outro) scenes
 *      whenever any style-specific shot remains in budget.
 *  (e) Spread data shots so 'data-*' never appears on >2 consecutive scenes when style shots allow,
 *      with deterministic pacing so style shots are not exhausted too early in a round.
 *  (f) variant = number of times the chosen shot was already used in earlier scenes (0 on first use).
 */
export function planStyleShots(
  def: StyleDirectorDef,
  scenes: StudioScene[],
): PlannedStyleShot[] {
  const keys = Object.keys(def.shots);
  if (scenes.length === 0) return [];
  if (keys.length === 0) return scenes.map(() => ({ shot: '', variant: 0 }));

  const keyByLower = new Map<string, string>();
  for (const k of keys) {
    keyByLower.set(k.toLowerCase(), k);
  }

  // Precompute per-scene hints deterministically (once per scene).
  const directedKeys = scenes.map((scene) => resolveKey(readDirectedShot(scene), keyByLower));
  const inferredKeys = scenes.map((scene) =>
    def.infer ? resolveKey(def.infer(scene), keyByLower) : '',
  );
  const dataKeys = scenes.map((scene) => resolveKey(dataShotForScene(scene), keyByLower));

  const usage: Record<string, number> = {};
  for (const k of keys) {
    usage[k] = 0;
  }

  const result: PlannedStyleShot[] = [];
  let prev: string | null = null;
  let consecutiveData = 0;

  for (let i = 0; i < scenes.length; i++) {
    // (a) Budget pool: only keys at current minimum usage.
    let minUsage = Infinity;
    for (const k of keys) {
      if (usage[k] < minUsage) minUsage = usage[k];
    }
    const budgetKeys = keys.filter((k) => usage[k] === minUsage);

    // (c) Never repeat consecutive shots when >1 key exists.
    const eligible =
      keys.length > 1 ? budgetKeys.filter((k) => k !== prev) : budgetKeys;
    const basePool = eligible.length > 0 ? eligible : budgetKeys;

    const eligibleStyle = basePool.filter((k) => !isDataShot(k));
    const eligibleData = basePool.filter((k) => isDataShot(k));

    const isFirstOrLast = i === 0 || (scenes.length > 1 && i === scenes.length - 1);

    // Pacing check: prevent exhausting style shots too early in a round, which would
    // force >2 consecutive data shots or leave no style shot for the outro.
    const budgetStyleCount = budgetKeys.filter((k) => !isDataShot(k)).length;
    const scenesLeftAfter = scenes.length - 1 - i;
    const roundLeftAfter = budgetKeys.length - 1;
    const outroInThisRound = scenesLeftAfter > 0 && scenesLeftAfter <= roundLeftAfter;
    const styleAfterIfPickStyle = budgetStyleCount - 1;
    const remainingInRoundAndVideo = Math.min(scenesLeftAfter, roundLeftAfter);
    const minDataNeededAfter = Math.max(0, remainingInRoundAndVideo - styleAfterIfPickStyle);
    const maxDataCapacityAfter = outroInThisRound
      ? 2 * styleAfterIfPickStyle
      : 2 * (styleAfterIfPickStyle + 1);
    const mustPickDataForPacing =
      !isFirstOrLast &&
      consecutiveData < 2 &&
      eligibleStyle.length > 0 &&
      eligibleData.length > 0 &&
      minDataNeededAfter > maxDataCapacityAfter;

    // Effective pool enforcing (d) hook/outro and (e) max-2 consecutive data shots.
    let pool: string[];
    if (isFirstOrLast && eligibleStyle.length > 0) {
      pool = eligibleStyle;
    } else if (consecutiveData >= 2 && eligibleStyle.length > 0) {
      pool = eligibleStyle;
    } else if (mustPickDataForPacing) {
      pool = eligibleData;
    } else {
      pool = basePool;
    }

    const poolSet = new Set(pool);
    const poolStyle = pool.filter((k) => !isDataShot(k));
    const poolData = pool.filter((k) => isDataShot(k));

    // (b) Priority order:
    // 1. direction.shot -> 2. def.infer -> 3. dataShotForScene
    let chosen: string | null = null;
    const dirKey = directedKeys[i];
    if (dirKey && poolSet.has(dirKey)) {
      chosen = dirKey;
    }

    if (!chosen) {
      const inferKey = inferredKeys[i];
      if (inferKey && poolSet.has(inferKey)) {
        chosen = inferKey;
      }
    }

    if (!chosen) {
      const dataKey = dataKeys[i];
      if (dataKey && poolSet.has(dataKey)) {
        chosen = dataKey;
      }
    }

    // 4. Unused style-specific shot -> 5. Unused data shot -> 6. Least-used shot
    if (!chosen && (poolStyle.length > 0 || poolData.length > 0)) {
      const lookaheadEnd = Math.min(scenes.length - 1, i + roundLeftAfter);
      if (poolStyle.length > 0) {
        const futureStyleClaims = new Set<string>();
        for (let j = i + 1; j <= lookaheadEnd; j++) {
          if (directedKeys[j] && !isDataShot(directedKeys[j])) {
            futureStyleClaims.add(directedKeys[j]);
          }
          if (inferredKeys[j] && !isDataShot(inferredKeys[j])) {
            futureStyleClaims.add(inferredKeys[j]);
          }
        }
        chosen = pickFirstPreferUnclaimed(poolStyle, futureStyleClaims);
      }

      if (!chosen && poolData.length > 0) {
        const futureDataClaims = new Set<string>();
        for (let j = i + 1; j <= lookaheadEnd; j++) {
          const isOutroWithStyleAvailable =
            j === scenes.length - 1 && scenes.length > 1 && budgetStyleCount > 0;
          if (isOutroWithStyleAvailable) continue;
          if (directedKeys[j] && isDataShot(directedKeys[j])) {
            futureDataClaims.add(directedKeys[j]);
          }
          if (dataKeys[j] && isDataShot(dataKeys[j])) {
            futureDataClaims.add(dataKeys[j]);
          }
        }
        chosen = pickFirstPreferUnclaimed(poolData, futureDataClaims);
      }
    }

    if (!chosen) {
      const leastUsed = [...pool].sort(
        (a, b) => (usage[a] || 0) - (usage[b] || 0) || keys.indexOf(a) - keys.indexOf(b),
      );
      chosen = leastUsed[0] || keys[0];
    }

    // (f) variant = count of prior uses of this shot.
    const variant = usage[chosen] || 0;
    usage[chosen] = variant + 1;
    prev = chosen;
    consecutiveData = isDataShot(chosen) ? consecutiveData + 1 : 0;

    result.push({ shot: chosen, variant });
  }

  return result;
}

/**
 * Backward-compatible wrapper returning only the planned shot IDs.
 */
export function pickStyleShots(def: StyleDirectorDef, scenes: StudioScene[]): string[] {
  return planStyleShots(def, scenes).map((entry) => entry.shot);
}
