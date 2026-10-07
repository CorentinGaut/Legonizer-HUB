import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brickLinkXml, BRICKLINK_MAX_BYTES } from '../../src/core/export/bricklink.ts';
import {
  encodePng,
  legacyCalqueLayout,
  physicalCalqueLayout,
  rasterizeCalque,
} from '../../src/core/export/calque.ts';
import { csvFileName, heightMapToCsv, parseHeightMapCsv, perPlateCsv } from '../../src/core/export/csv.ts';
import { buildGuide, heightHistogram, plateHeights } from '../../src/core/export/guide.ts';
import { ldrawModel, ldrawMpd } from '../../src/core/export/ldraw.ts';
import {
  decodePlatePass,
  encodePlatePass,
  platePassUrlInfo,
  qrVersionFor,
} from '../../src/core/export/platePass.ts';
import {
  checkInputs,
  createProject,
  hashInputs,
  parseProject,
  projectHeightMap,
  serializeProject,
} from '../../src/core/export/project.ts';
import { rebrickableCsv } from '../../src/core/export/rebrickable.ts';
import { generateHeightMap } from '../../src/core/heightmap/index.ts';
import { importCityModel } from '../../src/core/import/index.ts';
import { BRICKS, partById } from '../../src/core/packing/catalog.ts';
import { packHeightMap } from '../../src/core/packing/pack.ts';
import { SYNTHETIC_CENTRE, syntheticBoxesCity } from '../../src/core/samples/synthetic.ts';
import { defaultParams, type HeightMap } from '../../src/core/types.ts';
import { APP_VERSION } from '../../src/core/version.ts';

const files = syntheticBoxesCity(1);
const mesh = importCityModel(files);
const params = { ...defaultParams(2, 2), heightMode: 'true-scale' as const, keepSmall: true };
const area = { cx: SYNTHETIC_CENTRE[0], cy: SYNTHETIC_CENTRE[1], rotationDeg: 0 };
const hm = generateHeightMap(mesh, area, params).heightMap;
const packing = packHeightMap(hm);

describe('CSV (O1)', () => {
  it('legacy layout: north row first, ";" separators, "\\n" after every row, fixed file name', () => {
    const small: HeightMap = { cols: 32, rows: 32, data: new Int32Array(1024) };
    small.data[0] = 7; // south-west corner → last line, first value
    small.data[1023] = 3; // north-east corner → first line, last value
    const csv = heightMapToCsv(small);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(33);
    expect(lines[32]).toBe('');
    expect(lines[0]!.endsWith(';3')).toBe(true);
    expect(lines[31]!.startsWith('7;')).toBe(true);
    expect(csvFileName(3, 2)).toBe('legoPlates_3_2.csv');
    expect(parseHeightMapCsv(csv)).toEqual(small);
  });

  it('one CSV per baseplate, A1 = north-west', () => {
    const per = perPlateCsv(hm);
    expect(per.map((p) => p.plate)).toEqual(['A1', 'B1', 'A2', 'B2']);
    const a2 = parseHeightMapCsv(per[2]!.content);
    expect(Array.from(a2.data)).toEqual(Array.from(plateHeights(hm, 0, 0)));
  });
});

describe('shop exports (O6, O7)', () => {
  it('BrickLink wanted list: no XML declaration, P items, colour 1, baseplates included, < 204,800 bytes', () => {
    const xml = brickLinkXml(packing);
    expect(xml.startsWith('<INVENTORY>')).toBe(true);
    expect(xml).not.toContain('<?xml');
    const items = [
      ...xml.matchAll(
        /<ITEM>\s*<ITEMTYPE>P<\/ITEMTYPE>\s*<ITEMID>(\w+)<\/ITEMID>\s*<COLOR>1<\/COLOR>\s*<MINQTY>(\d+)<\/MINQTY>\s*<\/ITEM>/g,
      ),
    ];
    const total = items.filter((m) => m[1] !== '3811').reduce((a, m) => a + Number(m[2]), 0);
    expect(total).toBe(packing.total);
    expect(items.find((m) => m[1] === '3811')![2]).toBe('4');
    expect(new TextEncoder().encode(xml).length).toBeLessThan(BRICKLINK_MAX_BYTES);
    expect(brickLinkXml(packing, { condition: 'N', remarks: 'a<b & c' })).toContain(
      '<REMARKS>a&lt;b &amp; c</REMARKS>',
    );
  });

  it('Rebrickable CSV: Part,Color,Quantity with colour 15', () => {
    const csv = rebrickableCsv(packing);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Part,Color,Quantity');
    for (const l of lines.slice(1)) expect(l).toMatch(/^\d+,15,\d+$/);
    expect(
      lines.slice(1).reduce((a, l) => a + (l.startsWith('3811,') ? 0 : Number(l.split(',')[2])), 0),
    ).toBe(packing.total);
  });
});

describe('LDraw (O8)', () => {
  /** Re-derives stud occupancy per layer from the type-1 lines. */
  function occupancy(text: string, platesX: number, platesY: number) {
    const cols = platesX * 32,
      rows = platesY * 32;
    const grid = new Map<number, Int32Array>();
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (t[0] !== '1' || t[14] === '3811.dat' || !t[14]!.endsWith('.dat')) continue;
      expect(t[1]).toBe('15');
      const [x, y, z] = [Number(t[2]), Number(t[3]), Number(t[4])];
      const m = t.slice(5, 14).map(Number);
      const part = BRICKS.find((b) => b.ldrawFile === t[14])!;
      // part X axis (length) maps to world column m[0], m[3], m[6]
      const alongZ = m[6] === 1;
      const w = alongZ ? part.width : part.length,
        d = alongZ ? part.length : part.width;
      const layer = -y / 24;
      expect(Number.isInteger(layer)).toBe(true);
      const x0 = x / 20 + cols / 2 - w / 2,
        y0 = z / 20 + rows / 2 - d / 2;
      let g = grid.get(layer);
      if (!g) grid.set(layer, (g = new Int32Array(cols * rows)));
      for (let j = y0; j < y0 + d; j++) for (let i = x0; i < x0 + w; i++) g[j * cols + i]!++;
    }
    return grid;
  }

  it('.ldr: 20 LDU per stud, 24 per brick, −Y up, +Z north, colour 15, one STEP per layer; footprint equals the height matrix', () => {
    const text = ldrawModel(packing, 2, { title: 'Test' });
    expect(text.split('\r\n')[0]).toBe('0 Test');
    const occ = occupancy(text, 2, 2);
    for (const [layer, g] of occ) {
      for (let c = 0; c < g.length; c++) expect(g[c]).toBe(hm.data[c]! >= layer ? 1 : 0);
    }
    const maxLayer = Math.max(...hm.data);
    expect(occ.size).toBe(maxLayer);
    expect((text.match(/3811\.dat/g) ?? []).length).toBe(4);
  });

  it('MPD: main model + one 0 FILE … 0 NOFILE submodel per baseplate', () => {
    const mpd = ldrawMpd(packing, 2);
    const files = [...mpd.matchAll(/^0 FILE (.+)$/gm)].map((m) => m[1]!.trim());
    expect(files).toEqual(['legonizer.ldr', 'plate-A1.ldr', 'plate-B1.ldr', 'plate-A2.ldr', 'plate-B2.ldr']);
    expect((mpd.match(/^0 NOFILE/gm) ?? []).length).toBe(5);
    expect(mpd).toContain('1 15 -320 0 320 1 0 0 0 1 0 0 0 1 plate-A1.ldr'); // north-west plate at −X, +Z
  });

  it('every catalog part id resolves to an LDraw file', () => {
    for (const b of BRICKS) expect(partById(b.id)!.ldrawFile).toBe(`${b.id}.dat`);
  });
});

describe('build guide, plate passes, project file, calque', () => {
  it('guide: one step per plate and layer with a parts callout', () => {
    const guide = buildGuide(packing);
    expect(guide.map((g) => g.plate)).toEqual(['A1', 'B1', 'A2', 'B2']);
    const steps = guide.flatMap((g) => g.steps);
    expect(steps.reduce((a, s) => a + s.bricks.length, 0)).toBe(packing.total);
    for (const s of steps) expect(s.callout.reduce((a, c) => a + c.quantity, 0)).toBe(s.bricks.length);
    expect(heightHistogram(hm).reduce((a, b) => a + b, 0)).toBe(hm.data.length);
  });

  it('plate pass round-trips and stays QR-sized', () => {
    for (const p of packing.plates) {
      const heights = plateHeights(hm, p.col, p.southRow);
      const payload = encodePlatePass({
        plate: p.plate,
        heights,
        inventory: { enabled: ['3001', '3003'], maxLength: 4 },
        title: 'Part-Dieu',
      });
      expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
      const back = decodePlatePass(payload);
      expect(back.plate).toBe(p.plate);
      expect(Array.from(back.heights)).toEqual(Array.from(heights));
      expect(back.inventory).toEqual({ enabled: ['3005', '3003', '3001'], maxLength: 4 });
      expect(back.appVersion).toBe(APP_VERSION);
      // the decoded pass regenerates exactly this plate's packing (plate-local)
      const again = packHeightMap({ cols: 32, rows: 32, data: back.heights }, back.inventory);
      const orig = packHeightMap(hm, back.inventory).bricks.filter((b) => b.plate === p.plate);
      expect(again.bricks.map((b) => ({ ...b, plate: '' }))).toEqual(orig.map((b) => ({ ...b, plate: '' })));
      const info = platePassUrlInfo('https://vcityteam.github.io/legonizer/guide.html', payload);
      expect(info.qrVersion).not.toBeNull();
    }
    expect(qrVersionFor(17, 'L')).toBe(1);
    expect(qrVersionFor(2953, 'L')).toBe(40);
    expect(qrVersionFor(2954, 'L')).toBeNull();
    expect(() => decodePlatePass('not*base64')).toThrow();
  });

  it('project file round-trips the heights and checks input hashes', async () => {
    const inputs = await hashInputs(files);
    expect(inputs[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const proj = createProject({
      inputs,
      area,
      params,
      heightMap: hm,
      inventory: { maxLength: 6 },
      title: 'Synthetic',
      createdAt: '2026-10-06T00:00:00Z',
    });
    const back = parseProject(serializeProject(proj));
    expect(back.params).toEqual(params);
    expect(back.inventory.maxLength).toBe(6);
    expect(projectHeightMap(back)).toEqual(hm);
    expect(packHeightMap(projectHeightMap(back), back.inventory).bricks).toEqual(
      packHeightMap(hm, { maxLength: 6 }).bricks,
    );
    expect(await checkInputs(back, files)).toEqual({ missing: [], changed: [] });
    const altered = new Map(files);
    altered.set('tiles/0.b3dm', new Uint8Array([1, 2, 3]));
    altered.delete('tiles/1.b3dm');
    expect(await checkInputs(back, altered)).toEqual({
      missing: ['tiles/1.b3dm'],
      changed: ['tiles/0.b3dm'],
    });
    expect(() => parseProject('{"format":"other"}')).toThrow(/Not a Legonizer project/);
  });

  it('calque: legacy 1920 px long side; PNG with pHYs at the physical size', () => {
    const tall: HeightMap = { cols: 3 * 32, rows: 7 * 32, data: new Int32Array(3 * 7 * 1024).fill(1) };
    const l = legacyCalqueLayout(tall);
    expect([l.width, l.height]).toEqual([Math.floor(3 * (1920 / 7)), 1920]);
    const p = physicalCalqueLayout(hm, 25.4);
    expect(p.width).toBe(512); // 64 studs × 8 mm at 1 px/mm
    const png = encodePng(rasterizeCalque(hm, p, { plateGrid: true }), p.width, p.height, p.dpi);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(png.buffer, png.byteOffset);
    expect(dv.getUint32(16)).toBe(512);
    const phys = Buffer.from(png).indexOf('pHYs');
    expect(dv.getUint32(phys + 4)).toBe(1000); // 25.4 dpi = 1,000 px per metre
  });
});

describe('versions', () => {
  it('APP_VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8'));
    expect(APP_VERSION).toBe(pkg.version);
  });
});
