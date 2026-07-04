import { describe, expect, it } from 'vitest';
import { makeParallelSearch } from './parallel.js';

const fakeFetch = (payload: unknown): typeof fetch =>
  (async () => ({ ok: true, status: 200, json: async () => payload })) as unknown as typeof fetch;

describe('makeParallelSearch', () => {
  it('maps Parallel results to an ok outcome of neutral SearchHits', async () => {
    const provider = makeParallelSearch({
      apiKey: 'k',
      fetchImpl: fakeFetch({ results: [{ title: 'T', url: 'https://x.test', excerpts: ['E1', 'E2'] }] }),
    });
    expect(await provider.search({ query: 'q' })).toEqual({
      status: 'ok',
      clean: true,
      value: [{ title: 'T', url: 'https://x.test', snippet: 'E1\nE2' }],
    });
  });

  it('a non-200 response resolves to an error outcome (the chain falls through)', async () => {
    const provider = makeParallelSearch({
      apiKey: 'k',
      fetchImpl: (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch,
    });
    await expect(provider.search({ query: 'q' })).resolves.toMatchObject({ status: 'error' });
  });
});
