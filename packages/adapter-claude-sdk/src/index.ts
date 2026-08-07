/**
 * @coa/adapter-claude-sdk — the one backend implementation of the runtime port: the
 * neutral→native renderer, the TS-LSP backend, and the SDK loop with its two
 * hooks. The ONLY package permitted to import the Claude Agent SDK
 * (backend-isolation). The core never imports this package — the daemon injects it at
 * session construction, keeping the adapter a swappable leaf.
 *
 * This entry currently exports the pure renderer; the live SDK loop, the hook
 * wiring, and the TS-LSP `refs` backend are wired in a subsequent step.
 */

export * from './render-native.js';
export * from './sdk-options.js';
export * from './session-options.js';
export * from './claude-sdk-adapter.js';
export { messageToFrames } from './turn-frames.js';
export { toSdkPrompt } from './session-input.js';
export { reasoningToOptions } from './reasoning.js';
export { modelInfoToDescriptor, fetchClaudeModels } from './models.js';
export { DEFAULT_CLEAR_VARS, resolveAuthEnv } from './auth-env.js';
export {
  authStatusSchema,
  parseAuthStatus,
  probeAuthStatus,
  type AuthStatus,
  type RunCommand,
} from './auth-status.js';
export {
  emailSlug,
  extractOauthUrl,
  loginEnv,
  managedLoginDir,
  spawnLogin,
  type LoginProcess,
} from './login-driver.js';
