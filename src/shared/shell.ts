/**
 * Site shell shared by every page (SPEC §5): skip link, header
 * (logo, Create / About / Help, language switch, page action, phone menu) and footer (citation,
 * credit, source code, licences, privacy line, theme switch, trademark disclaimer N9).
 *
 * Page contract:
 *   <header id="lz-header"></header>
 *   <main id="main"> … </main>
 *   <footer id="lz-footer"></footer>
 *   mountShell({ page: 'home' | 'create' | 'about' });
 *
 * The create page gets the full-width header (`lz-header--wide`) and an empty action slot
 * `#lz-header-actions` for its project menu; home and about get the primary "Create your model".
 * Header and footer re-render on `setLocale` (focus is kept on the language switch).
 */
import '../styles/index.css';
import { getLocale, onLocaleChange, setLocale, t, type Locale } from './i18n.ts';
import { ensureIconSprite, icon } from './icons.ts';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from './theme.ts';

export type ShellPage = 'home' | 'create' | 'about';

export interface ShellOptions {
  page: ShellPage;
  /** Optional i18n keys for `document.title` and the meta description, kept in sync with the locale. */
  titleKey?: string;
  descriptionKey?: string;
  /** Where *Help* points (default: the data-preparation help on the about page). */
  helpHref?: string;
}

/** Research paper on HAL (SPEC §0, H7). */
export const PAPER_URL = 'https://hal.science/hal-04924304';
/** Development credit, main contributors: the names end the sentence in every locale, so they follow `footer.developedBy`. */
export const DEVELOPERS = [
  { name: 'Jey Puget Gil', url: 'https://hemoreg.me' },
  { name: 'Corentin Gautier', url: 'https://corentingaut.github.io/' },
] as const;
export const UDVIZ_URL = 'https://github.com/VCityTeam/UD-Viz';
/** Source code of this site; another repository can be set with VITE_SOURCE_URL at build time. */
export const SOURCE_URL: string =
  (import.meta.env?.VITE_SOURCE_URL as string | undefined) || 'https://github.com/CorentinGaut/Legonizer-HUB';

export const PAGE_HREF = {
  home: './',
  create: 'create.html',
  about: 'about.html',
  help: 'about.html#prepare-data',
  licences: 'about.html#licences',
} as const;

const LOGO_MARK = `<svg class="lz-logo__mark" viewBox="-18.82 -31.5 37.64 53" aria-hidden="true" focusable="false"><polygon points="-8.66,-25 0,-20 0,10 -8.66,5" class="l"/><polygon points="8.66,-25 0,-20 0,10 8.66,5" class="r"/><polygon points="0,-30 8.66,-25 0,-20 -8.66,-25" style="fill:var(--lz-color-accent)"/><polygon points="0,-8 8.66,-3 8.66,15 0,10" class="l"/><polygon points="17.32,-8 8.66,-3 8.66,15 17.32,10" class="r"/><polygon points="8.66,-13 17.32,-8 8.66,-3 0,-8" style="fill:var(--lz-brick-top)"/><polygon points="-17.32,-2 -8.66,3 -8.66,15 -17.32,10" class="l"/><polygon points="0,-2 -8.66,3 -8.66,15 0,10" class="r"/><polygon points="-8.66,-7 0,-2 -8.66,3 -17.32,-2" style="fill:var(--lz-brick-top)"/><polygon points="-8.66,9 0,14 0,20 -8.66,15" class="l"/><polygon points="8.66,9 0,14 0,20 8.66,15" class="r"/><polygon points="0,4 8.66,9 0,14 -8.66,9" style="fill:var(--lz-brick-top)"/></svg>`;

const LOCALE_LABEL: Record<Locale, { short: string; nameKey: string }> = {
  en: { short: 'EN', nameKey: 'header.language.en' },
  fr: { short: 'FR', nameKey: 'header.language.fr' },
};

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

let mounted: ShellOptions | undefined;
let menuOpen = false;

function navHtml(page: ShellPage, helpHref: string): string {
  const cur = (p: ShellPage) => (p === page ? ' aria-current="page"' : '');
  return `
    <a href="${PAGE_HREF.create}"${cur('create')}>${escapeHtml(t('header.nav.create'))}</a>
    <a href="${PAGE_HREF.about}"${cur('about')}>${escapeHtml(t('header.nav.about'))}</a>
    <a href="${escapeHtml(helpHref)}">${escapeHtml(t('header.nav.help'))}</a>`;
}

function langHtml(): string {
  const cur = getLocale();
  const links = (Object.keys(LOCALE_LABEL) as Locale[])
    .map((l) => {
      const { short, nameKey } = LOCALE_LABEL[l];
      // The visible label is the code; <abbr title> gives the language name (label-in-name holds).
      return `<a href="?lang=${l}" lang="${l}" hreflang="${l}" data-lz-locale="${l}"${
        l === cur ? ' aria-current="true"' : ''
      }><abbr title="${escapeHtml(t(nameKey))}">${short}</abbr></a>`;
    })
    .join('');
  return `<div class="lz-lang" role="group" aria-label="${escapeHtml(t('header.language.label'))}">${links}</div>`;
}

function renderHeader(el: HTMLElement, opts: ShellOptions): void {
  const helpHref = opts.helpHref ?? PAGE_HREF.help;
  const isCreate = opts.page === 'create';
  el.classList.add('lz-header');
  el.classList.toggle('lz-header--wide', isCreate);
  // Keep a page-provided action slot (create page project menu) across re-renders.
  const prevSlot = el.querySelector<HTMLElement>('#lz-header-actions');
  const action = isCreate
    ? ''
    : `<a class="lz-btn lz-btn--primary lz-btn--sm lz-header__hide-sm" href="${PAGE_HREF.create}">${escapeHtml(
        t('header.cta'),
      )}</a>
       <a class="lz-btn lz-btn--primary lz-btn--sm u-only-sm" href="${PAGE_HREF.create}">${escapeHtml(
         t('header.nav.create'),
       )}</a>`;
  el.innerHTML = `
  <div class="lz-header__inner">
    <a class="lz-logo" href="${PAGE_HREF.home}" aria-label="${escapeHtml(t('header.homeLink'))}">
      ${LOGO_MARK}<span class="lz-logo__word">${escapeHtml(t('common.productName'))}</span>
    </a>
    <nav class="lz-nav" aria-label="${escapeHtml(t('header.nav.label'))}">${navHtml(opts.page, helpHref)}</nav>
    <span class="lz-header__spacer"></span>
    ${langHtml()}
    <div class="lz-header__actions" id="lz-header-actions">${action}</div>
    <button type="button" class="lz-btn lz-btn--quiet lz-btn--icon lz-header__menu-btn" aria-expanded="${menuOpen}"
      aria-controls="lz-menu-sheet" aria-label="${escapeHtml(t(menuOpen ? 'header.closeMenu' : 'header.menu'))}">
      ${icon(menuOpen ? 'x' : 'menu')}
    </button>
  </div>
  <div class="lz-menu-sheet" id="lz-menu-sheet"${menuOpen ? '' : ' hidden'}>
    <nav class="lz-menu-sheet__nav" aria-label="${escapeHtml(t('header.nav.label'))}">${navHtml(opts.page, helpHref)}</nav>
    <div class="lz-menu-sheet__row"><span class="lz-menu-sheet__label">${escapeHtml(
      t('header.language.label'),
    )}</span>${langHtml()}</div>
  </div>`;
  if (prevSlot && isCreate) {
    el.querySelector('#lz-header-actions')?.replaceWith(prevSlot);
  }
}

function themeSwitchHtml(): string {
  const choice = getThemeChoice();
  const opt = (c: ThemeChoice, ic: 'monitor' | 'sun' | 'moon') =>
    `<button type="button" class="lz-theme-switch__btn" data-lz-theme="${c}" aria-pressed="${c === choice}">${icon(
      ic,
      { size: 'sm' },
    )}<span>${escapeHtml(t(`common.theme.${c}`))}</span></button>`;
  return `<div class="lz-theme-switch" role="group" aria-labelledby="lz-theme-label">
    <span id="lz-theme-label" class="lz-theme-switch__label">${escapeHtml(t('common.theme.label'))}</span>
    ${opt('auto', 'monitor')}${opt('light', 'sun')}${opt('dark', 'moon')}
  </div>`;
}

function renderFooter(el: HTMLElement): void {
  el.classList.add('lz-footer');
  el.innerHTML = `
  <div class="lz-footer__inner">
    <div>
      <h2>${escapeHtml(t('footer.citationLabel'))}</h2>
      <p lang="fr">${escapeHtml(t('footer.citation'))}</p>
      <p class="u-mt-2"><a class="lz-link" href="${PAPER_URL}">${escapeHtml(t('footer.paperLink'))}</a></p>
      <p class="u-mt-4">${escapeHtml(t('footer.credit'))}</p>
      <p class="u-mt-2">${escapeHtml(t('footer.developedBy'))} ${DEVELOPERS.map((d) => `<a class="lz-link" href="${d.url}">${d.name}</a>`).join(` ${escapeHtml(t('footer.and'))} `)}.</p>
    </div>
    <div class="lz-footer__links">
      <a class="lz-link" href="${escapeHtml(SOURCE_URL)}">${escapeHtml(t('footer.sourceCode'))}</a>
      <a class="lz-link" href="${PAGE_HREF.licences}">${escapeHtml(t('footer.licences'))}</a>
      <span>${escapeHtml(t('footer.privacy'))}</span>
      ${themeSwitchHtml()}
    </div>
    <div class="lz-footer__legal">
      <p>${escapeHtml(t('footer.trademark'))}</p>
      <p>${escapeHtml(t('footer.copyright'))}</p>
    </div>
  </div>`;
}

function applyMeta(opts: ShellOptions): void {
  if (opts.titleKey) document.title = t(opts.titleKey);
  if (opts.descriptionKey) {
    document.querySelector('meta[name="description"]')?.setAttribute('content', t(opts.descriptionKey));
  }
}

function setMenu(open: boolean, focusButton = false): void {
  menuOpen = open;
  const header = document.getElementById('lz-header');
  const btn = header?.querySelector<HTMLButtonElement>('.lz-header__menu-btn');
  const sheet = header?.querySelector<HTMLElement>('#lz-menu-sheet');
  if (!btn || !sheet) return;
  sheet.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', t(open ? 'header.closeMenu' : 'header.menu'));
  btn.innerHTML = icon(open ? 'x' : 'menu');
  if (open) sheet.querySelector<HTMLElement>('a')?.focus();
  else if (focusButton) btn.focus();
}

function ensureSkipLink(): void {
  const main =
    document.querySelector<HTMLElement>('main#main') ?? document.querySelector<HTMLElement>('main');
  if (main && !main.id) main.id = 'main';
  if (main && !main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  let link = document.querySelector<HTMLAnchorElement>('a.lz-skip-link');
  if (!link) {
    link = document.createElement('a');
    link.className = 'lz-skip-link';
    link.href = `#${main?.id ?? 'main'}`;
    document.body.prepend(link);
  }
  link.textContent = t('header.skipToContent');
}

function render(): void {
  if (!mounted) return;
  const header = document.getElementById('lz-header');
  const footer = document.getElementById('lz-footer');
  if (header) renderHeader(header, mounted);
  if (footer) renderFooter(footer);
  ensureSkipLink();
  applyMeta(mounted);
}

/** Render the header and footer of a page and wire their controls. Call once per page. */
export function mountShell(opts: ShellOptions): void {
  if (mounted) {
    mounted = opts;
    render();
    return;
  }
  mounted = opts;
  ensureIconSprite();
  render();

  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const langLink = target?.closest<HTMLAnchorElement>('[data-lz-locale]');
    if (langLink) {
      e.preventDefault();
      const l = langLink.dataset.lzLocale as Locale;
      const inSheet = !!langLink.closest('#lz-menu-sheet');
      setLocale(l);
      // Keep focus on the switch after the re-render.
      const sel = `${inSheet ? '#lz-menu-sheet ' : '.lz-header__inner '}[data-lz-locale="${l}"]`;
      document.querySelector<HTMLElement>(sel)?.focus();
      return;
    }
    const themeBtn = target?.closest<HTMLButtonElement>('[data-lz-theme]');
    if (themeBtn) {
      setThemeChoice(themeBtn.dataset.lzTheme as ThemeChoice);
      const choice = getThemeChoice();
      document.querySelectorAll<HTMLButtonElement>('[data-lz-theme]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.lzTheme === choice));
      });
      return;
    }
    if (target?.closest('.lz-header__menu-btn')) {
      setMenu(!menuOpen);
      return;
    }
    if (menuOpen && !target?.closest('#lz-header')) setMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuOpen) setMenu(false, true);
  });
  // Close the phone menu when the layout goes back to desktop.
  matchMedia('(min-width: 768px)').addEventListener('change', (e) => {
    if (e.matches && menuOpen) setMenu(false);
  });
  onLocaleChange(() => render());
}
