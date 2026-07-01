import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  main: { build: { outDir: 'dist/main' } },
  preload: {
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: { outDir: 'dist/renderer' },
    plugins: [react(), tailwind()],
  },
});
