import { describe, expect, it } from 'vitest';
import { importCityModel } from '../../src/core/import/index.ts';
import { fetchTilesetFiles } from '../../src/core/import/remote.ts';
import { syntheticBoxesCity } from '../../src/core/samples/synthetic.ts';

describe('tileset URL import (I1)', () => {
  const files = syntheticBoxesCity(1);
  const server = (path: string) => files.get(path);
  const fakeFetch = (async (url: string) => {
    const p = new URL(url).pathname.replace('/data/city/', '');
    const body = server(p);
    return body ? new Response(body.slice()) : new Response('nope', { status: 404 });
  }) as typeof fetch;

  it('downloads tileset and contents into a FileMap that imports like the zip', async () => {
    const progress: number[] = [];
    const got = await fetchTilesetFiles('https://example.org/data/city/tileset.json', {
      fetch: fakeFetch,
      progress: (_s, f) => progress.push(f),
    });
    expect([...got.keys()].sort()).toEqual([...files.keys()].sort());
    expect(importCityModel(got).stats).toEqual(importCityModel(files).stats);
    expect(progress.at(-1)).toBe(1);
  });

  it('reports HTTP and CORS failures clearly', async () => {
    await expect(
      fetchTilesetFiles('https://example.org/data/other/tileset.json', { fetch: fakeFetch }),
    ).rejects.toThrow(/HTTP 404/);
    const corsFail = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(
      fetchTilesetFiles('https://example.org/x/tileset.json', { fetch: corsFail }),
    ).rejects.toThrow(/no CORS permission/);
  });
});
