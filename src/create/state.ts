/**
 * Wizard state (SPEC §7): the persisted project (saved in IndexedDB, restored on reload) plus
 * transient UI state. A tiny observable store; steps subscribe and patch their own DOM.
 */
import type { HeightmapResult } from '../core/heightmap/index.ts';
import type { PackingResult } from '../core/packing/pack.ts';
import type { EstimateResult, MeshSummary } from '../core/worker/protocol.ts';
import type { TileCapMode } from '../core/packing/catalog.ts';
import { LEGACY_PRESET, defaultParams, type Area, type HeightMap, type Params } from '../core/types.ts';

export type StepId = 'import' | 'area' | 'settings' | 'generate' | 'guide';
export const STEPS: StepId[] = ['import', 'area', 'settings', 'generate', 'guide'];

export interface SourceInfo {
  kind: 'files' | 'demo' | 'url';
  /** Display name: file name, folder name, demo title. */
  label: string;
  demoId?: string;
  url?: string;
  fileNames: string[];
  bytes: number;
  /** The input files are kept in this browser (IndexedDB), so a reload can re-import them. */
  stored: boolean;
}

export interface ImportOptionsState {
  unit?: 'auto' | 'm' | 'cm' | 'mm' | 'ft';
  upAxis?: 'auto' | 'y' | 'z';
  maxLod?: number;
  ignoreMissing?: boolean;
}

export type ResultMeta = Omit<HeightmapResult, 'raw' | 'heightMap'>;

export interface ResultState {
  /** The inputs it was generated with (stale detection, G4). */
  area: Area;
  params: Params;
  sourceKey: string;
  heightMap: HeightMap;
  packing: PackingResult;
  meta: ResultMeta | null;
  durationMs: number;
  generatedAt: number;
}

export interface BuildProgress {
  /** Layers marked built per plate (0…layers). */
  built: Record<string, number>;
  teams: Record<string, string>;
  current: { plate: string; layer: number } | null;
}

export interface ProjectState {
  version: 1;
  name: string;
  nameEdited: boolean;
  source: SourceInfo | null;
  summary: MeshSummary | null;
  importOptions: ImportOptionsState;
  area: Area | null;
  /** Why the area is where it is (info line in step 2). */
  areaOrigin: 'default' | 'whole' | 'demo' | 'user' | null;
  params: Params;
  /** Part settings; `tileCap` = smooth tiles on top of the model (SPEC §7.5.1). */
  inventory: { enabled: string[]; maxLength: number; tileCap: TileCapMode };
  spares: 0 | 5 | 10;
  baseplateColour: 'white' | 'grey';
  result: ResultState | null;
  /** Opened from a project file without its source files (SPEC O9): the build guide only. */
  guideOnly: boolean;
  /** Demo suggested settings applied (SPEC I10: shows the note and the switch to strict Legacy). */
  demoSettings: boolean;
  progress: BuildProgress;
  checklist: { placed: boolean; aligned: boolean };
  ui: {
    step: StepId;
    disappearAck: boolean;
    keepGroundHintShown: boolean;
    shortcuts: boolean;
    belowMode: 'ghost' | 'solid' | 'hidden';
    paper: 'A4' | 'Letter';
  };
  savedAt: number | null;
}

export const ALL_PART_IDS = [
  '3005',
  '3004',
  '3622',
  '3010',
  '3009',
  '3008',
  '3003',
  '3002',
  '3001',
  '2456',
  '3007',
];

export function defaultPaper(): 'A4' | 'Letter' {
  // US Letter where it is the usual paper (US, Canada, Mexico, Philippines…), A4 elsewhere
  const l = (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en';
  return /-(US|CA|MX|PH|CL|CO|VE|PR)$/i.test(l) ? 'Letter' : 'A4';
}

export function emptyProject(): ProjectState {
  return {
    version: 1,
    name: '',
    nameEdited: false,
    source: null,
    summary: null,
    importOptions: {},
    area: null,
    areaOrigin: null,
    params: defaultParams(2, 2),
    inventory: { enabled: [...ALL_PART_IDS], maxLength: 8, tileCap: 'none' },
    spares: 0,
    baseplateColour: 'white',
    result: null,
    guideOnly: false,
    demoSettings: false,
    progress: { built: {}, teams: {}, current: null },
    checklist: { placed: false, aligned: false },
    ui: {
      step: 'import',
      disappearAck: false,
      keepGroundHintShown: false,
      shortcuts: true,
      belowMode: 'ghost',
      paper: defaultPaper(),
    },
    savedAt: null,
  };
}

/** Transient state: jobs, estimates, previews (never persisted). */
export interface Transient {
  importing: {
    name: string;
    stage: 'reading' | 'tiles' | 'model' | 'features' | 'preparing' | 'downloading';
    done: number;
    total: number;
    fraction: number;
    started: number;
  } | null;
  importIssue:
    | { kind: 'error'; title: string; body: string; details?: string; action?: 'citygml' | 'oom' | 'cors' }
    | { kind: 'partial'; missing: string[]; total: number }
    | null;
  largeAck: boolean;
  generating: {
    started: number;
    stage: 'select' | 'index' | 'sample' | 'quantize' | 'pack' | 'done';
    rows: [number, number];
    plates: [number, number];
    fraction: number;
    visible: boolean;
  } | null;
  generateError: { title: string; body: string; details: string; oom: boolean } | null;
  estimate: EstimateResult | null;
  estimating: boolean;
  repacking: boolean;
  /** Engine has the model loaded (false right after a reload until re-imported). */
  engineReady: boolean;
  /** Engine holds the current result (exports work). */
  engineResult: boolean;
  webgl: boolean;
  webglDismissed: boolean;
  stepFocusPending: boolean;
}

export function emptyTransient(): Transient {
  return {
    importing: null,
    importIssue: null,
    largeAck: false,
    generating: null,
    generateError: null,
    estimate: null,
    estimating: false,
    repacking: false,
    engineReady: false,
    engineResult: false,
    webgl: false,
    webglDismissed: false,
    stepFocusPending: false,
  };
}

type Listener = (p: ProjectState, t: Transient, changed: Set<string>) => void;

export class Store {
  p: ProjectState = emptyProject();
  t: Transient = emptyTransient();
  private listeners = new Set<Listener>();
  private pending = new Set<string>();
  private scheduled = false;
  /** Called after persisted state changes (autosave). */
  onPersistChange: (() => void) | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<ProjectState>): void {
    Object.assign(this.p, patch);
    for (const k of Object.keys(patch)) this.pending.add(k);
    this.onPersistChange?.();
    this.flush();
  }

  setUi(patch: Partial<ProjectState['ui']>): void {
    this.p.ui = { ...this.p.ui, ...patch };
    this.pending.add('ui');
    this.onPersistChange?.();
    this.flush();
  }

  setT(patch: Partial<Transient>): void {
    Object.assign(this.t, patch);
    for (const k of Object.keys(patch)) this.pending.add(`t.${k}`);
    this.flush();
  }

  private flush() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const changed = new Set(this.pending);
      this.pending.clear();
      for (const l of [...this.listeners]) l(this.p, this.t, changed);
    });
  }
}

// ------------------------------------------------------------------ presets (SPEC §7.3)

export type OptionKey =
  'heightMode' | 'heightRef' | 'sampling' | 'rounding' | 'keepSmall' | 'cap' | 'selection' | 'rotation';
export const OPTION_KEYS: OptionKey[] = [
  'heightMode',
  'heightRef',
  'sampling',
  'rounding',
  'keepSmall',
  'cap',
  'selection',
  'rotation',
];

const LEGACY_OPTIONS: Record<OptionKey, unknown> = {
  heightMode: LEGACY_PRESET.heightMode,
  heightRef: LEGACY_PRESET.heightRef,
  sampling: LEGACY_PRESET.sampling,
  rounding: LEGACY_PRESET.rounding,
  keepSmall: LEGACY_PRESET.keepSmall,
  cap: undefined,
  selection: LEGACY_PRESET.selection,
  rotation: LEGACY_PRESET.rotation,
};

function optionValue(p: Params, k: OptionKey): unknown {
  if (k === 'cap') return p.cap ?? undefined;
  if (k === 'heightMode' && p.heightMode === 'exaggerated') return `exaggerated:${p.exaggeration ?? 2}`;
  if (k === 'sampling' && p.sampling.startsWith('supersample'))
    return `${p.sampling}:${p.aggregate ?? 'max'}`;
  return p[k];
}

/** Options that differ from the Legacy (UD-Viz 4.6.1) preset. */
export function changedOptions(p: Params): OptionKey[] {
  return OPTION_KEYS.filter((k) => optionValue(p, k) !== LEGACY_OPTIONS[k]);
}

export function trueScaleOptions(p: Params, groundAvailable: boolean): Params {
  return {
    ...p,
    heightMode: 'true-scale',
    rounding: 'round',
    keepSmall: true,
    sampling: 'centre-1',
    selection: 'clip',
    rotation: 'rotate',
    heightRef: groundAvailable ? 'ground' : 'lowest-base',
    cap: undefined,
  };
}

export function legacyOptions(p: Params): Params {
  const { exaggeration: _e, aggregate: _a, cap: _c, ...rest } = p;
  return { ...rest, ...LEGACY_PRESET, scale: p.scale, maxHeight: p.maxHeight };
}

export type PresetId = 'legacy' | 'legacyKeepSmall' | 'trueScale' | 'custom';

export function presetOf(p: Params, groundAvailable: boolean): PresetId {
  const changed = changedOptions(p);
  if (!changed.length) return 'legacy';
  if (changed.length === 1 && changed[0] === 'keepSmall') return 'legacyKeepSmall';
  const ts = trueScaleOptions(p, groundAvailable);
  if (OPTION_KEYS.every((k) => optionValue(p, k) === optionValue(ts, k))) return 'trueScale';
  return 'custom';
}

// ------------------------------------------------------------------ stale result (SPEC G4)

export interface StaleChange {
  key: 'model' | 'area' | 'plates' | 'rotation' | 'scale' | 'maxHeight' | 'preset' | OptionKey;
  from?: string;
  to?: string;
}

export function sourceKey(p: ProjectState): string {
  const s = p.source;
  if (!s) return p.guideOnly ? 'project' : '';
  return `${s.kind}:${s.demoId ?? s.label}:${s.bytes}:${JSON.stringify(p.importOptions)}`;
}

export function staleChanges(p: ProjectState): StaleChange[] {
  const r = p.result;
  if (!r || !p.area) return [];
  const out: StaleChange[] = [];
  if (!p.guideOnly && r.sourceKey !== sourceKey(p)) out.push({ key: 'model' });
  const a = p.area,
    b = r.area;
  if (Math.abs(a.cx - b.cx) > 1e-6 || Math.abs(a.cy - b.cy) > 1e-6) out.push({ key: 'area' });
  if (Math.abs(a.rotationDeg - b.rotationDeg) > 1e-9)
    out.push({ key: 'rotation', from: `${b.rotationDeg}°`, to: `${a.rotationDeg}°` });
  const q = p.params,
    g = r.params;
  if (q.platesX !== g.platesX || q.platesY !== g.platesY)
    out.push({ key: 'plates', from: `${g.platesX} × ${g.platesY}`, to: `${q.platesX} × ${q.platesY}` });
  if (q.scale !== g.scale) out.push({ key: 'scale', from: String(g.scale), to: String(q.scale) });
  if (q.maxHeight !== g.maxHeight && (q.heightMode === 'normalized' || g.heightMode === 'normalized'))
    out.push({ key: 'maxHeight', from: String(g.maxHeight), to: String(q.maxHeight) });
  for (const k of OPTION_KEYS) if (optionValue(q, k) !== optionValue(g, k)) out.push({ key: k });
  return out;
}

export function isStale(p: ProjectState): boolean {
  return staleChanges(p).length > 0;
}

/** Steps reachable now. */
export function stepAvailable(p: ProjectState, s: StepId): boolean {
  switch (s) {
    case 'import':
      return true;
    case 'area':
    case 'settings':
    case 'generate':
      return !!p.summary || (p.guideOnly && !!p.area);
    case 'guide':
      return !!p.result;
  }
}

export function stepIndex(s: StepId): number {
  return STEPS.indexOf(s);
}

export function hasEstimate(t: Transient): t is Transient & { estimate: EstimateResult } {
  return !!t.estimate;
}
