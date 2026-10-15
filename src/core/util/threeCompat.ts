/**
 * Exact ports of the three.js numerics that UD-Viz 4.6.1 (three 0.154, iTowns 2.41.1-next.9) and
 * legonizer@1.1.0 (three 0.147) execute when building the legacy height matrix.
 *
 * Why not import three.js directly: three r16x replaced `Ray.intersectTriangle` with a watertight
 * algorithm (three r186 `src/math/Ray.js`), so the latest three no longer returns the same
 * distances as r147. Every function below reproduces the r147/r154 code operation by operation
 * (same operand order, hence the same IEEE-754 roundings); `test/unit/threeCompat.test.ts`
 * checks them against the real three r147 and r154 on random and adversarial inputs.
 *
 * Matrices are column-major Float64Array(16), like three's `Matrix4.elements`.
 *
 * Ported from three.js r147 / r154, Copyright © 2010-2023 three.js authors, MIT licence
 * (THIRD_PARTY_NOTICES.md).
 */

export type Mat4 = Float64Array;

export function identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function fromArray(a: ArrayLike<number>): Mat4 {
  const m = new Float64Array(16);
  for (let i = 0; i < 16; i++) m[i] = a[i] as number;
  return m;
}

/** Matrix4.multiplyMatrices(a, b) (r147 = r154). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const ae = a,
    be = b,
    te = new Float64Array(16);
  const a11 = ae[0]!, a12 = ae[4]!, a13 = ae[8]!, a14 = ae[12]!; // prettier-ignore
  const a21 = ae[1]!, a22 = ae[5]!, a23 = ae[9]!, a24 = ae[13]!; // prettier-ignore
  const a31 = ae[2]!, a32 = ae[6]!, a33 = ae[10]!, a34 = ae[14]!; // prettier-ignore
  const a41 = ae[3]!, a42 = ae[7]!, a43 = ae[11]!, a44 = ae[15]!; // prettier-ignore
  const b11 = be[0]!, b12 = be[4]!, b13 = be[8]!, b14 = be[12]!; // prettier-ignore
  const b21 = be[1]!, b22 = be[5]!, b23 = be[9]!, b24 = be[13]!; // prettier-ignore
  const b31 = be[2]!, b32 = be[6]!, b33 = be[10]!, b34 = be[14]!; // prettier-ignore
  const b41 = be[3]!, b42 = be[7]!, b43 = be[11]!, b44 = be[15]!; // prettier-ignore
  te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
  te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
  te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
  te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
  te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
  te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
  te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
  te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
  te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
  te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
  te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
  te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
  return te;
}

/** Matrix4.makeRotationX(theta). */
export function makeRotationX(theta: number): Mat4 {
  const c = Math.cos(theta),
    s = Math.sin(theta);
  // set( 1, 0, 0, 0,  0, c, -s, 0,  0, s, c, 0,  0, 0, 0, 1 ) — row-major arguments
  return fromArray([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Quaternion.setFromEuler for order 'XYZ' (the Object3D default). */
export function quatFromEulerXYZ(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2),
    c2 = Math.cos(y / 2),
    c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2),
    s2 = Math.sin(y / 2),
    s3 = Math.sin(z / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

/** Matrix4.compose(position, quaternion, scale). */
export function compose(
  px: number,
  py: number,
  pz: number,
  q: Quat,
  sx: number,
  sy: number,
  sz: number,
): Mat4 {
  const te = new Float64Array(16);
  const x = q.x,
    y = q.y,
    z = q.z,
    w = q.w;
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  te[0] = (1 - (yy + zz)) * sx;
  te[1] = (xy + wz) * sx;
  te[2] = (xz - wy) * sx;
  te[3] = 0;
  te[4] = (xy - wz) * sy;
  te[5] = (1 - (xx + zz)) * sy;
  te[6] = (yz + wx) * sy;
  te[7] = 0;
  te[8] = (xz + wy) * sz;
  te[9] = (yz - wx) * sz;
  te[10] = (1 - (xx + yy)) * sz;
  te[11] = 0;
  te[12] = px;
  te[13] = py;
  te[14] = pz;
  te[15] = 1;
  return te;
}

/** Matrix4.determinant (r147 = r154). */
export function determinant(te: Mat4): number {
  const n11 = te[0]!, n12 = te[4]!, n13 = te[8]!, n14 = te[12]!; // prettier-ignore
  const n21 = te[1]!, n22 = te[5]!, n23 = te[9]!, n24 = te[13]!; // prettier-ignore
  const n31 = te[2]!, n32 = te[6]!, n33 = te[10]!, n34 = te[14]!; // prettier-ignore
  const n41 = te[3]!, n42 = te[7]!, n43 = te[11]!, n44 = te[15]!; // prettier-ignore
  return (
    n41 *
      (+n14 * n23 * n32 -
        n13 * n24 * n32 -
        n14 * n22 * n33 +
        n12 * n24 * n33 +
        n13 * n22 * n34 -
        n12 * n23 * n34) +
    n42 *
      (+n11 * n23 * n34 -
        n11 * n24 * n33 +
        n14 * n21 * n33 -
        n13 * n21 * n34 +
        n13 * n24 * n31 -
        n14 * n23 * n31) +
    n43 *
      (+n11 * n24 * n32 -
        n11 * n22 * n34 -
        n14 * n21 * n32 +
        n12 * n21 * n34 +
        n14 * n22 * n31 -
        n12 * n24 * n31) +
    n44 *
      (-n13 * n22 * n31 -
        n11 * n23 * n32 +
        n11 * n22 * n33 +
        n13 * n21 * n32 -
        n12 * n21 * n33 +
        n12 * n23 * n31)
  );
}

/** Quaternion.setFromRotationMatrix (expects a pure rotation in the upper 3×3). */
export function quatFromRotationMatrix(te: ArrayLike<number>): Quat {
  const m11 = te[0]!, m12 = te[4]!, m13 = te[8]!; // prettier-ignore
  const m21 = te[1]!, m22 = te[5]!, m23 = te[9]!; // prettier-ignore
  const m31 = te[2]!, m32 = te[6]!, m33 = te[10]!; // prettier-ignore
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    return { w: 0.25 / s, x: (m32 - m23) * s, y: (m13 - m31) * s, z: (m21 - m12) * s };
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    return { w: (m32 - m23) / s, x: 0.25 * s, y: (m12 + m21) / s, z: (m13 + m31) / s };
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    return { w: (m13 - m31) / s, x: (m12 + m21) / s, y: 0.25 * s, z: (m23 + m32) / s };
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    return { w: (m21 - m12) / s, x: (m13 + m31) / s, y: (m23 + m32) / s, z: 0.25 * s };
  }
}

function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** Matrix4.decompose (r147 = r154). */
export function decompose(te: Mat4): {
  position: [number, number, number];
  quaternion: Quat;
  scale: [number, number, number];
} {
  let sx = len3(te[0]!, te[1]!, te[2]!);
  const sy = len3(te[4]!, te[5]!, te[6]!);
  const sz = len3(te[8]!, te[9]!, te[10]!);
  const det = determinant(te);
  if (det < 0) sx = -sx;
  const position: [number, number, number] = [te[12]!, te[13]!, te[14]!];
  const m = Float64Array.from(te);
  const invSX = 1 / sx;
  const invSY = 1 / sy;
  const invSZ = 1 / sz;
  m[0]! *= invSX;
  m[1]! *= invSX;
  m[2]! *= invSX;
  m[4]! *= invSY;
  m[5]! *= invSY;
  m[6]! *= invSY;
  m[8]! *= invSZ;
  m[9]! *= invSZ;
  m[10]! *= invSZ;
  return { position, quaternion: quatFromRotationMatrix(m), scale: [sx, sy, sz] };
}

/**
 * Object3D.applyMatrix4 on a fresh object followed by updateMatrix():
 * the matrix is decomposed into position/quaternion/scale and recomposed (not bit-identical to M).
 */
export function recompose(m: Mat4, positionOverride?: [number, number, number]): Mat4 {
  const d = decompose(m);
  const p = positionOverride ?? d.position;
  return compose(p[0], p[1], p[2], d.quaternion, d.scale[0], d.scale[1], d.scale[2]);
}

/** Vector3.applyMatrix4 — writes into out[o..o+2]. */
export function applyMatrix4To(
  e: Mat4,
  x: number,
  y: number,
  z: number,
  out: Float64Array | number[],
  o = 0,
): void {
  const w = 1 / (e[3]! * x + e[7]! * y + e[11]! * z + e[15]!);
  out[o] = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * w;
  out[o + 1] = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * w;
  out[o + 2] = (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * w;
}

/** Box3.applyMatrix4: AABB of the 8 transformed corners (float64). Returns [minx,miny,minz,maxx,maxy,maxz]. */
export function box3ApplyMatrix4(
  e: Mat4,
  minx: number,
  miny: number,
  minz: number,
  maxx: number,
  maxy: number,
  maxz: number,
): Float64Array {
  const out = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  if (maxx < minx || maxy < miny || maxz < minz) {
    // empty box stays empty
    return new Float64Array([minx, miny, minz, maxx, maxy, maxz]);
  }
  const p = new Float64Array(3);
  for (let c = 0; c < 8; c++) {
    applyMatrix4To(e, c & 4 ? maxx : minx, c & 2 ? maxy : miny, c & 1 ? maxz : minz, p);
    // Box3.setFromPoints → expandByPoint → min.min(p), max.max(p) (Math.min/Math.max)
    out[0] = Math.min(out[0]!, p[0]!);
    out[1] = Math.min(out[1]!, p[1]!);
    out[2] = Math.min(out[2]!, p[2]!);
    out[3] = Math.max(out[3]!, p[0]!);
    out[4] = Math.max(out[4]!, p[1]!);
    out[5] = Math.max(out[5]!, p[2]!);
  }
  return out;
}

// -------------------------------------------------------------------------------------------
// Ray tests, specialised to the legacy ray: origin (ox, oy, oz), direction exactly (+0, +0, -1).
//
// With d = (+0, +0, -1) and finite operands, three's `d.dot(v)` = (0*vx + 0*vy) + (-1*vz) is
// exactly -vz, `sign * x` and `-sign * x` are exact, and `ray.at(t)` keeps x, y unchanged. The
// specialisation is therefore bit-identical to the generic r147 code (verified by tests).

/**
 * r147 `Ray.intersectTriangle(a, b, c, backfaceCulling = true)` followed by Mesh.raycast's
 * `distance = ray.origin.distanceTo(point)`. Returns the distance, or -1 when there is no hit.
 */
export function legacyVerticalRayTriangle(
  ox: number,
  oy: number,
  oz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const e1x = bx - ax,
    e1y = by - ay,
    e1z = bz - az;
  const e2x = cx - ax,
    e2y = cy - ay,
    e2z = cz - az;
  // normal = e1 × e2
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  // DdN = d·n = -nz
  let DdN = -nz;
  let sign: number;
  if (DdN > 0) {
    return -1; // backface culling (FrontSide material)
  } else if (DdN < 0) {
    sign = -1;
    DdN = -DdN;
  } else {
    return -1;
  }
  const qx = ox - ax,
    qy = oy - ay,
    qz = oz - az;
  // (Q × E2).z = qx*e2y - qy*e2x ; d·(Q×E2) = -(Q×E2).z
  const DdQxE2 = sign * -(qx * e2y - qy * e2x);
  if (DdQxE2 < 0) return -1;
  // (E1 × Q).z = e1x*qy - e1y*qx
  const DdE1xQ = sign * -(e1x * qy - e1y * qx);
  if (DdE1xQ < 0) return -1;
  if (DdQxE2 + DdE1xQ > DdN) return -1;
  const QdN = -sign * (qx * nx + qy * ny + qz * nz);
  if (QdN < 0) return -1;
  const t = QdN / DdN;
  // ray.at(t): z = (-1 * t) + oz ; distanceTo: sqrt(0 + 0 + dz*dz)
  const pz = -t + oz;
  const dz = oz - pz;
  return Math.sqrt(0 + 0 + dz * dz);
}

/** r147 `Ray.intersectsSphere(sphere)` for the legacy ray (raycaster.ray: direction (0, 0, -1)). */
export function legacyVerticalRayHitsSphere(
  ox: number,
  oy: number,
  oz: number,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
): boolean {
  // distanceSqToPoint(center)
  const vx = cx - ox,
    vy = cy - oy,
    vz = cz - oz;
  const directionDistance = 0 * vx + 0 * vy + -1 * vz;
  let d2: number;
  if (directionDistance < 0) {
    const dx = ox - cx,
      dy = oy - cy,
      dz = oz - cz;
    d2 = dx * dx + dy * dy + dz * dz;
  } else {
    // _vector.copy(direction).multiplyScalar(dd).add(origin)
    const px = 0 * directionDistance + ox;
    const py = 0 * directionDistance + oy;
    const pz = -1 * directionDistance + oz;
    const dx = px - cx,
      dy = py - cy,
      dz = pz - cz;
    d2 = dx * dx + dy * dy + dz * dz;
  }
  return d2 <= radius * radius;
}

/** r147 `Ray.intersectsBox(box)` for the legacy ray after `applyMatrix4(identity⁻¹)`: direction (+0, +0, -1). */
export function legacyVerticalRayHitsBox(
  ox: number,
  oy: number,
  oz: number,
  minx: number,
  miny: number,
  minz: number,
  maxx: number,
  maxy: number,
  maxz: number,
): boolean {
  let tmin: number, tmax: number;
  const invdirx = 1 / 0,
    invdiry = 1 / 0,
    invdirz = 1 / -1;
  // invdirx >= 0
  tmin = (minx - ox) * invdirx;
  tmax = (maxx - ox) * invdirx;
  const tymin = (miny - oy) * invdiry;
  const tymax = (maxy - oy) * invdiry;
  if (tmin > tymax || tymin > tmax) return false;
  if (tymin > tmin || isNaN(tmin)) tmin = tymin;
  if (tymax < tmax || isNaN(tmax)) tmax = tymax;
  // invdirz < 0
  const tzmin = (maxz - oz) * invdirz;
  const tzmax = (minz - oz) * invdirz;
  if (tmin > tzmax || tzmin > tmax) return false;
  // (three then updates tmin, only used for the hit point, not for the boolean result)
  if (tzmax < tmax || tmax !== tmax) tmax = tzmax;
  if (tmax < 0) return false;
  return true;
}
