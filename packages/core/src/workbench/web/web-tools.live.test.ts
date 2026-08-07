import { describe, expect, it } from 'vitest';
import { makeParallelSearch } from './parallel.js';
import { makeFirecrawlFetch, makeFirecrawlSearch } from './firecrawl.js';
import { makeTavilySearch, makeTavilyFetch } from './tavily.js';

/**
 * Live network smokes against the real web providers. Gated like every other
 * `*.live.test.ts`: `COA_LIVE` unset ⇒ every describe is skipped, so a plain
 * `pnpm test` stays off the network; each provider additionally needs its own
 * key var to run.
 *
 *   COA_LIVE=1 pnpm vitest run packages/core/src/workbench/web/web-tools.live.test.ts
 */
const live = process.env.COA_LIVE === '1';
const hasKey = live && !!process.env.PARALLEL_API_KEY;
const hasFirecrawl = live && !!process.env.FIRECRAWL_KEY_1;
const hasTavily = live && !!process.env.TAVILY_KEY_1;

describe.skipIf(!hasKey)('web tools live smoke', () => {
  it('WebSearch returns real hits from Parallel', async () => {
    const provider = makeParallelSearch({ apiKey: process.env.PARALLEL_API_KEY! });
    const outcome = await provider.search({ query: 'anthropic claude api pricing', maxResults: 3 });
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.value.length).toBeGreaterThan(0);
      expect(outcome.value[0]!.url).toMatch(/^https?:\/\//);
    }
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

describe.skipIf(!hasTavily)('tavily live smoke', () => {
  it('WebSearch returns real hits from Tavily', async () => {
    const outcome = await makeTavilySearch({ apiKey: process.env.TAVILY_KEY_1! }).search({
      query: 'anthropic claude api pricing',
      maxResults: 3,
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.value.length).toBeGreaterThan(0);
      expect(outcome.value[0]!.url).toMatch(/^https?:\/\//);
    }
  }, 20_000);

  it('WebFetch extracts clean markdown from Tavily', async () => {
    const outcome = await makeTavilyFetch({ apiKey: process.env.TAVILY_KEY_1! }).fetch(
      'https://example.com',
    );
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.value.length).toBeGreaterThan(0);
  }, 30_000);
});

describe.skipIf(!hasFirecrawl)('firecrawl search live smoke', () => {
  it('WebSearch returns real hits from Firecrawl', async () => {
    const outcome = await makeFirecrawlSearch({ apiKey: process.env.FIRECRAWL_KEY_1! }).search({
      query: 'anthropic claude api pricing',
      maxResults: 3,
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.value.length).toBeGreaterThan(0);
  }, 20_000);
});
