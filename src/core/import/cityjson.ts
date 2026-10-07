/**
 * CityJSON 1.0 / 1.1 / 1.2 importer (SPEC I5), including CityJSONSeq (.jsonl) and geometry templates.
 * Spec: https://www.cityjson.org/specs/2.0.1/ (1.x structure identical for what we read):
 * - `transform` {scale, translate}: real = v × scale + translate (optional in 1.0, mandatory since 1.1)
 * - geometry boundaries: MultiSurface/CompositeSurface [surface], Solid [shell], Multi/CompositeSolid [solid];
 *   a surface is [exterior ring, interior rings…], a ring is a list of vertex indices
 * - `semantics` {surfaces, values} mirrors boundaries down to surfaces
 * - LoD: highest available ≤ maxLod (default 2.2), per city object
 * Features: one per top-level city object (BuildingPart → its Building).
 */
import { SurfaceClass, type CityMesh } from '../types.ts';
import { EngineError, throwIfAborted } from '../util/errors.ts';
import { decodeUtf8 } from '../util/bytes.ts';
import { identity } from '../util/threeCompat.ts';
import { CityMeshBuilder } from './cityMesh.ts';
import { triangulatePolygon } from './triangulate.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CityJsonOptions {
  /** Highest LoD to use (default 2.2). */
  maxLod?: number;
  signal?: AbortSignal;
}

/** Object types treated as terrain / ground-level surfaces (excluded from building hits in `ground` mode). */
const TERRAIN_TYPES = new Set([
  'TINRelief',
  'LandUse',
  'WaterBody',
  'PlantCover',
  'Road',
  'Railway',
  'TransportSquare',
  'Waterway',
  'GenericCityObject_ground',
]);

const SEMANTIC_CLASS: Record<string, number> = {
  GroundSurface: SurfaceClass.Ground,
  RoofSurface: SurfaceClass.Roof,
  WallSurface: SurfaceClass.Wall,
  ClosureSurface: SurfaceClass.Wall,
  OuterCeilingSurface: SurfaceClass.Wall,
  OuterFloorSurface: SurfaceClass.Roof,
  TrafficArea: SurfaceClass.Terrain,
  AuxiliaryTrafficArea: SurfaceClass.Terrain,
  WaterGroundSurface: SurfaceClass.Terrain,
};

export function isCityJson(json: any): boolean {
  return json && typeof json === 'object' && (json.type === 'CityJSON' || json.type === 'CityJSONFeature');
}

function lodValue(g: any): number {
  const v = parseFloat(String(g.lod ?? '0'));
  return Number.isFinite(v) ? v : 0;
}

/** LoDs seen and used during one import (summary, I5). */
const lodStats = { available: new Set<number>(), used: new Set<number>() };

function pickGeometries(geoms: any[], maxLod: number): any[] {
  const surfaces = geoms.filter((g) => g && g.type !== 'MultiPoint' && g.type !== 'MultiLineString');
  if (!surfaces.length) return [];
  const lods = [...new Set(surfaces.map(lodValue))].sort((a, b) => a - b);
  const eligible = lods.filter((l) => l <= maxLod + 1e-9);
  const chosen = eligible.length ? eligible[eligible.length - 1]! : lods[0]!;
  for (const l of lods) lodStats.available.add(l);
  if (chosen !== undefined) lodStats.used.add(chosen);
  return surfaces.filter((g) => lodValue(g) === chosen);
}

export function importCityJson(bytes: Uint8Array, name: string, opts: CityJsonOptions = {}): CityMesh {
  const text = decodeUtf8(bytes);
  const docs: any[] = [];
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      docs.push(JSON.parse(text));
    } catch {
      // CityJSONSeq: one JSON object per line
      for (const line of text.split('\n')) if (line.trim()) docs.push(JSON.parse(line));
    }
  }
  if (!docs.length || !isCityJson(docs[0]))
    throw new EngineError('invalid-file', `${name}: not a CityJSON file`);
  const maxLod = opts.maxLod ?? 2.2;
  lodStats.available.clear();
  lodStats.used.clear();
  const builder = new CityMeshBuilder();
  const header = docs[0];
  const version = String(header.version ?? '1.0');
  if (!/^(1\.|2\.)/.test(version)) builder.warnings.push(`${name}: CityJSON version ${version} not tested.`);
  const crs: string | undefined = header.metadata?.referenceSystem ?? header.metadata?.crs?.epsg;
  const templates = header['geometry-templates'];

  for (const doc of docs) {
    throwIfAborted(opts.signal);
    if (doc.type !== 'CityJSON' && doc.type !== 'CityJSONFeature') continue;
    const tr = doc.transform ?? header.transform;
    const raw: number[][] = doc.vertices ?? [];
    const verts = new Float64Array(raw.length * 3);
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i]!;
      for (let k = 0; k < 3; k++) verts[3 * i + k] = tr ? v[k]! * tr.scale[k] + tr.translate[k] : v[k]!;
    }
    addDocument(builder, doc, verts, templates, maxLod, opts.signal);
  }
  const files = [name];
  const mesh = builder.build('cityjson', files, { kind: 'projected', ...(crs ? { crs: String(crs) } : {}) });
  if (!mesh.features.length)
    throw new EngineError('no-features', `${name}: no city objects with surface geometry`);
  const used = [...lodStats.used].sort((a, b) => a - b);
  mesh.meta = {
    version,
    lods: [...lodStats.available].sort((a, b) => a - b),
    ...(used.length ? { lod: used[used.length - 1]! } : {}),
  };
  return mesh;
}

function addDocument(
  builder: CityMeshBuilder,
  doc: any,
  verts: Float64Array,
  templates: any,
  maxLod: number,
  signal?: AbortSignal,
) {
  const objects: Record<string, any> = doc.CityObjects ?? {};
  const rootOf = (id: string): string => {
    let cur = id;
    for (let guard = 0; guard < 32; guard++) {
      const parents = objects[cur]?.parents;
      if (!Array.isArray(parents) || !parents.length || !objects[parents[0]]) break;
      cur = parents[0];
    }
    return cur;
  };
  const positions: number[] = [];
  const triFeature: number[] = [];
  const triClass: number[] = [];
  let count = 0;
  for (const [id, obj] of Object.entries(objects)) {
    if ((++count & 1023) === 0) throwIfAborted(signal);
    const geoms = pickGeometries(obj.geometry ?? [], maxLod);
    if (!geoms.length) continue;
    const root = rootOf(id);
    const type: string = objects[root]?.type ?? obj.type;
    const terrain = TERRAIN_TYPES.has(obj.type) || TERRAIN_TYPES.has(type);
    const f = builder.feature(root, { idSource: 'cityobject', legacyIgnored: false, terrain, type });
    for (const g of geoms) {
      let vsrc = verts;
      let boundaries = g.boundaries;
      let semantics = g.semantics;
      let gType: string = g.type;
      if (g.type === 'GeometryInstance') {
        const tpl = templates?.templates?.[g.template];
        if (!tpl) continue;
        const tv: number[][] = templates['vertices-templates'] ?? [];
        const m: number[] = g.transformationMatrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        const refIdx = g.boundaries[0];
        const rx = verts[3 * refIdx]!,
          ry = verts[3 * refIdx + 1]!,
          rz = verts[3 * refIdx + 2]!;
        vsrc = new Float64Array(tv.length * 3);
        tv.forEach((p, i) => {
          // row-major 4×4 transformation, then translation to the reference point
          vsrc[3 * i] = m[0]! * p[0]! + m[1]! * p[1]! + m[2]! * p[2]! + m[3]! + rx;
          vsrc[3 * i + 1] = m[4]! * p[0]! + m[5]! * p[1]! + m[6]! * p[2]! + m[7]! + ry;
          vsrc[3 * i + 2] = m[8]! * p[0]! + m[9]! * p[1]! + m[10]! * p[2]! + m[11]! + rz;
        });
        boundaries = tpl.boundaries;
        semantics = tpl.semantics;
        gType = tpl.type;
      }
      const surfaces: { rings: number[][]; sem: number }[] = [];
      const semOf = (value: any): number => {
        if (value === null || value === undefined) return SurfaceClass.Unknown;
        const s = semantics?.surfaces?.[value];
        return (s && SEMANTIC_CLASS[s.type]) ?? SurfaceClass.Unknown;
      };
      if (gType === 'MultiSurface' || gType === 'CompositeSurface') {
        boundaries.forEach((s: number[][], i: number) =>
          surfaces.push({ rings: s, sem: semOf(semantics?.values?.[i]) }),
        );
      } else if (gType === 'Solid') {
        boundaries.forEach((shell: number[][][], si: number) =>
          shell.forEach((s, i) => surfaces.push({ rings: s, sem: semOf(semantics?.values?.[si]?.[i]) })),
        );
      } else if (gType === 'MultiSolid' || gType === 'CompositeSolid') {
        boundaries.forEach((solid: number[][][][], so: number) =>
          solid.forEach((shell, si) =>
            shell.forEach((s, i) =>
              surfaces.push({ rings: s, sem: semOf(semantics?.values?.[so]?.[si]?.[i]) }),
            ),
          ),
        );
      } else continue;
      for (const surf of surfaces) {
        const ringPos: number[] = [];
        const holes: number[] = [];
        surf.rings.forEach((ring, ri) => {
          if (ri > 0) holes.push(ringPos.length / 3);
          for (const vi of ring) ringPos.push(vsrc[3 * vi]!, vsrc[3 * vi + 1]!, vsrc[3 * vi + 2]!);
        });
        const tris = triangulatePolygon(ringPos, holes);
        const cls = terrain ? SurfaceClass.Terrain : surf.sem;
        for (let k = 0; k < tris.length; k += 3) {
          for (let c = 0; c < 3; c++) {
            const vi = tris[k + c]!;
            positions.push(ringPos[3 * vi]!, ringPos[3 * vi + 1]!, ringPos[3 * vi + 2]!);
          }
          triFeature.push(f);
          triClass.push(cls);
        }
      }
    }
  }
  if (!positions.length) return;
  builder.addPart({
    name: 'CityObjects',
    positions: Float64Array.from(positions),
    index: null,
    matrix: identity(),
    triFeature: Int32Array.from(triFeature),
    triClass: Uint8Array.from(triClass),
  });
}
