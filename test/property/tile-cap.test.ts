import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ldrawModel } from '../../src/core/export/ldraw.ts';
import { partLines } from '../../src/core/export/parts.ts';
import { decodePlatePass, encodePlatePass } from '../../src/core/export/platePass.ts';
import { createProject, parseProject, serializeProject } from '../../src/core/export/project.ts';
import { BRICKS, TILES, isTile, type TileCapMode } from '../../src/core/packing/catalog.ts';
import { packHeightMap, plateBrickHeight } from '../../src/core/packing/pack.ts';
import { verifyPacking } from '../../src/core/packing/verify.ts';
import type { HeightMap } from '../../src/core/types.ts';

/** Random 1–2 × 1–2 plate city: rectangles of constant height. */
const arbHeightMap = fc
  .record({
    px: fc.integer({ min: 1, max: 2 }),
    py: fc.integer({ min: 1, max: 2 }),
    rects: fc.array(
      fc.record({
        x: fc.nat(63),
        y: fc.nat(63),
        w: fc.integer({ min: 1, max: 20 }),
        d: fc.integer({ min: 1, max: 20 }),
        h: fc.integer({ min: 1, max: 5 }),
      }),
      { maxLength: 10 },
    ),
  })
  .map(({ px, py, rects }): HeightMap => {
    const cols = px * 32,
      rows = py * 32;
    const data = new Int32Array(cols * rows);
    for (const r of rects)
      for (let y = r.y; y < Math.min(rows, r.y + r.d); y++)
        for (let x = r.x; x < Math.min(cols, r.x + r.w); x++)
          data[y * cols + x] = Math.max(data[y * cols + x]!, r.h);
    return { cols, rows, data };
  });

const arbCap = fc.constantFrom<TileCapMode>('roofs', 'all');

function tileArea(r: ReturnType<typeof packHeightMap>): number {
  return r.bricks.filter((b) => isTile(b.partId)).reduce((a, b) => a + b.w * b.d, 0);
}

describe('smooth tile cap (SPEC §7.5.1)', () => {
  it('tiles cover exactly the capped columns, one layer above them; bricks unchanged', () => {
    fc.assert(
      fc.property(arbHeightMap, arbCap, fc.integer({ min: 1, max: 8 }), (hm, tileCap, maxLength) => {
        const inv = { maxLength, tileCap };
        const r = packHeightMap(hm, { ...inv, beamWidth: 4 });
        expect(verifyPacking(hm, r.bricks, inv)).toEqual([]);
        const capped = Array.from(hm.data).filter((h) => (tileCap === 'all' ? h >= 0 : h >= 1)).length;
        expect(tileArea(r)).toBe(capped);
        expect(r.tiles + r.total).toBe(r.bricks.length);
        // the bricks are the ones packed without a cap
        const plain = packHeightMap(hm, { maxLength, beamWidth: 4 });
        expect(r.bricks.filter((b) => !isTile(b.partId))).toEqual(plain.bricks);
        expect(r.total).toBe(plain.total);
        for (const p of r.plates) {
          const q = plain.plates.find((x) => x.plate === p.plate)!;
          expect(plateBrickHeight(p)).toBe(q.layers);
        }
      }),
      { numRuns: 40, seed: 7 },
    );
  });

  it('a tile sits on the column below it and respects the longest side', () => {
    const hm: HeightMap = { cols: 32, rows: 32, data: new Int32Array(32 * 32) };
    for (let y = 4; y < 12; y++) for (let x = 4; x < 20; x++) hm.data[y * 32 + x] = 3;
    const r = packHeightMap(hm, { tileCap: 'roofs', maxLength: 4 });
    const tiles = r.bricks.filter((b) => isTile(b.partId));
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.layer).toBe(4);
      expect(Math.max(t.w, t.d)).toBeLessThanOrEqual(4);
    }
    expect(r.plates[0]!.layers).toBe(4);
    expect(verifyPacking(hm, r.bricks, { tileCap: 'none' }).some((p) => p.kind === 'disabled-part')).toBe(
      true,
    );
  });

  it("'all' tiles the bare baseplate too; 'none' adds nothing", () => {
    const hm: HeightMap = { cols: 32, rows: 32, data: new Int32Array(32 * 32) };
    const all = packHeightMap(hm, { tileCap: 'all' });
    expect(tileArea(all)).toBe(32 * 32);
    expect(all.bricks.every((b) => b.layer === 1)).toBe(true);
    expect(packHeightMap(hm, { tileCap: 'roofs' }).bricks).toEqual([]);
    expect(packHeightMap(hm, {}).tiles).toBe(0);
  });

  it('parts list and LDraw: tiles after the bricks, 8 LDU high on the layer below', () => {
    const hm: HeightMap = { cols: 32, rows: 32, data: new Int32Array(32 * 32) };
    hm.data[0] = 2;
    const r = packHeightMap(hm, { tileCap: 'roofs' });
    const lines = partLines(r, false);
    expect(lines.map((l) => l.partId)).toEqual(['3005', '3070b']);
    const ldr = ldrawModel(r, 1);
    const tileLine = ldr.split('\r\n').find((l) => l.endsWith(' 3070b.dat'))!;
    expect(tileLine.split(' ')[3]).toBe(String(-24 * 2 - 8)); // y of the top face
    expect(TILES.every((t) => !BRICKS.some((b) => b.id === t.id))).toBe(true);
  });

  it('plate pass and project file keep the cap; older payloads read as none', () => {
    const heights = new Int32Array(32 * 32).fill(1);
    for (const tileCap of ['none', 'roofs', 'all'] as const) {
      const back = decodePlatePass(encodePlatePass({ plate: 'A1', heights, inventory: { tileCap } }));
      expect(back.inventory.tileCap).toBe(tileCap);
    }
    const hm: HeightMap = { cols: 32, rows: 32, data: heights };
    const base = { inputs: [], area: { cx: 0, cy: 0, rotationDeg: 0 }, params: {} as never, heightMap: hm };
    const plain = createProject({ ...base, inventory: {} });
    expect('tileCap' in plain.inventory).toBe(false);
    const capped = parseProject(serializeProject(createProject({ ...base, inventory: { tileCap: 'all' } })));
    expect(capped.inventory.tileCap).toBe('all');
  });
});
