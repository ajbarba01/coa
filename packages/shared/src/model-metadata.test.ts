import { describe, expect, it } from 'vitest';
import {
  modelImageInputSupport,
  modelMetadataSchema,
  type ModelMetadata,
} from './model-metadata.js';

describe('modelMetadataSchema', () => {
  it('parses a fully-populated row', () => {
    const parsed = modelMetadataSchema.parse({
      id: 'claude-sonnet-5',
      provider: 'claude',
      displayName: 'Sonnet 5',
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
      pricing: { inputPerMillion: 2, outputPerMillion: 10, cacheReadPerMillion: 0.2 },
      reasoning: true,
      openWeights: false,
      knowledgeCutoff: '2026-01-31',
      source: 'models-dev',
    });
    expect(parsed.contextWindow).toBe(1_000_000);
  });

  it('accepts a bare row (only id + provider known)', () => {
    const parsed = modelMetadataSchema.parse({ id: 'mystery-model', provider: 'openrouter' });
    expect(parsed).toEqual({ id: 'mystery-model', provider: 'openrouter' });
  });
});

describe('modelImageInputSupport', () => {
  it('reports supported when the input modalities include image', () => {
    const metadata: ModelMetadata = {
      id: 'gpt-5',
      provider: 'openai',
      modalities: { input: ['text', 'image'], output: ['text'] },
    };
    expect(modelImageInputSupport(metadata)).toBe('supported');
  });

  it('reports unsupported when modalities are known and image is absent', () => {
    const metadata: ModelMetadata = {
      id: 'deepseek-v4-flash',
      provider: 'deepseek',
      modalities: { input: ['text'], output: ['text'] },
    };
    expect(modelImageInputSupport(metadata)).toBe('unsupported');
  });

  it('reports unknown when metadata is absent', () => {
    expect(modelImageInputSupport(undefined)).toBe('unknown');
  });

  it('reports unknown when metadata is present but modalities were never learned', () => {
    const metadata: ModelMetadata = { id: 'some-model', provider: 'openrouter' };
    expect(modelImageInputSupport(metadata)).toBe('unknown');
  });
});
