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
 * Runs axe-core on the page. One adjustment, reported rather than hidden: on phones the guide has a
 * fixed bottom tab bar (and the wizard a sticky action bar), so at most scroll positions some control
 * sits partly under it and axe's `target-size` measures only its uncovered sliver. Those nodes, and
 * only those (their box intersects a fixed or sticky bar that is not their ancestor), are moved to
 * `obscured`; every other `target-size` node still fails.
 */
export async function runAxe(page: Page): Promise<AxeViolation[]> {
  const src = axeSource();
  if (!src) throw new Error('axe-core not found: install it or set AXE_CORE_PATH');
  await page.addScriptTag({ content: src });
  const { violations, obscured } = await page.evaluate(async () => {
    type AxeResult = {
      violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[];
    };
    const axe = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<AxeResult> } }).axe;
    const r = await axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
    });
    const bars = [...document.querySelectorAll<HTMLElement>('body *')].filter((e) => {
      const cs = getComputedStyle(e);
      return (
        (cs.position === 'fixed' || cs.position === 'sticky') &&
        e.getClientRects().length > 0 &&
        e.offsetHeight < 200
      );
    });
    const underBar = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const a = el.getBoundingClientRect();
      return bars.some((b) => {
        if (b.contains(el)) return false;
        const c = b.getBoundingClientRect();
        return a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top;
      });
    };
    const obscured: string[] = [];
    const violations = r.violations
      .map((v) => {
        let nodes = v.nodes.map((n) => n.target.join(' '));
        if (v.id === 'target-size') {
          obscured.push(...nodes.filter(underBar));
          nodes = nodes.filter((n) => !underBar(n));
        }
        return { id: v.id, impact: v.impact, help: v.help, nodes };
      })
      .filter((v) => v.nodes.length > 0);
    return { violations, obscured };
  });
  if (obscured.length)
    test.info().annotations.push({
      type: 'axe target-size, under a fixed/sticky bar',
      description: obscured.join(', '),
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
