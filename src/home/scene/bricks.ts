/**
 * Baseplates, bricks and studs of the home model as three instanced draws:
 * bricks are the packed bricks of the fixture (not stud columns), studs sit on the exposed column
 * tops and the empty plate cells only. All motion is in the shader (animMaterial.ts).
 */
import * as THREE from 'three';
import { animateInstances, type AnimUniforms } from './animMaterial.ts';
import { BRICK_H, COLORS, GAP, MODEL_X0, MODEL_Y0, PITCH, PLATE_T, STUD_H, STUD_R } from './constants.ts';
import type { HomeModel } from './model.ts';
import { brickDropStart, brickLiftStart, plateSlideIn, plateSlideOut } from '../timeline.ts';

export interface BrickMeshes {
  group: THREE.Group;
  bricks: THREE.InstancedMesh;
  studs: THREE.InstancedMesh;
  plates: THREE.InstancedMesh;
  /** Statistics for the report and tests. */
  stats: { bricks: number; studs: number; plates: number; triangles: number };
}

/** Open-bottom stud (sides + top cap), axis z, base at z = −STUD_H/2. */
function studGeometry(segments: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const h = STUD_H / 2;
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    const c = Math.cos(a),
      sn = Math.sin(a);
    pos.push(STUD_R * c, STUD_R * sn, -h, STUD_R * c, STUD_R * sn, h);
    nor.push(c, sn, 0, c, sn, 0);
  }
  for (let s = 0; s < segments; s++) {
    const a = 2 * s;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const centre = pos.length / 3;
  pos.push(0, 0, h);
  nor.push(0, 0, 1);
  const ring = pos.length / 3;
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    pos.push(STUD_R * Math.cos(a), STUD_R * Math.sin(a), h);
    nor.push(0, 0, 1);
  }
  for (let s = 0; s < segments; s++) idx.push(centre, ring + s, ring + s + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function depthMaterial(uniforms: AnimUniforms, key: string): THREE.MeshDepthMaterial {
  return animateInstances(
    new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    uniforms,
    `${key}-depth`,
  );
}

export function buildBrickMeshes(
  model: HomeModel,
  uniforms: AnimUniforms,
  opts: { studSegments?: number } = {},
): BrickMeshes {
  const { cols, rows, maxLayer, heights, bricks } = model;
  const plateCount = model.platesX * model.platesY;
  const group = new THREE.Group();
  group.name = 'brick-model';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();

  // ---------------------------------------------------------------- baseplates
  const plateMat = animateInstances(
    new THREE.MeshStandardMaterial({ color: COLORS.baseplate, roughness: 0.55 }),
    uniforms,
    'plate',
  );
  const plates = new THREE.InstancedMesh(
    new THREE.BoxGeometry(32 * PITCH - 0.0004, 32 * PITCH - 0.0004, PLATE_T),
    plateMat,
    plateCount,
  );
  const plateAnim = new Float32Array(plateCount * 4);
  for (let row = 0; row < model.platesY; row++) {
    for (let col = 0; col < model.platesX; col++) {
      const order = row * model.platesX + col;
      const southRow = model.platesY - 1 - row;
      v.set(MODEL_X0 + (col * 32 + 16) * PITCH, MODEL_Y0 + (southRow * 32 + 16) * PITCH, -PLATE_T / 2);
      plates.setMatrixAt(order, m.compose(v, q, s.set(1, 1, 1)));
      plateAnim.set([1, plateSlideIn(order), plateSlideOut(order, plateCount), 0], order * 4);
    }
  }
  plates.geometry.setAttribute('aAnim', new THREE.InstancedBufferAttribute(plateAnim, 4));
  plates.customDepthMaterial = depthMaterial(uniforms, 'plate');
  plates.castShadow = true;
  plates.receiveShadow = true;
  plates.frustumCulled = false;
  group.add(plates);

  // ---------------------------------------------------------------- bricks
  const brickMat = animateInstances(
    new THREE.MeshStandardMaterial({ color: COLORS.brick, roughness: 0.34, metalness: 0 }),
    uniforms,
    'brick',
  );
  const brickMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), brickMat, bricks.length);
  const brickAnim = new Float32Array(bricks.length * 4);
  // top brick of every column, for the studs
  const topOf = new Int32Array(cols * rows).fill(-1);
  bricks.forEach((b, n) => {
    v.set(
      MODEL_X0 + (b.gx + b.w / 2) * PITCH,
      MODEL_Y0 + (b.gy + b.d / 2) * PITCH,
      (b.layer - 0.5) * BRICK_H,
    );
    s.set(b.w * PITCH - GAP, b.d * PITCH - GAP, BRICK_H - 0.00012);
    brickMesh.setMatrixAt(n, m.compose(v, q, s));
    const xFrac = (b.gx + b.w / 2) / cols;
    brickAnim.set(
      [0, brickDropStart(b.layer, xFrac, maxLayer), brickLiftStart(b.layer, xFrac, maxLayer), 0],
      n * 4,
    );
    for (let y = b.gy; y < b.gy + b.d; y++)
      for (let x = b.gx; x < b.gx + b.w; x++) if (heights[y * cols + x] === b.layer) topOf[y * cols + x] = n;
  });
  brickMesh.geometry.setAttribute('aAnim', new THREE.InstancedBufferAttribute(brickAnim, 4));
  brickMesh.customDepthMaterial = depthMaterial(uniforms, 'brick');
  brickMesh.castShadow = true;
  brickMesh.receiveShadow = true;
  brickMesh.frustumCulled = false;
  group.add(brickMesh);

  // ---------------------------------------------------------------- studs
  const studCount = cols * rows;
  const studMat = animateInstances(
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0 }),
    uniforms,
    'stud',
  );
  const studGeo = studGeometry(opts.studSegments ?? 8);
  const studs = new THREE.InstancedMesh(studGeo, studMat, studCount);
  const studAnim = new Float32Array(studCount * 4);
  const white = new THREE.Color(COLORS.brick);
  const grey = new THREE.Color(COLORS.baseplate);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = j * cols + i;
      const h = heights[c]!;
      const n = j * cols + i;
      const top = topOf[c]!;
      v.set(MODEL_X0 + (i + 0.5) * PITCH, MODEL_Y0 + (j + 0.5) * PITCH, h * BRICK_H + STUD_H / 2);
      studs.setMatrixAt(n, m.compose(v, q, s.set(1, 1, 1)));
      if (h > 0 && top >= 0) {
        studAnim.set([0, brickAnim[top * 4 + 1]!, brickAnim[top * 4 + 2]!, 0], n * 4);
        studs.setColorAt(n, white);
      } else {
        const order = (model.platesY - 1 - Math.floor(j / 32)) * model.platesX + Math.floor(i / 32);
        studAnim.set([1, plateSlideIn(order), plateSlideOut(order, plateCount), 0], n * 4);
        studs.setColorAt(n, grey);
      }
    }
  }
  studs.geometry.setAttribute('aAnim', new THREE.InstancedBufferAttribute(studAnim, 4));
  studs.castShadow = false; // 1.7 mm studs: invisible shadows at room scale, a third of the triangles
  studs.receiveShadow = true;
  studs.frustumCulled = false;
  group.add(studs);

  const triangles = 12 * (bricks.length + plateCount) + (studGeo.index!.count / 3) * studCount;
  return {
    group,
    bricks: brickMesh,
    studs,
    plates,
    stats: { bricks: bricks.length, studs: studCount, plates: plateCount, triangles },
  };
}
