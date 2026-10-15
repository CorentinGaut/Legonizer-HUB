/**
 * Screenshots of the home and about pages and of every create step at 1440 and 390 px (reviewed by
 * hand; e2e-artifacts/create/screens). Each screen also asserts that nothing widens the page: a
 * phone would zoom the whole page out.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { OUT, loadDemo, primary } from './create-helpers.ts';

const DIR = join(OUT, 'screens');
mkdirSync(DIR, { recursive: true });

/** Brick glyphs drawn outside their shelf tray (the trays must fit the widest glyph). */
function glyphsOutsideTrays(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.lz-slot')].flatMap((slot) => {
      const s = slot.getBoundingClientRect();
      const g = slot.querySelector('.lz-glyph use')?.getBoundingClientRect();
      const part = slot.querySelector('.lz-slot__part')?.textContent ?? '?';
      return g && (g.left < s.left || g.right > s.right)
        ? [`${part}: ${g.left}–${g.right} in ${s.left}–${s.right}`]
        : [];
    }),
  );
}

/** Table-fit diagram texts that overflow the diagram's viewBox. */
function tableFitTextOutside(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<SVGSVGElement>('.lz-tablefit svg')].flatMap((svg) => {
      const vb = svg.viewBox.baseVal;
      return [...svg.querySelectorAll('text')].flatMap((tx) => {
        // the text box in the svg's user units, transforms of its groups included
        const b = tx.getBBox();
        const m = svg.getScreenCTM()!.inverse().multiply(tx.getScreenCTM()!);
        const x0 = m.a * b.x + m.e,
          x1 = m.a * (b.x + b.width) + m.e;
        return x0 < vb.x || x1 > vb.x + vb.width
          ? [`"${tx.textContent}": ${x0.toFixed(1)}–${x1.toFixed(1)}`]
          : [];
      });
    }),
  );
}

for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`home and about screens at ${w}px`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    for (const [name, url] of [
      ['0-home', './'],
      ['0-about', 'about.html'],
    ] as const) {
      await page.goto(url);
      await page.waitForLoadState('load');
      await page.screenshot({ path: join(DIR, `${name}-${w}.png`), fullPage: true });
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, `${name}: page wider than the viewport`).toBeLessThanOrEqual(w);
    }
  });
}

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
    await loadDemo(page);
    await page.waitForTimeout(1500);
    await shot('2-area');
    expect(await tableFitTextOutside(page), 'table-fit text outside its figure').toEqual([]);
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
    expect(await glyphsOutsideTrays(page), 'brick glyphs wider than their tray').toEqual([]);
    await page.locator('[data-tab=build]:visible').first().click();
    await page.waitForTimeout(1500);
    await shot('5b-build');
    await page.locator('[data-tab=table]:visible').first().click();
    await page.waitForTimeout(1500);
    await shot('5c-table');
    expect(await tableFitTextOutside(page), 'table-fit text outside its figure').toEqual([]);
    await page.locator('[data-tab=downloads]:visible').first().click();
    await page.waitForTimeout(500);
    await shot('5d-downloads');
  });
}
