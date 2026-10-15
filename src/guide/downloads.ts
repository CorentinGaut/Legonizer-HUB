/**
 * "All downloads" tab (SPEC O1–O9): export cards grouped
 * by what people do with the files, each with its file name, size, options and states (ready,
 * preparing with progress and cancel, done, error, disabled when out of date), plus Download
 * everything (.zip with a README).
 */
import { getLocale, rawMessage, t } from '../shared/i18n.ts';
import { PDF_MESSAGE_KEYS, pdfPageCount, type PdfSections } from '../core/export/pdfPlan.ts';
import { APP_VERSION } from '../core/version.ts';
import type { ExportKind, ExportOptions } from '../core/worker/protocol.ts';
import type { Params } from '../core/types.ts';
import { $, attr, copyText, html, ic, setHtml, toast, type Raw } from '../create/dom.ts';
import { bytes, n, slug } from '../create/format.ts';
import { isCancel } from '../create/engine.ts';
import type { GuideRoute } from '../create/route.ts';
import { changedOptions, isStale, presetOf, type OptionKey } from '../create/state.ts';
import type { Ctx } from '../create/stepView.ts';
import { presetName } from '../create/steps/generate.ts';
import type { GuideData, Tab } from './guide.ts';
import { pageBaseUrl } from './share.ts';

/** Localized labels of the options that differ from legacy (PDF cover, N7). */
export function differenceLabels(q: Params): string[] {
  const label = (k: OptionKey): string => {
    switch (k) {
      case 'heightMode':
        return `${t('create.settings.advanced.heightMode.label')}: ${q.heightMode === 'true-scale' ? t('create.settings.advanced.heightMode.trueScale') : `${t('create.settings.advanced.heightMode.exaggerated')} ×${q.exaggeration ?? 2}`}`;
      case 'heightRef':
        return `${t('create.settings.advanced.heightRef.label')}: ${t('create.settings.advanced.heightRef.ground')}`;
      case 'sampling':
        return `${t('create.settings.advanced.sampling.label')}: ${q.sampling}${q.sampling.startsWith('super') ? ` (${q.aggregate ?? 'max'})` : ''}`;
      case 'rounding':
        return `${t('create.settings.advanced.rounding.label')}: ${t(`create.settings.advanced.rounding.${q.rounding}`)}`;
      case 'keepSmall':
        return t('create.settings.advanced.rounding.keepSmall');
      case 'cap':
        return `${t('create.settings.advanced.cap.label')}: ${q.cap}`;
      case 'selection':
        return t('create.settings.advanced.selection.clip');
      case 'rotation':
        return t('create.settings.advanced.rotation.rotate');
    }
  };
  return changedOptions(q).map(label);
}

/** Options of the PDF export: localized messages, preset, differences, plate pass base URL. */
export function pdfOptions(ctx: Ctx): ExportOptions {
  const p = ctx.store.p;
  const q = p.result?.params ?? p.params;
  const messages: Record<string, string> = {};
  for (const k of PDF_MESSAGE_KEYS) {
    const m = rawMessage(k);
    if (m !== undefined) messages[k] = m;
  }
  return {
    paper: p.ui.paper,
    messages,
    locale: getLocale(),
    date: new Date().toISOString(),
    presetName: presetName(presetOf(q, p.summary?.groundAvailable ?? false)),
    differences: differenceLabels(q),
    baseUrl: pageBaseUrl(),
    ...(p.summary?.frame.crs ? { crs: p.summary.frame.crs } : {}),
  };
}

type CardId = 'pdf' | 'bricklink' | 'rebrickable' | 'projection' | 'csv' | 'ldraw' | 'project' | 'all';
interface CardState {
  status: 'ready' | 'preparing' | 'done' | 'error';
  progress: number;
  detail: string;
  file: string;
}

export class DownloadsTab implements Tab {
  private ctx: Ctx;
  private data: () => GuideData | null;
  private el!: HTMLElement;
  private cards = new Map<CardId, CardState>();
  private sections: PdfSections = {
    cover: true,
    shopping: true,
    plates: true,
    layers: true,
    projection: true,
    passes: true,
  };
  private projFmt: 'jpg' | 'png' = 'jpg';
  private dpi = 150;
  private grid = true;
  private labels = true;
  private csvMode: 'one' | 'zip' = 'one';
  private ldMode: 'ldr' | 'mpd' = 'ldr';
  private jobs = new Map<CardId, { cancel(): void }>();

  constructor(ctx: Ctx, data: () => GuideData | null, _route: GuideRoute) {
    this.ctx = ctx;
    this.data = data;
  }

  mount(el: HTMLElement): void {
    this.el = el;
    this.render();
    el.addEventListener('click', this.onClick);
    el.addEventListener('change', this.onChange);
  }

  unmount(): void {
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('change', this.onChange);
    this.el.innerHTML = '';
  }

  update(changed: Set<string>): void {
    if (
      changed.has('result') ||
      changed.has('params') ||
      changed.has('area') ||
      changed.has('t.repacking') ||
      changed.has('name') ||
      changed.has('ui') ||
      changed.has('spares')
    )
      this.render();
  }

  private state(id: CardId): CardState {
    return this.cards.get(id) ?? { status: 'ready', progress: 0, detail: '', file: '' };
  }

  private render() {
    const d = this.data();
    if (!d) return;
    const p = this.ctx.store.p;
    const stale = isStale(p);
    const busy = this.ctx.store.t.repacking;
    const base = slug(p.name || 'legonizer');
    const q = p.result!.params;
    const pages = pdfPageCount(d.packing, this.sections);
    const parts = Object.keys(d.packing.counts).length + 1;
    const hm = d.heightMap;
    let csvBytes = 0;
    for (const v of hm.data) csvBytes += v >= 10 ? 3 : 2;
    const fileOf: Record<CardId, string> = {
      pdf: `${base}-build-guide-${p.ui.paper}.pdf`,
      bricklink: `${base}-bricklink.xml`,
      rebrickable: `${base}-rebrickable.csv`,
      projection: this.projFmt === 'jpg' ? 'calqueTemplate.jpg' : `${base}-projection-${this.dpi}dpi.png`,
      csv:
        this.csvMode === 'one'
          ? `legoPlates_${q.platesX}_${q.platesY}.csv`
          : `legoPlates_${q.platesX}_${q.platesY}_per-plate.zip`,
      ldraw: `${base}.${this.ldMode}`,
      project: `${base}.legonizer.json`,
      all: `${base}-legonizer.zip`,
    };
    const card = (
      id: CardId,
      iconName: Parameters<typeof ic>[0],
      title: string,
      purpose: string,
      size: string,
      options: Raw | '',
      actions: Raw,
      note?: Raw | string,
    ): Raw => {
      const s = this.state(id);
      const disabled = (stale && id !== 'project') || busy;
      const statusLine =
        disabled && stale && id !== 'project'
          ? html`<span class="lz-export__status lz-export__status--warning"
              >${ic('warning', 'sm')}${t('exports.common.disabledStale')}</span
            >`
          : s.status === 'preparing'
            ? html`<div class="lz-progress lz-export__progress">
                <div
                  class="lz-progress__track"
                  role="progressbar"
                  aria-label="${title}"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow="${Math.round(s.progress * 100)}"
                >
                  <div class="lz-progress__fill" style="--value: ${Math.round(s.progress * 100)}%"></div>
                </div>
                <div class="lz-cluster lz-cluster--between">
                  <span class="lz-export__status" role="status"
                    >${s.detail || t('exports.common.preparing')}</span
                  ><button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-cancel="${id}">
                    ${t('common.actions.cancel')}
                  </button>
                </div>
              </div>`
            : s.status === 'done'
              ? html`<span class="lz-export__status lz-export__status--done" role="status"
                  >${ic('check-circle', 'sm')}${t('exports.common.downloaded', { file: s.file })}</span
                >`
              : s.status === 'error'
                ? html`<span class="lz-export__status lz-export__status--error" role="status"
                    >${ic('x-circle', 'sm')}${t('exports.common.error')}</span
                  >`
                : note
                  ? html`<span class="lz-export__status">${note}</span>`
                  : '';
      return html`<article
        class="lz-export"
        ${attr('data-state', disabled ? 'disabled' : null)}
        data-card="${id}"
      >
        <span class="lz-export__icon">${ic(iconName, 'lg')}</span>
        <div class="lz-export__head">
          <h3 class="lz-export__title">${title}</h3>
          <p class="lz-export__purpose">${purpose}</p>
        </div>
        <p class="lz-export__file"><span class="lz-filename">${fileOf[id]}</span><span>${size}</span></p>
        ${options ? html`<div class="lz-export__options">${options}</div>` : ''}
        <div class="lz-export__actions">${s.status === 'preparing' ? '' : actions}${statusLine}</div>
      </article>`;
    };
    const dis = (id: CardId) =>
      attr('disabled', (stale && id !== 'project') || busy || this.state(id).status === 'preparing');
    const again = (id: CardId, label: string) =>
      this.state(id).status === 'done'
        ? t('common.actions.downloadAgain')
        : this.state(id).status === 'error'
          ? t('common.actions.tryAgain')
          : label;
    const radio = (name: string, value: string, label: string, checked: boolean) =>
      html`<label class="lz-radio"
        ><input type="radio" name="${name}" value="${value}" ${attr('checked', checked)} />${label}</label
      >`;
    setHtml(
      this.el,
      html`<div class="dl-groups">
        <div class="lz-cluster lz-cluster--between">
          <h1 class="lz-h2" tabindex="-1">${t('create.guide.downloads.title')}</h1>
          <div class="lz-stack lz-stack--xs lz-dl-all">
            ${
              this.state('all').status === 'preparing'
                ? html`<div class="lz-progress">
                    <div
                      class="lz-progress__track"
                      role="progressbar"
                      aria-label="${t('create.guide.downloads.all')}"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow="${Math.round(this.state('all').progress * 100)}"
                    >
                      <div
                        class="lz-progress__fill"
                        style="--value: ${Math.round(this.state('all').progress * 100)}%"
                      ></div>
                    </div>
                    <div class="lz-cluster lz-cluster--between">
                      <span class="lz-export__status" role="status">${t('exports.all.preparing')}</span
                      ><button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-cancel="all">
                        ${t('common.actions.cancel')}
                      </button>
                    </div>
                  </div>`
                : html`<button type="button" class="lz-btn lz-btn--primary" data-dl="all" ${dis('all')}>
                      ${ic('download')}${t('create.guide.downloads.all')}</button
                    >${this.state('all').status === 'done' ? html`<span class="lz-export__status lz-export__status--done" role="status">${ic('check-circle', 'sm')}${t('exports.common.downloaded', { file: this.state('all').file })}</span>` : ''}`
            }
          </div>
        </div>
        <div class="dl-group">
          <h2 class="lz-eyebrow">${t('create.guide.downloads.groups.building')}</h2>
          ${card(
            'pdf',
            'print',
            t('exports.pdf.title'),
            t('exports.pdf.purpose'),
            t('exports.pdf.pages', { count: pages }),
            html`<div class="lz-segmented" role="group" aria-label="${t('exports.pdf.paper')}">
                <button type="button" data-paper="A4" aria-pressed="${String(p.ui.paper === 'A4')}">
                  ${t('exports.pdf.a4')}</button
                ><button type="button" data-paper="Letter" aria-pressed="${String(p.ui.paper === 'Letter')}">
                  ${t('exports.pdf.letter')}
                </button>
              </div>
              <fieldset class="lz-cluster lz-inline-fieldset">
                <legend class="lz-visually-hidden">${t('exports.pdf.sections.label')}</legend>
                ${(['cover', 'plates', 'layers', 'projection', 'passes'] as const).map((k) => html`<label class="lz-check"><input type="checkbox" data-section="${k}" ${attr('checked', this.sections[k])} />${t(`exports.pdf.sections.${k}`)}</label>`)}
              </fieldset>`,
            html`<button type="button" class="lz-btn lz-btn--primary" data-dl="pdf" ${dis('pdf')}>
              ${ic('download')}${again('pdf', t('exports.pdf.download'))}
            </button>`,
          )}
        </div>
        <div class="dl-group">
          <h2 class="lz-eyebrow">${t('create.guide.downloads.groups.shopping')}</h2>
          ${card(
            'bricklink',
            'tag',
            t('exports.bricklink.title'),
            t('exports.bricklink.purpose'),
            `${bytes(parts * 110 + 24)} · ${t('exports.common.parts', { count: parts })}`,
            '',
            html`<button type="button" class="lz-btn lz-btn--primary" data-dl="bl-copy" ${dis('bricklink')}>
                ${ic('copy')}${t('exports.bricklink.copy')}</button
              ><button type="button" class="lz-btn lz-btn--secondary" data-dl="bricklink" ${dis('bricklink')}>
                ${ic('download')}${again('bricklink', t('exports.bricklink.download'))}
              </button>`,
            t('exports.bricklink.ldrNote'),
          )}
          ${card(
            'rebrickable',
            'tag',
            t('exports.rebrickable.title'),
            t('exports.rebrickable.purpose'),
            bytes(parts * 14 + 20),
            '',
            html`<button
              type="button"
              class="lz-btn lz-btn--secondary"
              data-dl="rebrickable"
              ${dis('rebrickable')}
            >
              ${ic('download')}${again('rebrickable', t('exports.rebrickable.download'))}
            </button>`,
          )}
          <p class="lz-small lz-muted">
            ${t('create.guide.bricks.buy.white')}
            ${p.spares ? `· ${t('create.guide.bricks.buy.spares.label')} +${p.spares}%` : ''}
          </p>
        </div>
        <div class="dl-group">
          <h2 class="lz-eyebrow">${t('create.guide.downloads.groups.projector')}</h2>
          ${card(
            'projection',
            'projector',
            t('exports.projection.title'),
            t('exports.projection.purpose'),
            this.projFmt === 'jpg'
              ? t('exports.projection.sizePx', {
                  w: q.platesX >= q.platesY ? 1920 : Math.floor((1920 * q.platesX) / q.platesY),
                  h: q.platesY >= q.platesX ? 1920 : Math.floor((1920 * q.platesY) / q.platesX),
                })
              : t('exports.projection.sizePx', {
                  w: Math.floor((q.platesX * 256 * this.dpi) / 25.4),
                  h: Math.floor((q.platesY * 256 * this.dpi) / 25.4),
                }),
            html`${radio('lz-dl-proj', 'jpg', t('exports.projection.jpg'), this.projFmt === 'jpg')}<span
                class="lz-option__value"
                >${radio('lz-dl-proj', 'png', t('exports.projection.png', { dpi: this.dpi }), this.projFmt === 'png')}<span
                  class="lz-input lz-select lz-select--sm"
                  ><select id="lz-dl-dpi" aria-label="${t('exports.projection.dpiLabel')}">
                    ${[75, 100, 150, 300].map((v) => html`<option value="${v}" ${attr('selected', v === this.dpi)}>${t('exports.projection.dpiValue', { dpi: v })}</option>`)}
                  </select></span
                ></span
              ><label class="lz-switch"
                ><input
                  type="checkbox"
                  id="lz-dl-grid"
                  ${attr('checked', this.grid)}
                />${t('exports.projection.grid')}</label
              ><label class="lz-switch"
                ><input
                  type="checkbox"
                  id="lz-dl-labels"
                  ${attr('checked', this.labels)}
                />${t('exports.projection.labels')}</label
              >`,
            html`<button
              type="button"
              class="lz-btn lz-btn--secondary"
              data-dl="projection"
              ${dis('projection')}
            >
              ${ic('download')}${again('projection', t('common.actions.download'))}
            </button>`,
            this.projFmt === 'png' ? t('exports.projection.pngNote') : '',
          )}
        </div>
        <div class="dl-group">
          <h2 class="lz-eyebrow">${t('create.guide.downloads.groups.digital')}</h2>
          ${card(
            'csv',
            'grid',
            t('exports.csv.title'),
            t('exports.csv.purpose'),
            bytes(csvBytes),
            html`${radio('lz-dl-csv', 'one', t('exports.csv.oneFile'), this.csvMode === 'one')}${radio('lz-dl-csv', 'zip', t('exports.csv.perPlate'), this.csvMode === 'zip')}`,
            html`<button type="button" class="lz-btn lz-btn--secondary" data-dl="csv" ${dis('csv')}>
              ${ic('download')}${again('csv', t('common.actions.download'))}
            </button>`,
            t('exports.csv.formatNote'),
          )}
          ${card(
            'ldraw',
            'view-3d',
            t('exports.ldraw.title'),
            t('exports.ldraw.purpose'),
            bytes(d.packing.total * 62 + d.packing.baseplates.quantity * 70 + 200),
            html`${radio('lz-dl-ld', 'ldr', t('exports.ldraw.single'), this.ldMode === 'ldr')}${radio('lz-dl-ld', 'mpd', t('exports.ldraw.mpd'), this.ldMode === 'mpd')}`,
            html`<button type="button" class="lz-btn lz-btn--secondary" data-dl="ldraw" ${dis('ldraw')}>
              ${ic('download')}${again('ldraw', t('common.actions.download'))}
            </button>`,
          )}
          ${card(
            'project',
            'save',
            t('exports.project.title'),
            t('exports.project.purpose'),
            '',
            '',
            html`<button type="button" class="lz-btn lz-btn--secondary" data-dl="project" ${dis('project')}>
              ${ic('save')}${again('project', t('exports.project.save'))}
            </button>`,
          )}
        </div>
      </div>`,
    );
  }

  private set(id: CardId, s: Partial<CardState>) {
    this.cards.set(id, { ...this.state(id), ...s });
    this.render();
  }

  private readme(names: {
    csv: string;
    pdf: string;
    bl: string;
    rb: string;
    ldr: string;
    proj: string;
  }): string {
    const p = this.ctx.store.p;
    const date = new Intl.DateTimeFormat(getLocale(), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date());
    return [
      t('create.guide.downloads.readme.title'),
      '',
      t('create.guide.downloads.readme.intro', {
        version: APP_VERSION,
        project: p.name || 'Legonizer',
        date,
      }),
      '',
      t('create.guide.downloads.readme.pdf', { file: names.pdf }),
      t('create.guide.downloads.readme.bricklink', { file: names.bl }),
      t('create.guide.downloads.readme.rebrickable', { file: names.rb }),
      t('create.guide.downloads.readme.projection', { file: 'calqueTemplate.jpg' }),
      t('create.guide.downloads.readme.csv', { file: names.csv }),
      t('create.guide.downloads.readme.ldraw', { file: names.ldr }),
      t('create.guide.downloads.readme.project', { file: names.proj }),
      '',
      t('footer.trademark'),
      '',
    ].join('\r\n');
  }

  private async run(id: CardId, kind: ExportKind, opts: ExportOptions = {}) {
    this.set(id, { status: 'preparing', progress: 0, detail: '' });
    const onProgress = (f: number, detail?: string) => {
      const st = this.state(id);
      if (st.status !== 'preparing') return;
      const pg = kind === 'pdf' && detail ? detail.split('/') : null;
      this.cards.set(id, {
        ...st,
        progress: f,
        detail: pg ? t('exports.pdf.progress', { page: Number(pg[0]), total: Number(pg[1]) }) : '',
      });
      const bar = this.el.querySelector<HTMLElement>(
        `[data-card="${id}"] .lz-progress__fill, .lz-dl-all .lz-progress__fill`,
      );
      if (bar && (id !== 'all' || bar.closest('.lz-dl-all'))) {
        bar.style.setProperty('--value', `${Math.round(f * 100)}%`);
        bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(f * 100)));
        const status = bar.closest('.lz-progress')?.querySelector('.lz-export__status');
        if (status && pg)
          status.textContent = t('exports.pdf.progress', { page: Number(pg[0]), total: Number(pg[1]) });
      }
    };
    const job = this.ctx.actions;
    try {
      const pending = job.download(kind, opts, onProgress);
      this.jobs.set(id, { cancel: () => job.currentExport?.cancel() });
      const names = await pending;
      this.set(id, { status: 'done', file: names[0] ?? '' });
    } catch (e) {
      if (isCancel(e)) {
        this.set(id, { status: 'ready' });
        toast(t('exports.common.cancelled'));
      } else {
        console.error(e);
        this.set(id, { status: 'error' });
      }
    } finally {
      this.jobs.delete(id);
    }
  }

  private onClick = async (e: Event) => {
    const el = e.target as Element;
    const paper = el.closest<HTMLElement>('[data-paper]')?.dataset.paper;
    if (paper) {
      this.ctx.store.setUi({ paper: paper as 'A4' | 'Letter' });
      return;
    }
    const cancel = el.closest<HTMLElement>('[data-cancel]')?.dataset.cancel as CardId | undefined;
    if (cancel) {
      this.jobs.get(cancel)?.cancel();
      return;
    }
    const dl = el.closest<HTMLElement>('[data-dl]')?.dataset.dl;
    if (!dl) return;
    const p = this.ctx.store.p;
    const q = p.result!.params;
    switch (dl) {
      case 'pdf':
        await this.run('pdf', 'pdf', {
          ...pdfOptions(this.ctx),
          sections: { ...this.sections, shopping: this.sections.cover },
        });
        break;
      case 'bl-copy': {
        try {
          const [f] = await this.ctx.actions.exportFiles('bricklink');
          const ok = await copyText(String(f!.data));
          toast(ok ? t('exports.bricklink.copied') : t('errors.copyFailed'), {
            icon: ok ? 'check-circle' : 'warning',
          });
        } catch {
          toast(t('exports.common.error'), { icon: 'warning' });
        }
        break;
      }
      case 'bricklink':
        await this.run('bricklink', 'bricklink');
        break;
      case 'rebrickable':
        await this.run('rebrickable', 'rebrickable');
        break;
      case 'projection':
        await this.run('projection', this.projFmt === 'jpg' ? 'calque-jpeg' : 'calque-png', {
          plateGrid: this.grid,
          labels: this.labels,
          dpi: this.dpi,
        });
        break;
      case 'csv':
        await this.run(
          'csv',
          this.csvMode === 'one' ? 'csv' : 'csv-per-plate',
          this.csvMode === 'zip' ? { zip: true } : {},
        );
        break;
      case 'ldraw':
        await this.run('ldraw', this.ldMode === 'ldr' ? 'ldraw' : 'ldraw-mpd');
        break;
      case 'project':
        await this.run('project', 'project');
        break;
      case 'all': {
        const base = slug(p.name || 'legonizer');
        const readme = this.readme({
          csv: `legoPlates_${q.platesX}_${q.platesY}.csv`,
          pdf: `${base}-build-guide-${p.ui.paper}.pdf`,
          bl: `${base}-bricklink.xml`,
          rb: `${base}-rebrickable.csv`,
          ldr: `${base}.ldr`,
          proj: `${base}.legonizer.json`,
        });
        await this.run('all', 'all', { ...pdfOptions(this.ctx), readme, plateGrid: true, labels: true });
        break;
      }
    }
  };

  private onChange = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.section) this.sections = { ...this.sections, [el.dataset.section]: el.checked };
    else if (el.name === 'lz-dl-proj') this.projFmt = el.value as 'jpg' | 'png';
    else if (el.id === 'lz-dl-dpi') this.dpi = Number(el.value);
    else if (el.id === 'lz-dl-grid') this.grid = el.checked;
    else if (el.id === 'lz-dl-labels') this.labels = el.checked;
    else if (el.name === 'lz-dl-csv') this.csvMode = el.value as 'one' | 'zip';
    else if (el.name === 'lz-dl-ld') this.ldMode = el.value as 'ldr' | 'mpd';
    else return;
    const sel = el.id ? `#${el.id}` : `input[name="${el.name}"][value="${el.value}"]`;
    const ds = el.dataset.section ? `[data-section="${el.dataset.section}"]` : null;
    this.render();
    $<HTMLElement>(ds ?? sel, this.el)?.focus();
  };
}

export { n };
