import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/rpc/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  unbundle: true,
  fixedExtension: false,
});
