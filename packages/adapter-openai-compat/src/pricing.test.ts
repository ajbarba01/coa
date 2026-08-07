import { describe, expect, it } from 'vitest';
import { toRuntimeUsage } from './pricing.js';
import { loadPriceTable } from './provider-spec.js';
import { deepseekSpec } from './deepseek.js';
import { longcatSpec } from './longcat.js';
import type { WireUsage } from './wire.js';

describe('loadPriceTable', () => {
  it('parses the config-overridable table from the spec price env var', () => {
    const table = loadPriceTable(deepseekSpec, {
      COA_DEEPSEEK_PRICES: '{"deepseek-chat":{"inPerMillion":0.27,"outPerMillion":1.1}}',
    });
    expect(table['deepseek-chat']).toEqual({ inPerMillion: 0.27, outPerMillion: 1.1 });
  });

  /**
   * Both providers publish their rates, so the zero floor is not the honest default —
   * shipping them means the spend ledger sees real cost without the operator configuring
   * anything. An unset or malformed var falls back to the shipped table, never to zero.
   */
  it('falls back to the published rates when unset or malformed', () => {
    expect(loadPriceTable(deepseekSpec, {})).toEqual(deepseekSpec.defaultPrices);
    expect(loadPriceTable(deepseekSpec, { COA_DEEPSEEK_PRICES: 'not json' })).toEqual(
      deepseekSpec.defaultPrices,
    );
    expect(
      loadPriceTable(deepseekSpec, { COA_DEEPSEEK_PRICES: '{"m":{"inPerMillion":-1}}' }),
    ).toEqual(deepseekSpec.defaultPrices);
    expect(loadPriceTable(longcatSpec, {})).toEqual(longcatSpec.defaultPrices);
    expect(loadPriceTable(longcatSpec, { COA_LONGCAT_PRICES: 'not json' })).toEqual(
      longcatSpec.defaultPrices,
    );
  });

  it('ships the published DeepSeek V4 rates, cache-hit included', () => {
    expect(deepseekSpec.defaultPrices['deepseek-v4-flash']).toEqual({
      inPerMillion: 0.14,
      outPerMillion: 0.28,
      cacheInPerMillion: 0.0028,
    });
    expect(deepseekSpec.defaultPrices['deepseek-v4-pro']).toEqual({
      inPerMillion: 0.435,
      outPerMillion: 0.87,
      cacheInPerMillion: 0.003625,
    });
  });

  it('ships the published LongCat-2.0 rates, cache-hit included', () => {
    expect(longcatSpec.defaultPrices['LongCat-2.0']).toEqual({
      inPerMillion: 0.75,
      outPerMillion: 2.95,
      cacheInPerMillion: 0.015,
    });
  });

  /** An override names one model; the rest of the shipped table survives it. */
  it('merges an override over the shipped table rather than replacing it', () => {
    const table = loadPriceTable(deepseekSpec, {
      COA_DEEPSEEK_PRICES: '{"deepseek-v4-pro":{"inPerMillion":9,"outPerMillion":9}}',
    });
    expect(table['deepseek-v4-pro']).toEqual({ inPerMillion: 9, outPerMillion: 9 });
    expect(table['deepseek-v4-flash']).toEqual(deepseekSpec.defaultPrices['deepseek-v4-flash']);
  });
});

// The shared arithmetic, exercised through one spec; the per-provider cache-token
// wire shapes (flat vs nested) have their own tests below.
describe('toRuntimeUsage (shared arithmetic)', () => {
  const usage: WireUsage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 };

  it('passes token counts through and prices a table entry', () => {
    const result = toRuntimeUsage(deepseekSpec, usage, 'm', {
      m: { inPerMillion: 1, outPerMillion: 2 },
    });
    expect(result).toEqual({ tokensIn: 1_000_000, tokensOut: 1_000_000, costUsd: 3 });
  });

  it('costs zero for a model absent from the table (the zero floor)', () => {
    expect(toRuntimeUsage(deepseekSpec, usage, 'unknown', {}).costUsd).toBe(0);
  });

  it('is all-zero for an absent usage block', () => {
    expect(toRuntimeUsage(deepseekSpec, undefined, 'm', {})).toEqual({
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    });
  });
});

describe('toRuntimeUsage (per-provider cache-token shapes)', () => {
  it("bills DeepSeek's FLAT cache-hit tokens at the cache rate and reports them", () => {
    const cached: WireUsage = {
      prompt_tokens: 1_000_000,
      completion_tokens: 0,
      prompt_cache_hit_tokens: 400_000,
    };
    const result = toRuntimeUsage(deepseekSpec, cached, 'm', {
      m: { inPerMillion: 1, outPerMillion: 2, cacheInPerMillion: 0.5 },
    });
    // 600k fresh @1 + 400k cache @0.5 = 0.6 + 0.2
    expect(result.costUsd).toBeCloseTo(0.8, 10);
    expect(result.cacheReadTokens).toBe(400_000);
  });

  it("bills LongCat's NESTED cached tokens at the cache rate and reports them", () => {
    const cached: WireUsage = {
      prompt_tokens: 1_000_000,
      completion_tokens: 0,
      prompt_tokens_details: { cached_tokens: 400_000 },
    };
    const result = toRuntimeUsage(longcatSpec, cached, 'm', {
      m: { inPerMillion: 1, outPerMillion: 2, cacheInPerMillion: 0.5 },
    });
    // 600k fresh @1 + 400k cache @0.5 = 0.6 + 0.2
    expect(result.costUsd).toBeCloseTo(0.8, 10);
    expect(result.cacheReadTokens).toBe(400_000);
  });

  it("ignores the other provider's cache shape (each spec extracts only its own)", () => {
    const flat: WireUsage = {
      prompt_tokens: 10,
      completion_tokens: 1,
      prompt_cache_hit_tokens: 4,
    };
    expect(toRuntimeUsage(longcatSpec, flat, 'm', {}).cacheReadTokens).toBeUndefined();
    const nested: WireUsage = {
      prompt_tokens: 10,
      completion_tokens: 1,
      prompt_tokens_details: { cached_tokens: 4 },
    };
    expect(toRuntimeUsage(deepseekSpec, nested, 'm', {}).cacheReadTokens).toBeUndefined();
  });
});
