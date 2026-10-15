/**
 * Part labels on the page (bricks "1×2", cap tiles "1×2 tile") and the tile cap control, shared by
 * the guide views and the settings step.
 */
import { TILE_CAP_MODES, type BrickPart, type TileCapMode } from '../core/packing/catalog.ts';
import { attr, html, type Raw } from '../create/dom.ts';
import type { Ctx } from '../create/stepView.ts';
import { t } from '../shared/i18n.ts';

/** Compact size: "2×4" for a brick, "2×4 tile" for a cap tile. */
export function partSize(p: BrickPart): string {
  return p.kind === 'tile'
    ? t('common.part.tileCompact', { w: p.width, d: p.length })
    : t('common.part.sizeCompact', { w: p.width, d: p.length });
}

/** Spoken name: "2 by 4 brick" / "2 by 4 tile". */
export function partSpoken(p: BrickPart): string {
  return t(p.kind === 'tile' ? 'common.part.tileSpoken' : 'common.part.spoken', { w: p.width, d: p.length });
}

/** Written name: "2 × 4 brick" / "2 × 4 tile". */
export function partName(p: BrickPart): string {
  return t(p.kind === 'tile' ? 'common.part.tileName' : 'common.part.name', { w: p.width, d: p.length });
}

/** Smooth tile cap choice (settings step and guide part settings): one segmented control, same state. */
export function tileCapControl(current: TileCapMode, opts: { id: string; disabled?: boolean }): Raw {
  return html`<div class="lz-param">
    <span class="lz-label" id="${opts.id}-label">${t('create.settings.tileCap.label')}</span>
    <div
      class="lz-segmented"
      role="group"
      aria-labelledby="${opts.id}-label"
      aria-describedby="${opts.id}-help"
    >
      ${TILE_CAP_MODES.map(
        (m) =>
          html`<button
            type="button"
            data-tilecap="${m}"
            aria-pressed="${String(current === m)}"
            ${attr('disabled', !!opts.disabled)}
          >
            ${t(`create.settings.tileCap.${m}`)}
          </button>`,
      )}
    </div>
    <p class="lz-help" id="${opts.id}-help">${t(`create.settings.tileCap.help.${current}`)}</p>
  </div>`;
}

/** Applies a tile cap choice; with a model already generated, re-packs it (heights unchanged). */
export function setTileCap(ctx: Ctx, mode: TileCapMode): void {
  const st = ctx.store;
  if (st.p.inventory.tileCap === mode) return;
  st.set({ inventory: { ...st.p.inventory, tileCap: mode } });
  if (st.p.result) ctx.actions.scheduleRepack();
}
