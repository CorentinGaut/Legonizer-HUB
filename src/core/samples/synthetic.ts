/**
 * Deterministic synthetic 3D Tiles datasets, written exactly like py3dtilers output (b3dm v1,
 * glTF 2.0 non-indexed triangle soup with POSITION / NORMAL / _BATCHID float32, node matrix
 * Z-up → Y-up, positions Z-up relative to each child tile's translation `transform`, batch table
 * with `gml_id`). Used by tests (parity, importers) and as the small demo sample (SPEC I10).
 */
import type { FileMap } from '../import/fileMap.ts';

export interface Prng {
  next(): number;
  int(a: number, b: number): number;
}

/** mulberry32 */
export function prng(seed: number): Prng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (a, b) => a + Math.floor(next() * (b - a + 1)) };
}

// ---------------------------------------------------------------------------------------------
// Geometry builders (Z-up, local coordinates, outward-facing CCW triangles)

export class SoupBuilder {
  readonly pos: number[] = [];
  readonly batch: number[] = [];
  tri(
    b: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
  ): void {
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.batch.push(b, b, b);
  }
  quad(b: number, p: number[][]): void {
    const [a, c1, c, d] = p as [number[], number[], number[], number[]];
    this.tri(b, a[0]!, a[1]!, a[2]!, c1[0]!, c1[1]!, c1[2]!, c[0]!, c[1]!, c[2]!);
    this.tri(b, a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!);
  }
  /** Axis-aligned box: floor (down), 4 walls (out), flat roof (up). */
  box(b: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.quad(b, [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ]); // roof, normal +z
    this.quad(b, [
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y0, z0],
    ]); // floor, normal −z
    this.quad(b, [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ]); // south, −y
    this.quad(b, [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ]); // east, +x
    this.quad(b, [
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y1, z1],
      [x1, y1, z1],
    ]); // north, +y
    this.quad(b, [
      [x0, y1, z0],
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
    ]); // west, −x
  }
  /** Box with a gabled roof (ridge along x) of height `ridge` above the eaves, on a sloped base. */
  gabled(
    b: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    zBase0: number,
    zBase1: number,
    eaves: number,
    ridge: number,
  ): void {
    // floor follows the slope along x: z = zBase0 at x0, zBase1 at x1 (walls start at the lower point)
    const zb = Math.min(zBase0, zBase1);
    const ze = Math.max(zBase0, zBase1) + eaves;
    const ym = (y0 + y1) / 2;
    const zr = ze + ridge;
    this.quad(b, [
      [x0, y0, zb],
      [x0, y1, zb],
      [x1, y1, zb],
      [x1, y0, zb],
    ]);
    this.quad(b, [
      [x0, y0, zb],
      [x1, y0, zb],
      [x1, y0, ze],
      [x0, y0, ze],
    ]);
    this.quad(b, [
      [x1, y1, zb],
      [x0, y1, zb],
      [x0, y1, ze],
      [x1, y1, ze],
    ]);
    this.quad(b, [
      [x1, y0, zb],
      [x1, y1, zb],
      [x1, y1, ze],
      [x1, y0, ze],
    ]);
    this.quad(b, [
      [x0, y1, zb],
      [x0, y0, zb],
      [x0, y0, ze],
      [x0, y1, ze],
    ]);
    // gable ends
    this.tri(b, x1, y0, ze, x1, y1, ze, x1, ym, zr);
    this.tri(b, x0, y1, ze, x0, y0, ze, x0, ym, zr);
    // roof slopes
    this.quad(b, [
      [x0, y0, ze],
      [x1, y0, ze],
      [x1, ym, zr],
      [x0, ym, zr],
    ]);
    this.quad(b, [
      [x1, y1, ze],
      [x0, y1, ze],
      [x0, ym, zr],
      [x1, ym, zr],
    ]);
  }
}

// ---------------------------------------------------------------------------------------------
// GLB / b3dm / tileset writers

const enc = new TextEncoder();

function padTo4(bytes: Uint8Array, pad: number): Uint8Array {
  const len = (bytes.length + 3) & ~3;
  if (len === bytes.length) return bytes;
  const out = new Uint8Array(len).fill(pad);
  out.set(bytes);
  return out;
}

function padTo8(bytes: Uint8Array, pad: number, offset: number): Uint8Array {
  const len = ((offset + bytes.length + 7) & ~7) - offset;
  const out = new Uint8Array(len).fill(pad);
  out.set(bytes);
  return out;
}

function computeNormals(pos: Float32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < pos.length; t += 9) {
    const e1 = [pos[t + 3]! - pos[t]!, pos[t + 4]! - pos[t + 1]!, pos[t + 5]! - pos[t + 2]!];
    const e2 = [pos[t + 6]! - pos[t]!, pos[t + 7]! - pos[t + 1]!, pos[t + 8]! - pos[t + 2]!];
    const c = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    const l = Math.hypot(c[0]!, c[1]!, c[2]!) || 1;
    for (let k = 0; k < 3; k++) n.set([c[0]! / l, c[1]! / l, c[2]! / l], t + 3 * k);
  }
  return n;
}

/** GLB like py3dtiles: one node with the Z-up → Y-up matrix, one non-indexed primitive. */
export function writeGlb(positions: Float32Array, batchIds: Float32Array | null): Uint8Array {
  const count = positions.length / 3;
  const normals = computeNormals(positions);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, positions[i]!);
    max[i % 3] = Math.max(max[i % 3]!, positions[i]!);
  }
  const views: Uint8Array[] = [
    new Uint8Array(positions.buffer.slice(0)),
    new Uint8Array(normals.buffer.slice(0)),
  ];
  if (batchIds) views.push(new Uint8Array(batchIds.buffer.slice(0)));
  let offset = 0;
  const bufferViews = views.map((v) => {
    const bv = { buffer: 0, byteLength: v.length, byteOffset: offset, target: 34962 };
    offset += v.length;
    return bv;
  });
  const attributes: Record<string, number> = { POSITION: 0, NORMAL: 1 };
  const accessors: unknown[] = [
    { bufferView: 0, byteOffset: 0, componentType: 5126, count, min, max, type: 'VEC3' },
    {
      bufferView: 1,
      byteOffset: 0,
      componentType: 5126,
      count,
      max: [1, 1, 1],
      min: [-1, -1, -1],
      type: 'VEC3',
    },
  ];
  if (batchIds) {
    attributes._BATCHID = 2;
    let bmax = 0;
    for (const b of batchIds) bmax = Math.max(bmax, b);
    accessors.push({
      bufferView: 2,
      byteOffset: 0,
      componentType: 5126,
      count,
      max: [bmax],
      min: [0],
      type: 'SCALAR',
    });
  }
  const json = {
    asset: { generator: 'legonizer-synthetic (py3dtiles layout)', version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ matrix: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1], mesh: 0 }],
    meshes: [{ primitives: [{ attributes, material: 0, mode: 4 }] }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0 },
        name: 'Material0',
      },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const jsonBytes = padTo4(enc.encode(JSON.stringify(json)), 0x20);
  const bin = new Uint8Array((offset + 3) & ~3);
  let o = 0;
  for (const v of views) {
    bin.set(v, o);
    o += v.length;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const b = 20 + jsonBytes.length;
  dv.setUint32(b, bin.length, true);
  dv.setUint32(b + 4, 0x004e4942, true);
  out.set(bin, b + 8);
  return out;
}

export function writeB3dm(
  glb: Uint8Array,
  batchLength: number,
  batchTable: Record<string, unknown[]>,
): Uint8Array {
  const ft = padTo8(enc.encode(JSON.stringify({ BATCH_LENGTH: batchLength })), 0x20, 28);
  const bt = padTo8(enc.encode(JSON.stringify(batchTable)), 0x20, 28 + ft.length);
  const total = 28 + ft.length + bt.length + glb.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(enc.encode('b3dm'), 0);
  dv.setUint32(4, 1, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, ft.length, true);
  dv.setUint32(16, 0, true);
  dv.setUint32(20, bt.length, true);
  dv.setUint32(24, 0, true);
  out.set(ft, 28);
  out.set(bt, 28 + ft.length);
  out.set(glb, 28 + ft.length + bt.length);
  return out;
}

export interface SyntheticTile {
  /** Translation of the child tile (world, EPSG:3946-like). */
  origin: [number, number, number];
  soup: SoupBuilder;
  gmlIds: string[];
}

/** py3dtilers-like tileset: root with ADD refinement, one REPLACE child per tile with a translation transform. */
export function writeTileset(tiles: SyntheticTile[], title: string): FileMap {
  const files: FileMap = new Map();
  const children = tiles.map((t, i) => {
    const pos = Float32Array.from(t.soup.pos);
    const batch = Float32Array.from(t.soup.batch);
    files.set(
      `tiles/${i}.b3dm`,
      writeB3dm(writeGlb(pos, batch), t.gmlIds.length, {
        id: t.gmlIds.map((_, k) => k),
        'citygml::surface_type': t.gmlIds.map(() => 'Building'),
        gml_id: t.gmlIds,
      }),
    );
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    pos.forEach((v, k) => {
      min[k % 3] = Math.min(min[k % 3]!, v);
      max[k % 3] = Math.max(max[k % 3]!, v);
    });
    const c = [0, 1, 2].map((k) => (min[k]! + max[k]!) / 2);
    const h = [0, 1, 2].map((k) => (max[k]! - min[k]!) / 2);
    return {
      boundingVolume: { box: [c[0], c[1], c[2], h[0], 0, 0, 0, h[1], 0, 0, 0, h[2]] },
      geometricError: 1,
      refine: 'REPLACE',
      content: { uri: `tiles/${i}.b3dm` },
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t.origin[0], t.origin[1], t.origin[2], 1],
    };
  });
  const tileset = {
    asset: { version: '1.0', extras: { title } },
    geometricError: 500,
    root: {
      boundingVolume: { box: [0, 0, 0, 1e4, 0, 0, 0, 1e4, 0, 0, 0, 1e3] },
      geometricError: 500,
      refine: 'ADD',
      children,
    },
  };
  files.set('tileset.json', enc.encode(JSON.stringify(tileset)));
  return files;
}

// ---------------------------------------------------------------------------------------------
// Datasets

/** Centre of the synthetic datasets: Lyon Part-Dieu in EPSG:3946, to exercise float32 world coordinates. */
export const SYNTHETIC_CENTRE: [number, number] = [1844400, 5175100];

/**
 * "Boxes city": 2 × 2 tiles of box buildings on a 3 m grid aligned with the default legacy area
 * (rays hit edges and vertices exactly), heights 3–60 m, one 96 m tower, flat ground at z = 170 m.
 */
export function syntheticBoxesCity(seed = 1): FileMap {
  const r = prng(seed);
  const [cx, cy] = SYNTHETIC_CENTRE;
  const tiles: SyntheticTile[] = [];
  let n = 0;
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      // tile origin: a non-integer translation, like py3dtilers (millimetre decimals)
      const origin: [number, number, number] = [
        cx - 96 + tx * 192 + 0.555,
        cy - 96 + ty * 192 + 0.068,
        170.476,
      ];
      const soup = new SoupBuilder();
      const gmlIds: string[] = [];
      for (let by = 0; by < 6; by++) {
        for (let bx = 0; bx < 6; bx++) {
          if (r.next() < 0.2) continue;
          const w = 3 * r.int(2, 6),
            d = 3 * r.int(2, 6);
          // snap to the 3 m grid of the area whose corner is (cx − 192, cy − 192)
          const x0 = -96 + bx * 30 + 3 * r.int(0, 2) - 0.555 + (tx === 1 && by === 0 ? 0.25 : 0);
          const y0 = -96 + by * 30 + 3 * r.int(0, 2) - 0.068;
          const tall = tx === 0 && ty === 1 && bx === 3 && by === 2;
          const h = tall ? 96 : 3 * r.int(1, 20) + (r.next() < 0.3 ? 0.5 : 0);
          const b = gmlIds.length;
          gmlIds.push(`SYN_BOX_${String(n++).padStart(3, '0')}`);
          soup.box(b, x0, y0, 0, x0 + w, y0 + d, h);
        }
      }
      tiles.push({ origin, soup, gmlIds });
    }
  }
  return writeTileset(tiles, 'Synthetic boxes city');
}

/**
 * "Sloped scene": gabled houses on a hillside rising 100 m from west to east (L4), one tile.
 */
export function syntheticSlope(seed = 2): FileMap {
  const r = prng(seed);
  const [cx, cy] = SYNTHETIC_CENTRE;
  const soup = new SoupBuilder();
  const gmlIds: string[] = [];
  const origin: [number, number, number] = [cx + 0.25, cy - 0.75, 200.125];
  const slope = 100 / 384; // metres per metre along x
  for (let by = 0; by < 10; by++) {
    for (let bx = 0; bx < 10; bx++) {
      if (r.next() < 0.25) continue;
      const w = 6 + r.int(0, 12),
        d = 6 + r.int(0, 8);
      const x0 = -192 + bx * 38 + r.next() * 8,
        y0 = -192 + by * 38 + r.next() * 8;
      const zb0 = (x0 + 192) * slope,
        zb1 = (x0 + w + 192) * slope;
      const b = gmlIds.length;
      gmlIds.push(`SYN_SLOPE_${String(b).padStart(3, '0')}`);
      soup.gabled(b, x0, y0, x0 + w, y0 + d, zb0, zb1, 3 + r.int(0, 15), 2 + r.next() * 5);
    }
  }
  return writeTileset([{ origin, soup, gmlIds }], 'Synthetic sloped scene');
}
