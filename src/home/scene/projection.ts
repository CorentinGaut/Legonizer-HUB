/**
 * Projected layers (SPEC §2, §6.2): canvas textures for the projector SpotLight's
 * `map`. The map covers the table plane z = 0 seen from the lens; buildings are drawn where the
 * projector actually hits them (roofs and the walls facing the lens are displaced away from the
 * lens nadir by L / (L − z)), tallest last, so the colours land on the right bricks in 3D.
 * Everything outside the table is black (no light on the floor or on people); "no data" is
 * plain white light. Colours: the --lz-proj-* tokens (change colours: SPEC §12).
 */
import * as THREE from 'three';
import type { Derived } from './derive.ts';
import {
  BRICK_H,
  COLORS,
  LENS,
  MAP_HALF_X,
  MAP_HALF_Y,
  MEDIA,
  MODEL_X0,
  MODEL_Y0,
  PITCH,
  STUD_H,
  TABLE,
} from './constants.ts';
import type { HomeModel } from './model.ts';
import type { LayerKey } from '../timeline.ts';

export interface LegendLabels {
  housing: string;
  offices: string;
  shops: string;
  public: string;
  vegetation: string;
  tram: string;
  built: string;
  demolished: string;
  modified: string;
}

type Ctx = CanvasRenderingContext2D;

export class ProjectionLayers {
  readonly width: number;
  readonly height: number;
  private readonly cache = new Map<string, THREE.CanvasTexture>();
  private readonly order: string[] = [];
  private base: HTMLCanvasElement | undefined; // functions + green, for the tram animation
  private full: HTMLCanvasElement | undefined; // functions + green + trams
  private mask: HTMLCanvasElement | undefined;
  private tramTex: THREE.CanvasTexture | undefined;
  private tramStep = -1;
  private cellsByHeight: number[];

  private readonly model: HomeModel;
  private readonly derived: Derived;
  private labels: LegendLabels;
  private readonly maxCached: number;

  constructor(
    model: HomeModel,
    derived: Derived,
    labels: LegendLabels,
    size: 'high' | 'low' = 'high',
    maxCached = 4,
  ) {
    this.model = model;
    this.derived = derived;
    this.labels = labels;
    this.maxCached = maxCached;
    this.width = size === 'high' ? 2048 : 1024;
    this.height = this.width / 2;
    const cells: number[] = [];
    for (let c = 0; c < model.heights.length; c++) if (model.heights[c]! > 0) cells.push(c);
    cells.sort((a, b) => model.heights[a]! - model.heights[b]!);
    this.cellsByHeight = cells;
  }

  setLabels(labels: LegendLabels): void {
    this.labels = labels;
    this.dispose();
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
    this.order.length = 0;
    this.tramTex?.dispose();
    this.tramTex = undefined;
    this.base = undefined;
    this.full = undefined;
    this.mask = undefined;
    this.tramStep = -1;
  }

  /** Texture for a layer; the tram reveal is recomposed at most 30 times over its 1.5 s animation. */
  texture(key: LayerKey, tram = 1): THREE.Texture {
    if (key === 'functions-tram' && tram < 1) return this.tramTexture(tram);
    let tex = this.cache.get(key);
    if (!tex) {
      tex = this.makeTexture(this.draw(key, 1));
      this.cache.set(key, tex);
      this.order.push(key);
      while (this.order.length > this.maxCached) {
        const old = this.order.shift()!;
        this.cache.get(old)?.dispose();
        this.cache.delete(old);
      }
    } else {
      this.order.splice(this.order.indexOf(key), 1);
      this.order.push(key);
    }
    return tex;
  }

  private makeTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 1;
    return t;
  }

  private tramTexture(progress: number): THREE.Texture {
    const step = Math.round(progress * 30);
    if (!this.base) {
      this.base = this.draw('functions-green', 1);
      this.full = this.draw('functions-tram', 1);
      this.mask = document.createElement('canvas');
      this.mask.width = this.width;
      this.mask.height = this.height;
    }
    if (!this.tramTex) {
      const c = document.createElement('canvas');
      c.width = this.width;
      c.height = this.height;
      this.tramTex = this.makeTexture(c);
    }
    if (step !== this.tramStep) {
      this.tramStep = step;
      // reveal the full layer (trams already under the façades, legend with the tram) along the
      // line drawn so far, over the layer without trams: two blits instead of a full redraw
      const m = this.mask!.getContext('2d')!;
      m.globalCompositeOperation = 'source-over';
      m.clearRect(0, 0, this.width, this.height);
      m.drawImage(this.full!, 0, 0);
      m.globalCompositeOperation = 'destination-in';
      m.fillStyle = '#000';
      m.strokeStyle = '#000';
      this.tramPath(m, step / 30, 0.016);
      const legendRow = MEDIA.y1 - 0.04 - 5 * 0.046;
      m.fillRect(this.px(MEDIA.x0), this.py(legendRow + 0.01), this.len(MEDIA.x1 - MEDIA.x0), this.len(0.04));
      const canvas = this.tramTex.image as HTMLCanvasElement;
      const x = canvas.getContext('2d')!;
      x.drawImage(this.base, 0, 0);
      if (step > 0) x.drawImage(this.mask!, 0, 0);
      this.tramTex.needsUpdate = true;
    }
    return this.tramTex;
  }

  /** Stroke the tram lines up to `progress` of their length with a line of `width` metres. */
  private tramPath(x: Ctx, progress: number, width: number): void {
    if (progress <= 0) return;
    x.lineWidth = this.len(width);
    x.lineJoin = 'round';
    x.lineCap = 'round';
    for (const line of this.derived.trams) {
      const pts = line.map(
        ([i, j]) => [this.px(MODEL_X0 + i * PITCH), this.py(MODEL_Y0 + j * PITCH)] as const,
      );
      let total = 0;
      for (let k = 1; k < pts.length; k++)
        total += Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]);
      let left = total * Math.min(1, progress);
      x.beginPath();
      x.moveTo(pts[0]![0], pts[0]![1]);
      for (let k = 1; k < pts.length && left > 0; k++) {
        const [ax, ay] = pts[k - 1]!;
        const [bx, by] = pts[k]!;
        const seg = Math.hypot(bx - ax, by - ay);
        const f = Math.min(1, left / (seg || 1));
        x.lineTo(ax + (bx - ax) * f, ay + (by - ay) * f);
        left -= seg;
      }
      x.stroke();
    }
  }

  // ------------------------------------------------------------------------------ drawing

  private px(x: number): number {
    return ((x + MAP_HALF_X) / (2 * MAP_HALF_X)) * this.width;
  }
  private py(y: number): number {
    return ((MAP_HALF_Y - y) / (2 * MAP_HALF_Y)) * this.height;
  }
  private len(m: number): number {
    return (m / (2 * MAP_HALF_X)) * this.width;
  }

  /** Draw a full layer on a new canvas. */
  draw(key: LayerKey, tram: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.width;
    c.height = this.height;
    const x = c.getContext('2d')!;
    x.fillStyle = '#000';
    x.fillRect(0, 0, this.width, this.height);
    x.fillStyle = '#fff';
    x.fillRect(
      this.px(-TABLE.length / 2),
      this.py(TABLE.width / 2),
      this.len(TABLE.length),
      this.len(TABLE.width),
    );
    if (key === 'plain') return c;
    const isChange = key === 'change-1' || key === 'change-2';
    if (!isChange) {
      // ground of the model area, green spaces
      x.fillStyle = COLORS.projGround;
      x.fillRect(
        this.px(MODEL_X0),
        this.py(MODEL_Y0 + this.model.rows * PITCH),
        this.len(this.model.cols * PITCH),
        this.len(this.model.rows * PITCH),
      );
      if (key !== 'functions') this.drawGreen(x);
      if (key === 'functions-tram') this.drawTrams(x, tram);
    }
    this.drawBuildings(x, isChange ? 'change' : 'functions');
    this.drawMediaStrip(x, key);
    return c;
  }

  private drawGreen(x: Ctx): void {
    const { cols, rows } = this.model;
    x.fillStyle = COLORS.vegetation;
    const w = this.len(PITCH) + 0.6;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        if (this.derived.green[j * cols + i])
          x.fillRect(this.px(MODEL_X0 + i * PITCH) - 0.3, this.py(MODEL_Y0 + (j + 1) * PITCH) - 0.3, w, w);
  }

  private drawTrams(x: Ctx, progress: number): void {
    // ink core with a white casing (shape-coded transport line, --lz-proj-transport*)
    x.strokeStyle = COLORS.transportCasing;
    this.tramPath(x, progress, 0.01);
    x.strokeStyle = COLORS.transport;
    this.tramPath(x, progress, 0.005);
  }

  /** Buildings with projector parallax: each cell is drawn from its base up to its roof. */
  private drawBuildings(x: Ctx, mode: 'functions' | 'change'): void {
    const { cols, heights } = this.model;
    const L = LENS.z;
    const cell = PITCH;
    for (const c of this.cellsByHeight) {
      const b = this.derived.buildings[this.derived.buildingOf[c]!];
      let colour = '#ffffff';
      if (b) {
        if (mode === 'functions') colour = COLORS[b.fn];
        else if (b.change) colour = COLORS[b.change];
      }
      x.fillStyle = colour;
      const i = c % cols,
        j = (c - i) / cols;
      const x0 = MODEL_X0 + i * cell,
        y0 = MODEL_Y0 + j * cell;
      const zTop = heights[c]! * BRICK_H + STUD_H;
      const steps = 1 + Math.ceil(zTop / 0.02);
      for (let s = 0; s <= steps; s++) {
        const k = L / (L - (zTop * s) / steps);
        const ax = this.px(x0 * k),
          ay = this.py((y0 + cell) * k);
        const w = this.len(cell * k);
        x.fillRect(ax - 0.35, ay - 0.35, w + 0.7, w + 0.7);
      }
    }
  }

  private drawMediaStrip(x: Ctx, key: LayerKey): void {
    const isChange = key === 'change-1' || key === 'change-2';
    const M = MEDIA;
    x.fillStyle = COLORS.mediaPanel;
    x.fillRect(this.px(M.x0), this.py(M.y1), this.len(M.x1 - M.x0), this.len(M.y1 - M.y0));
    const L = this.labels;
    const items: [string, string, 'fill' | 'line'][] = isChange
      ? [
          [L.built, COLORS.built, 'fill'],
          [L.demolished, COLORS.demolished, 'fill'],
          [L.modified, COLORS.modified, 'fill'],
        ]
      : [
          [L.housing, COLORS.housing, 'fill'],
          [L.offices, COLORS.offices, 'fill'],
          [L.shops, COLORS.shops, 'fill'],
          [L.public, COLORS.public, 'fill'],
          ...(key !== 'functions'
            ? ([[L.vegetation, COLORS.vegetation, 'fill']] as [string, string, 'fill'][])
            : []),
          ...(key === 'functions-tram'
            ? ([[L.tram, COLORS.transport, 'line']] as [string, string, 'line'][])
            : []),
        ];
    const fontPx = this.len(0.024);
    x.font = `600 ${fontPx}px "IBM Plex Sans", system-ui, sans-serif`;
    x.textBaseline = 'middle';
    const lx = M.x0 + 0.03;
    items.forEach(([label, colour, kind], k) => {
      const yTop = M.y1 - 0.04 - k * 0.046;
      if (kind === 'fill') {
        x.fillStyle = colour;
        x.fillRect(this.px(lx), this.py(yTop), this.len(0.04), this.len(0.028));
        x.strokeStyle = '#85837b';
        x.lineWidth = Math.max(1, this.len(0.0012));
        x.strokeRect(this.px(lx), this.py(yTop), this.len(0.04), this.len(0.028));
      } else {
        x.strokeStyle = COLORS.transportCasing;
        x.lineWidth = this.len(0.01);
        x.beginPath();
        x.moveTo(this.px(lx), this.py(yTop - 0.014));
        x.lineTo(this.px(lx + 0.04), this.py(yTop - 0.014));
        x.stroke();
        x.strokeStyle = colour;
        x.lineWidth = this.len(0.005);
        x.stroke();
      }
      x.fillStyle = '#1b1c20';
      x.fillText(label, this.px(lx + 0.055), this.py(yTop - 0.014));
    });
    if (isChange) this.drawMediaCard(x, key === 'change-1' ? 0 : 1, M.y1 - 0.04 - 3 * 0.046 - 0.02);
  }

  /** A media card (image + title bar + two text lines), projected next to the model (paper §4.2). Illustrative. */
  private drawMediaCard(x: Ctx, which: 0 | 1, yTop: number): void {
    const x0 = MEDIA.x0 + 0.03,
      w = MEDIA.x1 - MEDIA.x0 - 0.06,
      h = 0.3;
    const X = this.px(x0),
      Y = this.py(yTop),
      W = this.len(w),
      H = this.len(h);
    const g = x.createLinearGradient(0, Y, 0, Y + H);
    if (which === 0) {
      g.addColorStop(0, '#9fb7cc');
      g.addColorStop(0.6, '#d8c9ad');
      g.addColorStop(1, '#6f6253');
    } else {
      g.addColorStop(0, '#d9cfbd');
      g.addColorStop(1, '#8d806c');
    }
    x.fillStyle = g;
    x.fillRect(X, Y, W, H);
    // a skyline (card 1) or an archive plan (card 2), abstract
    x.fillStyle = which === 0 ? 'rgba(40,36,32,0.78)' : 'rgba(60,52,42,0.55)';
    if (which === 0) {
      for (let k = 0; k < 11; k++) {
        const bh = H * (0.12 + ((k * 37) % 13) / 30);
        const bw = W / 14;
        x.fillRect(X + (k + 0.6) * (W / 12), Y + H - bh, bw, bh);
      }
    } else {
      x.lineWidth = this.len(0.003);
      x.strokeStyle = 'rgba(60,52,42,0.7)';
      for (let k = 0; k < 5; k++)
        x.strokeRect(X + W * (0.1 + 0.16 * k), Y + H * (0.2 + 0.1 * (k % 2)), W * 0.12, H * 0.5);
      x.fillRect(X + W * 0.05, Y + H * 0.82, W * 0.9, H * 0.04);
    }
    x.fillStyle = '#1b1c20';
    x.fillRect(X, Y + H + this.len(0.02), this.len(which === 0 ? 0.32 : 0.27), this.len(0.022));
    x.fillStyle = '#55575e';
    x.fillRect(X, Y + H + this.len(0.055), this.len(0.4), this.len(0.013));
    x.fillRect(X, Y + H + this.len(0.078), this.len(which === 0 ? 0.3 : 0.36), this.len(0.013));
  }
}
