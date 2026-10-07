/**
 * WGS84 ECEF ↔ geodetic and the local East-North-Up frame (SPEC I7).
 * Constants: NIMA TR8350.2 (WGS 84): a = 6378137 m, f = 1/298.257223563.
 */
import type { Bounds3, Vec3 } from '../types.ts';
import type { Mat4 } from '../util/threeCompat.ts';

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const B = A * (1 - F);
const EP2 = (A * A - B * B) / (B * B);

export function geodeticToEcef(lonDeg: number, latDeg: number, h: number): Vec3 {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const s = Math.sin(lat);
  const n = A / Math.sqrt(1 - E2 * s * s);
  return [
    (n + h) * Math.cos(lat) * Math.cos(lon),
    (n + h) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - E2) + h) * s,
  ];
}

/** Bowring's method, sub-millimetre for terrestrial points. */
export function ecefToGeodetic(
  x: number,
  y: number,
  z: number,
): { lon: number; lat: number; height: number } {
  const p = Math.hypot(x, y);
  const th = Math.atan2(z * A, p * B);
  const lon = Math.atan2(y, x);
  const lat = Math.atan2(z + EP2 * B * Math.sin(th) ** 3, p - E2 * A * Math.cos(th) ** 3);
  const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
  const height = p / Math.cos(lat) - n;
  return { lon: (lon * 180) / Math.PI, lat: (lat * 180) / Math.PI, height };
}

/**
 * True when the bounds look like Earth-centred coordinates: every corner ~6.36e6 m from the
 * origin and |z| far beyond any terrain height (projected CRSs keep z under ~9 km, e.g.
 * Lambert-93 has |(x, y)| ≈ 6.6e6 m but z < 5 km).
 */
export function looksLikeEcef(b: Bounds3): boolean {
  const r = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
  const rMin = r(b.min),
    rMax = r(b.max);
  const zAbs = Math.min(Math.abs(b.min[2]), Math.abs(b.max[2]));
  return rMin > 6.2e6 && rMax < 6.5e6 && zAbs > 2e4;
}

/** Matrix taking ECEF coordinates to the ENU frame whose origin is `origin` (column-major). */
export function enuFromEcefMatrix(originEcef: Vec3): Mat4 {
  const g = ecefToGeodetic(originEcef[0], originEcef[1], originEcef[2]);
  const lon = (g.lon * Math.PI) / 180,
    lat = (g.lat * Math.PI) / 180;
  const sl = Math.sin(lon),
    cl = Math.cos(lon),
    sp = Math.sin(lat),
    cp = Math.cos(lat);
  // rows: east, north, up
  const e = [-sl, cl, 0];
  const n = [-sp * cl, -sp * sl, cp];
  const u = [cp * cl, cp * sl, sp];
  const [ox, oy, oz] = originEcef;
  const m = new Float64Array(16);
  // column-major: m[col*4 + row]
  for (let c = 0; c < 3; c++) {
    m[c * 4 + 0] = e[c]!;
    m[c * 4 + 1] = n[c]!;
    m[c * 4 + 2] = u[c]!;
    m[c * 4 + 3] = 0;
  }
  m[12] = -(e[0]! * ox + e[1]! * oy + e[2]! * oz);
  m[13] = -(n[0]! * ox + n[1]! * oy + n[2]! * oz);
  m[14] = -(u[0]! * ox + u[1]! * oy + u[2]! * oz);
  m[15] = 1;
  return m;
}
