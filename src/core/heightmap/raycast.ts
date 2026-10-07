/**
 * Candidate search for vertical rays. With `useBvh` (the default, SPEC §7.3 "always BVH"), the
 * three-mesh-bvh tree is traversed top-down (highest nodes first) and nodes entirely below the
 * best hit found so far are pruned; without it every triangle is visited (reference for tests).
 * Bounds tests use a tolerance far larger than float32 round-off, so no triangle that the exact
 * test would hit is ever skipped.
 */
import type { Box3 } from 'three';
import type { CityMesh } from '../types.ts';
import { getBvh, type MeshIndex } from './meshIndex.ts';

const ABS_TOL = 0.01; // metres
const REL_TOL = 1e-6;

/** Spacing of float32 values around |v| (an upper bound of 2 × the float32 rounding error). */
export function ulpFloat32(v: number): number {
  const a = Math.abs(v);
  if (a < 1.1754943508222875e-38) return 1.401298464324817e-45;
  return Math.pow(2, Math.floor(Math.log2(a)) - 23);
}

export class VerticalCaster {
  private readonly idx: MeshIndex;
  private readonly bvh;
  private rx = 0;
  private ry = 0;
  private tolX = 0;
  private tolY = 0;
  private extraZ = 0;
  private visit: (tri: number) => void = () => {};
  private pruneBelow: () => number = () => -Infinity;
  private readonly callbacks;

  constructor(mesh: CityMesh, idx: MeshIndex, useBvh = true) {
    this.idx = idx;
    this.bvh = useBvh ? getBvh(mesh, idx) : null;
    const bvh = this.bvh;
    const oz = idx.bvhOrigin[2];
    this.callbacks = {
      boundsTraverseOrder: (box: Box3) => -box.max.z,
      intersectsBounds: (box: Box3) => {
        if (this.rx < box.min.x - this.tolX || this.rx > box.max.x + this.tolX) return false;
        if (this.ry < box.min.y - this.tolY || this.ry > box.max.y + this.tolY) return false;
        const zTop = box.max.z + oz;
        return zTop + ABS_TOL + REL_TOL * Math.abs(zTop) + this.extraZ >= this.pruneBelow();
      },
      intersectsRange: (offset: number, count: number) => {
        for (let k = offset, end = offset + count; k < end; k++) this.visit(bvh!.resolveTriangleIndex(k));
        return false;
      },
    };
  }

  /**
   * Calls `visit` for every triangle that may contain the world point (x, y) in projection.
   * `pruneBelow()` returns a world z under which no further hit can matter.
   * `extraTol` widens the x/y tests when the exact test runs on perturbed coordinates (legacy
   * mode intersects float32-rounded world coordinates: up to 0.25 m off at y ≈ 5.17e6).
   */
  query(x: number, y: number, visit: (tri: number) => void, pruneBelow: () => number, extraTol = 0): void {
    if (!this.bvh) {
      for (let t = 0; t < this.idx.triCount; t++) visit(t);
      return;
    }
    this.rx = x - this.idx.bvhOrigin[0];
    this.ry = y - this.idx.bvhOrigin[1];
    this.tolX = ABS_TOL + REL_TOL * Math.abs(this.rx) + extraTol;
    this.tolY = ABS_TOL + REL_TOL * Math.abs(this.ry) + extraTol;
    this.extraZ = extraTol;
    this.visit = visit;
    this.pruneBelow = pruneBelow;
    this.bvh.shapecast(this.callbacks);
  }
}
