import { describe, expect, it } from 'vitest';
import type { SessionAdapterInit } from '@coa/core';
import { createClaudeAdapter, createLongCatAdapter, fetchModels } from './adapter-factory.js';

const init = (over: Partial<SessionAdapterInit> = {}): SessionAdapterInit => ({
  sessionId: 's1',
  sandbox: { allowedTools: [], denyRules: [], permissionMode: 'default', denyRead: [] },
  input: 'go',
  onSettle: () => {},
  ...over,
});

describe('createClaudeAdapter', () => {
  it('constructs a runtime adapter advertising the barebones capability floor', () => {
    const adapter = createClaudeAdapter(init());
    expect(adapter.capabilityProfile().spiVersion).toBeDefined();
    expect(typeof adapter.runLoop).toBe('function');
  });

  it('rejects runLoop before renderNative is wired (the adapter precondition)', async () => {
    const adapter = createClaudeAdapter(init());
    await expect(
      adapter.runLoop({
        role: 'dev',
        scope: 'src',
        worktree: '/wt',
        capabilityFrame: { allow: [], deny: [] },
      }),
    ).rejects.toThrow();
  });
});

describe('fetchModels — deepseek', () => {
  it('throws (rather than silently returning []) when no key resolves from the locator', async () => {
    await expect(
      fetchModels({
        label: 'ds-ambient',
        provider: 'deepseek',
        locator: { type: 'env-var', name: 'COA_TEST_UNSET_DEEPSEEK_KEY_XYZ' },
      }),
    ).rejects.toThrow(/no api key resolved/i);
  });
});

describe('createLongCatAdapter', () => {
  it('constructs a runtime adapter advertising the barebones capability floor', () => {
    const adapter = createLongCatAdapter(
      init({ model: { provider: 'longcat', model: 'LongCat-2.0' } }),
    );
    expect(adapter.capabilityProfile().spiVersion).toBeDefined();
    expect(typeof adapter.runLoop).toBe('function');
  });
});

describe('fetchModels — longcat', () => {
  it('throws (rather than silently returning []) when no key resolves from the locator', async () => {
    await expect(
      fetchModels({
        label: 'lc-ambient',
        provider: 'longcat',
        locator: { type: 'env-var', name: 'COA_TEST_UNSET_LONGCAT_KEY_XYZ' },
      }),
    ).rejects.toThrow(/no api key resolved/i);
  });
});
