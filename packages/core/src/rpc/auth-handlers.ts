import {
  AMBIENT,
  locatorSchema,
  providerSchema,
  type ActiveByProvider,
  type Provider,
} from '@coa/shared';
import { z } from 'zod';
import type { AccountsRegistry } from '../auth/registry.js';
import { rpcMethod, type RpcHandlers } from './router.js';

/**
 * The CON-CAT account verbs — the GUI-ready twin of the `coa auth` CLI, over the
 * SAME registry core. Mutating-but-cheap local file ops; no model call. The active
 * account is tracked **per provider**, so each response reports the active label
 * for every provider (absent ⇒ ambient) and the flat account list (each carrying
 * its provider). Selecting `ambient` for a provider needs the provider named;
 * selecting an account infers it. Params are M0-validated.
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

export function buildAuthHandlers(registry: AccountsRegistry): RpcHandlers {
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
  };
}
