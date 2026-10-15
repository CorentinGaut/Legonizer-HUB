/**
 * "Set up the table" tab (SPEC O2, A6): lay out the plates on the 1 × 2 m
 * table (A1 north-west, checklist), then the projection layer (calque) with plate grid and labels,
 * legacy JPG or PNG at a chosen resolution with the real size inside, and how to use it.
 */
import { t } from '../shared/i18n.ts';
import { $, attr, html, ic, setHtml, toast } from '../create/dom.ts';
import { n } from '../create/format.ts';
import type { GuideRoute } from '../create/route.ts';
import { isStale } from '../create/state.ts';
import type { Ctx } from '../create/stepView.ts';
import { tableFitSvg } from '../create/steps/common.ts';
import type { GuideData, Tab } from './guide.ts';

export class TableTab implements Tab {
  private ctx: Ctx;
  private data: () => GuideData | null;
  private el!: HTMLElement;
  private grid = true;
  private labels = true;
  private format: 'jpg' | 'png' = 'jpg';
  private dpi = 150;
  private previewUrl: string | null = null;
  private previewToken = 0;

  constructor(ctx: Ctx, data: () => GuideData | null, _route: GuideRoute) {
    this.ctx = ctx;
    this.data = data;
  }

  mount(el: HTMLElement): void {
    this.el = el;
    this.render();
    el.addEventListener('change', this.onChange);
    el.addEventListener('click', this.onClick);
    void this.preview();
  }

  unmount(): void {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.el.removeEventListener('change', this.onChange);
    this.el.removeEventListener('click', this.onClick);
    this.el.innerHTML = '';
  }

  update(changed: Set<string>): void {
    if (changed.has('result') || changed.has('progress') || changed.has('t.engineResult')) {
      this.render();
      void this.preview();
    }
  }

  private render() {
    const d = this.data();
    if (!d) return;
    const p = this.ctx.store.p;
    const prog = p.progress;
    const done = d.packing.plates.filter(
      (x) => x.layers === 0 || (prog.built[x.plate] ?? 0) >= x.layers,
    ).length;
    const total = d.packing.plates.length;
    const first = d.packing.plates[0]?.plate ?? 'A1';
    const last = d.packing.plates[d.packing.plates.length - 1]?.plate ?? 'A1';
    const stale = isStale(p);
    const w = d.platesX * 25.6,
      h = d.platesY * 25.6;
    const jpgPx =
      d.platesX >= d.platesY
        ? [1920, Math.floor((1920 * d.platesY) / d.platesX)]
        : [Math.floor((1920 * d.platesX) / d.platesY), 1920];
    const pngPx = [
      Math.floor((d.platesX * 32 * 8 * this.dpi) / 25.4),
      Math.floor((d.platesY * 32 * 8 * this.dpi) / 25.4),
    ];
    setHtml(
      this.el,
      html`<div class="table-grid">
        <section class="lz-card lz-stack lz-stack--md" aria-labelledby="lay-title">
          <h1 id="lay-title" class="lz-h3" tabindex="-1">
            <span class="lz-tab__num" aria-hidden="true">1</span>${t('create.guide.table.layout.title')}
          </h1>
          ${tableFitSvg(d.platesX, d.platesY, 'guide', { labels: true, large: true })}
          <p>${t('create.guide.table.layout.body')}</p>
          <div class="checklist">
            <h2 class="lz-h4">${t('create.guide.table.layout.checklist.title')}</h2>
            <div class="lz-cluster lz-cluster--between">
              <label class="lz-check"
                ><input
                  type="checkbox"
                  disabled${attr('checked', done === total)}
                />${t('create.guide.table.layout.checklist.allBuilt', { done, total })}</label
              ><a class="lz-link lz-small" href="#guide/build" data-tab="build"
                >${t('create.guide.table.layout.goBuild')}</a
              >
            </div>
            <label class="lz-check"
              ><input
                type="checkbox"
                id="lz-ck-placed"
                ${attr('checked', p.checklist.placed)}
              />${t('create.guide.table.layout.checklist.placed', { first, last })}</label
            >
            <label class="lz-check"
              ><input
                type="checkbox"
                id="lz-ck-aligned"
                ${attr('checked', p.checklist.aligned)}
              />${t('create.guide.table.layout.checklist.aligned')}</label
            >
          </div>
        </section>
        <section class="lz-card lz-stack lz-stack--md" aria-labelledby="proj-title">
          <h2 id="proj-title" class="lz-h3">
            <span class="lz-tab__num" aria-hidden="true">2</span>${t('create.guide.table.projection.title')}
          </h2>
          <div class="calque" id="lz-calque">
            ${this.previewUrl ? html`<img src="${this.previewUrl}" alt="${this.alt()}" />` : html`<p class="lz-muted lz-small">${t('common.status.loading')}</p>`}
          </div>
          <div class="lz-cluster" style="--lz-cluster-gap: var(--lz-space-5)">
            <label class="lz-switch"
              ><input
                type="checkbox"
                id="lz-cq-grid"
                ${attr('checked', this.grid)}
              />${t('create.guide.table.projection.grid')}</label
            ><label class="lz-switch"
              ><input
                type="checkbox"
                id="lz-cq-labels"
                ${attr('checked', this.labels)}
              />${t('create.guide.table.projection.labels')}</label
            >
          </div>
          <fieldset class="lz-option lz-option--flat">
            <legend class="lz-visually-hidden">${t('create.guide.table.projection.fileType')}</legend>
            <div class="lz-option__values">
              <label class="lz-radio"
                ><input
                  type="radio"
                  name="lz-cq-fmt"
                  value="jpg"
                  ${attr('checked', this.format === 'jpg')}
                />${t('exports.projection.jpg')}
                <span class="lz-muted lz-small"
                  >${t('exports.projection.sizePx', { w: jpgPx[0]!, h: jpgPx[1]! })}</span
                ></label
              >
              <span class="lz-option__value"
                ><label class="lz-radio"
                  ><input
                    type="radio"
                    name="lz-cq-fmt"
                    value="png"
                    ${attr('checked', this.format === 'png')}
                  />${t('exports.projection.png', { dpi: this.dpi })}</label
                ><span class="lz-input lz-select lz-select--sm"
                  ><select id="lz-cq-dpi" aria-label="${t('exports.projection.dpiLabel')}">
                    ${[75, 100, 150, 300].map((v) => html`<option value="${v}" ${attr('selected', v === this.dpi)}>${t('exports.projection.dpiValue', { dpi: v })}</option>`)}
                  </select></span
                ></span
              >
              <p class="lz-help lz-option__why">
                ${t('exports.projection.pngNote')}
                ${this.format === 'png' ? t('exports.projection.sizePx', { w: pngPx[0]!, h: pngPx[1]! }) : ''}
                · ${n(w, 1)} × ${n(h, 1)} cm
              </p>
            </div>
          </fieldset>
          <button
            type="button"
            class="lz-btn lz-btn--primary"
            data-t="download"
            style="align-self:flex-start"
            ${attr('disabled', stale)}${attr('aria-describedby', stale ? 'lz-cq-why' : null)}
          >
            ${ic('download')}${t('create.guide.table.projection.download')}
          </button>
          ${stale ? html`<p class="lz-export__status lz-export__status--warning" id="lz-cq-why">${ic('warning', 'sm')}${t('create.stale.downloadsDisabled')}</p>` : ''}
          <p class="lz-export__status" role="status" id="lz-cq-status"></p>
          <div>
            <h3 class="lz-h4">${t('create.guide.table.projection.howTo.title')}</h3>
            <ol class="lz-howto u-mt-2">
              <li>${t('create.guide.table.projection.howTo.step1')}</li>
              <li>${t('create.guide.table.projection.howTo.step2')}</li>
              <li>${t('create.guide.table.projection.howTo.step3')}</li>
            </ol>
            <p class="lz-help u-mt-2">${t('create.guide.table.projection.note')}</p>
          </div>
        </section>
      </div>`,
    );
  }

  private alt(): string {
    return t('create.guide.table.calqueAlt', {
      grid: this.grid ? 'yes' : 'no',
      labels: this.labels ? 'yes' : 'no',
    });
  }

  private async preview() {
    const token = ++this.previewToken;
    try {
      const [f] = await this.ctx.actions.exportFiles('calque-preview', {
        plateGrid: this.grid,
        labels: this.labels,
        previewPx: 900,
      });
      if (token !== this.previewToken || !f || !this.el.isConnected) return;
      if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = URL.createObjectURL(new Blob([f.data as BlobPart], { type: 'image/png' }));
      const box = $('#lz-calque', this.el);
      if (box) box.innerHTML = `<img src="${this.previewUrl}" alt="${this.alt().replace(/"/g, '&quot;')}">`;
    } catch {
      // the engine may still be restoring; the next update retries
    }
  }

  private onChange = (e: Event) => {
    const el = e.target as HTMLInputElement;
    const st = this.ctx.store;
    if (el.id === 'lz-ck-placed' || el.id === 'lz-ck-aligned')
      st.set({
        checklist: { ...st.p.checklist, [el.id === 'lz-ck-placed' ? 'placed' : 'aligned']: el.checked },
      });
    else if (el.id === 'lz-cq-grid' || el.id === 'lz-cq-labels') {
      if (el.id === 'lz-cq-grid') this.grid = el.checked;
      else this.labels = el.checked;
      void this.preview();
    } else if (el.name === 'lz-cq-fmt' || el.id === 'lz-cq-dpi') {
      if (el.name === 'lz-cq-fmt') this.format = el.value as 'jpg' | 'png';
      else this.dpi = Number(el.value);
      const id = el.id || `lz-cq-${this.format}`;
      this.render();
      $<HTMLElement>(el.id ? `#${id}` : `input[name=lz-cq-fmt][value=${this.format}]`, this.el)?.focus();
    }
  };

  private onClick = async (e: Event) => {
    const el = e.target as Element;
    const tab = el.closest<HTMLElement>('[data-tab]');
    if (tab) {
      e.preventDefault();
      history.pushState(null, '', '#guide/build');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      return;
    }
    if (!el.closest('[data-t=download]')) return;
    const status = $('#lz-cq-status', this.el);
    try {
      if (status) status.textContent = t('exports.common.preparing');
      const names =
        this.format === 'jpg'
          ? await this.ctx.actions.download('calque-jpeg', { plateGrid: this.grid, labels: this.labels })
          : await this.ctx.actions.download('calque-png', {
              plateGrid: this.grid,
              labels: this.labels,
              dpi: this.dpi,
            });
      if (status) status.textContent = t('exports.common.downloaded', { file: names[0] ?? '' });
    } catch {
      if (status) status.textContent = t('exports.common.error');
      toast(t('exports.common.error'), { icon: 'warning' });
    }
  };
}
