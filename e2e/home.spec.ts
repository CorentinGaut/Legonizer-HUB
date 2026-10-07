/**
 * Home page (SPEC H1–H10, §10.1; storyboard §4–5). Headless Chromium renders WebGL with
 * SwiftShader, which the page treats as "cannot hold the frame rate" (no autoplay, storyboard §7);
 * `?lz-autoplay=force` starts the animation anyway for the tests that need it playing.
 */
import { expect, type Page, test } from '@playwright/test';

const FORCE = '/?lz-autoplay=force';

async function startPlaying(page: Page, url = FORCE): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__lzHome?.mode() === 'playing', null, { timeout: 60_000 });
}

const mode = (page: Page) => page.evaluate(() => window.__lzHome!.mode());
const time = (page: Page) => page.evaluate(() => window.__lzHome!.time());

test.describe('home hero', () => {
  test('shows the poster first and loads the 3D chunk only after the page load (H10)', async ({ page }) => {
    const order: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (/poster-desktop.*\.webp/.test(u)) order.push('poster');
      if (/\/assets\/stage-[^/]+\.js$/.test(u)) order.push('stage');
    });
    await page.goto(FORCE);
    const loadedAt = await page.evaluate(
      () => performance.getEntriesByType('navigation')[0]!.toJSON().loadEventEnd,
    );
    await page.waitForFunction(() => window.__lzHome?.mode() === 'playing', null, { timeout: 60_000 });
    expect(order[0]).toBe('poster');
    expect(order).toContain('stage');
    const stageStart = await page.evaluate(
      () => performance.getEntriesByType('resource').find((e) => /\/assets\/stage-/.test(e.name))!.startTime,
    );
    expect(stageStart).toBeGreaterThanOrEqual(loadedAt);
    const poster = page.locator('img.lz-hero__poster');
    await expect(poster).toHaveAttribute('alt', /Part-Dieu district on a table/);
    expect(await poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    // the canvas is decorative; the region and the poster carry the description
    await expect(page.locator('canvas.lz-hero__canvas')).toHaveAttribute('aria-hidden', 'true');
    // largest contentful paint is the poster or the headline, never the canvas
    const lcp = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          new PerformanceObserver((list) => {
            const e = list.getEntries().at(-1) as PerformanceEntry & { element?: Element };
            resolve(e?.element?.tagName ?? '');
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        }),
    );
    expect(['IMG', 'H1', 'P']).toContain(lcp);
  });

  test('does not autoplay on a software renderer; Play starts it', async ({ page }) => {
    const stageRequests: string[] = [];
    page.on('request', (r) => /\/assets\/stage-/.test(r.url()) && stageRequests.push(r.url()));
    await page.goto('/');
    await page.waitForLoadState('load');
    await page.waitForTimeout(2500);
    const renderer = await page.evaluate(() => window.__lzHome!.renderer);
    test.skip(!/swiftshader|llvmpipe|software/i.test(renderer), `hardware renderer: ${renderer}`);
    expect(await mode(page)).toBe('poster');
    expect(stageRequests).toEqual([]);
    const toggle = page.locator('.lz-hero__toggle');
    await expect(toggle).toHaveAttribute('aria-label', 'Play animation');
    await toggle.click();
    await page.waitForFunction(() => window.__lzHome?.mode() === 'playing', null, { timeout: 60_000 });
    await expect(toggle).toHaveAttribute('aria-label', 'Pause animation');
  });

  test('pause and play (H9, WCAG 2.2.2)', async ({ page }) => {
    await startPlaying(page);
    const toggle = page.locator('.lz-hero__toggle');
    await expect(toggle).toHaveAttribute('aria-label', 'Pause animation');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', 'Play animation');
    expect(await mode(page)).toBe('paused');
    const t1 = await time(page);
    await page.waitForTimeout(600);
    expect(await time(page)).toBe(t1);
    // keyboard: Space on the focused button
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-label', 'Pause animation');
    await page.waitForTimeout(600);
    expect(await time(page)).not.toBe(t1);
  });

  test('pauses off-screen and in a hidden tab; resumes only if the user had not paused (H9)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await startPlaying(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => mode(page)).toBe('paused');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => mode(page)).toBe('playing');
    // hidden tab
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await mode(page)).toBe('paused');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => mode(page)).toBe('playing');
    // user pause wins over visibility
    await page.locator('.lz-hero__toggle').click();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    expect(await mode(page)).toBe('paused');
  });

  test('chapters jump to the start of each scene', async ({ page }) => {
    await startPlaying(page);
    const chapters = page.locator('.lz-chapters button');
    await expect(chapters).toHaveCount(5);
    await expect(chapters.nth(2)).toHaveAttribute('aria-label', 'Chapter 3 of 5: Projecting');
    await chapters.nth(2).click();
    const t = await time(page);
    expect(t).toBeGreaterThanOrEqual(11);
    expect(t).toBeLessThan(13);
    await expect(chapters.nth(2)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.lz-caption__text')).toHaveText('Project urban data onto the white bricks.');
  });

  test('the loop is seamless over three cycles (SPEC §10.1)', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 700 });
    await startPlaying(page, '/?lz-autoplay=force&lz-speed=8');
    // 1. state and camera at 0, 28, 56 and 84 s are identical, and so are the rendered pixels
    const seam = await page.evaluate(() => {
      const d = window.__lzHome!;
      const snaps = [0, 28, 56, 84].map((t) => JSON.stringify(d.snapshot(t)));
      const px = [0, 28, 84].map((t) => d.still(t, 320, 180, 'desktop', { type: 'image/png' }));
      return { snaps, px };
    });
    expect(new Set(seam.snaps).size).toBe(1);
    expect(new Set(seam.px).size).toBe(1);
    // 2. play three accelerated cycles: the caption always matches the rendered time and the loop
    //    time stays a pure function of the clock (no drift)
    const result = await page.evaluate(async () => {
      const d = window.__lzHome!;
      const bounds = [0, 3, 11, 16, 23];
      const idx = (t: number) => bounds.filter((b) => t >= b).length - 1;
      const first = d.sample();
      let mismatches = 0;
      let samples = 0;
      let maxDrift = 0;
      let wraps = 0;
      let prev = first.t;
      const end = performance.now() + 3.4 * 3500; // 3.4 cycles at 8× (3.5 s per cycle)
      while (performance.now() < end) {
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        const s = d.sample();
        samples++;
        if (s.caption !== idx(s.rendered)) mismatches++;
        const expected = (((first.t + ((s.clock - first.clock) / 1000) * 8) % 28) + 28) % 28;
        const diff = Math.abs(expected - s.t);
        maxDrift = Math.max(maxDrift, Math.min(diff, 28 - diff));
        if (s.t < prev) wraps++;
        prev = s.t;
      }
      return { samples, mismatches, maxDrift, wraps };
    });
    console.log('loop sync over accelerated cycles:', result);
    expect(result.wraps).toBeGreaterThanOrEqual(3);
    expect(result.mismatches).toBe(0);
    expect(result.maxDrift).toBeLessThan(1e-6);
  });

  test('real-time loop: three 28 s cycles without drift', async ({ page }) => {
    test.skip(!process.env.LZ_E2E_SLOW, 'set LZ_E2E_SLOW=1 to run the 85 s real-time check');
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 800, height: 600 });
    await startPlaying(page);
    await page.evaluate(() => window.__lzHome!.setTime(0));
    const result = await page.evaluate(async () => {
      const d = window.__lzHome!;
      const bounds = [0, 3, 11, 16, 23];
      const idx = (t: number) => bounds.filter((b) => t >= b).length - 1;
      const first = d.sample();
      const changes: { cycle: number; caption: number; at: number }[] = [];
      let last = first.caption;
      let mismatches = 0;
      let maxDrift = 0;
      while (performance.now() - first.clock < 85_000) {
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        const s = d.sample();
        if (s.caption !== idx(s.rendered)) mismatches++;
        const elapsed = (s.clock - first.clock) / 1000;
        const expected = (first.t + elapsed) % 28;
        const diff = Math.abs(expected - s.t);
        maxDrift = Math.max(maxDrift, Math.min(diff, 28 - diff));
        if (s.caption !== last) {
          changes.push({ cycle: Math.floor((first.t + elapsed) / 28), caption: s.caption, at: s.rendered });
          last = s.caption;
        }
      }
      return { mismatches, maxDrift, changes };
    });
    console.log('real-time loop:', JSON.stringify(result));
    expect(result.mismatches).toBe(0);
    expect(result.maxDrift).toBeLessThan(1e-6);
    // every cycle changes captions at the same scene times (within one frame of software rendering)
    const byCycle = [0, 1, 2].map((c) => result.changes.filter((x) => x.cycle === c).map((x) => x.caption));
    expect(byCycle[1]).toEqual(byCycle[2]);
  });

  test('reduced motion: poster, story as text, explicit play (H8)', async ({ browser }) => {
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    const stageRequests: string[] = [];
    page.on('request', (r) => /\/assets\/stage-/.test(r.url()) && stageRequests.push(r.url()));
    await page.goto(FORCE);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    expect(await mode(page)).toBe('poster');
    expect(stageRequests).toEqual([]);
    await expect(page.locator('canvas.lz-hero__canvas')).toHaveCount(0);
    await expect(page.locator('#story')).toHaveAttribute('open', '');
    await expect(page.locator('#story li')).toHaveCount(5);
    const toggle = page.locator('.lz-hero__toggle');
    await expect(toggle).toHaveAttribute('aria-label', 'Play the animation');
    await toggle.click();
    await page.waitForFunction(() => window.__lzHome?.mode() === 'playing', null, { timeout: 60_000 });
    await context.close();
  });

  test('without WebGL 2: poster, story and a note', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        if (type === 'webgl2') return null;
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...args);
      } as typeof orig;
    });
    await page.goto(FORCE);
    await expect(page.locator('.lz-hero__fallback')).toBeVisible();
    await expect(page.locator('.lz-hero__toggle')).toBeHidden();
    await expect(page.locator('#story')).toHaveAttribute('open', '');
    expect(await mode(page)).toBe('unsupported');
  });
});

test.describe('home page', () => {
  test('primary CTA reaches /create, demo CTA asks for Part-Dieu (H6)', async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('#hero');
    await expect(hero.getByRole('link', { name: 'Try with Part-Dieu' })).toHaveAttribute(
      'href',
      'create.html?demo=part-dieu',
    );
    await hero.getByRole('link', { name: 'Create your model' }).click();
    await expect(page).toHaveURL(/create\.html$/);
  });

  test('describes what, why, how, who, the use case and credits (H5, H7)', async ({ page }) => {
    await page.goto('/');
    for (const name of [
      'A brick model of your city, ready to build',
      'Why bricks, and why project on them?',
      'How it works',
      'What you get',
      "Who it's for",
      'Use case: a workshop on Part-Dieu',
      'Credits',
    ])
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Read the paper on HAL' }).first()).toHaveAttribute(
      'href',
      'https://hal.science/hal-04924304',
    );
    await expect(page.locator('#lz-footer')).toContainText(
      'LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize or endorse this site.',
    );
    await expect(page.getByRole('link', { name: 'Create your model' })).toHaveCount(4);
  });

  test('switches language and keeps the choice (N6)', async ({ page }) => {
    await page.goto('/');
    await page.locator('.lz-header__inner [data-lz-locale="fr"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('#hero-title')).toHaveText(/^D'une maquette 3D de ville/);
    await expect(page.locator('.lz-caption__text')).toHaveText(
      'Voyez comment le quartier a changé, et parlez-en ensemble.',
    );
    await expect(page.locator('.lz-chapters button').first()).toHaveAttribute(
      'aria-label',
      'Chapitre 1 sur 5 : Le décor',
    );
    await expect(page).toHaveTitle(/maquette de briques/);
    await expect(page.locator('.lz-header__inner [data-lz-locale="fr"]')).toBeFocused();
    await page.reload();
    await expect(page.locator('#hero-title')).toHaveText(/^D'une maquette 3D de ville/);
    await page.locator('.lz-header__inner [data-lz-locale="en"]').click();
    await expect(page.locator('#hero-title')).toHaveText(/^From a 3D city model/);
  });

  test('theme switch in the footer (design-system §13, UI-13)', async ({ page }) => {
    await page.goto('/');
    const dark = page.getByRole('button', { name: 'Dark' });
    await dark.click();
    await expect(dark).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Automatic' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('phone: header menu sheet with navigation and language (390 px)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(page.locator('.lz-header__inner .lz-nav')).toBeHidden();
    await menu.click();
    const sheet = page.locator('#lz-menu-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'About' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
    // hero CTA above the fold at 390 × 844 (ux-spec §7.1.2)
    const cta = page.locator('#hero').getByRole('link', { name: 'Create your model' });
    const box = await cta.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  });

  test('skip link moves focus to the main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });
});

test.describe('about page', () => {
  test('credits, citation, data preparation, licences and trademark (N9, N10, I13)', async ({ page }) => {
    await page.goto('/about.html#prepare-data');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('About the Legonizer');
    await expect(page.getByRole('heading', { level: 2, name: 'Prepare your data' })).toBeInViewport();
    await expect(page.locator('#licences')).toContainText('legonizer 1.1.0 (core algorithm): ISC licence.');
    await expect(page.locator('#licences')).toContainText('UD-Viz Legonizer widget 4.6.1: LGPL-2.1 licence.');
    await expect(page.locator('#licences')).toContainText('Research paper and figures: CC0 1.0.');
    await expect(page.locator('#licences')).toContainText('Métropole de Lyon');
    await expect(page.locator('#trademark')).toContainText('LEGO® is a trademark of the LEGO Group');
    await expect(page.locator('#research blockquote')).toHaveAttribute('lang', 'fr');
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'About' }),
    ).toHaveAttribute('aria-current', 'page');
  });
});
