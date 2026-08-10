import { describe, expect, it } from 'vitest';
import { modelEntrySchema, modelsFileSchema } from './models-file.js';

describe('modelsFileSchema', () => {
  it('parses a full file and defaults origin to default', () => {
    const parsed = modelsFileSchema.parse({
      version: 1,
      providers: { claude: [{ id: 'claude-fable-5' }] },
    });
    expect(parsed.providers['claude']?.[0]).toEqual({ id: 'claude-fable-5', origin: 'default' });
  });

  it('defaults an empty object to version 1 with no providers', () => {
    expect(modelsFileSchema.parse({})).toEqual({ version: 1, providers: {} });
  });

  it('strips unknown fields on an entry (drop-unknown)', () => {
    const entry = modelEntrySchema.parse({ id: 'x', origin: 'custom', bogus: true });
    expect(entry).toEqual({ id: 'x', origin: 'custom' });
  });

  it('accepts every reasoning profile kind', () => {
    for (const reasoning of [
      { kind: 'inherit' },
      { kind: 'none' },
      { kind: 'effort', max: 'high' },
      { kind: 'thinking' },
      { kind: 'budget', tokens: 8000 },
    ]) {
      expect(modelEntrySchema.parse({ id: 'x', reasoning }).reasoning).toEqual(reasoning);
    }
  });

  it('rejects a budget without a positive integer token count', () => {
    expect(
      modelEntrySchema.safeParse({ id: 'x', reasoning: { kind: 'budget', tokens: 0 } }).success,
    ).toBe(false);
  });
});
