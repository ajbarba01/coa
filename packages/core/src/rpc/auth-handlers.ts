import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  AMBIENT,
  locatorSchema,
  providerSchema,
  type ActiveByProvider,
  type Locator,
  type Provider,
} from '@coa/shared';
import { z } from 'zod';
import type { AccountsRegistry } from '../auth/registry.js';
import { isManagedLoginDir, type LoginManager } from '../auth/login-manager.js';
import { isProfileShared, type BrowserSessionView } from '../auth/browser-session.js';
import {
  FETCH_KINDS,
  SEARCH_KINDS,
  webKeyFilePath,
  type WebChain,
} from '../workbench/web/web-config-store.js';
import {
  assembleAuthView,
  credentialId,
  heir,
  labelOf,
  type AuthViewDeps,
  type CredentialView,
} from './auth-view.js';
import { rpcMethod, type RpcHandlers } from './router.js';

/**
 * The CON-CAT account verbs — the GUI-ready twin of the `coa auth` CLI, over the
 * SAME registry core. Mutating-but-cheap local file ops; no model call. The active
 * account is tracked **per provider**, so each response reports the active label
 * for every provider (absent ⇒ ambient) and the flat account list (each carrying
 * its provider). Selecting `ambient` for a provider needs the provider named;
 * selecting an account infers it. Params are schema-validated.
 */
const PROVIDERS: readonly Provider[] = providerSchema.options;

const addParams = z.object({
  label: z.string().min(1),
  locator: locatorSchema,
  provider: providerSchema.optional(),
});
const useParams = z.object({ label: z.string().min(1), provider: providerSchema.optional() });
const labelParams = z.object({ label: z.string().min(1) });
const noParams = z.unknown().optional();

// --- the driven-login verbs: params ------------------------------------------------
const IDLE = { phase: 'idle' } as const;
const startLoginParams = z.object({
  email: z.string().min(3),
  credentialId: z.string().optional(),
});
const codeParams = z.object({ code: z.string().min(1) });
const mismatchParams = z.object({ action: z.enum(['keep', 'retry']) });
const failureParams = z.object({ credentialId: z.string().min(1) });

// --- the auth write verbs: params ---------------------------------------------------
const providerIdParams = z.object({ providerId: z.string().min(1) });
const addCredParams = z.object({
  providerId: z.string().min(1),
  label: z.string().min(1),
  secret: z.string(),
});
const idParams = z.object({ id: z.string().min(1) });
const replaceSecretParams = z.object({ id: z.string().min(1), secret: z.string() });
const renameParams = z.object({ id: z.string().min(1), label: z.string().min(1) });
const benchParams = z.object({ id: z.string().min(1), disabled: z.boolean() });
const enableParams = z.object({ providerId: z.string().min(1), on: z.boolean() });
const browserToggleParams = z.object({ on: z.boolean() });
const browserPathParams = z.object({ path: z.string() });
const reclaimParams = z.object({ names: z.array(z.string()) });
const removeCredParams = z.object({ id: z.string().min(1), removeProfile: z.boolean().optional() });
const removeProviderParams = z.object({
  providerId: z.string().min(1),
  removeProfiles: z.boolean().optional(),
});

// --- the auth write verbs: routing --------------------------------------------------
const BACKEND_SET = new Set<string>(PROVIDERS);
const SERVICE_SET = new Set<string>([...SEARCH_KINDS, ...FETCH_KINDS]);

type ProviderGroup = 'backend' | 'service' | 'unsupported';

/**
 * Route a provider id to the store that governs it. `backend` = a shared-schema `Provider`
 * (accounts.yaml); `service` = a SEARCH/FETCH web kind (web.yaml). Anything else
 * (exa, codex, gemini) is `unsupported` — not runnable, like codex/gemini — so
 * every write verb below no-ops rather than touching a store for it (help,
 * never crash).
 */
function providerGroup(id: string): ProviderGroup {
  if (BACKEND_SET.has(id)) return 'backend';
  if (SERVICE_SET.has(id)) return 'service';
  return 'unsupported';
}

/** The web chains a service provider kind serves, derived from SEARCH_KINDS/FETCH_KINDS membership. */
function chainOf(serviceId: string): WebChain[] {
  const chains: WebChain[] = [];
  if ((SEARCH_KINDS as readonly string[]).includes(serviceId)) chains.push('search');
  if ((FETCH_KINDS as readonly string[]).includes(serviceId)) chains.push('fetch');
  return chains;
}

/** Split a credential id on the FIRST `:` (providerId never contains one; labels may). */
function splitId(id: string): { providerId: string; label: string } {
  const at = id.indexOf(':');
  return { providerId: id.slice(0, at), label: id.slice(at + 1) };
}

/** Unlink a key file, tolerating one that's already gone (never a secret read-back). */
/**
 * Delete the sign-in coa created for an account, when it created one.
 *
 * Removal has to mean removal at both layers, or a re-added account silently resurrects a
 * session the user believed they had removed. The boundary is ownership, not
 * convenience: a config dir the USER pointed at is their data and is never touched — coa
 * forgets the row and leaves the directory exactly where it found it.
 */
function removeManagedLogin(locator: Locator): void {
  if (locator.type !== 'config-dir') return;
  if (!isManagedLoginDir(homedir(), locator.dir)) return;
  try {
    rmSync(locator.dir, { recursive: true, force: true });
  } catch {
    // A dir we cannot delete is a disk-space problem, never a failed removal.
  }
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already gone — nothing to do
  }
}

/**
 * Build (and, for a key-file provider, write) the locator for a fresh backend
 * credential. `claude` is a `config-dir` POINTER — `secret` is a directory path,
 * never a secret; `deepseek`/`longcat` are API-key providers — `secret` is written
 * once to a stable 0600 file and never read back.
 */
function backendLocator(providerId: Provider, label: string, secret: string): Locator {
  if (providerId === 'claude') return { type: 'config-dir', dir: secret };
  const path = join(homedir(), '.coa', 'keys', `${providerId}-${label}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, secret, { mode: 0o600 });
  return { type: 'key-file', path };
}

/** Promote the first non-disabled sibling to active (or ambient if none) — never leave disabled-but-active. */
function applyHeirIfWasActive(
  accounts: AccountsRegistry,
  providerId: Provider,
  excludeLabel: string,
  wasActive: boolean,
): void {
  if (!wasActive) return;
  const siblings: CredentialView[] = accounts
    .listByProvider(providerId)
    .filter((a) => a.label !== excludeLabel)
    .map((a) => ({
      id: credentialId(providerId, a.label),
      providerId,
      label: a.label,
      masked: '',
      disabled: a.disabled,
    }));
  const next = heir(siblings);
  if (next !== undefined) accounts.setActive(next.label);
  else accounts.setAmbient(providerId);
}

/** Re-key a backend account under a new label, preserving its locator, disabled flag, and active status. */
function renameBackendCredential(
  accounts: AccountsRegistry,
  providerId: Provider,
  oldLabel: string,
  newLabel: string,
): void {
  const account = accounts.listByProvider(providerId).find((a) => a.label === oldLabel);
  if (account === undefined) return;
  const activeBefore = accounts.getActive(providerId);
  const wasActive = activeBefore.kind === 'account' && activeBefore.account.label === oldLabel;
  accounts.remove(oldLabel);
  accounts.add(newLabel, account.locator, providerId, undefined, account.id);
  if (account.disabled) accounts.setDisabled(newLabel, true);
  if (wasActive) accounts.setActive(newLabel);
}

/**
 * Rename a service key: the highest-care unit. Renames the `web-<label>` file on
 * disk, removes the old web credential from every chain it served, and re-adds a
 * fresh key-file locator at the new path across those same chains — preserving its
 * benched state. Also clears the OLD path's breaker cooldown: the key-file path is
 * deterministic from the label, so a lingering cooldown there would otherwise make a
 * future same-label key appear breaker-cooling on arrival.
 */
function renameServiceCredential(
  deps: AuthHandlerDeps,
  providerId: string,
  oldLabel: string,
  newLabel: string,
): void {
  const oldPath = webKeyFilePath(homedir(), oldLabel);
  const newPath = webKeyFilePath(homedir(), newLabel);
  const chains = chainOf(providerId);

  const web = deps.web.read();
  const wasDisabled = chains.some((chain) => {
    const entry = (web[chain]?.providers ?? []).find((p) => p.kind === providerId);
    return entry?.credentials.some((c) => labelOf(c.locator) === oldLabel && c.disabled) ?? false;
  });

  if (existsSync(oldPath)) {
    mkdirSync(dirname(newPath), { recursive: true });
    renameSync(oldPath, newPath);
  }

  for (const chain of chains) {
    deps.web.removeCredential(chain, oldLabel); // registry-only prune; the file already moved
    deps.web.addCredential(chain, providerId, { type: 'key-file', path: newPath });
  }
  if (wasDisabled) {
    for (const chain of chains) deps.web.setCredentialDisabled(chain, newLabel, true);
  }
  deps.keys.clear(`${providerId}:${oldPath}`);
}

/**
 * Cascade-delete every credential a service provider has across its chains, unlinking
 * freed key files and clearing each removed label's breaker cooldown (the key-file
 * path is deterministic from the label, so a stale cooldown would otherwise haunt a
 * future same-label key).
 */
function removeServiceProviderCredentials(deps: AuthHandlerDeps, providerId: string): void {
  for (const chain of chainOf(providerId)) {
    const web = deps.web.read();
    const entry = (web[chain]?.providers ?? []).find((p) => p.kind === providerId);
    const labels = (entry?.credentials ?? []).map((c) => labelOf(c.locator));
    for (const label of labels) {
      for (const path of deps.web.removeCredential(chain, label)) safeUnlink(path);
      deps.keys.clear(`${providerId}:${webKeyFilePath(homedir(), label)}`);
    }
  }
}

/** The active account label per provider (absent ⇒ that provider is ambient). */
function activeByProvider(registry: AccountsRegistry): ActiveByProvider {
  const active: ActiveByProvider = {};
  for (const provider of PROVIDERS) {
    const resolved = registry.getActive(provider);
    if (resolved.kind === 'account') active[provider] = resolved.account.label;
  }
  return active;
}

/** The full account view the console renders: every account + the per-provider active map. */
function accountsView(registry: AccountsRegistry): {
  accounts: { label: string; provider: Provider }[];
  active: ActiveByProvider;
} {
  return {
    accounts: registry.list().map((a) => ({ label: a.label, provider: a.provider })),
    active: activeByProvider(registry),
  };
}

/** The `buildAuthHandlers` deps — the four-store shape `assembleAuthView` reads, plus the
 * optional driven-login manager (absent ⇒ every login verb degrades to idle/plain view rather than throwing). */
export type AuthHandlerDeps = AuthViewDeps & {
  loginManager?: LoginManager;
  browser?: BrowserSessionView;
};

export function buildAuthHandlers(deps: AuthHandlerDeps): RpcHandlers {
  const registry = deps.accounts;
  // Thread the manager into every assembleAuthView call site as the `login` reader port
  // (it already satisfies that port structurally) — one place, never repeated per call.
  const viewDeps: AuthViewDeps = {
    ...deps,
    ...(deps.loginManager !== undefined ? { login: deps.loginManager } : {}),
  };
  return {
    listAccounts: rpcMethod(noParams, () => accountsView(registry)),
    currentAccount: rpcMethod(noParams, () => ({ active: activeByProvider(registry) })),
    addAccount: rpcMethod(addParams, (p) => {
      registry.add(p.label, p.locator, p.provider ?? 'claude');
      return accountsView(registry);
    }),
    useAccount: rpcMethod(useParams, (p) => {
      // Selecting `ambient` clears the named provider; selecting an account infers its provider.
      if (p.label === AMBIENT) {
        if (p.provider !== undefined) registry.setAmbient(p.provider);
      } else {
        registry.setActive(p.label);
      }
      return { active: activeByProvider(registry) };
    }),
    removeAccount: rpcMethod(labelParams, (p) => {
      registry.remove(p.label);
      return accountsView(registry);
    }),
    authView: rpcMethod(noParams, () => assembleAuthView(viewDeps)),

    // --- the auth write verbs: every one returns the fresh AuthView -----------------
    addProvider: rpcMethod(providerIdParams, (p) => {
      deps.console.addProvider(p.providerId);
      return assembleAuthView(viewDeps);
    }),

    setIsolatedBrowserLogins: rpcMethod(browserToggleParams, (p) => {
      deps.console.setIsolatedBrowserLogins(p.on);
      return assembleAuthView(viewDeps);
    }),

    setBrowserPath: rpcMethod(browserPathParams, (p) => {
      deps.console.setBrowserPath(p.path);
      return assembleAuthView(viewDeps);
    }),

    /** Delete jars no account resolves to. browser profiles stay isolated per account — coa never sweeps on its
     *  own initiative, so this only ever runs because a user clicked. Each name is deleted
     *  independently: one that is locked must not abandon the rest, and it simply appears in
     *  the returned view again. */
    reclaimBrowserProfiles: rpcMethod(reclaimParams, (p) => {
      const offered = new Set(
        deps.browser?.listReclaimable(deps.accounts.list().map((a) => a.email)) ?? [],
      );
      // Only ever delete something the view itself offered. A name that arrived from
      // anywhere else — a stale renderer, a hand-written request — is not this verb's to act
      // on, and the guard keeps a live account's jar unreachable from here by construction.
      for (const name of p.names) {
        if (offered.has(name)) deps.browser?.reclaimProfile(name);
      }
      return assembleAuthView(viewDeps);
    }),

    removeProvider: rpcMethod(removeProviderParams, (p) => {
      const group = providerGroup(p.providerId);
      if (group === 'backend') {
        for (const account of deps.accounts.listByProvider(p.providerId as Provider)) {
          if (account.locator.type === 'key-file') safeUnlink(account.locator.path);
          removeManagedLogin(account.locator);
          deps.accounts.remove(account.label);
          // Read AFTER the removal, so the row going away is not counted as sharing its own
          // jar — but an account under a DIFFERENT provider signing in as the same identity
          // still is, and its session must survive this.
          if (
            p.removeProfiles === true &&
            account.email !== undefined &&
            !isProfileShared(
              account.email,
              deps.accounts.list().map((other) => other.email),
            )
          ) {
            deps.browser?.removeProfile(account.email);
          }
        }
      } else if (group === 'service') {
        removeServiceProviderCredentials(deps, p.providerId);
      }
      deps.console.removeProvider(p.providerId);
      return assembleAuthView(viewDeps);
    }),

    addCredential: rpcMethod(addCredParams, (p) => {
      const group = providerGroup(p.providerId);
      if (group === 'backend') {
        const locator = backendLocator(p.providerId as Provider, p.label, p.secret);
        deps.accounts.add(p.label, locator, p.providerId as Provider);
      } else if (group === 'service') {
        const path = webKeyFilePath(homedir(), p.label);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, p.secret, { mode: 0o600 });
        for (const chain of chainOf(p.providerId)) {
          deps.web.addCredential(chain, p.providerId, { type: 'key-file', path });
        }
      }
      // unsupported: no-op — no store recognizes this provider id
      return assembleAuthView(viewDeps);
    }),

    replaceSecret: rpcMethod(replaceSecretParams, (p) => {
      const { providerId, label } = splitId(p.id);
      const group = providerGroup(providerId);
      if (group === 'backend') {
        const account = deps.accounts
          .listByProvider(providerId as Provider)
          .find((a) => a.label === label);
        if (account !== undefined && account.locator.type === 'key-file') {
          mkdirSync(dirname(account.locator.path), { recursive: true });
          writeFileSync(account.locator.path, p.secret, { mode: 0o600 });
          deps.keys.clear(`${providerId}:${account.locator.path}`);
        }
        // a pointer credential (config-dir) has no secret to replace — no-op
      } else if (group === 'service') {
        const path = webKeyFilePath(homedir(), label);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, p.secret, { mode: 0o600 });
        deps.keys.clear(`${providerId}:${path}`);
      }
      return assembleAuthView(viewDeps);
    }),

    renameCredential: rpcMethod(renameParams, (p) => {
      const { providerId, label: oldLabel } = splitId(p.id);
      const group = providerGroup(providerId);
      if (group === 'backend') {
        renameBackendCredential(deps.accounts, providerId as Provider, oldLabel, p.label);
      } else if (group === 'service') {
        renameServiceCredential(deps, providerId, oldLabel, p.label);
      }
      return assembleAuthView(viewDeps);
    }),

    removeCredential: rpcMethod(removeCredParams, (p) => {
      const { providerId, label } = splitId(p.id);
      const group = providerGroup(providerId);
      if (group === 'backend') {
        const provider = providerId as Provider;
        const account = deps.accounts.listByProvider(provider).find((a) => a.label === label);
        if (account !== undefined) {
          const activeBefore = deps.accounts.getActive(provider);
          const wasActive = activeBefore.kind === 'account' && activeBefore.account.label === label;
          if (account.locator.type === 'key-file') safeUnlink(account.locator.path);
          removeManagedLogin(account.locator);
          deps.accounts.remove(label);
          // The email has to be read BEFORE the removal — afterwards there is no row to ask.
          // The jar is only this row's to delete if no surviving account shares the identity
          //; the view flags that case so the prompt never offers it.
          if (
            p.removeProfile === true &&
            account.email !== undefined &&
            !isProfileShared(
              account.email,
              deps.accounts.list().map((other) => other.email),
            )
          ) {
            deps.browser?.removeProfile(account.email);
          }
          applyHeirIfWasActive(deps.accounts, provider, label, wasActive);
        }
      } else if (group === 'service') {
        for (const chain of chainOf(providerId)) {
          for (const path of deps.web.removeCredential(chain, label)) safeUnlink(path);
        }
        // the key-file path is deterministic from the label — clear its cooldown so a
        // future same-label key never inherits a stale breaker cooling state
        deps.keys.clear(`${providerId}:${webKeyFilePath(homedir(), label)}`);
      }
      return assembleAuthView(viewDeps);
    }),

    setProviderEnabled: rpcMethod(enableParams, (p) => {
      const group = providerGroup(p.providerId);
      if (group === 'backend') {
        deps.console.setProviderDisabled(p.providerId, !p.on);
      } else if (group === 'service') {
        for (const chain of chainOf(p.providerId))
          deps.web.setProviderDisabled(chain, p.providerId, !p.on);
      }
      return assembleAuthView(viewDeps);
    }),

    setCredentialDisabled: rpcMethod(benchParams, (p) => {
      const { providerId, label } = splitId(p.id);
      const group = providerGroup(providerId);
      if (group === 'backend') {
        const provider = providerId as Provider;
        const account = deps.accounts.listByProvider(provider).find((a) => a.label === label);
        if (account !== undefined) {
          const activeBefore = deps.accounts.getActive(provider);
          const wasActive = activeBefore.kind === 'account' && activeBefore.account.label === label;
          deps.accounts.setDisabled(label, p.disabled);
          if (p.disabled) applyHeirIfWasActive(deps.accounts, provider, label, wasActive);
        }
        // no account at this label — graceful no-op (help, never crash)
      } else if (group === 'service') {
        for (const chain of chainOf(providerId))
          deps.web.setCredentialDisabled(chain, label, p.disabled);
      }
      return assembleAuthView(viewDeps);
    }),

    makeActive: rpcMethod(idParams, (p) => {
      const { providerId, label } = splitId(p.id);
      if (providerGroup(providerId) === 'backend') {
        const account = deps.accounts
          .listByProvider(providerId as Provider)
          .find((a) => a.label === label);
        if (account !== undefined && !account.disabled) deps.accounts.setActive(label);
      }
      return assembleAuthView(viewDeps);
    }),

    clearCooldown: rpcMethod(idParams, (p) => {
      const { providerId, label } = splitId(p.id);
      if (providerGroup(providerId) === 'service') {
        const path = webKeyFilePath(homedir(), label);
        deps.keys.clear(`${providerId}:${path}`);
      }
      return assembleAuthView(viewDeps);
    }),

    refresh: rpcMethod(noParams, () => assembleAuthView(viewDeps)),

    // --- the driven-login verbs (absent manager ⇒ idle, never a throw) --------
    startLogin: rpcMethod(startLoginParams, (p) =>
      deps.loginManager === undefined
        ? IDLE
        : deps.loginManager.startLogin({
            email: p.email,
            ...(p.credentialId !== undefined ? { credentialId: p.credentialId } : {}),
          }),
    ),
    loginState: rpcMethod(noParams, () => deps.loginManager?.snapshot() ?? IDLE),
    submitLoginCode: rpcMethod(codeParams, (p) => {
      deps.loginManager?.submitCode(p.code);
      return deps.loginManager?.snapshot() ?? IDLE;
    }),
    cancelLogin: rpcMethod(noParams, () => {
      deps.loginManager?.cancelLogin();
      return IDLE;
    }),
    resolveLoginMismatch: rpcMethod(
      mismatchParams,
      (p) => deps.loginManager?.resolveMismatch(p.action) ?? IDLE,
    ),
    probeHealth: rpcMethod(noParams, async () => {
      await deps.loginManager?.probeAll();
      return assembleAuthView(viewDeps);
    }),
    reportAuthFailure: rpcMethod(failureParams, (p) => {
      deps.loginManager?.reportAuthFailure(p.credentialId);
      return assembleAuthView(viewDeps);
    }),
  };
}
