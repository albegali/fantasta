// @ts-check
const tseslint = require('typescript-eslint');

/**
 * Config flat (ESLint 9). Deliberatamente asciutta: la formattazione la fa
 * Prettier (`npm run format`), qui stanno solo le regole che pescano errori.
 */
module.exports = tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**'] },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      // Il `!` non-null serve dove Nest inizializza dopo il costruttore
      // (@WebSocketServer, campi di DTO) e dopo un `ensure()` che ha già
      // garantito lo stato.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.spec.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
