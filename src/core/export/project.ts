/**
 * Project file `.legonizer.json` (SPEC O9): input file names, sizes and SHA-256 hashes, import
 * options, area, parameters, part settings, app and algorithm versions, and the height matrix
 * (run-length + deflate + base64url). Re-importing it regenerates identical outputs: the packing
 * and every export derive deterministically from the stored heights and part settings (N7), and
 * the inputs can be re-checked against the hashes to regenerate the heights themselves.
 */
import type { Area, HeightMap, Params } from '../types.ts';
import { normalizeInventory, type InventoryOptions } from '../packing/catalog.ts';
import type { FileMap } from '../import/fileMap.ts';
import { decodeHeights, encodeHeights } from '../util/heightCodec.ts';
import { APP_VERSION, HEIGHTMAP_ALGORITHM_VERSION, PACKING_ALGORITHM_VERSION } from '../version.ts';

export const PROJECT_FORMAT = 'legonizer-project';
export const PROJECT_FORMAT_VERSION = 1;

export interface ProjectInput {
  path: string;
  size: number;
  sha256: string;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  formatVersion: number;
  app: { version: string; heightmapAlgorithm: number; packingAlgorithm: number };
  createdAt: string;
  title?: string;
  /** Demo dataset id when the project started from a bundled demo. */
  demo?: string;
  inputs: ProjectInput[];
  importOptions: Record<string, unknown>;
  area: Area;
  params: Params;
  inventory: { enabled: string[]; maxLength: number };
  heightMap: { cols: number; rows: number; encoding: 'rle-deflate-base64url'; data: string };
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of each input (Web Crypto, available in Workers and Node ≥ 19). */
export async function hashInputs(files: FileMap): Promise<ProjectInput[]> {
  const out: ProjectInput[] = [];
  for (const path of [...files.keys()].sort()) {
    const data = files.get(path)!;
    const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
    out.push({ path, size: data.length, sha256: hex(digest) });
  }
  return out;
}

export function createProject(args: {
  inputs: ProjectInput[];
  importOptions?: Record<string, unknown>;
  area: Area;
  params: Params;
  inventory?: InventoryOptions;
  heightMap: HeightMap;
  title?: string;
  demo?: string;
  createdAt?: string;
}): ProjectFile {
  const p: ProjectFile = {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    app: {
      version: APP_VERSION,
      heightmapAlgorithm: HEIGHTMAP_ALGORITHM_VERSION,
      packingAlgorithm: PACKING_ALGORITHM_VERSION,
    },
    createdAt: args.createdAt ?? new Date().toISOString(),
    inputs: args.inputs,
    importOptions: args.importOptions ?? {},
    area: { ...args.area },
    params: { ...args.params },
    inventory: normalizeInventory(args.inventory),
    heightMap: {
      cols: args.heightMap.cols,
      rows: args.heightMap.rows,
      encoding: 'rle-deflate-base64url',
      data: encodeHeights(args.heightMap.data),
    },
  };
  if (args.title) p.title = args.title;
  if (args.demo) p.demo = args.demo;
  return p;
}

export function serializeProject(p: ProjectFile): string {
  return JSON.stringify(p, null, 2) + '\n';
}

export function projectFileName(title = 'model'): string {
  const safe =
    title
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'model';
  return `${safe}.legonizer.json`;
}

export function parseProject(text: string): ProjectFile {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('Not a JSON file');
  }
  const p = j as ProjectFile;
  if (!p || p.format !== PROJECT_FORMAT) throw new Error('Not a Legonizer project file');
  if (p.formatVersion > PROJECT_FORMAT_VERSION)
    throw new Error(`Project format ${p.formatVersion} is newer than this app supports`);
  const hm = p.heightMap;
  if (
    !hm ||
    !Number.isInteger(hm.cols) ||
    !Number.isInteger(hm.rows) ||
    hm.cols % 32 ||
    hm.rows % 32 ||
    typeof hm.data !== 'string'
  ) {
    throw new Error('Project file has no valid height matrix');
  }
  if (!p.params || !p.area || !Array.isArray(p.inputs)) throw new Error('Project file is incomplete');
  return p;
}

export function projectHeightMap(p: ProjectFile): HeightMap {
  return {
    cols: p.heightMap.cols,
    rows: p.heightMap.rows,
    data: decodeHeights(p.heightMap.data, p.heightMap.cols * p.heightMap.rows),
  };
}

/** Compares uploaded files with the project's inputs (to regenerate the heights from the same data). */
export async function checkInputs(
  p: ProjectFile,
  files: FileMap,
): Promise<{ missing: string[]; changed: string[] }> {
  const actual = new Map((await hashInputs(files)).map((i) => [i.path, i.sha256]));
  const missing: string[] = [];
  const changed: string[] = [];
  for (const i of p.inputs) {
    const h = actual.get(i.path);
    if (h === undefined) missing.push(i.path);
    else if (h !== i.sha256) changed.push(i.path);
  }
  return { missing, changed };
}
