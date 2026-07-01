import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  unbundle: true,
  fixedExtension: false,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react-dom/client',
    'react-resizable-panels',
    'zod',
  ],
});
