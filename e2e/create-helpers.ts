/** Helpers for the create-page e2e specs (wizard steps, downloads, axe, fixtures). */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { zipSync } from 'fflate';

export const ROOT = resolve(import.meta.dirname, '..');
export const OUT = join(ROOT, 'e2e-artifacts', 'create');
mkdirSync(OUT, { recursive: true });

/** Developer fixtures (git-ignored, absent in CI): real Lyon 3 tiles for the G1 timing only. */
export const hasLyon = existsSync(join(ROOT, 'fixtures', 'lyon3-2018', 'tileset.json'));

export function axeSource(): string | null {
  const fromEnv = process.env.AXE_CORE_PATH;
  if (fromEnv && existsSync(fromEnv)) return readFileSync(fromEnv, 'utf8');
  try {
    return readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    return null;
  }
}

export interface AxeViolation {
  id: string;
  impact: string;
  help: string;
  nodes: string[];
}

/**
 * Runs axe-core on the page (WCAG 2.0–2.2 A/AA + best practices); every rule counts, `target-size`
 * included.
 *
 * `target-size` measures a target where it is when axe runs. On phones the guide's tab bar (with
 * the Done button sticking above it in the Build tab) and the wizard's action bar stay at the
 * bottom of the screen while the page scrolls under them, so a control that the previous step of
 * the test left near the bottom edge is measured as the sliver above the bar. Such a node is
 * checked again where a user reaches it: it receives keyboard focus, which scrolls it into view as
 * Tab does (clear of the bars, thanks to the page's scroll-padding, WCAG technique C43), and
 * `target-size` runs again on it. It fails if it still fails there; no node is skipped. The nodes
 * checked this way are listed in the test's annotations.
 */
export async function runAxe(page: Page): Promise<AxeViolation[]> {
  const src = axeSource();
  if (!src) throw new Error('axe-core not found: install it or set AXE_CORE_PATH');
  await page.addScriptTag({ content: src });
  const { violations, refocused } = await page.evaluate(async () => {
    type AxeResult = {
      violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[];
    };
    const axe = (
      window as unknown as { axe: { run: (c: Document | Element, o: object) => Promise<AxeResult> } }
    ).axe;
    const r = await axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
    });
    const refocused: string[] = [];
    const violations: { id: string; impact: string; help: string; nodes: string[] }[] = [];
    for (const v of r.violations) {
      let nodes = v.nodes.map((n) => n.target.join(' '));
      if (v.id === 'target-size') {
        const failing: string[] = [];
        for (const sel of nodes) {
          const el = document.querySelector<HTMLElement>(sel);
          const x = window.scrollX,
            y = window.scrollY,
            prev = document.activeElement;
          el?.focus(); // scrolls into view like Tab (no smooth scrolling on these pages)
          if (!el || document.activeElement !== el) {
            failing.push(sel);
            continue;
          }
          // a choice in a group (stacked radios): bring the whole group clear of the sticky bars, or
          // its next option half under the tab bar counts as a neighbour a few pixels away
          el.closest('fieldset, [role=radiogroup], .lz-radio-row, .lz-export__options')?.scrollIntoView({
            block: 'nearest',
          });
          const again = await axe.run(el, { runOnly: { type: 'rule', values: ['target-size'] } });
          (again.violations.length ? failing : refocused).push(sel);
          el.blur();
          if (prev instanceof HTMLElement && prev !== document.body) prev.focus({ preventScroll: true });
          window.scrollTo(x, y);
        }
        nodes = failing;
      }
      if (nodes.length) violations.push({ id: v.id, impact: v.impact, help: v.help, nodes });
    }
    return { violations, refocused };
  });
  if (refocused.length)
    test.info().annotations.push({
      type: 'axe target-size, passed once focused (scrolled clear of the sticky bars)',
      description: refocused.join(', '),
    });
  return violations;
}

export async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const v = await runAxe(page);
  expect(v, `${label}: ${JSON.stringify(v, null, 1)}`).toEqual([]);
}

/** Clicks the action bar's primary button. */
export async function primary(page: Page): Promise<void> {
  await page.locator('[data-ab=primary]').click();
}

/** Opens the create page and loads the demo (the synthetic sample, the site's only demo). */
export async function loadDemo(page: Page, query = ''): Promise<void> {
  await page.goto(`create.html${query}`);
  await page.getByRole('button', { name: 'Try the sample' }).click();
  await page.waitForURL(/#area/);
  await expect(page.locator('#step-title')).toHaveText('Choose the area');
}

export async function generateFromArea(page: Page): Promise<void> {
  await primary(page); // → step 3
  await expect(page.locator('#step-title')).toHaveText('Scale and height');
  await primary(page); // Generate model
  await expect(page.getByRole('heading', { name: 'Your brick model', exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

export async function saveDownload(
  page: Page,
  click: () => Promise<void>,
): Promise<{ name: string; path: string; bytes: Buffer }> {
  const [dl] = (await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), click()])) as [
    Download,
    void,
  ];
  const path = join(OUT, dl.suggestedFilename());
  await dl.saveAs(path);
  return { name: dl.suggestedFilename(), path, bytes: readFileSync(path) };
}

/**
 * The real Lyon 3 (2018) tiles plus a copy shifted 4.5 km east with renamed gml_ids: 1.08 M
 * triangles (same dataset as scripts/perf.ts), zipped for upload.
 */
export async function doubledLyonZip(): Promise<string> {
  const path = join(OUT, 'lyon3x2.zip');
  if (existsSync(path)) return path;
  const { parseB3dm } = await import('../src/core/import/b3dm.ts');
  const { writeB3dm } = await import('../src/core/samples/synthetic.ts');
  const dir = join(ROOT, 'fixtures', 'lyon3-2018');
  const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8'));
  const tiles = readdirSync(join(dir, 'tiles'));
  const files: Record<string, Uint8Array> = {};
  const children: unknown[] = [];
  for (let c = 0; c < 2; c++) {
    for (const ch of ts.root.children) {
      const t = [...ch.transform];
      t[12] += c * 4500;
      const uri = c === 0 ? ch.content.uri : ch.content.uri.replace('tiles/', `copy${c}/`);
      children.push({ ...ch, transform: t, content: { uri } });
    }
    for (const f of tiles) {
      let data: Uint8Array = new Uint8Array(readFileSync(join(dir, 'tiles', f)));
      if (c > 0) {
        const b = parseB3dm(data);
        data = writeB3dm(b.glb, b.batchLength, {
          ...b.batchTable,
          gml_id: ((b.batchTable.gml_id as unknown[]) ?? []).map((g) => `${String(g)}_copy${c}`),
        });
      }
      files[c === 0 ? `tiles/${f}` : `copy${c}/${f}`] = data;
    }
  }
  files['tileset.json'] = new TextEncoder().encode(JSON.stringify({ ...ts, root: { ...ts.root, children } }));
  writeFileSync(path, zipSync(files, { level: 1 }));
  return path;
}
