// Page entry for index.html (home): shell, translations of the static HTML, hero animation.
// Global styles first: they declare the cascade layer order (lz.pages after lz.components).
import '../styles/index.css';
import '../home/home.css';
import { getLocale, onLocaleChange, translateDom } from '../shared/i18n.ts';
import { mountShell } from '../shared/shell.ts';
import { initHero } from '../home/hero.ts';

mountShell({ page: 'home', titleKey: 'home.meta.title', descriptionKey: 'home.meta.description' });
// The HTML ships in English (filled at build time); translate it when another locale is active.
if (getLocale() !== 'en') translateDom(document.querySelector('main') ?? document);
onLocaleChange(() => translateDom(document.querySelector('main') ?? document));
initHero();
