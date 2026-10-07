/**
 * Legacy mode: bit-exact emulation of UD-Viz 4.6.1 `Legonizer.generateMockup` +
 * `MockUpUtils.createMockUpObject` + legonizer@1.1.0 `createHeightMapFromBufferGeometry`
 * (SPEC §3.1), except the area's vertical extent, which is unbounded (the UD-Viz box height is a
 * UI artefact; a box tall enough to contain the model behaves exactly like this).
 *
 * Numerics reproduced on purpose:
 * - area AABB of the rotated unit box, corners stored as float32 (BufferAttribute.applyMatrix4);
 * - selected features merged in world coordinates in a Float32Array (≈0.5 m resolution at
 *   Lyon's y ≈ 5.17e6 in EPSG:3946!), then shifted so that min z = 0 (float32 again);
 * - one ray per cell corner from z = maxZ, three r147 Mesh.raycast semantics: bounding-sphere
 *   and bounding-box pre-tests, front faces only, r147 ray/triangle algorithm, Euclidean distance;
 * - step = AABB width / 32 / platesX used for X and Y (L9); value = Math.trunc(h / (maxZ / maxHeight)).
 *
 * This pipeline runs whenever the geometric options are the legacy ones (usesLegacyGeometry); the
 * quantization options (height mode, rounding, keep small, cap) are then applied to the same
 * sampled heights, so e.g. "Legacy + keep small buildings" differs from Legacy only in the cells
 * whose height is below one brick.
 */
import { STUDS_PER_PLATE, isLegacy, type Area, type CityMesh, type Params } from '../types.ts';
import { throwIfAborted } from '../util/errors.ts';
import { runSync, type Steps } from '../util/steps.ts';
import {
  applyMatrix4To,
  legacyVerticalRayHitsBox,
  legacyVerticalRayHitsSphere,
  legacyVerticalRayTriangle,
} from '../util/threeCompat.ts';
import { BRICK_HEIGHT_IN_STUDS, areaCorners, legacyAreaBox, type Rect2 } from './area.ts';
import { KEEP_SMALL_MIN_HEIGHT } from './improved.ts';
import { getMeshIndex, type MeshIndex } from './meshIndex.ts';
import { VerticalCaster, ulpFloat32 } from './raycast.ts';
import { emptyHeightMap, makeSampledRect, type HeightmapOptions, type HeightmapResult } from './result.ts';
import { vertexIndex } from '../import/cityMesh.ts';

function intersectsXY(b: Float64Array, r: Rect2): boolean {
  // three Box3.intersectsBox (r154): touching boxes intersect
  return !(b[3]! < r.minX || b[0]! > r.maxX || b[4]! < r.minY || b[1]! > r.maxY);
}

/** UD-Viz feature selection: whole features (by gml_id) whose world box intersects the area AABB. */
export function legacySelection(mesh: CityMesh, idx: MeshIndex, box: Rect2): Uint8Array {
  const selected = new Uint8Array(mesh.features.length);
  for (const lb of idx.legacyBoxes) {
    if (mesh.features[lb.feature]!.legacyIgnored) continue;
    const declared = idx.partDeclaredWorld[lb.part];
    if (declared && !intersectsXY(declared, box)) continue; // potentialObjects pre-filter (mesh bbox)
    if (intersectsXY(lb.box, box)) selected[lb.feature] = 1;
  }
  return selected;
}

export function legacyHeightMap(
  mesh: CityMesh,
  area: Area,
  params: Params,
  opts: HeightmapOptions = {},
): HeightmapResult {
  return runSync(legacyHeightMapSteps(mesh, area, params, opts));
}

export function* legacyHeightMapSteps(
  mesh: CityMesh,
  area: Area,
  params: Params,
  opts: HeightmapOptions = {},
): Steps<HeightmapResult> {
  const t0 = performance.now();
  const idx = getMeshIndex(mesh);
  const cols = STUDS_PER_PLATE * params.platesX;
  const rows = STUDS_PER_PLATE * params.platesY;
  const box = legacyAreaBox(area, params);
  const step = (box.maxX - box.minX) / STUDS_PER_PLATE / params.platesX;
  const exact = isLegacy(params);
  const result: HeightmapResult = {
    heightMap: emptyHeightMap(cols, rows),
    legacy: exact,
    pipeline: 'legacy-geometry',
    grid: { originX: box.minX, originY: box.minY, stepX: step, stepY: step, rotation: 0, sampleOffset: 0 },
    sampledRect: makeSampledRect(
      box.minX,
      box.minY,
      cols * step,
      rows * step,
      0,
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
  if (area.rotationDeg % 360 !== 0) {
    // L3: the rotated box is replaced by its axis-aligned bounding box (SPEC A4: the UI says so)
    result.warnings.push('legacy-rotation-aabb');
  }

  const selected = legacySelection(mesh, idx, box);
  result.selection.features = selected.reduce((a, b) => a + b, 0);

  // Merged geometry in float32 world coordinates (MockUpUtils) and its bounding box.
  const selTris: number[] = [];
  const w = new Float64Array(3);
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let t = 0; t < idx.triCount; t++) {
    const f = idx.triFeature[t]!;
    if (f < 0 || !selected[f]) continue;
    selTris.push(t);
    const part = mesh.parts[idx.triPart[t]!]!;
    const pos = part.positions;
    for (let k = 0; k < 3; k++) {
      const v = vertexIndex(part, idx.triLocal[t]!, k);
      applyMatrix4To(part.matrix, pos[3 * v]!, pos[3 * v + 1]!, pos[3 * v + 2]!, w);
      const x = Math.fround(w[0]!),
        y = Math.fround(w[1]!),
        z = Math.fround(w[2]!);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  result.selection.triangles = selTris.length;
  result.timings.selectMs = performance.now() - t0;
  if (selTris.length === 0) {
    // legonizer on an empty geometry: no ray hits, every cell 0
    result.warnings.push('empty-selection');
    result.timings.totalMs = performance.now() - t0;
    return result;
  }
  const isSelectedTri = new Uint8Array(idx.triCount);
  for (const t of selTris) isSelectedTri[t] = 1;

  // z shift (float32): z' = fround(z − minZ); fround is monotonic so max z' = fround(maxZ − minZ)
  const maxZs = Math.fround(maxZ - minZ);
  const ratioZ = maxZs / params.maxHeight;
  // generalized quantization (non-legacy height mode / rounding / keep small / cap)
  const mpb =
    params.heightMode === 'normalized'
      ? ratioZ
      : (params.scale * BRICK_HEIGHT_IN_STUDS) /
        (params.heightMode === 'exaggerated' ? (params.exaggeration ?? 1) : 1);
  const cap = params.cap ?? Infinity;
  const quantize = (h: number): number => {
    if (exact) return Math.trunc(h / ratioZ);
    const v = h / mpb;
    let q =
      params.rounding === 'round' ? Math.round(v) : params.rounding === 'ceil' ? Math.ceil(v) : Math.trunc(v);
    if (params.keepSmall && q < 1 && h > KEEP_SMALL_MIN_HEIGHT) q = 1;
    return Math.max(0, Math.min(q, cap));
  };
  result.vertical = {
    zBase: minZ,
    heightRange: maxZs,
    metresPerBrick: mpb,
    maxValue: 0,
    builtStuds: 0,
    erasedStuds: 0,
  };
  let built = 0,
    erased = 0;
  if (maxZs === 0) {
    // legonizer would divide 0 by 0 and write "NaN" in every cell; we report it instead
    result.warnings.push('flat-geometry');
    result.timings.totalMs = performance.now() - t0;
    return result;
  }

  // Exact float32 coordinates of the selected triangles (shifted z), as legonizer's Float32Array.
  const coords = new Float64Array(selTris.length * 9);
  const slot = new Int32Array(idx.triCount).fill(-1);
  // Bounding sphere (computed by Mesh.raycast on the first ray): centre = box centre.
  const cx = (minX + maxX) * 0.5,
    cy = (minY + maxY) * 0.5,
    cz = (0 + maxZs) * 0.5;
  let maxR2 = 0;
  selTris.forEach((t, s) => {
    slot[t] = s;
    const part = mesh.parts[idx.triPart[t]!]!;
    const pos = part.positions;
    for (let k = 0; k < 3; k++) {
      const v = vertexIndex(part, idx.triLocal[t]!, k);
      applyMatrix4To(part.matrix, pos[3 * v]!, pos[3 * v + 1]!, pos[3 * v + 2]!, w);
      const x = Math.fround(w[0]!),
        y = Math.fround(w[1]!),
        z = Math.fround(Math.fround(w[2]!) - minZ);
      coords[s * 9 + k * 3] = x;
      coords[s * 9 + k * 3 + 1] = y;
      coords[s * 9 + k * 3 + 2] = z;
      const dx = cx - x,
        dy = cy - y,
        dz = cz - z;
      maxR2 = Math.max(maxR2, dx * dx + dy * dy + dz * dz);
    }
  });
  const radius = Math.sqrt(maxR2);

  const tb = performance.now();
  const caster = new VerticalCaster(mesh, idx, opts.useBvh !== false);
  result.timings.bvhMs = performance.now() - tb;

  // the exact test runs on float32-rounded world coordinates: widen the BVH culling accordingly
  const f32Tol =
    2 *
    ulpFloat32(
      Math.max(
        Math.abs(minX),
        Math.abs(maxX),
        Math.abs(minY),
        Math.abs(maxY),
        Math.abs(maxZ),
        Math.abs(minZ),
      ),
    );
  const tr = performance.now();
  const data = result.heightMap.data;
  const raw = opts.keepRaw ? new Float32Array(cols * rows) : undefined;
  let best = Infinity;
  let ox = 0,
    oy = 0;
  const oz = maxZs;
  const visit = (t: number) => {
    if (!isSelectedTri[t]) return;
    const s = slot[t]! * 9;
    const d = legacyVerticalRayTriangle(
      ox, oy, oz,
      coords[s]!, coords[s + 1]!, coords[s + 2]!,
      coords[s + 3]!, coords[s + 4]!, coords[s + 5]!,
      coords[s + 6]!, coords[s + 7]!, coords[s + 8]!,
    ); // prettier-ignore
    if (d >= 0 && d < best) best = d;
  };
  // prune BVH nodes entirely below the best hit (world z = shifted z + minZ)
  const pruneBelow = () => (best === Infinity ? -Infinity : oz - best + minZ);
  let maxValue = 0;
  for (let j = 0; j < rows; j++) {
    if ((j & 3) === 0) {
      throwIfAborted(opts.signal);
      opts.progress?.('heightmap', j / rows);
      yield j / rows;
    }
    for (let i = 0; i < cols; i++) {
      ox = box.minX + i * step;
      oy = box.minY + j * step;
      best = Infinity;
      if (
        legacyVerticalRayHitsSphere(ox, oy, oz, cx, cy, cz, radius) &&
        legacyVerticalRayHitsBox(ox, oy, oz, minX, minY, 0, maxX, maxY, maxZs)
      ) {
        caster.query(ox, oy, visit, pruneBelow, f32Tol);
      }
      const h = best === Infinity ? 0 : oz - best;
      const value = quantize(h);
      if (h > KEEP_SMALL_MIN_HEIGHT) {
        built++;
        if (value === 0) erased++;
      }
      data[j * cols + i] = value;
      if (raw) raw[j * cols + i] = h;
      if (value > maxValue) maxValue = value;
    }
  }
  opts.progress?.('heightmap', 1);
  result.vertical.maxValue = maxValue;
  result.vertical.builtStuds = built;
  result.vertical.erasedStuds = erased;
  if (raw) result.raw = raw;
  result.timings.raycastMs = performance.now() - tr;
  result.timings.totalMs = performance.now() - t0;
  return result;
}
