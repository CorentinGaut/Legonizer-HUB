import { describe, expect, it } from 'vitest';
import {
  defaultArea,
  estimateHeights,
  fitsTable,
  generateHeightMap,
  mapScaleDenominator,
  validateParams,
} from '../../src/core/heightmap/index.ts';
import { generateHeightMapAsync } from '../../src/core/heightmap/index.ts';
import { quantize } from '../../src/core/heightmap/improved.ts';
import { importCityModel } from '../../src/core/import/index.ts';
import { SYNTHETIC_CENTRE, syntheticBoxesCity, syntheticSlope } from '../../src/core/samples/synthetic.ts';
import { defaultParams, isLegacy, usesLegacyGeometry, type Params } from '../../src/core/types.ts';

const [CX, CY] = SYNTHETIC_CENTRE;
const boxes = importCityModel(syntheticBoxesCity(1));
const slope = importCityModel(syntheticSlope(2));

describe('heightmap — options (SPEC §7.3)', () => {
  const variants: Partial<Params>[] = [
    {},
    { keepSmall: true },
    { heightMode: 'true-scale' },
    { heightMode: 'exaggerated', exaggeration: 2, rounding: 'round' },
    { sampling: 'centre-1', rotation: 'rotate' },
    { sampling: 'supersample-3', aggregate: 'max', rotation: 'rotate' },
    { sampling: 'supersample-2', aggregate: 'median', heightRef: 'ground' },
    { selection: 'clip', rounding: 'ceil', cap: 5 },
    { rotation: 'rotate', heightRef: 'ground', heightMode: 'true-scale', keepSmall: true },
  ];
  for (const v of variants) {
    it(`BVH does not change results: ${JSON.stringify(v)}`, () => {
      for (const [mesh, rot] of [
        [boxes, 0],
        [slope, 17],
      ] as const) {
        const p = { ...defaultParams(2, 2), ...v } as Params;
        const area = { cx: CX + 7, cy: CY - 3, rotationDeg: rot };
        const a = generateHeightMap(mesh, area, p);
        const b = generateHeightMap(mesh, area, p, { useBvh: false });
        expect(Array.from(a.heightMap.data)).toEqual(Array.from(b.heightMap.data));
        expect(a.heightMap.data.some((x) => x > 0)).toBe(true);
      }
    });
  }

  it('the legacy preset is detected; quantization-only options keep the legacy sampling', () => {
    expect(isLegacy(defaultParams())).toBe(true);
    expect(usesLegacyGeometry({ ...defaultParams(), keepSmall: true })).toBe(true);
    expect(isLegacy({ ...defaultParams(), keepSmall: true })).toBe(false);
    const area = { cx: CX, cy: CY, rotationDeg: 0 };
    const legacy = generateHeightMap(boxes, area, defaultParams(4, 4), { keepRaw: true });
    const keep = generateHeightMap(boxes, area, { ...defaultParams(4, 4), keepSmall: true });
    expect(keep.pipeline).toBe('legacy-geometry');
    let changed = 0;
    for (let c = 0; c < legacy.heightMap.data.length; c++) {
      const l = legacy.heightMap.data[c]!,
        k = keep.heightMap.data[c]!;
      if (l !== k) {
        changed++;
        // only cells below one brick become 1
        expect(l).toBe(0);
        expect(k).toBe(1);
        expect(legacy.raw![c]!).toBeGreaterThan(0);
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('rotation: aabb samples the bounding box (L3/L9), rotate turns the grid; the sampled rectangle says so', () => {
    const p = defaultParams(2, 1);
    const area = { cx: CX, cy: CY, rotationDeg: 30 };
    const aabb = generateHeightMap(boxes, area, p);
    expect(aabb.warnings).toContain('legacy-rotation-aabb');
    expect(aabb.sampledRect.differsFromArea).toBe(true);
    expect(aabb.sampledRect.rotation).toBe(0);
    // L9: square step from the X extent → sampled height ≠ AABB height
    const w = 192,
      h = 96;
    const c = Math.cos(Math.PI / 6),
      s = Math.sin(Math.PI / 6);
    expect(aabb.sampledRect.width).toBeCloseTo(w * c + h * s, 0);
    expect(aabb.sampledRect.height).toBeCloseTo((w * c + h * s) / 2, 0);
    const rot = generateHeightMap(boxes, area, { ...p, rotation: 'rotate' });
    expect(rot.sampledRect.differsFromArea).toBe(false);
    expect(rot.sampledRect.width).toBeCloseTo(w, 9);
    expect(rot.grid.rotation).toBeCloseTo(Math.PI / 6, 12);
    const flat = generateHeightMap(boxes, { cx: CX, cy: CY, rotationDeg: 0 }, p);
    expect(flat.sampledRect.differsFromArea).toBe(false);
  });

  it('ground reference removes the slope (L4); lowest-base keeps it', () => {
    const area = { cx: CX, cy: CY, rotationDeg: 0 };
    const base = {
      ...defaultParams(4, 4),
      heightMode: 'true-scale',
      sampling: 'centre-1',
      rotation: 'rotate',
    } as Params;
    const lowest = generateHeightMap(slope, area, base);
    const ground = generateHeightMap(slope, area, { ...base, heightRef: 'ground' });
    // houses are ≤ 3 + 15 + 7 + slope across their width ≈ 30 m → ≤ 10 bricks at 3.6 m/brick
    expect(ground.vertical.maxValue).toBeLessThanOrEqual(10);
    expect(lowest.vertical.maxValue).toBeGreaterThan(30); // uphill houses gain the hill (~100 m)
  });

  it('true-scale: 1 brick = scale × 1.2 m', () => {
    const area = { cx: CX, cy: CY, rotationDeg: 0 };
    const r = generateHeightMap(boxes, area, { ...defaultParams(4, 4), heightMode: 'true-scale' });
    expect(r.vertical.metresPerBrick).toBeCloseTo(3.6, 12);
    expect(r.vertical.maxValue).toBe(Math.trunc(96 / 3.6)); // the 96 m tower
  });

  it('quantize: rounding, keep small, cap', () => {
    const p = { ...defaultParams(), rounding: 'trunc' } as Params;
    expect(quantize(7.19, 3.6, p)).toBe(1);
    expect(quantize(7.2, 3.6, p)).toBe(2); // exact multiple survives float error
    expect(quantize(5.4, 3.6, { ...p, rounding: 'round' })).toBe(2);
    expect(quantize(3.7, 3.6, { ...p, rounding: 'ceil' })).toBe(2);
    expect(quantize(1, 3.6, { ...p, keepSmall: true })).toBe(1);
    expect(quantize(0.005, 3.6, { ...p, keepSmall: true })).toBe(0);
    expect(quantize(100, 3.6, { ...p, cap: 5 })).toBe(5);
  });

  it('async generation equals sync and can be cancelled', async () => {
    const area = { cx: CX, cy: CY, rotationDeg: 0 };
    const p = { ...defaultParams(4, 4), sampling: 'supersample-4', rotation: 'rotate' } as Params;
    const sync = generateHeightMap(boxes, area, p);
    const asyncR = await generateHeightMapAsync(boxes, area, p);
    expect(Array.from(asyncR.heightMap.data)).toEqual(Array.from(sync.heightMap.data));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(generateHeightMapAsync(boxes, area, p, { signal: ctrl.signal })).rejects.toThrow(
      /cancelled/,
    );
  });

  it('validates parameters', () => {
    expect(() => validateParams({ ...defaultParams(), scale: 0 })).toThrow(/scale/);
    expect(() => validateParams({ ...defaultParams(), platesX: 1.5 })).toThrow(/plates/);
    expect(() => validateParams({ ...defaultParams(), rotation: 'spin' as never })).toThrow(/rotation/);
  });
});

describe('estimates and area helpers', () => {
  it('estimates L1 erasure and physical size', () => {
    const e = estimateHeights(boxes, { cx: CX, cy: CY, rotationDeg: 0 }, defaultParams(4, 4));
    expect(e.studs).toBe(128 * 128);
    expect(e.widthCm).toBeCloseTo(102.4, 9);
    expect(e.mapScale).toBe(375);
    expect(e.maxBricks).toBe(10);
    expect(e.featuresBelowOneBrick).toBeGreaterThan(0); // 9.6 m per brick erases low boxes
    expect(e.shareBelowOneBrick).toBeGreaterThan(0);
    const t = estimateHeights(
      boxes,
      { cx: CX, cy: CY, rotationDeg: 0 },
      { ...defaultParams(4, 4), heightMode: 'true-scale', keepSmall: true },
    );
    expect(t.featuresBelowOneBrick).toBe(0);
    expect(t.maxHeightCm).toBeCloseTo(26 * 0.96, 9);
  });

  it('table fit, map scale, default area (A3, A5)', () => {
    expect(fitsTable(3, 7)).toBe(true);
    expect(fitsTable(7, 3)).toBe(true);
    expect(fitsTable(4, 4)).toBe(false);
    expect(mapScaleDenominator(3)).toBe(375);
    const d = defaultArea(boxes.bounds, 3);
    expect([d.platesX, d.platesY]).toEqual([4, 4]);
    expect(defaultArea({ min: [0, 0, 0], max: [5000, 100, 0] }, 3)).toMatchObject({ platesX: 2, platesY: 2 });
  });
});
