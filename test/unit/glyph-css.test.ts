/**
 * The brick shelf's CSS sizes its trays from the widest and tallest glyph (the 2×8 brick, in stud
 * units): those constants must follow the glyph geometry, or glyphs spill out of their trays.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRICKS } from '../../src/core/packing/catalog.ts';
import { GLYPH_UNIT, brickIsoGlyph } from '../../src/core/export/glyphs.ts';

const css = readFileSync('src/styles/components.css', 'utf8');

describe('brick shelf CSS and glyph geometry', () => {
  const boxes = BRICKS.map((b) => brickIsoGlyph(b.width, b.length).viewBox);
  const widest = Math.max(...boxes.map((v) => v[2])) / GLYPH_UNIT;
  const tallest = Math.max(...boxes.map((v) => v[3])) / GLYPH_UNIT;

  it('trays are at least as wide as the widest glyph', () => {
    const m = /--lz-tray-min: calc\(([\d.]+) \* var\(--lz-glyph-unit\)/.exec(css);
    expect(m, '--lz-tray-min in components.css').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(widest);
    expect(Number(m![1]) - widest).toBeLessThan(0.05);
  });

  it('the glyph area is at least as tall as the tallest glyph', () => {
    const m = /\.lz-slot__glyph \{[^}]*min-height: calc\(([\d.]+) \* var\(--lz-glyph-unit\)/.exec(css);
    expect(m, '.lz-slot__glyph min-height in components.css').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(tallest);
    expect(Number(m![1]) - tallest).toBeLessThan(0.05);
  });
});
