/**
 * 2D mode without WebGL 2 (SPEC N2): `?webgl=0` forces it (same code path as a browser
 * without WebGL 2). Numeric area + plan view, generation, 2D height map, 2D layer diagrams, exports.
 */
import { expect, test } from '@playwright/test';
import { generateFromArea, loadDemo, primary, saveDownload } from './create-helpers.ts';

test('the whole wizard works without WebGL 2', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loadDemo(page, '?webgl=0');
  await expect(page.getByText('3D views are off in this browser')).toBeVisible();
  await expect(page.locator('canvas.lz-viewport__canvas')).toHaveCount(0);
  // plan view with the area rectangle, operable from the keyboard
  const area = page.locator('.lz-area');
  await expect(area).toBeVisible();
  const before = await page.locator('#lz-cx').inputValue();
  await area.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('#lz-cx')).not.toHaveValue(before);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#lz-cx')).toHaveValue(before);
  // numeric inputs (two-way binding)
  await page.locator('#lz-py').fill('2');
  await page.locator('#lz-py').press('Enter');
  await expect(page.locator('.lz-area .label', { hasText: 'A2' })).toHaveCount(1);
  await generateFromArea(page);
  await expect(page.locator('.lz-hm2d svg')).toBeVisible();
  await primary(page);
  await page.getByRole('tab', { name: /Build/ }).click();
  await expect(page.locator('svg.lz-layer')).toBeVisible();
  await expect(page.getByRole('table', { name: /New bricks in layer 1/ })).toBeVisible();
  await page.getByRole('tab', { name: 'All downloads' }).click();
  const csv = await saveDownload(page, () => page.locator('[data-card=csv] [data-dl]').click());
  expect(csv.name).toMatch(/^legoPlates_\d+_2\.csv$/);
  const jpg = await saveDownload(page, () => page.locator('[data-card=projection] [data-dl]').click());
  expect(jpg.name).toBe('calqueTemplate.jpg');
  expect([...jpg.bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  expect(errors).toEqual([]);
});
