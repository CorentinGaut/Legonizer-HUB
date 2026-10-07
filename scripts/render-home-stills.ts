#!/usr/bin/env node
/**
 * Renders the home poster and stills from the real animation (SPEC H4, H10; UI-7): the same scene,
 * fixture (src/data/home/home-district.json, packed by our pipeline) and timeline as the page,
 * so the poster is the frame the animation hands off from (t = 19 s, storyboard §5).
 *
 * Runs a Vite dev server and headless Chromium (Playwright) with SwiftShader, so the output does
 * not depend on the machine's GPU. Writes WebP files to src/home/assets/.
 *
 * Usage: node scripts/render-home-stills.ts [name…]   (all stills when no name is given)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

type Pose = { target: [number, number, number]; az: number; el: number; dist: number };
interface Still {
  name: string;
  t: number;
  w: number;
  h: number;
  layout: 'desktop' | 'phone';
  pose?: Pose;
  fov?: number;
  quality?: number;
}

const STILLS: Still[] = [
  // posters: the animation's own frame at t = 19 s with the responsive framing of storyboard §2.2
  { name: 'poster-desktop', t: 19, w: 1920, h: 984, layout: 'desktop', quality: 0.8 },
  { name: 'poster-desktop-1280', t: 19, w: 1280, h: 656, layout: 'desktop', quality: 0.8 },
  { name: 'poster-mobile', t: 19, w: 780, h: 880, layout: 'phone', quality: 0.8 },
  // "What it is" stills (home.what.image*Alt)
  {
    name: 'still-model',
    t: 10.8,
    w: 800,
    h: 800,
    layout: 'phone',
    fov: 30,
    pose: { target: [-0.3, 0, 0.03], az: -30, el: 36, dist: 1.5 },
  },
  {
    name: 'still-projection',
    t: 15.6,
    w: 750,
    h: 500,
    layout: 'phone',
    fov: 30,
    pose: { target: [-0.28, 0, 0.0], az: -12, el: 52, dist: 1.35 },
  },
  {
    name: 'still-screen',
    t: 19.4,
    w: 750,
    h: 500,
    layout: 'phone',
    fov: 30,
    pose: { target: [0, 0.5, 0.7], az: -6, el: 6, dist: 1.0 },
  },
  // use case steps (decorative, alt="")
  {
    name: 'usecase-build',
    t: 7.4,
    w: 640,
    h: 480,
    layout: 'phone',
    fov: 30,
    pose: { target: [-0.32, 0, 0.02], az: -36, el: 40, dist: 1.6 },
  },
  {
    name: 'usecase-project',
    t: 15.6,
    w: 640,
    h: 480,
    layout: 'phone',
    fov: 30,
    pose: { target: [-0.05, 0, 0.0], az: 8, el: 50, dist: 2.2 },
  },
  {
    name: 'usecase-compare',
    t: 19.6,
    w: 640,
    h: 480,
    layout: 'phone',
    fov: 30,
    pose: { target: [0.05, 0, 0.0], az: 4, el: 54, dist: 1.9 },
  },
  {
    name: 'usecase-discuss',
    t: 20.6,
    w: 640,
    h: 480,
    layout: 'phone',
    fov: 32,
    pose: { target: [-0.2, -0.3, 0.4], az: 22, el: 20, dist: 3.4 },
  },
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src', 'home', 'assets');
mkdirSync(out, { recursive: true });
const only = new Set(process.argv.slice(2));

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const address = server.httpServer?.address();
const port = typeof address === 'object' && address ? address.port : 5173;
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${port}/?lz-autoplay=force`);
  await page.waitForFunction(() => window.__lzHome, null, { timeout: 60_000 });
  await page.evaluate(() => window.__lzHome!.play());
  const ok = await page.evaluate(() => window.__lzHome!.ready);
  if (!ok) throw new Error('the 3D stage did not start');
  await page.evaluate(() => window.__lzHome!.pause());
  for (const s of STILLS) {
    if (only.size && !only.has(s.name)) continue;
    const t0 = Date.now();
    const url = await page.evaluate(
      (st) =>
        window.__lzHome!.still(st.t, st.w, st.h, st.layout, {
          pose: st.pose,
          fov: st.fov,
          quality: st.quality ?? 0.78,
        }),
      s,
    );
    if (!url?.startsWith('data:image/webp')) throw new Error(`${s.name}: no WebP output`);
    const buf = Buffer.from(url.split(',')[1]!, 'base64');
    writeFileSync(join(out, `${s.name}.webp`), buf);
    console.log(
      `${s.name}.webp  ${s.w}×${s.h}  t=${s.t}s  ${(buf.length / 1024).toFixed(0)} kB  (${Date.now() - t0} ms)`,
    );
  }
} finally {
  await browser.close();
  await server.close();
}
