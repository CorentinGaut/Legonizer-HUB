/**
 * Phase 2 core additions: legacy calque (look of UD-Viz generateCadastre), plate grid and labels,
 * baseline JPEG encoder, brick glyphs (same geometry as the UI reference), PDF build guide (O5)
 * with plate-pass QR codes (O10), plan raster (2D mode), engine restore / project / zip exports.
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { SYNTHETIC_CENTRE, syntheticBoxesCity } from '../../src/core/samples/synthetic.ts';
import { importCityModel } from '../../src/core/import/index.ts';
import { generateHeightMap } from '../../src/core/heightmap/index.ts';
import { packHeightMap } from '../../src/core/packing/pack.ts';
import { defaultParams, type HeightMap } from '../../src/core/types.ts';
import {
  LEGACY_TOP_GREY,
  legacyCalqueJpeg,
  legacyCalqueLayout,
  rasterizeCalque,
  rasterizeLegacyCalque,
} from '../../src/core/export/calque.ts';
import { encodeJpeg, scaledQuantTable } from '../../src/core/export/jpeg.ts';
import { baseplateGlyph, brickIsoGlyph } from '../../src/core/export/glyphs.ts';
import { renderPdfGuide } from '../../src/core/export/pdfGuide.ts';
import { ALL_SECTIONS, PDF_MESSAGE_KEYS, pdfPageCount } from '../../src/core/export/pdfPlan.ts';
import { normalizeInventory } from '../../src/core/packing/catalog.ts';
import {
  decodePlatePass,
  encodePlatePass,
  passFitsQr,
  platePassUrl,
} from '../../src/core/export/platePass.ts';
import { planRaster } from '../../src/core/heightmap/planRaster.ts';
import { createEngineHost } from '../../src/core/worker/engine.ts';
import { EngineClient, type WorkerLike } from '../../src/core/worker/client.ts';
import type { EngineRequest, EngineResponse } from '../../src/core/worker/protocol.ts';
import { parseGuideRoute } from '../../src/create/route.ts';

function hm(cols: number, rows: number, f: (i: number, j: number) => number): HeightMap {
  const data = new Int32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) data[j * cols + i] = f(i, j);
  return { cols, rows, data };
}

function px(img: Uint8ClampedArray, W: number, x: number, y: number): number[] {
  const o = (y * W + x) * 4;
  return [img[o]!, img[o + 1]!, img[o + 2]!];
}

function enMessages(): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const ns of ['create', 'exports', 'errors', 'common', 'footer']) {
    const walk = (t: Record<string, unknown>, p: string) => {
      for (const [k, v] of Object.entries(t)) {
        if (typeof v === 'string') flat[`${p}.${k}`] = v;
        else walk(v as Record<string, unknown>, `${p}.${k}`);
      }
    };
    walk(JSON.parse(readFileSync(`src/i18n/en/${ns}.json`, 'utf8')), ns);
  }
  const out: Record<string, string> = {};
  for (const k of PDF_MESSAGE_KEYS) out[k] = flat[k]!;
  return out;
}

describe('legacy calque (O2: calqueTemplate.jpg as UD-Viz rendered it)', () => {
  it('grey Phong top faces, X diagonals, the near-plane quirk above 8 bricks, 1920 px long side', () => {
    const h = hm(64, 32, (i) => (i < 4 ? 0 : i < 8 ? 1 : i < 12 ? 9 : 3));
    const l = legacyCalqueLayout(h);
    expect([l.width, l.height]).toEqual([1920, 960]);
    const img = rasterizeLegacyCalque(h, l);
    const c = l.cell; // 30 px per stud
    const centre = (i: number, j: number) =>
      px(img, l.width, Math.floor((i + 0.5) * c) + 3, Math.floor((31 - j + 0.5) * c));
    expect(centre(1, 5)).toEqual([255, 255, 255]); // empty stud: background
    expect(centre(5, 5)).toEqual([LEGACY_TOP_GREY, LEGACY_TOP_GREY, LEGACY_TOP_GREY]); // 1 brick: lit top face
    expect(centre(9, 5)).toEqual([255, 255, 255]); // 9 bricks: top above the camera's near plane
    // each cell outline is drawn 3 times at 25 % (top edge, bottom edge, side diagonal), each pass
    // spread over the two pixels either side of the boundary like the GPU's MSAA; an edge shared by
    // two 1-brick studs is therefore darkened by 6 passes at 12.5 %
    const edge = px(img, l.width, Math.round(6 * c), Math.round(10.5 * c));
    expect(Math.abs(edge[0]! - LEGACY_TOP_GREY * 0.875 ** 6)).toBeLessThanOrEqual(2);
  });

  it('plate grid and labels are drawn on request only', () => {
    const h = hm(64, 64, () => 0);
    const l = legacyCalqueLayout(h);
    const plain = rasterizeCalque(h, l);
    expect(plain.every((v) => v === 255)).toBe(true);
    const marked = rasterizeCalque(h, l, { plateGrid: true, labels: true });
    // grid line at the plate boundary (x = 960) and ink in the A1 label corner
    expect(px(marked, l.width, 960, 100)).not.toEqual([255, 255, 255]);
    let ink = 0;
    for (let y = 20; y < 120; y++)
      for (let x = 20; x < 160; x++) if (px(marked, l.width, x, y)[2]! < 250) ink++;
    expect(ink).toBeGreaterThan(200);
  });

  it('baseline JPEG: JFIF markers, size, quality scaling (IJG)', () => {
    const jpg = legacyCalqueJpeg(hm(32, 32, (i, j) => (i + j) % 4));
    expect([jpg[0], jpg[1], jpg[jpg.length - 2], jpg[jpg.length - 1]]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    const sof = jpg.findIndex((b, k) => b === 0xff && jpg[k + 1] === 0xc0);
    expect(sof).toBeGreaterThan(0);
    const dv = new DataView(jpg.buffer, jpg.byteOffset);
    expect([dv.getUint16(sof + 7), dv.getUint16(sof + 5)]).toEqual([1920, 1920]);
    expect(scaledQuantTable([16, 11], 50)).toEqual(Uint8Array.from([16, 11]));
    expect(scaledQuantTable([16, 11], 92)).toEqual(Uint8Array.from([3, 2]));
    // a flat image compresses to almost nothing (DC-only blocks)
    expect(encodeJpeg(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64, 64).length).toBeLessThan(800);
  });
});

describe('brick glyphs', () => {
  it('same geometry as the reference glyphs (test/fixtures/brick-glyphs.json)', () => {
    const ref = JSON.parse(readFileSync('test/fixtures/brick-glyphs.json', 'utf8')).glyphs as {
      w: number;
      l: number;
      vbw: number;
      vbh: number;
      part: string;
    }[];
    for (const g of ref) {
      const ours = g.part === 'baseplate' ? baseplateGlyph(32) : brickIsoGlyph(g.w, g.l);
      expect([ours.viewBox[2], ours.viewBox[3]]).toEqual([g.vbw, g.vbh]);
    }
  });
});

describe('PDF build guide (O5) and plate passes (O10)', () => {
  const mesh = importCityModel(syntheticBoxesCity(1));
  const area = { cx: SYNTHETIC_CENTRE[0], cy: SYNTHETIC_CENTRE[1], rotationDeg: 0 };
  const params = { ...defaultParams(2, 2), keepSmall: true };
  const heightMap = generateHeightMap(mesh, area, params).heightMap;
  const packing = packHeightMap(heightMap);
  const input = {
    title: 'Synthétique “test” – Œuvre',
    heightMap,
    packing,
    params,
    area,
    inventory: normalizeInventory({}),
    paper: 'A4' as const,
    messages: enMessages(),
    locale: 'en',
    date: '2026-10-06T12:00:00Z',
    presetName: 'Legacy (UD-Viz 4.6.1) with small buildings kept',
    differences: ['Keep small buildings (at least 1 brick)'],
    passBaseUrl: 'https://example.org/legonizer/create.html',
  };

  it('page count matches the plan, A4 and Letter sizes, metadata, deterministic for a given date', async () => {
    const bytes = await renderPdfGuide(input);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(pdfPageCount(packing, ALL_SECTIONS));
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
    expect(doc.getTitle()).toContain('Synth');
    const again = await renderPdfGuide(input);
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
    const letter = await PDFDocument.load(
      await renderPdfGuide({ ...input, paper: 'Letter', sections: { layers: false } }),
    );
    expect(Math.round(letter.getPage(0).getSize().height)).toBe(792);
    expect(letter.getPageCount()).toBe(pdfPageCount(packing, { ...ALL_SECTIONS, layers: false }));
  });

  it('progress per page and cancel', async () => {
    const seen: number[] = [];
    await renderPdfGuide({
      ...input,
      sections: { cover: false, shopping: false, projection: false, passes: false },
      progress: (_s, f) => seen.push(f),
    });
    expect(seen.at(-1)).toBe(1);
    const ctrl = new AbortController();
    const p = renderPdfGuide({ ...input, signal: ctrl.signal, progress: (_s, f) => f > 0.2 && ctrl.abort() });
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('pass URLs carry the plate in the fragment, decode back, and respect the QR budget (UI-8)', () => {
    const route = parseGuideRoute('guide/build/B2/3&d=abc_-');
    expect(route).toEqual({ tab: 'build', plate: 'B2', layer: 3, payload: 'abc_-' });
    const url = platePassUrl('https://example.org/legonizer/create.html?x=1#old', 'A1', 'PAYLOAD');
    expect(url).toBe('https://example.org/legonizer/create.html?x=1#guide/build/A1/1&d=PAYLOAD');
    expect(passFitsQr('x'.repeat(412)).fits).toBe(true);
    expect(passFitsQr('x'.repeat(413))).toMatchObject({ fits: false, version: 16 });
    const heights = new Int32Array(1024).map((_, k) => (k % 7 === 0 ? 3 : 0));
    const real = platePassUrl(
      'https://example.org/c.html',
      'B2',
      encodePlatePass({ plate: 'B2', heights, title: 'Part-Dieu' }),
    );
    const back = decodePlatePass(parseGuideRoute(real.split('#')[1]!).payload!);
    expect(back.plate).toBe('B2');
    expect([...back.heights]).toEqual([...heights]);
  });
});

describe('plan raster (2D mode)', () => {
  it('top height per cell, highest surface wins, empty cells are NaN', () => {
    const mesh = importCityModel(syntheticBoxesCity(1));
    const b = mesh.bounds;
    const r = planRaster(mesh, {
      minX: b.min[0],
      minY: b.min[1],
      maxX: b.max[0],
      maxY: b.max[1],
      width: 200,
      height: 200,
    });
    let covered = 0,
      top = -Infinity;
    for (const z of r.z)
      if (!Number.isNaN(z)) {
        covered++;
        top = Math.max(top, z);
      }
    expect(covered).toBeGreaterThan(2000);
    expect(covered).toBeLessThan(40000);
    expect(top).toBeCloseTo(b.max[2], 0);
  });
});

describe('engine: restore, project file, estimate extras, new exports', () => {
  function connect() {
    const port: WorkerLike = {
      onmessage: null,
      postMessage(msg, transfer) {
        const copy = structuredClone(msg, { transfer: transfer ?? [] }) as EngineRequest;
        setTimeout(() => void host.onMessage(copy), 0);
      },
      terminate() {},
    };
    const host = createEngineHost((msg: EngineResponse, transfer) => {
      const copy = structuredClone(msg, { transfer: transfer ?? [] });
      setTimeout(() => port.onmessage?.({ data: copy } as MessageEvent), 0);
    });
    return new EngineClient(port);
  }
  const area = { cx: SYNTHETIC_CENTRE[0], cy: SYNTHETIC_CENTRE[1], rotationDeg: 0 };

  it('estimate gives fixes, the sampled stud share (UI-17) and per-building data', async () => {
    const c = connect();
    const files = [...syntheticBoxesCity(1)].map(([path, data]) => ({ path, data }));
    const summary = await c.request('import', { files }).promise;
    expect(summary.idSource).toBe('gml_id');
    expect(summary.meta.tiles).toBe(4);
    const est = await c.request('estimate', { area, params: defaultParams(4, 4) }).promise;
    expect(est.selected.length).toBe(est.features);
    expect(est.selectedBoxes.length).toBe(4 * est.features);
    expect(est.below.length).toBe(est.featuresBelowOneBrick);
    expect(est.sampled!.builtStuds).toBeGreaterThan(est.sampled!.erasedStuds);
    if (est.featuresBelowOneBrick) expect(est.fixes.maxHeight!.value).toBeGreaterThan(10);
    expect(est.fixes.trueScale.maxBricks).toBeGreaterThan(0);
    expect(est.tallestInfo!.height).toBeGreaterThan(50);
  });

  it('a project file restores identical exports without the source (GuideOnly)', async () => {
    const a = connect();
    const files = [...syntheticBoxesCity(1)].map(([path, data]) => ({ path, data }));
    await a.request('import', { files }).promise;
    const gen = await a.request('generate', { area, params: defaultParams(2, 2) }).promise;
    const [proj] = await a.request('export', { kind: 'project', options: { title: 'T' } }).promise;
    const [csvA] = await a.request('export', { kind: 'csv' }).promise;
    const [blA] = await a.request('export', {
      kind: 'bricklink',
      options: { spares: 10, baseplateColour: 'grey' },
    }).promise;
    expect(String(blA!.data)).toContain('<COLOR>86</COLOR>');
    const b = connect();
    const r = await b.request('open-project', { text: String(proj!.data) }).promise;
    expect(r.packing.total).toBe(gen.packing.total);
    const [csvB] = await b.request('export', { kind: 'csv' }).promise;
    expect(csvB!.data).toBe(csvA!.data);
    const [blB] = await b.request('export', {
      kind: 'bricklink',
      options: { spares: 10, baseplateColour: 'grey' },
    }).promise;
    expect(blB!.data).toBe(blA!.data);
    // restore from heights (reload) gives the same packing too
    const c = connect();
    const packing = await c.request('restore', {
      area,
      params: defaultParams(2, 2),
      heightMap: gen.heightmap.heightMap,
    }).promise;
    expect(packing.bricks).toEqual(gen.packing.bricks);
    const [jpg] = await c.request('export', {
      kind: 'calque-jpeg',
      options: { plateGrid: true, labels: true },
    }).promise;
    expect(jpg!.name).toBe('calqueTemplate.jpg');
    const [zip] = await c.request('export', {
      kind: 'all',
      options: {
        title: 'T',
        fileBase: 'T',
        messages: enMessages(),
        readme: 'hello',
        date: '2026-10-06T00:00:00Z',
      },
    }).promise;
    const names = Object.keys(unzipSync(zip!.data as Uint8Array)).sort();
    expect(names).toEqual(
      [
        'README.txt',
        'calqueTemplate.jpg',
        'legoPlates_2_2.csv',
        't-bricklink.xml',
        't-build-guide-A4.pdf',
        't-rebrickable.csv',
        't.ldr',
        't.legonizer.json',
      ].sort(),
    );
  });
});
