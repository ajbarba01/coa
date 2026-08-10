import type { ProviderSpec } from './provider-spec.js';

/**
 * OpenAI as a provider spec, over the chat-completions endpoint. The newer
 * Responses API is deliberately NOT used here: this package is one
 * chat-completions code path shared by every spec, and OpenAI still serves its
 * models over chat completions — a Responses adapter is future work, not a spec
 * field.
 *
 * Reasoning: the reasoning models (the o-series and the gpt-5 family) take a
 * graded `reasoning_effort` of `low`/`medium`/`high`. coa's ladder maps 1:1 up to
 * `high` and clamps `xhigh`/`max` down to `high` (OpenAI's top rung). Which models
 * get the ladder lives in the effort-caps table, config-overridable like pricing.
 * There is no universal off switch on chat completions (the o-series rejects one),
 * so `off`/`budget`/absent send nothing — the model's own default.
 *
 * Usage: the OpenAI-standard NESTED cache split (`prompt_tokens_details.cached_tokens`).
 *
 * Pricing: OpenAI publishes its rates, so the shipped table carries them (per
 * million tokens, cache-read included) and the spend ledger sees real cost with
 * no operator configuration.
 */
export const openaiSpec: ProviderSpec = {
  id: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-5',
  apiKeyEnvVar: 'OPENAI_API_KEY',
  pricesEnvVar: 'COA_OPENAI_PRICES',
  defaultPrices: {
    'gpt-5': { inPerMillion: 1.25, outPerMillion: 10, cacheInPerMillion: 0.125 },
    'gpt-5-mini': { inPerMillion: 0.25, outPerMillion: 2, cacheInPerMillion: 0.025 },
    'gpt-5-nano': { inPerMillion: 0.05, outPerMillion: 0.4, cacheInPerMillion: 0.005 },
    o3: { inPerMillion: 2, outPerMillion: 8, cacheInPerMillion: 0.5 },
    'o4-mini': { inPerMillion: 1.1, outPerMillion: 4.4, cacheInPerMillion: 0.275 },
  },
  effortEnvVar: 'COA_OPENAI_EFFORT',
  defaultEffortCaps: {
    'gpt-5': ['low', 'medium', 'high'],
    'gpt-5-mini': ['low', 'medium', 'high'],
    'gpt-5-nano': ['low', 'medium', 'high'],
    o3: ['low', 'medium', 'high'],
    'o4-mini': ['low', 'medium', 'high'],
  },
  thinkingToggle: false,
  reasoningBody: (reasoning) => {
    if (reasoning?.mode === 'effort') {
      return {
        reasoning_effort:
          reasoning.effort === 'xhigh' || reasoning.effort === 'max' ? 'high' : reasoning.effort,
      };
    }
    // `off`/`budget`/absent: chat completions offers no reasoning off switch or
    // token budget, so nothing is sent (the model default).
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
