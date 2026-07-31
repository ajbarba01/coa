import { describe, expect, it } from 'vitest';
import { parseRetryAfterHeader, firecrawlLimit, tavilyLimit } from './limits.js';

const headers = (retryAfter?: string) => ({
  get: (n: string) => (n.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null),
});

describe('parseRetryAfterHeader', () => {
  it('parses delta-seconds to milliseconds', () => {
    expect(parseRetryAfterHeader('30')).toBe(30_000);
  });
  it('returns undefined for null or non-numeric', () => {
    expect(parseRetryAfterHeader(null)).toBeUndefined();
    expect(parseRetryAfterHeader('soon')).toBeUndefined();
  });
});

describe('firecrawlLimit', () => {
  it('maps 429 to rate-limit with Retry-After when present', () => {
    expect(firecrawlLimit(429, headers('12'))).toEqual({
      kind: 'rate-limit',
      retryAfterMs: 12_000,
    });
  });
  it('maps 429 with no Retry-After to a bare rate-limit', () => {
    expect(firecrawlLimit(429, headers())).toEqual({ kind: 'rate-limit' });
  });
  it('maps 402 to quota', () => {
    expect(firecrawlLimit(402, headers())).toEqual({ kind: 'quota' });
  });
  it('returns undefined for a non-limit status', () => {
    expect(firecrawlLimit(200, headers())).toBeUndefined();
    expect(firecrawlLimit(500, headers())).toBeUndefined();
  });
});

describe('tavilyLimit', () => {
  it('maps 429 to rate-limit (with Retry-After if present)', () => {
    expect(tavilyLimit(429, headers('5'))).toEqual({ kind: 'rate-limit', retryAfterMs: 5000 });
    expect(tavilyLimit(429, headers())).toEqual({ kind: 'rate-limit' });
  });
  it('maps 432 and 433 to quota', () => {
    expect(tavilyLimit(432, headers())).toEqual({ kind: 'quota' });
    expect(tavilyLimit(433, headers())).toEqual({ kind: 'quota' });
  });
  it('returns undefined for a non-limit status (incl. 401)', () => {
    expect(tavilyLimit(401, headers())).toBeUndefined();
    expect(tavilyLimit(200, headers())).toBeUndefined();
  });
});
