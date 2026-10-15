/**
 * SPEC G1 in a real browser: 4 × 4 plates on ~1 M triangles (real Lyon 3 tiles + a shifted copy,
 * 1.08 M triangles) imported as a .zip, then generated in the engine Worker. Timings are logged
 * and attached to the report (docs/perf.md). Skipped without the Lyon fixtures.
 */
import { expect, test } from '@playwright/test';
import { doubledLyonZip, hasLyon, primary } from './create-helpers.ts';

test('G1: import 1 M triangles, generate 4 × 4 plates', async ({ page }) => {
  test.skip(!hasLyon, 'needs npm run fixtures:lyon -- --all');
  test.setTimeout(300_000);
  const zip = await doubledLyonZip();
  await page.goto('create.html');
  const t0 = Date.now();
  await page.locator('#lz-files').setInputFiles(zip);
  await expect(page.locator('[data-ab=primary]')).toBeEnabled({ timeout: 120_000 });
  const tImport = Date.now() - t0;
  const triangles = await page.locator('.lz-facts').first().innerText();
  await primary(page);
  await page.locator('#lz-cx').fill('1844300');
  await page.locator('#lz-cx').press('Enter');
  await page.locator('#lz-cy').fill('5175100');
  await page.locator('#lz-cy').press('Enter');
  for (const id of ['#lz-px', '#lz-py']) {
    await page.locator(id).fill('4');
    await page.locator(id).press('Enter');
  }
  await primary(page); // → settings (Legacy preset)
  const runs: { variant: string; generateMs: number; shownMs: string }[] = [];
  const generate = async (variant: string) => {
    const t = Date.now();
    await primary(page);
    // wait for a result generated after the click (a previous result shows the same heading)
    await page.waitForFunction(
      (since) => {
        const s = (
          window as unknown as {
            __lzCreate: {
              store: { p: { result: { generatedAt: number } | null }; t: { generating: unknown } };
            };
          }
        ).__lzCreate.store;
        return !!s.p.result && s.p.result.generatedAt >= since && !s.t.generating;
      },
      t - 5,
      { timeout: 120_000, polling: 50 },
    );
    await expect(page.getByRole('heading', { name: 'Your brick model', exact: true })).toBeVisible();
    const shown = await page.locator('.lz-generated').innerText();
    runs.push({ variant, generateMs: Date.now() - t, shownMs: shown });
  };
  await generate('Legacy preset, first generation');
  const tFirst = Date.now();
  await page.locator('[data-ab=back]').click();
  await page.locator('#lz-adv summary').click();
  await page.getByLabel('Keep small buildings (at least 1 brick)').check();
  await generate('Legacy + keep small (next generation)');
  await page.locator('[data-ab=back]').click();
  await page
    .getByRole('radio', { name: /True scale/ })
    .first()
    .check();
  await generate('True scale preset');
  // end to end: files chosen → first brick model shown, including the step 2 and 3 interactions
  // (typed by the test) during which the Worker builds the BVH for the live estimate
  const bvhBuildMs = await page.evaluate(
    () =>
      (
        window as unknown as {
          __lzCreate: { store: { t: { estimate: { bvhBuildMs: number | null } | null } } };
        }
      ).__lzCreate.store.t.estimate?.bvhBuildMs ?? null,
  );
  const result = {
    triangles,
    importMs: tImport,
    bvhBuildMs,
    runs,
    firstTotalMs: tFirst - t0,
  };
  console.log(`[G1 browser] ${JSON.stringify(result, null, 1)}`);
  test.info().annotations.push({ type: 'G1', description: JSON.stringify(result) });
  expect(result.firstTotalMs).toBeLessThan(15_000);
});
