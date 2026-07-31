import type { Locator, Provider } from '@coa/shared';
import type { AccountsRegistry } from '../auth/registry.js';
import type { WebChain, WebConfigStore } from '../workbench/web/web-config-store.js';
import type { WebConfig } from '../workbench/web/web-config.js';
import { locatorId, type KeyStateStore } from '../workbench/web/key-state-store.js';
import type { ConsoleStateStore } from '../console/console-state-store.js';
import { isProfileShared, type BrowserSessionView } from '../auth/browser-session.js';

/**
 * The pure read projection that assembles the unified auth view the renderer
 * expects, from the four credential-blind stores. No model call, no mutation —
 * it only reads. Server-side provider facts core owns (which backends exist, which
 * locator kinds are a readable pointer) live in a small local table below: the
 * renderer's providers.ts owns presentation (icons/copy), so core need not import it.
 */
const BACKENDS: readonly Provider[] = ['claude', 'deepseek', 'longcat'];
/** Locator kinds that are a readable pointer, never a secret. Only `claude` (config-dir) today. */
const POINTER_PROVIDERS = new Set<string>(['claude']);
const CHAINS: readonly WebChain[] = ['search', 'fetch'];

export interface CredentialView {
  id: string;
  providerId: string;
  label: string;
  masked: string;
  disabled: boolean;
  coolingSec?: number;
  email?: string;
  health?: 'healthy' | 'needs-relogin';
  identity?: string;
  plan?: string;
  /** A dedicated browser profile exists for this account — the fact the removal prompt
   *  needs. Absent/false ⇒ nothing extra to delete. */
  hasProfile?: boolean;
  /** Another account signs in as the same identity, so the profile is not this row's alone
   *  to delete (docs/adr/0021). The removal prompt says so instead of offering the delete. */
  profileShared?: boolean;
}

export interface AuthView {
  added: string[];
  credentials: CredentialView[];
  activeByProvider: Record<string, string>;
  enabled: Record<string, boolean>;
  chains: Record<string, string[]>;
  /** The isolated-browser-login capability as it stands right now: whether it is on,
   *  whether a browser was actually found, what detection saw (the override's prefill),
   *  and the override in force. */
  browserSession: {
    enabled: boolean;
    available: boolean;
    detectedPath?: string;
    path?: string;
    /** Jars in the shared root no account resolves to — normally empty, because under
     *  identity keying the only way to mint one is renaming an account's email
     *  (docs/adr/0024). Names only: no sizes, which is what keeps this cheap enough to
     *  ride every read of the view. */
    reclaimable: string[];
  };
}

export interface AuthViewDeps {
  accounts: AccountsRegistry;
  web: WebConfigStore;
  keys: KeyStateStore;
  console: ConsoleStateStore;
  login?: {
    healthOf(id: string): 'healthy' | 'needs-relogin' | undefined;
    identityOf(id: string): { email?: string; plan?: string } | undefined;
  };
  browser?: BrowserSessionView;
}

/** The stable credential id: unique within a provider, stable across reorders/renames of anything else. */
export function credentialId(providerId: string, label: string): string {
  return `${providerId}:${label}`;
}

/** The readable pointer value for a locator that isn't a secret (config-dir/env-var), else undefined. */
function pointerValue(locator: Locator): string | undefined {
  switch (locator.type) {
    case 'config-dir':
      return locator.dir;
    case 'env-var':
      return locator.name;
    case 'key-file':
    case 'ambient':
      return undefined;
  }
}

/** A key-file secret can never be read back; a pointer provider shows its pointer verbatim. */
function maskFor(providerId: string, locator: Locator): string {
  const pointer = pointerValue(locator);
  return POINTER_PROVIDERS.has(providerId) && pointer !== undefined ? pointer : '••••';
}

/** The first non-disabled sibling — who inherits routing when the active credential is removed/benched. */
export function heir(siblings: CredentialView[]): CredentialView | undefined {
  return siblings.find((c) => !c.disabled);
}

/** A service key's label: the tail of its `web-<label>` key-file, or the env-var name. */
export function labelOf(locator: Locator): string {
  if (locator.type === 'key-file') {
    const base = locator.path.split(/[\\/]/).pop() ?? locator.path;
    return base.startsWith('web-') ? base.slice(4) : base;
  }
  if (locator.type === 'env-var') return locator.name;
  // config-dir/ambient never appear as a web credential locator in practice; fall back to the raw pointer id.
  return locatorId(locator);
}

/** Remaining breaker cooldown in whole seconds, or undefined when the key isn't cooling. */
function coolingSec(
  keys: KeyStateStore,
  providerKind: string,
  locator: Locator,
  now: number,
): number | undefined {
  const until = keys.cooldownUntil(`${providerKind}:${locatorId(locator)}`);
  return until !== undefined && until > now ? Math.ceil((until - now) / 1000) : undefined;
}

/**
 * A provider is disabled if the console benched it directly (backend bench), or every
 * web-config entry for it is benched (service bench — see console-state.ts's doc note:
 * backend bench lives on console.yaml, service bench lives on the web.yaml entry).
 */
function isDisabledProvider(id: string, disabledProviders: readonly string[], web: WebConfig): boolean {
  if (disabledProviders.includes(id)) return true;
  const entries = [...(web.search?.providers ?? []), ...(web.fetch?.providers ?? [])].filter(
    (p) => p.kind === id,
  );
  return entries.length > 0 && entries.every((p) => p.disabled);
}

/**
 * Assemble the unified `AuthView` from the four credential stores. Pure — no model
 * call, no side effect beyond the reads themselves. `now` is injectable so
 * cooldown-remaining math is deterministic in tests.
 */
export function assembleAuthView(deps: AuthViewDeps, now = Date.now()): AuthView {
  const state = deps.console.read();
  const credentials: CredentialView[] = [];
  const activeByProvider: Record<string, string> = {};

  // Backends — accounts.yaml
  for (const provider of BACKENDS) {
    for (const account of deps.accounts.listByProvider(provider)) {
      const id = credentialId(provider, account.label);
      const health = deps.login?.healthOf(id);
      const live = deps.login?.identityOf(id);
      const identity =
        live?.email !== undefined
          ? live.plan !== undefined ? `${live.email} · ${live.plan}` : live.email
          : undefined;
      credentials.push({
        id,
        providerId: provider,
        label: account.label,
        masked: maskFor(provider, account.locator),
        disabled: account.disabled,
        ...(account.email !== undefined ? { email: account.email } : {}),
        ...(health !== undefined ? { health } : {}),
        ...(identity !== undefined ? { identity } : {}),
        ...(live?.plan !== undefined ? { plan: live.plan } : {}),
        ...(account.email !== undefined && deps.browser?.hasProfile(account.email) === true
          ? { hasProfile: true }
          : {}),
        ...(isProfileShared(
          account.email,
          deps.accounts
            .list()
            .filter((other) => other.label !== account.label)
            .map((other) => other.email),
        )
          ? { profileShared: true }
          : {}),
      });
    }
    const active = deps.accounts.getActive(provider);
    if (active.kind === 'account') {
      activeByProvider[provider] = credentialId(provider, active.account.label);
    }
  }

  // Services — web.yaml (+ breaker cooldown from web-keys.json)
  const web = deps.web.read();
  const chains: Record<string, string[]> = {};
  for (const chain of CHAINS) {
    const providers = web[chain]?.providers ?? [];
    chains[chain] = providers.map((p) => p.kind);
    for (const provider of providers) {
      for (const cred of provider.credentials) {
        const label = labelOf(cred.locator);
        const id = credentialId(provider.kind, label);
        if (credentials.some((c) => c.id === id)) continue; // a key shared by both chains appears once
        const cool = coolingSec(deps.keys, provider.kind, cred.locator, now);
        credentials.push({
          id,
          providerId: provider.kind,
          label,
          masked: '••••',
          disabled: cred.disabled,
          ...(cool !== undefined ? { coolingSec: cool } : {}),
        });
      }
    }
  }

  // added = console-added ∪ providers that already have a credential
  const withCredentials = new Set(credentials.map((c) => c.providerId));
  const added = [...new Set([...state.addedProviders, ...withCredentials])];

  const enabled: Record<string, boolean> = {};
  for (const id of added) enabled[id] = !isDisabledProvider(id, state.disabledProviders, web);

  // Absent browser session = the floor: off and unavailable. A read never starts one.
  const detectedPath = deps.browser?.detected();
  const overridePath = deps.browser?.override();
  const browserSession = {
    enabled: deps.browser?.enabled() ?? false,
    available: deps.browser?.available() ?? false,
    ...(detectedPath !== undefined ? { detectedPath } : {}),
    ...(overridePath !== undefined ? { path: overridePath } : {}),
    // Every account's email, including other providers': one jar can back several rows, and
    // a jar any of them resolves to must never be offered for deletion (docs/adr/0021).
    reclaimable: deps.browser?.listReclaimable(deps.accounts.list().map((a) => a.email)) ?? [],
  };

  return { added, credentials, activeByProvider, enabled, chains, browserSession };
}
