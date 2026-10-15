import type { Bounds3, CityFeature, CityMesh, FrameInfo, MeshPart, SourceFormat } from '../types.ts';
import { EngineError } from '../util/errors.ts';
import { applyMatrix4To, multiply, type Mat4 } from '../util/threeCompat.ts';

export function triangleCount(part: Pick<MeshPart, 'positions' | 'index'>): number {
  return part.index ? Math.floor(part.index.length / 3) : Math.floor(part.positions.length / 9);
}

export function vertexIndex(part: Pick<MeshPart, 'index'>, tri: number, k: number): number {
  return part.index ? part.index[tri * 3 + k]! : tri * 3 + k;
}

/** Accumulates parts and de-duplicated features (by key) while importing. */
export class CityMeshBuilder {
  readonly features: CityFeature[] = [];
  readonly parts: MeshPart[] = [];
  readonly warnings: string[] = [];
  private readonly byKey = new Map<string, number>();

  feature(key: string, init: Omit<CityFeature, 'key'>): number {
    const existing = this.byKey.get(key);
    if (existing !== undefined) return existing;
    const idx = this.features.length;
    this.features.push({ key, ...init });
    this.byKey.set(key, idx);
    return idx;
  }

  addPart(part: MeshPart): void {
    if (triangleCount(part) > 0) this.parts.push(part);
  }

  build(format: SourceFormat, files: string[], frame: FrameInfo): CityMesh {
    if (this.parts.length === 0) {
      throw new EngineError('empty-geometry', 'The file contains no triangle geometry.');
    }
    // drop features no triangle refers to, and remap indices
    const used = new Uint8Array(this.features.length);
    for (const p of this.parts) for (const f of p.triFeature) if (f >= 0) used[f] = 1;
    const remap = new Int32Array(this.features.length).fill(-1);
    const features: CityFeature[] = [];
    this.features.forEach((f, i) => {
      if (used[i]) {
        remap[i] = features.length;
        features.push(f);
      }
    });
    if (features.length !== this.features.length) {
      for (const p of this.parts)
        for (let t = 0; t < p.triFeature.length; t++)
          p.triFeature[t] = p.triFeature[t]! >= 0 ? remap[p.triFeature[t]!]! : -1;
    }
    const mesh: CityMesh = {
      parts: this.parts,
      features,
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      frame,
      stats: { triangles: 0, vertices: 0, parts: this.parts.length, features: features.length },
      source: { format, files },
      warnings: this.warnings,
    };
    finalizeMesh(mesh);
    return mesh;
  }
}

/** Recomputes bounds and stats (call after changing part matrices). */
export function finalizeMesh(mesh: CityMesh): void {
  let tris = 0;
  let verts = 0;
  for (const p of mesh.parts) {
    tris += triangleCount(p);
    verts += p.positions.length / 3;
  }
  mesh.stats = { triangles: tris, vertices: verts, parts: mesh.parts.length, features: mesh.features.length };
  mesh.bounds = computeWorldBounds(mesh.parts);
}

export function computeWorldBounds(parts: MeshPart[]): Bounds3 {
  const b: Bounds3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const p = new Float64Array(3);
  for (const part of parts) {
    const pos = part.positions;
    const m = part.matrix;
    for (let v = 0; v < pos.length; v += 3) {
      applyMatrix4To(m, pos[v]!, pos[v + 1]!, pos[v + 2]!, p);
      if (p[0]! < b.min[0]) b.min[0] = p[0]!;
      if (p[1]! < b.min[1]) b.min[1] = p[1]!;
      if (p[2]! < b.min[2]) b.min[2] = p[2]!;
      if (p[0]! > b.max[0]) b.max[0] = p[0]!;
      if (p[1]! > b.max[1]) b.max[1] = p[1]!;
      if (p[2]! > b.max[2]) b.max[2] = p[2]!;
    }
  }
  return b;
}

/** Pre-multiplies every part matrix (frame change: ENU conversion, unit scale, up axis). */
export function transformMesh(mesh: CityMesh, m: Mat4): void {
  for (const part of mesh.parts) part.matrix = multiply(m, part.matrix);
  finalizeMesh(mesh);
}

/**
 * Per-triangle feature index from per-vertex ids (first vertex of each triangle, like the
 * contiguous _BATCHID runs iTowns turns into feature groups).
 */
export function triangleFeatures(
  index: Uint32Array | null,
  vertexCount: number,
  vertexIds: ArrayLike<number> | null,
  toFeature: (id: number) => number,
): Int32Array {
  const triCount = index ? Math.floor(index.length / 3) : Math.floor(vertexCount / 3);
  const out = new Int32Array(triCount);
  const cache = new Map<number, number>();
  for (let t = 0; t < triCount; t++) {
    const v = index ? index[t * 3]! : t * 3;
    const id = vertexIds ? vertexIds[v]! : 0;
    let f = cache.get(id);
    if (f === undefined) {
      f = toFeature(id);
      cache.set(id, f);
    }
    out[t] = f;
  }
  return out;
}

export function boundsSize(b: Bounds3): [number, number, number] {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}
