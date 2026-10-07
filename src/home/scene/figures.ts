/**
 * Scale figures of the home animation (storyboard 3a–3c, SPEC N9): stylized, faceless people in
 * the manner of architectural-visualisation entourage, so they read as people at a glance without
 * evoking toy figures. Real proportions (adults ≈ 7.4 heads tall, the child ≈ 5.7), a neck,
 * sloping shoulders, a waist, mitten hands, simple hair volumes and clothing blocks in a muted
 * palette; no cylinder heads, studs, C-shaped hands or yellow skin.
 *
 * - Adult with the keypad (front-left): long belted camel coat, slate-blue scarf, charcoal
 *   trousers, dark ankle boots, chestnut hair in a bun. Holds the keypad at waist height with both
 *   hands, turns and hands it to the child at 20.0–20.8 s, then lets her arms hang.
 * - Child (front-centre-left): dusty-blue hoodie with its hood down, sand backpack, jeans, light
 *   sneakers, short dark hair. Looks at the model, reaches for the keypad, then holds it with both
 *   hands and presses.
 * - Adult at the right end: mauve sweater over a white collar, navy chinos, brown shoes, short grey
 *   hair. Indicates a changed building with an open hand, forearm 38° below the horizontal.
 *
 * Colours are mid-light and desaturated: readable in the dark room, away from the projected change
 * colours (green, red, yellow). Each figure is ONE skinned mesh: all its parts are built into one
 * indexed geometry, clothing colours are vertex colours on one material and every vertex is bound
 * rigidly to one of six bones (hips, head, shoulders, elbows), so a figure costs one draw call per
 * pass. Arms are posed every frame by a two-bone IK from wrist targets; heads turn toward what the
 * figure looks at. Every pose is a pure function of the loop time (timeline.ts `figuresAt`).
 */
import * as THREE from 'three';
import { fadeWithUniform } from './animMaterial.ts';
import { COLORS } from './constants.ts';
import { figuresAt, keypadLed, ramp, smooth, wrap } from '../timeline.ts';

type Vec3 = THREE.Vector3;
const V = (x: number, y: number, z: number): Vec3 => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const DEG = Math.PI / 180;

/** Figure colours (sRGB). Muted and mid-light; no green, red or yellow; skin tones not yellow. */
const PALETTE = {
  adult: {
    skin: '#c9a08b',
    hair: '#5a3a2b',
    coat: '#a08a72',
    belt: '#8c7761',
    scarf: '#5d7795',
    trousers: '#3e414a',
    shoes: '#392c25',
  },
  child: {
    skin: '#8d5d47',
    hair: '#2e2622',
    hoodie: '#86a1c2',
    rib: '#738dad',
    jeans: '#4b5c7a',
    shoes: '#dedbd4',
    sole: '#8a8782',
    bag: '#b7a386',
    strap: '#8f7e66',
  },
  guide: {
    skin: '#c19883',
    hair: '#a29d97',
    sweater: '#8c7888',
    rib: '#7a6877',
    collar: '#e6e5e1',
    trousers: '#3b4559',
    shoes: '#4a3529',
  },
} as const;

// ------------------------------------------------------------------------------------- geometry

/** The geometry of one figure: indexed triangles with a colour and a bone per vertex. */
class Mesher {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly bones: number[] = [];
  private readonly idx: number[] = [];
  private readonly c = new THREE.Color();
  private bone = 0;

  /** Colour (sRGB) and bone of the parts that follow. */
  use(colour: string, bone: number): this {
    this.c.set(colour); // converted to the linear working space, as the shader expects
    this.bone = bone;
    return this;
  }

  get count(): number {
    return this.pos.length / 3;
  }

  vertex(x: number, y: number, z: number): void {
    this.pos.push(x, y, z);
    this.col.push(this.c.r, this.c.g, this.c.b);
    this.bones.push(this.bone);
  }

  copy(i: number): void {
    this.vertex(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  build(): THREE.BufferGeometry {
    const n = this.count;
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      skinIndex[i * 4] = this.bones[i]!;
      skinWeight[i * 4] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals(); // parts share no vertices: each keeps its own smooth normals
    return g;
  }
}

/** How a ring sequence is closed at one end: a fan to a pole (flat: on its own rim copy). */
type Cap = { at: Vec3; flat?: boolean } | null;

const _v = new THREE.Vector3();

/**
 * Surface through `n` rings of `seg` vertices (`at(i, j, out)`), each ring counter-clockwise seen
 * from its successor's side; quads between consecutive rings, optional caps at both ends, or a
 * closed loop.
 */
function rings(
  m: Mesher,
  n: number,
  seg: number,
  at: (i: number, j: number, out: Vec3) => void,
  start: Cap,
  end: Cap,
  loop = false,
): void {
  const base = m.count;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < seg; j++) {
      at(i, j, _v);
      m.vertex(_v.x, _v.y, _v.z);
    }
  const v = (i: number, j: number) => base + (i % n) * seg + (j % seg);
  for (let i = 0; i < (loop ? n : n - 1); i++)
    for (let j = 0; j < seg; j++) {
      m.tri(v(i, j), v(i, j + 1), v(i + 1, j + 1));
      m.tri(v(i, j), v(i + 1, j + 1), v(i + 1, j));
    }
  const cap = (ring: number, c: Cap, top: boolean) => {
    if (!c) return;
    let rim = v(ring, 0);
    if (c.flat) {
      const copy = m.count;
      for (let j = 0; j < seg; j++) m.copy(rim + j);
      rim = copy;
    }
    const pole = m.count;
    m.vertex(c.at.x, c.at.y, c.at.z);
    for (let j = 0; j < seg; j++) {
      const a = rim + j,
        b = rim + ((j + 1) % seg);
      if (top) m.tri(pole, a, b);
      else m.tri(pole, b, a);
    }
  };
  cap(0, start, false);
  cap(n - 1, end, true);
}

/** Unit sphere (poles on z) deformed point by point by `shape`; no seam, so normals are smooth. */
function blob(m: Mesher, seg: [number, number], shape: (p: Vec3) => void): void {
  const [W, H] = seg;
  const pole = (z: number) => {
    const p = V(0, 0, z);
    shape(p);
    return p;
  };
  rings(
    m,
    H - 1,
    W,
    (i, j, out) => {
      const th = Math.PI * (1 - (i + 1) / H),
        phi = (j / W) * Math.PI * 2;
      shape(out.set(Math.sin(th) * Math.cos(phi), Math.sin(th) * Math.sin(phi), Math.cos(th)));
    },
    { at: pole(-1) },
    { at: pole(1) },
  );
}

function ellipsoid(
  m: Mesher,
  r: [number, number, number],
  c: Vec3,
  seg: [number, number] = [12, 8],
  rot?: THREE.Euler,
): void {
  blob(m, seg, (p) => {
    p.set(p.x * r[0], p.y * r[1], p.z * r[2]);
    if (rot) p.applyEuler(rot);
    p.add(c);
  });
}

/** Rounded box (superellipsoid): `e` < 1 squares it off; `floor` flattens the bottom (−1…0). */
function roundedBox(
  m: Mesher,
  size: [number, number, number],
  c: Vec3,
  opts: { e?: number; rot?: THREE.Euler; floor?: number } = {},
): void {
  const e = opts.e ?? 0.45;
  const sq = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
  blob(m, [12, 8], (p) => {
    p.set(
      (sq(p.x) * size[0]) / 2,
      (sq(p.y) * size[1]) / 2,
      (Math.max(sq(p.z), opts.floor ?? -1) * size[2]) / 2,
    );
    if (opts.rot) p.applyEuler(opts.rot);
    p.add(c);
  });
}

/** Torus of radius R and thickness r around z, tilted by `rot` and centred on c (scarf, collar). */
function torus(m: Mesher, R: number, r: number, c: Vec3, rot: THREE.Euler, seg: [number, number]): void {
  const [n, radial] = seg;
  rings(
    m,
    n,
    radial,
    (i, j, out) => {
      const a = (i / n) * Math.PI * 2,
        f = (j / radial) * Math.PI * 2;
      // ring frame: n = radial (cos a, sin a, 0), b = t × n = (0, 0, −1)
      const k = R + r * Math.cos(f);
      out
        .set(k * Math.cos(a), k * Math.sin(a), -r * Math.sin(f))
        .applyEuler(rot)
        .add(c);
    },
    null,
    null,
    true,
  );
}

interface Ring {
  z: number;
  rx: number;
  ry: number;
  x?: number;
  y?: number;
}

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 *
  (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3);

/**
 * Body of horizontal elliptical rings (bottom → top), interpolated with a Catmull-Rom spline
 * (`sub` steps per interval) for a smooth silhouette; flat-capped ends (coat, sweater, belt…).
 */
function loft(m: Mesher, key: Ring[], seg = 20, sub = 2): void {
  const k = key.map((r) => [r.z, r.rx, r.ry, r.x ?? 0, r.y ?? 0]);
  const dense: number[][] = [];
  for (let i = 0; i + 1 < k.length; i++) {
    const p0 = k[Math.max(0, i - 1)]!,
      p1 = k[i]!,
      p2 = k[i + 1]!,
      p3 = k[Math.min(k.length - 1, i + 2)]!;
    for (let s = 0; s < sub; s++) dense.push(p1.map((_, n) => cr(p0[n]!, p1[n]!, p2[n]!, p3[n]!, s / sub)));
  }
  dense.push(k[k.length - 1]!);
  const first = dense[0]!,
    last = dense[dense.length - 1]!;
  rings(
    m,
    dense.length,
    seg,
    (i, j, out) => {
      const r = dense[i]!;
      const a = (j / seg) * Math.PI * 2;
      out.set(r[3]! + r[1]! * Math.cos(a), r[4]! + r[2]! * Math.sin(a), r[0]!);
    },
    { at: V(first[3]!, first[4]!, first[0]!), flat: true },
    { at: V(last[3]!, last[4]!, last[0]!), flat: true },
  );
}

/**
 * Tube along a smooth curve through `pts` with a radius per point (limbs, neck, straps):
 * Catmull-Rom centre line, frames carried along by projection, rounded ends.
 */
function sweep(m: Mesher, pts: Vec3[], radii: number[], radial = 10, perSeg = 3): void {
  const last = pts.length - 1;
  const n = last * perSeg;
  const P: Vec3[] = [];
  const R: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * last;
    const k = Math.min(Math.floor(s), last - 1);
    const t = s - k;
    const p0 = pts[Math.max(0, k - 1)]!,
      p1 = pts[k]!,
      p2 = pts[k + 1]!,
      p3 = pts[Math.min(last, k + 2)]!;
    P.push(V(cr(p0.x, p1.x, p2.x, p3.x, t), cr(p0.y, p1.y, p2.y, p3.y, t), cr(p0.z, p1.z, p2.z, p3.z, t)));
    R.push(radii[k]! + (radii[k + 1]! - radii[k]!) * smooth(t));
  }
  const T = P.map((_, i) =>
    P[Math.min(n, i + 1)]!.clone()
      .sub(P[Math.max(0, i - 1)]!)
      .normalize(),
  );
  const frames: { c: Vec3; r: number; n: Vec3; b: Vec3 }[] = [];
  let N = Math.abs(T[0]!.x) < 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  for (let i = 0; i <= n; i++) {
    const t = T[i]!;
    N = N.clone().addScaledVector(t, -N.dot(t)).normalize();
    frames.push({ c: P[i]!, r: R[i]!, n: N, b: t.clone().cross(N) });
  }
  // rounded ends: one smaller ring and a pole beyond each end
  const f0 = frames[0]!,
    f1 = frames[n]!;
  const t0 = T[0]!,
    t1 = T[n]!;
  frames.unshift({ ...f0, c: f0.c.clone().addScaledVector(t0, -0.55 * f0.r), r: 0.83 * f0.r });
  frames.push({ ...f1, c: f1.c.clone().addScaledVector(t1, 0.55 * f1.r), r: 0.83 * f1.r });
  rings(
    m,
    frames.length,
    radial,
    (i, j, out) => {
      const f = frames[i]!;
      const a = (j / radial) * Math.PI * 2;
      out
        .copy(f.c)
        .addScaledVector(f.n, Math.cos(a) * f.r)
        .addScaledVector(f.b, Math.sin(a) * f.r);
    },
    { at: f0.c.clone().addScaledVector(t0, -f0.r) },
    { at: f1.c.clone().addScaledVector(t1, f1.r) },
  );
}

// ---------------------------------------------------------------------------------------- bodies

const BONE = { hips: 0, head: 1, shoulderR: 2, elbowR: 3, shoulderL: 4, elbowL: 5 } as const;

interface BodySpec {
  /** Head radii (x, y, z) and centre; the neck's top is the head pivot. */
  head: [number, number, number];
  headC: Vec3;
  neck: { r: number; z0: number; z1: number };
  shoulder: { x: number; z: number; r: number };
  arm: { L1: number; L2: number; rE: number; rW: number; hand: number; out: number };
  hip: { x: number; z: number };
  knee: number;
  ankle: number;
  /** Trouser-leg radii: hip, mid-thigh, knee, calf, hem. */
  leg: [number, number, number, number, number];
  shoe: [number, number, number];
  /** +1: weight on the right leg (the left knee relaxed), −1 the other way. */
  weight: 1 | -1;
}

interface Look {
  skin: string;
  hair: string;
  sleeve: string;
  cuff: string;
  trousers: string;
  shoes: string;
  sole?: string;
}

/**
 * Hair cap: thickness (scale of the skull; `crown` more on top) and the hairline as polar angles
 * from the top of the head (degrees) at the forehead, the temples, above the ears and the nape.
 */
interface HairSpec {
  grow: number;
  crown: number;
  front: number;
  temple: number;
  side: number;
  back: number;
}

/**
 * Hair as a cap of rings from the hairline up to the crown, so its edge follows the hairline
 * exactly; at full thickness down to a short lip that drops into the head, which leaves a clean
 * line on the skin.
 */
function hairCap(m: Mesher, skull: (p: Vec3, chin: boolean) => Vec3, C: Vec3, h: HairSpec): void {
  const NA = 28;
  const line = (phi: number) => {
    const a = Math.acos(clamp(Math.sin(phi), -1, 1)) / DEG; // 0 at the front (+y) … 180 at the back
    const t =
      a < 45
        ? h.front + (h.temple - h.front) * smooth(a / 45)
        : a < 90
          ? h.temple + (h.side - h.temple) * smooth((a - 45) / 45)
          : h.side + (h.back - h.side) * smooth((a - 90) / 90);
    return t * DEG;
  };
  const rows = [1, 0.985, 0.945, 0.88, 0.79, 0.68, 0.55, 0.41, 0.27, 0.13]; // hairline → crown
  const thick = (s: number) => (s >= 1 ? 0.9 : h.grow + h.crown * Math.max(0, 1 - s / 0.8) ** 2);
  rings(
    m,
    rows.length,
    NA,
    (i, j, out) => {
      const s = rows[i]!;
      const phi = (j / NA) * Math.PI * 2;
      const th = s * line(phi);
      out.set(Math.sin(th) * Math.cos(phi), Math.sin(th) * Math.sin(phi), Math.cos(th));
      skull(out, false).multiplyScalar(thick(s)).add(C);
    },
    null,
    {
      at: skull(V(0, 0, 1), false)
        .multiplyScalar(thick(0))
        .add(C),
    },
  );
}

interface Arm {
  shoulder: THREE.Bone;
  elbow: THREE.Bone;
  side: 1 | -1;
  L1: number;
  L2: number;
  /** Relaxed wrist position and elbow pole (figure frame). */
  rest: Vec3;
  restPole: Vec3;
}

interface Rig {
  root: THREE.Group;
  fade: { value: number };
  head: THREE.Bone;
  right: Arm;
  left: Arm;
  baseYaw: number;
}

function buildPerson(b: BodySpec, look: Look, hair: HairSpec, dress: (m: Mesher) => void): Rig {
  const m = new Mesher();
  const [hx, hy, hz] = b.head;
  const C = b.headC;

  // head: fuller at the back, narrower at the jaw; faceless
  const skull = (p: Vec3, chin: boolean): Vec3 => {
    const jaw = p.z < 0 ? 1 - 0.2 * Math.pow(-p.z, 1.6) : 1;
    const back = p.y < 0 ? 1.04 : 1;
    const front = chin ? 1 - 0.06 * smooth((-p.z - 0.2) / 0.4) * Math.max(0, p.y) : 1;
    return p.set(p.x * hx * jaw, p.y * hy * back * front, p.z * hz);
  };
  m.use(look.skin, BONE.head);
  blob(m, [20, 14], (p) => {
    skull(p, true).add(C);
  });
  m.use(look.hair, BONE.head);
  hairCap(m, skull, C, hair);
  m.use(look.skin, BONE.hips);
  sweep(m, [V(0, -0.006, b.neck.z0), V(0, 0, b.neck.z1)], [b.neck.r, b.neck.r * 0.94], 10, 1);

  // arms in the bind pose (straight down); the sleeve's rounded top is centred on the shoulder
  // pivot and an elbow ball closes the elbow, so the joints stay closed in every pose
  for (const side of [1, -1] as const) {
    const sb = side === 1 ? BONE.shoulderR : BONE.shoulderL;
    const eb = side === 1 ? BONE.elbowR : BONE.elbowL;
    const S = V(side * b.shoulder.x, 0, b.shoulder.z);
    const E = V(S.x, 0, S.z - b.arm.L1);
    const W = V(S.x, 0, E.z - b.arm.L2);
    m.use(look.sleeve, sb);
    sweep(m, [S, E], [b.shoulder.r, b.arm.rE], 10, 2);
    m.use(look.sleeve, eb);
    ellipsoid(m, [b.arm.rE, b.arm.rE, b.arm.rE], E, [10, 6]);
    sweep(m, [E, V(W.x, 0, W.z + 0.012)], [b.arm.rE, b.arm.rW], 10, 2);
    m.use(look.cuff, eb);
    const rc = b.arm.rW * 1.1;
    sweep(m, [V(W.x, 0, W.z + 0.02), V(W.x, 0, W.z - 0.002)], [rc, rc], 10, 1);
    // mitten: palm toward the body (thin across x), tapering to the fingertips; thumb forward
    const L = b.arm.hand;
    const H = V(W.x, 0.002, W.z - L * 0.33);
    const sq = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.7);
    m.use(look.skin, eb);
    blob(m, [10, 8], (p) => {
      const tip = Math.max(0, -p.z); // thinner and narrower toward the fingertips
      p.set(sq(p.x) * L * 0.085 * (1 - 0.35 * tip), sq(p.y) * L * 0.2 * (1 - 0.18 * tip), p.z * L * 0.36);
      p.add(H);
    });
    ellipsoid(
      m,
      [L * 0.065, L * 0.07, L * 0.19],
      V(W.x - side * L * 0.035, L * 0.15, W.z - L * 0.24),
      [8, 6],
      new THREE.Euler(0.4, 0, 0),
    );
  }

  // legs: the weight leg straight under the hip, the other knee relaxed forward, toes out
  const shift = 0.02 * b.weight;
  for (const side of [1, -1] as const) {
    const w = side === b.weight;
    const hx0 = side * b.hip.x;
    const hip = V(hx0 + shift, 0, b.hip.z - (w ? 0 : 0.018));
    const knee = w ? V(hx0 * 0.86 + shift, 0.004, b.knee) : V(hx0 * 1.02, 0.065, b.knee + 0.008);
    const ankle = w ? V(hx0 * 0.74, -0.012, b.ankle) : V(hx0 * 1.32, 0.05, b.ankle + 0.014);
    const mid = hip.clone().lerp(knee, 0.5);
    const calf = knee
      .clone()
      .lerp(ankle, 0.35)
      .add(V(0, -0.008, 0));
    m.use(look.trousers, BONE.hips);
    sweep(m, [hip, mid, knee, calf, ankle], b.leg, 12, 3);
    const rot = new THREE.Euler(0, 0, -side * (w ? 0.1 : 0.28));
    const [sw, sl, sh] = b.shoe;
    const fwd = V(0, sl * 0.24, 0).applyEuler(rot);
    const base = V(ankle.x + fwd.x, ankle.y + fwd.y, w ? 0 : 0.004);
    m.use(look.shoes, BONE.hips);
    roundedBox(m, [sw, sl, sh], V(base.x, base.y, base.z + sh * 0.42), { e: 0.5, rot, floor: -0.75 });
    if (look.sole) {
      m.use(look.sole, BONE.hips);
      roundedBox(m, [sw * 1.04, sl * 1.02, sh * 0.3], V(base.x, base.y, base.z + sh * 0.1), { e: 0.35, rot });
    }
  }

  dress(m);

  const fade = { value: 0 };
  const mat = fadeWithUniform(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 }),
    fade,
    'figure',
  );
  const depth = fadeWithUniform(
    new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    fade,
    'figure-depth',
  );
  const hips = new THREE.Bone();
  const head = new THREE.Bone();
  head.position.set(0, 0, b.neck.z1);
  hips.add(head);
  const arm = (side: 1 | -1): Arm => {
    const shoulder = new THREE.Bone();
    shoulder.position.set(side * b.shoulder.x, 0, b.shoulder.z);
    const elbow = new THREE.Bone();
    elbow.position.set(0, 0, -b.arm.L1);
    shoulder.add(elbow);
    hips.add(shoulder);
    const reach = (b.arm.L1 + b.arm.L2) * 0.96;
    return {
      shoulder,
      elbow,
      side,
      L1: b.arm.L1,
      L2: b.arm.L2,
      rest: V(side * (b.shoulder.x + b.arm.out), 0.05, b.shoulder.z - reach),
      restPole: V(side * 0.35, -1, 0).normalize(),
    };
  };
  const right = arm(1);
  const left = arm(-1);
  const mesh = new THREE.SkinnedMesh(m.build(), mat);
  mesh.add(hips);
  mesh.bind(new THREE.Skeleton([hips, head, right.shoulder, right.elbow, left.shoulder, left.elbow]));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = depth;
  mesh.frustumCulled = false; // poses move the arms outside the bind-pose bounds
  const root = new THREE.Group();
  root.add(mesh);
  return { root, fade, head, right, left, baseYaw: 0 };
}

/** Adult with the keypad: long belted coat, scarf, hair in a bun. */
function buildAdult(): Rig {
  const c = PALETTE.adult;
  const s = 0.012; // hips toward the weight leg
  return buildPerson(
    {
      head: [0.074, 0.093, 0.111],
      headC: V(0, 0.006, 1.586),
      neck: { r: 0.046, z0: 1.4, z1: 1.513 },
      shoulder: { x: 0.158, z: 1.36, r: 0.047 },
      arm: { L1: 0.3, L2: 0.245, rE: 0.043, rW: 0.037, hand: 0.17, out: 0.085 },
      hip: { x: 0.084, z: 0.88 },
      knee: 0.47,
      ankle: 0.075,
      leg: [0.074, 0.063, 0.047, 0.05, 0.042],
      shoe: [0.086, 0.235, 0.09],
      weight: 1,
    },
    { skin: c.skin, hair: c.hair, sleeve: c.coat, cuff: c.coat, trousers: c.trousers, shoes: c.shoes },
    { grow: 1.05, crown: 0.03, front: 64, temple: 70, side: 100, back: 128 },
    (m) => {
      m.use(c.coat, BONE.hips);
      loft(m, [
        { z: 0.39, rx: 0.205, ry: 0.168, x: s * 0.6 },
        { z: 0.55, rx: 0.195, ry: 0.158, x: s * 0.8 },
        { z: 0.75, rx: 0.186, ry: 0.148, x: s },
        { z: 0.9, rx: 0.18, ry: 0.14, x: s },
        { z: 1.03, rx: 0.152, ry: 0.113, x: s * 0.5 },
        { z: 1.17, rx: 0.16, ry: 0.124, y: 0.008 },
        { z: 1.27, rx: 0.168, ry: 0.12 },
        { z: 1.345, rx: 0.172, ry: 0.11, x: -s * 0.3 },
        { z: 1.395, rx: 0.16, ry: 0.098 },
        { z: 1.43, rx: 0.1, ry: 0.078 },
        { z: 1.445, rx: 0.062, ry: 0.058 },
      ]);
      m.use(c.belt, BONE.hips);
      loft(
        m,
        [
          { z: 1.012, rx: 0.157, ry: 0.118, x: s * 0.55 },
          { z: 1.048, rx: 0.155, ry: 0.117, x: s * 0.45 },
        ],
        20,
        1,
      );
      // scarf: a wrap round the neck, one end down the front
      m.use(c.scarf, BONE.hips);
      torus(m, 0.066, 0.03, V(0, 0.006, 1.447), new THREE.Euler(-0.3, 0, 0), [18, 8]);
      roundedBox(m, [0.07, 0.022, 0.22], V(0.05, 0.13, 1.31), {
        e: 0.4,
        rot: new THREE.Euler(0.12, 0, -0.08),
      });
      // bun
      m.use(c.hair, BONE.head);
      ellipsoid(m, [0.046, 0.044, 0.044], V(0, -0.088, 1.655));
    },
  );
}

/** Child: hoodie with the hood down, backpack, short hair. */
function buildChild(): Rig {
  const c = PALETTE.child;
  return buildPerson(
    {
      head: [0.072, 0.087, 0.103],
      headC: V(0, 0.006, 1.128),
      neck: { r: 0.037, z0: 0.95, z1: 1.056 },
      shoulder: { x: 0.112, z: 0.94, r: 0.038 },
      arm: { L1: 0.215, L2: 0.175, rE: 0.035, rW: 0.031, hand: 0.12, out: 0.055 },
      hip: { x: 0.064, z: 0.6 },
      knee: 0.33,
      ankle: 0.055,
      leg: [0.06, 0.05, 0.039, 0.041, 0.04],
      shoe: [0.07, 0.185, 0.068],
      weight: -1,
    },
    {
      skin: c.skin,
      hair: c.hair,
      sleeve: c.hoodie,
      cuff: c.rib,
      trousers: c.jeans,
      shoes: c.shoes,
      sole: c.sole,
    },
    { grow: 1.07, crown: 0.04, front: 74, temple: 74, side: 100, back: 136 },
    (m) => {
      const s = -0.01;
      m.use(c.jeans, BONE.hips);
      loft(m, [
        { z: 0.53, rx: 0.117, ry: 0.088, x: s },
        { z: 0.62, rx: 0.122, ry: 0.092, x: s },
      ]);
      m.use(c.hoodie, BONE.hips);
      loft(m, [
        { z: 0.57, rx: 0.13, ry: 0.099, x: s },
        { z: 0.66, rx: 0.127, ry: 0.097, x: s },
        { z: 0.76, rx: 0.122, ry: 0.094, x: s * 0.5 },
        { z: 0.86, rx: 0.13, ry: 0.098 },
        { z: 0.925, rx: 0.132, ry: 0.092 },
        { z: 0.965, rx: 0.118, ry: 0.082 },
        { z: 0.99, rx: 0.062, ry: 0.054 },
      ]);
      // hood lying on the upper back
      ellipsoid(m, [0.082, 0.04, 0.062], V(0, -0.088, 0.958), [12, 8], new THREE.Euler(-0.35, 0, 0));
      m.use(c.rib, BONE.hips);
      loft(
        m,
        [
          { z: 0.555, rx: 0.133, ry: 0.101, x: s },
          { z: 0.595, rx: 0.131, ry: 0.1, x: s },
        ],
        20,
        1,
      );
      // backpack, its pocket and straps
      m.use(c.bag, BONE.hips);
      roundedBox(m, [0.19, 0.085, 0.235], V(0, -0.142, 0.79), { e: 0.4 });
      m.use(c.strap, BONE.hips);
      roundedBox(m, [0.13, 0.03, 0.09], V(0, -0.19, 0.735), { e: 0.4 });
      for (const side of [1, -1]) {
        const strap = [
          V(side * 0.06, -0.11, 0.9),
          V(side * 0.07, -0.05, 0.968),
          V(side * 0.074, 0.05, 0.945),
          V(side * 0.085, 0.095, 0.86),
          V(side * 0.112, 0.07, 0.8),
        ];
        sweep(m, strap, [0.011, 0.011, 0.011, 0.011, 0.011], 6, 3);
      }
    },
  );
}

/** Adult at the right end: sweater, shirt collar, chinos, short grey hair. */
function buildGuide(): Rig {
  const c = PALETTE.guide;
  return buildPerson(
    {
      head: [0.078, 0.097, 0.115],
      headC: V(0, 0.006, 1.64),
      neck: { r: 0.054, z0: 1.44, z1: 1.565 },
      shoulder: { x: 0.18, z: 1.41, r: 0.05 },
      arm: { L1: 0.32, L2: 0.258, rE: 0.045, rW: 0.039, hand: 0.185, out: 0.05 },
      hip: { x: 0.09, z: 0.93 },
      knee: 0.5,
      ankle: 0.08,
      leg: [0.078, 0.067, 0.054, 0.054, 0.05],
      shoe: [0.098, 0.28, 0.08],
      weight: 1,
    },
    { skin: c.skin, hair: c.hair, sleeve: c.sweater, cuff: c.rib, trousers: c.trousers, shoes: c.shoes },
    { grow: 1.045, crown: 0.045, front: 58, temple: 52, side: 98, back: 132 },
    (m) => {
      const s = 0.012;
      m.use(c.trousers, BONE.hips);
      loft(m, [
        { z: 0.74, rx: 0.165, ry: 0.115, x: s },
        { z: 0.86, rx: 0.17, ry: 0.12, x: s },
      ]);
      m.use(c.sweater, BONE.hips);
      loft(m, [
        { z: 0.8, rx: 0.178, ry: 0.128, x: s },
        { z: 0.95, rx: 0.172, ry: 0.126, x: s },
        { z: 1.06, rx: 0.17, ry: 0.125, x: s * 0.5 },
        { z: 1.22, rx: 0.186, ry: 0.136, y: 0.006 },
        { z: 1.33, rx: 0.192, ry: 0.13 },
        { z: 1.395, rx: 0.19, ry: 0.118, x: -s * 0.3 },
        { z: 1.445, rx: 0.165, ry: 0.1 },
        { z: 1.48, rx: 0.085, ry: 0.078 },
        { z: 1.49, rx: 0.066, ry: 0.062 },
      ]);
      m.use(c.rib, BONE.hips);
      loft(
        m,
        [
          { z: 0.785, rx: 0.181, ry: 0.131, x: s },
          { z: 0.83, rx: 0.178, ry: 0.129, x: s },
        ],
        20,
        1,
      );
      m.use(c.collar, BONE.hips);
      torus(m, 0.06, 0.017, V(0, 0.008, 1.482), new THREE.Euler(-0.35, 0, 0), [18, 6]);
    },
  );
}

// ------------------------------------------------------------------------------------------ poses

const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Two-bone IK: put the wrist on `wrist` (figure frame), the elbow bending toward `pole`. The bind
 * pose hangs along −z with the forearm flexing toward +y, so the shoulder rotation maps −z to the
 * upper arm and +y to the flex direction, and the elbow is a hinge about its local x.
 */
function solveArm(arm: Arm, wrist: Vec3, pole: Vec3): void {
  const S = arm.shoulder.position;
  const { L1, L2 } = arm;
  const d = _d.subVectors(wrist, S);
  const D = clamp(d.length(), Math.abs(L1 - L2) + 0.02, (L1 + L2) * 0.999);
  d.normalize();
  const cosA = clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const p = _p.copy(pole).addScaledVector(d, -pole.dot(d));
  if (p.lengthSq() < 1e-8) p.set(0, -1, 0).addScaledVector(d, d.y);
  p.normalize();
  const u = _u.copy(d).multiplyScalar(cosA).addScaledVector(p, sinA); // upper arm direction
  // forearm direction: from the elbow (S + L1 u) to the wrist (S + D d)
  const f = _f.copy(d).multiplyScalar(D).addScaledVector(u, -L1).divideScalar(L2).normalize();
  const y = _y.copy(f).addScaledVector(u, -f.dot(u));
  if (y.lengthSq() < 1e-8) y.copy(p).negate().addScaledVector(u, p.dot(u));
  y.normalize();
  const z = _z.copy(u).negate();
  const x = _x.crossVectors(y, z);
  arm.shoulder.quaternion.setFromRotationMatrix(_m.makeBasis(x, y, z));
  arm.elbow.rotation.set(Math.acos(clamp(u.dot(f), -1, 1)), 0, 0);
}

const _w = new THREE.Vector3();
const _pl = new THREE.Vector3();

/** Pose an arm between its relaxed hang (w = 0) and a wrist target (w = 1). */
function reach(arm: Arm, target: Vec3 | null, w: number, pole: Vec3): void {
  _w.copy(arm.rest);
  _pl.copy(arm.restPole);
  if (target && w > 0) {
    _w.lerp(target, w);
    _pl.lerp(pole, w).normalize();
  }
  solveArm(arm, _w, _pl);
}

const _l = new THREE.Vector3();

/** Turn the head toward a world point (yaw, then pitch; limited like a real neck). */
function lookAt(rig: Rig, target: Vec3): void {
  const l = rig.root.worldToLocal(_l.copy(target)).sub(rig.head.position);
  // the eyes do part of the work: the head turns ~80 % of the way and bows ~60 %
  const yaw = clamp(0.8 * Math.atan2(-l.x, l.y), -0.9, 0.9);
  const pitch = clamp(0.6 * Math.atan2(l.z, Math.hypot(l.x, l.y)), -0.45, 0.2);
  rig.head.rotation.set(pitch, 0, yaw, 'ZXY');
}

/** Keypad centre in the holder's frame (waist height, a little toward the child / the camera). */
const HOLD_ADULT = V(0.06, 0.27, 0.98);
const HOLD_CHILD = V(0.0, 0.24, 0.78);
/** Where the keypad changes hands (table frame), between the adult's right and the child's left. */
const HANDOVER = V(-0.68, -0.66, 0.38);
/** The changed building the right-hand adult indicates (table frame, east part of the model). */
const POINT_AT = V(0.2, -0.04, 0.05);
/** Where each figure looks on the model (the part in front of them) and at the others. */
const MODEL_ADULT = V(-0.66, 0.02, 0.05);
const MODEL_CHILD = V(-0.3, 0.04, 0.05);
const MODEL_GUIDE = V(-0.2, 0.0, 0.08);
const PEOPLE = V(-0.68, -0.8, 0.45);
/** Elbow poles: by the sides while holding, down and a little out while indicating. */
const POLE_HOLD_R = V(0.3, -0.45, -1).normalize();
const POLE_HOLD_L = V(-0.3, -0.45, -1).normalize();
const POLE_POINT = V(0.3, 0, -1).normalize();
/** The indicating arm's angles below the horizontal (upper arm; forearm and hand). */
const UPPER_DOWN = 55 * DEG;
const FORE_DOWN = 38 * DEG;
const LED = new THREE.Color(COLORS.led);

/** Wrist position on one side of the keypad (holder's frame). */
function grip(rig: Rig, keypad: Vec3, side: 1 | -1, out: Vec3): Vec3 {
  rig.root.worldToLocal(out.copy(keypad));
  out.x += side * 0.068;
  out.y -= 0.07;
  out.z -= 0.022;
  return out;
}

export class Figures {
  readonly group = new THREE.Group();
  private readonly adult: Rig;
  private readonly child: Rig;
  private readonly guide: Rig;
  private readonly keypad: THREE.Group;
  private readonly keypadFade = { value: 0 };
  private readonly ledMat: THREE.MeshBasicMaterial;
  private readonly k = new THREE.Vector3();
  private readonly kA = new THREE.Vector3();
  private readonly kC = new THREE.Vector3();
  private readonly t1 = new THREE.Vector3();
  private readonly t2 = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  constructor() {
    this.group.name = 'figures';
    // positions and headings in the table frame (floor at z = −0.6); front = +y
    this.adult = buildAdult();
    this.adult.baseYaw = -0.18;
    this.child = buildChild();
    this.child.baseYaw = 0.1;
    this.guide = buildGuide();
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
    const { adult, child, guide } = this;
    adult.fade.value = fa;
    child.fade.value = fc;
    guide.fade.value = fg;
    const bump = (a: number, b: number, c: number, d: number) =>
      smooth(ramp(u, a, b)) * (1 - smooth(ramp(u, c, d)));
    // arrival: a short walk toward the table while fading in
    const arrive = (f: number) => (1 - smooth(f)) * 0.22;
    // the adult and the child turn toward each other for the handover
    const give = bump(19.85, 20.3, 20.9, 21.6);
    adult.root.position.set(-0.98, -0.86 - arrive(fa), -0.6);
    child.root.position.set(-0.36, -0.8 - arrive(fc), -0.6);
    guide.root.position.set(1.32 + arrive(fg), 0.08, -0.6);
    adult.root.rotation.z = adult.baseYaw + 0.12 * s.turn - 0.3 * give;
    child.root.rotation.z = child.baseYaw - 0.08 * s.turn + 0.3 * give;
    guide.root.rotation.z = guide.baseYaw - 0.1 * s.turn;
    this.group.updateMatrixWorld(true);

    // keypad: at the adult's waist → handover point (handover = 0.55) → at the child's chest
    const press = s.childPress;
    const kA = adult.root.localToWorld(this.kA.copy(HOLD_ADULT));
    const kC = child.root.localToWorld(
      this.kC.set(HOLD_CHILD.x, HOLD_CHILD.y + 0.03 * press, HOLD_CHILD.z + 0.045 * press),
    );
    const h = s.handover;
    const toChild = smooth((h - 0.55) / 0.45);
    const K =
      h < 0.55
        ? this.k.lerpVectors(kA, HANDOVER, smooth(h / 0.55))
        : this.k.lerpVectors(HANDOVER, kC, toChild);

    // adult: both hands on the keypad; the left lets go as she offers it, the right lets go at the
    // handover point and comes back down. Child: the left hand meets the keypad at the handover
    // point, the right joins it in front of the chest.
    const given = h < 0.55 ? K : HANDOVER;
    reach(adult.right, grip(adult, given, 1, this.t1), 1 - smooth(ramp(u, 20.45, 21.1)), POLE_HOLD_R);
    reach(adult.left, grip(adult, K, -1, this.t2), 1 - smooth(ramp(u, 19.95, 20.35)), POLE_HOLD_L);
    reach(child.left, grip(child, K, -1, this.t1), smooth(ramp(u, 20.1, 20.45)), POLE_HOLD_L);
    reach(child.right, grip(child, K, 1, this.t2), smooth(ramp(u, 20.55, 20.95)), POLE_HOLD_R);
    // right-hand adult: open-hand gesture toward a changed building, in the vertical plane through
    // it, the arm angled down to the table (no horizontal reach)
    const g = guide.right;
    const aim = guide.root.worldToLocal(this.t1.copy(POINT_AT)).sub(g.shoulder.position);
    aim.z = 0;
    aim.normalize();
    const hand = this.t2
      .copy(g.shoulder.position)
      .addScaledVector(aim, g.L1 * Math.cos(UPPER_DOWN) + g.L2 * Math.cos(FORE_DOWN));
    hand.z -= g.L1 * Math.sin(UPPER_DOWN) + g.L2 * Math.sin(FORE_DOWN);
    reach(g, hand, s.point, POLE_POINT);
    reach(guide.left, null, 0, POLE_POINT);

    // heads: the keypad, the model, each other
    const look = this.look;
    const atKeypad = Math.max(1 - smooth(ramp(u, 17.2, 17.9)), bump(19.85, 20.2, 20.9, 21.5));
    lookAt(adult, look.copy(MODEL_ADULT).lerp(K, atKeypad));
    lookAt(child, look.copy(MODEL_CHILD).lerp(K, bump(20.0, 20.3, 21.3, 21.9)));
    lookAt(
      guide,
      look
        .copy(MODEL_GUIDE)
        .lerp(POINT_AT, s.point)
        .lerp(PEOPLE, bump(22.0, 22.6, 23.6, 24.0)),
    );

    this.keypad.position.copy(K);
    const k = h < 0.55 ? 0 : toChild;
    const yaw = adult.root.rotation.z + (child.root.rotation.z - adult.root.rotation.z) * k;
    this.keypad.rotation.set(0.55 + 0.25 * press, 0, yaw, 'ZXY');
    this.keypadFade.value = fa + (fc - fa) * k;
    this.ledMat.color.set(COLORS.keypad).lerp(LED, 0.25 + 0.75 * keypadLed(u));
  }
}
