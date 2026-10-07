/**
 * Site fonts in the PDF build guide (SPEC O5, with the typography of src/styles/tokens.css): IBM Plex
 * Sans for text, IBM Plex Mono for numbers and part codes, Bricolage Grotesque for titles. Loaded by
 * the PDF module only (engine Worker, on the first PDF), never by the pages' initial bundles.
 *
 * Font files: the same @fontsource .woff2 files the site's CSS serves (OFL-1.1), one file per
 * Unicode subset (latin, latin-ext, vietnamese, cyrillic, greek), Bricolage only as a variable font
 * (opsz 12–96, wght 200–800; default instance opsz 96, wght 800). A file is loaded only when the
 * text of the guide needs a character of its subset, so a Latin-only guide loads the latin files.
 *
 * Why not `doc.embedFont(bytes, { subset: true })` with @pdf-lib/fontkit 1.1.1 (its last release)
 * directly: subsetting a WOFF2 file throws (TTFSubset copies glyf data through loca, which WOFF2's
 * transformed glyf table does not have), embedding a whole WOFF or WOFF2 file puts the compressed
 * container into FontFile2 (viewers show garbage), and a variation instance of a WOFF2 font crashes
 * (WOFF2Font decodes composites with `_decodeComposite` on an object without `_getPhantomPoints`)
 * or, once decoded, ignores gvar (WOFF2Glyph returns the undeformed points). Measured 2026-10-07.
 *
 * So each PDF font is a `MergedFont` that pdf-lib embeds through `doc.registerFontkit`:
 * - fontkit parses the files (brotli, glyf transform, cmap, GSUB, HVAR, gvar) and lays text out;
 * - per character, the first file of the face's chain that has the glyph is used (latin first,
 *   then latin-ext …, then the fallback face), so one PDF font covers every loaded subset;
 * - Bricolage's variation (opsz, wght) is applied here to the points with fontkit's gvar
 *   processor, composites are flattened, advances come from HVAR;
 * - `createSubset()` writes a TrueType font of the glyphs actually drawn (head, hhea, maxp, hmtx,
 *   loca, glyf, post; no hinting), embedded as a CIDFontType2 with a ToUnicode map, so the text
 *   stays searchable and copyable.
 *
 * Characters no loaded file covers never throw: a typographic replacement when there is one
 * (→ "->", ≤ "<=", ✓ "v" …), else the base letter without its marks (NFD: "ǩ" → "k"), else U+FFFD
 * (the replacement character, drawn from IBM Plex Sans). Emoji and CJK therefore print as "�".
 *
 * Licence: embedding the fonts, whole or subset, in documents is allowed by the OFL (OFL FAQ 1.12,
 * https://openfontlicense.org/ofl-faq/); no modified font file is distributed with the site.
 */
import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';

// ------------------------------------------------------------------------------------------ files

type Ranges = readonly (readonly [number, number])[];

/** Parses a CSS unicode-range ("U+0000-00FF,U+0131"). */
function ranges(s: string): Ranges {
  return s.split(',').map((r) => {
    const [a, b] = r.trim().slice(2).split('-');
    return [parseInt(a!, 16), parseInt(b ?? a!, 16)] as const;
  });
}

// unicode-range of each subset, from the packages' unicode.json (Google Fonts subsets, identical
// for the three families).
const LATIN = ranges(
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
);
const LATIN_EXT = ranges(
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
);
const VIETNAMESE = ranges(
  'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB',
);
const CYRILLIC = ranges('U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116');
const GREEK = ranges('U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF');

interface SourceSpec {
  /** Stable key (file name). */
  key: string;
  /** The file, as a URL the bundler rewrites to the emitted asset (file: URL in Node). */
  url: URL;
  ranges: Ranges;
}

const src = (key: string, url: URL, r: Ranges): SourceSpec => ({ key, url, ranges: r });

// Literal `new URL(…, import.meta.url)` so that Vite emits each file as an asset of the Worker
// build (same content hash as the CSS's copy); nothing is fetched before a PDF is made.
const SANS_400: SourceSpec[] = [
  src(
    'plex-sans-latin-400',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2',
      import.meta.url,
    ),
    LATIN,
  ),
  src(
    'plex-sans-latin-ext-400',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-400-normal.woff2',
      import.meta.url,
    ),
    LATIN_EXT,
  ),
  src(
    'plex-sans-vietnamese-400',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-vietnamese-400-normal.woff2',
      import.meta.url,
    ),
    VIETNAMESE,
  ),
  src(
    'plex-sans-cyrillic-400',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-cyrillic-400-normal.woff2',
      import.meta.url,
    ),
    CYRILLIC,
  ),
  src(
    'plex-sans-greek-400',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-greek-400-normal.woff2',
      import.meta.url,
    ),
    GREEK,
  ),
];
const SANS_600: SourceSpec[] = [
  src(
    'plex-sans-latin-600',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2',
      import.meta.url,
    ),
    LATIN,
  ),
  src(
    'plex-sans-latin-ext-600',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-600-normal.woff2',
      import.meta.url,
    ),
    LATIN_EXT,
  ),
  src(
    'plex-sans-vietnamese-600',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-vietnamese-600-normal.woff2',
      import.meta.url,
    ),
    VIETNAMESE,
  ),
  src(
    'plex-sans-cyrillic-600',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-cyrillic-600-normal.woff2',
      import.meta.url,
    ),
    CYRILLIC,
  ),
  src(
    'plex-sans-greek-600',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-greek-600-normal.woff2',
      import.meta.url,
    ),
    GREEK,
  ),
];
const MONO_400: SourceSpec[] = [
  src(
    'plex-mono-latin-400',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
      import.meta.url,
    ),
    LATIN,
  ),
  src(
    'plex-mono-latin-ext-400',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-ext-400-normal.woff2',
      import.meta.url,
    ),
    LATIN_EXT,
  ),
  src(
    'plex-mono-vietnamese-400',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-vietnamese-400-normal.woff2',
      import.meta.url,
    ),
    VIETNAMESE,
  ),
  src(
    'plex-mono-cyrillic-400',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-400-normal.woff2',
      import.meta.url,
    ),
    CYRILLIC,
  ),
];
const MONO_600: SourceSpec[] = [
  src(
    'plex-mono-latin-600',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2',
      import.meta.url,
    ),
    LATIN,
  ),
  src(
    'plex-mono-latin-ext-600',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-ext-600-normal.woff2',
      import.meta.url,
    ),
    LATIN_EXT,
  ),
  src(
    'plex-mono-vietnamese-600',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-vietnamese-600-normal.woff2',
      import.meta.url,
    ),
    VIETNAMESE,
  ),
  src(
    'plex-mono-cyrillic-600',
    new URL(
      '../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-600-normal.woff2',
      import.meta.url,
    ),
    CYRILLIC,
  ),
];
const BRICOLAGE: SourceSpec[] = [
  src(
    'bricolage-latin',
    new URL(
      '../../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2',
      import.meta.url,
    ),
    LATIN,
  ),
  src(
    'bricolage-latin-ext',
    new URL(
      '../../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-opsz-normal.woff2',
      import.meta.url,
    ),
    LATIN_EXT,
  ),
  src(
    'bricolage-vietnamese',
    new URL(
      '../../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-vietnamese-opsz-normal.woff2',
      import.meta.url,
    ),
    VIETNAMESE,
  ),
];

// ------------------------------------------------------------------------------------------ faces

/** The six PDF fonts of the guide. */
export type PdfFontRole = 'sans' | 'bold' | 'mono' | 'monoBold' | 'display' | 'heading';

interface FaceSpec {
  /** PostScript name in the PDF (after the subset tag). */
  name: string;
  /** Six uppercase letters, unique per font of the document (ISO 32000-1 §9.6.4). */
  tag: string;
  sources: SourceSpec[];
  /** Variation of the face's own (variable) files, user-space axis values. */
  variation?: Record<string, number>;
  /** Face whose files follow this face's own (scripts this family lacks, and U+FFFD). */
  fallback?: PdfFontRole;
  /** Standard font used when the files cannot be loaded. */
  standard: StandardFonts;
}

/**
 * Site typography → PDF: body text Plex Sans 400; labels, table heads and eyebrows Plex Sans 600
 * (`--lz-weight-semibold`); numbers and part codes Plex Mono 400/600; titles Bricolage Grotesque at
 * `--lz-weight-display` (720) with the optical size of the printed size (opsz follows the font
 * size on screen): 36 for the large titles (16–40 pt), 14 for the small headings (9–10.5 pt).
 */
export const PDF_FACES: Record<PdfFontRole, FaceSpec> = {
  sans: { name: 'IBMPlexSans', tag: 'LZSANS', sources: SANS_400, standard: StandardFonts.Helvetica },
  bold: {
    name: 'IBMPlexSans-SemiBold',
    tag: 'LZBOLD',
    sources: SANS_600,
    fallback: 'sans',
    standard: StandardFonts.HelveticaBold,
  },
  mono: {
    name: 'IBMPlexMono',
    tag: 'LZMONO',
    sources: MONO_400,
    fallback: 'sans',
    standard: StandardFonts.Courier,
  },
  monoBold: {
    name: 'IBMPlexMono-SemiBold',
    tag: 'LZMONB',
    sources: MONO_600,
    fallback: 'bold',
    standard: StandardFonts.CourierBold,
  },
  display: {
    name: 'BricolageGrotesque-Bold36pt',
    tag: 'LZDISP',
    sources: BRICOLAGE,
    variation: { opsz: 36, wght: 720 },
    fallback: 'bold',
    standard: StandardFonts.HelveticaBold,
  },
  heading: {
    name: 'BricolageGrotesque-Bold14pt',
    tag: 'LZHEAD',
    sources: BRICOLAGE,
    variation: { opsz: 14, wght: 720 },
    fallback: 'bold',
    standard: StandardFonts.HelveticaBold,
  },
};

const ROLES = Object.keys(PDF_FACES) as PdfFontRole[];

interface ChainItem {
  spec: SourceSpec;
  variation: Record<string, number> | undefined;
  /** First file of a family (its latin file): always loaded. */
  primary: boolean;
}

/** Source chain of a face: its own files, then its fallback face's chain. */
function chain(role: PdfFontRole): ChainItem[] {
  const out: ChainItem[] = [];
  for (let r: PdfFontRole | undefined = role; r; r = PDF_FACES[r].fallback) {
    const f: FaceSpec = PDF_FACES[r];
    f.sources.forEach((spec, k) => out.push({ spec, variation: f.variation, primary: k === 0 }));
  }
  return out;
}

// ------------------------------------------------------------------------- fontkit (internal API)

// The parts of fontkit 1.1.1 used here, including internals (underscored) that its typings omit.
interface FkPoint {
  x: number;
  y: number;
  onCurve: boolean;
  endContour: boolean;
  copy(): FkPoint;
}
interface FkComponent {
  glyphID: number;
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
  scale01: number;
  scale10: number;
}
interface FkRawGlyph {
  numberOfContours: number;
  points?: FkPoint[];
  components?: FkComponent[];
}
interface FkGlyph {
  id: number;
  codePoints: number[];
  advanceWidth: number;
}
interface FkFont {
  unitsPerEm: number;
  numGlyphs: number;
  ascent: number;
  descent: number;
  capHeight: number;
  xHeight: number;
  italicAngle: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  characterSet: number[];
  hhea: { lineGap: number };
  'OS/2': { sFamilyClass: number };
  post: { isFixedPitch: boolean | number };
  head: { macStyle: { italic: boolean } };
  fvar?: { axis: { axisTag: string; minValue: number; defaultValue: number; maxValue: number }[] };
  directory: { tables: Record<string, unknown> };
  variationCoords: number[] | null;
  _variationProcessor: { transformPoints(gid: number, points: FkPoint[]): void } | null;
  _transformedGlyphs?: (FkRawGlyph | undefined)[];
  _cmapProcessor: { codePointsForGlyph(gid: number): number[] };
  hasGlyphForCodePoint(cp: number): boolean;
  getGlyph(gid: number): FkGlyph;
  layout(text: string): { glyphs: FkGlyph[] };
}

/** Minimal Point for gvar processing (fontkit's Point class is not exported). */
class Pt implements FkPoint {
  x: number;
  y: number;
  onCurve: boolean;
  endContour: boolean;
  constructor(onCurve: boolean, endContour: boolean, x: number, y: number) {
    this.onCurve = onCurve;
    this.endContour = endContour;
    this.x = x;
    this.y = y;
  }
  copy(): Pt {
    return new Pt(this.onCurve, this.endContour, this.x, this.y);
  }
}

type Fontkit = { create(bytes: Uint8Array): unknown };

// fontkit is a 730 kB prebuilt bundle (brotli, Unicode data, shapers): its own chunk, loaded with
// the font files on the first PDF, so that changes to the guide's code do not invalidate it.
let fontkitModule: Promise<Fontkit> | undefined;
const loadFontkit = () =>
  (fontkitModule ??= import('@pdf-lib/fontkit').then((m) => (m.default ?? m) as unknown as Fontkit));

/** Opens a WOFF2 file; with a variation, sets it up so that gvar and HVAR apply. */
function openFont(
  fontkit: Fontkit,
  bytes: Uint8Array,
  variation: Record<string, number> | undefined,
): FkFont {
  const font = fontkit.create(bytes) as FkFont;
  // WOFF2Font decodes the whole transformed glyf table on the first glyph access; with a
  // variation already set, its composite decoding crashes (fontkit 1.1.1). Decode first with the
  // variation processor hidden, then set the coordinates (fontkit caches the processor on first use).
  Object.defineProperty(font, '_variationProcessor', { value: null, configurable: true });
  font.getGlyph(0);
  delete (font as Partial<FkFont>)._variationProcessor;
  if (!font._transformedGlyphs) throw new Error('pdfFonts: WOFF2 files expected');
  if (variation && font.fvar) {
    if (!font.directory.tables.HVAR) throw new Error('pdfFonts: variable font without HVAR');
    font.variationCoords = font.fvar.axis.map((a) => {
      const v = variation[a.axisTag.trim()];
      return v === undefined ? a.defaultValue : Math.max(a.minValue, Math.min(a.maxValue, v));
    });
  }
  return font;
}

// ---------------------------------------------------------------------------------------- loading

/** Loads a font file: fetch() in the Worker, the file system in Node (tests, scripts). */
export type FontLoader = (url: URL) => Promise<Uint8Array>;

export const defaultFontLoader: FontLoader = async (url) => {
  if (url.protocol === 'file:') {
    // Node's fetch() does not read file: URLs. A variable specifier keeps bundlers off it.
    const fsModule = 'node:fs/promises';
    const fs = (await import(/* @vite-ignore */ fsModule)) as {
      readFile(u: URL): Promise<Uint8Array>;
    };
    return new Uint8Array(await fs.readFile(url));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font ${url.pathname}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

// Files and parsed fonts are kept for the Worker's lifetime (a few hundred kB once decompressed),
// so the next PDF neither loads nor parses them again.
const byteCache = new Map<string, Promise<Uint8Array>>();
const fontCache = new Map<string, Promise<FkFont>>();

function cached<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    cache.set(key, (p = make()));
    p.catch(() => cache.delete(key));
  }
  return p;
}

function loadFont(
  spec: SourceSpec,
  variation: Record<string, number> | undefined,
  load: FontLoader,
): Promise<FkFont> {
  const open = (bytes: Promise<Uint8Array>) =>
    Promise.all([loadFontkit(), bytes]).then(([fk, b]) => openFont(fk, b, variation));
  if (load !== defaultFontLoader) return open(load(spec.url));
  return cached(fontCache, `${spec.key}|${variation ? JSON.stringify(variation) : ''}`, () =>
    open(cached(byteCache, spec.key, () => load(spec.url))),
  );
}

function inRanges(cp: number, r: Ranges): boolean {
  for (const [a, b] of r) if (cp >= a && cp <= b) return true;
  return false;
}

// ------------------------------------------------------------------------------------ merged font

interface Source {
  font: FkFont;
  /** First merged glyph id of this file. */
  base: number;
  /** To 1000 units per em. */
  scale: number;
  variable: boolean;
}

interface MergedGlyph {
  id: number;
  advanceWidth: number;
  codePoints: number[];
}

/**
 * Replacements for characters no loaded file covers: typographic ones, and the Latin letters
 * that have no canonical decomposition (so the NFD step below cannot strip them to a base letter).
 */
const REPLACE: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  Ħ: 'H',
  ħ: 'h',
  Ŧ: 'T',
  ŧ: 't',
  Ŀ: 'L',
  ŀ: 'l',
  ı: 'i',
  Ø: 'O',
  ø: 'o',
  Æ: 'AE',
  æ: 'ae',
  Œ: 'OE',
  œ: 'oe',
  ß: 'ss',
  Þ: 'Th',
  þ: 'th',
  '→': '->',
  '←': '<-',
  '⇒': '=>',
  '↔': '<->',
  '⅛': '1/8',
  '¼': '1/4',
  '½': '1/2',
  '✓': 'v',
  '✔': 'v',
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '≈': '~',
  '\u202f': '\u00a0',
  '\u2009': ' ',
  '\u2007': ' ',
  '\u200b': '',
  '\u200c': '',
  '\u200d': '',
  '\u2060': '',
  '\ufeff': '',
};

/**
 * A PDF font made of several font files (fontkit `Font` facade for pdf-lib's custom font
 * embedder): text layout, metrics, and a TrueType subset of the glyphs used.
 */
class MergedFont {
  readonly unitsPerEm = 1000;
  readonly postscriptName: string;
  readonly cff = undefined;
  private readonly sources: Source[];
  private readonly primary: FkFont;
  private readonly fixedPitch: boolean;
  private readonly glyphs = new Map<number, MergedGlyph>();
  private readonly runs = new Map<string, MergedGlyph[]>();
  private readonly replacement: string;

  constructor(name: string, fonts: { font: FkFont; variable: boolean }[], fixedPitch: boolean) {
    this.postscriptName = name;
    this.fixedPitch = fixedPitch;
    let base = 0;
    this.sources = fonts.map(({ font, variable }) => {
      const s = { font, base, scale: 1000 / font.unitsPerEm, variable };
      base += font.numGlyphs;
      return s;
    });
    this.primary = fonts[0]!.font;
    this.replacement = this.find(0xfffd) >= 0 ? '\ufffd' : '?';
  }

  // metrics read by pdf-lib (FontDescriptor, font flags)
  get ascent() {
    return this.primary.ascent * this.sources[0]!.scale;
  }
  get descent() {
    return this.primary.descent * this.sources[0]!.scale;
  }
  get capHeight() {
    return this.primary.capHeight * this.sources[0]!.scale;
  }
  get xHeight() {
    return this.primary.xHeight * this.sources[0]!.scale;
  }
  get italicAngle() {
    return this.primary.italicAngle;
  }
  get bbox() {
    const s = this.sources[0]!.scale,
      b = this.primary.bbox;
    return { minX: b.minX * s, minY: b.minY * s, maxX: b.maxX * s, maxY: b.maxY * s };
  }
  get 'OS/2'() {
    return this.primary['OS/2'];
  }
  get post() {
    return this.primary.post;
  }
  get head() {
    return this.primary.head;
  }
  get characterSet(): number[] {
    const set = new Set<number>();
    for (const s of this.sources) for (const cp of s.font.characterSet) set.add(cp);
    return [...set].sort((a, b) => a - b);
  }

  /** Index of the first file that has a glyph for `cp`, or -1. */
  private find(cp: number): number {
    for (let k = 0; k < this.sources.length; k++)
      if (this.sources[k]!.font.hasGlyphForCodePoint(cp)) return k;
    return -1;
  }

  private fallbackGlyph(): [number, string] {
    return [Math.max(0, this.find(this.replacement.codePointAt(0)!)), this.replacement];
  }

  /** Text → [file, character] pairs, with replacements for what no file covers. */
  private assign(text: string): [number, string][] {
    const out: [number, string][] = [];
    const push = (s: string, depth: number) => {
      for (const ch of s) {
        const cp = ch.codePointAt(0)!;
        if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) {
          // control characters (line breaks are split by the caller): a space
          if (cp === 0x09 || cp === 0x0a || cp === 0x0d) push(' ', depth + 1);
          continue;
        }
        if (cp === 0xad) continue; // soft hyphen: invisible
        const k = this.find(cp);
        if (k >= 0) {
          out.push([k, ch]);
          continue;
        }
        if (depth > 2) {
          out.push(this.fallbackGlyph());
          continue;
        }
        const rep = REPLACE[ch];
        if (rep !== undefined) {
          push(rep, depth + 1);
          continue;
        }
        const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
        if (base && base !== ch && [...base].every((c) => this.find(c.codePointAt(0)!) >= 0)) {
          push(base, depth + 1);
          continue;
        }
        out.push(this.fallbackGlyph());
      }
    };
    push(text.normalize('NFC'), 0);
    return out;
  }

  /** fontkit-compatible layout: GSUB per run of one file, advances in 1000 units per em. */
  layout(text: string): { glyphs: MergedGlyph[] } {
    let glyphs = this.runs.get(text);
    if (!glyphs) {
      glyphs = [];
      const parts = this.assign(text);
      for (let i = 0; i < parts.length;) {
        const k = parts[i]![0];
        let run = '';
        while (i < parts.length && parts[i]![0] === k) run += parts[i++]![1];
        const s = this.sources[k]!;
        for (const g of s.font.layout(run).glyphs) glyphs.push(this.glyph(s, g));
      }
      this.runs.set(text, glyphs);
    }
    return { glyphs };
  }

  private glyph(s: Source, g: FkGlyph): MergedGlyph {
    const id = s.base + g.id;
    let m = this.glyphs.get(id);
    if (!m) {
      let cps = g.codePoints.length ? g.codePoints : s.font._cmapProcessor.codePointsForGlyph(g.id);
      if (!cps.length) cps = [0xfffd];
      m = { id, advanceWidth: Math.round(g.advanceWidth * s.scale), codePoints: [...cps] };
      this.glyphs.set(id, m);
    }
    return m;
  }

  private locate(id: number): [Source, number] {
    for (let k = this.sources.length - 1; k >= 0; k--) {
      const s = this.sources[k]!;
      if (id >= s.base) return [s, id - s.base];
    }
    return [this.sources[0]!, 0];
  }

  /** Outline of a glyph in 1000 units per em: variation applied, composites flattened. */
  outline(id: number): { contours: Pt[][]; advance: number } {
    const [s, gid] = this.locate(id);
    const advance =
      this.glyphs.get(id)?.advanceWidth ?? Math.round(s.font.getGlyph(gid).advanceWidth * s.scale);
    const contours = rawOutline(s, gid, 0).map((c) =>
      c.map((p) => new Pt(p.onCurve, false, p.x * s.scale, p.y * s.scale)),
    );
    return { contours, advance };
  }

  createSubset() {
    const ids: number[] = [];
    const index = new Map<number, number>();
    const include = (g: number | { id: number }) => {
      const id = typeof g === 'number' ? g : g.id;
      let k = index.get(id);
      if (k === undefined) {
        index.set(id, (k = ids.length));
        ids.push(id);
      }
      return k;
    };
    include(0); // .notdef
    return {
      includeGlyph: include,
      encodeStream: () => {
        const handlers: Record<string, ((x?: unknown) => void) | undefined> = {};
        const stream = {
          on(ev: string, cb: (x?: unknown) => void) {
            handlers[ev] = cb;
            return stream;
          },
        };
        queueMicrotask(() => {
          try {
            const bytes = writeTrueType(
              ids.map((id) => this.outline(id)),
              {
                ascent: this.ascent,
                descent: this.descent,
                lineGap: this.primary.hhea.lineGap * this.sources[0]!.scale,
                fixedPitch: this.fixedPitch,
              },
            );
            handlers.data?.(bytes);
            handlers.end?.();
          } catch (e) {
            handlers.error?.(e);
          }
        });
        return stream;
      },
    };
  }
}

/** Contours of a glyph in font units, from WOFF2's decoded glyf data, with the variation applied. */
function rawOutline(s: Source, gid: number, depth: number): FkPoint[][] {
  const raw = s.font._transformedGlyphs![gid];
  if (!raw || raw.numberOfContours === 0 || depth > 8) return [];
  const vp = s.variable ? s.font._variationProcessor : null;
  // gvar deltas cover the glyph's points (or component offsets) plus 4 phantom points; the first
  // phantom point is the glyph origin.
  const vary = (pts: FkPoint[]): number => {
    if (!vp) return 0;
    const all = [
      ...pts,
      new Pt(false, true, 0, 0),
      new Pt(false, true, 0, 0),
      new Pt(false, true, 0, 0),
      new Pt(false, true, 0, 0),
    ];
    vp.transformPoints(gid, all);
    return all[pts.length]!.x;
  };
  if (raw.numberOfContours > 0) {
    const pts = (raw.points ?? []).map((p) => p.copy());
    const ox = vary(pts);
    const contours: FkPoint[][] = [];
    let cur: FkPoint[] = [];
    for (const p of pts) {
      p.x -= ox;
      cur.push(p);
      if (p.endContour) {
        contours.push(cur);
        cur = [];
      }
    }
    if (cur.length) contours.push(cur);
    return contours;
  }
  const comps = (raw.components ?? []).map((c) => ({ ...c }));
  const offsets = comps.map((c) => new Pt(true, true, c.dx, c.dy));
  const ox = vary(offsets);
  const out: FkPoint[][] = [];
  comps.forEach((c, k) => {
    const dx = offsets[k]!.x - ox,
      dy = offsets[k]!.y;
    for (const contour of rawOutline(s, c.glyphID, depth + 1))
      out.push(
        contour.map(
          (p) =>
            new Pt(
              p.onCurve,
              false,
              p.x * c.scaleX + p.y * c.scale01 + dx,
              p.y * c.scaleY + p.x * c.scale10 + dy,
            ),
        ),
      );
  });
  return out;
}

// ------------------------------------------------------------------------------ TrueType writer

class Bytes {
  private buf = new Uint8Array(1024);
  length = 0;
  private room(n: number) {
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  u8(v: number) {
    this.room(1);
    this.buf[this.length++] = v & 255;
  }
  u16(v: number) {
    this.u8(v >> 8);
    this.u8(v);
  }
  i16(v: number) {
    this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v: number) {
    this.u16(Math.floor(v / 0x10000) & 0xffff);
    this.u16(v & 0xffff);
  }
  bytes(b: Uint8Array) {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  pad4() {
    while (this.length % 4) this.u8(0);
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function checksum(b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < b.length; i += 4)
    sum =
      (sum + (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>>
      0;
  return sum;
}

const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, v));

/**
 * Writes a TrueType font (glyf outlines, no hinting) with the given glyphs, glyph 0 = .notdef.
 * Tables: those ISO 32000-1 §9.9 requires in an embedded TrueType program for a CIDFontType2
 * (glyf, head, hhea, hmtx, loca, maxp) and post.
 */
export function writeTrueType(
  glyphs: { contours: FkPoint[][]; advance: number }[],
  m: { ascent: number; descent: number; lineGap: number; fixedPitch: boolean },
): Uint8Array {
  const glyf = new Bytes();
  const loca: number[] = [];
  const hmtx = new Bytes();
  let maxPoints = 0,
    maxContours = 0,
    advMax = 0;
  let minLsb = 32767,
    minRsb = 32767,
    maxExtent = -32768;
  let fx0 = 32767,
    fy0 = 32767,
    fx1 = -32768,
    fy1 = -32768;
  for (const g of glyphs) {
    loca.push(glyf.length);
    const contours = g.contours.filter((c) => c.length > 0);
    const advance = Math.max(0, Math.min(0xffff, Math.round(g.advance)));
    advMax = Math.max(advMax, advance);
    if (!contours.length) {
      hmtx.u16(advance);
      hmtx.i16(0);
      continue;
    }
    const pts = contours
      .flat()
      .map((p) => ({ x: clamp16(Math.round(p.x)), y: clamp16(Math.round(p.y)), on: p.onCurve }));
    let x0 = 32767,
      y0 = 32767,
      x1 = -32768,
      y1 = -32768;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    fx0 = Math.min(fx0, x0);
    fy0 = Math.min(fy0, y0);
    fx1 = Math.max(fx1, x1);
    fy1 = Math.max(fy1, y1);
    minLsb = Math.min(minLsb, x0);
    minRsb = Math.min(minRsb, advance - x1);
    maxExtent = Math.max(maxExtent, x1);
    maxPoints = Math.max(maxPoints, pts.length);
    maxContours = Math.max(maxContours, contours.length);
    hmtx.u16(advance);
    hmtx.i16(x0);
    // header, endPtsOfContours, no instructions
    glyf.i16(contours.length);
    glyf.i16(x0);
    glyf.i16(y0);
    glyf.i16(x1);
    glyf.i16(y1);
    let end = -1;
    for (const c of contours) glyf.u16((end += c.length));
    glyf.u16(0);
    // flags and coordinates (deltas), ISO/IEC 14496-22 §5.3.3
    const flags: number[] = [];
    const xs = new Bytes(),
      ys = new Bytes();
    let px = 0,
      py = 0;
    for (const p of pts) {
      let f = p.on ? 0x01 : 0;
      const dx = p.x - px,
        dy = p.y - py;
      if (dx === 0) f |= 0x10;
      else if (Math.abs(dx) <= 255) {
        f |= 0x02 | (dx > 0 ? 0x10 : 0);
        xs.u8(Math.abs(dx));
      } else xs.i16(dx);
      if (dy === 0) f |= 0x20;
      else if (Math.abs(dy) <= 255) {
        f |= 0x04 | (dy > 0 ? 0x20 : 0);
        ys.u8(Math.abs(dy));
      } else ys.i16(dy);
      flags.push(f);
      px = p.x;
      py = p.y;
    }
    flags[0]! |= 0x40; // OVERLAP_SIMPLE: flattened composites and variable outlines overlap
    for (let i = 0; i < flags.length;) {
      let n = 1;
      while (i + n < flags.length && flags[i + n] === flags[i] && n < 256) n++;
      if (n > 2) {
        glyf.u8(flags[i]! | 0x08);
        glyf.u8(n - 1);
      } else for (let k = 0; k < n; k++) glyf.u8(flags[i]!);
      i += n;
    }
    glyf.bytes(xs.done());
    glyf.bytes(ys.done());
    glyf.pad4();
  }
  loca.push(glyf.length);
  if (fx0 > fx1) fx0 = fy0 = fx1 = fy1 = 0;
  if (minLsb > maxExtent) minLsb = minRsb = maxExtent = 0;
  const n = glyphs.length;

  const head = new Bytes();
  head.u32(0x00010000); // version
  head.u32(0x00010000); // fontRevision
  head.u32(0); // checkSumAdjustment, set below
  head.u32(0x5f0f3cf5);
  head.u16(0x0003); // baseline at y = 0, left sidebearing at x = 0
  head.u16(1000);
  for (let k = 0; k < 4; k++) head.u32(0); // created, modified (fixed: reproducible files)
  head.i16(fx0);
  head.i16(fy0);
  head.i16(fx1);
  head.i16(fy1);
  head.u16(0); // macStyle
  head.u16(6); // lowestRecPPEM
  head.i16(2); // fontDirectionHint
  head.i16(1); // indexToLocFormat: long
  head.i16(0);

  const hhea = new Bytes();
  hhea.u32(0x00010000);
  hhea.i16(clamp16(Math.round(m.ascent)));
  hhea.i16(clamp16(Math.round(m.descent)));
  hhea.i16(clamp16(Math.round(m.lineGap)));
  hhea.u16(advMax);
  hhea.i16(minLsb);
  hhea.i16(minRsb);
  hhea.i16(maxExtent);
  hhea.i16(1); // caretSlopeRise
  hhea.i16(0);
  hhea.i16(0);
  for (let k = 0; k < 5; k++) hhea.i16(0); // reserved, metricDataFormat
  hhea.u16(n);

  const maxp = new Bytes();
  maxp.u32(0x00010000);
  maxp.u16(n);
  maxp.u16(maxPoints);
  maxp.u16(maxContours);
  maxp.u16(0); // maxCompositePoints
  maxp.u16(0); // maxCompositeContours
  maxp.u16(2); // maxZones
  for (let k = 0; k < 8; k++) maxp.u16(0); // twilight, storage, fdefs, idefs, stack, instructions, components, depth

  const post = new Bytes();
  post.u32(0x00030000); // no glyph names
  post.u32(0); // italicAngle
  post.i16(-100);
  post.i16(50);
  post.u32(m.fixedPitch ? 1 : 0);
  for (let k = 0; k < 4; k++) post.u32(0);

  const locaB = new Bytes();
  for (const o of loca) locaB.u32(o);

  const tables: [string, Uint8Array][] = [
    ['glyf', glyf.done()],
    ['head', head.done()],
    ['hhea', hhea.done()],
    ['hmtx', hmtx.done()],
    ['loca', locaB.done()],
    ['maxp', maxp.done()],
    ['post', post.done()],
  ];
  const out = new Bytes();
  const nt = tables.length;
  const sel = Math.floor(Math.log2(nt));
  out.u32(0x00010000);
  out.u16(nt);
  out.u16(2 ** sel * 16);
  out.u16(sel);
  out.u16(nt * 16 - 2 ** sel * 16);
  let offset = 12 + nt * 16;
  for (const [tag, data] of tables) {
    for (let k = 0; k < 4; k++) out.u8(tag.charCodeAt(k));
    out.u32(checksum(data));
    out.u32(offset);
    out.u32(data.length);
    offset += Math.ceil(data.length / 4) * 4;
  }
  let headAt = 0;
  for (const [tag, data] of tables) {
    if (tag === 'head') headAt = out.length;
    out.bytes(data);
    out.pad4();
  }
  const font = out.done();
  const adj = (0xb1b0afba - checksum(font)) >>> 0;
  new DataView(font.buffer, font.byteOffset).setUint32(headAt + 8, adj);
  return font;
}

// --------------------------------------------------------------------------------------- embedding

export type PdfFonts = Record<PdfFontRole, PDFFont>;

export interface EmbeddedFonts {
  fonts: PdfFonts;
  /** True when the site fonts could not be loaded and the standard PDF fonts are used instead. */
  standard: boolean;
}

/**
 * Embeds the guide's six fonts in `doc`. `texts` is everything the guide may print (messages,
 * names, formatted numbers): it decides which subset files to load beyond the latin ones.
 * If a latin file cannot be loaded (offline, blocked), every font falls back to the 14 standard
 * fonts (Helvetica, Courier; WinAnsi text, see `winAnsiSafe`); another subset that fails is
 * skipped and its characters get the replacements above.
 */
export async function embedPdfFonts(
  doc: PDFDocument,
  texts: Iterable<string>,
  load: FontLoader = defaultFontLoader,
): Promise<EmbeddedFonts> {
  const needed = new Set<number>();
  for (const t of texts) for (const ch of t.normalize('NFC')) needed.add(ch.codePointAt(0)!);

  // per face: the files to load, in chain order: the latin file of each family, and any other
  // subset whose range has a needed character that the files before it do not declare
  const plans = new Map<PdfFontRole, ChainItem[]>();
  for (const role of ROLES) {
    const covered: Ranges[] = [];
    const list: ChainItem[] = [];
    for (const item of chain(role)) {
      const useful =
        item.primary ||
        [...needed].some((cp) => inRanges(cp, item.spec.ranges) && !covered.some((r) => inRanges(cp, r)));
      if (useful) list.push(item);
      covered.push(item.spec.ranges);
    }
    plans.set(role, list);
  }

  const loaded = new Map<PdfFontRole, { font: FkFont; variable: boolean }[]>();
  const results = await Promise.all(
    ROLES.map(async (role) => {
      const fonts = await Promise.all(
        plans.get(role)!.map(async ({ spec, variation, primary }) => {
          try {
            return { font: await loadFont(spec, variation, load), variable: variation !== undefined };
          } catch {
            return primary ? 'failed' : null;
          }
        }),
      );
      loaded.set(
        role,
        fonts.filter((f): f is { font: FkFont; variable: boolean } => f !== null && f !== 'failed'),
      );
      return fonts.includes('failed');
    }),
  );

  if (results.some(Boolean)) {
    const fonts = {} as PdfFonts;
    const byName = new Map<StandardFonts, PDFFont>();
    for (const role of ROLES) {
      const name = PDF_FACES[role].standard;
      let f = byName.get(name);
      if (!f) byName.set(name, (f = await doc.embedFont(name)));
      fonts[role] = f;
    }
    return { fonts, standard: true };
  }

  const faces = new Map<Uint8Array, MergedFont>();
  doc.registerFontkit({
    create: (bytes: Uint8Array) => {
      const f = faces.get(bytes);
      if (!f) throw new Error('pdfFonts: unknown font');
      return f;
    },
  } as unknown as Parameters<PDFDocument['registerFontkit']>[0]);
  const fonts = {} as PdfFonts;
  for (const role of ROLES) {
    const face = PDF_FACES[role];
    const merged = new MergedFont(face.name, loaded.get(role)!, role === 'mono' || role === 'monoBold');
    const key = new Uint8Array(1);
    faces.set(key, merged);
    fonts[role] = await doc.embedFont(key, { subset: true, customName: `${face.tag}+${face.name}` });
  }
  return { fonts, standard: false };
}

// ------------------------------------------------------------------- standard fonts (fallback)

const WIN_ANSI_REPLACE: Record<string, string> = {
  ...REPLACE,
  '↑': '^',
  '↓': 'v',
  '−': '-',
  '‑': '-',
  '‐': '-',
  '\u00a0': ' ',
  '\u202f': ' ',
};

/** Maps text to what the standard fonts can encode (WinAnsi), for the offline fallback. */
export function winAnsiSafe(font: PDFFont, s: string, cache: Map<PDFFont, Set<number>>): string {
  let set = cache.get(font);
  if (!set) cache.set(font, (set = new Set(font.getCharacterSet())));
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (set.has(cp)) out += ch;
    else if (WIN_ANSI_REPLACE[ch] !== undefined) out += WIN_ANSI_REPLACE[ch];
    else if (ch === '\n' || ch === '\t') out += ' ';
    else
      out += ch
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\x20-\x7e]/g, '?');
  }
  return out;
}
