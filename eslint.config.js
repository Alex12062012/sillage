import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
    languageOptions: {
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', performance: 'readonly',
        localStorage: 'readonly', requestAnimationFrame: 'readonly', console: 'readonly',
        process: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
      },
    },
  },
);
