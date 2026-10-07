/**
 * Demo path (SPEC §10.2): Try with Part-Dieu → default area → Generate → build guide → CSV, parts
 * list, instructions, PDF, BrickLink, LDraw — timed. Consistency of numbers across exports
 * (ux-spec §8.1), the legacy CSV byte for byte against legonizer@1.1.0 (SPEC §10.3), and the
 * LDraw file parsed back into the height matrix (SPEC O8; the LeoCAD open stays a manual check).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { BRICKS } from '../src/core/packing/catalog.ts';
import {
  OUT,
  ROOT,
  generateFromArea,
  hasPartDieu,
  loadDemo,
  primary,
  saveDownload,
} from './create-helpers.ts';

const DEMO = hasPartDieu ? 'part-dieu' : 'sample';

/** Height matrix (north row first) from the legacy CSV. */
function parseCsv(text: string): number[][] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(';').map(Number));
}

/** Studs covered per layer, from the LDraw type-1 lines (20 LDU per stud, 24 per brick, −Y up). */
function ldrawOccupancy(text: string, cols: number, rows: number): Map<number, Int32Array> {
  const grid = new Map<number, Int32Array>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] !== '1' || t[14] === '3811.dat' || !t[14]?.endsWith('.dat')) continue;
    const [x, y, z] = [Number(t[2]), Number(t[3]), Number(t[4])];
    const m = t.slice(5, 14).map(Number);
    const part = BRICKS.find((b) => b.ldrawFile === t[14]);
    if (!part) throw new Error(`unknown part ${t[14]}`);
    const alongZ = m[6] === 1;
    const w = alongZ ? part.width : part.length,
      d = alongZ ? part.length : part.width;
    const layer = -y / 24;
    const x0 = x / 20 + cols / 2 - w / 2,
      y0 = z / 20 + rows / 2 - d / 2;
    let g = grid.get(layer);
    if (!g) grid.set(layer, (g = new Int32Array(cols * rows)));
    for (let j = y0; j < y0 + d; j++) for (let i = x0; i < x0 + w; i++) g[j * cols + i]!++;
  }
  return grid;
}

test.describe('create: demo path', () => {
  test('demo → area → generate → guide → all downloads, numbers agree everywhere', async ({ page }) => {
    test.setTimeout(240_000);
    const t0 = Date.now();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await loadDemo(page, DEMO);
    const tLoaded = Date.now();
    await generateFromArea(page);
    const tGenerated = Date.now();
    const total = Number((await page.locator('#lz-total-bricks').innerText()).replace(/\D/g, ''));
    expect(total).toBeGreaterThan(0);
    await primary(page); // Open the build guide
    await page.waitForURL(/#guide/);
    await expect(page.getByRole('heading', { name: 'The brick shelf' })).toBeVisible();
    await expect(page.locator('.lz-shelf__total strong')).toContainText(total.toLocaleString('en-US'));

    // shop lists: BrickLink and Rebrickable quantities = the shelf (minus baseplates)
    const bl = await saveDownload(page, () => page.getByRole('button', { name: 'Download .xml' }).click());
    const qty = [
      ...bl.bytes
        .toString('utf8')
        .matchAll(/<ITEMID>(\d+)<\/ITEMID>\s*<COLOR>\d+<\/COLOR>\s*<MINQTY>(\d+)<\/MINQTY>/g),
    ];
    expect(bl.bytes.toString('utf8').startsWith('<INVENTORY>')).toBe(true);
    expect(qty.filter((q) => q[1] !== '3811').reduce((a, q) => a + Number(q[2]), 0)).toBe(total);
    const rb = await saveDownload(page, () => page.getByRole('button', { name: 'Download .csv' }).click());
    const rbLines = rb.bytes.toString('utf8').trim().split('\n');
    expect(rbLines[0]).toBe('Part,Color,Quantity');
    expect(
      rbLines
        .slice(1)
        .filter((l) => !l.startsWith('3811,'))
        .reduce((a, l) => a + Number(l.split(',')[2]), 0),
    ).toBe(total);

    // instructions: one step with the keyboard (Enter = done, next layer)
    await page.getByRole('tab', { name: /Build/ }).click();
    await expect(page.locator('#lz-step-title')).toContainText('Plate A1');
    await page.locator('#lz-step-title').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('.lz-plate-tile[data-plate=A1]')).toContainText(/Built|Layer 1 of/);
    const done = page.locator('dialog[open]');
    if (await done.count()) await done.getByRole('button', { name: 'Continue' }).click();

    // all downloads: CSV, PDF, LDraw
    await page.getByRole('tab', { name: 'All downloads' }).click();
    const csv = await saveDownload(page, () => page.locator('[data-card=csv] [data-dl]').click());
    expect(csv.name).toMatch(/^legoPlates_\d+_\d+\.csv$/);
    const tPdf = Date.now();
    const pdf = await saveDownload(page, () => page.locator('[data-card=pdf] [data-dl]').click());
    const pdfMs = Date.now() - tPdf;
    expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(pdf.bytes);
    expect(doc.getPageCount()).toBeGreaterThan(5);
    const ldr = await saveDownload(page, () => page.locator('[data-card=ldraw] [data-dl]').click());
    const tEnd = Date.now();

    // LDraw footprints = height matrix
    const m = parseCsv(csv.bytes.toString('utf8'));
    const rows = m.length,
      cols = m[0]!.length;
    const occ = ldrawOccupancy(ldr.bytes.toString('utf8'), cols, rows);
    let bricks = 0;
    for (const line of ldr.bytes.toString('utf8').split(/\r?\n/))
      if (line.startsWith('1 15 ') && !line.endsWith(' 3811.dat')) bricks++;
    expect(bricks).toBe(total);
    // one expect for the whole grid (83 k per-stud expects take minutes)
    const mismatches: string[] = [];
    const maxH = Math.max(...m.flat());
    for (let layer = 1; layer <= maxH; layer++) {
      const g = occ.get(layer) ?? new Int32Array(cols * rows);
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++)
          if (g[j * cols + i] !== (m[rows - 1 - j]![i]! >= layer ? 1 : 0))
            mismatches.push(`stud ${i},${j} layer ${layer}`);
    }
    expect([...occ.keys()].every((l) => l >= 1 && l <= maxH)).toBe(true);
    expect(mismatches.slice(0, 10)).toEqual([]);

    const timing = {
      demoLoadedMs: tLoaded - t0,
      generatedMs: tGenerated - tLoaded,
      guideAndDownloadsMs: tEnd - tGenerated,
      pdfMs,
      pdfPages: doc.getPageCount(),
      pdfBytes: pdf.bytes.length,
      totalMs: tEnd - t0,
    };
    console.log(`[demo path] ${DEMO}: ${JSON.stringify(timing)}`);
    test.info().annotations.push({ type: 'timing', description: JSON.stringify(timing) });
    expect(timing.totalMs).toBeLessThan(120_000);
    expect(errors).toEqual([]);
  });

  test('strict Legacy CSV is byte-identical to legonizer@1.1.0 (UD-Viz 4.6.1)', async ({ page }) => {
    test.skip(!hasPartDieu, 'needs the Part-Dieu demo in public/ (npm run fixtures:demo -- --public)');
    test.setTimeout(180_000);
    await loadDemo(page, 'part-dieu');
    await primary(page);
    await page.getByRole('button', { name: 'Switch to Legacy' }).click();
    await expect(page.getByRole('radio', { name: /Legacy \(UD-Viz 4\.6\.1\)/ }).first()).toBeChecked();
    await primary(page);
    await expect(page.getByRole('heading', { name: 'Your brick model', exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await primary(page);
    await page.getByRole('tab', { name: 'All downloads' }).click();
    const csv = await saveDownload(page, () => page.locator('[data-card=csv] [data-dl]').click());
    expect(csv.name).toBe('legoPlates_3_3.csv');
    // reference: the real legonizer@1.1.0 + three r147 behind UD-Viz's box selector (test/parity)
    const { buildReferenceLayer, referenceHeightMap, referenceCsv } =
      await import('../test/parity/legacyReference.ts');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'public/data/demo/part-dieu/manifest.json'), 'utf8'));
    const zip = unzipSync(
      new Uint8Array(readFileSync(join(ROOT, 'public/data/demo/part-dieu', manifest.archive))),
    );
    const layer = buildReferenceLayer(new Map(Object.entries(zip)));
    const { heightMap } = referenceHeightMap(layer, {
      cx: manifest.defaultArea.area.cx,
      cy: manifest.defaultArea.area.cy,
      rotationZ: 0,
      platesX: 3,
      platesY: 3,
      scale: 3,
      legoHeight: 10,
    });
    const ref = referenceCsv(heightMap, 'legoPlates_3_3.csv');
    expect(Buffer.from(ref.bytes).equals(csv.bytes)).toBe(true);
    console.log(
      `[parity] browser CSV ${csv.bytes.length} bytes = legonizer@1.1.0 reference (${heightMap.flat().filter(Boolean).length} non-zero studs)`,
    );
  });

  test('plate pass opens Plate mode on a phone without the project', async ({ browser }) => {
    test.setTimeout(120_000);
    const desk = await browser.newPage();
    await loadDemo(desk, DEMO);
    await generateFromArea(desk);
    await primary(desk);
    await desk.getByRole('tab', { name: /Build/ }).click();
    // build the pass URL the share dialog shows
    await desk.getByRole('button', { name: 'Share this plate' }).click();
    const dialog = desk.locator('dialog[open]');
    await expect(dialog.getByRole('img', { name: /QR code that opens plate A1/ })).toBeVisible();
    await desk.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    const link = await desk.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/#guide\/build\/A1\/1&d=[A-Za-z0-9_-]+$/);
    const phone = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await phone.goto(link.replace(/^https?:\/\/[^/]+\//, '/'));
    await expect(phone.getByRole('heading', { name: /Plate A1 from/ })).toBeVisible();
    await expect(phone.locator('#lz-step-title')).toContainText('Plate A1');
    // nothing may widen the page (a phone would zoom it out) and there is no project menu here
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(phone.locator('#lz-project-btn')).toHaveCount(0);
    const layers = Number((await phone.locator('#lz-step-title').innerText()).match(/of (\d+)/)![1]);
    await phone.getByRole('button', { name: /Done, (next layer|plate finished)/ }).click();
    if (layers > 1) await expect(phone.locator('#lz-step-title')).toContainText('Layer 2');
    else await expect(phone.locator('.lz-plate-tile').first()).toContainText('Built');
    await phone.screenshot({ path: join(OUT, 'plate-mode-390.png') });
  });
});
