import type { ProviderSpec } from './provider-spec.js';

/**
 * DeepSeek as a provider spec — a cheap **test** backend, not a fidelity reference.
 *
 * Reasoning (per the official V4 docs): `reasoning_effort` accepts only `high` and
 * `max` (thinking on); non-thinking is requested with `thinking: { type: 'disabled' }`.
 * Thinking-high is the V4 default, so an absent selection sends neither field. coa
 * maps `off` → thinking disabled; an effort → `high`, except `xhigh`/`max` → `max`
 * (DeepSeek's only two effort rungs); `budget`/absent → the default (nothing sent).
 *
 * Usage: the prompt-cache split arrives FLAT (`prompt_cache_hit_tokens`), not the
 * OpenAI-standard nested `prompt_tokens_details` shape.
 *
 * Pricing: DeepSeek publishes its rates, so the zero floor is not the honest
 * default — shipping the published V4 rates means the spend ledger sees real
 * cost without the operator configuring anything.
 */
export const deepseekSpec: ProviderSpec = {
  id: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  // `deepseek-chat` is universally available today and routes to v4-flash; it retires
  // 2026-07-24, after which pick a v4 model explicitly (the console lists live models).
  defaultModel: 'deepseek-chat',
  apiKeyEnvVar: 'DEEPSEEK_API_KEY',
  pricesEnvVar: 'COA_DEEPSEEK_PRICES',
  defaultPrices: {
    'deepseek-v4-flash': { inPerMillion: 0.14, outPerMillion: 0.28, cacheInPerMillion: 0.0028 },
    'deepseek-v4-pro': { inPerMillion: 0.435, outPerMillion: 0.87, cacheInPerMillion: 0.003625 },
  },
  effortEnvVar: 'COA_DEEPSEEK_EFFORT',
  defaultEffortCaps: {
    'deepseek-v4-pro': ['high', 'max'],
    'deepseek-v4-flash': ['high', 'max'],
  },
  thinkingToggle: false,
  reasoningBody: (reasoning) => {
    if (reasoning === undefined) return {};
    if (reasoning.mode === 'off') return { thinking: { type: 'disabled' } };
    if (reasoning.mode === 'effort') {
      return {
        reasoning_effort:
          reasoning.effort === 'xhigh' || reasoning.effort === 'max' ? 'max' : 'high',
      };
    }
    return {};
  },
  extractUsage: (usage) => ({
    tokensIn: usage.prompt_tokens,
    tokensOut: usage.completion_tokens,
    ...(usage.prompt_cache_hit_tokens !== undefined
      ? { cacheReadTokens: usage.prompt_cache_hit_tokens }
      : {}),
  }),
};
