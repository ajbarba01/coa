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
  const postToolUse = (hooks: ReturnType<typeof buildHooks>, name: string) =>
    hooks.PostToolUse?.[0]?.hooks[0]?.(
      { hook_event_name: 'PostToolUse', tool_name: name, tool_input: {} } as never,
      undefined,
      ctx,
    );
  const stopHook = (hooks: ReturnType<typeof buildHooks>) =>
    hooks.Stop?.[0]?.hooks[0]?.({ hook_event_name: 'Stop' } as never, undefined, ctx);

  it('registers the close-gate on Stop', () => {
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's',
      observeChanges: () => {},
    });
    expect(hooks.Stop).toHaveLength(1);
  });

  it('blocks the close and feeds the gate message back when the gate denies', async () => {
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: false, message: 'open invariant' }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's1',
      observeChanges: () => {},
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
      observeChanges: () => {},
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

  it('lets a permitted spawn through by abstaining, never by granting', async () => {
    // This previously asserted an explicit `allow`. An explicit allow at PreToolUse is an
    // AUTO-APPROVE — the same class of mistake as routing allow-intent onto `allowedTools`
    // — so coa now abstains and lets the harness's own flow proceed.
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's1',
      observeChanges: () => {},
    });
    expect(await preToolUse(hooks, 'Agent', { prompt: 'go' })).toEqual({});
  });

  it('consults the predicate for every tool, not just delegation', async () => {
    // This asserted the opposite under the earlier two-seam design, whose de-dup rule
    // kept canUseTool primary and had PreToolUse abstain on everything but a spawn. The
    // gate run of 2026-08-03 measured canUseTool not firing for an ordinary in-cwd Read,
    // so abstaining here left the call ungoverned by BOTH seams rather than one.
    const seen: string[] = [];
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: (call) => {
        seen.push(call.tool);
        return { behavior: 'allow' };
      },
      sessionId: 's1',
      observeChanges: () => {},
    });
    for (const name of ['Read', 'Bash', 'Write', 'Agent']) await preToolUse(hooks, name, {});
    expect(seen).toEqual(['Read', 'Bash', 'Write', 'Agent']);
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
      observeChanges: () => {},
    });
    await preToolUse(hooks, 'Agent', {});
    expect(seen).toBe('sess-99');
  });

  it('denies an ordinary built-in call at PreToolUse', async () => {
    // The 2026-08-03 gate run measured canUseTool not being consulted for a plain in-cwd
    // Read, so a gate that only judged delegation left every other call ungoverned.
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'deny', message: 'over cap' }),
      sessionId: 's1',
      observeChanges: () => {},
    });
    expect(await preToolUse(hooks, 'Read', { file_path: 'a.ts' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'over cap',
      },
    });
  });

  it('abstains rather than asserting allow, so coa only ever blocks', async () => {
    // coa has two blocks and zero grants (help, never cage). An explicit `allow` here is an
    // auto-approve that would suppress any prompt the harness would otherwise raise.
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's1',
      observeChanges: () => {},
    });
    expect(await preToolUse(hooks, 'Bash', { command: 'ls' })).toEqual({});
  });

  it('drives observeChanges after every tool call, whatever the tool was', async () => {
    // coa does NOT parse tool_input per tool: the reconciler scans the worktree itself,
    // so one trigger covers a native Edit, a Write, and any file a Bash command touched —
    // which per-tool parsing would miss entirely.
    let observed = 0;
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's1',
      observeChanges: () => {
        observed += 1;
      },
    });
    const postToolUse = (name: string) =>
      hooks.PostToolUse?.[0]?.hooks[0]?.(
        {
          hook_event_name: 'PostToolUse',
          tool_name: name,
          tool_input: {},
          tool_response: {},
          tool_use_id: 'tu_1',
        } as never,
        undefined,
        ctx,
      );
    expect(await postToolUse('Edit')).toEqual({});
    await postToolUse('Bash');
    expect(observed).toBe(2);
  });

  it('returns pending deliveries as additionalContext and still observes', async () => {
    const observed: number[] = [];
    const pending = [
      { origin: 'user' as const, text: 'stop and check the schema first' },
      { origin: 'system' as const, text: 'subagent explorer finished' },
    ];
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's1',
      observeChanges: () => observed.push(1),
      drainDeliveries: () => pending.splice(0, pending.length),
    });
    const out = await postToolUse(hooks, 'Read');
    expect(observed).toEqual([1]);
    expect(out?.hookSpecificOutput?.additionalContext).toContain('stop and check the schema first');
    expect(out?.hookSpecificOutput?.additionalContext).toContain('subagent explorer finished');
  });

  it('omits additionalContext when nothing is pending', async () => {
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's1',
      observeChanges: () => {},
      drainDeliveries: () => [],
    });
    const out = await postToolUse(hooks, 'Read');
    expect(out).toEqual({});
  });

  it('delivers pending text at an allowed stop so the conversation continues', async () => {
    // The floor: PostToolUse never fires when the model answers in plain text with no
    // tool call, so Stop is the only remaining point before the turn ends. `continue`
    // must survive alongside the delivery — toStopHookOutput's allowed branch returns
    // `{ continue: true }`, not an empty object, so replacing it outright would drop it.
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's1',
      observeChanges: () => {},
      drainDeliveries: () => [{ origin: 'system' as const, text: 'explorer finished' }],
    });
    const out = await stopHook(hooks);
    expect(out?.hookSpecificOutput?.additionalContext).toContain('explorer finished');
    expect(out?.continue).toBe(true);
  });

  it('lets an allowed close-gate continue when nothing is pending — the mainline stop', async () => {
    // The ordinary close of EVERY governed turn: allowed, nothing queued. `continue: true`
    // is the gate's own allow signal, so returning a bare `{}` here would drop it on every
    // turn in the product while the delivery-specific tests above still passed.
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's1',
      observeChanges: () => {},
      drainDeliveries: () => [],
    });
    expect(await stopHook(hooks)).toEqual({ continue: true });
  });

  it('lets an allowed close-gate continue with no delivery port wired at all (pass-through degrade)', async () => {
    // The absent-option path: a caller that never supplies `drainDeliveries` must behave
    // byte-identically to the pre-delivery product.
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: true }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's1',
      observeChanges: () => {},
    });
    expect(await stopHook(hooks)).toEqual({ continue: true });
  });

  it('leaves a blocked close-gate decision untouched, never draining', async () => {
    // Draining is destructive: a blocked stop's decision is final (it is one of the
    // system's two sanctioned blocks), so calling
    // drainDeliveries at all here would silently swallow the pending text on a path
    // that discards the result.
    const drained: number[] = [];
    const hooks = buildHooks({
      stopPredicate: () => ({ allow: false, message: 'Cannot close: 1 unresolved check' }),
      canUseTool: () => ({ behavior: 'allow' }),
      sessionId: 's1',
      observeChanges: () => {},
      drainDeliveries: () => {
        drained.push(1);
        return [];
      },
    });
    const out = await stopHook(hooks);
    expect(out).toEqual({ decision: 'block', reason: 'Cannot close: 1 unresolved check' });
    expect(drained).toEqual([]);
  });
});
