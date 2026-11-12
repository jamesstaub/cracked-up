import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'design/**/*.md'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts run outside the browser.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } },
  },
);
