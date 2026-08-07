/**
 * @coa/spi (the backend ports) — the capability-port type signatures the core
 * depends on. Types only; the concrete backends live in the adapter packages
 * and are injected at runtime by the composition root. This is the internal
 * port shape; the public, semver'd SPI is deferred.
 */

export * from './runtime-adapter.js';
