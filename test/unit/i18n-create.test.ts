/** Create-page catalogues (N6): FR has every EN key, every message is valid ICU, placeholders match. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { IntlMessageFormat } from 'intl-messageformat';
import { PDF_MESSAGE_KEYS } from '../../src/core/export/pdfPlan.ts';

type Tree = { [k: string]: string | Tree };
const NS = ['create', 'exports', 'errors'] as const;

function flat(locale: string, ns: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (t: Tree, p: string) => {
    for (const [k, v] of Object.entries(t)) {
      if (typeof v === 'string') out.set(`${p}.${k}`, v);
      else walk(v, `${p}.${k}`);
    }
  };
  walk(JSON.parse(readFileSync(`src/i18n/${locale}/${ns}.json`, 'utf8')), ns);
  return out;
}

/** Top-level argument names of an ICU message (not the words inside plural/select branches). */
function args(msg: string): string[] {
  const ast = new IntlMessageFormat(msg, 'en').getAst() as { type: number; value?: string }[];
  return [...new Set(ast.filter((e) => e.type !== 0 && e.value).map((e) => e.value!))].sort();
}

describe('create, exports and errors catalogues', () => {
  for (const ns of NS) {
    it(`${ns}: same keys in EN and FR, valid ICU, same arguments`, () => {
      const en = flat('en', ns),
        fr = flat('fr', ns);
      expect([...fr.keys()].sort()).toEqual([...en.keys()].sort());
      for (const [k, v] of en) {
        expect(() => new IntlMessageFormat(v, 'en'), k).not.toThrow();
        expect(() => new IntlMessageFormat(fr.get(k)!, 'fr'), k).not.toThrow();
        expect(args(fr.get(k)!), k).toEqual(args(v));
      }
    });
  }

  it('the PDF finds all its messages (exports, create, common, footer)', () => {
    const all = new Map<string, string>();
    for (const ns of [...NS, 'common', 'footer']) for (const [k, v] of flat('en', ns)) all.set(k, v);
    for (const k of PDF_MESSAGE_KEYS) expect(all.has(k), k).toBe(true);
  });

  it('SPEC §12 wording: no "area divided by 8" bound, demo preset named', () => {
    const en = flat('en', 'create');
    expect(en.get('create.guide.bricks.report.body')).not.toMatch(/divided by 8/);
    expect(en.get('create.settings.preset.legacyKeepSmall.name')).toBe(
      'Legacy (UD-Viz 4.6.1) with small buildings kept',
    );
    expect(en.get('create.settings.disappear.studShare')).toMatch(/built-up area/);
  });
});
