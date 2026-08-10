import { create } from 'zustand';
import type { AuthView } from '@coa/console-viewmodel';
import {
  rpcAddCredential,
  rpcAddProvider,
  rpcAuthView,
  rpcClearCooldown,
  rpcMakeActive,
  rpcProbeHealth,
  rpcRefreshAuth,
  rpcRemoveCredential,
  rpcRemoveProvider,
  rpcRenameCredential,
  rpcReplaceSecret,
  rpcReclaimBrowserProfiles,
  rpcSetBrowserPath,
  rpcSetCredentialDisabled,
  rpcSetIsolatedBrowserLogins,
  rpcSetProviderEnabled,
} from './rpc.js';
import { PROVIDERS, type ProviderDescriptor } from './providers.js';

/**
 * The auth surface's data, LIVE from the daemon. `hydrate()` reads `authView`; every write
 * action below calls its matching RPC verb and reprojects the daemon's returned view — the
 * store never computes `added`/`credentials`/`activeByProvider`/`enabled`/`chains` itself,
 * it only ever mirrors what the daemon last said (heir promotion on remove, the cascade on
 * removing a provider, clearing a bench's cooldown — all daemon-owned, tested in its own
 * suite, not re-implemented here).
 *
 * The secret contract is modelled honestly here: a credential holds a MASK, never a secret.
 * Nothing in this store can hand a secret back, which is why a SECRET is "replaced", never
 * edited. Labels and pointer locators (a config directory, an env-var name) are not secrets —
 * coa can read them, so it can show them, so they edit like anything else.
 */

/** A credential is benched (`disabled`) by a person; it COOLS DOWN by itself (the circuit
 *  breaker). Two different facts, never collapsed into one flag. */
export interface Credential {
  id: string;
  providerId: string;
  label: string;
  /** All a read may ever return. The secret itself left the process when it was pasted. */
  masked: string;
  /** The DECLARED identity — the email a driven login pre-fills. Distinct from `identity`,
   *  which is what the probe actually saw. */
  email?: string;
  /** config-dir logins carry an identity the provider told us about. */
  identity?: string;
  plan?: string;
  /** Probe-derived login health. Absent ⇒ never probed (unknown is not a verdict). */
  health?: 'healthy' | 'needs-relogin';
  /** Benched by the operator — still configured, just not used. */
  disabled: boolean;
  /** The login is gone/stale at the pointer; coa can't read limits for it. */
  expired?: boolean;
  /** Circuit-breaker cooldown, in seconds remaining. Owned by the breaker, not the user. */
  coolingSec?: number;
  lastUsed?: string;
  /** A dedicated browser profile exists for this login — what the removal prompt asks about. */
  hasProfile?: boolean;
  /** Another login signs in as the same identity, so the profile is not this row's to delete
   *  (profiles are keyed by identity, which several accounts can share) — the prompt says so instead of offering it. */
  profileShared?: boolean;
}

export interface AuthState {
  /** Providers the user has ADDED, in order. Empty ⇒ the surface is its own empty state. */
  added: string[];
  credentials: Credential[];
  /** provider → the ONE active credential (backends only; services are a pool, no "active"). */
  activeByProvider: Record<string, string>;
  /** provider → benched. A benched backend can't be activated; a benched service is skipped. */
  enabled: Record<string, boolean>;
  /** Tool-service chains, in failover order. */
  chains: Record<string, string[]>;
  /** The isolated-browser-login capability, daemon-owned: the global toggle, whether a
   *  browser was found, and the detected/overridden binary. */
  browserSession: {
    enabled: boolean;
    available: boolean;
    detectedPath?: string;
    path?: string;
    /** Profile dirs no account resolves to (profiles share one user-data-dir; orphaned jars are reclaimed only on request). Normally empty. */
    reclaimable: string[];
  };
  /** Reads `authView` and reprojects it. Idempotent — safe to call on every surface mount. */
  hydrate: () => Promise<void>;
  addProvider: (providerId: string) => Promise<void>;
  removeProvider: (providerId: string, removeProfiles?: boolean) => Promise<void>;
  addCredential: (providerId: string, label: string, secret: string) => Promise<void>;
  /** The only write to an existing secret: an add that supersedes. Never an edit. */
  replaceSecret: (credentialId: string, secret: string) => Promise<void>;
  /** Labels are coa's own words for a credential — freely editable, never secret. */
  renameCredential: (credentialId: string, label: string) => Promise<void>;
  removeCredential: (credentialId: string, removeProfile?: boolean) => Promise<void>;
  setProviderEnabled: (providerId: string, on: boolean) => Promise<void>;
  setCredentialDisabled: (credentialId: string, disabled: boolean) => Promise<void>;
  makeActive: (credentialId: string) => Promise<void>;
  clearCooldown: (credentialId: string) => Promise<void>;
  /** Re-read every pointer locator — identity, expiry, limits can all change behind
   *  coa's back (a `claude login` in a terminal). The strip's ⟳ runs this. */
  refresh: () => Promise<void>;
  /** Probe every claude login's health (`claude auth status --json` daemon-side) and
   *  reproject the health-threaded view. Runs on surface mount and from the ⟳. */
  probeHealth: () => Promise<void>;
  setIsolatedBrowserLogins: (on: boolean) => Promise<void>;
  /** An empty path clears the override back to auto-detection. */
  setBrowserPath: (path: string) => Promise<void>;
  /** Delete the named jars. Never called except from a click (profile cleanup only ever happens at the user's explicit request). */
  reclaimBrowserProfiles: (names: string[]) => Promise<void>;
}

/** A daemon `CredentialView`'s optional fields are `T | undefined` (zod's `.optional()`);
 *  `Credential`'s are absent-or-`T` (`exactOptionalPropertyTypes`). Rebuilding by omission —
 *  never `field: undefined` — is the same discipline the old mock's `uncooled` helper used
 *  for a cleared cooldown, just applied to every optional field a read can omit. */
function toCredential(c: AuthView['credentials'][number]): Credential {
  const cred: Credential = {
    id: c.id,
    providerId: c.providerId,
    label: c.label,
    masked: c.masked,
    disabled: c.disabled,
  };
  if (c.email !== undefined) cred.email = c.email;
  if (c.identity !== undefined) cred.identity = c.identity;
  if (c.plan !== undefined) cred.plan = c.plan;
  if (c.health !== undefined) cred.health = c.health;
  if (c.expired !== undefined) cred.expired = c.expired;
  if (c.coolingSec !== undefined) cred.coolingSec = c.coolingSec;
  if (c.lastUsed !== undefined) cred.lastUsed = c.lastUsed;
  if (c.hasProfile !== undefined) cred.hasProfile = c.hasProfile;
  if (c.profileShared !== undefined) cred.profileShared = c.profileShared;
  return cred;
}

/** Same omission discipline as {@link toCredential}, applied to the nested
 *  `browserSession` block's own optional fields. */
function toBrowserSession(b: AuthView['browserSession']): AuthState['browserSession'] {
  const session: AuthState['browserSession'] = {
    enabled: b.enabled,
    available: b.available,
    reclaimable: b.reclaimable,
  };
  if (b.detectedPath !== undefined) session.detectedPath = b.detectedPath;
  if (b.path !== undefined) session.path = b.path;
  return session;
}

/** Reprojects a daemon `AuthView` onto the store — the one place a write action's result
 *  becomes state, so every action applies it the same way. */
const apply =
  (set: (partial: Partial<AuthState>) => void) =>
  (view: AuthView): void =>
    set({
      added: view.added,
      credentials: view.credentials.map(toCredential),
      activeByProvider: view.activeByProvider,
      enabled: view.enabled,
      chains: view.chains,
      browserSession: toBrowserSession(view.browserSession),
    });

export const useAuthStore = create<AuthState>((set) => ({
  added: [],
  credentials: [],
  activeByProvider: {},
  enabled: {},
  chains: {},
  browserSession: { enabled: false, available: false, reclaimable: [] },

  hydrate: async () => apply(set)(await rpcAuthView()),
  addProvider: async (providerId) => apply(set)(await rpcAddProvider(providerId)),
  removeProvider: async (providerId, removeProfiles) =>
    apply(set)(await rpcRemoveProvider(providerId, removeProfiles)),
  addCredential: async (providerId, label, secret) =>
    apply(set)(await rpcAddCredential(providerId, label, secret)),
  replaceSecret: async (credentialId, secret) =>
    apply(set)(await rpcReplaceSecret(credentialId, secret)),
  renameCredential: async (credentialId, label) =>
    apply(set)(await rpcRenameCredential(credentialId, label)),
  removeCredential: async (credentialId, removeProfile) =>
    apply(set)(await rpcRemoveCredential(credentialId, removeProfile)),
  setProviderEnabled: async (providerId, on) =>
    apply(set)(await rpcSetProviderEnabled(providerId, on)),
  setCredentialDisabled: async (credentialId, disabled) =>
    apply(set)(await rpcSetCredentialDisabled(credentialId, disabled)),
  makeActive: async (credentialId) => apply(set)(await rpcMakeActive(credentialId)),
  clearCooldown: async (credentialId) => apply(set)(await rpcClearCooldown(credentialId)),

  refresh: async () => apply(set)(await rpcRefreshAuth()),
  probeHealth: async () => apply(set)(await rpcProbeHealth()),
  setIsolatedBrowserLogins: async (on) => apply(set)(await rpcSetIsolatedBrowserLogins(on)),
  setBrowserPath: async (path) => apply(set)(await rpcSetBrowserPath(path)),
  reclaimBrowserProfiles: async (names) => apply(set)(await rpcReclaimBrowserProfiles(names)),
}));

/* ------------------------------ pure selectors ------------------------------ */

/** The state a credential row wears. Order matters: a benched key that is also cooling
 *  reads as benched — the operator's decision outranks the breaker's. */
export type CredentialStatus = 'active' | 'expired' | 'disabled' | 'cooling' | 'healthy';

export function credentialStatus(
  c: Credential,
  activeByProvider: Record<string, string>,
): CredentialStatus {
  if (c.disabled) return 'disabled';
  if (c.expired === true) return 'expired';
  if (c.coolingSec !== undefined) return 'cooling';
  if (activeByProvider[c.providerId] === c.id) return 'active';
  return 'healthy';
}

/** The providers actually on the page, in registry order, split by group. */
export function addedProviders(
  added: string[],
  group?: ProviderDescriptor['group'],
): ProviderDescriptor[] {
  return PROVIDERS.filter((p) => added.includes(p.id)).filter(
    (p) => group === undefined || p.group === group,
  );
}

export function credentialsOf(credentials: Credential[], providerId: string): Credential[] {
  return credentials.filter((c) => c.providerId === providerId);
}

/** A pool's health, in the words the surface uses. Zero of a kind renders nothing (the count law). */
export function poolHealth(credentials: Credential[]): {
  healthy: number;
  cooling: number;
  disabled: number;
} {
  return {
    healthy: credentials.filter((c) => !c.disabled && c.coolingSec === undefined).length,
    cooling: credentials.filter((c) => !c.disabled && c.coolingSec !== undefined).length,
    disabled: credentials.filter((c) => c.disabled).length,
  };
}

/** The chains a service sits in, in failover position — "search #1 · fetch #2". */
export function chainPositions(chains: Record<string, string[]>, providerId: string): string[] {
  return Object.entries(chains)
    .map(([chain, ids]) => {
      const at = ids.indexOf(providerId);
      return at < 0 ? undefined : `${chain} #${at + 1}`;
    })
    .filter((s): s is string => s !== undefined);
}
