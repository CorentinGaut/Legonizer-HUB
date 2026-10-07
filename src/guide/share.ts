/**
 * "Share this plate" (SPEC O10): the plate pass on screen — plate
 * name, position, kit, QR code of the pass URL (the plate travels in the URL fragment, nothing is
 * uploaded), Copy link, Print plate passes (the passes section of the PDF). The QR encoder loads on
 * demand; above version 15 at ECC M (the scannability threshold of SPEC O10) the pass shows the no-QR variant.
 */
import { t } from '../shared/i18n.ts';
import { BRICKS } from '../core/packing/catalog.ts';
import { plateHeights } from '../core/export/guide.ts';
import { encodePlatePass, passFitsQr, platePassUrl } from '../core/export/platePass.ts';
import { APP_VERSION } from '../core/version.ts';
import { copyText, html, ic, openDialog, raw, toast } from '../create/dom.ts';
import { n } from '../create/format.ts';
import type { Ctx } from '../create/stepView.ts';
import type { GuideData } from './guide.ts';
import { glyph } from './glyphs.ts';

/** Base URL of the create page (fragment and query removed). */
export function pageBaseUrl(): string {
  return `${location.origin}${location.pathname}`;
}

export function passUrl(ctx: Ctx, d: GuideData, plate: string): string {
  const p = d.packing.plates.find((x) => x.plate === plate)!;
  const payload = encodePlatePass({
    plate,
    heights: plateHeights(d.heightMap, p.col, p.southRow),
    inventory: ctx.store.p.inventory,
    title: d.title,
  });
  return platePassUrl(pageBaseUrl(), plate, payload);
}

export async function qrSvg(text: string, label: string): Promise<string> {
  const { default: qr } = await import('qrcode/lib/core/qrcode.js');
  const q = qr.create(text, { errorCorrectionLevel: 'M' });
  const size = q.modules.size;
  let d = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!q.modules.get(y, x)) {
        x++;
        continue;
      }
      let e = x;
      while (e < size && q.modules.get(y, e)) e++;
      d += `M${x + 4} ${y + 4}h${e - x}v1h-${e - x}z`;
      x = e;
    }
  }
  const s = size + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" role="img" aria-label="${label.replace(/"/g, '&quot;')}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export async function openShareDialog(ctx: Ctx, d: GuideData, plate: string): Promise<void> {
  const p = d.packing.plates.find((x) => x.plate === plate);
  if (!p) return;
  const url = passUrl(ctx, d, plate);
  const fit = passFitsQr(url);
  const name = d.label(plate);
  const qr = fit.fits ? await qrSvg(url, t('create.guide.build.share.qrAlt', { plate: name })) : '';
  const cells: string[] = [];
  for (let r = 0; r < d.platesY; r++)
    for (let c = 0; c < d.platesX; c++)
      cells.push(`<i class="${c === p.col && r === d.platesY - 1 - p.southRow ? 'on' : ''}"></i>`);
  const kit = [...BRICKS].reverse().filter((b) => p.counts[b.id]);
  const date = new Intl.DateTimeFormat(document.documentElement.lang || 'en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date());
  const choice = await openDialog({
    title: t('create.guide.build.share.title', { plate: name }),
    wide: true,
    body: html`<p class="lz-small">${t('create.guide.build.share.body', { plate: name })}</p>
      <article class="lz-pass" aria-label="${t('create.guide.build.share.passTitle', { plate: name })}">
        <div class="lz-pass__eyebrow">
          <span class="lz-eyebrow">${t('exports.pass.title')}</span><span class="lz-eyebrow">${d.title}</span>
        </div>
        <div class="lz-pass__name">${name}</div>
        <div class="lz-pass__qr">
          ${
            fit.fits
              ? html`${raw(qr)}<span class="lz-xsmall lz-muted">${t('exports.pass.scan')}</span>`
              : html`<div class="lz-pass__noqr">
                  <span>${ic('qr', 'lg')}<br />${t('create.guide.build.share.tooLarge')}</span>
                </div>`
          }
        </div>
        <div class="lz-pass__where">
          <span class="lz-pass__minimap" style="--cols: ${d.platesX}" aria-hidden="true"
            >${raw(cells.join(''))}</span
          ><span class="lz-small"
            >${t('exports.pass.position')}<br /><strong
              >${t('create.guide.build.share.position', { col: plate.replace(/\d+$/, ''), row: plate.replace(/^[A-Z]+/, '') })}</strong
            >
            · ${t('exports.pass.layers', { count: p.layers, bricks: n(p.bricks) })}</span
          >
        </div>
        <ul class="lz-pass__kit" aria-label="${t('create.guide.build.plateMode.kit')}">
          ${kit.map((b) => html`<li>${raw(glyph(b.id))}<b>×${p.counts[b.id]}</b>${b.width}×${b.length}</li>`)}
        </ul>
        <div class="lz-pass__foot">
          <span>${t('exports.pass.footer', { version: APP_VERSION, date })}</span>
        </div>
      </article>
      <p class="lz-xsmall lz-muted lz-mono">
        QR ${fit.version ? `v${fit.version}` : '—'} · ${n(fit.bytes)} B
      </p>`,
    actions: [
      { label: t('create.guide.build.share.copy'), value: 'copy', icon: 'copy' },
      { label: t('create.guide.build.share.printPasses'), kind: 'primary', value: 'print', icon: 'print' },
    ],
  });
  if (choice === 'copy') {
    const ok = await copyText(url);
    toast(ok ? t('create.guide.build.linkCopied') : t('errors.copyFailed'), {
      icon: ok ? 'check-circle' : 'warning',
    });
  } else if (choice === 'print') {
    try {
      const { pdfOptions } = await import('./downloads.ts');
      toast(t('exports.pdf.preparingShort'));
      await ctx.actions.download('pdf', {
        ...pdfOptions(ctx),
        sections: {
          cover: false,
          shopping: false,
          plates: false,
          layers: false,
          projection: false,
          passes: true,
        },
        sectionsName: 'plate-passes',
      });
    } catch {
      toast(t('exports.common.error'), { icon: 'warning' });
    }
  }
}
