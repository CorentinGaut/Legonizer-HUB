/**
 * Plan view (top, north up) with the area rectangle tool (SPEC A1, A2).
 * Background: a height raster of the model computed in the Worker (works without WebGL, SPEC N2),
 * shaded by height (#FBFAF6 low → #A19D95 ≥ 100 m) with a light hillshade.
 * Overlay (SVG): the area with its plate grid and labels A1…, handles (resize by whole plates,
 * rotate), north tick, dimension labels, the sampled box of legacy mode (dashed, SPEC A4), buildings
 * included whole (L2) and the tallest building marker. Pointer, touch and keyboard.
 */
import type { PlanRaster, PlanRasterRequest } from '../../core/heightmap/planRaster.ts';
import type { Area, Bounds3 } from '../../core/types.ts';
import { plateName } from '../../core/packing/plates.ts';
import { esc } from '../dom.ts';

export interface AreaGeom {
  area: Area;
  platesX: number;
  platesY: number;
  scale: number;
}

export interface PlanOverlays {
  /** Corners (world) of the area actually sampled, when it differs (dashed). */
  sampled?: [number, number][] | null;
  tallest?: { x: number; y: number; label: string } | null;
  /** World boxes (minX, minY, maxX, maxY) of buildings included whole that stick out of the area. */
  included?: number[][];
  /** Disappearing buildings (boxes), hatched in the 2D settings view. */
  disappearing?: number[][];
}

export interface PlanStrings {
  rectangleName: (g: AreaGeom) => string;
  dimension: (plates: number, metres: number) => string;
  angle: (deg: number) => string;
  drawLabel: (x: number, y: number, w: number, d: number) => string;
  max16: string;
  imgLabel: string;
}

export interface PlanOptions {
  editable: boolean;
  bounds: Bounds3;
  strings: PlanStrings;
  requestRaster: (r: PlanRasterRequest) => Promise<PlanRaster>;
  onChange?: (
    g: AreaGeom,
    phase: 'live' | 'commit' | 'cancel',
    what: 'move' | 'resize' | 'rotate' | 'draw' | 'key',
  ) => void;
  onDrawModeChange?: (on: boolean) => void;
  onViewChange?: () => void;
}

const HANDLE = 10;
const MAX_PLATES = 16;

type Drag =
  | { kind: 'pan'; x0: number; y0: number; cx0: number; cy0: number }
  | { kind: 'move'; wx0: number; wy0: number; g0: AreaGeom }
  | { kind: 'resize'; handle: string; g0: AreaGeom }
  | { kind: 'rotate'; g0: AreaGeom }
  | { kind: 'draw'; wx0: number; wy0: number; g0: AreaGeom };

export class PlanView {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private svg: SVGSVGElement;
  private opts: PlanOptions;
  /** View: world centre and pixels per metre. */
  cx = 0;
  cy = 0;
  ppm = 1;
  private geom: AreaGeom | null = null;
  private overlays: PlanOverlays = {};
  private raster: { img: HTMLCanvasElement; req: PlanRasterRequest } | null = null;
  private rasterToken = 0;
  private rasterTimer = 0;
  private drag: Drag | null = null;
  private pointerId: number | null = null;
  private drawMode = false;
  private space = false;
  private undoStack: AreaGeom[] = [];
  private redoStack: AreaGeom[] = [];
  private ro: ResizeObserver;
  private destroyed = false;
  private liveLabel: string | null = null;

  constructor(container: HTMLElement, opts: PlanOptions) {
    this.opts = opts;
    this.el = document.createElement('div');
    this.el.className = 'lz-plan';
    // the Stage names it (aria-label): a plain div may not carry a name, a group may
    this.el.setAttribute('role', 'group');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lz-plan__raster';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('lz-plan__overlay');
    this.el.append(this.canvas, this.svg);
    container.prepend(this.el);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.bindPointer();
    this.fitModel(false);
    this.resize();
  }

  // ------------------------------------------------------------------ view transform

  private get W() {
    return this.el.clientWidth || 1;
  }
  private get H() {
    return this.el.clientHeight || 1;
  }
  toScreen(x: number, y: number): [number, number] {
    return [(x - this.cx) * this.ppm + this.W / 2, (this.cy - y) * this.ppm + this.H / 2];
  }
  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.W / 2) / this.ppm + this.cx, this.cy - (sy - this.H / 2) / this.ppm];
  }

  /** Safe rectangle: leave room for the toolbar (top) and the legend (bottom). */
  private fitBox(minX: number, minY: number, maxX: number, maxY: number, margin: number) {
    const top = 64,
      bottom = 64,
      side = 16;
    const w = Math.max(1, this.W - 2 * side),
      h = Math.max(1, this.H - top - bottom);
    const bw = (maxX - minX) * margin,
      bh = (maxY - minY) * margin;
    this.ppm = Math.min(w / Math.max(bw, 1e-6), h / Math.max(bh, 1e-6));
    this.cx = (minX + maxX) / 2;
    // centre in the safe rectangle (shift for asymmetric insets)
    this.cy = (minY + maxY) / 2 + (top - bottom) / 2 / this.ppm;
  }

  fitModel(render = true): void {
    const b = this.opts.bounds;
    this.fitBox(b.min[0], b.min[1], b.max[0], b.max[1], 1.08);
    if (render) this.viewChanged();
  }

  /** Frames the area with a 20 % margin. */
  fitArea(): void {
    if (!this.geom) return this.fitModel();
    const c = corners(this.geom);
    const xs = c.map((p) => p[0]),
      ys = c.map((p) => p[1]);
    this.fitBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 1.4);
    this.viewChanged();
  }

  zoomBy(f: number, sx = this.W / 2, sy = this.H / 2): void {
    const [wx, wy] = this.toWorld(sx, sy);
    this.ppm = Math.min(200, Math.max(1e-4, this.ppm * f));
    // keep (wx, wy) under the pointer
    this.cx = wx - (sx - this.W / 2) / this.ppm;
    this.cy = wy + (sy - this.H / 2) / this.ppm;
    this.viewChanged();
  }

  private resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
    this.viewChanged();
  }

  private viewChanged() {
    if (this.destroyed) return;
    this.paint();
    this.renderOverlay();
    this.opts.onViewChange?.();
    clearTimeout(this.rasterTimer);
    this.rasterTimer = window.setTimeout(() => void this.fetchRaster(), 160);
  }

  // ------------------------------------------------------------------ raster

  private async fetchRaster() {
    const [x0, y1] = this.toWorld(0, 0);
    const [x1, y0] = this.toWorld(this.W, this.H);
    const cur = this.raster?.req;
    if (
      cur &&
      Math.abs(cur.minX - x0) < 1e-6 &&
      Math.abs(cur.maxX - x1) < 1e-6 &&
      Math.abs(cur.minY - y0) < 1e-6 &&
      Math.abs(cur.maxY - y1) < 1e-6
    )
      return;
    const req: PlanRasterRequest = {
      minX: x0,
      minY: y0,
      maxX: x1,
      maxY: y1,
      width: Math.min(1600, Math.round(this.W)),
      height: Math.min(1600, Math.round(this.H * (Math.min(1600, Math.round(this.W)) / this.W))),
    };
    const token = ++this.rasterToken;
    try {
      const r = await this.opts.requestRaster(req);
      if (token !== this.rasterToken || this.destroyed) return;
      this.raster = { img: shade(r), req };
      this.paint();
    } catch {
      // keep the previous raster
    }
  }

  private paint() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const dpr = this.canvas.width / this.W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#DEDBD4';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.raster) return;
    const r = this.raster.req;
    const [sx0, sy0] = this.toScreen(r.minX, r.maxY);
    const [sx1, sy1] = this.toScreen(r.maxX, r.minY);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.raster.img, sx0 * dpr, sy0 * dpr, (sx1 - sx0) * dpr, (sy1 - sy0) * dpr);
  }

  // ------------------------------------------------------------------ area + overlays

  setArea(g: AreaGeom | null, opts: { record?: boolean } = {}): void {
    if (g && this.geom && opts.record) this.pushUndo(this.geom);
    this.geom = g ? { ...g, area: { ...g.area } } : null;
    this.renderOverlay();
  }

  setOverlays(o: PlanOverlays): void {
    this.overlays = o;
    this.renderOverlay();
  }

  private renderOverlay() {
    const g = this.geom;
    const parts: string[] = [];
    const ov = this.overlays;
    const box = (b: number[], cls: string) => {
      const [x0, y0] = this.toScreen(b[0]!, b[3]!);
      const [x1, y1] = this.toScreen(b[2]!, b[1]!);
      return `<rect class="${cls}" x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${Math.max(1, y1 - y0).toFixed(1)}"/>`;
    };
    parts.push(
      `<defs><pattern id="lz-plan-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="6" class="hatch-line"/></pattern></defs>`,
    );
    for (const b of ov.disappearing ?? []) parts.push(box(b, 'disappear'));
    for (const b of ov.included ?? []) parts.push(box(b, 'included'));
    if (ov.sampled)
      parts.push(
        `<polygon class="sampled" points="${ov.sampled
          .map((p) =>
            this.toScreen(p[0], p[1])
              .map((v) => v.toFixed(1))
              .join(','),
          )
          .join(' ')}"/>`,
      );
    if (g) parts.push(this.areaSvg(g));
    if (ov.tallest) {
      const [x, y] = this.toScreen(ov.tallest.x, ov.tallest.y);
      const lx = Math.max(8, Math.min(this.W - 220, x - 180)),
        ly = Math.max(70, y - 70);
      parts.push(
        `<g class="tallest" aria-hidden="true"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10"/><path d="M${(x - 7).toFixed(1)} ${(y - 7).toFixed(1)}L${(lx + 4).toFixed(1)} ${(ly + 6).toFixed(1)}"/><text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}">${esc(ov.tallest.label)}</text></g>`,
      );
    }
    if (this.liveLabel && this.drag) {
      parts.push(
        `<text class="live" x="${(this.W / 2).toFixed(1)}" y="${(this.H - 76).toFixed(1)}" text-anchor="middle">${esc(this.liveLabel)}</text>`,
      );
    }
    const hadFocus =
      (document.activeElement as Element | null)?.classList?.contains('lz-area') &&
      this.svg.contains(document.activeElement);
    this.svg.innerHTML = parts.join('');
    const rect = this.svg.querySelector<SVGGElement>('.lz-area');
    if (hadFocus) this.focusAfterRender = true;
    if (rect && g && this.opts.editable) {
      rect.setAttribute('tabindex', '0');
      rect.setAttribute('role', 'application');
      rect.setAttribute('aria-roledescription', 'area');
      rect.setAttribute('aria-label', this.opts.strings.rectangleName(g));
      if (this.focusAfterRender) {
        this.focusAfterRender = false;
        rect.focus();
      }
    }
  }
  private focusAfterRender = false;

  private areaSvg(g: AreaGeom): string {
    const c = corners(g); // SW, SE, NE, NW
    const s = c.map((p) => this.toScreen(p[0], p[1]));
    const pts = s.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const out: string[] = [`<g class="lz-area${this.drag ? ' is-dragging' : ''}">`];
    out.push(`<polygon class="body" data-h="body" points="${pts}"/>`);
    // plate grid
    const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
    ];
    let grid = '';
    for (let k = 1; k < g.platesX; k++) {
      const a = lerp(s[0]!, s[1]!, k / g.platesX),
        b = lerp(s[3]!, s[2]!, k / g.platesX);
      grid += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    }
    for (let k = 1; k < g.platesY; k++) {
      const a = lerp(s[0]!, s[3]!, k / g.platesY),
        b = lerp(s[1]!, s[2]!, k / g.platesY);
      grid += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    }
    if (grid) out.push(`<path class="grid" d="${grid}"/>`);
    // labels (rotate with the area)
    const platePx = 32 * g.scale * this.ppm;
    if (platePx >= 22) {
      const fs = Math.max(10, Math.min(22, platePx / 5));
      const rot = -g.area.rotationDeg;
      for (let i = 0; i < g.platesX; i++)
        for (let j = 0; j < g.platesY; j++) {
          // plate (i, j from the south) north-west corner + offset
          const u = (i + 0.08) / g.platesX,
            v = (j + 0.92) / g.platesY;
          const p = lerp(lerp(s[0]!, s[1]!, u), lerp(s[3]!, s[2]!, u), v);
          const name = plateName(i, j, g.platesY);
          out.push(
            `<text class="label" x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" font-size="${fs.toFixed(1)}" transform="rotate(${rot} ${p[0].toFixed(1)} ${p[1].toFixed(1)}) translate(0 ${(fs * 0.8).toFixed(1)})">${name}</text>`,
          );
        }
    }
    // north tick + rotation handle
    const nMid = lerp(s[3]!, s[2]!, 0.5);
    const sMid = lerp(s[0]!, s[1]!, 0.5);
    const len = Math.hypot(nMid[0] - sMid[0], nMid[1] - sMid[1]) || 1;
    const ux = (nMid[0] - sMid[0]) / len,
      uy = (nMid[1] - sMid[1]) / len;
    const stemEnd: [number, number] = [nMid[0] + ux * 26, nMid[1] + uy * 26];
    out.push(
      `<text class="north" x="${(nMid[0] - ux * 9).toFixed(1)}" y="${(nMid[1] - uy * 9 + 3).toFixed(1)}" text-anchor="middle">N</text>`,
    );
    if (this.opts.editable) {
      out.push(
        `<line class="stem" x1="${nMid[0].toFixed(1)}" y1="${nMid[1].toFixed(1)}" x2="${stemEnd[0].toFixed(1)}" y2="${stemEnd[1].toFixed(1)}"/>`,
      );
      out.push(
        `<circle class="handle handle--rotate" data-h="rotate" cx="${stemEnd[0].toFixed(1)}" cy="${stemEnd[1].toFixed(1)}" r="6"/>`,
      );
      out.push(
        `<circle class="hit" data-h="rotate" cx="${stemEnd[0].toFixed(1)}" cy="${stemEnd[1].toFixed(1)}" r="16"/>`,
      );
      const hs: [string, [number, number]][] = [
        ['sw', s[0]!],
        ['se', s[1]!],
        ['ne', s[2]!],
        ['nw', s[3]!],
        ['s', lerp(s[0]!, s[1]!, 0.5)],
        ['e', lerp(s[1]!, s[2]!, 0.5)],
        ['n', nMid],
        ['w', lerp(s[3]!, s[0]!, 0.5)],
      ];
      const coarse = matchMedia('(pointer: coarse)').matches;
      const hit = coarse ? 22 : 12;
      for (const [h, p] of hs) {
        out.push(
          `<rect class="handle" data-h="${h}" x="${(p[0] - HANDLE / 2).toFixed(1)}" y="${(p[1] - HANDLE / 2).toFixed(1)}" width="${HANDLE}" height="${HANDLE}" transform="rotate(${-g.area.rotationDeg} ${p[0].toFixed(1)} ${p[1].toFixed(1)})"/>`,
          `<rect class="hit" data-h="${h}" x="${(p[0] - hit).toFixed(1)}" y="${(p[1] - hit).toFixed(1)}" width="${2 * hit}" height="${2 * hit}"/>`,
        );
      }
      if (coarse) {
        const m = lerp(s[0]!, s[2]!, 0.5);
        out.push(
          `<circle class="handle handle--move" data-h="body" cx="${m[0].toFixed(1)}" cy="${m[1].toFixed(1)}" r="12"/>`,
        );
      }
    }
    // dimension labels outside the south and west edges
    const wM = g.platesX * 32 * g.scale,
      hM = g.platesY * 32 * g.scale;
    const off = 20;
    const sLab: [number, number] = [sMid[0] - ux * off, sMid[1] - uy * off];
    const wMid = lerp(s[0]!, s[3]!, 0.5);
    const vx = (s[1]![0] - s[0]![0]) / (Math.hypot(s[1]![0] - s[0]![0], s[1]![1] - s[0]![1]) || 1),
      vy = (s[1]![1] - s[0]![1]) / (Math.hypot(s[1]![0] - s[0]![0], s[1]![1] - s[0]![1]) || 1);
    const wLab: [number, number] = [wMid[0] - vx * off, wMid[1] - vy * off];
    const rot = -g.area.rotationDeg;
    out.push(
      `<text class="dim" x="${sLab[0].toFixed(1)}" y="${sLab[1].toFixed(1)}" text-anchor="middle" transform="rotate(${rot} ${sLab[0].toFixed(1)} ${sLab[1].toFixed(1)})" dy="4">${esc(this.opts.strings.dimension(g.platesX, wM))}</text>`,
      `<text class="dim" x="${wLab[0].toFixed(1)}" y="${wLab[1].toFixed(1)}" text-anchor="middle" transform="rotate(${rot - 90} ${wLab[0].toFixed(1)} ${wLab[1].toFixed(1)})" dy="4">${esc(this.opts.strings.dimension(g.platesY, hM))}</text>`,
    );
    out.push('</g>');
    return out.join('');
  }

  // ------------------------------------------------------------------ pointer

  private bindPointer() {
    const el = this.el;
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e, true));
    el.addEventListener('dblclick', (e) => {
      if ((e.target as Element).closest('[data-h=body]')) this.fitArea();
    });
    el.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keydown', this.spaceDown);
    window.addEventListener('keyup', this.spaceUp);
  }
  private spaceDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && this.el.contains(document.activeElement)) {
      this.space = true;
      this.el.dataset.pan = 'true';
    }
  };
  private spaceUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      this.space = false;
      delete this.el.dataset.pan;
    }
  };

  private local(e: PointerEvent): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const [sx, sy] = this.local(e);
    const [wx, wy] = this.toWorld(sx, sy);
    const h = (e.target as Element).closest<SVGElement>('[data-h]')?.dataset.h;
    const g = this.geom;
    if (this.drawMode && this.opts.editable && g && !this.space) {
      this.drag = { kind: 'draw', wx0: wx, wy0: wy, g0: clone(g) };
    } else if (!this.space && this.opts.editable && g && h === 'body') {
      this.drag = { kind: 'move', wx0: wx, wy0: wy, g0: clone(g) };
    } else if (!this.space && this.opts.editable && g && h === 'rotate') {
      this.drag = { kind: 'rotate', g0: clone(g) };
    } else if (!this.space && this.opts.editable && g && h && h !== 'body') {
      this.drag = { kind: 'resize', handle: h, g0: clone(g) };
    } else {
      this.drag = { kind: 'pan', x0: sx, y0: sy, cx0: this.cx, cy0: this.cy };
    }
    this.pointerId = e.pointerId;
    this.el.setPointerCapture(e.pointerId);
    this.el.dataset.drag = this.drag.kind;
    e.preventDefault();
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== this.pointerId) return;
    const [sx, sy] = this.local(e);
    const [wx, wy] = this.toWorld(sx, sy);
    if (d.kind === 'pan') {
      this.cx = d.cx0 - (sx - d.x0) / this.ppm;
      this.cy = d.cy0 + (sy - d.y0) / this.ppm;
      this.viewChanged();
      return;
    }
    const g0 = d.g0;
    let g: AreaGeom = clone(g0);
    const plate = 32 * g0.scale;
    if (d.kind === 'move') {
      let dx = wx - d.wx0,
        dy = wy - d.wy0;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      g.area.cx = g0.area.cx + dx;
      g.area.cy = g0.area.cy + dy;
      this.liveLabel = null;
    } else if (d.kind === 'rotate') {
      const ang = (Math.atan2(wy - g0.area.cy, wx - g0.area.cx) * 180) / Math.PI - 90;
      let r = e.shiftKey ? Math.round(ang / 15) * 15 : Math.round(ang);
      for (const m of [0, 90, -90, 180, -180]) if (Math.abs(r - m) <= 2) r = m;
      g.area.rotationDeg = normAngle(r);
      this.liveLabel = this.opts.strings.angle(g.area.rotationDeg);
    } else if (d.kind === 'resize') {
      const t = (g0.area.rotationDeg * Math.PI) / 180;
      const c = Math.cos(t),
        s = Math.sin(t);
      // pointer in area-local axes (u east, v north) relative to the centre
      const lx = (wx - g0.area.cx) * c + (wy - g0.area.cy) * s;
      const ly = -(wx - g0.area.cx) * s + (wy - g0.area.cy) * c;
      const hw = (g0.platesX * plate) / 2,
        hh = (g0.platesY * plate) / 2;
      let u0 = -hw,
        u1 = hw,
        v0 = -hh,
        v1 = hh;
      const hdl = d.handle;
      let capped = false;
      const snap = (len: number) => {
        const p = Math.round(len / plate);
        if (p > MAX_PLATES) capped = true;
        return Math.min(MAX_PLATES, Math.max(1, p));
      };
      if (hdl.includes('e')) u1 = u0 + snap(lx - u0) * plate;
      if (hdl.includes('w')) u0 = u1 - snap(u1 - lx) * plate;
      if (hdl.includes('n')) v1 = v0 + snap(ly - v0) * plate;
      if (hdl.includes('s')) v0 = v1 - snap(v1 - ly) * plate;
      g.platesX = Math.round((u1 - u0) / plate);
      g.platesY = Math.round((v1 - v0) / plate);
      const mu = (u0 + u1) / 2,
        mv = (v0 + v1) / 2;
      g.area.cx = g0.area.cx + mu * c - mv * s;
      g.area.cy = g0.area.cy + mu * s + mv * c;
      this.liveLabel = capped
        ? this.opts.strings.max16
        : this.opts.strings.drawLabel(g.platesX, g.platesY, g.platesX * plate, g.platesY * plate);
    } else if (d.kind === 'draw') {
      const dx = wx - d.wx0,
        dy = wy - d.wy0;
      const fromCentre = e.altKey;
      const px = Math.min(
        MAX_PLATES,
        Math.max(1, Math.round((fromCentre ? 2 * Math.abs(dx) : Math.abs(dx)) / plate)),
      );
      const py = Math.min(
        MAX_PLATES,
        Math.max(1, Math.round((fromCentre ? 2 * Math.abs(dy) : Math.abs(dy)) / plate)),
      );
      g = { ...g0, platesX: px, platesY: py, area: { cx: 0, cy: 0, rotationDeg: 0 } };
      if (fromCentre) {
        g.area.cx = d.wx0;
        g.area.cy = d.wy0;
      } else {
        g.area.cx = d.wx0 + (Math.sign(dx || 1) * px * plate) / 2;
        g.area.cy = d.wy0 + (Math.sign(dy || 1) * py * plate) / 2;
      }
      this.liveLabel = this.opts.strings.drawLabel(px, py, px * plate, py * plate);
    }
    this.geom = g;
    this.renderOverlay();
    this.opts.onChange?.(g, 'live', d.kind === 'draw' ? 'draw' : d.kind);
  }

  private onUp(e: PointerEvent, cancelled = false) {
    const d = this.drag;
    if (!d || e.pointerId !== this.pointerId) return;
    this.drag = null;
    this.pointerId = null;
    delete this.el.dataset.drag;
    this.liveLabel = null;
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    if (d.kind === 'pan') {
      this.renderOverlay();
      return;
    }
    if (cancelled) return this.cancelDrag(d.g0);
    if (this.geom && !same(this.geom, d.g0)) {
      this.pushUndo(d.g0);
      this.opts.onChange?.(this.geom, 'commit', d.kind === 'draw' ? 'draw' : d.kind);
    }
    if (d.kind === 'draw') this.setDrawMode(false);
    this.renderOverlay();
  }

  private cancelDrag(g0: AreaGeom) {
    this.geom = clone(g0);
    this.renderOverlay();
    this.opts.onChange?.(g0, 'cancel', 'move');
  }

  // ------------------------------------------------------------------ keyboard

  private onKey(e: KeyboardEvent) {
    const onRect = (e.target as Element).closest?.('.lz-area');
    if (e.key === 'Escape') {
      if (this.drag && this.drag.kind !== 'pan') {
        const g0 = this.drag.g0;
        this.drag = null;
        this.cancelDrag(g0);
        e.preventDefault();
        return;
      }
      if (this.drawMode) {
        this.setDrawMode(false);
        e.preventDefault();
        return;
      }
      if (onRect) {
        (
          this.el.closest('.lz-viewport')?.querySelector<HTMLElement>('.lz-vp-toolbar button') ?? null
        )?.focus();
        e.preventDefault();
      }
      return;
    }
    if (!onRect || !this.geom || !this.opts.editable) return;
    const g = clone(this.geom);
    const step = e.shiftKey ? 32 * g.scale : g.scale;
    let what: 'move' | 'rotate';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    switch (e.key) {
      case 'ArrowLeft':
        g.area.cx -= step;
        what = 'move';
        break;
      case 'ArrowRight':
        g.area.cx += step;
        what = 'move';
        break;
      case 'ArrowUp':
        g.area.cy += step;
        what = 'move';
        break;
      case 'ArrowDown':
        g.area.cy -= step;
        what = 'move';
        break;
      case '[':
      case '{':
        g.area.rotationDeg = normAngle(g.area.rotationDeg - (e.shiftKey ? 15 : 1));
        what = 'rotate';
        break;
      case ']':
      case '}':
        g.area.rotationDeg = normAngle(g.area.rotationDeg + (e.shiftKey ? 15 : 1));
        what = 'rotate';
        break;
      case 'Home': {
        const b = this.opts.bounds;
        g.area.cx = (b.min[0] + b.max[0]) / 2;
        g.area.cy = (b.min[1] + b.max[1]) / 2;
        what = 'move';
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    this.pushUndo(this.geom);
    this.geom = g;
    this.focusAfterRender = true;
    this.renderOverlay();
    this.opts.onChange?.(g, 'commit', what === 'rotate' ? 'rotate' : 'key');
  }

  setDrawMode(on: boolean): void {
    this.drawMode = on;
    this.el.dataset.draw = on ? 'true' : 'false';
    this.opts.onDrawModeChange?.(on);
  }
  get drawing(): boolean {
    return this.drawMode;
  }

  private pushUndo(g: AreaGeom) {
    this.undoStack.push(clone(g));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(): void {
    const g = this.undoStack.pop();
    if (!g || !this.geom) return;
    this.redoStack.push(clone(this.geom));
    this.geom = g;
    this.focusAfterRender = true;
    this.renderOverlay();
    this.opts.onChange?.(g, 'commit', 'key');
  }
  redo(): void {
    const g = this.redoStack.pop();
    if (!g || !this.geom) return;
    this.undoStack.push(clone(this.geom));
    this.geom = g;
    this.focusAfterRender = true;
    this.renderOverlay();
    this.opts.onChange?.(g, 'commit', 'key');
  }

  focusArea(): void {
    this.svg.querySelector<SVGGElement>('.lz-area')?.focus();
  }

  /** Scale bar: length in px and metres, 1-2-5 steps between 80 and 160 px. */
  scaleBar(): { px: number; metres: number } {
    const target = 120 / this.ppm;
    const p = Math.pow(10, Math.floor(Math.log10(target)));
    let best = p;
    for (const m of [1, 2, 5, 10]) if (m * p * this.ppm <= 160) best = m * p;
    return { px: best * this.ppm, metres: best };
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.rasterTimer);
    this.ro.disconnect();
    window.removeEventListener('keydown', this.spaceDown);
    window.removeEventListener('keyup', this.spaceUp);
    this.el.remove();
  }
}

export function corners(g: AreaGeom): [number, number][] {
  const w = g.platesX * 32 * g.scale,
    h = g.platesY * 32 * g.scale;
  const t = (g.area.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t),
    s = Math.sin(t);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([u, v]) => [g.area.cx + u! * c - v! * s, g.area.cy + u! * s + v! * c]);
}

export function normAngle(d: number): number {
  let r = ((((d + 180) % 360) + 360) % 360) - 180;
  if (r === -180) r = 180;
  return Math.round(r * 10) / 10;
}

function clone(g: AreaGeom): AreaGeom {
  return { ...g, area: { ...g.area } };
}

function same(a: AreaGeom, b: AreaGeom): boolean {
  return (
    a.platesX === b.platesX &&
    a.platesY === b.platesY &&
    a.area.cx === b.area.cx &&
    a.area.cy === b.area.cy &&
    a.area.rotationDeg === b.area.rotationDeg
  );
}

/** Shades a height raster: tint by height above the lowest point, hillshade from the north-west. */
export function shade(r: PlanRaster): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r.width;
  c.height = r.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(r.width, r.height);
  const z = r.z;
  const W = r.width,
    H = r.height;
  const mpp = (r.maxX - r.minX) / W;
  const lo = [0xfb, 0xfa, 0xf6],
    hi = [0xa1, 0x9d, 0x95],
    ground = [0xde, 0xdb, 0xd4],
    edge = [0x85, 0x83, 0x7b];
  // ground level: lowest covered cell (terrain or building bases)
  let zMin = Infinity;
  for (let i = 0; i < z.length; i++) if (z[i]! < zMin) zMin = z[i]!;
  if (!Number.isFinite(zMin)) zMin = r.zMin;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = i * 4;
      const v = z[i]!;
      let col: number[];
      if (Number.isNaN(v)) col = ground;
      else {
        const tt = Math.min(1, Math.max(0, (v - zMin) / 100));
        col = [
          lo[0]! + (hi[0]! - lo[0]!) * tt,
          lo[1]! + (hi[1]! - lo[1]!) * tt,
          lo[2]! + (hi[2]! - lo[2]!) * tt,
        ];
        const zl = x > 0 ? z[i - 1]! : v,
          zu = y > 0 ? z[i - W]! : v;
        if (Number.isNaN(zl) || Number.isNaN(zu)) col = edge;
        else {
          // light from the north-west: brighter when the surface rises toward the light
          const dzdx = (v - zl) / mpp,
            dzdy = (v - zu) / mpp;
          const sh = Math.max(-0.35, Math.min(0.25, (-dzdx - dzdy) * 0.08));
          const step = Math.abs(v - zl) > 1.5 || Math.abs(v - zu) > 1.5;
          col = col.map((q) => q * (1 + sh) * (step ? 0.82 : 1));
        }
      }
      img.data[o] = col[0]!;
      img.data[o + 1] = col[1]!;
      img.data[o + 2] = col[2]!;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
