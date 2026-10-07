/**
 * Randomized legacy parity on the real Lyon 3 tiles: seeded random areas (centre, scale, plates,
 * rotation, max height) compared with legonizer@1.1.0 through the reference harness.
 */
import { describe, expect, it } from 'vitest';
import { csvBytes } from '../../src/core/export/csv.ts';
import { generateHeightMap } from '../../src/core/heightmap/index.ts';
import { importCityModel } from '../../src/core/import/index.ts';
import { prng } from '../../src/core/samples/synthetic.ts';
import { defaultParams, type CityMesh } from '../../src/core/types.ts';
import { hasLyonFixtures, loadLyon } from '../helpers/fixtures.ts';
import { buildReferenceLayer, referenceCsv, referenceHeightMap, type RefLayer } from './legacyReference.ts';

const RUNS = Number(process.env.PARITY_SWEEP_RUNS ?? 12);

describe.skipIf(!hasLyonFixtures([0, 7]))('legacy parity — random sweep on real Lyon tiles', () => {
  const files = hasLyonFixtures([0, 7]) ? loadLyon() : new Map();
  const mesh = files.size ? importCityModel(files) : (null as unknown as CityMesh);
  const layer = files.size ? buildReferenceLayer(files) : (null as unknown as RefLayer);
  it(`${RUNS} random areas: identical matrices and CSV bytes`, () => {
    const r = prng(20261006);
    const b = mesh.bounds;
    let compared = 0,
      nonZero = 0;
    for (let k = 0; k < RUNS; k++) {
      const scale = [0.5, 1, 1.5, 2, 2.5, 3, 4, 0.75, 1.25][r.int(0, 8)]!;
      const platesX = r.int(1, 2),
        platesY = r.int(1, 2);
      const maxHeight = r.int(1, 60);
      const rotationDeg = r.next() < 0.3 ? r.int(-60, 60) + r.next() : 0;
      const cx = b.min[0] + 200 + r.next() * (b.max[0] - b.min[0] - 400);
      const cy = b.min[1] + 200 + r.next() * (b.max[1] - b.min[1] - 400);
      const params = { ...defaultParams(platesX, platesY), scale, maxHeight };
      const ours = generateHeightMap(mesh, { cx, cy, rotationDeg }, params);
      const ref = referenceHeightMap(layer, {
        cx,
        cy,
        rotationZ: (rotationDeg * Math.PI) / 180,
        platesX,
        platesY,
        scale,
        legoHeight: maxHeight,
      });
      if (ours.warnings.includes('flat-geometry')) continue; // legonizer writes NaN there (documented deviation)
      let diff = 0;
      ref.heightMap.forEach((row, j) =>
        row.forEach((v, i) => (diff += v === ours.heightMap.data[j * ours.heightMap.cols + i] ? 0 : 1)),
      );
      expect({ k, cx, cy, scale, platesX, platesY, rotationDeg, maxHeight, diff }).toMatchObject({ diff: 0 });
      expect(
        Buffer.from(csvBytes(ours.heightMap)).equals(Buffer.from(referenceCsv(ref.heightMap, 'x.csv').bytes)),
      ).toBe(true);
      compared++;
      nonZero += ours.heightMap.data.filter((v) => v > 0).length;
    }
    console.log(
      `[parity sweep] ${compared}/${RUNS} areas compared, ${nonZero} non-zero cells, 0 differences`,
    );
    expect(compared).toBeGreaterThan(RUNS / 2);
    expect(nonZero).toBeGreaterThan(0);
    // empty selections are compared too (all zeros on both sides)
  });
});
