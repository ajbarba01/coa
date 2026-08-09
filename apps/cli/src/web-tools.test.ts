import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KeyStateStore, webConfigSchema } from '@coa/core';
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

  it("reads the search chain's cooldown state from the injected home, not the ambient one", async () => {
    // Regression for Q11: buildWebTools used to build its KeyStateStore against
    // whatever home buildWebToolDeps defaults to (the real os.homedir()) because the
    // `home` parameter was never forwarded. A daemon started with an injected home
    // (tests today; a per-project daemon later) would then leak cooldown writes into
    // the operator's real home the moment a configured provider was rate-limited.
    const home = mkdtempSync(join(tmpdir(), 'coa-web-tools-home-'));
    const envVar = 'WEB_TOOLS_HOME_TEST_KEY';
    const prior = process.env[envVar];
    process.env[envVar] = 'test-key';
    try {
      // Seed a cooldown through the same KeyStateStore class buildWebToolDeps uses
      // internally, pointed at the injected home -- this is the exact file
      // buildWebTools's store must consult for its keyStateId to be `tavily:${envVar}`
      // (locatorId of an env-var credential is just its var name).
      new KeyStateStore(home).markCooldown(`tavily:${envVar}`, Date.now() + 60_000);

      const config = webConfigSchema.parse({
        search: {
          providers: [{ kind: 'tavily', credentials: [{ type: 'env-var', name: envVar }] }],
        },
      });
      const deps = buildWebTools(config, recordCost, home);
      const result = await deps.searchChain({ query: 'anything' });

      // The sole configured provider is cooling down, so the chain skips it entirely
      // (never attempts a real network call) and reports exhausted -- observable proof
      // that the store buildWebTools built is the one at `home`, not the ambient one.
      expect(result.status).toBe('exhausted');
    } finally {
      if (prior === undefined) delete process.env[envVar];
      else process.env[envVar] = prior;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
