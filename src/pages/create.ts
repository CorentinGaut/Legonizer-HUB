/**
 * Create page entry (SPEC §7): shared shell + the wizard. The engine Worker, three.js, the PDF and
 * the QR encoder load on demand (N5); this entry only pulls the wizard UI and light core modules.
 */
// Global styles first: they declare the cascade layer order (lz.pages after lz.components).
import '../styles/index.css';
import '../create/create.css';
import '../guide/guide.css';
import { mountShell } from '../shared/shell.ts';
import { CreateApp } from '../create/app.ts';

mountShell({ page: 'create', titleKey: 'create.meta.title' });
const root = document.getElementById('lz-create')!;
const app = new CreateApp(root);
void app.start();
// test hook (e2e): the app instance, never used by the page itself
(window as unknown as { __lzCreate?: CreateApp }).__lzCreate = app;
