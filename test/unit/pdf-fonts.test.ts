/**
 * Site fonts in the PDF build guide (SPEC O5, src/core/export/pdfFonts.ts): IBM Plex Sans, IBM Plex
 * Mono and Bricolage Grotesque embedded as TrueType subsets, any Unicode text, clean degradation
 * for what the fonts lack, and the standard-font fallback when the files cannot be loaded.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  decodePDFRawStream,
  type PDFNumber,
  type PDFObject,
  type PDFRawStream,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { SYNTHETIC_CENTRE, syntheticBoxesCity } from '../../src/core/samples/synthetic.ts';
import { importCityModel } from '../../src/core/import/index.ts';
import { generateHeightMap } from '../../src/core/heightmap/index.ts';
import { packHeightMap } from '../../src/core/packing/pack.ts';
import { normalizeInventory } from '../../src/core/packing/catalog.ts';
import { defaultParams } from '../../src/core/types.ts';
import { renderPdfGuide, type PdfGuideInput } from '../../src/core/export/pdfGuide.ts';
import { PDF_MESSAGE_KEYS } from '../../src/core/export/pdfPlan.ts';
import { defaultFontLoader, embedPdfFonts, writeTrueType } from '../../src/core/export/pdfFonts.ts';

function messages(lang: string): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const ns of ['create', 'exports', 'errors', 'common', 'footer']) {
    const walk = (t: Record<string, unknown>, p: string) => {
      for (const [k, v] of Object.entries(t)) {
        if (typeof v === 'string') flat[`${p}.${k}`] = v;
        else walk(v as Record<string, unknown>, `${p}.${k}`);
      }
    };
    walk(JSON.parse(readFileSync(`src/i18n/${lang}/${ns}.json`, 'utf8')), ns);
  }
  const out: Record<string, string> = {};
  for (const k of PDF_MESSAGE_KEYS) if (flat[k] !== undefined) out[k] = flat[k]!;
  return out;
}

const mesh = importCityModel(syntheticBoxesCity(1));
const area = { cx: SYNTHETIC_CENTRE[0], cy: SYNTHETIC_CENTRE[1], rotationDeg: 0 };
const params = { ...defaultParams(2, 2), keepSmall: true };
const heightMap = generateHeightMap(mesh, area, params).heightMap;
const packing = packHeightMap(heightMap);
const base: PdfGuideInput = {
  title: 'Sample',
  heightMap,
  packing,
  params,
  area,
  inventory: normalizeInventory({}),
  paper: 'A4',
  messages: messages('en'),
  locale: 'en',
  date: '2026-10-07T12:00:00Z',
  presetName: 'Legacy (UD-Viz 4.6.1) with small buildings kept',
  differences: ['Keep small buildings (at least 1 brick)'],
  passBaseUrl: 'https://example.org/legonizer/create.html',
};
/** Cover + technical appendix only: fast, and the title is drawn in Bricolage, Plex Sans and Plex Mono. */
const coverOnly = {
  cover: true,
  shopping: false,
  plates: false,
  layers: false,
  projection: false,
  passes: false,
};

interface EmbeddedFont {
  baseFont: string;
  subtype: string;
  descendant?: PDFDict;
  toUnicode: Map<number, string>;
  program?: Uint8Array;
}

const latin1 = new TextDecoder('latin1');
const decode = (s: PDFObject | undefined) => decodePDFRawStream(s as PDFRawStream).decode();

/** ToUnicode CMap (bfchar entries, as pdf-lib writes them): glyph id → text. */
function parseToUnicode(bytes: Uint8Array): Map<number, string> {
  const map = new Map<number, string>();
  const body = latin1.decode(bytes).split('beginbfchar')[1]?.split('endbfchar')[0] ?? '';
  for (const [, gid, hex] of body.matchAll(/<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]+)>/g)) {
    const units: number[] = [];
    for (let k = 0; k < hex!.length; k += 4) units.push(parseInt(hex!.slice(k, k + 4), 16));
    map.set(parseInt(gid!, 16), String.fromCharCode(...units));
  }
  return map;
}

function fontOf(doc: PDFDocument, dict: PDFDict): EmbeddedFont {
  const ctx = doc.context;
  const baseFont = (dict.get(PDFName.of('BaseFont')) as PDFName).decodeText();
  const subtype = (dict.get(PDFName.of('Subtype')) as PDFName).decodeText();
  const out: EmbeddedFont = { baseFont, subtype, toUnicode: new Map() };
  const tu = dict.get(PDFName.of('ToUnicode'));
  if (tu) out.toUnicode = parseToUnicode(decode(ctx.lookup(tu)));
  const desc = dict.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
  if (desc) {
    out.descendant = ctx.lookup(desc.get(0), PDFDict);
    const fd = out.descendant.lookup(PDFName.of('FontDescriptor'), PDFDict);
    const ff = fd.get(PDFName.of('FontFile2'));
    if (ff) out.program = decode(ctx.lookup(ff));
  }
  return out;
}

function fonts(doc: PDFDocument): EmbeddedFont[] {
  const out: EmbeddedFont[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects())
    if (
      obj instanceof PDFDict &&
      obj.get(PDFName.of('Type')) === PDFName.of('Font') &&
      obj.get(PDFName.of('Subtype')) !== PDFName.of('CIDFontType2')
    )
      out.push(fontOf(doc, obj));
  return out;
}

/** Text of every hex-string `Tj` of a page, through the fonts' ToUnicode maps, with its font. */
function pageText(doc: PDFDocument, index: number): { font: string; text: string }[] {
  const page = doc.getPage(index);
  const res = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  const byKey = new Map<string, EmbeddedFont>();
  for (const [key, ref] of res.entries())
    byKey.set(key.decodeText(), fontOf(doc, doc.context.lookup(ref, PDFDict)));
  const contents = page.node.Contents()!;
  const streams =
    contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  const src = streams.map((s) => latin1.decode(decode(s))).join('\n');
  const out: { font: string; text: string }[] = [];
  let font: EmbeddedFont | undefined;
  for (const m of src.matchAll(/\/(\S+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]*)>\s*Tj/g)) {
    if (m[1])
      font = byKey.get(
        m[1].replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))),
      );
    else if (font) {
      let text = '';
      for (let k = 0; k < m[2]!.length; k += 4)
        text += font.toUnicode.get(parseInt(m[2]!.slice(k, k + 4), 16)) ?? '';
      out.push({ font: font.baseFont, text });
    }
  }
  return out;
}

interface FkFont {
  numGlyphs: number;
  getGlyph(id: number): {
    advanceWidth: number;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    path: { commands: unknown[] };
  };
  glyphForCodePoint(cp: number): { advanceWidth: number; bbox: { minX: number; maxX: number } };
}
const parse = (bytes: Uint8Array) => fontkit.create(bytes) as unknown as FkFont;

describe('PDF fonts: the site typography (pdfFonts.ts)', () => {
  it('embeds IBM Plex Sans, IBM Plex Mono and Bricolage Grotesque as TrueType subsets, no standard font', async () => {
    const doc = await PDFDocument.load(await renderPdfGuide(base));
    const list = fonts(doc);
    const names = list.map((f) => f.baseFont).sort();
    expect(names).toEqual([
      'LZBOLD+IBMPlexSans-SemiBold',
      'LZDISP+BricolageGrotesque-Bold36pt',
      'LZHEAD+BricolageGrotesque-Bold14pt',
      'LZMONB+IBMPlexMono-SemiBold',
      'LZMONO+IBMPlexMono',
      'LZSANS+IBMPlexSans',
    ]);
    const families = new Set(names.map((n) => n.replace(/^[A-Z]{6}\+/, '').replace(/-.*/, '')));
    expect([...families].sort()).toEqual(['BricolageGrotesque', 'IBMPlexMono', 'IBMPlexSans']);
    for (const f of list) {
      expect(f.subtype).toBe('Type0');
      expect((f.descendant!.get(PDFName.of('Subtype')) as PDFName).decodeText()).toBe('CIDFontType2');
      // a real TrueType program with outlines, and a ToUnicode map (searchable, copyable text)
      const ttf = parse(f.program!);
      expect(ttf.numGlyphs).toBeGreaterThan(5);
      expect(ttf.numGlyphs).toBeLessThan(120); // a subset, not the whole font
      expect(f.toUnicode.size).toBe(ttf.numGlyphs - 1);
      // W widths = the program's advances
      const w = f.descendant!.lookup(PDFName.of('W'), PDFArray).asArray();
      const first = (w[0] as PDFNumber).asNumber();
      const widths = (w[1] as PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
      widths.forEach((adv, k) => expect(ttf.getGlyph(first + k).advanceWidth).toBe(adv));
    }
    // fonts actually used: body text, numbers, titles
    const used = new Set(pageText(doc, 2).map((t) => t.font));
    for (const n of names) expect(used.has(n), n).toBe(true);
  });

  it('prints Latin-extended text (title, header, footer, passes) and keeps it searchable', async () => {
    const title = 'Łódź – Œuvre – Ærøskøbing';
    const doc = await PDFDocument.load(
      await renderPdfGuide({ ...base, title, locale: 'fr', messages: messages('fr') }),
    );
    const cover = pageText(doc, 0);
    expect(cover).toContainEqual({ font: 'LZDISP+BricolageGrotesque-Bold36pt', text: title });
    expect(cover.find((t) => t.font === 'LZMONO+IBMPlexMono' && t.text.startsWith(title))).toBeDefined();
    const page2 = pageText(doc, 1);
    expect(page2).toContainEqual({ font: 'LZHEAD+BricolageGrotesque-Bold14pt', text: title });
    // plate passes: uppercase, truncated with an ellipsis
    const passes = pageText(doc, doc.getPageCount() - 2).map((t) => t.text);
    expect(passes.some((t) => t.startsWith('ŁÓDŹ – ŒUVRE') && t.endsWith('…'))).toBe(true);
    // the glyphs are real outlines, from the latin-ext file
    const disp = fonts(doc).find((f) => f.baseFont.includes('Bold36pt'))!;
    const ttf = parse(disp.program!);
    for (const ch of 'ŁźŒÆø') {
      const gid = [...disp.toUnicode].find(([, t]) => t === ch)?.[0];
      expect(gid, ch).toBeDefined();
      expect(ttf.getGlyph(gid!).path.commands.length, ch).toBeGreaterThan(4);
    }
    // the EN and FR guide texts need no replacement character
    for (const f of fonts(doc)) expect([...f.toUnicode.values()].join('')).not.toContain('\ufffd');
  });

  it('loads Cyrillic, Greek and Vietnamese subsets when the text needs them', async () => {
    const title = 'Київ · Αθήνα · Hà Nội · Đà Nẵng';
    const doc = await PDFDocument.load(await renderPdfGuide({ ...base, title, sections: coverOnly }));
    const cover = pageText(doc, 0);
    // titles: Bricolage (Latin, Vietnamese), Plex Sans 600 for the scripts Bricolage lacks, same PDF font
    expect(cover).toContainEqual({ font: 'LZDISP+BricolageGrotesque-Bold36pt', text: title });
    expect(cover.find((t) => t.font === 'LZMONO+IBMPlexMono' && t.text.startsWith(title))).toBeDefined();
  });

  it('degrades cleanly on characters no font has: replacements, base letters, U+FFFD', async () => {
    const title = '里昂 🧱 → ≤ ✈ ž';
    const doc = await PDFDocument.load(await renderPdfGuide({ ...base, title, sections: coverOnly }));
    const cover = pageText(doc, 0);
    // CJK, emoji and ✈ have no glyph: U+FFFD; → and ≤ have typographic replacements; ž is covered
    expect(cover).toContainEqual({ font: 'LZDISP+BricolageGrotesque-Bold36pt', text: '�� � -> <= � ž' });
    // standalone: unknown text after embedding (not in the pre-scan) never throws
    const d = await PDFDocument.create();
    const { fonts: f } = await embedPdfFonts(d, ['abc']);
    const page = d.addPage();
    for (const font of Object.values(f)) {
      expect(() => font.widthOfTextAtSize('Ł Київ 里 \u0000\u200b\u00ad ⅛', 10)).not.toThrow();
      page.drawText('Ł Київ 里 ⅛', { font, size: 10 });
    }
    const back = await PDFDocument.load(await d.save());
    const texts = pageText(back, 0).map((t) => t.text);
    // latin-ext was not loaded: Ł falls back to L, Cyrillic and CJK to U+FFFD, ⅛ to 1/8
    expect(texts[0]).toBe('L ���� � 1/8');
  });

  it('applies the Bricolage variation (opsz, wght) to outlines and advances', async () => {
    const d = await PDFDocument.create();
    const { fonts: f } = await embedPdfFonts(d, ['I']);
    const page = d.addPage();
    page.drawText('I', { font: f.display, size: 20 });
    page.drawText('I', { font: f.heading, size: 20 });
    const back = await PDFDocument.load(await d.save());
    const list = fonts(back);
    const glyph = (name: string) => parse(list.find((x) => x.baseFont.includes(name))!.program!).getGlyph(1);
    const display = glyph('Bold36pt'),
      heading = glyph('Bold14pt');
    // default instance of the variable file: opsz 96, wght 800
    const file = new URL(
      '../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2',
      import.meta.url,
    );
    const def = parse(await defaultFontLoader(file)).glyphForCodePoint(0x49);
    const stem = (g: { bbox: { minX: number; maxX: number } }) => g.bbox.maxX - g.bbox.minX;
    expect(stem(display)).toBeLessThan(stem(def)); // wght 720 < 800: thinner stem
    expect(stem(display)).toBeGreaterThan(stem(def) * 0.8);
    expect(display.advanceWidth).toBeGreaterThan(def.advanceWidth); // smaller optical size: looser
    expect(heading.advanceWidth).toBeGreaterThan(display.advanceWidth);
    expect(f.display.widthOfTextAtSize('I', 1000)).toBe(display.advanceWidth);
  });

  it('writes TrueType that fontkit reads back (outlines, metrics)', () => {
    const P = (x: number, y: number, onCurve = true) => ({
      x,
      y,
      onCurve,
      endContour: false,
      copy: () => P(x, y, onCurve),
    });
    const square = [P(50, 0), P(50, 700), P(450, 700), P(450, 0)];
    const bowl = [
      P(100, 300),
      P(100, 600, false),
      P(300, 600),
      P(500, 600, false),
      P(500, 300),
      P(500, 0, false),
      P(300, 0),
      P(100, 0, false),
    ];
    const ttf = writeTrueType(
      [
        { contours: [], advance: 500 },
        { contours: [square], advance: 500 },
        { contours: [bowl, square], advance: 1200 },
        { contours: [], advance: 250 },
      ],
      { ascent: 900, descent: -250, lineGap: 0, fixedPitch: false },
    );
    const f = parse(ttf);
    expect(f.numGlyphs).toBe(4);
    expect(f.getGlyph(1).bbox).toMatchObject({ minX: 50, minY: 0, maxX: 450, maxY: 700 });
    expect(f.getGlyph(2).advanceWidth).toBe(1200);
    expect(f.getGlyph(2).bbox).toMatchObject({ minX: 50, minY: 0, maxX: 500, maxY: 700 });
    expect(f.getGlyph(3).path.commands.length).toBe(0);
    expect(f.getGlyph(3).advanceWidth).toBe(250);
  });

  it('falls back to the standard fonts when the font files cannot be loaded', async () => {
    const offline = () => Promise.reject(new Error('offline'));
    const doc = await PDFDocument.load(
      await renderPdfGuide({ ...base, title: 'Łódź – Œuvre', sections: coverOnly, fontLoader: offline }),
    );
    expect(
      fonts(doc)
        .map((f) => f.baseFont)
        .sort(),
    ).toEqual(['Courier', 'Courier-Bold', 'Helvetica', 'Helvetica-Bold']);
    // a subset file that fails is skipped: its characters get the replacements
    const noExt = (url: URL) =>
      /latin-ext/.test(url.pathname) ? Promise.reject(new Error('blocked')) : defaultFontLoader(url);
    const doc2 = await PDFDocument.load(
      await renderPdfGuide({ ...base, title: 'Łódź – Œuvre', sections: coverOnly, fontLoader: noExt }),
    );
    expect(pageText(doc2, 0)).toContainEqual({
      font: 'LZDISP+BricolageGrotesque-Bold36pt',
      text: 'Lódz – Œuvre',
    });
  });
});
