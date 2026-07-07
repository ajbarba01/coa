import { describe, expect, it, vi } from 'vitest';
import type { TurnFrame } from '@coa/shared';
import type { RegisteredTool, ToolCatalogue } from '@coa/spi';
import type { CompletionResult } from './complete.js';
import type { DriverMessage } from './complete.js';
import {
  runGovernedLoop,
  toToolDefs,
  TOOL_RESULT_CHAR_CAP,
  type GovernedLoopDeps,
} from './driver.js';

const USAGE = { tokensIn: 10, tokensOut: 5, costUsd: 0.5 };

/** A governed tool whose `invoke` returns a plain enriched result (spy-able). */
function tool(
  name: string,
  invoke: RegisteredTool['invoke'] = vi.fn(async (args) => ({
    result: { ok: true, args },
    handle: `raw:${name}`,
    pointer: `p:${name}`,
  })),
  render?: RegisteredTool['render'],
  ok?: RegisteredTool['ok'],
): RegisteredTool {
  return {
    name,
    description: `the ${name} tool`,
    partition: 'kernel',
    inputSchema: {},
    invoke,
    ...(render ? { render } : {}),
    ...(ok ? { ok } : {}),
  };
}

/** A scripted `complete()` that plays canned rounds and snapshots the messages it sees each call. */
function scriptedComplete(rounds: CompletionResult[]): {
  fn: GovernedLoopDeps['complete'];
  seen: unknown[];
} {
  const seen: unknown[] = [];
  let i = 0;
  const fn = vi.fn(async (messages: unknown) => {
    seen.push(structuredClone(messages));
    const round = rounds[Math.min(i, rounds.length - 1)]!;
    i += 1;
    return round;
  });
  return { fn, seen };
}

const text = (t: string): CompletionResult => ({ text: t, toolCalls: [], usage: USAGE });

function deps(over: Partial<GovernedLoopDeps>): GovernedLoopDeps {
  return {
    sessionId: 's1',
    complete: async () => text(''),
    catalogue: [],
    systemPrompt: 'sys',
    input: 'do it',
    canUseTool: async () => ({ behavior: 'allow' }),
    gate: async () => ({ allow: true }),
    ...over,
  };
}

describe('runGovernedLoop', () => {
  it('executes an allowed tool call, streams frames in order, and settles summed usage', async () => {
    const invoke = vi.fn(async () => ({ result: { rows: 3 }, handle: 'raw', pointer: 'P' }));
    const catalogue: ToolCatalogue = [tool('get_symbol', invoke)];
    const frames: TurnFrame[] = [];
    const onSettle = vi.fn();
    const complete = scriptedComplete([
      {
        text: 'let me look',
        toolCalls: [{ id: 'c1', name: 'get_symbol', arguments: { name: 'pay' } }],
        usage: USAGE,
      },
      text('done'),
    ]);

    await runGovernedLoop(
      deps({ catalogue, complete: complete.fn, onTurn: (f) => frames.push(f), onSettle }),
    );

    expect(invoke).toHaveBeenCalledExactlyOnceWith({ name: 'pay' });
    expect(frames).toEqual([
      { t: 'text', text: 'let me look' },
      { t: 'tool_use', tool: 'get_symbol', input: { name: 'pay' }, handle: 's1:c1' },
      // No per-tool `render` here ⇒ the frame carries the JSON floor (matches the model content).
      { t: 'tool_result', handle: 's1:c1', ok: true, pointer: JSON.stringify({ rows: 3 }) },
      { t: 'text', text: 'done' },
    ]);
    expect(onSettle).toHaveBeenCalledExactlyOnceWith('s1', {
      tokensIn: 20,
      tokensOut: 10,
      costUsd: 1,
    });
  });

  it('emits a thinking frame (before the answer) when a completion carries reasoning, and never resends it', async () => {
    const frames: TurnFrame[] = [];
    let settled: readonly DriverMessage[] = [];
    const complete = scriptedComplete([
      {
        text: 'the answer is 4',
        toolCalls: [],
        usage: USAGE,
        reasoning: 'the user asked 2+2, so add them',
      },
    ]);

    await runGovernedLoop(
      deps({
        complete: complete.fn,
        onTurn: (f) => frames.push(f),
        onMessages: (m) => {
          settled = m;
        },
      }),
    );

    // Reasoning precedes the answer text.
    expect(frames).toEqual([
      { t: 'thinking', text: 'the user asked 2+2, so add them' },
      { t: 'text', text: 'the answer is 4' },
    ]);
    // Display-only: reasoning must never enter the resent transcript (the API rejects it on input).
    expect(JSON.stringify(settled)).not.toContain('the user asked 2+2');
  });

  it('emits no thinking frame when a completion has no reasoning', async () => {
    const frames: TurnFrame[] = [];
    await runGovernedLoop(
      deps({ complete: async () => text('just the answer'), onTurn: (f) => frames.push(f) }),
    );
    expect(frames.map((f) => f.t)).toEqual(['text']);
  });

  it("emits the tool's ok-predicate on the successful tool_result frame (a failure ⇒ ok:false)", async () => {
    // A pure-API backend has no SDK error signal; the tool's `ok` predicate decides the
    // frame's ✓/✗. Here a not-found `get_symbol` invoked successfully still reports ok:false.
    const notFound = { found: false, reason: 'no-symbol' };
    const invoke = vi.fn(async () => ({ result: notFound, handle: 'symbol:miss', pointer: 'pay' }));
    const okPredicate = vi.fn((r: unknown) => (r as { found: boolean }).found);
    const catalogue: ToolCatalogue = [
      tool('get_symbol', invoke, () => 'not found: no-symbol', okPredicate),
    ];
    const frames: TurnFrame[] = [];
    const complete = scriptedComplete([
      {
        text: '',
        toolCalls: [{ id: 'c1', name: 'get_symbol', arguments: { name: 'pay' } }],
        usage: USAGE,
      },
      text('ok'),
    ]);

    await runGovernedLoop(
      deps({ catalogue, complete: complete.fn, onTurn: (f) => frames.push(f) }),
    );

    expect(okPredicate).toHaveBeenCalledWith(notFound);
    const result = frames.find((f) => f.t === 'tool_result');
    expect(result).toEqual({
      t: 'tool_result',
      handle: 's1:c1',
      ok: false,
      pointer: 'not found: no-symbol',
    });
  });

  it('defaults ok:true when a tool carries no ok-predicate', async () => {
    const invoke = vi.fn(async () => ({ result: { rows: 1 }, handle: 'h', pointer: 'p' }));
    const catalogue: ToolCatalogue = [tool('Read', invoke)];
    const frames: TurnFrame[] = [];
    const complete = scriptedComplete([
      { text: '', toolCalls: [{ id: 'c1', name: 'Read', arguments: {} }], usage: USAGE },
      text('ok'),
    ]);
    await runGovernedLoop(
      deps({ catalogue, complete: complete.fn, onTurn: (f) => frames.push(f) }),
    );
    expect(frames.find((f) => f.t === 'tool_result')).toMatchObject({ ok: true });
  });

  it('renders a tool result to display text for BOTH the frame and the model (not the pointer)', async () => {
    // The Grep defect: the response `pointer` is the search PATTERN, and the real matches
    // live in `result`. A per-tool `render` turns the result into file:line lines, and the
    // driver uses that text for the emitted frame AND the model's tool message.
    const grepResult = {
      hits: [
        { file: 'src/auth.ts', line: 31, text: '  const next = mint(id);' },
        { file: 'src/session.ts', line: 88, text: 'export const refreshToken = () => {};' },
      ],
    };
    const rendered =
      'src/auth.ts:31:  const next = mint(id);\nsrc/session.ts:88:export const refreshToken = () => {};';
    const invoke = vi.fn(async () => ({
      result: grepResult,
      handle: 'grep:useState',
      pointer: 'useState', // the PATTERN — what the old code leaked to the console
    }));
    const render = vi.fn(() => rendered);
    const frames: TurnFrame[] = [];
    const onMessages = vi.fn();
    const complete = scriptedComplete([
      {
        text: '',
        toolCalls: [{ id: 'c1', name: 'Grep', arguments: { pattern: 'useState' } }],
        usage: USAGE,
      },
      text('found them'),
    ]);

    await runGovernedLoop(
      deps({
        catalogue: [tool('Grep', invoke, render)],
        complete: complete.fn,
        onTurn: (f) => frames.push(f),
        onMessages,
      }),
    );

    expect(render).toHaveBeenCalledExactlyOnceWith(grepResult);
    // The console frame shows the real matches, not the pattern.
    expect(frames).toContainEqual({
      t: 'tool_result',
      handle: 's1:c1',
      ok: true,
      pointer: rendered,
    });
    // The model reads the same rendered text — not raw JSON, not the pattern.
    const toolMsg = (onMessages.mock.calls[0]![0] as DriverMessage[]).find(
      (m) => m.role === 'tool',
    )!;
    expect(toolMsg.content).toBe(rendered);
  });

  it('does not execute a denied tool call — the deny reason goes back to the model', async () => {
    const invoke = vi.fn();
    const frames: TurnFrame[] = [];
    const complete = scriptedComplete([
      { text: '', toolCalls: [{ id: 'c1', name: 'apply_patch', arguments: {} }], usage: USAGE },
      text('acknowledged'),
    ]);

    await runGovernedLoop(
      deps({
        catalogue: [tool('apply_patch', invoke)],
        complete: complete.fn,
        canUseTool: async () => ({ behavior: 'deny', message: 'cost cap reached' }),
        onTurn: (f) => frames.push(f),
      }),
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(frames).toContainEqual({
      t: 'tool_result',
      handle: 's1:c1',
      ok: false,
      pointer: 'cost cap reached',
    });
    expect(JSON.stringify(complete.seen[1])).toContain(
      'denied by coa governance: cost cap reached',
    );
  });

  it('re-runs the model when the close-gate blocks, injecting the reason', async () => {
    let gateCalls = 0;
    const complete = scriptedComplete([text('first pass'), text('addressed it')]);

    await runGovernedLoop(
      deps({
        complete: complete.fn,
        gate: async () =>
          gateCalls++ === 0 ? { allow: false, message: 'address the flag' } : { allow: true },
      }),
    );

    expect(complete.fn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(complete.seen[1])).toContain('address the flag');
  });

  it('surfaces an unknown tool as a failed result without throwing', async () => {
    const frames: TurnFrame[] = [];
    const complete = scriptedComplete([
      { text: '', toolCalls: [{ id: 'c1', name: 'nope', arguments: {} }], usage: USAGE },
      text('ok'),
    ]);

    await runGovernedLoop(deps({ complete: complete.fn, onTurn: (f) => frames.push(f) }));

    expect(frames).toContainEqual({
      t: 'tool_result',
      handle: 's1:c1',
      ok: false,
      pointer: 'unknown tool: nope',
    });
  });

  it('resends the whole prior transcript verbatim ahead of the current turn (multi-turn memory)', async () => {
    const complete = scriptedComplete([text('sixty-four')]);
    // The full prior conversation (system omitted) — tool call + result included.
    const history: DriverMessage[] = [
      { role: 'user', content: 'what is 8 squared?' },
      {
        role: 'assistant',
        content: 'let me compute',
        toolCalls: [{ id: 'c1', name: 'calc', arguments: { n: 8 } }],
      },
      { role: 'tool', toolCallId: 'c1', content: '{"answer":64}' },
      { role: 'assistant', content: '64' },
    ];

    await runGovernedLoop(deps({ complete: complete.fn, history, input: 'and 9 squared?' }));

    // Nothing dropped or reordered — the cached prefix stays intact.
    expect(complete.seen[0]).toEqual([
      { role: 'system', content: 'sys' },
      ...history,
      { role: 'user', content: 'and 9 squared?' },
    ]);
  });

  it('hands back the settled transcript (system omitted) via onMessages for persistence', async () => {
    const onMessages = vi.fn();
    const complete = scriptedComplete([
      {
        text: 'looking',
        toolCalls: [{ id: 'c1', name: 'get_symbol', arguments: { name: 'pay' } }],
        usage: USAGE,
      },
      text('the answer'),
    ]);

    await runGovernedLoop(
      deps({
        catalogue: [tool('get_symbol')],
        complete: complete.fn,
        input: 'find pay',
        onMessages,
      }),
    );

    expect(onMessages).toHaveBeenCalledExactlyOnceWith([
      { role: 'user', content: 'find pay' },
      {
        role: 'assistant',
        content: 'looking',
        toolCalls: [{ id: 'c1', name: 'get_symbol', arguments: { name: 'pay' } }],
      },
      {
        role: 'tool',
        toolCallId: 'c1',
        content: JSON.stringify({ ok: true, args: { name: 'pay' } }),
      },
      { role: 'assistant', content: 'the answer' },
    ]);
  });

  it('caps an oversized tool result before it enters the conversation (history-poison backstop)', async () => {
    const result = { blob: 'x'.repeat(TOOL_RESULT_CHAR_CAP * 4) };
    const fullLen = JSON.stringify(result).length;
    const invoke = vi.fn(async () => ({ result, handle: 'raw', pointer: 'P' }));
    const onMessages = vi.fn();
    const complete = scriptedComplete([
      { text: '', toolCalls: [{ id: 'c1', name: 'big', arguments: {} }], usage: USAGE },
      text('done'),
    ]);

    await runGovernedLoop(
      deps({ catalogue: [tool('big', invoke)], complete: complete.fn, onMessages }),
    );

    const toolMsg = (onMessages.mock.calls[0]![0] as DriverMessage[]).find(
      (m) => m.role === 'tool',
    )!;
    // The verbatim raw store still holds the full result; only what enters the resent
    // transcript is bounded, with a marker telling the model how much was truncated.
    expect(toolMsg.content.length).toBeLessThan(TOOL_RESULT_CHAR_CAP + 200);
    expect(toolMsg.content).toContain(
      `truncated by coa: showing ${TOOL_RESULT_CHAR_CAP} of ${fullLen} chars`,
    );
  });

  it('leaves a small tool result untouched', async () => {
    const invoke = vi.fn(async () => ({ result: { ok: true }, handle: 'raw', pointer: 'P' }));
    const onMessages = vi.fn();
    const complete = scriptedComplete([
      { text: '', toolCalls: [{ id: 'c1', name: 'small', arguments: {} }], usage: USAGE },
      text('done'),
    ]);

    await runGovernedLoop(
      deps({ catalogue: [tool('small', invoke)], complete: complete.fn, onMessages }),
    );

    const toolMsg = (onMessages.mock.calls[0]![0] as DriverMessage[]).find(
      (m) => m.role === 'tool',
    )!;
    expect(toolMsg.content).toBe(JSON.stringify({ ok: true }));
  });

  it('is bounded by maxIterations when the model never stops, still settling', async () => {
    const onSettle = vi.fn();
    const complete = vi.fn(async () => ({
      text: '',
      toolCalls: [{ id: 'c', name: 'get_symbol', arguments: {} }],
      usage: USAGE,
    }));

    await runGovernedLoop(
      deps({ catalogue: [tool('get_symbol')], complete, onSettle, maxIterations: 3 }),
    );

    expect(complete).toHaveBeenCalledTimes(3);
    expect(onSettle).toHaveBeenCalledOnce();
  });

  it('flushes completed blocks and usage when a later round-trip throws (block-preserving)', async () => {
    const onMessages = vi.fn();
    const onSettle = vi.fn();
    let n = 0;
    const complete: GovernedLoopDeps['complete'] = vi.fn(async () => {
      n += 1;
      if (n === 1) {
        return {
          text: 'working',
          toolCalls: [{ id: 'c1', name: 'get_symbol', arguments: {} }],
          usage: USAGE,
        };
      }
      throw new Error('connection dropped');
    });

    await expect(
      runGovernedLoop(
        deps({ catalogue: [tool('get_symbol')], complete, input: 'do it', onMessages, onSettle }),
      ),
    ).rejects.toThrow('connection dropped');

    // The completed first round-trip survived in the canonical transcript (system omitted).
    expect(onMessages).toHaveBeenCalledTimes(1);
    expect(onMessages.mock.calls[0]![0]).toEqual([
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: 'working',
        toolCalls: [{ id: 'c1', name: 'get_symbol', arguments: {} }],
      },
      { role: 'tool', toolCallId: 'c1', content: '{"ok":true,"args":{}}' },
    ]);
    // Usage accrued for the completed round-trip is still charged.
    expect(onSettle).toHaveBeenCalledExactlyOnceWith('s1', USAGE);
  });

  it('stops at the next safe boundary when the signal aborts, flushing completed blocks', async () => {
    const onMessages = vi.fn();
    const controller = new AbortController();
    let n = 0;
    const complete: GovernedLoopDeps['complete'] = vi.fn(async () => {
      n += 1;
      if (n === 1) return { text: 'first answer', toolCalls: [], usage: USAGE };
      throw new Error('should not reach a second round-trip after abort');
    });
    // A gate that never allows the turn to end, so only the abort stops the loop.
    const gate = vi.fn(async () => {
      controller.abort(); // abort after the first round-trip settles
      return { allow: false, message: 'keep going' } as const;
    });
    await runGovernedLoop(
      deps({ complete, gate, signal: controller.signal, onMessages, input: 'do it' }),
    );
    expect(n).toBe(1); // never called complete() again after abort
    expect(onMessages).toHaveBeenCalledExactlyOnceWith([
      { role: 'user', content: 'do it' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'keep going' },
    ]);
  });

  it('injects a queued steer turn at the next safe boundary before the next round-trip', async () => {
    const seen: DriverMessage[][] = [];
    let n = 0;
    const complete: GovernedLoopDeps['complete'] = vi.fn(async (messages) => {
      seen.push(structuredClone(messages) as DriverMessage[]);
      n += 1;
      if (n === 1) return { text: 'ok', toolCalls: [], usage: USAGE };
      return { text: 'done', toolCalls: [], usage: USAGE };
    });
    // Allow the turn to end only on the SECOND round-trip, so the steer lands between them.
    const gate = vi.fn(async () => (n >= 2 ? { allow: true } : { allow: false, message: 'more?' }) as const);
    const steer = ['actually, also do X'];
    const drainSteer = vi.fn(() => steer.splice(0, steer.length));
    await runGovernedLoop(deps({ complete, gate, drainSteer, input: 'do it' }));
    // The second round-trip's messages include the injected user turn.
    expect(seen[1]).toContainEqual({ role: 'user', content: 'actually, also do X' });
  });

  it('trims the flush to the last complete round-trip when a throw lands mid tool-loop (unrenderable result)', async () => {
    const onMessages = vi.fn();
    const onSettle = vi.fn();
    // No `render`, and a result that JSON.stringify cannot serialize (a BigInt) — the
    // driver's `capToolResult(JSON.stringify(...))` fallback throws AFTER the assistant
    // message carrying `toolCalls` was pushed but BEFORE its tool result is pushed.
    const invoke = vi.fn(async () => ({ result: { bad: 10n }, handle: 'h', pointer: 'p' }));
    const complete = scriptedComplete([
      {
        text: 'working',
        toolCalls: [{ id: 'c1', name: 'bad_tool', arguments: {} }],
        usage: USAGE,
      },
    ]);

    await expect(
      runGovernedLoop(
        deps({
          catalogue: [tool('bad_tool', invoke)],
          complete: complete.fn,
          input: 'do it',
          onMessages,
          onSettle,
        }),
      ),
    ).rejects.toThrow();

    // Only the last round-trip-consistent prefix survives — the dangling assistant(toolCalls)
    // with no answered tool result must NOT be in the flushed transcript.
    expect(onMessages).toHaveBeenCalledExactlyOnceWith([{ role: 'user', content: 'do it' }]);
    // Usage from the completed `complete()` call is still charged.
    expect(onSettle).toHaveBeenCalledExactlyOnceWith('s1', USAGE);
  });
});

describe('toToolDefs', () => {
  it('maps the governed catalogue to model-facing name/description/params', () => {
    expect(toToolDefs([tool('get_symbol')])).toEqual([
      { name: 'get_symbol', description: 'the get_symbol tool', parameters: {} },
    ]);
  });
});
