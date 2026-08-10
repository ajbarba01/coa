import { describe, expect, it } from 'vitest';
import { webConfigSchema } from '@coa/core';
import { buildWebTools } from './web-tools.js';

const recordCost = (): void => {};

/** A fetch chain whose summarizer is a DeepSeek key held in the named env var. */
function configWithSummarizer(envVar: string) {
  return webConfigSchema.parse({
    fetch: {
      summarizer: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        credential: { type: 'env-var', name: envVar },
      },
    },
  });
}

describe('buildWebTools', () => {
  it('assembles callable chains from a config with no providers at all', () => {
    const deps = buildWebTools(webConfigSchema.parse({}), recordCost);
    expect(typeof deps.searchChain).toBe('function');
    expect(typeof deps.fetchChain).toBe('function');
    expect(deps.summarizer).toBeUndefined();
  });

  it('degrades to the raw-markdown floor when the summarizer credential does not resolve', () => {
    const prior = process.env.UNSET_WEB_TOOLS_KEY;
    delete process.env.UNSET_WEB_TOOLS_KEY;
    try {
      const deps = buildWebTools(configWithSummarizer('UNSET_WEB_TOOLS_KEY'), recordCost);
      // No summarizer is a degradation, never an error: the chains still exist, so
      // WebFetch is still offered and simply returns unsummarized markdown.
      expect(deps.summarizer).toBeUndefined();
      expect(typeof deps.fetchChain).toBe('function');
    } finally {
      if (prior !== undefined) process.env.UNSET_WEB_TOOLS_KEY = prior;
    }
  });

  it('wires the summarizer into the deps when its credential resolves', () => {
    const prior = process.env.SET_WEB_TOOLS_KEY;
    process.env.SET_WEB_TOOLS_KEY = 'ds-secret';
    try {
      const deps = buildWebTools(configWithSummarizer('SET_WEB_TOOLS_KEY'), recordCost);
      expect(typeof deps.summarizer?.summarize).toBe('function');
    } finally {
      if (prior === undefined) delete process.env.SET_WEB_TOOLS_KEY;
      else process.env.SET_WEB_TOOLS_KEY = prior;
    }
  });
});
