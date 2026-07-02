import { homedir } from 'node:os';
import {
  AccountsRegistry,
  ModelCache,
  composeSessionDeps,
  createDaemonCore,
  createRegistryAssemblePieces,
  packageRegistry,
  roleRegistry,
  type ActiveAccountResolution,
  type DaemonCoreHandle,
  type ModelCacheAccount,
  type SessionDeps,
} from '@coa/core';
import { createAdapter, fetchModels } from './adapter-factory.js';
import { buildGenerationProducers } from './generation.js';

/**
 * The app-side spike harness — assemble runnable {@link SessionDeps} from the
 * real daemon core (M1–M7) plus the Claude adapter factory (M9). This is the one
 * place the whole closure meets the backend; a spike script then calls
 * `createSession(req, deps)` to drive the rented loop end to end. The worktree
 * binder is the current floor (the session worktree is the configured root);
 * the coupling-aware worktree manager and the OS-socket daemon host are later.
 * M4's generation producers are assembled from the worktree's committed
 * `.coa/generate.yaml`, so the SSOT-constraint producer fires on real relations.
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
  /** The per-account model-capability cache (backend fetch injected). */
  models: ModelCache;
  /** Resolve the active account (label + optional login pointer) at call time. */
  activeAccount: () => ModelCacheAccount;
}

/** Construct the daemon core and bind it (plus the Claude backend) into session deps. */
export function buildSessionDeps(options: DaemonSessionOptions): BuiltSession {
  const root = options.root ?? process.cwd();
  const handle = createDaemonCore({
    walPath: options.walPath,
    root,
    producers: buildGenerationProducers(root),
    ...(options.ceilingUsd !== undefined ? { ceilingUsd: options.ceilingUsd } : {}),
    ...(options.allowedTools !== undefined ? { allowedTools: options.allowedTools } : {}),
  });
  const registry = new AccountsRegistry(homedir());
  const activeAccount = (): ModelCacheAccount => resolveActiveAccount(registry);
  const deps = composeSessionDeps(handle.core, {
    createAdapter,
    bindWorktree: () => root,
    assemblePieces: createRegistryAssemblePieces({
      roles: roleRegistry(),
      packages: packageRegistry(),
      platform: process.platform,
    }),
    activeAccount,
  });
  const models = new ModelCache({ fetch: fetchModels });
  return { deps, handle, models, activeAccount };
}

/** Resolve the active account from the registry into the session's login pointer + label + backend. */
function resolveActiveAccount(registry: AccountsRegistry): ActiveAccountResolution {
  const active = registry.getActive();
  return active.kind === 'account'
    ? {
        label: active.account.label,
        locator: active.account.locator,
        provider: active.account.provider,
      }
    : { label: 'ambient' };
}
