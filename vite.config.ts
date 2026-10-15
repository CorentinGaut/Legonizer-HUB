import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { homeModelPlugin } from './scripts/vite/home-model.ts';
import { i18nHtmlPlugin } from './scripts/vite/i18n-html.ts';

// Multi-page static site (SPEC §9): home, create wizard, about.
// `base` is relative so the build works on GitHub Pages project sites.
export default defineConfig({
  base: './',
  plugins: [
    // English text in the static HTML from src/i18n/en (data-i18n attributes).
    i18nHtmlPlugin(import.meta.dirname),
    // virtual:lz-home-model — the home animation's bricks, packed at build time from the H4 fixture.
    homeModelPlugin(import.meta.dirname),
  ],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        create: resolve(import.meta.dirname, 'create.html'),
        about: resolve(import.meta.dirname, 'about.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
