/**
 * Accessibility (SPEC N3, WCAG 2.2 AA): axe-core on the home and about pages, light and dark,
 * desktop and phone, and the reduced-motion home. axe-core is resolved from node_modules, or from
 * AXE_CORE_PATH (path to axe.min.js) when it is not a dependency of the project.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, type Page, test } from '@playwright/test';

function axeSource(): string | null {
  const fromEnv = process.env.AXE_CORE_PATH;
  if (fromEnv && existsSync(fromEnv)) return readFileSync(fromEnv, 'utf8');
  try {
    return readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    return null;
  }
}

const AXE = axeSource();

async function runAxe(page: Page): Promise<{ id: string; impact: string; nodes: string[] }[]> {
  await page.addScriptTag({ content: AXE! });
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: Document,
            o: object,
          ) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }>;
        };
      }
    ).axe;
    const r = await axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    }));
  });
}

const CASES = [
  { name: 'home, light, 1440', url: '/', scheme: 'light', width: 1440, height: 900 },
  { name: 'home, dark, 1440', url: '/', scheme: 'dark', width: 1440, height: 900 },
  { name: 'home, light, 390', url: '/', scheme: 'light', width: 390, height: 844 },
  { name: 'home, dark, 390', url: '/', scheme: 'dark', width: 390, height: 844 },
  {
    name: 'home, playing',
    url: '/?lz-autoplay=force',
    scheme: 'light',
    width: 1280,
    height: 800,
    playing: true,
  },
  { name: 'home, reduced motion', url: '/', scheme: 'light', width: 1280, height: 800, reduced: true },
  { name: 'home, French', url: '/?lang=fr', scheme: 'light', width: 1280, height: 800 },
  { name: 'about, light', url: '/about.html', scheme: 'light', width: 1440, height: 900 },
  { name: 'about, dark, 390', url: '/about.html', scheme: 'dark', width: 390, height: 844 },
] as const;

for (const c of CASES) {
  test(`axe: ${c.name}`, async ({ browser }) => {
    test.skip(!AXE, 'axe-core not installed (add it as a devDependency or set AXE_CORE_PATH)');
    const context = await browser.newContext({
      colorScheme: c.scheme,
      viewport: { width: c.width, height: c.height },
      reducedMotion: 'reduced' in c && c.reduced ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    await page.goto(c.url);
    await page.waitForLoadState('load');
    if ('playing' in c && c.playing)
      await page.waitForFunction(() => window.__lzHome?.mode() === 'playing', null, { timeout: 60_000 });
    else await page.waitForTimeout(500);
    const violations = await runAxe(page);
    if (violations.length) console.log(c.name, JSON.stringify(violations, null, 1));
    expect(violations).toEqual([]);
    await context.close();
  });
}
