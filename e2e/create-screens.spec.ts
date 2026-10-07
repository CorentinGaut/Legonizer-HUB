/**
 * Screenshots of every step at 1440 and 390 px (reviewed by hand; e2e-artifacts/create/screens).
 * Each screen also asserts that nothing widens the page: a phone would zoom the whole page out.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { OUT, hasPartDieu, loadDemo, primary } from './create-helpers.ts';

const DIR = join(OUT, 'screens');
mkdirSync(DIR, { recursive: true });

for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`screens at ${w}px`, async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const shot = async (name: string) => {
      await page.screenshot({ path: join(DIR, `${name}-${w}.png`), fullPage: w < 768 });
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, `${name}: page wider than the viewport`).toBeLessThanOrEqual(w);
    };
    await page.goto('create.html');
    await expect(page.locator('#step-title')).toBeVisible();
    await shot('1-import');
    await loadDemo(page, hasPartDieu ? 'part-dieu' : 'sample');
    await page.waitForTimeout(1500);
    await shot('2-area');
    await primary(page);
    await page.waitForTimeout(1500);
    await shot('3-settings');
    await primary(page);
    await expect(page.getByRole('heading', { name: 'Your brick model', exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForTimeout(1500);
    await shot('4-generate');
    await primary(page);
    await page.waitForTimeout(1500);
    await shot('5a-bricks');
    await page.locator('[data-tab=build]:visible').first().click();
    await page.waitForTimeout(1500);
    await shot('5b-build');
    await page.locator('[data-tab=table]:visible').first().click();
    await page.waitForTimeout(1500);
    await shot('5c-table');
    await page.locator('[data-tab=downloads]:visible').first().click();
    await page.waitForTimeout(500);
    await shot('5d-downloads');
  });
}
