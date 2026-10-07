/**
 * Wavefront OBJ importer (SPEC I4): `v` and `f` records; `o` (else `g`) names become features;
 * materials (.mtl), normals and texture coordinates are ignored. Polygons are triangulated with
 * their winding preserved. Reference: Wavefront OBJ spec, Appendix B1 of the Advanced Visualizer manual
 * (https://paulbourke.net/dataformats/obj/).
 */
import type { CityMesh } from '../types.ts';
import { EngineError, throwIfAborted } from '../util/errors.ts';
import { decodeUtf8 } from '../util/bytes.ts';
import { identity } from '../util/threeCompat.ts';
import { CityMeshBuilder } from './cityMesh.ts';
import { triangulatePolygon } from './triangulate.ts';
import { applyGenericFrame, type GenericMeshOptions } from './units.ts';

export function importObj(
  bytes: Uint8Array,
  name: string,
  opts: GenericMeshOptions & { signal?: AbortSignal } = {},
): CityMesh {
  const text = decodeUtf8(bytes);
  const verts: number[] = [];
  const index: number[] = [];
  const triFeature: number[] = [];
  const builder = new CityMeshBuilder();
  let currentO: string | null = null;
  let currentG: string | null = null;
  const featureFor = () => {
    const key = currentO ?? currentG ?? name;
    return builder.feature(`${name}#${key}`, {
      idSource: 'mesh',
      legacyIgnored: false,
      terrain: false,
      type: key,
    });
  };
  let featureIdx = featureFor();
  let lineStart = 0;
  let lineNo = 0;
  const poly: number[] = [];
  const polyPos: number[] = [];
  while (lineStart < text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd < 0) lineEnd = text.length;
    let line = text.slice(lineStart, lineEnd);
    lineStart = lineEnd + 1;
    lineNo++;
    // line continuation
    while (line.endsWith('\\') && lineStart < text.length) {
      let next = text.indexOf('\n', lineStart);
      if (next < 0) next = text.length;
      line = line.slice(0, -1) + ' ' + text.slice(lineStart, next);
      lineStart = next + 1;
    }
    if ((lineNo & 0xffff) === 0) throwIfAborted(opts.signal);
    const t = line.trim();
    if (t.length < 2 || t[0] === '#') continue;
    const c0 = t[0];
    const c1 = t[1];
    if (c0 === 'v' && (c1 === ' ' || c1 === '\t')) {
      const parts = t.split(/\s+/);
      verts.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (c0 === 'f' && (c1 === ' ' || c1 === '\t')) {
      const parts = t.split(/\s+/);
      poly.length = 0;
      const nv = verts.length / 3;
      for (let k = 1; k < parts.length; k++) {
        const s = parts[k]!;
        if (!s) continue;
        let vi = parseInt(s, 10);
        if (Number.isNaN(vi)) continue;
        vi = vi < 0 ? nv + vi : vi - 1;
        if (vi < 0 || vi >= nv)
          throw new EngineError('invalid-file', `${name}: face index out of range at line ${lineNo}`);
        poly.push(vi);
      }
      if (poly.length < 3) continue;
      if (poly.length === 3) {
        index.push(poly[0]!, poly[1]!, poly[2]!);
        triFeature.push(featureIdx);
      } else {
        polyPos.length = 0;
        for (const vi of poly) polyPos.push(verts[3 * vi]!, verts[3 * vi + 1]!, verts[3 * vi + 2]!);
        const tris = triangulatePolygon(polyPos, []);
        for (let k = 0; k < tris.length; k += 3) {
          index.push(poly[tris[k]!]!, poly[tris[k + 1]!]!, poly[tris[k + 2]!]!);
          triFeature.push(featureIdx);
        }
      }
    } else if (c0 === 'o' && (c1 === ' ' || c1 === '\t')) {
      currentO = t.slice(2).trim() || null;
      featureIdx = featureFor();
    } else if (c0 === 'g' && (c1 === ' ' || c1 === '\t')) {
      currentG = t.slice(2).trim() || null;
      if (currentO === null) featureIdx = featureFor();
    }
  }
  if (index.length === 0) throw new EngineError('empty-geometry', `${name}: no faces found`);
  builder.addPart({
    name,
    positions: Float64Array.from(verts),
    index: Uint32Array.from(index),
    matrix: identity(),
    triFeature: Int32Array.from(triFeature),
  });
  const mesh = builder.build('obj', [name], { kind: 'local' });
  applyGenericFrame(mesh, opts, null);
  return mesh;
}
