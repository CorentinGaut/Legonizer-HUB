/**
 * Scene content builders (docs/ui/3d-look.md §3, §4, §12): the source model ("plaster" massing, with
 * per-building flags for disappearing / outside buildings), the brick model (one InstancedMesh per
 * footprint and state, studs on exposed tops, baseplates with a stud texture), plate labels, stud
 * rulers and brick-level guides.
 */
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { MeshPreview } from '../../../core/worker/protocol.ts';
import type { PlacedBrick } from '../../../core/types.ts';
import { parsePlateName, plateName } from '../../../core/packing/plates.ts';

export const BRICK_H = 1.2; // stud pitches
const GAP = 0.025; // 0.2 mm
const PLATE_T = 0.225; // 1.8 mm
const STUD_R = 0.3;
const STUD_H = 0.2125; // 1.7 mm

// ------------------------------------------------------------------ source model

/** Per-building flag: 0 normal, 1 disappears (hatched), 2 outside the selection (dimmed), 3 included whole. */
export type FeatureFlag = 0 | 1 | 2 | 3;

export class SourceModel {
  readonly mesh: Mesh;
  private flagAttr: BufferAttribute;
  private triFeature: Int32Array;

  constructor(preview: MeshPreview, opts: { ghost?: boolean; transform?: Matrix4 } = {}) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(preview.positions, 3));
    if (opts.transform) g.applyMatrix4(opts.transform);
    g.computeVertexNormals();
    this.triFeature = preview.triFeature;
    const flags = new Float32Array(preview.positions.length / 3);
    this.flagAttr = new BufferAttribute(flags, 1);
    g.setAttribute('aFlag', this.flagAttr);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mat = opts.ghost
      ? new MeshStandardMaterial({
          color: '#F2F0EA',
          roughness: 0.8,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
          side: DoubleSide,
        })
      : new MeshStandardMaterial({ color: '#F2F0EA', roughness: 0.8, side: DoubleSide });
    if (!opts.ghost) patchFlags(mat);
    this.mesh = new Mesh(g, mat);
    this.mesh.castShadow = !opts.ghost;
    this.mesh.receiveShadow = !opts.ghost;
  }

  /** `flags[feature]`; features missing from the array are 0. */
  setFlags(flags: Uint8Array | null): void {
    const a = this.flagAttr.array as Float32Array;
    const tf = this.triFeature;
    for (let t = 0; t < tf.length; t++) {
      const f = tf[t]!;
      const v = flags && f >= 0 ? (flags[f] ?? 0) : 0;
      a[t * 3] = a[t * 3 + 1] = a[t * 3 + 2] = v;
    }
    this.flagAttr.needsUpdate = true;
  }
}

/** Stripes on disappearing buildings (45°, #B3261E on #F3E3DF) and dimmed buildings outside the area. */
function patchFlags(mat: MeshStandardMaterial) {
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aFlag;\nvarying float vFlag;\nvarying vec3 vWorld;',
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvFlag = aFlag;\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vFlag;\nvarying vec3 vWorld;\nuniform float uStripe;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vFlag > 0.5 && vFlag < 1.5) {
          float s = fract((vWorld.x + vWorld.y + vWorld.z) / uStripe);
          diffuseColor.rgb = s < 0.5 ? vec3(0.705, 0.149, 0.118) : vec3(0.953, 0.890, 0.875);
        } else if (vFlag > 1.5 && vFlag < 2.5) {
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62), 0.55);
        } else if (vFlag > 2.5) {
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.80, 0.45), 0.55);
        }`,
      );
    s.uniforms.uStripe = { value: (mat.userData.stripe as number) ?? 6 };
    mat.userData.shader = s;
  };
}

export function setStripeWidth(m: Mesh, metres: number): void {
  const mat = m.material as MeshStandardMaterial;
  mat.userData.stripe = metres;
  const sh = mat.userData.shader as { uniforms: { uStripe: { value: number } } } | undefined;
  if (sh) sh.uniforms.uStripe.value = metres;
}

// ------------------------------------------------------------------ lines and overlays

export function lineSegments(points: number[], color: string, opacity = 1): LineSegments {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(points, 3));
  const m = new LineBasicMaterial({
    color: new Color(color),
    transparent: opacity < 1,
    opacity,
    depthTest: true,
  });
  const l = new LineSegments(g, m);
  l.renderOrder = 2;
  return l;
}

/** Closed polygon outline at height z. */
export function polygonOutline(
  corners: [number, number][],
  z: number,
  color: string,
  opacity = 1,
): LineSegments {
  const pts: number[] = [];
  for (let k = 0; k < corners.length; k++) {
    const a = corners[k]!,
      b = corners[(k + 1) % corners.length]!;
    pts.push(a[0], a[1], z, b[0], b[1], z);
  }
  return lineSegments(pts, color, opacity);
}

/** Text sprite on a pill (plate labels, 3d-look §12). */
export function textSprite(
  text: string,
  opts: { size: number; fg?: string; bg?: string; font?: string },
): Sprite {
  const c = document.createElement('canvas');
  const px = 64;
  const ctx = c.getContext('2d')!;
  const font = `760 ${px}px ${opts.font ?? "'Bricolage Grotesque Variable', 'Bricolage Grotesque', 'IBM Plex Sans', system-ui, sans-serif"}`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + px * 0.7;
  c.width = w;
  c.height = Math.ceil(px * 1.45);
  const g = c.getContext('2d')!;
  g.font = font;
  g.fillStyle = opts.bg ?? 'rgba(255,255,255,0.92)';
  const r = c.height / 2;
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, r * 0.6);
  g.fill();
  g.fillStyle = opts.fg ?? '#2f39b3';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillText(text, c.width / 2, c.height / 2 + px * 0.04);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const s = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((opts.size * c.width) / c.height, opts.size, 1);
  s.renderOrder = 10;
  return s;
}

// ------------------------------------------------------------------ bricks

export type BrickState = 'solid' | 'ghost' | 'new' | 'hidden' | 'dim';

export interface BrickModelOptions {
  platesX: number;
  platesY: number;
  /** Only these plates (Build view); default all. */
  plates?: string[];
  style?: (b: PlacedBrick) => BrickState;
  baseplateColour?: 'grey' | 'white';
  studs?: boolean;
  /** Shift so the given plate's south-west corner is at the origin. */
  originPlate?: string;
  outlines?: boolean;
}

let studTexture: CanvasTexture | null = null;
function baseplateStudTexture(): CanvasTexture {
  if (studTexture) return studTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#d8d9dc';
  g.beginPath();
  g.arc(32, 32, 19, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8e9094';
  g.lineWidth = 2.5;
  g.stroke();
  studTexture = new CanvasTexture(c);
  studTexture.wrapS = studTexture.wrapT = RepeatWrapping;
  studTexture.repeat.set(32, 32);
  studTexture.colorSpace = SRGBColorSpace;
  studTexture.anisotropy = 4;
  return studTexture;
}

const MATS: Record<Exclude<BrickState, 'hidden'>, () => Material> = {
  solid: () => new MeshStandardMaterial({ color: '#F4F2EC', roughness: 0.36, metalness: 0 }),
  ghost: () =>
    new MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.5,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
  new: () => new MeshStandardMaterial({ color: '#C9CEFF', roughness: 0.45, metalness: 0 }),
  dim: () =>
    new MeshStandardMaterial({
      color: '#F4F2EC',
      roughness: 0.4,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
};

/** Brick model in stud units: x east, y north, z up (1 brick = 1.2). */
export function buildBrickModel(bricks: PlacedBrick[], o: BrickModelOptions): { group: Group; bounds: Box3 } {
  const group = new Group();
  const plateSet = o.plates ? new Set(o.plates) : null;
  const origin = o.originPlate ? parsePlateName(o.originPlate, o.platesY) : null;
  const ox = origin ? -origin.col * 32 : 0,
    oy = origin ? -origin.southRow * 32 : 0;
  const style = o.style ?? (() => 'solid' as const);
  // group instances by footprint × state
  const buckets = new Map<string, { w: number; d: number; state: BrickState; mats: Matrix4[] }>();
  const cols = o.platesX * 32;
  const rows = o.platesY * 32;
  const top = new Int16Array(cols * rows); // highest visible layer per cell
  const topState = new Uint8Array(cols * rows);
  const stateCode: Record<BrickState, number> = { solid: 1, ghost: 2, new: 3, hidden: 0, dim: 4 };
  const outline: number[] = [];
  const m = new Matrix4();
  let maxZ = 0;
  for (const b of bricks) {
    if (plateSet && !plateSet.has(b.plate)) continue;
    const st = style(b);
    if (st === 'hidden') continue;
    const { col, southRow } = parsePlateName(b.plate, o.platesY);
    const x0 = col * 32 + b.x,
      y0 = southRow * 32 + b.y;
    const z0 = (b.layer - 1) * BRICK_H;
    maxZ = Math.max(maxZ, z0 + BRICK_H);
    const key = `${b.w}x${b.d}:${st}`;
    let bk = buckets.get(key);
    if (!bk) buckets.set(key, (bk = { w: b.w, d: b.d, state: st, mats: [] }));
    bk.mats.push(m.clone().makeTranslation(x0 + b.w / 2 + ox, y0 + b.d / 2 + oy, z0 + BRICK_H / 2));
    for (let i = 0; i < b.w; i++)
      for (let j = 0; j < b.d; j++) {
        const c = (y0 + j) * cols + (x0 + i);
        if (b.layer >= top[c]!) {
          top[c] = b.layer;
          topState[c] = stateCode[st];
        }
      }
    if (st === 'new' && o.outlines !== false) {
      const xa = x0 + ox + GAP / 2,
        xb = x0 + b.w + ox - GAP / 2,
        ya = y0 + oy + GAP / 2,
        yb = y0 + b.d + oy - GAP / 2,
        za = z0,
        zb = z0 + BRICK_H - GAP;
      // 12 box edges
      const e = [
        [xa, ya, za, xb, ya, za],
        [xb, ya, za, xb, yb, za],
        [xb, yb, za, xa, yb, za],
        [xa, yb, za, xa, ya, za],
        [xa, ya, zb, xb, ya, zb],
        [xb, ya, zb, xb, yb, zb],
        [xb, yb, zb, xa, yb, zb],
        [xa, yb, zb, xa, ya, zb],
        [xa, ya, za, xa, ya, zb],
        [xb, ya, za, xb, ya, zb],
        [xb, yb, za, xb, yb, zb],
        [xa, yb, za, xa, yb, zb],
      ];
      for (const s of e) outline.push(...s);
    }
  }
  const mats = new Map<string, Material>();
  const mat = (st: Exclude<BrickState, 'hidden'>) => {
    let q = mats.get(st);
    if (!q) mats.set(st, (q = MATS[st]()));
    return q;
  };
  for (const bk of buckets.values()) {
    if (bk.state === 'hidden') continue;
    const geo = new RoundedBoxGeometry(bk.w - GAP, bk.d - GAP, BRICK_H - GAP, 2, 0.05);
    const im = new InstancedMesh(geo, mat(bk.state), bk.mats.length);
    bk.mats.forEach((mm, k) => im.setMatrixAt(k, mm));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = bk.state === 'solid' || bk.state === 'new';
    im.receiveShadow = bk.state !== 'ghost';
    if (bk.state === 'ghost' || bk.state === 'dim') im.renderOrder = 1;
    im.computeBoundingSphere();
    group.add(im);
  }
  // studs on exposed tops
  if (o.studs !== false) {
    const byState = new Map<number, Matrix4[]>();
    let count = 0;
    for (let c = 0; c < top.length; c++) {
      if (!top[c]) continue;
      count++;
    }
    if (count <= 120_000) {
      for (let c = 0; c < top.length; c++) {
        const L = top[c]!;
        if (!L) continue;
        const x = (c % cols) + 0.5 + ox,
          y = Math.floor(c / cols) + 0.5 + oy;
        const s = topState[c]!;
        let l = byState.get(s);
        if (!l) byState.set(s, (l = []));
        const mm = new Matrix4().makeRotationX(Math.PI / 2);
        mm.setPosition(x, y, L * BRICK_H - GAP + STUD_H / 2);
        l.push(mm);
      }
      const studGeo = new CylinderGeometry(STUD_R, STUD_R, STUD_H, 16);
      const codeState: Record<number, Exclude<BrickState, 'hidden'>> = {
        1: 'solid',
        2: 'ghost',
        3: 'new',
        4: 'dim',
      };
      for (const [s, list] of byState) {
        const st = codeState[s]!;
        const im = new InstancedMesh(studGeo, mat(st), list.length);
        list.forEach((mm, k) => im.setMatrixAt(k, mm));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = st === 'solid' || st === 'new';
        im.computeBoundingSphere();
        group.add(im);
      }
    }
  }
  if (outline.length) group.add(lineSegments(outline, '#222A88'));
  // baseplates
  const plates: { col: number; southRow: number }[] = [];
  for (let col = 0; col < o.platesX; col++)
    for (let row = 0; row < o.platesY; row++) {
      if (plateSet && !plateSet.has(plateName(col, row, o.platesY))) continue;
      plates.push({ col, southRow: row });
    }
  const plateMat = new MeshStandardMaterial({
    color: o.baseplateColour === 'white' ? '#ECEBE6' : '#A9ABAF',
    roughness: 0.55,
    map: baseplateStudTexture(),
  });
  const plateGeo = new PlaneGeometry(32 - GAP * 2, 32 - GAP * 2);
  const sideMat = new MeshStandardMaterial({
    color: o.baseplateColour === 'white' ? '#D9D8D2' : '#8E9094',
    roughness: 0.6,
  });
  for (const p of plates) {
    const top = new Mesh(plateGeo, plateMat);
    top.position.set(p.col * 32 + 16 + ox, p.southRow * 32 + 16 + oy, 0);
    top.receiveShadow = true;
    group.add(top);
    const side = new Mesh(new RoundedBoxGeometry(32 - GAP * 2, 32 - GAP * 2, PLATE_T, 1, 0.05), sideMat);
    side.position.set(p.col * 32 + 16 + ox, p.southRow * 32 + 16 + oy, -PLATE_T / 2 - 0.002);
    side.receiveShadow = true;
    group.add(side);
  }
  const minC = plates.length ? Math.min(...plates.map((p) => p.col)) : 0;
  const maxC = plates.length ? Math.max(...plates.map((p) => p.col)) : 0;
  const minR = plates.length ? Math.min(...plates.map((p) => p.southRow)) : 0;
  const maxR = plates.length ? Math.max(...plates.map((p) => p.southRow)) : 0;
  const bounds = new Box3(
    new Vector3(minC * 32 + ox, minR * 32 + oy, -PLATE_T),
    new Vector3((maxC + 1) * 32 + ox, (maxR + 1) * 32 + oy, Math.max(maxZ, 0.5)),
  );
  return { group, bounds };
}

/** Plate label sprites at each plate's north-west corner. */
export function plateLabels(platesX: number, platesY: number, maxZ: number): Group {
  const g = new Group();
  for (let col = 0; col < platesX; col++)
    for (let row = 0; row < platesY; row++) {
      const s = textSprite(plateName(col, row, platesY), { size: 3.2 });
      s.position.set(col * 32 + 3.5, row * 32 + 32 - 2.5, Math.max(0.5, maxZ * 0.02) + 0.6);
      g.add(s);
    }
  return g;
}

/** Stud rulers around one plate (columns 1–32 west → east on the north edge, rows 1–32 north → south on the west edge). */
export function studRulers(): Mesh {
  const px = 32; // canvas px per stud
  const margin = 2.2;
  const size = 32 + margin * 2;
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(size * px);
  const g = c.getContext('2d')!;
  g.fillStyle = '#55575e';
  g.strokeStyle = '#85837b';
  g.font = `500 ${Math.round(px * 0.62)}px 'IBM Plex Mono', ui-monospace, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let n = 1; n <= 32; n++) {
    const x = (margin + n - 0.5) * px;
    const y = (margin + n - 0.5) * px;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, margin * px - 6);
    g.lineTo(x, margin * px - 1);
    g.moveTo(margin * px - 6, y);
    g.lineTo(margin * px - 1, y);
    g.stroke();
    if (n % 4 === 1) {
      g.fillText(String(n), x, margin * px * 0.45);
      g.fillText(String(n), margin * px * 0.45, y);
    }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  const mesh = new Mesh(
    new PlaneGeometry(size, size),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.position.set(16, 16, -0.005);
  mesh.renderOrder = 0;
  return mesh;
}

/** Horizontal brick-level guide lines on the north and west faces of a box (step 3). */
export function brickGuides(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  z0: number,
  step: number,
  levels: number,
  color: string,
): LineSegments {
  const pts: number[] = [];
  for (let k = 1; k <= levels; k++) {
    const z = z0 + k * step;
    pts.push(minX, maxY, z, maxX, maxY, z); // north (back)
    pts.push(minX, minY, z, minX, maxY, z); // west (left)
  }
  pts.push(minX, maxY, z0, minX, maxY, z0 + levels * step);
  pts.push(maxX, maxY, z0, maxX, maxY, z0 + levels * step);
  pts.push(minX, minY, z0, minX, minY, z0 + levels * step);
  return lineSegments(pts, color, 0.55);
}
