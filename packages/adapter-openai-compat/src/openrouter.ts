import type { ProviderSpec } from './provider-spec.js';

/**
 * OpenRouter as a provider spec — one key in front of many vendors' models,
 * served over an OpenAI-compatible surface.
 *
 * Reasoning: OpenRouter normalizes reasoning across vendors under one request
 * field (`reasoning: {...}`). coa maps `off` → `{enabled: false}`, an effort →
 * the graded `effort` (`low`/`medium`/`high`, with `xhigh`/`max` clamped to
 * `high`), and a budget → `max_tokens` (OpenRouter's token-budget form). Which
 * models expose the ladder is the operator's call via the effort-caps env var —
 * the routed catalog is too large and too mixed to ship a claim per model.
 *
 * Usage: OpenAI-style; the cache split is the standard NESTED shape
 * (`prompt_tokens_details.cached_tokens`) where the routed vendor reports one.
 *
 * Pricing: per-model rates vary by routed vendor and change without notice, so
 * nothing is shipped — the zero floor applies until the operator configures the
 * models they use via the prices env var.
 */
export const openrouterSpec: ProviderSpec = {
  id: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  // OpenRouter's own model-routing sentinel — valid on every account.
  defaultModel: 'openrouter/auto',
  apiKeyEnvVar: 'OPENROUTER_API_KEY',
  pricesEnvVar: 'COA_OPENROUTER_PRICES',
  defaultPrices: {},
  effortEnvVar: 'COA_OPENROUTER_EFFORT',
  defaultEffortCaps: {},
  thinkingToggle: false,
  reasoningBody: (reasoning) => {
    if (reasoning === undefined) return {};
    if (reasoning.mode === 'off') return { reasoning: { enabled: false } };
    if (reasoning.mode === 'effort') {
      return {
        reasoning: {
          effort:
            reasoning.effort === 'xhigh' || reasoning.effort === 'max' ? 'high' : reasoning.effort,
        },
      };
    }
    return { reasoning: { max_tokens: reasoning.budgetTokens } };
  },
  extractUsage: (usage) => ({
    tokensIn: usage.prompt_tokens,
    tokensOut: usage.completion_tokens,
    ...(usage.prompt_tokens_details !== undefined
      ? { cacheReadTokens: usage.prompt_tokens_details.cached_tokens ?? 0 }
      : {}),
  }),
};
