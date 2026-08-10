import type { RuntimeUsage } from '@coa/spi';
import type { ModelPrice, PriceTable, ProviderSpec } from './provider-spec.js';
import type { WireUsage } from './wire.js';

/**
 * Cost accounting for a raw API. These providers return token usage but no dollar
 * cost, so coa computes it from the spec's config-overridable price table. A model
 * with no configured entry costs 0 (the zero floor — the cap never guesses).
 * Cache-hit input tokens — extracted per spec, since providers disagree on the wire
 * shape — bill at the (cheaper) cache rate when one is configured, otherwise the
 * normal input rate; the rest of the input bills at the input rate.
 */
export function toRuntimeUsage(
  spec: ProviderSpec,
  usage: WireUsage | undefined,
  model: string,
  table: PriceTable,
): RuntimeUsage {
  if (usage === undefined) return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const { tokensIn, tokensOut, cacheReadTokens } = spec.extractUsage(usage);
  const cacheHit = cacheReadTokens ?? 0;
  const price = table[model];
  const costUsd = price === undefined ? 0 : billed(price, tokensIn, tokensOut, cacheHit);
  return {
    tokensIn,
    tokensOut,
    costUsd,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
  };
}

function billed(price: ModelPrice, tokensIn: number, tokensOut: number, cacheHit: number): number {
  const cacheRate = price.cacheInPerMillion ?? price.inPerMillion;
  const freshIn = Math.max(tokensIn - cacheHit, 0);
  const perMillion = (tokens: number, rate: number): number => (tokens / 1_000_000) * rate;
  return (
    perMillion(freshIn, price.inPerMillion) +
    perMillion(cacheHit, cacheRate) +
    perMillion(tokensOut, price.outPerMillion)
  );
}
