/**
 * Engine state and message host. Runs in the Worker (engine.worker.ts) and, unchanged, in Node
 * tests through an in-memory port. Requests run one at a time; `cancel` is handled immediately and
 * aborts the running request at its next yield (heightmap rows, packing layers, PDF pages).
 */
import { zipSync } from 'fflate';
import { csvFileName, heightMapToCsv, perPlateCsv } from '../export/csv.ts';
import { brickLinkXml } from '../export/bricklink.ts';
import {
  LEGACY_CALQUE_NAME,
  calquePng,
  legacyCalqueJpeg,
  legacyCalqueLayout,
  physicalCalqueLayout,
} from '../export/calque.ts';
import { plateHeights } from '../export/guide.ts';
import { ldrawModel, ldrawMpd } from '../export/ldraw.ts';
import { encodePlatePass, platePassUrl } from '../export/platePass.ts';
import {
  createProject,
  hashInputs,
  parseProject,
  projectFileName,
  projectHeightMap,
  serializeProject,
  type ProjectFile,
} from '../export/project.ts';
import { rebrickableCsv } from '../export/rebrickable.ts';
import type { PdfGuideInput } from '../export/pdfGuide.ts';
import {
  defaultArea,
  estimateHeights,
  generateHeightMapAsync,
  type HeightEstimate,
  type HeightmapResult,
} from '../heightmap/index.ts';
import { getMeshIndex, worldVertex } from '../heightmap/meshIndex.ts';
import { quantize } from '../heightmap/improved.ts';
import { planRaster, type PlanRaster, type PlanRasterRequest } from '../heightmap/planRaster.ts';
import { generateHeightMap } from '../heightmap/index.ts';
import { boundsSize } from '../import/cityMesh.ts';
import { toFileMap, type FileMap } from '../import/fileMap.ts';
import { importCityModel, type ImportOptions } from '../import/index.ts';
import { fetchTilesetFiles } from '../import/remote.ts';
import { BASEPLATE, normalizeInventory, type InventoryOptions } from '../packing/catalog.ts';
import { packHeightMapAsync, type PackingResult } from '../packing/pack.ts';
import { parsePlateName } from '../packing/plates.ts';
import { isLegacy, type Area, type CityMesh, type HeightMap, type IdSource, type Params } from '../types.ts';
import { EngineError } from '../util/errors.ts';
import type { ProgressFn } from '../util/progress.ts';
import type {
  EngineRequest,
  EngineResponse,
  EstimateResult,
  ExportFile,
  ExportOptions,
  GenerateResult,
  MeshPreview,
  MeshSummary,
  RestoreResult,
  WireFile,
} from './protocol.ts';

export const LARGE_MODEL_TRIANGLES = 2_000_000;
/** Above this many studs the estimate skips the sampled share of built-up studs left empty to stay fast. */
export const ESTIMATE_SAMPLED_MAX_STUDS = 66_000;
/**
 * Shop colours of the light bluish grey baseplate (an option; white is the default, SPEC §12), checked 2026-10-07: BrickLink
 * colour guide (https://www.bricklink.com/catalogColors.asp) lists "Light Bluish Gray" as ID 86
 * (LEGO Medium Stone Grey 194); Rebrickable colors.csv
 * (https://cdn.rebrickable.com/media/downloads/colors.csv.gz) has `71,Light Bluish Gray,A0A5A9`.
 */
export const COLOR_LBG = { bricklink: 86, rebrickable: 71 } as const;

/** "True scale" preset of the settings step (SPEC §7.3). */
export function trueScaleParams(p: Params, groundAvailable: boolean): Params {
  return {
    ...p,
    heightMode: 'true-scale',
    rounding: 'round',
    keepSmall: true,
    sampling: 'centre-1',
    selection: 'clip',
    rotation: 'rotate',
    heightRef: groundAvailable ? 'ground' : 'lowest-base',
  };
}

function dominantIdSource(mesh: CityMesh): IdSource | 'mixed' {
  const counts = new Map<IdSource, number>();
  for (const f of mesh.features) counts.set(f.idSource, (counts.get(f.idSource) ?? 0) + 1);
  if (counts.size === 1) return [...counts.keys()][0]!;
  if (counts.has('gml_id')) return 'gml_id';
  return 'mixed';
}

/** Shop quantities with spares (rounded up per part; baseplates have no spares). */
export function withSpares(packing: Pick<PackingResult, 'counts' | 'baseplates'>, pct: number) {
  if (!pct) return packing;
  const counts: Record<string, number> = {};
  for (const [id, q] of Object.entries(packing.counts)) counts[id] = Math.ceil(q * (1 + pct / 100));
  return { counts, baseplates: packing.baseplates };
}

function fileSlug(s: unknown): string {
  const t = typeof s === 'string' ? s : '';
  const slug = t
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'legonizer';
}

interface LastResult {
  area: Area;
  params: Params;
  inventory: InventoryOptions;
  heightMap: HeightMap;
  heightmap?: HeightmapResult;
  packing: PackingResult;
  demo?: string;
}

export class Engine {
  files: FileMap | null = null;
  mesh: CityMesh | null = null;
  importOptions: Omit<ImportOptions, 'signal' | 'progress'> = {};
  last: LastResult | null = null;

  import(
    files: WireFile[] | FileMap,
    options: Omit<ImportOptions, 'signal' | 'progress'> = {},
    progress?: ProgressFn,
  ): MeshSummary {
    const map = files instanceof Map ? files : toFileMap(files);
    const mesh = importCityModel(map, { ...options, ...(progress ? { progress } : {}) });
    progress?.('index', 0);
    getMeshIndex(mesh);
    progress?.('index', 1);
    this.files = map;
    this.mesh = mesh;
    this.importOptions = options;
    this.last = null;
    return this.summary();
  }

  summary(): MeshSummary {
    const mesh = this.requireMesh();
    const idx = getMeshIndex(mesh);
    let groundSurfaces = false;
    for (let f = 0; f < idx.featureGroundZ.length && !groundSurfaces; f++)
      if (Number.isFinite(idx.featureGroundZ[f]!)) groundSurfaces = true;
    return {
      format: mesh.source.format,
      files: mesh.source.files,
      bounds: mesh.bounds,
      size: boundsSize(mesh.bounds),
      frame: mesh.frame,
      stats: mesh.stats,
      warnings: mesh.warnings,
      defaultArea: defaultArea(mesh.bounds, 3),
      large: mesh.stats.triangles > LARGE_MODEL_TRIANGLES,
      idSource: dominantIdSource(mesh),
      meta: mesh.meta ?? {},
      groundAvailable: groundSurfaces || mesh.features.some((f) => f.terrain),
      inputBytes: this.files ? [...this.files.values()].reduce((a, d) => a + d.length, 0) : 0,
    };
  }

  /** Re-applies import options (unit, up axis, LoD) to the files already loaded. */
  reimport(options: Omit<ImportOptions, 'signal' | 'progress'>, progress?: ProgressFn): MeshSummary {
    if (!this.files) throw new EngineError('empty-geometry', 'Import a model first.');
    return this.import(this.files, { ...this.importOptions, ...options }, progress);
  }

  private requireMesh(): CityMesh {
    if (!this.mesh) throw new EngineError('empty-geometry', 'Import a model first.');
    return this.mesh;
  }

  estimate(area: Area, params: Params): EstimateResult {
    const mesh = this.requireMesh();
    const est: HeightEstimate = estimateHeights(mesh, area, params);
    const summary = this.summary();
    // fixes of the "buildings that disappear" warning (SPEC §7.3)
    const ts = estimateHeights(mesh, area, trueScaleParams(params, summary.groundAvailable));
    let maxHeightFix: EstimateResult['fixes']['maxHeight'] = null;
    if (params.heightMode === 'normalized' && est.features > 0 && est.featuresBelowOneBrick > 0) {
      const range = Math.max(0, ...est.selectedHeights);
      for (let M = Math.floor(params.maxHeight) + 1; M <= 100; M++) {
        const mpb = range / M;
        let below = 0;
        for (const h of est.selectedHeights) {
          const q = isLegacy(params)
            ? mpb > 0
              ? Math.trunc(h / mpb)
              : 0
            : quantize(h, mpb, { ...params, maxHeight: M });
          if (q < 1) below++;
        }
        if (below <= 0.05 * est.features) {
          maxHeightFix = { value: M, keepShare: 1 - below / est.features };
          break;
        }
      }
    }
    // share of the built-up studs that get no brick (SPEC §7.3), sampled with one ray per stud
    let sampled: EstimateResult['sampled'] = null;
    if (est.studs <= ESTIMATE_SAMPLED_MAX_STUDS && est.features > 0) {
      const single: Params = params.sampling.startsWith('supersample')
        ? { ...params, sampling: 'centre-1' }
        : params;
      const r = generateHeightMap(mesh, area, single, { keepRaw: true });
      sampled = { builtStuds: r.vertical.builtStuds, erasedStuds: r.vertical.erasedStuds };
    }
    const fb = getMeshIndex(mesh).featureBox;
    const tallest =
      est.tallest >= 0
        ? {
            feature: est.tallest,
            x: (fb[est.tallest * 6]! + fb[est.tallest * 6 + 3]!) / 2,
            y: (fb[est.tallest * 6 + 1]! + fb[est.tallest * 6 + 4]!) / 2,
            top: fb[est.tallest * 6 + 5]!,
            height: Math.max(...est.selectedHeights),
          }
        : null;
    return {
      ...est,
      fixes: { trueScale: { maxBricks: ts.maxBricks, maxHeightCm: ts.maxHeightCm }, maxHeight: maxHeightFix },
      sampled,
      tallestInfo: tallest,
      groundAvailable: summary.groundAvailable,
      bvhBuildMs: getMeshIndex(mesh).bvh ? getMeshIndex(mesh).bvhBuildMs : null,
    };
  }

  async generate(
    area: Area,
    params: Params,
    inventory: InventoryOptions = {},
    beamWidth: number | undefined,
    signal: AbortSignal,
    progress: ProgressFn,
  ): Promise<GenerateResult> {
    const mesh = this.requireMesh();
    const heightmap = await generateHeightMapAsync(mesh, area, params, { signal, progress });
    const packing = await packHeightMapAsync(heightmap.heightMap, {
      ...inventory,
      ...(beamWidth ? { beamWidth } : {}),
      signal,
      progress,
    });
    this.last = { area, params, inventory, heightMap: heightmap.heightMap, heightmap, packing };
    const { raw: _raw, ...hm } = heightmap;
    return { heightmap: hm, packing };
  }

  async pack(
    hm: HeightMap,
    inventory: InventoryOptions = {},
    beamWidth: number | undefined,
    signal: AbortSignal,
    progress: ProgressFn,
  ) {
    const packing = await packHeightMapAsync(hm, {
      ...inventory,
      ...(beamWidth ? { beamWidth } : {}),
      signal,
      progress,
    });
    if (this.last && this.last.heightMap.data.length === hm.data.length)
      this.last = { ...this.last, inventory, packing };
    return packing;
  }

  /** Re-installs a result without the source (reload, project file, guide-only): packs the heights. */
  async restore(
    area: Area,
    params: Params,
    heightMap: HeightMap,
    inventory: InventoryOptions,
    signal: AbortSignal,
    progress: ProgressFn,
  ): Promise<PackingResult> {
    const packing = await packHeightMapAsync(heightMap, { ...inventory, signal, progress });
    this.last = { area, params, inventory, heightMap, packing };
    return packing;
  }

  async openProject(text: string, signal: AbortSignal, progress: ProgressFn): Promise<RestoreResult> {
    let project: ProjectFile;
    try {
      project = parseProject(text);
    } catch (e) {
      throw new EngineError('invalid-file', (e as Error).message);
    }
    const heightMap = projectHeightMap(project);
    const packing = await this.restore(
      project.area,
      project.params,
      heightMap,
      project.inventory,
      signal,
      progress,
    );
    if (project.demo) this.last!.demo = project.demo;
    return { project: { ...project, heightMap: { ...project.heightMap, data: '' } }, heightMap, packing };
  }

  planRaster(r: PlanRasterRequest): PlanRaster {
    return planRaster(this.requireMesh(), r);
  }

  async export(
    kind: string,
    options: ExportOptions = {},
    signal?: AbortSignal,
    progress?: ProgressFn,
  ): Promise<ExportFile[]> {
    if (!this.last) throw new EngineError('invalid-params', 'Generate a model first.');
    const { packing, params, area, inventory } = this.last;
    const hm = this.last.heightMap;
    const title = typeof options.title === 'string' && options.title ? options.title : 'Legonizer model';
    const base = fileSlug(options.fileBase ?? title);
    const spares = typeof options.spares === 'number' ? options.spares : 0;
    const greyPlates = options.baseplateColour === 'grey';
    switch (kind) {
      case 'csv':
        return [
          { name: csvFileName(params.platesX, params.platesY), mime: 'text/csv', data: heightMapToCsv(hm) },
        ];
      case 'csv-per-plate': {
        const files = perPlateCsv(hm);
        if (options.zip) {
          const zip = zipSync(
            Object.fromEntries(files.map((f) => [f.name, new TextEncoder().encode(f.content)])),
          );
          return [
            {
              name: `legoPlates_${params.platesX}_${params.platesY}_per-plate.zip`,
              mime: 'application/zip',
              data: zip,
            },
          ];
        }
        return files.map((f) => ({ name: f.name, mime: 'text/csv', data: f.content }));
      }
      case 'bricklink': {
        let xml = brickLinkXml(withSpares(packing, spares));
        if (greyPlates)
          xml = xml.replace(
            new RegExp(`(<ITEMID>${BASEPLATE.id}</ITEMID>\\n\\s*<COLOR>)1(</COLOR>)`),
            `$1${COLOR_LBG.bricklink}$2`,
          );
        return [{ name: `${base}-bricklink.xml`, mime: 'application/xml', data: xml }];
      }
      case 'rebrickable': {
        let csv = rebrickableCsv(withSpares(packing, spares));
        if (greyPlates)
          csv = csv.replace(
            new RegExp(`^${BASEPLATE.id},15,`, 'm'),
            `${BASEPLATE.id},${COLOR_LBG.rebrickable},`,
          );
        return [{ name: `${base}-rebrickable.csv`, mime: 'text/csv', data: csv }];
      }
      case 'ldraw':
        return [
          {
            name: `${base}.ldr`,
            mime: 'application/x-ldraw',
            data: ldrawModel(packing, params.platesY, { title }),
          },
        ];
      case 'ldraw-mpd':
        return [
          {
            name: `${base}.mpd`,
            mime: 'application/x-multipart-ldraw',
            data: ldrawMpd(packing, params.platesY, { title }),
          },
        ];
      case 'project': {
        const inputs = this.files ? await hashInputs(this.files) : [];
        const p = createProject({
          inputs,
          importOptions: this.importOptions as Record<string, unknown>,
          area,
          params,
          inventory,
          heightMap: hm,
          title,
          ...(typeof options.demo === 'string'
            ? { demo: options.demo }
            : this.last.demo
              ? { demo: this.last.demo }
              : {}),
        });
        return [
          {
            name: options.fileBase ? `${base}.legonizer.json` : projectFileName(title),
            mime: 'application/json',
            data: serializeProject(p),
          },
        ];
      }
      case 'calque-png': {
        const dpi = typeof options.dpi === 'number' ? options.dpi : 150;
        const style = { plateGrid: options.plateGrid === true, labels: options.labels === true };
        return [
          {
            name: `${base}-projection-${Math.round(dpi)}dpi.png`,
            mime: 'image/png',
            data: calquePng(hm, dpi, style),
          },
        ];
      }
      case 'calque-jpeg': {
        const style = { plateGrid: options.plateGrid === true, labels: options.labels === true };
        return [{ name: LEGACY_CALQUE_NAME, mime: 'image/jpeg', data: legacyCalqueJpeg(hm, style) }];
      }
      case 'calque-preview': {
        // small PNG for the on-screen preview
        const longPlates = Math.max(params.platesX, params.platesY);
        const dpi = Math.max(5, Math.min(150, ((options.previewPx ?? 900) / (longPlates * 32)) * (25.4 / 8)));
        const style = { plateGrid: options.plateGrid === true, labels: options.labels === true };
        return [{ name: 'calque-preview.png', mime: 'image/png', data: calquePng(hm, dpi, style) }];
      }
      case 'plate-pass': {
        const plates =
          typeof options.plate === 'string' ? [options.plate] : packing.plates.map((p) => p.plate);
        return plates.map((name) => {
          const { col, southRow } = parsePlateName(name, params.platesY);
          const payload = encodePlatePass({
            plate: name,
            heights: plateHeights(hm, col, southRow),
            inventory,
            title,
          });
          const data =
            typeof options.baseUrl === 'string' ? platePassUrl(options.baseUrl, name, payload) : payload;
          return { name: `pass-${name}.txt`, mime: 'text/plain', data };
        });
      }
      case 'pdf': {
        const { renderPdfGuide } = await import('../export/pdfGuide.ts');
        const paper = options.paper === 'Letter' ? 'Letter' : 'A4';
        const inputs = this.files ? await hashInputs(this.files) : [];
        const pdf = await renderPdfGuide({
          title,
          heightMap: hm,
          packing,
          params,
          area,
          inventory: normalizeInventory(inventory),
          paper,
          sections: options.sections ?? {},
          messages: options.messages ?? {},
          locale: options.locale ?? 'en',
          date: options.date ?? new Date().toISOString(),
          presetName: options.presetName ?? '',
          differences: options.differences ?? [],
          ...(options.baseUrl ? { passBaseUrl: options.baseUrl } : {}),
          inputs,
          ...(this.mesh?.frame.crs ? { crs: this.mesh.frame.crs } : options.crs ? { crs: options.crs } : {}),
          spares,
          ...(signal ? { signal } : {}),
          ...(progress ? { progress } : {}),
        } satisfies PdfGuideInput);
        const suffix = options.sectionsName ? `-${options.sectionsName}` : '';
        return [{ name: `${base}-build-guide${suffix}-${paper}.pdf`, mime: 'application/pdf', data: pdf }];
      }
      case 'all': {
        // Download everything (.zip): README + every export
        const out: Record<string, Uint8Array> = {};
        const add = (files: ExportFile[]) => {
          for (const f of files)
            out[f.name] = typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data;
        };
        const sub = (k: string, o: ExportOptions = {}) => this.export(k, { ...options, ...o });
        const steps: [string, ExportOptions?][] = [
          ['csv'],
          ['bricklink'],
          ['rebrickable'],
          ['ldraw'],
          ['project'],
          ['calque-jpeg', { plateGrid: options.plateGrid ?? true, labels: options.labels ?? true }],
          ['pdf'],
        ];
        for (let k = 0; k < steps.length; k++) {
          if (signal?.aborted) throw new EngineError('cancelled', 'Operation cancelled');
          const [kk, o] = steps[k]!;
          add(await sub(kk, o));
          progress?.('zip', (k + 1) / (steps.length + 1), kk);
        }
        if (typeof options.readme === 'string') out['README.txt'] = new TextEncoder().encode(options.readme);
        const zip = zipSync(out, { level: 6 });
        progress?.('zip', 1);
        return [{ name: `${base}-legonizer.zip`, mime: 'application/zip', data: zip }];
      }
      default:
        throw new EngineError('invalid-params', `Unknown export ${kind}`);
    }
  }

  meshPreview(): MeshPreview {
    const mesh = this.requireMesh();
    const idx = getMeshIndex(mesh);
    const b = mesh.bounds;
    const origin: [number, number, number] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
    const positions = new Float32Array(idx.triCount * 9);
    const w = new Float64Array(3);
    for (let t = 0; t < idx.triCount; t++) {
      for (let k = 0; k < 3; k++) {
        worldVertex(mesh, idx, t, k, w);
        positions[t * 9 + k * 3] = w[0]! - origin[0];
        positions[t * 9 + k * 3 + 1] = w[1]! - origin[1];
        positions[t * 9 + k * 3 + 2] = w[2]! - origin[2];
      }
    }
    return { origin, positions, triFeature: Int32Array.from(idx.triFeature) };
  }
}

/** Legacy calque size in pixels (for the UI's file line). */
export function calqueSizes(hm: HeightMap, dpi: number) {
  const l = legacyCalqueLayout(hm);
  const p = physicalCalqueLayout(hm, dpi);
  return { jpeg: [l.width, l.height], png: [p.width, p.height] };
}

type Post = (msg: EngineResponse, transfer?: Transferable[]) => void;

function transferables(result: unknown): Transferable[] {
  const out: Transferable[] = [];
  const seen = new Set<ArrayBufferLike>();
  const visit = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 4) return;
    if (ArrayBuffer.isView(v)) {
      if (
        v.buffer instanceof ArrayBuffer &&
        !seen.has(v.buffer) &&
        v.byteOffset === 0 &&
        v.byteLength === v.buffer.byteLength
      ) {
        seen.add(v.buffer);
        out.push(v.buffer);
      }
      return;
    }
    if (Array.isArray(v)) {
      if (v.length < 64) for (const x of v) visit(x, depth + 1);
      return;
    }
    for (const x of Object.values(v)) visit(x, depth + 1);
  };
  visit(result, 0);
  return out;
}

/** Creates the message handler of the engine Worker. */
export function createEngineHost(post: Post, engine = new Engine()) {
  const running = new Map<number, AbortController>();
  let queue: Promise<void> = Promise.resolve();

  const run = async (msg: Exclude<EngineRequest, { type: 'cancel' }>) => {
    const ctrl = running.get(msg.id)!;
    const progress: ProgressFn = (stage, fraction, detail) =>
      post({ id: msg.id, type: 'progress', stage, fraction, ...(detail ? { detail } : {}) });
    try {
      if (ctrl.signal.aborted) throw new EngineError('cancelled', 'Operation cancelled');
      let result: unknown;
      switch (msg.type) {
        case 'import':
          result = engine.import(msg.files, msg.options, progress);
          break;
        case 'import-url': {
          const files = await fetchTilesetFiles(msg.url, { signal: ctrl.signal, progress });
          result = engine.import(
            [...files].map(([path, data]) => ({ path, data })),
            msg.options,
            progress,
          );
          break;
        }
        case 'reimport':
          result = engine.reimport(msg.options ?? {}, progress);
          break;
        case 'estimate':
          result = engine.estimate(msg.area, msg.params);
          break;
        case 'generate': {
          const r = await engine.generate(
            msg.area,
            msg.params,
            msg.inventory,
            msg.beamWidth,
            ctrl.signal,
            progress,
          );
          // the engine keeps its copy for exports: send a copy of the height data
          result = {
            ...r,
            heightmap: {
              ...r.heightmap,
              heightMap: { ...r.heightmap.heightMap, data: r.heightmap.heightMap.data.slice() },
            },
          };
          break;
        }
        case 'pack':
          result = await engine.pack(msg.heightMap, msg.inventory, msg.beamWidth, ctrl.signal, progress);
          break;
        case 'restore':
          result = await engine.restore(
            msg.area,
            msg.params,
            msg.heightMap,
            msg.inventory ?? {},
            ctrl.signal,
            progress,
          );
          break;
        case 'open-project':
          result = await engine.openProject(msg.text, ctrl.signal, progress);
          break;
        case 'plan-raster':
          result = engine.planRaster(msg.request);
          break;
        case 'export':
          result = await engine.export(msg.kind, msg.options, ctrl.signal, progress);
          break;
        case 'mesh-preview':
          result = engine.meshPreview();
          break;
      }
      post(
        { id: msg.id, type: 'result', result },
        msg.type === 'generate' ||
          msg.type === 'mesh-preview' ||
          msg.type === 'export' ||
          msg.type === 'plan-raster' ||
          msg.type === 'estimate'
          ? transferables(result)
          : [],
      );
    } catch (e) {
      const err = e as EngineError;
      post({
        id: msg.id,
        type: 'error',
        code: err instanceof EngineError ? err.code : 'internal',
        message: err?.message ?? String(e),
        ...(err instanceof EngineError && err.details ? { details: err.details } : {}),
      });
    } finally {
      running.delete(msg.id);
    }
  };

  return {
    engine,
    onMessage(msg: EngineRequest): Promise<void> {
      if (msg.type === 'cancel') {
        running.get(msg.target)?.abort();
        return Promise.resolve();
      }
      running.set(msg.id, new AbortController());
      queue = queue.then(() => run(msg));
      return queue;
    },
  };
}
