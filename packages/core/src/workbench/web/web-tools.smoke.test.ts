import { describe, expect, it } from 'vitest';
import { makeParallelSearch } from './parallel.js';
import { makeFirecrawlFetch } from './firecrawl.js';

const hasKey = !!process.env.PARALLEL_API_KEY;
const hasFirecrawl = !!process.env.FIRECRAWL_KEY_1;

describe.skipIf(!hasKey)('web tools live smoke', () => {
  it('WebSearch returns real hits from Parallel', async () => {
    const provider = makeParallelSearch({ apiKey: process.env.PARALLEL_API_KEY! });
    const hits = await provider.search({ query: 'anthropic claude api pricing', maxResults: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.url).toMatch(/^https?:\/\//);
  }, 20_000);
});

describe.skipIf(!hasFirecrawl)('firecrawl fetch live smoke', () => {
  it('scrapes a real page to clean markdown', async () => {
    const provider = makeFirecrawlFetch({ apiKey: process.env.FIRECRAWL_KEY_1! });
    const outcome = await provider.fetch('https://example.com');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.clean).toBe(true);
      expect(outcome.value.length).toBeGreaterThan(0);
    }
  }, 30_000);
});
