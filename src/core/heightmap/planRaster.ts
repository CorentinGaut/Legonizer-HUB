/**
 * Top-down height raster of the model (z-buffer of every triangle, highest surface wins), used by
 * the 2D plan view when WebGL 2 is not available (SPEC N2) and for fast
 * overviews. Cells nobody covers are NaN. Triangles smaller than a cell still mark the cell of
 * their centroid so thin buildings do not vanish.
 */
import type { CityMesh } from '../types.ts';
import { getMeshIndex, worldVertex } from './meshIndex.ts';

export interface PlanRasterRequest {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface PlanRaster extends PlanRasterRequest {
  /** Row 0 = north edge; top z per cell (world metres), NaN = empty. */
  z: Float32Array;
  /** Lowest z of the model (for shading). */
  zMin: number;
  zMax: number;
}

export function planRaster(mesh: CityMesh, r: PlanRasterRequest): PlanRaster {
  const W = Math.max(1, Math.min(4096, Math.round(r.width)));
  const H = Math.max(1, Math.min(4096, Math.round(r.height)));
  const z = new Float32Array(W * H).fill(NaN);
  const idx = getMeshIndex(mesh);
  const sx = W / (r.maxX - r.minX),
    sy = H / (r.maxY - r.minY);
  const a = new Float64Array(3),
    b = new Float64Array(3),
    c = new Float64Array(3);
  const put = (px: number, py: number, v: number) => {
    if (px < 0 || py < 0 || px >= W || py >= H) return;
    const o = py * W + px;
    if (!(z[o]! >= v)) z[o] = v;
  };
  for (let t = 0; t < idx.triCount; t++) {
    worldVertex(mesh, idx, t, 0, a);
    worldVertex(mesh, idx, t, 1, b);
    worldVertex(mesh, idx, t, 2, c);
    // pixel coordinates (y down = north at the top)
    const ax = (a[0]! - r.minX) * sx,
      ay = (r.maxY - a[1]!) * sy;
    const bx = (b[0]! - r.minX) * sx,
      by = (r.maxY - b[1]!) * sy;
    const cx = (c[0]! - r.minX) * sx,
      cy = (r.maxY - c[1]!) * sy;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
      x1 = Math.min(W - 1, Math.floor(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))),
      y1 = Math.min(H - 1, Math.floor(Math.max(ay, by, cy)));
    if (x0 > x1 || y0 > y1) continue;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    const zTop = Math.max(a[2]!, b[2]!, c[2]!);
    if (Math.abs(den) < 1e-9 || (x1 - x0 < 1 && y1 - y0 < 1)) {
      // degenerate in plan (vertical wall) or sub-pixel: mark the centroid cell
      put(Math.floor((ax + bx + cx) / 3), Math.floor((ay + by + cy) / 3), zTop);
      continue;
    }
    for (let py = y0; py <= y1; py++) {
      const pcy = py + 0.5;
      for (let px = x0; px <= x1; px++) {
        const pcx = px + 0.5;
        const l1 = ((by - cy) * (pcx - cx) + (cx - bx) * (pcy - cy)) / den;
        const l2 = ((cy - ay) * (pcx - cx) + (ax - cx) * (pcy - cy)) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        put(px, py, l1 * a[2]! + l2 * b[2]! + l3 * c[2]!);
      }
    }
  }
  return { ...r, width: W, height: H, z, zMin: mesh.bounds.min[2], zMax: mesh.bounds.max[2] };
}
