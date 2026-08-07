import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fetchOpenAiCompatModels } from './models.js';
import { modelsResponseSchema } from './wire.js';
import { openrouterSpec } from './openrouter.js';
import type { FetchLike } from './complete.js';

/**
 * A checked-in slice of the real `GET /api/v1/models` response shape (three
 * entries, every field the live API serves per entry — id, name, per-token
 * decimal-string pricing, context_length, architecture, and friends). The point:
 * OpenRouter's model rows carry far more than the OpenAI-standard `{id}`, and the
 * wire schema must parse-and-drop that surplus rather than choke on it — a shape
 * regression here would empty the model picker for every OpenRouter account.
 */
const fixture: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('./openrouter-models.fixture.json', import.meta.url)), 'utf8'),
);

describe('openrouter /models parsing', () => {
  it('parses the real response shape, keeping the ids and dropping the extra fields', () => {
    const parsed = modelsResponseSchema.parse(fixture);
    expect(parsed.data.map((m) => m.id)).toEqual([
      'openai/gpt-5',
      'anthropic/claude-sonnet-4.5',
      'deepseek/deepseek-chat-v3.1',
    ]);
    // Zod strips unknown keys: pricing/context_length never leak past the edge.
    expect(parsed.data[0]).toEqual({ id: 'openai/gpt-5' });
  });

  it('lists the fixture models from the derived OpenRouter /models URL', async () => {
    const captured: { url?: string } = {};
    const fetchImpl: FetchLike = async (url) => {
      captured.url = url;
      return { ok: true, status: 200, text: async () => '', json: async () => fixture };
    };
    const models = await fetchOpenAiCompatModels(openrouterSpec, { apiKey: 'sk-or', fetchImpl });
    expect(captured.url).toBe('https://openrouter.ai/api/v1/models');
    // No shipped effort claims: a routed model exposes no reasoning control until
    // the operator configures a ladder for it.
    expect(models).toEqual([
      { id: 'openai/gpt-5' },
      { id: 'anthropic/claude-sonnet-4.5' },
      { id: 'deepseek/deepseek-chat-v3.1' },
    ]);
  });
});
