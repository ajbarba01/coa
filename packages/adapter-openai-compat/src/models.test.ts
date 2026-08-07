import { describe, expect, it } from 'vitest';
import { fetchOpenAiCompatModels, toModelDescriptor } from './models.js';
import { loadEffortCaps } from './provider-spec.js';
import type { FetchLike } from './complete.js';
import { deepseekSpec } from './deepseek.js';
import { longcatSpec } from './longcat.js';

function okModels(ids: string[], captured?: { url?: string }): FetchLike {
  return async (url) => {
    if (captured !== undefined) captured.url = url;
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ data: ids.map((id) => ({ id })) }),
    };
  };
}

describe('loadEffortCaps', () => {
  it('ships the DeepSeek V4 defaults, overriding per model from the config env var', () => {
    // The shipped defaults are present when unset or malformed…
    expect(loadEffortCaps(deepseekSpec, {})).toEqual({
      'deepseek-v4-pro': ['high', 'max'],
      'deepseek-v4-flash': ['high', 'max'],
    });
    expect(loadEffortCaps(deepseekSpec, { COA_DEEPSEEK_EFFORT: 'nope' })['deepseek-v4-pro']).toEqual(
      ['high', 'max'],
    );
    // …and a config entry overrides that model while leaving the other defaults intact.
    const merged = loadEffortCaps(deepseekSpec, {
      COA_DEEPSEEK_EFFORT: '{"deepseek-v4-pro":["max"]}',
    });
    expect(merged['deepseek-v4-pro']).toEqual(['max']);
    expect(merged['deepseek-v4-flash']).toEqual(['high', 'max']);
  });

  it('is empty by default for LongCat (LongCat-2.0 exposes a thinking toggle, not an effort ladder)', () => {
    expect(loadEffortCaps(longcatSpec, {})).toEqual({});
    expect(loadEffortCaps(longcatSpec, { COA_LONGCAT_EFFORT: 'nope' })).toEqual({});
  });

  it('accepts a config override for a future LongCat model', () => {
    expect(loadEffortCaps(longcatSpec, { COA_LONGCAT_EFFORT: '{"LongCat-3.0":["high","max"]}' })).toEqual({
      'LongCat-3.0': ['high', 'max'],
    });
  });
});

describe('toModelDescriptor', () => {
  it('attaches the configured effort ladder, or none for an unlisted DeepSeek model', () => {
    expect(
      toModelDescriptor(deepseekSpec, 'deepseek-reasoner', { 'deepseek-reasoner': ['low', 'high'] }),
    ).toEqual({
      id: 'deepseek-reasoner',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'high'],
    });
    expect(toModelDescriptor(deepseekSpec, 'deepseek-chat', {})).toEqual({ id: 'deepseek-chat' });
  });

  it('marks a laddered LongCat model with effort, and an unladdered one as a thinking toggle', () => {
    // No effort ladder ⇒ LongCat exposes a binary thinking on/off toggle (not "no reasoning").
    expect(toModelDescriptor(longcatSpec, 'LongCat-2.0', {})).toEqual({
      id: 'LongCat-2.0',
      supportsThinking: true,
    });
    expect(toModelDescriptor(longcatSpec, 'LongCat-3.0', { 'LongCat-3.0': ['high'] })).toEqual({
      id: 'LongCat-3.0',
      supportsEffort: true,
      supportedEffortLevels: ['high'],
    });
  });
});

describe('fetchOpenAiCompatModels', () => {
  it('lists the account models with their configured effort ladders, from the derived /models URL', async () => {
    const captured: { url?: string } = {};
    const models = await fetchOpenAiCompatModels(deepseekSpec, {
      apiKey: 'sk-1',
      caps: { 'deepseek-reasoner': ['high'] },
      fetchImpl: okModels(['deepseek-chat', 'deepseek-reasoner'], captured),
    });
    expect(captured.url).toBe('https://api.deepseek.com/models');
    expect(models).toEqual([
      { id: 'deepseek-chat' },
      { id: 'deepseek-reasoner', supportsEffort: true, supportedEffortLevels: ['high'] },
    ]);
  });

  it("lists the LongCat models from the spec's own models URL", async () => {
    const captured: { url?: string } = {};
    const models = await fetchOpenAiCompatModels(longcatSpec, {
      apiKey: 'sk-1',
      fetchImpl: okModels(['LongCat-2.0'], captured),
    });
    expect(captured.url).toBe('https://api.longcat.chat/openai/v1/models');
    expect(models).toEqual([{ id: 'LongCat-2.0', supportsThinking: true }]);
  });

  it('throws (rather than silently returning []) when the endpoint is not ok', async () => {
    await expect(
      fetchOpenAiCompatModels(deepseekSpec, {
        apiKey: 'sk-1',
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          text: async () => '',
          json: async () => ({}),
        }),
      }),
    ).rejects.toThrow(/deepseek \/models failed: HTTP 401/);
  });

  it('returns an empty list for a genuinely-empty but successful response', async () => {
    const models = await fetchOpenAiCompatModels(deepseekSpec, {
      apiKey: 'sk-1',
      fetchImpl: okModels([]),
    });
    expect(models).toEqual([]);
  });
});
