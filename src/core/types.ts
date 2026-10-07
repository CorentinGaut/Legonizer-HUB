/**
 * Core data contracts (SPEC §9.1, extended where the spec leaves room).
 *
 * Everything here is plain data (typed arrays, numbers, strings) so it can be
 * structured-cloned or transferred between the UI thread and the engine Worker.
 */

export type Vec3 = [number, number, number];

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

/** Per-triangle surface class, when the source tells us (CityJSON semantics, batch table hints). */
export const SurfaceClass = {
  Unknown: 0,
  Ground: 1,
  Wall: 2,
  Roof: 3,
  /** Terrain / relief (CityJSON TINRelief). Excluded from building hits in `heightRef: 'ground'`. */
  Terrain: 4,
} as const;
export type SurfaceClass = (typeof SurfaceClass)[keyof typeof SurfaceClass];

export type IdSource = 'gml_id' | 'batch' | 'cityobject' | 'mesh';

export interface CityFeature {
  /**
   * Grouping key. Legacy grouping (SPEC §3.1 step 3, I8): `gml_id` when present; otherwise
   * `<content>#<batchId>`; otherwise one feature per mesh part.
   */
  key: string;
  idSource: IdSource;
  /**
   * UD-Viz skips features whose batch table has no / an empty `gml_id` (L7). In legacy mode
   * these are ignored only when *other* features of the dataset carry a gml_id, so that
   * gml_id datasets reproduce UD-Viz exactly while other datasets still produce a model (I8).
   */
  legacyIgnored: boolean;
  /** Terrain feature (e.g. CityJSON TINRelief). */
  terrain: boolean;
  /** Optional type name (CityJSON type, citygml::surface_type, OBJ group...). */
  type?: string;
}

export interface MeshPart {
  name: string;
  /** Local positions, xyz triplets, exactly as stored in the source (float32 for glTF/b3dm). */
  positions: Float32Array | Float64Array;
  /** Triangle vertex indices; null = non-indexed triangle soup (3 consecutive vertices per triangle). */
  index: Uint32Array | null;
  /**
   * Local → world matrix, column-major 4×4 (three.js layout). World frame: Z up, metres,
   * either the projected CRS of the data, a local ENU frame (ECEF tilesets) or the file's frame.
   */
  matrix: Float64Array;
  /** Per-triangle index into `CityMesh.features` (-1 = no feature). */
  triFeature: Int32Array;
  /** Optional per-triangle surface class (see SurfaceClass). */
  triClass?: Uint8Array;
  /**
   * Local bounds declared by the source (glTF POSITION accessor min/max). three's GLTFLoader uses
   * them as `geometry.boundingBox`, which UD-Viz uses to pre-filter meshes (legacy selection).
   */
  declaredBounds?: { min: Vec3; max: Vec3 } | null;
}

export type SourceFormat = '3dtiles' | 'b3dm' | 'gltf' | 'glb' | 'obj' | 'cityjson';

export interface FrameInfo {
  /** projected: CRS coordinates used as is; enu: local East-North-Up frame of an ECEF tileset; local: file frame. */
  kind: 'projected' | 'enu' | 'local';
  /** CRS name when known (e.g. "EPSG:3946" from CityJSON metadata). */
  crs?: string;
  /** For `enu`: geodetic origin of the frame (degrees, metres) and its ECEF position. */
  enuOrigin?: { lon: number; lat: number; height: number; ecef: Vec3 };
}

/** Facts for the import summary (I5–I9); all optional. */
export interface CityMeshMeta {
  /** 3D Tiles: content files loaded, files referenced but missing (with `ignoreMissing`), asset.version. */
  tiles?: number;
  missing?: string[];
  tilesetVersion?: string;
  /** 3D Tiles: tiles carry their own `transform` (py3dtilers offsets, I7). */
  tileTransforms?: boolean;
  /** CityJSON: LoD used and LoDs available. */
  lod?: number;
  lods?: number[];
  version?: string;
  /** Generic meshes (glTF, OBJ): unit and up axis applied, and whether they were detected. */
  unit?: 'm' | 'cm' | 'mm' | 'ft';
  unitDetected?: boolean;
  upAxis?: 'y' | 'z';
  upDetected?: boolean;
}

export interface CityMesh {
  meta?: CityMeshMeta;
  parts: MeshPart[];
  features: CityFeature[];
  /** World bounds (float64). */
  bounds: Bounds3;
  frame: FrameInfo;
  stats: { triangles: number; vertices: number; parts: number; features: number };
  source: { format: SourceFormat; files: string[] };
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------
// Heightmap (SPEC §9.1)

/** data[j*cols + i]; j = row south→north, i = column west→east. Unit = one brick height. */
export interface HeightMap {
  cols: number;
  rows: number;
  data: Int32Array;
}

export type HeightMode = 'normalized' | 'true-scale' | 'exaggerated';
export type HeightRef = 'lowest-base' | 'ground';
export type Sampling = 'corner-1' | 'centre-1' | 'supersample-2' | 'supersample-3' | 'supersample-4';
export type Aggregate = 'max' | 'mean' | 'median';
export type Rounding = 'trunc' | 'round' | 'ceil';
export type Selection = 'touching' | 'clip';
/** 'aabb' (legacy, L3): the rotated area is replaced by its axis-aligned bounding box; 'rotate': the grid turns with the area. */
export type RotationMode = 'aabb' | 'rotate';

export interface Params {
  /** Metres per stud. */
  scale: number;
  /** Normalized mode: bricks given to the tallest point. */
  maxHeight: number;
  platesX: number;
  platesY: number;
  heightMode: HeightMode;
  exaggeration?: number;
  heightRef: HeightRef;
  sampling: Sampling;
  aggregate?: Aggregate;
  rounding: Rounding;
  keepSmall: boolean;
  cap?: number;
  selection: Selection;
  rotation: RotationMode;
}

/** Area centre in world coordinates; size derived from plates × 32 × scale. */
export interface Area {
  cx: number;
  cy: number;
  rotationDeg: number;
}

export const STUDS_PER_PLATE = 32;

/** "Legacy (UD-Viz 4.6.1)" preset: the default, reproduces UD-Viz + legonizer@1.1.0 (SPEC §7.3). */
export const LEGACY_PRESET = {
  scale: 3,
  maxHeight: 10,
  heightMode: 'normalized',
  heightRef: 'lowest-base',
  sampling: 'corner-1',
  rounding: 'trunc',
  keepSmall: false,
  selection: 'touching',
  rotation: 'aabb',
} as const satisfies Partial<Params>;

export function defaultParams(platesX = 1, platesY = 1): Params {
  return { ...LEGACY_PRESET, platesX, platesY };
}

/**
 * True when the geometric options (selection, height reference, sampling, rotation) are the legacy
 * ones: the engine then samples heights with the exact UD-Viz numerics; the quantization options
 * (height mode, rounding, keep small, cap) are applied on top of those heights.
 */
export function usesLegacyGeometry(p: Params): boolean {
  return (
    p.heightRef === 'lowest-base' &&
    p.sampling === 'corner-1' &&
    p.selection === 'touching' &&
    p.rotation === 'aabb'
  );
}

/** True when every option equals the legacy preset: output identical to UD-Viz 4.6.1 + legonizer 1.1.0. */
export function isLegacy(p: Params): boolean {
  return (
    usesLegacyGeometry(p) &&
    p.heightMode === 'normalized' &&
    p.rounding === 'trunc' &&
    !p.keepSmall &&
    (p.cap === undefined || p.cap === null)
  );
}

// ---------------------------------------------------------------------------------------------
// Packing (SPEC §7.5.1)

export interface PlacedBrick {
  /** Baseplate name: columns A, B, C… west→east, rows 1, 2, 3… north→south (A1 = north-west). */
  plate: string;
  /** Layer, 1 = on the baseplate. */
  layer: number;
  /** Plate-local stud column of the brick's west edge (0…31, west→east). */
  x: number;
  /** Plate-local stud row of the brick's south edge (0…31, south→north, same as HeightMap j). */
  y: number;
  /** Extent in studs along x (west→east). */
  w: number;
  /** Extent in studs along y (south→north). */
  d: number;
  /** 0 = the part's long side runs along x, 90 = along y (equal sides: 0). */
  rotation: 0 | 90;
  /** Part number (BrickLink/LDraw design id, e.g. "3001"). */
  partId: string;
}
