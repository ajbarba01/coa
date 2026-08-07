import { describe, expect, it } from 'vitest';
import { webConfigSchema } from '@coa/core';
import { buildFetchSummarizer } from './fetch-summarizer.js';

const recordCost = (): void => {};

describe('buildFetchSummarizer', () => {
  it('returns undefined when web.fetch.summarizer is absent', () => {
    const web = webConfigSchema.parse({});
    expect(buildFetchSummarizer(web, recordCost)).toBeUndefined();
  });

  it('returns undefined when the summarizer credential does not resolve', () => {
    const prior = process.env.UNSET_SUMMARIZER_KEY;
    delete process.env.UNSET_SUMMARIZER_KEY;
    try {
      const web = webConfigSchema.parse({
        fetch: {
          summarizer: {
            provider: 'deepseek',
            model: 'deepseek-chat',
            credential: { type: 'env-var', name: 'UNSET_SUMMARIZER_KEY' },
          },
        },
      });
      expect(buildFetchSummarizer(web, recordCost)).toBeUndefined();
    } finally {
      if (prior !== undefined) process.env.UNSET_SUMMARIZER_KEY = prior;
    }
  });

  it('returns a Summarizer when the credential resolves', () => {
    const prior = process.env.SET_SUMMARIZER_KEY;
    process.env.SET_SUMMARIZER_KEY = 'ds-secret';
    try {
      const web = webConfigSchema.parse({
        fetch: {
          summarizer: {
            provider: 'deepseek',
            model: 'deepseek-chat',
            credential: { type: 'env-var', name: 'SET_SUMMARIZER_KEY' },
          },
        },
      });
      const summarizer = buildFetchSummarizer(web, recordCost);
      expect(summarizer).toBeDefined();
      expect(typeof summarizer?.summarize).toBe('function');
    } finally {
      if (prior === undefined) delete process.env.SET_SUMMARIZER_KEY;
      else process.env.SET_SUMMARIZER_KEY = prior;
    }
  });
});
