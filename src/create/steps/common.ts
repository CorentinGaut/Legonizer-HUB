/** Pieces shared by several steps: stale banner (G4), table-fit diagram (A5), numeric fields. */
import { t } from '../../shared/i18n.ts';
import { fitsTable } from '../../core/heightmap/estimate.ts';
import { attr, html, ic, type Raw } from '../dom.ts';
import { n } from '../format.ts';
import { staleChanges, type ProjectState, type StaleChange } from '../state.ts';

export function changeLabel(c: StaleChange): string {
  const names: Record<string, string> = {
    model: t('create.stale.names.model'),
    area: t('create.stale.names.area'),
    plates: t('create.stale.names.plates'),
    rotation: t('create.stale.names.rotation'),
    scale: t('create.stale.names.scale'),
    maxHeight: t('create.stale.names.maxHeight'),
    preset: t('create.stale.names.preset'),
    heightMode: t('create.settings.advanced.heightMode.label'),
    heightRef: t('create.settings.advanced.heightRef.label'),
    sampling: t('create.settings.advanced.sampling.label'),
    rounding: t('create.settings.advanced.rounding.label'),
    keepSmall: t('create.settings.advanced.rounding.keepSmall'),
    cap: t('create.settings.advanced.cap.label'),
    selection: t('create.settings.advanced.selection.label'),
    rotation_mode: t('create.settings.advanced.rotation.label'),
  };
  const name = names[c.key] ?? c.key;
  if (c.from !== undefined && c.to !== undefined) {
    const unit = c.key === 'scale' ? ` ${t('common.units.metresPerStud')}` : '';
    return t('create.stale.change', { name, from: c.from, to: `${c.to}${unit}` });
  }
  return name;
}

/** Stale banner: "Out of date · You changed Scale (3 → 4 m per stud) after generating." */
export function staleBanner(p: ProjectState, busy: boolean): Raw | '' {
  const changes = staleChanges(p);
  if (!changes.length) return '';
  const list = changes.slice(0, 4).map(changeLabel).join(t('create.stale.listSeparator'));
  return html`<div class="lz-alert lz-alert--warning lz-stale" role="status">
    ${ic('warning')}
    <div class="lz-alert__body">
      <p><strong>${t('create.stale.title')}</strong> · ${t('create.stale.message', { changes: list })}</p>
      <div class="lz-cluster">
        <button
          type="button"
          class="lz-btn lz-btn--primary lz-btn--sm"
          data-stale="regenerate"
          ${attr('disabled', busy)}
        >
          ${ic('refresh', 'sm')}${t('create.stale.regenerate')}</button
        ><button type="button" class="lz-btn lz-btn--tertiary lz-btn--sm" data-stale="undo">
          ${ic('undo', 'sm')}${t('create.stale.undo')}
        </button>
      </div>
    </div>
  </div>`;
}

/**
 * The Legonizer table (1 × 2 m) seen from above, to scale (1 unit = 1 cm), with the model at one
 * end (turned when it fits that way), the free part hatched for projected media (components §22).
 */
export function tableFitSvg(
  platesX: number,
  platesY: number,
  idSuffix: string,
  opts: { labels?: boolean; large?: boolean } = {},
): Raw {
  const w = platesX * 25.6,
    d = platesY * 25.6;
  const fits = fitsTable(platesX, platesY);
  // on the table: x along the 2 m length, y across (1 m); north up means the model's Y goes up
  let mw = w,
    md = d,
    turned = false;
  if (fits && !(platesX <= 7 && platesY <= 3) && platesX <= 3 && platesY <= 7) {
    // fits only turned: lay the model's north–south along the table's length
    mw = d;
    md = w;
    turned = true;
  }
  const x0 = 3,
    y0 = (100 - Math.min(md, 100)) / 2;
  const title = fits
    ? t('create.area.tableFit.diagramAlt', { x: platesX, y: platesY })
    : t('create.area.tableFit.tooBig', { w: n(w, 0), d: n(d, 0) });
  const media =
    fits && mw + 6 < 197
      ? html`<rect
            class="media"
            x="${x0 + mw + 3}"
            y="1"
            width="${Math.max(0, 196 - (x0 + mw + 3))}"
            height="98"
          /><text x="${(x0 + mw + 199) / 2}" y="53" text-anchor="middle" class="muted"
            >${t('create.area.tableFit.mediaArea')}</text
          >`
      : '';
  let grid = '';
  if (fits) {
    for (let k = 1; k < (turned ? platesY : platesX); k++)
      grid += `M${(x0 + k * 25.6).toFixed(1)} ${y0.toFixed(1)}v${md.toFixed(1)}`;
    for (let k = 1; k < (turned ? platesX : platesY); k++)
      grid += `M${x0} ${(y0 + k * 25.6).toFixed(1)}h${mw.toFixed(1)}`;
  }
  let labels: Raw | '' = '';
  if (opts.labels && fits && !turned) {
    const items: Raw[] = [];
    for (let c = 0; c < platesX; c++)
      for (let r = 0; r < platesY; r++)
        items.push(
          html`<text x="${(x0 + c * 25.6 + 12.8).toFixed(1)}" y="${(y0 + r * 25.6 + 15).toFixed(1)}"
            >${String.fromCharCode(65 + c)}${r + 1}</text
          >`,
        );
    labels = html`<g class="plate-labels" text-anchor="middle">${items}</g>`;
  }
  const model = fits
    ? html`<rect
          class="model"
          x="${x0}"
          y="${y0.toFixed(1)}"
          width="${mw.toFixed(1)}"
          height="${md.toFixed(1)}"
        />${grid ? html`<path class="plate" d="${grid}" />` : ''}${labels}`
    : html`<rect class="model model--toobig" x="2" y="2" width="198" height="98" />`;
  return html`<figure class="lz-tablefit${opts.large ? ' lz-tablefit--large' : ''}">
      <svg viewBox="-10 -14 224 ${opts.large ? 128 : 122}" role="img" aria-labelledby="tf-title-${idSuffix}">
        <title id="tf-title-${idSuffix}">${title}</title>
        <defs>
          <pattern
            id="lz-hatch-${idSuffix}"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" class="hatch" />
          </pattern>
        </defs>
        <text x="0" y="-4" class="muted">${t('create.area.tableFit.diagramTitle')}</text>
        <rect class="table" x="0" y="0" width="200" height="100" rx="2" />
        <g style="--hatch: url(#lz-hatch-${idSuffix})">${media}</g>
        ${model}
        <g transform="translate(192 14)">
          <path d="M0 -9 4 2H-4z" class="north" />
          <text x="0" y="13" text-anchor="middle" class="north-label">N</text>
        </g>
      </svg>
    </figure>
    ${
      fits
        ? html`<p class="lz-fit">
            ${ic('check-circle')}${turned ? t('create.area.tableFit.fitsLengthwise') : t('create.area.tableFit.fits')}
          </p>`
        : html`<p class="lz-fit lz-fit--no">
            ${ic('info')}${t('create.area.tableFit.tooBig', { w: n(w, 1), d: n(d, 1) })}
          </p>`
    }`;
}

/** Integer stepper `[−] value [+]` (components §10). */
export function stepperInput(o: {
  id: string;
  value: number;
  min: number;
  max: number;
  label?: string;
  less: string;
  more: string;
  describedBy?: string;
  disabled?: boolean;
}): Raw {
  return html`<div class="lz-stepper-input">
    <button
      type="button"
      data-step-dec="${o.id}"
      aria-label="${o.less}"
      ${attr('disabled', !!o.disabled || o.value <= o.min)}
    >
      ${ic('minus', 'sm')}</button
    ><input
      id="${o.id}"
      inputmode="numeric"
      value="${o.value}"
      autocomplete="off"
      ${attr('aria-label', o.label ?? null)}${attr('aria-describedby', o.describedBy ?? null)}${attr('disabled', !!o.disabled)}
      data-min="${o.min}"
      data-max="${o.max}"
    /><button
      type="button"
      data-step-inc="${o.id}"
      aria-label="${o.more}"
      ${attr('disabled', !!o.disabled || o.value >= o.max)}
    >
      ${ic('plus', 'sm')}
    </button>
  </div>`;
}

/** Shows or clears the inline error of a field (components §10: the field keeps the typed value). */
export function setFieldError(input: HTMLInputElement, message: string | null): void {
  const errId = `${input.id}-err`;
  let err = document.getElementById(errId);
  const wrap = input.closest('.lz-field, .lz-param') ?? input.parentElement!;
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    if (!err) {
      err = document.createElement('p');
      err.className = 'lz-error';
      err.id = errId;
      wrap.append(err);
    }
    err.textContent = message;
    const ids = new Set((input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
    ids.add(errId);
    input.setAttribute('aria-describedby', [...ids].join(' '));
  } else {
    input.removeAttribute('aria-invalid');
    err?.remove();
    const ids = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((x) => x && x !== errId);
    if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
    else input.removeAttribute('aria-describedby');
  }
}

/** Sets an input's value unless the user is editing it or it shows an error. */
export function syncValue(input: HTMLInputElement | null, value: string): void {
  if (!input || document.activeElement === input || input.getAttribute('aria-invalid') === 'true') return;
  if (input.value !== value) input.value = value;
}
