/**
 * Small DOM helpers for the create page (no UI framework, SPEC §9): an escaping `html` template tag,
 * element lookup, live-region announcements, toasts, dialogs, downloads.
 */
import { icon, type IconName } from '../shared/icons.ts';

const RAW = Symbol('raw');
export interface Raw {
  [RAW]: string;
}
/** Marks trusted markup so `html` does not escape it. */
export function raw(s: string): Raw {
  return { [RAW]: s };
}
export function isRaw(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && RAW in v;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

type Value = string | number | boolean | null | undefined | Raw | Value[];

function render(v: Value): string {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (isRaw(v)) return v[RAW];
  return esc(v);
}

/** Template tag: interpolations are escaped unless wrapped with raw(); arrays are joined. */
export function html(strings: TemplateStringsArray, ...values: Value[]): Raw {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i++) out += render(values[i]!) + strings[i + 1]!;
  return raw(out);
}

export function setHtml(el: Element, content: Raw | string): void {
  el.innerHTML = typeof content === 'string' ? content : content[RAW];
}

export function toHtml(content: Raw): string {
  return content[RAW];
}

export function ic(name: IconName, size?: 'sm' | 'lg' | 'xl'): Raw {
  return raw(icon(name, size ? { size } : {}));
}

export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}
export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(sel)];
}

/** Attribute helper for templates: `attr('disabled', cond)`. */
export function attr(name: string, value: string | boolean | number | null | undefined): Raw {
  if (value === false || value === null || value === undefined) return raw('');
  if (value === true) return raw(` ${name}`);
  return raw(` ${name}="${esc(value)}"`);
}

// ------------------------------------------------------------------ live regions (WCAG 4.1.3)
let politeEl: HTMLElement | null = null;
let assertiveEl: HTMLElement | null = null;
function region(kind: 'polite' | 'assertive'): HTMLElement {
  let el = kind === 'polite' ? politeEl : assertiveEl;
  if (!el) {
    el = document.createElement('div');
    el.className = 'lz-visually-hidden';
    el.setAttribute('aria-live', kind);
    el.setAttribute('aria-atomic', 'true');
    if (kind === 'assertive') el.setAttribute('role', 'alert');
    else el.setAttribute('role', 'status');
    el.dataset.lzAnnounce = kind;
    document.body.append(el);
    if (kind === 'polite') politeEl = el;
    else assertiveEl = el;
  }
  return el;
}
/** Screen-reader announcement (polite by default). */
export function announce(text: string, kind: 'polite' | 'assertive' = 'polite'): void {
  const el = region(kind);
  el.textContent = '';
  // a new text node in the next frame is reliably announced
  requestAnimationFrame(() => (el.textContent = text));
}

// ------------------------------------------------------------------ toasts
let toastHost: HTMLElement | null = null;
export function toast(
  message: string,
  opts: { icon?: IconName; action?: { label: string; run: () => void } } = {},
): void {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'lz-toast-region';
    document.body.append(toastHost);
  }
  const el = document.createElement('div');
  el.className = 'lz-toast';
  el.setAttribute('role', 'status');
  setHtml(
    el,
    html`${opts.icon ? ic(opts.icon) : ''}<span class="lz-toast__msg">${message}</span>${
        opts.action
          ? html`<button type="button" class="lz-btn lz-btn--tertiary lz-btn--sm lz-toast__action">
              ${opts.action.label}
            </button>`
          : ''
      }<button
        type="button"
        class="lz-btn lz-btn--quiet lz-btn--icon lz-btn--sm lz-toast__close"
        aria-label="${document.documentElement.lang === 'fr' ? 'Fermer' : 'Close'}"
      >
        ${ic('x', 'sm')}
      </button>`,
  );
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    el.remove();
  };
  const arm = () => {
    clearTimeout(timer);
    timer = window.setTimeout(close, 6000);
  };
  el.querySelector('.lz-toast__close')!.addEventListener('click', close);
  el.querySelector('.lz-toast__action')?.addEventListener('click', () => {
    opts.action?.run();
    close();
  });
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  el.addEventListener('focusin', () => clearTimeout(timer));
  toastHost.append(el);
  while (toastHost.children.length > 3) toastHost.firstElementChild?.remove();
  arm();
}

// ------------------------------------------------------------------ dialogs
export interface DialogOptions {
  title: string;
  body: Raw | string;
  /** Buttons, last = primary. */
  actions: {
    label: string;
    kind?: 'primary' | 'secondary' | 'tertiary' | 'danger';
    value: string;
    icon?: IconName;
  }[];
  /** Index of the button focused first (destructive confirms focus Cancel). */
  focus?: number;
  wide?: boolean;
  className?: string;
  onOpen?: (dialog: HTMLDialogElement) => void;
}

/** Native modal dialog; resolves with the chosen action value, or '' when dismissed. */
export function openDialog(o: DialogOptions): Promise<string> {
  const trigger = document.activeElement as HTMLElement | null;
  const d = document.createElement('dialog');
  d.className = `lz-dialog${o.wide ? ' lz-dialog--wide' : ''}${o.className ? ' ' + o.className : ''}`;
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  d.setAttribute('aria-labelledby', titleId);
  const closeLabel = document.documentElement.lang === 'fr' ? 'Fermer la boîte de dialogue' : 'Close dialog';
  setHtml(
    d,
    html`<div class="lz-dialog__head">
        <h2 id="${titleId}">${o.title}</h2>
        <button
          type="button"
          class="lz-btn lz-btn--quiet lz-btn--icon"
          value=""
          data-close
          aria-label="${closeLabel}"
        >
          ${ic('x')}
        </button>
      </div>
      <div class="lz-dialog__body">${typeof o.body === 'string' ? html`<p>${o.body}</p>` : o.body}</div>
      ${
        o.actions.length
          ? html`<div class="lz-dialog__foot">
              ${o.actions.map(
                (a) =>
                  html`<button
                    type="button"
                    class="lz-btn lz-btn--${a.kind ?? 'secondary'}"
                    data-value="${a.value}"
                  >
                    ${a.icon ? ic(a.icon) : ''}${a.label}
                  </button>`,
              )}
            </div>`
          : ''
      }`,
  );
  document.body.append(d);
  return new Promise((resolve) => {
    let result = '';
    d.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-value],button[data-close]');
      if (b) {
        result = b.dataset.value ?? '';
        d.close();
      } else if (e.target === d) d.close(); // backdrop click
    });
    d.addEventListener('close', () => {
      d.remove();
      trigger?.focus?.();
      resolve(result);
    });
    d.showModal();
    o.onOpen?.(d);
    const buttons = [...d.querySelectorAll<HTMLButtonElement>('.lz-dialog__foot button')];
    const target = o.focus !== undefined ? buttons[o.focus] : buttons[buttons.length - 1];
    (target ?? d.querySelector<HTMLElement>('button'))?.focus();
  });
}

// ------------------------------------------------------------------ downloads
export function downloadBlob(data: Blob | Uint8Array | string, name: string, mime: string): void {
  const blob =
    data instanceof Blob
      ? data
      : new Blob([data as BlobPart], { type: `${mime}${typeof data === 'string' ? ';charset=utf-8' : ''}` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Parses a number typed with "." or "," as decimal separator (EN and FR, SPEC N6). */
export function parseNumber(s: string): number {
  const t = s
    .trim()
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
  return Number(t);
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t = 0;
  const f = (...a: A) => {
    clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  };
  f.cancel = () => clearTimeout(t);
  return f;
}
