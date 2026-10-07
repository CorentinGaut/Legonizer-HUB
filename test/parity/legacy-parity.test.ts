/**
 * SPEC §10.3 — legacy parity: our legacy mode vs the real legonizer@1.1.0 (+ the UD-Viz 4.6.1
 * pre-processing replayed with three r154), cell for cell and CSV byte for byte.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { csvBytes, csvFileName } from '../../src/core/export/csv.ts';
import { generateHeightMap } from '../../src/core/heightmap/index.ts';
import { importCityModel } from '../../src/core/import/index.ts';
import type { DemoManifest } from '../../src/core/samples/manifest.ts';
import { SYNTHETIC_CENTRE, syntheticBoxesCity, syntheticSlope } from '../../src/core/samples/synthetic.ts';
import { defaultParams, type CityMesh, type HeightMap } from '../../src/core/types.ts';
import { ROOT, hasLyonFixtures, loadLyon } from '../helpers/fixtures.ts';
import { buildReferenceLayer, referenceCsv, referenceHeightMap, type RefLayer } from './legacyReference.ts';

interface Case {
  name: string;
  cx: number;
  cy: number;
  /** Area rotation as entered in our UI; UD-Viz receives the same value converted to radians. */
  rotationDeg: number;
  platesX: number;
  platesY: number;
  scale: number;
  maxHeight: number;
}

function diff(ref: number[][], ours: HeightMap) {
  const out: { i: number; j: number; ref: number; ours: number }[] = [];
  let n = 0;
  for (let j = 0; j < ref.length; j++) {
    for (let i = 0; i < ref[j]!.length; i++) {
      const r = ref[j]![i]!;
      const o = ours.data[j * ours.cols + i]!;
      if (!(r === o)) {
        n++;
        if (out.length < 10) out.push({ i, j, ref: r, ours: o });
      }
    }
  }
  return { count: n, first: out };
}

export function runParity(mesh: CityMesh, layer: RefLayer, c: Case) {
  const params = { ...defaultParams(c.platesX, c.platesY), scale: c.scale, maxHeight: c.maxHeight };
  const area = { cx: c.cx, cy: c.cy, rotationDeg: c.rotationDeg };
  const ref = referenceHeightMap(layer, {
    ...c,
    rotationZ: (c.rotationDeg * Math.PI) / 180,
    legoHeight: c.maxHeight,
  });
  const ours = generateHeightMap(mesh, area, params);
  expect(ours.legacy).toBe(true);
  expect(ours.heightMap.rows).toBe(ref.heightMap.length);
  expect(ours.heightMap.cols).toBe(ref.heightMap[0]!.length);
  const d = diff(ref.heightMap, ours.heightMap);
  const refCsv = referenceCsv(ref.heightMap, csvFileName(c.platesX, c.platesY));
  const ourCsv = csvBytes(ours.heightMap);
  let nonZero = 0;
  for (const v of ours.heightMap.data) if (v) nonZero++;
  return { d, refCsv, ourCsv, nonZero, ours, selectedTriangles: ref.selected };
}

const [CX, CY] = SYNTHETIC_CENTRE;
const DEMO = JSON.parse(
  readFileSync(join(ROOT, 'public', 'data', 'demo', 'sample', 'manifest.json'), 'utf8'),
) as DemoManifest;

describe('legacy parity — synthetic boxes city (py3dtilers-like b3dm tileset)', () => {
  const files = syntheticBoxesCity(1);
  const mesh = importCityModel(files);
  const layer = buildReferenceLayer(files);
  const cases: Case[] = [
    {
      name: 'aligned 4×4 @3 m (rays on edges and vertices)',
      cx: CX,
      cy: CY,
      rotationDeg: 0,
      platesX: 4,
      platesY: 4,
      scale: 3,
      maxHeight: 10,
    },
    {
      name: '2×2 @1.5 m, max 25',
      cx: CX + 40,
      cy: CY - 20,
      rotationDeg: 0,
      platesX: 2,
      platesY: 2,
      scale: 1.5,
      maxHeight: 25,
    },
    {
      name: 'off-grid centre 3×2 @2 m, max 7',
      cx: CX + 1.37,
      cy: CY - 2.11,
      rotationDeg: 0,
      platesX: 3,
      platesY: 2,
      scale: 2,
      maxHeight: 7,
    },
    {
      // the demo's curated default area in strict Legacy (the sample is the site's only demo)
      name: `demo default area ${DEMO.defaultArea.platesX}×${DEMO.defaultArea.platesY} @${DEMO.suggested.strictLegacy.scale} m`,
      cx: DEMO.defaultArea.area.cx,
      cy: DEMO.defaultArea.area.cy,
      rotationDeg: DEMO.defaultArea.area.rotationDeg,
      platesX: DEMO.defaultArea.platesX,
      platesY: DEMO.defaultArea.platesY,
      scale: DEMO.suggested.strictLegacy.scale,
      maxHeight: DEMO.suggested.strictLegacy.maxHeight,
    },
    {
      name: 'rotated area 30° (L3: AABB) 2×3 @2.5 m',
      cx: CX - 10,
      cy: CY + 5,
      rotationDeg: 30,
      platesX: 2,
      platesY: 3,
      scale: 2.5,
      maxHeight: 10,
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = runParity(mesh, layer, c);
      expect(r.nonZero).toBeGreaterThan(50);
      expect(r.d.first).toEqual([]);
      expect(r.d.count).toBe(0);
      expect(Buffer.from(r.ourCsv).equals(Buffer.from(r.refCsv.bytes))).toBe(true);
    });
  }
});

describe('legacy parity — synthetic sloped scene (gabled roofs on a 100 m slope)', () => {
  const files = syntheticSlope(2);
  const mesh = importCityModel(files);
  const layer = buildReferenceLayer(files);
  const cases: Case[] = [
    { name: '4×4 @3 m', cx: CX, cy: CY, rotationDeg: 0, platesX: 4, platesY: 4, scale: 3, maxHeight: 10 },
    {
      name: '2×2 @2 m, max 40',
      cx: CX + 60,
      cy: CY - 30,
      rotationDeg: 0,
      platesX: 2,
      platesY: 2,
      scale: 2,
      maxHeight: 40,
    },
    {
      name: 'rotated 17° 3×3 @1.25 m',
      cx: CX - 30,
      cy: CY + 10,
      rotationDeg: 17,
      platesX: 3,
      platesY: 3,
      scale: 1.25,
      maxHeight: 12,
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = runParity(mesh, layer, c);
      expect(r.nonZero).toBeGreaterThan(50);
      expect(r.d.first).toEqual([]);
      expect(Buffer.from(r.ourCsv).equals(Buffer.from(r.refCsv.bytes))).toBe(true);
    });
  }
});

describe.skipIf(!hasLyonFixtures([0, 7]))('legacy parity — real Lyon 3 (2018) tiles', () => {
  // all tiles present are used (cross-tile selection); 0 and 7 are enough for these areas
  const files = hasLyonFixtures([0, 7]) ? loadLyon() : new Map();
  const mesh = files.size ? importCityModel(files) : (null as unknown as CityMesh);
  const layer = files.size ? buildReferenceLayer(files) : (null as unknown as RefLayer);
  const cases: Case[] = [
    {
      name: 'Part-Dieu 2×2 @3 m (UD-Viz defaults)',
      cx: 1844300,
      cy: 5175100,
      rotationDeg: 0,
      platesX: 2,
      platesY: 2,
      scale: 3,
      maxHeight: 10,
    },
    {
      name: 'Part-Dieu 3×2 @2 m, max 40',
      cx: 1844420.37,
      cy: 5175020.81,
      rotationDeg: 0,
      platesX: 3,
      platesY: 2,
      scale: 2,
      maxHeight: 40,
    },
    {
      name: 'Lyon 3 south 2×2 @3 m',
      cx: 1845530,
      cy: 5173790,
      rotationDeg: 0,
      platesX: 2,
      platesY: 2,
      scale: 3,
      maxHeight: 10,
    },
    {
      name: 'Part-Dieu rotated 23° 2×2 @2.5 m',
      cx: 1844250,
      cy: 5175150,
      rotationDeg: 23,
      platesX: 2,
      platesY: 2,
      scale: 2.5,
      maxHeight: 15,
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = runParity(mesh, layer, c);
      console.log(
        `[parity] ${c.name}: ${r.ours.heightMap.cols}×${r.ours.heightMap.rows}, non-zero ${r.nonZero}, ref triangles ${r.selectedTriangles}, ours ${r.ours.selection.triangles}, diff ${r.d.count}`,
      );
      expect(r.nonZero).toBeGreaterThan(50);
      expect(r.d.first).toEqual([]);
      expect(Buffer.from(r.ourCsv).equals(Buffer.from(r.refCsv.bytes))).toBe(true);
    });
  }
});
