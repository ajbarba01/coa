import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  HOOK_EVENTS,
  query,
  resolveSettings,
  type AgentDefinition,
  type Options,
  type PreToolUseHookSpecificOutput,
  type SDKUserMessage,
  type SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk';
import type { NeutralConfig } from '@coa/shared';
import type { BackendConfig } from '@coa/spi';
import { describe, expect, it } from 'vitest';
import { sessionAuthEnv } from '../auth-env.js';
import { mcpToolName } from '../mcp-tools.js';
import { renderNative } from '../render-native.js';
import { buildBaseOptions } from '../sdk-options.js';
import { KNOWN_BUILTINS, resolveToolTransport } from '../tool-frame.js';
import { captureSpawn } from './probe-kit.js';

/**
 * **Task 10 — the adversarial assumption audit.**
 *
 * Written by an agent that made none of the claims below. Every probe is an attempt to
 * BREAK a claim coa's shipped code, its design docs, or a sibling spike agent asserted
 * about `@anthropic-ai/claude-agent-sdk` **0.3.196** / bundled CLI **2.1.196**
 * (`a4ca500badcac68511fb5f04303e32e4360f3dfb`). Nothing here is a claim about any other
 * version.
 *
 * Each `describe` names one assumption and carries its verdict in the title:
 *
 * - **HOLDS** — a probe exercises the lever and the claim survives.
 * - **FALSE** — a probe demonstrates the opposite.
 * - **UNSETTLED** — the offline surface cannot decide it. This is a legitimate result and
 *   is never rounded to either side. Where the SDK-side basis for a claim is gone but the
 *   CLI-side behaviour is unobservable from here, the verdict is UNSETTLED, not FALSE.
 *
 * ## What an offline probe can and cannot prove
 *
 * The SDK splits one `Options` object across **two** channels:
 *
 * - **argv** — `--tools`, `--allowedTools`, `--disallowedTools`, `--setting-sources`,
 *   `--task-budget`, `--session-mirror`, …
 * - **the stdin `initialize` control request** — `systemPrompt`, `appendSystemPrompt`,
 *   `toolAliases`, `agents`, `hooks`, `forwardSubagentText`, …
 *
 * An argv-only probe therefore reports stdio-borne options as *absent* even when they are
 * fully supported, which reads as a false negative. {@link captureInit} below captures the
 * stdio channel; `captureSpawn` (probe-kit) captures argv. Both prove **transmission**.
 * Neither proves **honouring** — that is a live fact, and where it matters the probe says so
 * rather than inferring.
 *
 * The shipped `sdk.d.ts` uses CRLF, so {@link sdkTypes} normalises line endings before any
 * regex runs. A pattern written with `\n` against the raw file silently fails to match and
 * would manufacture a false negative.
 */

const require_ = createRequire(import.meta.url);
const SDK_DIR = dirname(require_.resolve('@anthropic-ai/claude-agent-sdk'));

const typingsCache = new Map<string, string>();
/** A shipped typings file, CRLF-normalised. Structural evidence only, never behavioural. */
function sdkTypes(file: 'sdk.d.ts' | 'sdk-tools.d.ts'): string {
  const cached = typingsCache.get(file);
  if (cached !== undefined) return cached;
  const text = readFileSync(join(SDK_DIR, file), 'utf8').replace(/\r\n/g, '\n');
  typingsCache.set(file, text);
  return text;
}

/** Collapse TSDoc wrapping so a sentence broken across lines matches as one string. */
function unwrapDoc(source: string): string {
  return source.replace(/\s*\n\s*\*\s?/g, ' ');
}

/** Fields the SDK reads off `Options` at runtime but does not declare on the `Options` type. */
type UndeclaredOptions = Options & { appendSubagentSystemPrompt?: string };

/** A `SpawnedProcess` that records every byte the SDK writes to the CLI's stdin. */
function recordingProcess(frames: string[]): SpawnedProcess {
  const stdin = new PassThrough();
  stdin.on('data', (chunk: Buffer) => frames.push(chunk.toString('utf8')));
  return {
    stdin,
    stdout: new PassThrough(),
    killed: false,
    exitCode: null,
    kill: (): boolean => true,
    on: (): void => {},
    once: (): void => {},
    off: (): void => {},
  } as unknown as SpawnedProcess;
}

interface WireCapture {
  /** The `request` payload of the `initialize` control request, or undefined if none arrived. */
  readonly initialize: Record<string, unknown> | undefined;
  /** Every NDJSON frame the SDK wrote, in order. */
  readonly frames: readonly Record<string, unknown>[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Run one `query()` against an in-process fake `SpawnedProcess` and return what the SDK
 * wrote to its stdin. Faster and more precise than a stub executable: no subprocess, and
 * the fake never answers, so the SDK gets exactly as far as `initialize` plus the prompt —
 * the window that carries every stdio-borne option.
 */
async function captureInit(
  options: UndeclaredOptions,
  messages?: readonly SDKUserMessage[],
): Promise<WireCapture> {
  const frames: string[] = [];
  const controller = new AbortController();
  const prompt: string | AsyncGenerator<SDKUserMessage> =
    messages === undefined
      ? 'probe'
      : (async function* (): AsyncGenerator<SDKUserMessage> {
          for (const message of messages) yield message;
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        })();

  const q = query({
    prompt,
    options: {
      ...options,
      abortController: controller,
      spawnClaudeCodeProcess: () => recordingProcess(frames),
    } as Options,
  });
  const drained = (async (): Promise<void> => {
    try {
      for await (const _message of q) break;
    } catch {
      // Expected: the fake process never speaks stream-json back.
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  controller.abort();
  try {
    await q.return();
  } catch {
    // Expected.
  }
  await Promise.race([drained, new Promise((resolve) => setTimeout(resolve, 800))]);

  const parsed = frames
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown)
    .filter(isRecord);
  const envelope = parsed.find(
    (frame) =>
      frame['type'] === 'control_request' &&
      isRecord(frame['request']) &&
      frame['request']['subtype'] === 'initialize',
  );
  const request =
    envelope !== undefined && isRecord(envelope['request']) ? envelope['request'] : undefined;
  return { initialize: request, frames: parsed };
}

const emptyBackend = (): BackendConfig => ({
  systemPrompt: '',
  allowedTools: [],
  disallowedTools: [],
  perAgent: {},
});

const neutral = (overrides: Partial<NeutralConfig> = {}): NeutralConfig => ({
  prefixHead: [],
  systemReminders: [],
  onDemandPullable: [],
  scopePushed: [],
  toolIntents: { allow: [], deny: [] },
  ...overrides,
});

// ===========================================================================
// Assumption 1 — the `Agent`/`mcp__coa__` name limit (arc design, "One limit
// worth writing down")
// ===========================================================================

describe('assumption 1 — FALSE: "the literal name `Agent` is not available on the Claude path"', () => {
  it('routes a model-emitted `Agent` to a coa MCP tool — the name IS reachable, via toolAliases', async () => {
    // The arc asserts the name is unavailable BECAUSE coa's tools carry the mcp__coa__
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
    // The half of the arc's claim that survives. coa's MCP server name is a hardcoded
    // constant and the SDK-visible name is derived from it, so the tool the model SEES is
    // still `mcp__coa__spawn_agent`; only the resolution of an emitted `Agent` is coa's.
    expect(mcpToolName('spawn_agent')).toBe('mcp__coa__spawn_agent');
    // And the SDK's own caveat bounds it further: the alias is a name-lookup rewrite only.
    const doc = unwrapDoc(sdkTypes('sdk.d.ts'));
    expect(doc).toContain('the alias only affects name-based lookup of model-emitted');
    // VERDICT: the arc's stated limit ("the literal name `Agent` is therefore not available")
    // is FALSE. The narrower true statement is: coa cannot put the name on its own tool
    // SCHEMA, but it can own everything the name DOES. Whether the CLI honours an alias for a
    // name whose native tool is absent is live-only.
  });
});

// ===========================================================================
// Assumption 2 — `settingSources: []` "fully isolates" (sdk-options.ts:98-106)
// ===========================================================================

describe('assumption 2 — FALSE: "settingSources: [] fully isolates the session from the target repo’s config"', () => {
  it('does isolate the channel it covers: user/project/local settings files', async () => {
    // The true half, run through the SDK's own merge engine (`resolveSettings`), which the
    // package documents as the same engine the CLI uses.
    const dir = mkdtempSync(join(tmpdir(), 'coa-assume-settings-'));
    mkdirSync(join(dir, '.claude'));
    writeFileSync(
      join(dir, '.claude', 'settings.json'),
      JSON.stringify({
        env: { FROM_TARGET_REPO: 'leaked' },
        permissions: { deny: ['Bash(rm:*)'] },
      }),
      'utf8',
    );

    const loaded = await resolveSettings({ cwd: dir, settingSources: ['project'] });
    expect(loaded.effective['env']).toEqual({ FROM_TARGET_REPO: 'leaked' });

    const isolated = await resolveSettings({ cwd: dir, settingSources: [] });
    expect(isolated.effective).toEqual({});
  }, 30_000);

  it('BREAKS the claim: a policy tier still applies with settingSources: [] — and is read from disk', async () => {
    // The decisive counterexample, runtime-verified. `settingSources: []` governs the three
    // FILESYSTEM sources only; the managed/policy tier is a separate cascade layer that is
    // still resolved. The SDK's own doc says so in as many words.
    const dir = mkdtempSync(join(tmpdir(), 'coa-assume-policy-'));
    const resolved = await resolveSettings({
      cwd: dir,
      settingSources: [],
      managedSettings: { permissions: { deny: ['Bash(curl:*)'] } },
    });
    expect(resolved.sources.map((source) => source.source)).toContain('managed');
    expect(resolved.effective['permissions']).toEqual({ deny: ['Bash(curl:*)'] });

    const doc = unwrapDoc(sdkTypes('sdk.d.ts'));
    expect(doc).toContain(
      'Pass `[]` to skip user/project/local sources — the managed-settings policy tier is still read from disk',
    );
  }, 30_000);

  it('BREAKS the claim: project `.mcp.json` needs a SECOND option (strictMcpConfig), not settingSources', () => {
    // `.mcp.json` is not one of the three settings files, so `settingSources` cannot reach it.
    // The SDK gives that job to a different flag entirely — and enumerates the sources by name.
    const doc = unwrapDoc(sdkTypes('sdk.d.ts'));
    expect(doc).toContain(
      'ignoring all other MCP configurations: project `.mcp.json`, user settings, plugins, and on-disk agent frontmatter',
    );
    // coa does set it — so coa is covered. The ASSUMPTION, which credits settingSources alone,
    // is still wrong: it takes two options, and only one of them is what the comment cites.
    const opts = buildBaseOptions({ backend: emptyBackend(), sandbox: sandboxSet() });
    expect(opts.settingSources).toEqual([]);
    expect(opts.strictMcpConfig).toBe(true);
  });

  it('the leak is CLOSED: `skills` unset was never "skills off," so coa now sets it explicitly', async () => {
    // The SDK states the default explicitly: omitting `skills` is *not* "skills off" — the
    // CLI's own discovery defaults still apply, independent of settingSources. That gap is
    // exactly why coa sets the option directly rather than leaving it unset.
    // Asserted against the raw (CRLF-normalised) text on a single doc line rather than through
    // unwrapDoc: this sentence wraps with a hanging indent, which unwrapDoc leaves as extra
    // interior whitespace, so an unwrapped match would fail for a reason unrelated to the claim.
    expect(sdkTypes('sdk.d.ts')).toContain(`still apply, so this is **not** "skills off."`);

    const opts = buildBaseOptions({ backend: emptyBackend(), sandbox: sandboxSet() });
    expect(opts.skills).toEqual([]);

    // The fix is invisible on argv: an empty array folds to zero `Skill(...)` entries, the
    // same as an omitted option producing none — so argv cannot tell "closed" from "leaky"
    // apart. The distinction lives on the OTHER wire channel, the stdio `initialize` request:
    // `Array.isArray(skills) ? skills : void 0` transmits `[]` as an empty array but transmits
    // an omitted option as absent. That contrast is the actual measured effect of the fix.
    const closed = await captureInit({ settingSources: [], skills: [] });
    expect(closed.initialize?.['skills']).toEqual([]);

    const leaky = await captureInit({ settingSources: [] });
    expect(leaky.initialize?.['skills']).toBeUndefined();
  }, 30_000);

  it('BREAKS the claim: a per-agent `memory` scope reads the target repo regardless of settingSources', () => {
    // `AgentDefinition.memory: 'project'` is documented to auto-load
    // `.claude/agent-memory/<agentType>/` — target-repo files, on a channel settingSources
    // does not appear on.
    const doc = unwrapDoc(sdkTypes('sdk.d.ts'));
    expect(doc).toContain("'project' - .claude/agent-memory/<agentType>/");
  });

  it('the re-anchor file is GONE: standing authority ships only where it can load', () => {
    // Was a live bug: renderNative wrote `.claude/CLAUDE.md`, which cannot load under
    // settingSources: [], and BackendConfig.files was consumed by nobody.
    expect(sdkTypes('sdk.d.ts')).toContain("Must include `'project'` to load CLAUDE.md files.");
    const rendered = renderNative(
      neutral({ systemReminders: [{ rule: 'no-silent-pretend', reason: 'SC-1', tier: 0 }] }),
    );
    expect(rendered).not.toHaveProperty('files');
    expect(rendered.systemPrompt).toContain('no-silent-pretend');
  });
});

function sandboxSet(): Parameters<typeof buildBaseOptions>[0]['sandbox'] {
  return { allowedTools: [], denyRules: [], permissionMode: 'default', denyRead: [] };
}

// ===========================================================================
// Assumption 3 — the `claude_code` preset (sdk-options.ts:88-91)
// ===========================================================================

describe('assumption 3 — HOLDS (narrowly): "layering on the claude_code preset is the only way to keep the baseline"', () => {
  it('is the ONLY Options shape that leaves the system prompt to the harness', async () => {
    // Tried to break it four ways. Only the preset object produces a wire request with no
    // `systemPrompt` key; every other form sends a concrete replacement value.
    const preset = await captureInit({
      settingSources: [],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
    });
    expect(preset.initialize?.['systemPrompt']).toBeUndefined();

    const raw = await captureInit({ settingSources: [], systemPrompt: 'coa owns this' });
    expect(raw.initialize?.['systemPrompt']).toEqual(['coa owns this']);

    const blocks = await captureInit({ settingSources: [], systemPrompt: ['a', 'b'] });
    expect(blocks.initialize?.['systemPrompt']).toEqual(['a', 'b']);

    // The one that looks like a second route and is not: OMITTING systemPrompt does not fall
    // through to the preset — the wrapper substitutes an empty custom prompt.
    const omitted = await captureInit({ settingSources: [] });
    expect(omitted.initialize?.['systemPrompt']).toEqual(['']);
  }, 60_000);

  it('makes `append` reachable from the preset object and nowhere else', async () => {
    // The layering mechanism is a SIBLING wire field, `appendSystemPrompt` — but the only
    // Options value that can populate it is `{type:'preset', append}`. So the assumption's
    // conclusion holds even though its stated mechanism ("layering on the preset") is not how
    // the wire expresses it.
    const capture = await captureInit({
      settingSources: [],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'coa governance layer' },
    });
    expect(capture.initialize?.['systemPrompt']).toBeUndefined();
    expect(capture.initialize?.['appendSystemPrompt']).toBe('coa governance layer');

    // Break-it: a raw string cannot reach `appendSystemPrompt` at all — it replaces instead.
    const raw = await captureInit({ settingSources: [], systemPrompt: 'coa governance layer' });
    expect(raw.initialize?.['appendSystemPrompt']).toBeUndefined();
  }, 30_000);

  it('SCOPES the claim: "baseline behaviour" is bigger than the prompt, and the preset is not all-or-nothing', async () => {
    // Two qualifications the assumption as written does not carry.
    // (1) `excludeDynamicSections` keeps the preset while STRIPPING part of it, so "keep the
    //     baseline" is a dial, not a switch.
    const trimmed = await captureInit({
      settingSources: [],
      systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
    });
    expect(trimmed.initialize?.['excludeDynamicSections']).toBe(true);
    // (2) The built-in TOOL baseline is a separate preset on a separate channel (argv), so the
    //     systemPrompt preset does not carry it.
    const tools = await captureSpawn({
      settingSources: [],
      tools: { type: 'preset', preset: 'claude_code' },
    });
    expect(tools.flag('--tools')).toBe('default');
    // UNSETTLED, named rather than guessed: `Options.agent` + `agents[name].prompt` selects a
    // main-thread agent with its own system prompt. Whether that layers on the preset or
    // replaces it is CLI-side and unobservable here.
  }, 30_000);
});

// ===========================================================================
// Assumption 4 — version-aware demote set across Task→Agent (arc risk R2)
// ===========================================================================

describe('assumption 4 — HOLDS: "the demote set must be version-aware across the Task→Agent rename"', () => {
  it('names the tool `Agent` in the generated schemas, with no Task counterpart', () => {
    const tools = sdkTypes('sdk-tools.d.ts');
    expect(tools).toContain('export interface AgentInput {');
    expect(tools).toContain('export type AgentOutput =');
    // Written against the CRLF-normalised text, and anchored on the full declaration header
    // so the `TaskCreate`/`TaskGet`/`TaskStop` tools (which are real and unrelated) cannot
    // accidentally satisfy it.
    expect(tools).not.toContain('export interface TaskInput {');
    expect(tools).not.toContain('export type TaskOutput =');
  });

  it('disagrees with ITSELF inside one shipped version — which is exactly what "version-aware" must absorb', () => {
    const types = sdkTypes('sdk.d.ts');
    expect(types).toContain('invoked via the Agent tool');
    expect(types).toContain('invoked via the Task tool');
    expect(sdkTypes('sdk-tools.d.ts')).toContain('hasTaskTool');
  });

  it('leaves the runtime spelling free-form, so no type can settle which arrives', () => {
    const types = sdkTypes('sdk.d.ts');
    expect(types).toContain('tool_name: string;');
    expect(types).toContain('tools: string[];');
  });
});

// ===========================================================================
// Assumption 5 — allowlist vs denylist for removing the delegation tool
// ===========================================================================

describe('assumption 5 — FALSE: "removing the native delegation tool requires the allowlist; the denylist is the wrong lever"', () => {
  it('shows `allowedTools` puts no removal on the wire at all', async () => {
    const capture = await captureSpawn({ settingSources: [], allowedTools: ['Read'] });
    expect(capture.flag('--allowedTools')).toBe('Read');
    expect(capture.hasFlag('--tools')).toBe(false);
    expect(capture.hasFlag('--disallowedTools')).toBe(false);
  }, 30_000);

  it('shows the SDK assigns the two roles the OPPOSITE way round to the arc', () => {
    const doc = unwrapDoc(sdkTypes('sdk.d.ts'));
    // allowedTools = auto-approve, explicitly NOT availability…
    expect(doc).toContain('auto-allowed without prompting for permission');
    expect(doc).toContain('To restrict which tools are available, use the `tools` option instead.');
    // …and disallowedTools = context removal, the exact property the arc credits to the allowlist.
    expect(doc).toContain("removed from the model's context and cannot be used");
  });

  it('DOWNGRADES the sibling verdict "allowedTools restricts NOTHING": it is not inert w.r.t. availability', async () => {
    // Stage 7 rated allowedTools as pure auto-approve. Two documented counterexamples say it
    // also GRANTS availability — it just cannot REMOVE it.
    // (1) The `tools` docstring itself routes Grep/Glob through allowedTools on native builds.
    const doc = unwrapDoc(sdkTypes('sdk.d.ts'));
    expect(doc).toContain('List Grep/Glob here or in `allowedTools` to get them.');
    // (2) Skills become available by being folded INTO allowedTools — a runtime fact, not a doc.
    const capture = await captureSpawn({ settingSources: [], skills: ['pdf'] });
    expect(capture.flag('--allowedTools')).toContain('Skill(pdf)');
    // Corrected statement: `allowedTools` is a one-way widen-or-auto-approve lever. "Restricts
    // nothing" is right; "is not an availability lever" is too strong.
  }, 30_000);

  it('DOWNGRADES the sibling verdict "coa maps its allow-intent to auto-approve, NOT to availability"', () => {
    // Stage 7 probed `buildBaseOptions` in isolation and concluded a coa session with an allow
    // intent "still ships the FULL built-in set, delegation tool included". That is not coa's
    // real path: the adapter calls `resolveToolTransport` FIRST, which sets `tools` whenever
    // the allow set is non-empty, and forwards it into the session options.
    const restricted = resolveToolTransport({ allow: ['Read'], deny: [], coaToolNames: [] });
    expect(restricted.tools).toEqual(['Read']);

    const adapterSource = readFileSync(
      new URL('../claude-sdk-adapter.ts', import.meta.url),
      'utf8',
    );
    expect(adapterSource).toContain('...(transport.tools ? { tools: transport.tools } : {})');

    // The pass-through case is the one where no restriction ships, and it is deliberate (D85).
    const passthrough = resolveToolTransport({ allow: [], deny: [], coaToolNames: [] });
    expect(passthrough.tools).toBeUndefined();
    // So the arc's MECHANISM works; its NAMING is wrong. The lever is `tools`, derived from the
    // allow intent — not `allowedTools`.
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
    // finding, not as something P1 should lean on without a live check.
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

// ===========================================================================
// The remaining sibling positives, challenged head-on
// ===========================================================================

describe('stage 7: the Task/Agent rename — coa guards both spellings', () => {
  it('guards the fix: KNOWN_BUILTINS carries both `Task` and `Agent`', () => {
    expect(KNOWN_BUILTINS.has('Task')).toBe(true);
    expect(KNOWN_BUILTINS.has('Agent')).toBe(true);
    expect(sdkTypes('sdk-tools.d.ts')).toContain('export interface AgentInput {');
  });

  it('guards both spellings in a frame: Agent and Task are both granted when named', () => {
    // Direction 1: granting the real name Agent passes through the frame.
    const granted = resolveToolTransport({ allow: ['Read', 'Agent'], deny: [], coaToolNames: [] });
    expect(granted.tools).toEqual(['Read', 'Agent']);
    // autoApprove is always empty (docs/adr/0028) — availability lives entirely in
    // `tools`, which KNOWN_BUILTINS drives.
    expect(granted.autoApprove).toEqual([]);

    // Direction 2: both spellings are deliberately carried in the grant vocabulary because
    // the pinned CLI advertises Task in system:init.tools while the model emits Agent in
    // the same run (see docs/design/research/2026-08-02-claude-sdk-control-ledger.md:184).
    // Granting either name is accepted.
    const advertisedSpelling = resolveToolTransport({
      allow: ['Read', 'Task'],
      deny: [],
      coaToolNames: [],
    });
    expect(advertisedSpelling.tools).toEqual(['Read', 'Task']);
  });

  it('guards the full catalogue: KNOWN_BUILTINS covers all the tools the SDK advertises', () => {
    // Every one of these is a tool the pinned package generates a schema for, and all are
    // in coa's grant/deny vocabulary — so a frame naming any of them is recognized and routed.
    const tools = sdkTypes('sdk-tools.d.ts');
    const names = ['Agent', 'TaskStop', 'ExitPlanMode', 'AskUserQuestion', 'EnterWorktree'];
    for (const name of names) {
      expect(tools).toContain(`export interface ${name}Input`);
      expect(KNOWN_BUILTINS.has(name)).toBe(true);
    }
  });
});

describe('sibling challenge — stage 6: sessionStore "refuses to let coa be the only writer"', () => {
  it('DOWNGRADES it: the SDK’s own error message prescribes the workaround the verdict says does not exist', async () => {
    // The sibling quoted the first clause of this error and stopped. The rest of the same
    // string tells the host how to make the local write throwaway — i.e. how to be the only
    // DURABLE writer. That is a materially different verdict.
    await expect(
      captureSpawn({
        settingSources: [],
        persistSession: false,
        sessionStore: { append: async () => {}, load: async () => null },
      }),
    ).rejects.toThrow(
      /sessionStore cannot be used with persistSession: false.*Use CLAUDE_CONFIG_DIR=\/tmp for ephemeral local writes with external mirroring/s,
    );
  }, 30_000);

  it('DOWNGRADES it further: coa already owns that redirect in shipped code', () => {
    // `CLAUDE_CONFIG_DIR` is not a hypothetical — it is the field coa's auth seam already sets
    // per session, and `Options.env` REPLACES the child environment, so coa decides where the
    // "required local write" lands.
    const env = sessionAuthEnv({ type: 'config-dir', dir: '/coa/owned/scratch' }, {});
    expect(env?.['CLAUDE_CONFIG_DIR']).toBe('/coa/owned/scratch');
    expect(unwrapDoc(sdkTypes('sdk.d.ts'))).toContain(
      'this value REPLACES the subprocess environment entirely',
    );
    // Corrected verdict: a local write is structurally required and cannot be eliminated —
    // that half stands. "coa cannot be the only writer" does not: coa chooses the destination,
    // and the SDK documents doing exactly that. The store is a mirror of a write coa sites.
  });

  it('CONFIRMS the surviving half — append is documented as following the local write', () => {
    const types = sdkTypes('sdk.d.ts');
    expect(types).toMatch(/Called AFTER the subprocess's\n\s*\*\s*local write succeeds/);
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
