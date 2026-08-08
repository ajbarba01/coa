import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { CapabilitySet } from '@coa/shared';
import type { BackendConfig } from '@coa/spi';
import { describe, expect, it, vi } from 'vitest';
import { buildBaseOptions } from '../sdk-options.js';
import { KNOWN_BUILTINS, resolveToolTransport } from '../tool-frame.js';
import { captureSpawn } from './probe-kit.js';

// These probes spawn real child processes; under a fully loaded suite run the
// default 5s can lapse before a child even boots. One file-wide ceiling, same
// contract as the live suites' setConfig convention.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * Control-spike stage 7 — **delegation**, the load-bearing remainder.
 *
 * Version under test: `@anthropic-ai/claude-agent-sdk` **0.3.196**, bundled CLI **2.1.196**
 * (commit `a4ca500badcac68511fb5f04303e32e4360f3dfb`). Every assertion below is a claim about
 * *that* pair and nothing else.
 *
 * Two things shipped code relies on are pinned here:
 *
 * - **The delegation tool's rename churn.** The pinned SDK spells the native delegation tool
 *   both `Task` and `Agent` in the same version, so coa's grant vocabulary carries both
 *   spellings and the bounded tool floor demotes both. A future SDK that settles or re-churns
 *   the spelling fails these probes by name.
 * - **Which lever controls tool availability.** `tools` is the availability lever;
 *   `allowedTools` is auto-approve and removes nothing; `disallowedTools` is context removal.
 *   Shipped option-building rides exactly this split.
 */

const require_ = createRequire(import.meta.url);
const SDK_DIR = dirname(require_.resolve('@anthropic-ai/claude-agent-sdk'));

/** The pinned package's own typings, read as data. These are wrapper files, not the binary. */
function sdkTypes(file: 'sdk.d.ts' | 'sdk-tools.d.ts'): string {
  return readFileSync(join(SDK_DIR, file), 'utf8');
}

/**
 * The body of one declaration. Anchored on the full `export declare type NAME = {` /
 * `export interface NAME {` header, because a bare name also matches the file's re-export
 * list near the top — an earlier draft of these probes sliced backwards and silently
 * produced empty strings that passed nothing.
 */
function declBlock(source: string, name: string): string {
  for (const header of [`export declare type ${name} = {`, `export interface ${name} {`]) {
    const start = source.indexOf(header);
    if (start === -1) continue;
    const end = source.indexOf('\n};', start);
    const close = source.indexOf('\n}', start);
    const stop = end === -1 ? close : Math.min(end, close === -1 ? end : close);
    return source.slice(start, stop === -1 ? undefined : stop);
  }
  throw new Error(`declBlock: no declaration named ${name}`);
}

/** Collapse TSDoc line continuations so a wrapped sentence can be matched as one string. */
function unwrapDoc(source: string): string {
  return source.replace(/\s*\n\s*\*\s?/g, ' ');
}

function sandbox(): CapabilitySet {
  return { allowedTools: [], denyRules: [], permissionMode: 'default', denyRead: [] };
}

function backend(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    systemPrompt: '',
    allowedTools: [],
    disallowedTools: [],
    perAgent: {},
    ...overrides,
  };
}

describe('stage 7 — the Task/Agent rename (arc risk R2)', () => {
  it('names the tool `Agent` in the generated tool schemas, with no Task counterpart', () => {
    const toolTypes = readFileSync(join(SDK_DIR, 'sdk-tools.d.ts'), 'utf8');
    expect(toolTypes).toContain('export interface AgentInput');
    expect(toolTypes).toContain('export type AgentOutput');
    expect(toolTypes).not.toContain('export interface TaskInput ');
    expect(toolTypes).not.toContain('export type TaskOutput =');
  });

  it('still disagrees with itself INSIDE the shipped typings', () => {
    // R2, evidenced. One file, one version, three spellings of the same tool: the agent
    // *definition* is "invoked via the Agent tool", the agent *info* is "invoked via the
    // Task tool", and `ExitPlanModeOutput` exposes a field literally named `hasTaskTool`
    // whose own doc calls it the Agent tool. Any demote set that assumes a single spelling
    // is wrong on this version.
    const types = sdkTypes('sdk.d.ts');
    expect(types).toContain('invoked via the Agent tool');
    expect(types).toContain('invoked via the Task tool');
    // `hasTaskTool` lives in the GENERATED tool schemas, and its own doc calls it the Agent
    // tool — the field name kept the old spelling while the prose moved on.
    const exitPlan = declBlock(sdkTypes('sdk-tools.d.ts'), 'ExitPlanModeOutput');
    expect(exitPlan).toContain('hasTaskTool');
    expect(unwrapDoc(exitPlan)).toContain('Whether the Agent tool is available');
  });

  it('leaves the spelling free-form where it matters at runtime', () => {
    // `system:init.tools` and the denial record's `tool_name` are both plain strings — the
    // typings cannot settle which spelling arrives. That is the live half of R2.
    const types = sdkTypes('sdk.d.ts');
    expect(declBlock(types, 'SDKPermissionDenial')).toContain('tool_name: string;');
    expect(declBlock(types, 'SDKPermissionDeniedMessage')).toContain('tool_name: string;');
    expect(declBlock(types, 'SDKSystemMessage')).toContain('tools: string[];');
  });

  it('carries BOTH delegation spellings in the vocabulary, while the floor demotes them', () => {
    // The pinned CLI advertises `Task` in `system:init.tools` while the model emits `Agent`
    // in the same run — measured live, on one version.
    // coa's grant vocabulary carries both spellings so neither is silently dropped from a
    // frame that names them. THAT is the SDK fact, and it is unchanged.
    expect(KNOWN_BUILTINS.has('Task')).toBe(true);
    expect(KNOWN_BUILTINS.has('Agent')).toBe(true);

    // What changed is coa's transport POLICY, not the fact above. This probe originally
    // asserted a granted `Agent` survived the frame; the built-in floor
    // now demotes delegation deliberately, to be replaced by a governed spawn tool. The
    // vocabulary assertions are what still guard the rename — absence here is intent.
    const granted = resolveToolTransport({ allow: ['Read', 'Agent'], deny: [], coaToolNames: [] });
    expect(granted.tools).toEqual(['Read']);
    // autoApprove is always empty (coa never grants, only denies) — availability lives entirely in
    // `tools`, which KNOWN_BUILTINS and the floor together drive.
    expect(granted.autoApprove).toEqual([]);
  });

  it('keeps BOTH spellings out of a restricted frame, which is what demotion needs', () => {
    const granted = resolveToolTransport({ allow: ['Read'], deny: [], coaToolNames: [] });
    expect(granted.tools).not.toContain('Task');
    expect(granted.tools).not.toContain('Agent');
  });
});

describe('stage 7 — which lever actually removes the delegation tool', () => {
  it('proves `allowedTools` restricts NOTHING: no availability flag reaches the wire', async () => {
    // `allowedTools` is an AUTO-APPROVE list. Omitting a tool from it puts nothing on the
    // wire that could remove that tool, so the delegation tool's schema is untouched by
    // this lever.
    const capture = await captureSpawn({ settingSources: [], allowedTools: ['Read'] });
    expect(capture.flag('--allowedTools')).toBe('Read');
    expect(capture.hasFlag('--tools')).toBe(false);
    expect(capture.hasFlag('--disallowedTools')).toBe(false);
  });

  it('makes `tools` the availability lever — the built-in set is stated positively', async () => {
    const capture = await captureSpawn({ settingSources: [], tools: ['Read', 'Grep'] });
    expect(capture.flag('--tools')).toBe('Read,Grep');
    expect(capture.flag('--tools')).not.toContain('Agent');
    expect(capture.flag('--tools')).not.toContain('Task');
  });

  it('distinguishes `tools: []` (all built-ins off) from `tools` unset', async () => {
    // Break-it: an empty value is a real setting. Conflating it with absence would invert
    // the demotion probe.
    const empty = await captureSpawn({ settingSources: [], tools: [] });
    expect(empty.hasFlag('--tools')).toBe(true);
    expect(empty.flag('--tools')).toBe('');

    const preset = await captureSpawn({
      settingSources: [],
      tools: { type: 'preset', preset: 'claude_code' },
    });
    expect(preset.flag('--tools')).toBe('default');

    const unset = await captureSpawn({ settingSources: [] });
    expect(unset.hasFlag('--tools')).toBe(false);
  });

  it('sends `disallowedTools` verbatim, documented as CONTEXT REMOVAL', async () => {
    // The SDK's own doc for `disallowedTools` says these tools "will be removed from the
    // model's context and cannot be used" — the denylist is a removal lever, not merely a
    // permission answer.
    const capture = await captureSpawn({
      settingSources: [],
      disallowedTools: ['Agent', 'Task'],
    });
    expect(capture.flag('--disallowedTools')).toBe('Agent,Task');

    const options = declBlock(sdkTypes('sdk.d.ts'), 'Options');
    const doc = unwrapDoc(options);
    expect(doc).toContain("removed from the model's context and cannot be used");
    expect(doc).toContain('auto-allowed without prompting for permission');
    expect(doc).toContain('To restrict which tools are available, use the `tools` option');
  });

  it('shows coa maps its allow-intent to auto-approve, NOT to availability', () => {
    // End-to-end on coa's own path: `BackendConfig.allowedTools` is commented "Allow intent
    // → SDK `tools`", but `buildBaseOptions` maps it to `allowedTools` and leaves `tools`
    // undefined unless a separate resolved-frame argument supplies it. So a coa session that
    // renders an allow intent and nothing else still ships the FULL built-in set, delegation
    // tool included.
    const opts = buildBaseOptions({
      backend: backend({ allowedTools: ['Read'] }),
      sandbox: sandbox(),
    });
    expect(opts.allowedTools).toEqual(['Read']);
    expect(opts.tools).toBeUndefined();

    const restricted = buildBaseOptions({
      backend: backend({ allowedTools: ['Read'] }),
      sandbox: sandbox(),
      tools: ['Read'],
    });
    expect(restricted.tools).toEqual(['Read']);
  });
});
