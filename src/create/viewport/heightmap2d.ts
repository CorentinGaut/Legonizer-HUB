/**
 * 2D height map of the whole model (step 4 without WebGL 2, components.md §15.6): one square per
 * stud filled with the height ramp (design-system §10), plate grid and labels, north up.
 */
import type { HeightMap } from '../../core/types.ts';
import { plateName } from '../../core/packing/plates.ts';
import { esc } from '../dom.ts';

export const RAMP = [
  '#f3f9c4',
  '#d1edb8',
  '#a0dab8',
  '#6dc5be',
  '#3db2c4',
  '#2195c1',
  '#216fb0',
  '#244c9f',
  '#1f2f86',
  '#081d58',
];

export function rampStep(v: number, max: number): number {
  if (v <= 0) return 0;
  return max <= 10 ? Math.min(10, v) : Math.min(10, Math.ceil((v / max) * 10));
}

export function heightMap2dSvg(hm: HeightMap, platesY: number, label: string): string {
  const u = 6;
  const { cols, rows, data } = hm;
  let max = 0;
  for (const v of data) if (v > max) max = v;
  // one path per ramp step keeps the SVG small
  const paths: string[][] = RAMP.map(() => []);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const v = data[(rows - 1 - r) * cols + c]!;
      const s = rampStep(v, max);
      if (s) paths[s - 1]!.push(`M${c * u} ${r * u}h${u}v${u}h-${u}z`);
    }
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-18 -18 ${cols * u + 36} ${rows * u + 36}" role="img" aria-label="${esc(label)}"><rect width="${cols * u}" height="${rows * u}" style="fill:var(--lz-height-0)"/>`;
  paths.forEach((p, k) => {
    if (p.length) svg += `<path d="${p.join('')}" fill="${RAMP[k]}"/>`;
  });
  svg += `<g style="stroke:var(--lz-viz-plate-grid);stroke-width:2;fill:none"><rect width="${cols * u}" height="${rows * u}"/>`;
  for (let k = 1; k < cols / 32; k++) svg += `<path d="M${k * 32 * u} 0V${rows * u}"/>`;
  for (let k = 1; k < rows / 32; k++) svg += `<path d="M0 ${k * 32 * u}H${cols * u}"/>`;
  svg += '</g>';
  for (let col = 0; col < cols / 32; col++)
    for (let row = 0; row < platesY; row++)
      svg += `<text x="${col * 32 * u + 10}" y="${(platesY - 1 - row) * 32 * u + 28}" style="font:700 22px var(--lz-font-display);fill:var(--lz-color-accent-text);paint-order:stroke;stroke:var(--lz-color-surface);stroke-width:4px">${plateName(col, row, platesY)}</text>`;
  return svg + '</svg>';
}

/** Ramp legend items (value → colour), with ranges above 10 bricks. */
export function rampLegend(max: number): { label: string; colour: string; light: boolean }[] {
  const out = [{ label: '0', colour: 'var(--lz-height-0)', light: false }];
  const steps = Math.min(10, Math.max(1, max));
  for (let s = 1; s <= steps; s++) {
    const label =
      max <= 10 ? String(s) : `${Math.floor(((s - 1) * max) / 10) + 1}–${Math.floor((s * max) / 10)}`;
    out.push({ label, colour: RAMP[s - 1]!, light: s >= 7 });
  }
  return out;
}
