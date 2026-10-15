/**
 * Per-mesh acceleration data, computed once and cached (the Worker keeps the mesh between
 * generations): global triangle numbering, per-feature world boxes, legacy per-(mesh, feature)
 * boxes, and a three-mesh-bvh BVH over all triangles used for culling vertical rays.
 *
 * The BVH only selects candidate triangles (with a conservative tolerance); every intersection is
 * then computed exactly on the original coordinates, so the BVH cannot change results (SPEC §7.3).
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { SurfaceClass, type CityMesh } from '../types.ts';
import { applyMatrix4To, box3ApplyMatrix4 } from '../util/threeCompat.ts';
import { triangleCount, vertexIndex } from '../import/cityMesh.ts';

export interface LegacyFeatureBox {
  part: number;
  feature: number;
  /** World AABB (float64), three Box3.applyMatrix4 of the local bounds: minx, miny, minz, maxx, maxy, maxz. */
  box: Float64Array;
}

export interface MeshIndex {
  triCount: number;
  triPart: Uint32Array;
  triLocal: Uint32Array;
  triFeature: Int32Array;
  triClass: Uint8Array;
  /** Per feature world AABB: 6 values per feature. */
  featureBox: Float64Array;
  /** Per feature min z of its Ground-class triangles (NaN if none). */
  featureGroundZ: Float64Array;
  legacyBoxes: LegacyFeatureBox[];
  /** Per part declared (accessor) bounds transformed to world, or null. */
  partDeclaredWorld: (Float64Array | null)[];
  /** Origin of the BVH's float32 coordinates (world). */
  bvhOrigin: [number, number, number];
  bvh: MeshBVH | null;
  bvhBuildMs: number;
}

const cache = new WeakMap<CityMesh, MeshIndex>();

export function getMeshIndex(mesh: CityMesh): MeshIndex {
  const hit = cache.get(mesh);
  if (hit) return hit;
  const idx = buildIndex(mesh);
  cache.set(mesh, idx);
  return idx;
}

/** World coordinates (float64) of vertex k of global triangle t. */
export function worldVertex(
  mesh: CityMesh,
  idx: MeshIndex,
  t: number,
  k: number,
  out: Float64Array | number[],
  o = 0,
): void {
  const part = mesh.parts[idx.triPart[t]!]!;
  const v = vertexIndex(part, idx.triLocal[t]!, k);
  const p = part.positions;
  applyMatrix4To(part.matrix, p[3 * v]!, p[3 * v + 1]!, p[3 * v + 2]!, out, o);
}

function buildIndex(mesh: CityMesh): MeshIndex {
  let triCount = 0;
  for (const p of mesh.parts) triCount += triangleCount(p);
  const triPart = new Uint32Array(triCount);
  const triLocal = new Uint32Array(triCount);
  const triFeature = new Int32Array(triCount);
  const triClass = new Uint8Array(triCount);
  const nf = mesh.features.length;
  const featureBox = new Float64Array(nf * 6);
  for (let f = 0; f < nf; f++)
    featureBox.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], f * 6);
  const featureGroundZ = new Float64Array(nf).fill(NaN);
  const legacyBoxes: LegacyFeatureBox[] = [];
  const partDeclaredWorld: (Float64Array | null)[] = [];
  const w = new Float64Array(3);
  let g = 0;
  mesh.parts.forEach((part, pi) => {
    const n = triangleCount(part);
    const pos = part.positions;
    // local bounds per feature in this part (legacy C3DTFeature.computeWorldBox3)
    const local = new Map<number, Float64Array>();
    for (let t = 0; t < n; t++, g++) {
      triPart[g] = pi;
      triLocal[g] = t;
      const f = part.triFeature[t]!;
      triFeature[g] = f;
      const cls = part.triClass?.[t] ?? 0;
      triClass[g] = f >= 0 && mesh.features[f]!.terrain ? SurfaceClass.Terrain : cls;
      let lb = local.get(f);
      if (!lb) {
        lb = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
        local.set(f, lb);
      }
      for (let k = 0; k < 3; k++) {
        const v = vertexIndex(part, t, k);
        const x = pos[3 * v]!,
          y = pos[3 * v + 1]!,
          z = pos[3 * v + 2]!;
        lb[0] = Math.min(x, lb[0]!);
        lb[1] = Math.min(y, lb[1]!);
        lb[2] = Math.min(z, lb[2]!);
        lb[3] = Math.max(x, lb[3]!);
        lb[4] = Math.max(y, lb[4]!);
        lb[5] = Math.max(z, lb[5]!);
        if (f >= 0) {
          applyMatrix4To(part.matrix, x, y, z, w);
          const b = f * 6;
          if (w[0]! < featureBox[b]!) featureBox[b] = w[0]!;
          if (w[1]! < featureBox[b + 1]!) featureBox[b + 1] = w[1]!;
          if (w[2]! < featureBox[b + 2]!) featureBox[b + 2] = w[2]!;
          if (w[0]! > featureBox[b + 3]!) featureBox[b + 3] = w[0]!;
          if (w[1]! > featureBox[b + 4]!) featureBox[b + 4] = w[1]!;
          if (w[2]! > featureBox[b + 5]!) featureBox[b + 5] = w[2]!;
          if (cls === SurfaceClass.Ground && !(w[2]! >= featureGroundZ[f]!)) featureGroundZ[f] = w[2]!;
        }
      }
    }
    for (const [f, lb] of local) {
      if (f < 0) continue;
      legacyBoxes.push({
        part: pi,
        feature: f,
        box: box3ApplyMatrix4(part.matrix, lb[0]!, lb[1]!, lb[2]!, lb[3]!, lb[4]!, lb[5]!),
      });
    }
    const d = part.declaredBounds;
    partDeclaredWorld.push(
      d ? box3ApplyMatrix4(part.matrix, d.min[0], d.min[1], d.min[2], d.max[0], d.max[1], d.max[2]) : null,
    );
  });
  const b = mesh.bounds;
  return {
    triCount,
    triPart,
    triLocal,
    triFeature,
    triClass,
    featureBox,
    featureGroundZ,
    legacyBoxes,
    partDeclaredWorld,
    bvhOrigin: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, 0],
    bvh: null,
    bvhBuildMs: 0,
  };
}

/** Builds (once) the BVH over all triangles, in float32 coordinates relative to `bvhOrigin`. */
export function getBvh(mesh: CityMesh, idx: MeshIndex): MeshBVH {
  if (idx.bvh) return idx.bvh;
  const t0 = performance.now();
  const pos = new Float32Array(idx.triCount * 9);
  const w = new Float64Array(3);
  const [ox, oy, oz] = idx.bvhOrigin;
  for (let t = 0; t < idx.triCount; t++) {
    for (let k = 0; k < 3; k++) {
      worldVertex(mesh, idx, t, k, w);
      pos[t * 9 + k * 3] = w[0]! - ox;
      pos[t * 9 + k * 3 + 1] = w[1]! - oy;
      pos[t * 9 + k * 3 + 2] = w[2]! - oz;
    }
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(pos, 3));
  idx.bvh = new MeshBVH(geom, { indirect: true, targetLeafSize: 8 });
  idx.bvhBuildMs = performance.now() - t0;
  return idx.bvh;
}
