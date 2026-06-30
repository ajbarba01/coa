/**
 * @coa/cli — the app-side composition + CLI entry. Today it exposes the spike
 * harness: the M9 adapter factory and the session-deps builder that bind the
 * real daemon core to the Claude backend. The OS-socket daemon host, the
 * JSON-RPC catalogue, and the `coa` verbs (M10) layer on top of this.
 */

export { createClaudeAdapter } from './adapter-factory.js';
export { buildSessionDeps, type DaemonSessionOptions, type BuiltSession } from './session-deps.js';
