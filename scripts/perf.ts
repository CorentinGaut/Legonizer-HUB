#!/usr/bin/env node
/**
 * Performance measurements for docs/perf.md (SPEC G1: 4 × 4 plates on ~1 M triangles in < 5 s).
 * Datasets: real Lyon 3 (2018) tiles (540 k triangles) and the same tileset plus a copy shifted
 * 4.5 km east (1.08 M triangles). Node runs V8 like Chrome; browser timings are measured in phase 2.
 *
 * Usage: node scripts/perf.ts [--baseline]   (--baseline also times legonizer@1.1.0 itself)
 */
import { cpus, totalmem, type as osType, release } from 'node:os';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateHeightMap } from '../src/core/heightmap/index.ts';
import { getMeshIndex, getBvh } from '../src/core/heightmap/meshIndex.ts';
import type { FileMap } from '../src/core/import/fileMap.ts';
import { importCityModel } from '../src/core/import/index.ts';
import { packHeightMap } from '../src/core/packing/pack.ts';
import { parseB3dm } from '../src/core/import/b3dm.ts';
import { writeB3dm } from '../src/core/samples/synthetic.ts';
import { defaultParams, type Params } from '../src/core/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'fixtures', 'lyon3-2018');
if (!existsSync(join(dir, 'tileset.json'))) throw new Error('run `npm run fixtures:lyon -- --all` first');

function lyon(copies: number): FileMap {
  const files: FileMap = new Map();
  const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8'));
  const tiles = readdirSync(join(dir, 'tiles'));
  const children: unknown[] = [];
  for (let c = 0; c < copies; c++) {
    for (const ch of ts.root.children) {
      const t = [...ch.transform];
      t[12] += c * 4500;
      const uri = c === 0 ? ch.content.uri : ch.content.uri.replace('tiles/', `copy${c}/`);
      children.push({ ...ch, transform: t, content: { uri } });
    }
    for (const f of tiles) {
      let data: Uint8Array = new Uint8Array(readFileSync(join(dir, 'tiles', f)));
      if (c > 0) {
        // the copy gets its own gml_ids, otherwise each copied building would merge with its original
        const b = parseB3dm(data);
        const bt = {
          ...b.batchTable,
          gml_id: (b.batchTable.gml_id ?? []).map((g) => `${String(g)}_copy${c}`),
        };
        data = writeB3dm(b.glb, b.batchLength, bt);
      }
      files.set(c === 0 ? `tiles/${f}` : `copy${c}/${f}`, data);
    }
  }
  files.set(
    'tileset.json',
    new TextEncoder().encode(JSON.stringify({ ...ts, root: { ...ts.root, children } })),
  );
  return files;
}

const ms = (t0: number) => performance.now() - t0;
const fmt = (x: number) => (x < 10 ? x.toFixed(1) : x.toFixed(0));
const area = { cx: 1844300, cy: 5175100, rotationDeg: 0 };
const variants: [string, Params][] = [
  ['Legacy preset (exact UD-Viz numerics)', defaultParams(4, 4)],
  ['Legacy + keep small', { ...defaultParams(4, 4), keepSmall: true }],
  [
    'True scale, ground, centre, rotate',
    {
      ...defaultParams(4, 4),
      heightMode: 'true-scale',
      heightRef: 'ground',
      sampling: 'centre-1',
      rotation: 'rotate',
      keepSmall: true,
    },
  ],
  [
    'Supersample 4×4 (max), true scale, rotated 20°',
    {
      ...defaultParams(4, 4),
      heightMode: 'true-scale',
      sampling: 'supersample-4',
      aggregate: 'max',
      rotation: 'rotate',
    },
  ],
];

const cpu = cpus()[0]!;
console.log(
  `Machine: ${cpu.model}, ${cpus().length} logical CPUs, ${(totalmem() / 2 ** 30).toFixed(0)} GiB RAM, ${osType()} ${release()}, Node ${process.version}`,
);
console.log('');
console.log(
  '| Dataset | Triangles | Import (parse) | Index | BVH build | Variant | Heightmap | Packing (bricks) | Total generate |',
);
console.log('|---|---|---|---|---|---|---|---|---|');
for (const copies of [1, 2]) {
  const files = lyon(copies);
  let t0 = performance.now();
  const mesh = importCityModel(files);
  const tImport = ms(t0);
  t0 = performance.now();
  const idx = getMeshIndex(mesh);
  const tIndex = ms(t0);
  t0 = performance.now();
  getBvh(mesh, idx);
  const tBvh = ms(t0);
  for (const [name, p] of variants) {
    const a = name.includes('rotated') ? { ...area, rotationDeg: 20 } : area;
    t0 = performance.now();
    const r = generateHeightMap(mesh, a, p);
    const tHm = ms(t0);
    t0 = performance.now();
    const pk = packHeightMap(r.heightMap);
    const tPack = ms(t0);
    console.log(
      `| Lyon 3${copies > 1 ? ` ×${copies}` : ''} | ${mesh.stats.triangles.toLocaleString('en')} | ${fmt(tImport)} ms | ${fmt(tIndex)} ms | ${fmt(tBvh)} ms | ${name} | ${fmt(tHm)} ms | ${fmt(tPack)} ms (${pk.total}) | ${fmt(tBvh + tHm + tPack)} ms first, ${fmt(tHm + tPack)} ms next |`,
    );
  }
}

if (process.argv.includes('--baseline')) {
  // legonizer@1.1.0 itself (three r147 Mesh.raycast over every triangle, L6) on the same 4×4 area
  const { buildReferenceLayer, referenceHeightMap } = await import('../test/parity/legacyReference.ts');
  const layer = buildReferenceLayer(lyon(1));
  const t0 = performance.now();
  const ref = referenceHeightMap(layer, {
    cx: area.cx,
    cy: area.cy,
    rotationZ: 0,
    platesX: 4,
    platesY: 4,
    scale: 3,
    legoHeight: 10,
  });
  console.log(
    `\nBaseline legonizer@1.1.0, Part-Dieu 4×4 @3 m: ${fmt(ms(t0))} ms (${ref.selected.toLocaleString('en')} triangles selected, 16,384 rays)`,
  );
}
