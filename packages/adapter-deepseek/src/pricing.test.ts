import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICES, loadPriceTable, toRuntimeUsage, PRICES_ENV_VAR } from './pricing.js';
import type { WireUsage } from './wire.js';

describe('loadPriceTable', () => {
  it('parses the config-overridable table from the env var', () => {
    const table = loadPriceTable({
      [PRICES_ENV_VAR]: '{"deepseek-chat":{"inPerMillion":0.27,"outPerMillion":1.1}}',
    });
    expect(table['deepseek-chat']).toEqual({ inPerMillion: 0.27, outPerMillion: 1.1 });
  });

  /**
   * DeepSeek publishes its rates, so the zero floor is no longer the honest default —
   * shipping them means the cost cap sees real spend without the operator configuring
   * anything. An unset or malformed var falls back to the shipped table, never to zero.
   */
  it('falls back to the published rates when unset or malformed', () => {
    expect(loadPriceTable({})).toEqual(DEFAULT_PRICES);
    expect(loadPriceTable({ [PRICES_ENV_VAR]: 'not json' })).toEqual(DEFAULT_PRICES);
    expect(loadPriceTable({ [PRICES_ENV_VAR]: '{"m":{"inPerMillion":-1}}' })).toEqual(
      DEFAULT_PRICES,
    );
  });

  it('ships the published v4 rates, cache-hit included', () => {
    expect(DEFAULT_PRICES['deepseek-v4-flash']).toEqual({
      inPerMillion: 0.14,
      outPerMillion: 0.28,
      cacheInPerMillion: 0.0028,
    });
    expect(DEFAULT_PRICES['deepseek-v4-pro']).toEqual({
      inPerMillion: 0.435,
      outPerMillion: 0.87,
      cacheInPerMillion: 0.003625,
    });
  });

  /** An override names one model; the rest of the shipped table survives it. */
  it('merges an override over the shipped table rather than replacing it', () => {
    const table = loadPriceTable({
      [PRICES_ENV_VAR]: '{"deepseek-v4-pro":{"inPerMillion":9,"outPerMillion":9}}',
    });
    expect(table['deepseek-v4-pro']).toEqual({ inPerMillion: 9, outPerMillion: 9 });
    expect(table['deepseek-v4-flash']).toEqual(DEFAULT_PRICES['deepseek-v4-flash']);
  });
});

describe('toRuntimeUsage', () => {
  const usage: WireUsage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 };

  it('passes token counts through and prices a table entry', () => {
    const result = toRuntimeUsage(usage, 'm', { m: { inPerMillion: 1, outPerMillion: 2 } });
    expect(result).toEqual({ tokensIn: 1_000_000, tokensOut: 1_000_000, costUsd: 3 });
  });

  it('costs zero for a model absent from the table (the zero floor)', () => {
    expect(toRuntimeUsage(usage, 'unknown', {}).costUsd).toBe(0);
  });

  it('bills cache-hit input tokens at the cache rate and reports them', () => {
    const cached: WireUsage = {
      prompt_tokens: 1_000_000,
      completion_tokens: 0,
      prompt_cache_hit_tokens: 400_000,
    };
    const result = toRuntimeUsage(cached, 'm', {
      m: { inPerMillion: 1, outPerMillion: 2, cacheInPerMillion: 0.5 },
    });
    // 600k fresh @1 + 400k cache @0.5 = 0.6 + 0.2
    expect(result.costUsd).toBeCloseTo(0.8, 10);
    expect(result.cacheReadTokens).toBe(400_000);
  });

  it('is all-zero for an absent usage block', () => {
    expect(toRuntimeUsage(undefined, 'm', {})).toEqual({ tokensIn: 0, tokensOut: 0, costUsd: 0 });
  });
});
