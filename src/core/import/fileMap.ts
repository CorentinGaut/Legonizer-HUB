import { unzipSync } from 'fflate';
import { EngineError } from '../util/errors.ts';

/**
 * Input files keyed by a normalized relative path ("a/b/c.b3dm", forward slashes, no "./").
 * A folder upload (webkitdirectory / drag-and-drop) and an extracted zip both become a FileMap.
 */
export type FileMap = Map<string, Uint8Array>;

export interface InputFile {
  /** Relative path (webkitRelativePath) or plain file name. */
  path: string;
  data: Uint8Array;
}

export function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

export function extension(p: string): string {
  const b = basename(p).toLowerCase();
  if (b.endsWith('.city.json')) return 'city.json';
  if (b.endsWith('.city.jsonl')) return 'city.jsonl';
  const i = b.lastIndexOf('.');
  return i < 0 ? '' : b.slice(i + 1);
}

/** Resolves a URI found in a file (tileset content, glTF buffer) relative to that file. */
export function resolveUri(fromFile: string, uri: string): string {
  let u = uri;
  try {
    u = decodeURIComponent(uri);
  } catch {
    // keep the raw uri
  }
  u = u.split('?')[0]!.split('#')[0]!;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('data:')) {
    // absolute URL: only the path can be matched against uploaded files
    try {
      u = new URL(u).pathname;
    } catch {
      // ignore
    }
    return normalizePath(u);
  }
  if (u.startsWith('/')) return normalizePath(u);
  const base = dirname(fromFile);
  return normalizePath(base ? `${base}/${u}` : u);
}

/**
 * Looks a path up in the map; falls back to a case-insensitive match and to a match on the
 * path suffix (absolute URLs in tilesets, zips with an extra root folder).
 */
export function lookup(files: FileMap, path: string): Uint8Array | undefined {
  const direct = files.get(path);
  if (direct) return direct;
  const lower = path.toLowerCase();
  let best: Uint8Array | undefined;
  for (const [k, v] of files) {
    const kl = k.toLowerCase();
    if (kl === lower) return v;
    if (!best && (kl.endsWith('/' + lower) || lower.endsWith('/' + kl))) best = v;
  }
  return best;
}

export function isZip(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 0x03 || data[2] === 0x05);
}

/** Builds a FileMap from uploaded files, extracting zip archives in place. */
export function toFileMap(inputs: InputFile[] | FileMap): FileMap {
  const list: InputFile[] =
    inputs instanceof Map ? [...inputs].map(([path, data]) => ({ path, data })) : inputs;
  const out: FileMap = new Map();
  for (const f of list) {
    if (isZip(f.data) && extension(f.path) !== 'glb') {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(f.data, {
          filter: (file) => !file.name.endsWith('/') && !file.name.startsWith('__MACOSX/'),
        });
      } catch (e) {
        throw new EngineError('invalid-file', `Cannot read zip archive ${f.path}: ${(e as Error).message}`);
      }
      const prefix = dirname(normalizePath(f.path));
      for (const [name, data] of Object.entries(entries)) {
        const p = normalizePath(prefix ? `${prefix}/${name}` : name);
        if (p) out.set(p, data);
      }
    } else {
      out.set(normalizePath(f.path), f.data);
    }
  }
  return out;
}
