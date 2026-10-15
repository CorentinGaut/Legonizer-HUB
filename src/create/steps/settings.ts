/**
 * Step 3 — Scale & height (SPEC §7.3):
 * presets (Legacy default; the demo's "Legacy + keep small" named, SPEC §12), scale with a log slider, max height,
 * plates, live estimates, the "buildings that disappear" warning with fixes (+ the share of built-up studs left empty),
 * advanced options with their legacy values marked.
 */
import { t } from '../../shared/i18n.ts';
import { mapScaleDenominator } from '../../core/heightmap/area.ts';
import { fitsTable } from '../../core/heightmap/estimate.ts';
import type { Params } from '../../core/types.ts';
import { $, attr, html, ic, parseNumber, setHtml, type Raw } from '../dom.ts';
import { n } from '../format.ts';
import {
  OPTION_KEYS,
  changedOptions,
  legacyOptions,
  presetOf,
  trueScaleOptions,
  type PresetId,
} from '../state.ts';
import type { Ctx, PrimaryAction, StepView } from '../stepView.ts';
import { setFieldError, staleBanner, stepperInput, syncValue } from './common.ts';
import type { TileCapMode } from '../../core/packing/catalog.ts';
import { setTileCap, tileCapControl } from '../../guide/parts.ts';

const LOG_MIN = Math.log(0.25),
  LOG_MAX = Math.log(50);
const toSlider = (s: number) => Math.round(((Math.log(s) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 1000);
const fromSlider = (x: number) => {
  const v = Math.exp(LOG_MIN + (x / 1000) * (LOG_MAX - LOG_MIN));
  return v < 1 ? Math.round(v * 100) / 100 : v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
};

export class SettingsStep implements StepView {
  readonly id = 'settings' as const;
  private ctx: Ctx;
  private panel!: HTMLElement;
  private invalid = new Set<string>();
  private sig = '';
  private estSig = '';
  private showFlags = true;
  private advOpen = false;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  mount(panel: HTMLElement): void {
    this.panel = panel;
    this.render();
    panel.addEventListener('click', this.onClick);
    panel.addEventListener('change', this.onChange);
    panel.addEventListener('input', this.onInput);
    panel.addEventListener('keydown', this.onKeydown);
    panel.addEventListener('toggle', this.onToggle, true);
    this.ctx.stage.show('settings');
  }

  unmount(): void {
    const p = this.panel;
    p.removeEventListener('click', this.onClick);
    p.removeEventListener('change', this.onChange);
    p.removeEventListener('input', this.onInput);
    p.removeEventListener('keydown', this.onKeydown);
    p.removeEventListener('toggle', this.onToggle, true);
    p.innerHTML = '';
  }

  update(changed: Set<string>): void {
    if (
      changed.has('params') ||
      changed.has('inventory') ||
      changed.has('result') ||
      changed.has('t.generating') ||
      changed.has('demoSettings') ||
      changed.has('summary') ||
      changed.has('ui')
    )
      this.render();
    else if (changed.has('t.estimate') || changed.has('t.estimating') || changed.has('area'))
      this.renderEstimates();
  }

  primary(): PrimaryAction {
    const tr = this.ctx.store.t;
    return {
      label: t('create.shell.primary.settings'),
      short: t('create.settings.generate'),
      disabled: this.invalid.size > 0 || !!tr.generating,
      run: () => {
        this.ctx.go('generate', { focus: true });
        void this.ctx.actions.generate();
      },
    };
  }

  // ------------------------------------------------------------------ render

  private render() {
    const p = this.ctx.store.p;
    const tr = this.ctx.store.t;
    const q = p.params;
    const ground = p.summary?.groundAvailable ?? false;
    const preset = presetOf(q, ground);
    const busy = !!tr.generating;
    const sig = JSON.stringify([
      q,
      preset,
      busy,
      p.demoSettings,
      p.result?.generatedAt,
      p.area,
      ground,
      this.invalid.size,
      p.inventory.tileCap,
    ]);
    if (sig === this.sig) return;
    const focusId = (document.activeElement as HTMLElement | null)?.id;
    this.sig = sig;
    const changed = changedOptions(q);
    const normalized = q.heightMode === 'normalized';
    const presetCard = (id: PresetId, name: string, desc: Raw | string, badge?: Raw) =>
      html`<label class="lz-choice-card"
        ><input
          type="radio"
          name="lz-preset"
          value="${id}"
          ${attr('checked', preset === id)}${attr('disabled', busy)}
        /><span class="lz-choice-card__title">${name}${badge ?? ''}</span
        ><span class="lz-choice-card__desc">${desc}</span></label
      >`;
    const legacyBadge = html` <span class="lz-badge lz-badge--legacy"
      >${ic('archive')}${t('create.settings.advanced.legacyMarker')}</span
    >`;
    const customCard =
      preset === 'legacyKeepSmall'
        ? presetCard(
            'legacyKeepSmall',
            t('create.settings.preset.legacyKeepSmall.name'),
            html`${t('create.settings.preset.legacyKeepSmall.description')}
              <button type="button" class="lz-link lz-link--button" data-a="reset-legacy">
                ${t('create.settings.preset.resetLegacy')}
              </button>`,
            html` <span class="lz-badge lz-badge--changed"
              >${t('create.settings.advanced.changed', { count: 1 })}</span
            >`,
          )
        : preset === 'custom'
          ? presetCard(
              'custom',
              t('create.settings.preset.custom.name'),
              html`${t('create.settings.preset.custom.description', { count: changed.length })}
                <button type="button" class="lz-link lz-link--button" data-a="reset-legacy">
                  ${t('create.settings.preset.resetLegacy')}
                </button>`,
              html` <span class="lz-badge lz-badge--changed"
                >${t('create.settings.advanced.changed', { count: changed.length })}</span
              >`,
            )
          : '';
    const tip = (id: string, key: string) =>
      html`<span class="lz-tip"
        ><button
          type="button"
          class="lz-info-btn"
          aria-label="${t('create.settings.udvizInfo')}"
          aria-describedby="${id}"
        >
          ${ic('info', 'sm')}</button
        ><span class="lz-tooltip" role="tooltip" id="${id}">${t(key)}</span></span
      >`;
    const est = tr.estimate;
    setHtml(
      this.panel,
      html`${staleBanner(p, busy)}
        <div class="lz-panel__head">
          <h1 id="step-title" tabindex="-1">${t('create.settings.title')}</h1>
          <p class="lz-muted">${t('create.settings.lead')}</p>
        </div>
        ${busy ? html`<p class="lz-alert lz-alert--busy" role="status">${ic('info')}<span>${t('create.shell.busyInputs')}</span></p>` : ''}
        ${
          p.demoSettings && preset === 'legacyKeepSmall'
            ? html`<div class="lz-alert" role="status">
                ${ic('info')}
                <div class="lz-alert__body">
                  <p>${t('create.settings.preset.demoNote')}</p>
                  <button
                    type="button"
                    class="lz-btn lz-btn--secondary lz-btn--sm"
                    data-a="switch-legacy"
                    style="align-self:flex-start"
                  >
                    ${ic('archive', 'sm')}${t('create.settings.preset.switchToLegacy')}
                  </button>
                </div>
              </div>`
            : ''
        }
        <fieldset class="lz-choice-group">
          <legend class="lz-eyebrow">${t('create.settings.preset.title')}</legend>
          ${presetCard('legacy', t('create.settings.preset.legacy.name'), t('create.settings.preset.legacy.description'), legacyBadge)}
          ${presetCard('trueScale', t('create.settings.preset.trueScale.name'), t('create.settings.preset.trueScale.description'))}
          ${customCard}
        </fieldset>
        <section
          class="lz-panel__section"
          aria-label="${t('create.settings.scale.label')}, ${t('create.settings.maxHeight.label')}, ${t('create.settings.plates.label')}"
        >
          <div class="lz-param">
            <span class="lz-label-row"
              ><label class="lz-label" for="lz-scale3">${t('create.settings.scale.label')}</label
              >${tip('tt-scale', 'create.settings.scale.udviz')}</span
            >
            <div class="lz-input lz-input--num">
              <input
                id="lz-scale3"
                inputmode="decimal"
                autocomplete="off"
                aria-describedby="lz-scale3-help"
                ${attr('disabled', busy)}
              /><span class="lz-input__unit">${t('create.settings.scale.unit')}</span>
            </div>
            <div class="lz-slider" style="--_pct: ${(toSlider(q.scale) / 10).toFixed(1)}%">
              <input
                type="range"
                id="lz-scale-slider"
                min="0"
                max="1000"
                value="${toSlider(q.scale)}"
                aria-label="${t('create.settings.scale.slider')}"
                aria-valuetext="${t('create.settings.scale.sliderValue', { s: n(q.scale, 2) })}"
                ${attr('disabled', busy)}
              />
              <div class="lz-slider__ticks" aria-hidden="true">
                ${[0.25, 0.5, 1, 2, 5, 10, 25, 50].map((v) => html`<span style="--at:${(toSlider(v) / 10).toFixed(1)}%">${n(v, 2)}</span>`)}
              </div>
            </div>
            <p class="lz-help" id="lz-scale3-help">
              ${t('create.settings.scale.help', { s: n(q.scale, 2), n: n(mapScaleDenominator(q.scale)) })}
            </p>
          </div>
          ${
            normalized
              ? html`<div class="lz-param">
                  <span class="lz-label-row"
                    ><label class="lz-label" for="lz-maxh">${t('create.settings.maxHeight.label')}</label
                    >${tip('tt-maxh', 'create.settings.maxHeight.udviz')}</span
                  >
                  <div class="lz-plates-row">
                    ${stepperInput({ id: 'lz-maxh', value: q.maxHeight, min: 1, max: 100, less: t('create.settings.maxHeight.lower'), more: t('create.settings.maxHeight.raise'), describedBy: 'lz-maxh-help', disabled: busy })}<span
                      class="lz-small lz-muted"
                      >${t('create.settings.maxHeight.unit')}</span
                    >
                  </div>
                  <p class="lz-help" id="lz-maxh-help">${t('create.settings.maxHeight.help')}</p>
                </div>`
              : html`<div class="lz-param">
                    <span class="lz-label">${t('create.settings.maxHeight.label')}</span>
                    <p>
                      <strong id="lz-tallest-ro"
                        >${est ? t('create.settings.maxHeight.readOnly', { bricks: est.maxBricks, cm: n(est.maxHeightCm, 1) }) : '…'}</strong
                      >
                    </p>
                    <p class="lz-help">${t('create.settings.maxHeight.readOnlyHelp')}</p>
                  </div>
                  <div class="lz-param">
                    <label class="lz-label" for="lz-cap-main"
                      >${t('create.settings.advanced.cap.label')}</label
                    >
                    <div class="lz-input lz-input--num">
                      <input
                        id="lz-cap-main"
                        inputmode="numeric"
                        placeholder="${t('create.settings.advanced.capNone')}"
                        value="${q.cap ?? ''}"
                        aria-describedby="lz-cap-main-help"
                        ${attr('disabled', busy)}
                      /><span class="lz-input__unit">${t('create.settings.advanced.capUnit')}</span>
                    </div>
                    <p class="lz-help" id="lz-cap-main-help">
                      ${t('create.settings.advanced.cap.consequence')}
                    </p>
                  </div>`
          }
          ${
            q.heightMode === 'exaggerated'
              ? html`<div class="lz-param">
                  <label class="lz-label" for="lz-exag">${t('create.settings.exaggeration.label')}</label>
                  <div class="lz-input lz-input--num">
                    <input
                      id="lz-exag"
                      inputmode="decimal"
                      value="${q.exaggeration ?? 2}"
                      aria-describedby="lz-exag-help"
                      ${attr('disabled', busy)}
                    /><span class="lz-input__unit">×</span>
                  </div>
                  <p class="lz-help" id="lz-exag-help">
                    ${t('create.settings.exaggeration.help', { f: n(q.exaggeration ?? 2, 1) })}
                  </p>
                </div>`
              : ''
          }
          <div class="lz-param">
            <span class="lz-label-row"
              ><span class="lz-label" id="lz-plates-label">${t('create.settings.plates.label')}</span
              >${tip('tt-plates', 'create.settings.plates.udviz')}</span
            >
            <div class="lz-plates-row" role="group" aria-labelledby="lz-plates-label">
              ${stepperInput({ id: 'lz-px3', value: q.platesX, min: 1, max: 16, label: t('create.area.size.platesX'), less: t('create.area.size.fewerX'), more: t('create.area.size.moreX'), disabled: busy })}
              <span aria-hidden="true">×</span>
              ${stepperInput({ id: 'lz-py3', value: q.platesY, min: 1, max: 16, label: t('create.area.size.platesY'), less: t('create.area.size.fewerY'), more: t('create.area.size.moreY'), disabled: busy })}
            </div>
            <p class="lz-help">${t('create.settings.plates.help')}</p>
          </div>
        </section>
        <section class="lz-panel__section" aria-label="${t('create.settings.tileCap.label')}">
          ${tileCapControl(p.inventory.tileCap, { id: 'lz-tilecap', disabled: busy })}
        </section>
        <section class="lz-panel__section" aria-labelledby="est-title" id="lz-estimates"></section>
        ${this.advancedHtml(q, ground, busy)}`,
    );
    syncValue($<HTMLInputElement>('#lz-scale3', this.panel), String(q.scale));
    this.estSig = '';
    this.renderEstimates();
    if (focusId) document.getElementById(focusId)?.focus();
  }

  private advancedHtml(q: Params, ground: boolean, busy: boolean): Raw {
    const changed = new Set(changedOptions(q));
    const legacy = html` <span class="lz-badge lz-badge--legacy"
      >${t('create.settings.advanced.legacyMarker')}</span
    >`;
    const opt = (key: string, label: string, body: Raw, consequence?: string) =>
      html`<fieldset class="lz-option" ${attr('data-changed', changed.has(key as never) ? 'true' : null)}>
        <legend>
          ${label}${changed.has(key as never) ? html` <span class="lz-badge lz-badge--changed">${t('create.settings.advanced.changedMarker')}</span>` : ''}
          <span class="lz-option__internal"
            >${t('create.settings.advanced.internalName', { name: key })}</span
          >
        </legend>
        ${body}${consequence ? html`<p class="lz-option__consequence">${consequence}</p>` : ''}
      </fieldset>`;
    const radio = (
      name: string,
      value: string,
      label: string,
      checked: boolean,
      isLegacy: boolean,
      disabled = false,
      describedBy?: string,
    ) =>
      html`<label class="lz-radio"
        ><input
          type="radio"
          name="${name}"
          value="${value}"
          ${attr('checked', checked)}${attr('disabled', busy || disabled)}${attr('aria-describedby', describedBy ?? null)}
        />${label}${isLegacy ? legacy : ''}</label
      >`;
    const sel = (
      id: string,
      label: string,
      options: [string, string][],
      value: string,
      legacyValue: string,
      disabled = false,
    ) =>
      html`<div class="lz-option__value">
        <div class="lz-input lz-select" ${attr('data-disabled', disabled ? 'true' : null)}>
          <select id="${id}" aria-label="${label}" ${attr('disabled', busy || disabled)}>
            ${options.map(([v, l]) => html`<option value="${v}" ${attr('selected', v === value)}>${l}</option>`)}
          </select>
        </div>
        ${value === legacyValue ? legacy : ''}
      </div>`;
    const mpb = q.scale * 1.2;
    return html`<details class="lz-disclosure lz-advanced" id="lz-adv" ${attr('open', this.advOpen)}>
      <summary>
        ${t('create.settings.advanced.title')}
        ${changed.size ? html`<span class="lz-badge lz-badge--changed">${t('create.settings.advanced.changed', { count: changed.size })}</span>` : html`<span class="lz-badge lz-badge--legacy">${t('create.settings.advanced.allLegacy')}</span>`}
      </summary>
      <div class="lz-disclosure__content">
        <div class="lz-cluster lz-cluster--between">
          <span></span
          ><button
            type="button"
            class="lz-btn lz-btn--tertiary lz-btn--sm"
            data-a="reset-legacy"
            ${attr('disabled', busy || !changed.size)}
          >
            ${t('create.settings.advanced.resetAll')}
          </button>
        </div>
        ${opt(
          'heightMode',
          t('create.settings.advanced.heightMode.label'),
          html`<div class="lz-option__values">
            ${radio('o-hm', 'normalized', t('create.settings.advanced.heightMode.normalized'), q.heightMode === 'normalized', true)}${radio('o-hm', 'true-scale', t('create.settings.advanced.heightMode.trueScale'), q.heightMode === 'true-scale', false)}<span
              class="lz-option__value"
              >${radio('o-hm', 'exaggerated', t('create.settings.advanced.heightMode.exaggerated'), q.heightMode === 'exaggerated', false)}</span
            >
          </div>`,
          t('create.settings.advanced.heightMode.consequence', { m: n(mpb, 1) }),
        )}
        ${opt(
          'heightRef',
          t('create.settings.advanced.heightRef.label'),
          html`<div class="lz-option__values">
            ${radio('o-hr', 'lowest-base', t('create.settings.advanced.heightRef.lowestBase'), q.heightRef === 'lowest-base', true)}${radio('o-hr', 'ground', t('create.settings.advanced.heightRef.ground'), q.heightRef === 'ground', false, !ground, ground ? undefined : 'lz-hr-why')}${ground ? '' : html`<p class="lz-help lz-option__why" id="lz-hr-why">${t('create.settings.advanced.heightRef.groundUnavailable')}</p>`}
          </div>`,
          t('create.settings.advanced.heightRef.consequence'),
        )}
        ${opt(
          'sampling',
          t('create.settings.advanced.sampling.label'),
          html`${sel(
              'lz-o-sampling',
              t('create.settings.advanced.sampling.label'),
              [
                ['corner-1', t('create.settings.advanced.sampling.corner1')],
                ['centre-1', t('create.settings.advanced.sampling.centre1')],
                ['supersample-2', t('create.settings.advanced.sampling.super2')],
                ['supersample-3', t('create.settings.advanced.sampling.super3')],
                ['supersample-4', t('create.settings.advanced.sampling.super4')],
              ],
              q.sampling,
              'corner-1',
            )}
            <div class="lz-option__value">
              <label class="lz-label" for="lz-o-agg"
                >${t('create.settings.advanced.sampling.aggregate')}</label
              >
              <div
                class="lz-input lz-select"
                ${attr('data-disabled', q.sampling.startsWith('super') ? null : 'true')}
              >
                <select id="lz-o-agg" ${attr('disabled', busy || !q.sampling.startsWith('super'))}>
                  ${(['max', 'mean', 'median'] as const).map((v) => html`<option value="${v}" ${attr('selected', (q.aggregate ?? 'max') === v)}>${t(`create.settings.advanced.sampling.${v}`)}</option>`)}
                </select>
              </div>
            </div>`,
          t('create.settings.advanced.sampling.consequence'),
        )}
        ${opt(
          'rounding',
          t('create.settings.advanced.rounding.label'),
          html`${sel(
              'lz-o-rounding',
              t('create.settings.advanced.rounding.label'),
              [
                ['trunc', t('create.settings.advanced.rounding.trunc')],
                ['round', t('create.settings.advanced.rounding.round')],
                ['ceil', t('create.settings.advanced.rounding.ceil')],
              ],
              q.rounding,
              'trunc',
            )}<label class="lz-check"
              ><input
                type="checkbox"
                id="lz-o-keep"
                ${attr('checked', q.keepSmall)}${attr('disabled', busy)}
              />${t('create.settings.advanced.rounding.keepSmall')}</label
            >`,
        )}
        ${opt(
          'cap',
          t('create.settings.advanced.cap.label'),
          html`<div class="lz-option__value">
            <div class="lz-input lz-input--num">
              <input
                id="lz-o-cap"
                inputmode="numeric"
                aria-label="${t('create.settings.advanced.cap.value')}"
                placeholder="${t('create.settings.advanced.capNone')}"
                value="${q.cap ?? ''}"
                ${attr('disabled', busy)}
              /><span class="lz-input__unit">${t('create.settings.advanced.capUnit')}</span>
            </div>
            ${q.cap === undefined || q.cap === null ? html` <span class="lz-badge lz-badge--legacy">${t('create.settings.advanced.legacyNone')}</span>` : ''}
          </div>`,
          t('create.settings.advanced.cap.consequence'),
        )}
        ${opt(
          'selection',
          t('create.settings.advanced.selection.label'),
          html`<div class="lz-option__values">
            ${radio('o-sel', 'touching', t('create.settings.advanced.selection.touching'), q.selection === 'touching', true)}${radio('o-sel', 'clip', t('create.settings.advanced.selection.clip'), q.selection === 'clip', false)}
          </div>`,
          t('create.settings.advanced.selection.consequence'),
        )}
        ${opt(
          'rotation',
          t('create.settings.advanced.rotation.label'),
          html`<div class="lz-option__values">
            ${radio('o-rot', 'aabb', t('create.settings.advanced.rotation.aabb'), q.rotation === 'aabb', true)}${radio('o-rot', 'rotate', t('create.settings.advanced.rotation.rotate'), q.rotation === 'rotate', false)}
          </div>`,
          t('create.settings.advanced.rotation.consequence'),
        )}
        <p class="lz-help lz-advanced__note">${t('create.settings.advanced.acceleration')}</p>
      </div>
    </details>`;
  }

  /** "What you'll get" + the disappearing buildings warning (SPEC §7.3). */
  private renderEstimates() {
    const box = $('#lz-estimates', this.panel);
    if (!box) return;
    const p = this.ctx.store.p;
    const tr = this.ctx.store.t;
    const q = p.params;
    const est = tr.estimate;
    const sig = JSON.stringify([
      est?.cols,
      est?.rows,
      est?.metresPerBrick,
      est?.maxBricks,
      est?.features,
      est?.featuresBelowOneBrick,
      est?.sampled,
      est?.fixes,
      tr.estimating,
      p.ui.disappearAck,
      q,
      this.showFlags,
    ]);
    if (sig === this.estSig) return;
    this.estSig = sig;
    const X = q.platesX,
      Y = q.platesY;
    const lines: Raw[] = [];
    if (est) {
      lines.push(
        html`<p>
          <strong
            >${t('create.settings.estimates.onTable', { w: n(X * 25.6, 1), d: n(Y * 25.6, 1), h: n(est.maxHeightCm, 1) })}</strong
          >
        </p>`,
      );
      if (Number.isFinite(est.metresPerBrick) && est.metresPerBrick > 0) {
        lines.push(
          html`<p>
            ${t('create.settings.estimates.brickHeight', { m: n(est.metresPerBrick, est.metresPerBrick < 10 ? 1 : 0) })}
          </p>`,
        );
        const r = (q.scale * 1.2) / est.metresPerBrick;
        lines.push(
          html`<p>
            ${r < 0.95 ? t('create.settings.estimates.flatter', { r: n(1 / r, 1) }) : r > 1.05 ? t('create.settings.estimates.taller', { r: n(r, 1) }) : t('create.settings.estimates.real')}
          </p>`,
        );
      }
    }
    lines.push(
      html`<p class="lz-muted">
        ${t('create.settings.estimates.studs', { total: n(X * Y * 1024) })} ·
        ${t('create.settings.estimates.mapScale', { n: n(mapScaleDenominator(q.scale)) })} ·
        ${fitsTable(X, Y) ? html`<span class="u-text-success">✓ ${t('create.area.tableFit.fits')}</span>` : t('create.area.tableFit.tooBig', { w: n(X * 25.6, 1), d: n(Y * 25.6, 1) })}
      </p>`,
    );
    let warn: Raw | '' = '';
    if (est && est.features === 0)
      warn = html`<div class="lz-alert lz-alert--warning" role="status">
        ${ic('warning')}
        <p>${t('create.settings.disappear.noBuildings')}</p>
      </div>`;
    else if (est && est.featuresBelowOneBrick > 0) {
      const pct = Math.round((100 * est.featuresBelowOneBrick) / est.features);
      const about = q.sampling === 'corner-1' || q.sampling === 'centre-1';
      const mpbText = n(est.metresPerBrick, est.metresPerBrick < 10 ? 1 : 0);
      const msg = t(about ? 'create.settings.disappear.messageAbout' : 'create.settings.disappear.message', {
        count: est.featuresBelowOneBrick,
        total: est.features,
        percent: pct,
        m: mpbText,
      });
      const studShare =
        est.sampled && est.sampled.builtStuds > 0 && est.sampled.erasedStuds > 0
          ? t('create.settings.disappear.studShare', {
              percent: Math.round((100 * est.sampled.erasedStuds) / est.sampled.builtStuds),
            })
          : '';
      const kind = pct >= 10 ? 'lz-alert--warning' : '';
      if (p.ui.disappearAck) {
        warn = html`<div class="lz-alert ${kind}" role="status">
          ${ic(pct >= 10 ? 'warning' : 'info')}
          <div class="lz-alert__body">
            <p>${t('create.settings.disappear.collapsed', { count: est.featuresBelowOneBrick })}</p>
            <button
              type="button"
              class="lz-btn lz-btn--tertiary lz-btn--sm"
              data-a="show-fixes"
              style="align-self:flex-start"
            >
              ${t('create.settings.disappear.showFixes')}
            </button>
          </div>
        </div>`;
      } else {
        const fixes: Raw[] = [];
        if (!q.keepSmall)
          fixes.push(
            html`<div class="lz-fix">
              <button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-a="fix-keep">
                ${t('create.settings.disappear.fixes.keepSmall')}</button
              ><span class="lz-fix__desc">${t('create.settings.disappear.fixes.keepSmallDesc')}</span>
            </div>`,
          );
        if (q.heightMode === 'normalized')
          fixes.push(
            html`<div class="lz-fix">
              <button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-a="fix-true">
                ${t('create.settings.disappear.fixes.trueScale')}</button
              ><span class="lz-fix__desc"
                >${t('create.settings.disappear.fixes.trueScaleDesc', { bricks: est.fixes.trueScale.maxBricks, cm: n(est.fixes.trueScale.maxHeightCm, 1) })}</span
              >
            </div>`,
          );
        if (est.fixes.maxHeight)
          fixes.push(
            html`<div class="lz-fix">
              <button
                type="button"
                class="lz-btn lz-btn--secondary lz-btn--sm"
                data-a="fix-max"
                data-value="${est.fixes.maxHeight.value}"
              >
                ${t('create.settings.disappear.fixes.maxHeight', { n: est.fixes.maxHeight.value })}</button
              ><span class="lz-fix__desc"
                >${t('create.settings.disappear.fixes.maxHeightDesc', { percent: Math.round(est.fixes.maxHeight.keepShare * 100) })}</span
              >
            </div>`,
          );
        warn = html`<div class="lz-alert ${kind}" role="status">
          ${ic(pct >= 10 ? 'warning' : 'info')}
          <div class="lz-alert__body">
            <p class="lz-alert__title">${msg}</p>
            ${studShare ? html`<p>${studShare}</p>` : ''}
            ${fixes.length ? html`<div class="lz-fixes">${fixes}</div>` : ''}
            <div class="lz-cluster lz-cluster--between">
              <button type="button" class="lz-btn lz-btn--tertiary lz-btn--sm" data-a="keep-as-is">
                ${t('create.settings.disappear.fixes.keepAsIs')}</button
              >${tr.webgl ? html`<label class="lz-check lz-small"><input type="checkbox" id="lz-show-flags" ${attr('checked', this.showFlags)} />${t('create.settings.disappear.showThem')}</label>` : ''}
            </div>
          </div>
        </div>`;
      }
    }
    setHtml(
      box,
      html`<h2 id="est-title">
          ${t('create.settings.estimates.title')}
          ${tr.estimating ? html`<span class="lz-badge lz-badge--plain">${t('create.settings.estimates.updating')}</span>` : ''}
        </h2>
        <div
          class="lz-card lz-card--sunken lz-card--tight lz-estimates${tr.estimating ? ' is-updating' : ''}"
          aria-live="polite"
        >
          ${lines}
        </div>
        ${warn}`,
    );
    const tallest = $('#lz-tallest-ro', this.panel);
    if (tallest && est)
      tallest.textContent = t('create.settings.maxHeight.readOnly', {
        bricks: est.maxBricks,
        cm: n(est.maxHeightCm, 1),
      });
  }

  // ------------------------------------------------------------------ edits

  private setParams(patch: Partial<Params>) {
    const st = this.ctx.store;
    const next = { ...st.p.params, ...patch };
    if (next.cap === null) delete next.cap;
    st.set({
      params: next,
      demoSettings: st.p.demoSettings && patch.keepSmall === undefined ? st.p.demoSettings : false,
    });
  }

  private commit(input: HTMLInputElement) {
    const v = parseNumber(input.value);
    const q = this.ctx.store.p.params;
    const fail = (m: string) => {
      setFieldError(input, m);
      this.invalid.add(input.id);
      this.ctx.renderActionbar();
    };
    const ok = () => {
      setFieldError(input, null);
      this.invalid.delete(input.id);
      this.ctx.renderActionbar();
    };
    switch (input.id) {
      case 'lz-scale3':
        if (!Number.isFinite(v) || v < 0.25 || v > 50) return fail(t('create.area.errors.scale'));
        ok();
        if (v !== q.scale) this.setParams({ scale: v });
        break;
      case 'lz-maxh':
        if (!Number.isInteger(v) || v < 1 || v > 100) return fail(t('create.settings.maxHeight.error'));
        ok();
        this.setParams({ maxHeight: v });
        break;
      case 'lz-px3':
      case 'lz-py3':
        if (!Number.isInteger(v) || v < 1 || v > 16) return fail(t('create.area.errors.plates'));
        ok();
        this.setParams(input.id === 'lz-px3' ? { platesX: v } : { platesY: v });
        break;
      case 'lz-exag':
        if (!Number.isFinite(v) || v < 0.5 || v > 5) return fail(t('create.settings.exaggeration.error'));
        ok();
        this.setParams({ exaggeration: v });
        break;
      case 'lz-o-cap':
      case 'lz-cap-main': {
        if (input.value.trim() === '') {
          ok();
          const { cap: _c, ...rest } = q;
          this.ctx.store.set({ params: rest });
          return;
        }
        if (!Number.isInteger(v) || v < 1 || v > 100) return fail(t('create.settings.advanced.cap.error'));
        ok();
        this.setParams({ cap: v });
        break;
      }
    }
  }

  private onChange = (e: Event) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const q = this.ctx.store.p.params;
    const ground = this.ctx.store.p.summary?.groundAvailable ?? false;
    if (el.name === 'lz-preset') {
      const v = el.value as PresetId;
      const st = this.ctx.store;
      if (v === 'legacy') st.set({ params: legacyOptions(q), demoSettings: false });
      else if (v === 'trueScale') st.set({ params: trueScaleOptions(q, ground), demoSettings: false });
      return;
    }
    if (el.id === 'lz-scale-slider') {
      this.setParams({ scale: fromSlider(Number(el.value)) });
      return;
    }
    if (el.name === 'o-hm')
      this.setParams({
        heightMode: el.value as Params['heightMode'],
        ...(el.value === 'exaggerated' && !q.exaggeration ? { exaggeration: 2 } : {}),
      });
    else if (el.name === 'o-hr') this.setParams({ heightRef: el.value as Params['heightRef'] });
    else if (el.name === 'o-sel') this.setParams({ selection: el.value as Params['selection'] });
    else if (el.name === 'o-rot') this.setParams({ rotation: el.value as Params['rotation'] });
    else if (el.id === 'lz-o-sampling') this.setParams({ sampling: el.value as Params['sampling'] });
    else if (el.id === 'lz-o-agg') this.setParams({ aggregate: el.value as Params['aggregate'] });
    else if (el.id === 'lz-o-rounding') this.setParams({ rounding: el.value as Params['rounding'] });
    else if (el.id === 'lz-o-keep') this.setParams({ keepSmall: (el as HTMLInputElement).checked });
    else if (el.id === 'lz-show-flags') {
      this.showFlags = (el as HTMLInputElement).checked;
      this.ctx.stage.setShowFlags(this.showFlags);
    } else if (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range')
      this.commit(el as HTMLInputElement);
  };

  private onInput = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (el.id === 'lz-scale-slider') {
      // live label while dragging; commit on release (change)
      const v = fromSlider(Number(el.value));
      el.setAttribute('aria-valuetext', t('create.settings.scale.sliderValue', { s: n(v, 2) }));
      const f = $<HTMLInputElement>('#lz-scale3', this.panel);
      if (f) f.value = String(v);
      el.parentElement?.style.setProperty('--_pct', `${(Number(el.value) / 10).toFixed(1)}%`);
    }
  };

  private onKeydown = (e: KeyboardEvent) => {
    const el = e.target as HTMLInputElement;
    if (e.key === 'Escape' && el.classList.contains('lz-info-btn')) {
      el.blur();
      return;
    }
    if (el.tagName !== 'INPUT' || el.type === 'range' || el.type === 'checkbox' || el.type === 'radio')
      return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commit(el);
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && el.dataset.min) {
      const v = parseNumber(el.value);
      if (!Number.isFinite(v)) return;
      e.preventDefault();
      el.value = String(
        Math.min(
          Number(el.dataset.max),
          Math.max(Number(el.dataset.min), v + (e.key === 'ArrowUp' ? 1 : -1)),
        ),
      );
      this.commit(el);
    }
  };

  private onToggle = (e: Event) => {
    if ((e.target as HTMLElement).id === 'lz-adv') this.advOpen = (e.target as HTMLDetailsElement).open;
  };

  private onClick = (e: Event) => {
    const el = e.target as Element;
    const st = this.ctx.store;
    const q = st.p.params;
    const dec = el.closest<HTMLElement>('[data-step-dec]');
    const inc = el.closest<HTMLElement>('[data-step-inc]');
    if (dec || inc) {
      const id = dec?.dataset.stepDec ?? inc!.dataset.stepInc!;
      const input = $<HTMLInputElement>(`#${id}`, this.panel)!;
      const v = parseNumber(input.value);
      input.value = String(
        Math.min(
          Number(input.dataset.max),
          Math.max(Number(input.dataset.min), (Number.isFinite(v) ? v : 1) + (dec ? -1 : 1)),
        ),
      );
      this.commit(input);
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
    const cap = el.closest<HTMLElement>('[data-tilecap]')?.dataset.tilecap as TileCapMode | undefined;
    if (cap) {
      setTileCap(this.ctx, cap);
      return;
    }
    const a = el.closest<HTMLElement>('[data-a]');
    if (!a) return;
    switch (a.dataset.a) {
      case 'reset-legacy':
        st.set({ params: legacyOptions(q), demoSettings: false });
        break;
      case 'switch-legacy':
        st.set({ params: { ...q, keepSmall: false }, demoSettings: false });
        break;
      case 'fix-keep':
        this.setParams({ keepSmall: true });
        break;
      case 'fix-true':
        st.set({ params: trueScaleOptions(q, st.p.summary?.groundAvailable ?? false), demoSettings: false });
        break;
      case 'fix-max':
        this.setParams({ maxHeight: Number(a.dataset.value) });
        break;
      case 'keep-as-is':
        st.setUi({ disappearAck: true });
        this.renderEstimates();
        break;
      case 'show-fixes':
        st.setUi({ disappearAck: false });
        this.renderEstimates();
        break;
    }
  };
}

export { OPTION_KEYS };
