/**
 * Reference implementation of the legacy pipeline, for parity tests. Deliberately independent of
 * src/core: it re-creates what UD-Viz 4.6.1 runs, with the real three.js builds:
 *
 * - iTowns 2.41.1-next.9 object graph (tile Object3D.applyMatrix4(transform), B3dmParser scene
 *   rotation, GLTFLoader nodes, geometry.boundingBox from accessor min/max) with three r154;
 * - `initC3DTileFeatures` and `C3DTFeature.computeWorldBox3` ported verbatim from iTowns;
 * - `createMockUpObject` ported verbatim from @ud-viz/widget_legonizer 4.6.1 MockUpUtils.js;
 * - `Legonizer.generateMockup` box-selector steps (BoxGeometry + matrixWorld + computeBoundingBox);
 * - the npm package legonizer@1.1.0 itself (`createHeightMapFromBufferGeometry` with its own
 *   three r147, and `generateCSVwithHeightMap` with a minimal `document` stub capturing the data URI).
 *
 * Only the b3dm/GLB byte layout is read by a small reader below (py3dtiles content: one node, one
 * non-indexed primitive, float32 attributes).
 *
 * Ported code keeps its licence (THIRD_PARTY_NOTICES.md): iTowns, Copyright 2016 iTowns Contributors,
 * MIT licence; UD-Viz, Copyright of University of Lyon 2012 - 2023, LGPL-2.1, used here under the
 * GPL-3.0-or-later as LGPL-2.1 section 3 allows.
 */
import { THREE154 as T, legonizer } from '../helpers/threeVersions.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Files = Map<string, Uint8Array>;

function readB3dm(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ftj = dv.getUint32(12, true),
    ftb = dv.getUint32(16, true),
    btj = dv.getUint32(20, true),
    btb = dv.getUint32(24, true);
  const dec = new TextDecoder();
  let o = 28;
  const ft = ftj ? JSON.parse(dec.decode(bytes.subarray(o, o + ftj))) : {};
  o += ftj + ftb;
  const bt = btj ? JSON.parse(dec.decode(bytes.subarray(o, o + btj))) : {};
  o += btj + btb;
  const glb = bytes.subarray(o);
  const gdv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jl = gdv.getUint32(12, true);
  const json = JSON.parse(dec.decode(glb.subarray(20, 20 + jl)));
  const binStart = 20 + jl + 8;
  const bin = glb.subarray(binStart);
  const accessor = (i: number) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const n = a.count * ({ SCALAR: 1, VEC3: 3 } as any)[a.type];
    if (a.componentType !== 5126) throw new Error('reference reader: float32 accessors only');
    const start = bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return new Float32Array(bin.buffer.slice(start, start + n * 4));
  };
  return { ft, bt, json, accessor };
}

/** iTowns C3DTFeature (2.41.1-next.9), verbatim behaviour. */
class C3DTFeature {
  tileId: number;
  batchId: number;
  groups: { start: number; count: number }[];
  private info: any;
  userData: any;
  object3d: any;
  constructor(
    tileId: number,
    batchId: number,
    groups: { start: number; count: number }[],
    info: any,
    userData: any,
    object3d: any,
  ) {
    this.tileId = tileId;
    this.batchId = batchId;
    this.groups = groups;
    this.info = info;
    this.userData = userData;
    this.object3d = object3d;
  }
  computeWorldBox3(target = new T.Box3()) {
    target.max.x = -Infinity;
    target.max.y = -Infinity;
    target.max.z = -Infinity;
    target.min.x = Infinity;
    target.min.y = Infinity;
    target.min.z = Infinity;
    this.groups.forEach((group) => {
      const positionIndexStart = group.start * 3;
      const positionIndexCount = (group.start + group.count) * 3;
      for (let index = positionIndexStart; index < positionIndexCount; index += 3) {
        const x = this.object3d.geometry.attributes.position.array[index];
        const y = this.object3d.geometry.attributes.position.array[index + 1];
        const z = this.object3d.geometry.attributes.position.array[index + 2];
        target.max.x = Math.max(x, target.max.x);
        target.max.y = Math.max(y, target.max.y);
        target.max.z = Math.max(z, target.max.z);
        target.min.x = Math.min(x, target.min.x);
        target.min.y = Math.min(y, target.min.y);
        target.min.z = Math.min(z, target.min.z);
      }
    });
    target.applyMatrix4(this.object3d.matrixWorld);
    return target;
  }
  getInfo() {
    return this.info;
  }
}

export interface RefLayer {
  object3d: any;
  tilesC3DTileFeatures: Map<number, Map<number, C3DTFeature>>;
}

/** Loads a py3dtilers-like tileset into an iTowns-like layer (three r154 objects). */
export function buildReferenceLayer(files: Files, tilesetPath = 'tileset.json'): RefLayer {
  const scene = new T.Scene();
  const layerObject = new T.Group();
  scene.add(layerObject);
  const tilesC3DTileFeatures = new Map<number, Map<number, C3DTFeature>>();
  const tileset = JSON.parse(new TextDecoder().decode(files.get(tilesetPath)!));
  let tileId = 0;
  const contents: { tileId: number; tileObject: any; batchTable: any }[] = [];
  const visit = (meta: any, parent: any) => {
    const tile = new T.Object3D();
    if (meta.transform) tile.applyMatrix4(new T.Matrix4().fromArray(meta.transform)); // configureTile
    parent.add(tile);
    tile.updateMatrixWorld();
    const id = tileId++;
    const uri = meta.content?.uri ?? meta.content?.url;
    if (uri) {
      const bytes = files.get(uri);
      if (bytes) {
        const { ft, bt, json, accessor } = readB3dm(bytes);
        const gltfScene = new T.Group();
        // B3dmParser: gltfUpAxis undefined → applyMatrix4(makeRotationX(π/2)); position ← FT RTC
        gltfScene.applyMatrix4(new T.Matrix4().makeRotationX(Math.PI / 2));
        gltfScene.position.set(...((ft.RTC_CENTER ?? [0, 0, 0]) as [number, number, number]));
        const prim = json.meshes[0].primitives[0];
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.BufferAttribute(accessor(prim.attributes.POSITION), 3));
        geometry.setAttribute('normal', new T.BufferAttribute(accessor(prim.attributes.NORMAL), 3));
        geometry.setAttribute('_BATCHID', new T.BufferAttribute(accessor(prim.attributes._BATCHID), 1));
        const pa = json.accessors[prim.attributes.POSITION];
        // GLTFLoader computeBounds: boundingBox from the accessor's min/max
        geometry.boundingBox = new T.Box3(new T.Vector3(...pa.min), new T.Vector3(...pa.max));
        const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial());
        const nodeDef = json.nodes[json.scenes[json.scene ?? 0].nodes[0]];
        if (nodeDef.matrix) mesh.applyMatrix4(new T.Matrix4().fromArray(nodeDef.matrix)); // GLTFLoader loadNode
        gltfScene.add(mesh);
        tile.add(gltfScene);
        contents.push({ tileId: id, tileObject: tile, batchTable: bt });
      }
    }
    for (const c of meta.children ?? []) visit(c, tile);
  };
  visit(tileset.root, layerObject);
  scene.updateMatrixWorld(true);
  // C3DTilesLayer.initC3DTileFeatures (verbatim logic)
  for (const { tileId: tid, tileObject, batchTable } of contents) {
    tilesC3DTileFeatures.set(tid, new Map());
    const getInfoById = (batchId: number) => {
      const info: any = { batchTable: {} };
      for (const k of Object.keys(batchTable)) info.batchTable[k] = batchTable[k][batchId];
      return info;
    };
    tileObject.traverse((child: any) => {
      if (child.geometry && child.geometry.attributes._BATCHID) {
        const geometryAttributes = child.geometry.attributes;
        let currentBatchId = geometryAttributes._BATCHID.array[0];
        let start = 0;
        let count = 0;
        const registerBatchIdGroup = () => {
          if (tilesC3DTileFeatures.get(tid)!.has(currentBatchId)) {
            tilesC3DTileFeatures.get(tid)!.get(currentBatchId)!.groups.push({ start, count });
          } else {
            tilesC3DTileFeatures
              .get(tid)!
              .set(
                currentBatchId,
                new C3DTFeature(
                  tid,
                  currentBatchId,
                  [{ start, count }],
                  getInfoById(currentBatchId),
                  {},
                  child,
                ),
              );
          }
        };
        for (
          let index = 0;
          index < geometryAttributes.position.array.length;
          index += geometryAttributes.position.itemSize
        ) {
          const batchIndex = index / geometryAttributes.position.itemSize;
          const batchId = geometryAttributes._BATCHID.array[batchIndex];
          if (currentBatchId !== batchId) {
            registerBatchIdGroup();
            currentBatchId = batchId;
            start = batchIndex;
            count = 0;
          }
          count++;
          if (index + geometryAttributes.position.itemSize >= geometryAttributes.position.array.length)
            registerBatchIdGroup();
        }
      }
    });
  }
  return { object3d: layerObject, tilesC3DTileFeatures };
}

/** @ud-viz/widget_legonizer 4.6.1 MockUpUtils.createMockUpObject, verbatim (three r154). */
export function createMockUpObject(layers: RefLayer[], area: any) {
  const geometryMockUp = new T.BufferGeometry();
  const positionsMockUp: number[] = [];
  const normalsMockUp: number[] = [];
  const materialsMockup: any[] = [];
  const addToFinalMockUp = (positions: number[], normals: number[], color: any) => {
    let materialIndex = -1;
    const material = materialsMockup.filter((mat, index) => {
      if (mat.color.getHex() == color) {
        materialIndex = index;
        return true;
      }
      return false;
    });
    if (material.length == 0) {
      materialsMockup.push(new T.MeshStandardMaterial({ color: color }));
      materialIndex = materialsMockup.length - 1;
    }
    geometryMockUp.addGroup(positionsMockUp.length / 3, positions.length / 3, materialIndex);
    for (const p of positions) positionsMockUp.push(p);
    for (const n of normals) normalsMockUp.push(n);
  };
  const potentialObjects = new Map();
  layers.forEach((l) => {
    l.object3d.traverse((child: any) => {
      if (child.geometry && child.geometry.attributes._BATCHID) {
        const bbChild = child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
        if (area.intersectsBox(bbChild)) potentialObjects.set(child.uuid, child);
      }
    });
  });
  const gmlIDs: any[] = [];
  const bbBuffer = new T.Box3();
  layers.forEach((l) => {
    for (const [, c3dTfeatures] of l.tilesC3DTileFeatures) {
      for (const [, feature] of c3dTfeatures) {
        const gmlId = feature.getInfo().batchTable['gml_id'];
        if (gmlIDs.includes(gmlId) || !gmlId) continue;
        if (!potentialObjects.has(feature.object3d.uuid)) continue;
        feature.computeWorldBox3(bbBuffer);
        if (area.intersectsBox(bbBuffer)) gmlIDs.push(gmlId);
      }
    }
  });
  const bufferPos = new T.Vector3();
  const bufferNormal = new T.Vector3();
  layers.forEach((l) => {
    for (const [, c3dTfeatures] of l.tilesC3DTileFeatures) {
      for (const [, feature] of c3dTfeatures) {
        const gmlId = feature.getInfo().batchTable['gml_id'];
        if (gmlIDs.includes(gmlId)) {
          const positions: number[] = [];
          const normals: number[] = [];
          const normalMatrixWorld = new T.Matrix3().getNormalMatrix(feature.object3d.matrixWorld);
          feature.groups.forEach((group) => {
            const positionIndexStart = group.start * 3;
            const positionIndexCount = (group.start + group.count) * 3;
            for (let index = positionIndexStart; index < positionIndexCount; index += 3) {
              bufferPos.x = feature.object3d.geometry.attributes.position.array[index];
              bufferPos.y = feature.object3d.geometry.attributes.position.array[index + 1];
              bufferPos.z = feature.object3d.geometry.attributes.position.array[index + 2];
              positions.push(...bufferPos.applyMatrix4(feature.object3d.matrixWorld).toArray());
              bufferNormal.x = feature.object3d.geometry.attributes.normal.array[index];
              bufferNormal.y = feature.object3d.geometry.attributes.normal.array[index + 1];
              bufferNormal.z = feature.object3d.geometry.attributes.normal.array[index + 2];
              normals.push(...bufferNormal.applyMatrix3(normalMatrixWorld).toArray());
            }
          });
          addToFinalMockUp(positions, normals, feature.object3d.material.color);
        }
      }
    }
  });
  geometryMockUp.setAttribute('position', new T.BufferAttribute(new Float32Array(positionsMockUp), 3));
  geometryMockUp.setAttribute('normal', new T.BufferAttribute(new Float32Array(normalsMockUp), 3));
  geometryMockUp.computeBoundingBox();
  const bbMockUp = geometryMockUp.boundingBox!;
  const geoPositionsMockUp = geometryMockUp.attributes.position!.array as Float32Array;
  for (let index = 0; index < geoPositionsMockUp.length; index += 3) {
    geoPositionsMockUp[index + 2]! -= bbMockUp.min.z;
  }
  const mockUpObject = new T.Mesh(geometryMockUp, materialsMockup);
  return mockUpObject;
}

export interface ReferenceArea {
  cx: number;
  cy: number;
  /** Radians, like the UD-Viz rotation inputs. */
  rotationZ: number;
  platesX: number;
  platesY: number;
  scale: number;
  legoHeight: number;
}

/** Legonizer.generateMockup with the box selector set as after a drag-select (scale snapped to plates). */
export function referenceHeightMap(
  layer: RefLayer,
  a: ReferenceArea,
): { heightMap: number[][]; selected: number } {
  const scene = new T.Scene();
  const boxSelector = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshLambertMaterial());
  scene.add(boxSelector);
  boxSelector.position.set(a.cx, a.cy, 0);
  boxSelector.rotation.set(0, 0, a.rotationZ);
  // tall enough to contain every feature: the legacy z test then never excludes anything
  boxSelector.scale.set(a.platesX * a.scale * 32, a.platesY * a.scale * 32, 100000);
  boxSelector.updateMatrixWorld();
  const bufferBoxGeometry = boxSelector.geometry.clone();
  bufferBoxGeometry.applyMatrix4(boxSelector.matrixWorld);
  bufferBoxGeometry.computeBoundingBox();
  const mockUpObject = createMockUpObject([layer], bufferBoxGeometry.boundingBox);
  const selected = mockUpObject.geometry.attributes.position!.count / 3;
  const heightMap = legonizer.createHeightMapFromBufferGeometry(
    mockUpObject.geometry,
    bufferBoxGeometry.boundingBox,
    a.platesX,
    a.platesY,
    a.legoHeight,
  );
  return { heightMap, selected };
}

/** legonizer.generateCSVwithHeightMap with a DOM stub; returns the downloaded file's bytes and name. */
export function referenceCsv(heightMap: number[][], name: string): { bytes: Uint8Array; name: string } {
  let link: any = null;
  const g = globalThis as any;
  const previous = g.document;
  g.document = {
    createElement: () => {
      const el: any = {
        attrs: {} as Record<string, string>,
        setAttribute(k: string, v: string) {
          el.attrs[k] = v;
        },
        click() {
          link = el;
        },
      };
      return el;
    },
    body: { appendChild() {} },
  };
  try {
    (legonizer as any).generateCSVwithHeightMap(heightMap, name);
  } finally {
    g.document = previous;
  }
  const href: string = link.attrs.href;
  const prefix = 'data:text/csv;charset=utf-8,';
  if (!href.startsWith(prefix)) throw new Error('unexpected data URI');
  // a browser percent-decodes the data URL payload into the file bytes
  return {
    bytes: new TextEncoder().encode(decodeURIComponent(href.slice(prefix.length))),
    name: link.attrs.download,
  };
}
