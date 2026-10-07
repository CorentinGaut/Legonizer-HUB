import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'fixtures/', 'docs/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.worker } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The core engine must stay DOM-free (SPEC §9): it runs in a Worker and in Node.
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: { ...globals.worker } },
    rules: {
      'no-restricted-globals': ['error', 'document', 'window', 'HTMLElement', 'HTMLCanvasElement'],
    },
  },
  prettier,
);
