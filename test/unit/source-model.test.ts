/**
 * "Show source model" in step 4 rebuilt the ghost with a transform baked into the shared preview
 * positions, so the model shrank at every toggle and the step 2/3 view was corrupted too.
 */
import { describe, expect, it } from 'vitest';
import { Box3, Matrix4 } from 'three';
import { SourceModel } from '../../src/create/viewport/three/models.ts';
import type { MeshPreview } from '../../src/core/worker/protocol.ts';

function preview(): MeshPreview {
  // two triangles of a 30 m × 20 m roof at 12 m
  const positions = new Float32Array([0, 0, 12, 30, 0, 12, 30, 20, 12, 0, 0, 12, 30, 20, 12, 0, 20, 12]);
  return { origin: [1844000, 5175000, 170], positions, triFeature: new Int32Array([0, 0]) };
}

// metres → studs at 3 m per stud, 1 brick = 3.6 m, rotated 30°
const transform = new Matrix4()
  .makeRotationZ(Math.PI / 6)
  .premultiply(new Matrix4().makeScale(1 / 3, 1 / 3, 1.2 / 3.6))
  .setPosition(5, -2, 0);

function worldBox(m: SourceModel): Box3 {
  m.mesh.updateMatrixWorld(true);
  return new Box3().setFromObject(m.mesh);
}

describe('SourceModel ghost transform', () => {
  it('leaves the shared preview positions untouched', () => {
    const p = preview();
    const before = p.positions.slice();
    new SourceModel(p, { ghost: true, transform });
    expect(Array.from(p.positions)).toEqual(Array.from(before));
  });

  it('gives the same placement on every rebuild (toggle off and on)', () => {
    const p = preview();
    const first = worldBox(new SourceModel(p, { ghost: true, transform }));
    for (let i = 0; i < 5; i++) {
      const again = worldBox(new SourceModel(p, { ghost: true, transform }));
      expect(again.min.toArray()).toEqual(first.min.toArray());
      expect(again.max.toArray()).toEqual(first.max.toArray());
    }
  });

  it('places the ghost in stud space and the plain model in metres', () => {
    const p = preview();
    const ghost = worldBox(new SourceModel(p, { ghost: true, transform }));
    const plain = worldBox(new SourceModel(p));
    expect(plain.max.x).toBeCloseTo(30, 5);
    expect(ghost.max.z).toBeCloseTo(4, 5); // 12 m / 3.6 m per brick × 1.2 studs per brick
  });
});
