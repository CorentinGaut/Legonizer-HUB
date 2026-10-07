/**
 * "Build" tab (SPEC O4, ux-spec §6.4, §7.6.2–7.6.4, §8.3–8.5, components.md §18–19): the build
 * board (plate map with progress), one step = one layer of one plate, layers below ghosted, new
 * bricks highlighted and outlined, "this step" callout, step controls, keyboard and numeric keypad
 * (NumLock on or off), list twin (2D diagram + positions), deep links, Table mode and keyboard help.
 * `BuildView` is shared with Plate mode (plate passes, OI-4).
 */
import { t } from '../shared/i18n.ts';
import { BRICKS } from '../core/packing/catalog.ts';
import { plateHeights } from '../core/export/guide.ts';
import { columnLetters } from '../core/packing/plates.ts';
import type { PlacedBrick } from '../core/types.ts';
import type { PlateSummary } from '../core/packing/pack.ts';
import {
  $,
  announce,
  attr,
  copyText,
  esc,
  html,
  ic,
  openDialog,
  raw,
  reducedMotion,
  setHtml,
  toast,
  type Raw,
} from '../create/dom.ts';
import type * as ThreeModule from '../create/viewport/three/index.ts';
import type { GuideRoute } from '../create/route.ts';
import type { BuildProgress } from '../create/state.ts';
import { isStale } from '../create/state.ts';
import type { Ctx } from '../create/stepView.ts';
import { brickRows, layerDiagram } from './diagram.ts';
import type { GuideData, Tab } from './guide.ts';
import { glyph } from './glyphs.ts';

type ThreeMod = typeof ThreeModule;
type Below = 'ghost' | 'solid' | 'hidden';

export interface BuildHost {
  data(): GuideData | null;
  progress(): BuildProgress;
  setProgress(p: BuildProgress): void;
  shortcuts(): boolean;
  setShortcuts(on: boolean): void;
  below(): Below;
  setBelow(b: Below): void;
  webgl: boolean;
  plateMode: boolean;
  /** Writes the step into the URL (replaceState for layers, §4.1). */
  onStep(plate: string, layer: number, push: boolean): void;
  share?(plate: string): void;
  goTable?(): void;
  link(plate: string, layer: number): string;
}

const KEYPAD: Record<string, string> = {
  Numpad6: 'next',
  Numpad4: 'prev',
  NumpadEnter: 'done',
  Numpad7: 'first',
  Numpad1: 'last',
  Numpad3: 'nextPlate',
  Numpad9: 'prevPlate',
  Numpad8: 'top',
  Numpad2: '3d',
  Numpad5: 'turn',
  Numpad0: 'reset',
  NumpadAdd: 'zoomIn',
  NumpadSubtract: 'zoomOut',
  NumpadDecimal: 'below',
  NumpadDivide: 'help',
  NumpadMultiply: 'help',
};

export class BuildView {
  private host: BuildHost;
  private el!: HTMLElement;
  plate = '';
  layer = 1;
  private hl: string | null = null;
  private listMode = false;
  private top = false;
  private turns = 0;
  private three: ThreeMod | null = null;
  private view: InstanceType<ThreeMod['ThreeView']> | null = null;
  private tm: {
    el: HTMLElement;
    view: InstanceType<ThreeMod['ThreeView']> | null;
    hintTimer: number;
    idleTimer: number;
  } | null = null;
  private framedPlate = '';

  constructor(host: BuildHost) {
    this.host = host;
  }

  mount(el: HTMLElement, route: { plate?: string; layer?: number }): void {
    this.el = el;
    this.listMode = !this.host.webgl;
    this.pickStep(route.plate, route.layer, false);
    this.render();
    el.addEventListener('click', this.onClick);
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('change', this.onChange);
    el.addEventListener('input', this.onInput);
  }

  unmount(): void {
    this.exitTableMode();
    this.view?.dispose();
    this.view = null;
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('keydown', this.onKey);
    this.el.removeEventListener('change', this.onChange);
    this.el.removeEventListener('input', this.onInput);
    this.el.innerHTML = '';
  }

  private plates(): PlateSummary[] {
    return this.host.data()?.packing.plates ?? [];
  }
  private summary(plate = this.plate): PlateSummary | undefined {
    return this.plates().find((p) => p.plate === plate);
  }
  private label(plate: string): string {
    return this.host.data()?.label(plate) ?? plate;
  }

  /** Chooses the plate and layer from a deep link, else the first unbuilt layer (§6.4.3). */
  private pickStep(plate?: string, layer?: number, toastInvalid = true) {
    const plates = this.plates();
    if (!plates.length) return;
    const prog = this.host.progress();
    let p = plate ? plates.find((x) => x.plate === plate) : undefined;
    if (plate && !p && toastInvalid) {
      const fb = plates[0]!.plate;
      toast(t('create.guide.build.deepLink.invalidPlate', { plate, fallback: this.label(fb) }));
    }
    if (!p) {
      p =
        (prog.current && plates.find((x) => x.plate === prog.current!.plate)) ||
        plates.find((x) => (prog.built[x.plate] ?? 0) < x.layers) ||
        plates[0]!;
    }
    this.plate = p.plate;
    const total = Math.max(1, p.layers);
    let L =
      layer ??
      (prog.current?.plate === p.plate
        ? prog.current.layer
        : Math.min(total, (prog.built[p.plate] ?? 0) + 1));
    if (layer !== undefined && (layer < 1 || layer > total) && toastInvalid)
      toast(
        t('create.guide.build.deepLink.invalidLayer', {
          plate: this.label(p.plate),
          total,
          fallback: Math.min(Math.max(1, layer), total),
        }),
      );
    L = Math.min(Math.max(1, L), total);
    this.layer = L;
  }

  route(r: { plate?: string; layer?: number }): void {
    if (r.plate === this.plate && r.layer === this.layer) return;
    this.pickStep(r.plate, r.layer);
    this.renderStep(false);
    this.renderBoard();
  }

  update(): void {
    if (!this.summary()) this.pickStep(undefined, undefined, false);
    this.render();
  }

  // ------------------------------------------------------------------ render

  private render() {
    const d = this.host.data();
    if (!d) return;
    setHtml(
      this.el,
      html`<div class="build-grid">
        <div class="build-side">
          <section class="lz-stack lz-stack--md lz-platemap-block" aria-labelledby="board-title">
            <h2 id="board-title" class="lz-h3">${t('create.guide.build.plateMap.title')}</h2>
            <div id="lz-board"></div>
            <div id="lz-board-tools"></div>
          </section>
          <section class="lz-callout" aria-labelledby="callout-title" id="lz-callout"></section>
        </div>
        <div class="build-main" id="lz-build-main">
          <div class="lz-step-header">
            <h1 class="lz-h2 lz-step-title" id="lz-step-title" tabindex="-1"></h1>
            <span class="lz-muted" id="lz-step-count"></span>
          </div>
          <div class="lz-build-view" id="lz-build-view"></div>
          <div class="lz-stepctl" id="lz-stepctl"></div>
          <p class="lz-visually-hidden" aria-live="polite" id="lz-build-live"></p>
        </div>
      </div>`,
    );
    this.renderBoard();
    this.renderStep(true);
  }

  private tileStatus(p: PlateSummary): { text: string; cls: string; built: number } {
    const built = Math.min(p.layers, this.host.progress().built[p.plate] ?? 0);
    if (p.layers === 0)
      return { text: t('create.guide.build.plateMap.status.empty'), cls: 'is-empty', built };
    if (built >= p.layers)
      return { text: `✓ ${t('create.guide.build.plateMap.status.built')}`, cls: 'is-built', built };
    if (built > 0)
      return {
        text: t('create.guide.build.plateMap.status.inProgress', { done: built, total: p.layers }),
        cls: '',
        built,
      };
    return { text: t('create.guide.build.plateMap.status.notStarted'), cls: '', built };
  }

  private renderBoard() {
    const d = this.host.data();
    const box = $('#lz-board', this.el);
    if (!d || !box) return;
    const prog = this.host.progress();
    const cols = d.platesX,
      rows = d.platesY;
    const cells: Raw[] = [html`<span></span>`];
    for (let c = 0; c < cols; c++)
      cells.push(html`<span class="lz-platemap__colhead" aria-hidden="true">${columnLetters(c)}</span>`);
    for (let r = 0; r < rows; r++) {
      cells.push(html`<span class="lz-platemap__rowhead" aria-hidden="true">${r + 1}</span>`);
      for (let c = 0; c < cols; c++) {
        const p = this.plates().find((x) => x.col === c && x.southRow === rows - 1 - r);
        if (!p) {
          cells.push(html`<span></span>`);
          continue;
        }
        const st = this.tileStatus(p);
        const team = prog.teams[p.plate];
        const bar: Raw[] = [];
        for (let k = 0; k < Math.max(1, Math.min(p.layers, 12)); k++)
          bar.push(
            html`<i
              class="${k < Math.round((st.built / Math.max(1, p.layers)) * Math.min(p.layers, 12)) ? 'on' : ''}"
            ></i>`,
          );
        cells.push(
          html`<button
            type="button"
            class="lz-plate-tile ${st.cls}"
            data-plate="${p.plate}"
            tabindex="${p.plate === this.plate ? 0 : -1}"
            ${attr('aria-current', p.plate === this.plate ? 'true' : null)}
          >
            <span class="lz-plate-tile__name"
              ><span class="lz-visually-hidden">${t('common.plate.name', { plate: '' }).trim()} </span
              >${this.label(p.plate)}</span
            >${team ? html`<span class="lz-plate-tile__team">${team}</span>` : ''}<span
              class="lz-plate-tile__status"
              ><span>${st.text}</span><span class="lz-plate-tile__bar" aria-hidden="true">${bar}</span></span
            >
          </button>`,
        );
      }
    }
    setHtml(
      box,
      html`<div
        class="lz-platemap"
        style="--cols: ${cols}"
        role="group"
        aria-label="${t('create.guide.build.plateMap.label')}"
      >
        ${cells}
      </div>`,
    );
    const allBuilt = this.plates().every((p) => p.layers === 0 || (prog.built[p.plate] ?? 0) >= p.layers);
    const cur = this.summary();
    const curBuilt = cur ? (prog.built[cur.plate] ?? 0) >= cur.layers : false;
    setHtml(
      $('#lz-board-tools', this.el)!,
      html`${
          allBuilt
            ? html`<div
                class="lz-alert lz-alert--success lz-allbuilt${reducedMotion() ? '' : ' is-celebrating'}"
                role="status"
              >
                ${ic('check-circle')}
                <div class="lz-alert__body">
                  <p>${t('create.guide.build.allBuilt')}</p>
                  ${this.host.goTable ? html`<button type="button" class="lz-btn lz-btn--primary lz-btn--sm" data-k="go-table" style="align-self:flex-start">${t('create.guide.build.allBuiltCta')}</button>` : ''}
                </div>
              </div>`
            : ''
        }
        ${
          this.host.plateMode
            ? ''
            : html`<div class="lz-field">
                <label class="lz-label" for="lz-team"
                  >${t('create.guide.build.plateMap.team.label', { plate: this.label(this.plate) })}</label
                >
                <div class="lz-input">
                  <input
                    id="lz-team"
                    value="${prog.teams[this.plate] ?? ''}"
                    placeholder="${t('create.guide.build.plateMap.team.placeholder')}"
                    maxlength="40"
                    autocomplete="off"
                  />
                </div>
              </div>`
        }
        <div class="lz-cluster">
          ${this.host.share ? html`<button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-k="share">${ic('qr', 'sm')}${t('create.guide.build.share.action')}</button>` : ''}<button
            type="button"
            class="lz-btn lz-btn--tertiary lz-btn--sm"
            data-k="mark"
          >
            ${curBuilt ? t('create.guide.build.plateMap.markNotBuilt') : t('create.guide.build.plateMap.markBuilt')}
          </button>
        </div>`,
    );
  }

  private stepBricks(layer = this.layer): PlacedBrick[] {
    const d = this.host.data();
    return d ? d.packing.bricks.filter((b) => b.plate === this.plate && b.layer === layer) : [];
  }

  private renderStep(rebuildView: boolean) {
    const d = this.host.data();
    const p = this.summary();
    if (!d || !p) return;
    const total = p.layers;
    const bricks = this.stepBricks();
    const counts: Record<string, number> = {};
    for (const b of bricks) counts[b.partId] = (counts[b.partId] ?? 0) + 1;
    const items = [...BRICKS].reverse().filter((b) => counts[b.id]);
    // header
    $('#lz-step-title', this.el)!.textContent = total
      ? t('create.guide.build.step.header', { plate: this.label(this.plate), layer: this.layer, total })
      : t('common.plate.name', { plate: this.label(this.plate) });
    $('#lz-step-count', this.el)!.textContent = total
      ? t('create.guide.build.step.newBricks', { count: bricks.length })
      : '';
    // callout
    setHtml(
      $('#lz-callout', this.el)!,
      html`<h2 id="callout-title" class="lz-h3">${t('create.guide.build.callout.title')}</h2>
        ${
          items.length
            ? html`<ul class="lz-callout__list">
                  ${items.map(
                    (b) =>
                      html`<li>
                        <button
                          type="button"
                          class="lz-callout__item"
                          data-part="${b.id}"
                          aria-pressed="${String(this.hl === b.id)}"
                        >
                          <span class="lz-callout__glyph">${raw(glyph(b.id))}</span
                          ><span class="lz-callout__qty"
                            >${t('create.guide.build.callout.item', { count: counts[b.id]!, size: `${b.width}×${b.length}` })}</span
                          ><span class="lz-callout__part">${b.id}</span
                          ><span class="lz-visually-hidden"
                            >, ${t('common.part.spoken', { w: b.width, d: b.length })}</span
                          >
                        </button>
                      </li>`,
                  )}
                </ul>
                <p class="lz-help">
                  ${this.hl ? html`<button type="button" class="lz-link lz-link--button" data-k="show-all">${t('create.guide.build.callout.showAll')}</button>` : t('create.guide.build.callout.hint')}
                </p>`
            : html`<p class="lz-muted">
                ${total ? t('create.guide.build.callout.empty') : t('create.guide.build.emptyPlate')}
              </p>`
        }`,
    );
    // view
    this.renderView(rebuildView);
    // controls
    const prog = this.host.progress();
    const built = prog.built[this.plate] ?? 0;
    const ticks: Raw[] = [];
    for (let k = 1; k <= total; k++)
      ticks.push(
        html`<button
          type="button"
          class="lz-scrubber__tick${k <= built ? ' is-built' : ''}"
          data-layer="${k}"
          aria-label="${t('create.guide.build.controls.scrubber', { layer: k, total })}${k <= built ? `, ${t('create.guide.build.plateMap.status.built')}` : ''}"
          ${attr('aria-current', k === this.layer ? 'step' : null)}
        ></button>`,
      );
    const last = this.layer >= total;
    setHtml(
      $('#lz-stepctl', this.el)!,
      total
        ? html`<div class="lz-stepctl__row">
              <button
                type="button"
                class="lz-btn lz-btn--secondary lz-btn--icon lz-btn--hide-sm"
                data-k="first"
                aria-label="${t('create.guide.build.controls.first')}"
                aria-keyshortcuts="Home 7"
                ${attr('disabled', this.layer <= 1)}
              >
                ${ic('first')}
              </button>
              <button
                type="button"
                class="lz-btn lz-btn--secondary"
                data-k="prev"
                aria-keyshortcuts="ArrowLeft 4"
                ${attr('disabled', this.layer <= 1)}
              >
                ${ic('chevron-left')}${t('create.guide.build.controls.previous')}
              </button>
              <div
                class="lz-scrubber"
                role="group"
                aria-label="${t('create.guide.build.controls.scrubber', { layer: this.layer, total })}"
              >
                ${ticks}
              </div>
              <button
                type="button"
                class="lz-btn lz-btn--secondary"
                data-k="next"
                aria-keyshortcuts="ArrowRight 6"
                ${attr('disabled', last)}
              >
                ${t('create.guide.build.controls.next')}${ic('chevron-right')}
              </button>
              <button
                type="button"
                class="lz-btn lz-btn--secondary lz-btn--icon lz-btn--hide-sm"
                data-k="last"
                aria-label="${t('create.guide.build.controls.last')}"
                aria-keyshortcuts="End 1"
                ${attr('disabled', last)}
              >
                ${ic('last')}
              </button>
            </div>
            <button
              type="button"
              class="lz-btn lz-btn--primary lz-btn--lg lz-stepctl__done"
              data-k="done"
              aria-keyshortcuts="Enter"
            >
              ${last ? t('create.guide.build.controls.doneLast') : t('create.guide.build.controls.done')}
              <kbd>Enter</kbd>
            </button>
            <p class="lz-keyhint">${raw(keyHint())}</p>
            <div class="lz-cluster">
              <button
                type="button"
                class="lz-btn lz-btn--tertiary lz-btn--sm"
                data-k="list"
                aria-pressed="${String(this.listMode)}"
                ${attr('disabled', !this.host.webgl)}
              >
                ${ic('layers', 'sm')}${this.listMode && this.host.webgl ? t('create.guide.build.list.hide') : t('create.guide.build.list.show')}</button
              ><button type="button" class="lz-btn lz-btn--tertiary lz-btn--sm" data-k="copy-link">
                ${ic('link', 'sm')}${t('create.guide.build.copyLink')}
              </button>
            </div>`
        : html`<p class="lz-alert">${ic('info')}<span>${t('create.guide.build.emptyPlate')}</span></p>`,
    );
  }

  private renderView(rebuild: boolean) {
    const box = $('#lz-build-view', this.el);
    const d = this.host.data();
    const p = this.summary();
    if (!box || !d || !p) return;
    const { col, southRow } = p;
    const heights = plateHeights(d.heightMap, col, southRow);
    const bricks = this.stepBricks();
    const label = t('create.guide.build.list.diagramTitle', {
      plate: this.label(this.plate),
      layer: this.layer,
    });
    if (this.listMode || !this.host.webgl) {
      this.view?.dispose();
      this.view = null;
      const rows = brickRows(bricks);
      setHtml(
        box,
        html`<div class="lz-card lz-card--tight list-twin">
          <figure>
            ${raw(p.layers ? layerDiagram(heights, bricks, this.layer, { label, highlight: this.hl, rotate: this.turns * 90 }) : '')}
            <figcaption class="lz-help u-mt-2">
              ${label}. ${t('create.guide.build.list.rulersNote')}
            </figcaption>
          </figure>
          <div class="lz-stack lz-stack--sm">
            ${!this.host.webgl ? this.viewTools(true) : ''}
            <div class="lz-legend lz-legend--inline">
              <span class="lz-legend__item"
                ><span
                  class="lz-swatch"
                  style="--sw: var(--lz-brick-new-top); box-shadow: inset 0 0 0 1.5px var(--lz-brick-new-edge)"
                ></span
                >${t('create.guide.build.legend.new')}</span
              ><span class="lz-legend__item"
                ><span class="lz-swatch" style="--sw: var(--lz-brick-ghost)"></span
                >${t('create.guide.build.legend.below')}</span
              >
            </div>
            <div class="lz-table-wrap">
              <table class="lz-table newlist">
                <caption>
                  ${t('create.guide.build.list.caption', { layer: this.layer })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">${t('create.guide.build.list.brick')}</th>
                    <th scope="col" class="num">${t('create.guide.build.list.column')}</th>
                    <th scope="col" class="num">${t('create.guide.build.list.row')}</th>
                    <th scope="col">${t('create.guide.build.list.lying')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(
                    (r) =>
                      html`<tr>
                        <td>${r.size}</td>
                        <td class="num">${r.col}</td>
                        <td class="num">${r.row}</td>
                        <td>
                          ${r.lying === 'we' ? t('create.guide.build.list.lyingWE') : r.lying === 'ns' ? t('create.guide.build.list.lyingNS') : t('create.guide.build.list.square')}
                        </td>
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>
            <p class="lz-help">${t('create.guide.build.list.positionNote')}</p>
          </div>
        </div>`,
      );
      return;
    }
    if (!box.querySelector('.lz-viewport')) {
      this.view?.dispose();
      this.view = null;
      setHtml(
        box,
        html`<div class="lz-viewport lz-viewport--build" id="lz-build-vp">
          <div class="lz-build-chrome"></div>
        </div>`,
      );
    }
    // toolbar state (Top / 3D, layers below)
    const chrome = box.querySelector('.lz-build-chrome');
    if (chrome) chrome.innerHTML = toolbarHtml(this);
    void this.renderThree(rebuild);
  }

  viewTools(twoD: boolean): Raw {
    return twoD
      ? html`<div class="lz-cluster lz-build-2dtools">${raw(turnButton())}</div>`
      : raw(toolbarHtml(this));
  }

  get isTop() {
    return this.top;
  }
  get belowMode(): Below {
    return this.host.below();
  }

  private async renderThree(_rebuild: boolean) {
    const box = $('#lz-build-vp', this.el);
    const d = this.host.data();
    if (!box || !d) return;
    if (!this.three) this.three = await import('../create/viewport/three/index.ts');
    if (!this.el.isConnected || !$('#lz-build-vp', this.el)) return;
    const label = t('a11y.viewport.build', { plate: this.label(this.plate), layer: this.layer });
    if (!this.view) {
      this.view = new this.three.ThreeView(box, {
        label: `${label}. ${t('a11y.viewport.description', { link: t('create.guide.build.list.show') })}`,
        shadows: true,
        fov: 30,
      });
      this.view.onRender = () => {
        const svg = box.querySelector<SVGElement>('.lz-compass svg');
        if (svg && this.view) svg.style.setProperty('--bearing', `${-this.view.bearing()}deg`);
      };
      this.framedPlate = '';
    }
    this.view.canvas.setAttribute(
      'aria-label',
      `${label}. ${t('a11y.viewport.description', { link: t('create.guide.build.list.show') })}`,
    );
    this.fillThree(this.view);
  }

  private fillThree(view: InstanceType<ThreeMod['ThreeView']>) {
    const d = this.host.data()!;
    const three = this.three!;
    const L = this.layer,
      hl = this.hl,
      below = this.host.below();
    const style = (b: PlacedBrick) => {
      if (b.layer < L) return below;
      if (b.layer > L) return 'hidden' as const;
      return hl && b.partId !== hl ? ('solid' as const) : ('new' as const);
    };
    const { group, bounds } = three.buildBrickModel(d.packing.bricks, {
      platesX: d.platesX,
      platesY: d.platesY,
      plates: [this.plate],
      originPlate: this.plate,
      style,
      baseplateColour: 'grey',
    });
    const full = new three.Box3(
      new three.Vector3(-2.5, -2.5, -0.3),
      new three.Vector3(34.5, 34.5, Math.max(3, (this.summary()?.layers ?? 1) * 1.2)),
    );
    view.setContent([group, three.studRulers()], full);
    if (this.framedPlate !== this.plate) {
      this.framedPlate = this.plate;
      view.setTop(this.top);
      view.frame(full, { azimuth: -28 + this.turns * 90, elevation: 46, margin: 1.02 });
    }
    void bounds;
  }

  // ------------------------------------------------------------------ navigation

  go(layer: number, opts: { plate?: string; push?: boolean; announce?: boolean } = {}) {
    const plate = opts.plate ?? this.plate;
    const p = this.plates().find((x) => x.plate === plate);
    if (!p) return;
    const changedPlate = plate !== this.plate;
    this.plate = plate;
    this.layer = Math.min(Math.max(1, layer), Math.max(1, p.layers));
    this.hl = null;
    const prog = this.host.progress();
    this.host.setProgress({ ...prog, current: { plate: this.plate, layer: this.layer } });
    this.host.onStep(this.plate, this.layer, !!opts.push);
    this.renderStep(true);
    if (changedPlate) this.renderBoard();
    else this.updateScrubber();
    if (this.tm) this.renderTableMode();
    if (opts.announce !== false) this.announceStep();
  }

  private updateScrubber() {
    // board tile text may change (progress); cheap full re-render of the board
    this.renderBoard();
  }

  private announceStep() {
    const p = this.summary();
    if (!p) return;
    const bricks = this.stepBricks();
    const counts: Record<string, number> = {};
    for (const b of bricks) counts[b.partId] = (counts[b.partId] ?? 0) + 1;
    const parts = [...BRICKS]
      .reverse()
      .filter((b) => counts[b.id])
      .map((b) => `${counts[b.id]} ${t('common.part.spoken', { w: b.width, d: b.length })}`)
      .join(', ');
    const text = p.layers
      ? t('create.guide.build.step.announce', {
          plate: this.label(this.plate),
          layer: this.layer,
          total: p.layers,
          parts: parts || t('create.guide.build.callout.empty'),
        })
      : t('create.guide.build.emptyPlate');
    announce(text);
  }

  private nextPlate(dir: 1 | -1) {
    const plates = this.plates();
    const i = plates.findIndex((p) => p.plate === this.plate);
    const j = (i + dir + plates.length) % plates.length;
    const p = plates[j]!;
    const built = this.host.progress().built[p.plate] ?? 0;
    this.go(Math.min(Math.max(1, p.layers), built + 1), { plate: p.plate, push: true });
  }

  private async done() {
    const p = this.summary();
    if (!p || !p.layers) return;
    const prog = this.host.progress();
    const built = { ...prog.built, [p.plate]: Math.max(prog.built[p.plate] ?? 0, this.layer) };
    this.host.setProgress({ ...prog, built });
    if (this.layer < p.layers) {
      this.go(this.layer + 1);
      return;
    }
    // plate finished
    this.renderBoard();
    this.renderStep(false);
    const plates = this.plates();
    const next = plates.find((x) => x.layers > 0 && (built[x.plate] ?? 0) < x.layers);
    if (!next) {
      announce(
        this.host.plateMode
          ? t('create.guide.build.plateMode.done', { plate: this.label(p.plate) })
          : t('create.guide.build.allBuilt'),
      );
      return;
    }
    if (this.tm) {
      this.go(Math.max(1, (built[next.plate] ?? 0) + 1), { plate: next.plate, push: true });
      return;
    }
    const r = await openDialog({
      title: t('create.guide.build.plateDone', { plate: this.label(p.plate), next: this.label(next.plate) }),
      body: html`<p class="lz-muted">${t('create.guide.build.plateMap.status.built')} ✓</p>`,
      actions: [
        ...(this.host.share
          ? [{ label: t('create.guide.build.share.action'), value: 'share', icon: 'qr' as const }]
          : []),
        { label: t('create.guide.build.plateDoneContinue'), kind: 'primary' as const, value: 'next' },
      ],
    });
    if (r === 'next') this.go(Math.max(1, (built[next.plate] ?? 0) + 1), { plate: next.plate, push: true });
    else if (r === 'share') this.host.share?.(p.plate);
  }

  private action(a: string): boolean {
    const p = this.summary();
    switch (a) {
      case 'next':
        if (p && this.layer < p.layers) this.go(this.layer + 1);
        return true;
      case 'prev':
        if (this.layer > 1) this.go(this.layer - 1);
        return true;
      case 'first':
        this.go(1);
        return true;
      case 'last':
        if (p) this.go(p.layers);
        return true;
      case 'done':
        void this.done();
        return true;
      case 'nextPlate':
        this.nextPlate(1);
        return true;
      case 'prevPlate':
        this.nextPlate(-1);
        return true;
      case 'top':
        this.setTop(true);
        return true;
      case '3d':
        this.setTop(false);
        return true;
      case 'turn':
        this.turns = (this.turns + 1) % 4;
        if (this.view) this.view.turn(90);
        if (this.tm?.view) this.tm.view.turn(90);
        if (!this.view || this.listMode) this.renderView(false);
        return true;
      case 'reset':
        this.turns = 0;
        this.framedPlate = '';
        this.renderView(true);
        if (this.tm?.view) this.tm.view.frame(undefined, { azimuth: -28, elevation: 46, margin: 1.02 });
        return true;
      case 'zoomIn':
        (this.tm?.view ?? this.view)?.zoom(1.2);
        return true;
      case 'zoomOut':
        (this.tm?.view ?? this.view)?.zoom(1 / 1.2);
        return true;
      case 'below': {
        const order: Below[] = ['ghost', 'solid', 'hidden'];
        this.setBelow(order[(order.indexOf(this.host.below()) + 1) % 3]!);
        return true;
      }
      case 'help':
        void this.keyboardHelp();
        return true;
    }
    return false;
  }

  private setTop(top: boolean) {
    this.top = top;
    this.view?.setTop(top);
    this.tm?.view?.setTop(top);
    this.renderView(false);
  }

  private setBelow(b: Below) {
    this.host.setBelow(b);
    this.renderView(true);
    if (this.tm) this.renderTableMode();
  }

  // ------------------------------------------------------------------ events

  private onClick = (e: Event) => {
    const el = e.target as Element;
    const tile = el.closest<HTMLElement>('[data-plate]');
    if (tile && tile.classList.contains('lz-plate-tile')) {
      const p = this.plates().find((x) => x.plate === tile.dataset.plate)!;
      const built = this.host.progress().built[p.plate] ?? 0;
      this.go(Math.min(Math.max(1, p.layers), built + 1), { plate: p.plate, push: true });
      requestAnimationFrame(() => $<HTMLElement>(`[data-plate="${p.plate}"]`, this.el)?.focus());
      return;
    }
    const tick = el.closest<HTMLElement>('[data-layer]');
    if (tick) {
      this.go(Number(tick.dataset.layer));
      return;
    }
    const part = el.closest<HTMLElement>('.lz-callout__item');
    if (part) {
      this.hl = this.hl === part.dataset.part ? null : part.dataset.part!;
      this.renderStep(true);
      $<HTMLElement>(`.lz-callout__item[data-part="${part.dataset.part}"]`, this.el)?.focus();
      return;
    }
    const k = el.closest<HTMLElement>('[data-k]')?.dataset.k;
    if (!k) return;
    if (this.action(k)) return;
    switch (k) {
      case 'show-all':
        this.hl = null;
        this.renderStep(true);
        break;
      case 'list':
        this.listMode = !this.listMode;
        this.framedPlate = '';
        this.renderView(true);
        this.renderStep(false);
        break;
      case 'copy-link':
        void copyText(this.host.link(this.plate, this.layer)).then((ok) =>
          toast(ok ? t('create.guide.build.linkCopied') : t('errors.copyFailed')),
        );
        break;
      case 'share':
        this.host.share?.(this.plate);
        break;
      case 'mark': {
        const p = this.summary();
        if (!p) return;
        const prog = this.host.progress();
        const isBuilt = (prog.built[p.plate] ?? 0) >= p.layers;
        this.host.setProgress({ ...prog, built: { ...prog.built, [p.plate]: isBuilt ? 0 : p.layers } });
        this.renderBoard();
        this.renderStep(false);
        break;
      }
      case 'go-table':
        this.host.goTable?.();
        break;
      case 'table-mode':
        void this.enterTableMode();
        break;
      case 'below-ghost':
      case 'below-solid':
      case 'below-hidden':
        this.setBelow(k.slice(6) as Below);
        break;
    }
  };

  private onChange = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (el.id === 'lz-team') {
      const prog = this.host.progress();
      const teams = { ...prog.teams };
      if (el.value.trim()) teams[this.plate] = el.value.trim();
      else delete teams[this.plate];
      this.host.setProgress({ ...prog, teams });
      this.renderBoard();
      $<HTMLInputElement>('#lz-team', this.el)?.focus();
    }
  };
  private onInput = () => {};

  /** Keyboard and numeric keypad (§6.4.2); single keys only inside the Build region, not in fields. */
  private onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('.lz-platemap') &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
    ) {
      this.moveTileFocus(target, e.key);
      e.preventDefault();
      return;
    }
    if (this.handleKey(e)) e.preventDefault();
  };

  handleKey(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || e.ctrlKey || e.metaKey || e.altKey)
      return false;
    const pad = KEYPAD[e.code];
    const single = this.host.shortcuts() || !!this.tm;
    if (pad && single) return this.action(pad);
    if (e.key === 'Enter' && target.tagName === 'BUTTON' && !target.closest('[data-k=done]')) return false;
    switch (e.key) {
      case 'ArrowRight':
        return this.action('next');
      case 'ArrowLeft':
        return this.action('prev');
      case ' ':
        if (target.tagName === 'BUTTON') return false;
        return this.action(e.shiftKey ? 'prev' : 'next');
      case 'Enter':
        return this.action('done');
      case 'Home':
        return this.action('first');
      case 'End':
        return this.action('last');
      case 'PageDown':
        return this.action('nextPlate');
      case 'PageUp':
        return this.action('prevPlate');
    }
    if (!single) return false;
    switch (e.key) {
      case ']':
        return this.action('nextPlate');
      case '[':
        return this.action('prevPlate');
      case 'ArrowUp':
        return this.action('top');
      case 'ArrowDown':
        return this.action('3d');
      case 'r':
      case 'R':
        return this.action('turn');
      case '0':
        return this.action('reset');
      case '+':
        return this.action('zoomIn');
      case '-':
        return this.action('zoomOut');
      case 'g':
      case 'G':
        return this.action('below');
      case '?':
        return this.action('help');
    }
    return false;
  }

  private moveTileFocus(from: HTMLElement, key: string) {
    const d = this.host.data()!;
    const tile = from.closest<HTMLElement>('[data-plate]');
    if (!tile) return;
    const p = this.plates().find((x) => x.plate === tile.dataset.plate)!;
    let c = p.col,
      r = d.platesY - 1 - p.southRow;
    if (key === 'ArrowLeft') c--;
    if (key === 'ArrowRight') c++;
    if (key === 'ArrowUp') r--;
    if (key === 'ArrowDown') r++;
    const q = this.plates().find((x) => x.col === c && d.platesY - 1 - x.southRow === r);
    if (!q) return;
    this.el
      .querySelectorAll<HTMLElement>('.lz-plate-tile')
      .forEach((b) => (b.tabIndex = b.dataset.plate === q.plate ? 0 : -1));
    $<HTMLElement>(`.lz-plate-tile[data-plate="${q.plate}"]`, this.el)?.focus();
  }

  // ------------------------------------------------------------------ keyboard help (§6.4.2)

  private async keyboardHelp() {
    const rows: [string, string, string][] = [
      ['next', '→ / Space', '6'],
      ['previous', '← / Shift + Space', '4'],
      ['done', 'Enter', 'Enter'],
      ['first', 'Home', '7'],
      ['last', 'End', '1'],
      ['nextPlate', 'Page Down / ]', '3'],
      ['previousPlate', 'Page Up / [', '9'],
      ['top', '↑', '8'],
      ['threeD', '↓', '2'],
      ['turn', 'R', '5'],
      ['reset', '0', '0'],
      ['zoom', '+ / −', '+ / −'],
      ['below', 'G', '.'],
      ['help', '?', '/ *'],
      ['exit', 'Esc', '—'],
    ];
    const on = this.host.shortcuts();
    const r = await openDialog({
      title: t('create.guide.build.keys.title'),
      wide: true,
      body: html`<p>${t('create.guide.build.keys.intro')}</p>
        <div class="lz-table-wrap">
          <table class="lz-table lz-keys-table">
            <thead>
              <tr>
                <th scope="col">${t('create.guide.build.keys.columns.action')}</th>
                <th scope="col">${t('create.guide.build.keys.columns.keyboard')}</th>
                <th scope="col">${t('create.guide.build.keys.columns.keypad')}</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(
                ([k, kb, kp]) =>
                  html`<tr>
                    <th scope="row">${t(`create.guide.build.keys.${k}`)}</th>
                    <td><kbd>${kb}</kbd></td>
                    <td><kbd>${kp}</kbd></td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>
        <fieldset class="lz-option">
          <legend>${t('create.guide.build.keys.shortcuts.label')}</legend>
          <div class="lz-option__values">
            <label class="lz-radio"
              ><input
                type="radio"
                name="lz-sc"
                value="on"
                ${attr('checked', on)}
              />${t('create.guide.build.keys.shortcuts.on')}</label
            ><label class="lz-radio"
              ><input
                type="radio"
                name="lz-sc"
                value="off"
                ${attr('checked', !on)}
              />${t('create.guide.build.keys.shortcuts.off')}</label
            >
          </div>
          <p class="lz-help">${t('create.guide.build.keys.shortcuts.help')}</p>
        </fieldset>`,
      actions: [{ label: t('common.actions.close'), kind: 'primary', value: 'close' }],
      onOpen: (d) => {
        d.addEventListener('change', (e) => {
          const v = (e.target as HTMLInputElement).value;
          this.host.setShortcuts(v === 'on');
        });
      },
    });
    void r;
  }

  // ------------------------------------------------------------------ Table mode (§6.4.2, UI-14)

  private async enterTableMode() {
    if (this.tm) return;
    const el = document.createElement('div');
    el.className = 'tm lz-room';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', t('create.guide.build.tableModeLabel'));
    el.tabIndex = -1;
    document.body.append(el);
    this.tm = { el, view: null, hintTimer: 0, idleTimer: 0 };
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.exitTableMode();
        return;
      }
      this.showTmHint();
      if (this.handleKey(e)) e.preventDefault();
    });
    el.addEventListener('click', (e) => {
      const k = (e.target as Element).closest<HTMLElement>('[data-tm]')?.dataset.tm;
      if (k === 'exit') this.exitTableMode();
      else if (k) this.action(k);
    });
    el.addEventListener('pointermove', () => this.showTmControls());
    this.renderTableMode();
    try {
      await el.requestFullscreen?.();
    } catch {
      // full screen refused: the overlay still covers the window
    }
    document.addEventListener('fullscreenchange', this.onFsChange);
    el.focus();
    this.showTmHint();
    this.showTmControls();
  }

  private onFsChange = () => {
    if (!document.fullscreenElement && this.tm) this.exitTableMode();
  };

  private exitTableMode() {
    const tm = this.tm;
    if (!tm) return;
    this.tm = null;
    document.removeEventListener('fullscreenchange', this.onFsChange);
    clearTimeout(tm.hintTimer);
    clearTimeout(tm.idleTimer);
    tm.view?.dispose();
    tm.el.remove();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    $<HTMLElement>('[data-k=table-mode]', this.el)?.focus();
  }

  private showTmHint() {
    const tm = this.tm;
    if (!tm) return;
    tm.el.classList.add('show-keys');
    clearTimeout(tm.hintTimer);
    tm.hintTimer = window.setTimeout(() => tm.el.classList.remove('show-keys'), 5000);
  }
  private showTmControls() {
    const tm = this.tm;
    if (!tm) return;
    tm.el.classList.remove('is-idle');
    clearTimeout(tm.idleTimer);
    tm.idleTimer = window.setTimeout(() => tm.el.classList.add('is-idle'), 3000);
  }

  private renderTableMode() {
    const tm = this.tm;
    const d = this.host.data();
    const p = this.summary();
    if (!tm || !d || !p) return;
    const prog = this.host.progress();
    const bricks = this.stepBricks();
    const counts: Record<string, number> = {};
    for (const b of bricks) counts[b.partId] = (counts[b.partId] ?? 0) + 1;
    const items = [...BRICKS].reverse().filter((b) => counts[b.id]);
    const cells: Raw[] = [html`<span></span>`];
    for (let c = 0; c < d.platesX; c++)
      cells.push(html`<span class="lz-platemap__colhead">${columnLetters(c)}</span>`);
    for (let r = 0; r < d.platesY; r++) {
      cells.push(html`<span class="lz-platemap__rowhead">${r + 1}</span>`);
      for (let c = 0; c < d.platesX; c++) {
        const q = this.plates().find((x) => x.col === c && x.southRow === d.platesY - 1 - r);
        if (!q) {
          cells.push(html`<span></span>`);
          continue;
        }
        const b = prog.built[q.plate] ?? 0;
        cells.push(
          html`<span
            class="lz-plate-tile${b >= q.layers ? ' is-built' : ''}"
            ${attr('aria-current', q.plate === this.plate ? 'true' : null)}
            ><span class="lz-plate-tile__name">${this.label(q.plate)}</span
            ><span
              >${b >= q.layers ? '✓' : t('create.guide.build.plateMap.layerShort', { done: b, total: q.layers })}</span
            ></span
          >`,
        );
      }
    }
    const keepCanvas = tm.view?.canvas;
    setHtml(
      tm.el,
      html`<div class="tm__head">
          <p class="tm__title">
            ${t('create.guide.build.step.header', { plate: this.label(this.plate), layer: this.layer, total: p.layers })}<br /><span
              class="tm__sub"
              >${t('create.guide.build.step.newBricks', { count: bricks.length })}${prog.teams[this.plate] ? ` · ${prog.teams[this.plate]}` : ''}</span
            >
          </p>
          <div class="lz-platemap" style="--cols: ${d.platesX}" aria-hidden="true">${cells}</div>
          <button type="button" class="lz-btn lz-btn--on-room tm__exit" data-tm="exit">
            ${ic('fullscreen-exit')}${t('create.guide.build.view.exitTableMode')}
          </button>
        </div>
        <div class="tm__view" id="lz-tm-view"></div>
        <ul class="tm__callout" aria-label="${t('create.guide.build.callout.title')}">
          ${items.map((b) => html`<li>${raw(glyph(b.id))}${t('create.guide.build.callout.item', { count: counts[b.id]!, size: `${b.width}×${b.length}` })}</li>`)}
        </ul>
        <div class="tm__controls">
          <button type="button" class="lz-btn lz-btn--on-room lz-btn--lg" data-tm="prev">
            ${ic('chevron-left')}${t('create.guide.build.controls.previous')}</button
          ><button type="button" class="lz-btn lz-btn--primary lz-btn--lg" data-tm="done">
            ${t('create.guide.build.controls.done')}</button
          ><button type="button" class="lz-btn lz-btn--on-room lz-btn--lg" data-tm="next">
            ${t('create.guide.build.controls.next')}${ic('chevron-right')}
          </button>
        </div>
        <p class="tm__keys">${t('create.guide.build.keys.tableModeHint')}</p>`,
    );
    const host = $('#lz-tm-view', tm.el)!;
    if (keepCanvas && tm.view) {
      host.append(keepCanvas);
      tm.view.resize();
      this.fillThree(tm.view);
    } else if (this.host.webgl && this.three) {
      tm.view = new this.three.ThreeView(host, {
        label: t('a11y.viewport.build', { plate: this.label(this.plate), layer: this.layer }),
        fov: 30,
      });
      tm.view.safeTop = 8;
      tm.view.safeBottom = 8;
      this.framedPlate = '';
      this.fillThree(tm.view);
      tm.view.setTop(this.top);
      tm.view.frame(undefined, { azimuth: -28 + this.turns * 90, elevation: 46, margin: 1.02 });
    } else {
      const heights = plateHeights(d.heightMap, p.col, p.southRow);
      host.innerHTML = layerDiagram(heights, bricks, this.layer, { label: '', rotate: this.turns * 90 });
    }
  }
}

function keyHint(): string {
  return t('create.guide.build.keys.hint')
    .split(' · ')
    .map((part) => `<span>${part.replace(/([←→]|Enter|\?|\d\/\d|\d)/g, '<kbd>$1</kbd>')}</span>`)
    .join('');
}

function turnButton(): string {
  return `<button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-k="turn" aria-keyshortcuts="R 5" title="${esc(t('create.guide.build.view.turnHelp'))}">${iconStr('rotate')}${esc(t('create.guide.build.view.turn'))}</button>`;
}

function toolbarHtml(v: BuildView): string {
  const below = v.belowMode;
  const seg = (k: Below) =>
    `<button type="button" data-k="below-${k}" aria-pressed="${below === k}">${t(`create.guide.build.view.below.${k}`)}</button>`;
  return `<div class="lz-vp-toolbar"><div class="lz-vp-group" role="toolbar" aria-label="${t('create.shell.toolbar.label')}">
    <button type="button" class="lz-btn" data-k="top" aria-pressed="${v.isTop}" aria-keyshortcuts="8">${iconStr('view-top')}${t('create.guide.build.view.top')}</button>
    <button type="button" class="lz-btn" data-k="3d" aria-pressed="${!v.isTop}" aria-keyshortcuts="2">${iconStr('view-3d')}${t('create.guide.build.view.threeD')}</button>
    <span class="lz-vp-sep"></span>
    <button type="button" class="lz-btn" data-k="turn" aria-keyshortcuts="R 5" title="${t('create.guide.build.view.turnHelp')}">${iconStr('rotate')}${t('create.guide.build.view.turn')}</button>
    <span class="lz-small u-hide-sm lz-vp-text">${t('create.guide.build.view.below.label')}</span>
    <div class="lz-segmented u-hide-sm" role="group" aria-label="${t('create.guide.build.view.below.label')}">${seg('ghost')}${seg('solid')}${seg('hidden')}</div>
  </div><span class="lz-vp-toolbar__spacer"></span>
  <div class="lz-vp-group u-hide-sm" role="toolbar" aria-label="${t('create.shell.toolbar.label')}"><button type="button" class="lz-btn" data-k="table-mode">${iconStr('table')}${t('create.guide.build.view.tableMode')}</button><button type="button" class="lz-btn lz-btn--icon" data-k="help" aria-label="${t('create.guide.build.view.help')}" title="${t('create.guide.build.view.help')}" aria-keyshortcuts="?">${iconStr('keyboard')}</button></div></div>
  <div class="lz-vp-bottom"><div class="lz-legend" role="group" aria-label="${t('create.shell.toolbar.legend')}"><span class="lz-legend__item"><span class="lz-swatch" style="--sw: var(--lz-brick-new-top); box-shadow: inset 0 0 0 1.5px var(--lz-brick-new-edge)"></span>${t('create.guide.build.legend.new')}</span><span class="lz-legend__item"><span class="lz-swatch" style="--sw: var(--lz-brick-ghost)"></span>${t('create.guide.build.legend.below')}</span></div><span class="u-grow"></span><div class="lz-compass" role="img" aria-label="${t('create.shell.compass')}"><span class="lz-compass__n" aria-hidden="true">N</span><svg aria-hidden="true"><use href="#i-north"/></svg></div></div>`;
}

function iconStr(name: Parameters<typeof ic>[0]): string {
  return `<svg class="lz-icon lz-icon--sm" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}

// ====================================================================== the tab in the guide

export class BuildTab implements Tab {
  private ctx: Ctx;
  private view: BuildView;
  private data: () => GuideData | null;
  private route0: GuideRoute;

  constructor(ctx: Ctx, data: () => GuideData | null, route: GuideRoute) {
    this.ctx = ctx;
    this.data = data;
    this.route0 = route;
    const st = ctx.store;
    this.view = new BuildView({
      data,
      progress: () => st.p.progress,
      setProgress: (p) => st.set({ progress: p }),
      shortcuts: () => st.p.ui.shortcuts,
      setShortcuts: (on) => st.setUi({ shortcuts: on }),
      below: () => st.p.ui.belowMode,
      setBelow: (b) => st.setUi({ belowMode: b }),
      webgl: st.t.webgl,
      plateMode: false,
      onStep: (plate, layer, push) => {
        const h = `#guide/build/${plate}/${layer}`;
        if (location.hash === h) return;
        if (push) history.pushState(null, '', h);
        else history.replaceState(null, '', h);
      },
      share: (plate) =>
        void import('./share.ts').then(({ openShareDialog }) => openShareDialog(ctx, data()!, plate)),
      goTable: () => {
        history.pushState(null, '', '#guide/table');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      },
      link: (plate, layer) => `${location.origin}${location.pathname}#guide/build/${plate}/${layer}`,
    });
  }

  mount(el: HTMLElement): void {
    this.view.mount(el, this.route0);
    if (isStale(this.ctx.store.p)) el.dataset.readonly = 'true';
  }
  update(changed: Set<string>): void {
    if (changed.has('result')) this.view.update();
  }
  unmount(): void {
    this.view.unmount();
  }
  route(r: GuideRoute): void {
    this.view.route(r);
  }
}
