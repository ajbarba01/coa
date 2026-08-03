import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CapabilitySet, NeutralConfig } from '@coa/shared';
import type { BackendConfig } from '@coa/spi';
import {
  HOOK_EVENTS,
  getSubagentMessages,
  listSubagents,
  query,
  type AgentDefinition,
  type HookJSONOutput,
  type Options,
} from '@anthropic-ai/claude-agent-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderNative } from '../render-native.js';
import { buildBaseOptions } from '../sdk-options.js';
import { KNOWN_BUILTINS, resolveToolTransport } from '../tool-frame.js';
import { captureSpawn } from './probe-kit.js';

/**
 * Control-spike stage 7 — **delegation**. The stage most likely to rewrite the arc's P1,
 * which currently assumes coa must demote the harness's native delegation tool and replace
 * it with a governed `spawn_agent` of its own.
 *
 * Version under test: `@anthropic-ai/claude-agent-sdk` **0.3.196**, bundled CLI **2.1.196**
 * (commit `a4ca500badcac68511fb5f04303e32e4360f3dfb`). Every assertion below is a claim about
 * *that* pair and nothing else.
 *
 * ## The transport split this file exists to make visible
 *
 * `captureSpawn` (probe-kit) reads **argv only**. That is not the whole wire. The SDK splits
 * a single `Options` object across two channels:
 *
 * - **argv** — `--tools`, `--allowedTools`, `--disallowedTools`, `--task-budget`,
 *   `--max-budget-usd`, `--setting-sources`, …
 * - **the stdin `initialize` control request** — `agents`, `toolAliases`, `hooks`,
 *   `forwardSubagentText`, `systemPrompt`, …
 *
 * An argv-only probe therefore reports `--agents` as absent *even when `agents` is set*, which
 * read naively says "the SDK drops the option". It does not. {@link captureHandshake} below
 * captures both channels from one spawn so the two are never confused, and the first probe
 * pins the argv absence deliberately so a future reader cannot mistake it for a regression.
 *
 * ## What "on the wire" does and does not prove
 *
 * The wrapper performs **no validation** of `agents` — see the `coaMadeThisUp` probe. It
 * forwards the record verbatim, unknown keys included. So every assertion here proves
 * *transmission*, never *honouring*. Whether the CLI acts on a field is a live fact, and it
 * lives in `stage-7-delegation.live.test.ts`.
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

/**
 * A stub `claude` that records argv **and** everything the SDK writes to its stdin, then
 * exits. probe-kit's stub exits immediately and so never sees the `initialize` request; this
 * one lingers briefly. It is written to a temp dir at run time and is never spawned by
 * product code.
 */
const HANDSHAKE_STUB = `
import { writeFileSync, appendFileSync } from 'node:fs';
const out = process.env['COA_PROBE_HANDSHAKE'];
if (out === undefined || out === '') {
  process.stderr.write('handshake-stub: COA_PROBE_HANDSHAKE is unset\\n');
  process.exit(2);
}
writeFileSync(out, JSON.stringify(process.argv.slice(2)) + '\\n', 'utf8');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { appendFileSync(out, chunk, 'utf8'); });
setTimeout(() => process.exit(0), 1200);
`;

/** The subset of the SDK's `initialize` control request this stage cares about. */
interface InitializeRequest {
  readonly subtype: string;
  readonly agents?: Record<string, Record<string, unknown>>;
  readonly toolAliases?: Record<string, string>;
  readonly hooks?: Record<string, readonly { matcher?: string; hookCallbackIds: string[] }[]>;
  readonly forwardSubagentText?: boolean;
}

interface Handshake {
  readonly argv: readonly string[];
  /** The `initialize` control request, or `undefined` when none reached the process. */
  readonly initialize: InitializeRequest | undefined;
  /** `undefined` when the flag is absent; `''` when present with an empty value. */
  flag(name: string): string | undefined;
  hasFlag(name: string): boolean;
}

function parseHandshake(raw: string): Handshake {
  const [argvLine, ...rest] = raw.split('\n');
  const argv = JSON.parse(argvLine ?? '[]') as string[];

  let initialize: InitializeRequest | undefined;
  for (const line of rest) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // a partially-flushed chunk; the request we want arrives whole
    }
    const envelope = parsed as { type?: string; request?: InitializeRequest };
    if (envelope.type === 'control_request' && envelope.request?.subtype === 'initialize') {
      initialize = envelope.request;
    }
  }

  const inline = (name: string): string | undefined =>
    argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i !== -1) return argv[i + 1];
    return inline(name);
  };
  return {
    argv,
    initialize,
    flag,
    hasFlag: (name) => argv.includes(name) || inline(name) !== undefined,
  };
}

/** Run one `query()` against the lingering stub and return BOTH wire channels. */
async function captureHandshake(options: Options): Promise<Handshake> {
  const dir = mkdtempSync(join(tmpdir(), 'coa-handshake-'));
  const stub = join(dir, 'handshake-stub.mjs');
  const capturePath = join(dir, 'handshake.txt');
  writeFileSync(stub, HANDSHAKE_STUB, 'utf8');

  const q = query({
    prompt: 'probe',
    options: {
      ...options,
      executable: 'node',
      pathToClaudeCodeExecutable: stub,
      env: { ...process.env, COA_PROBE_HANDSHAKE: capturePath },
    },
  });
  try {
    for await (const _message of q) break;
  } catch {
    // Expected: the stub speaks no stream-json back.
  }

  if (!existsSync(capturePath)) {
    throw new Error(`captureHandshake: the SDK never spawned the stub (no capture at ${dir}).`);
  }
  return parseHandshake(readFileSync(capturePath, 'utf8'));
}

/**
 * Every field `AgentDefinition` declares on SDK 0.3.196, each set to a distinguishable value.
 * If a future SDK adds a field, `AgentDefinition` gains it and this literal stops being
 * exhaustive — which is why the key-set assertion below is written against this object rather
 * than a hand-copied list.
 */
const EVERY_FIELD = {
  description: 'a governed child',
  prompt: 'You are a coa-governed worker.',
  model: 'claude-haiku-4-5',
  tools: ['Read'],
  disallowedTools: ['Bash'],
  mcpServers: ['coa'],
  criticalSystemReminder_EXPERIMENTAL: 'never rm -rf',
  skills: ['coa-orientation'],
  initialPrompt: 'begin',
  maxTurns: 3,
  background: true,
  memory: 'project',
  effort: 'low',
  permissionMode: 'plan',
} as const satisfies AgentDefinition;

const ROOT_MODEL = 'claude-opus-4-8';

function neutral(overrides: Partial<NeutralConfig> = {}): NeutralConfig {
  return {
    prefixHead: [],
    systemReminders: [],
    onDemandPullable: [],
    scopePushed: [],
    toolIntents: { allow: [], deny: [] },
    ...overrides,
  };
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
    files: [],
    ...overrides,
  };
}

// The handshakes are slow (a real subprocess each, held open ~1.2s), so the shared ones are
// taken once. Probes that need a distinct Options build their own.
let full: Handshake;
let bare: Handshake;

beforeAll(async () => {
  full = await captureHandshake({
    settingSources: [],
    model: ROOT_MODEL,
    agents: { worker: EVERY_FIELD },
    toolAliases: { Agent: 'mcp__coa__spawn_agent' },
    taskBudget: { total: 1000 },
    maxBudgetUsd: 1,
    forwardSubagentText: true,
    hooks: {
      SubagentStart: [{ hooks: [async (): Promise<HookJSONOutput> => ({ continue: true })] }],
      SubagentStop: [{ hooks: [async (): Promise<HookJSONOutput> => ({ continue: true })] }],
      PreToolUse: [
        {
          matcher: 'Agent|Task',
          hooks: [async (): Promise<HookJSONOutput> => ({ continue: true })],
        },
      ],
    },
  });
  bare = await captureHandshake({ settingSources: [] });
}, 60_000);

describe('stage 7 — the `agents` declaration plane', () => {
  it('does NOT put `agents` on argv — the argv-only reading would be a false negative', async () => {
    // Deliberate negative probe. `--agents` IS a real CLI flag (managed settings can reject
    // it by name), but this SDK does not use it, so an argv-only survey concludes "agents is
    // unsupported". The very next probe shows it is fully supported over stdin.
    const capture = await captureSpawn({ settingSources: [], agents: { worker: EVERY_FIELD } });
    expect(capture.hasFlag('--agents')).toBe(false);
    expect(capture.argv.join(' ')).not.toContain('worker');
  });

  it('carries every AgentDefinition field verbatim in the `initialize` control request', () => {
    expect(full.initialize).toBeDefined();
    expect(full.initialize?.agents).toEqual({ worker: EVERY_FIELD });
  });

  it.each(Object.keys(EVERY_FIELD))('transmits AgentDefinition.%s', (field) => {
    const worker = full.initialize?.agents?.['worker'];
    expect(worker).toBeDefined();
    expect(Object.keys(worker ?? {})).toContain(field);
    expect(worker?.[field]).toEqual(EVERY_FIELD[field as keyof typeof EVERY_FIELD]);
  });

  it('drops no declared field and invents none', () => {
    expect(Object.keys(full.initialize?.agents?.['worker'] ?? {}).sort()).toEqual(
      Object.keys(EVERY_FIELD).sort(),
    );
  });

  it('omits `agents` entirely when the option is not set', () => {
    expect(bare.initialize).toBeDefined();
    expect(bare.initialize?.agents).toBeUndefined();
  });

  it('transmits an EMPTY agents record rather than eliding it', async () => {
    // Break-it #1: rules out "the field only appeared because the value was truthy".
    const capture = await captureHandshake({ settingSources: [], agents: {} });
    expect(capture.initialize?.agents).toEqual({});
  });

  it('forwards UNKNOWN keys too — so "on the wire" proves transmission, not honouring', async () => {
    // Break-it #2, and the most important caveat in this file. The wrapper validates
    // nothing. Every positive result above is a transport fact; whether the CLI acts on a
    // field can only be settled live.
    const bogus = {
      description: 'd',
      prompt: 'p',
      coaMadeThisUp: 42,
    } as unknown as AgentDefinition;
    const capture = await captureHandshake({ settingSources: [], agents: { child: bogus } });
    expect(capture.initialize?.agents?.['child']).toEqual({
      description: 'd',
      prompt: 'p',
      coaMadeThisUp: 42,
    });
  });
});

describe('stage 7 — a child model distinct from the root model', () => {
  it('sends the root model on argv and a DIFFERENT child model in the same handshake', () => {
    // THE headline result. One spawn, both planes: the root runs `claude-opus-4-8` and the
    // declared child runs `claude-haiku-4-5`. Per-model delegation is a declaration coa
    // already gets to make — no `spawn_agent` tool required to express it.
    expect(full.flag('--model')).toBe(ROOT_MODEL);
    expect(full.initialize?.agents?.['worker']?.['model']).toBe('claude-haiku-4-5');
    expect(full.initialize?.agents?.['worker']?.['model']).not.toBe(full.flag('--model'));
  });

  it('accepts a per-agent `effort` alongside the per-agent model', () => {
    // The reasoning half of "what the child is" travels with the model, so a child can be
    // both cheaper and shallower than its parent.
    expect(full.initialize?.agents?.['worker']?.['effort']).toBe('low');
  });

  it('lets the CALLING MODEL override the child model per spawn, from a fixed union', () => {
    // The declared model is not the last word: the native tool's own input schema carries a
    // `model` override. Asserted structurally against the SDK's generated tool schemas —
    // this is a shipped .d.ts in the pinned package, not the binary.
    const agentInput = declBlock(sdkTypes('sdk-tools.d.ts'), 'AgentInput');
    expect(agentInput).toContain('"sonnet" | "opus" | "haiku"');
    // …and the same schema already carries background and worktree isolation.
    expect(agentInput).toContain('run_in_background');
    expect(agentInput).toContain('isolation');
  });

  it('reports the resolved child model and full child token usage back in the tool result', () => {
    // `AgentOutput` carries `resolvedModel`, `usage` and `toolStats`. That is the
    // cost-attribution seam for a NATIVE subagent — coa does not need to own the spawn to
    // learn what the child cost.
    const toolTypes = sdkTypes('sdk-tools.d.ts');
    const start = toolTypes.indexOf('export type AgentOutput');
    const agentOutput = toolTypes.slice(start, toolTypes.indexOf('export interface BashInput'));
    expect(start).toBeGreaterThan(-1);
    expect(agentOutput.length).toBeGreaterThan(0);
    expect(agentOutput).toContain('resolvedModel');
    expect(agentOutput).toContain('cache_read_input_tokens');
    expect(agentOutput).toContain('toolStats');
  });

  it('cannot express a per-agent model through coa’s own render surface today', () => {
    // The negative half, and the actual P1 gap: the SDK grants per-agent model/prompt/effort,
    // but coa's rendered `perAgent` frame has slots for tool intents ONLY. The missing piece
    // is in coa's declaration plane, not in the harness.
    const rendered = renderNative(
      neutral({
        toolIntents: { allow: [], deny: [], perAgent: { worker: { allow: [], deny: [] } } },
      }),
    );
    expect(Object.keys(rendered.perAgent['worker'] ?? {}).sort()).toEqual([
      'allowedTools',
      'disallowedTools',
    ]);
    expect(rendered.perAgent['worker']).not.toHaveProperty('model');
    expect(rendered.perAgent['worker']).not.toHaveProperty('prompt');
  });
});

describe('stage 7 — the governance seam over a native subagent', () => {
  it('exposes SubagentStart and SubagentStop as first-class hook events at runtime', () => {
    // HOOK_EVENTS is a runtime const, so this is an assertion about the shipped module, not
    // about typings.
    expect(HOOK_EVENTS).toContain('SubagentStart');
    expect(HOOK_EVENTS).toContain('SubagentStop');
  });

  it('registers both subagent hooks on the wire', () => {
    expect(full.initialize?.hooks?.['SubagentStart']?.[0]?.hookCallbackIds).toHaveLength(1);
    expect(full.initialize?.hooks?.['SubagentStop']?.[0]?.hookCallbackIds).toHaveLength(1);
  });

  it('transmits a PreToolUse matcher naming BOTH delegation-tool spellings', () => {
    // PreToolUse — not SubagentStart — is where a *deny* is typed. This proves the matcher
    // string survives the wire; whether it matches the live tool name is the live half.
    expect(full.initialize?.hooks?.['PreToolUse']?.[0]?.matcher).toBe('Agent|Task');
  });

  it('types a deny for PreToolUse but only additionalContext for SubagentStart', () => {
    // The typings asymmetry, asserted structurally: `PreToolUseHookSpecificOutput` declares
    // `permissionDecision`; `SubagentStartHookSpecificOutput` declares only
    // `additionalContext`. Read as: the spawn is denied by intercepting the TOOL CALL, while
    // SubagentStart is an injection/observation point. Whether the generic
    // `SyncHookJSONOutput.decision: 'block'` is honoured on SubagentStart is UNSETTLED
    // offline and is probed live.
    const types = sdkTypes('sdk.d.ts');
    const startOut = declBlock(types, 'SubagentStartHookSpecificOutput');
    expect(startOut).toContain('additionalContext');
    expect(startOut).not.toContain('permissionDecision');

    const stopOut = declBlock(types, 'SubagentStopHookSpecificOutput');
    expect(stopOut).toContain('additionalContext');
    expect(stopOut).not.toContain('permissionDecision');

    const preOut = declBlock(types, 'PreToolUseHookSpecificOutput');
    expect(preOut).toContain('permissionDecision');

    // The generic envelope every hook shares DOES type a block, so `{decision:'block'}` is
    // *constructible* for SubagentStart — it is simply not documented as honoured there.
    const blockAtStart: HookJSONOutput = { decision: 'block', reason: 'coa denied the spawn' };
    expect(blockAtStart).toEqual({ decision: 'block', reason: 'coa denied the spawn' });
  });

  it('hands coa the child transcript after the fact', () => {
    // The observation seam a native subagent already grants: per-session subagent listing and
    // full child message retrieval, as runtime exports.
    expect(typeof listSubagents).toBe('function');
    expect(typeof getSubagentMessages).toBe('function');
  });
});

describe('stage 7 — taskBudget and where a child’s spend lands', () => {
  it('sends taskBudget on argv as a TOKEN count, not a dollar cap', () => {
    expect(full.flag('--task-budget')).toBe('1000');
    expect(full.flag('--max-budget-usd')).toBe('1');
  });

  it('binds taskBudget to the QUERY, with no per-agent counterpart', () => {
    // Negative probe for R4. `taskBudget` is `Options`-level only: nothing budget-shaped
    // exists on `AgentDefinition`, so a child cannot be given its own budget and coa cannot
    // ring-fence one. `--task-budget` is the API's `output_config.task_budget` — a PACING
    // HINT the model is told about, not an enforced cap. The enforced cap is
    // `--max-budget-usd`, which is likewise root-only.
    const agentFields = Object.keys(EVERY_FIELD).map((k) => k.toLowerCase());
    expect(agentFields.filter((k) => k.includes('budget'))).toEqual([]);
    expect(agentFields.filter((k) => k.includes('cost'))).toEqual([]);
    // `maxTurns` is the only per-agent throttle the declaration plane offers.
    expect(full.initialize?.agents?.['worker']?.['maxTurns']).toBe(3);
  });

  it('omits both budget flags when unset, so neither has a silent default', () => {
    expect(bare.hasFlag('--task-budget')).toBe(false);
    expect(bare.hasFlag('--max-budget-usd')).toBe(false);
  });
});

describe('stage 7 — forwardSubagentText', () => {
  it('rides the initialize request, never argv', () => {
    expect(full.initialize?.forwardSubagentText).toBe(true);
    expect(full.argv.join(' ')).not.toContain('forward');
    expect(full.hasFlag('--forward-subagent-text')).toBe(false);
  });

  it('is absent by default, so child text does NOT reach coa unless asked for', () => {
    expect(bare.initialize?.forwardSubagentText).toBeUndefined();
  });
});

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

  it('carries BOTH delegation spellings, so a granted Agent survives the frame', () => {
    // The pinned CLI advertises `Task` in `system:init.tools` while the model emits `Agent`
    // in the same run. coa's grant vocabulary carries both spellings so neither is silently
    // dropped from a frame that names them.
    expect(KNOWN_BUILTINS.has('Task')).toBe(true);
    expect(KNOWN_BUILTINS.has('Agent')).toBe(true);

    const granted = resolveToolTransport({ allow: ['Read', 'Agent'], deny: [], coaToolNames: [] });
    expect(granted.tools).toEqual(['Read', 'Agent']);
    // autoApprove is always empty now (docs/adr/0028) — availability lives entirely in
    // `tools`, which KNOWN_BUILTINS drives.
    expect(granted.autoApprove).toEqual([]);
  });

  it('keeps BOTH spellings out of a restricted frame, which is what demotion needs', () => {
    const granted = resolveToolTransport({ allow: ['Read'], deny: [], coaToolNames: [] });
    expect(granted.tools).not.toContain('Task');
    expect(granted.tools).not.toContain('Agent');
  });

  it('offers `toolAliases` as the escape from the mcp__coa__ naming limit', () => {
    // The arc's "One limit worth writing down" says the literal name `Agent` is unavailable
    // to coa because governed tools carry the `mcp__coa__` prefix. `toolAliases` maps the
    // native name onto a coa MCP tool, and it reaches the wire. It rewrites the model's
    // emitted name at lookup time; it does NOT put the name on a tool schema, so this
    // narrows the limit rather than deleting it.
    expect(full.initialize?.toolAliases).toEqual({ Agent: 'mcp__coa__spawn_agent' });
  });
});

describe('stage 7 — which lever actually removes the delegation tool', () => {
  it('proves `allowedTools` restricts NOTHING: no availability flag reaches the wire', async () => {
    // Directly contradicts the arc's "removing the native delegation tool works — via the
    // allowlist". `allowedTools` is an AUTO-APPROVE list. Omitting a tool from it puts
    // nothing on the wire that could remove that tool, so the delegation tool's schema is
    // untouched by this lever.
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

    expect(bare.hasFlag('--tools')).toBe(false);
  });

  it('sends `disallowedTools` verbatim, documented as CONTEXT REMOVAL', async () => {
    // The arc calls the denylist "the wrong lever". The SDK's own doc for `disallowedTools`
    // says these tools "will be removed from the model's context and cannot be used" —
    // exactly the property the arc credits to the allowlist. The two claims are swapped.
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
