import { describe, expect, it } from 'vitest';
import type { ClaudeReasoning } from '@coa/shared';
import { fetchOpenAiCompatModels } from './models.js';
import { deepseekSpec } from './deepseek.js';
import { longcatSpec } from './longcat.js';
import { openaiSpec } from './openai.js';
import { openrouterSpec } from './openrouter.js';
import type { NormalizedUsage, ProviderSpec } from './provider-spec.js';
import type { WireUsage } from './wire.js';

/**
 * The per-spec differences, side by side as one table per axis — the reasoning
 * request fields, the cache-token wire shape, and the model-list URL. A new spec
 * adds a row per table; a row that drifts from its provider's real wire behavior
 * fails here before it fails live.
 */

const SPECS: Record<string, ProviderSpec> = {
  deepseek: deepseekSpec,
  longcat: longcatSpec,
  openai: openaiSpec,
  openrouter: openrouterSpec,
};

const OFF: ClaudeReasoning = { mode: 'off' };
const HIGH: ClaudeReasoning = { mode: 'effort', effort: 'high' };
const MAX: ClaudeReasoning = { mode: 'effort', effort: 'max' };
const BUDGET: ClaudeReasoning = { mode: 'budget', budgetTokens: 2_000 };

describe('reasoning body per provider', () => {
  const table: Record<string, { off: unknown; high: unknown; max: unknown; budget: unknown }> = {
    // DeepSeek: two graded rungs + a thinking-disable; no budget surface.
    deepseek: {
      off: { thinking: { type: 'disabled' } },
      high: { reasoning_effort: 'high' },
      max: { reasoning_effort: 'max' },
      budget: {},
    },
    // LongCat: a binary thinking toggle; no grades, no budget surface.
    longcat: {
      off: { thinking: { type: 'disabled' } },
      high: { thinking: { type: 'enabled' } },
      max: { thinking: { type: 'enabled' } },
      budget: {},
    },
    // OpenAI: graded reasoning_effort capped at high; no off switch, no budget.
    openai: {
      off: {},
      high: { reasoning_effort: 'high' },
      max: { reasoning_effort: 'high' },
      budget: {},
    },
    // OpenRouter: the normalized reasoning object — enable/effort/budget all real.
    openrouter: {
      off: { reasoning: { enabled: false } },
      high: { reasoning: { effort: 'high' } },
      max: { reasoning: { effort: 'high' } },
      budget: { reasoning: { max_tokens: 2_000 } },
    },
  };

  for (const [id, spec] of Object.entries(SPECS)) {
    it(`${id}: maps off/effort/budget to its real request fields, absent to nothing`, () => {
      expect(spec.reasoningBody(undefined)).toEqual({});
      expect(spec.reasoningBody(OFF)).toEqual(table[id]!.off);
      expect(spec.reasoningBody(HIGH)).toEqual(table[id]!.high);
      expect(spec.reasoningBody(MAX)).toEqual(table[id]!.max);
      expect(spec.reasoningBody(BUDGET)).toEqual(table[id]!.budget);
    });
  }

  it('openai maps the low/medium grades 1:1 (only the over-range rungs clamp)', () => {
    expect(openaiSpec.reasoningBody({ mode: 'effort', effort: 'low' })).toEqual({
      reasoning_effort: 'low',
    });
    expect(openaiSpec.reasoningBody({ mode: 'effort', effort: 'medium' })).toEqual({
      reasoning_effort: 'medium',
    });
    expect(openaiSpec.reasoningBody({ mode: 'effort', effort: 'xhigh' })).toEqual({
      reasoning_effort: 'high',
    });
  });
});

describe('usage extraction per provider', () => {
  const flat: WireUsage = {
    prompt_tokens: 10,
    completion_tokens: 3,
    prompt_cache_hit_tokens: 4,
  };
  const nested: WireUsage = {
    prompt_tokens: 10,
    completion_tokens: 3,
    prompt_tokens_details: { cached_tokens: 4 },
  };
  const bare: WireUsage = { prompt_tokens: 10, completion_tokens: 3 };

  // Which cache-token wire shape each provider really sends: DeepSeek reports the
  // split FLAT; the other three follow the OpenAI-standard NESTED shape.
  const table: Record<string, { own: WireUsage; other: WireUsage }> = {
    deepseek: { own: flat, other: nested },
    longcat: { own: nested, other: flat },
    openai: { own: nested, other: flat },
    openrouter: { own: nested, other: flat },
  };

  for (const [id, spec] of Object.entries(SPECS)) {
    it(`${id}: extracts its own cache shape and ignores the other`, () => {
      const withCache: NormalizedUsage = { tokensIn: 10, tokensOut: 3, cacheReadTokens: 4 };
      expect(spec.extractUsage(table[id]!.own)).toEqual(withCache);
      expect(spec.extractUsage(table[id]!.other)).toEqual({ tokensIn: 10, tokensOut: 3 });
      expect(spec.extractUsage(bare)).toEqual({ tokensIn: 10, tokensOut: 3 });
    });
  }
});

describe('models url resolution', () => {
  // Only LongCat's list endpoint diverges from the derived `{baseUrl}/models`.
  const table: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/models',
    longcat: 'https://api.longcat.chat/openai/v1/models',
    openai: 'https://api.openai.com/v1/models',
    openrouter: 'https://openrouter.ai/api/v1/models',
  };

  for (const [id, spec] of Object.entries(SPECS)) {
    it(`${id}: fetches the model list from its real endpoint`, async () => {
      const captured: { url?: string } = {};
      await fetchOpenAiCompatModels(spec, {
        apiKey: 'sk-test',
        fetchImpl: async (url) => {
          captured.url = url;
          return { ok: true, status: 200, text: async () => '', json: async () => ({ data: [] }) };
        },
      });
      expect(captured.url).toBe(table[id]);
    });
  }
});

describe('credential + config env vars per provider', () => {
  it('each spec names its conventional key var and its own coa config vars', () => {
    expect(openaiSpec.apiKeyEnvVar).toBe('OPENAI_API_KEY');
    expect(openrouterSpec.apiKeyEnvVar).toBe('OPENROUTER_API_KEY');
    const vars = Object.values(SPECS).flatMap((s) => [
      s.apiKeyEnvVar,
      s.pricesEnvVar,
      s.effortEnvVar,
    ]);
    expect(new Set(vars).size).toBe(vars.length);
  });
});
