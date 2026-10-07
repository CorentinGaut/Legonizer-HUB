/**
 * Architectural scale figures (3d-look.md §6, design-system §11): faceless and smooth, like the
 * white figures of an architecture model. Each body is one continuous volume (capsule chains of
 * equal radius at the joints, a shoulder cap blending arm and torso, a coat or jacket silhouette),
 * in a light matte warm grey. Poses are relaxed: arms close to the body, soft elbows, weight on one
 * leg; gestures stay below the shoulder (no stiff horizontal arms). No hands, faces or toy-like
 * features (SPEC N9).
 *
 * Three figures (storyboard 3a–3c): an adult in a coat holding the numeric keypad (front-left), a
 * child (front-centre-left) who receives it at 20.0–20.8 s, and an adult at the right end who
 * gestures toward a changed building. Only the arms that move are articulated; the rest of a
 * figure is one merged mesh (3 draws per figure).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fadeWithUniform } from './animMaterial.ts';
import { COLORS } from './constants.ts';
import { figuresAt, keypadLed, ramp, smooth, wrap } from '../timeline.ts';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Capsule of radius r from a to b. */
function capsule(a: THREE.Vector3, b: THREE.Vector3, r: number, radial = 14): THREE.BufferGeometry {
  const len = Math.max(0.0001, a.distanceTo(b));
  const g = new THREE.CapsuleGeometry(r, len, 5, radial);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/**
 * Smooth tapered limb from a to b with rounded ends: `radii` = [t, r] along the limb (t = 0 at a,
 * 1 at b). One piece, so knees and elbows show no joint.
 */
function limb(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radii: [number, number][],
  radial = 14,
): THREE.BufferGeometry {
  const L = a.distanceTo(b);
  const r0 = radii[0]![1],
    r1 = radii[radii.length - 1]![1];
  // LatheGeometry profile from bottom (b, z = 0) to top (a, z = L)
  const prof: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, -r1 * 0.92),
    new THREE.Vector2(r1 * 0.72, -r1 * 0.68),
  ];
  for (const [t, r] of [...radii].reverse()) prof.push(new THREE.Vector2(r, (1 - t) * L));
  prof.push(new THREE.Vector2(r0 * 0.72, L + r0 * 0.68), new THREE.Vector2(0.0001, L + r0 * 0.92));
  const g = new THREE.LatheGeometry(prof, radial);
  g.rotateX(Math.PI / 2); // axis y → z
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), a.clone().sub(b).normalize()));
  g.translate(b.x, b.y, b.z);
  return g;
}

/** Solid of revolution around z from a [radius, z] profile (bottom → top), squashed in depth. */
function lathe(profile: [number, number][], depth: number, segments = 24): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 0.0001), z)),
    segments,
  );
  g.rotateX(Math.PI / 2);
  g.scale(1, depth, 1);
  return g;
}

function ellipsoid(
  rx: number,
  ry: number,
  rz: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 20, 14);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
}

function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(n.attributes))
    if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
  return n;
}

interface ArmRig {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Object3D;
}

interface FigureRig {
  root: THREE.Group;
  fade: { value: number };
  arm: ArmRig;
  baseYaw: number;
}

interface FigureSpec {
  height: number;
  colour: string;
  movingArm: 'left' | 'right';
  outfit: 'coat' | 'jacket' | 'child';
}

const UPPER = 0.29;
const FORE = 0.25;
/** Arm pivots sit inside the shoulder volume so the arms grow out of the torso (no ball joints). */
const SHOULDER = { x: 0.148, z: 1.395 };
const ARM_R = [0.041, 0.035] as const;

function buildFigure(spec: FigureSpec): FigureRig {
  const fade = { value: 0 };
  const mat = fadeWithUniform(
    new THREE.MeshStandardMaterial({ color: spec.colour, roughness: 0.92, metalness: 0 }),
    fade,
    'figure',
  );
  const depth = fadeWithUniform(
    new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    fade,
    'figure-depth',
  );
  const child = spec.outfit === 'child';
  const parts: THREE.BufferGeometry[] = [];

  // legs: slender, straight, weight on the right leg, the left foot a little forward
  const LEG: [number, number][] = [
    [0, 0.066],
    [0.18, 0.062],
    [0.5, 0.049],
    [0.63, 0.053],
    [0.88, 0.039],
    [1, 0.037],
  ];
  parts.push(limb(V(0.074, 0, 0.87), V(0.084, -0.012, 0.07), LEG));
  parts.push(limb(V(-0.074, 0, 0.87), V(-0.092, 0.05, 0.075), LEG));
  parts.push(ellipsoid(0.04, 0.095, 0.032, 0.086, 0.035, 0.032));
  parts.push(ellipsoid(0.04, 0.095, 0.032, -0.096, 0.085, 0.034));
  // pelvis and torso, one smooth volume with sloping shoulders, leaning slightly toward the table
  const torso = lathe(
    [
      [0.0, 0.8],
      [0.11, 0.82],
      [0.148, 0.9],
      [0.143, 1.0],
      [0.13, 1.1],
      [0.14, 1.22],
      [0.156, 1.33],
      [0.15, 1.41],
      [0.112, 1.465],
      [0.05, 1.5],
      [0.0, 1.505],
    ],
    0.66,
  );
  torso.rotateX(0.03);
  parts.push(torso);
  if (spec.outfit === 'coat') {
    // a long coat: falls from the waist to just below the knee
    parts.push(
      lathe(
        [
          [0.165, 0.56],
          [0.163, 0.7],
          [0.152, 0.86],
          [0.138, 0.99],
          [0.0, 1.0],
        ],
        0.8,
      ),
    );
  } else if (spec.outfit === 'jacket') {
    parts.push(
      lathe(
        [
          [0.155, 0.8],
          [0.15, 0.88],
          [0.138, 1.0],
          [0.0, 1.01],
        ],
        0.76,
      ),
    );
  }
  // neck and head (no face), head slightly bowed toward the model
  parts.push(capsule(V(0, 0.01, 1.46), V(0, 0.018, 1.54), 0.044));
  const hk = child ? 1.18 : 1;
  parts.push(ellipsoid(0.071 * hk, 0.081 * hk, 0.098 * hk, 0, 0.024, 1.545 + 0.092 * hk));

  // the static arm, hanging relaxed close to the body, one smooth piece
  const staticSide = spec.movingArm === 'right' ? -1 : 1;
  const wrist = V(staticSide * 0.19, 0.045, SHOULDER.z - UPPER - FORE + 0.02);
  parts.push(
    limb(V(staticSide * SHOULDER.x, 0, SHOULDER.z + 0.02), wrist, [
      [0, ARM_R[0]],
      [0.5, ARM_R[1]],
      [0.6, ARM_R[1] + 0.002],
      [1, 0.029],
    ]),
  );
  parts.push(ellipsoid(0.026, 0.02, 0.046, wrist.x, wrist.y + 0.006, wrist.z - 0.035));

  const body = new THREE.Mesh(mergeGeometries(parts.map(clean))!, mat);
  body.castShadow = true;
  body.receiveShadow = true;
  body.customDepthMaterial = depth;
  const root = new THREE.Group();
  root.add(body);

  // the moving arm: shoulder → upper arm → elbow → forearm → hand anchor
  const side = spec.movingArm === 'right' ? 1 : -1;
  const shoulder = new THREE.Group();
  shoulder.position.set(side * SHOULDER.x, 0, SHOULDER.z);
  const upper = new THREE.Mesh(
    clean(
      limb(V(0, 0, 0.02), V(0, 0, -UPPER), [
        [0, ARM_R[0]],
        [1, ARM_R[1]],
      ]),
    ),
    mat,
  );
  const elbow = new THREE.Group();
  elbow.position.set(0, 0, -UPPER);
  const foreGeo = mergeGeometries([
    clean(
      limb(V(0, 0, 0), V(0, 0, -FORE), [
        [0, ARM_R[1]],
        [0.15, ARM_R[1] + 0.002],
        [1, 0.029],
      ]),
    ),
    clean(ellipsoid(0.027, 0.02, 0.046, 0, 0, -FORE - 0.035)),
  ])!;
  const fore = new THREE.Mesh(foreGeo, mat);
  const hand = new THREE.Object3D();
  hand.position.set(0, 0, -FORE - 0.05);
  for (const m of [upper, fore]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.customDepthMaterial = depth;
  }
  shoulder.add(upper, elbow);
  elbow.add(fore, hand);
  root.add(shoulder);
  root.scale.setScalar(spec.height / 1.75);
  return { root, fade, arm: { shoulder, elbow, hand }, baseYaw: 0 };
}

/** Arm pose: forward raise, sideways away from the body, elbow bend (radians). */
function pose(arm: ArmRig, side: 1 | -1, forward: number, out: number, elbow: number, twist = 0): void {
  arm.shoulder.rotation.set(forward, -side * out, twist);
  arm.elbow.rotation.set(elbow, 0, 0);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Figures {
  readonly group = new THREE.Group();
  private readonly adult: FigureRig;
  private readonly child: FigureRig;
  private readonly guide: FigureRig;
  private readonly keypad: THREE.Group;
  private readonly keypadFade = { value: 0 };
  private readonly ledMat: THREE.MeshBasicMaterial;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor() {
    this.group.name = 'figures';
    // positions and headings: 3d-look.md §6 (table frame; floor at z = −0.6); front = +y
    this.adult = buildFigure({ height: 1.74, colour: COLORS.figures[0], movingArm: 'right', outfit: 'coat' });
    this.adult.baseYaw = -0.18;
    this.child = buildFigure({ height: 1.24, colour: COLORS.figures[1], movingArm: 'left', outfit: 'child' });
    this.child.baseYaw = 0.1;
    this.guide = buildFigure({
      height: 1.68,
      colour: COLORS.figures[2],
      movingArm: 'right',
      outfit: 'jacket',
    });
    this.guide.baseYaw = Math.PI / 2 + 0.15; // faces −x, toward the model
    this.group.add(this.adult.root, this.child.root, this.guide.root);

    const kmat = fadeWithUniform(
      new THREE.MeshStandardMaterial({ color: COLORS.keypad, roughness: 0.4 }),
      this.keypadFade,
      'keypad',
    );
    this.keypad = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.13, 0.018), kmat);
    body.castShadow = true;
    this.ledMat = fadeWithUniform(
      new THREE.MeshBasicMaterial({ color: COLORS.led }),
      this.keypadFade,
      'keypad-led',
    );
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), this.ledMat);
    led.position.set(0, 0.045, 0.0095);
    this.keypad.add(body, led);
    this.group.add(this.keypad);
  }

  update(t: number): void {
    const u = wrap(t);
    const s = figuresAt(u);
    this.group.visible = s.fade.some((f) => f > 0);
    if (!this.group.visible) return;
    const [fa, fc, fg] = s.fade;
    this.adult.fade.value = fa;
    this.child.fade.value = fc;
    this.guide.fade.value = fg;
    // arrival: a short walk toward the table while fading in
    const arrive = (f: number) => (1 - smooth(f)) * 0.22;
    this.adult.root.position.set(-0.98, -0.86 - arrive(fa), -0.6);
    this.child.root.position.set(-0.36, -0.8 - arrive(fc), -0.6);
    this.guide.root.position.set(1.32 + arrive(fg), 0.08, -0.6);
    this.adult.root.rotation.z = this.adult.baseYaw + 0.12 * s.turn;
    this.child.root.rotation.z = this.child.baseYaw - 0.08 * s.turn;
    this.guide.root.rotation.z = this.guide.baseYaw - 0.1 * s.turn;

    // adult: keypad held at the waist; offers it to the child 20.0–20.8 s, arm back by 21.4 s
    const reach = smooth(ramp(u, 20.0, 20.5)) * (1 - smooth(ramp(u, 20.8, 21.4)));
    pose(this.adult.arm, 1, lerp(0.28, 0.62, reach), lerp(0.04, 0.42, reach), lerp(1.25, 0.55, reach));
    // child: arm down; reaches up 20.3–20.75 s, then holds the keypad in front and presses
    const take = smooth(ramp(u, 20.3, 20.75));
    const hold = s.handover >= 1 ? 1 : take;
    const press = s.childPress;
    pose(
      this.child.arm,
      -1,
      lerp(0.06, lerp(0.62, 0.42, press), hold),
      lerp(0.07, lerp(0.38, 0.1, press), take),
      lerp(0.2, lerp(0.6, 1.15, press), hold),
    );
    // guide: a calm gesture toward a changed building: forearm angled down, hand below the waist line
    pose(this.guide.arm, 1, lerp(0.05, 0.3, s.point), lerp(0.08, -0.06, s.point), lerp(0.2, 0.78, s.point));

    this.group.updateMatrixWorld(true);
    // keypad: in the adult's hand until the handover, then in the child's
    const handA = this.adult.arm.hand.getWorldPosition(this.tmpA);
    const handC = this.child.arm.hand.getWorldPosition(this.tmpB);
    const hv = smooth(ramp(u, 20.35, 20.75));
    this.keypad.position.lerpVectors(handA, handC, hv);
    this.keypad.position.z += 0.014;
    const yaw = lerp(this.adult.root.rotation.z, this.child.root.rotation.z, hv);
    this.keypad.rotation.set(-0.45, 0, yaw, 'ZXY');
    this.keypadFade.value = lerp(fa, fc, hv);
    const led = keypadLed(u);
    this.ledMat.color.set(COLORS.keypad).lerp(new THREE.Color(COLORS.led), 0.25 + 0.75 * led);
  }
}
