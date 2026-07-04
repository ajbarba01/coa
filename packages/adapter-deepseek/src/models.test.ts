import { describe, expect, it } from 'vitest';
import {
  fetchDeepSeekModels,
  loadEffortCaps,
  toModelDescriptor,
  EFFORT_ENV_VAR,
} from './models.js';
import type { FetchLike } from './complete.js';

function okModels(ids: string[]): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ data: ids.map((id) => ({ id })) }),
  });
}

describe('loadEffortCaps', () => {
  it('ships the V4 defaults, overriding per model from the config env var', () => {
    // The shipped defaults are present when unset or malformed…
    expect(loadEffortCaps({})).toEqual({
      'deepseek-v4-pro': ['high', 'max'],
      'deepseek-v4-flash': ['high', 'max'],
    });
    expect(loadEffortCaps({ [EFFORT_ENV_VAR]: 'nope' })['deepseek-v4-pro']).toEqual([
      'high',
      'max',
    ]);
    // …and a config entry overrides that model while leaving the other defaults intact.
    const merged = loadEffortCaps({ [EFFORT_ENV_VAR]: '{"deepseek-v4-pro":["max"]}' });
    expect(merged['deepseek-v4-pro']).toEqual(['max']);
    expect(merged['deepseek-v4-flash']).toEqual(['high', 'max']);
  });
});

describe('toModelDescriptor', () => {
  it('attaches the configured effort ladder, or none for an unlisted model', () => {
    expect(
      toModelDescriptor('deepseek-reasoner', { 'deepseek-reasoner': ['low', 'high'] }),
    ).toEqual({
      id: 'deepseek-reasoner',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'high'],
    });
    expect(toModelDescriptor('deepseek-chat', {})).toEqual({ id: 'deepseek-chat' });
  });
});

describe('fetchDeepSeekModels', () => {
  it('lists the account models with their configured effort ladders', async () => {
    const models = await fetchDeepSeekModels({
      apiKey: 'sk-1',
      caps: { 'deepseek-reasoner': ['high'] },
      fetchImpl: okModels(['deepseek-chat', 'deepseek-reasoner']),
    });
    expect(models).toEqual([
      { id: 'deepseek-chat' },
      { id: 'deepseek-reasoner', supportsEffort: true, supportedEffortLevels: ['high'] },
    ]);
  });

  it('throws (rather than silently returning []) when the endpoint is not ok', async () => {
    await expect(
      fetchDeepSeekModels({
        apiKey: 'sk-1',
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          text: async () => '',
          json: async () => ({}),
        }),
      }),
    ).rejects.toThrow(/401/);
  });

  it('returns an empty list for a genuinely-empty but successful response', async () => {
    const models = await fetchDeepSeekModels({
      apiKey: 'sk-1',
      fetchImpl: okModels([]),
    });
    expect(models).toEqual([]);
  });
});
