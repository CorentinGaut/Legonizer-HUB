/** Locale-aware formatting of the numbers the create page shows (units, sizes, times). */
import { formatNumber, getLocale, t } from '../shared/i18n.ts';

export function n(v: number, digits = 0): string {
  return formatNumber(v, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
export function nFixed(v: number, digits: number): string {
  return formatNumber(v, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** "1.3 km" / "738 m" / "0.42 m" */
export function length(m: number): string {
  const a = Math.abs(m);
  if (a >= 1000) return t('common.units.kilometres', { value: n(m / 1000, 1) });
  if (a >= 10) return t('common.units.metres', { value: n(m, 0) });
  return t('common.units.metres', { value: n(m, 2) });
}

export function cm(v: number): string {
  return n(v, 1);
}

export function bytes(b: number): string {
  if (b < 1024) return t('exports.common.underOneKb');
  if (b < 1024 * 1024) return t('exports.common.kb', { value: n(b / 1024, 0) });
  return t('exports.common.mb', { value: n(b / (1024 * 1024), 1) });
}

export function seconds(ms: number): string {
  return n(ms / 1000, 1);
}

export function timeOfDay(ts: number): string {
  return new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(ts);
}

/** "today at 14:32" / "on 6 October 2026" (resume banner). */
export function when(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t('common.time.todayAt', { time: timeOfDay(ts) });
  return t('common.time.onDate', {
    date: new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(d),
  });
}

/** Part size written 2×4 (compact) for a part id or a w × l. */
export function sizeCompact(w: number, l: number): string {
  return t('common.part.sizeCompact', { w, d: l });
}

/** File-safe project slug ("small-sample"). */
export function slug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'legonizer'
  );
}
