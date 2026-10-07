import { STUDS_PER_PLATE, type Area, type Params } from '../types.ts';
import { applyMatrix4To, compose, quatFromEulerXYZ } from '../util/threeCompat.ts';

/** Physical brick system: 8 mm stud pitch, 9.6 mm brick height (= 1.2 × pitch). */
export const STUD_PITCH_MM = 8;
export const BRICK_HEIGHT_MM = 9.6;
export const BRICK_HEIGHT_IN_STUDS = BRICK_HEIGHT_MM / STUD_PITCH_MM; // 1.2

export function areaSize(p: Pick<Params, 'platesX' | 'platesY' | 'scale'>): {
  width: number;
  height: number;
} {
  // UD-Viz: boxSelector.scale.x = nbPlatesX * this.scale * 32
  return { width: p.platesX * p.scale * STUDS_PER_PLATE, height: p.platesY * p.scale * STUDS_PER_PLATE };
}

export interface Rect2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Legacy area (SPEC §3.1 step 2, L3): the unit box scaled to the area size, rotated about Z and
 * centred on the area, transformed by three's BufferAttribute.applyMatrix4 — which stores the
 * corners in a Float32Array — then its AABB (computeBoundingBox). Coordinates are float32 values.
 */
export function legacyAreaBox(area: Area, p: Pick<Params, 'platesX' | 'platesY' | 'scale'>): Rect2 {
  const { width, height } = areaSize(p);
  const rz = (area.rotationDeg * Math.PI) / 180;
  const m = compose(area.cx, area.cy, 0, quatFromEulerXYZ(0, 0, rz), width, height, 1);
  const out = [0, 0, 0];
  const r: Rect2 = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const x of [-0.5, 0.5]) {
    for (const y of [-0.5, 0.5]) {
      applyMatrix4To(m, x, y, 0.5, out);
      const fx = Math.fround(out[0]!),
        fy = Math.fround(out[1]!);
      if (fx < r.minX) r.minX = fx;
      if (fy < r.minY) r.minY = fy;
      if (fx > r.maxX) r.maxX = fx;
      if (fy > r.maxY) r.maxY = fy;
    }
  }
  return r;
}

/** Corners of the (rotated) area, counter-clockwise from the south-west corner, world coordinates. */
export function areaCorners(
  area: Area,
  p: Pick<Params, 'platesX' | 'platesY' | 'scale'>,
): [number, number][] {
  const { width, height } = areaSize(p);
  const t = (area.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t),
    s = Math.sin(t);
  return [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ].map(([u, v]) => [area.cx + u! * c - v! * s, area.cy + u! * s + v! * c]);
}

/**
 * Oriented rectangle centred on the origin (area-local frame rotated by `theta`), used by the
 * improved pipeline in coordinates relative to the area centre.
 */
export interface OrientedRect {
  halfW: number;
  halfH: number;
  cos: number;
  sin: number;
}

export function orientedRect(area: Area, p: Pick<Params, 'platesX' | 'platesY' | 'scale'>): OrientedRect {
  const { width, height } = areaSize(p);
  const t = (area.rotationDeg * Math.PI) / 180;
  return { halfW: width / 2, halfH: height / 2, cos: Math.cos(t), sin: Math.sin(t) };
}

/** Separating-axis test between an AABB (relative to the area centre) and the oriented area. */
export function aabbIntersectsOrientedRect(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  r: OrientedRect,
): boolean {
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2;
  const hx = (maxX - minX) / 2,
    hy = (maxY - minY) / 2;
  const ac = Math.abs(r.cos),
    as = Math.abs(r.sin);
  const eps = 1e-9 * (1 + Math.abs(cx) + Math.abs(cy));
  // world axes
  if (Math.abs(cx) > hx + ac * r.halfW + as * r.halfH + eps) return false;
  if (Math.abs(cy) > hy + as * r.halfW + ac * r.halfH + eps) return false;
  // area axes u = (cos, sin), v = (−sin, cos)
  if (Math.abs(cx * r.cos + cy * r.sin) > r.halfW + ac * hx + as * hy + eps) return false;
  if (Math.abs(-cx * r.sin + cy * r.cos) > r.halfH + as * hx + ac * hy + eps) return false;
  return true;
}

/** Map scale denominator: metres per stud / 8 mm (e.g. 3 m/stud → 1:375). */
export function mapScaleDenominator(scale: number): number {
  return scale / (STUD_PITCH_MM / 1000);
}

/** Physical model size in centimetres. */
export function physicalSizeCm(p: Pick<Params, 'platesX' | 'platesY'>): { width: number; depth: number } {
  return {
    width: (p.platesX * STUDS_PER_PLATE * STUD_PITCH_MM) / 10,
    depth: (p.platesY * STUDS_PER_PLATE * STUD_PITCH_MM) / 10,
  };
}

/**
 * Default area (SPEC A3): the whole model if it fits in ≤ 4 × 4 plates at the given scale
 * (plates rounded up), else a centred 2 × 2-plate area.
 */
export function defaultArea(
  bounds: { min: number[]; max: number[] },
  scale = 3,
): { area: Area; platesX: number; platesY: number } {
  const w = bounds.max[0]! - bounds.min[0]!,
    h = bounds.max[1]! - bounds.min[1]!;
  const plate = STUDS_PER_PLATE * scale;
  let px = Math.max(1, Math.ceil(w / plate - 1e-9)),
    py = Math.max(1, Math.ceil(h / plate - 1e-9));
  if (px > 4 || py > 4) px = py = 2;
  return {
    area: {
      cx: (bounds.min[0]! + bounds.max[0]!) / 2,
      cy: (bounds.min[1]! + bounds.max[1]!) / 2,
      rotationDeg: 0,
    },
    platesX: px,
    platesY: py,
  };
}
