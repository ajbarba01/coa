import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelMetadataCatalog, modelMetadataCachePath } from './metadata-catalog.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-model-metadata-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** A fetch fake that always fails — the offline path. */
const alwaysFails: typeof fetch = (async () => {
  throw new Error('network unreachable');
}) as unknown as typeof fetch;

describe('ModelMetadataCatalog — offline path', () => {
  it('answers from the static floor with zero network calls, before refresh() is ever called', () => {
    const catalog = new ModelMetadataCatalog({ home });
    const sonnet = catalog.get('claude', 'claude-sonnet-5');
    expect(sonnet?.contextWindow).toBe(1_000_000);
    expect(catalog.list('claude').length).toBeGreaterThan(0);
  });

  it('refresh() with every fetch failing/timing out resolves without throwing and leaves the static floor intact', async () => {
    const catalog = new ModelMetadataCatalog({ home, fetchImpl: alwaysFails });
    await expect(catalog.refresh()).resolves.toBeUndefined();
    const sonnet = catalog.get('claude', 'claude-sonnet-5');
    expect(sonnet?.contextWindow).toBe(1_000_000);
    expect(sonnet?.source).toBe('static');
  });

  it('an unknown model id is honestly absent, never a fabricated row', () => {
    const catalog = new ModelMetadataCatalog({ home });
    expect(catalog.get('claude', 'no-such-model')).toBeUndefined();
  });
});

describe('ModelMetadataCatalog — merge order', () => {
  function fakeFetch(responses: Record<string, unknown>): typeof fetch {
    return (async (url: string) => {
      for (const [match, body] of Object.entries(responses)) {
        if (url.includes(match)) return { ok: true, json: async () => body } as unknown as Response;
      }
      return { ok: false, status: 404 } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  it('models.dev enriches a field the static floor lacked, without erasing the static label', async () => {
    const fetchImpl = fakeFetch({
      'models.dev': {
        anthropic: {
          models: {
            'claude-sonnet-5': {
              id: 'claude-sonnet-5',
              // no `name` here — must not blank the static displayName
              limit: { context: 1_000_000, output: 999_000 },
            },
          },
        },
      },
      'openrouter.ai': { data: [] },
    });
    const catalog = new ModelMetadataCatalog({ home, fetchImpl });
    await catalog.refresh();
    const sonnet = catalog.get('claude', 'claude-sonnet-5');
    expect(sonnet?.displayName).toBe('Sonnet 5'); // survives from the static tier
    expect(sonnet?.maxOutputTokens).toBe(999_000); // supplied by models.dev
  });

  it('OpenRouter-live overrides models.dev for the same openrouter-namespaced row', async () => {
    const fetchImpl = fakeFetch({
      'models.dev': {
        openrouter: {
          models: {
            'anthropic/claude-sonnet-4.5': {
              id: 'anthropic/claude-sonnet-4.5',
              name: 'stale name from models.dev',
              limit: { context: 500_000 },
            },
          },
        },
      },
      'openrouter.ai': {
        data: [
          {
            id: 'anthropic/claude-sonnet-4.5',
            name: 'fresh name from the live endpoint',
            context_length: 1_000_000,
          },
        ],
      },
    });
    const catalog = new ModelMetadataCatalog({ home, fetchImpl });
    await catalog.refresh();
    const row = catalog.get('openrouter', 'anthropic/claude-sonnet-4.5');
    expect(row?.displayName).toBe('fresh name from the live endpoint');
    expect(row?.contextWindow).toBe(1_000_000);
  });

  it('a failed models.dev fetch alongside a successful OpenRouter fetch still applies the OpenRouter data', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes('models.dev')) throw new Error('timeout');
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'openai/gpt-5', context_length: 400_000 }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const catalog = new ModelMetadataCatalog({ home, fetchImpl });
    await catalog.refresh();
    expect(catalog.get('openrouter', 'openai/gpt-5')?.contextWindow).toBe(400_000);
    // the static floor for claude is still there — the models.dev failure changed nothing about it
    expect(catalog.get('claude', 'claude-sonnet-5')?.contextWindow).toBe(1_000_000);
  });
});

describe('ModelMetadataCatalog — disk cache', () => {
  it('persists a successful refresh so a freshly-constructed catalog over the same home is warm without a fetch', async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({ data: [{ id: 'openai/gpt-5', context_length: 400_000 }] }),
      }) as unknown as Response) as unknown as typeof fetch;
    const first = new ModelMetadataCatalog({ home, fetchImpl });
    await first.refresh({ modelsDev: false });
    expect(readFileSync(modelMetadataCachePath(home), 'utf8')).toContain('openai/gpt-5');

    const second = new ModelMetadataCatalog({ home, fetchImpl: alwaysFails });
    expect(second.get('openrouter', 'openai/gpt-5')?.contextWindow).toBe(400_000);
  });

  it('a corrupt cache file is dropped, not thrown — the constructor still succeeds off the static floor', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    const path = modelMetadataCachePath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ not valid json');
    expect(() => new ModelMetadataCatalog({ home })).not.toThrow();
    const catalog = new ModelMetadataCatalog({ home });
    expect(catalog.get('claude', 'claude-sonnet-5')).toBeDefined();
  });
});
