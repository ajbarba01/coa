// Vite's client types give `import.meta.env` its shape — the renderer's dev-only
// gating (e.g. the showcase surface) keys off `import.meta.env.DEV`, which the
// bundler replaces statically at build time.
/// <reference types="vite/client" />

// Ambient module declaration for the side-effect CSS import in main.tsx — electron-vite's
// bundler handles the actual import; this only satisfies tsc's module resolution.
declare module '*.css';

// @fontsource-variable/fira-code resolves to a bare CSS file via package `exports`, which the
// `*.css` wildcard above doesn't match under NodeNext resolution (the specifier itself has no
// `.css` suffix). Same rationale as above: electron-vite's bundler handles the real import.
declare module '@fontsource-variable/fira-code';
