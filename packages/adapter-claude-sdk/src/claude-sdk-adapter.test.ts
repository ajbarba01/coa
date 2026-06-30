import type { CapabilitySet, NeutralConfig } from '@coa/shared';
import { capabilityProfileSchema } from '@coa/shared';
import type { CanUseTool, StopPredicate } from '@coa/spi';
import { describe, expect, it } from 'vitest';
import { ClaudeSdkAdapter, type ClaudeSdkAdapterInit } from './claude-sdk-adapter.js';

function neutral(): NeutralConfig {
  return {
    prefixHead: [
      {
        piece: {
          name: 'p',
          description: 'd',
          body: 'BODY',
          axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
        },
        order: 0,
      },
    ],
    systemReminders: [],
    onDemandPullable: [],
    scopePushed: [],
    toolIntents: { allow: [], deny: [] },
  };
}

function adapter(over: Partial<ClaudeSdkAdapterInit> = {}): ClaudeSdkAdapter {
  const sandbox: CapabilitySet = {
    allowedTools: [],
    denyRules: [],
    permissionMode: 'default',
    denyRead: [],
  };
  return new ClaudeSdkAdapter({ sessionId: 's1', sandbox, input: 'hi', ...over });
}

const session = {
  role: 'r',
  scope: 'sc',
  worktree: '/wt',
  capabilityFrame: { allow: [], deny: [] },
};

describe('ClaudeSdkAdapter — pure ports + floor state', () => {
  it('renderNative delegates to the pure renderer and returns the rendered config', () => {
    expect(adapter().renderNative(neutral()).systemPrompt).toBe('BODY');
  });

  it('capabilityProfile reports the barebones baseline (valid M0 profile, refs absent)', () => {
    const profile = adapter().capabilityProfile();
    expect(() => capabilityProfileSchema.parse(profile)).not.toThrow();
    expect(profile.ports['refs']?.present).toBe(false);
  });

  it('refs returns the null-fallback (caller degrades to the M2 floor)', () => {
    expect(adapter().refs({ name: 'foo' })).toBeNull();
  });

  it('runEval rejects rather than returning a vacuous pass (secondary path unwired)', async () => {
    await expect(adapter().runEval({ cases: [] })).rejects.toThrow(/not wired/);
  });
});

describe('ClaudeSdkAdapter — runLoop preconditions', () => {
  const allow: CanUseTool = () => ({ behavior: 'allow' });
  const stop: StopPredicate = () => ({ allow: true });

  it('throws if renderNative was not called before runLoop', async () => {
    const a = adapter();
    a.interceptTool(allow);
    a.interceptStop(stop);
    await expect(a.runLoop(session)).rejects.toThrow(/renderNative/);
  });

  it('throws if the hooks were not wired before runLoop', async () => {
    const a = adapter();
    a.renderNative(neutral());
    await expect(a.runLoop(session)).rejects.toThrow(/interceptTool/);
  });
});
