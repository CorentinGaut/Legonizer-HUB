/**
 * PDF build guide in the browser (SPEC O5): the engine Worker fetches the site's font files (Vite
 * assets) and embeds IBM Plex Sans, IBM Plex Mono and Bricolage Grotesque, instead of falling back
 * to the standard PDF fonts (which it does only when the files cannot be loaded).
 */
import { expect, test } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { generateFromArea, loadDemo, primary, saveDownload } from './create-helpers.ts';

test('the PDF guide embeds the site fonts, fetched by the Worker', async ({ page }) => {
  test.setTimeout(180_000);
  await loadDemo(page);
  await generateFromArea(page);
  await primary(page); // Open the build guide
  await page.waitForURL(/#guide/);
  await page.getByRole('tab', { name: 'All downloads' }).click();
  const pdf = await saveDownload(page, () => page.locator('[data-card=pdf] [data-dl]').click());
  const doc = await PDFDocument.load(pdf.bytes);
  const names = new Set<string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects())
    if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Font'))
      names.add((obj.get(PDFName.of('BaseFont')) as PDFName).decodeText());
  // subset tag + PostScript name; the standard fonts (Helvetica, Courier) would mean the fallback
  expect([...names].every((n) => /^[A-Z]{6}\+/.test(n))).toBe(true);
  const families = new Set([...names].map((n) => n.replace(/^[A-Z]{6}\+/, '').replace(/-.*/, '')));
  expect([...families].sort()).toEqual(['BricolageGrotesque', 'IBMPlexMono', 'IBMPlexSans']);
});
