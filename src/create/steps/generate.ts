/**
 * Step 4 — Generate (SPEC G1–G4, ux-spec §5.4, §6.3, §7.5, mockups/create-4-generate.html):
 * ready, running (stages, bar, elapsed, cancel; shown after 400 ms), done (key figures, histogram,
 * per-plate summary, height grid table), warnings, empty model, error, out of date.
 */
import { t } from '../../shared/i18n.ts';
import { plateHeights } from '../../core/export/guide.ts';
import { $, attr, html, ic, raw, setHtml, type Raw } from '../dom.ts';
import { n, seconds } from '../format.ts';
import { isStale, presetOf } from '../state.ts';
import type { Ctx, PrimaryAction, StepView } from '../stepView.ts';
import { rampStep } from '../viewport/heightmap2d.ts';
import { changeLabel, staleBanner } from './common.ts';
import { staleChanges } from '../state.ts';

export function presetName(preset: ReturnType<typeof presetOf>): string {
  return preset === 'legacy'
    ? t('create.settings.preset.legacy.name')
    : preset === 'legacyKeepSmall'
      ? t('create.settings.preset.legacyKeepSmall.name')
      : preset === 'trueScale'
        ? t('create.settings.preset.trueScale.name')
        : t('create.settings.preset.custom.name');
}

/** Height grid table of one plate (N3, components §22): rows north → south, columns west → east. */
export function heightGridTable(heights: Int32Array, max: number, plate: string): Raw {
  const head: Raw[] = [];
  for (let i = 1; i <= 32; i++) head.push(html`<th scope="col">${i}</th>`);
  const rows: Raw[] = [];
  for (let r = 0; r < 32; r++) {
    const cells: string[] = [];
    for (let c = 0; c < 32; c++) {
      const v = heights[(31 - r) * 32 + c]!;
      cells.push(`<td data-h="${rampStep(v, max)}">${v}</td>`);
    }
    // cells are numbers only: trusted markup
    rows.push(
      html`<tr>
        <th scope="row">${r + 1}</th>
        ${raw(cells.join(''))}
      </tr>`,
    );
  }
  return html`<table class="lz-heightgrid">
    <caption class="lz-visually-hidden">
      ${t('create.generate.done.grid.caption', { plate })}
    </caption>
    <thead>
      <tr>
        <th scope="col"><span class="lz-visually-hidden">${t('create.generate.done.grid.row')}</span></th>
        ${head}
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}
export class GenerateStep implements StepView {
  readonly id = 'generate' as const;
  private ctx: Ctx;
  private panel!: HTMLElement;
  private sig = '';
  private gridPlate: string | null = null;
  private showHistTable = false;
  private timer = 0;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  mount(panel: HTMLElement): void {
    this.panel = panel;
    this.render(true);
    panel.addEventListener('click', this.onClick);
    panel.addEventListener('change', this.onChange);
    panel.addEventListener('keydown', this.onKey);
    this.ctx.stage.show('bricks');
    this.timer = window.setInterval(() => {
      if (this.ctx.store.t.generating?.visible) this.render(false);
    }, 500);
  }

  unmount(): void {
    clearInterval(this.timer);
    this.panel.removeEventListener('click', this.onClick);
    this.panel.removeEventListener('change', this.onChange);
    this.panel.removeEventListener('keydown', this.onKey);
    this.panel.innerHTML = '';
  }

  update(changed: Set<string>): void {
    if (
      changed.has('t.generating') ||
      changed.has('t.generateError') ||
      changed.has('result') ||
      changed.has('params') ||
      changed.has('area') ||
      changed.has('t.estimate')
    ) {
      const wasState = this.state;
      this.render(false);
      if (
        wasState !== this.state &&
        (this.state === 'done' ||
          this.state === 'error' ||
          this.state === 'running' ||
          this.state === 'empty')
      )
        requestAnimationFrame(() => $<HTMLElement>('#step-title', this.panel)?.focus());
    }
  }

  private state: 'ready' | 'running' | 'done' | 'empty' | 'error' = 'ready';

  private computeState() {
    const p = this.ctx.store.p;
    const tr = this.ctx.store.t;
    if (tr.generating?.visible) return 'running';
    if (tr.generating && !p.result) return 'running';
    if (tr.generateError) return 'error';
    if (p.result) return p.result.packing.total === 0 ? 'empty' : 'done';
    return 'ready';
  }

  primary(): PrimaryAction {
    const p = this.ctx.store.p;
    const st = this.computeState();
    const a = this.ctx.actions;
    if (st === 'running')
      return {
        label: t('create.generate.running.cancel'),
        kind: 'secondary',
        icon: 'x',
        run: () => a.cancelGenerate(),
      };
    if (st === 'error')
      return { label: t('common.actions.tryAgain'), icon: 'refresh', run: () => void a.generate() };
    if (st === 'ready')
      return { label: t('create.generate.ready.cta'), run: () => void a.generate(), disabled: !p.area };
    if (isStale(p))
      return {
        label: t('create.stale.regenerate'),
        icon: 'refresh',
        run: () => void a.generate(),
        disabled: !!this.ctx.store.t.generating,
      };
    if (st === 'empty')
      return {
        label: t('create.generate.empty.back'),
        icon: 'arrow-left',
        run: () => this.ctx.go('settings', { focus: true }),
      };
    return {
      label: t('create.shell.primary.generate'),
      short: t('create.stepper.steps.guide'),
      run: () => this.ctx.go('guide', { focus: true }),
    };
  }

  // ------------------------------------------------------------------ render

  private render(initial: boolean) {
    const p = this.ctx.store.p;
    const tr = this.ctx.store.t;
    this.state = this.computeState();
    const g = tr.generating;
    const sig = JSON.stringify([
      this.state,
      g && {
        s: g.stage,
        r: g.rows,
        pl: g.plates,
        f: Math.round(g.fraction * 100),
        e: Math.floor((performance.now() - g.started) / 500),
      },
      tr.generateError,
      p.result?.generatedAt,
      p.result?.packing.total,
      isStale(p),
      staleChanges(p).length,
      this.gridPlate,
      this.showHistTable,
      tr.estimate?.featuresBelowOneBrick,
    ]);
    if (sig === this.sig && !initial) return;
    const runningUpdate = this.sig && JSON.parse(this.sig)[0] === 'running' && this.state === 'running';
    this.sig = sig;
    if (runningUpdate) {
      const box = $('#lz-gen-running', this.panel);
      if (box) {
        setHtml(box, this.runningInner());
        this.ctx.renderActionbar();
        return;
      }
    }
    let body: Raw;
    switch (this.state) {
      case 'running':
        body = html`<div class="lz-stack" id="lz-gen-running" aria-live="polite">
          ${this.runningInner()}
        </div>`;
        break;
      case 'error':
        body = this.errorHtml();
        break;
      case 'empty':
        body = this.emptyHtml();
        break;
      case 'done':
        body = this.doneHtml();
        break;
      default:
        body = this.readyHtml();
    }
    setHtml(this.panel, html`${staleBanner(p, !!tr.generating)}${body}`);
    this.ctx.renderActionbar();
  }

  private readyHtml(): Raw {
    const p = this.ctx.store.p;
    const preset = presetOf(p.params, p.summary?.groundAvailable ?? false);
    return html`<div class="lz-stack">
      <div class="lz-panel__head">
        <h1 id="step-title" tabindex="-1">${t('create.generate.ready.title')}</h1>
        <p class="lz-muted">
          ${t('create.generate.ready.summary', { x: p.params.platesX, y: p.params.platesY, scale: n(p.params.scale, 2), preset: presetName(preset) })}
        </p>
      </div>
      <p>${t('create.generate.ready.lead')}</p>
      <button
        type="button"
        class="lz-btn lz-btn--primary lz-btn--lg"
        data-a="generate"
        style="align-self:flex-start"
      >
        ${t('create.generate.ready.cta')}
      </button>
    </div>`;
  }

  private runningInner(): Raw {
    const g = this.ctx.store.t.generating;
    if (!g) return html``;
    const order = ['select', 'index', 'sample', 'quantize', 'pack'] as const;
    const idx = Math.max(0, order.indexOf(g.stage as (typeof order)[number]));
    const label = (s: (typeof order)[number]) =>
      s === 'sample'
        ? t('create.generate.running.stages.sample', { done: g.rows[0], total: g.rows[1] })
        : s === 'pack'
          ? t('create.generate.running.stages.pack', { done: g.plates[0], total: g.plates[1] })
          : t(`create.generate.running.stages.${s}`);
    const pct = Math.round(g.fraction * 100);
    const elapsed = performance.now() - g.started;
    return html`<div class="lz-panel__head">
        <h1 id="step-title" tabindex="-1">${t('create.generate.running.title')}</h1>
      </div>
      <ul class="lz-stages">
        ${order.map((s, i) =>
          i < idx
            ? html`<li class="is-done">${ic('check-circle')}${label(s)}</li>`
            : i === idx
              ? html`<li class="is-current">
                  <span class="lz-stages__spinner" aria-hidden="true"></span>${label(s)}
                </li>`
              : html`<li><span class="lz-stages__pending" aria-hidden="true"></span>${label(s)}</li>`,
        )}
      </ul>
      <div class="lz-progress">
        <div
          class="lz-progress__track"
          role="progressbar"
          aria-label="${t('create.generate.running.title')}"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="${pct}"
        >
          <div class="lz-progress__fill" style="--value: ${pct}%"></div>
        </div>
        <div class="lz-progress__meta">
          <span>${t('create.generate.running.percent', { value: pct })}</span
          ><span
            >${elapsed >= 2000 ? t('create.generate.running.elapsed', { value: seconds(elapsed) }) : ''}</span
          >
        </div>
      </div>
      <button type="button" class="lz-btn lz-btn--secondary" data-a="cancel" style="align-self:flex-start">
        ${t('create.generate.running.cancel')}
      </button>`;
  }

  private errorHtml(): Raw {
    const e = this.ctx.store.t.generateError!;
    return html`<div class="lz-alert lz-alert--danger" role="alert">
      ${ic('x-circle')}
      <div class="lz-alert__body">
        <h1 class="lz-alert__title" id="step-title" tabindex="-1">${e.title}</h1>
        <p>${e.body}</p>
        <div class="lz-cluster">
          ${e.oom ? html`<button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-a="fewer">${t('create.generate.errors.outOfMemory.action')}</button>` : ''}<button
            type="button"
            class="lz-btn lz-btn--primary lz-btn--sm"
            data-a="generate"
          >
            ${t('common.actions.tryAgain')}
          </button>
        </div>
        <details class="lz-disclosure lz-disclosure--inline">
          <summary>${t('common.actions.technicalDetails')}</summary>
          <p class="lz-mono lz-xsmall u-mt-2">${e.details}</p>
        </details>
      </div>
    </div>`;
  }

  private emptyHtml(): Raw {
    return html`<div class="lz-stack">
      <div class="lz-panel__head">
        <h1 id="step-title" tabindex="-1">${t('create.generate.empty.title')}</h1>
        <p class="lz-muted">${t('create.generate.empty.body')}</p>
      </div>
      <div class="lz-cluster">
        <button type="button" class="lz-btn lz-btn--secondary" data-a="fix-keep">
          ${t('create.generate.empty.keepSmall')}</button
        ><button type="button" class="lz-btn lz-btn--secondary" data-a="fix-true">
          ${t('create.generate.empty.trueScale')}</button
        ><button type="button" class="lz-btn lz-btn--tertiary" data-a="move">
          ${t('create.generate.empty.moveArea')}
        </button>
      </div>
    </div>`;
  }

  private doneHtml(): Raw {
    const p = this.ctx.store.p;
    const tr = this.ctx.store.t;
    const r = p.result!;
    const q = r.params;
    const max = r.packing.plates.reduce((a, pl) => Math.max(a, pl.layers), 0);
    const preset = presetOf(q, p.summary?.groundAvailable ?? false);
    // histogram (G3)
    const counts: number[] = [];
    for (const v of r.heightMap.data) counts[v] = (counts[v] ?? 0) + 1;
    const bins: { label: string; count: number; step: number }[] = [
      { label: '0', count: counts[0] ?? 0, step: 0 },
    ];
    if (max <= 10)
      for (let v = 1; v <= max; v++) bins.push({ label: String(v), count: counts[v] ?? 0, step: v });
    else
      for (let s = 1; s <= 10; s++) {
        const lo = Math.floor(((s - 1) * max) / 10) + 1,
          hi = Math.floor((s * max) / 10);
        let c = 0;
        for (let v = lo; v <= hi; v++) c += counts[v] ?? 0;
        bins.push({ label: `${lo}–${hi}`, count: c, step: s });
      }
    const top = Math.max(1, ...bins.map((b) => b.count));
    const values = bins.map((b) => `${b.label}: ${n(b.count)}`).join('; ');
    // warnings
    const warns: Raw[] = [];
    const est = tr.estimate;
    if (!isStale(p) && est && est.featuresBelowOneBrick > 0)
      warns.push(
        html`<li class="lz-cluster lz-cluster--between">
          <span>${t('create.generate.done.warnings.disappeared', { count: est.featuresBelowOneBrick })}</span
          ><button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-a="fix">
            ${t('create.generate.done.warnings.fix')}
          </button>
        </li>`,
      );
    else if (r.meta && r.meta.vertical.erasedStuds > 0)
      warns.push(
        html`<li class="lz-cluster lz-cluster--between">
          <span
            >${t('create.generate.done.warnings.erasedStuds', { count: r.meta.vertical.erasedStuds })}</span
          ><button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-a="fix">
            ${t('create.generate.done.warnings.fix')}
          </button>
        </li>`,
      );
    if (r.meta?.sampledRect.differsFromArea && q.rotation === 'aabb' && Math.abs(r.area.rotationDeg) > 1e-9)
      warns.push(html`<li>${t('create.generate.done.warnings.legacyRotation')}</li>`);
    const missing = p.summary?.meta?.missing?.length ?? 0;
    if (missing)
      warns.push(html`<li>${t('create.generate.done.warnings.missingTiles', { count: missing })}</li>`);
    const plates = r.packing.plates;
    const gridPlate =
      this.gridPlate && plates.some((x) => x.plate === this.gridPlate) ? this.gridPlate : null;
    let grid: Raw | '' = '';
    if (gridPlate) {
      const pl = plates.find((x) => x.plate === gridPlate)!;
      grid = html`<section class="lz-panel__section" aria-labelledby="grid-title">
        <div class="lz-cluster lz-cluster--between">
          <h2 id="grid-title">${t('create.generate.done.grid.title', { plate: gridPlate })}</h2>
          <div class="lz-input lz-select lz-select--sm">
            <select id="lz-grid-plate" aria-label="${t('create.generate.done.grid.plateSelect')}">
              ${plates.map((x) => html`<option value="${x.plate}" ${attr('selected', x.plate === gridPlate)}>${x.plate}</option>`)}
            </select>
          </div>
        </div>
        <p class="lz-help">${t('create.generate.done.grid.caption', { plate: gridPlate })}</p>
        <div
          class="lz-grid-wrap"
          tabindex="0"
          role="region"
          aria-label="${t('create.generate.done.grid.region', { plate: gridPlate })}"
        >
          ${heightGridTable(plateHeights(r.heightMap, pl.col, pl.southRow), max, gridPlate)}
        </div>
        <button
          type="button"
          class="lz-btn lz-btn--tertiary lz-btn--sm"
          data-a="hide-grid"
          style="align-self:flex-start"
        >
          ${t('create.generate.done.grid.hide')}
        </button>
      </section>`;
    }
    return html`<div class="lz-stack lz-stack--lg">
      <div class="lz-panel__head">
        <h1 id="step-title" tabindex="-1">${t('create.generate.done.title')}</h1>
        ${r.durationMs ? html`<p class="lz-cluster lz-small lz-generated">${ic('check-circle', 'sm')}${t('create.generate.done.generatedIn', { value: seconds(r.durationMs) })}</p>` : ''}
      </div>
      <div class="lz-keyfigs">
        <div class="lz-keyfig">
          <span class="lz-keyfig__value">${q.platesX} × ${q.platesY}</span
          ><span class="lz-keyfig__label"
            >${t('create.generate.done.keyPlates', { w: n(q.platesX * 25.6, 1), d: n(q.platesY * 25.6, 1) })}</span
          >
        </div>
        <div class="lz-keyfig">
          <span class="lz-keyfig__value" id="lz-total-bricks">${n(r.packing.total)}</span
          ><span class="lz-keyfig__label"
            >${t('create.generate.done.keyBricks', { plates: r.packing.baseplates.quantity })}</span
          >
        </div>
        <div class="lz-keyfig">
          <span class="lz-keyfig__value">${max}</span
          ><span class="lz-keyfig__label"
            >${t('create.generate.done.keyTallest', { cm: n((max * 9.6) / 10, 1) })}</span
          >
        </div>
      </div>
      <p class="lz-small lz-muted">
        ${t('create.generate.done.settings', { preset: presetName(preset), scale: n(q.scale, 2) })}
      </p>
      ${
        warns.length
          ? html`<div class="lz-alert lz-alert--warning" role="status">
              ${ic('warning')}
              <div class="lz-alert__body">
                <p class="lz-alert__title">
                  ${t('create.generate.done.warnings.title', { count: warns.length })}
                </p>
                <ul class="lz-stack lz-stack--xs">
                  ${warns}
                </ul>
              </div>
            </div>`
          : ''
      }
      <section class="lz-panel__section" aria-labelledby="hist-title">
        <h2 id="hist-title">${t('create.generate.done.histogram.title')}</h2>
        <div
          class="lz-histogram"
          style="--n: ${bins.length}"
          role="img"
          aria-label="${t('create.generate.done.histogram.label', { values })}"
        >
          ${bins.map(
            (b) =>
              html`<div
                class="lz-histogram__bar"
                style="--v: ${((100 * b.count) / top).toFixed(1)}%; --c: var(--lz-height-${b.step})"
                ${attr('data-zero', b.step === 0 ? 'true' : null)}
              >
                <span>${b.label}</span>
              </div>`,
          )}
        </div>
        <p class="lz-help">
          ${t('create.generate.done.histogram.caption')}.
          <button
            type="button"
            class="lz-link lz-link--button"
            data-a="hist-table"
            aria-expanded="${String(this.showHistTable)}"
          >
            ${this.showHistTable ? t('create.generate.done.histogram.hideTable') : t('create.generate.done.histogram.showTable')}
          </button>
        </p>
        ${
          this.showHistTable
            ? html`<table class="lz-table">
                <caption class="lz-visually-hidden">
                  ${t('create.generate.done.histogram.caption')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">${t('create.generate.done.histogram.height')}</th>
                    <th scope="col" class="num">${t('create.generate.done.histogram.studs')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${bins.map(
                    (b) =>
                      html`<tr>
                        <td>${b.label}</td>
                        <td class="num">${n(b.count)}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>`
            : ''
        }
      </section>
      <section class="lz-panel__section" aria-labelledby="pp-title">
        <h2 id="pp-title">${t('create.generate.done.perPlate.title')}</h2>
        <div class="lz-table-wrap">
          <table class="lz-table">
            <caption class="lz-visually-hidden">
              ${t('create.generate.done.perPlate.caption')}
            </caption>
            <thead>
              <tr>
                <th scope="col">${t('create.generate.done.perPlate.plate')}</th>
                <th scope="col" class="num">${t('create.generate.done.perPlate.tallest')}</th>
                <th scope="col" class="num">${t('create.generate.done.perPlate.bricks')}</th>
              </tr>
            </thead>
            <tbody>
              ${plates.map(
                (x) =>
                  html`<tr>
                    <th scope="row">${x.plate}</th>
                    <td class="num">${x.layers}</td>
                    <td class="num">${n(x.bricks)}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>
      </section>
      ${grid || html`<button type="button" class="lz-btn lz-btn--secondary" data-a="show-grid" style="align-self:flex-start">${ic('grid', 'sm')}${t('create.generate.done.grid.show')}</button>`}
    </div>`;
  }

  // ------------------------------------------------------------------ events

  private onClick = (e: Event) => {
    const el = e.target as Element;
    const st = this.ctx.store;
    const stale = el.closest<HTMLElement>('[data-stale]');
    if (stale) {
      if (stale.dataset.stale === 'regenerate') void this.ctx.actions.generate();
      else this.ctx.actions.undoChanges();
      return;
    }
    const a = el.closest<HTMLElement>('[data-a]')?.dataset.a;
    if (!a) return;
    switch (a) {
      case 'generate':
        void this.ctx.actions.generate();
        break;
      case 'cancel':
        this.ctx.actions.cancelGenerate();
        break;
      case 'fewer': {
        const q = st.p.params;
        st.set({
          params: {
            ...q,
            platesX: Math.max(1, Math.ceil(q.platesX / 2)),
            platesY: Math.max(1, Math.ceil(q.platesY / 2)),
          },
        });
        st.setT({ generateError: null });
        break;
      }
      case 'fix':
        this.ctx.go('settings', { focus: true });
        break;
      case 'fix-keep':
        st.set({ params: { ...st.p.params, keepSmall: true } });
        void this.ctx.actions.generate();
        break;
      case 'fix-true': {
        const ground = st.p.summary?.groundAvailable ?? false;
        void import('../state.ts').then(({ trueScaleOptions }) => {
          st.set({ params: trueScaleOptions(st.p.params, ground) });
          void this.ctx.actions.generate();
        });
        break;
      }
      case 'move':
        this.ctx.go('area', { focus: true });
        break;
      case 'show-grid':
        this.gridPlate = st.p.result?.packing.plates[0]?.plate ?? null;
        this.render(false);
        requestAnimationFrame(() =>
          $<HTMLElement>('#grid-title', this.panel)?.scrollIntoView({ block: 'nearest' }),
        );
        break;
      case 'hide-grid':
        this.gridPlate = null;
        this.render(false);
        break;
      case 'hist-table':
        this.showHistTable = !this.showHistTable;
        this.render(false);
        break;
    }
  };

  private onChange = (e: Event) => {
    const el = e.target as HTMLSelectElement;
    if (el.id === 'lz-grid-plate') {
      this.gridPlate = el.value;
      this.render(false);
      $<HTMLElement>('#lz-grid-plate', this.panel)?.focus();
    }
  };

  /** Esc cancels when focus is in the progress region (§6.3). */
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.state === 'running' && (e.target as Element).closest('#lz-gen-running')) {
      this.ctx.actions.cancelGenerate();
    }
  };
}

export { changeLabel };
