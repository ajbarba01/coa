import { z } from 'zod';

/**
 * M0 — the credential-blind multi-account types. coa stores POINTERS to Claude
 * subscription logins (a Claude Code config dir holding one `claude /login`),
 * never tokens. The locator→env mapping that turns a locator into SDK auth lives
 * in the Claude adapter (the backend seam), not here. `ambient` = no override =
 * today's behavior. (The `ant auth login` profile mechanism was dropped: it
 * selects Anthropic Console/API profiles — the API-billing path this design
 * avoids — not Claude.ai subscription logins.)
 */

/** Reserved `active` sentinel: run under whatever login the environment already resolves. */
export const AMBIENT = 'ambient';

/**
 * A pointer to a login — never a secret. `config-dir` names a Claude Code config
 * dir (a subscription login); `env-var` names the environment variable that holds
 * an API-key provider's key (e.g. DeepSeek); `key-file` names a file (0600, under
 * `~/.coa/keys/`) that coa wrote the key into — both are pointers, the secret
 * lives outside `accounts.yaml`; `ambient` is no override (today's behavior).
 */
export const locatorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('config-dir'), dir: z.string().min(1) }),
  z.object({ type: z.literal('env-var'), name: z.string().min(1) }),
  z.object({ type: z.literal('key-file'), path: z.string().min(1) }),
  z.object({ type: z.literal('ambient') }),
]);
export type Locator = z.infer<typeof locatorSchema>;

/** The backends an account can point at. `claude` = subscription login; `deepseek`/`longcat` = API-key providers. */
export const providerSchema = z.enum(['claude', 'deepseek', 'longcat']);
export type Provider = z.infer<typeof providerSchema>;

/** A registered account: a user-facing label + the neutral pointer to its login. */
export const accountSchema = z.object({
  label: z.string().min(1),
  provider: providerSchema.default('claude'),
  locator: locatorSchema,
  /** Benched by the operator — still configured, just not used. Additive, drop-safe. */
  disabled: z.boolean().default(false),
  /** The declared identity — what a driven login pre-fills (`--email`). The live
   *  identity is probe-derived and never stored here. Additive, drop-safe. */
  email: z.string().optional(),
  /** A stable, opaque account id. Minted at registration and never derived from the
   *  email or label: both change, and a slug of either collides. It is what per-account
   *  side state (a browser profile dir) is keyed by — see docs/adr/0018. Absent on rows
   *  written before ids existed; the registry backfills lazily. Additive, drop-safe. */
  id: z.string().optional(),
});
export type Account = z.infer<typeof accountSchema>;

/** The active account label per provider (absent ⇒ that provider runs ambient). A partial map. */
export const activeByProviderSchema = z.record(z.string(), z.string());
export type ActiveByProvider = z.infer<typeof activeByProviderSchema>;

/** The on-disk registry: the active account per provider + the registered accounts. */
export const accountsFileSchema = z.object({
  active: activeByProviderSchema,
  accounts: z.array(accountSchema),
});
export type AccountsFile = z.infer<typeof accountsFileSchema>;

/** What a backend's sign-in NEEDS at the auth layer. `isolatedBrowserSession` says the
 *  sign-in is a browser cookie-session flow, so a dedicated browser profile is what makes
 *  the declared identity actually select the account. Claude is the first consumer, not
 *  the owner: a future provider is a row here, never new machinery (docs/adr/0018). */
export interface ProviderCapabilities {
  isolatedBrowserSession: boolean;
}

export const PROVIDER_CAPABILITIES: Record<Provider, ProviderCapabilities> = {
  claude: { isolatedBrowserSession: true },
  deepseek: { isolatedBrowserSession: false },
  longcat: { isolatedBrowserSession: false },
};

/** Capability lookup for an unvalidated provider id — an id no backend claims is a `false`,
 *  never a throw (SC-1: an unknown provider just takes the plain path). */
export function supportsIsolatedBrowserSession(provider: string): boolean {
  const parsed = providerSchema.safeParse(provider);
  return parsed.success && PROVIDER_CAPABILITIES[parsed.data].isolatedBrowserSession;
}
