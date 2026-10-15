/**
 * Minimal glTF 2.0 geometry reader (GLB and .gltf with embedded or external buffers).
 *
 * Why in-house rather than three's GLTFLoader: we only need positions, indices, feature ids and
 * node matrices; GLTFLoader also builds materials/textures (image decoding needs DOM or
 * ImageBitmap, unavailable in Node tests), converts nothing we need, and hides the exact float32
 * data and matrix chain the legacy parity depends on. Spec: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
 */
import { EngineError } from '../util/errors.ts';
import { base64ToBytes, dataView, decodeUtf8, parseJsonBytes } from '../util/bytes.ts';
import { compose, fromArray, identity, multiply, recompose, type Mat4 } from '../util/threeCompat.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export interface GltfPrimitiveGeometry {
  name: string;
  /** Local positions (float32 when the accessor is FLOAT, float64 for dequantized integer data). */
  positions: Float32Array | Float64Array;
  /** Triangle indices (null = non-indexed triangle list). */
  index: Uint32Array | null;
  /** Node world matrix inside the glTF scene (parent × local, three.js Object3D semantics). */
  matrix: Mat4;
  /** Per-vertex feature id (_BATCHID, BATCHID or EXT_mesh_features _FEATURE_ID_n), or null. */
  featureIds: Float32Array | Uint32Array | Uint16Array | Uint8Array | null;
  /** POSITION accessor min/max as declared in the file (three's GLTFLoader uses them as geometry.boundingBox). */
  declaredBounds: { min: [number, number, number]; max: [number, number, number] } | null;
  /** Name of the mesh / node, for one-feature-per-mesh fallback. */
  meshName: string;
}

export interface GltfGeometry {
  primitives: GltfPrimitiveGeometry[];
  json: Json;
  warnings: string[];
}

export type ExternalResolver = (uri: string) => Uint8Array | undefined;

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function isGlb(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && dataView(bytes).getUint32(0, true) === GLB_MAGIC;
}

export function parseGlbContainer(bytes: Uint8Array): {
  json: Json;
  bin: Uint8Array | null;
  version: number;
} {
  const dv = dataView(bytes);
  if (dv.getUint32(0, true) !== GLB_MAGIC)
    throw new EngineError('invalid-file', 'Not a GLB file (bad magic)');
  const version = dv.getUint32(4, true);
  if (version === 1) {
    throw new EngineError(
      'unsupported-format',
      'glTF 1.0 content (old b3dm) is not supported: convert the tileset to glTF 2.0 (e.g. with 3d-tiles-tools upgrade).',
    );
  }
  if (version !== 2) throw new EngineError('invalid-file', `Unsupported GLB version ${version}`);
  const length = Math.min(dv.getUint32(8, true), bytes.length);
  let offset = 12;
  let json: Json = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= length) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    const chunk = bytes.subarray(start, start + chunkLength);
    if (chunkType === CHUNK_JSON) json = parseJsonBytes(chunk);
    else if (chunkType === CHUNK_BIN && bin === null) bin = chunk;
    offset = start + chunkLength;
  }
  if (!json) throw new EngineError('invalid-file', 'GLB has no JSON chunk');
  return { json, bin, version };
}

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

function readComponent(dv: DataView, offset: number, componentType: number): number {
  switch (componentType) {
    case 5120:
      return dv.getInt8(offset);
    case 5121:
      return dv.getUint8(offset);
    case 5122:
      return dv.getInt16(offset, true);
    case 5123:
      return dv.getUint16(offset, true);
    case 5125:
      return dv.getUint32(offset, true);
    case 5126:
      return dv.getFloat32(offset, true);
    default:
      throw new EngineError('invalid-file', `Unknown accessor componentType ${componentType}`);
  }
}

/** glTF 2.0 §3.11 normalized integer → float conversion. */
function denormalize(v: number, componentType: number): number {
  switch (componentType) {
    case 5120:
      return Math.max(v / 127, -1);
    case 5121:
      return v / 255;
    case 5122:
      return Math.max(v / 32767, -1);
    case 5123:
      return v / 65535;
    default:
      return v;
  }
}

class GltfReader {
  private readonly buffers: (Uint8Array | null)[] = [];
  readonly warnings: string[] = [];
  readonly json: Json;
  private readonly bin: Uint8Array | null;
  private readonly resolve: ExternalResolver | undefined;
  private readonly label: string;

  constructor(json: Json, bin: Uint8Array | null, resolve: ExternalResolver | undefined, label: string) {
    this.json = json;
    this.bin = bin;
    this.resolve = resolve;
    this.label = label;
    const required: string[] = json.extensionsRequired ?? [];
    const used: string[] = json.extensionsUsed ?? [];
    for (const ext of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression']) {
      if (required.includes(ext) || used.includes(ext)) {
        throw new EngineError(
          'unsupported-feature',
          `${label}: ${ext} compressed geometry is not supported yet; re-export the model without mesh compression.`,
          { extension: ext },
        );
      }
    }
  }

  private buffer(i: number): Uint8Array {
    if (this.buffers[i] !== undefined && this.buffers[i] !== null) return this.buffers[i]!;
    const def = this.json.buffers?.[i];
    if (!def) throw new EngineError('invalid-file', `${this.label}: missing buffer ${i}`);
    let data: Uint8Array | undefined;
    if (def.uri === undefined) {
      if (!this.bin)
        throw new EngineError('invalid-file', `${this.label}: buffer ${i} has no uri and no GLB BIN chunk`);
      data = this.bin;
    } else if (typeof def.uri === 'string' && def.uri.startsWith('data:')) {
      const comma = def.uri.indexOf(',');
      data = base64ToBytes(def.uri.slice(comma + 1));
    } else {
      data = this.resolve?.(def.uri);
      if (!data) {
        throw new EngineError('missing-files', `${this.label}: missing external buffer "${def.uri}"`, {
          missing: [def.uri],
        });
      }
    }
    this.buffers[i] = data;
    return data;
  }

  /** Reads an accessor into a flat array of numbers (Float64Array, dequantized when normalized). */
  readAccessor(index: number): {
    values: Float64Array;
    f32: Float32Array | null;
    itemSize: number;
    count: number;
  } {
    const acc = this.json.accessors?.[index];
    if (!acc) throw new EngineError('invalid-file', `${this.label}: missing accessor ${index}`);
    const itemSize = TYPE_SIZE[acc.type as string];
    const compSize = COMPONENT_SIZE[acc.componentType as number];
    if (!itemSize || !compSize) throw new EngineError('invalid-file', `${this.label}: bad accessor ${index}`);
    const count: number = acc.count;
    const values = new Float64Array(count * itemSize);
    const isFloat = acc.componentType === 5126;
    const f32 = isFloat ? new Float32Array(count * itemSize) : null;
    if (acc.bufferView !== undefined) {
      const bv = this.json.bufferViews[acc.bufferView];
      const buf = this.buffer(bv.buffer);
      const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : itemSize * compSize;
      const dv = dataView(buf);
      if (base + stride * (count - 1) + itemSize * compSize > buf.length && count > 0) {
        throw new EngineError('invalid-file', `${this.label}: accessor ${index} exceeds its buffer`);
      }
      if (isFloat && stride === itemSize * 4 && (buf.byteOffset + base) % 4 === 0) {
        f32!.set(new Float32Array(buf.buffer, buf.byteOffset + base, count * itemSize));
        for (let k = 0; k < values.length; k++) values[k] = f32![k]!;
      } else {
        for (let i = 0; i < count; i++) {
          for (let c = 0; c < itemSize; c++) {
            let v = readComponent(dv, base + i * stride + c * compSize, acc.componentType);
            if (acc.normalized) v = denormalize(v, acc.componentType);
            values[i * itemSize + c] = v;
            if (f32) f32[i * itemSize + c] = v;
          }
        }
      }
    }
    if (acc.sparse) {
      const sp = acc.sparse;
      const ibv = this.json.bufferViews[sp.indices.bufferView];
      const vbv = this.json.bufferViews[sp.values.bufferView];
      const ibuf = dataView(this.buffer(ibv.buffer));
      const vbuf = dataView(this.buffer(vbv.buffer));
      const ibase = (ibv.byteOffset ?? 0) + (sp.indices.byteOffset ?? 0);
      const vbase = (vbv.byteOffset ?? 0) + (sp.values.byteOffset ?? 0);
      const isz = COMPONENT_SIZE[sp.indices.componentType as number]!;
      for (let s = 0; s < sp.count; s++) {
        const target = readComponent(ibuf, ibase + s * isz, sp.indices.componentType);
        for (let c = 0; c < itemSize; c++) {
          let v = readComponent(vbuf, vbase + (s * itemSize + c) * compSize, acc.componentType);
          if (acc.normalized) v = denormalize(v, acc.componentType);
          values[target * itemSize + c] = v;
          if (f32) f32[target * itemSize + c] = v;
        }
      }
    }
    return { values, f32: acc.normalized ? null : f32, itemSize, count };
  }

  readIndices(index: number): Uint32Array {
    const { values } = this.readAccessor(index);
    const out = new Uint32Array(values.length);
    for (let i = 0; i < values.length; i++) out[i] = values[i]!;
    return out;
  }
}

function nodeLocalMatrix(node: Json): Mat4 {
  if (Array.isArray(node.matrix)) {
    // GLTFLoader: node.applyMatrix4(matrix) → decompose + compose
    return recompose(fromArray(node.matrix));
  }
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  if (node.translation === undefined && node.rotation === undefined && node.scale === undefined)
    return identity();
  return compose(t[0], t[1], t[2], { x: r[0], y: r[1], z: r[2], w: r[3] }, s[0], s[1], s[2]);
}

function triangulate(mode: number, index: Uint32Array | null, vertexCount: number): Uint32Array | null {
  if (mode === 4) return index;
  const src = index ?? Uint32Array.from({ length: vertexCount }, (_, i) => i);
  const tris: number[] = [];
  if (mode === 5) {
    for (let i = 0; i + 2 < src.length; i++) {
      if (i % 2 === 0) tris.push(src[i]!, src[i + 1]!, src[i + 2]!);
      else tris.push(src[i + 1]!, src[i]!, src[i + 2]!);
    }
  } else if (mode === 6) {
    for (let i = 1; i + 1 < src.length; i++) tris.push(src[0]!, src[i]!, src[i + 1]!);
  }
  return Uint32Array.from(tris);
}

function featureAttributeName(prim: Json): string | null {
  const featureIds = prim.extensions?.EXT_mesh_features?.featureIds;
  if (Array.isArray(featureIds)) {
    for (const f of featureIds) if (typeof f.attribute === 'number') return `_FEATURE_ID_${f.attribute}`;
  }
  const legacy = prim.extensions?.EXT_feature_metadata?.featureIdAttributes;
  if (Array.isArray(legacy) && legacy[0]?.featureIds?.attribute) return legacy[0].featureIds.attribute;
  const attrs = prim.attributes ?? {};
  if (attrs._BATCHID !== undefined) return '_BATCHID';
  if (attrs.BATCHID !== undefined) return 'BATCHID';
  if (attrs._FEATURE_ID_0 !== undefined) return '_FEATURE_ID_0';
  return null;
}

/**
 * Reads all triangle primitives of the default scene with their world matrices
 * `((root × N_0) × N_1) × …`, multiplied in the same order as three's updateMatrixWorld
 * (floating-point matrix products are not associative).
 */
export function readGltf(
  json: Json,
  bin: Uint8Array | null,
  resolve: ExternalResolver | undefined,
  label: string,
  root: Mat4 = identity(),
): GltfGeometry {
  const reader = new GltfReader(json, bin, resolve, label);
  const primitives: GltfPrimitiveGeometry[] = [];
  const nodes: Json[] = json.nodes ?? [];
  const sceneIndex: number = json.scene ?? 0;
  const roots: number[] =
    json.scenes?.[sceneIndex]?.nodes ?? (json.scenes ? [] : nodes.map((_: Json, i: number) => i));

  const visit = (ni: number, parent: Mat4, depth: number) => {
    if (depth > 64) throw new EngineError('invalid-file', `${label}: node hierarchy too deep or cyclic`);
    const node = nodes[ni];
    if (!node) return;
    const world = multiply(parent, nodeLocalMatrix(node));
    if (node.extensions?.EXT_mesh_gpu_instancing) {
      reader.warnings.push(`${label}: EXT_mesh_gpu_instancing is not supported; instances were ignored.`);
    }
    if (node.mesh !== undefined) {
      const mesh = json.meshes?.[node.mesh];
      const meshName = mesh?.name ?? node.name ?? `mesh${node.mesh}`;
      (mesh?.primitives ?? []).forEach((prim: Json, pi: number) => {
        const mode = prim.mode ?? 4;
        if (mode < 4) return; // points and lines carry no surface
        if (prim.attributes?.POSITION === undefined) return;
        const pos = reader.readAccessor(prim.attributes.POSITION);
        if (pos.itemSize !== 3) return;
        let index = prim.indices !== undefined ? reader.readIndices(prim.indices) : null;
        index = triangulate(mode, index, pos.count);
        const fname = featureAttributeName(prim);
        let featureIds: GltfPrimitiveGeometry['featureIds'] = null;
        if (fname && prim.attributes[fname] !== undefined) {
          const f = reader.readAccessor(prim.attributes[fname]);
          featureIds = f.f32 ?? Float32Array.from(f.values);
        }
        const acc = json.accessors[prim.attributes.POSITION];
        primitives.push({
          name: `${meshName}#${pi}`,
          meshName,
          positions: pos.f32 ?? pos.values,
          index,
          matrix: world,
          featureIds,
          declaredBounds:
            Array.isArray(acc.min) && Array.isArray(acc.max)
              ? { min: [acc.min[0], acc.min[1], acc.min[2]], max: [acc.max[0], acc.max[1], acc.max[2]] }
              : null,
        });
      });
    }
    for (const c of node.children ?? []) visit(c, world, depth + 1);
  };
  for (const r of roots) visit(r, root, 0);
  return { primitives, json, warnings: reader.warnings };
}

/** Parses a .glb or .gltf file. */
export function parseGltfFile(
  bytes: Uint8Array,
  resolve: ExternalResolver | undefined,
  label: string,
  root: Mat4 = identity(),
): GltfGeometry {
  if (isGlb(bytes)) {
    const { json, bin } = parseGlbContainer(bytes);
    return readGltf(json, bin, resolve, label, root);
  }
  let json: Json;
  try {
    json = JSON.parse(decodeUtf8(bytes));
  } catch {
    throw new EngineError('invalid-file', `${label}: not a valid glTF JSON file`);
  }
  if (!json.asset) throw new EngineError('invalid-file', `${label}: not a glTF file (no "asset")`);
  return readGltf(json, null, resolve, label, root);
}
