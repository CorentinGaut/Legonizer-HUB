/**
 * I1: load a 3D Tiles tileset from a URL (only works when the server sends CORS headers — the
 * LIRIS server does not, hence the bundled demo). Downloads tileset.json, external tilesets and
 * every content (b3dm / glb / gltf + their buffers are fetched by URI) into a FileMap whose paths
 * are relative to the root tileset, ready for importCityModel. Runs in the Worker (fetch).
 */
import { EngineError, throwIfAborted } from '../util/errors.ts';
import type { ProgressFn } from '../util/progress.ts';
import type { FileMap } from './fileMap.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RemoteOptions {
  signal?: AbortSignal;
  progress?: ProgressFn;
  /** Parallel downloads (default 6). */
  concurrency?: number;
  /** Abort above this many bytes (default 300 MB, SPEC I12). */
  maxBytes?: number;
  fetch?: typeof fetch;
}

export async function fetchTilesetFiles(url: string, opts: RemoteOptions = {}): Promise<FileMap> {
  const doFetch = opts.fetch ?? fetch;
  const base = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
  const files: FileMap = new Map();
  const rel = (u: URL) => {
    const b = base.href.slice(0, base.href.lastIndexOf('/') + 1);
    return u.href.startsWith(b)
      ? decodeURIComponent(u.href.slice(b.length).split(/[?#]/)[0]!)
      : `remote/${u.host}${u.pathname}`;
  };
  let bytes = 0;
  const get = async (u: URL): Promise<Uint8Array> => {
    throwIfAborted(opts.signal);
    let res: Response;
    try {
      res = await doFetch(u.href, opts.signal ? { signal: opts.signal } : {});
    } catch (e) {
      throw new EngineError(
        'missing-files',
        `Cannot download ${u.href} (network error or no CORS permission): ${(e as Error).message}`,
        { url: u.href },
      );
    }
    if (!res.ok)
      throw new EngineError('missing-files', `Cannot download ${u.href}: HTTP ${res.status}`, {
        url: u.href,
        status: res.status,
      });
    const data = new Uint8Array(await res.arrayBuffer());
    bytes += data.length;
    if (bytes > (opts.maxBytes ?? 300e6))
      throw new EngineError(
        'too-large',
        `Tileset larger than ${Math.round((opts.maxBytes ?? 300e6) / 1e6)} MB`,
      );
    return data;
  };
  const contents: URL[] = [];
  const visitTileset = async (u: URL, depth: number) => {
    if (depth > 16) throw new EngineError('invalid-file', 'External tilesets nested too deeply');
    const data = await get(u);
    files.set(rel(u), data);
    const json = JSON.parse(new TextDecoder().decode(data));
    const walk = async (tile: any) => {
      for (const c of tile.contents ?? (tile.content ? [tile.content] : [])) {
        const cu = new URL(c.uri ?? c.url, u);
        if (/\.json$/i.test(cu.pathname)) await visitTileset(cu, depth + 1);
        else contents.push(cu);
      }
      for (const ch of tile.children ?? []) await walk(ch);
    };
    await walk(json.root ?? {});
  };
  await visitTileset(base, 0);
  let done = 0;
  const queue = [...contents];
  const worker = async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      const data = await get(u);
      files.set(rel(u), data);
      // .gltf contents may reference external buffers
      if (/\.gltf$/i.test(u.pathname)) {
        const g = JSON.parse(new TextDecoder().decode(data));
        for (const b of g.buffers ?? [])
          if (b.uri && !String(b.uri).startsWith('data:'))
            files.set(rel(new URL(b.uri, u)), await get(new URL(b.uri, u)));
      }
      opts.progress?.('download', ++done / contents.length, u.pathname);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 6) }, worker));
  return files;
}
