import type { StudioScene } from '../types';
import type { StyleDirectorDef } from './types';

function readDirectedShot(scene: StudioScene): string {
  const raw = (scene as StudioScene & { direction?: { shot?: unknown } }).direction?.shot;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * Assign a concrete shot ID for every scene in a style-directed video.
 * Priority:
 *  1) scene.direction.shot (if defined in def.shots)
 *  2) def.infer(scene) (if defined in def.shots)
 *  3) least-used shot in Object.keys(def.shots) order
 * Never repeats the exact same shot on consecutive scenes (when >1 shot exists).
 */
export function pickStyleShots(def: StyleDirectorDef, scenes: StudioScene[]): string[] {
  const keys = Object.keys(def.shots);
  if (keys.length === 0) return scenes.map(() => '');

  const usage: Record<string, number> = {};
  const result: string[] = [];
  let prev: string | null = null;

  const hasKey = (k: string): boolean => Object.prototype.hasOwnProperty.call(def.shots, k);

  for (const scene of scenes) {
    const canRepeat = keys.length === 1;
    let chosen: string | null = null;

    const dirShot = readDirectedShot(scene);
    if (dirShot && hasKey(dirShot) && (canRepeat || dirShot !== prev)) {
      chosen = dirShot;
    }

    if (!chosen && def.infer) {
      const inferredRaw = def.infer(scene);
      const inferred = typeof inferredRaw === 'string' ? inferredRaw.trim().toLowerCase() : '';
      if (inferred && hasKey(inferred) && (canRepeat || inferred !== prev)) {
        chosen = inferred;
      }
    }

    if (!chosen) {
      const candidates = canRepeat ? keys : keys.filter((k) => k !== prev);
      candidates.sort((a, b) => (usage[a] || 0) - (usage[b] || 0) || keys.indexOf(a) - keys.indexOf(b));
      chosen = candidates[0] || keys[0];
    }

    usage[chosen] = (usage[chosen] || 0) + 1;
    prev = chosen;
    result.push(chosen);
  }

  return result;
}
