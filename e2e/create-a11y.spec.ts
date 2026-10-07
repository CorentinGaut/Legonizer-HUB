/**
 * Accessibility of the create page (SPEC N3, ux-spec §9.9): axe-core (WCAG 2.0–2.2 A/AA +
 * best practices) on every step, every guide tab and the main dialogs, light and dark, desktop and
 * phone. axe-core comes from node_modules or AXE_CORE_PATH.
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  ROOT,
  axeSource,
  expectNoAxeViolations,
  generateFromArea,
  hasPartDieu,
  loadDemo,
  primary,
} from './create-helpers.ts';

const DEMO = hasPartDieu ? 'part-dieu' : 'sample';

async function walk(page: Page, label: string) {
  await page.goto('create.html');
  await expect(page.locator('#step-title')).toHaveText('Import a 3D city model');
  await expectNoAxeViolations(page, `${label} step 1 empty`);
  await loadDemo(page, DEMO);
  await page.waitForTimeout(800);
  await expectNoAxeViolations(page, `${label} step 2`);
  await primary(page);
  await expect(page.locator('#step-title')).toHaveText('Scale and height');
  await page.locator('#lz-adv summary').click();
  await expectNoAxeViolations(page, `${label} step 3 (advanced open)`);
  await primary(page);
  await expect(page.getByRole('heading', { name: 'Your brick model', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'View the height grid as a table' }).click();
  await expectNoAxeViolations(page, `${label} step 4 (+ height grid)`);
  await page.locator('[data-stepper-back], [data-ab=back]').first().click();
  await page.locator('#lz-scale3').fill('4');
  await page.locator('#lz-scale3').press('Enter');
  await expect(page.locator('.lz-stale')).toBeVisible();
  await expectNoAxeViolations(page, `${label} step 3 out of date`);
  await page.getByRole('button', { name: 'Undo changes' }).click();
  // the phone stepper is a menu, not links: go through the hash route on both widths
  await page.evaluate(() => (location.hash = '#guide'));
  await expect(page.getByRole('heading', { name: 'The brick shelf' })).toBeVisible();
  await expectNoAxeViolations(page, `${label} guide: bricks`);
  // tabs: in the guide head on desktop, in the bottom tab bar (other labels) on phones
  await page.locator('[data-tab=build]:visible').first().click();
  await expect(page.locator('#lz-step-title')).toContainText('Plate');
  await expectNoAxeViolations(page, `${label} guide: build`);
  await page.getByRole('button', { name: 'Show as list' }).click();
  await expectNoAxeViolations(page, `${label} guide: build list`);
  await page.locator('[data-tab=table]:visible').first().click();
  await expect(page.locator('.calque img')).toBeVisible();
  await expectNoAxeViolations(page, `${label} guide: table`);
  await page.locator('[data-tab=downloads]:visible').first().click();
  await expectNoAxeViolations(page, `${label} guide: downloads`);
}

test.describe('create: axe', () => {
  test.skip(!axeSource(), 'axe-core not installed (set AXE_CORE_PATH)');

  test('every step and tab, light, 1440', async ({ page }) => {
    test.setTimeout(240_000);
    await walk(page, 'light 1440');
  });

  test('every step and tab, dark, 390', async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await walk(page, 'dark 390');
  });

  test('dialogs: keyboard help, share plate, replace model; 2D mode', async ({ page }) => {
    test.setTimeout(180_000);
    await loadDemo(page, DEMO, '?webgl=0');
    await expectNoAxeViolations(page, '2D step 2');
    await generateFromArea(page);
    await expectNoAxeViolations(page, '2D step 4');
    await primary(page);
    await page.getByRole('tab', { name: /Build/ }).click();
    await expectNoAxeViolations(page, '2D build');
    await page.goto('create.html#guide/build');
    await page.getByRole('button', { name: 'Share this plate' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await expectNoAxeViolations(page, 'share dialog');
    await page.keyboard.press('Escape');
    await page.locator('#lz-step-title').click();
    await page.keyboard.press('?');
    await expect(page.locator('dialog[open]')).toContainText('Keyboard and keypad');
    await expectNoAxeViolations(page, 'keyboard help');
    await page.keyboard.press('Escape');
    await page
      .getByRole('link', { name: /Import/ })
      .first()
      .click();
    // a model is loaded: choosing new files asks before replacing it
    await page
      .locator('#lz-files')
      .setInputFiles(join(ROOT, 'public', 'data', 'demo', 'sample', 'sample.zip'));
    await expect(page.locator('dialog[open]')).toBeVisible();
    await expectNoAxeViolations(page, 'replace dialog');
  });
});
