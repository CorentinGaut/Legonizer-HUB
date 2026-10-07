#!/usr/bin/env node
// Downloads real Lyon 3 (2018) 3D Tiles into the git-ignored `fixtures/lyon3-2018/` folder.
//
// The LIRIS server sends no CORS header, so the site can never fetch these tiles at runtime:
// they are fetched here, with curl, for tests and for building the demo dataset.
// Licence: Métropole de Lyon open data; redistribution in `public/` is pending confirmation
// (SPEC §13.2), so nothing in this folder is ever copied into `public/` by this script.
//
// Usage: node scripts/fetch-lyon-fixtures.mjs [--all] [tile numbers...]
//   default tiles: 0 (documented in docs/reference/README.md) and 7 (Part-Dieu).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://dataset-dl.liris.cnrs.fr/three-d-tiles-lyon-metropolis/2018/Lyon-3_2018/';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'fixtures', 'lyon3-2018');

const args = process.argv.slice(2);
const all = args.includes('--all');
const requested = args.filter((a) => /^\d+$/.test(a)).map(Number);
const tiles = all ? [...Array(16).keys()] : requested.length ? requested : [0, 7];

function fetchTo(url, file) {
  if (existsSync(file) && statSync(file).size > 0) {
    console.log(`= ${file} (cached)`);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  console.log(`> ${url}`);
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', file, url], { stdio: 'inherit' });
}

fetchTo(BASE + 'tileset.json', join(out, 'tileset.json'));
for (const t of tiles) fetchTo(`${BASE}tiles/${t}.b3dm`, join(out, 'tiles', `${t}.b3dm`));
console.log(`Done: ${tiles.length} tile(s) in ${out}`);
