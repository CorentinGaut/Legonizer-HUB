/**
 * Illustrative urban data for the home animation, derived deterministically from the brick
 * model's heights (storyboard §6: building functions, green spaces, tram lines and changes are
 * illustrative unless the VCity team provides real ones; the About page and the credits say so).
 * Pure functions, no three.js: unit-tested in Node.
 */

export type FunctionKey = 'housing' | 'offices' | 'shops' | 'public' | 'industry';
export type ChangeKey = 'built' | 'demolished' | 'modified';

export interface Building {
  id: number;
  cells: number[]; // j * cols + i
  maxH: number;
  area: number;
  cx: number; // centroid, stud units (i)
  cy: number; // centroid, stud units (j, south→north)
  fn: FunctionKey;
  change: ChangeKey | null;
}

export interface Derived {
  /** Building id per cell (−1 = no building). */
  buildingOf: Int32Array;
  buildings: Building[];
  /** 1 where the ground is a green space. */
  green: Uint8Array;
  /** Tram lines as polylines in stud units (cell centres: i + 0.5, j + 0.5). */
  trams: [number, number][][];
}

/** Small deterministic hash → [0, 1). */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Buildings = 4-connected cells with height > 0 whose heights differ by at most `maxStep`
 * bricks, so a tower separates from its podium and a block from its neighbour across a step.
 */
export function segmentBuildings(
  cols: number,
  rows: number,
  h: ArrayLike<number>,
  maxStep = 1,
): { buildings: Building[]; buildingOf: Int32Array } {
  const of = new Int32Array(cols * rows).fill(-1);
  const out: Building[] = [];
  const stack: number[] = [];
  for (let s = 0; s < cols * rows; s++) {
    if (h[s]! <= 0 || of[s] !== -1) continue;
    const id = out.length;
    const cells: number[] = [];
    of[s] = id;
    stack.push(s);
    let maxH = 0,
      sx = 0,
      sy = 0;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const i = c % cols,
        j = (c - i) / cols;
      const hc = h[c]!;
      maxH = Math.max(maxH, hc);
      sx += i;
      sy += j;
      const nb = [
        i > 0 ? c - 1 : -1,
        i < cols - 1 ? c + 1 : -1,
        j > 0 ? c - cols : -1,
        j < rows - 1 ? c + cols : -1,
      ];
      for (const n of nb) {
        if (n < 0 || of[n] !== -1 || h[n]! <= 0) continue;
        if (Math.abs(h[n]! - hc) > maxStep) continue;
        of[n] = id;
        stack.push(n);
      }
    }
    out.push({
      id,
      cells,
      maxH,
      area: cells.length,
      cx: sx / cells.length + 0.5,
      cy: sy / cells.length + 0.5,
      fn: 'housing',
      change: null,
    });
  }
  return { buildings: out, buildingOf: of };
}

/** Distance (in cells, chessboard metric) from every cell to the nearest building cell. */
export function distanceToBuildings(cols: number, rows: number, h: ArrayLike<number>): Int32Array {
  const INF = 1 << 20;
  const d = new Int32Array(cols * rows).fill(INF);
  const q: number[] = [];
  for (let c = 0; c < cols * rows; c++)
    if (h[c]! > 0) {
      d[c] = 0;
      q.push(c);
    }
  for (let k = 0; k < q.length; k++) {
    const c = q[k]!;
    const i = c % cols,
      j = (c - i) / cols;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const ni = i + di,
          nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const n = nj * cols + ni;
        if (d[n]! > d[c]! + 1) {
          d[n] = d[c]! + 1;
          q.push(n);
        }
      }
  }
  return d;
}

/** Cheapest path through empty cells, preferring the middle of streets (Dijkstra, binary heap). */
export function streetPath(
  cols: number,
  rows: number,
  dist: Int32Array,
  from: [number, number],
  to: [number, number],
  extraCost: (i: number, j: number) => number = () => 0,
): [number, number][] | null {
  const N = cols * rows;
  const cost = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap: [number, number][] = [];
  const push = (c: number, v: number) => {
    heap.push([v, c]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p]![0] <= heap[k]![0]) break;
      [heap[p], heap[k]] = [heap[k]!, heap[p]!];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1,
          r = l + 1;
        let m = k;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k]!, heap[m]!];
        k = m;
      }
    }
    return top;
  };
  const start = from[1] * cols + from[0];
  const goal = to[1] * cols + to[0];
  if (dist[start] === 0 || dist[goal] === 0) return null;
  cost[start] = 0;
  push(start, 0);
  while (heap.length) {
    const [v, c] = pop();
    if (v > cost[c]!) continue;
    if (c === goal) break;
    const i = c % cols,
      j = (c - i) / cols;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = i + di,
        nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const n = nj * cols + ni;
      if (dist[n] === 0) continue;
      // stay away from façades: steps next to a building cost much more
      const step = 1 + 6 / (dist[n]! * dist[n]!) + extraCost(ni, nj);
      const nv = v + step;
      if (nv < cost[n]!) {
        cost[n] = nv;
        prev[n] = c;
        push(n, nv);
      }
    }
  }
  if (!Number.isFinite(cost[goal]!)) return null;
  const path: [number, number][] = [];
  for (let c = goal; c !== -1; c = prev[c]!) path.push([(c % cols) + 0.5, Math.floor(c / cols) + 0.5]);
  return path.reverse();
}

/** 4-connected components of the cells where `inside` holds. */
export function components(
  cols: number,
  rows: number,
  inside: (c: number) => boolean,
): { cells: number[]; touchesEdge: boolean }[] {
  const seen = new Uint8Array(cols * rows);
  const out: { cells: number[]; touchesEdge: boolean }[] = [];
  for (let s = 0; s < cols * rows; s++) {
    if (seen[s] || !inside(s)) continue;
    const cells: number[] = [];
    let touchesEdge = false;
    const st = [s];
    seen[s] = 1;
    while (st.length) {
      const c = st.pop()!;
      cells.push(c);
      const i = c % cols,
        j = (c - i) / cols;
      if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) touchesEdge = true;
      for (const n of [
        i > 0 ? c - 1 : -1,
        i < cols - 1 ? c + 1 : -1,
        j > 0 ? c - cols : -1,
        j < rows - 1 ? c + cols : -1,
      ])
        if (n >= 0 && !seen[n] && inside(n)) {
          seen[n] = 1;
          st.push(n);
        }
    }
    out.push({ cells, touchesEdge });
  }
  return out;
}

/** Douglas–Peucker simplification, then the result is drawn with round joins. */
export function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0]!, pts[pts.length - 1]!];
  let best = -1,
    bestD = 0;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  for (let k = 1; k < pts.length - 1; k++) {
    const p = pts[k]!;
    const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > bestD) {
      bestD = d;
      best = k;
    }
  }
  if (bestD <= eps) return [a, b];
  return [...simplify(pts.slice(0, best + 1), eps).slice(0, -1), ...simplify(pts.slice(best), eps)];
}

/** Nearest empty cell with the largest street clearance around (i, j). */
function openCellNear(
  cols: number,
  rows: number,
  dist: Int32Array,
  i0: number,
  j0: number,
  r = 6,
): [number, number] {
  let best: [number, number] = [i0, j0],
    bestV = -1;
  for (let j = Math.max(0, j0 - r); j <= Math.min(rows - 1, j0 + r); j++)
    for (let i = Math.max(0, i0 - r); i <= Math.min(cols - 1, i0 + r); i++) {
      const v = dist[j * cols + i]! * 10 - Math.hypot(i - i0, j - j0);
      if (dist[j * cols + i]! > 0 && v > bestV) {
        bestV = v;
        best = [i, j];
      }
    }
  return best;
}

export function deriveUrbanData(cols: number, rows: number, h: ArrayLike<number>): Derived {
  const { buildings, buildingOf } = segmentBuildings(cols, rows, h, 1);

  // Functions: towers are offices, the largest low footprint is the shopping centre, other large
  // low footprints are public facilities (the station), the rest is mostly housing.
  const lowLarge = buildings.filter((b) => b.maxH <= 4 && b.area >= 90).sort((a, b) => b.area - a.area);
  for (const b of buildings) {
    const r = hash01(b.id * 7 + 3);
    if (b.maxH >= 9) b.fn = 'offices';
    else if (lowLarge[0] === b) b.fn = 'shops';
    else if (lowLarge.includes(b)) b.fn = r < 0.5 ? 'public' : 'industry';
    else if (b.maxH >= 6) b.fn = r < 0.55 ? 'offices' : r < 0.8 ? 'housing' : 'public';
    else
      b.fn =
        r < 0.62 ? 'housing' : r < 0.78 ? 'shops' : r < 0.9 ? 'public' : r < 0.96 ? 'offices' : 'industry';
  }

  // Changes: the tallest tower and a few others built, some demolished, some modified.
  const ranked = [...buildings].filter((b) => b.area >= 6).sort((a, b) => b.maxH - a.maxH || b.area - a.area);
  if (ranked[0]) ranked[0].change = 'built';
  const pool = ranked.slice(1).sort((a, b) => hash01(a.id * 13 + 1) - hash01(b.id * 13 + 1));
  let nb = 0,
    nd = 0,
    nm = 0;
  for (const b of pool) {
    if (nb < 4 && b.area >= 12) {
      b.change = 'built';
      nb++;
    } else if (nd < 4 && b.maxH <= 6 && b.area >= 10) {
      b.change = 'demolished';
      nd++;
    } else if (nm < 6 && b.area >= 10) {
      b.change = 'modified';
      nm++;
    }
    if (nb >= 4 && nd >= 4 && nm >= 6) break;
  }

  // Green spaces: enclosed courtyards (empty areas that do not reach the map edge) and the
  // two most open squares, kept away from façades by one cell.
  const dist = distanceToBuildings(cols, rows, h);
  const green = new Uint8Array(cols * rows);
  const emptyBlobs = components(cols, rows, (c) => h[c]! <= 0);
  for (const blob of emptyBlobs) {
    if (blob.touchesEdge || blob.cells.length < 4 || blob.cells.length > 400) continue;
    for (const c of blob.cells) green[c] = 1;
  }
  const squares = components(cols, rows, (c) => dist[c]! >= 4)
    .filter((b) => !b.touchesEdge && b.cells.length >= 6 && b.cells.length <= 160)
    .sort((a, b) => b.cells.length - a.cells.length)
    .slice(0, 2);
  for (const blob of squares) {
    for (const c of blob.cells) {
      const i = c % cols,
        j = (c - i) / cols;
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          const ni = i + di,
            nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          if (dist[nj * cols + ni]! >= 2) green[nj * cols + ni] = 1;
        }
    }
  }

  // Tram lines: one west→east and one south→north, each along the most open avenue of the
  // middle band (a corridor cost keeps the line straight where the street allows it).
  const trams: [number, number][][] = [];
  const rowScore = (j: number) => {
    let n = 0;
    for (let i = 0; i < cols; i++) if (dist[j * cols + i]! >= 2) n++;
    return n;
  };
  const colScore = (i: number) => {
    let n = 0;
    for (let j = 0; j < rows; j++) if (dist[j * cols + i]! >= 2) n++;
    return n;
  };
  const best = (lo: number, hi: number, score: (k: number) => number) => {
    let bk = lo,
      bv = -1;
    for (let k = lo; k <= hi; k++) {
      const v = score(k);
      if (v > bv) {
        bv = v;
        bk = k;
      }
    }
    return bk;
  };
  const j0 = best(Math.round(rows * 0.3), Math.round(rows * 0.7), rowScore);
  const ew = streetPath(
    cols,
    rows,
    dist,
    openCellNear(cols, rows, dist, 0, j0, 6),
    openCellNear(cols, rows, dist, cols - 1, j0, 6),
    (_i, j) => 0.35 * Math.abs(j - j0),
  );
  if (ew) trams.push(simplify(ew, 1.0));
  const i0 = best(Math.round(cols * 0.3), Math.round(cols * 0.7), colScore);
  const sn = streetPath(
    cols,
    rows,
    dist,
    openCellNear(cols, rows, dist, i0, 0, 6),
    openCellNear(cols, rows, dist, i0, rows - 1, 6),
    (i) => 0.35 * Math.abs(i - i0),
  );
  if (sn) trams.push(simplify(sn, 1.0));
  return { buildingOf, buildings, green, trams };
}
