/**
 * @coa/adapter-claude-sdk — the one backend implementation of the runtime port: the
 * neutral→native renderer, the TS-LSP backend, and the SDK loop with its two
 * hooks. The ONLY package permitted to import the Claude Agent SDK
 * (backend-isolation). The core never imports this package — the daemon injects it at
 * session construction, keeping the adapter a swappable leaf.
 *
 * The barrel exports only the injection seams the daemon/CLI consume: the adapter
 * itself, the model-catalog fetch, and the managed-login probe/driver. The renderer
 * and hook wiring are internal to the adapter.
 */

export { ClaudeSdkAdapter } from './claude-sdk-adapter.js';
export { fetchClaudeModels } from './models.js';
export { probeAuthStatus } from './auth-status.js';
export { extractOauthUrl, managedLoginDir, spawnLogin } from './login-driver.js';
