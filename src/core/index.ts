/**
 * Legonizer core engine — framework-free, DOM-free (runs in a Worker and in Node).
 * import → CityMesh → heightmap (legacy / improved) → packing → exports.
 */
export * from './types.ts';
export { APP_VERSION, HEIGHTMAP_ALGORITHM_VERSION, PACKING_ALGORITHM_VERSION } from './version.ts';
export { EngineError, type EngineErrorCode } from './util/errors.ts';
export {
  detectFormat,
  importCityModel,
  toFileMap,
  type FileMap,
  type ImportOptions,
  type InputFile,
} from './import/index.ts';
export {
  PARAM_LIMITS,
  areaCorners,
  areaSize,
  defaultArea,
  estimateHeights,
  fitsTable,
  generateHeightMap,
  generateHeightMapAsync,
  legacyAreaBox,
  mapScaleDenominator,
  physicalSizeCm,
  validateParams,
  type GridInfo,
  type HeightEstimate,
  type HeightmapResult,
  type SampledRect,
} from './heightmap/index.ts';
export {
  ALL_PARTS,
  BASEPLATE,
  BRICKS,
  TILE_CAP_MODES,
  COLOR_WHITE,
  TILES,
  tileCapsColumn,
  enabledShapes,
  isTile,
  normalizeInventory,
  partById,
  tileShapes,
  type BrickPart,
  type TileCapMode,
  type InventoryOptions,
  type NormalizedInventory,
} from './packing/catalog.ts';
export {
  packHeightMap,
  packHeightMapAsync,
  type LayerStats,
  type PackingOptions,
  type PackingResult,
  type PlateSummary,
} from './packing/pack.ts';
export { columnLetters, parsePlateName, plateName } from './packing/plates.ts';
export { verifyPacking } from './packing/verify.ts';
export * from './export/index.ts';
export { syntheticBoxesCity, syntheticSlope } from './samples/synthetic.ts';
export { EngineClient, EngineRequestError, type WorkerLike } from './worker/client.ts';
export type {
  EngineRequest,
  EngineResponse,
  ExportFile,
  ExportKind,
  GenerateResult,
  MeshPreview,
  MeshSummary,
  ResultMap,
  WireFile,
} from './worker/protocol.ts';
