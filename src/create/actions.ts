/**
 * Wizard flows (ux-spec §5): import (files, folder, zip, demo, URL, project file), live estimates,
 * generation with progress and cancel, re-packing, restore after a reload, exports.
 */
import { t } from '../shared/i18n.ts';
import type { DemoManifest } from '../core/samples/manifest.ts';
import type {
  ExportFile,
  ExportKind,
  ExportOptions,
  MeshSummary,
  WireFile,
} from '../core/worker/protocol.ts';
import type { Area, Params } from '../core/types.ts';
import { type EngineService, errorCode, errorText, isCancel, isOutOfMemory } from './engine.ts';
import { announce, debounce, downloadBlob, toast } from './dom.ts';
import { clearAll, clearFiles, loadFiles, saveFiles } from './persist.ts';
import {
  ALL_PART_IDS,
  emptyProject,
  emptyTransient,
  sourceKey,
  type ImportOptionsState,
  type ProjectState,
  type SourceInfo,
  type Store,
  type Transient,
} from './state.ts';
import { n } from './format.ts';

export const DEMO_IDS = ['part-dieu', 'sample'] as const;
export type DemoId = (typeof DEMO_IDS)[number];

/** Demo manifests found on this copy of the site (a card shows only when its manifest exists). */
export async function loadDemoManifests(): Promise<Partial<Record<DemoId, DemoManifest>>> {
  const out: Partial<Record<DemoId, DemoManifest>> = {};
  await Promise.all(
    DEMO_IDS.map(async (id) => {
      try {
        const r = await fetch(`data/demo/${id}/manifest.json`, { cache: 'no-cache' });
        if (!r.ok) return;
        const m = (await r.json()) as DemoManifest;
        if (m && m.id === id && m.archive) out[id] = m;
      } catch {
        // not deployed
      }
    }),
  );
  return out;
}

async function fetchBytes(
  url: string,
  onProgress?: (f: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const r = await fetch(url, signal ? { signal } : {});
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const total = Number(r.headers.get('content-length')) || 0;
  if (!r.body || !total) return new Uint8Array(await r.arrayBuffer());
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Overlap test between the current area and new model bounds (keep the area on replace, §4.3). */
function areaOverlaps(area: Area, params: Params, s: MeshSummary): boolean {
  const half = (Math.max(params.platesX, params.platesY) * 32 * params.scale) / 2;
  const b = s.bounds;
  return (
    area.cx + half >= b.min[0] &&
    area.cx - half <= b.max[0] &&
    area.cy + half >= b.min[1] &&
    area.cy - half <= b.max[1]
  );
}

export class Actions {
  /** Input files of the current model, kept for re-imports (unit change, missing files, restart). */
  files: WireFile[] | null = null;
  demos: Partial<Record<DemoId, DemoManifest>> = {};
  private importJob: { cancel(): void } | null = null;
  private genJob: { id: number; cancel(): void; done: boolean } | null = null;
  private estimateJob: { cancel(): void } | null = null;
  private importToken = 0;
  /** Called when a step should be shown (e.g. after a demo loads). */
  onNavigate: ((step: ProjectState['ui']['step'], focus?: boolean) => void) | null = null;

  private readonly store: Store;
  private readonly engine: EngineService;

  constructor(store: Store, engine: EngineService) {
    this.store = store;
    this.engine = engine;
    engine.onRestart = () => {
      store.setT({ engineReady: false, engineResult: false });
    };
  }

  // ================================================================== import

  async importDemo(id: DemoId): Promise<void> {
    const m = this.demos[id];
    if (!m) {
      toast(t('create.import.demo.unavailable'), { icon: 'warning' });
      return;
    }
    const token = ++this.importToken;
    const ctrl = new AbortController();
    const title =
      id === 'part-dieu' ? t('create.import.demo.partDieu.title') : t('create.import.demo.sample.title');
    this.store.setT({
      importing: {
        name: title,
        stage: 'reading',
        done: 0,
        total: 0,
        fraction: 0,
        started: performance.now(),
      },
      importIssue: null,
    });
    this.importJob = { cancel: () => ctrl.abort() };
    try {
      const data = await fetchBytes(
        `data/demo/${id}/${m.archive}`,
        (f) => this.progressImport({ stage: 'reading', fraction: f * 0.3 }),
        ctrl.signal,
      );
      if (token !== this.importToken) return;
      const files = [{ path: m.archive, data }];
      const source: SourceInfo = {
        kind: 'demo',
        label: title,
        demoId: id,
        fileNames: [m.archive],
        bytes: data.length,
        stored: false,
      };
      const summary = await this.runImport(files, source, {}, token);
      if (!summary) return;
      // demo: curated area and suggested settings (I10, OI-1)
      const sug = m.suggested.params;
      this.store.set({
        area: { ...m.defaultArea.area },
        areaOrigin: id === 'part-dieu' ? 'demo' : 'default',
        params: { ...sug, platesX: m.defaultArea.platesX, platesY: m.defaultArea.platesY },
        demoSettings: JSON.stringify(sug) !== JSON.stringify(m.suggested.strictLegacy),
        name: this.store.p.nameEdited ? this.store.p.name : title,
      });
      this.onNavigate?.('area', true);
    } catch (e) {
      if (token !== this.importToken) return;
      if ((e as Error).name === 'AbortError') return;
      this.importFailed(e, title);
    }
  }

  async importFiles(files: WireFile[], label: string, opts: ImportOptionsState = {}): Promise<void> {
    const token = ++this.importToken;
    this.store.setT({
      importing: {
        name: label,
        stage: 'reading',
        done: 0,
        total: 0,
        fraction: 0,
        started: performance.now(),
      },
      importIssue: null,
      largeAck: false,
    });
    const bytes = files.reduce((a, f) => a + f.data.length, 0);
    const source: SourceInfo = {
      kind: 'files',
      label,
      fileNames: files.map((f) => f.path),
      bytes,
      stored: false,
    };
    const summary = await this.runImport(files, source, opts, token);
    if (!summary) return;
    if (!this.store.p.nameEdited)
      this.store.set({ name: label.replace(/\.(zip|glb|gltf|obj|json|city\.json|jsonl)$/i, '') });
    // keep the files for a reload (ux-spec §4.3), when they fit
    void saveFiles(files).then((stored) => {
      if (this.store.p.source && this.store.p.source.label === label)
        this.store.set({ source: { ...this.store.p.source, stored } });
    });
  }

  async importUrl(url: string): Promise<void> {
    const token = ++this.importToken;
    const label = url.split('/').slice(-2, -1)[0] || url;
    this.store.setT({
      importing: {
        name: label,
        stage: 'downloading',
        done: 0,
        total: 0,
        fraction: 0,
        started: performance.now(),
      },
      importIssue: null,
    });
    const job = this.engine.request(
      'import-url',
      { url },
      { onProgress: (s, f, d) => this.onImportProgress(s, f, d) },
    );
    this.importJob = job;
    try {
      const summary = await job.promise;
      if (token !== this.importToken) return;
      this.files = null;
      this.afterImport(
        summary,
        { kind: 'url', label, url, fileNames: [url], bytes: summary.inputBytes, stored: false },
        {},
      );
    } catch (e) {
      if (token !== this.importToken || isCancel(e)) return;
      const msg = errorText(e);
      const cors = /Failed to fetch|NetworkError|CORS|Load failed/i.test(msg);
      this.store.setT({
        importing: null,
        importIssue: {
          kind: 'error',
          title: cors ? t('create.import.errors.cors.title') : t('create.import.errors.network.title'),
          body: cors ? t('create.import.errors.cors.body') : t('create.import.errors.network.body'),
          details: msg,
          action: 'cors',
        },
      });
      announce(
        cors ? t('create.import.errors.cors.title') : t('create.import.errors.network.title'),
        'assertive',
      );
    }
  }

  private progressImport(p: Partial<NonNullable<Transient['importing']>>) {
    const cur = this.store.t.importing;
    if (!cur) return;
    this.store.setT({ importing: { ...cur, ...p } });
  }

  private tileEvents = 0;
  private onImportProgress(stage: string, fraction: number, _detail?: string) {
    const cur = this.store.t.importing;
    if (!cur) return;
    if (stage === 'download') {
      this.progressImport({ stage: 'downloading', fraction: 0.3 * fraction });
    } else if (stage === 'import') {
      if (fraction > 0) this.tileEvents++;
      const total = fraction > 0 ? Math.max(1, Math.round(this.tileEvents / fraction)) : 0;
      const tiles = this.store.t.importing?.name && total > 1;
      this.progressImport({
        stage: tiles ? 'tiles' : 'model',
        done: this.tileEvents,
        total,
        fraction: 0.3 + 0.5 * fraction,
      });
    } else if (stage === 'index') {
      this.progressImport({ stage: 'features', fraction: 0.8 + 0.15 * fraction });
    }
  }

  /** Sends files to the Worker; returns the summary, or null on error / cancel / superseded. */
  private async runImport(
    files: WireFile[],
    source: SourceInfo,
    opts: ImportOptionsState,
    token: number,
  ): Promise<MeshSummary | null> {
    this.tileEvents = 0;
    const job = this.engine.request(
      'import',
      { files, options: opts },
      { onProgress: (s, f, d) => this.onImportProgress(s, f, d) },
    );
    this.importJob = job;
    try {
      const summary = await job.promise;
      if (token !== this.importToken) return null;
      this.files = files;
      this.afterImport(summary, source, opts);
      return summary;
    } catch (e) {
      if (token !== this.importToken || isCancel(e)) return null;
      const code = errorCode(e);
      if (code === 'missing-files') {
        const missing = ((e as { details?: { missing?: string[] } }).details?.missing ?? []) as string[];
        const tileFiles = files.filter((f) => /\.(b3dm|glb|gltf|cmpt|json)$/i.test(f.path)).length;
        if (missing.length && tileFiles > 1) {
          this.files = files;
          this.pendingSource = source;
          this.store.setT({
            importing: null,
            importIssue: { kind: 'partial', missing, total: missing.length + Math.max(0, tileFiles - 1) },
          });
          announce(
            t('create.import.partial.title', {
              loaded: Math.max(0, tileFiles - 1),
              total: missing.length + Math.max(0, tileFiles - 1),
            }),
          );
          return null;
        }
      }
      this.importFailed(e, source.label);
      return null;
    }
  }

  /** Source waiting for a decision (partial import). */
  pendingSource: SourceInfo | null = null;

  async continueWithoutMissing(): Promise<void> {
    if (!this.files || !this.pendingSource) return;
    const token = ++this.importToken;
    const src = this.pendingSource;
    this.store.setT({
      importing: {
        name: src.label,
        stage: 'reading',
        done: 0,
        total: 0,
        fraction: 0,
        started: performance.now(),
      },
      importIssue: null,
    });
    const s = await this.runImport(
      this.files,
      src,
      { ...this.store.p.importOptions, ignoreMissing: true },
      token,
    );
    if (s) void saveFiles(this.files);
  }

  async addMissingFiles(extra: WireFile[]): Promise<void> {
    if (!this.files || !this.pendingSource) return;
    const merged = [...this.files];
    for (const f of extra) {
      const i = merged.findIndex(
        (m) => m.path === f.path || m.path.endsWith('/' + f.path) || f.path.endsWith('/' + m.path),
      );
      if (i >= 0) merged[i] = f;
      else {
        // put loose tiles next to the tileset (same folder)
        const ts = merged.find((m) => /(^|\/)tileset\.json$/i.test(m.path));
        const dir = ts ? ts.path.replace(/tileset\.json$/i, '') : '';
        const missing = this.store.t.importIssue?.kind === 'partial' ? this.store.t.importIssue.missing : [];
        const target = missing.find((p) => p.split('/').pop() === f.path.split('/').pop());
        merged.push({ path: target ?? dir + f.path, data: f.data });
      }
    }
    const src = {
      ...this.pendingSource,
      fileNames: merged.map((f) => f.path),
      bytes: merged.reduce((a, f) => a + f.data.length, 0),
    };
    const token = ++this.importToken;
    this.store.setT({
      importing: {
        name: src.label,
        stage: 'reading',
        done: 0,
        total: 0,
        fraction: 0,
        started: performance.now(),
      },
      importIssue: null,
    });
    const s = await this.runImport(merged, src, this.store.p.importOptions, token);
    if (s) void saveFiles(merged);
  }

  private afterImport(summary: MeshSummary, source: SourceInfo, opts: ImportOptionsState) {
    const p = this.store.p;
    const keepArea = p.area && areaOverlaps(p.area, p.params, summary) && p.source !== null;
    const def = summary.defaultArea;
    const whole = def.platesX !== 2 || def.platesY !== 2 || summary.size[0] <= 2 * 96;
    this.pendingSource = null;
    this.store.set({
      source,
      summary,
      importOptions: opts,
      guideOnly: false,
      result: null,
      demoSettings: false,
      progress: { built: {}, teams: {}, current: null },
      ...(keepArea
        ? {}
        : {
            area: { ...def.area },
            areaOrigin: whole ? 'whole' : 'default',
            params: { ...p.params, platesX: def.platesX, platesY: def.platesY },
          }),
    });
    this.store.setT({
      importing: {
        ...(this.store.t.importing ?? { name: source.label, done: 0, total: 0, started: performance.now() }),
        stage: 'preparing',
        fraction: 0.97,
      },
      importIssue: null,
      engineReady: true,
      engineResult: false,
      estimate: null,
      largeAck: false,
    });
    // the viewport finishes "Preparing the 3D view" and clears `importing`
    setTimeout(() => {
      if (this.store.t.importing?.stage === 'preparing') this.store.setT({ importing: null });
    }, 50);
    const size = `${n(summary.size[0] / (summary.size[0] >= 1000 ? 1000 : 1), 1)} × ${n(summary.size[1] / (summary.size[1] >= 1000 ? 1000 : 1), 1)} ${summary.size[0] >= 1000 ? 'km' : 'm'}`;
    announce(
      t('create.import.success.announce', {
        buildings: t('create.import.success.buildings', { count: summary.stats.features }),
        size,
      }),
    );
    this.scheduleEstimate();
  }

  private importFailed(e: unknown, name: string) {
    const code = errorCode(e);
    const msg = errorText(e);
    let title = t('create.import.errors.generic.title');
    let body = t('create.import.errors.generic.body');
    let action: 'citygml' | 'oom' | undefined;
    if (isOutOfMemory(e)) {
      title = t('create.import.errors.outOfMemory.title');
      body = t('create.import.errors.outOfMemory.body');
      action = 'oom';
    } else if (code === 'unsupported-format') {
      const files = this.lastAttempt ?? [];
      if (files.some((f) => /\.gml$/i.test(f))) {
        title = t('create.import.errors.citygml.title');
        body = t('create.import.errors.citygml.body');
        action = 'citygml';
      } else {
        const ext =
          [...new Set(files.map((f) => (f.includes('.') ? '.' + f.split('.').pop() : f)))].join(', ') || name;
        title = t('create.import.errors.unsupported.title');
        body = t('create.import.errors.unsupported.body', { ext });
      }
    } else if (code === 'empty-geometry' || code === 'no-features') {
      title = t('create.import.errors.emptyGeometry.title');
      body = t('create.import.errors.emptyGeometry.body');
    } else if (code === 'missing-files') {
      title = t('create.import.errors.noTilesFound.title');
      body = t('create.import.errors.noTilesFound.body');
    } else if (code === 'invalid-file') {
      if (/version/i.test(msg) && /cityjson/i.test(msg)) {
        title = t('create.import.errors.cityjsonVersion.title');
        body = t('create.import.errors.cityjsonVersion.body', {
          version: (/\d+\.\d+/.exec(msg) ?? ['?'])[0],
        });
      } else {
        title = t('create.import.errors.corrupt.title');
        body = t('create.import.errors.corrupt.body', { file: name });
      }
    } else if (code === 'unsupported-feature') {
      title = t('create.import.errors.generic.title');
      body = msg.replace(/^EngineRequestError: /, '');
    }
    this.store.setT({
      importing: null,
      importIssue: { kind: 'error', title, body, details: msg, ...(action ? { action } : {}) },
    });
    announce(title, 'assertive');
  }

  lastAttempt: string[] | null = null;

  cancelImport(): void {
    this.importToken++;
    this.importJob?.cancel();
    this.importJob = null;
    // parsing is not interruptible: restart the Worker, then bring the previous model back
    this.engine.restart();
    this.store.setT({ importing: null });
    toast(t('create.import.loading.cancelled'));
    announce(t('create.import.loading.cancelled'));
    void this.ensureEngineModel();
  }

  /** Re-import the current files with other options (unit, up axis, LoD): I6, I5. */
  async reimport(opts: ImportOptionsState): Promise<void> {
    const p = this.store.p;
    if (!p.source) return;
    const merged = { ...p.importOptions, ...opts };
    const token = ++this.importToken;
    this.store.setT({
      importing: {
        name: p.source.label,
        stage: 'model',
        done: 0,
        total: 0,
        fraction: 0.4,
        started: performance.now(),
      },
    });
    const job = this.engine.request('reimport', { options: merged });
    this.importJob = job;
    try {
      const summary = await job.promise;
      if (token !== this.importToken) return;
      this.store.set({ summary, importOptions: merged, result: null });
      const def = summary.defaultArea;
      this.store.set({
        area: { ...def.area },
        areaOrigin: 'default',
        params: { ...p.params, platesX: def.platesX, platesY: def.platesY },
      });
      this.store.setT({ importing: null, engineResult: false, estimate: null });
      this.scheduleEstimate();
    } catch (e) {
      if (token !== this.importToken || isCancel(e)) return;
      this.importFailed(e, p.source.label);
    }
  }

  // ================================================================== project file (O9)

  async openProjectFile(file: File): Promise<boolean> {
    const text = new TextDecoder().decode(new Uint8Array(await file.arrayBuffer()));
    try {
      const r = await this.engine.request('open-project', { text }).promise;
      const proj = r.project;
      const base = emptyProject();
      this.files = null;
      this.store.set({
        ...base,
        name: proj.title ?? file.name.replace(/\.legonizer\.json$/i, ''),
        nameEdited: !!proj.title,
        source: null,
        summary: null,
        guideOnly: true,
        area: proj.area,
        areaOrigin: 'user',
        params: proj.params,
        inventory: { enabled: proj.inventory.enabled, maxLength: proj.inventory.maxLength },
        result: {
          area: proj.area,
          params: proj.params,
          sourceKey: 'project',
          heightMap: r.heightMap,
          packing: r.packing,
          meta: null,
          durationMs: 0,
          generatedAt: Date.parse(proj.createdAt) || Date.now(),
        },
        ui: { ...this.store.p.ui, step: 'guide' },
      });
      this.store.setT({
        ...emptyTransient(),
        webgl: this.store.t.webgl,
        engineReady: false,
        engineResult: true,
      });
      void clearFiles();
      toast(t('create.project.openFile.opened'), { icon: 'check-circle' });
      const v = proj.app?.version;
      if (v && v !== '0.1.0')
        toast(t('create.project.openFile.olderVersion', { version: v, current: '0.1.0' }));
      this.onNavigate?.('guide', true);
      return true;
    } catch (e) {
      this.store.setT({
        importIssue: {
          kind: 'error',
          title: t('create.import.errors.invalidProject.title'),
          body: t('create.import.errors.invalidProject.body'),
          details: errorText(e),
        },
      });
      announce(t('create.import.errors.invalidProject.title'), 'assertive');
      return false;
    }
  }

  // ================================================================== restore after reload

  /** Makes sure the Worker holds the model (and the result) of the current project. */
  async ensureEngineModel(): Promise<void> {
    const p = this.store.p;
    if (this.store.t.engineReady && (this.store.t.engineResult || !p.result)) return;
    const gen = this.engine.generation;
    try {
      if (!this.store.t.engineReady && p.source) {
        let files: WireFile[] | null = this.files;
        if (!files && p.source.kind === 'demo' && p.source.demoId) {
          if (!Object.keys(this.demos).length) this.demos = await loadDemoManifests();
          const m = this.demos[p.source.demoId as DemoId];
          if (m) files = [{ path: m.archive, data: await fetchBytes(`data/demo/${m.id}/${m.archive}`) }];
        } else if (!files && p.source.kind === 'files' && p.source.stored) {
          files = await loadFiles();
        }
        if (files) {
          const summary = await this.engine.request('import', { files, options: p.importOptions }).promise;
          if (gen !== this.engine.generation) return;
          this.files = files;
          this.store.set({ summary });
          this.store.setT({ engineReady: true, engineResult: false });
        } else if (p.source.kind === 'url' && p.source.url) {
          const summary = await this.engine.request('import-url', {
            url: p.source.url,
            options: p.importOptions,
          }).promise;
          if (gen !== this.engine.generation) return;
          this.store.set({ summary });
          this.store.setT({ engineReady: true, engineResult: false });
        }
      }
      const r = this.store.p.result;
      if (r && !this.store.t.engineResult) {
        const packing = await this.engine.request('restore', {
          area: r.area,
          params: r.params,
          heightMap: r.heightMap,
          inventory: this.store.p.inventory,
        }).promise;
        if (gen !== this.engine.generation) return;
        this.store.set({ result: { ...r, packing } });
        this.store.setT({ engineResult: true });
      }
      if (this.store.t.engineReady) this.scheduleEstimate();
    } catch (e) {
      console.warn('[legonizer] could not restore the model', e);
    }
  }

  // ================================================================== estimate (§6.2.3)

  scheduleEstimate = debounce(() => void this.runEstimate(), 120);
  private estimateTimer = 0;

  private async runEstimate(): Promise<void> {
    const p = this.store.p;
    if (!p.area || !p.summary || !this.store.t.engineReady) return;
    this.estimateJob?.cancel();
    clearTimeout(this.estimateTimer);
    this.estimateTimer = window.setTimeout(() => this.store.setT({ estimating: true }), 300);
    const job = this.engine.request('estimate', { area: p.area, params: p.params });
    this.estimateJob = job;
    try {
      const est = await job.promise;
      if (this.estimateJob !== job) return;
      clearTimeout(this.estimateTimer);
      this.store.setT({ estimate: est, estimating: false });
    } catch (e) {
      clearTimeout(this.estimateTimer);
      if (!isCancel(e)) this.store.setT({ estimating: false });
    }
  }

  // ================================================================== generate (§6.3)

  async generate(): Promise<void> {
    const p = this.store.p;
    if (!p.area || this.store.t.generating) return;
    if (!this.store.t.engineReady) await this.ensureEngineModel();
    if (!this.store.t.engineReady) return;
    const started = performance.now();
    this.store.setT({
      generating: {
        started,
        stage: 'select',
        rows: [0, p.params.platesY * 32],
        plates: [0, p.params.platesX * p.params.platesY],
        fraction: 0,
        visible: false,
      },
      generateError: null,
    });
    const showTimer = window.setTimeout(() => {
      const g = this.store.t.generating;
      if (g) this.store.setT({ generating: { ...g, visible: true } });
    }, 400);
    let lastAnnounced = 0;
    const area = { ...p.area },
      params = { ...p.params };
    const job = this.engine.request(
      'generate',
      { area, params, inventory: p.inventory },
      {
        onProgress: (stage, f, detail) => {
          const g = this.store.t.generating;
          if (!g) return;
          let next = { ...g };
          if (stage === 'heightmap') {
            next = {
              ...next,
              stage: 'sample',
              rows: [Math.round(f * g.rows[1]), g.rows[1]],
              fraction: Math.max(g.fraction, 0.05 + 0.7 * f),
            };
          } else if (stage === 'packing') {
            next = {
              ...next,
              stage: 'pack',
              plates: [Math.round(f * g.plates[1]), g.plates[1]],
              fraction: Math.max(g.fraction, 0.8 + 0.2 * f),
            };
            void detail;
          }
          const pct = Math.floor(next.fraction * 4);
          if (pct > lastAnnounced && next.visible) {
            lastAnnounced = pct;
            announce(t('a11y.announce.generationProgress', { percent: pct * 25 }));
          }
          this.store.setT({ generating: next });
        },
      },
    );
    this.genJob = { id: job.id, cancel: job.cancel, done: false };
    try {
      const r = await job.promise;
      clearTimeout(showTimer);
      this.genJob.done = true;
      const { heightMap, ...meta } = r.heightmap;
      const durationMs = performance.now() - started;
      this.store.set({
        result: {
          area,
          params,
          sourceKey: sourceKey(this.store.p),
          heightMap,
          packing: r.packing,
          meta,
          durationMs,
          generatedAt: Date.now(),
        },
        progress: { built: {}, teams: this.store.p.progress.teams, current: null },
      });
      this.store.setT({ generating: null, engineResult: true });
      if (document.hidden) {
        const prev = document.title;
        document.title = t('create.generate.running.documentTitleReady');
        const back = () => {
          if (!document.hidden) {
            document.title = prev;
            document.removeEventListener('visibilitychange', back);
          }
        };
        document.addEventListener('visibilitychange', back);
      }
      announce(t('create.generate.done.announce', { bricks: n(r.packing.total) }));
    } catch (e) {
      clearTimeout(showTimer);
      if (this.genJob) this.genJob.done = true;
      if (isCancel(e)) return;
      const oom = isOutOfMemory(e);
      this.store.setT({
        generating: null,
        generateError: {
          title: oom
            ? t('create.generate.errors.outOfMemory.title')
            : t('create.generate.errors.worker.title'),
          body: oom ? t('create.generate.errors.outOfMemory.body') : t('create.generate.errors.worker.body'),
          details: errorText(e),
          oom,
        },
      });
      announce(t('a11y.announce.generationFailed', { reason: errorText(e) }), 'assertive');
      if (oom) this.engine.restart();
    }
  }

  cancelGenerate(): void {
    const job = this.genJob;
    if (!job || job.done) return;
    job.cancel();
    this.store.setT({ generating: null });
    toast(t('create.generate.running.cancelled'));
    announce(t('create.generate.running.cancelled'));
    // the BVH build cannot be interrupted: if the Worker does not answer quickly, restart it
    const gen = this.engine.generation;
    window.setTimeout(() => {
      if (!job.done && gen === this.engine.generation) {
        this.engine.restart();
        void this.ensureEngineModel();
      }
    }, 250);
  }

  /** Undo changes (G4): back to the values the result was generated with. */
  undoChanges(): void {
    const r = this.store.p.result;
    if (!r) return;
    this.store.set({ area: { ...r.area }, params: { ...r.params } });
    this.scheduleEstimate();
  }

  // ================================================================== re-pack (§6.5)

  private repackJob: { cancel(): void } | null = null;
  scheduleRepack = debounce(() => void this.repack(), 300);

  async repack(): Promise<void> {
    const r = this.store.p.result;
    if (!r) return;
    this.repackJob?.cancel();
    this.store.setT({ repacking: true });
    const job = this.engine.request('pack', { heightMap: r.heightMap, inventory: this.store.p.inventory });
    this.repackJob = job;
    try {
      const packing = await job.promise;
      if (this.repackJob !== job) return;
      const cur = this.store.p.result;
      if (cur) this.store.set({ result: { ...cur, packing } });
      this.store.setT({ repacking: false, engineResult: true });
      announce(t('create.guide.bricks.settings.announceUpdated', { bricks: n(packing.total) }));
    } catch (e) {
      if (!isCancel(e)) this.store.setT({ repacking: false });
    }
  }

  // ================================================================== exports (§6.6)

  async exportFiles(
    kind: ExportKind,
    options: ExportOptions = {},
    onProgress?: (f: number, d?: string) => void,
  ): Promise<ExportFile[]> {
    if (!this.store.t.engineResult) await this.ensureEngineModel();
    const p = this.store.p;
    const job = this.engine.request(
      'export',
      {
        kind,
        options: {
          title: p.name || 'Legonizer',
          fileBase: p.name || 'legonizer',
          spares: p.spares,
          baseplateColour: p.baseplateColour,
          ...(p.source?.demoId ? { demo: p.source.demoId } : {}),
          ...options,
        },
      },
      onProgress ? { onProgress: (_s, f, d) => onProgress(f, d) } : {},
    );
    this.currentExport = job;
    try {
      return await job.promise;
    } finally {
      if (this.currentExport === job) this.currentExport = null;
    }
  }
  currentExport: { cancel(): void } | null = null;

  async download(
    kind: ExportKind,
    options: ExportOptions = {},
    onProgress?: (f: number, d?: string) => void,
  ): Promise<string[]> {
    const files = await this.exportFiles(kind, options, onProgress);
    for (const f of files) downloadBlob(f.data, f.name, f.mime);
    return files.map((f) => f.name);
  }

  // ================================================================== project lifecycle

  async newProject(): Promise<void> {
    this.importToken++;
    this.files = null;
    this.engine.restart();
    await clearAll();
    const webgl = this.store.t.webgl;
    this.store.p = emptyProject();
    this.store.set({});
    this.store.setT({ ...emptyTransient(), webgl });
    this.onNavigate?.('import', true);
  }

  partIdsEnabled(): string[] {
    return this.store.p.inventory.enabled.length ? this.store.p.inventory.enabled : ALL_PART_IDS;
  }
}
