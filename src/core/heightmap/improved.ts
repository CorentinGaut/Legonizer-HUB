/**
 * Improved pipeline (any geometric option differing from the legacy preset, SPEC §7.3):
 * - `rotation: 'rotate'`: the sampling grid follows the rotated area (A4), step = scale in both
 *   directions (fixes L3, L9); `rotation: 'aabb'`: legacy area semantics (axis-aligned bounding box
 *   of the rotated area, square step = AABB width / columns, L3 + L9 kept), in float64;
 * - float64 coordinates relative to the area centre (no float32 world coordinates);
 * - double-sided hits, highest surface wins (robust to inconsistent winding in OBJ / CityJSON);
 * - height reference `lowest-base` (legacy) or `ground` (terrain under the sample when the model
 *   has terrain surfaces, otherwise the base of the hit feature: its GroundSurface or lowest point);
 * - sampling corner / centre / N×N supersampling with max, mean or median aggregation;
 * - height modes normalized / true-scale / exaggerated, rounding, keep-small and cap.
 */
import {
  SurfaceClass,
  STUDS_PER_PLATE,
  type Aggregate,
  type Area,
  type CityMesh,
  type Params,
} from '../types.ts';
import { throwIfAborted } from '../util/errors.ts';
import { runSync, type Steps } from '../util/steps.ts';
import {
  BRICK_HEIGHT_IN_STUDS,
  aabbIntersectsOrientedRect,
  areaCorners,
  orientedRect,
  type OrientedRect,
} from './area.ts';
import { clippedZRange } from './clip.ts';
import { getMeshIndex, worldVertex } from './meshIndex.ts';
import { VerticalCaster } from './raycast.ts';
import { emptyHeightMap, makeSampledRect, type HeightmapOptions, type HeightmapResult } from './result.ts';

/** Below this height (metres) a sample counts as empty for "keep small buildings". */
export const KEEP_SMALL_MIN_HEIGHT = 0.01;
const EDGE_EPS = 1e-9;
const QUANT_EPS = 1e-9;

export function samplesPerAxis(sampling: Params['sampling']): number {
  const m = /^supersample-(\d)$/.exec(sampling);
  return m ? Number(m[1]) : 1;
}

export function quantize(h: number, metresPerBrick: number, p: Params): number {
  if (!(h > 0) || !(metresPerBrick > 0)) return 0;
  const v = h / metresPerBrick;
  let q =
    p.rounding === 'round'
      ? Math.round(v)
      : p.rounding === 'ceil'
        ? Math.ceil(v - QUANT_EPS)
        : Math.trunc(v + QUANT_EPS);
  if (p.keepSmall && q < 1 && h > KEEP_SMALL_MIN_HEIGHT) q = 1;
  if (p.cap !== undefined && p.cap !== null && q > p.cap) q = p.cap;
  return Math.max(0, q);
}

function aggregate(values: Float64Array, n: number, mode: Aggregate): number {
  if (n === 1) return values[0]!;
  if (mode === 'max') {
    let m = 0;
    for (let k = 0; k < n; k++) if (values[k]! > m) m = values[k]!;
    return m;
  }
  if (mode === 'mean') {
    let s = 0;
    for (let k = 0; k < n; k++) s += values[k]!;
    return s / n;
  }
  const sorted = Array.from(values.subarray(0, n)).sort((a, b) => a - b);
  return n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

export function improvedHeightMap(
  mesh: CityMesh,
  area: Area,
  params: Params,
  opts: HeightmapOptions = {},
): HeightmapResult {
  return runSync(improvedHeightMapSteps(mesh, area, params, opts));
}

export function* improvedHeightMapSteps(
  mesh: CityMesh,
  area: Area,
  params: Params,
  opts: HeightmapOptions = {},
): Steps<HeightmapResult> {
  const t0 = performance.now();
  const idx = getMeshIndex(mesh);
  const cols = STUDS_PER_PLATE * params.platesX;
  const rows = STUDS_PER_PLATE * params.platesY;
  const O = [area.cx, area.cy] as const;
  // Selection / clip rectangle and sampling grid (relative to the area centre O)
  let rect: OrientedRect;
  let s: number; // cell size
  let originU: number, originV: number; // grid south-west corner in the grid frame
  if (params.rotation === 'rotate') {
    rect = orientedRect(area, params);
    s = params.scale;
    originU = -rect.halfW;
    originV = -rect.halfH;
  } else {
    const r = orientedRect(area, params);
    const ac = Math.abs(r.cos),
      as = Math.abs(r.sin);
    rect = { halfW: ac * r.halfW + as * r.halfH, halfH: as * r.halfW + ac * r.halfH, cos: 1, sin: 0 };
    s = (2 * rect.halfW) / cols; // square cells from the X extent, like legacy (L9)
    originU = -rect.halfW;
    originV = -rect.halfH;
  }
  const gridCos = rect.cos,
    gridSin = rect.sin;
  const ground = params.heightRef === 'ground';
  const nSub = samplesPerAxis(params.sampling);
  const offset = params.sampling === 'corner-1' ? 0 : 0.5;
  const agg: Aggregate = params.aggregate ?? 'median';

  const gridOriginX = O[0] + originU * gridCos - originV * gridSin;
  const gridOriginY = O[1] + originU * gridSin + originV * gridCos;
  const gridRotation = params.rotation === 'rotate' ? (area.rotationDeg * Math.PI) / 180 : 0;
  const result: HeightmapResult = {
    heightMap: emptyHeightMap(cols, rows),
    legacy: false,
    pipeline: 'improved',
    grid: {
      originX: gridOriginX,
      originY: gridOriginY,
      stepX: s,
      stepY: s,
      rotation: gridRotation,
      sampleOffset: offset,
    },
    sampledRect: makeSampledRect(
      gridOriginX,
      gridOriginY,
      cols * s,
      rows * s,
      gridRotation,
      areaCorners(area, params),
      0.1 * params.scale,
    ),
    vertical: {
      zBase: NaN,
      heightRange: NaN,
      metresPerBrick: NaN,
      maxValue: 0,
      builtStuds: 0,
      erasedStuds: 0,
    },
    selection: { features: 0, triangles: 0 },
    warnings: [],
    timings: { selectMs: 0, bvhMs: 0, raycastMs: 0, totalMs: 0 },
  };

  // 1. Features touching the (rotated) area.
  const nf = mesh.features.length;
  const selected = new Uint8Array(nf);
  const fb = idx.featureBox;
  for (let f = 0; f < nf; f++) {
    const b = f * 6;
    if (
      aabbIntersectsOrientedRect(fb[b]! - O[0], fb[b + 1]! - O[1], fb[b + 3]! - O[0], fb[b + 4]! - O[1], rect)
    )
      selected[f] = 1;
  }
  result.selection.features = selected.reduce((a, b) => a + b, 0);

  // 2. Selected triangles, relative coordinates (float64), building / terrain roles.
  const slot = new Int32Array(idx.triCount).fill(-1);
  const role = new Uint8Array(idx.triCount); // 1 building, 2 terrain
  const sel: number[] = [];
  let hasTerrain = false;
  for (let t = 0; t < idx.triCount; t++) {
    const f = idx.triFeature[t]!;
    if (f < 0 || !selected[f]) continue;
    const terrain = idx.triClass[t] === SurfaceClass.Terrain;
    role[t] = ground && terrain ? 2 : 1;
    if (role[t] === 2) hasTerrain = true;
    slot[t] = sel.length;
    sel.push(t);
  }
  result.selection.triangles = sel.length;
  const coords = new Float64Array(sel.length * 9);
  const w = new Float64Array(3);
  sel.forEach((t, k) => {
    for (let v = 0; v < 3; v++) {
      worldVertex(mesh, idx, t, v, w);
      coords[k * 9 + v * 3] = w[0]! - O[0];
      coords[k * 9 + v * 3 + 1] = w[1]! - O[1];
      coords[k * 9 + v * 3 + 2] = w[2]!;
    }
  });

  // 3. Vertical reference and range (lowest-base).
  let zBase = Infinity,
    zTop = -Infinity;
  if (params.selection === 'clip') {
    for (let k = 0; k < sel.length; k++) {
      if (role[sel[k]!] !== 1) continue;
      const r = clippedZRange(coords.subarray(k * 9, k * 9 + 9), rect);
      if (r) {
        zBase = Math.min(zBase, r[0]);
        zTop = Math.max(zTop, r[1]);
      }
    }
  } else {
    for (let f = 0; f < nf; f++) {
      if (!selected[f] || (ground && mesh.features[f]!.terrain)) continue;
      zBase = Math.min(zBase, fb[f * 6 + 2]!);
      zTop = Math.max(zTop, fb[f * 6 + 5]!);
    }
  }
  result.timings.selectMs = performance.now() - t0;
  if (sel.length === 0 || zBase === Infinity) {
    result.warnings.push('empty-selection');
    result.timings.totalMs = performance.now() - t0;
    return result;
  }

  const tb = performance.now();
  const caster = new VerticalCaster(mesh, idx, opts.useBvh !== false);
  result.timings.bvhMs = performance.now() - tb;

  // 4. Sampling.
  const tr = performance.now();
  let px = 0,
    py = 0;
  let bestB: number, bestT: number, bestTri: number; // reset before every sample
  const visit = (t: number) => {
    const r = role[t]!;
    if (!r) return;
    const k = slot[t]! * 9;
    const ax = coords[k]!,
      ay = coords[k + 1]!,
      az = coords[k + 2]!;
    const e1x = coords[k + 3]! - ax,
      e1y = coords[k + 4]! - ay,
      e2x = coords[k + 6]! - ax,
      e2y = coords[k + 7]! - ay;
    const d = e1x * e2y - e1y * e2x;
    if (d === 0) return; // vertical or degenerate
    const qx = px - ax,
      qy = py - ay;
    const w1 = (qx * e2y - qy * e2x) / d;
    const w2 = (e1x * qy - e1y * qx) / d;
    if (w1 < -EDGE_EPS || w2 < -EDGE_EPS || w1 + w2 > 1 + EDGE_EPS) return;
    const z = az + w1 * (coords[k + 5]! - az) + w2 * (coords[k + 8]! - az);
    if (r === 1) {
      if (z > bestB) {
        bestB = z;
        bestTri = t;
      }
    } else if (z > bestT) bestT = z;
  };
  const pruneBelow = () => (hasTerrain ? Math.min(bestB, bestT) : bestB);
  const featureBase = (f: number) => {
    const g = idx.featureGroundZ[f]!;
    return Number.isFinite(g) ? g : fb[f * 6 + 2]!;
  };
  const sub = new Float64Array(nSub * nSub);
  const rawH = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    if ((j & 3) === 0) {
      throwIfAborted(opts.signal);
      opts.progress?.('heightmap', j / rows);
      yield j / rows;
    }
    for (let i = 0; i < cols; i++) {
      let n = 0;
      for (let b = 0; b < nSub; b++) {
        for (let a = 0; a < nSub; a++) {
          const u = originU + (i + (nSub === 1 ? offset : (a + 0.5) / nSub)) * s;
          const v = originV + (j + (nSub === 1 ? offset : (b + 0.5) / nSub)) * s;
          px = u * gridCos - v * gridSin;
          py = u * gridSin + v * gridCos;
          bestB = -Infinity;
          bestT = -Infinity;
          bestTri = -1;
          caster.query(px + O[0], py + O[1], visit, pruneBelow);
          let h = 0;
          if (bestTri >= 0) {
            if (!ground) h = bestB - zBase;
            else {
              const base = hasTerrain && bestT > -Infinity ? bestT : featureBase(idx.triFeature[bestTri]!);
              h = bestB - base;
            }
          }
          sub[n++] = h > 0 ? h : 0;
        }
      }
      rawH[j * cols + i] = aggregate(sub, n, agg);
    }
  }
  opts.progress?.('heightmap', 1);

  // 5. Vertical scale and quantization.
  let metresPerBrick: number;
  let heightRange = NaN;
  if (params.heightMode === 'normalized') {
    if (ground) {
      heightRange = 0;
      for (const h of rawH) if (h > heightRange) heightRange = h;
    } else heightRange = zTop - zBase;
    metresPerBrick = heightRange / params.maxHeight;
  } else {
    const factor = params.heightMode === 'exaggerated' ? (params.exaggeration ?? 1) : 1;
    metresPerBrick = (s * BRICK_HEIGHT_IN_STUDS) / factor;
  }
  result.vertical = {
    zBase: ground ? NaN : zBase,
    heightRange,
    metresPerBrick,
    maxValue: 0,
    builtStuds: 0,
    erasedStuds: 0,
  };
  if (!(metresPerBrick > 0)) result.warnings.push('flat-geometry');
  const data = result.heightMap.data;
  let maxValue = 0;
  for (let c = 0; c < data.length; c++) {
    const q = quantize(rawH[c]!, metresPerBrick, params);
    if (rawH[c]! > KEEP_SMALL_MIN_HEIGHT) {
      result.vertical.builtStuds++;
      if (q === 0) result.vertical.erasedStuds++;
    }
    data[c] = q;
    if (q > maxValue) maxValue = q;
  }
  result.vertical.maxValue = maxValue;
  if (opts.keepRaw) result.raw = Float32Array.from(rawH);
  result.timings.raycastMs = performance.now() - tr;
  result.timings.totalMs = performance.now() - t0;
  return result;
}
