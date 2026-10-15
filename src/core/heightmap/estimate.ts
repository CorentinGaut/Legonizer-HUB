/**
 * Cheap live feedback before generation (SPEC §7.3, A5): estimated max height in bricks and cm,
 * stud count, physical size, map scale, table fit and the share of selected features that the
 * chosen vertical scale erases (below one brick) — the L1 warning.
 */
import {
  STUDS_PER_PLATE,
  isLegacy,
  usesLegacyGeometry,
  type Area,
  type CityMesh,
  type Params,
} from '../types.ts';
import {
  BRICK_HEIGHT_IN_STUDS,
  BRICK_HEIGHT_MM,
  aabbIntersectsOrientedRect,
  legacyAreaBox,
  mapScaleDenominator,
  orientedRect,
  physicalSizeCm,
} from './area.ts';
import { legacySelection } from './legacy.ts';
import { getMeshIndex } from './meshIndex.ts';
import { quantize } from './improved.ts';

/** The Legonizer table is 1 × 2 m: up to 3 × 7 baseplates (25.6 cm), leaving room for projected media. */
export const TABLE_MAX_PLATES: [number, number] = [3, 7];

export interface HeightEstimate {
  cols: number;
  rows: number;
  studs: number;
  widthCm: number;
  depthCm: number;
  mapScale: number;
  fitsTable: boolean;
  metresPerBrick: number;
  maxBricks: number;
  maxHeightCm: number;
  features: number;
  featuresBelowOneBrick: number;
  shareBelowOneBrick: number;
  /** Selected feature indices (into CityMesh.features), their height above the reference (m). */
  selected: Uint32Array;
  selectedHeights: Float64Array;
  /** Selected features lower than one brick (they disappear, L1). */
  below: Uint32Array;
  /** World XY boxes of the selected features (minX, minY, maxX, maxY per feature, same order). */
  selectedBoxes: Float64Array;
  /** Tallest selected feature (sets the vertical scale in normalized mode, L2), or -1. */
  tallest: number;
  /** Height reference (world z) for `lowest-base`; NaN for `ground`. */
  zBase: number;
}

export function fitsTable(platesX: number, platesY: number): boolean {
  const [a, b] = TABLE_MAX_PLATES;
  return (platesX <= a && platesY <= b) || (platesX <= b && platesY <= a);
}

export function estimateHeights(mesh: CityMesh, area: Area, params: Params): HeightEstimate {
  const idx = getMeshIndex(mesh);
  const fb = idx.featureBox;
  const nf = mesh.features.length;
  let selected: Uint8Array;
  if (usesLegacyGeometry(params)) selected = legacySelection(mesh, idx, legacyAreaBox(area, params));
  else {
    const r0 = orientedRect(area, params);
    const ac = Math.abs(r0.cos),
      as = Math.abs(r0.sin);
    const rect =
      params.rotation === 'rotate'
        ? r0
        : { halfW: ac * r0.halfW + as * r0.halfH, halfH: as * r0.halfW + ac * r0.halfH, cos: 1, sin: 0 };
    selected = new Uint8Array(nf);
    for (let f = 0; f < nf; f++) {
      const b = f * 6;
      if (
        aabbIntersectsOrientedRect(
          fb[b]! - area.cx,
          fb[b + 1]! - area.cy,
          fb[b + 3]! - area.cx,
          fb[b + 4]! - area.cy,
          rect,
        )
      )
        selected[f] = 1;
    }
  }
  const ground = params.heightRef === 'ground';
  let zBase = Infinity,
    zTop = -Infinity,
    maxOwn = 0,
    count = 0;
  const base = (f: number) =>
    Number.isFinite(idx.featureGroundZ[f]!) ? idx.featureGroundZ[f]! : fb[f * 6 + 2]!;
  for (let f = 0; f < nf; f++) {
    if (!selected[f] || (ground && mesh.features[f]!.terrain)) continue;
    count++;
    zBase = Math.min(zBase, fb[f * 6 + 2]!);
    zTop = Math.max(zTop, fb[f * 6 + 5]!);
    maxOwn = Math.max(maxOwn, fb[f * 6 + 5]! - base(f));
  }
  let mpb: number;
  if (params.heightMode === 'normalized') mpb = (ground ? maxOwn : zTop - zBase) / params.maxHeight;
  else
    mpb =
      (params.scale * BRICK_HEIGHT_IN_STUDS) /
      (params.heightMode === 'exaggerated' ? (params.exaggeration ?? 1) : 1);
  let below = 0;
  let maxBricks = 0;
  let tallest = -1,
    tallestTop = -Infinity;
  const sel: number[] = [];
  const selH: number[] = [];
  const selBox: number[] = [];
  const belowList: number[] = [];
  for (let f = 0; f < nf; f++) {
    if (!selected[f] || (ground && mesh.features[f]!.terrain)) continue;
    const h = ground ? fb[f * 6 + 5]! - base(f) : fb[f * 6 + 5]! - zBase;
    const q = isLegacy(params) ? (mpb > 0 ? Math.trunc(h / mpb) : 0) : quantize(h, mpb, params);
    sel.push(f);
    selH.push(h);
    selBox.push(fb[f * 6]!, fb[f * 6 + 1]!, fb[f * 6 + 3]!, fb[f * 6 + 4]!);
    if (q < 1) {
      below++;
      belowList.push(f);
    }
    maxBricks = Math.max(maxBricks, q);
    if (fb[f * 6 + 5]! > tallestTop) {
      tallestTop = fb[f * 6 + 5]!;
      tallest = f;
    }
  }
  const cols = params.platesX * STUDS_PER_PLATE,
    rows = params.platesY * STUDS_PER_PLATE;
  const size = physicalSizeCm(params);
  return {
    cols,
    rows,
    studs: cols * rows,
    widthCm: size.width,
    depthCm: size.depth,
    mapScale: mapScaleDenominator(params.scale),
    fitsTable: fitsTable(params.platesX, params.platesY),
    metresPerBrick: Number.isFinite(mpb) ? mpb : NaN,
    maxBricks,
    maxHeightCm: (maxBricks * BRICK_HEIGHT_MM) / 10,
    features: count,
    featuresBelowOneBrick: below,
    shareBelowOneBrick: count ? below / count : 0,
    selected: Uint32Array.from(sel),
    selectedHeights: Float64Array.from(selH),
    below: Uint32Array.from(belowList),
    selectedBoxes: Float64Array.from(selBox),
    tallest,
    zBase: ground ? NaN : zBase,
  };
}
