// Page entry for about.html: shell and translations of the static HTML (credits, citation,
// data preparation help, licences, trademark notice).
import '../styles/index.css';
import '../styles/about.css';
import { getLocale, onLocaleChange, translateDom } from '../shared/i18n.ts';
import { mountShell } from '../shared/shell.ts';

mountShell({ page: 'about', titleKey: 'about.meta.title', descriptionKey: 'about.intro' });
const main = document.querySelector('main') ?? document;
if (getLocale() !== 'en') translateDom(main);
onLocaleChange(() => translateDom(main));
