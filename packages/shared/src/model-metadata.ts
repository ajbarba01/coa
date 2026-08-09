import { z } from 'zod';

/**
 * The per-model info catalog's neutral shape — coa's cross-provider mirror of "what
 * this model actually is": context window, pricing, modalities, reasoning support.
 * Distinct from {@link ModelDescriptor} (config.ts), which carries the
 * reasoning-EFFORT UI capabilities (`supportsEffort`/`supportedEffortLevels`/…) coa
 * curates per backend; this schema carries the richer info the context ring, the
 * model-picker hover card, and attachment capability-gating need. Populated by the
 * merge chain in `@coa/core`'s model-metadata catalog (static fallback < models.dev
 * < OpenRouter-live); every field is optional because a source may simply not know
 * it — absent renders as absent in the UI, never a guessed value.
 */

/** Per-model rates in USD per million tokens — the same unit models.dev and coa's
 *  existing `ModelPrice` (adapter-openai-compat) both use, so the numbers read
 *  consistently wherever they surface. */
export const modelPricingSchema = z.object({
  inputPerMillion: z.number().nonnegative().optional(),
  outputPerMillion: z.number().nonnegative().optional(),
  cacheReadPerMillion: z.number().nonnegative().optional(),
  cacheWritePerMillion: z.number().nonnegative().optional(),
});
export type ModelPricing = z.infer<typeof modelPricingSchema>;

/** The modality lists a model's own architecture reports — `image` in `input` is
 *  the one this catalog's vision-capability predicate keys on. */
export const modelModalitiesSchema = z.object({
  input: z.array(z.string()),
  output: z.array(z.string()),
});
export type ModelModalities = z.infer<typeof modelModalitiesSchema>;

/** Which merge tier last supplied an opinion on a metadata row — informational
 *  only (e.g. a "verified via OpenRouter" hint in the hover card), never branched on. */
export const modelMetadataSourceSchema = z.enum(['static', 'models-dev', 'openrouter']);
export type ModelMetadataSource = z.infer<typeof modelMetadataSourceSchema>;

export const modelMetadataSchema = z.object({
  id: z.string(),
  /** The coa provider id this row is filed under (`claude`/`deepseek`/`longcat`/`openai`/`openrouter`) — distinct namespace per provider, so `openrouter:anthropic/claude-sonnet-4.5` and `claude:claude-sonnet-5` are two rows even though they name the same underlying model. */
  provider: z.string(),
  displayName: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  modalities: modelModalitiesSchema.optional(),
  pricing: modelPricingSchema.optional(),
  /** The model exposes some form of extended reasoning (effort ladder, thinking toggle, or budget) — a coarse yes/no; the exact controls it exposes are `ModelDescriptor`'s job. */
  reasoning: z.boolean().optional(),
  openWeights: z.boolean().optional(),
  /** The model's training-data cutoff, as the source reports it (e.g. `"2026-01-31"`) — free-form, never parsed. */
  knowledgeCutoff: z.string().optional(),
  source: modelMetadataSourceSchema.optional(),
});
export type ModelMetadata = z.infer<typeof modelMetadataSchema>;

/**
 * A tri-state capability answer: `'unknown'` is a distinct, honest outcome from
 * `'unsupported'` — a model this catalog has no metadata for must never render as
 * confidently non-vision (the attach control's job is to tell those two apart:
 * disabled-with-reason vs. disabled-because-we-can't-tell).
 */
export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';

/** Does this model accept image input? Pure — reads only the modality list, never
 *  fetches. `undefined`/no `modalities` ⇒ `'unknown'` (this catalog has no opinion),
 *  never a false `'unsupported'`. */
export function modelImageInputSupport(metadata: ModelMetadata | undefined): CapabilitySupport {
  if (metadata?.modalities === undefined) return 'unknown';
  return metadata.modalities.input.includes('image') ? 'supported' : 'unsupported';
}
