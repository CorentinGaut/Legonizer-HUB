/**
 * Z range of a triangle clipped to the oriented area (Sutherland–Hodgman against the 4 sides,
 * z interpolated linearly along clipped edges). Used by `selection: 'clip'`.
 */
import type { OrientedRect } from './area.ts';

/** Returns [zmin, zmax] of the part of triangle (a, b, c) inside the rectangle, or null. Coordinates relative to the area centre. */
export function clippedZRange(tri: ArrayLike<number>, r: OrientedRect): [number, number] | null {
  // polygon in area-local coordinates (u, v, z)
  let poly: number[] = [];
  for (let k = 0; k < 3; k++) {
    const x = tri[3 * k]!,
      y = tri[3 * k + 1]!,
      z = tri[3 * k + 2]!;
    poly.push(x * r.cos + y * r.sin, -x * r.sin + y * r.cos, z);
  }
  const planes: [number, number, number][] = [
    [1, 0, r.halfW], // u ≤ halfW
    [-1, 0, r.halfW], // −u ≤ halfW
    [0, 1, r.halfH],
    [0, -1, r.halfH],
  ];
  for (const [a, b, lim] of planes) {
    const out: number[] = [];
    const n = poly.length / 3;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const pu = poly[3 * i]!,
        pv = poly[3 * i + 1]!,
        pz = poly[3 * i + 2]!;
      const qu = poly[3 * j]!,
        qv = poly[3 * j + 1]!,
        qz = poly[3 * j + 2]!;
      const dp = a * pu + b * pv - lim;
      const dq = a * qu + b * qv - lim;
      if (dp <= 0) out.push(pu, pv, pz);
      if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
        const t = dp / (dp - dq);
        out.push(pu + t * (qu - pu), pv + t * (qv - pv), pz + t * (qz - pz));
      }
    }
    poly = out;
    if (poly.length === 0) return null;
  }
  let zmin = Infinity,
    zmax = -Infinity;
  for (let i = 2; i < poly.length; i += 3) {
    zmin = Math.min(zmin, poly[i]!);
    zmax = Math.max(zmax, poly[i]!);
  }
  return [zmin, zmax];
}
