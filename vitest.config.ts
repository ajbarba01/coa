import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript source so tests run without a
// prior build. Runtime/build resolution still goes through each package's
// `exports` map (-> dist); this alias is test-time only.
//
// Anchored to an EXACT match (`^…$`) rather than a plain string key: Vite's
// string-key aliasing matches a path PREFIX (`id === find || id.startsWith(find +
// '/')`), so an unanchored `'@coa/core'` entry also swallows every subpath import
// (`@coa/core/rpc`) and rewrites it onto the root barrel's file path (nonsense —
// `index.ts` isn't a directory), breaking resolution instead of falling through to
// that package's own `exports` map the way an un-aliased subpath correctly does.
const workspaceAlias: Array<{ find: RegExp; replacement: string }> = [
  ['@coa/shared', './packages/shared/src/index.ts'],
  ['@coa/code-intel', './packages/code-intel/src/index.ts'],
  ['@coa/core', './packages/core/src/index.ts'],
  ['@coa/spi', './packages/spi/src/index.ts'],
  ['@coa/loop-driver', './packages/loop-driver/src/index.ts'],
  ['@coa/adapter-claude-sdk', './packages/adapter-claude-sdk/src/index.ts'],
  ['@coa/adapter-openai-compat', './packages/adapter-openai-compat/src/index.ts'],
  ['@coa/console-viewmodel', './packages/console-viewmodel/src/index.ts'],
  ['@coa/console-kit', './packages/console-kit/src/index.ts'],
  ['@coa/console-transcript', './packages/console-transcript/src/index.ts'],
].map(([pkg, path]) => ({
  find: new RegExp(`^${pkg.replace(/[/-]/g, '\\$&')}$`),
  replacement: fileURLToPath(new URL(path, import.meta.url)),
}));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: workspaceAlias },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      'packages/*/test/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.tsx',
      // Repo-level tooling tests (e.g. the dependency-cruiser canary).
      'test/**/*.test.ts',
    ],
  },
});
