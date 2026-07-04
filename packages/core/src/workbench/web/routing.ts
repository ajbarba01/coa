/**
 * The generic, deterministic web-provider routing core (P1). A chain walks an
 * ordered list of keyed entries, skips any key still cooling down in a persisted
 * circuit-breaker, marks a cooldown on a `limit`, and returns the first `ok`
 * value. Value-generic, so the fetch side (this increment) and the search side
 * (increment 2) share it. No provider/HTTP specifics leak in — adapters map their
 * own responses to a {@link ProviderOutcome}.
 */

/** An adapter's classified result — never a throw (SC-1). `clean` = already extracted/summarized. */
export type ProviderOutcome<T> =
  | { status: 'ok'; value: T; clean: boolean }
  | { status: 'limit'; kind: 'rate-limit' | 'quota'; retryAfterMs?: number }
  | { status: 'error'; reason: string };

/** The persisted circuit-breaker surface {@link runChain} depends on (real impl: KeyStateStore). */
export interface CooldownStore {
  isCoolingDown(id: string, now: number): boolean;
  markCooldown(id: string, until: number): void;
  clear(id: string): void;
}

/** One ordered chain hop: a keyed, no-throw run producing a {@link ProviderOutcome}. */
export interface ChainEntry<T> {
  run: () => Promise<ProviderOutcome<T>>;
  keyStateId: string;
}

/** The chain's result: the first `ok`, or a miss carrying the last failure reason for surfacing. */
export type ChainResult<T> =
  | { status: 'ok'; value: T; clean: boolean }
  | { status: 'exhausted'; lastReason?: string };

/** The next local midnight strictly after `now` — the default cooldown for quota/ambiguous limits. */
export function nextLocalMidnight(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0); // rolls to 00:00 of the following local day
  return d.getTime();
}

/**
 * Walk `entries` in priority order: skip any still cooling down; run the next live
 * one; on `limit` compute a cooldown (`rate-limit` + `retryAfterMs` → `now +
 * retryAfterMs`; `quota` or an ambiguous rate-limit → `quotaCooldownUntil(now)`)
 * and continue; on `error` continue with no cooldown; on `ok` clear that key's
 * cooldown and return. All exhausted ⇒ a miss with the last reason (SC-1). Pure
 * but for the injected store's side effects and the entries' own runs.
 */
export async function runChain<T>(
  entries: readonly ChainEntry<T>[],
  store: CooldownStore,
  now: number,
  quotaCooldownUntil: (now: number) => number,
): Promise<ChainResult<T>> {
  let lastReason: string | undefined;
  for (const entry of entries) {
    if (store.isCoolingDown(entry.keyStateId, now)) continue;
    const outcome = await entry.run();
    if (outcome.status === 'ok') {
      store.clear(entry.keyStateId);
      return { status: 'ok', value: outcome.value, clean: outcome.clean };
    }
    if (outcome.status === 'limit') {
      const until =
        outcome.kind === 'rate-limit' && outcome.retryAfterMs !== undefined
          ? now + outcome.retryAfterMs
          : quotaCooldownUntil(now);
      store.markCooldown(entry.keyStateId, until);
      lastReason = `limit:${outcome.kind}`;
      continue;
    }
    lastReason = outcome.reason;
  }
  return { status: 'exhausted', ...(lastReason !== undefined ? { lastReason } : {}) };
}
