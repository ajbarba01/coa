/**
 * @coa/adapter-claude-sdk (M9 impl) — the one backend implementation: the
 * neutral→native renderer, the TS-LSP backend, and the SDK loop with its two
 * hooks. The ONLY package permitted to import the Claude Agent SDK
 * (backend-isolation). The core never imports this package — M8 injects it at
 * session construction (D121), keeping M9 a swappable leaf.
 *
 * This entry currently exports the pure renderer; the live SDK loop, the hook
 * wiring, and the TS-LSP `refs` backend are wired in a subsequent step.
 */

export * from './render-native.js';
export * from './sdk-options.js';
export * from './session-options.js';
export * from './claude-sdk-adapter.js';
