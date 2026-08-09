import { describe, expect, it } from 'vitest';
import type { ModelMetadata } from '@coa/shared';
import { mergeModelMetadata } from './metadata-merge.js';

const staticLayer: ModelMetadata[] = [
  {
    id: 'claude-sonnet-5',
    provider: 'claude',
    displayName: 'Sonnet 5 (static)',
    contextWindow: 1_000_000,
    pricing: { inputPerMillion: 2, outputPerMillion: 10 },
    source: 'static',
  },
];

describe('mergeModelMetadata', () => {
  it('a single layer passes through unchanged', () => {
    expect(mergeModelMetadata(staticLayer)).toEqual(staticLayer);
  });

  it('a later layer overrides only the fields it carries', () => {
    const modelsDevLayer: ModelMetadata[] = [
      { id: 'claude-sonnet-5', provider: 'claude', maxOutputTokens: 128_000, source: 'models-dev' },
    ];
    const [merged] = mergeModelMetadata(staticLayer, modelsDevLayer);
    expect(merged).toMatchObject({
      id: 'claude-sonnet-5',
      provider: 'claude',
      // untouched by the models-dev layer, so the static value survives
      displayName: 'Sonnet 5 (static)',
      contextWindow: 1_000_000,
      // supplied by the models-dev layer
      maxOutputTokens: 128_000,
      // provenance reflects the last layer that actually wrote an opinion
      source: 'models-dev',
    });
  });

  it('pricing merges per sub-field rather than replacing wholesale', () => {
    const openrouterLayer: ModelMetadata[] = [
      {
        id: 'claude-sonnet-5',
        provider: 'claude',
        pricing: { inputPerMillion: 3 }, // no outputPerMillion opinion
        source: 'openrouter',
      },
    ];
    const [merged] = mergeModelMetadata(staticLayer, openrouterLayer);
    expect(merged?.pricing).toEqual({ inputPerMillion: 3, outputPerMillion: 10 });
  });

  it('rows for different providers never collide even with the same raw id', () => {
    const claudeRow: ModelMetadata = {
      id: 'shared-id',
      provider: 'claude',
      displayName: 'claude version',
    };
    const openrouterRow: ModelMetadata = {
      id: 'shared-id',
      provider: 'openrouter',
      displayName: 'openrouter version',
    };
    const merged = mergeModelMetadata([claudeRow], [openrouterRow]);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.provider === 'claude')?.displayName).toBe('claude version');
    expect(merged.find((m) => m.provider === 'openrouter')?.displayName).toBe('openrouter version');
  });

  it('a model unknown to a later layer is left exactly as the earlier layer had it', () => {
    const openrouterLayer: ModelMetadata[] = [
      { id: 'openai/gpt-5', provider: 'openrouter', contextWindow: 400_000, source: 'openrouter' },
    ];
    const merged = mergeModelMetadata(staticLayer, openrouterLayer);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.id === 'claude-sonnet-5')).toEqual(staticLayer[0]);
  });

  it('is empty when every layer is empty', () => {
    expect(mergeModelMetadata([], [], [])).toEqual([]);
  });
});
