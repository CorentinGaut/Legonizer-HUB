/**
 * Step 5 — Build guide (SPEC §7.5): summary strip and
 * four tabs that follow what people do with their hands — Get the bricks · Build · Set up the table
 * · All downloads. Every tab reads the same packing result, so the numbers agree everywhere.
 */
import { t } from '../shared/i18n.ts';
import type { PackingResult } from '../core/packing/pack.ts';
import type { HeightMap } from '../core/types.ts';
import { $, attr, html, ic, setHtml, type Raw } from '../create/dom.ts';
import { n } from '../create/format.ts';
import { guideHash, type GuideRoute, type GuideTab } from '../create/route.ts';
import { isStale, presetOf } from '../create/state.ts';
import type { Ctx } from '../create/stepView.ts';
import { staleBanner } from '../create/steps/common.ts';
import { presetName } from '../create/steps/generate.ts';
import { ensureGlyphSprite } from './glyphs.ts';

export interface GuideData {
  title: string;
  packing: PackingResult;
  heightMap: HeightMap;
  platesX: number;
  platesY: number;
  /** Display name of a plate (plate mode shows the pass's name). */
  label(plate: string): string;
}

export interface Tab {
  mount(el: HTMLElement): void;
  update(changed: Set<string>): void;
  unmount(): void;
  route?(r: GuideRoute): void;
}

const TABS: GuideTab[] = ['bricks', 'build', 'table', 'downloads'];

export function guideData(ctx: Ctx): GuideData | null {
  const p = ctx.store.p;
  const r = p.result;
  if (!r) return null;
  return {
    title: p.name || t('create.project.untitled'),
    packing: r.packing,
    heightMap: r.heightMap,
    platesX: r.params.platesX,
    platesY: r.params.platesY,
    label: (x) => x,
  };
}

export class GuideView {
  private host: HTMLElement;
  private ctx: Ctx;
  private tab: Tab | null = null;
  private current: GuideTab = 'bricks';
  private body!: HTMLElement;
  private routeState: GuideRoute = { tab: 'bricks' };

  constructor(host: HTMLElement, ctx: Ctx) {
    this.host = host;
    this.ctx = ctx;
  }

  mount(r: GuideRoute, focus: boolean): void {
    ensureGlyphSprite();
    this.routeState = r;
    setHtml(
      this.host,
      html`<div class="lz-guide" id="lz-guide">
        <div class="guide-head">
          <p class="lz-summary-strip" id="lz-summary"></p>
          <div class="lz-tabs" role="tablist" aria-label="${t('create.guide.tabs.label')}" id="lz-tabs"></div>
        </div>
        <div class="guide-body">
          <div id="lz-guide-banners"></div>
          <div id="lz-guide-panel" role="tabpanel" tabindex="-1"></div>
        </div>
        <nav class="lz-tabbar" aria-label="${t('create.guide.tabs.label')}" id="lz-tabbar"></nav>
      </div>`,
    );
    this.body = $('#lz-guide-panel', this.host)!;
    this.host.addEventListener('click', this.onClick);
    $('#lz-tabs', this.host)!.addEventListener('keydown', this.onTabKey);
    this.renderHead();
    this.show(r.tab, focus);
    void this.ctx.actions.ensureEngineModel();
  }

  route(r: GuideRoute): void {
    this.routeState = r;
    if (r.tab !== this.current) this.show(r.tab, false);
    else this.tab?.route?.(r);
  }

  update(changed: Set<string>): void {
    if (
      changed.has('result') ||
      changed.has('params') ||
      changed.has('area') ||
      changed.has('name') ||
      changed.has('t.generating') ||
      changed.has('guideOnly')
    )
      this.renderHead();
    this.tab?.update(changed);
  }

  unmount(): void {
    this.tab?.unmount();
    this.tab = null;
    this.host.removeEventListener('click', this.onClick);
    this.host.innerHTML = '';
  }

  private renderHead() {
    const p = this.ctx.store.p;
    const d = guideData(this.ctx);
    const strip = $('#lz-summary', this.host);
    if (!strip) return;
    if (d) {
      const tallest = d.packing.plates.reduce((a, x) => Math.max(a, x.layers), 0);
      const preset = presetName(presetOf(p.result!.params, p.summary?.groundAvailable ?? false));
      setHtml(
        strip,
        html`<strong>${d.title}</strong><span class="sep" aria-hidden="true">·</span
          ><span
            >${t('common.units.plates', { count: d.platesX * d.platesY })} (${d.platesX} × ${d.platesY})</span
          ><span class="sep" aria-hidden="true">·</span
          ><span class="opt">${n(d.platesX * 25.6, 1)} × ${n(d.platesY * 25.6, 1)} cm</span
          ><span class="sep" aria-hidden="true">·</span
          ><span
            >${n(d.packing.total)}
            ${t('create.generate.done.keyBricks', { plates: d.packing.baseplates.quantity })}</span
          ><span class="sep" aria-hidden="true">·</span
          ><span class="opt"
            >${t('create.generate.done.tallest', { bricks: tallest, cm: n((tallest * 9.6) / 10, 1) })}</span
          ><span class="sep" aria-hidden="true">·</span><span class="opt">${preset}</span>`,
      );
    }
    const banners: Raw[] = [];
    const stale = staleBanner(p, !!this.ctx.store.t.generating);
    if (stale) banners.push(stale);
    if (p.guideOnly)
      banners.push(
        html`<div class="lz-alert" role="status">
          ${ic('info')}
          <div class="lz-alert__body">
            <p>${t('create.guide.guideOnly.message')}</p>
            <button
              type="button"
              class="lz-btn lz-btn--secondary lz-btn--sm"
              data-g="add-source"
              style="align-self:flex-start"
            >
              ${t('create.guide.guideOnly.action')}
            </button>
          </div>
        </div>`,
      );
    setHtml($('#lz-guide-banners', this.host)!, html`${banners}`);
    this.renderTabs();
  }

  private renderTabs() {
    const tabs = TABS.map(
      (k, i) =>
        html`<a
          class="lz-tab"
          role="tab"
          id="lz-tab-${k}"
          href="#guide/${k}"
          data-tab="${k}"
          aria-selected="${String(k === this.current)}"
          aria-controls="lz-guide-panel"
          tabindex="${k === this.current ? 0 : -1}"
          >${i < 3 ? html`<span class="lz-tab__num" aria-hidden="true">${i + 1}</span>` : ''}${t(`create.guide.tabs.${k}`)}</a
        >`,
    );
    setHtml($('#lz-tabs', this.host)!, html`${tabs}`);
    const icons: Record<GuideTab, Parameters<typeof ic>[0]> = {
      build: 'grid',
      bricks: 'brick',
      table: 'table',
      downloads: 'download',
    };
    const order: GuideTab[] = ['build', 'bricks', 'table', 'downloads'];
    const labels: Record<GuideTab, string> = {
      build: t('create.guide.mobileTabs.plates'),
      bricks: t('create.guide.mobileTabs.bricks'),
      table: t('create.guide.mobileTabs.table'),
      downloads: t('create.guide.mobileTabs.downloads'),
    };
    setHtml(
      $('#lz-tabbar', this.host)!,
      html`${order.map((k) => html`<a href="#guide/${k}" data-tab="${k}" ${attr('aria-current', k === this.current ? 'page' : null)}>${ic(icons[k])}${labels[k]}</a>`)}`,
    );
    this.body.setAttribute('aria-labelledby', `lz-tab-${this.current}`);
  }

  private async show(tab: GuideTab, focus: boolean) {
    this.tab?.unmount();
    this.tab = null;
    this.current = tab;
    this.renderTabs();
    this.body.innerHTML = '';
    this.body.className = `guide-tab guide-tab--${tab}`;
    let T: new (ctx: Ctx, data: () => GuideData | null, route: GuideRoute) => Tab;
    if (tab === 'bricks') T = (await import('./bricks.ts')).BricksTab;
    else if (tab === 'build') T = (await import('./build.ts')).BuildTab;
    else if (tab === 'table') T = (await import('./table.ts')).TableTab;
    else T = (await import('./downloads.ts')).DownloadsTab;
    if (this.current !== tab) return;
    this.tab = new T(this.ctx, () => guideData(this.ctx), this.routeState);
    this.tab.mount(this.body);
    if (focus)
      requestAnimationFrame(() => (this.body.querySelector<HTMLElement>('h1, h2') ?? this.body).focus?.());
  }

  private select(tab: GuideTab, focusTab = false) {
    const hash = '#' + guideHash({ tab });
    if (location.hash !== hash) history.pushState(null, '', hash);
    this.routeState = { tab };
    void this.show(tab, false);
    if (focusTab) requestAnimationFrame(() => $<HTMLElement>(`#lz-tab-${tab}`, this.host)?.focus());
  }

  private onClick = (e: Event) => {
    const el = e.target as Element;
    const tabEl = el.closest<HTMLElement>('[data-tab]');
    if (tabEl) {
      e.preventDefault();
      this.select(tabEl.dataset.tab as GuideTab);
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
    if (el.closest('[data-g=add-source]')) this.ctx.go('import', { focus: true });
  };

  /** ARIA tabs: arrows move, Home/End, activation follows focus. */
  private onTabKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(this.current);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    if (j < 0) return;
    e.preventDefault();
    this.select(TABS[j]!, true);
  };
}

export function stale(ctx: Ctx): boolean {
  return isStale(ctx.store.p);
}
