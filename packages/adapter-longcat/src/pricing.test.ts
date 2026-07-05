import { describe, expect, it } from 'vitest';
import { loadPriceTable, toRuntimeUsage, PRICES_ENV_VAR, DEFAULT_PRICES } from './pricing.js';
import type { WireUsage } from './wire.js';

describe('loadPriceTable', () => {
  it('ships the published LongCat-2.0 default rates when unset', () => {
    expect(loadPriceTable({})).toEqual(DEFAULT_PRICES);
    expect(DEFAULT_PRICES['LongCat-2.0']).toEqual({
      inPerMillion: 0.75,
      outPerMillion: 2.95,
      cacheInPerMillion: 0.015,
    });
  });

  it('merges the config-overridable table over the defaults', () => {
    const table = loadPriceTable({
      [PRICES_ENV_VAR]: '{"LongCat-2.0":{"inPerMillion":0.3,"outPerMillion":1.2}}',
    });
    expect(table['LongCat-2.0']).toEqual({ inPerMillion: 0.3, outPerMillion: 1.2 });
  });

  it('falls back to the defaults for a malformed override', () => {
    expect(loadPriceTable({ [PRICES_ENV_VAR]: 'not json' })).toEqual(DEFAULT_PRICES);
    expect(loadPriceTable({ [PRICES_ENV_VAR]: '{"m":{"inPerMillion":-1}}' })).toEqual(
      DEFAULT_PRICES,
    );
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

  it('bills cached input tokens at the cache rate and reports them', () => {
    const cached: WireUsage = {
      prompt_tokens: 1_000_000,
      completion_tokens: 0,
      prompt_tokens_details: { cached_tokens: 400_000 },
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
