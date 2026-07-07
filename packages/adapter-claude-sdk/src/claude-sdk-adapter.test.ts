import type { CapabilitySet, NeutralConfig } from '@coa/shared';
import { capabilityProfileSchema } from '@coa/shared';
import type { CanUseTool, StopPredicate } from '@coa/spi';
import { describe, expect, it, vi } from 'vitest';
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
    expect(adapter().renderNative(neutral()).systemPrompt).toBe('# coa governance layer\n\nBODY');
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

  it('flushes the transcript received so far when the SDK stream throws mid-turn', async () => {
    const flushed: unknown[] = [];
    async function* boom(): AsyncGenerator<unknown> {
      yield {
        type: 'assistant',
        session_id: 'srv-1',
        message: { content: [{ type: 'text', text: 'partial work' }] },
      };
      throw new Error('stream dropped');
    }
    const a = adapter({
      query: (() => boom()) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query,
      onBackendMessages: (m) => flushed.push(...m),
    });
    a.renderNative(neutral());
    a.interceptTool(() => ({ behavior: 'allow' }));
    a.interceptStop(() => ({ allow: true }));

    await expect(a.runLoop(session)).rejects.toThrow('stream dropped');
    // The assistant text received before the throw survives in the canonical transcript.
    expect(flushed).toContainEqual({ role: 'assistant', content: 'partial work' });
  });

  it('flushes the transcript exactly once when a clean stream runs to completion (D85)', async () => {
    async function* clean(): AsyncGenerator<unknown> {
      yield {
        type: 'assistant',
        session_id: 'srv-1',
        message: { content: [{ type: 'text', text: 'done' }] },
      };
      yield {
        type: 'result',
        session_id: 'srv-1',
        total_cost_usd: 0,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      };
    }
    const onBackendMessages = vi.fn();
    const a = adapter({
      query: (() => clean()) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query,
      onBackendMessages,
    });
    a.renderNative(neutral());
    a.interceptTool(() => ({ behavior: 'allow' }));
    a.interceptStop(() => ({ allow: true }));

    await a.runLoop(session);

    // A future post-loop flush re-added alongside the `finally` one would double-count here.
    expect(onBackendMessages).toHaveBeenCalledTimes(1);
    expect(onBackendMessages.mock.calls[0]![0]).toContainEqual({ role: 'assistant', content: 'done' });
  });
});
