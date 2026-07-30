import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** ESLint 9 flat config for the API. */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      // Unused args are often meaningful in Express signatures (the 4-arg error
      // handler must keep `next` to be recognised as one), so allow the
      // underscore-prefixed convention rather than deleting them.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Escalate from warn: an `any` in escrow or token code is exactly where a
      // type error would be most expensive.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'off', // server logging is intentional
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // Tests may reach for non-null assertions on fixture data.
    files: ['src/**/*.test.ts', 'src/__tests__/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
