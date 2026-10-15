/**
 * Brick packing (SPEC §7.5.1).
 *
 * For each baseplate P and layer k, the mask M(P, k) = {(i, j) ∈ P : H[j][i] ≥ k} is covered exactly
 * by rectangular bricks of the enabled catalog, both orientations, never crossing a plate edge.
 *
 * Method (deterministic):
 * 1. The mask is held as 32 bit-rows (one uint32 per plate row) and split into 4-connected components.
 * 2. Each component is solved by a beam search over "anchor at the first free cell": scanning cells
 *    in row-major order, the first free cell of any exact cover is the south-west corner of the
 *    brick covering it, so expanding every shape anchored there enumerates all exact covers (the
 *    search is complete with an unbounded beam). States advance one brick per level; the beam keeps
 *    the `beamWidth` best states by (covered cells − 5 × isolated free cells), then bond score,
 *    de-duplicated by Zobrist hash of the free set. The first level where a state completes gives
 *    the brick count. Both scan orders (row-major and column-major, via transposition) are tried
 *    and the better solution kept.
 * 3. Post-pass: adjacent aligned bricks whose union is an enabled part are merged (count −1 each).
 * Objective: (1) fewest parts, (2) tie-break: most seams of the layer below bridged (running bond,
 * Σ over bricks of (number of distinct bricks underneath − 1)).
 * The 1×1 is always enabled (SPEC §7.5.1), so an exact cover always exists.
 * Plate-local (SPEC §7.5.1, O10): a plate's packing depends only on its own heights, the part
 * settings and PACKING_ALGORITHM_VERSION; the bond tie-break only looks at the same plate's layer below.
 *
 * Smooth cap (`tileCap`): a column of height h that gets a cap (h ≥ 1 for 'roofs', h ≥ 0 for 'all') carries one
 * tile at layer h + 1. The tile mask of layer k = {H == k − 1} is covered by tiles the same way (no bond
 * tie-break), after the bricks of layer k. Bricks are packed exactly as without the cap.
 *
 * Lower bounds per layer: `lowerBound` = Σ components max(⌈area / largest enabled shape fitting the
 * component's bounding box⌉, ⌈boundary vertices / 4⌉) — the second because every vertex of the
 * component's outline (convex or reflex, holes included) is a corner of at least one brick and a
 * brick has 4 corners; `lowerBound8` = ⌈area / 8⌉ (the bound named in the spec; not a valid bound
 * when 2×6 / 2×8 are enabled, reported for comparison).
 */
import { STUDS_PER_PLATE, type HeightMap, type PlacedBrick } from '../types.ts';
import { throwIfAborted } from '../util/errors.ts';
import { runAsync, runSync, type Steps } from '../util/steps.ts';
import type { ProgressFn } from '../util/progress.ts';
import {
  BASEPLATE,
  tileCapsColumn,
  enabledShapes,
  tileShapes,
  type InventoryOptions,
  type Shape,
} from './catalog.ts';
import { plateName } from './plates.ts';
import { PACKING_ALGORITHM_VERSION } from '../version.ts';

const N = STUDS_PER_PLATE;

export { PACKING_ALGORITHM_VERSION };

export interface PackingOptions extends InventoryOptions {
  /** Beam width (default 12). Larger = fewer parts, slower. */
  beamWidth?: number;
  /** Try both scan orders per component (default true). */
  bothOrders?: boolean;
  signal?: AbortSignal;
  progress?: ProgressFn;
}

export interface LayerStats {
  plate: string;
  layer: number;
  area: number;
  bricks: number;
  /** Cap tiles placed at this layer (area = tiled studs). */
  tiles: number;
  tileArea: number;
  lowerBound: number;
  lowerBound8: number;
  bond: number;
}

export interface PlateSummary {
  plate: string;
  col: number;
  /** Plate row counted from the south (0-based). */
  southRow: number;
  /** Part id → quantity (bricks and tiles). */
  counts: Record<string, number>;
  /** Bricks only. */
  bricks: number;
  /** Cap tiles. */
  tiles: number;
  /** Highest layer used (a cap tile adds one). */
  layers: number;
}

export interface PackingResult {
  /** Placed parts: bricks and, with a cap, tiles (see `isTile`). */
  bricks: PlacedBrick[];
  /** Part id → quantity (bricks and tiles; baseplates apart). */
  counts: Record<string, number>;
  baseplates: { id: string; quantity: number };
  plates: PlateSummary[];
  layers: LayerStats[];
  /** Bricks only. */
  total: number;
  /** Cap tiles. */
  tiles: number;
  lowerBound: number;
  lowerBound8: number;
  bond: number;
  algorithmVersion: number;
  timeMs: number;
}

/** A placement in component-local coordinates (plate studs). */
interface Placement {
  x: number;
  y: number;
  shape: Shape;
}

// ---------------------------------------------------------------------------------------------
// bit helpers

function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function ctz(v: number): number {
  return 31 - Math.clz32(v & -v);
}

function rowMask(w: number): number {
  return w >= 32 ? 0xffffffff : ((1 << w) - 1) >>> 0;
}

function transpose(rows: Uint32Array): Uint32Array {
  const out = new Uint32Array(N);
  for (let y = 0; y < N; y++) {
    let r = rows[y]!;
    while (r) {
      const x = ctz(r);
      r &= r - 1;
      out[x] = (out[x]! | (1 << y)) >>> 0;
    }
  }
  return out;
}

/** 4-connected components of a 32×32 bit mask. */
export function components(mask: Uint32Array): Uint32Array[] {
  const left = Uint32Array.from(mask);
  const out: Uint32Array[] = [];
  for (let y = 0; y < N; y++) {
    while (left[y]) {
      const comp = new Uint32Array(N);
      comp[y] = (left[y]! & -left[y]!) >>> 0;
      // iterative dilation within the mask until stable
      let changed = true;
      while (changed) {
        changed = false;
        for (let r = 0; r < N; r++) {
          const c = comp[r]!;
          if (!c && !(r > 0 && comp[r - 1]) && !(r < N - 1 && comp[r + 1])) continue;
          let grown = c | (c << 1) | (c >>> 1);
          if (r > 0) grown |= comp[r - 1]!;
          if (r < N - 1) grown |= comp[r + 1]!;
          grown = (grown & left[r]!) >>> 0;
          if (grown !== c) {
            comp[r] = grown;
            changed = true;
          }
        }
      }
      for (let r = 0; r < N; r++) left[r] = (left[r]! & ~comp[r]!) >>> 0;
      out.push(comp);
    }
  }
  return out;
}

function maskArea(m: Uint32Array): number {
  let a = 0;
  for (let r = 0; r < N; r++) a += popcount(m[r]!);
  return a;
}

function bbox(m: Uint32Array): { w: number; h: number } {
  let y0 = N,
    y1 = -1,
    or = 0;
  for (let r = 0; r < N; r++) {
    if (m[r]) {
      y0 = Math.min(y0, r);
      y1 = r;
      or |= m[r]!;
    }
  }
  if (y1 < 0) return { w: 0, h: 0 };
  return { w: 32 - Math.clz32(or) - ctz(or), h: y1 - y0 + 1 };
}

/** Number of vertices of the outline of a mask (grid points where 1 or 3 of the 4 cells are inside; 2 diagonal cells count twice). */
export function outlineVertices(m: Uint32Array): number {
  let n = 0;
  for (let y = 0; y <= N; y++) {
    const lo = y > 0 ? m[y - 1]! : 0; // row below the grid line
    const hi = y < N ? m[y]! : 0;
    for (let x = 0; x <= N; x++) {
      const a = x > 0 ? (lo >>> (x - 1)) & 1 : 0; // south-west cell
      const b = x < N ? (lo >>> x) & 1 : 0; // south-east
      const c = x > 0 ? (hi >>> (x - 1)) & 1 : 0; // north-west
      const d = x < N ? (hi >>> x) & 1 : 0; // north-east
      const k = a + b + c + d;
      if (k === 1 || k === 3) n++;
      else if (k === 2 && a === d) n += 2;
    }
  }
  return n;
}

/** Valid lower bound for one component. */
export function componentLowerBound(m: Uint32Array, shapes: Shape[]): number {
  const area = maskArea(m);
  if (!area) return 0;
  const b = bbox(m);
  let amax = 1;
  for (const s of shapes) if (s.w <= b.w && s.d <= b.h) amax = Math.max(amax, s.area);
  return Math.max(Math.ceil(area / amax), Math.ceil(outlineVertices(m) / 4));
}

// ---------------------------------------------------------------------------------------------
// beam search on one component

const ZOBRIST_A = new Uint32Array(N * N);
const ZOBRIST_B = new Uint32Array(N * N);
{
  let s = 0x9e3779b9;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
  for (let i = 0; i < N * N; i++) {
    ZOBRIST_A[i] = next();
    ZOBRIST_B[i] = next();
  }
}

interface Node {
  parent: number;
  x: number;
  y: number;
  shape: number; // index in shapes
}

interface State {
  free: Uint32Array;
  node: number;
  covered: number;
  iso: number; // free cells with no free 4-neighbour
  bond: number;
  h1: number;
  h2: number;
}

function isFree(free: Uint32Array, x: number, y: number): boolean {
  return x >= 0 && x < N && y >= 0 && y < N && ((free[y]! >>> x) & 1) === 1;
}

/** Free cells adjacent to the rectangle that lose their last free neighbour when it is placed. */
function newlyIsolated(free: Uint32Array, x: number, y: number, w: number, d: number): number {
  let n = 0;
  const inRect = (cx: number, cy: number) => cx >= x && cx < x + w && cy >= y && cy < y + d;
  const check = (cx: number, cy: number) => {
    if (!isFree(free, cx, cy)) return;
    const nb = [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ];
    for (const [qx, qy] of nb) if (!inRect(qx!, qy!) && isFree(free, qx!, qy!)) return;
    n++;
  };
  for (let cy = y; cy < y + d; cy++) {
    check(x - 1, cy);
    check(x + w, cy);
  }
  for (let cx = x; cx < x + w; cx++) {
    check(cx, y - 1);
    check(cx, y + d);
  }
  return n;
}

function hasFreeNeighbour(free: Uint32Array, x: number, y: number): boolean {
  return isFree(free, x - 1, y) || isFree(free, x + 1, y) || isFree(free, x, y - 1) || isFree(free, x, y + 1);
}

/** Distinct bricks of the layer below under the rectangle, minus one (0 when ≤ 1). */
function bondOf(below: Int32Array | null, x: number, y: number, w: number, d: number): number {
  if (!below) return 0;
  let a = -1,
    b = -1,
    n = 0;
  let seen: Set<number> | null = null;
  for (let cy = y; cy < y + d; cy++) {
    for (let cx = x; cx < x + w; cx++) {
      const id = below[cy * N + cx]!;
      if (id < 0 || id === a || id === b) continue;
      if (seen?.has(id)) continue;
      if (a < 0) a = id;
      else if (b < 0) b = id;
      else (seen ??= new Set()).add(id);
      n++;
    }
  }
  return Math.max(0, n - 1);
}

function solveBeam(
  mask: Uint32Array,
  shapes: Shape[],
  below: Int32Array | null,
  beamWidth: number,
): { placements: Placement[]; bond: number } {
  const total = maskArea(mask);
  const nodes: Node[] = [];
  let h1 = 0,
    h2 = 0;
  let iso0 = 0;
  for (let y = 0; y < N; y++) {
    let r = mask[y]!;
    while (r) {
      const x = ctz(r);
      r &= r - 1;
      h1 ^= ZOBRIST_A[y * N + x]!;
      h2 ^= ZOBRIST_B[y * N + x]!;
      if (!hasFreeNeighbour(mask, x, y)) iso0++;
    }
  }
  let beam: State[] = [
    { free: Uint32Array.from(mask), node: -1, covered: 0, iso: iso0, bond: 0, h1: h1 >>> 0, h2: h2 >>> 0 },
  ];
  const masks = shapes.map((s) => rowMask(s.w));
  for (;;) {
    interface Child {
      s: number;
      shape: number;
      x: number;
      y: number;
      covered: number;
      iso: number;
      bond: number;
      h1: number;
      h2: number;
      score: number;
      order: number;
    }
    const children: Child[] = [];
    let order = 0;
    for (let si = 0; si < beam.length; si++) {
      const st = beam[si]!;
      let y0 = 0;
      while (y0 < N && st.free[y0] === 0) y0++;
      const x0 = ctz(st.free[y0]!);
      const anchorIsolated = !hasFreeNeighbour(st.free, x0, y0);
      for (let k = 0; k < shapes.length; k++) {
        const sh = shapes[k]!;
        if (y0 + sh.d > N || x0 + sh.w > N) continue;
        const m = masks[k]!;
        let fits = true;
        for (let r = y0; r < y0 + sh.d; r++) {
          if (((st.free[r]! >>> x0) & m) >>> 0 !== m) {
            fits = false;
            break;
          }
        }
        if (!fits) continue;
        let a = st.h1,
          b = st.h2;
        for (let r = y0; r < y0 + sh.d; r++) {
          for (let c = x0; c < x0 + sh.w; c++) {
            a ^= ZOBRIST_A[r * N + c]!;
            b ^= ZOBRIST_B[r * N + c]!;
          }
        }
        const iso = st.iso + newlyIsolated(st.free, x0, y0, sh.w, sh.d) - (anchorIsolated ? 1 : 0);
        const covered = st.covered + sh.area;
        const bond = st.bond + bondOf(below, x0, y0, sh.w, sh.d);
        children.push({
          s: si,
          shape: k,
          x: x0,
          y: y0,
          covered,
          iso,
          bond,
          h1: a >>> 0,
          h2: b >>> 0,
          score: covered - 5 * iso,
          order: order++,
        });
      }
    }
    // complete states end the search (best bond wins among them)
    const done = children.filter((c) => c.covered === total);
    const pick = done.length ? done : children;
    pick.sort((p, q) => (done.length ? 0 : q.score - p.score) || q.bond - p.bond || p.order - q.order);
    const next: State[] = [];
    const seen = new Set<number>();
    for (const c of pick) {
      const key = c.h1 * 2097152 + (c.h2 & 0x1fffff);
      if (seen.has(key)) continue;
      seen.add(key);
      const parent = beam[c.s]!;
      const sh = shapes[c.shape]!;
      const w = sh.w,
        d = sh.d;
      const free = Uint32Array.from(parent.free);
      const m = rowMask(w);
      for (let r = c.y; r < c.y + d; r++) free[r] = (free[r]! & ~(m << c.x)) >>> 0;
      nodes.push({ parent: parent.node, x: c.x, y: c.y, shape: c.shape });
      next.push({
        free,
        node: nodes.length - 1,
        covered: c.covered,
        iso: c.iso,
        bond: c.bond,
        h1: c.h1,
        h2: c.h2,
      });
      if (done.length || next.length >= beamWidth) break;
    }
    beam = next;
    if (done.length) {
      const best = beam[0]!;
      const placements: Placement[] = [];
      for (let n = best.node; n >= 0; n = nodes[n]!.parent) {
        const nd = nodes[n]!;
        placements.push({ x: nd.x, y: nd.y, shape: shapes[nd.shape]! });
      }
      placements.reverse();
      return { placements, bond: best.bond };
    }
  }
}

/** Merges adjacent aligned bricks whose union is an enabled shape, until no merge applies. */
function mergePass(placements: Placement[], shapes: Shape[]): Placement[] {
  const byDims = new Map<string, Shape>();
  for (const s of shapes) if (!byDims.has(`${s.w}x${s.d}`)) byDims.set(`${s.w}x${s.d}`, s);
  let list = placements.slice();
  let merged = true;
  while (merged) {
    merged = false;
    const grid = new Int32Array(N * N).fill(-1);
    list.forEach((p, i) => {
      for (let y = p.y; y < p.y + p.shape.d; y++)
        for (let x = p.x; x < p.x + p.shape.w; x++) grid[y * N + x] = i;
    });
    const gone = new Uint8Array(list.length);
    const add: Placement[] = [];
    list.forEach((p, i) => {
      if (gone[i]) return;
      // east neighbour with the same rows, then north neighbour with the same columns
      const candidates: number[] = [];
      if (p.x + p.shape.w < N) candidates.push(grid[p.y * N + p.x + p.shape.w]!);
      if (p.y + p.shape.d < N) candidates.push(grid[(p.y + p.shape.d) * N + p.x]!);
      for (const j of candidates) {
        if (j < 0 || j === i || gone[j]) continue;
        const q = list[j]!;
        let w: number, d: number;
        if (q.y === p.y && q.shape.d === p.shape.d && q.x === p.x + p.shape.w) {
          w = p.shape.w + q.shape.w;
          d = p.shape.d;
        } else if (q.x === p.x && q.shape.w === p.shape.w && q.y === p.y + p.shape.d) {
          w = p.shape.w;
          d = p.shape.d + q.shape.d;
        } else continue;
        const s = byDims.get(`${w}x${d}`);
        if (!s) continue;
        gone[i] = gone[j] = 1;
        add.push({ x: p.x, y: p.y, shape: s });
        merged = true;
        break;
      }
    });
    if (merged) list = list.filter((_, i) => !gone[i]).concat(add);
  }
  return list;
}

function transposePlacement(p: Placement, shapes: Shape[]): Placement {
  const s = shapes.find((t) => t.part === p.shape.part && t.w === p.shape.d && t.d === p.shape.w) ?? p.shape;
  return { x: p.y, y: p.x, shape: s };
}

function bondTotal(placements: Placement[], below: Int32Array | null): number {
  let b = 0;
  for (const p of placements) b += bondOf(below, p.x, p.y, p.shape.w, p.shape.d);
  return b;
}

export function packComponent(
  comp: Uint32Array,
  shapes: Shape[],
  below: Int32Array | null,
  beamWidth: number,
  bothOrders: boolean,
  preferColumns: boolean,
): { placements: Placement[]; bond: number } {
  const run = (columns: boolean) => {
    const mask = columns ? transpose(comp) : comp;
    const belowT = columns && below ? transposeIds(below) : below;
    const r = solveBeam(mask, shapes, belowT, beamWidth);
    let placements = mergePass(r.placements, shapes);
    if (columns) placements = placements.map((p) => transposePlacement(p, shapes));
    return { placements, bond: bondTotal(placements, below) };
  };
  const first = run(preferColumns);
  if (!bothOrders) return first;
  const second = run(!preferColumns);
  const better =
    second.placements.length < first.placements.length ||
    (second.placements.length === first.placements.length && second.bond > first.bond);
  return better ? second : first;
}

function transposeIds(ids: Int32Array): Int32Array {
  const out = new Int32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[x * N + y] = ids[y * N + x]!;
  return out;
}

// ---------------------------------------------------------------------------------------------

/** Packs the whole height map, plate by plate (A1, B1, … then row 2…), layer by layer. */
export function packHeightMap(hm: HeightMap, opts: PackingOptions = {}): PackingResult {
  return runSync(packHeightMapSteps(hm, opts));
}

export function packHeightMapAsync(hm: HeightMap, opts: PackingOptions = {}): Promise<PackingResult> {
  return runAsync(packHeightMapSteps(hm, opts), opts.signal);
}

export function* packHeightMapSteps(hm: HeightMap, opts: PackingOptions = {}): Steps<PackingResult> {
  const t0 = performance.now();
  if (hm.cols % N || hm.rows % N) throw new Error('height map size must be a multiple of 32');
  const shapes = enabledShapes(opts);
  const cap = opts.tileCap ?? 'none';
  const tShapes = cap === 'none' ? [] : tileShapes(opts);
  const beamWidth = opts.beamWidth ?? 12;
  const bothOrders = opts.bothOrders ?? true;
  const px = hm.cols / N,
    py = hm.rows / N;
  const bricks: PlacedBrick[] = [];
  const counts: Record<string, number> = {};
  const plates: PlateSummary[] = [];
  const layers: LayerStats[] = [];
  let lowerBound = 0,
    lowerBound8 = 0,
    bond = 0,
    tiles = 0;
  const totalPlates = px * py;
  let done = 0;
  for (let row = py - 1; row >= 0; row--) {
    for (let col = 0; col < px; col++) {
      throwIfAborted(opts.signal);
      const name = plateName(col, row, py);
      const heights = new Int32Array(N * N);
      let hmax = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const v = Math.max(0, hm.data[(row * N + y) * hm.cols + col * N + x]!);
          heights[y * N + x] = v;
          if (v > hmax) hmax = v;
        }
      }
      let capped = false;
      for (let c = 0; c < N * N && !capped; c++) capped = tileCapsColumn(cap, heights[c]!);
      const top = hmax + (capped ? 1 : 0);
      const summary: PlateSummary = {
        plate: name,
        col,
        southRow: row,
        counts: {},
        bricks: 0,
        tiles: 0,
        layers: top,
      };
      const place = (p: Placement, k: number) => {
        const b: PlacedBrick = {
          plate: name,
          layer: k,
          x: p.x,
          y: p.y,
          w: p.shape.w,
          d: p.shape.d,
          rotation: p.shape.rotation,
          partId: p.shape.part.id,
        };
        bricks.push(b);
        counts[b.partId] = (counts[b.partId] ?? 0) + 1;
        summary.counts[b.partId] = (summary.counts[b.partId] ?? 0) + 1;
      };
      let below: Int32Array | null = null;
      for (let k = 1; k <= top; k++) {
        const mask = new Uint32Array(N);
        for (let y = 0; y < N; y++) {
          let r = 0;
          for (let x = 0; x < N; x++) if (heights[y * N + x]! >= k) r |= 1 << x;
          mask[y] = r >>> 0;
        }
        const ids = new Int32Array(N * N).fill(-1);
        const stats: LayerStats = {
          plate: name,
          layer: k,
          area: maskArea(mask),
          bricks: 0,
          tiles: 0,
          tileArea: 0,
          lowerBound: 0,
          lowerBound8: 0,
          bond: 0,
        };
        stats.lowerBound8 = Math.ceil(stats.area / 8);
        for (const comp of components(mask)) {
          stats.lowerBound += componentLowerBound(comp, shapes);
          // alternate the preferred scan order per layer so successive layers cross (running bond)
          const r = packComponent(comp, shapes, below, beamWidth, bothOrders, k % 2 === 0);
          r.placements.sort((a, b) => a.y - b.y || a.x - b.x);
          for (const p of r.placements) {
            const id = bricks.length;
            for (let y = p.y; y < p.y + p.shape.d; y++)
              for (let x = p.x; x < p.x + p.shape.w; x++) ids[y * N + x] = id;
            place(p, k);
          }
          stats.bricks += r.placements.length;
          stats.bond += r.bond;
        }
        if (capped) {
          const tmask = new Uint32Array(N);
          for (let y = 0; y < N; y++) {
            let r = 0;
            for (let x = 0; x < N; x++) {
              const h = heights[y * N + x]!;
              if (h === k - 1 && tileCapsColumn(cap, h)) r |= 1 << x;
            }
            tmask[y] = r >>> 0;
          }
          stats.tileArea = maskArea(tmask);
          for (const comp of components(tmask)) {
            const r = packComponent(comp, tShapes, null, beamWidth, bothOrders, k % 2 === 0);
            r.placements.sort((a, b) => a.y - b.y || a.x - b.x);
            for (const p of r.placements) place(p, k);
            stats.tiles += r.placements.length;
          }
          summary.tiles += stats.tiles;
          tiles += stats.tiles;
        }
        lowerBound += stats.lowerBound;
        lowerBound8 += stats.lowerBound8;
        bond += stats.bond;
        summary.bricks += stats.bricks;
        layers.push(stats);
        below = ids;
        yield done / totalPlates;
      }
      plates.push(summary);
      done++;
      opts.progress?.('packing', done / totalPlates, name);
    }
  }
  return {
    bricks,
    counts,
    baseplates: { id: BASEPLATE.id, quantity: totalPlates },
    plates,
    layers,
    total: bricks.length - tiles,
    tiles,
    lowerBound,
    lowerBound8,
    bond,
    algorithmVersion: PACKING_ALGORITHM_VERSION,
    timeMs: performance.now() - t0,
  };
}

/** Tallest column of a plate in bricks (`layers` minus the cap-tile layer). */
export function plateBrickHeight(p: Pick<PlateSummary, 'layers' | 'tiles'>): number {
  return p.tiles ? p.layers - 1 : p.layers;
}

/** Physical height of the tallest point in cm: 9.6 mm per brick, + 3.2 mm when the model has a tile cap. */
export function tallestCm(packing: Pick<PackingResult, 'plates' | 'tiles'>): number {
  const bricks = packing.plates.reduce((a, p) => Math.max(a, plateBrickHeight(p)), 0);
  return (bricks * 9.6 + (packing.tiles ? 3.2 : 0)) / 10;
}
