/**
 * Vite plugin: `virtual:lz-home-model`, the brick model of the home animation (SPEC H4,
 * storyboard §1.1). At build (and dev) time it reads the heightmap fixture produced by our own
 * pipeline (src/data/home/part-dieu-home.json, `npm run fixtures:home`), packs it with the real
 * packer (src/core/packing) and exposes compact byte arrays, so the browser never runs the
 * packer (≈ 200 ms in Node, several times that on a phone) and the brick list is exactly the
 * build guide's output. The build fails if the packing no longer matches the fixture summary
 * (packing algorithm changed without regenerating the fixture).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { packHeightMap } from '../../src/core/packing/pack.ts';

const VIRTUAL_ID = 'virtual:lz-home-model';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

interface HomeFixture {
  kind: string;
  source: { attribution: string; licence: string; dataset: string };
  layout: { platesX: number; platesY: number };
  params: { scale: number; heightMode: string };
  heightMap: { cols: number; rows: number; data: number[] };
  summary: { totalBricks: number; counts: Record<string, number>; maxBricks: number; metresPerBrick: number };
  generated: { packingAlgorithm: number };
}

export interface HomeModelBuild {
  cols: number;
  rows: number;
  platesX: number;
  platesY: number;
  maxLayer: number;
  /** heights[j * cols + i], j south→north, one byte per stud. */
  heights: Uint8Array;
  /** 8 bytes per brick: plateCol, plateRowFromNorth (0 = row 1), layer, x, y (plate-local, south-based), w, d, partIndex. */
  bricks: Uint8Array;
  parts: string[];
}

/** Pack the fixture the same way the build guide does (default inventory: every part, max length 8). */
export function buildHomeModel(fixturePath: string): { model: HomeModelBuild; fixture: HomeFixture } {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as HomeFixture;
  if (fixture.kind !== 'legonizer-home-heightmap')
    throw new Error(`${fixturePath}: not a home heightmap fixture`);
  const { cols, rows, data } = fixture.heightMap;
  const hm = { cols, rows, data: Int32Array.from(data) };
  const packing = packHeightMap(hm);
  if (packing.total !== fixture.summary.totalBricks) {
    throw new Error(
      `home model: packing gives ${packing.total} bricks, fixture says ${fixture.summary.totalBricks}; run npm run fixtures:home`,
    );
  }
  for (const [part, n] of Object.entries(fixture.summary.counts)) {
    if (packing.counts[part] !== n)
      throw new Error(`home model: part ${part} count differs from the fixture summary`);
  }
  const platesX = cols / 32;
  const platesY = rows / 32;
  const parts = [...new Set(packing.bricks.map((b) => b.partId))].sort();
  const bricks = new Uint8Array(packing.bricks.length * 8);
  let maxLayer = 0;
  packing.bricks.forEach((b, n) => {
    const plateCol = b.plate.charCodeAt(0) - 65;
    const plateRow = Number(b.plate.slice(1)) - 1;
    bricks.set([plateCol, plateRow, b.layer, b.x, b.y, b.w, b.d, parts.indexOf(b.partId)], n * 8);
    maxLayer = Math.max(maxLayer, b.layer);
  });
  return {
    model: { cols, rows, platesX, platesY, maxLayer, heights: Uint8Array.from(data), bricks, parts },
    fixture,
  };
}

export function homeModelPlugin(root: string): Plugin {
  const fixturePath = resolve(root, 'src/data/home/part-dieu-home.json');
  return {
    name: 'lz-home-model',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      this.addWatchFile(fixturePath);
      const { model, fixture } = buildHomeModel(fixturePath);
      const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
      return [
        `export const cols = ${model.cols};`,
        `export const rows = ${model.rows};`,
        `export const platesX = ${model.platesX};`,
        `export const platesY = ${model.platesY};`,
        `export const maxLayer = ${model.maxLayer};`,
        `export const parts = ${JSON.stringify(model.parts)};`,
        `export const heightsB64 = ${JSON.stringify(b64(model.heights))};`,
        `export const bricksB64 = ${JSON.stringify(b64(model.bricks))};`,
        `export const meta = ${JSON.stringify({
          dataset: fixture.source.dataset,
          attribution: fixture.source.attribution,
          licence: fixture.source.licence,
          scale: fixture.params.scale,
          heightMode: fixture.params.heightMode,
          metresPerBrick: fixture.summary.metresPerBrick,
          totalBricks: fixture.summary.totalBricks,
          packingAlgorithm: fixture.generated.packingAlgorithm,
        })};`,
      ].join('\n');
    },
  };
}
