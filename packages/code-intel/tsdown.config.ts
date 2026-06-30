import { defineConfig } from 'tsdown';

// Two entries: the library API and a separate runnable parser-process entry, so
// running the tree-sitter parser as an isolated child process is a build flag,
// not a re-tooling (D112). The parser entry is added with M2's parser host.
export default defineConfig({
  entry: ['src/index.ts', 'src/parser-process.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  unbundle: true,
  fixedExtension: false,
});
