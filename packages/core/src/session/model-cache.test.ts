import type { ModelDescriptor } from '@coa/shared';
import { describe, expect, it, vi } from 'vitest';
import { ModelCache } from './model-cache.js';

const MODELS: ModelDescriptor[] = [
  { id: 'claude-opus-4-8', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-4-5', supportedEffortLevels: ['low', 'medium'] },
];

describe('ModelCache — account-keyed model capability cache', () => {
  it('fetches on first use and serves the cached list thereafter', async () => {
    const fetch = vi.fn().mockResolvedValue(MODELS);
    const cache = new ModelCache({ fetch });

    expect(await cache.list({ label: 'work' })).toEqual(MODELS);
    expect(await cache.list({ label: 'work' })).toEqual(MODELS);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keys by account label — a different account fetches its own list', async () => {
    const fetch = vi.fn(async (a: { label: string }) => [{ id: `${a.label}-model` }]);
    const cache = new ModelCache({ fetch });

    expect(await cache.list({ label: 'work' })).toEqual([{ id: 'work-model' }]);
    expect(await cache.list({ label: 'personal' })).toEqual([{ id: 'personal-model' }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent fetches for the same account into one call', async () => {
    const fetch = vi.fn().mockResolvedValue(MODELS);
    const cache = new ModelCache({ fetch });

    const [a, b] = await Promise.all([
      cache.list({ label: 'work' }),
      cache.list({ label: 'work' }),
    ]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed fetch — a later call retries', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(MODELS);
    const cache = new ModelCache({ fetch });

    await expect(cache.list({ label: 'work' })).rejects.toThrow('offline');
    expect(await cache.list({ label: 'work' })).toEqual(MODELS);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('invalidate drops the cached entry so the next call refetches', async () => {
    const fetch = vi.fn().mockResolvedValue(MODELS);
    const cache = new ModelCache({ fetch });

    await cache.list({ label: 'work' });
    cache.invalidate('work');
    await cache.list({ label: 'work' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('update seeds the cache without a fetch (opportunistic refresh from a session init)', async () => {
    const fetch = vi.fn().mockResolvedValue([]);
    const cache = new ModelCache({ fetch });

    cache.update('work', MODELS);
    expect(await cache.list({ label: 'work' })).toEqual(MODELS);
    expect(fetch).not.toHaveBeenCalled();
  });
});
