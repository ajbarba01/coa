/**
 * @coa/spi (M9 ports) — the capability-port type signatures + the D109
 * null-fallback contracts the core depends on. Types + pinned contracts only; the
 * concrete backend lives in `@coa/adapter-claude-sdk` and is injected at runtime
 * by M8 (D121). This is the internal D109 port (D126); the public, semver'd SPI
 * (D110) is deferred.
 */

export * from './runtime-adapter.js';
export * from './null-fallback.js';
