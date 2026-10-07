/**
 * "Get the bricks" tab (SPEC O3, O6, O7, §7.5.1 settings):
 * the brick shelf (to scale, whole model or one plate's kit), part settings with automatic
 * re-packing (1×1 locked, SPEC §7.5.1), the honest packing report (valid lower bound, SPEC §12), the shop
 * handoff (BrickLink XML copy/download, Rebrickable CSV, paper list), spares and baseplate colour.
 */
import { t } from '../shared/i18n.ts';
import { BASEPLATE, BRICKS } from '../core/packing/catalog.ts';
import type { PlacedBrick } from '../core/types.ts';
import { $, attr, copyText, html, ic, raw, setHtml, toast, type Raw } from '../create/dom.ts';
import { n } from '../create/format.ts';
import type { GuideRoute } from '../create/route.ts';
import { ALL_PART_IDS, isStale } from '../create/state.ts';
import type { Ctx } from '../create/stepView.ts';
import type { GuideData, Tab } from './guide.ts';
import { glyph } from './glyphs.ts';
import { heightMap2dSvg } from '../create/viewport/heightmap2d.ts';
import type * as ThreeModule from '../create/viewport/three/index.ts';

type ThreeMod = typeof ThreeModule;
const COMMON = ['3005', '3004', '3010', '3003', '3001'];
const SQUARES = ['3005', '3003'];

export class BricksTab implements Tab {
  private ctx: Ctx;
  private data: () => GuideData | null;
  private el!: HTMLElement;
  private scope: string | null;
  private showTable = false;
  private three: ThreeMod | null = null;
  private view: InstanceType<ThreeMod['ThreeView']> | null = null;
  private highlight: string | null = null;
  private builtSig = '';
  private settingsOpen = false;

  constructor(ctx: Ctx, data: () => GuideData | null, route: GuideRoute) {
    this.ctx = ctx;
    this.data = data;
    this.scope = route.plate ?? null;
  }

  mount(el: HTMLElement): void {
    this.el = el;
    this.render();
    el.addEventListener('click', this.onClick);
    el.addEventListener('change', this.onChange);
    el.addEventListener('mouseover', this.onHover);
    el.addEventListener('focusin', this.onHover);
    el.addEventListener('mouseleave', this.onLeave);
    el.addEventListener('toggle', this.onToggle, true);
  }

  unmount(): void {
    this.view?.dispose();
    this.view = null;
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('change', this.onChange);
    this.el.removeEventListener('mouseover', this.onHover);
    this.el.removeEventListener('focusin', this.onHover);
    this.el.removeEventListener('mouseleave', this.onLeave);
    this.el.removeEventListener('toggle', this.onToggle, true);
    this.el.innerHTML = '';
  }

  route(r: GuideRoute): void {
    this.scope = r.plate ?? null;
    this.renderShelf();
  }

  update(changed: Set<string>): void {
    if (
      changed.has('result') ||
      changed.has('t.repacking') ||
      changed.has('inventory') ||
      changed.has('spares') ||
      changed.has('baseplateColour') ||
      changed.has('params') ||
      changed.has('area')
    ) {
      this.renderShelf();
      this.renderBuy();
      void this.renderModel();
    }
  }

  // ------------------------------------------------------------------ render

  private render() {
    setHtml(
      this.el,
      html`<div class="lz-stack lz-stack--xl">
        <div class="bricks-grid">
          <div class="lz-shelf" id="lz-shelf"></div>
          <div
            class="lz-viewport lz-viewport--guide"
            id="lz-bricks-vp"
            role="region"
            aria-label="${t('create.guide.bricks.viewport')}"
          ></div>
        </div>
        <section class="lz-stack" aria-labelledby="buy-title" id="lz-buy"></section>
      </div>`,
    );
    this.renderShelf();
    this.renderBuy();
    void this.renderModel();
  }

  private counts(): { counts: Record<string, number>; total: number; plates: number } | null {
    const d = this.data();
    if (!d) return null;
    if (this.scope) {
      const pl = d.packing.plates.find((p) => p.plate === this.scope);
      if (pl) return { counts: pl.counts, total: pl.bricks, plates: 1 };
    }
    return { counts: d.packing.counts, total: d.packing.total, plates: d.packing.baseplates.quantity };
  }

  private renderShelf() {
    const box = $('#lz-shelf', this.el);
    const d = this.data();
    if (!box || !d) return;
    const p = this.ctx.store.p;
    const tr = this.ctx.store.t;
    const c = this.counts()!;
    const enabled = new Set(p.inventory.enabled);
    const spares = p.spares;
    const upd = tr.repacking;
    const scoped = !!this.scope && d.packing.plates.some((x) => x.plate === this.scope);
    const slot = (id: string) => {
      const part = BRICKS.find((b) => b.id === id)!;
      const q = c.counts[id] ?? 0;
      const size = t('common.part.sizeCompact', { w: part.width, d: part.length });
      const spoken = t('create.guide.bricks.slot.spoken', {
        size: t('common.part.spoken', { w: part.width, d: part.length }),
        id,
        count: q,
      });
      const locked = id === '3005';
      const off = !locked && (!enabled.has(id) || part.length > p.inventory.maxLength);
      const buy = spares && q ? Math.ceil(q * (1 + spares / 100)) : q;
      const qty = off
        ? t('create.guide.bricks.slot.notUsed')
        : scoped && q === 0
          ? t('create.guide.bricks.slot.noneOnPlate')
          : t('create.guide.bricks.slot.quantity', { count: n(q) });
      return html`<li
        class="lz-slot${off || (scoped && q === 0) ? ' is-off' : ''}${this.highlight === id ? ' is-highlighted' : ''}"
        data-part="${id}"
      >
        <div class="lz-slot__glyph">${raw(glyph(id))}</div>
        <span class="lz-slot__qty${upd ? ' is-updating' : ''}" aria-hidden="true">${qty}</span>
        <span class="lz-slot__size" aria-hidden="true">${size}</span>
        <span class="lz-slot__part" aria-hidden="true">${id}</span>
        ${spares && q && !off ? html`<span class="lz-slot__buy lz-small">${t('create.guide.bricks.slot.toBuy', { buy: n(buy), need: n(q), spare: n(buy - q) })}</span>` : ''}
        <span class="lz-visually-hidden"
          >${off ? `${t('common.part.spoken', { w: part.width, d: part.length })}, ${t('create.guide.bricks.slot.notUsed')}` : spoken}</span
        >
        ${
          scoped
            ? ''
            : html`<div class="lz-slot__use">
                ${
                  locked
                    ? html`<span class="lz-slot__lock"
                        >${ic('lock')}${t('create.guide.bricks.settings.oneByOneLocked')}</span
                      >`
                    : html`<label class="lz-switch"
                        ><input
                          type="checkbox"
                          data-use="${id}"
                          ${attr('checked', enabled.has(id) && part.length <= p.inventory.maxLength)}${attr('disabled', part.length > p.inventory.maxLength)}
                        />${t('create.guide.bricks.slot.useThis')}<span class="lz-visually-hidden">
                          (${size})</span
                        ></label
                      >`
                }
              </div>`
        }
      </li>`;
    };
    const one = BRICKS.filter((b) => b.width === 1).map((b) => slot(b.id));
    const two = BRICKS.filter((b) => b.width === 2).map((b) => slot(b.id));
    const kinds = BRICKS.filter((b) => (c.counts[b.id] ?? 0) > 0).length;
    const quick = setsOf(p.inventory.enabled);
    const lb = d.packing.lowerBound;
    const pct = lb ? Math.round((100 * (d.packing.total - lb)) / lb) : 0;
    const plates = d.packing.plates;
    const table = this.showTable ? this.tableHtml() : '';
    setHtml(
      box,
      html`<div class="shelf-head">
        <h1 class="lz-h2" tabindex="-1">${t('create.guide.bricks.title')}</h1>
        <fieldset class="lz-cluster lz-scope"><legend class="lz-visually-hidden">${t('create.guide.bricks.scope.label')}</legend>
          <span class="lz-small lz-muted" aria-hidden="true">${t('create.guide.bricks.scope.label')}</span>
          <label class="lz-radio"><input type="radio" name="lz-scope" value="whole"${attr('checked', !scoped)}>${t('create.guide.bricks.scope.whole')}</label>
          <label class="lz-radio"><input type="radio" name="lz-scope" value="plate"${attr('checked', scoped)}>${t('create.guide.bricks.scope.plate', { plate: '' }).trim()}</label>
          <span class="lz-input lz-select lz-select--sm"><select id="lz-scope-plate" aria-label="${t('create.generate.done.grid.plateSelect')}">${plates.map((x) => html`<option value="${x.plate}" ${attr('selected', x.plate === this.scope)}>${d.label(x.plate)}</option>`)}</select></span>
        </fieldset>
      </div>
      ${scoped ? html`<p class="lz-eyebrow">${t('create.guide.bricks.kitTitle', { plate: d.label(this.scope!) })}</p>` : ''}
      <div class="lz-shelf__row"><h2 class="lz-eyebrow" id="row1">${t('create.guide.bricks.rows.oneWide')}</h2><ul class="lz-shelf__slots" aria-labelledby="row1">${one}</ul></div>
      <div class="lz-shelf__row"><h2 class="lz-eyebrow" id="row2">${t('create.guide.bricks.rows.twoWide')}</h2><ul class="lz-shelf__slots" aria-labelledby="row2">${two}</ul></div>
      <div class="lz-shelf__row"><h2 class="lz-eyebrow" id="row3">${t('create.guide.bricks.rows.baseplates')}</h2><ul class="lz-shelf__slots" aria-labelledby="row3">
        <li class="lz-slot lz-slot--baseplate"><div class="lz-slot__glyph">${raw(glyph(BASEPLATE.id))}</div><span class="lz-slot__qty">${t('create.guide.bricks.slot.quantity', { count: c.plates })}</span><span class="lz-slot__size">${t('common.plate.baseplate')}</span><span class="lz-slot__part">${BASEPLATE.id} · ${t('create.guide.bricks.rows.baseplatesScale')}</span></li>
      </ul></div>
      <p class="lz-shelf__total"><strong${attr('aria-live', 'polite')}>${upd ? t('create.guide.bricks.updating') : scoped ? t('create.guide.bricks.plateKit', { bricks: n(c.total), plate: d.label(this.scope!) }) : t('create.guide.bricks.total', { bricks: n(c.total), kinds, plates: n(c.plates) })}</strong>
        <button type="button" class="lz-link lz-link--button" data-b="table" aria-expanded="${String(this.showTable)}">${this.showTable ? t('create.guide.bricks.showShelf') : t('create.guide.bricks.showTable')}</button>
        ${scoped ? html`<button type="button" class="lz-link lz-link--button" data-b="share">${ic('qr', 'sm')}${t('create.guide.build.share.action')}</button>` : ''}</p>
      ${table}
      <details class="lz-disclosure" id="lz-parts-settings"${attr('open', this.settingsOpen)}>
        <summary>${t('create.guide.bricks.settings.title')} <span class="lz-badge">${quick === 'all' ? t('create.guide.bricks.settings.summaryAll') : t('create.guide.bricks.settings.summaryCount', { count: p.inventory.enabled.filter((x) => BRICKS.find((b) => b.id === x)!.length <= p.inventory.maxLength).length })}</span></summary>
        <div class="lz-disclosure__content lz-stack lz-stack--md">
          <div class="lz-segmented" role="group" aria-label="${t('create.guide.bricks.settings.quickSets.label')}">
            <button type="button" data-set="all" aria-pressed="${String(quick === 'all')}">${t('create.guide.bricks.settings.quickSets.all')}</button>
            <button type="button" data-set="common" aria-pressed="${String(quick === 'common')}">${t('create.guide.bricks.settings.quickSets.common')}</button>
            <button type="button" data-set="squares" aria-pressed="${String(quick === 'squares')}">${t('create.guide.bricks.settings.quickSets.squares')}</button>
          </div>
          <div class="lz-param lz-param--narrow"><label class="lz-label" for="lz-longest">${t('create.guide.bricks.settings.longest')}</label><div class="lz-input lz-select"><select id="lz-longest">${[8, 6, 4, 3, 2, 1].map((v) => html`<option value="${v}" ${attr('selected', v === p.inventory.maxLength)}>${t('create.guide.bricks.settings.longestValue', { n: v })}</option>`)}</select></div></div>
          <p class="lz-help">${ic('lock', 'sm')} ${t('create.guide.bricks.settings.oneByOneLocked')}</p>
        </div>
      </details>
      <details class="lz-disclosure">
        <summary>${t('create.guide.bricks.report.title')}</summary>
        <div class="lz-disclosure__content lz-stack lz-stack--sm">
          <p class="lz-prose lz-small">${t('create.guide.bricks.report.body', { lowerBound: n(lb), count: n(d.packing.total), percent: pct })}</p>
          <a class="lz-link lz-small" href="about.html#method">${t('create.guide.bricks.report.method')}</a>
        </div>
      </details>`,
    );
  }

  private tableHtml(): Raw {
    const d = this.data()!;
    const p = this.ctx.store.p;
    const plates = d.packing.plates.length <= 16 ? d.packing.plates : [];
    const spares = p.spares;
    const rows = BRICKS.map((b) => {
      const q = d.packing.counts[b.id] ?? 0;
      const buy = spares ? Math.ceil(q * (1 + spares / 100)) : q;
      return html`<tr>
        <th scope="row">${t('common.part.name', { w: b.width, d: b.length })}</th>
        <td class="lz-mono">${b.id}</td>
        ${plates.map((pl) => html`<td class="num">${pl.counts[b.id] ?? 0}</td>`)}
        <td class="num"><strong>${n(q)}</strong></td>
        <td class="num">${n(buy)}</td>
      </tr>`;
    });
    rows.push(
      html`<tr>
        <th scope="row">${t('common.plate.baseplate')}</th>
        <td class="lz-mono">${BASEPLATE.id}</td>
        ${plates.map(() => html`<td class="num">1</td>`)}
        <td class="num"><strong>${d.packing.baseplates.quantity}</strong></td>
        <td class="num">${d.packing.baseplates.quantity}</td>
      </tr>`,
    );
    return html`<div class="lz-table-wrap">
      <table class="lz-table lz-parts-table">
        <caption>
          ${t('create.guide.bricks.table.caption')}
        </caption>
        <thead>
          <tr>
            <th scope="col">${t('create.guide.bricks.table.part')}</th>
            <th scope="col">${t('create.guide.bricks.table.number')}</th>
            ${plates.map((pl) => html`<th scope="col" class="num">${d.label(pl.plate)}</th>`)}
            <th scope="col" class="num">${t('create.guide.bricks.table.quantity')}</th>
            <th scope="col" class="num">${t('create.guide.bricks.table.toBuy')}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`;
  }

  private renderBuy() {
    const box = $('#lz-buy', this.el);
    if (!box) return;
    const p = this.ctx.store.p;
    const stale = isStale(p);
    const dis = stale || this.ctx.store.t.repacking;
    const why = stale
      ? html`<p class="lz-export__status lz-export__status--warning">
          ${ic('warning', 'sm')}${t('create.stale.downloadsDisabled')}
        </p>`
      : '';
    setHtml(
      box,
      html`<div class="lz-cluster lz-cluster--between">
          <h2 id="buy-title" class="lz-h2">${t('create.guide.bricks.buy.title')}</h2>
          <p class="lz-small lz-muted">${t('create.guide.bricks.buy.white')}</p>
        </div>
        <div class="buy-grid">
          <article class="lz-card lz-stack lz-stack--md">
            <h3 class="lz-h4">${t('exports.bricklink.title')}</h3>
            <p class="lz-small lz-muted">${t('exports.bricklink.purpose')}</p>
            <ol class="lz-howto">
              <li>${t('exports.bricklink.howTo.step1')}</li>
              <li>${t('exports.bricklink.howTo.step2')}</li>
              <li>${t('exports.bricklink.howTo.step3')}</li>
            </ol>
            <div class="lz-cluster">
              <button
                type="button"
                class="lz-btn lz-btn--primary lz-btn--sm"
                data-b="bl-copy"
                ${attr('disabled', dis)}
              >
                ${ic('copy', 'sm')}${t('exports.bricklink.copy')}</button
              ><button
                type="button"
                class="lz-btn lz-btn--secondary lz-btn--sm"
                data-b="bl-dl"
                ${attr('disabled', dis)}
              >
                ${ic('download', 'sm')}${t('exports.bricklink.download')}
              </button>
            </div>
            <a
              class="lz-link lz-small"
              href="https://www.bricklink.com/v2/wanted/upload.page"
              target="_blank"
              rel="noopener"
              >${t('exports.bricklink.link')} ${ic('external')}<span class="lz-visually-hidden">
                ${t('common.newTab')}</span
              ></a
            >
            ${why}
          </article>
          <article class="lz-card lz-stack lz-stack--md">
            <h3 class="lz-h4">${t('exports.rebrickable.title')}</h3>
            <p class="lz-small lz-muted">${t('exports.rebrickable.purpose')}</p>
            <ol class="lz-howto">
              <li>${t('exports.rebrickable.howTo.step1')}</li>
              <li>${t('exports.rebrickable.howTo.step2')}</li>
              <li>${t('exports.rebrickable.howTo.step3')}</li>
            </ol>
            <div class="lz-cluster">
              <button
                type="button"
                class="lz-btn lz-btn--secondary lz-btn--sm"
                data-b="rb-dl"
                ${attr('disabled', dis)}
              >
                ${ic('download', 'sm')}${t('exports.rebrickable.download')}
              </button>
            </div>
            ${why}
          </article>
          <article class="lz-card lz-stack lz-stack--md">
            <h3 class="lz-h4">${t('exports.print.title')}</h3>
            <p class="lz-small lz-muted">${t('exports.print.purpose')}</p>
            <div class="lz-cluster">
              <button
                type="button"
                class="lz-btn lz-btn--secondary lz-btn--sm"
                data-b="paper"
                ${attr('disabled', dis)}
              >
                ${ic('print', 'sm')}${t('exports.print.action')}
              </button>
            </div>
            <p class="lz-export__status" role="status" id="lz-paper-status"></p>
          </article>
        </div>
        <div class="lz-cluster lz-buy-options">
          <fieldset class="lz-cluster lz-inline-fieldset">
            <legend class="lz-label">${t('create.guide.bricks.buy.spares.label')}</legend>
            <span class="lz-radio-row"
              >${([0, 5, 10] as const).map((v) => html`<label class="lz-radio"><input type="radio" name="lz-spares" value="${v}" ${attr('checked', p.spares === v)} aria-describedby="lz-spares-help" />${v === 0 ? t('create.guide.bricks.buy.spares.none') : v === 5 ? t('create.guide.bricks.buy.spares.five') : t('create.guide.bricks.buy.spares.ten')}</label>`)}</span
            >
          </fieldset>
          <div class="lz-cluster">
            <label class="lz-label" for="lz-bpc">${t('create.guide.bricks.buy.baseplateColour.label')}</label
            ><span class="lz-input lz-select lz-select--sm"
              ><select id="lz-bpc">
                <option value="white" ${attr('selected', p.baseplateColour === 'white')}>
                  ${t('create.guide.bricks.buy.baseplateColour.white')}
                </option>
                <option value="grey" ${attr('selected', p.baseplateColour === 'grey')}>
                  ${t('create.guide.bricks.buy.baseplateColour.grey')}
                </option>
              </select></span
            >
          </div>
        </div>
        <p class="lz-help" id="lz-spares-help">${t('create.guide.bricks.buy.spares.help')}</p>`,
    );
  }

  // ------------------------------------------------------------------ model (where do they go?)

  private async renderModel() {
    const box = $('#lz-bricks-vp', this.el);
    const d = this.data();
    if (!box || !d) return;
    if (!this.ctx.store.t.webgl) {
      if (!box.querySelector('.lz-hm2d'))
        box.innerHTML = `<div class="lz-hm2d lz-hm2d--inline">${heightMap2dSvg(d.heightMap, d.platesY, t('create.generate.done.view2d'))}</div>`;
      return;
    }
    if (!this.three) this.three = await import('../create/viewport/three/index.ts');
    if (!this.el.isConnected) return;
    const sig = `${d.packing.total}:${this.highlight}:${this.scope}:${this.ctx.store.p.baseplateColour}:${JSON.stringify(d.packing.counts)}`;
    if (sig === this.builtSig) return;
    const first = !this.view;
    if (!this.view) {
      this.view = new this.three.ThreeView(box, {
        label: t('create.guide.bricks.viewport'),
        shadows: d.packing.total < 20000,
        fov: 28,
      });
      this.view.safeTop = 16;
    }
    this.builtSig = sig;
    const hl = this.highlight;
    const scope = this.scope;
    const style = (b: PlacedBrick) => {
      if (scope && b.plate !== scope) return 'dim' as const;
      if (!hl) return 'solid' as const;
      return b.partId === hl ? ('new' as const) : ('dim' as const);
    };
    const { group, bounds } = this.three.buildBrickModel(d.packing.bricks, {
      platesX: d.platesX,
      platesY: d.platesY,
      style,
      baseplateColour: this.ctx.store.p.baseplateColour === 'white' ? 'white' : 'grey',
      outlines: false,
    });
    this.view.setContent([group], bounds);
    if (first) this.view.frame(bounds, { azimuth: -32, elevation: 40, margin: 1.02 });
    let legend = box.querySelector('.lz-vp-bottom');
    if (!legend) {
      legend = document.createElement('div');
      legend.className = 'lz-vp-bottom';
      box.append(legend);
    }
    const part = hl ? BRICKS.find((b) => b.id === hl) : null;
    legend.innerHTML = part
      ? `<div class="lz-legend"><span class="lz-legend__item"><span class="lz-swatch" style="--sw: var(--lz-brick-new-top)"></span>${t('create.guide.bricks.where.legend', { size: `${part.width}×${part.length}` })}</span></div>`
      : '';
  }

  // ------------------------------------------------------------------ events

  private setInventory(enabled: string[], maxLength = this.ctx.store.p.inventory.maxLength) {
    const ids = ALL_PART_IDS.filter((id) => id === '3005' || enabled.includes(id));
    this.ctx.store.set({ inventory: { enabled: ids, maxLength } });
    this.ctx.actions.scheduleRepack();
  }

  private onChange = (e: Event) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const p = this.ctx.store.p;
    if (el.dataset.use) {
      const on = (el as HTMLInputElement).checked;
      const set = new Set(p.inventory.enabled);
      if (on) set.add(el.dataset.use);
      else set.delete(el.dataset.use);
      this.setInventory([...set]);
    } else if (el.id === 'lz-longest') this.setInventory(p.inventory.enabled, Number(el.value));
    else if (el.name === 'lz-scope' || el.id === 'lz-scope-plate') {
      const whole = el.name === 'lz-scope' && el.value === 'whole';
      const plate = whole ? null : ($<HTMLSelectElement>('#lz-scope-plate', this.el)?.value ?? null);
      this.scope = plate;
      const hash = `#guide/bricks${plate ? '/' + plate : ''}`;
      history.replaceState(null, '', hash);
      this.renderShelf();
      void this.renderModel();
      $<HTMLElement>(
        el.id ? `#${el.id}` : `input[name=lz-scope][value=${whole ? 'whole' : 'plate'}]`,
        this.el,
      )?.focus();
    } else if (el.name === 'lz-spares') this.ctx.store.set({ spares: Number(el.value) as 0 | 5 | 10 });
    else if (el.id === 'lz-bpc') this.ctx.store.set({ baseplateColour: el.value as 'white' | 'grey' });
  };

  private onToggle = (e: Event) => {
    if ((e.target as HTMLElement).id === 'lz-parts-settings')
      this.settingsOpen = (e.target as HTMLDetailsElement).open;
  };

  private hoverTimer = 0;
  private onHover = (e: Event) => {
    const s = (e.target as Element).closest<HTMLElement>('.lz-slot[data-part]');
    const part = s?.dataset.part ?? null;
    if (part === this.highlight) return;
    clearTimeout(this.hoverTimer);
    this.hoverTimer = window.setTimeout(() => {
      this.highlight = part;
      this.el
        .querySelectorAll('.lz-slot.is-highlighted')
        .forEach((x) => x.classList.remove('is-highlighted'));
      s?.classList.add('is-highlighted');
      void this.renderModel();
    }, 120);
  };
  private onLeave = () => {
    clearTimeout(this.hoverTimer);
    if (!this.highlight) return;
    this.highlight = null;
    this.el.querySelectorAll('.lz-slot.is-highlighted').forEach((x) => x.classList.remove('is-highlighted'));
    void this.renderModel();
  };

  private onClick = async (e: Event) => {
    const el = e.target as Element;
    const set = el.closest<HTMLElement>('[data-set]')?.dataset.set;
    if (set) {
      this.setInventory(
        set === 'all' ? ALL_PART_IDS : set === 'common' ? COMMON : SQUARES,
        set === 'all' ? 8 : this.ctx.store.p.inventory.maxLength,
      );
      return;
    }
    const b = el.closest<HTMLElement>('[data-b]')?.dataset.b;
    if (!b) return;
    const a = this.ctx.actions;
    try {
      if (b === 'table') {
        this.showTable = !this.showTable;
        this.renderShelf();
      } else if (b === 'share' && this.scope) {
        const { openShareDialog } = await import('./share.ts');
        await openShareDialog(this.ctx, this.data()!, this.scope);
      } else if (b === 'bl-copy') {
        const [f] = await a.exportFiles('bricklink');
        const ok = await copyText(String(f!.data));
        toast(ok ? t('exports.bricklink.copied') : t('errors.copyFailed'), {
          icon: ok ? 'check-circle' : 'warning',
        });
      } else if (b === 'bl-dl') await a.download('bricklink');
      else if (b === 'rb-dl') await a.download('rebrickable');
      else if (b === 'paper') {
        const status = $('#lz-paper-status', this.el);
        if (status) status.textContent = t('exports.pdf.preparingShort');
        const { pdfOptions } = await import('./downloads.ts');
        const names = await a.download('pdf', {
          ...pdfOptions(this.ctx),
          sections: {
            cover: false,
            shopping: true,
            plates: false,
            layers: false,
            projection: false,
            passes: false,
          },
          sectionsName: 'shopping-list',
        });
        if (status) status.textContent = t('exports.common.downloaded', { file: names[0] ?? '' });
      }
    } catch (err) {
      console.error(err);
      toast(t('exports.common.error'), { icon: 'warning' });
    }
  };
}

function setsOf(enabled: string[]): 'all' | 'common' | 'squares' | 'custom' {
  const s = [...enabled].sort().join();
  if (s === [...ALL_PART_IDS].sort().join()) return 'all';
  if (s === [...COMMON].sort().join()) return 'common';
  if (s === [...SQUARES].sort().join()) return 'squares';
  return 'custom';
}
