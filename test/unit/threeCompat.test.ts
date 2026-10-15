import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyMatrix4To,
  box3ApplyMatrix4,
  compose,
  legacyVerticalRayHitsBox,
  legacyVerticalRayHitsSphere,
  legacyVerticalRayTriangle,
  makeRotationX,
  multiply,
  quatFromEulerXYZ,
  recompose,
} from '../../src/core/util/threeCompat.ts';
import { THREE147, THREE154 } from '../helpers/threeVersions.ts';

const same = (a: number, b: number) => Object.is(a, b) || (a === b && a !== 0) || (a === 0 && b === 0);

describe('threeCompat matches three r147/r154 bit for bit', () => {
  it('ray/triangle distance equals r147 Raycaster on a Mesh (FrontSide)', () => {
    const T = THREE147;
    let hitCount = 0;
    const coord = fc.oneof(
      fc.double({ min: -50, max: 50, noNaN: true }),
      fc.integer({ min: -4, max: 4 }).map((v) => v * 0.5),
      fc.integer({ min: -4, max: 4 }).map((v) => v * 0.5),
      fc.double({ min: 5174000, max: 5174010, noNaN: true }).map(Math.fround),
    );
    fc.assert(
      fc.property(
        fc.array(coord, { minLength: 9, maxLength: 9 }),
        fc.array(
          fc.oneof(fc.constantFrom(0, 0.5, 1, 1 / 3), fc.double({ min: -0.2, max: 1.2, noNaN: true })),
          {
            minLength: 2,
            maxLength: 2,
          },
        ),
        fc.oneof(fc.constant(0), fc.double({ min: -5, max: 60, noNaN: true })),
        (v, w, dz) => {
          const [ax, ay, az, bx, by, bz, cx, cy, cz] = v as [
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
          ];
          const [u, t] = w as [number, number];
          // ray origin above a barycentric point of the triangle (edges, vertices, centroid, outside)
          const ox = ax + u * (bx - ax) + t * (1 - u) * (cx - ax);
          const oy = ay + u * (by - ay) + t * (1 - u) * (cy - ay);
          const oz = Math.max(az, bz, cz) + dz;
          const geom = new T.BufferGeometry();
          geom.setAttribute(
            'position',
            new T.BufferAttribute(new Float32Array([ax, ay, az, bx, by, bz, cx, cy, cz]), 3),
          );
          const pos = geom.attributes.position!.array as Float32Array;
          const mesh = new T.Mesh(geom);
          const ray = new T.Raycaster();
          ray.set(new T.Vector3(ox, oy, oz), new T.Vector3(0, 0, -1));
          const hits = ray.intersectObject(mesh);
          // sphere/box prefilters of Mesh.raycast are tested separately: compare only when they pass
          const ours = legacyVerticalRayTriangle(
            ox,
            oy,
            oz,
            pos[0]!,
            pos[1]!,
            pos[2]!,
            pos[3]!,
            pos[4]!,
            pos[5]!,
            pos[6]!,
            pos[7]!,
            pos[8]!,
          );
          if (hits.length > 0) {
            hitCount++;
            expect(ours).toBe(hits[0]!.distance);
          } else {
            // either we also miss, or three rejected the ray with its bounding sphere/box test
            geom.computeBoundingBox();
            geom.computeBoundingSphere();
            const s = geom.boundingSphere!;
            const b = geom.boundingBox!;
            const pre =
              legacyVerticalRayHitsSphere(ox, oy, oz, s.center.x, s.center.y, s.center.z, s.radius) &&
              legacyVerticalRayHitsBox(ox, oy, oz, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
            if (pre) expect(ours).toBe(-1);
          }
        },
      ),
      { numRuns: 6000, seed: 1234 },
    );
    expect(hitCount).toBeGreaterThan(200);
  });

  it('sphere and box prefilters equal r147 Ray methods', () => {
    const T = THREE147;
    const c = fc.oneof(fc.double({ min: -10, max: 10, noNaN: true }), fc.integer({ min: -2, max: 2 }));
    fc.assert(
      fc.property(fc.array(c, { minLength: 10, maxLength: 10 }), (v) => {
        const [ox, oy, oz, cx, cy, cz, r, ex, ey, ez] = v as [
          number,
          number,
          number,
          number,
          number,
          number,
          number,
          number,
          number,
          number,
        ];
        const ray = new T.Ray(new T.Vector3(ox, oy, oz), new T.Vector3(0, 0, -1));
        const sphere = new T.Sphere(new T.Vector3(cx, cy, cz), Math.abs(r));
        expect(legacyVerticalRayHitsSphere(ox, oy, oz, cx, cy, cz, Math.abs(r))).toBe(
          ray.intersectsSphere(sphere),
        );
        const box = new T.Box3(
          new T.Vector3(Math.min(cx, ex), Math.min(cy, ey), Math.min(cz, ez)),
          new T.Vector3(Math.max(cx, ex), Math.max(cy, ey), Math.max(cz, ez)),
        );
        // Mesh.raycast transforms the ray by the inverse of the (identity) world matrix first
        const local = ray.clone().applyMatrix4(new T.Matrix4().copy(new T.Matrix4()).invert());
        expect(
          legacyVerticalRayHitsBox(
            ox,
            oy,
            oz,
            box.min.x,
            box.min.y,
            box.min.z,
            box.max.x,
            box.max.y,
            box.max.z,
          ),
        ).toBe(local.intersectsBox(box));
      }),
      { numRuns: 3000, seed: 99 },
    );
  });

  it('matrix compose / multiply / decompose / applyMatrix4 / Box3.applyMatrix4 equal r154', () => {
    const T = THREE154;
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1e6, max: 6e6, noNaN: true }), { minLength: 3, maxLength: 3 }),
        fc.double({ min: -7, max: 7, noNaN: true }),
        fc.array(fc.double({ min: 0.1, max: 3000, noNaN: true }), { minLength: 3, maxLength: 3 }),
        fc.array(fc.double({ min: -1000, max: 1000, noNaN: true }), { minLength: 3, maxLength: 3 }),
        (p, rz, s, v) => {
          const obj = new T.Object3D();
          obj.position.set(p[0]!, p[1]!, p[2]!);
          obj.rotation.set(0, 0, rz);
          obj.scale.set(s[0]!, s[1]!, s[2]!);
          obj.updateMatrix();
          const ours = compose(p[0]!, p[1]!, p[2]!, quatFromEulerXYZ(0, 0, rz), s[0]!, s[1]!, s[2]!);
          obj.matrix.elements.forEach((e, i) => expect(same(e, ours[i]!)).toBe(true));
          const vec = new T.Vector3(v[0], v[1], v[2]).applyMatrix4(obj.matrix);
          const out = [0, 0, 0];
          applyMatrix4To(ours, v[0]!, v[1]!, v[2]!, out);
          expect(out).toEqual([vec.x, vec.y, vec.z]);
          // Object3D.applyMatrix4 (decompose + compose) of a rotation about X then a translation
          const rx = new T.Matrix4().makeRotationX(Math.PI / 2);
          const o2 = new T.Object3D();
          o2.applyMatrix4(rx);
          o2.updateMatrix();
          const ours2 = recompose(makeRotationX(Math.PI / 2));
          o2.matrix.elements.forEach((e, i) => expect(same(e, ours2[i]!)).toBe(true));
          const prod = new T.Matrix4().multiplyMatrices(obj.matrix, o2.matrix);
          multiply(ours, ours2).forEach((e, i) => expect(same(e, prod.elements[i]!)).toBe(true));
          const box = new T.Box3(
            new T.Vector3(-v[0]! - 1, -2, -3),
            new T.Vector3(Math.abs(v[0]!), 5, 6),
          ).applyMatrix4(obj.matrix);
          const b = box3ApplyMatrix4(ours, -v[0]! - 1, -2, -3, Math.abs(v[0]!), 5, 6);
          expect([...b]).toEqual([box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]);
        },
      ),
      { numRuns: 500, seed: 7 },
    );
  });
});
