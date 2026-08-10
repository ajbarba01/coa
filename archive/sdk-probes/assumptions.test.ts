// Archived (exploratory half) from
// packages/adapter-claude-sdk/src/control/assumptions.test.ts.
// These adversarial audits challenged claims about levers no shipped code uses:
// toolAliases reachability and substitution, the SDK-native subagent plane, the
// per-tool lever inventory survey, the mid-session role:system channel (whose
// canonical guard lives in the in-tree stage-5-6 files), and taskBudget. The
// `captureInit`/`captureSpawn`/`sdkTypes`/`unwrapDoc` helpers they ran on remain
// in the in-tree file, which keeps the audits guarding shipped fixes.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  HOOK_EVENTS,
  type AgentDefinition,
  type PreToolUseHookSpecificOutput,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

// ===========================================================================
// Assumption 1 — the `Agent`/`mcp__coa__` name limit ("One limit worth
// writing down")
// ===========================================================================

describe('assumption 1 — FALSE: "the literal name `Agent` is not available on the Claude path"', () => {
  it('routes a model-emitted `Agent` to a coa MCP tool — the name IS reachable, via toolAliases', async () => {
    // The claim asserts the name is unavailable BECAUSE coa's tools carry the mcp__coa__
    // prefix. `toolAliases` decouples the two: the prefix stays, and the literal name still
    // resolves to coa's governed handler. Verified on the wire, not from the types.
    const capture = await captureInit({
      settingSources: [],
      toolAliases: { Agent: mcpToolName('spawn_agent') },
    });
    expect(capture.initialize?.['toolAliases']).toEqual({ Agent: 'mcp__coa__spawn_agent' });
  }, 30_000);

  it('is documented as exactly this use case — redirecting a built-in name to the host’s own tool', () => {
    const doc = unwrapDoc(sdkTypes('sdk.d.ts'));
    expect(doc).toContain('lets SDK consumers redirect built-in tool names to their own tools');
    expect(doc).toContain('the call is routed to the MCP tool instead of failing as unknown');
  });

  it('NARROWS BUT DOES NOT DELETE the limit: coa’s own schema still cannot be PRESENTED as `Agent`', () => {
    // The half of the claim that survives. coa's MCP server name is a hardcoded
    // constant and the SDK-visible name is derived from it, so the tool the model SEES is
    // still `mcp__coa__spawn_agent`; only the resolution of an emitted `Agent` is coa's.
    expect(mcpToolName('spawn_agent')).toBe('mcp__coa__spawn_agent');
    // And the SDK's own caveat bounds it further: the alias is a name-lookup rewrite only.
    const doc = unwrapDoc(sdkTypes('sdk.d.ts'));
    expect(doc).toContain('the alias only affects name-based lookup of model-emitted');
    // VERDICT: the stated limit ("the literal name `Agent` is therefore not available")
    // is FALSE. The narrower true statement is: coa cannot put the name on its own tool
    // SCHEMA, but it can own everything the name DOES. Whether the CLI honours an alias for a
    // name whose native tool is absent is live-only.
  });
});

// ===========================================================================
// Assumption 6 — substituting an implementation for a native tool
// ===========================================================================

describe('assumption 6 — FALSE: "coa cannot substitute its own implementation for a native tool"', () => {
  it('is the documented purpose of toolAliases — a built-in name executing coa’s handler', async () => {
    const capture = await captureInit({
      settingSources: [],
      toolAliases: { Bash: mcpToolName('bash'), Read: mcpToolName('read') },
    });
    expect(capture.initialize?.['toolAliases']).toEqual({
      Bash: 'mcp__coa__bash',
      Read: 'mcp__coa__read',
    });
    expect(unwrapDoc(sdkTypes('sdk.d.ts'))).toContain(
      'a host that runs Bash inside a remote sandbox via an MCP tool can set',
    );
  }, 30_000);

  it('also lets coa rewrite a native tool’s INPUT before it runs, and its SCHEMA before the model sees it', () => {
    // Two more substitution seams short of a full swap.
    const rewrite: Required<PreToolUseHookSpecificOutput> = {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'coa normalised the call',
      updatedInput: { file_path: '/repo/only/here' },
      additionalContext: 'coa',
    };
    expect(rewrite.updatedInput).toEqual({ file_path: '/repo/only/here' });

    const doc = unwrapDoc(sdkTypes('sdk.d.ts'));
    expect(doc).toContain(
      'Per-tool configuration for built-in tools. Allows SDK consumers to customize tool behavior that the CLI hardcodes.',
    );
    expect(doc).toContain('how the field is described in the tool schema');
  });

  it('BOUNDS the refutation: the swap is at the model-emission boundary, not total', () => {
    // Two limits that survive, stated so the FALSE verdict is not overread.
    const doc = unwrapDoc(sdkTypes('sdk.d.ts'));
    // (1) An alias does not cover harness-internal direct calls.
    expect(doc).toContain('whereas `disallowedTools` also blocks harness-internal direct calls');
    // (2) PreToolUse still has no result-bearing field, so coa cannot ANSWER a native tool call.
    const full: Required<PreToolUseHookSpecificOutput> = {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'probe',
      updatedInput: {},
      additionalContext: 'probe',
    };
    expect(Object.keys(full)).not.toContain('toolResult');
  });
});

// ===========================================================================
// Assumption 7 — "the harness's own subagents are ungovernable"
// ===========================================================================

describe('assumption 7 — FALSE (premise): "a subagent must be a coa session because the harness’s own subagents are ungovernable"', () => {
  const child = {
    description: 'a governed child',
    prompt: 'You are a coa-governed worker.',
    model: 'claude-haiku-4-5',
    tools: ['Read'],
    disallowedTools: ['Bash'],
    maxTurns: 3,
    permissionMode: 'plan',
    effort: 'low',
  } as const satisfies AgentDefinition;

  it('transmits a per-child tool frame, model, turn cap and permission mode', async () => {
    const capture = await captureInit({ settingSources: [], agents: { worker: child } });
    expect(capture.initialize?.['agents']).toEqual({ worker: child });
  }, 30_000);

  it('exposes an UNDECLARED lever the survey missed: appendSubagentSystemPrompt reaches the wire', async () => {
    // Not on the `Options` type at all — the SDK reads it straight off the options object
    // (`appendSubagentSystemPrompt: u.appendSubagentSystemPrompt` in sdk.mjs). It is coa's
    // standing authority applied to every NATIVE child's system prompt, which is the single
    // strongest counterexample to "ungovernable". Undeclared means unsupported: recorded as a
    // finding, not as something to lean on without a live check.
    const capture = await captureInit({
      settingSources: [],
      appendSubagentSystemPrompt: 'coa governs every child of this session.',
    });
    expect(capture.initialize?.['appendSubagentSystemPrompt']).toBe(
      'coa governs every child of this session.',
    );
    // The tripwire: if a future SDK declares it, this stops being a finding and starts being API.
    const optionsKeys = sdkTypes('sdk.d.ts').slice(
      sdkTypes('sdk.d.ts').indexOf('export declare type Options = {'),
    );
    expect(optionsKeys.slice(0, optionsKeys.indexOf('\n};'))).not.toContain(
      'appendSubagentSystemPrompt?:',
    );
  }, 30_000);

  it('gives coa lifecycle hooks, a deny point, a transcript read and a kill switch over native children', async () => {
    expect(HOOK_EVENTS).toContain('SubagentStart');
    expect(HOOK_EVENTS).toContain('SubagentStop');

    const capture = await captureInit({
      settingSources: [],
      forwardSubagentText: true,
      hooks: {
        SubagentStart: [{ hooks: [async () => ({ continue: true })] }],
        PreToolUse: [{ matcher: 'Agent|Task', hooks: [async () => ({ continue: true })] }],
      },
    });
    expect(capture.initialize?.['forwardSubagentText']).toBe(true);
    expect(JSON.stringify(capture.initialize?.['hooks'])).toContain('SubagentStart');

    const types = sdkTypes('sdk.d.ts');
    expect(types).toContain('stopTask(');
    expect(types).toContain('export declare function listSubagents(');
    expect(types).toContain('export declare function getSubagentMessages(');
  }, 30_000);

  it('finds a REAL governance hole in the native path, which the ungovernable claim did not name', () => {
    // The calling MODEL — not coa — picks the child's permission mode and isolation on each
    // spawn, and `bypassPermissions` is in that union. That is a genuine risk, and it is also
    // the thing PreToolUse.updatedInput exists to fix: coa can rewrite the spawn input before
    // it runs. So the honest reading is "governable, but only if coa intercepts the spawn",
    // not "ungovernable".
    const agentInput = sdkTypes('sdk-tools.d.ts');
    const start = agentInput.indexOf('export interface AgentInput {');
    const body = agentInput.slice(start, agentInput.indexOf('\n}', start));
    expect(body).toContain('"bypassPermissions"');
    expect(body).toContain('isolation?: "worktree" | "remote"');
    // UNSETTLED and stated as such: every assertion above proves TRANSMISSION. Whether the CLI
    // honours a per-agent frame, and whether `canUseTool` fires for a child's tool calls, are
    // live facts. The premise "ungovernable" is refuted; "fully governable" is NOT established.
  });
});

// ===========================================================================
// Assumption 8 — the per-tool lever inventory
// ===========================================================================

describe('assumption 8 — FALSE: "disallowedTools and canUseTool are coa’s only per-tool levers"', () => {
  it('counts at least six more at session construction', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      tools: ['Read'],
      allowedTools: ['Read'],
      disallowedTools: ['Bash'],
      permissionMode: 'plan',
      settings: { permissions: { deny: ['Bash(rm:*)'] } },
    });
    expect(capture.flag('--tools')).toBe('Read');
    expect(capture.flag('--allowedTools')).toBe('Read');
    expect(capture.flag('--disallowedTools')).toBe('Bash');
    expect(capture.flag('--permission-mode')).toBe('plan');
    expect(capture.json<{ permissions: { deny: string[] } }>('--settings')).toEqual({
      permissions: { deny: ['Bash(rm:*)'] },
    });

    const wire = await captureInit({
      settingSources: [],
      toolAliases: { Bash: 'mcp__coa__bash' },
      agents: { worker: { description: 'd', prompt: 'p', disallowedTools: ['Bash'] } },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [async () => ({ continue: true })] }] },
    });
    expect(wire.initialize?.['toolAliases']).toEqual({ Bash: 'mcp__coa__bash' });
    expect(JSON.stringify(wire.initialize?.['agents'])).toContain('disallowedTools');
    expect(JSON.stringify(wire.initialize?.['hooks'])).toContain('PreToolUse');
  }, 60_000);

  it('and four MID-SESSION ones on the Query handle, which the assumption omits entirely', () => {
    // Per-tool control is not fixed at construction. `applyFlagSettings` merges a
    // `permissions` object mid-session; the MCP verbs add and gate whole tool servers.
    const types = sdkTypes('sdk.d.ts');
    for (const method of [
      'applyFlagSettings(',
      'setMcpServers(',
      'toggleMcpServer(',
      'setMcpPermissionModeOverride(',
    ]) {
      expect(types).toContain(method);
    }
    expect(unwrapDoc(types)).toContain(
      'Merge the provided settings into the flag settings layer, dynamically updating the active configuration.',
    );
  });
});

// ===========================================================================
// Assumption 9 — a mid-session role:system channel (render-native.ts:44-45)
// ===========================================================================

describe('assumption 9 — UNSETTLED: "there is no programmatic mid-session role:system channel" (labelled a verified SDK fact)', () => {
  it('removes the SDK-side basis for the claim: the type admits `system` and the frame ships verbatim', async () => {
    const declarations = readFileSync(
      require_.resolve('@anthropic-ai/sdk/resources/messages/messages').replace(/\.m?js$/, '.d.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(declarations).toMatch(
      /export interface MessageParam \{[\s\S]*?role: 'user' \| 'assistant' \| 'system';/,
    );

    const capture = await captureInit({ settingSources: [] }, [
      {
        type: 'user',
        message: { role: 'system', content: 'coa standing authority' },
        parent_tool_use_id: null,
      },
      { type: 'user', message: { role: 'user', content: 'hello' }, parent_tool_use_id: null },
    ]);
    const userFrames = capture.frames.filter((frame) => frame['type'] === 'user');
    expect(userFrames).toHaveLength(2);
    const message = userFrames[0]?.['message'];
    expect(isRecord(message) ? message['role'] : undefined).toBe('system');
    expect(isRecord(message) ? message['content'] : undefined).toBe('coa standing authority');
  }, 30_000);

  it('DOWNGRADES the sibling verdict: the two halves were separate probes, and neither reaches the CLI', async () => {
    // Stage 5 asserted (a) a role:system frame ships verbatim and (b) `shouldQuery?: boolean`
    // exists with a doc saying a message can land without a turn — as two independent probes.
    // Combined here for the first time: BOTH survive on one frame.
    const capture = await captureInit({ settingSources: [] }, [
      {
        type: 'user',
        message: { role: 'system', content: 'coa standing authority' },
        parent_tool_use_id: null,
        shouldQuery: false,
      },
    ]);
    const frame = capture.frames.find((f) => f['type'] === 'user');
    expect(frame?.['shouldQuery']).toBe(false);
    const message = frame?.['message'];
    expect(isRecord(message) ? message['role'] : undefined).toBe('system');

    // …and that still settles nothing about acceptance. Every assertion above is about what
    // the SDK WRITES. The consumer is a compiled CLI this harness never runs, and behind it an
    // API that historically rejects a `system` role inside `messages`. So:
    //   - "there is no programmatic role:system channel" — NO LONGER SUPPORTED by the SDK
    //     surface, therefore the "verified SDK fact" label in render-native.ts:44-45 is stale.
    //   - "coa HAS a mid-session system channel" — NOT ESTABLISHED.
    // Verdict: UNSETTLED. It is a live probe, and it must not be rounded either way.
  }, 30_000);

  it('names the mid-session channels that ARE settled, so the unsettled one is not the only option', () => {
    const types = sdkTypes('sdk.d.ts');
    // A hook-borne injection channel on turn-scoped events…
    expect(types).toContain('additionalContext');
    // …and a mid-session settings merge. Neither is `role:system`; both are real.
    expect(types).toContain('applyFlagSettings(');
  });
});

describe('sibling challenge — stage 7: taskBudget is tokens, query-bound, no per-agent counterpart', () => {
  it('CONFIRMS it, and strengthens it with the probe the sibling did not run', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      taskBudget: { total: 1000 },
      maxBudgetUsd: 1,
    });
    expect(capture.flag('--task-budget')).toBe('1000');
    expect(capture.flag('--max-budget-usd')).toBe('1');

    const doc = unwrapDoc(sdkTypes('sdk.d.ts'));
    expect(doc).toContain('API-side task budget in tokens');
    expect(doc).toContain(
      'the model is made aware of its remaining token budget so it can pace tool use',
    );

    // The sibling checked `AgentDefinition` for a budget field. The other place a per-child
    // budget could live is the delegation tool's OWN input schema, which the calling model
    // fills in — checked here for the first time. It is not there either.
    const tools = sdkTypes('sdk-tools.d.ts');
    const start = tools.indexOf('export interface AgentInput {');
    const body = tools.slice(start, tools.indexOf('\n}', start));
    expect(body).not.toMatch(/budget/i);
    expect(body).not.toMatch(/max_tokens/i);
    // So: tokens, root-only, pacing hint rather than enforced cap, and a child cannot be
    // ring-fenced from either channel. The sibling verdict HOLDS.
  }, 30_000);
});
