import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { generateHeightMap } from '../../src/core/heightmap/index.ts';
import { getMeshIndex } from '../../src/core/heightmap/meshIndex.ts';
import { geodeticToEcef, ecefToGeodetic } from '../../src/core/import/ecef.ts';
import type { FileMap } from '../../src/core/import/fileMap.ts';
import { detectFormat, importCityModel } from '../../src/core/import/index.ts';
import { parseB3dm } from '../../src/core/import/b3dm.ts';
import { SoupBuilder, syntheticBoxesCity, writeB3dm, writeGlb } from '../../src/core/samples/synthetic.ts';
import { SurfaceClass, defaultParams } from '../../src/core/types.ts';
import { EngineError } from '../../src/core/util/errors.ts';

const enc = new TextEncoder();
const json = (o: unknown) => enc.encode(JSON.stringify(o));

function oneBox(h = 12): SoupBuilder {
  const s = new SoupBuilder();
  s.box(0, -5, -5, 0, 5, 5, h);
  return s;
}

describe('3D Tiles (b3dm) import', () => {
  it('reads the synthetic py3dtilers-like tileset as a zip and as a folder, identically', () => {
    const files = syntheticBoxesCity(1);
    const zip = zipSync(Object.fromEntries([...files].map(([p, d]) => [`city/${p}`, d])));
    const fromZip = importCityModel([{ path: 'city.zip', data: zip }]);
    const folder: FileMap = new Map([...files].map(([p, d]) => [`my-upload/${p}`, d]));
    const fromFolder = importCityModel(folder);
    expect(fromZip.source.format).toBe('3dtiles');
    expect(fromZip.stats).toEqual(fromFolder.stats);
    expect(fromZip.bounds).toEqual(fromFolder.bounds);
    expect(fromZip.features.every((f) => f.idSource === 'gml_id' && f.key.startsWith('SYN_BOX_'))).toBe(true);
    expect(fromZip.frame.kind).toBe('projected');
    // flat ground at z = 170.476 (tile transform z)
    expect(fromZip.bounds.min[2]).toBeCloseTo(170.476, 3);
    const hm = generateHeightMap(fromZip, { cx: 1844400, cy: 5175100, rotationDeg: 0 }, defaultParams(4, 4));
    expect(hm.vertical.maxValue).toBe(10);
  });

  it('parses b3dm header, batch table (JSON + binary) and RTC_CENTER', () => {
    const glb = writeGlb(Float32Array.from(oneBox().pos), Float32Array.from(oneBox().batch));
    const b = parseB3dm(writeB3dm(glb, 1, { gml_id: ['B1'] }));
    expect(b.batchLength).toBe(1);
    expect(b.batchTable.gml_id).toEqual(['B1']);
    expect(b.rtcCenter).toBeNull();
    expect(b.glb.subarray(0, 4)).toEqual(enc.encode('glTF'));
  });

  it('uses the finest LOD: REPLACE parents are skipped, ADD parents kept; external tilesets followed', () => {
    const tile = (h: number, id: string) =>
      writeB3dm(writeGlb(Float32Array.from(oneBox(h).pos), Float32Array.from(oneBox(h).batch)), 1, {
        gml_id: [id],
      });
    const files: FileMap = new Map([
      ['coarse.b3dm', tile(50, 'COARSE')],
      ['fine.b3dm', tile(20, 'FINE')],
      ['add-parent.b3dm', tile(5, 'ADDPARENT')],
      ['sub/ext.b3dm', tile(7, 'EXT')],
      [
        'sub/external.json',
        json({
          asset: { version: '1.0' },
          geometricError: 1,
          root: {
            boundingVolume: { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
            geometricError: 0,
            content: { uri: 'ext.b3dm' },
          },
        }),
      ],
      [
        'tileset.json',
        json({
          asset: { version: '1.0' },
          geometricError: 100,
          root: {
            boundingVolume: { box: [0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100] },
            geometricError: 100,
            refine: 'REPLACE',
            content: { uri: 'coarse.b3dm' },
            children: [
              {
                boundingVolume: { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
                geometricError: 0,
                content: { uri: 'fine.b3dm' },
                transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1],
              },
              {
                boundingVolume: { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
                geometricError: 1,
                refine: 'ADD',
                content: { uri: 'add-parent.b3dm' },
                transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 100, 0, 1],
                children: [
                  {
                    boundingVolume: { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
                    geometricError: 0,
                    content: { uri: 'sub/external.json' },
                  },
                ],
              },
            ],
          },
        }),
      ],
    ]);
    const mesh = importCityModel(files);
    expect(mesh.features.map((f) => f.key).sort()).toEqual(['ADDPARENT', 'EXT', 'FINE']);
    // child transforms compose: the external tileset's content inherits the parent's (0, 100, 0)
    const idx = getMeshIndex(mesh);
    const ext = mesh.features.findIndex((f) => f.key === 'EXT');
    expect(idx.featureBox[ext * 6 + 1]).toBeCloseTo(95, 6);
    expect(idx.featureBox[ext * 6 + 5]).toBeCloseTo(7, 6);
  });

  it('reports missing tiles clearly (I11)', () => {
    const files = syntheticBoxesCity(1);
    files.delete('tiles/2.b3dm');
    let err: unknown;
    try {
      importCityModel(files);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe('missing-files');
    expect((err as EngineError).message).toContain('tiles/2.b3dm');
    const partial = importCityModel(files, { ignoreMissing: true });
    expect(partial.warnings.join(' ')).toContain('missing');
  });

  it('converts an ECEF tileset to a local ENU frame (I7)', () => {
    // a 30 m tall box placed at 4.85° E, 45.76° N in ECEF through the root transform (ENU→ECEF)
    const lon = 4.85,
      lat = 45.76,
      h = 170;
    const o = geodeticToEcef(lon, lat, h);
    const L = (lon * Math.PI) / 180,
      P = (lat * Math.PI) / 180;
    const e = [-Math.sin(L), Math.cos(L), 0];
    const n = [-Math.sin(P) * Math.cos(L), -Math.sin(P) * Math.sin(L), Math.cos(P)];
    const u = [Math.cos(P) * Math.cos(L), Math.cos(P) * Math.sin(L), Math.sin(P)];
    const transform = [...e, 0, ...n, 0, ...u, 0, ...o, 1];
    const box = oneBox(30);
    const files: FileMap = new Map([
      [
        't.b3dm',
        writeB3dm(writeGlb(Float32Array.from(box.pos), Float32Array.from(box.batch)), 1, {
          gml_id: ['ECEF1'],
        }),
      ],
      [
        'tileset.json',
        json({
          asset: { version: '1.0' },
          geometricError: 1,
          root: {
            transform,
            boundingVolume: { sphere: [0, 0, 0, 50] },
            geometricError: 0,
            content: { uri: 't.b3dm' },
          },
        }),
      ],
    ]);
    const mesh = importCityModel(files);
    expect(mesh.frame.kind).toBe('enu');
    const g = ecefToGeodetic(...mesh.frame.enuOrigin!.ecef);
    expect(g.lat).toBeCloseTo(lat, 3);
    expect(mesh.bounds.max[2] - mesh.bounds.min[2]).toBeCloseTo(30, 3);
    expect(mesh.bounds.max[0] - mesh.bounds.min[0]).toBeCloseTo(10, 3);
    expect(mesh.bounds.min[2]).toBeCloseTo(h, 1);
  });
});

describe('glTF / GLB import', () => {
  it('GLB with _BATCHID: Y-up converted to Z-up, one feature per batch id', () => {
    const s = new SoupBuilder();
    s.box(0, 0, 0, 0, 10, 10, 20);
    s.box(1, 20, 0, 0, 30, 10, 5);
    const mesh = importCityModel([
      { path: 'model.glb', data: writeGlb(Float32Array.from(s.pos), Float32Array.from(s.batch)) },
    ]);
    expect(mesh.source.format).toBe('glb');
    expect(mesh.features).toHaveLength(2);
    // writeGlb stores Z-up data with a Z-up→Y-up node matrix (py3dtiles layout): net Z-up
    expect(mesh.bounds.max[2]).toBeCloseTo(20, 6);
    expect(mesh.bounds.max[0]).toBeCloseTo(30, 6);
  });

  it('.gltf with an external .bin, indexed triangles, TRS nodes, centimetres (I6 override)', () => {
    const pos = new Float32Array([0, 0, 0, 1000, 0, 0, 1000, 0, -1000, 0, 0, -1000, 0, 500, 0]);
    const idx = new Uint16Array([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]);
    const bin = new Uint8Array(pos.byteLength + idx.byteLength);
    bin.set(new Uint8Array(pos.buffer), 0);
    bin.set(new Uint8Array(idx.buffer), pos.byteLength);
    const gltf = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ children: [1], translation: [100, 0, 0] }, { mesh: 0 }],
      meshes: [{ name: 'pyramid', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 5,
          type: 'VEC3',
          min: [0, 0, -1000],
          max: [1000, 500, 0],
        },
        { bufferView: 1, componentType: 5123, count: 12, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
        { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength },
      ],
      buffers: [{ uri: 'data/pyramid.bin', byteLength: bin.length }],
    };
    const files: FileMap = new Map([
      ['pyramid.gltf', json(gltf)],
      ['data/pyramid.bin', bin],
    ]);
    const mesh = importCityModel(files, { unit: 'cm' });
    expect(mesh.stats.triangles).toBe(4);
    expect(mesh.bounds.max[2]).toBeCloseTo(5, 6); // 500 cm tall, Y-up → Z
    expect(mesh.bounds.min[0]).toBeCloseTo(1, 6); // node translation 100 cm
    expect(mesh.bounds.max[1]).toBeCloseTo(10, 6); // glTF −Z (−1000 cm) → +Y north
    expect(() => importCityModel(new Map([['pyramid.gltf', json(gltf)]]))).toThrow(/missing external buffer/);
  });

  it('rejects Draco-compressed glTF with a clear error', () => {
    const files: FileMap = new Map([
      [
        'd.gltf',
        json({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'], meshes: [] }),
      ],
    ]);
    expect(() => importCityModel(files)).toThrow(/KHR_draco_mesh_compression/);
  });
});

describe('OBJ import', () => {
  it('objects become features, quads and n-gons are triangulated, negative indices, Y-up auto-detected', () => {
    const obj = [
      '# two buildings, Blender-style Y-up',
      'mtllib city.mtl',
      'o Tower',
      'v 0 0 0',
      'v 10 0 0',
      'v 10 0 -10',
      'v 0 0 -10',
      'v 0 40 0',
      'v 10 40 0',
      'v 10 40 -10',
      'v 0 40 -10',
      'f 5 6 7 8',
      'f 1/1/1 2/2/2 6/6/6 5/5/5',
      'o Hall',
      'v 30 0 0',
      'v 60 0 0',
      'v 60 0 -20',
      'v 45 0 -10',
      'v 30 0 -20',
      'v 30 6 0',
      'v 60 6 0',
      'v 60 6 -20',
      'v 45 6 -10',
      'v 30 6 -20',
      'f -5 -4 -3 -2 -1',
      'usemtl concrete',
      'l 1 2',
      'g Ground',
      'v -100 0 50',
      'v 150 0 50',
      'v 150 0 -100',
      'f -3 -2 -1',
    ].join('\n');
    const mesh = importCityModel([{ path: 'city.obj', data: enc.encode(obj) }]);
    expect(mesh.source.format).toBe('obj');
    // `g` inside an `o` does not split the object: the ground triangle belongs to Hall
    expect(mesh.features.map((f) => f.type)).toEqual(['Tower', 'Hall']);
    expect(mesh.stats.triangles).toBe(2 + 2 + 3 + 1);
    expect(mesh.bounds.max[2]).toBeCloseTo(40, 9); // Y-up → Z-up
    expect(mesh.bounds.max[1]).toBeCloseTo(100, 9); // −Z → north
    expect(mesh.warnings.join(' ')).toMatch(/Up axis auto-detected: Y-up/);
    // roof triangles face up after conversion: the legacy (front-face) raycast hits the tower roof
    const hm = generateHeightMap(
      mesh,
      { cx: 5, cy: 5, rotationDeg: 0 },
      { ...defaultParams(1, 1), scale: 0.25, maxHeight: 40 },
    );
    expect(hm.vertical.maxValue).toBe(40);
    // explicit override
    const z = importCityModel([{ path: 'city.obj', data: enc.encode(obj) }], { upAxis: 'z' });
    expect(z.bounds.max[2]).toBeCloseTo(50, 9);
  });
});

describe('CityJSON import', () => {
  const doc = {
    type: 'CityJSON',
    version: '1.1',
    metadata: { referenceSystem: 'https://www.opengis.net/def/crs/EPSG/0/3946' },
    transform: { scale: [0.001, 0.001, 0.001], translate: [1844000, 5175000, 170] },
    CityObjects: {
      B1: { type: 'Building', children: ['B1-P1'] },
      'B1-P1': {
        type: 'BuildingPart',
        parents: ['B1'],
        geometry: [
          { type: 'MultiSurface', lod: '1', boundaries: [[[0, 1, 2, 3]]] },
          {
            type: 'Solid',
            lod: '2.2',
            boundaries: [
              [
                [[0, 3, 2, 1]],
                [
                  [4, 5, 6, 7],
                  [8, 9, 10, 11],
                ],
                [[0, 1, 5, 4]],
                [[1, 2, 6, 5]],
                [[2, 3, 7, 6]],
                [[3, 0, 4, 7]],
              ],
            ],
            semantics: {
              surfaces: [{ type: 'GroundSurface' }, { type: 'RoofSurface' }, { type: 'WallSurface' }],
              values: [[0, 1, 2, 2, 2, 2]],
            },
          },
          { type: 'Solid', lod: 3, boundaries: [] },
        ],
      },
      T1: {
        type: 'TINRelief',
        geometry: [{ type: 'CompositeSurface', lod: '1', boundaries: [[[12, 13, 14]], [[12, 14, 15]]] }],
      },
    },
    vertices: [
      [0, 0, 0],
      [20000, 0, 0],
      [20000, 20000, 0],
      [0, 20000, 0],
      [0, 0, 15000],
      [20000, 0, 15000],
      [20000, 20000, 15000],
      [0, 20000, 15000],
      [5000, 5000, 15000],
      [5000, 15000, 15000],
      [15000, 15000, 15000],
      [15000, 5000, 15000],
      [-50000, -50000, -2000],
      [80000, -50000, -2000],
      [80000, 80000, 3000],
      [-50000, 80000, 3000],
    ],
  };

  it('applies transform, picks the highest LoD ≤ 2.2, groups parts under their building, triangulates holes, keeps semantics', () => {
    const mesh = importCityModel([{ path: 'district.city.json', data: json(doc) }]);
    expect(mesh.source.format).toBe('cityjson');
    expect(mesh.frame.crs).toContain('3946');
    expect(mesh.features.map((f) => f.key).sort()).toEqual(['B1', 'T1']);
    const t1 = mesh.features.find((f) => f.key === 'T1')!;
    expect(t1.terrain).toBe(true);
    const part = mesh.parts[0]!;
    // ground 2 + roof with hole 8 + walls 4×2 = 18, terrain 2
    expect(mesh.stats.triangles).toBe(20);
    const roof = [...part.triClass!].filter((c) => c === SurfaceClass.Roof).length;
    expect(roof).toBe(8);
    expect(mesh.bounds.max[2]).toBeCloseTo(185, 6);
    // the courtyard (hole) stays empty, the roof ring gets bricks; ground mode ignores the TIN
    const hm = generateHeightMap(
      mesh,
      { cx: 1844010, cy: 5175010, rotationDeg: 0 },
      {
        ...defaultParams(1, 1),
        scale: 1,
        heightMode: 'true-scale',
        heightRef: 'ground',
        sampling: 'centre-1',
        rotation: 'rotate',
      },
    );
    const at = (x: number, y: number) => hm.heightMap.data[(y + 16 - 10) * 32 + (x + 16 - 10)]!; // world offset → cell
    expect(at(2, 2)).toBe(Math.trunc(15 / 1.2)); // roof ring
    expect(at(10, 10)).toBe(0); // courtyard
  });

  it('reads CityJSON 2.0, the default output of citygml-tools to-cityjson, like 1.1', () => {
    // CityJSON 2.0 keeps the 1.1 structure for what the importer reads (transform, CityObjects,
    // geometry boundaries, semantics); the help recommends citygml-tools for CityGML.
    const v11 = importCityModel([{ path: 'district.city.json', data: json(doc) }]);
    const v20 = importCityModel([{ path: 'district.city.json', data: json({ ...doc, version: '2.0' }) }]);
    expect(v20.warnings).toEqual([]);
    expect(v20.features.map((f) => f.key)).toEqual(v11.features.map((f) => f.key));
    expect(v20.stats.triangles).toBe(v11.stats.triangles);
    expect(v20.bounds).toEqual(v11.bounds);
  });

  it('detects formats and rejects unknown files', () => {
    expect(detectFormat(new Map([['a/b/x.city.json', json(doc)]])).kind).toBe('cityjson');
    expect(() => detectFormat(new Map([['readme.txt', enc.encode('hello')]]))).toThrow(
      /No supported 3D city model/,
    );
  });
});
