/**
 * Step 1 — Import (SPEC I1–I13).
 */
import { t } from '../../shared/i18n.ts';
import type { WireFile } from '../../core/worker/protocol.ts';
import type { DemoId } from '../actions.ts';
import { $, announce, attr, html, ic, openDialog, setHtml, type Raw } from '../dom.ts';
import { length, n, when } from '../format.ts';
import type { Ctx, PrimaryAction, StepView } from '../stepView.ts';

/** Reads a dropped folder tree (webkitGetAsEntry) into path-keyed files. */
async function readEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: { path: string; file: File }[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ path: prefix + entry.name, file });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await readEntry(e, `${prefix}${entry.name}/`, out);
    }
  }
}

async function toWire(list: { path: string; file: File }[]): Promise<WireFile[]> {
  return Promise.all(
    list.map(async ({ path, file }) => ({ path, data: new Uint8Array(await file.arrayBuffer()) })),
  );
}

function labelFor(list: { path: string }[]): string {
  if (list.length === 1) return list[0]!.path.split('/').pop()!;
  const roots = new Set(list.map((f) => f.path.split('/')[0]));
  if (roots.size === 1 && list[0]!.path.includes('/')) return [...roots][0]!;
  const ts = list.find((f) => /tileset\.json$/i.test(f.path));
  return ts ? ts.path.split('/').slice(-2, -1)[0] || 'tileset' : list[0]!.path.split('/').pop()!;
}

export class ImportStep implements StepView {
  readonly id = 'import' as const;
  private ctx: Ctx;
  private panel!: HTMLElement;
  private sig = '';
  private dragDepth = 0;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  mount(panel: HTMLElement): void {
    this.panel = panel;
    this.sig = '';
    this.render();
    panel.addEventListener('click', this.onClick);
    panel.addEventListener('change', this.onInput);
    panel.addEventListener('submit', this.onSubmit);
    panel.addEventListener('dragenter', this.onDragEnter);
    panel.addEventListener('dragover', this.onDragOver);
    panel.addEventListener('dragleave', this.onDragLeave);
    panel.addEventListener('drop', this.onDrop);
    this.ctx.stage.show(this.ctx.store.p.summary && !this.ctx.store.t.importing ? 'source' : 'placeholder');
  }

  unmount(): void {
    const p = this.panel;
    p.removeEventListener('click', this.onClick);
    p.removeEventListener('change', this.onInput);
    p.removeEventListener('submit', this.onSubmit);
    p.removeEventListener('dragenter', this.onDragEnter);
    p.removeEventListener('dragover', this.onDragOver);
    p.removeEventListener('dragleave', this.onDragLeave);
    p.removeEventListener('drop', this.onDrop);
    p.innerHTML = '';
  }

  update(changed: Set<string>): void {
    if (
      changed.has('t.importing') ||
      changed.has('t.importIssue') ||
      changed.has('summary') ||
      changed.has('source') ||
      changed.has('t.largeAck') ||
      changed.has('importOptions') ||
      changed.has('t.engineReady')
    ) {
      this.render();
      const tr = this.ctx.store.t;
      this.ctx.stage.show(
        this.ctx.store.p.summary && !tr.importing && tr.importIssue?.kind !== 'error'
          ? 'source'
          : 'placeholder',
      );
    }
  }

  primary(): PrimaryAction {
    const p = this.ctx.store.p;
    const tr = this.ctx.store.t;
    return {
      label: t('create.shell.primary.import'),
      short: t('common.actions.continue'),
      disabled: !p.summary || !!tr.importing,
      run: () => this.ctx.go('area', { focus: true }),
    };
  }

  // ------------------------------------------------------------------ render

  private render() {
    const p = this.ctx.store.p;
    const tr = this.ctx.store.t;
    const state = tr.importing
      ? 'loading'
      : tr.importIssue?.kind === 'error'
        ? 'error'
        : p.summary
          ? 'success'
          : 'empty';
    const sig = JSON.stringify([
      state,
      tr.importing,
      tr.importIssue,
      p.summary?.stats,
      p.source,
      tr.largeAck,
      p.importOptions,
      !!this.ctx.resumeCandidate,
      Object.keys(this.ctx.actions.demos),
    ]);
    if (sig === this.sig) return;
    const loadingOnly = this.sig && JSON.parse(this.sig)[0] === 'loading' && state === 'loading';
    this.sig = sig;
    if (loadingOnly) {
      // update the stage list and bar in place (keeps focus on Cancel)
      const box = $('#lz-import-loading', this.panel);
      if (box) {
        setHtml(box, this.loadingInner());
        return;
      }
    }
    const head = html`<div class="lz-panel__head">
      <h1 id="step-title" tabindex="-1">${t('create.import.title')}</h1>
      <p class="lz-muted">${t('create.import.lead')}</p>
    </div>`;
    let body: Raw;
    if (state === 'loading')
      body = html`<div class="lz-stack" id="lz-import-loading" aria-live="polite">
        ${this.loadingInner()}
      </div>`;
    else if (state === 'success') body = this.successHtml();
    else body = this.emptyHtml(state === 'error');
    setHtml(this.panel, html`${head}${this.resumeHtml()}${body}`);
    if (state === 'error')
      requestAnimationFrame(() => $<HTMLElement>('#lz-import-error', this.panel)?.focus());
  }

  private resumeHtml(): Raw | '' {
    const r = this.ctx.resumeCandidate;
    if (!r) return '';
    return html`<div class="lz-alert" role="status">
      ${ic('clock')}
      <div class="lz-alert__body">
        <p>
          ${t('create.project.resume.message', {
            name: r.name || t('create.project.untitled'),
            when: r.savedAt ? when(r.savedAt) : '',
          })}
        </p>
        ${r.source && !r.source.stored && r.source.kind === 'files' ? html`<p class="lz-small">${t('create.project.resume.noSource')}</p>` : ''}
        <div class="lz-cluster">
          <button type="button" class="lz-btn lz-btn--primary lz-btn--sm" data-a="resume">
            ${t('create.project.resume.continue')}</button
          ><button type="button" class="lz-btn lz-btn--tertiary lz-btn--sm" data-a="start-new">
            ${t('create.project.resume.startNew')}
          </button>
        </div>
      </div>
    </div>`;
  }

  private emptyHtml(error: boolean): Raw {
    const demos = this.ctx.actions.demos;
    const issue = this.ctx.store.t.importIssue;
    const err =
      error && issue?.kind === 'error'
        ? html`<div class="lz-alert lz-alert--danger" role="alert">
            ${ic('x-circle')}
            <div class="lz-alert__body">
              <h2 class="lz-alert__title" id="lz-import-error" tabindex="-1">${issue.title}</h2>
              <p>${issue.body}</p>
              <div class="lz-cluster">
                ${issue.action === 'citygml' ? html`<a class="lz-btn lz-btn--secondary lz-btn--sm" href="about.html#prepare-data">${t('create.import.errors.citygml.action')}</a>` : ''}${issue.action === 'oom' ? html`<a class="lz-btn lz-btn--secondary lz-btn--sm" href="about.html#prepare-data">${t('create.import.errors.outOfMemory.action')}</a>` : ''}${issue.action === 'cors' ? html`<button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-a="choose-files">${t('create.import.errors.cors.action')}</button>` : ''}<button
                  type="button"
                  class="lz-btn lz-btn--primary lz-btn--sm"
                  data-a="dismiss-error"
                >
                  ${t('create.import.errors.tryAnother')}
                </button>
              </div>
              ${
                issue.details
                  ? html`<details class="lz-disclosure lz-disclosure--inline">
                      <summary>${t('common.actions.technicalDetails')}</summary>
                      <p class="lz-mono lz-xsmall u-mt-2">${issue.details}</p>
                    </details>`
                  : ''
              }
            </div>
          </div>`
        : '';
    const sample = demos['sample'];
    return html`${err}
      <div class="lz-stack">
        ${
          sample
            ? html`<div class="lz-card lz-card--tight lz-demo-card">
                  <h2 class="lz-h4">${t('create.import.demo.sample.title')}</h2>
                  <p class="lz-small lz-muted">${t('create.import.demo.sample.body')}</p>
                  <button
                    type="button"
                    class="lz-btn lz-btn--primary"
                    data-a="demo"
                    data-demo="sample"
                    style="justify-self:start"
                  >
                    ${t('create.import.demo.sample.cta')}
                  </button>
                </div>
                <p class="lz-or">${t('create.import.or')}</p>`
            : ''
        }
        <div
          class="lz-dropzone"
          id="lz-dropzone"
          role="group"
          aria-label="${t('create.import.dropzone.label')}"
        >
          ${ic('upload', 'xl')}
          <p class="lz-dropzone__title" id="lz-drop-title">${t('create.import.dropzone.title')}</p>
          <div class="lz-cluster" style="justify-content:center">
            <button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-a="choose-files">
              ${ic('file', 'sm')}${t('create.import.dropzone.chooseFiles')}
            </button>
            <button
              type="button"
              class="lz-btn lz-btn--secondary lz-btn--sm u-hide-sm"
              data-a="choose-folder"
            >
              ${ic('folder', 'sm')}${t('create.import.dropzone.chooseFolder')}
            </button>
          </div>
          <input
            type="file"
            id="lz-files"
            multiple
            hidden
            accept=".zip,.json,.b3dm,.glb,.gltf,.bin,.obj,.mtl,.jsonl,.png,.jpg,.jpeg,.ktx2,.gml,.cmpt"
          />
          <input type="file" id="lz-folder" hidden webkitdirectory />
        </div>
        <details class="lz-disclosure lz-disclosure--inline">
          <summary>${t('create.import.url.toggle')}</summary>
          <form class="lz-field u-mt-2" id="lz-url-form" novalidate>
            <label class="lz-label" for="lz-url">${t('create.import.url.label')}</label>
            <div class="lz-cluster" style="flex-wrap:nowrap">
              <div class="lz-input lz-input--wide u-grow">
                <input
                  id="lz-url"
                  type="url"
                  placeholder="${t('create.import.url.placeholder')}"
                  aria-describedby="lz-url-help"
                  autocomplete="url"
                />
              </div>
              <button type="submit" class="lz-btn lz-btn--secondary">${t('create.import.url.submit')}</button>
            </div>
            <p class="lz-help" id="lz-url-help">${t('create.import.url.help')}</p>
          </form>
        </details>
        <div class="lz-stack lz-stack--sm lz-small">
          <p class="lz-cluster lz-privacy">
            ${ic('lock', 'sm')}<strong class="u-hide-sm">${t('create.import.privacy')}</strong
            ><strong class="u-only-sm">${t('create.import.privacyMobile')}</strong>
          </p>
          <p class="lz-muted">${t('create.import.sizeGuidance')}</p>
        </div>
        <details class="lz-disclosure">
          <summary>${t('create.import.formats.toggle')}</summary>
          <ul class="lz-disclosure__content lz-small lz-stack lz-stack--xs lz-formats">
            ${['tiles10', 'tiles11', 'gltf', 'obj', 'cityjson', 'citygml'].map((k) => html`<li>${t(`create.import.formats.${k}`)}</li>`)}
          </ul>
        </details>
        <div class="lz-cluster lz-small" style="--lz-cluster-gap: var(--lz-space-5)">
          <a class="lz-link" href="about.html#prepare-data">${ic('help')}${t('create.import.helpLink')}</a>
          <button type="button" class="lz-link lz-link--button" data-a="open-project">
            ${ic('folder-open')}${t('create.import.openProject')}
          </button>
        </div>
        <p class="lz-alert u-only-sm">${ic('info')}<span>${t('create.shell.smallScreen')}</span></p>
      </div>`;
  }

  private loadingInner(): Raw {
    const L = this.ctx.store.t.importing!;
    const order = ['reading', 'tiles', 'features', 'preparing'] as const;
    const cur = L.stage === 'model' ? 'tiles' : L.stage === 'downloading' ? 'reading' : L.stage;
    const idx = order.indexOf(cur as (typeof order)[number]);
    const label = (s: (typeof order)[number]) =>
      s === 'tiles'
        ? L.stage === 'tiles' && L.total > 1
          ? t('create.import.loading.stages.tiles', { done: Math.min(L.done, L.total), total: L.total })
          : t('create.import.loading.stages.model')
        : s === 'reading' && L.stage === 'downloading'
          ? t('create.import.loading.downloading', { done: L.done, total: L.total || '?' })
          : t(`create.import.loading.stages.${s}`);
    const pct = Math.round(Math.min(1, L.fraction) * 100);
    const elapsed = (performance.now() - L.started) / 1000;
    return html`<h2 class="lz-h3">${t('create.import.loading.title', { name: L.name })}</h2>
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
          aria-label="${t('create.import.loading.title', { name: L.name })}"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="${pct}"
        >
          <div class="lz-progress__fill" style="--value: ${pct}%"></div>
        </div>
        <div class="lz-progress__meta">
          <span>${t('common.units.percent', { value: pct })}</span
          ><span>${elapsed >= 2 ? t('common.units.seconds', { value: n(elapsed, 1) }) : ''}</span>
        </div>
      </div>
      <button type="button" class="lz-btn lz-btn--secondary" data-a="cancel" style="align-self:flex-start">
        ${t('create.import.loading.cancel')}
      </button>`;
  }

  private successHtml(): Raw {
    const p = this.ctx.store.p;
    const tr = this.ctx.store.t;
    const s = p.summary!;
    const src = p.source;
    const meta = s.meta ?? {};
    const generic = s.format === 'glb' || s.format === 'gltf' || s.format === 'obj';
    const fmt =
      s.format === '3dtiles' || s.format === 'b3dm'
        ? t('create.import.success.formatTiles', {
            version: meta.tilesetVersion ?? '1.0',
            count: meta.tiles ?? 1,
          })
        : s.format === 'glb'
          ? t('create.import.success.formatGlb')
          : s.format === 'gltf'
            ? t('create.import.success.formatGltf')
            : s.format === 'obj'
              ? t('create.import.success.formatObj')
              : t('create.import.success.formatCityjson', { version: meta.version ?? '1.x' });
    const name =
      src?.kind === 'demo' ? t('create.import.success.demoName', { name: src.label }) : (src?.label ?? '');
    const size = t('create.import.success.size', {
      w: length(s.size[0]),
      d: length(s.size[1]),
      h: length(s.size[2]),
    });
    const tri =
      s.stats.triangles >= 1e6
        ? t('create.import.success.triangles', { value: n(s.stats.triangles / 1e6, 1) })
        : t('create.import.success.trianglesSmall', { count: s.stats.triangles });
    const coords =
      s.frame.kind === 'enu'
        ? t('create.import.success.coordinates.ecef')
        : s.frame.kind === 'local' || generic
          ? t('create.import.success.coordinates.local')
          : meta.tileTransforms
            ? `${t('create.import.success.coordinates.projected')} · ${t('create.import.success.coordinates.py3dtilers')}`
            : t('create.import.success.coordinates.projected');
    const featKey =
      s.idSource === 'gml_id' ? 'featuresGml' : s.idSource === 'mesh' ? 'featuresMesh' : 'featuresBatch';
    const largest = Math.max(s.size[0], s.size[1]);
    const sizeCheck = generic && (largest < 10 || largest > 100_000);
    const unitOpts = ['m', 'cm', 'mm', 'ft'] as const;
    const curUnit = p.importOptions.unit ?? 'auto';
    const curUp = p.importOptions.upAxis ?? 'auto';
    const unitName = (u: string) => t(`create.import.success.unit.${u}`);
    const detectedUnit = meta.unit ?? 'm';
    const detectedUp = meta.upAxis ?? 'y';
    const lods = meta.lods ?? [];
    const fmtB = (b: number[]) => `(${n(b[0]!, 0)}; ${n(b[1]!, 0)})`;
    const detail =
      s.format === '3dtiles'
        ? t('create.import.success.tilesLod')
        : s.format === 'cityjson' && meta.lod !== undefined
          ? t('create.import.success.lod.highest', { lod: meta.lod })
          : '';
    return html`<div class="lz-stack">
      <div class="lz-card lz-card--tight lz-stack lz-stack--sm">
        <p class="lz-cluster lz-success-title">${ic('check-circle')}<strong>${name}</strong></p>
        <dl class="lz-facts">
          <div>
            <dt>${t('create.import.success.labels.format')}</dt>
            <dd>${fmt}</dd>
          </div>
          <div>
            <dt>${t('create.import.success.labels.buildings')}</dt>
            <dd>${t('create.import.success.buildings', { count: s.stats.features })}</dd>
          </div>
          <div>
            <dt>${t('create.import.success.labels.size')}</dt>
            <dd>${size}</dd>
          </div>
          <div>
            <dt>${t('create.import.success.labels.triangles')}</dt>
            <dd>${tri}</dd>
          </div>
          <div>
            <dt>${t('create.import.success.labels.coordinates')}</dt>
            <dd>${coords}</dd>
          </div>
          ${
            detail
              ? html`<div>
                  <dt>${t('create.import.success.labels.detail')}</dt>
                  <dd>${detail}</dd>
                </div>`
              : ''
          }
        </dl>
        ${
          sizeCheck
            ? html`<div class="lz-alert lz-alert--warning" role="status">
                ${ic('warning')}
                <div class="lz-alert__body">
                  <p>${t('create.import.sizeCheck', { size: length(largest) })}</p>
                </div>
              </div>`
            : ''
        }
        ${
          generic
            ? html`<div class="lz-param">
                  <label class="lz-label" for="lz-unit">${t('create.import.success.unit.label')}</label>
                  <div class="lz-input lz-select">
                    <select id="lz-unit" data-opt="unit">
                      <option value="auto" ${attr('selected', curUnit === 'auto')}>
                        ${t('create.import.success.unit.detected', { unit: unitName(detectedUnit) })}
                      </option>
                      ${unitOpts.map((u) => html`<option value="${u}" ${attr('selected', curUnit === u)}>${unitName(u)}</option>`)}
                    </select>
                  </div>
                </div>
                <div class="lz-param">
                  <label class="lz-label" for="lz-up">${t('create.import.success.upAxis.label')}</label>
                  <div class="lz-input lz-select">
                    <select id="lz-up" data-opt="upAxis">
                      <option value="auto" ${attr('selected', curUp === 'auto')}>
                        ${t('create.import.success.upAxis.detected', { axis: t(`create.import.success.upAxis.${detectedUp}`) })}
                      </option>
                      <option value="y" ${attr('selected', curUp === 'y')}>
                        ${t('create.import.success.upAxis.y')}
                      </option>
                      <option value="z" ${attr('selected', curUp === 'z')}>
                        ${t('create.import.success.upAxis.z')}
                      </option>
                    </select>
                  </div>
                </div>`
            : ''
        }
        ${
          s.format === 'cityjson' && lods.length > 1
            ? html`<div class="lz-param">
                <label class="lz-label" for="lz-lod">${t('create.import.success.lod.label')}</label>
                <div class="lz-input lz-select">
                  <select id="lz-lod" data-opt="maxLod">
                    ${lods.map(
                      (l) =>
                        html`<option value="${l}" ${attr('selected', l === meta.lod)}>
                          ${l === Math.max(...lods.filter((x) => x <= 2.2)) ? t('create.import.success.lod.highest', { lod: l }) : t('create.import.success.lod.option', { lod: l })}
                        </option>`,
                    )}
                  </select>
                </div>
              </div>`
            : ''
        }
        <details class="lz-disclosure">
          <summary>${t('create.import.success.details.toggle')}</summary>
          <dl class="lz-facts lz-disclosure__content">
            <div>
              <dt>${t('create.import.success.labels.buildings')}</dt>
              <dd>${t(`create.import.success.details.${featKey}`)}</dd>
            </div>
            <div>
              <dt></dt>
              <dd class="lz-muted">${t('create.import.success.details.featureTerm')}</dd>
            </div>
            <div>
              <dt>${t('create.import.success.labels.files')}</dt>
              <dd>${t('create.import.success.details.files', { count: s.files.length })}</dd>
            </div>
            <div>
              <dt>${t('create.import.success.labels.bbox')}</dt>
              <dd class="lz-mono lz-xsmall">
                ${t('create.import.success.details.bbox', { min: fmtB(s.bounds.min), max: fmtB(s.bounds.max) })}
              </dd>
            </div>
            ${
              s.warnings.length
                ? html`<div>
                    <dt>${t('common.status.info')}</dt>
                    <dd class="lz-xsmall">${s.warnings.slice(0, 6).join(' ')}</dd>
                  </div>`
                : ''
            }
          </dl>
        </details>
        <button
          type="button"
          class="lz-btn lz-btn--tertiary lz-btn--sm"
          data-a="replace"
          style="align-self:flex-start"
        >
          ${ic('refresh', 'sm')}${t('create.import.success.replace')}
        </button>
        <input type="file" id="lz-files" multiple hidden />
      </div>
      ${
        meta.missing?.length
          ? html`<div class="lz-alert lz-alert--warning" role="status">
              ${ic('warning')}
              <div class="lz-alert__body">
                <p class="lz-alert__title">
                  ${t('create.import.partial.title', { loaded: meta.tiles ?? 0, total: (meta.tiles ?? 0) + meta.missing.length })}
                </p>
                <p>${t('create.import.partial.missing', { files: meta.missing.slice(0, 8).join(', ') })}</p>
              </div>
            </div>`
          : ''
      }
      ${
        s.large && !tr.largeAck
          ? html`<div class="lz-alert lz-alert--warning" role="status">
              ${ic('warning')}
              <div class="lz-alert__body">
                <p>${t('create.import.large.message', { value: n(s.stats.triangles / 1e6, 1) })}</p>
                <p><a href="about.html#prepare-data">${t('create.import.large.link')}</a></p>
                <button
                  type="button"
                  class="lz-btn lz-btn--secondary lz-btn--sm"
                  data-a="large-ack"
                  style="align-self:flex-start"
                >
                  ${t('create.import.large.continue')}
                </button>
              </div>
            </div>`
          : ''
      }
      ${this.partialHtml()}
    </div>`;
  }

  private partialHtml(): Raw | '' {
    const issue = this.ctx.store.t.importIssue;
    if (issue?.kind !== 'partial') return '';
    return html`<div class="lz-alert lz-alert--warning" role="status">
      ${ic('warning')}
      <div class="lz-alert__body">
        <p class="lz-alert__title">
          ${t('create.import.partial.title', { loaded: Math.max(0, issue.total - issue.missing.length), total: issue.total })}
        </p>
        <p>${t('create.import.partial.missing', { files: issue.missing.slice(0, 8).join(', ') })}</p>
        <div class="lz-cluster">
          <button type="button" class="lz-btn lz-btn--secondary lz-btn--sm" data-a="add-missing">
            ${t('create.import.partial.addMissing')}</button
          ><button type="button" class="lz-btn lz-btn--tertiary lz-btn--sm" data-a="continue-without">
            ${t('create.import.partial.continueWithout')}
          </button>
        </div>
        <input type="file" id="lz-missing" multiple hidden />
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ events

  private onClick = (e: Event) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-a]');
    if (!b) return;
    const a = this.ctx.actions;
    switch (b.dataset.a) {
      case 'demo':
        void this.confirmReplace(t(`create.import.demo.${b.dataset.demo}.title`)).then((ok) => {
          if (ok) void a.importDemo(b.dataset.demo as DemoId);
        });
        break;
      case 'choose-files':
      case 'replace':
        if (this.ctx.store.t.importIssue?.kind === 'error') this.ctx.store.setT({ importIssue: null });
        $<HTMLInputElement>('#lz-files', this.panel)?.click();
        break;
      case 'choose-folder':
        $<HTMLInputElement>('#lz-folder', this.panel)?.click();
        break;
      case 'cancel':
        a.cancelImport();
        break;
      case 'dismiss-error':
        this.ctx.store.setT({ importIssue: null });
        requestAnimationFrame(() => $<HTMLElement>('[data-a=choose-files]', this.panel)?.focus());
        break;
      case 'open-project':
        this.ctx.openProjectPicker();
        break;
      case 'large-ack':
        this.ctx.store.setT({ largeAck: true });
        break;
      case 'add-missing':
        $<HTMLInputElement>('#lz-missing', this.panel)?.click();
        break;
      case 'continue-without':
        void a.continueWithoutMissing();
        break;
      case 'resume':
        this.ctx.resume();
        break;
      case 'start-new':
        void this.ctx.startNew().then(() => {
          this.sig = '';
          this.render();
          announce(t('create.import.title'));
        });
        break;
    }
  };

  private onInput = (e: Event) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.id === 'lz-files' || el.id === 'lz-folder') {
      const files = [...((el as HTMLInputElement).files ?? [])];
      (el as HTMLInputElement).value = '';
      if (!files.length) return;
      const list = files.map((f) => ({
        path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
        file: f,
      }));
      void this.importList(list);
    } else if (el.id === 'lz-missing') {
      const files = [...((el as HTMLInputElement).files ?? [])];
      (el as HTMLInputElement).value = '';
      if (files.length)
        void toWire(files.map((f) => ({ path: f.name, file: f }))).then((w) =>
          this.ctx.actions.addMissingFiles(w),
        );
    } else if (el.dataset.opt) {
      const v = el.value;
      const opt = el.dataset.opt;
      if (opt === 'maxLod') void this.ctx.actions.reimport({ maxLod: Number(v) });
      else void this.ctx.actions.reimport({ [opt]: v } as never);
    }
  };

  private onSubmit = (e: Event) => {
    if ((e.target as HTMLElement).id !== 'lz-url-form') return;
    e.preventDefault();
    const url = $<HTMLInputElement>('#lz-url', this.panel)!.value.trim();
    if (!url) return;
    void this.confirmReplace(url).then((ok) => {
      if (ok) void this.ctx.actions.importUrl(url);
    });
  };

  private async importList(list: { path: string; file: File }[]) {
    const label = labelFor(list);
    if (!(await this.confirmReplace(label))) return;
    this.ctx.actions.lastAttempt = list.map((f) => f.path);
    const wire = await toWire(list);
    await this.ctx.actions.importFiles(wire, label);
  }

  /** Asks before replacing the model when a model or a result exists. */
  private async confirmReplace(next: string): Promise<boolean> {
    const p = this.ctx.store.p;
    if (!p.summary && !p.result) return true;
    const r = await openDialog({
      title: t('create.import.replaceDialog.title', {
        current: p.name || p.source?.label || t('create.project.untitled'),
        next,
      }),
      body: t('create.import.replaceDialog.body'),
      actions: [
        { label: t('create.import.replaceDialog.cancel'), value: '' },
        { label: t('create.import.replaceDialog.confirm'), kind: 'primary', value: 'ok' },
      ],
    });
    return r === 'ok';
  }

  // drag and drop: the zone grows to the whole panel during a drag
  private onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    this.dragDepth++;
    this.setDrag(true);
  };
  private onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  private onDragLeave = () => {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) this.setDrag(false);
  };
  private onDrop = (e: DragEvent) => {
    e.preventDefault();
    this.dragDepth = 0;
    this.setDrag(false);
    const dt = e.dataTransfer;
    if (!dt) return;
    const items = [...dt.items].filter((i) => i.kind === 'file');
    const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
    void (async () => {
      const list: { path: string; file: File }[] = [];
      if (entries.length) for (const en of entries) await readEntry(en, '', list);
      else for (const f of [...dt.files]) list.push({ path: f.name, file: f });
      if (list.length) await this.importList(list);
    })();
  };
  private setDrag(on: boolean) {
    const z = $('#lz-dropzone', this.panel);
    if (!z) return;
    if (on) z.dataset.state = 'dragover';
    else delete z.dataset.state;
    this.panel.classList.toggle('is-dragover', on);
    const title = $('#lz-drop-title', this.panel);
    if (title)
      title.textContent = on ? t('create.import.dropzone.active') : t('create.import.dropzone.title');
  }
}
