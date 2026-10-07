/**
 * Synthetic city district for the home animation (SPEC H4): a deterministic, invented
 * neighbourhood written as py3dtilers-like 3D Tiles (same writer as the other synthetic datasets),
 * so the home brick model comes out of the real pipeline: import → heightmap → packing.
 * No real-world data: every footprint and height below is made up.
 *
 * Layout, on a 6 m design module (one stud at the home scale; i west→east, j south→north,
 * 160 × 96 modules = 960 × 576 m centred on DISTRICT_CENTRE):
 * - a street grid with a 30 m boulevard (west→east) and a 30 m avenue (south→north) where the
 *   illustrative tram lines run, and 12–18 m side streets;
 * - perimeter blocks with courtyards: one building per lot, 12–18 m deep, 15–31 m high, gabled
 *   roofs in the old quarter (west), passages into some courtyards, a few courtyard annexes;
 * - a railway station: a long vaulted hall (336 × 54 m) facing a forecourt, platform canopies and
 *   the track corridor along the north-east edge;
 * - a business cluster by the station: towers of 170, 128, 100 (round) and 84 m on podiums, and
 *   two lone towers (68 m, 60 m);
 * - a park, a church on its square, a low shopping centre, a housing estate of slabs.
 * The plan extends one block beyond the frame so the area cuts it like a real district.
 */
import type { FileMap } from '../import/fileMap.ts';
import { SoupBuilder, prng, writeTileset, type Prng, type SyntheticTile } from './synthetic.ts';

/** Centre of the district (local projected frame, metres): the home area is centred here. */
export const DISTRICT_CENTRE: [number, number] = [0, 0];
/** Design module (metres): one stud at the home animation's 6 m per stud. */
export const DISTRICT_MODULE = 6;
/** Extent of the framed district in modules (5 × 3 baseplates of 32 studs at the home scale). */
export const DISTRICT_MODULES: [number, number] = [160, 96];

type Shape =
  | { kind: 'box'; i0: number; j0: number; i1: number; j1: number; z0: number; z1: number }
  | { kind: 'gable'; i0: number; j0: number; i1: number; j1: number; eaves: number; ridge: number }
  | { kind: 'round'; ci: number; cj: number; r: number; sides: number; z1: number }
  | { kind: 'vault'; i0: number; j0: number; i1: number; j1: number; walls: number; crown: number };

interface Feature {
  name: string;
  shapes: Shape[];
}

/** Empty intervals [a, b) of module columns (south→north streets) and rows (west→east streets). */
const STREETS_I: [number, number][] = [
  [-14, -12],
  [-2, 0],
  [18, 20],
  [38, 41],
  [60, 65], // avenue (tram)
  [84, 86],
  [106, 109],
  [128, 130],
  [148, 150],
  [168, 170],
];
const STREETS_J: [number, number][] = [
  [-14, -12],
  [-2, 0],
  [12, 14],
  [28, 31],
  [42, 47], // boulevard (tram)
  [58, 60],
  [76, 78],
  [96, 98],
  [108, 110],
];

/** Blocks with a special use, by their south-west corner (i0, j0). */
type Use =
  'park' | 'church' | 'mall' | 'estate' | 'business-a' | 'business-b' | 'business-c' | 'hotel' | 'tower-east';
const SPECIAL: Record<string, Use> = {
  '20,14': 'park',
  '86,31': 'church',
  '109,31': 'mall',
  '109,0': 'estate',
  '130,0': 'estate',
  '109,14': 'estate',
  '65,47': 'business-a',
  '65,60': 'business-b',
  '86,47': 'business-c',
  '41,60': 'hotel',
  '150,47': 'tower-east',
};

/** Railway land (no blocks): forecourt and hall, then the track corridor to the east edge. */
const RAIL = [
  { i0: 86, j0: 60, i1: 150, j1: 76 },
  { i0: 86, j0: 78, i1: 172, j1: 110 },
];
const onRail = (i: number, j: number) => RAIL.some((r) => i >= r.i0 && i < r.i1 && j >= r.j0 && j < r.j1);

export interface DistrictPlan {
  features: Feature[];
}

/** The district as a list of buildings (module coordinates, heights in metres). */
export function districtPlan(seed = 7): DistrictPlan {
  const r = prng(seed);
  const features: Feature[] = [];
  const add = (name: string, ...shapes: Shape[]) => features.push({ name, shapes });
  const box = (i0: number, j0: number, i1: number, j1: number, z1: number, z0 = 0): Shape => ({
    kind: 'box',
    i0,
    j0,
    i1,
    j1,
    z0,
    z1,
  });

  const bandsI = gaps(STREETS_I);
  const bandsJ = gaps(STREETS_J);
  for (const [j0, j1] of bandsJ) {
    for (const [i0, i1] of bandsI) {
      if (onRail(i0, j0)) continue;
      const use = SPECIAL[`${i0},${j0}`];
      if (use) special(use, i0, j0, i1, j1, r, add, box);
      else perimeterBlock(i0, j0, i1, j1, r, add, box);
    }
  }
  station(add, box);
  return { features };
}

function gaps(streets: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < streets.length; k++) out.push([streets[k]![1], streets[k + 1]![0]]);
  return out;
}

const pick = <T>(r: Prng, xs: readonly T[]): T => xs[Math.floor(r.next() * xs.length)]!;

/**
 * Perimeter block: lots along the four sides around a courtyard; one building per lot. West of
 * the avenue (old quarter) lots are narrower and gabled, east of it taller and flat-roofed.
 */
function perimeterBlock(
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  r: Prng,
  add: (name: string, ...s: Shape[]) => void,
  box: (i0: number, j0: number, i1: number, j1: number, z1: number) => Shape,
): void {
  const w = i1 - i0,
    d = j1 - j0;
  const old = i1 <= 62;
  const heights = old ? [15.5, 17, 18.5, 20, 22, 23.5] : [16, 19, 22.5, 24, 26, 29.5, 31];
  if (Math.min(w, d) < 8) {
    // small block: a single building
    add('block', box(i0, j0, i1, j1, pick(r, heights)));
    return;
  }
  const depth = old ? 2 + (r.next() < 0.5 ? 1 : 0) : 3;
  const lotLen = () => (old ? r.int(3, 5) : r.int(4, 7));
  // neighbouring lots differ by at least one brick at the home scale (7.2 m), as a street front
  // of buildings of different heights does
  let prev = -1;
  const lot = (a0: number, b0: number, a1: number, b1: number, alongI: boolean, corner: boolean) => {
    let h = pick(r, heights) + (corner ? 3 : 0);
    for (let k = 0; k < 8 && Math.floor(h / 7.2) === prev; k++) h = pick(r, heights) + (corner ? 3 : 0);
    prev = Math.floor(h / 7.2);
    if (old && alongI && depth === 3 && r.next() < 0.7) {
      add('lot', { kind: 'gable', i0: a0, j0: b0, i1: a1, j1: b1, eaves: h - 4, ridge: 7 });
    } else add('lot', box(a0, b0, a1, b1, h));
  };
  // south and north rows (full width, corners included), split along i
  for (const [b0, b1] of [
    [j0, j0 + depth],
    [j1 - depth, j1],
  ] as const) {
    let a = i0;
    while (a < i1) {
      let len = Math.min(lotLen(), i1 - a);
      if (i1 - (a + len) < 3) len = i1 - a;
      if (a > i0 && a + len < i1 && r.next() < 0.1) {
        a += 1; // passage into the courtyard
        continue;
      }
      lot(a, b0, a + len, b1, true, a === i0 || a + len === i1);
      a += len;
    }
  }
  // west and east sides between the rows, split along j
  for (const [a0, a1] of [
    [i0, i0 + depth],
    [i1 - depth, i1],
  ] as const) {
    let b = j0 + depth;
    const end = j1 - depth;
    while (b < end) {
      let len = Math.min(lotLen(), end - b);
      if (end - (b + len) < 3) len = end - b;
      if (b > j0 + depth && b + len < end && r.next() < 0.12) {
        b += 1;
        continue;
      }
      lot(a0, b, a1, b + len, false, false);
      b += len;
    }
  }
  // a low annex in some courtyards
  const ci0 = i0 + depth + 2,
    cj0 = j0 + depth + 2,
    ci1 = i1 - depth - 2,
    cj1 = j1 - depth - 2;
  if (ci1 - ci0 >= 4 && cj1 - cj0 >= 3 && r.next() < 0.35) {
    const aw = r.int(2, Math.min(5, ci1 - ci0)),
      ad = r.int(2, Math.min(3, cj1 - cj0));
    const ai = ci0 + r.int(0, ci1 - ci0 - aw),
      aj = cj0 + r.int(0, cj1 - cj0 - ad);
    add('annex', box(ai, aj, ai + aw, aj + ad, 8));
  }
}

function special(
  use: Use,
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  r: Prng,
  add: (name: string, ...s: Shape[]) => void,
  box: (i0: number, j0: number, i1: number, j1: number, z1: number, z0?: number) => Shape,
): void {
  switch (use) {
    case 'park': {
      // lawns and paths (empty ground), a bandstand and a park lodge
      const ci = Math.floor((i0 + i1) / 2),
        cj = Math.floor((j0 + j1) / 2);
      add('bandstand', { kind: 'round', ci: ci + 0.5, cj: cj + 0.5, r: 1.1, sides: 8, z1: 7.5 });
      add('lodge', box(i0 + 1, j1 - 3, i0 + 4, j1 - 1, 8));
      return;
    }
    case 'church': {
      // church on a square: nave (gabled, ridge west→east), choir, bell tower with a spire
      const nj = j0 + 4;
      add(
        'church',
        { kind: 'gable', i0: i0 + 5, j0: nj, i1: i0 + 14, j1: nj + 3, eaves: 16, ridge: 8 },
        box(i0 + 14, nj, i0 + 16, nj + 3, 15),
        box(i0 + 3, nj, i0 + 5, nj + 3, 38),
        { kind: 'round', ci: i0 + 4, cj: nj + 1.5, r: 0.9, sides: 8, z1: 56 },
      );
      add('presbytery', box(i1 - 4, j1 - 3, i1, j1, 13));
      return;
    }
    case 'mall': {
      add('mall', box(i0 + 1, j0 + 1, i1 - 1, j1 - 1, 16), box(i0 + 6, j0 + 3, i0 + 12, j1 - 3, 23));
      return;
    }
    case 'estate': {
      // slabs of a housing estate, set back from the streets, and one point block
      const slabs = j1 - j0 >= 12 ? [j0 + 2, j0 + 8] : [j0 + 2, j0 + 7];
      for (const sj of slabs) {
        const len = r.int(9, Math.min(13, i1 - i0 - 3));
        const si = i0 + 1 + r.int(0, i1 - i0 - 2 - len);
        add('slab', box(si, sj, si + len, sj + 2, pick(r, [28, 31, 34])));
      }
      if (j1 - j0 < 12) return;
      add('point-block', box(i1 - 5, j1 - 4, i1 - 2, j1 - 1, 47));
      return;
    }
    case 'business-a': {
      // podium with a 128 m tower and a 100 m round tower
      add('podium-a', box(i0 + 1, j0 + 1, i1 - 1, j1 - 1, 10));
      add('tower-128', box(i1 - 8, j0 + 3, i1 - 4, j1 - 2, 128));
      add('tower-100', { kind: 'round', ci: i0 + 6, cj: j0 + 5.5, r: 2.6, sides: 16, z1: 100 });
      return;
    }
    case 'business-b': {
      // the tallest tower (170 m) on a two-storey podium, an office slab
      add('podium-b', box(i0 + 3, j0 + 3, i1 - 5, j1 - 3, 16));
      add('tower-170', box(i0 + 7, j0 + 6, i0 + 12, j0 + 11, 170));
      add('offices-b', box(i1 - 3, j0 + 1, i1, j1 - 6, 34));
      return;
    }
    case 'business-c': {
      // office perimeter on three sides and an 84 m slab tower
      add('offices-c1', box(i0, j0, i1, j0 + 3, 27));
      add('offices-c2', box(i0, j0 + 3, i0 + 3, j1, 24));
      add('tower-84', box(i0 + 10, j0 + 4, i0 + 13, j1, 84));
      add('offices-c3', box(i1 - 3, j0 + 3, i1, j1, 31));
      return;
    }
    case 'hotel': {
      perimeterBlock(i0, j0, i1 - 7, j1, r, add, box);
      add('tower-68', box(i1 - 5, j0 + 2, i1 - 1, j0 + 6, 68));
      add('hotel-wing', box(i1 - 6, j0 + 6, i1, j1, 22));
      return;
    }
    case 'tower-east': {
      perimeterBlock(i0 + 7, j0, i1, j1, r, add, box);
      add('tower-60', box(i0 + 1, j0 + 2, i0 + 5, j0 + 6, 60));
      add('tower-60-base', box(i0, j0 + 6, i0 + 6, j1, 13));
      return;
    }
  }
}

/** Station: forecourt, vaulted hall, platform canopies and the track corridor (railway land). */
function station(
  add: (name: string, ...s: Shape[]) => void,
  box: (i0: number, j0: number, i1: number, j1: number, z1: number, z0?: number) => Shape,
): void {
  add('station-hall', { kind: 'vault', i0: 90, j0: 66, i1: 146, j1: 75, walls: 9, crown: 30 });
  add('station-wing-west', box(86, 64, 90, 76, 19));
  add('station-wing-east', box(146, 64, 150, 76, 19));
  for (const j of [79, 84, 89]) add('platform-canopy', box(94, j, 144, j + 2, 7.6));
  add('signal-box', box(150, 85, 153, 88, 11));
  add('rail-depot', box(112, 93, 158, 96, 9.5));
}

/** Box shapes in metres around the centre (module → metres). */
function toMetres(m: number, axis: 0 | 1): number {
  const half = DISTRICT_MODULES[axis] / 2;
  return DISTRICT_CENTRE[axis] + (m - half) * DISTRICT_MODULE;
}

function emit(soup: SoupBuilder, b: number, s: Shape, ox: number, oy: number): void {
  const X = (i: number) => toMetres(i, 0) - ox;
  const Y = (j: number) => toMetres(j, 1) - oy;
  switch (s.kind) {
    case 'box':
      soup.box(b, X(s.i0), Y(s.j0), s.z0, X(s.i1), Y(s.j1), s.z1);
      return;
    case 'gable':
      soup.gabled(b, X(s.i0), Y(s.j0), X(s.i1), Y(s.j1), 0, 0, s.eaves, s.ridge);
      return;
    case 'round': {
      const pts: [number, number][] = [];
      for (let k = 0; k < s.sides; k++) {
        const a = (2 * Math.PI * (k + 0.5)) / s.sides;
        pts.push([X(s.ci + s.r * Math.cos(a)), Y(s.cj + s.r * Math.sin(a))]);
      }
      soup.prism(b, pts, 0, s.z1);
      return;
    }
    case 'vault': {
      // walls, then a segmental vault: 7 points on an arc from wall top to wall top
      const y0 = Y(s.j0),
        y1 = Y(s.j1);
      const profile: [number, number][] = [
        [y0, 0],
        [y1, 0],
      ];
      for (let k = 0; k <= 6; k++) {
        const u = k / 6;
        profile.push([y1 + (y0 - y1) * u, s.walls + (s.crown - s.walls) * Math.sin(Math.PI * u)]);
      }
      soup.extrudeX(b, X(s.i0), X(s.i1), profile);
      return;
    }
  }
}

function shapeCentre(s: Shape): [number, number] {
  return s.kind === 'round' ? [s.ci, s.cj] : [(s.i0 + s.i1) / 2, (s.j0 + s.j1) / 2];
}

/**
 * The district as 3D Tiles (3 × 2 tiles with translation transforms, like py3dtilers), one
 * feature (`gml_id` DISTRICT_0001…) per building. Deterministic for a given seed.
 */
export function syntheticDistrict(seed = 7): FileMap {
  const { features } = districtPlan(seed);
  const TX = 3,
    TY = 2;
  const tiles: (SyntheticTile & { ti: number })[] = [];
  for (let ty = 0; ty < TY; ty++)
    for (let tx = 0; tx < TX; tx++) {
      const ci = ((tx + 0.5) * DISTRICT_MODULES[0]) / TX,
        cj = ((ty + 0.5) * DISTRICT_MODULES[1]) / TY;
      tiles.push({
        ti: tiles.length,
        // py3dtilers-like translation with millimetre decimals
        origin: [toMetres(ci, 0) + 0.437, toMetres(cj, 1) + 0.219, 0],
        soup: new SoupBuilder(),
        gmlIds: [],
      });
    }
  features.forEach((f, n) => {
    const [ci, cj] = shapeCentre(f.shapes[0]!);
    const tx = Math.min(TX - 1, Math.max(0, Math.floor((ci / DISTRICT_MODULES[0]) * TX)));
    const ty = Math.min(TY - 1, Math.max(0, Math.floor((cj / DISTRICT_MODULES[1]) * TY)));
    const tile = tiles[ty * TX + tx]!;
    const b = tile.gmlIds.length;
    tile.gmlIds.push(`DISTRICT_${String(n + 1).padStart(4, '0')}_${f.name}`);
    for (const s of f.shapes) emit(tile.soup, b, s, tile.origin[0], tile.origin[1]);
  });
  return writeTileset(
    tiles.filter((t) => t.gmlIds.length > 0),
    'Synthetic district (Legonizer home animation)',
  );
}
