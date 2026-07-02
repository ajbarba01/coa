import { describe, expect, it } from 'vitest';
import { loadPriceTable, toRuntimeUsage, PRICES_ENV_VAR } from './pricing.js';
import type { WireUsage } from './wire.js';

describe('loadPriceTable', () => {
  it('parses the config-overridable table from the env var', () => {
    const table = loadPriceTable({
      [PRICES_ENV_VAR]: '{"deepseek-chat":{"inPerMillion":0.27,"outPerMillion":1.1}}',
    });
    expect(table['deepseek-chat']).toEqual({ inPerMillion: 0.27, outPerMillion: 1.1 });
  });

  it('is the empty (zero-floor) table when unset or malformed', () => {
    expect(loadPriceTable({})).toEqual({});
    expect(loadPriceTable({ [PRICES_ENV_VAR]: 'not json' })).toEqual({});
    expect(loadPriceTable({ [PRICES_ENV_VAR]: '{"m":{"inPerMillion":-1}}' })).toEqual({});
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
