#!/usr/bin/env node
/**
 * PDF build guide measurement for docs/perf.md (SPEC O5, N5): renders the guide of the site's demo
 * (the synthetic sample, whole sample on 3 × 3 plates at 4 m/stud, Legacy + keep small buildings)
 * in Node, the way the engine Worker does, and reports the generation time and the file size.
 *
 * Usage: node scripts/perf-pdf.ts [--runs 5] [--out file.pdf] [--locale fr] [--title "…"]
 * Reports wall time and process CPU time per run (the first run includes loading the fonts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateHeightMap } from '../src/core/heightmap/index.ts';
import { importCityModel } from '../src/core/import/index.ts';
import { packHeightMap } from '../src/core/packing/pack.ts';
import { normalizeInventory } from '../src/core/packing/catalog.ts';
import { renderPdfGuide } from '../src/core/export/pdfGuide.ts';
import { PDF_MESSAGE_KEYS, pdfPageCount, ALL_SECTIONS } from '../src/core/export/pdfPlan.ts';
import type { Params } from '../src/core/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name: string, def: string) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 && process.argv[k + 1] ? process.argv[k + 1]! : def;
};
const runs = Number(arg('runs', '5'));
const locale = arg('locale', 'en');

function messages(lang: string): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const ns of ['create', 'exports', 'errors', 'common', 'footer']) {
    const walk = (t: Record<string, unknown>, p: string) => {
      for (const [k, v] of Object.entries(t)) {
        if (typeof v === 'string') flat[`${p}.${k}`] = v;
        else walk(v as Record<string, unknown>, `${p}.${k}`);
      }
    };
    walk(JSON.parse(readFileSync(join(root, 'src/i18n', lang, `${ns}.json`), 'utf8')), ns);
  }
  const out: Record<string, string> = {};
  for (const k of PDF_MESSAGE_KEYS) if (flat[k] !== undefined) out[k] = flat[k]!;
  return out;
}

const demo = join(root, 'public/data/demo/sample');
const manifest = JSON.parse(readFileSync(join(demo, 'manifest.json'), 'utf8'));
const mesh = importCityModel([
  { path: 'sample.zip', data: new Uint8Array(readFileSync(join(demo, 'sample.zip'))) },
]);
const params = manifest.suggested.params as Params;
const area = manifest.defaultArea.area;
const heightMap = generateHeightMap(mesh, area, params).heightMap;
const packing = packHeightMap(heightMap);
const input = {
  title: arg('title', manifest.title as string),
  heightMap,
  packing,
  params,
  area,
  inventory: normalizeInventory({}),
  paper: 'A4' as const,
  messages: messages(locale),
  locale,
  date: '2026-10-07T12:00:00Z',
  presetName: 'Legacy (UD-Viz 4.6.1) with small buildings kept',
  differences: ['Keep small buildings (at least 1 brick)'],
  passBaseUrl: 'https://example.org/legonizer/create.html',
  crs: manifest.crs as string,
};

// wall time, and the process's CPU time (less sensitive to other loads on the machine)
const times: number[] = [];
const cpu: number[] = [];
let bytes: Uint8Array = new Uint8Array();
for (let r = 0; r < runs; r++) {
  const t0 = performance.now();
  const c0 = process.cpuUsage();
  bytes = await renderPdfGuide(input);
  const c = process.cpuUsage(c0);
  times.push(performance.now() - t0);
  cpu.push((c.user + c.system) / 1000);
}
const out = arg('out', '');
if (out) writeFileSync(out, bytes);
console.log(
  JSON.stringify(
    {
      cpu: cpus()[0]?.model,
      node: process.version,
      bricks: packing.total,
      pages: pdfPageCount(packing, ALL_SECTIONS),
      bytes: bytes.length,
      firstMs: Math.round(times[0]!),
      nextMs: times.slice(1).map((t) => Math.round(t)),
      firstCpuMs: Math.round(cpu[0]!),
      nextCpuMs: cpu.slice(1).map((t) => Math.round(t)),
    },
    null,
    1,
  ),
);
