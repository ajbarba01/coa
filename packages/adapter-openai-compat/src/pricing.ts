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
 *
 * `RuntimeUsage.tokensIn` means FRESH (non-cached) input tokens, matching the Claude
 * SDK adapter's `input_tokens` (which Anthropic already reports separately from
 * `cache_read_input_tokens`, see packages/adapter-claude-sdk). Every OpenAI-compatible
 * wire, by contrast, reports `prompt_tokens` as fresh+cached COMBINED — the cache hit
 * is a subset, not additive — so it is subtracted out here, once, at the one boundary
 * every spec funnels through, rather than fixed per spec. Every downstream consumer
 * (the spend ledger, the console's context ring) can then treat `tokensIn +
 * cacheReadTokens` as the true total across every backend without re-deriving this.
 */
export function toRuntimeUsage(
  spec: ProviderSpec,
  usage: WireUsage | undefined,
  model: string,
  table: PriceTable,
): RuntimeUsage {
  if (usage === undefined) return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const { tokensIn: rawTokensIn, tokensOut, cacheReadTokens } = spec.extractUsage(usage);
  const cacheHit = cacheReadTokens ?? 0;
  const freshIn = Math.max(rawTokensIn - cacheHit, 0);
  const price = table[model];
  const costUsd = price === undefined ? 0 : billed(price, freshIn, tokensOut, cacheHit);
  return {
    tokensIn: freshIn,
    tokensOut,
    costUsd,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
  };
}

function billed(price: ModelPrice, freshIn: number, tokensOut: number, cacheHit: number): number {
  const cacheRate = price.cacheInPerMillion ?? price.inPerMillion;
  const perMillion = (tokens: number, rate: number): number => (tokens / 1_000_000) * rate;
  return (
    perMillion(freshIn, price.inPerMillion) +
    perMillion(cacheHit, cacheRate) +
    perMillion(tokensOut, price.outPerMillion)
  );
}
