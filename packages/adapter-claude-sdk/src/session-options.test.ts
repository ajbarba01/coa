import type { CapabilitySet } from '@coa/shared';
import type { BackendConfig, CanUseTool, StopPredicate } from '@coa/spi';
import { describe, expect, it } from 'vitest';
import { assembleSessionOptions, buildHooks } from './session-options.js';

function backend(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    systemPrompt: 'SP',
    allowedTools: [],
    disallowedTools: [],
    perAgent: {},
    files: [],
    ...overrides,
  };
}

function sandbox(overrides: Partial<CapabilitySet> = {}): CapabilitySet {
  return { allowedTools: [], denyRules: [], permissionMode: 'default', denyRead: [], ...overrides };
}

const allowAll: CanUseTool = () => ({ behavior: 'allow' });
const allowStop: StopPredicate = () => ({ allow: true });

function assemble(over: Partial<Parameters<typeof assembleSessionOptions>[0]> = {}) {
  return assembleSessionOptions({
    sessionId: 's1',
    backend: backend(),
    sandbox: sandbox(),
    canUseTool: allowAll,
    stopPredicate: allowStop,
    ...over,
  });
}

describe('assembleSessionOptions — the per-session query() options', () => {
  it('carries the base options through (the static fields)', () => {
    const opts = assemble({
      backend: backend({ systemPrompt: 'HEAD', allowedTools: ['get_symbol'] }),
    });
    expect(opts.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'HEAD' });
    expect(opts.allowedTools).toEqual(['get_symbol']);
  });

  it('wires the injected per-tool predicate onto the SDK canUseTool, echoing input on allow', async () => {
    const denyEdit: CanUseTool = (call) =>
      call.tool === 'Edit' ? { behavior: 'deny', message: 'demoted' } : { behavior: 'allow' };
    const opts = assemble({ canUseTool: denyEdit });

    const ctx = { signal: new AbortController().signal, toolUseID: 't1' };
    expect(await opts.canUseTool?.('Edit', { file: 'a.ts' }, ctx)).toEqual({
      behavior: 'deny',
      message: 'demoted',
    });
    expect(await opts.canUseTool?.('Read', { file_path: 'b.ts' }, ctx)).toEqual({
      behavior: 'allow',
      updatedInput: { file_path: 'b.ts' },
    });
  });

  it('threads the sessionId into the ToolCall handed to the predicate', async () => {
    let seen = '';
    const capture: CanUseTool = (call) => {
      seen = call.sessionId;
      return { behavior: 'allow' };
    };
    const opts = assemble({ sessionId: 'sess-42', canUseTool: capture });
    await opts.canUseTool?.('Read', {}, { signal: new AbortController().signal, toolUseID: 't' });
    expect(seen).toBe('sess-42');
  });

  it('wires the close-gate onto the Stop hook, blocking the close when the gate denies', async () => {
    const denyStop: StopPredicate = () => ({ allow: false, message: 'open invariant' });
    const opts = assemble({ stopPredicate: denyStop });

    const stopMatchers = opts.hooks?.Stop;
    expect(stopMatchers).toHaveLength(1);
    const cb = stopMatchers?.[0]?.hooks[0];
    const out = await cb?.({ hook_event_name: 'Stop' } as never, undefined, {
      signal: new AbortController().signal,
    });
    expect(out).toEqual({ decision: 'block', reason: 'open invariant' });
  });

  it('passes maxBudgetUsd through only when provided', () => {
    expect(assemble({ maxBudgetUsd: 5 }).maxBudgetUsd).toBe(5);
    expect(assemble().maxBudgetUsd).toBeUndefined();
  });

  it('passes the auth env through only when provided', () => {
    const env = { CLAUDE_CONFIG_DIR: '/d', ANTHROPIC_API_KEY: undefined };
    expect(assemble({ env }).env).toEqual(env);
    expect(assemble().env).toBeUndefined();
  });
});

describe('buildHooks — the multi-event hook assembly', () => {
  const ctx = { signal: new AbortController().signal };
  const preToolUse = (hooks: ReturnType<typeof buildHooks>, name: string, input: unknown) =>
    hooks.PreToolUse?.[0]?.hooks[0]?.(
      { hook_event_name: 'PreToolUse', tool_name: name, tool_input: input } as never,
      undefined,
      ctx,
    );

  it('registers the close-gate on Stop', () => {
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's',
    });
    expect(hooks.Stop).toHaveLength(1);
  });

  it('blocks the close and feeds the gate message back when the gate denies', async () => {
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: false, message: 'open invariant' }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's1',
    });
    const out = await hooks.Stop?.[0]?.hooks[0]?.({ hook_event_name: 'Stop' } as never, undefined, {
      signal: new AbortController().signal,
    });
    expect(out).toEqual({ decision: 'block', reason: 'open invariant' });
  });

  it('denies a spawn at PreToolUse under BOTH delegation spellings', async () => {
    // `system:init.tools` advertises `Task` while the model emits `Agent` in the SAME
    // live run, so a set matching one spelling misses the other.
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'deny', message: 'cost cap reached' }),
      sessionId: 's1',
    });
    for (const name of ['Task', 'Agent']) {
      expect(await preToolUse(hooks, name, { prompt: 'go' })).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'cost cap reached',
        },
      });
    }
  });

  it('allows a permitted spawn without rewriting its input', async () => {
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's1',
    });
    expect(await preToolUse(hooks, 'Agent', { prompt: 'go' })).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    });
  });

  it('abstains on every non-delegation tool, leaving it to canUseTool', async () => {
    // De-dup: canUseTool sees everything EXCEPT delegation, so PreToolUse judging a
    // Read as well would run the predicate twice for one call.
    let calls = 0;
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => {
        calls += 1;
        return { behavior: 'deny', message: 'should not be consulted' };
      },
      sessionId: 's1',
    });
    expect(await preToolUse(hooks, 'Read', { file_path: 'a.ts' })).toEqual({});
    expect(calls).toBe(0);
  });

  it('threads the sessionId into the ToolCall handed to the predicate', async () => {
    let seen = '';
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: (call) => {
        seen = call.sessionId;
        return { behavior: 'allow' };
      },
      sessionId: 'sess-99',
    });
    await preToolUse(hooks, 'Agent', {});
    expect(seen).toBe('sess-99');
  });
});
