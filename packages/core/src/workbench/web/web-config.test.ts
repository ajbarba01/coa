import { describe, expect, it } from 'vitest';
import { webConfigSchema, buildWebToolDeps } from './web-config.js';

describe('webConfigSchema', () => {
  it('drops unknown fields and defaults the provider to parallel', () => {
    const cfg = webConfigSchema.parse({
      credential: { type: 'env-var', name: 'PARALLEL_API_KEY' },
      extra: 1,
    });
    expect(cfg.provider).toBe('parallel');
    expect('extra' in cfg).toBe(false);
  });
});

describe('buildWebToolDeps', () => {
  it('returns undefined when the search key does not resolve (tools not offered)', () => {
    const deps = buildWebToolDeps(
      { provider: 'parallel', credential: { type: 'env-var', name: 'MISSING' } },
      {},
    );
    expect(deps).toBeUndefined();
  });

  it('returns undefined for a non-parallel provider (only parallel wired at launch)', () => {
    const deps = buildWebToolDeps(
      { provider: 'exa', credential: { type: 'env-var', name: 'EXA_KEY' } },
      { EXA_KEY: 'sk-exa' },
    );
    expect(deps).toBeUndefined();
  });

  it('returns a WebToolDeps with search/fetch/htmlToMarkdown present when a key is in env', () => {
    const deps = buildWebToolDeps(
      { provider: 'parallel', credential: { type: 'env-var', name: 'PARALLEL_API_KEY' } },
      { PARALLEL_API_KEY: 'sk-123' },
    );
    expect(deps).toBeDefined();
    expect(deps?.search).toBeDefined();
    expect(deps?.fetch).toBeDefined();
    expect(deps?.htmlToMarkdown).toBeDefined();
    expect(deps?.summarizer).toBeUndefined();
    expect(deps?.htmlToMarkdown('<p>hi</p>')).toContain('hi');
  });

  it('includes the injected summarizer when provided', () => {
    const summarizer = { summarize: async () => 'summary' };
    const deps = buildWebToolDeps(
      { provider: 'parallel', credential: { type: 'env-var', name: 'PARALLEL_API_KEY' } },
      { PARALLEL_API_KEY: 'sk-123' },
      { summarizer },
    );
    expect(deps?.summarizer).toBe(summarizer);
  });
});
