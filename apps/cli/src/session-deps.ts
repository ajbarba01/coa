import { homedir } from 'node:os';
import {
  AccountsRegistry,
  ModelCache,
  composeSessionDeps,
  createDaemonCore,
  createRegistryAssemblePieces,
  packageRegistry,
  roleRegistry,
  WebConfigStore,
  type ActiveAccountResolution,
  type DaemonCoreHandle,
  type ModelCacheAccount,
  type SessionDeps,
} from '@coa/core';
import { providerSchema, type Provider } from '@coa/shared';
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
  /** The active account to fetch models from, per provider — the merged model list's sources. */
  modelAccounts: () => ModelCacheAccount[];
}

/** Construct the daemon core and bind it (plus the Claude backend) into session deps. */
export function buildSessionDeps(options: DaemonSessionOptions): BuiltSession {
  const root = options.root ?? process.cwd();
  // Load the user-global web-key config (`~/.coa/web.yaml`); offer the web tools only
  // when at least one provider is configured (D85 — an unconfigured user gets today's
  // behavior). Credentials resolve at chain assembly from env vars / coa-saved key files.
  const web = new WebConfigStore(homedir()).read();
  const hasWeb = (web.search?.providers.length ?? 0) > 0 || (web.fetch?.providers.length ?? 0) > 0;
  const handle = createDaemonCore({
    walPath: options.walPath,
    root,
    producers: buildGenerationProducers(root),
    ...(hasWeb ? { web } : {}),
    ...(options.ceilingUsd !== undefined ? { ceilingUsd: options.ceilingUsd } : {}),
    ...(options.allowedTools !== undefined ? { allowedTools: options.allowedTools } : {}),
  });
  const registry = new AccountsRegistry(homedir());
  // Session auth: the model names its provider; that provider's active account authenticates.
  const activeAccount = (provider: string): ActiveAccountResolution =>
    resolveActiveAccount(registry, provider);
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
  const modelAccounts = (): ModelCacheAccount[] => activeModelAccounts(registry);
  return { deps, handle, models, modelAccounts };
}

/** Resolve a provider's active account into the session's login pointer + label (ambient ⇒ no pointer). */
function resolveActiveAccount(
  registry: AccountsRegistry,
  provider: string,
): ActiveAccountResolution {
  if (!isProvider(provider)) return { label: 'ambient' };
  const active = registry.getActive(provider);
  return active.kind === 'account'
    ? { label: active.account.label, locator: active.account.locator }
    : { label: 'ambient' };
}

/**
 * The account to fetch models from for each provider — the sources the daemon
 * merges into one model list. An ambient provider still fetches (Claude via its
 * ambient login, DeepSeek via the default key var), tagged so the cache never
 * collides across providers.
 */
function activeModelAccounts(registry: AccountsRegistry): ModelCacheAccount[] {
  return providerSchema.options.map((provider) => {
    const active = registry.getActive(provider);
    return active.kind === 'account'
      ? { label: active.account.label, locator: active.account.locator, provider }
      : { label: 'ambient', provider };
  });
}

function isProvider(value: string): value is Provider {
  return (providerSchema.options as readonly string[]).includes(value);
}
