/**
 * 3D Tiles importer (1.0 b3dm, 1.1 glTF content best effort, cmpt, external tilesets).
 * Spec: https://github.com/CesiumGS/3d-tiles/tree/main/specification
 *
 * World matrices follow the chain iTowns 2.41 builds for UD-Viz (`3dTilesProvider.configureTile`,
 * `B3dmParser.parse`, three's GLTFLoader), so that the legacy pipeline sees the same float values:
 *   tile:  matrixWorld = parent.matrixWorld × recompose(tile.transform)      (Object3D.applyMatrix4)
 *   scene: recompose(makeRotationX(π/2)) with position = RTC_CENTER          (glTF Y-up → Z-up)
 *   node:  recompose(node.matrix) or compose(T, R, S)                        (GLTFLoader)
 *
 * Real Lyon tiles (py3dtilers): each child tile carries a translation `transform` in EPSG:3946;
 * the glTF node holds a Z-up→Y-up matrix that the Y-up→Z-up scene rotation cancels; positions
 * are float32 relative to the child tile's transform.
 */
import { SurfaceClass, type CityMesh, type IdSource } from '../types.ts';
import { EngineError, throwIfAborted } from '../util/errors.ts';
import { dataView, parseJsonBytes } from '../util/bytes.ts';
import { noProgress, type ProgressFn } from '../util/progress.ts';
import { fromArray, identity, makeRotationX, multiply, recompose, type Mat4 } from '../util/threeCompat.ts';
import { isB3dm, parseB3dm } from './b3dm.ts';
import { CityMeshBuilder, finalizeMesh, transformMesh, triangleFeatures } from './cityMesh.ts';
import { ecefToGeodetic, enuFromEcefMatrix, geodeticToEcef, looksLikeEcef } from './ecef.ts';
import { lookup, resolveUri, type FileMap } from './fileMap.ts';
import { isGlb, parseGltfFile, type GltfPrimitiveGeometry } from './gltf.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TilesetImportOptions {
  /** Continue when some referenced contents are missing (default: error listing them). */
  ignoreMissing?: boolean;
  signal?: AbortSignal;
  progress?: ProgressFn;
}

/** Scene matrix iTowns applies to every glTF of a tileset, from `asset.gltfUpAxis` (default Y). */
export function upAxisSceneMatrix(
  gltfUpAxis: string | undefined,
  rtc: [number, number, number] | null,
): Mat4 {
  const pos = rtc ?? [0, 0, 0];
  let rot: Mat4;
  if (gltfUpAxis === undefined || gltfUpAxis === 'Y' || gltfUpAxis === 'y') rot = makeRotationX(Math.PI / 2);
  else if (gltfUpAxis === 'X' || gltfUpAxis === 'x') {
    // makeRotationZ(-π/2)
    const c = Math.cos(-Math.PI / 2),
      s = Math.sin(-Math.PI / 2);
    rot = fromArray([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  } else rot = identity();
  // Object3D.applyMatrix4(rot) on the scene, then `scene.position.copy(FT_RTC)`
  return recompose(rot, pos);
}

interface ContentJob {
  path: string;
  world: Mat4;
}

const TERRAIN_TYPE = /tinrelief|relief|terrain|dem\b/i;

export function importTileset(
  files: FileMap,
  tilesetPath: string,
  opts: TilesetImportOptions = {},
): CityMesh {
  const progress = opts.progress ?? noProgress;
  const builder = new CityMeshBuilder();
  const jobs: ContentJob[] = [];
  const missing: string[] = [];
  let gltfUpAxis: string | undefined;
  const usedFiles = new Set<string>([tilesetPath]);
  let tilesetVersion: string | undefined;
  let translatedTiles = 0;

  const loadTileset = (path: string, parentWorld: Mat4, depth: number, inheritedRefine: string) => {
    if (depth > 32) throw new EngineError('invalid-file', 'External tilesets nested too deeply (cycle?)');
    const bytes = lookup(files, path);
    if (!bytes) {
      missing.push(path);
      return;
    }
    let json: any;
    try {
      json = parseJsonBytes(bytes);
    } catch {
      throw new EngineError('invalid-file', `${path}: not valid JSON`);
    }
    if (!json?.root) throw new EngineError('invalid-file', `${path}: not a 3D Tiles tileset (no "root")`);
    if (depth === 0) {
      gltfUpAxis = json.asset?.gltfUpAxis;
      if (json.asset?.version !== undefined) tilesetVersion = String(json.asset.version);
    }
    if (json.root.implicitTiling) {
      throw new EngineError(
        'unsupported-feature',
        `${path}: implicit tiling (3D Tiles 1.1) is not supported yet`,
      );
    }
    visitTile(json.root, path, parentWorld, depth, inheritedRefine);
  };

  const hasContentBelow = (tile: any): boolean =>
    (tile.children ?? []).some((c: any) => c.content || c.contents || hasContentBelow(c));

  const visitTile = (
    tile: any,
    tilesetFile: string,
    parentWorld: Mat4,
    depth: number,
    inheritedRefine: string,
  ) => {
    if (Array.isArray(tile.transform) && tile.transform.slice(12, 15).some((v: number) => v !== 0))
      translatedTiles++;
    const local = Array.isArray(tile.transform) ? recompose(fromArray(tile.transform)) : identity();
    const world = multiply(parentWorld, local);
    const refine = String(tile.refine ?? inheritedRefine).toUpperCase();
    const contents: any[] = tile.contents ?? (tile.content ? [tile.content] : []);
    // I9: finest LOD — keep a tile's content when nothing below replaces it (leaf) or when its
    // children are additive (ADD).
    const useContent = !hasContentBelow(tile) || refine === 'ADD';
    for (const c of contents) {
      const uri: string | undefined = c.uri ?? c.url;
      if (!uri) continue;
      const path = resolveUri(tilesetFile, uri);
      if (/\.json$/i.test(path)) {
        // external tileset: its root is a child of this tile
        usedFiles.add(path);
        loadTileset(path, world, depth + 1, refine);
      } else if (useContent) {
        jobs.push({ path, world });
      }
    }
    for (const child of tile.children ?? []) visitTile(child, tilesetFile, world, depth, refine);
  };

  loadTileset(tilesetPath, identity(), 0, 'REPLACE');

  for (const j of jobs) if (!lookup(files, j.path)) missing.push(j.path);
  if (missing.length && !opts.ignoreMissing) {
    throw new EngineError(
      'missing-files',
      `${missing.length} file(s) referenced by the tileset are missing: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`,
      { missing },
    );
  }
  if (missing.length) builder.warnings.push(`${missing.length} referenced file(s) missing and skipped.`);

  jobs.forEach((job, k) => {
    throwIfAborted(opts.signal);
    const bytes = lookup(files, job.path);
    if (!bytes) return;
    usedFiles.add(job.path);
    loadContent(builder, files, job.path, bytes, job.world, gltfUpAxis);
    progress('import', (k + 1) / jobs.length, job.path);
  });

  const mesh = builder.build('3dtiles', [...usedFiles], { kind: 'projected' });
  mesh.meta = {
    tiles: jobs.length - missing.length,
    ...(missing.length ? { missing } : {}),
    ...(tilesetVersion ? { tilesetVersion } : {}),
    // several tiles with their own translation: py3dtilers-style per-tile offsets (I7)
    tileTransforms: translatedTiles > 1,
  };
  applyLegacyIgnore(mesh);
  return toLocalFrameIfEcef(mesh);
}

/** Standalone .b3dm / .glb content without a tileset. */
export function importSingleContent(files: FileMap, path: string): CityMesh {
  const builder = new CityMeshBuilder();
  const bytes = lookup(files, path);
  if (!bytes) throw new EngineError('missing-files', `Missing ${path}`, { missing: [path] });
  loadContent(builder, files, path, bytes, identity(), undefined);
  const mesh = builder.build('b3dm', [path], { kind: 'projected' });
  applyLegacyIgnore(mesh);
  return toLocalFrameIfEcef(mesh);
}

function loadContent(
  builder: CityMeshBuilder,
  files: FileMap,
  path: string,
  bytes: Uint8Array,
  world: Mat4,
  gltfUpAxis: string | undefined,
): void {
  const resolve = (uri: string) => lookup(files, resolveUri(path, uri));
  if (isB3dm(bytes)) {
    const b = parseB3dm(bytes, path);
    const gltfRoot = multiply(world, upAxisSceneMatrix(gltfUpAxis, b.rtcCenter));
    const g = parseGltfFile(b.glb, resolve, path, gltfRoot);
    builder.warnings.push(...g.warnings);
    // CESIUM_RTC in the glTF JSON overrides the scene position (iTowns B3dmParser)
    const cesiumRtc = g.json.extensions?.CESIUM_RTC?.center;
    const prims = cesiumRtc
      ? parseGltfFile(b.glb, resolve, path, multiply(world, upAxisSceneMatrix(gltfUpAxis, cesiumRtc)))
          .primitives
      : g.primitives;
    addPrimitives(builder, path, prims, b.batchTable, b.batchLength);
  } else if (isGlb(bytes) || /\.gltf$/i.test(path)) {
    const g = parseGltfFile(bytes, resolve, path, multiply(world, upAxisSceneMatrix(gltfUpAxis, null)));
    builder.warnings.push(...g.warnings);
    addPrimitives(builder, path, g.primitives, {}, 0);
  } else if (
    bytes.length >= 4 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === 'cmpt'
  ) {
    const dv = dataView(bytes);
    const tilesLength = dv.getUint32(12, true);
    let o = 16;
    for (let t = 0; t < tilesLength && o + 12 <= bytes.length; t++) {
      const len = dv.getUint32(o + 8, true);
      loadContent(builder, files, `${path}[${t}]`, bytes.subarray(o, o + len), world, gltfUpAxis);
      o += len;
    }
  } else {
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    builder.warnings.push(`${path}: ${magic} content is not supported (only b3dm / glTF / cmpt); skipped.`);
  }
}

function addPrimitives(
  builder: CityMeshBuilder,
  contentPath: string,
  prims: GltfPrimitiveGeometry[],
  batchTable: Record<string, unknown[]>,
  batchLength: number,
): void {
  const gml = batchTable['gml_id'];
  const types = batchTable['citygml::surface_type'] ?? batchTable['type'] ?? batchTable['class'];
  prims.forEach((p, pi) => {
    const vertexCount = p.positions.length / 3;
    const toFeature = (id: number): number => {
      if (!p.featureIds) {
        return builder.feature(`${contentPath}#${p.meshName}#${pi}`, {
          idSource: 'mesh',
          legacyIgnored: false,
          terrain: false,
        });
      }
      const g = gml?.[id];
      const type = types?.[id] !== undefined ? String(types[id]) : undefined;
      const terrain = type !== undefined && TERRAIN_TYPE.test(type);
      // UD-Viz: `if (... || !gmlId) continue;` — falsy gml_id values are skipped
      const hasGml = g !== undefined && g !== null && g !== '' && g !== 0 && g !== false;
      const idSource: IdSource = hasGml ? 'gml_id' : 'batch';
      const key = hasGml ? String(g) : `${contentPath}#${id}`;
      const init = { idSource, legacyIgnored: false, terrain, ...(type !== undefined ? { type } : {}) };
      return builder.feature(key, init);
    };
    void batchLength;
    const triFeature = triangleFeatures(p.index, vertexCount, p.featureIds, toFeature);
    const triClass = new Uint8Array(triFeature.length);
    for (let t = 0; t < triFeature.length; t++) {
      if (builder.features[triFeature[t]!]?.terrain) triClass[t] = SurfaceClass.Terrain;
    }
    builder.addPart({
      name: `${contentPath}:${p.name}`,
      positions: p.positions,
      index: p.index,
      matrix: p.matrix,
      triFeature,
      triClass,
      declaredBounds: p.declaredBounds,
    });
  });
}

/**
 * L7 / I8: UD-Viz only uses features with a gml_id. When the dataset has gml_ids, features without
 * one are flagged so legacy mode ignores them as UD-Viz does; datasets without any gml_id keep
 * all their features (otherwise the legacy result would be empty).
 */
export function applyLegacyIgnore(mesh: CityMesh): void {
  const anyGml = mesh.features.some((f) => f.idSource === 'gml_id');
  for (const f of mesh.features) f.legacyIgnored = anyGml && f.idSource !== 'gml_id';
}

/** I7: ECEF tilesets are moved to a local ENU frame centred on the data (origin on the ellipsoid). */
export function toLocalFrameIfEcef(mesh: CityMesh): CityMesh {
  if (!looksLikeEcef(mesh.bounds)) {
    finalizeMesh(mesh);
    return mesh;
  }
  const c: [number, number, number] = [
    (mesh.bounds.min[0] + mesh.bounds.max[0]) / 2,
    (mesh.bounds.min[1] + mesh.bounds.max[1]) / 2,
    (mesh.bounds.min[2] + mesh.bounds.max[2]) / 2,
  ];
  const g = ecefToGeodetic(c[0], c[1], c[2]);
  const origin = geodeticToEcef(g.lon, g.lat, 0);
  transformMesh(mesh, enuFromEcefMatrix(origin));
  mesh.frame = { kind: 'enu', enuOrigin: { lon: g.lon, lat: g.lat, height: 0, ecef: origin } };
  mesh.warnings.push(
    `Earth-centred (ECEF) coordinates converted to a local East-North-Up frame at ${g.lat.toFixed(5)}°, ${g.lon.toFixed(5)}°.`,
  );
  return mesh;
}
