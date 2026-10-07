/**
 * Step 2 — Area (SPEC A1–A7, ux-spec §5.2, §6.1, §7.3, mockups/create-2-area.html). The panel's
 * numeric inputs and the plan view's rectangle are one value (two-way binding, A2).
 */
import { t } from '../../shared/i18n.ts';
import { mapScaleDenominator } from '../../core/heightmap/area.ts';
import { $, attr, html, ic, parseNumber, setHtml, type Raw } from '../dom.ts';
import { n } from '../format.ts';
import type { Ctx, PrimaryAction, StepView } from '../stepView.ts';
import { normAngle } from '../viewport/plan.ts';
import { setFieldError, staleBanner, stepperInput, syncValue, tableFitSvg } from './common.ts';

export class AreaStep implements StepView {
  readonly id = 'area' as const;
  private ctx: Ctx;
  private panel!: HTMLElement;
  private invalid = new Set<string>();
  private keepGroundHint: { x: number; y: number } | null = null;
  private dynSig = '';

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  mount(panel: HTMLElement): void {
    this.panel = panel;
    this.render();
    panel.addEventListener('click', this.onClick);
    panel.addEventListener('keydown', this.onKeydown);
    panel.addEventListener('change', this.onCommit);
    panel.addEventListener('focusout', this.onBlur);
    this.ctx.stage.show('area');
    document.addEventListener('keydown', this.onGlobalKey);
  }

  unmount(): void {
    this.panel.removeEventListener('click', this.onClick);
    this.panel.removeEventListener('keydown', this.onKeydown);
    this.panel.removeEventListener('change', this.onCommit);
    this.panel.removeEventListener('focusout', this.onBlur);
    document.removeEventListener('keydown', this.onGlobalKey);
    this.panel.innerHTML = '';
  }

  update(changed: Set<string>): void {
    if (
      changed.has('area') ||
      changed.has('params') ||
      changed.has('t.estimate') ||
      changed.has('result') ||
      changed.has('t.generating') ||
      changed.has('summary')
    )
      this.refresh();
  }

  primary(): PrimaryAction {
    return {
      label: t('create.shell.primary.area'),
      short: t('common.actions.continue'),
      disabled: this.invalid.size > 0 || !!this.ctx.store.t.generating,
      run: () => this.ctx.go('settings', { focus: true }),
    };
  }

  // ------------------------------------------------------------------ render

  private render() {
    const p = this.ctx.store.p;
    const busy = !!this.ctx.store.t.generating;
    const s = p.summary;
    const frameHelp =
      s?.frame.kind === 'enu' ? t('create.area.position.frameLocal') : t('create.area.position.frameModel');
    setHtml(
      this.panel,
      html`<div id="lz-area-stale"></div>
        <div class="lz-panel__head">
          <h1 id="step-title" tabindex="-1">${t('create.area.title')}</h1>
          <p class="lz-muted">${t('create.area.lead')}</p>
        </div>
        ${busy ? html`<p class="lz-alert lz-alert--busy" role="status">${ic('info')}<span>${t('create.shell.busyInputs')}</span></p>` : ''}
        <div id="lz-area-notices"></div>
        <section class="lz-panel__section" aria-labelledby="pos-title">
          <h2 id="pos-title">${t('create.area.position.title')}</h2>
          <div class="lz-coords">
            <div class="lz-field">
              <label class="lz-label" for="lz-cx">${t('create.area.position.centreX')}</label>
              <div class="lz-input">
                <input
                  id="lz-cx"
                  inputmode="decimal"
                  autocomplete="off"
                  aria-describedby="lz-frame-help"
                  ${attr('disabled', busy)}
                /><span class="lz-input__unit">m</span>
              </div>
            </div>
            <div class="lz-field">
              <label class="lz-label" for="lz-cy">${t('create.area.position.centreY')}</label>
              <div class="lz-input">
                <input
                  id="lz-cy"
                  inputmode="decimal"
                  autocomplete="off"
                  aria-describedby="lz-frame-help"
                  ${attr('disabled', busy)}
                /><span class="lz-input__unit">m</span>
              </div>
            </div>
            <p class="lz-help lz-coords__help" id="lz-frame-help">${frameHelp}</p>
            <div class="lz-field">
              <label class="lz-label" for="lz-rot">${t('create.area.position.rotation')}</label>
              <div class="lz-input lz-input--num">
                <input id="lz-rot" inputmode="decimal" autocomplete="off" ${attr('disabled', busy)} /><span
                  class="lz-input__unit"
                  >${t('create.area.position.rotationUnit')}</span
                >
              </div>
              <p class="lz-help" id="lz-rot-note" hidden></p>
            </div>
          </div>
        </section>
        <section class="lz-panel__section" aria-labelledby="size-title">
          <h2 id="size-title">${t('create.area.size.title')}</h2>
          <div class="lz-param">
            <label class="lz-label" for="lz-px">${t('create.area.size.platesX')}</label>
            ${stepperInput({ id: 'lz-px', value: p.params.platesX, min: 1, max: 16, less: t('create.area.size.fewerX'), more: t('create.area.size.moreX'), describedBy: 'lz-plates-help', disabled: busy })}
          </div>
          <div class="lz-param">
            <label class="lz-label" for="lz-py">${t('create.area.size.platesY')}</label>
            ${stepperInput({ id: 'lz-py', value: p.params.platesY, min: 1, max: 16, less: t('create.area.size.fewerY'), more: t('create.area.size.moreY'), describedBy: 'lz-plates-help', disabled: busy })}
          </div>
          <p class="lz-help" id="lz-plates-help">${t('create.area.size.platesHelp')}</p>
          <div class="lz-param">
            <label class="lz-label" for="lz-scale">${t('create.area.size.scale')}</label>
            <div class="lz-input lz-input--num">
              <input id="lz-scale" inputmode="decimal" autocomplete="off" ${attr('disabled', busy)} /><span
                class="lz-input__unit"
                >${t('create.area.size.scaleUnit')}</span
              >
            </div>
          </div>
          <div id="lz-keep-ground"></div>
        </section>
        <section class="lz-panel__section" aria-labelledby="table-title">
          <h2 id="table-title">${t('create.area.summary.title')}</h2>
          <div id="lz-area-summary"></div>
          <div class="lz-cluster">
            <button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-a="centre">
              ${ic('target', 'sm')}${t('create.area.tools.centre')}
            </button>
            <button type="button" class="lz-btn lz-btn--tertiary lz-btn--sm" data-a="reset">
              ${ic('undo', 'sm')}${t('create.area.tools.reset')}
            </button>
          </div>
        </section>`,
    );
    this.dynSig = '';
    this.refresh();
  }

  private refresh() {
    const p = this.ctx.store.p;
    const tr = this.ctx.store.t;
    if (!p.area) return;
    syncValue($<HTMLInputElement>('#lz-cx', this.panel), p.area.cx.toFixed(2));
    syncValue($<HTMLInputElement>('#lz-cy', this.panel), p.area.cy.toFixed(2));
    syncValue($<HTMLInputElement>('#lz-rot', this.panel), p.area.rotationDeg.toFixed(1));
    syncValue($<HTMLInputElement>('#lz-px', this.panel), String(p.params.platesX));
    syncValue($<HTMLInputElement>('#lz-py', this.panel), String(p.params.platesY));
    syncValue($<HTMLInputElement>('#lz-scale', this.panel), String(p.params.scale));
    for (const [id, v, lim] of [
      ['lz-px', p.params.platesX, 16],
      ['lz-py', p.params.platesY, 16],
    ] as const) {
      const dec = $<HTMLButtonElement>(`[data-step-dec="${id}"]`, this.panel);
      const inc = $<HTMLButtonElement>(`[data-step-inc="${id}"]`, this.panel);
      if (dec) dec.disabled = v <= 1 || !!tr.generating;
      if (inc) inc.disabled = v >= lim || !!tr.generating;
    }
    const est = tr.estimate;
    const sig = JSON.stringify([
      p.params.platesX,
      p.params.platesY,
      p.params.scale,
      p.area.rotationDeg,
      p.params.rotation,
      p.areaOrigin,
      est?.features,
      !!p.result,
      p.result?.generatedAt,
      JSON.stringify(p.area),
      this.keepGroundHint,
    ]);
    if (sig === this.dynSig) return;
    this.dynSig = sig;
    // stale banner
    setHtml($('#lz-area-stale', this.panel)!, staleBanner(p, !!tr.generating));
    // notices
    const notices: Raw[] = [];
    const rotated = Math.abs(p.area.rotationDeg % 360) > 1e-9;
    if (rotated && p.params.rotation === 'aabb') {
      notices.push(
        html`<div class="lz-alert lz-alert--legacy" role="status">
          ${ic('archive')}
          <div class="lz-alert__body">
            <p>${t('create.area.warnings.legacyRotation')}</p>
            <button
              type="button"
              class="lz-btn lz-btn--secondary lz-btn--sm"
              data-a="rotate-mode"
              style="align-self:flex-start"
            >
              ${t('create.area.warnings.legacyRotationAction')}
            </button>
          </div>
        </div>`,
      );
    } else if (p.areaOrigin && p.areaOrigin !== 'user') {
      const msg =
        p.areaOrigin === 'demo'
          ? t('create.area.demoSuggested')
          : p.areaOrigin === 'whole'
            ? t('create.area.defaultWhole', { x: p.params.platesX, y: p.params.platesY })
            : t('create.area.defaultPlaced', { x: p.params.platesX, y: p.params.platesY });
      notices.push(
        html`<div class="lz-alert">
          ${ic('info')}
          <p>${msg}</p>
        </div>`,
      );
    }
    if (est && est.features === 0) {
      notices.push(
        html`<div class="lz-alert lz-alert--warning" role="status">
          ${ic('warning')}
          <div class="lz-alert__body">
            <p>${t('create.area.warnings.empty')}</p>
            <button
              type="button"
              class="lz-btn lz-btn--secondary lz-btn--sm"
              data-a="centre"
              style="align-self:flex-start"
            >
              ${ic('target', 'sm')}${t('create.area.warnings.emptyAction')}
            </button>
          </div>
        </div>`,
      );
    }
    setHtml($('#lz-area-notices', this.panel)!, html`${notices}`);
    // keep-ground hint (one time, OI-2)
    const kg = $('#lz-keep-ground', this.panel)!;
    setHtml(
      kg,
      this.keepGroundHint
        ? html`<p class="lz-help lz-keep-ground">
            ${ic('info', 'sm')}<button type="button" class="lz-link lz-link--button" data-a="keep-ground">
              ${t('create.area.size.keepGroundArea', this.keepGroundHint)}
            </button>
          </p>`
        : '',
    );
    // summary + table fit (A5)
    const X = p.params.platesX,
      Y = p.params.platesY;
    const w = X * 32 * p.params.scale,
      d = Y * 32 * p.params.scale;
    setHtml(
      $('#lz-area-summary', this.panel)!,
      html`<dl class="lz-facts lz-facts--plain">
          <div>
            <dd>
              ${t('create.area.summary.ground', { w: n(w, w < 100 ? 1 : 0), d: n(d, d < 100 ? 1 : 0) })}
            </dd>
          </div>
          <div><dd>${t('create.area.summary.table', { w: n(X * 25.6, 1), d: n(Y * 25.6, 1) })}</dd></div>
          <div>
            <dd>
              ${t('create.area.summary.studs', { total: n(X * Y * 1024), cols: X * 32, rows: Y * 32 })} ·
              ${t('create.area.summary.mapScale', { n: n(mapScaleDenominator(p.params.scale)) })}
            </dd>
          </div>
        </dl>
        ${tableFitSvg(X, Y, 'area')}`,
    );
    this.ctx.renderActionbar();
  }

  // ------------------------------------------------------------------ edits

  private commitField(input: HTMLInputElement): void {
    const st = this.ctx.store;
    const p = st.p;
    if (!p.area) return;
    const id = input.id;
    const v = parseNumber(input.value);
    const fail = (msg: string) => {
      setFieldError(input, msg);
      this.invalid.add(id);
      this.ctx.renderActionbar();
    };
    const ok = () => {
      setFieldError(input, null);
      this.invalid.delete(id);
      this.ctx.renderActionbar();
    };
    if (id === 'lz-cx' || id === 'lz-cy') {
      if (!Number.isFinite(v)) return fail(t('create.area.errors.number'));
      ok();
      st.set({ area: { ...p.area, [id === 'lz-cx' ? 'cx' : 'cy']: v }, areaOrigin: 'user' });
    } else if (id === 'lz-rot') {
      if (!Number.isFinite(v)) return fail(t('create.area.errors.rotation'));
      ok();
      const r = normAngle(v);
      const note = $('#lz-rot-note', this.panel)!;
      note.hidden = Math.abs(r - v) < 1e-9;
      note.textContent = note.hidden
        ? ''
        : t('create.area.position.rotationNormalised', { input: n(v, 1), value: n(r, 1) });
      input.value = r.toFixed(1);
      st.set({ area: { ...p.area, rotationDeg: r }, areaOrigin: 'user' });
    } else if (id === 'lz-px' || id === 'lz-py') {
      if (!Number.isInteger(v) || v < 1 || v > 16) return fail(t('create.area.errors.plates'));
      ok();
      st.set({ params: { ...p.params, [id === 'lz-px' ? 'platesX' : 'platesY']: v }, areaOrigin: 'user' });
    } else if (id === 'lz-scale') {
      if (!Number.isFinite(v) || v < 0.25 || v > 50) return fail(t('create.area.errors.scale'));
      ok();
      if (v !== p.params.scale) this.scaleChanged(p.params.scale, v);
    }
  }

  /** Scale change keeps plates and centre; one-time hint offers to keep the ground area (OI-2). */
  private scaleChanged(from: number, to: number) {
    const st = this.ctx.store;
    const p = st.p;
    st.set({ params: { ...p.params, scale: to } });
    if (!p.ui.keepGroundHintShown) {
      const x = Math.min(16, Math.max(1, Math.round((p.params.platesX * from) / to)));
      const y = Math.min(16, Math.max(1, Math.round((p.params.platesY * from) / to)));
      if (x !== p.params.platesX || y !== p.params.platesY) {
        this.keepGroundHint = { x, y };
        st.setUi({ keepGroundHintShown: true });
      }
    }
  }

  private onCommit = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (el.tagName === 'INPUT' && el.id) this.commitField(el);
  };
  private onBlur = (e: FocusEvent) => {
    void e;
  };

  private onKeydown = (e: KeyboardEvent) => {
    const el = e.target as HTMLInputElement;
    if (el.tagName !== 'INPUT') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commitField(el);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const v = parseNumber(el.value);
      if (!Number.isFinite(v)) return;
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      const step =
        el.id === 'lz-px' || el.id === 'lz-py'
          ? 1
          : el.id === 'lz-scale'
            ? v < 2
              ? 0.05
              : 0.5
            : el.id === 'lz-rot'
              ? 1
              : 1;
      let nv = Math.round((v + dir * step) * 1000) / 1000;
      if (el.id === 'lz-px' || el.id === 'lz-py') nv = Math.min(16, Math.max(1, nv));
      if (el.id === 'lz-scale') nv = Math.min(50, Math.max(0.25, nv));
      el.value = el.id === 'lz-cx' || el.id === 'lz-cy' ? nv.toFixed(2) : String(nv);
      e.preventDefault();
      this.commitField(el);
    }
  };

  private onClick = (e: Event) => {
    const el = e.target as Element;
    const dec = el.closest<HTMLElement>('[data-step-dec]');
    const inc = el.closest<HTMLElement>('[data-step-inc]');
    const st = this.ctx.store;
    const p = st.p;
    if (dec || inc) {
      const id = (dec ?? inc)!.dataset.stepDec ?? (dec ?? inc)!.dataset.stepInc!;
      const input = $<HTMLInputElement>(`#${id}`, this.panel)!;
      const cur = id === 'lz-px' ? p.params.platesX : p.params.platesY;
      input.value = String(Math.min(16, Math.max(1, cur + (dec ? -1 : 1))));
      this.commitField(input);
      return;
    }
    const stale = el.closest<HTMLElement>('[data-stale]');
    if (stale) {
      if (stale.dataset.stale === 'regenerate') {
        this.ctx.go('generate', { focus: true });
        void this.ctx.actions.generate();
      } else this.ctx.actions.undoChanges();
      return;
    }
    const a = el.closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'centre') this.ctx.stage.centreOnModel();
    else if (a === 'reset') {
      const s = p.summary;
      if (!s) return;
      st.set({
        area: { ...s.defaultArea.area },
        params: { ...p.params, platesX: s.defaultArea.platesX, platesY: s.defaultArea.platesY },
        areaOrigin: 'default',
      });
    } else if (a === 'rotate-mode') st.set({ params: { ...p.params, rotation: 'rotate' } });
    else if (a === 'keep-ground' && this.keepGroundHint) {
      st.set({ params: { ...p.params, platesX: this.keepGroundHint.x, platesY: this.keepGroundHint.y } });
      this.keepGroundHint = null;
      this.dynSig = '';
      this.refresh();
    }
  };

  /** D (draw) when the viewport is focused (WCAG 2.1.4). */
  private onGlobalKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (this.ctx.stage.handleKey(e)) e.preventDefault();
  };
}
