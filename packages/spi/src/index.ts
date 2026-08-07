/**
 * @coa/spi (the backend ports) — the capability-port type signatures + the
 * null-fallback contracts the core depends on. Types + pinned contracts only; the
 * concrete backend lives in `@coa/adapter-claude-sdk` and is injected at runtime
 * by the session host. This is the internal port shape; the public, semver'd SPI
 * is deferred.
 */

export * from './runtime-adapter.js';
export * from './null-fallback.js';
