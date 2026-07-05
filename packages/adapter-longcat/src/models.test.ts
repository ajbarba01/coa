import { describe, expect, it } from 'vitest';
import {
  fetchLongCatModels,
  loadEffortCaps,
  toModelDescriptor,
  DEFAULT_MODELS_URL,
  EFFORT_ENV_VAR,
} from './models.js';
import type { FetchLike } from './complete.js';

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
  it('is empty by default (LongCat-2.0 exposes a thinking toggle, not an effort ladder)', () => {
    expect(loadEffortCaps({})).toEqual({});
    expect(loadEffortCaps({ [EFFORT_ENV_VAR]: 'nope' })).toEqual({});
  });

  it('accepts a config override for a future model', () => {
    expect(loadEffortCaps({ [EFFORT_ENV_VAR]: '{"LongCat-3.0":["high","max"]}' })).toEqual({
      'LongCat-3.0': ['high', 'max'],
    });
  });
});

describe('toModelDescriptor', () => {
  it('has no effort control for LongCat-2.0 (unlisted), and attaches a ladder when configured', () => {
    expect(toModelDescriptor('LongCat-2.0', {})).toEqual({ id: 'LongCat-2.0' });
    expect(toModelDescriptor('LongCat-3.0', { 'LongCat-3.0': ['high'] })).toEqual({
      id: 'LongCat-3.0',
      supportsEffort: true,
      supportedEffortLevels: ['high'],
    });
  });
});

describe('fetchLongCatModels', () => {
  it('lists the account models from the dedicated /v1/models URL', async () => {
    const captured: { url?: string } = {};
    const models = await fetchLongCatModels({
      apiKey: 'sk-1',
      fetchImpl: okModels(['LongCat-2.0'], captured),
    });
    expect(captured.url).toBe(DEFAULT_MODELS_URL);
    expect(models).toEqual([{ id: 'LongCat-2.0' }]);
  });

  it('throws (rather than silently returning []) when the endpoint is not ok', async () => {
    await expect(
      fetchLongCatModels({
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
    const models = await fetchLongCatModels({ apiKey: 'sk-1', fetchImpl: okModels([]) });
    expect(models).toEqual([]);
  });
});
