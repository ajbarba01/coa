// Ambient module declaration for the side-effect CSS import in main.tsx — electron-vite's
// bundler handles the actual import; this only satisfies tsc's module resolution.
declare module '*.css';
