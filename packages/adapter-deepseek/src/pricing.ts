import { z } from 'zod';
import type { RuntimeUsage } from '@coa/spi';
import type { WireUsage } from './wire.js';

/**
 * Cost accounting for a raw API (dual-backend spec C4). DeepSeek returns token
 * usage but no dollar cost, so coa computes it from a price table. The table is
 * **config-overridable with a zero floor** (the maintainer's call): rates come
 * from the `COA_DEEPSEEK_PRICES` env var (JSON, per-million-token), and a model
 * with no configured entry costs 0 — so the cap never guesses, and DeepSeek stays
 * free-to-track until the operator sets real rates. Cache-hit input tokens bill at
 * the (cheaper) cache rate when one is configured.
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

export const PRICES_ENV_VAR = 'COA_DEEPSEEK_PRICES';

/** The published V4 rates coa ships by default; overridable per model via {@link PRICES_ENV_VAR}. */
export const DEFAULT_PRICES: PriceTable = {
  'deepseek-v4-flash': { inPerMillion: 0.14, outPerMillion: 0.28, cacheInPerMillion: 0.0028 },
  'deepseek-v4-pro': { inPerMillion: 0.435, outPerMillion: 0.87, cacheInPerMillion: 0.003625 },
};

/** Load the config-overridable price table; a missing/malformed var ⇒ the shipped rates. */
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
 * to neutral {@link RuntimeUsage} and price them. A model absent from the table
 * costs 0 (the zero floor). Cache-hit tokens use `cacheInPerMillion` when set,
 * otherwise the normal input rate; the rest of the input bills at the input rate.
 */
export function toRuntimeUsage(
  usage: WireUsage | undefined,
  model: string,
  table: PriceTable,
): RuntimeUsage {
  if (usage === undefined) return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const tokensIn = usage.prompt_tokens;
  const tokensOut = usage.completion_tokens;
  const cacheHit = usage.prompt_cache_hit_tokens ?? 0;
  const price = table[model];
  const costUsd = price === undefined ? 0 : billed(price, tokensIn, tokensOut, cacheHit);
  return {
    tokensIn,
    tokensOut,
    costUsd,
    ...(usage.prompt_cache_hit_tokens !== undefined ? { cacheReadTokens: cacheHit } : {}),
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
