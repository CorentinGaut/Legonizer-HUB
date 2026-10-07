import type { HeightMap } from '../types.ts';
import type { ProgressFn } from '../util/progress.ts';

export interface HeightmapOptions {
  signal?: AbortSignal;
  progress?: ProgressFn;
  /** Use the BVH (default). `false` visits every triangle; results are identical (tested). */
  useBvh?: boolean;
  /** Keep the per-cell height in metres before quantization (histograms, debugging). */
  keepRaw?: boolean;
}

/** Geometry of the sampling grid, so the UI can overlay it on the map and georeference the calque. */
export interface GridInfo {
  /** World position of the south-west corner of cell (0, 0). */
  originX: number;
  originY: number;
  /** Cell size along the grid's x and y axes (metres). */
  stepX: number;
  stepY: number;
  /** Grid rotation about Z (radians, counter-clockwise); always 0 in legacy mode (L3). */
  rotation: number;
  /** Where the single sample sits inside a cell: 0 = corner (legacy), 0.5 = centre. */
  sampleOffset: number;
}

/**
 * The rectangle actually sampled (cells' extent), world coordinates, corners counter-clockwise
 * from the grid's south-west corner. It differs from the drawn area with `rotation: 'aabb'` and a
 * rotated area (L3), and when the square legacy step does not span the Y extent (L9) — SPEC A4.
 */
export interface SampledRect {
  corners: [number, number][];
  width: number;
  height: number;
  rotation: number;
  differsFromArea: boolean;
}

export interface HeightmapResult {
  heightMap: HeightMap;
  /** Output identical to UD-Viz 4.6.1 + legonizer 1.1.0 (all options at the legacy preset). */
  legacy: boolean;
  /** Which sampling pipeline ran: exact UD-Viz numerics, or the improved one. */
  pipeline: 'legacy-geometry' | 'improved';
  grid: GridInfo;
  sampledRect: SampledRect;
  vertical: {
    /** Height reference (world z) for `lowest-base`; NaN for `ground`. */
    zBase: number;
    /** Top used for normalization (metres above the reference), NaN when not normalized. */
    heightRange: number;
    /** Metres of city per brick height. */
    metresPerBrick: number;
    maxValue: number;
    /** Studs where the sampled height is above 1 cm. */
    builtStuds: number;
    /** Built-up studs that got 0 bricks (L1 warning after generation). */
    erasedStuds: number;
  };
  selection: { features: number; triangles: number };
  raw?: Float32Array;
  warnings: string[];
  timings: { selectMs: number; bvhMs: number; raycastMs: number; totalMs: number };
}

export function makeSampledRect(
  originX: number,
  originY: number,
  width: number,
  height: number,
  rotation: number,
  drawn: [number, number][],
  tolerance: number,
): SampledRect {
  const c = Math.cos(rotation),
    s = Math.sin(rotation);
  const corners: [number, number][] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([u, v]) => [originX + u! * c - v! * s, originY + u! * s + v! * c]);
  const differsFromArea = corners.some(
    (p, k) => Math.hypot(p[0] - drawn[k]![0], p[1] - drawn[k]![1]) > tolerance,
  );
  return { corners, width, height, rotation, differsFromArea };
}

export function emptyHeightMap(cols: number, rows: number): HeightMap {
  return { cols, rows, data: new Int32Array(cols * rows) };
}
