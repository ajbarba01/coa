import { describe, expect, it } from 'vitest';
import { makeTavilyFetch, makeTavilySearch } from './tavily.js';

/** A fake `fetch` returning a Response-like shape (cast to satisfy `typeof fetch`). */
function fakeFetch(res: { ok?: boolean; status: number; headers?: Record<string, string>; json?: unknown }): typeof fetch {
  const headers = res.headers ?? {};
  return (async () => ({
    ok: res.ok ?? (res.status >= 200 && res.status < 300),
    status: res.status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => res.json ?? {},
    text: async () => JSON.stringify(res.json ?? {}),
  })) as unknown as typeof fetch;
}

describe('makeTavilyFetch', () => {
  it('maps a 200 with results[].raw_content to an ok, clean outcome', async () => {
    const provider = makeTavilyFetch({
      apiKey: 'tvly-secret',
      fetchImpl: fakeFetch({ status: 200, json: { results: [{ raw_content: '# Page' }] } }),
    });
    expect(await provider.fetch('https://x.test')).toEqual({ status: 'ok', value: '# Page', clean: true });
  });

  it('POSTs to /extract with a Bearer key and markdown format', async () => {
    let url = '';
    let init: { method?: string; headers?: Record<string, string>; body?: string } = {};
    const fetchImpl = (async (u: string, i: typeof init) => {
      url = u;
      init = i;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ results: [{ raw_content: 'md' }] }), text: async () => '' };
    }) as unknown as typeof fetch;
    await makeTavilyFetch({ apiKey: 'tvly-secret', fetchImpl }).fetch('https://x.test');
    expect(url).toBe('https://api.tavily.com/extract');
    expect(init.method).toBe('POST');
    expect(init.headers?.authorization).toBe('Bearer tvly-secret');
    expect(JSON.parse(init.body!)).toEqual({ urls: ['https://x.test'], format: 'markdown' });
  });

  it('maps 429 to rate-limit and 432/433 to quota', async () => {
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 429 }) }).fetch('https://x.test')).toEqual({ status: 'limit', kind: 'rate-limit' });
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 432 }) }).fetch('https://x.test')).toEqual({ status: 'limit', kind: 'quota' });
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 433 }) }).fetch('https://x.test')).toEqual({ status: 'limit', kind: 'quota' });
  });

  it('maps 401 and other non-ok statuses to an error', async () => {
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 401 }) }).fetch('https://x.test')).toMatchObject({ status: 'error' });
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 500 }) }).fetch('https://x.test')).toMatchObject({ status: 'error' });
  });

  it('maps an empty/failed extract to an error', async () => {
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 200, json: { results: [] } }) }).fetch('https://x.test')).toMatchObject({ status: 'error' });
  });

  it('SC-1: a fetch throw becomes an error outcome', async () => {
    const fetchImpl = (async () => { throw new Error('dns'); }) as unknown as typeof fetch;
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl }).fetch('https://x.test')).toMatchObject({ status: 'error' });
  });
});

describe('makeTavilySearch', () => {
  it('maps results[] to neutral SearchHits (content → snippet)', async () => {
    const provider = makeTavilySearch({
      apiKey: 'k',
      fetchImpl: fakeFetch({ status: 200, json: { results: [{ title: 'T', url: 'https://x.test', content: 'snip' }] } }),
    });
    expect(await provider.search({ query: 'q' })).toEqual({
      status: 'ok',
      clean: true,
      value: [{ title: 'T', url: 'https://x.test', snippet: 'snip' }],
    });
  });

  it('POSTs to /search with a Bearer key and the query', async () => {
    let url = '';
    let init: { headers?: Record<string, string>; body?: string } = {};
    const fetchImpl = (async (u: string, i: typeof init) => {
      url = u;
      init = i;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ results: [] }), text: async () => '' };
    }) as unknown as typeof fetch;
    await makeTavilySearch({ apiKey: 'tvly-secret', fetchImpl }).search({ query: 'hello', allowedDomains: ['a.com'], maxResults: 3 });
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.headers?.authorization).toBe('Bearer tvly-secret');
    expect(JSON.parse(init.body!)).toEqual({ query: 'hello', max_results: 3, include_domains: ['a.com'] });
  });

  it('maps 429→rate-limit, 432/433→quota, 401→error', async () => {
    expect(await makeTavilySearch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 429 }) }).search({ query: 'q' })).toEqual({ status: 'limit', kind: 'rate-limit' });
    expect(await makeTavilySearch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 432 }) }).search({ query: 'q' })).toEqual({ status: 'limit', kind: 'quota' });
    expect(await makeTavilySearch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 401 }) }).search({ query: 'q' })).toMatchObject({ status: 'error' });
  });

  it('SC-1: a throw becomes an error outcome', async () => {
    const fetchImpl = (async () => { throw new Error('dns'); }) as unknown as typeof fetch;
    expect(await makeTavilySearch({ apiKey: 'k', fetchImpl }).search({ query: 'q' })).toMatchObject({ status: 'error' });
  });
});
