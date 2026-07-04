/**
 * Per-provider HTTP status → limit classifiers, shared by each provider's two
 * adapters (search + fetch/extract) so a single mapping can't drift. A `LimitOutcome`
 * is spread into a {@link ProviderOutcome} `limit` variant by the caller; `undefined`
 * means "not a limit" (the caller decides ok vs error).
 */
export type LimitOutcome = { kind: 'rate-limit'; retryAfterMs?: number } | { kind: 'quota' };

/** Parse a `Retry-After` header (delta-seconds) into milliseconds; `null`/invalid ⇒ `undefined`. */
export function parseRetryAfterHeader(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/** Firecrawl: 429 → rate-limit (Retry-After if present); 402 → quota; else not a limit. */
export function firecrawlLimit(
  status: number,
  headers: { get(name: string): string | null },
): LimitOutcome | undefined {
  if (status === 429) {
    const retryAfterMs = parseRetryAfterHeader(headers.get('retry-after'));
    return { kind: 'rate-limit', ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  }
  if (status === 402) return { kind: 'quota' };
  return undefined;
}

/** Tavily: 429 → rate-limit (Retry-After if present); 432/433 → quota; else not a limit (401 is a bad key, not a limit). */
export function tavilyLimit(
  status: number,
  headers: { get(name: string): string | null },
): LimitOutcome | undefined {
  if (status === 429) {
    const retryAfterMs = parseRetryAfterHeader(headers.get('retry-after'));
    return { kind: 'rate-limit', ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  }
  if (status === 432 || status === 433) return { kind: 'quota' };
  return undefined;
}
