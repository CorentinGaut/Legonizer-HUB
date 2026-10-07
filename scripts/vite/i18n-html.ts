/**
 * Vite plugin: fills static HTML from the English catalog (src/i18n/en/*.json), so pages paint
 * their text without JavaScript (fast LCP, no-JS fallback) while the strings stay in one place.
 *
 *   <h1 data-i18n="home.hero.headline"></h1>                       → text content
 *   <img data-i18n-attr="alt:home.hero.posterAlt;title:…">          → attributes
 *
 * Elements with `data-i18n` must contain text only (no child elements). At run time
 * `translateDom()` (src/shared/i18n.ts) applies the user's locale with the same attributes.
 * Messages used this way must not need ICU parameters.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Plugin } from 'vite';

type Tree = { [k: string]: string | Tree };

function loadCatalog(dir: string): Record<string, Tree> {
  const out: Record<string, Tree> = {};
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json'))
      out[basename(f, '.json')] = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as Tree;
  }
  return out;
}

function lookup(cat: Record<string, Tree>, key: string): string {
  const [ns, ...path] = key.split('.');
  let node: string | Tree | undefined = cat[ns ?? ''];
  for (const p of path) node = typeof node === 'object' ? node[p] : undefined;
  if (typeof node !== 'string') throw new Error(`i18n-html: missing English message "${key}"`);
  // ICU: '' is a literal apostrophe; parameters are not supported in static HTML.
  if (/\{[^}]*\}/.test(node)) throw new Error(`i18n-html: "${key}" has ICU parameters; render it from code`);
  return node.replace(/''/g, "'");
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');

export function fillHtml(html: string, cat: Record<string, Tree>): string {
  // attributes first (they may sit on the same element as data-i18n)
  html = html.replace(
    /<([a-zA-Z][\w-]*)([^>]*?)\sdata-i18n-attr="([^"]+)"([^>]*)>/g,
    (_m, tag, before, spec, after) => {
      const selfClose = /\/\s*$/.test(String(after));
      let attrs = `${before}${String(after).replace(/\s*\/\s*$/, '')}`;
      for (const pair of String(spec).split(';')) {
        const i = pair.indexOf(':');
        if (i <= 0) continue;
        const name = pair.slice(0, i).trim();
        const value = escAttr(lookup(cat, pair.slice(i + 1).trim()));
        const re = new RegExp(`\\s${name}="[^"]*"`);
        attrs = re.test(attrs) ? attrs.replace(re, ` ${name}="${value}"`) : `${attrs} ${name}="${value}"`;
      }
      return `<${tag}${attrs} data-i18n-attr="${spec}"${selfClose ? ' /' : ''}>`;
    },
  );
  html = html.replace(
    /<([a-zA-Z][\w-]*)([^>]*?\sdata-i18n="([^"]+)"[^>]*)>([^<]*)<\/\1>/g,
    (_m, tag, attrs, key) => `<${tag}${attrs}>${esc(lookup(cat, key))}</${tag}>`,
  );
  return html;
}

export function i18nHtmlPlugin(root: string): Plugin {
  const dir = resolve(root, 'src/i18n/en');
  return {
    name: 'lz-i18n-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return fillHtml(html, loadCatalog(dir));
      },
    },
  };
}
