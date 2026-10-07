/**
 * Brick glyphs (docs/ui/components.md §16): one isometric line-art glyph per catalog part, drawn at
 * the same stud size everywhere (shelf, step callout, plate pass, PDF), plus the plan (top-view)
 * glyph. TypeScript port of the UI reference generator `docs/ui/brick-glyphs/generate-glyphs.mjs`,
 * so the web page and the PDF draw the very same geometry.
 *
 * Geometry in stud pitches (1 pitch = 8 mm): brick height 1.2, stud radius 0.3, stud height 0.2,
 * baseplate thickness 0.2. True isometric projection, u px per stud (12 at native size):
 *   sx = (x − y)·cos30°·u,  sy = (x + y)·sin30°·u − z·u   (x = length → lower right, y = width → lower left)
 *
 * DOM-free: returns primitives (SVG path strings with a fill role) and SVG markup strings.
 */

export const GLYPH_UNIT = 12;
const C = Math.cos(Math.PI / 6);
const S = 0.5;
const H = 1.2;
const STUD_R = 0.3;
const STUD_H = 0.2;
const PLATE_T = 0.2;
const PAD = 1.5;

export type GlyphFill =
  'top' | 'left' | 'right' | 'studSide' | 'plateTop' | 'plateSide' | 'plateStud' | 'none';

/** One drawing primitive: an SVG path (absolute commands, y down) with a fill role and an edge stroke width. */
export interface GlyphPrim {
  d: string;
  fill: GlyphFill;
  stroke: number;
}

export interface Glyph {
  /** viewBox: x, y, width, height in px at `GLYPH_UNIT` px per stud. */
  viewBox: [number, number, number, number];
  prims: GlyphPrim[];
}

/** CSS fills with light-theme fallbacks (the tokens re-map them for states and themes). */
export const GLYPH_CSS_FILL: Record<GlyphFill, string> = {
  top: 'var(--lz-brick-top, #ffffff)',
  left: 'var(--lz-brick-left, #e7e5df)',
  right: 'var(--lz-brick-right, #d3d0c8)',
  studSide: 'var(--lz-brick-stud-side, #e2e0d9)',
  plateTop: 'var(--lz-baseplate-top, #a9abaf)',
  plateSide: 'var(--lz-baseplate-side, #8e9094)',
  plateStud: 'var(--lz-baseplate-stud, #b9bbbf)',
  none: 'none',
};

/** Print colours (light theme, design-system §2.5). */
export const GLYPH_PRINT_FILL: Record<GlyphFill, [number, number, number] | null> = {
  top: [0xff, 0xff, 0xff],
  left: [0xe7, 0xe5, 0xdf],
  right: [0xd3, 0xd0, 0xc8],
  studSide: [0xe2, 0xe0, 0xd9],
  plateTop: [0xa9, 0xab, 0xaf],
  plateSide: [0x8e, 0x90, 0x94],
  plateStud: [0xb9, 0xbb, 0xbf],
  none: null,
};
export const GLYPH_EDGE: [number, number, number] = [0x2b, 0x2c, 0x31];

const f = (n: number) => +n.toFixed(2);
const P = (x: number, y: number, z: number, u: number): [number, number] => [
  (x - y) * C * u,
  (x + y) * S * u - z * u,
];
const poly = (ps: [number, number][]) => 'M' + ps.map(([a, b]) => `${f(a)},${f(b)}`).join('L') + 'Z';

/** Ellipse as an SVG path (two arcs). */
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${f(cx - rx)},${f(cy)}A${f(rx)},${f(ry)} 0 1 0 ${f(cx + rx)},${f(cy)}A${f(rx)},${f(ry)} 0 1 0 ${f(cx - rx)},${f(cy)}Z`;
}

function stud(
  cx: number,
  cy: number,
  z: number,
  u: number,
  top: GlyphFill,
  side: GlyphFill,
  w = 1,
): GlyphPrim[] {
  const [sx, sy] = P(cx, cy, z, u);
  const a = STUD_R * Math.SQRT2 * C * u;
  const b = STUD_R * Math.SQRT2 * S * u;
  const yt = sy - STUD_H * u;
  return [
    {
      d: `M${f(sx - a)},${f(yt)}V${f(sy)}A${f(a)},${f(b)} 0 0 0 ${f(sx + a)},${f(sy)}V${f(yt)}Z`,
      fill: side,
      stroke: w,
    },
    { d: ellipsePath(sx, yt, a, b), fill: top, stroke: w },
  ];
}

function box(
  W: number,
  L: number,
  h: number,
  u: number,
  fills: { top: GlyphFill; left: GlyphFill; right: GlyphFill },
  z0 = 0,
): GlyphPrim[] {
  const zt = z0 + h;
  const p = (x: number, y: number, z: number) => P(x, y, z, u);
  return [
    { d: poly([p(0, W, zt), p(L, W, zt), p(L, W, z0), p(0, W, z0)]), fill: fills.left, stroke: 1 },
    { d: poly([p(L, 0, zt), p(L, W, zt), p(L, W, z0), p(L, 0, z0)]), fill: fills.right, stroke: 1 },
    { d: poly([p(0, 0, zt), p(L, 0, zt), p(L, W, zt), p(0, W, zt)]), fill: fills.top, stroke: 1 },
    {
      d: poly([p(0, 0, zt), p(L, 0, zt), p(L, 0, z0), p(L, W, z0), p(0, W, z0), p(0, W, zt)]),
      fill: 'none',
      stroke: 1.5,
    },
  ];
}

/** Isometric brick glyph, W studs wide (short side), L studs long. */
export function brickIsoGlyph(W: number, L: number, u = GLYPH_UNIT): Glyph {
  const minX = -W * C * u - PAD;
  const maxX = L * C * u + PAD;
  const backY = P(0.5, 0.5, H, u)[1] - STUD_H * u - STUD_R * Math.SQRT2 * S * u;
  const minY = Math.min(P(0, 0, H, u)[1], backY) - PAD;
  const maxY = P(L, W, 0, u)[1] + PAD;
  const prims = box(W, L, H, u, { top: 'top', left: 'left', right: 'right' });
  const order: [number, number][] = [];
  for (let i = 0; i < L; i++) for (let j = 0; j < W; j++) order.push([i, j]);
  order.sort((p, q) => p[0] + p[1] - (q[0] + q[1]) || p[1] - q[1]);
  for (const [i, j] of order) prims.push(...stud(i + 0.5, j + 0.5, H, u, 'top', 'studSide'));
  return { viewBox: [f(minX), f(minY), f(maxX - minX), f(maxY - minY)], prims };
}

/** Plan (top view) glyph: L studs along x, W along y, studs as circles. North up. */
export function brickTopGlyph(W: number, L: number, u = GLYPH_UNIT): Glyph {
  const pad = 1;
  const prims: GlyphPrim[] = [
    {
      d: `M0.25,0.25H${f(L * u - 0.25)}V${f(W * u - 0.25)}H0.25Z`,
      fill: 'top',
      stroke: 1.5,
    },
  ];
  for (let i = 0; i < L; i++)
    for (let j = 0; j < W; j++)
      prims.push({
        d: ellipsePath((i + 0.5) * u, (j + 0.5) * u, STUD_R * u, STUD_R * u),
        fill: 'studSide',
        stroke: 0.75,
      });
  return { viewBox: [-pad, -pad, L * u + 2 * pad, W * u + 2 * pad], prims };
}

/**
 * Isometric baseplate glyph. `studStep` > 1 draws one stud every `studStep` positions (the PDF uses a
 * lighter drawing at ⅛ scale; the web shelf draws all studs at ¼ scale).
 */
export function baseplateGlyph(n = 32, u = GLYPH_UNIT, studStep = 1): Glyph {
  const minX = -n * C * u - PAD;
  const maxX = n * C * u + PAD;
  const minY = P(0, 0, PLATE_T, u)[1] - STUD_H * u - PAD;
  const maxY = P(n, n, 0, u)[1] + PAD;
  const prims = box(n, n, PLATE_T, u, { top: 'plateTop', left: 'plateSide', right: 'plateSide' });
  const order: [number, number][] = [];
  for (let i = 0; i < n; i += studStep) for (let j = 0; j < n; j += studStep) order.push([i, j]);
  order.sort((p, q) => p[0] + p[1] - (q[0] + q[1]) || p[1] - q[1]);
  for (const [i, j] of order)
    prims.push(...stud(i + 0.5, j + 0.5, PLATE_T, u, 'plateStud', 'plateSide', 0.5));
  return { viewBox: [f(minX), f(minY), f(maxX - minX), f(maxY - minY)], prims };
}

/** SVG markup of a glyph's content (to put inside an `<svg>` or a `<symbol>`). */
export function glyphSvgContent(g: Glyph): string {
  return g.prims
    .map(
      (p) =>
        `<path d="${p.d}" style="fill:${GLYPH_CSS_FILL[p.fill]};stroke:var(--lz-brick-edge, #2b2c31);stroke-width:${p.stroke};stroke-linejoin:round" vector-effect="non-scaling-stroke"/>`,
    )
    .join('');
}

/** A complete standalone SVG element (decorative by default). */
export function glyphSvg(g: Glyph, opts: { className?: string; title?: string } = {}): string {
  const [x, y, w, h] = g.viewBox;
  const a11y = opts.title ? `role="img" aria-label="${opts.title}"` : 'aria-hidden="true" focusable="false"';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" class="lz-glyph${opts.className ? ' ' + opts.className : ''}" ` +
    `style="--vbw:${w};--vbh:${h}" ${a11y}>${opts.title ? `<title>${opts.title}</title>` : ''}<g class="lz-glyph__brick">${glyphSvgContent(g)}</g></svg>`
  );
}
