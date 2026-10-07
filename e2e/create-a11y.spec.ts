/**
 * Accessibility of the create page (SPEC N3): axe-core (WCAG 2.0–2.2 A/AA + best practices) on
 * every step, every guide tab and the main dialogs, light and dark, desktop and phone, and keyboard
 * focus against the phone's sticky bars. axe-core comes from node_modules or AXE_CORE_PATH.
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  ROOT,
  axeSource,
  expectNoAxeViolations,
  generateFromArea,
  loadDemo,
  primary,
} from './create-helpers.ts';

/**
 * WCAG 2.4.11 (and the stricter 2.4.12) on phones: from the top of `#main`, Tab through every
 * control and check that the focused one is never covered, even partly, by a sticky or fixed bar
 * (header, wizard action bar, guide tab bar, Done button). The page's scroll-padding (WCAG
 * technique C43) makes the browser scroll each control clear of them.
 */
async function expectFocusNeverHidden(page: Page, label: string): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>('#main')!.focus({ preventScroll: true });
  });
  const hidden: string[] = [];
  let count = 0;
  for (; count < 400; count++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !document.querySelector('#main')!.contains(el)) return null;
      const a = el.getBoundingClientRect();
      const covered = [...document.querySelectorAll<HTMLElement>('body *')].filter((b) => {
        const cs = getComputedStyle(b);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
        if (b.contains(el) || el.contains(b) || cs.visibility === 'hidden') return false;
        const c = b.getBoundingClientRect();
        return (
          Math.min(a.right, c.right) - Math.max(a.left, c.left) > 0.5 &&
          Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 0.5
        );
      });
      const name = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`;
      return { name, covered: covered.map((b) => b.id || b.className) };
    });
    if (!r) break;
    if (r.covered.length) hidden.push(`${r.name} under ${r.covered.join(', ')}`);
  }
  expect(count, `${label}: Tab never left #main`).toBeLessThan(400);
  expect(hidden, `${label}: focused controls under a sticky bar`).toEqual([]);
}

async function walk(page: Page, label: string) {
  await page.goto('create.html');
  await expect(page.locator('#step-title')).toHaveText('Import a 3D city model');
  await expectNoAxeViolations(page, `${label} step 1 empty`);
  await loadDemo(page);
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
  await page.locator('#lz-scale3').fill('5'); // the sample opens at 4 m per stud
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
    await loadDemo(page, '?webgl=0');
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

test('keyboard focus never under the sticky bars, 390', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await loadDemo(page);
  await expectFocusNeverHidden(page, 'step 2');
  await primary(page);
  await expect(page.locator('#step-title')).toHaveText('Scale and height');
  await page.locator('#lz-adv summary').click();
  await expectFocusNeverHidden(page, 'step 3 (advanced open)');
  await primary(page);
  await expect(page.getByRole('heading', { name: 'Your brick model', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expectFocusNeverHidden(page, 'step 4');
  await primary(page);
  await expect(page.getByRole('heading', { name: 'The brick shelf' })).toBeVisible();
  await expectFocusNeverHidden(page, 'guide: bricks');
  for (const tab of ['build', 'table', 'downloads']) {
    await page.locator(`[data-tab=${tab}]:visible`).first().click();
    await page.waitForTimeout(500);
    await expectFocusNeverHidden(page, `guide: ${tab}`);
  }
  await page.locator('[data-tab=build]:visible').first().click();
  await page.getByRole('button', { name: 'Show as list' }).click();
  await expectFocusNeverHidden(page, 'guide: build list');
});
