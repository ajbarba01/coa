import type { BackendMessage, CapabilitySet, NeutralConfig } from '@coa/shared';
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

describe('ClaudeSdkAdapter — pure ports', () => {
  it('renderNative delegates to the pure renderer and returns the rendered config', () => {
    expect(adapter().renderNative(neutral()).systemPrompt).toBe('# coa governance layer\n\nBODY');
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
      controller.abort(); // the daemon interrupts after the first message
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
        gen(arg.options)) as unknown as typeof SdkQuery,
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

  it("wires the daemon's delivery drain onto the PostToolUse hook, so pending text rides the next tool result", async () => {
    // The whole mid-loop route in one assertion: an injected drain must survive the
    // option assembly and end up as the hook's `additionalContext`. Without it the
    // session queue fills and nothing ever pulls it — the delivery silently never lands.
    let seen: Parameters<typeof SdkQuery>[0]['options'] | undefined;
    // eslint-disable-next-line require-yield
    const gen = async function* (options: Parameters<typeof SdkQuery>[0]['options']) {
      seen = options;
    };
    const a = adapter({
      drainDeliveries: () => [
        { origin: 'user', text: 'check the schema first' },
        { origin: 'system', text: 'explorer finished' },
      ],
      query: ((arg: Parameters<typeof SdkQuery>[0]) =>
        gen(arg.options)) as unknown as typeof SdkQuery,
    });
    a.renderNative(neutral());
    a.interceptTool(() => ({ behavior: 'allow' }));
    a.interceptStop(() => ({ allow: true }));
    await a.runLoop(session);

    const out = await seen?.hooks?.PostToolUse?.[0]?.hooks[0]?.(
      { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} } as never,
      undefined,
      { signal: new AbortController().signal },
    );
    // Both entries land, each framed for its origin — the person's words are never
    // presented as a platform notice, nor a notice as the person speaking.
    expect(out?.hookSpecificOutput?.additionalContext).toContain(
      '[The user sent this while you were working] check the schema first',
    );
    expect(out?.hookSpecificOutput?.additionalContext).toContain('[coa notice] explorer finished');
  });
});

describe('runLoop — the SDK budget stop is not a coa block', () => {
  /** A `query` that yields nothing and throws out of iteration, like the SDK's budget stop does. */
  const throwingQuery = (message: string) =>
    (() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error(message);
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

  it('propagates a budget-shaped throw unchanged — coa holds no ceiling to dress it as a deny', async () => {
    const a = wired({ query: throwingQuery('Reached maximum budget ($0.02)') });
    await expect(a.runLoop(session)).rejects.toThrow('Reached maximum budget');
  });

  it('merges raw sdkOptions over the assembled query options (the live-suite money guard)', async () => {
    let seen: { maxBudgetUsd?: number; cwd?: string } | undefined;
    async function* empty(): AsyncGenerator<unknown> {
      // no messages — only the received options matter here
    }
    const a = wired({
      sdkOptions: { maxBudgetUsd: 0.25 },
      query: ((arg: { options: { maxBudgetUsd?: number; cwd?: string } }) => {
        seen = arg.options;
        return empty();
      }) as unknown as typeof SdkQuery,
    });
    await a.runLoop(session);
    expect(seen?.maxBudgetUsd).toBe(0.25);
    // The worktree cwd is the adapter's own and always wins over the passthrough.
    expect(seen?.cwd).toBe('/wt');
  });
});
