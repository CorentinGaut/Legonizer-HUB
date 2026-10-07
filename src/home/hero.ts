/**
 * Home hero controller (SPEC H1, H8–H10; storyboard §5): poster first, the 3D chunk loads after
 * the page (`load` + idle), renders t = 19 s identical to the poster, crossfades in and plays.
 * Captions and chapters are HTML synced to t. Pause/play (WCAG 2.2.2), pause off-screen
 * (< 25 % visible) and in hidden tabs, resume only if the user had not paused. Reduced motion:
 * poster, the story as a list, explicit *Play the animation*. No WebGL 2: poster + story + note.
 * Frame-rate guard (storyboard §7): quality steps down, then the animation stops on the poster.
 */
import { onLocaleChange, t as tr } from '../shared/i18n.ts';
import { icon } from '../shared/icons.ts';
import { CAPTIONS, CHAPTER_STARTS, POSTER_T, captionIndexAt, wrap } from './timeline.ts';
import type { LegendLabels } from './scene/projection.ts';
import type { Stage, StageSnapshot } from './scene/stage.ts';

type Mode = 'poster' | 'loading' | 'playing' | 'paused' | 'unsupported' | 'error';

export interface HeroDebug {
  mode(): Mode;
  time(): number;
  setTime(t: number): void;
  play(): Promise<void>;
  pause(): void;
  snapshot(t: number): StageSnapshot | null;
  still(
    t: number,
    w: number,
    h: number,
    layout: 'desktop' | 'phone',
    opts?: Parameters<Stage['still']>[4],
  ): string | null;
  stats(): Stage['stats'] | null;
  /** Loop time now, time of the last rendered frame and the caption shown, for the sync test. */
  sample(): { t: number; rendered: number; caption: number; clock: number };
  ready: Promise<boolean>;
  /** WebGL renderer string, known once the page has loaded. */
  renderer: string;
}

declare global {
  interface Window {
    __lzHome?: HeroDebug;
  }
}

function probeWebGL(): { webgl2: boolean; software: boolean; renderer: string } {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { webgl2: false, software: false, renderer: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return {
      webgl2: true,
      software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer),
      renderer,
    };
  } catch {
    return { webgl2: false, software: false, renderer: '' };
  }
}

function legendLabels(): LegendLabels {
  const k = (n: string) => tr(`home.animation.legend.${n}`);
  return {
    housing: k('housing'),
    offices: k('offices'),
    shops: k('shops'),
    public: k('public'),
    vegetation: k('vegetation'),
    tram: k('tram'),
    built: k('built'),
    demolished: k('demolished'),
    modified: k('modified'),
  };
}

const idle = (fn: () => void, timeout: number) => {
  const ric = (window as { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number })
    .requestIdleCallback;
  if (ric) ric(fn, { timeout });
  else setTimeout(fn, 200);
};

export function initHero(): HeroDebug | undefined {
  const hero = document.getElementById('hero');
  if (!hero) return undefined;
  const media = hero.querySelector<HTMLElement>('.lz-hero__media')!;
  const toggle = hero.querySelector<HTMLButtonElement>('.lz-hero__toggle')!;
  const captionEl = hero.querySelector<HTMLElement>('.lz-caption__text')!;
  const chapters = hero.querySelector<HTMLOListElement>('.lz-chapters')!;
  const story = document.getElementById('story') as HTMLDetailsElement | null;
  const fallback = document.querySelector<HTMLElement>('.lz-hero__fallback');
  const params = new URLSearchParams(location.search);
  const speed = Math.max(0.05, Number(params.get('lz-speed')) || 1);
  const forceAutoplay = params.get('lz-autoplay') === 'force';
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  const phoneMq = matchMedia('(max-width: 767px)');

  let mode: Mode = 'poster';
  let stage: Stage | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let t = POSTER_T;
  let clock0 = 0;
  let raf = 0;
  let userPaused = false;
  let offscreen = false;
  let captionIdx = captionIndexAt(POSTER_T);
  let loading: Promise<boolean> | null = null;
  let resolveReady: (ok: boolean) => void = () => {};
  const ready = new Promise<boolean>((r) => (resolveReady = r));
  // probed after the page load: creating a WebGL context can take a second on software GL
  let probe = { webgl2: true, software: false, renderer: '' };

  // ------------------------------------------------------------------ captions, chapters, toggle
  function renderChapters(): void {
    chapters.innerHTML = CAPTIONS.map(
      (c, n) =>
        `<li><button type="button" data-chapter="${n}" aria-label="${tr('home.hero.chapter', {
          n: n + 1,
          title: tr(`home.animation.chapterTitles.${c.id}`),
        }).replace(/"/g, '&quot;')}"${n === captionIdx ? ' aria-current="true"' : ''}></button></li>`,
    ).join('');
    chapters.setAttribute('aria-label', tr('home.hero.chaptersLabel'));
  }

  function setCaption(idx: number, animate: boolean): void {
    if (idx === captionIdx && captionEl.textContent) return;
    captionIdx = idx;
    const text = tr(`home.animation.captions.${CAPTIONS[idx]!.id}`);
    chapters.querySelectorAll('button').forEach((b, n) => {
      if (n === idx) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
    if (!animate || reducedMq.matches) {
      captionEl.textContent = text;
      captionEl.classList.remove('is-fading');
      return;
    }
    captionEl.classList.add('is-fading');
    setTimeout(() => {
      captionEl.textContent = tr(`home.animation.captions.${CAPTIONS[captionIdx]!.id}`);
      captionEl.classList.remove('is-fading');
    }, 150);
  }

  function renderToggle(): void {
    const showsPause = !userPaused && (mode === 'playing' || mode === 'loading' || mode === 'paused');
    const label = showsPause
      ? tr('home.hero.pause')
      : reducedMq.matches && !stage
        ? tr('home.hero.playReducedMotion')
        : tr('home.hero.play');
    toggle.setAttribute('aria-label', label);
    toggle.innerHTML = `${icon(showsPause ? 'pause' : 'play')}<span class="lz-hero__toggle-label u-hide-sm" aria-hidden="true">${label}</span>`;
    toggle.setAttribute('aria-busy', String(mode === 'loading' && !userPaused));
  }

  // ------------------------------------------------------------------ clock and loop
  const now = () => performance.now();
  const currentTime = () => (mode === 'playing' ? wrap(((now() - clock0) / 1000) * speed) : t);

  let frames: number[] = [];
  let lastFrame = 0;
  let guardFrom = 0;
  let windowStart = 0;
  /**
   * Keep degrading but never stop on the poster: after the user pressed Play following a guard
   * stop, and with `?lz-autoplay=force` (tests, stills).
   */
  let keepPlaying = forceAutoplay;
  let guardStopped = false;

  function frame(): void {
    raf = 0;
    if (mode !== 'playing' || !stage) return;
    t = currentTime();
    stage.renderAt(t);
    setCaption(captionIndexAt(t), true);
    // frame-rate guard (storyboard §7): mean frame interval over 2 s windows after a 1.5 s
    // warm-up; below ~38 fps drop one quality step; a slideshow (< 7 fps) stops on the poster
    const n = now();
    if (lastFrame && n > guardFrom) {
      frames.push(n - lastFrame);
      if (!windowStart) windowStart = n;
      if (n - windowStart >= 2000 && frames.length >= 4) {
        const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
        frames = [];
        windowStart = 0;
        if (mean > 150 && !keepPlaying) {
          stopOnPoster();
          return;
        }
        if (mean > 1000 / 38) {
          if (!stage.degrade() && !keepPlaying) {
            stopOnPoster();
            return;
          }
          guardFrom = n + 1000;
        }
      }
    }
    lastFrame = n;
    raf = requestAnimationFrame(frame);
  }

  function startClock(from: number): void {
    t = wrap(from);
    clock0 = now() - (t / speed) * 1000;
    lastFrame = 0;
    frames = [];
    windowStart = 0;
    guardFrom = now() + 1500;
  }

  function run(): void {
    if (!stage) return;
    mode = 'playing';
    startClock(t);
    renderToggle();
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function halt(byUser: boolean): void {
    if (mode !== 'playing') return;
    t = currentTime();
    mode = 'paused';
    if (byUser) userPaused = true;
    cancelAnimationFrame(raf);
    raf = 0;
    renderToggle();
  }

  function stopOnPoster(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    mode = 'poster';
    guardStopped = true;
    userPaused = true;
    if (canvas) canvas.classList.remove('is-visible');
    t = POSTER_T;
    setCaption(captionIndexAt(POSTER_T), false);
    renderToggle();
  }

  // ------------------------------------------------------------------ loading the 3D chunk
  function load(): Promise<boolean> {
    if (loading) return loading;
    mode = 'loading';
    renderToggle();
    loading = (async () => {
      try {
        const t0 = performance.now();
        const { createStage } = await import('./scene/stage.ts');
        performance.measure('lz:stage:import', { start: t0 });
        canvas = document.createElement('canvas');
        canvas.className = 'lz-hero__canvas';
        canvas.setAttribute('aria-hidden', 'true');
        media.append(canvas);
        const lowEnd =
          ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4 ||
          (navigator.hardwareConcurrency ?? 8) <= 4 ||
          (phoneMq.matches && matchMedia('(pointer: coarse)').matches);
        stage = await createStage(canvas, { labels: legendLabels(), quality: lowEnd ? 'low' : 'high' });
        resize();
        const t1 = performance.now();
        stage.renderAt(POSTER_T); // identical to the poster (storyboard §5)
        performance.measure('lz:stage:first-frame', { start: t1 });
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        canvas.classList.add('is-visible');
        resolveReady(true);
        return true;
      } catch (err) {
        console.warn('[home] 3D animation unavailable, keeping the poster:', err);
        canvas?.remove();
        canvas = null;
        stage = null;
        mode = 'error';
        toggle.hidden = true;
        resolveReady(false);
        return false;
      }
    })();
    return loading;
  }

  async function play(): Promise<void> {
    userPaused = false;
    if (guardStopped) keepPlaying = true;
    if (!stage) {
      const ok = await load();
      if (!ok) return;
      t = POSTER_T;
      mode = 'paused';
    }
    if (userPaused) {
      // paused by the user while the 3D was loading
      mode = 'paused';
      renderToggle();
      return;
    }
    canvas?.classList.add('is-visible');
    if (offscreen || document.hidden) {
      mode = 'paused';
      renderToggle();
      return;
    }
    run();
  }

  function resize(): void {
    if (!stage || !canvas) return;
    const r = media.getBoundingClientRect();
    stage.setSize(r.width, r.height, phoneMq.matches ? 'phone' : 'desktop');
    if (mode !== 'playing') stage.renderAt(t);
  }

  // ------------------------------------------------------------------ wiring
  renderChapters();
  setCaption(captionIdx, false);
  if (reducedMq.matches && story) story.open = true;

  function decide(): void {
    probe = probeWebGL();
    debug.renderer = probe.renderer;
    if (!probe.webgl2) {
      mode = 'unsupported';
      toggle.hidden = true;
      chapters.hidden = true;
      if (fallback) fallback.hidden = false;
      if (story) story.open = true;
      resolveReady(false);
      return;
    }
    toggle.hidden = false;
    chapters.hidden = false;
    const autoplay = !reducedMq.matches && (!probe.software || forceAutoplay);
    if (autoplay) void play();
    else userPaused = true;
    renderToggle();
  }
  const afterLoad = () => idle(decide, 1500);
  if (document.readyState === 'complete') afterLoad();
  else addEventListener('load', afterLoad, { once: true });

  toggle.addEventListener('click', () => {
    if (mode === 'playing') halt(true);
    else if ((mode === 'loading' || mode === 'paused') && !userPaused) {
      userPaused = true;
      renderToggle();
    } else void play();
  });
  chapters.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-chapter]');
    if (!b) return;
    const n = Number(b.dataset.chapter);
    const start = CHAPTER_STARTS[n] ?? 0;
    if (mode === 'playing') startClock(start);
    else {
      t = start;
      setCaption(n, false);
      if (stage) stage.renderAt(t);
      else if (!reducedMq.matches) void play().then(() => mode === 'playing' && startClock(start));
    }
  });

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        offscreen = e.intersectionRatio < 0.25;
        if (offscreen) halt(false);
        else if (mode === 'paused' && !userPaused && !document.hidden) run();
      }
    },
    { threshold: [0, 0.25, 0.5] },
  );
  io.observe(hero);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) halt(false);
    else if (mode === 'paused' && !userPaused && !offscreen) run();
  });
  reducedMq.addEventListener('change', () => {
    if (reducedMq.matches && mode === 'playing') halt(true);
    renderToggle();
  });
  new ResizeObserver(() => resize()).observe(media);
  onLocaleChange(() => {
    renderChapters();
    captionEl.textContent = tr(`home.animation.captions.${CAPTIONS[captionIdx]!.id}`);
    renderToggle();
    stage?.setLabels(legendLabels());
    if (stage && mode !== 'playing') stage.renderAt(t);
  });

  const debug: HeroDebug = {
    mode: () => mode,
    time: () => currentTime(),
    setTime: (x: number) => {
      if (mode === 'playing') startClock(x);
      else {
        t = wrap(x);
        setCaption(captionIndexAt(t), false);
        stage?.renderAt(t);
      }
    },
    play,
    pause: () => {
      if (mode === 'playing') halt(true);
      else {
        userPaused = true;
        renderToggle();
      }
    },
    snapshot: (x: number) => stage?.snapshot(x) ?? null,
    still: (x, w, h, layout, opts) => stage?.still(x, w, h, layout, opts) ?? null,
    stats: () => stage?.stats ?? null,
    sample: () => {
      const clock = now(); // one clock read for both values
      const cur = mode === 'playing' ? wrap(((clock - clock0) / 1000) * speed) : t;
      return { t: cur, rendered: t, caption: captionIdx, clock };
    },
    ready,
    renderer: '',
  };
  window.__lzHome = debug;
  return debug;
}
