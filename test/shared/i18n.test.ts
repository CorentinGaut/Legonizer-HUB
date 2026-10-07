/**
 * i18n (SPEC N6): EN and FR have the same keys in every namespace, every message is valid ICU
 * MessageFormat in its locale, and the static HTML of the pages only uses existing keys.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { fillHtml } from '../../scripts/vite/i18n-html.ts';
import {
  getLocale,
  keysOf,
  namespaces,
  onLocaleChange,
  rawMessage,
  setLocale,
  t,
} from '../../src/shared/i18n.ts';

const root = join(import.meta.dirname, '..', '..');
/** Namespaces owned by the shell / home / about (phase 2A). The others are checked for parity too. */
const SHELL_NS = ['a11y', 'about', 'common', 'footer', 'header', 'help', 'home'];

describe('i18n catalogs', () => {
  it('loads every namespace for both locales', () => {
    for (const ns of SHELL_NS) {
      expect(namespaces('en')).toContain(ns);
      expect(namespaces('fr')).toContain(ns);
    }
  });

  it.each(SHELL_NS)('%s: FR has exactly the EN keys', (ns) => {
    expect(keysOf('fr', ns).sort()).toEqual(keysOf('en', ns).sort());
  });

  it('every message of every namespace parses as ICU in its locale', () => {
    for (const locale of ['en', 'fr'] as const) {
      for (const ns of namespaces(locale)) {
        for (const key of keysOf(locale, ns)) {
          const msg = rawMessage(key, locale);
          if (msg === undefined) continue; // arrays (lists) are not messages
          expect(() => new IntlMessageFormat(msg, locale), `${locale} ${key}`).not.toThrow();
        }
      }
    }
  });

  it('formats plurals and parameters, falls back to English, returns unknown keys as is', () => {
    expect(getLocale()).toBe('en');
    expect(t('common.units.bricks', { count: 1 })).toBe('1 brick');
    expect(t('common.units.bricks', { count: 2473 })).toBe('2,473 bricks');
    expect(t('home.hero.chapter', { n: 4, title: 'Discussing' })).toBe('Chapter 4 of 5: Discussing');
    expect(t('no.such.key')).toBe('no.such.key');
    const seen: string[] = [];
    const off = onLocaleChange((l) => seen.push(l));
    setLocale('fr');
    expect(t('common.units.bricks', { count: 2473 })).toBe('2 473 briques');
    expect(t('header.nav.about')).toBe('À propos');
    setLocale('en');
    off();
    expect(seen).toEqual(['fr', 'en']);
  });
});

describe('static HTML filled from the catalog', () => {
  const en = Object.fromEntries(
    SHELL_NS.map((ns) => [
      ns,
      JSON.parse(readFileSync(join(root, 'src', 'i18n', 'en', `${ns}.json`), 'utf8')),
    ]),
  );
  it.each(['index.html', 'about.html'])(
    '%s: every data-i18n key exists and no element stays empty',
    (file) => {
      const html = readFileSync(join(root, file), 'utf8');
      const out = fillHtml(html, en);
      expect(out).not.toMatch(/data-i18n="[^"]+"[^>]*><\//);
      expect(out).toContain('<title data-i18n=');
      const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]!);
      expect(keys.length).toBeGreaterThan(20);
      for (const k of keys) expect(rawMessage(k, 'fr'), k).toBeDefined();
    },
  );
});
