#!/usr/bin/env node
/**
 * Home animation fixture (SPEC H4, docs/ux/storyboard.md §1.1): the heightmap of a synthetic
 * district (src/core/samples/district.ts, no real-world data) produced by our own pipeline
 * (3D Tiles import → heightmap → packing), saved to src/data/home/home-district.json.
 *
 * Choice: True scale (not legacy). Storyboard constraints: 3 × 5 baseplates with north facing the
 * mast (5 plates west→east, 3 north→south), no building erased (keep small buildings), tallest
 * tower ≤ 24 bricks. At 6 m/stud one brick is 7.2 m: the 170 m tower → 23 bricks (trunc), the
 * blocks (15–31 m) → 2–4 bricks, platform canopies → 1. Height reference `ground` (each building
 * from its own base), centre sampling, grid aligned with the axes (rotation 0). Legacy normalized
 * mode would give 1 brick = 17 m here and erase most of the district (L1).
 *
 * The fixture stores the heights (not the bricks): the Vite plugin (scripts/vite/home-model.ts)
 * packs them at build time with packHeightMap, which is deterministic, and the summary below lets
 * it assert it got the same parts. test/home/model.test.ts regenerates the heights and checks
 * they equal the fixture.
 *
 * Usage: node scripts/build-home-heightmap.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHomeHeightmap, HOME_FIXTURE_PATH } from './home-district.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = buildHomeHeightmap(new Date().toISOString().slice(0, 10));
const out = join(root, HOME_FIXTURE_PATH);
writeFileSync(out, JSON.stringify(fixture) + '\n');
const s = fixture.summary;
console.log(
  `${out}: ${fixture.heightMap.cols}×${fixture.heightMap.rows} studs, ${fixture.source.features} buildings, tallest ${s.maxBricks} bricks (${s.tallestCm} cm), ${s.studsWithBricks} studs built, ${s.totalBricks} bricks (lower bound ${s.lowerBound}), ${(JSON.stringify(fixture).length / 1024).toFixed(0)} kB`,
);
