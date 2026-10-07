import { usesLegacyGeometry, type Area, type CityMesh, type Params } from '../types.ts';
import { EngineError } from '../util/errors.ts';
import { runAsync, runSync, type Steps } from '../util/steps.ts';
import { improvedHeightMapSteps } from './improved.ts';
import { legacyHeightMapSteps } from './legacy.ts';
import type { HeightmapOptions, HeightmapResult } from './result.ts';

export type { GridInfo, HeightmapOptions, HeightmapResult, SampledRect } from './result.ts';
export { estimateHeights, fitsTable, type HeightEstimate } from './estimate.ts';
export {
  areaCorners,
  areaSize,
  defaultArea,
  legacyAreaBox,
  mapScaleDenominator,
  physicalSizeCm,
} from './area.ts';

/** Parameter ranges of SPEC §7.3 (the core accepts slightly wider values than the UI offers). */
export const PARAM_LIMITS = {
  scale: [0.05, 500],
  maxHeight: [1, 1000],
  plates: [1, 64],
  exaggeration: [0.1, 10],
  cap: [1, 10000],
} as const;

export function validateParams(p: Params): void {
  const bad = (msg: string) => {
    throw new EngineError('invalid-params', msg);
  };
  const inRange = (v: number, [a, b]: readonly [number, number]) => Number.isFinite(v) && v >= a && v <= b;
  if (!inRange(p.scale, PARAM_LIMITS.scale))
    bad(`scale must be in [${PARAM_LIMITS.scale.join(', ')}] m/stud`);
  if (!inRange(p.maxHeight, PARAM_LIMITS.maxHeight)) bad('maxHeight out of range');
  for (const n of [p.platesX, p.platesY])
    if (!Number.isInteger(n) || !inRange(n, PARAM_LIMITS.plates)) bad('plates must be integers in [1, 64]');
  if (p.heightMode === 'exaggerated' && !inRange(p.exaggeration ?? 1, PARAM_LIMITS.exaggeration))
    bad('exaggeration out of range');
  if (
    p.cap !== undefined &&
    p.cap !== null &&
    (!Number.isInteger(p.cap) || !inRange(p.cap, PARAM_LIMITS.cap))
  )
    bad('cap must be a positive integer');
  if (!/^(corner-1|centre-1|supersample-[234])$/.test(p.sampling)) bad(`unknown sampling ${p.sampling}`);
  if (p.rotation !== 'aabb' && p.rotation !== 'rotate') bad(`unknown rotation mode ${String(p.rotation)}`);
}

/**
 * Generates the stud height matrix. Samples with the exact UD-Viz numerics when the geometric
 * options are the legacy ones (output identical to legonizer@1.1.0 when every option is legacy),
 * with the improved pipeline otherwise.
 */
export function generateHeightMap(
  mesh: CityMesh,
  area: Area,
  params: Params,
  opts: HeightmapOptions = {},
): HeightmapResult {
  return runSync(generateHeightMapSteps(mesh, area, params, opts));
}

/** Same, yielding to the event loop so `opts.signal` can cancel it (Worker). */
export function generateHeightMapAsync(
  mesh: CityMesh,
  area: Area,
  params: Params,
  opts: HeightmapOptions = {},
): Promise<HeightmapResult> {
  return runAsync(generateHeightMapSteps(mesh, area, params, opts), opts.signal);
}

export function generateHeightMapSteps(
  mesh: CityMesh,
  area: Area,
  params: Params,
  opts: HeightmapOptions = {},
): Steps<HeightmapResult> {
  validateParams(params);
  return usesLegacyGeometry(params)
    ? legacyHeightMapSteps(mesh, area, params, opts)
    : improvedHeightMapSteps(mesh, area, params, opts);
}
