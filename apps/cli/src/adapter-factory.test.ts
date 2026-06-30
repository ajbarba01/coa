import { describe, expect, it } from 'vitest';
import type { SessionAdapterInit } from '@coa/core';
import { createClaudeAdapter } from './adapter-factory.js';

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
