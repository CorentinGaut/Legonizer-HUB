/**
 * Messages between the UI thread and the engine Worker. Everything is structured-cloneable;
 * large typed arrays are transferred.
 */
import type { ProjectFile } from '../export/project.ts';
import type { PaperSize, PdfSections } from '../export/pdfPlan.ts';
import type { HeightEstimate, HeightmapResult } from '../heightmap/index.ts';
import type { PlanRaster, PlanRasterRequest } from '../heightmap/planRaster.ts';
import type { ImportOptions } from '../import/index.ts';
import type { InventoryOptions } from '../packing/catalog.ts';
import type { PackingResult } from '../packing/pack.ts';
import type {
  Area,
  Bounds3,
  CityMesh,
  CityMeshMeta,
  FrameInfo,
  HeightMap,
  IdSource,
  Params,
} from '../types.ts';
import type { EngineErrorCode } from '../util/errors.ts';

export interface WireFile {
  path: string;
  data: Uint8Array;
}

export interface MeshSummary {
  format: CityMesh['source']['format'];
  files: string[];
  bounds: Bounds3;
  /** Bounding box size in metres (I6 summary). */
  size: [number, number, number];
  frame: FrameInfo;
  stats: CityMesh['stats'];
  warnings: string[];
  /** A3 default area at scale 3 m/stud. */
  defaultArea: { area: Area; platesX: number; platesY: number };
  /** I12: above ~2 M triangles the UI warns. */
  large: boolean;
  /** How buildings are identified (I8). */
  idSource: IdSource | 'mixed';
  meta: CityMeshMeta;
  /** Terrain or ground surfaces exist: the "ground" height reference is available. */
  groundAvailable: boolean;
  /** Total size of the input files (bytes). */
  inputBytes: number;
}

export interface EstimateResult extends HeightEstimate {
  fixes: {
    /** What the True scale preset would give (fix "Use true scale"). */
    trueScale: { maxBricks: number; maxHeightCm: number };
    /** Smallest max height (≤ 100) keeping ≥ 95 % of the buildings, normalized mode only. */
    maxHeight: { value: number; keepShare: number } | null;
  };
  /** Built-up studs and those left empty, sampled one ray per stud (UI-17); null when too large. */
  sampled: { builtStuds: number; erasedStuds: number } | null;
  /** Tallest selected building: centre, top (world z) and height above the reference (L2 marker). */
  tallestInfo: { feature: number; x: number; y: number; top: number; height: number } | null;
  groundAvailable: boolean;
  /** Time the Worker took to build the BVH of this model (built once, by the first ray query). */
  bvhBuildMs: number | null;
}

export type ExportKind =
  | 'csv'
  | 'csv-per-plate'
  | 'bricklink'
  | 'rebrickable'
  | 'ldraw'
  | 'ldraw-mpd'
  | 'project'
  | 'calque-png'
  | 'calque-jpeg'
  | 'calque-preview'
  | 'plate-pass'
  | 'pdf'
  | 'all';

export interface ExportOptions {
  /** Project name (LDraw title, PDF cover). */
  title?: string;
  /** File-safe base name (`part-dieu`); defaults to a slug of the title. */
  fileBase?: string;
  demo?: string;
  /** Shop lists: spares in percent (0, 5, 10) and the baseplate colour (UI-5: white by default). */
  spares?: number;
  baseplateColour?: 'white' | 'grey';
  /** Projection layer. */
  dpi?: number;
  plateGrid?: boolean;
  labels?: boolean;
  previewPx?: number;
  /** CSV per plate as one zip. */
  zip?: boolean;
  /** Plate passes: one plate, and the page URL to build `…#guide/build/B2/1&d=…`. */
  plate?: string;
  baseUrl?: string;
  /** PDF. */
  paper?: PaperSize;
  sections?: Partial<PdfSections>;
  sectionsName?: string;
  messages?: Record<string, string>;
  locale?: string;
  date?: string;
  presetName?: string;
  differences?: string[];
  crs?: string;
  /** Download everything: README.txt content. */
  readme?: string;
}

export interface ExportFile {
  name: string;
  mime: string;
  data: string | Uint8Array;
}

export interface RestoreResult {
  /** The project file without its encoded heights (they are in `heightMap`). */
  project: ProjectFile;
  heightMap: HeightMap;
  packing: PackingResult;
}

export type EngineRequest =
  | { id: number; type: 'import'; files: WireFile[]; options?: Omit<ImportOptions, 'signal' | 'progress'> }
  | { id: number; type: 'import-url'; url: string; options?: Omit<ImportOptions, 'signal' | 'progress'> }
  | { id: number; type: 'reimport'; options?: Omit<ImportOptions, 'signal' | 'progress'> }
  | { id: number; type: 'estimate'; area: Area; params: Params }
  | {
      id: number;
      type: 'generate';
      area: Area;
      params: Params;
      inventory?: InventoryOptions;
      beamWidth?: number;
    }
  | { id: number; type: 'pack'; heightMap: HeightMap; inventory?: InventoryOptions; beamWidth?: number }
  | {
      id: number;
      type: 'restore';
      area: Area;
      params: Params;
      heightMap: HeightMap;
      inventory?: InventoryOptions;
    }
  | { id: number; type: 'open-project'; text: string }
  | { id: number; type: 'plan-raster'; request: PlanRasterRequest }
  | { id: number; type: 'export'; kind: ExportKind; options?: ExportOptions }
  | { id: number; type: 'mesh-preview' }
  | { id: number; type: 'cancel'; target: number };

export interface GenerateResult {
  heightmap: Omit<HeightmapResult, 'raw'>;
  packing: PackingResult;
}

export interface MeshPreview {
  /** World position subtracted from every coordinate (float32 precision). */
  origin: [number, number, number];
  /** Non-indexed triangles, xyz relative to `origin`. */
  positions: Float32Array;
  /** Feature index per triangle. */
  triFeature: Int32Array;
}

export interface ResultMap {
  import: MeshSummary;
  'import-url': MeshSummary;
  reimport: MeshSummary;
  estimate: EstimateResult;
  generate: GenerateResult;
  pack: PackingResult;
  restore: PackingResult;
  'open-project': RestoreResult;
  'plan-raster': PlanRaster;
  export: ExportFile[];
  'mesh-preview': MeshPreview;
}

export type EngineResponse =
  | { id: number; type: 'progress'; stage: string; fraction: number; detail?: string }
  | { id: number; type: 'result'; result: unknown }
  | {
      id: number;
      type: 'error';
      code: EngineErrorCode | 'internal';
      message: string;
      details?: Record<string, unknown>;
    };
