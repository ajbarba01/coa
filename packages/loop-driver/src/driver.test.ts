import { describe, expect, it, vi } from 'vitest';
import type { TurnFrame } from '@coa/shared';
import type {
  CompletionDelta,
  CompletionResult,
  Delivery,
  DriverMessage,
  RegisteredTool,
  ToolCatalogue,
} from '@coa/spi';
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
  // A non-streaming fake (degrades to yielding nothing and returning the settled round).
  // eslint-disable-next-line require-yield
  const fn = vi.fn(async function* (messages: unknown) {
    seen.push(structuredClone(messages));
    const round = rounds[Math.min(i, rounds.length - 1)]!;
    i += 1;
    return round;
  });
  return { fn, seen };
}

const text = (t: string): CompletionResult => ({ text: t, toolCalls: [], usage: USAGE });

/**
 * A scripted `complete()` (usage filled in), returned as the bare `vi.fn` (not wrapped in
 * a snapshot list like {@link scriptedComplete}) so a test can inspect `mock.calls` directly.
 */
function completions(rounds: ReadonlyArray<Pick<CompletionResult, 'text' | 'toolCalls'>>) {
  let i = 0;
  // A non-streaming fake (degrades to yielding nothing, returning the settled round). Typed
  // explicitly (not inferred) so the wrapping vi.fn keeps the real `messages` parameter on
  // `mock.calls`, unlike `scriptedComplete`'s snapshot-only `seen`.
  // eslint-disable-next-line require-yield
  const impl: GovernedLoopDeps['complete'] = async function* (messages) {
    void messages;
    const round = rounds[Math.min(i, rounds.length - 1)]!;
    i += 1;
    return { ...round, usage: USAGE };
  };
  return vi.fn(impl);
}

function deps(over: Partial<GovernedLoopDeps>): GovernedLoopDeps {
  return {
    sessionId: 's1',
    // A non-streaming default fake: yields nothing, returns the result.
    // eslint-disable-next-line require-yield
    complete: async function* () {
      return text('');
    },
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
    let gateCalls = 0;
    const complete = scriptedComplete([
      {
        text: 'the answer is 4',
        toolCalls: [],
        usage: USAGE,
        reasoning: 'the user asked 2+2, so add them',
      },
      text('done'),
    ]);

    await runGovernedLoop(
      deps({
        complete: complete.fn,
        onTurn: (f) => frames.push(f),
        gate: async () =>
          gateCalls++ === 0 ? { allow: false, message: 'keep going' } : { allow: true },
      }),
    );

    // Reasoning precedes the answer text.
    expect(frames).toEqual([
      { t: 'thinking', text: 'the user asked 2+2, so add them' },
      { t: 'text', text: 'the answer is 4' },
      { t: 'text', text: 'done' },
    ]);
    // Display-only: reasoning must never enter the resent transcript (the API rejects it on
    // input) — proven by inspecting what the SECOND round-trip actually resends.
    expect(JSON.stringify(complete.seen[1])).not.toContain('the user asked 2+2');
  });

  it('emits text-delta and thinking-delta frames as the generator yields, then the settled frames', async () => {
    const frames: TurnFrame[] = [];
    async function* streamingComplete(): AsyncGenerator<CompletionDelta, CompletionResult> {
      yield { kind: 'reasoning', text: 'th' };
      yield { kind: 'reasoning', text: 'ink' };
      yield { kind: 'text', text: 'Hel' };
      yield { kind: 'text', text: 'lo' };
      return {
        text: 'Hello',
        reasoning: 'think',
        toolCalls: [],
        usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 },
      };
    }
    await runGovernedLoop({
      sessionId: 's',
      complete: streamingComplete,
      catalogue: [],
      systemPrompt: '',
      input: 'hi',
      canUseTool: async () => ({ behavior: 'allow' }) as never,
      gate: async () => ({ allow: true }),
      onTurn: (f) => frames.push(f),
    });
    // deltas arrive in order, then the settled thinking + settled text
    expect(frames).toEqual([
      { t: 'thinking-delta', text: 'th' },
      { t: 'thinking-delta', text: 'ink' },
      { t: 'text-delta', text: 'Hel' },
      { t: 'text-delta', text: 'lo' },
      { t: 'thinking', text: 'think' },
      { t: 'text', text: 'Hello' },
    ]);
  });

  it('on interrupt mid-stream, streams the partial as deltas and settles NOTHING (the session host owns the interrupt closure)', async () => {
    const controller = new AbortController();
    const frames: TurnFrame[] = [];
    async function* streamThenAbort(): AsyncGenerator<CompletionDelta, CompletionResult> {
      yield { kind: 'text', text: 'Par' };
      yield { kind: 'text', text: 'tial' };
      // The user interrupts; the adapter's next read observes the abort and throws.
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    await runGovernedLoop({
      sessionId: 's',
      complete: streamThenAbort,
      catalogue: [],
      systemPrompt: '',
      input: 'hi',
      canUseTool: async () => ({ behavior: 'allow' }) as never,
      gate: async () => ({ allow: true }),
      signal: controller.signal,
      onTurn: (f) => frames.push(f),
    });
    expect(frames).toContainEqual({ t: 'text-delta', text: 'Par' });
    expect(frames).toContainEqual({ t: 'text-delta', text: 'tial' });
    // The driver re-emits NOTHING on abort: the session host's interrupt closure settles the partial from these
    // same deltas and records the marker. Re-emitting it here duplicated the block (once live,
    // once settled) — the reported doubled-output bug.
    expect(frames.filter((f) => f.t === 'text')).toHaveLength(0);
  });

  it('emits no thinking frame when a completion has no reasoning', async () => {
    const frames: TurnFrame[] = [];
    await runGovernedLoop(
      deps({
        // eslint-disable-next-line require-yield
        complete: async function* () {
          return text('just the answer');
        },
        onTurn: (f) => frames.push(f),
      }),
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
    // The model reads the same rendered text — not raw JSON, not the pattern — proven by
    // what the SECOND round-trip actually resends.
    const toolMsg = (complete.seen[1] as DriverMessage[]).find((m) => m.role === 'tool')!;
    expect(toolMsg.content).toBe(rendered);
  });

  it('carries the display body as `full` on the tool_result frame (append-only log fidelity)', async () => {
    const invoke = vi.fn(async () => ({ result: { rows: 3 }, handle: 'raw', pointer: 'P' }));
    const catalogue: ToolCatalogue = [tool('get_symbol', invoke)];
    const seen: Array<{ frame: TurnFrame; full?: string }> = [];
    const onTurn = (frame: TurnFrame, full?: string): void => {
      seen.push(full !== undefined ? { frame, full } : { frame });
    };
    const complete = scriptedComplete([
      {
        text: '',
        toolCalls: [{ id: 'c1', name: 'get_symbol', arguments: { name: 'pay' } }],
        usage: USAGE,
      },
      text('done'),
    ]);

    await runGovernedLoop(deps({ catalogue, complete: complete.fn, onTurn }));

    const resultEntry = seen.find((s) => s.frame.t === 'tool_result');
    expect(resultEntry?.full).toBe(JSON.stringify({ rows: 3 }));
    expect(resultEntry?.full).toBe((resultEntry?.frame as { pointer: string }).pointer);
  });

  it('drains deliveries into the next round trip, tagged by origin', async () => {
    const seen: DriverMessage[][] = [];
    const pending = [
      { origin: 'user' as const, text: 'check the schema first' },
      { origin: 'system' as const, text: 'explorer finished' },
    ];
    // eslint-disable-next-line require-yield
    const complete: GovernedLoopDeps['complete'] = vi.fn(async function* (messages) {
      seen.push(structuredClone(messages) as DriverMessage[]);
      return text('done');
    });
    await runGovernedLoop(
      deps({
        complete,
        drainDeliveries: () => pending.splice(0, pending.length),
      }),
    );
    const first = seen[0] ?? [];
    expect(
      first.some((m) => m.role === 'user' && m.content.includes('check the schema first')),
    ).toBe(true);
    expect(first.some((m) => m.role === 'user' && m.content.includes('explorer finished'))).toBe(
      true,
    );
  });

  it('feeds a delivery to the model without writing its log line (core owns the record)', async () => {
    const frames: TurnFrame[] = [];
    const pending = [
      { origin: 'user' as const, text: 'from the person' },
      { origin: 'system' as const, text: 'child agent finished' },
    ];
    const drainDeliveries = vi.fn(() => pending.splice(0, pending.length));
    await runGovernedLoop(deps({ drainDeliveries, onTurn: (f) => frames.push(f) }));
    expect(drainDeliveries).toHaveBeenCalled();
    // The driver hands the text to the model but writes nothing: core's drain closure is the
    // single writer, so an emit here would put the same line in the log twice.
    expect(frames.some((f) => f.t === 'text' && (f.role === 'user' || f.role === 'system'))).toBe(
      false,
    );
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
        canUseTool: async () => ({ behavior: 'deny', message: 'blocked by a deny rule' }),
        onTurn: (f) => frames.push(f),
      }),
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(frames).toContainEqual({
      t: 'tool_result',
      handle: 's1:c1',
      ok: false,
      pointer: 'blocked by a deny rule',
    });
    expect(JSON.stringify(complete.seen[1])).toContain(
      'denied by coa governance: blocked by a deny rule',
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

  it('carries this turn attachments on the first user message', async () => {
    const complete = scriptedComplete([text('described')]);
    const attachments: DriverMessage['attachments'] = [
      { kind: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
    ];

    await runGovernedLoop(deps({ complete: complete.fn, input: 'what is this?', attachments }));

    expect(complete.seen[0]).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'what is this?', attachments },
    ]);
  });

  it('omits the attachments field entirely when none are given (byte-identical to today)', async () => {
    const complete = scriptedComplete([text('ok')]);

    await runGovernedLoop(deps({ complete: complete.fn, input: 'hi' }));

    expect(complete.seen[0]).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('caps an oversized tool result before it enters the conversation (history-poison backstop)', async () => {
    const result = { blob: 'x'.repeat(TOOL_RESULT_CHAR_CAP * 4) };
    const fullLen = JSON.stringify(result).length;
    const invoke = vi.fn(async () => ({ result, handle: 'raw', pointer: 'P' }));
    const complete = scriptedComplete([
      { text: '', toolCalls: [{ id: 'c1', name: 'big', arguments: {} }], usage: USAGE },
      text('done'),
    ]);

    await runGovernedLoop(deps({ catalogue: [tool('big', invoke)], complete: complete.fn }));

    // What the SECOND round-trip resends is what actually reaches the model.
    const toolMsg = (complete.seen[1] as DriverMessage[]).find((m) => m.role === 'tool')!;
    // The verbatim raw store still holds the full result; only what enters the resent
    // transcript is bounded, with a marker telling the model how much was truncated.
    expect(toolMsg.content.length).toBeLessThan(TOOL_RESULT_CHAR_CAP + 200);
    expect(toolMsg.content).toContain(
      `truncated by coa: showing ${TOOL_RESULT_CHAR_CAP} of ${fullLen} chars`,
    );
  });

  it('leaves a small tool result untouched', async () => {
    const invoke = vi.fn(async () => ({ result: { ok: true }, handle: 'raw', pointer: 'P' }));
    const complete = scriptedComplete([
      { text: '', toolCalls: [{ id: 'c1', name: 'small', arguments: {} }], usage: USAGE },
      text('done'),
    ]);

    await runGovernedLoop(deps({ catalogue: [tool('small', invoke)], complete: complete.fn }));

    const toolMsg = (complete.seen[1] as DriverMessage[]).find((m) => m.role === 'tool')!;
    expect(toolMsg.content).toBe(JSON.stringify({ ok: true }));
  });

  it('is bounded by maxIterations when the model never stops, still settling', async () => {
    const onSettle = vi.fn();
    // eslint-disable-next-line require-yield
    const complete = vi.fn(async function* () {
      return {
        text: '',
        toolCalls: [{ id: 'c', name: 'get_symbol', arguments: {} }],
        usage: USAGE,
      };
    });

    await runGovernedLoop(
      deps({ catalogue: [tool('get_symbol')], complete, onSettle, maxIterations: 3 }),
    );

    expect(complete).toHaveBeenCalledTimes(3);
    expect(onSettle).toHaveBeenCalledOnce();
  });

  it('settles the accrued usage even when a later round-trip throws', async () => {
    const onSettle = vi.fn();
    let n = 0;
    // eslint-disable-next-line require-yield
    const complete: GovernedLoopDeps['complete'] = vi.fn(async function* () {
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
        deps({ catalogue: [tool('get_symbol')], complete, input: 'do it', onSettle }),
      ),
    ).rejects.toThrow('connection dropped');

    // Usage accrued for the completed first round-trip is still charged, even though the
    // second round-trip threw before the loop settled cleanly.
    expect(onSettle).toHaveBeenCalledExactlyOnceWith('s1', USAGE);
  });

  it('stops at the next safe boundary when the signal aborts', async () => {
    const controller = new AbortController();
    let n = 0;
    // eslint-disable-next-line require-yield
    const complete: GovernedLoopDeps['complete'] = vi.fn(async function* () {
      n += 1;
      if (n === 1) return { text: 'first answer', toolCalls: [], usage: USAGE };
      throw new Error('should not reach a second round-trip after abort');
    });
    // A gate that never allows the turn to end, so only the abort stops the loop.
    const gate = vi.fn(async () => {
      controller.abort(); // abort after the first round-trip settles
      return { allow: false, message: 'keep going' } as const;
    });
    await runGovernedLoop(deps({ complete, gate, signal: controller.signal, input: 'do it' }));
    expect(n).toBe(1); // never called complete() again after abort
  });

  it('re-enters the loop for a delivery that arrived after the close-gate allowed a stop', async () => {
    // The pure-API floor: the model stopped and the gate allowed it, but text is pending.
    // Without this the delivery is stranded — fed to nobody, with no drain point left.
    const complete = completions([
      { text: 'first', toolCalls: [] },
      { text: 'second', toolCalls: [] },
    ]);
    const gate = vi.fn(async () => ({ allow: true }) as const);
    const pending: Delivery[] = [];
    let asked = 0;
    const drainDeliveries = vi.fn(() => {
      asked += 1;
      // Arrives only once the first round trip is over, so it cannot be picked up at the
      // top-of-loop drain — the close-gate is the sole remaining boundary.
      if (asked === 2) pending.push({ origin: 'system', text: 'child agent finished' });
      return pending.splice(0, pending.length);
    });
    await runGovernedLoop(deps({ complete, gate, drainDeliveries, input: 'do it' }));
    expect(complete).toHaveBeenCalledTimes(2);
    const second = complete.mock.calls[1]?.[0] ?? [];
    expect(second.some((m) => m.content === '[coa notice] child agent finished')).toBe(true);
  });

  it('settles usage even when a mid-tool-loop throw leaves a dangling tool_use unanswered', async () => {
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
          onSettle,
        }),
      ),
    ).rejects.toThrow();

    // Usage from the completed `complete()` call is still charged even though the
    // in-flight tool_use never got its result.
    expect(onSettle).toHaveBeenCalledExactlyOnceWith('s1', USAGE);
  });

  it('observes on-disk changes after each tool call', async () => {
    // The same producer-② trigger the SDK backend fires from PostToolUse. It runs after
    // EVERY call, not just an edit verb, because a shell command can touch any file and
    // the reconciler — not this loop — is what works out whether anything changed.
    const observeChanges = vi.fn();
    const complete = scriptedComplete([
      {
        text: '',
        toolCalls: [{ id: 'c1', name: 'Bash', arguments: { command: 'touch x' } }],
        usage: USAGE,
      },
      text('done'),
    ]);

    await runGovernedLoop(
      deps({ catalogue: [tool('Bash')], complete: complete.fn, observeChanges }),
    );

    expect(observeChanges).toHaveBeenCalledTimes(1);
  });

  it('is byte-identical when no observeChanges port is supplied (degrades to a pass-through)', async () => {
    const complete = scriptedComplete([
      {
        text: '',
        toolCalls: [{ id: 'c1', name: 'Bash', arguments: { command: 'touch x' } }],
        usage: USAGE,
      },
      text('done'),
    ]);
    await expect(
      runGovernedLoop(deps({ catalogue: [tool('Bash')], complete: complete.fn })),
    ).resolves.toBeUndefined();
  });
});

describe('toToolDefs', () => {
  it('maps the governed catalogue to model-facing name/description/params', () => {
    expect(toToolDefs([tool('get_symbol')])).toEqual([
      { name: 'get_symbol', description: 'the get_symbol tool', parameters: {} },
    ]);
  });
});
