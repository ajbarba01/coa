// Archived (exploratory half) from
// packages/adapter-claude-sdk/src/control/stage-7-delegation.test.ts.
// These probes measured the SDK-native delegation plane — the `agents`
// declaration map, per-child models, subagent hooks, taskBudget, and
// forwardSubagentText — which no shipped code uses: shipped subagents are coa's
// own sessions spawned through a governed tool, and the bounded tool floor
// removes the native delegation tool from every governed session. The
// `captureHandshake` harness moved here with them because only these probes
// needed both wire channels from one spawn; the in-tree file keeps the
// rename-tripwire and availability-lever probes on `captureSpawn` alone.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    // The negative half: the SDK grants per-agent model/prompt/effort, but coa's rendered
    // `perAgent` frame has slots for tool intents ONLY. The missing piece is in coa's
    // declaration plane, not in the harness.
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
    // Negative probe. `taskBudget` is `Options`-level only: nothing budget-shaped
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

describe('the toolAliases escape from the mcp__coa__ naming limit', () => {
  it('offers `toolAliases` as the escape from the mcp__coa__ naming limit', () => {
    // The literal name `Agent` is unavailable to coa's own tool schemas because governed
    // tools carry the `mcp__coa__` prefix. `toolAliases` maps the native name onto a coa
    // MCP tool, and it reaches the wire. It rewrites the model's emitted name at lookup
    // time; it does NOT put the name on a tool schema, so this narrows the limit rather
    // than deleting it.
    expect(full.initialize?.toolAliases).toEqual({ Agent: 'mcp__coa__spawn_agent' });
  });
});
