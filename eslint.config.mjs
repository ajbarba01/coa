import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `.claude/**` holds agent scratch AND git worktrees — separate checkouts of other
    // branches. Linting those reports another branch's problems as if they were ours
    // (and reports every shared file twice).
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.config.*',
      '**/*.cjs',
      '**/*.d.ts',
      '.claude/**',
      // Parked feature code kept for reference — never compiled, linted, or imported.
      'archive/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Repo-maintenance scripts run directly under Node, not bundled — they need
    // the Node CLI globals (console, process) that the rest of the monorepo
    // never references directly.
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    rules: {
      // The Constitution's hard floor: no `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
