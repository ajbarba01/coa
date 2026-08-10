import type { ModelMetadata } from '@coa/shared';

/**
 * The baked-in metadata floor — bundled with the app, works with zero network. Covers
 * exactly the ids `default-catalog.ts` ships (coa's curated "these work" set); an id a
 * user adds by hand simply has no static row (absent, not fabricated) until the
 * live sources (models.dev / OpenRouter) enrich it.
 *
 * Numbers are sourced from the providers' own published specs (Anthropic's model docs
 * and pricing page; the OpenAI/DeepSeek/LongCat rows cross-checked against a live
 * models.dev fetch) — last verified 2026-08-09. Re-verify when a provider republishes
 * pricing or a context/output limit changes; a stale row here is a data fix, not a
 * rearchitecture (same posture as `default-catalog.ts`'s `last-verified`).
 */
export const STATIC_MODEL_METADATA: ModelMetadata[] = [
  // --- claude ---
  {
    id: 'claude-fable-5',
    provider: 'claude',
    displayName: 'Fable 5',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    pricing: {
      inputPerMillion: 10,
      outputPerMillion: 50,
      cacheReadPerMillion: 1,
      cacheWritePerMillion: 12.5,
    },
    reasoning: true,
    openWeights: false,
    source: 'static',
  },
  {
    id: 'claude-opus-4-8',
    provider: 'claude',
    displayName: 'Opus 4.8',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    pricing: {
      inputPerMillion: 5,
      outputPerMillion: 25,
      cacheReadPerMillion: 0.5,
      cacheWritePerMillion: 6.25,
    },
    reasoning: true,
    openWeights: false,
    knowledgeCutoff: '2026-01',
    source: 'static',
  },
  {
    id: 'claude-sonnet-5',
    provider: 'claude',
    displayName: 'Sonnet 5',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    pricing: {
      inputPerMillion: 2,
      outputPerMillion: 10,
      cacheReadPerMillion: 0.2,
      cacheWritePerMillion: 2.5,
    },
    reasoning: true,
    openWeights: false,
    knowledgeCutoff: '2026-01-31',
    source: 'static',
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'claude',
    displayName: 'Haiku 4.5',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    pricing: {
      inputPerMillion: 1,
      outputPerMillion: 5,
      cacheReadPerMillion: 0.1,
      cacheWritePerMillion: 1.25,
    },
    reasoning: true,
    openWeights: false,
    knowledgeCutoff: '2025-02-28',
    source: 'static',
  },
  {
    id: 'claude-opus-4-7',
    provider: 'claude',
    displayName: 'Opus 4.7',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    pricing: {
      inputPerMillion: 5,
      outputPerMillion: 25,
      cacheReadPerMillion: 0.5,
      cacheWritePerMillion: 6.25,
    },
    reasoning: true,
    openWeights: false,
    knowledgeCutoff: '2026-01-31',
    source: 'static',
  },
  {
    id: 'claude-sonnet-4-6',
    provider: 'claude',
    displayName: 'Sonnet 4.6',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheReadPerMillion: 0.3,
      cacheWritePerMillion: 3.75,
    },
    reasoning: true,
    openWeights: false,
    knowledgeCutoff: '2025-08-31',
    source: 'static',
  },
  // Older ids the current models.dev listing has rolled off; kept alive here (the
  // floor's whole point) from Anthropic's long-published, stable spec sheet.
  {
    id: 'claude-opus-4-1',
    provider: 'claude',
    displayName: 'Opus 4.1',
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    pricing: {
      inputPerMillion: 15,
      outputPerMillion: 75,
      cacheReadPerMillion: 1.5,
      cacheWritePerMillion: 18.75,
    },
    reasoning: true,
    openWeights: false,
    source: 'static',
  },
  {
    id: 'claude-sonnet-4-0',
    provider: 'claude',
    displayName: 'Sonnet 4',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheReadPerMillion: 0.3,
      cacheWritePerMillion: 3.75,
    },
    reasoning: true,
    openWeights: false,
    source: 'static',
  },

  // --- deepseek ---
  {
    id: 'deepseek-v4-flash',
    provider: 'deepseek',
    displayName: 'DeepSeek V4 Flash',
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    modalities: { input: ['text'], output: ['text'] },
    pricing: { inputPerMillion: 0.14, outputPerMillion: 0.28, cacheReadPerMillion: 0.0028 },
    reasoning: true,
    openWeights: true,
    knowledgeCutoff: '2025-05',
    source: 'static',
  },
  {
    id: 'deepseek-v4-pro',
    provider: 'deepseek',
    displayName: 'DeepSeek V4 Pro',
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    modalities: { input: ['text'], output: ['text'] },
    pricing: { inputPerMillion: 0.435, outputPerMillion: 0.87, cacheReadPerMillion: 0.003625 },
    reasoning: true,
    openWeights: true,
    knowledgeCutoff: '2025-05',
    source: 'static',
  },

  // --- longcat ---
  {
    id: 'LongCat-2.0',
    provider: 'longcat',
    displayName: 'LongCat 2.0',
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
    modalities: { input: ['text'], output: ['text'] },
    pricing: { inputPerMillion: 0.75, outputPerMillion: 2.95, cacheReadPerMillion: 0.015 },
    reasoning: true,
    openWeights: false,
    source: 'static',
  },

  // --- openai ---
  {
    id: 'gpt-5',
    provider: 'openai',
    displayName: 'GPT-5',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    modalities: { input: ['text', 'image'], output: ['text'] },
    pricing: { inputPerMillion: 1.25, outputPerMillion: 10, cacheReadPerMillion: 0.125 },
    reasoning: true,
    openWeights: false,
    knowledgeCutoff: '2024-09-30',
    source: 'static',
  },
  {
    id: 'gpt-5-mini',
    provider: 'openai',
    displayName: 'GPT-5 mini',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    modalities: { input: ['text', 'image'], output: ['text'] },
    pricing: { inputPerMillion: 0.25, outputPerMillion: 2, cacheReadPerMillion: 0.025 },
    reasoning: true,
    openWeights: false,
    source: 'static',
  },
  {
    id: 'gpt-5-nano',
    provider: 'openai',
    displayName: 'GPT-5 nano',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    modalities: { input: ['text', 'image'], output: ['text'] },
    pricing: { inputPerMillion: 0.05, outputPerMillion: 0.4, cacheReadPerMillion: 0.005 },
    reasoning: true,
    openWeights: false,
    source: 'static',
  },
  {
    id: 'o3',
    provider: 'openai',
    displayName: 'o3',
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    pricing: { inputPerMillion: 2, outputPerMillion: 8, cacheReadPerMillion: 0.5 },
    reasoning: true,
    openWeights: false,
    source: 'static',
  },
  {
    id: 'o4-mini',
    provider: 'openai',
    displayName: 'o4-mini',
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    modalities: { input: ['text', 'image'], output: ['text'] },
    pricing: { inputPerMillion: 1.1, outputPerMillion: 4.4, cacheReadPerMillion: 0.275 },
    reasoning: true,
    openWeights: false,
    source: 'static',
  },

  // --- openrouter --- none shipped: the routed catalog is huge, per-vendor, and
  // changes without notice (see default-catalog.ts) — the live /models fetch is the
  // only honest source, so the static floor for this provider is intentionally empty.
];
