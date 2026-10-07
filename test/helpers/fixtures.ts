import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FileMap } from '../../src/core/import/fileMap.ts';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const LYON_DIR = join(ROOT, 'fixtures', 'lyon3-2018');

export function hasLyonFixtures(tiles: number[] = [7]): boolean {
  return (
    existsSync(join(LYON_DIR, 'tileset.json')) &&
    tiles.every((t) => existsSync(join(LYON_DIR, 'tiles', `${t}.b3dm`)))
  );
}

function bytes(path: string): Uint8Array {
  const b = readFileSync(path);
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

/**
 * Lyon 3 (2018) tileset with the tiles present in fixtures/ (`npm run fixtures:lyon` fetches 0 and
 * 7, `-- --all` all 16); tileset.json is pruned to the tiles present.
 */
export function loadLyon(tiles?: number[]): FileMap {
  const files: FileMap = new Map();
  const available = readdirSync(join(LYON_DIR, 'tiles')).filter((f) => f.endsWith('.b3dm'));
  for (const f of available) {
    const n = Number(f.replace('.b3dm', ''));
    if (!tiles || tiles.includes(n)) files.set(`tiles/${f}`, bytes(join(LYON_DIR, 'tiles', f)));
  }
  const ts = JSON.parse(new TextDecoder().decode(bytes(join(LYON_DIR, 'tileset.json'))));
  ts.root.children = ts.root.children.filter((c: { content: { uri: string } }) => files.has(c.content.uri));
  files.set('tileset.json', new TextEncoder().encode(JSON.stringify(ts)));
  return files;
}
