/**
 * Smooth tile cap (SPEC §7.5.1): chosen in step 3 before generating, changed again from the guide's part
 * settings (re-pack, heights unchanged). Tiles show on the shelf and in the shop lists, the PDF still renders.
 */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { TILES } from '../src/core/packing/catalog.ts';
import { OUT, loadDemo, primary, saveDownload } from './create-helpers.ts';

const TILE_IDS = new Set(TILES.map((t) => t.id));

function blQuantities(xml: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const q of xml.matchAll(/<ITEMID>(\w+)<\/ITEMID>\s*<COLOR>\d+<\/COLOR>\s*<MINQTY>(\d+)<\/MINQTY>/g))
    out.set(q[1]!, Number(q[2]));
  return out;
}

test('tile cap: settings step → generate → shelf, shop list, PDF; changed from the guide', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await loadDemo(page);
  await primary(page); // → step 3
  await expect(page.locator('#step-title')).toHaveText('Scale and height');
  const roofs = page.getByRole('button', { name: 'On roofs' });
  await roofs.click();
  await expect(roofs).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: join(OUT, 'tiles-settings.png'), fullPage: true });
  await primary(page); // Generate model
  await expect(page.getByRole('heading', { name: 'Your brick model', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const bricks = Number((await page.locator('#lz-total-bricks').innerText()).replace(/\D/g, ''));
  const tiles = Number((await page.locator('#lz-total-tiles').innerText()).replace(/\D/g, ''));
  expect(tiles).toBeGreaterThan(0);
  await page.screenshot({ path: join(OUT, 'tiles-generate.png') });

  await primary(page); // Open the build guide
  await page.waitForURL(/#guide/);
  await expect(page.locator('#row-tiles')).toHaveText('Smooth tiles');
  await expect(page.locator('.lz-shelf__total strong')).toContainText(
    `+ ${tiles.toLocaleString('en-US')} tiles`,
  );
  const bl = blQuantities(
    (
      await saveDownload(page, () => page.getByRole('button', { name: 'Download .xml' }).click())
    ).bytes.toString('utf8'),
  );
  const sum = (pred: (id: string) => boolean) =>
    [...bl].filter(([id]) => pred(id)).reduce((a, [, q]) => a + q, 0);
  expect(sum((id) => TILE_IDS.has(id))).toBe(tiles);
  expect(sum((id) => id !== '3811' && !TILE_IDS.has(id))).toBe(bricks);
  await page.screenshot({ path: join(OUT, 'tiles-shelf.png'), fullPage: true });

  // whole model from the guide: re-pack, more tiles, same bricks
  await page.locator('#lz-parts-settings summary').click();
  await page.locator('#lz-parts-settings').getByRole('button', { name: 'Whole model' }).click();
  await expect(page.locator('.lz-shelf__total strong')).not.toContainText(
    `+ ${tiles.toLocaleString('en-US')} tiles`,
    {
      timeout: 30_000,
    },
  );
  await expect(page.locator('.lz-shelf__total strong')).toContainText(bricks.toLocaleString('en-US'));

  // build view and PDF with tiles
  await page.getByRole('tab', { name: /Build/ }).click();
  await expect(page.locator('#lz-step-title')).toContainText('Plate A1');
  await page.screenshot({ path: join(OUT, 'tiles-build.png') });
  await page.getByRole('tab', { name: 'All downloads' }).click();
  const pdf = await saveDownload(page, () => page.locator('[data-card=pdf] [data-dl]').click());
  expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBeGreaterThan(3);

  // back to no tiles
  await page.getByRole('tab', { name: 'Get the bricks' }).click();
  await page.locator('#lz-parts-settings summary').click();
  await page.locator('#lz-parts-settings').getByRole('button', { name: 'No tiles' }).click();
  await expect(page.locator('#row-tiles')).toHaveCount(0, { timeout: 30_000 });
  expect(errors).toEqual([]);
});
