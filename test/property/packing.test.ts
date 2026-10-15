import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BRICKS, enabledShapes } from '../../src/core/packing/catalog.ts';
import { componentLowerBound, components, packHeightMap } from '../../src/core/packing/pack.ts';
import { verifyPacking } from '../../src/core/packing/verify.ts';
import type { HeightMap } from '../../src/core/types.ts';

/** Random height maps that look like cities: rectangles of constant height plus noise. */
function arbHeightMap(maxPlates = 2) {
  return fc
    .record({
      px: fc.integer({ min: 1, max: maxPlates }),
      py: fc.integer({ min: 1, max: maxPlates }),
      rects: fc.array(
        fc.record({
          x: fc.nat(63),
          y: fc.nat(63),
          w: fc.integer({ min: 1, max: 24 }),
          d: fc.integer({ min: 1, max: 24 }),
          h: fc.integer({ min: 1, max: 6 }),
        }),
        { maxLength: 12 },
      ),
      noise: fc.array(fc.record({ i: fc.nat(4095), h: fc.integer({ min: 0, max: 4 }) }), { maxLength: 40 }),
    })
    .map(({ px, py, rects, noise }): HeightMap => {
      const cols = px * 32,
        rows = py * 32;
      const data = new Int32Array(cols * rows);
      for (const r of rects)
        for (let y = r.y; y < Math.min(rows, r.y + r.d); y++)
          for (let x = r.x; x < Math.min(cols, r.x + r.w); x++)
            data[y * cols + x] = Math.max(data[y * cols + x]!, r.h);
      for (const n of noise) if (n.i < data.length) data[n.i] = n.h;
      return { cols, rows, data };
    });
}

const arbInventory = fc.record({
  enabled: fc.subarray(BRICKS.map((b) => b.id)),
  maxLength: fc.integer({ min: 1, max: 8 }),
});

describe('brick packing — properties (SPEC §7.5.1, N8)', () => {
  it('exact cover, no overlap, no plate crossing, enabled parts only', () => {
    fc.assert(
      fc.property(arbHeightMap(), arbInventory, (hm, inv) => {
        const r = packHeightMap(hm, { ...inv, beamWidth: 4 });
        expect(verifyPacking(hm, r.bricks, inv)).toEqual([]);
        expect(r.total).toBe(r.bricks.length);
        expect(r.total).toBeGreaterThanOrEqual(r.lowerBound);
      }),
      { numRuns: 60, seed: 42 },
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(arbHeightMap(), (hm) => {
        const a = packHeightMap(hm, { beamWidth: 6 });
        const b = packHeightMap({ ...hm, data: Int32Array.from(hm.data) }, { beamWidth: 6 });
        expect(b.bricks).toEqual(a.bricks);
      }),
      { numRuns: 25, seed: 7 },
    );
  });

  it('is plate-local: a plate packed alone equals the same plate inside the full model', () => {
    fc.assert(
      fc.property(arbHeightMap(3), (hm) => {
        const full = packHeightMap(hm, { beamWidth: 6 });
        const px = hm.cols / 32,
          py = hm.rows / 32;
        for (let row = 0; row < py; row++) {
          for (let col = 0; col < px; col++) {
            const plate = new Int32Array(1024);
            for (let y = 0; y < 32; y++)
              for (let x = 0; x < 32; x++)
                plate[y * 32 + x] = hm.data[(row * 32 + y) * hm.cols + col * 32 + x]!;
            const alone = packHeightMap({ cols: 32, rows: 32, data: plate }, { beamWidth: 6 });
            const name = `${String.fromCharCode(65 + col)}${py - row}`;
            const strip = (b: { plate: string }) => ({ ...b, plate: '' });
            expect(alone.bricks.map(strip)).toEqual(full.bricks.filter((b) => b.plate === name).map(strip));
          }
        }
      }),
      { numRuns: 15, seed: 11 },
    );
  });

  it('only 1×1 enabled gives one brick per stud and layer (1×1 cannot be disabled)', () => {
    const hm: HeightMap = { cols: 32, rows: 32, data: new Int32Array(1024).fill(2) };
    const r = packHeightMap(hm, { enabled: [] });
    expect(r.counts).toEqual({ '3005': 2048 });
    expect(verifyPacking(hm, r.bricks, { enabled: [] })).toEqual([]);
  });

  it('a full 32×32 layer packs into 2×8 bricks (64 parts = lower bound)', () => {
    const hm: HeightMap = { cols: 32, rows: 32, data: new Int32Array(1024).fill(1) };
    const r = packHeightMap(hm);
    expect(r.total).toBe(64);
    expect(r.lowerBound).toBe(64);
    expect(r.counts).toEqual({ '3007': 64 });
  });

  it('running bond: successive full layers cross the seams of the layer below', () => {
    const hm: HeightMap = { cols: 32, rows: 32, data: new Int32Array(1024).fill(3) };
    const r = packHeightMap(hm);
    expect(r.total).toBe(192);
    const perLayer = r.layers.map((l) => l.bond);
    expect(perLayer[0]).toBe(0);
    expect(perLayer[1]!).toBeGreaterThan(0);
    expect(perLayer[2]!).toBeGreaterThan(0);
  });

  it('component lower bound is valid on small exhaustive cases', () => {
    const shapes = enabledShapes();
    // 3×3 square: optimum is 2 bricks (2×3 + 1×3); the bound ⌈9 / 6⌉ = 2 (largest shape fitting a 3×3 box is 2×3)
    const m = new Uint32Array(32);
    m[0] = m[1] = m[2] = 0b111;
    expect(components(m)).toHaveLength(1);
    expect(componentLowerBound(m, shapes)).toBe(2);
    const hm: HeightMap = { cols: 32, rows: 32, data: new Int32Array(1024) };
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) hm.data[y * 32 + x] = 1;
    expect(packHeightMap(hm).total).toBe(2);
  });
});
