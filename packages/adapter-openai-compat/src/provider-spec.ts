import { z } from 'zod';
import type { ClaudeReasoning } from '@coa/shared';
import type { WireUsage } from './wire.js';

/**
 * One OpenAI-compatible provider, described as DATA. The package is a single code
 * path (request build, SSE loop, pricing, credentials, model discovery); every
 * per-provider difference that is real on the wire lives here as a spec field, so
 * adding another OpenAI-compatible backend is a new spec object, not a new package.
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

/** `{ "some-model": ["high","max"] }` — per-model supported effort levels (coa's ladder). */
export const effortCapsSchema = z.record(
  z.string(),
  z.array(z.enum(['low', 'medium', 'high', 'xhigh', 'max'])),
);
export type EffortCaps = z.infer<typeof effortCapsSchema>;

/** The provider-neutral token counts pricing consumes, extracted from the wire usage. */
export interface NormalizedUsage {
  tokensIn: number;
  tokensOut: number;
  /** Cache-hit input tokens; absent when the provider reported no cache split. */
  cacheReadTokens?: number;
}

export interface ProviderSpec {
  /** The provider id — the routing key and the error-message prefix. */
  id: string;
  /** The chat host; completions go to `{baseUrl}/chat/completions`. */
  baseUrl: string;
  /** The model used when the session selects none. */
  defaultModel: string;
  /** The model-list endpoint, for when it diverges from the derived `{baseUrl}/models`. */
  modelsUrl?: string;
  /** The env var an account with no explicit credential pointer falls back to. */
  apiKeyEnvVar: string;
  /** The env var holding a JSON per-model price override. */
  pricesEnvVar: string;
  /** The shipped per-model rates (config-overridable; a model with no entry costs 0). */
  defaultPrices: PriceTable;
  /** The env var holding a JSON per-model effort-ladder override. */
  effortEnvVar: string;
  /** The shipped per-model effort ladders. */
  defaultEffortCaps: EffortCaps;
  /** Whether an unladdered model still exposes a binary thinking on/off toggle. */
  thinkingToggle: boolean;
  /**
   * Map coa's faithful reasoning selection to the provider's real request fields
   * (`{}` sends nothing — the provider's own default).
   */
  reasoningBody: (reasoning: ClaudeReasoning | undefined) => Record<string, unknown>;
  /**
   * Extract the neutral token counts from the wire usage — the one place a provider's
   * cache-token shape (flat vs nested) is known.
   */
  extractUsage: (usage: WireUsage) => NormalizedUsage;
}

/** Load the spec's price table: the shipped defaults, with the config env var overriding per model. */
export function loadPriceTable(
  spec: ProviderSpec,
  env: Record<string, string | undefined> = process.env,
): PriceTable {
  return loadJsonTable(env[spec.pricesEnvVar], spec.defaultPrices, priceTableSchema);
}

/** Load the spec's per-model effort ladders: the shipped defaults, with the config env var overriding per model. */
export function loadEffortCaps(
  spec: ProviderSpec,
  env: Record<string, string | undefined> = process.env,
): EffortCaps {
  return loadJsonTable(env[spec.effortEnvVar], spec.defaultEffortCaps, effortCapsSchema);
}

/** Merge a JSON env-var override over the shipped defaults; a missing/malformed var ⇒ the defaults. */
function loadJsonTable<T extends Record<string, unknown>>(
  raw: string | undefined,
  defaults: T,
  schema: { parse: (value: unknown) => T },
): T {
  if (raw === undefined || raw === '') return { ...defaults };
  try {
    return { ...defaults, ...schema.parse(JSON.parse(raw)) };
  } catch {
    return { ...defaults };
  }
}
