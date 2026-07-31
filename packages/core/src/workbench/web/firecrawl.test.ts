import { describe, expect, it } from 'vitest';
import { makeFirecrawlFetch, makeFirecrawlSearch } from './firecrawl.js';

/** A fake `fetch` returning a Response-like shape (cast to satisfy `typeof fetch`). */
function fakeFetch(res: {
  ok?: boolean;
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
}): typeof fetch {
  const headers = res.headers ?? {};
  return (async () => ({
    ok: res.ok ?? (res.status >= 200 && res.status < 300),
    status: res.status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => res.json ?? {},
    text: async () => JSON.stringify(res.json ?? {}),
  })) as unknown as typeof fetch;
}

describe('makeFirecrawlFetch', () => {
  it('maps a 200 with data.markdown to an ok, clean outcome', async () => {
    const provider = makeFirecrawlFetch({
      apiKey: 'fc-secret',
      fetchImpl: fakeFetch({ status: 200, json: { success: true, data: { markdown: '# Hi' } } }),
    });
    const outcome = await provider.fetch('https://x.test');
    expect(outcome).toEqual({ status: 'ok', value: '# Hi', clean: true });
  });

  it('sends the scrape request to /v2/scrape with a Bearer key and markdown format', async () => {
    let capturedUrl = '';
    let capturedInit: { method?: string; headers?: Record<string, string>; body?: string } = {};
    const fetchImpl = (async (url: string, init: typeof capturedInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ success: true, data: { markdown: 'md' } }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;
    await makeFirecrawlFetch({ apiKey: 'fc-secret', fetchImpl }).fetch('https://x.test');
    expect(capturedUrl).toBe('https://api.firecrawl.dev/v2/scrape');
    expect(capturedInit.method).toBe('POST');
    expect(capturedInit.headers?.authorization).toBe('Bearer fc-secret');
    expect(JSON.parse(capturedInit.body!)).toEqual({
      url: 'https://x.test',
      formats: ['markdown'],
    });
  });

  it('maps 429 to a rate-limit, reading Retry-After seconds into retryAfterMs', async () => {
    const provider = makeFirecrawlFetch({
      apiKey: 'k',
      fetchImpl: fakeFetch({ status: 429, headers: { 'retry-after': '30' } }),
    });
    expect(await provider.fetch('https://x.test')).toEqual({
      status: 'limit',
      kind: 'rate-limit',
      retryAfterMs: 30_000,
    });
  });

  it('maps 429 with no Retry-After to a rate-limit with no retryAfterMs (ambiguous)', async () => {
    const provider = makeFirecrawlFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 429 }) });
    expect(await provider.fetch('https://x.test')).toEqual({ status: 'limit', kind: 'rate-limit' });
  });

  it('maps 402 to a quota limit', async () => {
    const provider = makeFirecrawlFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 402 }) });
    expect(await provider.fetch('https://x.test')).toEqual({ status: 'limit', kind: 'quota' });
  });

  it('maps another non-ok status to an error', async () => {
    const provider = makeFirecrawlFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 500 }) });
    expect(await provider.fetch('https://x.test')).toEqual({
      status: 'error',
      reason: 'firecrawl-http-500',
    });
  });

  it('maps a malformed/empty body to an error', async () => {
    const provider = makeFirecrawlFetch({
      apiKey: 'k',
      fetchImpl: fakeFetch({ status: 200, json: { success: true, data: {} } }),
    });
    expect(await provider.fetch('https://x.test')).toMatchObject({ status: 'error' });
  });

  it('SC-1: a fetch throw becomes an error outcome, never a throw', async () => {
    const fetchImpl = (async () => {
      throw new Error('dns');
    }) as unknown as typeof fetch;
    const outcome = await makeFirecrawlFetch({ apiKey: 'k', fetchImpl }).fetch('https://x.test');
    expect(outcome).toMatchObject({ status: 'error' });
  });
});

describe('makeFirecrawlSearch', () => {
  it('maps data.web[] to neutral SearchHits (description → snippet)', async () => {
    const provider = makeFirecrawlSearch({
      apiKey: 'k',
      fetchImpl: fakeFetch({
        status: 200,
        json: {
          success: true,
          data: { web: [{ title: 'T', url: 'https://x.test', description: 'desc' }] },
        },
      }),
    });
    expect(await provider.search({ query: 'q' })).toEqual({
      status: 'ok',
      clean: true,
      value: [{ title: 'T', url: 'https://x.test', snippet: 'desc' }],
    });
  });

  it('POSTs to /v2/search with a web source', async () => {
    let url = '';
    let init: { body?: string } = {};
    const fetchImpl = (async (u: string, i: typeof init) => {
      url = u;
      init = i;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ success: true, data: { web: [] } }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;
    await makeFirecrawlSearch({ apiKey: 'k', fetchImpl }).search({ query: 'hello', maxResults: 4 });
    expect(url).toBe('https://api.firecrawl.dev/v2/search');
    expect(JSON.parse(init.body!)).toMatchObject({
      query: 'hello',
      limit: 4,
      sources: [{ type: 'web' }],
    });
  });

  it('maps 429→rate-limit and 402→quota', async () => {
    expect(
      await makeFirecrawlSearch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 429 }) }).search({
        query: 'q',
      }),
    ).toEqual({ status: 'limit', kind: 'rate-limit' });
    expect(
      await makeFirecrawlSearch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 402 }) }).search({
        query: 'q',
      }),
    ).toEqual({ status: 'limit', kind: 'quota' });
  });

  it('SC-1: a throw becomes an error outcome', async () => {
    const fetchImpl = (async () => {
      throw new Error('dns');
    }) as unknown as typeof fetch;
    expect(
      await makeFirecrawlSearch({ apiKey: 'k', fetchImpl }).search({ query: 'q' }),
    ).toMatchObject({ status: 'error' });
  });
});
