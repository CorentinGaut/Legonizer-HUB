import { Earcut } from 'three/src/extras/Earcut.js';

/**
 * Triangulates a planar-ish 3D polygon with holes.
 *
 * @param pos     flat xyz coordinates of all ring vertices (exterior ring first, then holes)
 * @param holes   start index (in vertices) of each hole ring
 * @returns       triangles as local vertex indices, wound like the exterior ring (Newell normal),
 *                so that outward-facing CityJSON / OBJ faces stay outward-facing.
 */
export function triangulatePolygon(pos: ArrayLike<number>, holes: number[]): number[] {
  const n = pos.length / 3;
  if (n < 3) return [];
  const exteriorEnd = holes.length ? holes[0]! : n;
  // Newell normal of the exterior ring
  let nx = 0,
    ny = 0,
    nz = 0;
  for (let i = 0; i < exteriorEnd; i++) {
    const j = (i + 1) % exteriorEnd;
    const xi = pos[3 * i]!,
      yi = pos[3 * i + 1]!,
      zi = pos[3 * i + 2]!;
    const xj = pos[3 * j]!,
      yj = pos[3 * j + 1]!,
      zj = pos[3 * j + 2]!;
    nx += (yi - yj) * (zi + zj);
    ny += (zi - zj) * (xi + xj);
    nz += (xi - xj) * (yi + yj);
  }
  if (n === 3 && holes.length === 0) return orient([0, 1, 2], pos, nx, ny, nz);
  if (n === 4 && holes.length === 0 && isConvexQuad(pos, nx, ny, nz))
    return orient([0, 1, 2, 0, 2, 3], pos, nx, ny, nz);
  const ax = Math.abs(nx),
    ay = Math.abs(ny),
    az = Math.abs(nz);
  // drop the dominant axis
  const [u, v] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [2, 0];
  const flat: number[] = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    flat[2 * i] = pos[3 * i + u]!;
    flat[2 * i + 1] = pos[3 * i + v]!;
  }
  const tris = Earcut.triangulate(flat, holes.length ? holes : undefined, 2);
  return orient(tris, pos, nx, ny, nz);
}

function isConvexQuad(pos: ArrayLike<number>, nx: number, ny: number, nz: number): boolean {
  for (let i = 0; i < 4; i++) {
    const a = i,
      b = (i + 1) % 4,
      c = (i + 2) % 4;
    const e1x = pos[3 * b]! - pos[3 * a]!,
      e1y = pos[3 * b + 1]! - pos[3 * a + 1]!,
      e1z = pos[3 * b + 2]! - pos[3 * a + 2]!;
    const e2x = pos[3 * c]! - pos[3 * b]!,
      e2y = pos[3 * c + 1]! - pos[3 * b + 1]!,
      e2z = pos[3 * c + 2]! - pos[3 * b + 2]!;
    const cx = e1y * e2z - e1z * e2y,
      cy = e1z * e2x - e1x * e2z,
      cz = e1x * e2y - e1y * e2x;
    if (cx * nx + cy * ny + cz * nz <= 0) return false;
  }
  return true;
}

function orient(tris: number[], pos: ArrayLike<number>, nx: number, ny: number, nz: number): number[] {
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = tris[t]!,
      b = tris[t + 1]!,
      c = tris[t + 2]!;
    const e1x = pos[3 * b]! - pos[3 * a]!,
      e1y = pos[3 * b + 1]! - pos[3 * a + 1]!,
      e1z = pos[3 * b + 2]! - pos[3 * a + 2]!;
    const e2x = pos[3 * c]! - pos[3 * a]!,
      e2y = pos[3 * c + 1]! - pos[3 * a + 1]!,
      e2z = pos[3 * c + 2]! - pos[3 * a + 2]!;
    const cx = e1y * e2z - e1z * e2y,
      cy = e1z * e2x - e1x * e2z,
      cz = e1x * e2y - e1y * e2x;
    if (cx * nx + cy * ny + cz * nz < 0) {
      tris[t + 1] = c;
      tris[t + 2] = b;
    }
  }
  return tris;
}
