import { describe, expect, it } from 'vitest';
import { makeParallelSearch } from './parallel.js';

const hasKey = !!process.env.PARALLEL_API_KEY;

describe.skipIf(!hasKey)('web tools live smoke', () => {
  it('WebSearch returns real hits from Parallel', async () => {
    const provider = makeParallelSearch({ apiKey: process.env.PARALLEL_API_KEY! });
    const hits = await provider.search({ query: 'anthropic claude api pricing', maxResults: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.url).toMatch(/^https?:\/\//);
  }, 20_000);
});
