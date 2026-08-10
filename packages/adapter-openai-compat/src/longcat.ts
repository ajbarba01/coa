import type { ProviderSpec } from './provider-spec.js';

/**
 * LongCat as a provider spec.
 *
 * Reasoning: a thinking on/off toggle (`thinking: {type}`), not a graded
 * `reasoning_effort`. coa maps `off` → disabled, any effort → enabled, and sends
 * nothing when reasoning is absent (the model default) — so `LongCat-2.0` ships no
 * effort ladder and instead exposes the binary toggle in the console.
 *
 * Usage: cache-hit tokens follow the OpenAI-standard nested shape
 * (`prompt_tokens_details.cached_tokens`), confirmed by the live smoke.
 *
 * Endpoints: the model list lives at its own URL rather than being derived from the
 * chat base (verified against the live API — the docs' `/v1/models` 404s), kept as
 * an explicit spec field so a future path divergence is a one-line change.
 */
export const longcatSpec: ProviderSpec = {
  id: 'longcat',
  baseUrl: 'https://api.longcat.chat/openai/v1',
  defaultModel: 'LongCat-2.0',
  modelsUrl: 'https://api.longcat.chat/openai/v1/models',
  apiKeyEnvVar: 'LONGCAT_API_KEY',
  pricesEnvVar: 'COA_LONGCAT_PRICES',
  defaultPrices: {
    'LongCat-2.0': { inPerMillion: 0.75, outPerMillion: 2.95, cacheInPerMillion: 0.015 },
  },
  effortEnvVar: 'COA_LONGCAT_EFFORT',
  defaultEffortCaps: {},
  thinkingToggle: true,
  reasoningBody: (reasoning) => {
    if (reasoning === undefined) return {};
    if (reasoning.mode === 'off') return { thinking: { type: 'disabled' } };
    if (reasoning.mode === 'effort') return { thinking: { type: 'enabled' } };
    return {};
  },
  extractUsage: (usage) => ({
    tokensIn: usage.prompt_tokens,
    tokensOut: usage.completion_tokens,
    ...(usage.prompt_tokens_details !== undefined
      ? { cacheReadTokens: usage.prompt_tokens_details.cached_tokens ?? 0 }
      : {}),
  }),
};
