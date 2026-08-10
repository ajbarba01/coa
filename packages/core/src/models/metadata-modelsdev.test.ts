import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fetchModelsDevCatalog, parseModelsDevCatalog } from './metadata-modelsdev.js';

/**
 * A checked-in slice of the real `GET https://models.dev/api.json` response shape
 * (verified live 2026-08-09 against the anthropic/deepseek provider rows) — every
 * field this module reads, plus a `cohere` provider (no coa provider maps to it) to
 * prove the parse drops what it doesn't recognize rather than choking on it.
 */
const fixture: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./metadata-modelsdev.fixture.json', import.meta.url)),
    'utf8',
  ),
);

describe('parseModelsDevCatalog', () => {
  it('maps the anthropic + deepseek rows onto their coa provider ids', () => {
    const rows = parseModelsDevCatalog(fixture);
    expect(rows).toHaveLength(2);
    const sonnet = rows.find((r) => r.id === 'claude-sonnet-4-6');
    expect(sonnet).toMatchObject({
      id: 'claude-sonnet-4-6',
      provider: 'claude',
      displayName: 'Claude Sonnet 4.6',
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
      pricing: {
        inputPerMillion: 3,
        outputPerMillion: 15,
        cacheReadPerMillion: 0.3,
        cacheWritePerMillion: 3.75,
      },
      reasoning: true,
      openWeights: false,
      knowledgeCutoff: '2025-08-31',
      source: 'models-dev',
    });
    const deepseek = rows.find((r) => r.id === 'deepseek-v4-flash');
    expect(deepseek).toMatchObject({
      provider: 'deepseek',
      modalities: { input: ['text'], output: ['text'] },
    });
  });

  it('drops a provider no coa provider id maps to (cohere)', () => {
    const rows = parseModelsDevCatalog(fixture);
    expect(rows.some((r) => r.id === 'command-r-plus')).toBe(false);
  });

  it('never throws on a malformed payload — resolves to no rows', () => {
    expect(parseModelsDevCatalog({ anthropic: 'not an object' })).toEqual([]);
    expect(parseModelsDevCatalog(null)).toEqual([]);
    expect(parseModelsDevCatalog('a string')).toEqual([]);
  });
});

describe('fetchModelsDevCatalog', () => {
  it('fetches and parses on a 200', async () => {
    const rows = await fetchModelsDevCatalog({
      fetchImpl: (async () =>
        ({ ok: true, json: async () => fixture }) as unknown as Response) as typeof fetch,
    });
    expect(rows).toHaveLength(2);
  });

  it('resolves to undefined (not []) on a non-OK response, so a caller can tell a failed fetch from a genuinely-empty catalog', async () => {
    const rows = await fetchModelsDevCatalog({
      fetchImpl: (async () => ({ ok: false, status: 503 }) as unknown as Response) as typeof fetch,
    });
    expect(rows).toBeUndefined();
  });

  it('resolves to undefined on a network throw/timeout — never throws itself', async () => {
    const rows = await fetchModelsDevCatalog({
      fetchImpl: (async () => {
        throw new Error('ECONNRESET');
      }) as typeof fetch,
    });
    expect(rows).toBeUndefined();
  });

  it('resolves to undefined (not []) when a 200 response parses to zero rows — e.g. an error/notice body', async () => {
    const rows = await fetchModelsDevCatalog({
      fetchImpl: (async () =>
        ({
          ok: true,
          json: async () => ({ error: 'rate limited' }),
        }) as unknown as Response) as typeof fetch,
    });
    expect(rows).toBeUndefined();
  });
});
