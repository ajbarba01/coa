import { describe, expect, it, vi } from 'vitest';
import type { TurnFrame } from '@coa/shared';
import type { RegisteredTool, ToolCatalogue } from '@coa/spi';
import type { CompletionResult } from './complete.js';
import type { DriverMessage } from './complete.js';
import { runGovernedLoop, toToolDefs, type GovernedLoopDeps } from './driver.js';

const USAGE = { tokensIn: 10, tokensOut: 5, costUsd: 0.5 };

/** A governed tool whose `invoke` returns a plain enriched result (spy-able). */
function tool(
  name: string,
  invoke: RegisteredTool['invoke'] = vi.fn(async (args) => ({
    result: { ok: true, args },
    handle: `raw:${name}`,
    pointer: `p:${name}`,
  })),
): RegisteredTool {
  return { name, description: `the ${name} tool`, partition: 'kernel', inputSchema: {}, invoke };
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
      { t: 'tool_result', handle: 's1:c1', ok: true, pointer: 'P' },
      { t: 'text', text: 'done' },
    ]);
    expect(onSettle).toHaveBeenCalledExactlyOnceWith('s1', {
      tokensIn: 20,
      tokensOut: 10,
      costUsd: 1,
    });
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
      { role: 'assistant', content: 'let me compute', toolCalls: [{ id: 'c1', name: 'calc', arguments: { n: 8 } }] },
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
      { role: 'assistant', content: 'looking', toolCalls: [{ id: 'c1', name: 'get_symbol', arguments: { name: 'pay' } }] },
      { role: 'tool', toolCallId: 'c1', content: JSON.stringify({ ok: true, args: { name: 'pay' } }) },
      { role: 'assistant', content: 'the answer' },
    ]);
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
});

describe('toToolDefs', () => {
  it('maps the governed catalogue to model-facing name/description/params', () => {
    expect(toToolDefs([tool('get_symbol')])).toEqual([
      { name: 'get_symbol', description: 'the get_symbol tool', parameters: {} },
    ]);
  });
});
