#!/usr/bin/env node
/**
 * Home animation fixture (SPEC H4, docs/ux/storyboard.md §1.1): Part-Dieu heightmap produced by our
 * own pipeline from the demo dataset, saved to src/data/home/part-dieu-home.json for phase 2.
 *
 * Choice: True scale (not legacy). Storyboard constraints: 3 × 5 baseplates with north facing the
 * mast (5 plates west→east, 3 north→south), no building erased (keep small buildings), tallest
 * tower ≤ 24 bricks, station and towers inside. Legacy normalized mode would give 1 brick ≈ 18 m
 * here and erase most of the district (L1), which is the opposite of what the animation shows.
 * At 6 m/stud one brick is 7.2 m: the 179 m tower → 24 bricks (trunc), the station (15 m) → 2.
 * Height reference `ground` (each building from its own base) so the Rhône-side slope does not
 * lift buildings (L4); centre sampling; grid aligned with the axes (rotation 0).
 *
 * The fixture stores the heights (not the bricks): phase 2 packs them with packHeightMap, which is
 * deterministic, and the summary below lets it assert it got the same parts.
 *
 * Usage: node scripts/build-home-heightmap.ts   (needs fixtures/demo/part-dieu, see build-demo-datasets.ts)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { generateHeightMap } from '../src/core/heightmap/index.ts';
import { importCityModel } from '../src/core/import/index.ts';
import { packHeightMap } from '../src/core/packing/pack.ts';
import { defaultParams, type Params } from '../src/core/types.ts';
import { APP_VERSION, HEIGHTMAP_ALGORITHM_VERSION, PACKING_ALGORITHM_VERSION } from '../src/core/version.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demoZip = join(root, 'fixtures', 'demo', 'part-dieu', 'part-dieu.zip');
if (!existsSync(demoZip)) {
  console.error(
    'Missing fixtures/demo/part-dieu/part-dieu.zip: run `npm run fixtures:lyon -- --all` then `npm run fixtures:demo`.',
  );
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(dirname(demoZip), 'manifest.json'), 'utf8'));
const files = new Map(Object.entries(unzipSync(new Uint8Array(readFileSync(demoZip)))));
const mesh = importCityModel(files);

const area = { cx: 1844400, cy: 5175150, rotationDeg: 0 };
const params: Params = {
  ...defaultParams(5, 3),
  scale: 6,
  heightMode: 'true-scale',
  heightRef: 'ground',
  sampling: 'centre-1',
  rotation: 'rotate',
  rounding: 'trunc',
  keepSmall: true,
};
const result = generateHeightMap(mesh, area, params);
const hm = result.heightMap;
const packing = packHeightMap(hm);
if (result.vertical.maxValue > 24) throw new Error(`tallest column ${result.vertical.maxValue} > 24 bricks`);

const fixture = {
  kind: 'legonizer-home-heightmap',
  formatVersion: 1,
  generated: {
    date: new Date().toISOString().slice(0, 10),
    app: APP_VERSION,
    heightmapAlgorithm: HEIGHTMAP_ALGORITHM_VERSION,
    packingAlgorithm: PACKING_ALGORITHM_VERSION,
  },
  source: {
    dataset: 'part-dieu',
    archiveSha256: manifest.sha256,
    attribution: manifest.source.attribution,
    licence: manifest.source.licence,
  },
  layout: {
    platesX: 5,
    platesY: 3,
    note: 'platesX west→east (table length), platesY north→south; north faces the mast (storyboard §1.1)',
  },
  area,
  params,
  inventory: { enabled: 'all', maxLength: 8 },
  grid: result.grid,
  heightMap: {
    cols: hm.cols,
    rows: hm.rows,
    order: 'data[j*cols + i], j south→north, i west→east',
    data: Array.from(hm.data),
  },
  summary: {
    maxBricks: result.vertical.maxValue,
    metresPerBrick: result.vertical.metresPerBrick,
    tallestCm: (result.vertical.maxValue * 9.6) / 10,
    studsWithBricks: hm.data.filter((v) => v > 0).length,
    totalBricks: packing.total,
    counts: packing.counts,
    baseplates: packing.baseplates.quantity,
    lowerBound: packing.lowerBound,
  },
};
const out = join(root, 'src', 'data', 'home', 'part-dieu-home.json');
writeFileSync(out, JSON.stringify(fixture) + '\n');
console.log(
  `${out}: ${hm.cols}×${hm.rows} studs, tallest ${result.vertical.maxValue} bricks, ${packing.total} bricks (lower bound ${packing.lowerBound}), ${(JSON.stringify(fixture).length / 1024).toFixed(0)} kB`,
);
