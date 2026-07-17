import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { modelInfoToDescriptor } from './models.js';

const info = (over: Partial<ModelInfo>): ModelInfo =>
  ({ value: 'm', displayName: 'M', description: '', ...over }) as ModelInfo;

describe('modelInfoToDescriptor — SDK ModelInfo → neutral ModelDescriptor', () => {
  it('carries id/display/description and the per-model effort levels', () => {
    expect(
      modelInfoToDescriptor(
        info({
          value: 'claude-opus-4-8',
          displayName: 'Opus 4.8',
          description: 'deep',
          supportsEffort: true,
          supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
          supportsAdaptiveThinking: true,
        }),
      ),
    ).toEqual({
      id: 'claude-opus-4-8',
      displayName: 'Opus 4.8',
      description: 'deep',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true,
    });
  });

  it('reflects a model with a smaller effort set faithfully (Haiku ≠ Opus)', () => {
    const d = modelInfoToDescriptor(
      info({
        value: 'claude-haiku-4-5',
        supportsEffort: true,
        supportedEffortLevels: ['low', 'medium'],
      }),
    );
    expect(d.supportedEffortLevels).toEqual(['low', 'medium']);
  });

  it('omits effort fields for a model that exposes none', () => {
    const d = modelInfoToDescriptor(info({ value: 'x', supportsEffort: false }));
    expect(d.supportsEffort).toBe(false);
    expect(d.supportedEffortLevels).toBeUndefined();
  });
});
