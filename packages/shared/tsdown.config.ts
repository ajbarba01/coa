import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  unbundle: true,
  // Packages are `type: module`, so `.js` is ESM — emit `.js`/`.d.ts` (not
  // `.mjs`/`.d.mts`) so the bundler, tsc, and the exports map agree on one extension.
  fixedExtension: false,
});
