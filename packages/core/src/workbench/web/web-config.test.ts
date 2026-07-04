import { afterEach, describe, expect, it, vi } from 'vitest';
import { webConfigSchema, buildWebToolDeps } from './web-config.js';
import type { CooldownStore } from './routing.js';

afterEach(() => vi.unstubAllGlobals());

const noopStore: CooldownStore = {
  isCoolingDown: () => false,
  markCooldown: () => {},
  clear: () => {},
};

describe('webConfigSchema', () => {
  it('drops unknown fields and parses an empty config', () => {
    const cfg = webConfigSchema.parse({ extra: 1 });
    expect('extra' in cfg).toBe(false);
    expect(cfg.search).toBeUndefined();
    expect(cfg.fetch).toBeUndefined();
  });

  it('parses a search block with a provider union and default quotaCooldown', () => {
    const cfg = webConfigSchema.parse({
      search: { providers: [{ kind: 'tavily', credentials: [{ type: 'env-var', name: 'TAVILY_KEY_1' }] }] },
    });
    expect(cfg.search?.providers[0]?.kind).toBe('tavily');
    expect(cfg.search?.quotaCooldown).toBe('next-midnight');
  });
});

describe('buildWebToolDeps', () => {
  it('always returns deps with callable search and fetch chains', () => {
    const cfg = webConfigSchema.parse({});
    const deps = buildWebToolDeps(cfg, {}, { store: noopStore, now: () => 0 });
    expect(typeof deps.searchChain).toBe('function');
    expect(typeof deps.fetchChain).toBe('function');
    expect(deps.summarizer).toBeUndefined();
  });

  it('an empty search chain resolves to exhausted (WebSearch returns empty)', async () => {
    const cfg = webConfigSchema.parse({});
    const deps = buildWebToolDeps(cfg, {}, { store: noopStore, now: () => 0 });
    expect(await deps.searchChain({ query: 'q' })).toMatchObject({ status: 'exhausted' });
  });

  it('routes a Tavily search key and marks its credential-blind cooldown id on quota', async () => {
    const marks: Array<{ id: string; until: number }> = [];
    const store: CooldownStore = { isCoolingDown: () => false, markCooldown: (id, until) => marks.push({ id, until }), clear: () => {} };
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 432, headers: { get: () => null }, json: async () => ({}), text: async () => '' }));
    const cfg = webConfigSchema.parse({
      search: { providers: [{ kind: 'tavily', credentials: [{ type: 'env-var', name: 'TAVILY_KEY_1' }] }] },
    });
    const deps = buildWebToolDeps(cfg, { TAVILY_KEY_1: 'tvly-secret' }, { store, now: () => 0 });
    const res = await deps.searchChain({ query: 'q' });
    expect(res.status).toBe('exhausted');
    expect(marks[0]?.id).toBe('tavily:TAVILY_KEY_1');
  });

  it('free-floor plain-fetches when no provider keys resolve', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => '<p>hi</p>',
      json: async () => ({}),
    }));
    const cfg = webConfigSchema.parse({ fetch: { providers: [], freeFloor: true } });
    const deps = buildWebToolDeps(cfg, {}, { store: noopStore, now: () => 0 });
    const res = await deps.fetchChain('https://x.test');
    expect(res).toMatchObject({ status: 'ok', clean: false });
  });

  it('marks a credential-blind cooldown id when a Firecrawl key rate-limits', async () => {
    const marks: Array<{ id: string; until: number }> = [];
    const store: CooldownStore = {
      isCoolingDown: () => false,
      markCooldown: (id, until) => marks.push({ id, until }),
      clear: () => {},
    };
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
    }));
    const cfg = webConfigSchema.parse({
      fetch: {
        providers: [{ kind: 'firecrawl', credentials: [{ type: 'env-var', name: 'FIRECRAWL_KEY_1' }] }],
        freeFloor: false,
      },
    });
    const deps = buildWebToolDeps(cfg, { FIRECRAWL_KEY_1: 'fc-secret' }, { store, now: () => 0 });
    const res = await deps.fetchChain('https://x.test');
    expect(res.status).toBe('exhausted');
    expect(marks[0]?.id).toBe('firecrawl:FIRECRAWL_KEY_1');
  });

  it('routes a Tavily fetch key and marks its credential-blind cooldown id on quota', async () => {
    const marks: Array<{ id: string; until: number }> = [];
    const store: CooldownStore = { isCoolingDown: () => false, markCooldown: (id, until) => marks.push({ id, until }), clear: () => {} };
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 432,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
    }));
    const cfg = webConfigSchema.parse({
      fetch: { providers: [{ kind: 'tavily', credentials: [{ type: 'env-var', name: 'TAVILY_KEY_1' }] }], freeFloor: false },
    });
    const deps = buildWebToolDeps(cfg, { TAVILY_KEY_1: 'tvly-secret' }, { store, now: () => 0 });
    const res = await deps.fetchChain('https://x.test');
    expect(res.status).toBe('exhausted');
    expect(marks[0]?.id).toBe('tavily:TAVILY_KEY_1');
  });

  it('includes the injected summarizer when provided', () => {
    const summarizer = { summarize: async () => 'summary' };
    const deps = buildWebToolDeps(webConfigSchema.parse({}), {}, { summarizer, store: noopStore, now: () => 0 });
    expect(deps.summarizer).toBe(summarizer);
  });
});
