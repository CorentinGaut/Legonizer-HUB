/**
 * Brick glyphs on the page (SPEC O3: drawn to scale): one sprite of `<symbol>`s built once from the core
 * glyph geometry (the same drawing as the PDF), referenced with `<use>`.
 */
import { BRICKS, BASEPLATE, TILES } from '../core/packing/catalog.ts';
import {
  baseplateGlyph,
  brickIsoGlyph,
  brickTopGlyph,
  glyphSvgContent,
  tileIsoGlyph,
  tileTopGlyph,
  type Glyph,
} from '../core/export/glyphs.ts';

const SPRITE_ID = 'lz-glyph-sprite';
const boxes = new Map<string, Glyph['viewBox']>();

export function ensureGlyphSprite(): void {
  if (document.getElementById(SPRITE_ID)) return;
  const symbols: string[] = [];
  const add = (id: string, g: Glyph) => {
    boxes.set(id, g.viewBox);
    symbols.push(
      `<symbol id="${id}" viewBox="${g.viewBox.join(' ')}"><g class="lz-glyph__brick">${glyphSvgContent(g)}</g></symbol>`,
    );
  };
  for (const b of BRICKS) {
    add(`lz-g-${b.id}`, brickIsoGlyph(b.width, b.length));
    add(`lz-g-${b.id}-top`, brickTopGlyph(b.width, b.length));
  }
  for (const b of TILES) {
    add(`lz-g-${b.id}`, tileIsoGlyph(b.width, b.length));
    add(`lz-g-${b.id}-top`, tileTopGlyph(b.width, b.length));
  }
  add(`lz-g-${BASEPLATE.id}`, baseplateGlyph(32, 12, 1));
  const holder = document.createElement('div');
  holder.id = SPRITE_ID;
  holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${symbols.join('')}</svg>`;
  document.body.prepend(holder);
}

/** Decorative glyph markup for a part id (`top` = plan view). */
export function glyph(partId: string, opts: { top?: boolean; className?: string } = {}): string {
  ensureGlyphSprite();
  const id = `lz-g-${partId}${opts.top ? '-top' : ''}`;
  const vb = boxes.get(id);
  if (!vb) return '';
  const quarter = partId === BASEPLATE.id ? ' lz-glyph--quarter' : '';
  // The <use> gets the viewBox's origin and size: by default it would place the symbol's viewport at
  // (0, 0) of a viewBox that starts at (vb[0], vb[1]) < 0, shifting the drawing right and down.
  return `<svg class="lz-glyph${quarter}${opts.className ? ' ' + opts.className : ''}" viewBox="${vb.join(' ')}" style="--vbw:${vb[2]};--vbh:${vb[3]}" aria-hidden="true" focusable="false"><use href="#${id}" x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}"/></svg>`;
}
