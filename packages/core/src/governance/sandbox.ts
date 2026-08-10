import type { CapabilitySet } from '@coa/shared';

/**
 * Sandboxing as the first-class adversarial control. `sandboxPolicy`
 * returns the per-session capability set the backend adapter enforces (allowed tools,
 * deny-rules, permission mode, denyRead globs). Deterministic, no model.
 *
 * Honest scope (DT-1): the SDK OS sandbox bounds bash subprocesses + children only.
 * The `denyRead` set is the **bash/built-in** read control (applied to built-in
 * Read/Write/Edit + bash, NOT to in-process MCP tools — those are covered by the workbench's
 * S-1 path-confinement). Two distinct controls, each named for what it covers.
 */

/** The single secrets-confinement glob — used three ways (do-not-sync, denyRead, ledger-clean tree). */
export const SECRETS_GLOB = '~/.coa/secrets/**';

/**
 * The COMPLETED sandbox `denyRead` set (D141c) — including `~/.claude/**` (the SDK's
 * own credential home, the omission the stress test caught). Only the worktree is
 * re-allowed. This is the bash/built-in read control.
 */
export const DENY_READ_GLOBS: readonly string[] = [
  SECRETS_GLOB,
  '~/.ssh',
  '~/.aws',
  '~/.config/gcloud',
  '~/.claude/**',
  '~/.gnupg',
  '~/.kube',
  '~/.docker',
];

/** The session trust context — two concurrent sessions of different trust resolve distinct sets. */
export interface SessionTrustCtx {
  sessionId: string;
  trust: 'local' | 'imported';
  worktree: string;
}

export interface SandboxOptions {
  /** The daemon's configured tool baseline for the session. */
  allowedTools?: string[];
}

export function sandboxPolicy(ctx: SessionTrustCtx, options: SandboxOptions = {}): CapabilitySet {
  return {
    allowedTools: options.allowedTools ?? [],
    // Defense-in-depth (S-3): the coa binary is denied to bash so an agent-spawned
    // `coa` cannot reach a human-only verb via agent-bash → same-uid socket.
    denyRules: ['Bash(coa *)'],
    // Untrusted (imported/cloned) sessions run sandboxed until promoted.
    permissionMode: ctx.trust === 'local' ? 'default' : 'sandboxed',
    denyRead: [...DENY_READ_GLOBS],
  };
}
