import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript source so tests run without a
// prior build. Runtime/build resolution still goes through each package's
// `exports` map (-> dist); this alias is test-time only.
const workspaceAlias = {
  '@coa/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
  '@coa/code-intel': fileURLToPath(new URL('./packages/code-intel/src/index.ts', import.meta.url)),
};

export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
  },
});
