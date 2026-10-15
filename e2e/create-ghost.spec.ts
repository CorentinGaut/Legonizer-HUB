/**
 * Step 4 "Show source model": the ghost used to shrink at every toggle, because its transform was
 * baked into the cached preview positions (see test/unit/source-model.test.ts).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { generateFromArea, loadDemo } from './create-helpers.ts';

/**
 * The 3D picture only: the viewport's toolbar and legend float over the canvas, and under load the
 * toolbar's switch knob is not always rasterized to the same pixels.
 */
const SHOT = { style: '.lz-vp-toolbar, .lz-vp-bottom { visibility: hidden !important; }' };

/** Screenshot of `target` once two consecutive captures are identical (the view has rendered). */
async function stableShot(page: Page, target: Locator): Promise<Buffer> {
  let prev = await target.screenshot(SHOT);
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(150);
    const cur = await target.screenshot(SHOT);
    if (cur.equals(prev)) return cur;
    prev = cur;
  }
  throw new Error('the 3D view did not settle');
}

test('show source model: toggling it again gives the same picture', async ({ page }) => {
  await loadDemo(page);
  await generateFromArea(page);
  const ghost = page.locator('[data-vp="ghost"]');
  await expect(ghost).toBeEnabled({ timeout: 30_000 });
  const canvas = page.locator('canvas:visible').first();

  const off = await stableShot(page, canvas);
  await ghost.check();
  const on = await stableShot(page, canvas);
  expect(on.equals(off), 'the source model is drawn').toBe(false);

  for (let i = 0; i < 3; i++) {
    await ghost.uncheck();
    await stableShot(page, canvas);
    await ghost.check();
  }
  const again = await stableShot(page, canvas);
  expect(again.equals(on), 'same ghost after three more toggles').toBe(true);
});
