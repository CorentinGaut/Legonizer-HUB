/**
 * 2D layer diagram (components.md §19, §22; the PDF draws the same): top view, north up, layers
 * below shaded, new bricks outlined with their studs, stud rulers (columns 1–32 west → east, rows
 * 1–32 north → south). The text twin of the 3D step view (N3) and the Build view in 2D mode (OI-15).
 */
import type { PlacedBrick } from '../core/types.ts';
import { BRICKS } from '../core/packing/catalog.ts';
import { esc } from '../create/dom.ts';

export function layerDiagram(
  heights: Int32Array,
  bricks: PlacedBrick[],
  layer: number,
  opts: { u?: number; label: string; highlight?: string | null; rotate?: number } = { label: '' },
): string {
  const u = opts.u ?? 11;
  const pad = 22,
    W = 32 * u;
  const rot = (((opts.rotate ?? 0) % 360) + 360) % 360;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${W + pad + 2} ${W + pad + 2}" class="lz-layer" role="img" aria-label="${esc(opts.label)}">`;
  s += `<g transform="rotate(${rot} ${W / 2} ${W / 2})">`;
  s += `<rect width="${W}" height="${W}" class="lz-layer__plate"/>`;
  // studs of the empty baseplate and layers below
  let ghost = '',
    ghostOld = '',
    studs = '';
  for (let r = 0; r < 32; r++)
    for (let c = 0; c < 32; c++) {
      const v = heights[(31 - r) * 32 + c]!;
      if (layer > 1 && v >= 1) {
        if (v >= layer - 1) ghost += `M${c * u} ${r * u}h${u}v${u}h-${u}z`;
        else ghostOld += `M${c * u} ${r * u}h${u}v${u}h-${u}z`;
      } else if (v < layer) studs += circ((c + 0.5) * u, (r + 0.5) * u, u * 0.3);
    }
  if (ghostOld) s += `<path d="${ghostOld}" class="lz-layer__below lz-layer__below--old"/>`;
  if (ghost) s += `<path d="${ghost}" class="lz-layer__below"/>`;
  if (studs) s += `<path d="${studs}" class="lz-layer__stud"/>`;
  for (const b of bricks) {
    const x = b.x * u,
      y = (32 - b.y - b.d) * u;
    const hl = opts.highlight ? (b.partId === opts.highlight ? ' is-hl' : ' is-dim') : '';
    s += `<g class="lz-layer__brick${hl}"><rect x="${x + 1}" y="${y + 1}" width="${b.w * u - 2}" height="${b.d * u - 2}" rx="1.2"/>`;
    let d = '';
    for (let i = 0; i < b.w; i++)
      for (let j = 0; j < b.d; j++) d += circ(x + (i + 0.5) * u, y + (j + 0.5) * u, u * 0.3);
    s += `<path d="${d}"/></g>`;
  }
  s += '</g><g class="lz-layer__ruler" text-anchor="middle">';
  for (let n = 1; n <= 32; n++) {
    if (n % 4 === 1)
      s += `<text x="${(n - 0.5) * u}" y="-7">${n}</text><text x="-11" y="${(n - 0.5) * u + 3}">${n}</text>`;
    s += `<path d="M${(n - 0.5) * u} -3V0M-3 ${(n - 0.5) * u}H0"/>`;
  }
  return s + '</g></svg>';
}

/** Rows of the "new bricks" table: size, north-west stud (column, row from the north), orientation. */
export function brickRows(
  bricks: PlacedBrick[],
): { partId: string; size: string; col: number; row: number; lying: 'we' | 'ns' | 'sq' }[] {
  return [...bricks]
    .sort((a, b) => b.y + b.d - (a.y + a.d) || a.x - b.x)
    .map((b) => {
      const part = BRICKS.find((p) => p.id === b.partId);
      return {
        partId: b.partId,
        size: part ? `${part.width}×${part.length}` : b.partId,
        col: b.x + 1,
        row: 32 - (b.y + b.d) + 1,
        lying: b.w === b.d ? 'sq' : b.w > b.d ? 'we' : 'ns',
      };
    });
}

function circ(cx: number, cy: number, r: number): string {
  const f = (v: number) => +v.toFixed(2);
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0z`;
}
