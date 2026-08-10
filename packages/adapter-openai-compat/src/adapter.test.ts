import { describe, expect, it, vi } from 'vitest';
import type { NeutralConfig, SessionConfig, TurnFrame } from '@coa/shared';
import type { CanUseTool, RegisteredTool, StopPredicate } from '@coa/spi';
import { OpenAiCompatAdapter } from './adapter.js';
import type { FetchLike } from './complete.js';
import { deepseekSpec } from './deepseek.js';
import { longcatSpec } from './longcat.js';

const NEUTRAL: NeutralConfig = {
  prefixHead: [
    {
      order: 0,
      piece: {
        name: 'identity',
        description: 'd',
        body: 'You are a coa agent.',
        axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
      },
    },
  ],
  systemReminders: [],
  onDemandPullable: [],
  scopePushed: [],
  toolIntents: { allow: [], deny: [] },
};

const SESSION: SessionConfig = {
  role: '',
  scope: '',
  worktree: '/w',
  capabilityFrame: { allow: [], deny: [] },
};

const allow: CanUseTool = async () => ({ behavior: 'allow' });
const allowStop: StopPredicate = async () => ({ allow: true });

interface Captured {
  body?: Record<string, unknown>;
}

/** An async-iterable body of raw SSE event strings (what `Response.body` yields as bytes). */
function sseBody(...events: string[]): AsyncIterable<Uint8Array> {
  const enc = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield enc.encode(e);
    },
  };
}

/** A fake transport that captures the request and streams a one-word reply plus usage as SSE. */
function textFetch(captured: Captured): FetchLike {
  return async (_url, init) => {
    captured.body = init.body !== undefined ? JSON.parse(init.body) : undefined;
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({}),
      // The real wire carries `usage: null` on every chunk until the final usage frame.
      body: sseBody(
        'data: {"choices":[{"delta":{"content":"done"}}],"usage":null}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n',
      ),
    };
  };
}

function wire(adapter: OpenAiCompatAdapter): void {
  adapter.renderNative(NEUTRAL);
  adapter.registerTools([]);
  adapter.interceptTool(allow);
  adapter.interceptStop(allowStop);
}

describe('OpenAiCompatAdapter', () => {
  it('renders the system prompt, drives the loop, streams frames, and settles usage', async () => {
    const captured: Captured = {};
    const frames: TurnFrame[] = [];
    const onSettle = vi.fn();
    const adapter = new OpenAiCompatAdapter(deepseekSpec, {
      sessionId: 's1',
      input: 'refactor the auth module',
      env: { DEEPSEEK_API_KEY: 'sk-1' },
      prices: { 'deepseek-chat': { inPerMillion: 0, outPerMillion: 0 } },
      fetchImpl: textFetch(captured),
      onTurn: (f) => frames.push(f),
      onSettle,
    });
    wire(adapter);

    await adapter.runLoop(SESSION);

    // The rendered system prompt + the user turn opened the conversation, on the
    // spec's default model since the session selected none.
    expect(captured.body?.['model']).toBe('deepseek-chat');
    expect(captured.body?.['messages']).toEqual([
      { role: 'system', content: 'You are a coa agent.' },
      { role: 'user', content: 'refactor the auth module' },
    ]);
    expect(frames).toContainEqual({ t: 'text', text: 'done' });
    expect(onSettle).toHaveBeenCalledExactlyOnceWith('s1', {
      tokensIn: 3,
      tokensOut: 2,
      costUsd: 0,
    });
  });

  it('maps a DeepSeek reasoning effort selection onto the request', async () => {
    const captured: Captured = {};
    const adapter = new OpenAiCompatAdapter(deepseekSpec, {
      sessionId: 's1',
      input: 'go',
      model: {
        provider: 'deepseek',
        model: 'deepseek-reasoner',
        reasoning: { mode: 'effort', effort: 'max' },
      },
      env: { DEEPSEEK_API_KEY: 'sk-1' },
      fetchImpl: textFetch(captured),
    });
    wire(adapter);

    await adapter.runLoop(SESSION);

    // coa's `max` maps onto DeepSeek's top ladder rung, `max`.
    expect(captured.body?.['reasoning_effort']).toBe('max');
    expect(captured.body?.['model']).toBe('deepseek-reasoner');
  });

  it('maps a LongCat effort selection onto thinking enabled, and off onto disabled', async () => {
    const enabled: Captured = {};
    const on = new OpenAiCompatAdapter(longcatSpec, {
      sessionId: 's1',
      input: 'go',
      model: {
        provider: 'longcat',
        model: 'LongCat-2.0',
        reasoning: { mode: 'effort', effort: 'max' },
      },
      env: { LONGCAT_API_KEY: 'sk-1' },
      fetchImpl: textFetch(enabled),
    });
    wire(on);
    await on.runLoop(SESSION);
    expect(enabled.body?.['thinking']).toEqual({ type: 'enabled' });
    expect(enabled.body?.['model']).toBe('LongCat-2.0');

    const disabled: Captured = {};
    const off = new OpenAiCompatAdapter(longcatSpec, {
      sessionId: 's1',
      input: 'go',
      model: { provider: 'longcat', model: 'LongCat-2.0', reasoning: { mode: 'off' } },
      env: { LONGCAT_API_KEY: 'sk-1' },
      fetchImpl: textFetch(disabled),
    });
    wire(off);
    await off.runLoop(SESSION);
    expect(disabled.body?.['thinking']).toEqual({ type: 'disabled' });
  });

  it('fails loudly (the error surfaces upstream, never silently swallowed) when no API key resolves', async () => {
    const deepseek = new OpenAiCompatAdapter(deepseekSpec, {
      sessionId: 's1',
      input: 'go',
      env: {},
    });
    wire(deepseek);
    await expect(deepseek.runLoop(SESSION)).rejects.toThrow(
      'deepseek: no API key — set DEEPSEEK_API_KEY or add an env-var account',
    );

    const longcat = new OpenAiCompatAdapter(longcatSpec, { sessionId: 's1', input: 'go', env: {} });
    wire(longcat);
    await expect(longcat.runLoop(SESSION)).rejects.toThrow(
      'longcat: no API key — set LONGCAT_API_KEY or add an env-var account',
    );
  });

  it('requires renderNative before runLoop', async () => {
    const adapter = new OpenAiCompatAdapter(deepseekSpec, {
      sessionId: 's1',
      input: 'go',
      env: { DEEPSEEK_API_KEY: 'k' },
    });
    adapter.interceptTool(allow);
    adapter.interceptStop(allowStop);
    await expect(adapter.runLoop(SESSION)).rejects.toThrow('renderNative');
  });

  it('forwards a registered base tool (e.g. Read) onto the wire tools list', async () => {
    const captured: Captured = {};
    const readTool: RegisteredTool = {
      name: 'Read',
      description: 'Read a file',
      partition: 'kernel',
      inputSchema: {},
      invoke: async () => ({ result: { ok: true }, handle: 'raw:Read', pointer: 'p:Read' }),
    };
    const adapter = new OpenAiCompatAdapter(deepseekSpec, {
      sessionId: 's1',
      input: 'go',
      env: { DEEPSEEK_API_KEY: 'sk-1' },
      fetchImpl: textFetch(captured),
    });
    adapter.renderNative(NEUTRAL);
    adapter.registerTools([readTool]);
    adapter.interceptTool(allow);
    adapter.interceptStop(allowStop);

    await adapter.runLoop(SESSION);

    const tools = captured.body?.['tools'] as Array<{ function: { name: string } }> | undefined;
    expect(tools?.map((t) => t.function.name)).toContain('Read');
  });
});
