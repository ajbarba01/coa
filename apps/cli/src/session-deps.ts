import {
  composeSessionDeps,
  createDaemonCore,
  type DaemonCoreHandle,
  type SessionDeps,
} from '@coa/core';
import { createClaudeAdapter } from './adapter-factory.js';

/**
 * The app-side spike harness — assemble runnable {@link SessionDeps} from the
 * real daemon core (M1–M7) plus the Claude adapter factory (M9). This is the one
 * place the whole closure meets the backend; a spike script then calls
 * `createSession(req, deps)` to drive the rented loop end to end. The worktree
 * binder is the current floor (the session worktree is the configured root);
 * the coupling-aware worktree manager and the OS-socket daemon host are later.
 */
export interface DaemonSessionOptions {
  /** The WAL path (M1); its parent directory must exist. */
  walPath: string;
  /** The worktree root for the session; defaults to the process cwd. */
  root?: string;
  /** The API-route hard ceiling in USD; omitted ⇒ subscription model. */
  ceilingUsd?: number;
  /** The session's configured tool baseline for the sandbox policy. */
  allowedTools?: string[];
}

export interface BuiltSession {
  deps: SessionDeps;
  handle: DaemonCoreHandle;
}

/** Construct the daemon core and bind it (plus the Claude backend) into session deps. */
export function buildSessionDeps(options: DaemonSessionOptions): BuiltSession {
  const root = options.root ?? process.cwd();
  const handle = createDaemonCore({
    walPath: options.walPath,
    root,
    ...(options.ceilingUsd !== undefined ? { ceilingUsd: options.ceilingUsd } : {}),
    ...(options.allowedTools !== undefined ? { allowedTools: options.allowedTools } : {}),
  });
  const deps = composeSessionDeps(handle.core, {
    createAdapter: createClaudeAdapter,
    bindWorktree: () => root,
  });
  return { deps, handle };
}
