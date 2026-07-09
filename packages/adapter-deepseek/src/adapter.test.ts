import { describe, expect, it, vi } from 'vitest';
import type { NeutralConfig, SessionConfig, TurnFrame } from '@coa/shared';
import type { CanUseTool, RegisteredTool, StopPredicate } from '@coa/spi';
import { DeepSeekAdapter } from './adapter.js';
import type { FetchLike } from './complete.js';

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

function textFetch(captured: Captured): FetchLike {
  return async (_url, init) => {
    captured.body = init.body !== undefined ? JSON.parse(init.body) : undefined;
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        choices: [{ message: { content: 'done' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }),
    };
  };
}

function wire(adapter: DeepSeekAdapter): void {
  adapter.renderNative(NEUTRAL);
  adapter.registerTools([]);
  adapter.interceptTool(allow);
  adapter.interceptStop(allowStop);
}

describe('DeepSeekAdapter', () => {
  it('renders the system prompt, drives the loop, streams frames, and settles usage', async () => {
    const captured: Captured = {};
    const frames: TurnFrame[] = [];
    const onSettle = vi.fn();
    const adapter = new DeepSeekAdapter({
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

    // The rendered system prompt + the user turn opened the conversation.
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
    expect(adapter.usageTelemetry()).toMatchObject({ tokensIn: 3, tokensOut: 2 });
  });

  it('maps a reasoning effort selection onto the request', async () => {
    const captured: Captured = {};
    const adapter = new DeepSeekAdapter({
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

  it('fails (SC-1 surfaces upstream) when no API key resolves', async () => {
    const adapter = new DeepSeekAdapter({ sessionId: 's1', input: 'go', env: {} });
    wire(adapter);
    await expect(adapter.runLoop(SESSION)).rejects.toThrow('no API key');
  });

  it('requires renderNative before runLoop', async () => {
    const adapter = new DeepSeekAdapter({
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
    const adapter = new DeepSeekAdapter({
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

  it('forwards drainSteer into the governed loop so a queued steer turn is injected before the round-trip', async () => {
    const captured: Captured = {};
    const steer = ['also check the tests'];
    const drainSteer = vi.fn(() => steer.splice(0, steer.length));
    const adapter = new DeepSeekAdapter({
      sessionId: 's1',
      input: 'go',
      env: { DEEPSEEK_API_KEY: 'sk-1' },
      fetchImpl: textFetch(captured),
      drainSteer,
    });
    wire(adapter);

    await adapter.runLoop(SESSION);

    expect(drainSteer).toHaveBeenCalled();
    expect(captured.body?.['messages']).toContainEqual({
      role: 'user',
      content: 'also check the tests',
    });
  });

  it('forwards drainQueuedSteer into the governed loop so a queue-mode steer runs after the current turn', async () => {
    const captures: Array<Record<string, unknown> | undefined> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = init.body !== undefined ? JSON.parse(init.body) : undefined;
      captures.push(body);
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          choices: [{ message: { content: captures.length === 1 ? 'done' : 'done again' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      };
    };
    const queued = ['also check the tests'];
    const drainQueuedSteer = vi.fn(() => queued.splice(0, queued.length));
    const adapter = new DeepSeekAdapter({
      sessionId: 's1',
      input: 'go',
      env: { DEEPSEEK_API_KEY: 'sk-1' },
      fetchImpl,
      drainQueuedSteer,
    });
    wire(adapter);

    await adapter.runLoop(SESSION);

    expect(drainQueuedSteer).toHaveBeenCalled();
    // The queued steer forced a SECOND round-trip after the close-gate would have ended.
    expect(captures.length).toBe(2);
    expect(captures[1]?.['messages']).toContainEqual({
      role: 'user',
      content: 'also check the tests',
    });
  });

  it('reports the barebones capability profile and the refs null-fallback', () => {
    const adapter = new DeepSeekAdapter({ sessionId: 's1', input: 'go' });
    expect(adapter.capabilityProfile().ports.refs.present).toBe(false);
    expect(adapter.refs({ name: 'x' })).toBeNull();
  });
});
