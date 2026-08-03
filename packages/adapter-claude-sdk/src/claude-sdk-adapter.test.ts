import type { BackendMessage, CapabilitySet, NeutralConfig, TurnFrame } from '@coa/shared';
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

const allow: CanUseTool = () => ({ behavior: 'allow' });
const stop: StopPredicate = () => ({ allow: true });

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

  it('forwards an abort signal to the SDK abortController and stops on early exit', async () => {
    const controller = new AbortController();
    let seen: AbortController | undefined;
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
    });
    a.renderNative(neutral());
    a.interceptTool(() => ({ behavior: 'allow' }));
    a.interceptStop(() => ({ allow: true }));

    await a.runLoop(session);

    expect(seen?.signal.aborted).toBe(true);
  });

  it('under streaming input, delivers the history preamble on turn 1 (no resumable server session to carry it)', async () => {
    const history: BackendMessage[] = [
      { role: 'user', content: 'prior question' },
      { role: 'assistant', content: 'prior answer' },
    ];
    const delivered: string[] = [];
    async function* oneTurn(): AsyncGenerator<string> {
      yield 'first';
    }
    async function* streaming(arg: {
      prompt: AsyncIterable<{ message: { content: string } }>;
    }): AsyncGenerator<unknown> {
      for await (const msg of arg.prompt) delivered.push(msg.message.content);
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
      input: oneTurn(),
      history,
      deliverHistoryAsPreamble: true,
      query: streaming as unknown as typeof SdkQuery,
    });
    a.renderNative(neutral());
    a.interceptTool(() => ({ behavior: 'allow' }));
    a.interceptStop(() => ({ allow: true }));

    await a.runLoop(session);

    // The model DID receive the preamble on turn 1's delivery.
    expect(delivered[0]).toContain('<prior_conversation>');
    expect(delivered[0]).toContain('first');
  });

  it('reports a turn-interrupt handle bound to the SDK query (streaming input only)', async () => {
    const interrupt = vi.fn(async () => {});
    // A query double: an async generator function carrying an `interrupt` method,
    // matching the SDK `Query` shape (AsyncGenerator<SDKMessage> & { interrupt }).
    const makeQuery = () => {
      const gen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 's1' } as never;
        yield {
          type: 'result',
          subtype: 'success',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
          total_cost_usd: 0,
          session_id: 's1',
        } as never;
      })();
      return Object.assign(gen, { interrupt, setPermissionMode: vi.fn() });
    };
    let reported: (() => Promise<void>) | undefined;
    const channel = (async function* () {
      yield 'hi';
    })(); // streaming input
    const a = adapter({
      input: channel,
      query: makeQuery as never,
      onTurnInterrupt: (fn) => {
        reported = fn;
      },
    });
    a.renderNative(neutral());
    a.interceptTool(() => ({ behavior: 'allow' }));
    a.interceptStop(() => ({ allow: true }));
    await a.runLoop(session);
    expect(reported).toBeTypeOf('function');
    await reported!();
    expect(interrupt).toHaveBeenCalledTimes(1);
  });
});

describe('runLoop — the cost cap is a block, not a fault', () => {
  /** A `query` that yields nothing and throws out of iteration, like the SDK's cap does. */
  const throwingQuery = (message: string) =>
    (() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error(message);
        // eslint-disable-next-line no-unreachable
        yield undefined as never;
      },
      interrupt: () => Promise.resolve(),
    })) as unknown as ClaudeSdkAdapterInit['query'];

  const wired = (over: Partial<ClaudeSdkAdapterInit>) => {
    const a = adapter(over);
    a.renderNative(neutral());
    a.interceptTool(allow);
    a.interceptStop(stop);
    return a;
  };

  it('emits a cost-cap deny instead of propagating the budget throw', async () => {
    const frames: TurnFrame[] = [];
    const a = wired({
      maxBudgetUsd: 0.02,
      onTurn: (f) => frames.push(f),
      query: throwingQuery('Reached maximum budget ($0.02)'),
    });

    await expect(a.runLoop(session)).resolves.toBeUndefined();

    expect(frames).toEqual([
      { t: 'deny', denyKind: 'cost-cap', reason: 'Reached maximum budget ($0.02)' },
      { t: 'turn-boundary', role: 'assistant' },
    ]);
  });

  it('rethrows a transient network failure unchanged', async () => {
    // Recognition is narrow on purpose: a missed match must degrade to today's behaviour,
    // never to a swallowed error.
    const a = wired({ maxBudgetUsd: 0.02, query: throwingQuery('fetch failed') });
    await expect(a.runLoop(session)).rejects.toThrow('fetch failed');
  });

  it('rethrows a budget-shaped error when coa set no cap', async () => {
    const a = wired({ query: throwingQuery('Reached maximum budget ($0.02)') });
    await expect(a.runLoop(session)).rejects.toThrow('Reached maximum budget');
  });
});
