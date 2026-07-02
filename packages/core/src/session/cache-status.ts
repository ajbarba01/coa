/**
 * M8 — deterministic prompt-cache status (SPEC: caching is a prefix match; anything
 * that changes the cached prefix, the backend, or lets the provider's cache TTL lapse
 * makes the next turn start cold). This is a PURE, side-effect-free heuristic — NO
 * model call (P1) — that a send compares the current turn against the previous one to
 * decide whether to surface the cache-status banner. It never blocks; it only informs.
 */

/** Why the provider's prompt cache is likely cold on this turn. */
export type CacheColdReason = 'provider-changed' | 'model-changed' | 'prompt-recompiled' | 'stale';

/** The previous turn's cache-relevant facts (from the session's stored metadata). */
export interface CacheStatusPrior {
  provider?: string;
  model?: string;
  /** The frozen prompt version the last turn ran on. */
  promptVersion?: string;
  /** ISO timestamp of the last turn (its recency drives the staleness check). */
  at?: string;
}

export interface CacheStatusInput {
  /** The prior turn's facts; absent ⇒ the first turn (nothing cached to invalidate). */
  prior?: CacheStatusPrior;
  /** This turn's routing + frozen prompt version. */
  current: { provider: string; model?: string; promptVersion?: string };
  /** Now, as an ISO timestamp (injected so the check stays pure/testable). */
  now: string;
  /** The provider's cache TTL in ms; absent or ≤ 0 ⇒ the staleness check is off. */
  stalenessMs?: number;
}

/**
 * The reasons this turn's provider cache is likely cold — empty ⇒ warm (no banner).
 * A first turn (no `prior`) is warm by definition. Each trigger is only raised when
 * both sides are known and actually differ, so a same-config continuation stays quiet.
 */
export function cacheColdReasons(input: CacheStatusInput): CacheColdReason[] {
  const { prior, current } = input;
  if (prior === undefined) return [];
  const reasons: CacheColdReason[] = [];
  if (prior.provider !== undefined && prior.provider !== current.provider) {
    reasons.push('provider-changed');
  }
  if (prior.model !== current.model) reasons.push('model-changed');
  if (
    prior.promptVersion !== undefined &&
    current.promptVersion !== undefined &&
    prior.promptVersion !== current.promptVersion
  ) {
    reasons.push('prompt-recompiled');
  }
  if (input.stalenessMs !== undefined && input.stalenessMs > 0 && prior.at !== undefined) {
    const elapsed = Date.parse(input.now) - Date.parse(prior.at);
    if (Number.isFinite(elapsed) && elapsed > input.stalenessMs) reasons.push('stale');
  }
  return reasons;
}
