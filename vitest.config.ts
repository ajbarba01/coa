import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript source so tests run without a
// prior build. Runtime/build resolution still goes through each package's
// `exports` map (-> dist); this alias is test-time only.
const workspaceAlias = {
  '@coa/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
  '@coa/code-intel': fileURLToPath(new URL('./packages/code-intel/src/index.ts', import.meta.url)),
  '@coa/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
  '@coa/spi': fileURLToPath(new URL('./packages/spi/src/index.ts', import.meta.url)),
  '@coa/loop-driver': fileURLToPath(
    new URL('./packages/loop-driver/src/index.ts', import.meta.url),
  ),
  '@coa/adapter-claude-sdk': fileURLToPath(
    new URL('./packages/adapter-claude-sdk/src/index.ts', import.meta.url),
  ),
  '@coa/adapter-deepseek': fileURLToPath(
    new URL('./packages/adapter-deepseek/src/index.ts', import.meta.url),
  ),
  '@coa/adapter-longcat': fileURLToPath(
    new URL('./packages/adapter-longcat/src/index.ts', import.meta.url),
  ),
  '@coa/console-viewmodel': fileURLToPath(
    new URL('./packages/console-viewmodel/src/index.ts', import.meta.url),
  ),
  '@coa/console-kit': fileURLToPath(
    new URL('./packages/console-kit/src/index.ts', import.meta.url),
  ),
  '@coa/console-transcript': fileURLToPath(
    new URL('./packages/console-transcript/src/index.ts', import.meta.url),
  ),
};

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
