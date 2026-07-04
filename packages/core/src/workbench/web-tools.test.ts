import { describe, expect, it } from 'vitest';
import {
  webSearch,
  type SearchProvider,
  webFetch,
  type FetchLike,
  WEB_TOOL_CATALOGUE,
  webToolSpecs,
} from './web-tools.js';

const okProvider = (hits: { title: string; url: string; snippet: string }[]): SearchProvider => ({
  search: async () => hits,
});

const okFetch = (body: string, contentType = 'text/html'): FetchLike =>
  async () => ({ ok: true, status: 200, contentType, body });

describe('webSearch', () => {
  it('returns provider hits wrapped as a distilled handle', async () => {
    const provider = okProvider([{ title: 'T', url: 'https://x.test', snippet: 'S' }]);
    const res = await webSearch({ query: 'find x' }, { search: provider });
    expect(res.result).toEqual({ results: [{ title: 'T', url: 'https://x.test', snippet: 'S' }] });
    expect(res.pointer).toBe('find x');
  });

  it('SC-1: a provider throw degrades to an empty result with a reason (never throws)', async () => {
    const provider: SearchProvider = { search: async () => { throw new Error('boom'); } };
    const res = await webSearch({ query: 'q' }, { search: provider });
    expect(res.result.results).toEqual([]);
    expect('reason' in res.result && res.result.reason).toBeTruthy();
  });
});

describe('webFetch', () => {
  const md = (html: string) => html.replace(/<[^>]+>/g, '').trim();

  it('summarizes via the Summarizer when one is configured', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'what is x?' },
      { fetch: okFetch('<p>hello</p>'), htmlToMarkdown: md, summarizer: { summarize: async () => 'SUMMARY' } },
    );
    expect(res.result).toMatchObject({ fetched: true, content: 'SUMMARY', summarized: true });
  });

  it('D85: degrades to raw markdown when no summarizer is configured', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      { fetch: okFetch('<p>hello</p>'), htmlToMarkdown: md },
    );
    expect(res.result).toMatchObject({ fetched: true, content: 'hello', summarized: false });
  });

  it('truncates raw markdown to maxChars', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      { fetch: okFetch('<p>abcdef</p>'), htmlToMarkdown: md, maxChars: 3 },
    );
    expect((res.result as { content: string }).content).toBe('abc');
  });

  it('caps the markdown fed to the summarizer at maxChars', async () => {
    let seen = '';
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      {
        fetch: okFetch('<p>abcdef</p>'),
        htmlToMarkdown: (h) => h.replace(/<[^>]+>/g, '').trim(),
        summarizer: { summarize: async ({ markdown }) => { seen = markdown; return 'S'; } },
        maxChars: 3,
      },
    );
    expect(seen).toBe('abc');
    expect(res.result).toMatchObject({ fetched: true, summarized: true });
  });

  it('SC-1: a non-HTML content type returns an unapplied result', async () => {
    const res = await webFetch(
      { url: 'https://x.test/data.bin', prompt: 'p' },
      { fetch: okFetch('binary', 'application/octet-stream'), htmlToMarkdown: md },
    );
    expect(res.result).toMatchObject({ fetched: false });
  });

  it('SC-1: a fetch throw returns an unapplied result (never throws)', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      { fetch: async () => { throw new Error('dns'); }, htmlToMarkdown: md },
    );
    expect(res.result).toMatchObject({ fetched: false });
  });
});

describe('web tool registration', () => {
  it('catalogues WebSearch and WebFetch as kernel egress tools', () => {
    expect(WEB_TOOL_CATALOGUE.map((e) => e.name)).toEqual(['WebSearch', 'WebFetch']);
    expect(WEB_TOOL_CATALOGUE.every((e) => e.group === 'egress')).toBe(true);
  });

  it('dispatches WebSearch through its spec into web deps', async () => {
    const specs = webToolSpecs();
    const deps = { web: { search: { search: async () => [{ title: 'T', url: 'u', snippet: 's' }] } } };
    const res = specs.WebSearch?.dispatch({ query: 'q' }, deps as never);
    await expect(Promise.resolve(res as never)).resolves.toMatchObject({ pointer: 'q' });
  });

  it('dispatches WebFetch through its spec into web deps', async () => {
    const specs = webToolSpecs();
    const deps = {
      web: {
        fetch: async () => ({ ok: true, status: 200, contentType: 'text/html', body: '<p>hi</p>' }),
        htmlToMarkdown: (h: string) => h.replace(/<[^>]+>/g, '').trim(),
      },
    };
    const res = specs.WebFetch?.dispatch({ url: 'https://x.test', prompt: 'p' }, deps as never);
    await expect(Promise.resolve(res as never)).resolves.toMatchObject({ pointer: 'https://x.test' });
  });
});
