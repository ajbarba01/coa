import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fetchOpenRouterCatalog, parseOpenRouterCatalog } from './metadata-openrouter.js';

/**
 * Reuses `adapter-openai-compat`'s checked-in slice of the real
 * `GET https://openrouter.ai/api/v1/models` response (verified live 2026-08-09) — a
 * relative read across the package boundary, not an import, so this module still
 * carries no dependency on that package (core does not depend on any adapter package).
 */
const fixture: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../adapter-openai-compat/src/openrouter-models.fixture.json', import.meta.url),
    ),
    'utf8',
  ),
);

describe('parseOpenRouterCatalog', () => {
  it('maps every row into the openrouter provider namespace, converting per-token USD to per-million', () => {
    const rows = parseOpenRouterCatalog(fixture);
    expect(rows.map((r) => r.id)).toEqual([
      'openai/gpt-5',
      'anthropic/claude-sonnet-4.5',
      'deepseek/deepseek-chat-v3.1',
    ]);
    expect(rows.every((r) => r.provider === 'openrouter')).toBe(true);
    const sonnet = rows.find((r) => r.id === 'anthropic/claude-sonnet-4.5');
    expect(sonnet).toMatchObject({
      displayName: 'Anthropic: Claude Sonnet 4.5',
      contextWindow: 1_000_000,
      maxOutputTokens: 64_000,
      modalities: { input: ['text', 'image'], output: ['text'] },
      pricing: { inputPerMillion: 3, outputPerMillion: 15 },
      source: 'openrouter',
    });
  });

  it('a model with no vision in its architecture reports a text-only modality list', () => {
    const rows = parseOpenRouterCatalog(fixture);
    const deepseek = rows.find((r) => r.id === 'deepseek/deepseek-chat-v3.1');
    expect(deepseek?.modalities).toEqual({ input: ['text'], output: ['text'] });
  });

  it('never throws on a malformed payload', () => {
    expect(parseOpenRouterCatalog({ data: 'not an array' })).toEqual([]);
    expect(parseOpenRouterCatalog(null)).toEqual([]);
  });
});

describe('fetchOpenRouterCatalog', () => {
  it('fetches and parses on a 200', async () => {
    const rows = await fetchOpenRouterCatalog({
      fetchImpl: (async () =>
        ({ ok: true, json: async () => fixture }) as unknown as Response) as typeof fetch,
    });
    expect(rows).toHaveLength(3);
  });

  it('resolves to undefined on a non-OK response', async () => {
    const rows = await fetchOpenRouterCatalog({
      fetchImpl: (async () => ({ ok: false, status: 500 }) as unknown as Response) as typeof fetch,
    });
    expect(rows).toBeUndefined();
  });

  it('resolves to undefined on a network throw — never throws itself', async () => {
    const rows = await fetchOpenRouterCatalog({
      fetchImpl: (async () => {
        throw new Error('timeout');
      }) as typeof fetch,
    });
    expect(rows).toBeUndefined();
  });

  it('resolves to undefined (not []) when a 200 response parses to zero rows — OpenRouter is never genuinely empty', async () => {
    const rows = await fetchOpenRouterCatalog({
      fetchImpl: (async () =>
        ({ ok: true, json: async () => ({ data: [] }) }) as unknown as Response) as typeof fetch,
    });
    expect(rows).toBeUndefined();
  });
});
