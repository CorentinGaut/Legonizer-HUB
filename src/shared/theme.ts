/**
 * Theme handling. The theme follows `prefers-color-scheme`; the user can
 * force Light or Dark from the footer. The choice sets `<html data-theme>` (tokens.css switches
 * `color-scheme`, every token uses `light-dark()`) and is stored in localStorage `lz-theme`.
 *
 * To avoid a flash of the wrong theme, each HTML page should run this in `<head>` before the CSS:
 *   <script>try{var t=localStorage.getItem('lz-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
 * `applyStoredTheme()` does the same when the module loads, for pages that don't.
 *
 * 3D renderers read scene colours with getComputedStyle and re-read them on `onThemeChange`.
 */
export type ThemeChoice = 'auto' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'lz-theme';
const listeners = new Set<(t: Theme) => void>();
let lastEffective: Theme | undefined;
let memoryChoice: ThemeChoice | undefined; // used when localStorage is blocked

function readChoice(): ThemeChoice {
  if (memoryChoice) return memoryChoice;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // storage blocked
  }
  return 'auto';
}

export function getThemeChoice(): ThemeChoice {
  return readChoice();
}

/** The theme in effect for the page chrome (the home hero is always dark). */
export function getEffectiveTheme(): Theme {
  const c = readChoice();
  if (c !== 'auto') return c;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function notifyIfChanged(): void {
  const eff = getEffectiveTheme();
  if (eff === lastEffective) return;
  lastEffective = eff;
  for (const cb of [...listeners]) {
    try {
      cb(eff);
    } catch (err) {
      console.error('[theme] listener failed:', err);
    }
  }
}

/** Apply the stored choice to `<html data-theme>`. Idempotent. */
export function applyStoredTheme(): void {
  if (typeof document === 'undefined') return;
  const c = readChoice();
  if (c === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = c;
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    memoryChoice = choice; // the choice applies to this page view only
  }
  applyStoredTheme();
  notifyIfChanged();
}

/** Called with the effective theme whenever it changes (user choice or OS setting). */
export function onThemeChange(cb: (t: Theme) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

if (typeof window !== 'undefined') {
  applyStoredTheme();
  lastEffective = getEffectiveTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', notifyIfChanged);
  // Another tab changed the choice.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      applyStoredTheme();
      notifyIfChanged();
    }
  });
}
