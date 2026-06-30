import { AMBIENT, locatorSchema } from '@coa/shared';
import { z } from 'zod';
import type { AccountsRegistry } from '../auth/registry.js';
import { rpcMethod, type RpcHandlers } from './router.js';

/**
 * The CON-CAT account verbs — the GUI-ready twin of the `coa auth` CLI, over the
 * SAME registry core. Mutating-but-cheap local file ops; no model call. Params
 * are M0-validated (locator via the shared schema) so a malformed pointer is a
 * coded invalid-params error, never a thrown 500.
 */
const addParams = z.object({ label: z.string().min(1), locator: locatorSchema });
const labelParams = z.object({ label: z.string().min(1) });
const noParams = z.unknown().optional();

export function buildAuthHandlers(registry: AccountsRegistry): RpcHandlers {
  const activeLabel = (): string => {
    const active = registry.getActive();
    return active.kind === 'account' ? active.account.label : AMBIENT;
  };
  return {
    listAccounts: rpcMethod(noParams, () => ({ accounts: registry.list() })),
    currentAccount: rpcMethod(noParams, () => ({ active: activeLabel() })),
    addAccount: rpcMethod(addParams, (p) => {
      registry.add(p.label, p.locator);
      return { accounts: registry.list() };
    }),
    useAccount: rpcMethod(labelParams, (p) => {
      registry.setActive(p.label);
      return { active: activeLabel() };
    }),
    removeAccount: rpcMethod(labelParams, (p) => {
      registry.remove(p.label);
      return { accounts: registry.list() };
    }),
  };
}
