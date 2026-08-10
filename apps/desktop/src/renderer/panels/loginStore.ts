import { create } from 'zustand';
import type { CredentialView, LoginSnapshot } from '@coa/console-viewmodel';
import {
  rpcCancelLogin,
  rpcLoginState,
  rpcReportAuthFailure,
  rpcResolveLoginMismatch,
  rpcStartLogin,
  rpcSubmitLoginCode,
} from './rpc.js';
import { useAuthStore } from './authStore.js';

/**
 * The driven-login flow's data, LIVE from the daemon (the authStore/modelsStore pattern):
 * `poll` reads `loginState`; every write action calls its matching RPC verb and reprojects
 * the daemon's returned `LoginSnapshot` — the store never invents flow state itself, it only
 * ever mirrors what the daemon last said. `idle` reprojects to `undefined` (a flow-less
 * dialog, not an error); any transition INTO `registered` — a normal finalize, or a
 * `resolveMismatch('keep')` that lands the same way — rehydrates the auth store so the
 * new/healed account row appears without a manual refresh.
 *
 * The flow is Claude-only today (the daemon's `LoginManager` never takes a `providerId`),
 * so `startLogin`'s `providerId`/`mode` are accepted for the caller's own bookkeeping (a
 * provider-scoped dialog) but aren't forwarded to the RPC or stored — the daemon derives
 * `mode` itself from whether a `credentialId` is present, and echoes it back on the snapshot.
 */

export interface StartLoginParams {
  providerId: string;
  mode: 'new' | 'relogin';
  email: string;
  credentialId?: string;
}

interface LoginState {
  flow: LoginSnapshot | undefined;
  startLogin: (params: StartLoginParams) => Promise<void>;
  submitCode: (code: string) => Promise<void>;
  cancelLogin: () => Promise<void>;
  resolveMismatch: (action: 'keep' | 'retry') => Promise<void>;
  /** One `loginState` round: reprojects the snapshot; on `phase:'idle'` clears the flow. */
  poll: () => Promise<void>;
}

export const useLogin = create<LoginState>((set, get) => {
  /** Reprojects a daemon `LoginSnapshot` onto the store — the one place a round-trip's
   *  result becomes state, so every action applies it the same way. Fires the auth
   *  rehydrate on any transition INTO `registered` (never on an already-registered no-op
   *  poll), so the healed/new account row lands exactly once per finalize. */
  const apply = (snapshot: LoginSnapshot): void => {
    const wasRegistered = get().flow?.phase === 'registered';
    set({ flow: snapshot.phase === 'idle' ? undefined : snapshot });
    if (snapshot.phase === 'registered' && !wasRegistered) {
      void useAuthStore.getState().hydrate();
    }
  };

  return {
    flow: undefined,
    startLogin: async (params) =>
      apply(
        await rpcStartLogin({
          email: params.email,
          ...(params.credentialId !== undefined ? { credentialId: params.credentialId } : {}),
        }),
      ),
    submitCode: async (code) => apply(await rpcSubmitLoginCode(code)),
    cancelLogin: async () => apply(await rpcCancelLogin()),
    resolveMismatch: async (action) => apply(await rpcResolveLoginMismatch(action)),
    poll: async () => apply(await rpcLoginState()),
  };
});

/** The live-session signal — the strongest health evidence there is (stronger than any
 *  probe: the loop just FAILED to authenticate). Flags the active claude login daemon-side
 *  and reprojects the auth store so the badges light in the same breath. Fire-and-forget:
 *  mis-detection costs an amber dot, never a block. Lives HERE (not console.ts, whose push
 *  consumer calls it through the `onAuthFailure` registration) because this module already
 *  owns the auth-store reach — importing the store from console.ts would close a static
 *  import cycle the dependency ruleset forbids. */
export function reportActiveClaudeAuthFailure(): void {
  const report = (id: string): Promise<void> =>
    rpcReportAuthFailure(id).then(() => useAuthStore.getState().hydrate());

  const activeId = useAuthStore.getState().activeByProvider['claude'];
  if (activeId !== undefined) {
    void report(activeId).catch(() => {});
    return;
  }
  // The auth store may genuinely not have hydrated yet this run (a live-session auth
  // failure can land before any auth surface mounted `hydrate()`), which would otherwise
  // drop the signal on the floor forever — hydrate once, then re-check. Still a silent
  // no-op if the id is genuinely absent (no claude login configured at all).
  void useAuthStore
    .getState()
    .hydrate()
    .then(() => {
      const rehydratedId = useAuthStore.getState().activeByProvider['claude'];
      return rehydratedId === undefined ? undefined : report(rehydratedId);
    })
    .catch(() => {});
}

/* ------------------------------ pure selectors ------------------------------ */

/** How many of a provider's credentials need a relogin — zero renders no badge (the count law). */
export function providerAttention(credentials: CredentialView[], providerId: string): number {
  return credentials.filter((c) => c.providerId === providerId && c.health === 'needs-relogin')
    .length;
}

/** The total across every provider — the nav-level badge. */
export function totalAttention(credentials: CredentialView[]): number {
  return credentials.filter((c) => c.health === 'needs-relogin').length;
}

/** Whether the provider's ACTIVE credential is the broken one — worth calling out distinctly
 *  from "some other benched/idle credential needs a relogin". */
export function activeNeedsRelogin(
  activeByProvider: Record<string, string>,
  providerId: string,
  credentials: CredentialView[],
): boolean {
  const activeId = activeByProvider[providerId];
  if (activeId === undefined) return false;
  return credentials.some((c) => c.id === activeId && c.health === 'needs-relogin');
}
