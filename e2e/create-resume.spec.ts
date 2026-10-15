/**
 * Persistence (SPEC §7: the state survives a reload): the project is saved in IndexedDB; a reload inside the wizard
 * continues where it was, a return to the import step offers Continue / Start a new project, and
 * the build progress survives.
 */
import { expect, test } from '@playwright/test';
import { generateFromArea, loadDemo, primary } from './create-helpers.ts';

test('reload continues the project; the resume banner offers Continue or Start new', async ({ page }) => {
  test.setTimeout(180_000);
  await loadDemo(page);
  await generateFromArea(page);
  const total = await page.locator('#lz-total-bricks').innerText();
  await primary(page);
  await page.getByRole('tab', { name: /Build/ }).click();
  await page.getByRole('textbox', { name: /Who builds A1/ }).fill('Team 1');
  await page.getByRole('textbox', { name: /Who builds A1/ }).press('Tab');
  await expect(page.locator('#lz-actionbar, body')).toBeTruthy();
  await page.waitForTimeout(1200); // autosave within 1 s

  // 1) reload inside the guide: same step, same result, same progress
  await page.reload();
  await expect(page.getByRole('heading', { name: /Plate A1/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.lz-plate-tile[data-plate=A1]')).toContainText('Team 1');
  await page.getByRole('tab', { name: 'Get the bricks' }).click();
  await expect(page.locator('.lz-shelf__total strong')).toContainText(total);

  // 2) back to the start page: resume banner
  await page.goto('create.html');
  await expect(page.getByText(/Welcome back\. Continue/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL(/#guide/);
  // the engine re-imported the model in the background: exports work after a reload
  await page.getByRole('tab', { name: 'All downloads' }).click();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-card=csv] [data-dl]').click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/^legoPlates_/);

  // 3) start new clears it
  await page.goto('create.html');
  await page.getByRole('button', { name: 'Start a new project' }).click();
  await expect(page.getByText(/Welcome back/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/Welcome back/)).toHaveCount(0);
});
