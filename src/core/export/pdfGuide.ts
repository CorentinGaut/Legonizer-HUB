/**
 * Printable build guide (SPEC O5, ux-spec §8.6, docs/ui/print.css + mockups/pdf-page.html), generated
 * in the engine Worker with pdf-lib (MIT, pure JavaScript: runs in Workers and in Node tests).
 *
 * Pages: cover with the plate map → shopping list (the shelf on paper, kit per plate) → per plate an
 * opener (position, 32 × 32 height grid with the number in every stud, kit, plate-pass QR) and the
 * layer diagrams four per page (layers below shaded, new bricks outlined, stud rulers, "this step")
 * → projection layer → plate passes four per page (O10) → technical appendix. Every page carries a
 * running header and the footer "Part-Dieu · Plate B2 · Layer 3 of 9 · page 12 of 46".
 *
 * Fonts: the 14 standard PDF fonts (Helvetica, Courier; WinAnsi encoding). Embedding IBM Plex /
 * Bricolage (UI-11) would need @pdf-lib/fontkit, not a dependency yet; text is mapped to WinAnsi
 * (`pdfSafe`). Everything printed derives from the packing result and the heights (no algorithmic
 * decision here), so the PDF says the same numbers as the shelf, BrickLink list and 3D steps.
 */
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { IntlMessageFormat } from 'intl-messageformat';
import qrcodeCore from 'qrcode/lib/core/qrcode.js';
import { BASEPLATE, BRICKS } from '../packing/catalog.ts';
import type { PackingResult, PlateSummary } from '../packing/pack.ts';
import { parsePlateName, columnLetters } from '../packing/plates.ts';
import { STUDS_PER_PLATE, type Area, type HeightMap, type Params, type PlacedBrick } from '../types.ts';
import { APP_VERSION, HEIGHTMAP_ALGORITHM_VERSION, PACKING_ALGORITHM_VERSION } from '../version.ts';
import { EngineError } from '../util/errors.ts';
import type { ProgressFn } from '../util/progress.ts';
import { encodeJpeg } from './jpeg.ts';
import { physicalCalqueLayout, rasterizeCalque } from './calque.ts';
import { plateHeights } from './guide.ts';
import { encodePlatePass, platePassUrl, qrVersionFor } from './platePass.ts';
import { GLYPH_EDGE, GLYPH_PRINT_FILL, baseplateGlyph, brickIsoGlyph, type Glyph } from './glyphs.ts';
import {
  ALL_SECTIONS,
  KIT_ROWS_FIRST_PAGE,
  KIT_ROWS_PER_PAGE,
  LAYERS_PER_PAGE,
  PAPER_MM,
  PASSES_PER_PAGE,
  type PaperSize,
  type PdfSections,
} from './pdfPlan.ts';

export interface PdfGuideInput {
  title: string;
  heightMap: HeightMap;
  packing: PackingResult;
  params: Params;
  area: Area;
  inventory: { enabled: string[]; maxLength: number };
  paper: PaperSize;
  sections?: Partial<PdfSections>;
  /** Raw ICU messages by dotted key (see PDF_MESSAGE_KEYS) and their locale. */
  messages: Record<string, string>;
  locale: string;
  /** ISO date printed on the cover and passes (pass it for reproducible files). */
  date: string;
  /** Localized preset name ("Legacy (UD-Viz 4.6.1)", …). */
  presetName: string;
  /** Localized labels of the options that differ from legacy. */
  differences: string[];
  /** Plate pass URL base (`…/create.html`); passes have no QR without it. */
  passBaseUrl?: string;
  /** QR threshold: largest QR version still printed (UI-8: 15 at ECC M = 412 bytes). */
  maxQrVersion?: number;
  inputs?: { path: string; size: number; sha256: string }[];
  /** CRS name for the appendix (e.g. EPSG:3946). */
  crs?: string;
  spares?: number;
  signal?: AbortSignal;
  progress?: ProgressFn;
}

const MM = 72 / 25.4;
const INK = rgb(0x1b / 255, 0x1c / 255, 0x20 / 255);
const MUTED = rgb(0x55 / 255, 0x57 / 255, 0x5e / 255);
const RULE = rgb(0xc9 / 255, 0xc7 / 255, 0xc1 / 255);
const FILL = rgb(0xef / 255, 0xed / 255, 0xe7 / 255);
const WHITE = rgb(1, 1, 1);
const GHOST = hex('#d9d7d0');
const NEW_TOP = hex('#dfe2ff');
const NEW_EDGE = hex('#222a88');
const STUD_RING = hex('#dad7cf');
const RAMP = [
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
].map(hex);

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Height ramp step (design-system §10): bricks when the tallest column is ≤ 10, else 10 classes. */
export function rampStep(v: number, max: number): number {
  if (v <= 0) return 0;
  return max <= 10 ? Math.min(10, v) : Math.min(10, Math.ceil((v / max) * 10));
}

const REPLACE: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '↑': '^',
  '↓': 'v',
  '⅛': '1/8',
  '✓': 'v',
  '−': '-',
  '‑': '-',
  '‐': '-',
  ' ': ' ',
  ' ': ' ',
  '≤': '<=',
  '≥': '>=',
  '­': '',
};

/** Maps text to what the standard fonts can encode (WinAnsi). */
export function pdfSafe(font: PDFFont, s: string, cache: Map<PDFFont, Set<number>>): string {
  let set = cache.get(font);
  if (!set) cache.set(font, (set = new Set(font.getCharacterSet())));
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (set.has(cp)) out += ch;
    else if (REPLACE[ch] !== undefined) out += REPLACE[ch];
    else if (ch === '\n' || ch === '\t') out += ' ';
    else
      out += ch
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\x20-\x7e]/g, '?');
  }
  return out;
}

interface Ctx {
  doc: PDFDocument;
  W: number;
  H: number;
  sans: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
  cache: Map<PDFFont, Set<number>>;
  m: (key: string, params?: Record<string, unknown>) => string;
  num: (n: number, digits?: number) => string;
}

type Align = 'left' | 'right' | 'center';

function text(
  c: Ctx,
  page: PDFPage,
  s: string,
  xMm: number,
  baselineMm: number,
  size: number,
  opts: { font?: PDFFont; color?: RGB; align?: Align; maxWidthMm?: number } = {},
): number {
  const font = opts.font ?? c.sans;
  let str = pdfSafe(font, s, c.cache);
  let width = font.widthOfTextAtSize(str, size);
  if (opts.maxWidthMm && width > opts.maxWidthMm * MM) {
    while (str.length > 1 && font.widthOfTextAtSize(str + '...', size) > opts.maxWidthMm * MM)
      str = str.slice(0, -1);
    str += '...';
    width = font.widthOfTextAtSize(str, size);
  }
  let x = xMm * MM;
  if (opts.align === 'right') x -= width;
  else if (opts.align === 'center') x -= width / 2;
  page.drawText(str, { x, y: c.H - baselineMm * MM, size, font, color: opts.color ?? INK });
  return width / MM;
}

function wrap(c: Ctx, s: string, font: PDFFont, size: number, widthMm: number): string[] {
  const words = pdfSafe(font, s, c.cache).split(/ +/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= widthMm * MM || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Wrapped paragraph; returns the y (mm) below it. */
function para(
  c: Ctx,
  page: PDFPage,
  s: string,
  xMm: number,
  topMm: number,
  widthMm: number,
  size: number,
  opts: { font?: PDFFont; color?: RGB; leading?: number } = {},
): number {
  const font = opts.font ?? c.sans;
  const lead = (size * (opts.leading ?? 1.35)) / MM;
  let y = topMm + size / MM;
  for (const line of wrap(c, s, font, size, widthMm)) {
    page.drawText(line, { x: xMm * MM, y: c.H - y * MM, size, font, color: opts.color ?? INK });
    y += lead;
  }
  return y - lead + (size * 0.4) / MM;
}

function rect(
  c: Ctx,
  page: PDFPage,
  xMm: number,
  yMm: number,
  wMm: number,
  hMm: number,
  o: { fill?: RGB; stroke?: RGB; width?: number; dash?: number[]; opacity?: number } = {},
) {
  page.drawRectangle({
    x: xMm * MM,
    y: c.H - (yMm + hMm) * MM,
    width: wMm * MM,
    height: hMm * MM,
    ...(o.fill ? { color: o.fill } : {}),
    ...(o.stroke ? { borderColor: o.stroke, borderWidth: o.width ?? 0.5 } : {}),
    ...(o.dash ? { borderDashArray: o.dash } : {}),
    ...(o.opacity !== undefined ? { opacity: o.opacity } : {}),
  });
}

function hline(
  c: Ctx,
  page: PDFPage,
  x0: number,
  x1: number,
  y: number,
  color: RGB,
  width: number,
  dash?: number[],
) {
  page.drawLine({
    start: { x: x0 * MM, y: c.H - y * MM },
    end: { x: x1 * MM, y: c.H - y * MM },
    thickness: width,
    color,
    ...(dash ? { dashArray: dash } : {}),
  });
}

function vline(
  c: Ctx,
  page: PDFPage,
  x: number,
  y0: number,
  y1: number,
  color: RGB,
  width: number,
  dash?: number[],
) {
  page.drawLine({
    start: { x: x * MM, y: c.H - y0 * MM },
    end: { x: x * MM, y: c.H - y1 * MM },
    thickness: width,
    color,
    ...(dash ? { dashArray: dash } : {}),
  });
}

/** Draws a glyph with its top-left corner at (x, y) mm, `unitMm` per stud. Returns its size in mm. */
function drawGlyph(
  c: Ctx,
  page: PDFPage,
  g: Glyph,
  xMm: number,
  yMm: number,
  unitMm: number,
): [number, number] {
  const [vx, vy, vw, vh] = g.viewBox;
  const scale = (unitMm * MM) / 12;
  for (const p of g.prims) {
    const fill = GLYPH_PRINT_FILL[p.fill];
    page.drawSvgPath(p.d, {
      x: xMm * MM - vx * scale,
      y: c.H - yMm * MM + vy * scale,
      scale,
      ...(fill ? { color: rgb(fill[0] / 255, fill[1] / 255, fill[2] / 255) } : {}),
      borderColor: rgb(GLYPH_EDGE[0] / 255, GLYPH_EDGE[1] / 255, GLYPH_EDGE[2] / 255),
      borderWidth: (p.stroke * 0.45) / scale,
    });
  }
  return [(vw * unitMm) / 12, (vh * unitMm) / 12];
}

/** QR code (ISO/IEC 18004, ECC M) drawn as merged module runs; quiet zone of 4 modules. */
function drawQr(c: Ctx, page: PDFPage, url: string, xMm: number, yMm: number, sizeMm: number): number {
  const q = qrcodeCore.create(url, { errorCorrectionLevel: 'M' });
  const n = q.modules.size;
  const mod = sizeMm / (n + 8);
  rect(c, page, xMm, yMm, sizeMm, sizeMm, { fill: WHITE });
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!q.modules.get(y, x)) {
        x++;
        continue;
      }
      let e = x;
      while (e < n && q.modules.get(y, e)) e++;
      page.drawRectangle({
        x: (xMm + (x + 4) * mod) * MM,
        y: c.H - (yMm + (y + 5) * mod) * MM,
        width: (e - x) * mod * MM + 0.05,
        height: mod * MM + 0.05,
        color: rgb(0, 0, 0),
      });
      x = e;
    }
  }
  return q.version;
}

function partSize(id: string): string {
  const p = BRICKS.find((b) => b.id === id);
  return p ? `${p.width}×${p.length}` : id;
}

/** Callout items of a step or kit: largest part first ("4 × 2×8"). */
function calloutItems(counts: Record<string, number>): { id: string; q: number }[] {
  return [...BRICKS]
    .reverse()
    .filter((b) => (counts[b.id] ?? 0) > 0)
    .map((b) => ({ id: b.id, q: counts[b.id]! }));
}

/** Inline "4 × 2×8   2 × 1×2 …" list, wrapped; returns the y below it. */
function callout(
  c: Ctx,
  page: PDFPage,
  items: { id: string; q: number }[],
  x: number,
  top: number,
  width: number,
  size = 7.5,
): number {
  let cx = x,
    y = top + size / MM;
  const gap = 3;
  for (const it of items) {
    const qs = String(it.q);
    const rest = ` × ${partSize(it.id)}`;
    const w =
      (c.monoBold.widthOfTextAtSize(qs, size) +
        c.mono.widthOfTextAtSize(pdfSafe(c.mono, rest, c.cache), size)) /
      MM;
    if (cx + w > x + width && cx > x) {
      cx = x;
      y += (size * 1.4) / MM;
    }
    text(c, page, qs, cx, y, size, { font: c.monoBold });
    text(c, page, rest, cx + c.monoBold.widthOfTextAtSize(qs, size) / MM, y, size, { font: c.mono });
    cx += w + gap;
  }
  return y + (size * 0.5) / MM;
}

/** Plate layout map: tiles with names (or blank), north arrow; the `on` tile is filled. */
function plateMap(
  c: Ctx,
  page: PDFPage,
  plates: { name: string; col: number; row: number }[],
  cols: number,
  rows: number,
  x: number,
  y: number,
  cell: number,
  o: { on?: string; names?: boolean; headers?: boolean } = {},
): [number, number] {
  const head = o.headers === false ? 0 : 5;
  const gap = Math.min(1, cell / 10);
  if (head) {
    for (let k = 0; k < cols; k++)
      text(c, page, columnLetters(k), x + head + k * (cell + gap) + cell / 2, y + 3, 6.5, {
        font: c.mono,
        color: MUTED,
        align: 'center',
      });
    for (let r = 0; r < rows; r++)
      text(c, page, String(r + 1), x + 2.5, y + head + r * (cell + gap) + cell / 2 + 1, 6.5, {
        font: c.mono,
        color: MUTED,
        align: 'center',
      });
  }
  for (const p of plates) {
    const tx = x + head + p.col * (cell + gap),
      ty = y + head + p.row * (cell + gap);
    const on = o.on === p.name;
    rect(c, page, tx, ty, cell, cell, { fill: on ? INK : WHITE, stroke: INK, width: Math.min(1, cell / 10) });
    if (o.names !== false && cell >= 6) {
      const size = Math.min(13, cell * 1.1);
      text(c, page, p.name, tx + cell / 2, ty + cell / 2 + (size * 0.35) / MM, size, {
        font: c.bold,
        color: on ? WHITE : INK,
        align: 'center',
      });
    }
  }
  return [head + cols * (cell + gap), head + rows * (cell + gap)];
}

function northArrow(c: Ctx, page: PDFPage, x: number, y: number) {
  page.drawSvgPath('M7 0 14 18 7 13 0 18z', { x: x * MM, y: c.H - y * MM, scale: 0.7, color: INK });
  text(c, page, 'N', x + 2.5, y + (18 * 0.7) / MM + 3.2, 8, { font: c.bold, align: 'center' });
}

/** Renders the PDF build guide. */
export async function renderPdfGuide(input: PdfGuideInput): Promise<Uint8Array> {
  const sections: PdfSections = { ...ALL_SECTIONS, ...(input.sections ?? {}) };
  const [wMm, hMm] = PAPER_MM[input.paper];
  const doc = await PDFDocument.create();
  const date = new Date(input.date);
  doc.setTitle(`${input.title} - Legonizer build guide`);
  doc.setAuthor('Legonizer');
  doc.setCreator(`Legonizer ${APP_VERSION}`);
  doc.setProducer('Legonizer (pdf-lib)');
  doc.setLanguage(input.locale);
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  const fmtCache = new Map<string, IntlMessageFormat>();
  const m = (key: string, params: Record<string, unknown> = {}) => {
    const msg = input.messages[key];
    if (msg === undefined) return key;
    let f = fmtCache.get(key);
    if (!f) fmtCache.set(key, (f = new IntlMessageFormat(msg, input.locale)));
    const out = f.format(params as Record<string, string | number>);
    return Array.isArray(out) ? out.join('') : String(out);
  };
  const nf = new Map<number, Intl.NumberFormat>();
  const num = (n: number, digits = 0) => {
    let f = nf.get(digits);
    if (!f) nf.set(digits, (f = new Intl.NumberFormat(input.locale, { maximumFractionDigits: digits })));
    return f.format(n);
  };
  const c: Ctx = {
    doc,
    W: wMm * MM,
    H: hMm * MM,
    sans: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
    monoBold: await doc.embedFont(StandardFonts.CourierBold),
    cache: new Map(),
    m,
    num,
  };

  const { packing, heightMap: hm, params } = input;
  const platesX = params.platesX,
    platesY = params.platesY;
  const plateList = packing.plates.map((p) => ({ name: p.plate, col: p.col, row: platesY - 1 - p.southRow }));
  const maxH = packing.plates.reduce((a, p) => Math.max(a, p.layers), 0);
  const bricksByPlateLayer = new Map<string, PlacedBrick[]>();
  for (const b of packing.bricks) {
    const k = `${b.plate}:${b.layer}`;
    let l = bricksByPlateLayer.get(k);
    if (!l) bricksByPlateLayer.set(k, (l = []));
    l.push(b);
  }
  const X0 = 14,
    X1 = wMm - 14,
    TOP = 13,
    BOTTOM = hMm - 14;
  const CW = X1 - X0;
  const bodyTop = TOP + 9;
  const kinds = BRICKS.filter((b) => (packing.counts[b.id] ?? 0) > 0).length;
  const dateText = new Intl.DateTimeFormat(input.locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  const dateShort = new Intl.DateTimeFormat(input.locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
  const sizeW = (platesX * STUDS_PER_PLATE * 8) / 10,
    sizeD = (platesY * STUDS_PER_PLATE * 8) / 10;
  const tallestCm = (maxH * 9.6) / 10;

  const passInfo = new Map<string, { url: string | null; version: number | null }>();
  const passFor = (plate: PlateSummary) => {
    let info = passInfo.get(plate.plate);
    if (!info) {
      if (!input.passBaseUrl) info = { url: null, version: null };
      else {
        const payload = encodePlatePass({
          plate: plate.plate,
          heights: plateHeights(hm, plate.col, plate.southRow),
          inventory: input.inventory,
          title: input.title,
        });
        const url = platePassUrl(input.passBaseUrl, plate.plate, payload);
        const version = qrVersionFor(new TextEncoder().encode(url).length, 'M');
        info =
          version !== null && version <= (input.maxQrVersion ?? 15)
            ? { url, version }
            : { url: null, version };
      }
      passInfo.set(plate.plate, info);
    }
    return info;
  };

  // ---------------------------------------------------------------- page plan
  interface Planned {
    head: string;
    foot: string;
    draw: (page: PDFPage) => void;
  }
  const plan: Planned[] = [];
  const projectName = input.title;

  if (sections.cover)
    plan.push({
      head: m('exports.pdf.title'),
      foot: m('exports.pdf.sections.cover'),
      draw: (p) => drawCover(p),
    });
  if (sections.shopping) {
    const n = plateList.length;
    const extra = Math.max(0, Math.ceil((n - KIT_ROWS_FIRST_PAGE) / KIT_ROWS_PER_PAGE));
    plan.push({
      head: m('exports.pdf.sections.shopping'),
      foot: m('exports.pdf.sections.shopping'),
      draw: (p) => drawShopping(p),
    });
    for (let k = 0; k < extra; k++) {
      const from = KIT_ROWS_FIRST_PAGE + k * KIT_ROWS_PER_PAGE;
      plan.push({
        head: m('exports.pdf.kitPerPlate'),
        foot: m('exports.pdf.sections.shopping'),
        draw: (p) => kitTable(p, bodyTop, from, Math.min(n, from + KIT_ROWS_PER_PAGE), true),
      });
    }
  }
  for (const plate of packing.plates) {
    if (sections.plates)
      plan.push({
        head: `${m('common.plate.name', { plate: plate.plate })} · ${m('exports.pdf.plateSummary', { layers: plate.layers, bricks: plate.bricks })}`,
        foot: m('common.plate.name', { plate: plate.plate }),
        draw: (p) => drawPlateOpener(p, plate),
      });
    if (sections.layers)
      for (let k = 1; k <= plate.layers; k += LAYERS_PER_PAGE) {
        const last = Math.min(plate.layers, k + LAYERS_PER_PAGE - 1);
        const range = m('exports.pdf.layersRange', { from: k, to: last, total: plate.layers });
        plan.push({
          head: `${m('common.plate.name', { plate: plate.plate })} · ${range}`,
          foot: `${m('common.plate.name', { plate: plate.plate })} · ${range}`,
          draw: (p) => drawLayers(p, plate, k, last),
        });
      }
  }
  if (sections.projection)
    plan.push({
      head: m('exports.pdf.sections.projection'),
      foot: m('exports.pdf.sections.projection'),
      draw: (p) => drawProjection(p),
    });
  if (sections.passes)
    for (let k = 0; k < packing.plates.length; k += PASSES_PER_PAGE)
      plan.push({
        head: `${m('exports.pdf.sections.passes')} · ${m('exports.pass.cut')}`,
        foot: m('exports.pdf.sections.passes'),
        draw: (p) => drawPasses(p, packing.plates.slice(k, k + PASSES_PER_PAGE)),
      });
  if (sections.cover)
    plan.push({
      head: m('exports.pdf.sections.appendix'),
      foot: m('exports.pdf.sections.appendix'),
      draw: (p) => drawAppendix(p),
    });
  if (!plan.length) throw new EngineError('invalid-params', 'No PDF section selected');

  // projection layer image (modern outline + plate grid + labels, ~1600 px long side, JPEG)
  let calque: { img: PDFImage; layout: ReturnType<typeof physicalCalqueLayout> } | null = null;
  if (sections.projection) {
    const longPlates = Math.max(platesX, platesY);
    const dpi = Math.max(10, Math.min(150, (1600 / (longPlates * 32)) * (25.4 / 8)));
    const layout = physicalCalqueLayout(hm, dpi);
    const raster = rasterizeCalque(hm, layout, { plateGrid: true, labels: true });
    calque = {
      img: await doc.embedJpg(encodeJpeg(raster, layout.width, layout.height, { quality: 85 })),
      layout,
    };
  }

  // ---------------------------------------------------------------- render
  for (let i = 0; i < plan.length; i++) {
    if (input.signal?.aborted) throw new EngineError('cancelled', 'Operation cancelled');
    const pl = plan[i]!;
    const page = doc.addPage([c.W, c.H]);
    // running header
    text(c, page, i === 0 && sections.cover ? 'Legonizer' : projectName, X0, TOP + 3, 9, {
      font: c.bold,
      maxWidthMm: CW / 2,
    });
    text(c, page, pl.head, X1, TOP + 3, 7.5, { color: MUTED, align: 'right', maxWidthMm: CW / 2 });
    hline(c, page, X0, X1, TOP + 5, INK, 0.85);
    // footer
    hline(c, page, X0, X1, BOTTOM - 4, RULE, 0.6);
    text(c, page, m('exports.pdf.pageFooter', { project: projectName, section: pl.foot }), X0, BOTTOM, 7, {
      font: c.mono,
      color: MUTED,
      maxWidthMm: CW - 30,
    });
    text(c, page, m('exports.pdf.pageNumber', { page: i + 1, pages: plan.length }), X1, BOTTOM, 7, {
      font: c.mono,
      color: MUTED,
      align: 'right',
    });
    pl.draw(page);
    input.progress?.('pdf', (i + 1) / plan.length, `${i + 1}/${plan.length}`);
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
  if (input.signal?.aborted) throw new EngineError('cancelled', 'Operation cancelled');
  return doc.save({ useObjectStreams: true });

  // ================================================================= sections
  function drawCover(page: PDFPage) {
    let y = bodyTop + 4;
    text(c, page, m('exports.pdf.title').toUpperCase(), X0, y, 7, { font: c.bold, color: MUTED });
    y += 13;
    text(c, page, projectName, X0, y, 30, { font: c.bold, maxWidthMm: CW });
    y += 7;
    text(
      c,
      page,
      m('exports.pdf.cover.settings', {
        preset: input.presetName,
        scale: num(params.scale, 2),
        n: num(params.scale / 0.008),
      }),
      X0,
      y,
      8.5,
      {
        color: MUTED,
        maxWidthMm: CW,
      },
    );
    y += 10;
    // plate map + facts
    text(c, page, m('exports.pdf.cover.plateMap'), X0, y, 10.5, { font: c.bold });
    text(
      c,
      page,
      m('exports.pdf.cover.mapHint'),
      X0 + 2 + c.bold.widthOfTextAtSize(pdfSafe(c.bold, m('exports.pdf.cover.plateMap'), c.cache), 10.5) / MM,
      y,
      8,
      {
        color: MUTED,
      },
    );
    y += 3;
    const mapW = Math.min(85, CW * 0.48);
    const cell = Math.min(25, (mapW - 5) / platesX - 1, 70 / platesY);
    const [mw, mh] = plateMap(c, page, plateList, platesX, platesY, X0, y, cell);
    northArrow(c, page, X0 + mw + 3, y + 5);
    const noteY = para(c, page, m('exports.pdf.cover.plateMapNote'), X0, y + mh + 2, mapW, 8, {
      color: MUTED,
    });
    // facts box
    const fx = X0 + Math.max(mw + 16, mapW + 6),
      fw = X1 - fx;
    const facts: [string, string][] = [
      [
        m('exports.pdf.cover.facts.onTable'),
        m('exports.pdf.cover.facts.onTableValue', {
          w: num(sizeW, 1),
          d: num(sizeD, 1),
          h: num(tallestCm, 1),
        }),
      ],
      [
        m('exports.pdf.cover.facts.onGround'),
        m('exports.pdf.cover.facts.onGroundValue', {
          w: num(platesX * 32 * params.scale),
          d: num(platesY * 32 * params.scale),
        }),
      ],
      [
        m('exports.pdf.cover.facts.scale'),
        m('exports.pdf.cover.facts.scaleValue', { s: num(params.scale, 2), n: num(params.scale / 0.008) }),
      ],
      [m('exports.pdf.cover.facts.preset'), input.presetName],
      ...(input.differences.length
        ? [[m('exports.pdf.cover.facts.differs'), input.differences.join(', ')] as [string, string]]
        : []),
      [
        m('exports.pdf.cover.facts.bricks'),
        m('create.guide.bricks.total', {
          bricks: num(packing.total),
          kinds,
          plates: num(packing.baseplates.quantity),
        }),
      ],
      [
        m('exports.pdf.cover.facts.tallest'),
        m('exports.pdf.cover.facts.tallestValue', { bricks: maxH, cm: num(tallestCm, 1) }),
      ],
    ];
    let fy = y + 4;
    const labelW = 30;
    const boxTop = y - 1;
    for (const [k, v] of facts) {
      text(c, page, k, fx + 4, fy + 3, 8, { color: MUTED, maxWidthMm: labelW - 2 });
      fy = para(c, page, v, fx + 4 + labelW, fy, fw - labelW - 8, 8.5) + 1.2;
    }
    rect(c, page, fx, boxTop, fw, fy - boxTop + 2, { stroke: RULE, width: 0.7 });
    y = Math.max(noteY, fy + 2) + 8;
    // how to use
    const steps = [1, 2, 3, 4, 5].map((k) => m(`exports.pdf.cover.howTo${k}`));
    const boxH = 12 + steps.length * 6;
    rect(c, page, X0, y, CW, boxH, { fill: FILL });
    text(c, page, m('exports.pdf.cover.howToTitle'), X0 + 4, y + 7, 10.5, { font: c.bold });
    steps.forEach((s, k) => {
      text(c, page, `${k + 1}.`, X0 + 5, y + 14 + k * 6, 9.5, { font: c.monoBold });
      text(c, page, s, X0 + 11, y + 14 + k * 6, 9.5, { maxWidthMm: CW - 16 });
    });
    // made with
    para(
      c,
      page,
      m('exports.pdf.cover.madeWith', { version: APP_VERSION, date: dateText }),
      X0,
      BOTTOM - 16,
      CW,
      8,
      { color: MUTED },
    );
    para(c, page, m('exports.pdf.cover.accessibleVersion'), X0, BOTTOM - 11.5, CW, 8, { color: MUTED });
  }

  function drawShopping(page: PDFPage) {
    let y = bodyTop + 4;
    text(c, page, m('exports.pdf.sections.shopping').toUpperCase(), X0, y, 7, { font: c.bold, color: MUTED });
    y += 8;
    text(
      c,
      page,
      m('create.guide.bricks.total', {
        bricks: num(packing.total),
        kinds,
        plates: num(packing.baseplates.quantity),
      }),
      X0,
      y,
      16,
      {
        font: c.bold,
        maxWidthMm: CW * 0.62,
      },
    );
    const noteBottom = para(c, page, m('exports.pdf.white'), X0 + CW * 0.64, y - 7, CW * 0.36, 7.5, {
      color: MUTED,
    });
    para(c, page, m('exports.pdf.tickTray'), X0 + CW * 0.64, noteBottom + 0.5, CW * 0.36, 7.5, {
      color: MUTED,
    });
    y += 6;
    const spares = input.spares ?? 0;
    const row = (
      label: string,
      items: { glyph: Glyph; unit: number; qty: number; size: string; part: string; note?: string }[],
    ) => {
      text(c, page, label.toUpperCase(), X0, y + 2, 7, { font: c.bold, color: MUTED });
      y += 4;
      const slotW = (CW - 5 * 2) / 6;
      const slotH = 34;
      items.forEach((it, k) => {
        const sx = X0 + k * (slotW + 2);
        rect(c, page, sx, y, slotW, slotH, { stroke: RULE, width: 0.7 });
        const [gw, gh] = [(it.glyph.viewBox[2] * it.unit) / 12, (it.glyph.viewBox[3] * it.unit) / 12];
        drawGlyph(c, page, it.glyph, sx + (slotW - gw) / 2, y + 17 - gh, it.unit);
        hline(c, page, sx + 2, sx + slotW - 2, y + 18.5, RULE, 1.1);
        rect(c, page, sx + 2.5, y + 21, 3.2, 3.2, { stroke: INK, width: 0.8 });
        const buy = spares ? Math.ceil(it.qty * (1 + spares / 100)) : it.qty;
        text(c, page, `×${num(buy)}`, sx + 7, y + 24, 12, { font: c.monoBold });
        text(c, page, it.size, sx + 2.5, y + 28.3, 8.5, { font: c.bold, maxWidthMm: slotW - 4 });
        text(c, page, it.note ?? it.part, sx + 2.5, y + 31.8, 6.5, {
          font: c.mono,
          color: MUTED,
          maxWidthMm: slotW - 4,
        });
      });
      y += slotH + 4;
    };
    const glyphItem = (w: number, l: number, id: string) => ({
      glyph: brickIsoGlyph(w, l),
      unit: 2.1,
      qty: packing.counts[id] ?? 0,
      size: `${w}×${l}`,
      part: id,
      ...(spares && (packing.counts[id] ?? 0) > 0
        ? {
            note: `${id} · ${m('exports.pdf.spare', { n: Math.ceil((packing.counts[id] ?? 0) * (1 + spares / 100)) - (packing.counts[id] ?? 0) })}`,
          }
        : {}),
    });
    row(
      m('create.guide.bricks.rows.oneWide'),
      BRICKS.filter((b) => b.width === 1).map((b) => glyphItem(b.width, b.length, b.id)),
    );
    row(`${m('create.guide.bricks.rows.twoWide')} · ${m('create.guide.bricks.rows.baseplates')}`, [
      ...BRICKS.filter((b) => b.width === 2).map((b) => glyphItem(b.width, b.length, b.id)),
      {
        glyph: baseplateGlyph(32, 12, 4),
        unit: 0.26,
        qty: packing.baseplates.quantity,
        size: m('exports.pdf.baseplateName'),
        part: BASEPLATE.id,
        note: `${BASEPLATE.id} · ${m('exports.pdf.baseplateScale')}`,
      },
    ]);
    text(c, page, m('exports.pdf.kitPerPlate'), X0, y + 3, 10.5, { font: c.bold });
    text(
      c,
      page,
      m('exports.pdf.kitPerPlateNote'),
      X0 + 2 + c.bold.widthOfTextAtSize(pdfSafe(c.bold, m('exports.pdf.kitPerPlate'), c.cache), 10.5) / MM,
      y + 3,
      8,
      {
        color: MUTED,
      },
    );
    y += 5;
    y = kitTable(page, y, 0, Math.min(plateList.length, KIT_ROWS_FIRST_PAGE), false);
    para(
      c,
      page,
      m('exports.pdf.lowerBound', {
        lowerBound: num(packing.lowerBound),
        count: num(packing.total),
        percent: packing.lowerBound
          ? Math.round((100 * (packing.total - packing.lowerBound)) / packing.lowerBound)
          : 0,
      }),
      X0,
      Math.min(y + 3, BOTTOM - 14),
      CW,
      8,
      { color: MUTED },
    );
  }

  /** Kit per plate table: one row per plate, one column per part. Returns the y below it. */
  function kitTable(page: PDFPage, top: number, from: number, to: number, continued: boolean): number {
    let y = top;
    if (continued) {
      text(c, page, `${m('exports.pdf.kitPerPlate')} (${m('exports.pdf.continued')})`, X0, y + 4, 10.5, {
        font: c.bold,
      });
      y += 7;
    }
    const parts = BRICKS.slice().reverse();
    const firstW = 16;
    const colW = (CW - firstW - 16) / (parts.length + 1);
    const rowH = 4.6;
    // header
    text(c, page, m('create.guide.bricks.table.part'), X0 + 1, y + 3.4, 7, { font: c.bold, color: MUTED });
    parts.forEach((p, k) =>
      text(c, page, `${p.width}×${p.length}`, X0 + firstW + (k + 1) * colW, y + 3.4, 7, {
        font: c.bold,
        color: MUTED,
        align: 'right',
      }),
    );
    text(c, page, '32×32', X0 + firstW + (parts.length + 1) * colW, y + 3.4, 7, {
      font: c.bold,
      color: MUTED,
      align: 'right',
    });
    text(c, page, m('exports.pdf.total'), X1 - 1, y + 3.4, 7, { font: c.bold, color: MUTED, align: 'right' });
    y += rowH;
    hline(c, page, X0, X1, y, INK, 0.85);
    for (let r = from; r < to; r++) {
      const p = packing.plates[r]!;
      text(c, page, p.plate, X0 + 1, y + 3.4, 8, { font: c.bold });
      parts.forEach((part, k) =>
        text(
          c,
          page,
          p.counts[part.id] ? String(p.counts[part.id]) : '·',
          X0 + firstW + (k + 1) * colW,
          y + 3.4,
          7.5,
          {
            font: c.mono,
            color: p.counts[part.id] ? INK : MUTED,
            align: 'right',
          },
        ),
      );
      text(c, page, '1', X0 + firstW + (parts.length + 1) * colW, y + 3.4, 7.5, {
        font: c.mono,
        align: 'right',
      });
      text(c, page, num(p.bricks), X1 - 1, y + 3.4, 7.5, { font: c.monoBold, align: 'right' });
      y += rowH;
      hline(c, page, X0, X1, y, RULE, 0.5);
    }
    if (to === plateList.length) {
      hline(c, page, X0, X1, y, INK, 0.85);
      text(c, page, m('exports.pdf.total'), X0 + 1, y + 3.4, 8, { font: c.bold });
      parts.forEach((part, k) =>
        text(
          c,
          page,
          packing.counts[part.id] ? num(packing.counts[part.id]!) : '·',
          X0 + firstW + (k + 1) * colW,
          y + 3.4,
          7.5,
          {
            font: c.monoBold,
            align: 'right',
          },
        ),
      );
      text(c, page, num(packing.baseplates.quantity), X0 + firstW + (parts.length + 1) * colW, y + 3.4, 7.5, {
        font: c.monoBold,
        align: 'right',
      });
      text(c, page, num(packing.total), X1 - 1, y + 3.4, 7.5, { font: c.monoBold, align: 'right' });
      y += rowH;
    }
    return y;
  }

  function drawPlateOpener(page: PDFPage, plate: PlateSummary) {
    const { col, southRow } = parsePlateName(plate.plate, platesY);
    const heights = plateHeights(hm, col, southRow);
    let y = bodyTop + 2;
    text(c, page, m('common.plate.name', { plate: '' }).trim().toUpperCase(), X0, y + 3, 7, {
      font: c.bold,
      color: MUTED,
    });
    text(c, page, plate.plate, X0, y + 17, 40, { font: c.bold });
    // mini map + position
    const mx = X0 + 40;
    const cell = Math.min(7, 30 / Math.max(platesX, platesY));
    const [mw] = plateMap(c, page, plateList, platesX, platesY, mx, y, cell, {
      on: plate.plate,
      names: false,
    });
    para(
      c,
      page,
      m('exports.pdf.platePosition', {
        col: columnLetters(col),
        row: platesY - southRow,
        cols: platesX,
        rows: platesY,
      }),
      mx + mw + 3,
      y + 2,
      X1 - 44 - (mx + mw + 3),
      8,
      { color: MUTED },
    );
    // QR
    const info = passFor(plate);
    const qx = X1 - 38;
    if (info.url) {
      drawQr(c, page, info.url, qx, y - 1, 38);
      text(c, page, m('exports.pass.scan'), qx + 19, y + 40, 7, {
        color: MUTED,
        align: 'center',
        maxWidthMm: 44,
      });
    } else {
      rect(c, page, qx, y - 1, 38, 38, { stroke: MUTED, width: 0.7, dash: [3, 2] });
      para(c, page, m('exports.pass.tooLarge'), qx + 2, y + 12, 34, 7, { color: MUTED });
    }
    y += 46;
    if (plate.layers === 0) {
      para(c, page, m('exports.pdf.emptyPlate'), X0, y, CW, 11);
      return;
    }
    text(c, page, m('exports.pdf.heightGridTitle'), X0, y, 10.5, { font: c.bold });
    text(
      c,
      page,
      m('exports.pdf.heightGridNote'),
      X0 +
        2 +
        c.bold.widthOfTextAtSize(pdfSafe(c.bold, m('exports.pdf.heightGridTitle'), c.cache), 10.5) / MM,
      y,
      7.5,
      {
        color: MUTED,
        maxWidthMm: CW - 70,
      },
    );
    y += 3;
    // 32 × 32 grid, row 1 = north
    const cs = Math.min(4.55, (CW - 6) / 32, (BOTTOM - 40 - y) / 33);
    const gx = X0 + 5;
    for (let k = 0; k < 32; k++) {
      text(c, page, String(k + 1), gx + (k + 0.5) * cs, y + 2.6, 5, {
        font: c.mono,
        color: MUTED,
        align: 'center',
      });
      text(c, page, String(k + 1), gx - 1, y + 3.5 + (k + 0.5) * cs + 1, 5, {
        font: c.mono,
        color: MUTED,
        align: 'right',
      });
    }
    const gy = y + 3.5;
    for (let r = 0; r < 32; r++) {
      for (let k = 0; k < 32; k++) {
        const v = heights[(31 - r) * 32 + k]!;
        const s = rampStep(v, maxH);
        const cx = gx + k * cs,
          cy = gy + r * cs;
        rect(c, page, cx, cy, cs, cs, {
          fill: s ? RAMP[s - 1]! : WHITE,
          stroke: rgb(0.8, 0.8, 0.8),
          width: 0.25,
        });
        text(c, page, String(v), cx + cs / 2, cy + cs / 2 + 0.8, cs * 1.35, {
          font: c.mono,
          color: s === 0 ? MUTED : s >= 7 ? WHITE : INK,
          align: 'center',
        });
      }
    }
    for (let k = 0; k <= 32; k += 4) {
      vline(c, page, gx + k * cs, gy, gy + 32 * cs, rgb(0.45, 0.45, 0.45), 0.6);
      hline(c, page, gx, gx + 32 * cs, gy + k * cs, rgb(0.45, 0.45, 0.45), 0.6);
    }
    y = gy + 32 * cs + 4;
    // ramp legend
    text(c, page, m('exports.pdf.heightLegend'), X0, y + 3, 7.5, { color: MUTED });
    let rx = X0 + 26;
    const rampN = Math.min(10, Math.max(1, maxH));
    for (let s = 0; s <= rampN; s++) {
      rect(c, page, rx, y, 7, 4.2, { fill: s ? RAMP[s - 1]! : WHITE, stroke: RULE, width: 0.4 });
      const label =
        maxH <= 10
          ? String(s)
          : s === 0
            ? '0'
            : `${Math.floor(((s - 1) * maxH) / 10) + 1}-${Math.floor((s * maxH) / 10)}`;
      text(c, page, label, rx + 3.5, y + 3.1, maxH <= 10 ? 6.5 : 5, {
        font: c.mono,
        color: s >= 7 ? WHITE : INK,
        align: 'center',
      });
      rx += 7.6;
    }
    y += 10;
    text(c, page, m('exports.pdf.kitTitle', { plate: plate.plate }), X0, y, 10.5, { font: c.bold });
    y = callout(c, page, [...calloutItems(plate.counts)], X0, y + 1.5, CW, 8.5);
    text(c, page, `1 × ${m('exports.pdf.baseplateName')}`, X0, y + 4, 8.5, { font: c.mono });
  }

  function drawLayers(page: PDFPage, plate: PlateSummary, from: number, to: number) {
    const { col, southRow } = parsePlateName(plate.plate, platesY);
    const heights = plateHeights(hm, col, southRow);
    let y = bodyTop + 1;
    // legend
    rect(c, page, X0, y, 4, 3, { fill: NEW_TOP, stroke: NEW_EDGE, width: 0.6 });
    let lx = X0 + 5.5 + text(c, page, m('exports.pdf.legendNew'), X0 + 5.5, y + 2.6, 7.5, { color: MUTED });
    rect(c, page, lx + 5, y, 4, 3, { fill: GHOST, stroke: GHOST, width: 0.6 });
    lx += 10.5 + text(c, page, m('exports.pdf.legendBelow'), lx + 10.5, y + 2.6, 7.5, { color: MUTED });
    text(c, page, m('exports.pdf.legendNote'), lx + 6, y + 2.6, 7.5, {
      color: MUTED,
      maxWidthMm: X1 - lx - 6,
    });
    y += 6;
    const cellW = (CW - 6) / 2;
    const cellH = (BOTTOM - 6 - y - 5) / 2;
    for (let k = from; k <= to; k++) {
      const idx = k - from;
      const cx = X0 + (idx % 2) * (cellW + 6),
        cy = y + Math.floor(idx / 2) * (cellH + 5);
      const bricks = bricksByPlateLayer.get(`${plate.plate}:${k}`) ?? [];
      const titleW = text(
        c,
        page,
        m('exports.pdf.layerTitle', { layer: k, total: plate.layers }),
        cx,
        cy + 4,
        10,
        { font: c.bold },
      );
      text(
        c,
        page,
        `· ${m('exports.pdf.newBricks', { count: bricks.length })}`,
        cx + titleW + 1.5,
        cy + 4,
        8,
        { color: MUTED },
      );
      const counts: Record<string, number> = {};
      for (const b of bricks) counts[b.partId] = (counts[b.partId] ?? 0) + 1;
      // diagram
      const rul = 5;
      const side = Math.min(cellW - rul - 1, cellH - 22);
      const u = side / 32;
      const dx = cx + rul,
        dy = cy + 7 + rul;
      rect(c, page, dx, dy, 32 * u, 32 * u, { fill: WHITE, stroke: RULE, width: 0.6 });
      // studs of the empty baseplate (light rings), then layers below
      for (let r = 0; r < 32; r++)
        for (let q = 0; q < 32; q++) {
          const v = heights[(31 - r) * 32 + q]!;
          if (k > 1 && v >= 1)
            rect(c, page, dx + q * u, dy + r * u, u, u, { fill: GHOST, opacity: v >= k - 1 ? 1 : 0.5 });
          else if (v < k)
            page.drawCircle({
              x: (dx + (q + 0.5) * u) * MM,
              y: c.H - (dy + (r + 0.5) * u) * MM,
              size: u * 0.3 * MM,
              borderColor: STUD_RING,
              borderWidth: 0.3,
            });
        }
      for (const b of bricks) {
        const bx = dx + b.x * u,
          by = dy + (32 - b.y - b.d) * u;
        rect(c, page, bx + 0.12, by + 0.12, b.w * u - 0.24, b.d * u - 0.24, {
          fill: NEW_TOP,
          stroke: NEW_EDGE,
          width: 0.7,
        });
        for (let di = 0; di < b.w; di++)
          for (let dj = 0; dj < b.d; dj++)
            page.drawCircle({
              x: (bx + (di + 0.5) * u) * MM,
              y: c.H - (by + (dj + 0.5) * u) * MM,
              size: u * 0.3 * MM,
              borderColor: NEW_EDGE,
              borderWidth: 0.35,
            });
      }
      // rulers: columns 1–32 west→east on top, rows 1–32 north→south on the left
      for (let n = 1; n <= 32; n++) {
        vline(c, page, dx + (n - 0.5) * u, dy - 1, dy, RULE, 0.4);
        hline(c, page, dx - 1, dx, dy + (n - 0.5) * u, RULE, 0.4);
        if (n % 4 === 1) {
          text(c, page, String(n), dx + (n - 0.5) * u, dy - 1.6, 5.5, {
            font: c.mono,
            color: MUTED,
            align: 'center',
          });
          text(c, page, String(n), dx - 1.6, dy + (n - 0.5) * u + 0.9, 5.5, {
            font: c.mono,
            color: MUTED,
            align: 'right',
          });
        }
      }
      callout(c, page, calloutItems(counts), cx, dy + 32 * u + 2, cellW, 7.5);
    }
  }

  function drawProjection(page: PDFPage) {
    let y = bodyTop + 4;
    text(c, page, m('exports.projection.eyebrow').toUpperCase(), X0, y, 7, { font: c.bold, color: MUTED });
    y += 8;
    text(c, page, m('exports.projection.title'), X0, y, 18, { font: c.bold });
    text(c, page, m('exports.pdf.projectionPageNote', { w: num(sizeW, 1), d: num(sizeD, 1) }), X1, y, 8, {
      color: MUTED,
      align: 'right',
    });
    y += 5;
    const { img, layout } = calque!;
    const availH = BOTTOM - 40 - y;
    const scale = Math.min(CW / layout.width, availH / layout.height);
    const iw = layout.width * scale,
      ih = layout.height * scale;
    const ix = X0 + (CW - iw) / 2;
    page.drawImage(img, { x: ix * MM, y: c.H - (y + ih) * MM, width: iw * MM, height: ih * MM });
    rect(c, page, ix, y, iw, ih, { stroke: RULE, width: 0.6 });
    y += ih + 6;
    // scale bar: one plate
    const plateLen = 32 * layout.cell * scale;
    for (let k = 0; k < 4; k++)
      rect(c, page, X0 + (k * plateLen) / 4, y, plateLen / 4, 1.6, {
        fill: k % 2 ? WHITE : INK,
        stroke: INK,
        width: 0.5,
      });
    text(c, page, m('exports.pdf.scaleBar'), X0 + plateLen + 2, y + 1.5, 7, { font: c.mono });
    y += 6;
    [1, 2, 3].forEach((k) => {
      text(c, page, `${k}.`, X0, y + 3, 8, { font: c.monoBold });
      y = para(c, page, m(`create.guide.table.projection.howTo.step${k}`), X0 + 5, y, CW - 5, 8) + 1;
    });
  }

  function drawPasses(page: PDFPage, plates: PlateSummary[]) {
    const top = bodyTop;
    const pw = CW / 2,
      ph = (BOTTOM - 6 - top) / 2;
    rect(c, page, X0, top, CW, ph * 2, { stroke: rgb(0.56, 0.56, 0.59), width: 0.7, dash: [3, 2] });
    vline(c, page, X0 + pw, top, top + 2 * ph, rgb(0.56, 0.56, 0.59), 0.7, [3, 2]);
    hline(c, page, X0, X1, top + ph, rgb(0.56, 0.56, 0.59), 0.7, [3, 2]);
    plates.forEach((plate, k) => {
      const x = X0 + (k % 2) * pw + 6,
        y = top + Math.floor(k / 2) * ph + 6;
      const w = pw - 12;
      text(c, page, m('exports.pass.title').toUpperCase(), x, y + 3, 7, { font: c.bold, color: MUTED });
      text(c, page, projectName.toUpperCase(), x + w - 42, y + 3, 7, {
        font: c.bold,
        color: MUTED,
        maxWidthMm: 40,
      });
      text(c, page, plate.plate, x, y + 20, 40, { font: c.bold });
      const info = passFor(plate);
      const qx = x + w - 38;
      if (info.url) {
        drawQr(c, page, info.url, qx, y + 6, 38);
        text(c, page, m('exports.pass.scan'), qx + 19, y + 47, 6.5, {
          color: MUTED,
          align: 'center',
          maxWidthMm: 42,
        });
      } else {
        rect(c, page, qx, y + 6, 38, 38, { stroke: MUTED, width: 0.7, dash: [3, 2] });
        para(c, page, m('exports.pass.tooLarge'), qx + 2, y + 18, 34, 7, { color: MUTED });
      }
      // position
      const cell = Math.min(3.2, 22 / Math.max(platesX, platesY));
      const [, mh] = plateMap(c, page, plateList, platesX, platesY, x, y + 26, cell, {
        on: plate.plate,
        names: false,
        headers: false,
      });
      text(c, page, m('exports.pass.position'), x, y + 26 + mh + 4, 7.5, { color: MUTED });
      text(
        c,
        page,
        m('exports.pass.layers', { count: plate.layers, bricks: num(plate.bricks) }),
        x,
        y + 26 + mh + 8,
        8.5,
        { font: c.bold },
      );
      // kit
      let ky = y + 54;
      let kx = x;
      for (const it of calloutItems(plate.counts)) {
        const part = BRICKS.find((b) => b.id === it.id)!;
        const g = brickIsoGlyph(part.width, part.length);
        const gw = (g.viewBox[2] * 1.6) / 12,
          gh = (g.viewBox[3] * 1.6) / 12;
        const label = `×${it.q} ${part.width}×${part.length}`;
        const lw = c.mono.widthOfTextAtSize(pdfSafe(c.mono, label, c.cache), 7) / MM;
        if (kx + Math.max(gw, lw) > x + w) {
          kx = x;
          ky += 17;
        }
        if (ky + 14 > y + ph - 16) break;
        drawGlyph(c, page, g, kx, ky + 10 - gh, 1.6);
        text(c, page, label, kx, ky + 13.5, 7, { font: c.mono });
        kx += Math.max(gw, lw) + 3;
      }
      para(
        c,
        page,
        m('exports.pass.footer', { version: APP_VERSION, date: dateShort }),
        x,
        y + ph - 18,
        w,
        6.5,
        { color: MUTED },
      );
    });
  }

  function drawAppendix(page: PDFPage) {
    let y = bodyTop + 4;
    text(c, page, m('exports.pdf.sections.appendix').toUpperCase(), X0, y, 7, { font: c.bold, color: MUTED });
    y += 8;
    text(c, page, m('exports.pdf.appendix.title'), X0, y, 18, { font: c.bold });
    y += 6;
    const legacyOf: Record<string, unknown> = {
      heightMode: 'normalized',
      heightRef: 'lowest-base',
      sampling: 'corner-1',
      rounding: 'trunc',
      keepSmall: false,
      selection: 'touching',
      rotation: 'aabb',
      cap: undefined,
    };
    const tag = (k: string, v: unknown) =>
      k in legacyOf
        ? legacyOf[k] === v
          ? ` (${m('exports.pdf.appendix.legacyValue')})`
          : ` (${m('exports.pdf.appendix.changedValue')})`
        : '';
    const settings: [string, string][] = [
      ['scale', `${num(params.scale, 3)} m/stud`],
      ['platesX x platesY', `${params.platesX} x ${params.platesY}`],
      [
        'area centre',
        `X ${num(input.area.cx, 2)} m, Y ${num(input.area.cy, 2)} m${input.crs ? ` (${input.crs})` : ''}`,
      ],
      [
        'rotation',
        `${num(input.area.rotationDeg, 1)} deg, ${params.rotation}${tag('rotation', params.rotation)}`,
      ],
      [
        'heightMode',
        `${params.heightMode}${params.heightMode === 'exaggerated' ? ` x${params.exaggeration ?? 1}` : ''}${tag('heightMode', params.heightMode)}`,
      ],
      ['maxHeight', String(params.maxHeight)],
      ['heightRef', `${params.heightRef}${tag('heightRef', params.heightRef)}`],
      [
        'sampling',
        `${params.sampling}${params.aggregate && params.sampling.startsWith('super') ? ` / ${params.aggregate}` : ''}${tag('sampling', params.sampling)}`,
      ],
      ['rounding', `${params.rounding}${tag('rounding', params.rounding)}`],
      ['keepSmall', `${params.keepSmall}${tag('keepSmall', params.keepSmall)}`],
      ['cap', `${params.cap ?? 'none'}${tag('cap', params.cap ?? undefined)}`],
      ['selection', `${params.selection}${tag('selection', params.selection)}`],
      ['parts', `${input.inventory.enabled.join(', ')}; max length ${input.inventory.maxLength}`],
    ];
    const half = (CW - 6) / 2;
    const box = (x: number, top: number, w: number, title: string, rows: [string, string][]) => {
      let yy = top + 6;
      text(c, page, title, x + 4, yy, 10.5, { font: c.bold });
      yy += 3;
      for (const [k, v] of rows) {
        text(c, page, k, x + 4, yy + 3, 7, { font: c.mono, color: MUTED, maxWidthMm: 30 });
        yy = para(c, page, v, x + 36, yy, w - 40, 7, { font: c.mono }) + 1;
      }
      rect(c, page, x, top, w, yy - top + 3, { stroke: RULE, width: 0.7 });
      return yy + 3;
    };
    const versions: [string, string][] = [
      ...(input.inputs?.length
        ? input.inputs.flatMap((f) => [
            ['file', `${f.path} (${num(f.size)} bytes)`] as [string, string],
            ['SHA-256', f.sha256] as [string, string],
          ])
        : [['file', m('exports.pdf.appendix.noInputs')] as [string, string]]),
      ['app', `Legonizer ${APP_VERSION}`],
      ['heightmap', `algorithm ${HEIGHTMAP_ALGORITHM_VERSION}`],
      [
        'packing',
        `algorithm ${PACKING_ALGORITHM_VERSION}, plate-local; lower bound ${num(packing.lowerBound)}`,
      ],
    ];
    const y1 = box(X0, y, half, m('exports.pdf.appendix.settings'), settings);
    const y2 = box(X0 + half + 6, y, half, m('exports.pdf.appendix.inputs'), versions.slice(0, 30));
    y = Math.max(y1, y2) + 4;
    text(c, page, m('exports.pdf.appendix.files'), X0, y + 4, 10.5, { font: c.bold });
    para(
      c,
      page,
      m('exports.pdf.appendix.filesBody', { csv: `legoPlates_${platesX}_${platesY}.csv` }),
      X0,
      y + 6,
      CW,
      8,
      { color: MUTED },
    );
    para(c, page, `${m('exports.pdf.appendix.credits')} ${m('footer.trademark')}`, X0, BOTTOM - 16, CW, 7.5, {
      color: MUTED,
    });
  }
}
