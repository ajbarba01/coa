import { create } from 'zustand';
import { PROVIDERS, isPointerLocator, providerById, type ProviderDescriptor } from './providers.js';

/**
 * The auth/usage surfaces' data, MOCKED IN THE RENDERER (the `mockAgents` precedent).
 *
 * Seven RPC verbs this design needs and the daemon does not yet have — surfacing them is
 * the point of the exercise, not a gap in it:
 *   · `addSecret`                                   — paste a key, daemon writes it 0600
 *   · `listWebKeys` / `addWebKey` / `removeWebKey`  — tool services have ZERO RPC today (CLI-only)
 *   · an enable/disable verb at all three levels    — provider · login · key
 *   · a usage read                                  — identity + limits + spend, per account, via the M9 port
 *   · an edit verb for the NON-secret facts         — rename a label, re-point a config-dir/env-var locator
 *   · a model-visibility write (+ per-provider model reads — only Claude's list exists live)
 *   · a refresh — re-read every pointer locator (identity, expiry, limits) on demand
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
  /** config-dir logins carry an identity the provider told us about. */
  identity?: string;
  plan?: string;
  /** Benched by the operator — still configured, just not used. */
  disabled: boolean;
  /** The login is gone/stale at the pointer; coa can't read limits for it. */
  expired?: boolean;
  /** Circuit-breaker cooldown, in seconds remaining. Owned by the breaker, not the user. */
  coolingSec?: number;
  lastUsed?: string;
}

export interface MockAuthState {
  /** Providers the user has ADDED, in order. Empty ⇒ the surface is its own empty state. */
  added: string[];
  credentials: Credential[];
  /** provider → the ONE active credential (backends only; services are a pool, no "active"). */
  activeByProvider: Record<string, string>;
  /** provider → benched. A benched backend can't be activated; a benched service is skipped. */
  enabled: Record<string, boolean>;
  /** Tool-service chains, in failover order. */
  chains: Record<string, string[]>;
  /** Model ids the user has hidden from the picker. Hiding is a view preference, never a
   *  capability change — the model stays runnable by id, exactly like a benched provider's
   *  credentials stay configured. */
  hiddenModels: string[];

  addProvider: (providerId: string) => void;
  removeProvider: (providerId: string) => void;
  addCredential: (providerId: string, label: string, secret: string) => void;
  /** The only write to an existing secret: an add that supersedes. Never an edit. */
  replaceSecret: (credentialId: string, secret: string) => void;
  /** Labels are coa's own words for a credential — freely editable, never secret. */
  renameCredential: (credentialId: string, label: string) => void;
  removeCredential: (credentialId: string) => void;
  setProviderEnabled: (providerId: string, on: boolean) => void;
  setCredentialDisabled: (credentialId: string, disabled: boolean) => void;
  makeActive: (credentialId: string) => void;
  clearCooldown: (credentialId: string) => void;
  setModelHidden: (modelId: string, hidden: boolean) => void;
  /** Re-read every pointer locator — identity, expiry, limits can all change behind
   *  coa's back (a `claude login` in a terminal). The strip's ⟳ runs this. */
  refresh: () => void;
}

/** Masks a pasted secret the way a read would: keep the prefix, keep the tail, lose the rest. */
export function mask(secret: string): string {
  const clean = secret.trim();
  if (clean.length <= 8) return '••••';
  return `${clean.slice(0, 4)}…${clean.slice(-3)}`;
}

/** What a read returns for this provider's credential: a POINTER (a path, a variable name)
 *  is stored verbatim — masking `~/.claude-work` would hide a fact coa can read anyway —
 *  while a real secret keeps only its mask. */
export function stored(providerId: string, value: string): string {
  return isPointerLocator(providerById(providerId)?.locator) ? value.trim() : mask(value);
}

let seq = 0;
const nextId = (): string => `c${++seq}`;

/** Cooling is the ABSENCE of the field, not a field set to undefined (exactOptionalPropertyTypes):
 *  "not cooling" and "cooling for an unknown time" must not be the same value. */
function uncooled(c: Credential): Credential {
  const { coolingSec: _cooling, ...rest } = c;
  return rest;
}

function cred(
  c: Omit<Credential, 'id' | 'disabled'> & Partial<Pick<Credential, 'disabled'>>,
): Credential {
  return { id: nextId(), disabled: false, ...c };
}

/** The seed mirrors the real `~/.coa` shape (3 claude logins, keyed backends, a fat tavily pool
 *  with one key cooling and one benched) — the states the surface has to survive, not a happy path. */
const SEED_CREDENTIALS: Credential[] = [
  cred({
    providerId: 'claude',
    label: 'worm',
    masked: '~/.claude',
    identity: 'wormsegment1000@gmail.com',
    plan: 'Claude Pro',
    lastUsed: 'now',
  }),
  cred({
    providerId: 'claude',
    label: 'school',
    masked: '~/.claude-school',
    identity: 'alex@barba.edu',
    plan: 'Claude Pro',
    lastUsed: '3d',
  }),
  // No identity: the pointer is stale, so coa cannot read who this login belongs to. The row
  // says that ONCE, as its status — the identity column shows the pointer we still have.
  cred({
    providerId: 'claude',
    label: 'personal',
    masked: '~/.claude-personal',
    expired: true,
    lastUsed: '2w',
  }),
  cred({ providerId: 'deepseek', label: 'ds', masked: 'sk-9…4f1', lastUsed: '1d' }),
  cred({ providerId: 'longcat', label: 'lc', masked: 'lc-2…c07', lastUsed: '2w' }),
  cred({ providerId: 'tavily', label: 'tavily-1', masked: 'tvly…8f2', lastUsed: '2m' }),
  cred({ providerId: 'tavily', label: 'tavily-2', masked: 'tvly…a10', lastUsed: '11m' }),
  cred({
    providerId: 'tavily',
    label: 'tavily-3',
    masked: 'tvly…c4d',
    coolingSec: 252,
    lastUsed: '5m',
  }),
  cred({ providerId: 'tavily', label: 'tavily-4', masked: 'tvly…33e', lastUsed: '1h' }),
  cred({ providerId: 'tavily', label: 'tavily-5', masked: 'tvly…9be', disabled: true }),
  cred({ providerId: 'tavily', label: 'tavily-6', masked: 'tvly…71c', lastUsed: '4h' }),
  cred({ providerId: 'tavily', label: 'tavily-7', masked: 'tvly…e50', lastUsed: '2d' }),
  cred({ providerId: 'firecrawl', label: 'fc-1', masked: 'fc-1…b22', lastUsed: '18m' }),
  cred({ providerId: 'firecrawl', label: 'fc-2', masked: 'fc-2…9a4', lastUsed: '1d' }),
  cred({ providerId: 'parallel', label: 'px-1', masked: 'px-0…5d1' }),
];

export const useMockAuth = create<MockAuthState>((set) => ({
  added: ['claude', 'deepseek', 'longcat', 'tavily', 'firecrawl', 'parallel'],
  credentials: SEED_CREDENTIALS,
  activeByProvider: {
    claude: SEED_CREDENTIALS[0]?.id ?? '',
    deepseek: SEED_CREDENTIALS[3]?.id ?? '',
  },
  enabled: {
    claude: true,
    deepseek: true,
    longcat: false,
    tavily: true,
    firecrawl: true,
    parallel: false,
  },
  chains: {
    search: ['tavily', 'firecrawl', 'parallel'],
    fetch: ['firecrawl', 'tavily'],
  },
  // One hidden seed so the state is visible on first look, not a theory.
  hiddenModels: ['claude-haiku-3-5'],

  addProvider: (providerId) =>
    set((s) =>
      s.added.includes(providerId)
        ? s
        : {
            added: [...s.added, providerId],
            enabled: { ...s.enabled, [providerId]: true },
          },
    ),

  // Removing a provider takes its credentials with it — the pointers are the provider.
  removeProvider: (providerId) =>
    set((s) => {
      const activeByProvider = { ...s.activeByProvider };
      delete activeByProvider[providerId];
      return {
        added: s.added.filter((id) => id !== providerId),
        credentials: s.credentials.filter((c) => c.providerId !== providerId),
        activeByProvider,
      };
    }),

  addCredential: (providerId, label, secret) =>
    set((s) => {
      const created = cred({
        providerId,
        label,
        masked: stored(providerId, secret),
        lastUsed: 'never',
      });
      const isFirstBackend =
        providerById(providerId)?.group === 'backend' &&
        s.credentials.every((c) => c.providerId !== providerId);
      return {
        credentials: [...s.credentials, created],
        // A backend's first login has nothing to compete with — adopt it, rather than
        // leaving the provider configured-but-inert.
        activeByProvider: isFirstBackend
          ? { ...s.activeByProvider, [providerId]: created.id }
          : s.activeByProvider,
      };
    }),

  // A fresh secret clears what the OLD one earned: its cooldown, and its expiry.
  replaceSecret: (credentialId, secret) =>
    set((s) => ({
      credentials: s.credentials.map((c) =>
        c.id === credentialId
          ? { ...uncooled(c), masked: stored(c.providerId, secret), expired: false }
          : c,
      ),
    })),

  renameCredential: (credentialId, label) =>
    set((s) =>
      label.trim() === ''
        ? s
        : {
            credentials: s.credentials.map((c) =>
              c.id === credentialId ? { ...c, label: label.trim() } : c,
            ),
          },
    ),

  removeCredential: (credentialId) =>
    set((s) => {
      const gone = s.credentials.find((c) => c.id === credentialId);
      const credentials = s.credentials.filter((c) => c.id !== credentialId);
      const activeByProvider = { ...s.activeByProvider };
      // Removing the active login promotes the next usable sibling — never leave a
      // provider pointing at a credential that no longer exists.
      if (gone !== undefined && activeByProvider[gone.providerId] === credentialId) {
        const heir = credentials.find(
          (c) => c.providerId === gone.providerId && !c.disabled && c.expired !== true,
        );
        if (heir === undefined) delete activeByProvider[gone.providerId];
        else activeByProvider[gone.providerId] = heir.id;
      }
      return { credentials, activeByProvider };
    }),

  setProviderEnabled: (providerId, on) =>
    set((s) => ({ enabled: { ...s.enabled, [providerId]: on } })),

  setCredentialDisabled: (credentialId, disabled) =>
    set((s) => {
      const credentials = s.credentials.map((c) =>
        c.id === credentialId ? { ...c, disabled } : c,
      );
      const target = s.credentials.find((c) => c.id === credentialId);
      const activeByProvider = { ...s.activeByProvider };
      // Benching the active login must also unseat it — "disabled but active" is a lie.
      if (
        disabled &&
        target !== undefined &&
        activeByProvider[target.providerId] === credentialId
      ) {
        const heir = credentials.find(
          (c) => c.providerId === target.providerId && !c.disabled && c.expired !== true,
        );
        if (heir === undefined) delete activeByProvider[target.providerId];
        else activeByProvider[target.providerId] = heir.id;
      }
      return { credentials, activeByProvider };
    }),

  makeActive: (credentialId) =>
    set((s) => {
      const target = s.credentials.find((c) => c.id === credentialId);
      if (target === undefined || target.disabled || target.expired === true) return s;
      return { activeByProvider: { ...s.activeByProvider, [target.providerId]: credentialId } };
    }),

  clearCooldown: (credentialId) =>
    set((s) => ({
      credentials: s.credentials.map((c) => (c.id === credentialId ? uncooled(c) : c)),
    })),

  setModelHidden: (modelId, hidden) =>
    set((s) => ({
      hiddenModels: hidden
        ? s.hiddenModels.includes(modelId)
          ? s.hiddenModels
          : [...s.hiddenModels, modelId]
        : s.hiddenModels.filter((id) => id !== modelId),
    })),

  // The honest seam for the strip's ⟳: the real verb re-reads every pointer locator via
  // the daemon. The mock has nothing stale to re-read, so this changes nothing — no
  // spinner theater pretending otherwise.
  refresh: () => set((s) => s),
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
