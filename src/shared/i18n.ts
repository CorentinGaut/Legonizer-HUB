/**
 * i18n for every page (SPEC N6). Messages are ICU MessageFormat strings (intl-messageformat).
 *
 * Every file `src/i18n/<locale>/<namespace>.json` is bundled; the file name is the top-level key, so
 * `src/i18n/en/home.json` → `t('home.hero.headline')`. New namespaces are picked up automatically.
 * A key missing in the current locale falls back to English; a key missing everywhere returns the key
 * itself (and warns once in development), so a gap is visible but never breaks a page.
 *
 * Locale choice, in order: `?lang=en|fr` in the URL, the stored choice (localStorage `lz-locale`),
 * the browser language (`fr*` → fr), else en.
 */
import { IntlMessageFormat } from 'intl-messageformat';

export type Locale = 'en' | 'fr';
export const LOCALES: readonly Locale[] = ['en', 'fr'];
export type MessageParams = Record<string, string | number>;

type MessageTree = { [key: string]: string | string[] | MessageTree };

const STORAGE_KEY = 'lz-locale';

const files = import.meta.glob<MessageTree>('../i18n/*/*.json', { eager: true, import: 'default' });

const catalog: Record<Locale, Record<string, MessageTree>> = { en: {}, fr: {} };
for (const [path, tree] of Object.entries(files)) {
  const m = /\/i18n\/([a-z]{2})\/([^/]+)\.json$/.exec(path);
  if (!m) continue;
  const locale = m[1] as Locale;
  const ns = m[2] as string;
  if (catalog[locale]) catalog[locale][ns] = tree;
}

function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'fr';
}

function detectLocale(): Locale {
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get('lang');
      if (isLocale(q)) return q;
    }
    if (typeof localStorage !== 'undefined') {
      const s = localStorage.getItem(STORAGE_KEY);
      if (isLocale(s)) return s;
    }
  } catch {
    // storage may be blocked (privacy mode): fall through to the browser language
  }
  if (typeof navigator !== 'undefined') {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const l of langs) {
      const base = (l ?? '').toLowerCase().slice(0, 2);
      if (isLocale(base)) return base;
    }
  }
  return 'en';
}

let current: Locale = detectLocale();
const listeners = new Set<(l: Locale) => void>();
const formatCache = new Map<string, IntlMessageFormat>();
const warned = new Set<string>();

if (typeof document !== 'undefined') document.documentElement.lang = current;

function lookup(locale: Locale, key: string): string | undefined {
  const dot = key.indexOf('.');
  if (dot < 0) return undefined;
  let node: string | string[] | MessageTree | undefined = catalog[locale][key.slice(0, dot)];
  for (const part of key.slice(dot + 1).split('.')) {
    if (node === undefined || typeof node === 'string' || Array.isArray(node)) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** The raw message for `key` in the current locale (English fallback), or undefined. */
export function rawMessage(key: string, locale: Locale = current): string | undefined {
  return lookup(locale, key) ?? (locale === 'en' ? undefined : lookup('en', key));
}

/** True when `key` exists in the current locale or in English. */
export function hasKey(key: string): boolean {
  return rawMessage(key) !== undefined;
}

/**
 * Translate `key` with optional ICU parameters, e.g.
 * `t('common.units.bricks', { count: 3 })` → "3 bricks".
 */
export function t(key: string, params?: MessageParams): string {
  const msgLocale: Locale = lookup(current, key) !== undefined ? current : 'en';
  const msg = lookup(msgLocale, key);
  if (msg === undefined) {
    if (import.meta.env?.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
  }
  // Fast path: nothing ICU-special in the message.
  if (!msg.includes('{') && !msg.includes("''")) return msg;
  const cacheKey = `${msgLocale}\u0000${key}`;
  let fmt = formatCache.get(cacheKey);
  if (!fmt) {
    try {
      fmt = new IntlMessageFormat(msg, msgLocale);
    } catch (err) {
      console.error(`[i18n] invalid ICU message for ${key}:`, err);
      return msg;
    }
    formatCache.set(cacheKey, fmt);
  }
  try {
    const out = fmt.format(params ?? {});
    return Array.isArray(out) ? out.join('') : String(out);
  } catch (err) {
    console.error(`[i18n] cannot format ${key}:`, err);
    return msg;
  }
}

export function getLocale(): Locale {
  return current;
}

/** Switch language: stores the choice, sets `<html lang>`, notifies `onLocaleChange` listeners. */
export function setLocale(l: Locale): void {
  if (!isLocale(l) || l === current) return;
  current = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    // ignore: the choice just won't persist
  }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  if (typeof location !== 'undefined' && typeof history !== 'undefined') {
    const url = new URL(location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.set('lang', l);
      history.replaceState(history.state, '', url);
    }
  }
  for (const cb of [...listeners]) {
    try {
      cb(l);
    } catch (err) {
      console.error('[i18n] locale listener failed:', err);
    }
  }
}

/** Subscribe to language changes; returns the unsubscribe function. */
export function onLocaleChange(cb: (l: Locale) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Locale-aware number formatting (tabular data, estimates). */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(current, options).format(n);
}

/**
 * Fill static markup from the catalog:
 *  - `data-i18n="ns.key"` sets the element's text;
 *  - `data-i18n-attr="aria-label:ns.key;alt:ns.key2"` sets attributes.
 * Pages ship English text in their HTML (fast first paint, no JS needed) and call this on load and
 * on every locale change.
 */
export function translateDom(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    for (const pair of (el.dataset.i18nAttr ?? '').split(';')) {
      const i = pair.indexOf(':');
      if (i <= 0) continue;
      el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
    }
  });
}

/** Test helper: every key of a namespace for a locale, as dotted paths. */
export function keysOf(locale: Locale, ns: string): string[] {
  const out: string[] = [];
  const walk = (node: MessageTree | string | string[], prefix: string): void => {
    if (typeof node === 'string' || Array.isArray(node)) {
      out.push(prefix);
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}.${k}` : k);
  };
  const tree = catalog[locale][ns];
  if (tree) walk(tree, ns);
  return out;
}

/** Namespaces present for a locale (test helper). */
export function namespaces(locale: Locale): string[] {
  return Object.keys(catalog[locale]).sort();
}
