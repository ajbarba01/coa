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
  it('drops unknown fields and defaults the provider to parallel', () => {
    const cfg = webConfigSchema.parse({ credential: { type: 'env-var', name: 'PARALLEL_API_KEY' }, extra: 1 });
    expect(cfg.provider).toBe('parallel');
    expect('extra' in cfg).toBe(false);
  });

  it('validates a fetch-only config (no search credential required)', () => {
    const cfg = webConfigSchema.parse({
      fetch: { providers: [{ kind: 'firecrawl', credentials: [{ type: 'env-var', name: 'FIRECRAWL_KEY_1' }] }] },
    });
    expect(cfg.credential).toBeUndefined();
    expect(cfg.fetch?.freeFloor).toBe(true); // default
    expect(cfg.fetch?.quotaCooldown).toBe('next-midnight'); // default
  });
});

describe('buildWebToolDeps', () => {
  it('always returns deps with a callable fetch chain (the free floor guarantees it)', () => {
    const cfg = webConfigSchema.parse({});
    const deps = buildWebToolDeps(cfg, {}, { store: noopStore, now: () => 0 });
    expect(typeof deps.fetchChain).toBe('function');
    expect(deps.search).toBeDefined();
    expect(deps.summarizer).toBeUndefined();
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

  it('builds a real search provider when a parallel key resolves, else an inert one', () => {
    const withKey = buildWebToolDeps(
      webConfigSchema.parse({ provider: 'parallel', credential: { type: 'env-var', name: 'PARALLEL_API_KEY' } }),
      { PARALLEL_API_KEY: 'sk-123' },
      { store: noopStore, now: () => 0 },
    );
    expect(withKey.search).toBeDefined();
    const noKey = buildWebToolDeps(webConfigSchema.parse({}), {}, { store: noopStore, now: () => 0 });
    expect(noKey.search).toBeDefined(); // inert null-search, still present
  });

  it('includes the injected summarizer when provided', () => {
    const summarizer = { summarize: async () => 'summary' };
    const deps = buildWebToolDeps(webConfigSchema.parse({}), {}, { summarizer, store: noopStore, now: () => 0 });
    expect(deps.summarizer).toBe(summarizer);
  });
});
