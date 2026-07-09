import type { BackendMessage, CapabilitySet, NeutralConfig } from '@coa/shared';
import { capabilityProfileSchema } from '@coa/shared';
import type { CanUseTool, StopPredicate } from '@coa/spi';
import type { query as SdkQuery } from '@anthropic-ai/claude-agent-sdk';
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

  it('trims a dangling tool_use from the flushed transcript when the stream drops between the call and its result', async () => {
    const flushed: unknown[] = [];
    async function* boom(): AsyncGenerator<unknown> {
      yield {
        type: 'assistant',
        session_id: 'srv-1',
        message: {
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: 'a.ts' } }],
        },
      };
      throw new Error('stream dropped mid-tool');
    }
    const a = adapter({
      query: (() => boom()) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query,
      onBackendMessages: (m) => flushed.push(...m),
    });
    a.renderNative(neutral());
    a.interceptTool(() => ({ behavior: 'allow' }));
    a.interceptStop(() => ({ allow: true }));

    await expect(a.runLoop(session)).rejects.toThrow('stream dropped mid-tool');
    // The dangling assistant tool_use (no matching tool_result ever arrived) must not
    // survive the flush — a cross-provider replay would otherwise 400 on it.
    expect(flushed.some((m) => (m as { toolCalls?: unknown }).toolCalls !== undefined)).toBe(false);
    // The user turn recorded ahead of the stream is untouched.
    expect(flushed).toContainEqual({ role: 'user', content: 'hi' });
  });

  it('forwards an abort signal to the SDK abortController and flushes on early stop', async () => {
    const controller = new AbortController();
    let seen: AbortController | undefined;
    const flushed: unknown[] = [];
    async function* gen(opts: { abortController?: AbortController }): AsyncGenerator<unknown> {
      seen = opts.abortController;
      yield {
        type: 'assistant',
        session_id: 'srv-1',
        message: { content: [{ type: 'text', text: 'partial work' }] },
      };
      controller.abort(); // M8 interrupts after the first message
      if (opts.abortController?.signal.aborted) return; // the SDK stops when its controller aborts
      yield {
        type: 'result',
        session_id: 'srv-1',
        total_cost_usd: 0,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      };
    }
    const a = adapter({
      signal: controller.signal,
      query: ((arg: { options: { abortController?: AbortController } }) =>
        gen(arg.options)) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query,
      onBackendMessages: (m) => flushed.push(...m),
    });
    a.renderNative(neutral());
    a.interceptTool(() => ({ behavior: 'allow' }));
    a.interceptStop(() => ({ allow: true }));

    await a.runLoop(session);

    expect(seen?.signal.aborted).toBe(true);
    expect(flushed).toContainEqual({ role: 'assistant', content: 'partial work' });
  });

  it('captures each streamed user/steer turn into the canonical transcript (rawInput is empty under streaming input)', async () => {
    async function* turns(): AsyncGenerator<string> {
      yield 'first';
      yield 'also do X';
    }
    const flushed: unknown[] = [];
    async function* streaming(arg: {
      prompt: AsyncIterable<unknown>;
    }): AsyncGenerator<unknown> {
      // Drain the streamed prompt like the real SDK does as it consumes user turns.
      for await (const _message of arg.prompt) {
        // no-op: exercising consumption is what matters here
      }
      yield {
        type: 'assistant',
        session_id: 'srv-1',
        message: { content: [{ type: 'text', text: 'ok' }] },
      };
      yield {
        type: 'result',
        session_id: 'srv-1',
        total_cost_usd: 0,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      };
    }
    const a = adapter({
      input: turns(),
      query: streaming as unknown as typeof SdkQuery,
      onBackendMessages: (m) => flushed.push(...m),
    });
    a.renderNative(neutral());
    a.interceptTool(() => ({ behavior: 'allow' }));
    a.interceptStop(() => ({ allow: true }));

    await a.runLoop(session);

    expect(flushed).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'also do X' },
      { role: 'assistant', content: 'ok' },
    ]);
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

  it('flushes the canonical transcript at EACH turn boundary under streaming input (per-result durability)', async () => {
    const flushes: BackendMessage[][] = [];
    async function* twoTurns(): AsyncGenerator<string> {
      yield 'first';
      yield 'second';
    }
    async function* streaming(arg: { prompt: AsyncIterable<unknown> }): AsyncGenerator<unknown> {
      const it = arg.prompt[Symbol.asyncIterator]();
      await it.next(); // consume 'first' (the tap records it)
      yield { type: 'assistant', session_id: 'srv-1', message: { content: [{ type: 'text', text: 'a1' }] } };
      yield {
        type: 'result',
        session_id: 'srv-1',
        total_cost_usd: 0,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      };
      await it.next(); // consume 'second'
      yield { type: 'assistant', session_id: 'srv-1', message: { content: [{ type: 'text', text: 'a2' }] } };
      yield {
        type: 'result',
        session_id: 'srv-1',
        total_cost_usd: 0,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      };
    }
    const a = adapter({
      input: twoTurns(),
      query: streaming as unknown as typeof SdkQuery,
      onBackendMessages: (m) => flushes.push([...m]),
    });
    a.renderNative(neutral());
    a.interceptTool(() => ({ behavior: 'allow' }));
    a.interceptStop(() => ({ allow: true }));

    await a.runLoop(session);

    // Two flushes — one at each turn's `result` — each carrying the transcript UP TO that
    // turn (a crash after turn 1 keeps turn 1). The clean-exit `finally` net is skipped.
    expect(flushes.length).toBe(2);
    expect(flushes[0]).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'a1' },
    ]);
    expect(flushes[1]).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'a2' },
    ]);
  });

  it('under streaming input, delivers the history preamble on turn 1 while onBackendMessages reports only the raw text (no preamble leak)', async () => {
    const history: BackendMessage[] = [
      { role: 'user', content: 'prior question' },
      { role: 'assistant', content: 'prior answer' },
    ];
    const delivered: string[] = [];
    const flushes: BackendMessage[][] = [];
    async function* oneTurn(): AsyncGenerator<string> {
      yield 'first';
    }
    async function* streaming(arg: {
      prompt: AsyncIterable<{ message: { content: string } }>;
    }): AsyncGenerator<unknown> {
      for await (const msg of arg.prompt) delivered.push(msg.message.content);
      yield { type: 'assistant', session_id: 'srv-1', message: { content: [{ type: 'text', text: 'ok' }] } };
      yield {
        type: 'result',
        session_id: 'srv-1',
        total_cost_usd: 0,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      };
    }
    const a = adapter({
      input: oneTurn(),
      history,
      deliverHistoryAsPreamble: true,
      query: streaming as unknown as typeof SdkQuery,
      onBackendMessages: (m) => flushes.push([...m]),
    });
    a.renderNative(neutral());
    a.interceptTool(() => ({ behavior: 'allow' }));
    a.interceptStop(() => ({ allow: true }));

    await a.runLoop(session);

    // The model DID receive the preamble (composed OUTSIDE the tap) on turn 1's delivery.
    expect(delivered[0]).toContain('<prior_conversation>');
    expect(delivered[0]).toContain('first');
    // But the canonical transcript records only the RAW turn — the preamble is delivery
    // only, never memory (guards a future compose-order regression that would leak it).
    const flushed = flushes.at(-1)!;
    expect(flushed).toContainEqual({ role: 'user', content: 'first' });
    expect(flushed.some((m) => m.role === 'user' && m.content.includes('<prior_conversation>'))).toBe(false);
  });
});
