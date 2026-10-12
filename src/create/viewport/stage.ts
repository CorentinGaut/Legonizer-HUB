/**
 * The viewport of steps 1–4 (SPEC §7): always visible next to the step panel.
 * 1 source model (3D, auto-framed, bounding box sizes) · 2 plan view with the area tool (2D raster
 * + SVG, also in 3D) · 3 buildings in the area with brick-level guides and the buildings that
 * disappear · 4 brick preview (bricks with studs, plate labels, source ghost). Without WebGL 2 the
 * plan view and a 2D height map replace the 3D views (SPEC N2).
 */
import type { Object3D } from 'three';
import type * as ThreeModule from './three/index.ts';
import { t } from '../../shared/i18n.ts';
import type { MeshPreview } from '../../core/worker/protocol.ts';
import { areaCorners } from '../../core/heightmap/area.ts';
import { $, attr, esc, html, ic, reducedMotion, setHtml, toHtml } from '../dom.ts';
import { length, n } from '../format.ts';
import { isStale, sourceKey, type ProjectState } from '../state.ts';
import type { Ctx } from '../stepView.ts';
import { PlanView, type AreaGeom } from './plan.ts';
import { heightMap2dSvg } from './heightmap2d.ts';

export type StageMode = 'none' | 'placeholder' | 'source' | 'area' | 'settings' | 'bricks';
type ThreeMod = typeof ThreeModule;

export class Stage {
  private el: HTMLElement;
  private ctx: Ctx;
  private vp: HTMLElement;
  mode: StageMode = 'none';
  private three: ThreeMod | null = null;
  private view: InstanceType<ThreeMod['ThreeView']> | null = null;
  private plan: PlanView | null = null;
  private preview: { key: string; data: MeshPreview } | null = null;
  private previewPromise: Promise<MeshPreview | null> | null = null;
  private previewKey = '';
  private source: InstanceType<ThreeMod['SourceModel']> | null = null;
  private top = false;
  private ghost = false;
  private labels = true;
  private showFlags = true;
  private builtFor = '';
  private modeToken = 0;

  constructor(el: HTMLElement, ctx: Ctx) {
    this.el = el;
    this.ctx = ctx;
    setHtml(el, html`<div class="lz-viewport" id="lz-viewport"></div>`);
    this.vp = $('#lz-viewport', el)!;
    ctx.store.subscribe((_p, _t, changed) => this.onChange(changed));
    this.vp.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('fullscreenchange', () => {
      this.renderChrome();
      this.view?.resize();
    });
  }

  relabel(): void {
    this.builtFor = '';
    const m = this.mode;
    this.mode = 'none';
    this.show(m);
  }

  get webgl(): boolean {
    return this.ctx.store.t.webgl;
  }

  // ------------------------------------------------------------------ modes

  show(mode: StageMode): void {
    if (mode === this.mode) return;
    const token = ++this.modeToken;
    this.mode = mode;
    this.el.hidden = mode === 'none';
    this.el.setAttribute('aria-label', this.label());
    if (mode !== 'area' && mode !== 'settings' && this.plan) {
      this.plan.destroy();
      this.plan = null;
    }
    this.top = mode === 'area';
    this.builtFor = '';
    this.renderChrome();
    void this.build(token);
  }

  private label(): string {
    const m = this.mode;
    if (m === 'area') return t('a11y.viewport.area');
    // 2D mode (SPEC N2): the same places show top views, not 3D views
    const flat = !this.webgl;
    if (m === 'settings') return flat ? t('create.shell.view2d.settings') : t('a11y.viewport.settings');
    if (m === 'bricks') return flat ? t('create.shell.view2d.generate') : t('a11y.viewport.generate');
    return flat ? t('create.shell.view2d.import') : t('a11y.viewport.import');
  }

  private usesPlan(): boolean {
    const m = this.mode;
    if (m === 'area') return this.top || !this.webgl;
    if (m === 'settings' || m === 'source') return !this.webgl;
    return false;
  }

  private async build(token: number) {
    const p = this.ctx.store.p;
    const mode = this.mode;
    if (mode === 'none' || mode === 'placeholder' || (!p.summary && mode !== 'bricks')) {
      this.disposeThree();
      this.renderChrome();
      return;
    }
    if (mode === 'bricks' && !this.webgl) {
      this.disposeThree();
      this.renderChrome();
      return;
    }
    if (this.usesPlan()) {
      this.disposeThree();
      this.ensurePlan();
      this.renderChrome();
      return;
    }
    if (this.plan) {
      this.plan.destroy();
      this.plan = null;
    }
    // 3D
    if (!this.three) this.three = await import('./three/index.ts');
    if (token !== this.modeToken) return;
    if (!this.view) {
      const tri = p.summary?.stats.triangles ?? 0;
      this.view = new this.three.ThreeView(this.vp, {
        label: this.label(),
        shadows: tri < 400_000,
        fov: mode === 'bricks' ? 28 : 30,
      });
      this.view.onRender = () => this.updateHud();
    }
    this.view.canvas.setAttribute('aria-label', this.label());
    this.view.setTop(mode === 'area' ? false : this.top);
    await this.fill(token);
  }

  /** (Re)builds the 3D content of the current mode. */
  private async fill(token: number) {
    const three = this.three!;
    const view = this.view!;
    const p = this.ctx.store.p;
    const est = this.ctx.store.t.estimate;
    const mode = this.mode;
    if (mode === 'bricks') {
      const r = p.result;
      if (!r) {
        view.setContent([]);
        this.renderChrome();
        return;
      }
      const sig = `bricks:${r.generatedAt}:${r.packing.total}:${r.packing.tiles ?? 0}:${this.ghost}:${this.labels}:${p.baseplateColour}`;
      if (sig === this.builtFor) return;
      const firstBuild = !this.builtFor.startsWith('bricks:' + r.generatedAt);
      this.builtFor = sig;
      const { group, bounds } = three.buildBrickModel(r.packing.bricks, {
        platesX: r.params.platesX,
        platesY: r.params.platesY,
        baseplateColour: p.baseplateColour === 'white' ? 'white' : 'grey',
      });
      const objs: Object3D[] = [group];
      if (this.labels) objs.push(three.plateLabels(r.params.platesX, r.params.platesY, bounds.max.z));
      if (this.ghost && r.meta && Number.isFinite(r.meta.vertical.zBase)) {
        const preview = await this.getPreview();
        if (token !== this.modeToken) return;
        if (preview) {
          const g = r.meta.grid;
          const m = new three.Matrix4();
          // world (relative to the preview origin) → stud space of the brick model
          const c = Math.cos(-g.rotation),
            s = Math.sin(-g.rotation);
          const tx = preview.origin[0] - g.originX,
            ty = preview.origin[1] - g.originY;
          const kz = 1.2 / r.meta.vertical.metresPerBrick;
          m.set(
            c / g.stepX,
            -s / g.stepX,
            0,
            (c * tx - s * ty) / g.stepX,
            s / g.stepY,
            c / g.stepY,
            0,
            (s * tx + c * ty) / g.stepY,
            0,
            0,
            kz,
            (preview.origin[2] - r.meta.vertical.zBase) * kz,
            0,
            0,
            0,
            1,
          );
          objs.push(new three.SourceModel(preview, { ghost: true, transform: m }).mesh);
        }
      }
      view.setContent(objs, bounds);
      if (firstBuild) view.frame(bounds, { azimuth: -32, elevation: 40, margin: 1.05 });
      this.renderChrome();
      return;
    }
    const preview = await this.getPreview();
    if (token !== this.modeToken || !preview) return;
    const key = `${mode}:${this.previewKey}`;
    if (!this.source || this.builtFor.split('|')[0] !== this.previewKey) {
      this.source = new three.SourceModel(preview);
      this.builtFor = this.previewKey + '|';
    }
    const objs: Object3D[] = [this.source.mesh];
    const o = preview.origin;
    const g = this.geom();
    if ((mode === 'area' || mode === 'settings') && g) {
      const cs = areaCorners(g.area, { platesX: g.platesX, platesY: g.platesY, scale: g.scale }).map(
        ([x, y]) => [x - o[0], y - o[1]] as [number, number],
      );
      objs.push(three.polygonOutline(cs, 0.05, '#3742C4'));
      if (mode === 'settings' && est && Number.isFinite(est.metresPerBrick) && est.metresPerBrick > 0) {
        const xs = cs.map((c) => c[0]),
          ys = cs.map((c) => c[1]);
        const z0 = (Number.isFinite(est.zBase) ? est.zBase : p.summary!.bounds.min[2]) - o[2];
        const levels = Math.min(200, Math.max(1, est.maxBricks || p.params.maxHeight));
        objs.push(
          three.brickGuides(
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs),
            Math.max(...ys),
            z0,
            est.metresPerBrick,
            levels,
            '#3742C4',
          ),
        );
      }
    }
    // flags: outside (dimmed), disappearing (hatched), included whole (amber)
    if (mode === 'settings' && est) {
      const flags = new Uint8Array(p.summary!.stats.features).fill(2);
      for (const f of est.selected) flags[f] = 0;
      if (this.showFlags) for (const f of est.below) flags[f] = 1;
      this.source.setFlags(flags);
      three.setStripeWidth(this.source.mesh, Math.max(1, (est.metresPerBrick || 6) / 3));
    } else this.source.setFlags(null);
    view.setContent(objs, undefined);
    if (this.lastFramed !== key) {
      this.lastFramed = key;
      if (mode === 'source') view.frame(undefined, { azimuth: -28, elevation: 34, margin: 1.1 });
      else if (g) {
        const cs = areaCorners(g.area, { platesX: g.platesX, platesY: g.platesY, scale: g.scale });
        const box = new three.Box3();
        for (const [x, y] of cs) box.expandByPoint(new three.Vector3(x - o[0], y - o[1], 0));
        const top =
          est && Number.isFinite(est.zBase)
            ? est.zBase - o[2] + est.metresPerBrick * Math.max(1, est.maxBricks)
            : 30;
        box.expandByPoint(new three.Vector3(cs[0]![0] - o[0], cs[0]![1] - o[1], Math.max(10, top)));
        view.frame(box, { azimuth: -32, elevation: mode === 'settings' ? 27 : 45, margin: 1.2 });
      }
    }
    this.renderChrome();
  }
  private lastFramed = '';

  private async getPreview(): Promise<MeshPreview | null> {
    const p = this.ctx.store.p;
    const key = `${sourceKey(p)}:${p.summary?.stats.triangles}`;
    if (this.preview && this.preview.key === key) return this.preview.data;
    if (this.previewPromise && this.previewKey === key) return this.previewPromise;
    if (!this.ctx.store.t.engineReady) return null;
    this.previewKey = key;
    this.previewPromise = this.ctx.engine
      .request('mesh-preview', {})
      .promise.then((data) => {
        this.preview = { key, data };
        this.source = null;
        return data;
      })
      .catch(() => null)
      .finally(() => (this.previewPromise = null));
    return this.previewPromise;
  }

  private disposeThree() {
    if (this.view) {
      this.view.dispose();
      this.view = null;
      this.source = null;
      this.lastFramed = '';
    }
  }

  // ------------------------------------------------------------------ plan view (step 2, 2D mode)

  private geom(): AreaGeom | null {
    const p = this.ctx.store.p;
    if (!p.area) return null;
    return { area: p.area, platesX: p.params.platesX, platesY: p.params.platesY, scale: p.params.scale };
  }

  private ensurePlan() {
    const p = this.ctx.store.p;
    if (!p.summary) return;
    const editable = this.mode === 'area';
    if (this.plan && this.plan.el.isConnected && this.planEditable === editable) {
      this.plan.setArea(this.geom());
      this.updatePlanOverlays();
      return;
    }
    this.plan?.destroy();
    this.planEditable = editable;
    this.plan = new PlanView(this.vp, {
      editable,
      bounds: p.summary.bounds,
      strings: {
        rectangleName: (g) =>
          t('create.area.viewport.rectangleName', {
            x: g.platesX,
            y: g.platesY,
            cx: n(g.area.cx, 0),
            cy: n(g.area.cy, 0),
            r: n(g.area.rotationDeg, 1),
          }),
        dimension: (count, m) => t('create.area.viewport.dimension', { count, m: n(m, 0) }),
        angle: (d) => t('create.area.viewport.angleLabel', { value: n(d, 0) }),
        drawLabel: (x, y, w, d) => t('create.area.viewport.drawLabel', { x, y, w: n(w, 0), d: n(d, 0) }),
        max16: t('create.area.viewport.max16'),
        imgLabel: t('a11y.viewport.area'),
      },
      requestRaster: (req) => this.ctx.engine.request('plan-raster', { request: req }).promise,
      onChange: (g, phase, what) => this.onPlanChange(g, phase, what),
      onDrawModeChange: () => this.renderChrome(),
      onViewChange: () => this.updateHud(),
    });
    this.plan.setArea(this.geom());
    this.updatePlanOverlays();
    if (editable) this.plan.fitArea();
  }
  private planEditable = false;

  private onPlanChange(g: AreaGeom, phase: 'live' | 'commit' | 'cancel', what: string) {
    const st = this.ctx.store;
    st.set({
      area: { ...g.area },
      areaOrigin: 'user',
      params: { ...st.p.params, platesX: g.platesX, platesY: g.platesY },
    });
    if (phase === 'commit' || phase === 'cancel') {
      const msg =
        phase === 'cancel'
          ? t('create.area.viewport.cancelled')
          : what === 'resize' || what === 'draw'
            ? t('create.area.viewport.resized', { x: g.platesX, y: g.platesY })
            : what === 'rotate'
              ? t('create.area.viewport.rotated', { r: n(g.area.rotationDeg, 1) })
              : t('create.area.viewport.moved', { cx: n(g.area.cx, 0), cy: n(g.area.cy, 0) });
      const live = $('#lz-vp-live', this.vp);
      if (live) live.textContent = msg;
    }
  }

  private updatePlanOverlays() {
    if (!this.plan) return;
    const p = this.ctx.store.p;
    const est = this.ctx.store.t.estimate;
    const g = this.geom();
    let sampled: [number, number][] | null = null;
    if (g && p.params.rotation === 'aabb' && Math.abs(g.area.rotationDeg % 180) > 1e-9) {
      const cs = areaCorners(g.area, g);
      const xs = cs.map((c) => c[0]),
        ys = cs.map((c) => c[1]);
      const x0 = Math.min(...xs),
        x1 = Math.max(...xs),
        y0 = Math.min(...ys);
      // legacy grid: square step from the X extent (L3, L9)
      const step = (x1 - x0) / 32 / g.platesX;
      const y1 = y0 + step * 32 * g.platesY;
      sampled = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ];
    }
    const included: number[][] = [];
    const disappearing: number[][] = [];
    if (est && g) {
      const cs = areaCorners(g.area, g);
      const xs = cs.map((c) => c[0]),
        ys = cs.map((c) => c[1]);
      const ax0 = Math.min(...xs),
        ax1 = Math.max(...xs),
        ay0 = Math.min(...ys),
        ay1 = Math.max(...ys);
      const below = new Set(est.below);
      for (let k = 0; k < est.selected.length; k++) {
        const b = [...est.selectedBoxes.subarray(k * 4, k * 4 + 4)];
        if (p.params.selection === 'touching' && (b[0]! < ax0 || b[1]! < ay0 || b[2]! > ax1 || b[3]! > ay1))
          included.push(b);
        if (this.mode === 'settings' && below.has(est.selected[k]!)) disappearing.push(b);
      }
    }
    const tallest =
      est?.tallestInfo && p.params.heightMode === 'normalized'
        ? {
            x: est.tallestInfo.x,
            y: est.tallestInfo.y,
            label: t('create.area.viewport.tallest', { h: n(est.tallestInfo.height, 0) }),
          }
        : null;
    this.plan.setOverlays({ sampled, included, tallest, disappearing });
  }

  // ------------------------------------------------------------------ state changes

  private onChange(changed: Set<string>) {
    const m = this.mode;
    if (m === 'none') return;
    if (changed.has('summary') || changed.has('t.engineReady')) {
      if (changed.has('summary')) {
        this.preview = null;
        this.source = null;
        this.lastFramed = '';
        this.plan?.destroy();
        this.plan = null;
      }
      void this.build(++this.modeToken);
      return;
    }
    if (this.plan && (changed.has('area') || changed.has('params'))) {
      this.plan.setArea(this.geom());
      this.updatePlanOverlays();
    }
    if (this.plan && changed.has('t.estimate')) this.updatePlanOverlays();
    if (
      this.view &&
      (m === 'area' || m === 'settings') &&
      (changed.has('area') || changed.has('params') || changed.has('t.estimate'))
    )
      void this.fill(this.modeToken);
    if (m === 'bricks' && (changed.has('result') || changed.has('baseplateColour'))) {
      if (this.webgl) void this.build(this.modeToken);
    }
    if (
      changed.has('t.generating') ||
      changed.has('result') ||
      changed.has('area') ||
      changed.has('params') ||
      changed.has('t.estimate')
    )
      this.renderChrome();
  }

  // ------------------------------------------------------------------ chrome (toolbar, legend, banners)

  private renderChrome() {
    const p = this.ctx.store.p;
    const tr = this.ctx.store.t;
    const m = this.mode;
    const vp = this.vp;
    vp.dataset.mode = m;
    const stale = m === 'bricks' && isStale(p) && !!p.result;
    vp.dataset.stale = String(stale);
    const keep = new Set<Element>([this.view?.canvas, this.plan?.el].filter(Boolean) as Element[]);
    for (const c of [...vp.children]) if (!keep.has(c)) c.remove();
    const chrome = document.createElement('div');
    chrome.className = 'lz-vp-chrome';
    const has3d = !!this.view;
    const hasModel = !!p.summary || (m === 'bricks' && !!p.result);
    const parts: string[] = [];
    const placeholder =
      m === 'placeholder' ||
      (!hasModel && m !== 'none') ||
      (m === 'bricks' && !p.result) ||
      (m === 'source' && !this.webgl && !this.plan);
    if (placeholder) {
      parts.push(
        toHtml(
          html`<div class="lz-viewport__placeholder" aria-hidden="true"></div>
            <div class="lz-viewport__placeholder-text">
              ${ic('view-3d', 'xl')}
              <p>
                ${m === 'bricks' && p.result === null && tr.generating ? t('create.generate.running.title') : t('create.shell.viewportPlaceholder')}
              </p>
            </div>`,
        ),
      );
    }
    if (!this.webgl && !tr.webglDismissed && m !== 'none') {
      parts.push(
        toHtml(
          html`<div class="lz-vp-banner lz-vp-banner--top">
            <div class="lz-alert" role="status">
              ${ic('cube-off')}
              <div class="lz-alert__body">
                <p class="lz-alert__title">${t('create.shell.webgl.title')}</p>
                <p>${t('create.shell.webgl.body')}</p>
                <button type="button" class="lz-btn lz-btn--tertiary lz-btn--sm" data-vp="dismiss-webgl">
                  ${t('create.shell.webgl.dismiss')}
                </button>
              </div>
            </div>
          </div>`,
        ),
      );
    }
    // toolbar
    if (!placeholder && hasModel) {
      const tb: string[] = [];
      if (has3d)
        tb.push(
          toHtml(
            html`<button
                type="button"
                class="lz-btn lz-btn--icon"
                data-vp="reset"
                aria-label="${t('create.shell.toolbar.resetView')}"
                title="${t('create.shell.toolbar.resetView')}"
              >
                ${ic('reset-view')}</button
              ><span class="lz-vp-sep"></span>`,
          ),
        );
      if (this.webgl && m !== 'bricks' && !(m === 'settings')) {
        tb.push(
          toHtml(
            html`<button type="button" class="lz-btn" data-vp="top" aria-pressed="${String(this.top)}">
                ${ic('view-top', 'sm')}${t('create.shell.toolbar.topView')}</button
              ><button type="button" class="lz-btn" data-vp="3d" aria-pressed="${String(!this.top)}">
                ${ic('view-3d', 'sm')}${t('create.shell.toolbar.view3d')}
              </button>`,
          ),
        );
      }
      if (this.webgl && m === 'bricks') {
        tb.push(
          toHtml(
            html`<button type="button" class="lz-btn" data-vp="top" aria-pressed="${String(this.top)}">
                ${ic('view-top', 'sm')}${t('create.shell.toolbar.topView')}</button
              ><button type="button" class="lz-btn" data-vp="3d" aria-pressed="${String(!this.top)}">
                ${ic('view-3d', 'sm')}${t('create.shell.toolbar.view3d')}</button
              ><span class="lz-vp-sep"></span>
              <label class="lz-switch"
                ><input
                  type="checkbox"
                  data-vp="ghost"
                  ${attr('checked', this.ghost)}${attr('disabled', !p.result?.meta || !Number.isFinite(p.result.meta.vertical.zBase) || !tr.engineReady)}
                />${t('create.generate.done.toolbar.ghost')}</label
              >
              <label class="lz-switch"
                ><input
                  type="checkbox"
                  data-vp="labels"
                  ${attr('checked', this.labels)}
                />${t('create.generate.done.toolbar.labels')}</label
              >`,
          ),
        );
      }
      if (m === 'area' && this.plan) {
        tb.push(
          toHtml(
            html`<span class="lz-vp-sep"></span
              ><button
                type="button"
                class="lz-btn"
                data-vp="draw"
                aria-pressed="${String(this.plan.drawing)}"
                aria-keyshortcuts="D"
              >
                ${ic('draw-area', 'sm')}${t('create.area.tools.draw')}
                <kbd>${t('create.area.tools.drawShortcut')}</kbd></button
              ><button type="button" class="lz-btn" data-vp="fit">
                ${ic('fit', 'sm')}${t('create.area.tools.fit')}
              </button>`,
          ),
        );
      }
      const right: string[] = [];
      if (this.plan || has3d)
        right.push(
          toHtml(
            html`<button
                type="button"
                class="lz-btn lz-btn--icon"
                data-vp="zoom-in"
                aria-label="${t('create.shell.toolbar.zoomIn')}"
                title="${t('create.shell.toolbar.zoomIn')}"
              >
                ${ic('zoom-in')}</button
              ><button
                type="button"
                class="lz-btn lz-btn--icon"
                data-vp="zoom-out"
                aria-label="${t('create.shell.toolbar.zoomOut')}"
                title="${t('create.shell.toolbar.zoomOut')}"
              >
                ${ic('zoom-out')}</button
              ><span class="lz-vp-sep"></span>`,
          ),
        );
      const fs = !!document.fullscreenElement;
      right.push(
        toHtml(
          html`<button
            type="button"
            class="lz-btn lz-btn--icon"
            data-vp="fullscreen"
            aria-label="${fs ? t('create.shell.toolbar.exitFullScreen') : t('create.shell.toolbar.fullScreen')}"
            title="${fs ? t('create.shell.toolbar.exitFullScreen') : t('create.shell.toolbar.fullScreen')}"
          >
            ${ic(fs ? 'fullscreen-exit' : 'fullscreen')}
          </button>`,
        ),
      );
      parts.push(
        `<div class="lz-vp-toolbar"><div class="lz-vp-group" role="toolbar" aria-label="${esc(t('create.shell.toolbar.label'))}">${tb.join('')}</div><span class="lz-vp-toolbar__spacer"></span><div class="lz-vp-group" role="toolbar" aria-label="${esc(t('create.shell.toolbar.label'))}">${right.join('')}</div></div>`,
      );
      if (m === 'area' && this.plan?.drawing)
        parts.push(
          toHtml(
            html`<div class="lz-vp-banner">
              <div class="lz-toast lz-toast--inline" role="status">
                ${ic('draw-area')}<span class="lz-toast__msg">${t('create.area.tools.drawHint')}</span>
              </div>
            </div>`,
          ),
        );
    }
    // 2D height map (step 4 without WebGL)
    if (m === 'bricks' && !this.webgl && p.result) {
      parts.push(
        `<div class="lz-hm2d">${heightMap2dSvg(p.result.heightMap, p.result.params.platesY, t('create.generate.done.view2d'))}</div>`,
      );
    }
    // legend + scale bar + compass
    if (!placeholder && hasModel) {
      const legend: string[] = [];
      if (m === 'area') {
        legend.push(
          toHtml(
            html`<span class="lz-legend__item"
              ><span class="lz-swatch lz-swatch--area"></span>${t('create.area.viewport.legend.area')}</span
            >`,
          ),
        );
        if (p.params.selection === 'touching')
          legend.push(
            toHtml(
              html`<span class="lz-legend__item"
                ><span class="lz-swatch lz-swatch--dashed" style="--sw: var(--lz-viz-included-whole)"></span
                >${t('create.area.viewport.legend.includedWhole')}</span
              >`,
            ),
          );
        if (p.params.rotation === 'aabb' && p.area && Math.abs(p.area.rotationDeg % 180) > 1e-9)
          legend.push(
            toHtml(
              html`<span class="lz-legend__item"
                ><span class="lz-swatch lz-swatch--dashed" style="--sw: var(--lz-viz-sampled-stroke)"></span
                >${t('create.area.viewport.legend.sampled')}</span
              >`,
            ),
          );
      } else if (m === 'settings') {
        const est = tr.estimate;
        if (est && Number.isFinite(est.metresPerBrick))
          legend.push(
            toHtml(
              html`<span class="lz-legend__item"
                ><span class="lz-swatch lz-swatch--line" style="--sw: var(--lz-color-accent)"></span
                >${t('create.settings.viewport.guides', { m: n(est.metresPerBrick, est.metresPerBrick < 10 ? 1 : 0) })}</span
              >`,
            ),
          );
        if (est && est.featuresBelowOneBrick > 0)
          legend.push(
            toHtml(
              html`<span class="lz-legend__item"
                ><span class="lz-swatch lz-swatch--hatch" style="--sw: var(--lz-viz-disappear)"></span
                >${t('create.settings.viewport.legendDisappears')}</span
              >`,
            ),
          );
      } else if (m === 'bricks' && this.webgl) {
        legend.push(
          toHtml(
            html`<span class="lz-legend__item"
                ><span class="lz-swatch" style="--sw: #f4f2ec"></span
                >${t('create.generate.done.legend.bricks')}</span
              ><span class="lz-legend__item"
                ><span
                  class="lz-swatch"
                  style="--sw: ${p.baseplateColour === 'white' ? '#ECEBE6' : 'var(--lz-baseplate-top)'}"
                ></span
                >${t('create.generate.done.legend.baseplates')}</span
              >`,
          ),
        );
      } else if (m === 'bricks') {
        legend.push(
          toHtml(
            html`<span class="lz-legend__title"
              >${t('create.generate.done.view2d')} · ${t('exports.pdf.heightLegend')}</span
            >`,
          ),
        );
      }
      parts.push(
        `<div class="lz-vp-bottom">${legend.length ? `<div class="lz-legend" role="group" aria-label="${esc(t('create.shell.toolbar.legend'))}">${legend.join('')}</div>` : ''}<span class="u-grow"></span><div class="lz-scalebar" role="img" id="lz-scalebar" hidden></div><div class="lz-compass" role="img" aria-label="${esc(t('create.shell.compass'))}" id="lz-compass"><span class="lz-compass__n" aria-hidden="true">N</span><svg aria-hidden="true"><use href="#i-north"/></svg></div></div>`,
      );
    }
    if (stale)
      parts.push(
        toHtml(
          html`<div class="lz-vp-label" role="status">
            ${ic('warning')}${t('create.stale.previewLabel')}
          </div>`,
        ),
      );
    if (m === 'bricks' && tr.generating?.visible)
      parts.push(
        toHtml(
          html`<div class="lz-vp-label lz-vp-label--busy">
            <span class="lz-stages__spinner" aria-hidden="true"></span
            >${t('create.generate.running.label', { value: Math.round(tr.generating.fraction * 100) })}
          </div>`,
        ),
      );
    parts.push('<p class="lz-visually-hidden" aria-live="polite" id="lz-vp-live"></p>');
    chrome.innerHTML = parts.join('');
    vp.append(...chrome.childNodes);
    vp.dataset.busy = String(!!tr.generating && m === 'bricks');
    if (this.plan) this.plan.el.setAttribute('aria-label', this.label());
    this.updateHud();
  }

  /** Scale bar and compass. */
  private updateHud() {
    const sb = $('#lz-scalebar', this.vp);
    const compass = $('#lz-compass', this.vp);
    let bearing = 0;
    if (this.plan && sb) {
      const s = this.plan.scaleBar();
      sb.hidden = false;
      const label = s.metres >= 1000 ? `${n(s.metres / 1000, 1)} km` : `${n(s.metres, 0)} m`;
      sb.setAttribute('aria-label', t('create.shell.scaleBar', { value: label }));
      sb.innerHTML = `<div class="lz-scalebar__bar" style="--len: ${Math.round(s.px)}px"></div><div class="lz-scalebar__labels"><span>0</span><span>${esc(label)}</span></div>`;
    } else if (sb) sb.hidden = true;
    if (this.view) bearing = this.view.bearing();
    const svg = compass?.querySelector('svg');
    if (svg) (svg as SVGElement).style.setProperty('--bearing', `${-bearing}deg`);
    // bounding box sizes (step 1)
    const old = this.vp.querySelectorAll('.lz-bbox-label');
    old.forEach((e) => e.remove());
    if (this.mode === 'source' && this.view && this.three) {
      const s = this.ctx.store.p.summary;
      if (!s) return;
      const V = this.three.Vector3;
      const hx = s.size[0] / 2,
        hy = s.size[1] / 2,
        h = s.size[2];
      const pts: [InstanceType<typeof V>, string][] = [
        [new V(0, -hy, 0), length(s.size[0])],
        [new V(hx, 0, 0), length(s.size[1])],
        [new V(-hx, -hy, h / 2), length(s.size[2])],
      ];
      for (const [v, label] of pts) {
        const q = this.view.project(v);
        if (!q.visible) continue;
        const span = document.createElement('span');
        span.className = 'lz-bbox-label';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = label;
        span.style.left = `${Math.round(q.x)}px`;
        span.style.top = `${Math.round(q.y)}px`;
        this.vp.append(span);
      }
    }
  }

  // ------------------------------------------------------------------ toolbar actions

  private onClick(e: Event) {
    const b = (e.target as Element).closest<HTMLElement>('[data-vp]');
    if (!b) return;
    const a = b.dataset.vp;
    switch (a) {
      case 'reset':
        this.view?.reset();
        break;
      case 'top':
      case '3d': {
        const top = a === 'top';
        if (top === this.top) return;
        this.top = top;
        this.lastFramed = '';
        void this.build(++this.modeToken);
        break;
      }
      case 'draw':
        this.plan?.setDrawMode(!this.plan.drawing);
        this.renderChrome();
        break;
      case 'fit':
        this.plan?.fitModel();
        break;
      case 'zoom-in':
        if (this.plan) this.plan.zoomBy(1.4);
        else this.view?.zoom(1.25);
        break;
      case 'zoom-out':
        if (this.plan) this.plan.zoomBy(1 / 1.4);
        else this.view?.zoom(0.8);
        break;
      case 'fullscreen':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void this.vp.requestFullscreen?.().catch(() => {});
        break;
      case 'ghost':
        this.ghost = (b as HTMLInputElement).checked;
        void this.fill(this.modeToken);
        return;
      case 'labels':
        this.labels = (b as HTMLInputElement).checked;
        void this.fill(this.modeToken);
        return;
      case 'dismiss-webgl':
        this.ctx.store.setT({ webglDismissed: true });
        this.renderChrome();
        break;
    }
  }

  /** Keyboard shortcut D (viewport focused only, WCAG 2.1.4). */
  handleKey(e: KeyboardEvent): boolean {
    if (
      this.mode === 'area' &&
      this.plan &&
      (e.key === 'd' || e.key === 'D') &&
      this.vp.contains(document.activeElement)
    ) {
      this.plan.setDrawMode(!this.plan.drawing);
      this.renderChrome();
      return true;
    }
    return false;
  }

  /** "Show them in the 3D view": the buildings that disappear (SPEC §7.3). */
  setShowFlags(on: boolean): void {
    this.showFlags = on;
    if (this.view && this.mode === 'settings') void this.fill(this.modeToken);
  }

  focusArea(): void {
    this.plan?.focusArea();
  }

  centreOnModel(): void {
    const s = this.ctx.store.p.summary;
    if (!s) return;
    const st = this.ctx.store;
    st.set({
      area: {
        ...st.p.area!,
        cx: (s.bounds.min[0] + s.bounds.max[0]) / 2,
        cy: (s.bounds.min[1] + s.bounds.max[1]) / 2,
      },
    });
    this.plan?.fitArea();
  }

  static reduced(): boolean {
    return reducedMotion();
  }
}

export type { ProjectState };
