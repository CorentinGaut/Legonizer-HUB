/**
 * Plate mode (SPEC O10): a phone scans a plate pass and opens
 * `create.html#guide/build/B2/1&d=<payload>`. The heights, part settings and versions travel in the
 * URL fragment (never sent to a server); the plate is packed in the Worker (packing is plate-local
 * and deterministic) and shown in the Build view, with the plate's kit. Progress stays on the phone.
 */
import { t } from '../shared/i18n.ts';
import { BRICKS } from '../core/packing/catalog.ts';
import { decodePlatePass, type PlatePass } from '../core/export/platePass.ts';
import { APP_VERSION, PACKING_ALGORITHM_VERSION } from '../core/version.ts';
import type { PackingResult } from '../core/packing/pack.ts';
import { $, html, ic, raw, setHtml } from '../create/dom.ts';
import { n } from '../create/format.ts';
import { parseGuideRoute } from '../create/route.ts';
import type { BuildProgress } from '../create/state.ts';
import type { Ctx } from '../create/stepView.ts';
import { BuildView } from './build.ts';
import type { GuideData } from './guide.ts';
import { ensureGlyphSprite, glyph } from './glyphs.ts';

export class PlateModeView {
  private host: HTMLElement;
  private ctx: Ctx;
  private view: BuildView | null = null;

  constructor(host: HTMLElement, ctx: Ctx) {
    this.host = host;
    this.ctx = ctx;
  }

  async mount(hash: string): Promise<void> {
    ensureGlyphSprite();
    const r = parseGuideRoute(hash);
    let pass: PlatePass;
    try {
      if (!r.payload) throw new Error('no payload');
      pass = decodePlatePass(r.payload);
    } catch {
      setHtml(
        this.host,
        html`<div class="lz-guide lz-plate-mode">
          <div class="guide-body">
            <div class="lz-alert lz-alert--danger" role="alert">
              ${ic('x-circle')}
              <div class="lz-alert__body">
                <h1 class="lz-alert__title" tabindex="-1">${t('create.guide.build.plateMode.invalid')}</h1>
                <p><a href="./">${t('create.guide.build.plateMode.whatIsThis')}</a></p>
              </div>
            </div>
          </div>
        </div>`,
      );
      return;
    }
    const title = pass.title || t('create.project.untitled');
    document.title = `${t('create.guide.build.plateMode.title', { plate: pass.plate, project: title })} · Legonizer`;
    setHtml(
      this.host,
      html`<div class="lz-guide lz-plate-mode">
        <div class="guide-head lz-plate-mode__head">
          <h1 class="lz-h2" tabindex="-1" id="lz-pm-title">
            ${t('create.guide.build.plateMode.title', { plate: pass.plate, project: title })}
          </h1>
          <p class="lz-alert">${ic('info')}<span>${t('create.guide.build.plateMode.shared')}</span></p>
          ${pass.appVersion !== APP_VERSION || pass.packingVersion !== PACKING_ALGORITHM_VERSION ? html`<p class="lz-alert lz-alert--warning">${ic('warning')}<span>${t('create.guide.build.plateMode.versionMismatch', { version: pass.appVersion })}</span></p>` : ''}
        </div>
        <div class="guide-body">
          <div id="lz-pm-build"><p class="lz-muted">${t('create.guide.build.plateMode.loading')}</p></div>
          <div id="lz-pm-kit"></div>
          <p><a class="lz-link" href="./">${t('create.guide.build.plateMode.whatIsThis')}</a></p>
        </div>
      </div>`,
    );
    let packing: PackingResult;
    try {
      packing = await this.ctx.engine.request('pack', {
        heightMap: { cols: 32, rows: 32, data: Int32Array.from(pass.heights) },
        inventory: pass.inventory,
      }).promise;
    } catch {
      setHtml(
        $('#lz-pm-build', this.host)!,
        html`<p class="lz-alert lz-alert--danger" role="alert">
          ${ic('x-circle')}<span>${t('create.guide.build.plateMode.invalid')}</span>
        </p>`,
      );
      return;
    }
    const data: GuideData = {
      title,
      packing,
      heightMap: { cols: 32, rows: 32, data: Int32Array.from(pass.heights) },
      platesX: 1,
      platesY: 1,
      label: () => pass.plate,
    };
    const key = `lz-plate-progress:${r.payload!.slice(0, 64)}`;
    let progress: BuildProgress = { built: {}, teams: {}, current: null };
    try {
      progress = JSON.parse(localStorage.getItem(key) ?? 'null') ?? progress;
    } catch {
      // private mode: progress lives for this page only
    }
    let shortcuts = true;
    let below: 'ghost' | 'solid' | 'hidden' = 'ghost';
    const box = $('#lz-pm-build', this.host)!;
    box.innerHTML = '';
    this.view = new BuildView({
      data: () => data,
      progress: () => progress,
      setProgress: (p) => {
        progress = p;
        try {
          localStorage.setItem(key, JSON.stringify(p));
        } catch {
          // ignore
        }
      },
      shortcuts: () => shortcuts,
      setShortcuts: (on) => (shortcuts = on),
      below: () => below,
      setBelow: (b) => (below = b),
      webgl: this.ctx.store.t.webgl,
      plateMode: true,
      onStep: (_plate, layer) => {
        history.replaceState(null, '', `#guide/build/${pass.plate}/${layer}&d=${r.payload}`);
      },
      link: () => location.href,
    });
    this.view.mount(box, { plate: 'A1', ...(r.layer ? { layer: r.layer } : {}) });
    const pl = packing.plates[0]!;
    const kit = [...BRICKS].reverse().filter((b) => pl.counts[b.id]);
    setHtml(
      $('#lz-pm-kit', this.host)!,
      html`<details class="lz-disclosure">
        <summary>
          ${t('create.guide.build.plateMode.kit')} ·
          ${t('exports.pass.layers', { count: pl.layers, bricks: n(pl.bricks) })}
        </summary>
        <ul class="lz-pass__kit lz-disclosure__content" aria-label="${t('create.guide.build.plateMode.kit')}">
          ${kit.map((b) => html`<li>${raw(glyph(b.id))}<b>×${pl.counts[b.id]}</b>${b.width}×${b.length}</li>`)}
        </ul>
      </details>`,
    );
    requestAnimationFrame(() => $<HTMLElement>('#lz-pm-title', this.host)?.focus());
  }
}
