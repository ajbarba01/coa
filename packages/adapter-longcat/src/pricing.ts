import { z } from 'zod';
import type { RuntimeUsage } from '@coa/spi';
import type { WireUsage } from './wire.js';

/**
 * Cost accounting for a raw API. LongCat returns token usage but no dollar cost, so
 * coa computes it from a price table. LongCat's rates are published, so we ship real
 * defaults for `LongCat-2.0`, still config-overridable via `COA_LONGCAT_PRICES` (JSON,
 * per-million-token). A model with no entry costs 0 (the zero floor). Cache-hit input
 * tokens bill at the cache rate when one is configured.
 */

/** Per-model rates in USD per million tokens. */
export const modelPriceSchema = z.object({
  inPerMillion: z.number().nonnegative(),
  outPerMillion: z.number().nonnegative(),
  cacheInPerMillion: z.number().nonnegative().optional(),
});
export type ModelPrice = z.infer<typeof modelPriceSchema>;

export const priceTableSchema = z.record(z.string(), modelPriceSchema);
export type PriceTable = z.infer<typeof priceTableSchema>;

export const PRICES_ENV_VAR = 'COA_LONGCAT_PRICES';

/** The published LongCat-2.0 rates coa ships by default; overridable per model via {@link PRICES_ENV_VAR}. */
export const DEFAULT_PRICES: PriceTable = {
  'LongCat-2.0': { inPerMillion: 0.75, outPerMillion: 2.95, cacheInPerMillion: 0.015 },
};

/** Load the price table: the shipped defaults, with the config env var overriding per model. */
export function loadPriceTable(env: Record<string, string | undefined> = process.env): PriceTable {
  const raw = env[PRICES_ENV_VAR];
  if (raw === undefined || raw === '') return { ...DEFAULT_PRICES };
  try {
    return { ...DEFAULT_PRICES, ...priceTableSchema.parse(JSON.parse(raw)) };
  } catch {
    return { ...DEFAULT_PRICES };
  }
}

/**
 * Compute the settled usage for one completion: pass the wire token counts through
 * to neutral {@link RuntimeUsage} and price them. A model absent from the table costs
 * 0. Cached tokens (`prompt_tokens_details.cached_tokens`) use `cacheInPerMillion` when
 * set, otherwise the normal input rate; the rest of the input bills at the input rate.
 */
export function toRuntimeUsage(
  usage: WireUsage | undefined,
  model: string,
  table: PriceTable,
): RuntimeUsage {
  if (usage === undefined) return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const tokensIn = usage.prompt_tokens;
  const tokensOut = usage.completion_tokens;
  const cacheHit = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const price = table[model];
  const costUsd = price === undefined ? 0 : billed(price, tokensIn, tokensOut, cacheHit);
  return {
    tokensIn,
    tokensOut,
    costUsd,
    ...(usage.prompt_tokens_details !== undefined ? { cacheReadTokens: cacheHit } : {}),
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
