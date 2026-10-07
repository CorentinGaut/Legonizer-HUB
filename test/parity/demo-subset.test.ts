/** The Part-Dieu demo subset keeps the original float32 data: legacy matrices equal the full tileset's. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { generateHeightMap } from '../../src/core/heightmap/index.ts';
import { importCityModel } from '../../src/core/import/index.ts';
import type { DemoManifest } from '../../src/core/samples/manifest.ts';
import { hasLyonFixtures, loadLyon, ROOT } from '../helpers/fixtures.ts';

const demoDir = join(ROOT, 'fixtures', 'demo', 'part-dieu');
const ready = hasLyonFixtures([5, 7]) && existsSync(join(demoDir, 'manifest.json'));

describe.skipIf(!ready)('Part-Dieu demo subset', () => {
  it('produces the same legacy and suggested matrices as the full Lyon 3 tileset on its default area', () => {
    const manifest = JSON.parse(readFileSync(join(demoDir, 'manifest.json'), 'utf8')) as DemoManifest;
    const demo = importCityModel(
      new Map(Object.entries(unzipSync(new Uint8Array(readFileSync(join(demoDir, manifest.archive)))))),
    );
    const full = importCityModel(loadLyon());
    for (const params of [manifest.suggested.strictLegacy, manifest.suggested.params]) {
      const a = generateHeightMap(demo, manifest.defaultArea.area, params);
      const b = generateHeightMap(full, manifest.defaultArea.area, params);
      expect(Array.from(a.heightMap.data)).toEqual(Array.from(b.heightMap.data));
    }
    expect(manifest.suggested.params.keepSmall).toBe(true);
    expect(manifest.source.licenceVerified).toBe(false);
  });
});
