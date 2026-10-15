/**
 * Import entry point: detects the format of the uploaded files and returns a normalized CityMesh
 * (Z up, metres, feature ids, world bounds) — SPEC §7.1.
 */
import type { CityMesh } from '../types.ts';
import { EngineError } from '../util/errors.ts';
import { decodeUtf8 } from '../util/bytes.ts';
import type { ProgressFn } from '../util/progress.ts';
import { isB3dm } from './b3dm.ts';
import { importCityJson } from './cityjson.ts';
import { CityMeshBuilder, triangleFeatures } from './cityMesh.ts';
import {
  basename,
  extension,
  lookup,
  resolveUri,
  toFileMap,
  type FileMap,
  type InputFile,
} from './fileMap.ts';
import { isGlb, parseGltfFile } from './gltf.ts';
import { importObj } from './obj.ts';
import { importSingleContent, importTileset, toLocalFrameIfEcef } from './tileset.ts';
import { applyGenericFrame, type GenericMeshOptions } from './units.ts';

export type { FileMap, InputFile } from './fileMap.ts';
export { toFileMap } from './fileMap.ts';

export interface ImportOptions extends GenericMeshOptions {
  /** CityJSON: highest LoD to use (default 2.2). */
  maxLod?: number;
  /** 3D Tiles: continue when some referenced contents are missing. */
  ignoreMissing?: boolean;
  /** Path of the entry file when several candidates exist. */
  entry?: string;
  signal?: AbortSignal;
  progress?: ProgressFn;
}

export type DetectedFormat =
  | { kind: '3dtiles'; entry: string }
  | { kind: 'b3dm'; entry: string }
  | { kind: 'gltf'; entry: string }
  | { kind: 'obj'; entry: string }
  | { kind: 'cityjson'; entry: string };

function looksLikeJsonWith(bytes: Uint8Array, test: (head: string) => boolean): boolean {
  const head = decodeUtf8(bytes.subarray(0, Math.min(bytes.length, 4096)));
  return test(head);
}

/** Picks the entry file and format (I1–I5). */
export function detectFormat(files: FileMap, entry?: string): DetectedFormat {
  const paths = [...files.keys()].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  );
  const candidates = entry ? [entry] : paths;
  // 1. a tileset.json (shallowest first)
  for (const p of candidates) {
    const ext = extension(p);
    if (ext !== 'json') continue;
    const bytes = files.get(p)!;
    if (
      basename(p).toLowerCase() === 'tileset.json' ||
      looksLikeJsonWith(bytes, (h) => /"asset"\s*:/.test(h) && /"root"\s*:/.test(h))
    )
      return { kind: '3dtiles', entry: p };
  }
  for (const p of candidates) {
    const ext = extension(p);
    const bytes = files.get(p);
    if (!bytes) continue;
    if (ext === 'city.json' || ext === 'city.jsonl' || ext === 'jsonl' || ext === 'json') {
      if (looksLikeJsonWith(bytes, (h) => /"type"\s*:\s*"CityJSON/.test(h)))
        return { kind: 'cityjson', entry: p };
    }
  }
  for (const p of candidates) {
    const ext = extension(p);
    const bytes = files.get(p)!;
    if (ext === 'glb' || ext === 'gltf' || (bytes && isGlb(bytes))) return { kind: 'gltf', entry: p };
    if (ext === 'b3dm' || (bytes && isB3dm(bytes))) return { kind: 'b3dm', entry: p };
    if (ext === 'obj') return { kind: 'obj', entry: p };
  }
  const exts = [...new Set(paths.map(extension))].join(', ') || 'none';
  throw new EngineError(
    'unsupported-format',
    `No supported 3D city model found (files: ${exts}). Supported: 3D Tiles (tileset.json + .b3dm, as a zip or a folder), glTF/GLB, OBJ, CityJSON.`,
  );
}

export function importGltf(files: FileMap, path: string, opts: GenericMeshOptions): CityMesh {
  const bytes = lookup(files, path)!;
  const g = parseGltfFile(bytes, (uri) => lookup(files, resolveUri(path, uri)), path);
  const builder = new CityMeshBuilder();
  builder.warnings.push(...g.warnings);
  g.primitives.forEach((p, pi) => {
    const vertexCount = p.positions.length / 3;
    const triFeature = triangleFeatures(p.index, vertexCount, p.featureIds, (id) =>
      p.featureIds
        ? builder.feature(`${path}#${p.meshName}#${id}`, {
            idSource: 'batch',
            legacyIgnored: false,
            terrain: false,
          })
        : builder.feature(`${path}#${p.meshName}#${pi}`, {
            idSource: 'mesh',
            legacyIgnored: false,
            terrain: false,
            type: p.meshName,
          }),
    );
    builder.addPart({
      name: p.name,
      positions: p.positions,
      index: p.index,
      matrix: p.matrix,
      triFeature,
      declaredBounds: p.declaredBounds,
    });
  });
  const mesh = builder.build(isGlb(bytes) ? 'glb' : 'gltf', [path], { kind: 'local' });
  // glTF is Y-up by specification (glTF 2.0 §3.4): convert unless the user overrides
  applyGenericFrame(mesh, opts, 'y');
  return toLocalFrameIfEcef(mesh);
}

/** Imports uploaded files (zip archives are extracted) into a CityMesh. */
export function importCityModel(input: InputFile[] | FileMap, opts: ImportOptions = {}): CityMesh {
  const files = toFileMap(input);
  if (files.size === 0) throw new EngineError('empty-geometry', 'No file provided.');
  const fmt = detectFormat(files, opts.entry);
  opts.progress?.('import', 0, fmt.entry);
  let mesh: CityMesh;
  switch (fmt.kind) {
    case '3dtiles':
      mesh = importTileset(files, fmt.entry, opts);
      break;
    case 'b3dm':
      mesh = importSingleContent(files, fmt.entry);
      break;
    case 'gltf':
      mesh = importGltf(files, fmt.entry, opts);
      break;
    case 'obj':
      mesh = importObj(files.get(fmt.entry)!, fmt.entry, opts);
      break;
    case 'cityjson':
      mesh = importCityJson(files.get(fmt.entry)!, fmt.entry, opts);
      break;
  }
  if (mesh.stats.triangles === 0) throw new EngineError('empty-geometry', 'The model contains no triangles.');
  opts.progress?.('import', 1, fmt.entry);
  return mesh;
}
