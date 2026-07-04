import { describe, expect, it } from 'vitest';
import {
  webSearch,
  type SearchProvider,
  webFetch,
  type RoutedFetch,
  WEB_TOOL_CATALOGUE,
  webToolSpecs,
} from './web-tools.js';

const okProvider = (hits: { title: string; url: string; snippet: string }[]): SearchProvider => ({
  search: async () => hits,
});

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
  const okChain = (value: string, clean: boolean): RoutedFetch => async () => ({
    status: 'ok',
    value,
    clean,
  });

  it('summarizes non-clean content when a Summarizer is configured', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'what is x?' },
      { fetchChain: okChain('hello', false), summarizer: { summarize: async () => 'SUMMARY' } },
    );
    expect(res.result).toMatchObject({ fetched: true, content: 'SUMMARY', summarized: true });
  });

  it('returns clean content as-is, SKIPPING the summarizer', async () => {
    let called = false;
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      {
        fetchChain: okChain('# clean markdown', true),
        summarizer: { summarize: async () => { called = true; return 'NOPE'; } },
      },
    );
    expect(called).toBe(false);
    expect(res.result).toMatchObject({ fetched: true, content: '# clean markdown', summarized: false });
  });

  it('D85: degrades to raw markdown when no summarizer is configured', async () => {
    const res = await webFetch({ url: 'https://x.test', prompt: 'p' }, { fetchChain: okChain('hello', false) });
    expect(res.result).toMatchObject({ fetched: true, content: 'hello', summarized: false });
  });

  it('truncates raw markdown to maxChars', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      { fetchChain: okChain('abcdef', false), maxChars: 3 },
    );
    expect((res.result as { content: string }).content).toBe('abc');
  });

  it('caps the markdown fed to the summarizer at maxChars', async () => {
    let seen = '';
    await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      {
        fetchChain: okChain('abcdef', false),
        summarizer: { summarize: async ({ markdown }) => { seen = markdown; return 'S'; } },
        maxChars: 3,
      },
    );
    expect(seen).toBe('abc');
  });

  it('SC-1: an exhausted chain returns an unapplied result carrying the last reason', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      { fetchChain: async () => ({ status: 'exhausted', lastReason: 'dead-url' }) },
    );
    expect(res.result).toMatchObject({ fetched: false, reason: 'dead-url' });
  });

  it('SC-1: a summarizer throw degrades to raw markdown (never throws)', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      { fetchChain: okChain('hello', false), summarizer: { summarize: async () => { throw new Error('x'); } } },
    );
    expect(res.result).toMatchObject({ fetched: true, content: 'hello', summarized: false });
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
        search: { search: async () => [] },
        fetchChain: async () => ({ status: 'ok', value: 'hi', clean: false }),
      },
    };
    const res = specs.WebFetch?.dispatch({ url: 'https://x.test', prompt: 'p' }, deps as never);
    await expect(Promise.resolve(res as never)).resolves.toMatchObject({ pointer: 'https://x.test' });
  });
});
