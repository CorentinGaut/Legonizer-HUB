/**
 * Independent check of a packing: every layer of every plate is covered exactly (no gap, no
 * overlap), bricks stay inside their plate, sizes match an enabled catalog part and orientation.
 */
import { STUDS_PER_PLATE, type HeightMap, type PlacedBrick } from '../types.ts';
import { BRICKS, normalizeInventory, type InventoryOptions } from './catalog.ts';
import { parsePlateName, plateName } from './plates.ts';

export interface PackingProblem {
  kind: 'gap' | 'overlap' | 'outside-plate' | 'outside-mask' | 'bad-part' | 'disabled-part';
  plate: string;
  layer: number;
  x: number;
  y: number;
}

export function verifyPacking(
  hm: HeightMap,
  bricks: PlacedBrick[],
  inventory: InventoryOptions = {},
): PackingProblem[] {
  const N = STUDS_PER_PLATE;
  const py = hm.rows / N;
  const inv = normalizeInventory(inventory);
  const problems: PackingProblem[] = [];
  const cover = new Map<string, Uint8Array>(); // `${plate}|${layer}` → 32×32 coverage counts
  for (const b of bricks) {
    const part = BRICKS.find((p) => p.id === b.partId);
    const dims =
      part &&
      ((b.w === part.length && b.d === part.width && b.rotation === 0) ||
        (b.w === part.width && b.d === part.length && (b.rotation === 90 || part.width === part.length)));
    if (!part || !dims) problems.push({ kind: 'bad-part', plate: b.plate, layer: b.layer, x: b.x, y: b.y });
    else if (!inv.enabled.includes(part.id) || (part.length > inv.maxLength && part.id !== '3005'))
      problems.push({ kind: 'disabled-part', plate: b.plate, layer: b.layer, x: b.x, y: b.y });
    if (b.x < 0 || b.y < 0 || b.x + b.w > N || b.y + b.d > N) {
      problems.push({ kind: 'outside-plate', plate: b.plate, layer: b.layer, x: b.x, y: b.y });
      continue;
    }
    const key = `${b.plate}|${b.layer}`;
    let c = cover.get(key);
    if (!c) cover.set(key, (c = new Uint8Array(N * N)));
    for (let y = b.y; y < b.y + b.d; y++) for (let x = b.x; x < b.x + b.w; x++) c[y * N + x]!++;
  }
  const px = hm.cols / N;
  for (let row = 0; row < py; row++) {
    for (let col = 0; col < px; col++) {
      let hmax = 0;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) hmax = Math.max(hmax, hm.data[(row * N + y) * hm.cols + col * N + x]!);
      const plate = plateName(col, row, py);
      for (let k = 1; k <= hmax; k++) {
        const c = cover.get(`${plate}|${k}`);
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            const want = hm.data[(row * N + y) * hm.cols + col * N + x]! >= k ? 1 : 0;
            const got = c ? c[y * N + x]! : 0;
            if (got > 1) problems.push({ kind: 'overlap', plate: plate, layer: k, x, y });
            else if (want && !got) problems.push({ kind: 'gap', plate, layer: k, x, y });
            else if (!want && got) problems.push({ kind: 'outside-mask', plate, layer: k, x, y });
          }
        }
      }
    }
  }
  // bricks on layers above the plate's max height
  for (const b of bricks) {
    const { col, southRow } = parsePlateName(b.plate, py);
    if (col < 0 || col >= px || southRow < 0 || southRow >= py)
      problems.push({ kind: 'outside-plate', plate: b.plate, layer: b.layer, x: b.x, y: b.y });
  }
  return problems;
}
