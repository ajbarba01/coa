# Claude Agent SDK Control Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a version-stamped, probe-backed ledger answering how much of the Claude Agent SDK's loop coa can control, so the backend-independent agent arc's P1 is designed against observed behaviour rather than assumption.

**Architecture:** A stub executable substituted via `pathToClaudeCodeExecutable` captures the argv the SDK constructs from any `Options`, making most control questions answerable offline with no credentials and no cost. Six subagents each own a slice of a nine-stage decomposition and deliver runnable probes; a serialised live pass covers what needs the real binary; a separate adversarial agent tries to break the positive results; the parent re-runs everything and writes the ledger from output it produced itself.

**Tech Stack:** TypeScript (strict), Vitest 4, `@anthropic-ai/claude-agent-sdk` 0.3.196, pnpm workspaces.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-02-claude-sdk-control-spike-design.md`. Read it before starting any task.
- **SDK version under test:** `@anthropic-ai/claude-agent-sdk` **0.3.196**; bundled CLI **2.1.196**, commit `a4ca500badcac68511fb5f04303e32e4360f3dfb`. Every finding records these.
- **TypeScript `strict`, no `any`.** Probes are production-quality code (AGENTS.md Constitution).
- **No verdict without an assertion.** `Owned` needs a passing probe exercising the lever; `Opaque` needs a negative probe asserting absence or ineffectiveness. Reading typings is never a verdict.
- **Nothing extracted from `claude.exe` is committed.** The SDK license is "© Anthropic PBC. All rights reserved." Probes over the binary assert **structural** facts (a path exists in the bundle; a count; a boolean). They never embed verbatim proprietary text. Prose cites; it does not paste.
- **Subagents do not run live probes.** They write them. Live probes run in one serialised pass (Task 9). Parallel `COA_LIVE` runs would race one account into a rate limit and spend real budget.
- **Probe location:** `packages/adapter-claude-sdk/src/control/`. Offline probes are `*.test.ts`; live probes are `*.live.test.ts` and gate with `describe.skipIf(!process.env['COA_LIVE'])`, matching the existing smokes.
- **Offline probes must pass from a clean checkout with no credentials and no network.**
- **Commits:** subject-only Conventional Commits. No body, no `Co-Authored-By`, no "Generated with" trailer. No module IDs or plan/phase numbers in the subject. Stage files by name; never `git add -A`.
- **No behaviour change to the shipped adapter.** This spike adds files under `control/` and touches nothing else in `packages/adapter-claude-sdk/src/`. Findings feed P1; they are not applied opportunistically here.
- **Verification per task:** `pnpm vitest run packages/adapter-claude-sdk` green, and `pnpm typecheck` green.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/adapter-claude-sdk/src/control/stub-cli.mjs` | A fake `claude` executable. Writes its argv and stdin to a capture file, then exits. Never spawned by product code. |
| `packages/adapter-claude-sdk/src/control/probe-kit.ts` | `captureSpawn(options)` — runs `query()` against the stub and returns the parsed argv/env the SDK constructed. The enabling helper every offline probe uses. |
| `packages/adapter-claude-sdk/src/control/probe-kit.test.ts` | Proves the harness itself works before anything depends on it. |
| `packages/adapter-claude-sdk/src/control/stage-1-2-session-construction.test.ts` | Agent 1 — what the model is, what tools exist. |
| `packages/adapter-claude-sdk/src/control/stage-3-4-turn-control.test.ts` | Agent 2 — per-call interception, turn boundary. |
| `packages/adapter-claude-sdk/src/control/stage-5-6-lifecycle.test.ts` | Agent 3 — context over time, state ownership. |
| `packages/adapter-claude-sdk/src/control/stage-7-delegation.test.ts` | Agent 4 — delegation. |
| `packages/adapter-claude-sdk/src/control/stage-8-9-process.test.ts` | Agent 5 — inference routing, the process. |
| `packages/adapter-claude-sdk/src/control/binary.test.ts` | Agent 6 — structural assertions over the extracted bundle. |
| `packages/adapter-claude-sdk/src/control/*.live.test.ts` | Live probes, one file per owning agent, all `COA_LIVE`-gated. |
| `packages/adapter-claude-sdk/src/control/assumptions.test.ts` | Task 10 — the adversarial audit of the eight-plus assumption checklist. |
| `docs/design/research/2026-08-02-claude-sdk-control-ledger.md` | The deliverable. Nine rows: verdict, evidence, consequence, version. |

---

### Task 1: The stub-CLI probe harness

This is the enabling task. Every offline probe depends on it, so it lands alone and first.

**Files:**
- Create: `packages/adapter-claude-sdk/src/control/stub-cli.mjs`
- Create: `packages/adapter-claude-sdk/src/control/probe-kit.ts`
- Test: `packages/adapter-claude-sdk/src/control/probe-kit.test.ts`

**Interfaces:**
- Consumes: `query` and `Options` from `@anthropic-ai/claude-agent-sdk`.
- Produces:
  - `captureSpawn(options: Options, prompt?: string): Promise<SpawnCapture>`
  - `interface SpawnCapture { argv: string[]; env: Record<string, string | undefined>; flag(name: string): string | undefined; hasFlag(name: string): boolean; json<T>(name: string): T | undefined }`

**Why this works:** the SDK spawns the CLI with argv flags (`--input-format stream-json`, `--output-format stream-json`, `--setting-sources`, `--allowedTools`, `--agents`, `--mcp-config`). The stub records argv **before** any protocol exchange, so the capture succeeds even though the stub never speaks stream-json back. `captureSpawn` aborts the query once the capture file appears. No protocol emulation, no credentials, no network.

- [ ] **Step 1: Write the failing test**

Create `packages/adapter-claude-sdk/src/control/probe-kit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { captureSpawn } from './probe-kit.js';

describe('probe-kit — the stub-CLI capture harness', () => {
  it('captures the argv the SDK constructs from Options', async () => {
    const capture = await captureSpawn({
      allowedTools: ['Read', 'Grep'],
      settingSources: [],
    });

    expect(capture.argv.length).toBeGreaterThan(0);
    expect(capture.hasFlag('--allowedTools')).toBe(true);
    expect(capture.flag('--allowedTools')).toContain('Read');
  });

  it('reports a flag as absent when the option is omitted', async () => {
    const capture = await captureSpawn({ settingSources: [] });
    expect(capture.hasFlag('--agents')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/control/probe-kit.test.ts`
Expected: FAIL — cannot resolve `./probe-kit.js`.

- [ ] **Step 3: Write the stub executable**

Create `packages/adapter-claude-sdk/src/control/stub-cli.mjs`:

```js
#!/usr/bin/env node
// A fake `claude` binary for the control spike. It records the argv and env the
// Agent SDK constructed, then exits. It deliberately does NOT speak stream-json:
// argv is written before any protocol exchange, so the capture is complete even
// though the SDK's query() then fails. Never spawned by product code.
import { writeFileSync } from 'node:fs';

const out = process.env['COA_PROBE_CAPTURE'];
if (out === undefined || out === '') {
  process.stderr.write('stub-cli: COA_PROBE_CAPTURE is unset\n');
  process.exit(2);
}

writeFileSync(
  out,
  JSON.stringify({ argv: process.argv.slice(2), env: process.env }, null, 2),
  'utf8',
);
process.exit(0);
```

- [ ] **Step 4: Write the harness**

Create `packages/adapter-claude-sdk/src/control/probe-kit.ts`:

```ts
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';

/** What the SDK handed the CLI process for one `query()` call. */
export interface SpawnCapture {
  readonly argv: string[];
  readonly env: Record<string, string | undefined>;
  /** The value following `name`, or undefined when the flag is absent. */
  flag(name: string): string | undefined;
  hasFlag(name: string): boolean;
  /** The value following `name`, parsed as JSON. */
  json<T>(name: string): T | undefined;
}

const STUB = fileURLToPath(new URL('./stub-cli.mjs', import.meta.url));

function readCapture(path: string): SpawnCapture {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    argv: string[];
    env: Record<string, string | undefined>;
  };
  const flag = (name: string): string | undefined => {
    const i = raw.argv.indexOf(name);
    return i === -1 ? undefined : raw.argv[i + 1];
  };
  return {
    argv: raw.argv,
    env: raw.env,
    flag,
    hasFlag: (name) => raw.argv.includes(name),
    json: <T>(name: string): T | undefined => {
      const value = flag(name);
      return value === undefined ? undefined : (JSON.parse(value) as T);
    },
  };
}

/**
 * Run one `query()` against the stub executable and return what the SDK spawned it
 * with. The query is expected to fail (the stub speaks no protocol); the capture
 * file is written first, so the failure is discarded and the capture returned.
 */
export async function captureSpawn(options: Options, prompt = 'probe'): Promise<SpawnCapture> {
  const dir = mkdtempSync(join(tmpdir(), 'coa-probe-'));
  const capturePath = join(dir, 'capture.json');

  const q = query({
    prompt,
    options: {
      ...options,
      executable: 'node',
      pathToClaudeCodeExecutable: STUB,
      env: { ...process.env, COA_PROBE_CAPTURE: capturePath },
    },
  });

  try {
    for await (const _message of q) {
      break;
    }
  } catch {
    // Expected: the stub exits without speaking stream-json.
  }

  if (!existsSync(capturePath)) {
    throw new Error(
      `captureSpawn: the SDK never spawned the stub (no capture at ${capturePath}). ` +
        'Check whether pathToClaudeCodeExecutable/executable are still honoured on this SDK version.',
    );
  }
  return readCapture(capturePath);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/control/probe-kit.test.ts`
Expected: PASS, both cases.

If the SDK ignores `pathToClaudeCodeExecutable` and the capture file never appears, **stop and report**. That outcome is itself a stage-9 finding (`Opaque`), and it means every offline probe in this plan must be re-planned as live. Do not paper over it.

- [ ] **Step 6: Confirm the harness needs no credentials**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/control --reporter=verbose`
Expected: PASS with no `ANTHROPIC_API_KEY` and no account. Confirm no network call was made.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-claude-sdk/src/control/stub-cli.mjs packages/adapter-claude-sdk/src/control/probe-kit.ts packages/adapter-claude-sdk/src/control/probe-kit.test.ts
git commit -m "test: capture what the agent sdk hands its cli process"
```

---

### Tasks 2–7: The six-agent fan-out

Tasks 2 through 7 run **in parallel** as subagents once Task 1 is committed. Each owns files no other touches, so no write coordination is needed. Every one of them follows the same contract, restated in full in each task because an implementer sees only their own task.

**The contract, for each of Tasks 2–7:**

1. Read the spec at `docs/superpowers/specs/2026-08-02-claude-sdk-control-spike-design.md` first.
2. Use `captureSpawn` from `./probe-kit.js` for anything answerable offline.
3. Every claim gets an assertion. A lever you believe is present gets a probe that exercises it and passes. A lever you believe is absent gets a probe that asserts the absence and passes. **A claim with no assertion is not reportable.**
4. Before reporting a positive result, try to break it — construct the case where it would not hold and probe that too.
5. Anything needing a real model round-trip goes in your `*.live.test.ts` file, `COA_LIVE`-gated. **Do not run it.** Write it, confirm it is skipped without `COA_LIVE`, and report it as pending.
6. Report back: for each stage you own, the proposed verdict (`Owned`/`Shaped`/`Observed`/`Opaque`), the probe name backing it, and the consequence for the arc's P1. Quote nothing you did not observe.
7. Never modify files outside `packages/adapter-claude-sdk/src/control/`.

---

### Task 2: Stages 1–2 — what the model is, what tools exist

**Files:**
- Create: `packages/adapter-claude-sdk/src/control/stage-1-2-session-construction.test.ts`
- Create: `packages/adapter-claude-sdk/src/control/stage-1-2-session-construction.live.test.ts`

**Interfaces:**
- Consumes: `captureSpawn`, `SpawnCapture` from `./probe-kit.js`.
- Produces: findings only. No exported code.

**Questions this task must answer with assertions:**

- Can `systemPrompt` fully replace the `claude_code` preset (raw `string`), and what reaches the CLI in each of the three forms — preset, preset + `append`, raw string, and `string[]` containing `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`?
- Does `settingSources: []` actually suppress the target repo's config, and what does the CLI receive when it is omitted? (This is the D108 claim asserted in `sdk-options.ts:98-106`.)
- Does `tools: []` disable all built-ins, and does `tools: { type: 'preset', preset: 'claude_code' }` differ from omitting it?
- **Does `toolAliases` reach the CLI, and in what shape?** This is the highest-value question in the task — the arc design asserts the native name `Agent` is unavailable to coa.
- What do `agents`, `plugins`, `skills`, and `managedSettings` put on the wire?

- [ ] **Step 1: Write the failing probe file**

```ts
import { describe, expect, it } from 'vitest';
import { captureSpawn } from './probe-kit.js';

/**
 * Control-spike stages 1-2 — what the model is, and what tools exist.
 * SDK 0.3.196 / CLI 2.1.196 (a4ca500). See
 * docs/superpowers/specs/2026-08-02-claude-sdk-control-spike-design.md.
 */
describe('stage 1 — what the model is', () => {
  it('sends a raw-string systemPrompt without the claude_code preset', async () => {
    const capture = await captureSpawn({
      systemPrompt: 'coa is the only authority here.',
      settingSources: [],
    });
    expect(capture.argv.join(' ')).toContain('coa is the only authority here.');
  });

  it('sends preset plus append as a distinguishable shape', async () => {
    const capture = await captureSpawn({
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'coa layer' },
      settingSources: [],
    });
    expect(capture.argv.join(' ')).toContain('coa layer');
  });
});

describe('stage 2 — what tools exist', () => {
  it('puts toolAliases on the wire', async () => {
    const capture = await captureSpawn({
      toolAliases: { Agent: 'mcp__coa__spawn_agent' },
      settingSources: [],
    });
    expect(capture.argv.join(' ')).toContain('mcp__coa__spawn_agent');
  });

  it('distinguishes an empty tool set from an omitted one', async () => {
    const empty = await captureSpawn({ tools: [], settingSources: [] });
    const omitted = await captureSpawn({ settingSources: [] });
    expect(empty.argv).not.toEqual(omitted.argv);
  });
});
```

- [ ] **Step 2: Run it and record what actually happens**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/control/stage-1-2-session-construction.test.ts --reporter=verbose`

A spike inverts the usual TDD order: the probe encodes a **hypothesis**, and the run tells you whether it holds. Record the real argv for each case. Where the hypothesis was wrong, **rewrite the assertion to match observed behaviour** and note that the original expectation failed — that failure is a finding, often the most valuable kind. Never delete a probe because it disappointed you.

- [ ] **Step 3: Broaden to the full question list**

Add a probe per remaining question above (`settingSources` present vs. omitted, `tools` preset-form, `agents`, `plugins`, `skills`, `managedSettings`, the `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` split). Each is a `captureSpawn` plus an assertion on the observed argv.

- [ ] **Step 4: Write the falsification probes**

For every lever you concluded is `Owned`, add the case that would break it. For `toolAliases` specifically: alias a name that does not exist as a native tool, and alias one that does, and assert both reach the wire — an alias the CLI silently drops is `Shaped`, not `Owned`.

- [ ] **Step 5: Write the live probe file (do not run it)**

Create `stage-1-2-session-construction.live.test.ts` covering what argv cannot settle: with `toolAliases: { Read: 'mcp__coa__read' }` and a coa MCP server registered, does the model's `Read` call actually route to coa's handler? Gate it:

```ts
describe.skipIf(!process.env['COA_LIVE'])('stage 1-2 — live routing', () => {
  it('routes a native tool name to coa’s handler when aliased', async () => {
    // Drive ClaudeSdkAdapter with a registered coa tool aliased to `Read`,
    // prompt the model to read a file in a temp worktree, and assert coa's
    // handler observed the call.
  });
});
```

Follow the existing pattern in `streaming-smoke.live.test.ts` for adapter setup and `live-smoke-helpers.ts` for account resolution. Keep the live prompt tiny — it spends real subscription tokens.

- [ ] **Step 6: Confirm the live file is skipped by default**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/control --reporter=verbose`
Expected: offline probes PASS; live file reports as skipped.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck
git add packages/adapter-claude-sdk/src/control/stage-1-2-session-construction.test.ts packages/adapter-claude-sdk/src/control/stage-1-2-session-construction.live.test.ts
git commit -m "test: probe how far the session's prompt and tool surface can be set"
```

---

### Task 3: Stages 3–4 — per-call interception, turn boundary

**Files:**
- Create: `packages/adapter-claude-sdk/src/control/stage-3-4-turn-control.test.ts`
- Create: `packages/adapter-claude-sdk/src/control/stage-3-4-turn-control.live.test.ts`

**Interfaces:**
- Consumes: `captureSpawn` from `./probe-kit.js`; `toSdkPermission` and `toStopHookOutput` from `../sdk-options.js`.
- Produces: findings only.

**Questions this task must answer with assertions:**

- Which hook events exist on this SDK version, and which are registrable through `Options.hooks`? Enumerate against `HookEvent` and assert the list, so a future SDK bump that adds or removes one fails this probe.
- Can `PreToolUse` return a tool **result** — substituting an implementation — or only deny / `updatedInput` / `additionalContext`? Assert the negative explicitly if so.
- Does `canUseTool` see every tool call, including MCP-served ones and built-ins?
- Does the `Stop` hook's `{ decision: 'block', reason }` still block the close, as `sdk-options.ts:44-56` claims? That comment says the SPEC draft was wrong and was corrected against the live SDK; re-verify it on 0.3.196.
- What `TerminalReason` values can coa observe, and can it distinguish a coa-initiated stop from a harness one?
- Does `maxTurns` interact with the `Stop` hook, and which wins?

- [ ] **Step 1: Write the hook-inventory probe**

```ts
import { describe, expect, it } from 'vitest';
import { captureSpawn } from './probe-kit.js';
import { toStopHookOutput } from '../sdk-options.js';

/**
 * Control-spike stages 3-4 — per-call interception and the turn boundary.
 * SDK 0.3.196 / CLI 2.1.196 (a4ca500).
 */
describe('stage 4 — turn boundary', () => {
  it('maps a coa close-gate denial to a blocking Stop-hook output', () => {
    expect(toStopHookOutput({ allow: false, message: 'unfinished work' })).toEqual({
      decision: 'block',
      reason: 'unfinished work',
    });
  });

  it('registers hook callbacks without them reaching argv', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      hooks: { PreToolUse: [{ hooks: [() => Promise.resolve({ continue: true })] }] },
    });
    // Hooks are callbacks over the control protocol, not argv. Assert the observed
    // reality rather than assuming either way.
    expect(capture.argv).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it and record what actually happens**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/control/stage-3-4-turn-control.test.ts --reporter=verbose`

Record whether hook registration appears in argv at all. If it does not, that is the finding: hooks are protocol-level, so stages 3–4 are largely **live-only**, and the live file below carries most of this task's weight. Say so in the report rather than inflating the offline probes.

- [ ] **Step 3: Assert the hook-event inventory**

Add a probe that pins the registrable `HookEvent` list for this version. Derive it from the SDK's own exported type via a typed const array so a bump that changes the union fails `pnpm typecheck` rather than passing silently:

```ts
import type { HookEvent } from '@anthropic-ai/claude-agent-sdk';

/** The full HookEvent union as shipped on SDK 0.3.196. */
const KNOWN_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
  'MessageDisplay',
] as const satisfies readonly HookEvent[];

it('pins the hook-event inventory for this SDK version', () => {
  expect(KNOWN_HOOK_EVENTS).toHaveLength(30);
});
```

The `satisfies` clause is the tripwire: if a future SDK removes an event, `pnpm typecheck` fails. If
one is added, the length assertion fails. Either way the ledger learns that its stage-3/4 row expired.

Report which of these thirty coa currently registers. The answer is a small fraction, and the gap is a
finding in its own right — `PreCompact`/`PostCompact` bear directly on stage 5,
`SubagentStart`/`SubagentStop` on stage 7, and `PermissionRequest`/`PermissionDenied` on the arc's deny
channel.

- [ ] **Step 4: Assert the PreToolUse negative**

`PreToolUseHookSpecificOutput` on 0.3.196 carries `permissionDecision`, `permissionDecisionReason`, `updatedInput`, `additionalContext` — and no result field. Write a type-level probe that fails if a result field ever appears, since that would change coa's options materially:

```ts
it('cannot return a tool result from PreToolUse on this SDK version', () => {
  const output: PreToolUseHookSpecificOutput = {
    hookEventName: 'PreToolUse',
    updatedInput: { file_path: '/tmp/x' },
  };
  expect(Object.keys(output)).not.toContain('toolResult');
});
```

- [ ] **Step 5: Write the live probe file (do not run it)**

Cover: `canUseTool` firing for a built-in and for an MCP tool; `PreToolUse` `updatedInput` actually rewriting the executed call; the `Stop` hook blocking a close and the agent continuing; the `TerminalReason` observed on a coa interrupt. Gate with `describe.skipIf(!process.env['COA_LIVE'])`.

- [ ] **Step 6: Confirm skipped, typecheck, commit**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/control
pnpm typecheck
git add packages/adapter-claude-sdk/src/control/stage-3-4-turn-control.test.ts packages/adapter-claude-sdk/src/control/stage-3-4-turn-control.live.test.ts
git commit -m "test: probe what can be intercepted per tool call and at the turn boundary"
```

---

### Task 4: Stages 5–6 — context over time, state ownership

This is one of the two stages flagged as most likely to change the arc. M4's thesis is that coa owns what is in context; if the harness compacts silently, that thesis has a hole nobody has measured.

**Files:**
- Create: `packages/adapter-claude-sdk/src/control/stage-5-6-lifecycle.test.ts`
- Create: `packages/adapter-claude-sdk/src/control/stage-5-6-lifecycle.live.test.ts`

**Interfaces:**
- Consumes: `captureSpawn` from `./probe-kit.js`.
- Produces: findings only.

**Questions this task must answer with assertions:**

- **Compaction:** the `HookEvent` union carries `PreCompact` and `PostCompact` on this version, so compaction is at least nominally observable. That is a **lead, not a verdict** — probe whether the hooks actually fire, what their input carries, and crucially whether `PreCompact` can *prevent* or *shape* compaction or merely watch it. `Observed` and `Owned` are very different answers for M4. Also check for any option or CLI flag that disables it outright.
- Does `sessionStore` let coa own persistence outright, and what interface must it satisfy?
- What does `persistSession: false` change on the wire?
- Do `resume`, `forkSession`, and `sessionId` let coa reconstruct a session from its own append-only log (ADR-0010), or does the harness insist on its own store?
- What does `enableFileCheckpointing` write, and where?
- Is there a programmatic mid-session `role:system` channel? `render-native.ts:44-45` asserts there is not, calling it a "verified SDK fact" — re-verify it on 0.3.196, since a lot of coa's prompt design rests on it.

- [ ] **Step 1: Write the compaction-search probe**

```ts
import { describe, expect, it } from 'vitest';
import { captureSpawn } from './probe-kit.js';

/**
 * Control-spike stages 5-6 — context over time and state ownership.
 * SDK 0.3.196 / CLI 2.1.196 (a4ca500).
 */
describe('stage 5 — context over time', () => {
  it('records which compaction-related flags the SDK sends, if any', async () => {
    const capture = await captureSpawn({ settingSources: [] });
    const compactionFlags = capture.argv.filter((a) => /compact|context|summar/i.test(a));
    // Pin the observed set. An empty set is itself the finding: coa has no argv
    // lever over compaction on this version.
    expect(compactionFlags).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and record the real set**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/control/stage-5-6-lifecycle.test.ts --reporter=verbose`

If flags appear, replace `[]` with the observed array and pursue each. If none do, the assertion stands as the negative probe backing an `Opaque` or `Observed` verdict — and Task 7's binary read becomes the way to learn what actually triggers compaction.

- [ ] **Step 3: Probe the persistence levers**

Add probes for `sessionStore`, `persistSession`, `resume`, `forkSession`, `sessionId`, `enableFileCheckpointing` — each a `captureSpawn` asserting the observed wire effect. For `sessionStore`, additionally assert whether it is a callback interface (protocol-level, so invisible to argv) and say so plainly if it is.

- [ ] **Step 4: Re-verify the mid-session system-channel claim**

Write a probe that searches the `Options` surface and hook inventory for any mid-session system-role injection path. Assert the outcome either way. If the claim in `render-native.ts` still holds, the probe is the durable evidence it lacked; if it does not, that is a significant finding for the arc's declaration plane.

- [ ] **Step 5: Write the live probe file (do not run it)**

The decisive compaction question needs a real long session: drive a session past the context limit and observe whether coa's frames show compaction happening, whether anything notifies coa, and whether the transcript coa persists diverges from what the model actually saw. This is the single most valuable live probe in the plan — write it carefully and note in its docstring that it is expensive.

- [ ] **Step 6: Confirm skipped, typecheck, commit**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/control
pnpm typecheck
git add packages/adapter-claude-sdk/src/control/stage-5-6-lifecycle.test.ts packages/adapter-claude-sdk/src/control/stage-5-6-lifecycle.live.test.ts
git commit -m "test: probe who owns context over time and where session state lives"
```

---

### Task 5: Stage 7 — delegation

The other stage that can change the arc. P1 currently assumes coa must demote the native delegation tool and replace it with a governed `spawn_agent`. If this stage returns `Owned`, P1 gets rewritten before it is built.

**Files:**
- Create: `packages/adapter-claude-sdk/src/control/stage-7-delegation.test.ts`
- Create: `packages/adapter-claude-sdk/src/control/stage-7-delegation.live.test.ts`

**Interfaces:**
- Consumes: `captureSpawn` from `./probe-kit.js`; `renderNative` from `../render-native.js`.
- Produces: findings only.

**Questions this task must answer with assertions:**

- What does `agents: Record<string, AgentDefinition>` let coa define — model, tools, prompt, per-agent permissions? Read `AgentDefinition` and probe every field onto the wire.
- Can a native subagent be pointed at a **different provider or model** than the root? This is the arc's core thesis, and if `AgentDefinition` carries a model, part of it may already be free.
- Do `SubagentStart` and `SubagentStop` give coa a governance seam over native subagents — can it deny a spawn, or observe one?
- What does `taskBudget` bind to, and does a child's spend land on the root budget? Arc risk R4 assumes it does not.
- Does `forwardSubagentText` surface child output to coa's frames?
- **The `Task`→`Agent` rename (arc risk R2):** which spelling does this version emit in `system:init`, in tool-use blocks, and in permission-denial records? Probe all three, since the arc says they disagree.
- Does omitting the delegation tool from `allowedTools` keep its schema out of context, as the arc claims — and is the denylist genuinely the wrong lever?

- [ ] **Step 1: Write the delegation-surface probe**

```ts
import { describe, expect, it } from 'vitest';
import { captureSpawn } from './probe-kit.js';

/**
 * Control-spike stage 7 — delegation. The stage most likely to change the arc's P1.
 * SDK 0.3.196 / CLI 2.1.196 (a4ca500).
 */
describe('stage 7 — delegation', () => {
  it('puts an agent definition on the wire with its own model', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      agents: {
        worker: {
          description: 'a governed child',
          prompt: 'You are a coa-governed worker.',
          model: 'haiku',
          tools: ['Read'],
        },
      },
    });
    expect(capture.hasFlag('--agents')).toBe(true);
    expect(capture.flag('--agents')).toContain('worker');
  });

  it('keeps a tool omitted from the allowlist off the wire', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      allowedTools: ['Read'],
    });
    expect(capture.flag('--allowedTools')).not.toContain('Agent');
    expect(capture.flag('--allowedTools')).not.toContain('Task');
  });
});
```

- [ ] **Step 2: Run it and record what actually happens**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/control/stage-7-delegation.test.ts --reporter=verbose`

Record the exact serialised `--agents` payload. Whether `AgentDefinition` accepts a per-agent model is the single fact most likely to reshape P1 — report it first.

- [ ] **Step 3: Probe every `AgentDefinition` field**

Read the `AgentDefinition` type at `sdk.d.ts:38` and write one assertion per field, so the ledger can state exactly what the declaration plane already gets for free.

- [ ] **Step 4: Probe the `Task`/`Agent` naming reality**

Assert which spelling appears where. An offline probe can cover the rendered frame; `system:init` and denial records need the live file. Write the offline half now and note the split.

- [ ] **Step 5: Write the live probe file (do not run it)**

Cover: a native subagent actually running on a different model than the root; `SubagentStart` firing and whether denying it prevents the spawn; child spend appearing against the root budget or not; which spelling `system:init` emits. Gate with `describe.skipIf(!process.env['COA_LIVE'])`.

- [ ] **Step 6: Confirm skipped, typecheck, commit**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/control
pnpm typecheck
git add packages/adapter-claude-sdk/src/control/stage-7-delegation.test.ts packages/adapter-claude-sdk/src/control/stage-7-delegation.live.test.ts
git commit -m "test: probe what the harness already grants over delegating to child agents"
```

---

### Task 6: Stages 8–9 — inference routing, the process

**Files:**
- Create: `packages/adapter-claude-sdk/src/control/stage-8-9-process.test.ts`
- Create: `packages/adapter-claude-sdk/src/control/stage-8-9-process.live.test.ts`

**Interfaces:**
- Consumes: `captureSpawn`, `SpawnCapture` from `./probe-kit.js`.
- Produces: findings only.

**Questions this task must answer with assertions:**

- Does `ANTHROPIC_BASE_URL` in `Options.env` redirect inference, and does the SDK pass the environment through intact? Note that `env` **replaces** the subprocess environment rather than merging — assert that, since it is a live footgun for coa's auth wiring.
- Which auth-related variables must survive for a subscription account to work? The existing `auth-env.ts` encodes coa's current answer; probe whether it is complete.
- Does `maxBudgetUsd` reach the CLI, and is it enforced there or in the wrapper? Arc risk R4 depends on the answer.
- What do `fallbackModel`, `extraArgs`, `executableArgs`, and `betas` put on the wire?
- Is `pathToClaudeCodeExecutable` honoured for an arbitrary path — the lever tier 2 of the fork pricing depends on? Task 1 already proves it for the stub; assert it explicitly here as a stage-9 verdict.
- Is the exported `Transport` interface reachable through `query()`? The typings say `query()` takes only `{ prompt, options }`. Assert the negative.

- [ ] **Step 1: Write the routing and process probes**

```ts
import { describe, expect, it } from 'vitest';
import { captureSpawn } from './probe-kit.js';

/**
 * Control-spike stages 8-9 — inference routing and the process coa wraps.
 * SDK 0.3.196 / CLI 2.1.196 (a4ca500).
 */
describe('stage 8 — inference routing', () => {
  it('passes ANTHROPIC_BASE_URL through to the CLI process', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      env: { ...process.env, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/vNOPE' },
    });
    expect(capture.env['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:9/vNOPE');
  });

  it('replaces rather than merges the subprocess environment', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      env: { COA_PROBE_CAPTURE: process.env['COA_PROBE_CAPTURE'], ONLY_THIS: '1' },
    });
    expect(capture.env['ONLY_THIS']).toBe('1');
    // Record whether unrelated inherited variables survived. Assert the observed
    // truth; the docstring on Options.env says they do not.
  });
});

describe('stage 9 — the process', () => {
  it('honours an arbitrary pathToClaudeCodeExecutable', async () => {
    const capture = await captureSpawn({ settingSources: [] });
    expect(capture.argv.length).toBeGreaterThan(0);
  });
});
```

Note: the second probe needs `COA_PROBE_CAPTURE` preserved for the stub to write its capture at all — that is itself the demonstration that `env` replaces rather than merges. If preserving it is impossible, the probe cannot run and the finding is stronger still; report that.

- [ ] **Step 2: Run it and record what actually happens**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/control/stage-8-9-process.test.ts --reporter=verbose`

- [ ] **Step 3: Probe the remaining levers**

Add assertions for `maxBudgetUsd`, `fallbackModel`, `extraArgs`, `executableArgs`, `betas`, and the `Transport` negative.

- [ ] **Step 4: Cross-check against coa's existing auth wiring**

Read `packages/adapter-claude-sdk/src/auth-env.ts` and assert that the variables it sets and clears match what a spawned process actually receives. A gap here is a live bug, not just a spike finding — report it separately and loudly.

- [ ] **Step 5: Write the live probe file (do not run it)**

Cover: whether `ANTHROPIC_BASE_URL` genuinely redirects a real turn to a non-Anthropic endpoint, which is the load-bearing fact for the arc's P5 gateway. A local stub HTTP server is enough; it need not be a real model.

- [ ] **Step 6: Confirm skipped, typecheck, commit**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/control
pnpm typecheck
git add packages/adapter-claude-sdk/src/control/stage-8-9-process.test.ts packages/adapter-claude-sdk/src/control/stage-8-9-process.live.test.ts
git commit -m "test: probe where inference is routed and what wraps the cli process"
```

---

### Task 7: The binary track and the fork price

**Files:**
- Create: `packages/adapter-claude-sdk/src/control/binary.test.ts`
- Create: `docs/design/research/2026-08-02-claude-cli-binary-findings.md`

**Interfaces:**
- Consumes: the platform binary resolved from `@anthropic-ai/claude-agent-sdk`'s optional dependency, plus its `manifest.json`.
- Produces: findings only.

**Method — read this before starting.** `extractFromBunfs` is **not** the way in, despite its name. Its
signature is `extractFromBunfs(embeddedPath: string): string` and its own comment says it extracts a
file from *the current Bun process's* `$bunfs` so that file can be spawned as a subprocess — it serves
consumers who bundle the SDK into their own Bun binary. It does not open `claude.exe` from Node.

The actual method is a **read-only scan of the shipped binary for its embedded JavaScript.** A Bun
single-file executable embeds its sources, so scanning reaches them, but the result is minified and
unstructured. This track is therefore **best-effort and explicitly lower-confidence than the probes**:
anything the scan cannot settle is reported as unsettled rather than inferred, and where a scan finding
and a probe finding disagree, **the probe wins**.

**Hard constraint, repeated because it is the one that matters:** the license is "© Anthropic PBC. All rights reserved." **Nothing read out of the binary is committed.** Probes assert structural facts — a marker is present, a count, a boolean. They never embed verbatim proprietary text. The findings doc cites and paraphrases; it does not paste. Any scratch output goes to the session scratchpad, never the repo tree.

**Questions this task must answer:**

- What triggers compaction, and is any part of it observable from outside? This is the fact Task 4 most needs.
- Does the `claude_code` preset contain anything coa's own prompt duplicates or contradicts? `PRESET_COVERED_PIECES` in `render-native.ts:18-23` is coa's current guess at this, explicitly labelled as needing an A/B harness — the binary is the A/B harness.
- What are the built-in tools' real schemas and descriptions? Needed to judge the arc's "same tool, different clothes" ruling and risk R3.
- What does `settingSources: []` genuinely exclude?
- How does the native subagent machinery work, and what does it call itself internally?

**The fork price, computed not argued:**

- Upstream release cadence from actual npm version history: `npm view @anthropic-ai/claude-agent-sdk time --json`, reduced to releases per month over the last six months.
- Per-release patch cost against minified Bun output.
- Integrity and signing obstacles: `manifest.json` carries a per-platform checksum; win32 and darwin binaries are signed.
- The licensing position on redistributing a modified harness.

- [ ] **Step 1: Write the manifest probe**

Start with what is committable and certain — the manifest, which is plain JSON in the npm package.

```ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * Control-spike binary track. Establishes structural facts about the shipped CLI.
 * Asserts STRUCTURE ONLY — no proprietary text is committed, per the SDK's
 * all-rights-reserved license. CLI 2.1.196 (a4ca500).
 */
const require = createRequire(import.meta.url);

interface BinaryManifest {
  version: string;
  commit: string;
  buildDate: string;
  platforms: Record<string, { binary: string; checksum: string; size: number }>;
}

function readManifest(): BinaryManifest {
  const path = require.resolve('@anthropic-ai/claude-agent-sdk/manifest.json');
  return JSON.parse(readFileSync(path, 'utf8')) as BinaryManifest;
}

describe('binary track — structural facts about the shipped CLI', () => {
  it('pins one checksummed binary per platform for a known CLI build', () => {
    const manifest = readManifest();
    expect(manifest.version).toBe('2.1.196');
    expect(manifest.commit).toBe('a4ca500badcac68511fb5f04303e32e4360f3dfb');
    expect(Object.keys(manifest.platforms)).toContain('win32-x64');
    for (const platform of Object.values(manifest.platforms)) {
      expect(platform.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(platform.size).toBeGreaterThan(100_000_000);
    }
  });
});
```

If `require.resolve` cannot see `manifest.json` because the package's `exports` map does not expose it,
resolve the package root from `@anthropic-ai/claude-agent-sdk/package.json` and join the filename. Do
not skip the probe — the manifest is the version tripwire the whole ledger hangs on.

- [ ] **Step 2: Locate and scan the binary**

Resolve the platform binary through the optional dependency for this platform
(`@anthropic-ai/claude-agent-sdk-win32-x64` here), confirm it exists, and scan it read-only for the
five questions above. Work in the session scratchpad, never the repo tree.

A practical approach on a ~236 MB file: stream it in chunks and search for anchor strings rather than
loading it whole. Useful anchors are the names already known from the typings — `PreCompact`,
`SubagentStart`, `claude_code`, `settingSources`, `toolAliases` — since finding where those appear
locates the surrounding implementation.

Take notes as citations: what was found, what it appears to do, paraphrased. No verbatim blocks, and
nothing pasted into the repo.

If the scan yields too little to answer a question, **say so**. "The scan could not settle whether
`PreCompact` can prevent compaction" is a legitimate and useful result; a guess dressed as a finding is
not.

- [ ] **Step 3: Write the structural assertions**

Convert what you learned into assertions that will fail on a future CLI version if the structure changes: counts, path existence, presence of a named module. These are the version tripwires for stage 5 and stage 7 verdicts.

- [ ] **Step 4: Compute the fork price**

Run: `npm view @anthropic-ai/claude-agent-sdk time --json`

Reduce to releases per month over the last six months. Record the number.

- [ ] **Step 5: Write the findings doc**

Create `docs/design/research/2026-08-02-claude-cli-binary-findings.md` with the five answers, the three fork tiers priced (fork the wrapper / patch the binary / stop borrowing), the measured cadence, and an explicit recommendation. End with a `_Last reviewed: 2026-08-02_` footer, matching the other docs in that directory.

- [ ] **Step 6: Verify nothing extracted was committed**

Run: `git status --short`
Expected: only the two intended files. Confirm no extracted artifact and no temp directory is staged.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck
git add packages/adapter-claude-sdk/src/control/binary.test.ts docs/design/research/2026-08-02-claude-cli-binary-findings.md
git commit -m "docs: read the shipped cli bundle and price a fork against it"
```

---

### Task 8: Assemble and re-run the offline suite

The parent's independent verification. Runs after the fan-out completes.

**Files:**
- Modify: none. This task produces output, not code.

- [ ] **Step 1: Run the whole offline suite from clean**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/control --reporter=verbose
```

Expected: every offline probe passes; every `*.live.test.ts` reports skipped.

- [ ] **Step 2: Run the full repo suite**

```bash
pnpm typecheck && pnpm test
```

Expected: green. If anything outside `control/` changed, an agent violated the contract — revert that change and note it.

- [ ] **Step 3: Reconcile agent reports against observed output**

For each stage, check the agent's claimed verdict against the probe output you just produced. Any claim you cannot reproduce is **not** a verdict — it is an open question, recorded with the claim quoted and labelled unverified.

- [ ] **Step 4: Commit any reconciliation fixes**

```bash
git add packages/adapter-claude-sdk/src/control
git commit -m "test: reconcile the control probes against a clean run"
```

---

### Task 9: The serialised live pass

**Files:**
- Modify: whichever `*.live.test.ts` files need correcting once real behaviour is observed.

Requires an active Claude account. Spends real tokens. Runs **one file at a time**, never in parallel.

- [ ] **Step 1: Confirm an active account**

```bash
pnpm --filter @coa/cli exec coa auth current
```

If no active `claude` account exists, stop and report — the live pass is blocked, and the ledger ships with the live rows marked pending.

- [ ] **Step 2: Run each live file in sequence**

```bash
COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/control/stage-7-delegation.live.test.ts
COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/control/stage-1-2-session-construction.live.test.ts
COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/control/stage-3-4-turn-control.live.test.ts
COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/control/stage-8-9-process.live.test.ts
COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/control/stage-5-6-lifecycle.live.test.ts
```

Delegation runs first because it is the finding most likely to change P1. The compaction probe runs last because it is the most expensive.

- [ ] **Step 3: Correct probes that encoded a wrong hypothesis**

Where a live probe fails because reality differs from the guess, rewrite the assertion to match observed behaviour and record that the original expectation was wrong. A rate-limit or auth failure is **not** a finding — retry later, and if it persists, mark the row pending rather than guessing.

- [ ] **Step 4: Commit**

```bash
git add packages/adapter-claude-sdk/src/control
git commit -m "test: correct the live control probes against observed behavior"
```

---

### Task 10: The adversarial assumption audit

Run by a **different agent** than the one that produced any claim it checks — the contract requires the falsifier not be the claimant.

**Files:**
- Create: `packages/adapter-claude-sdk/src/control/assumptions.test.ts`

**Interfaces:**
- Consumes: `captureSpawn` from `./probe-kit.js`.
- Produces: findings only.

Each assumption below gets one named probe asserting whether it holds on this SDK version. The probe name states the assumption; the assertion states the verdict.

1. The literal tool name `Agent` is unavailable to coa because governed tools carry the `mcp__coa__` prefix (arc design, "One limit worth writing down").
2. `settingSources: []` fully isolates the session from the target repo's config (`sdk-options.ts:98-106`).
3. Layering on the `claude_code` preset is the only way to keep Claude Code's baseline behaviour (`sdk-options.ts:88-91`).
4. The demote set must be version-aware across the `Task`→`Agent` rename (arc risk R2).
5. Removing the native delegation tool requires the allowlist; the denylist is the wrong lever (arc research).
6. coa cannot substitute its own implementation for a native tool.
7. A subagent must be a coa session because the harness's own subagents are ungovernable (arc decision).
8. `disallowedTools` and `canUseTool` are coa's only per-tool levers.
9. There is no programmatic mid-session `role:system` channel (`render-native.ts:44-45`, labelled a "verified SDK fact").

- [ ] **Step 1: Write one probe per assumption**

```ts
import { describe, expect, it } from 'vitest';
import { captureSpawn } from './probe-kit.js';

/**
 * The adversarial audit. One probe per assumption coa's code and design docs
 * currently make about the Agent SDK. A passing probe means the assumption HOLDS on
 * SDK 0.3.196 / CLI 2.1.196 (a4ca500); the name states the claim under test.
 */
describe('assumption audit', () => {
  it('FALSE: the name `Agent` is unavailable to coa’s tools', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      toolAliases: { Agent: 'mcp__coa__spawn_agent' },
    });
    expect(capture.argv.join(' ')).toContain('mcp__coa__spawn_agent');
  });
});
```

- [ ] **Step 2: Run and record**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/control/assumptions.test.ts --reporter=verbose`

For each assumption, record HOLDS / FALSE / UNSETTLED. `UNSETTLED` is legitimate and must be reported as such — it is never rounded to either side.

- [ ] **Step 3: Try to break each positive finding from the fan-out**

For every stage an agent rated `Owned`, construct the case where it would not hold and probe that. Report anything that downgrades a verdict.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck
git add packages/adapter-claude-sdk/src/control/assumptions.test.ts
git commit -m "test: audit every assumption coa makes about the agent sdk"
```

---

### Task 11: The ledger, the P1 delta, and the fork verdict

Written by the parent, from output the parent produced.

**Files:**
- Create: `docs/design/research/2026-08-02-claude-sdk-control-ledger.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Write the ledger**

Nine rows, one per stage. Columns: stage, verdict (`Owned`/`Shaped`/`Observed`/`Opaque`), the probe name backing it, the consequence for the arc, and the version stamp. Rows the live pass could not settle are marked pending, with what would settle them.

Below the table: the assumption audit's nine results, and an explicit "open questions" section for anything unverified.

Footer: `_Last reviewed: 2026-08-02_`.

- [ ] **Step 2: Write the P1 delta**

A section in the ledger listing what the arc design got wrong and what changes because of it. Do not edit the arc design doc itself — it is a committed record of what was believed at the time. The delta is the correction, and P1's own plan will be written against the ledger.

- [ ] **Step 3: Write the fork verdict**

State the recommendation and the reasoning. If no stage returned `Opaque` **and** was needed by P1, the verdict is "do not fork" — say so plainly so the question stops recurring. If a stage did meet both tests, name it and give the priced tier.

- [ ] **Step 4: Add the ROADMAP entry**

Add the spike under the cross-cutting workstreams, with its outcome in one or two sentences and a link to the ledger. Same-commit rule: this lands with the ledger.

- [ ] **Step 5: Verify docs reachability**

Run: `pnpm docs:check`
Expected: the new `docs/design/research/` files are reachable from the router, or the run's only failure is the pre-existing untracked `TEMP.md`. If the new files are flagged, add them to the router's navigation table.

- [ ] **Step 6: Full verification**

```bash
pnpm typecheck && pnpm test && pnpm lint
```

- [ ] **Step 7: Commit**

```bash
git add docs/design/research/2026-08-02-claude-sdk-control-ledger.md ROADMAP.md
git commit -m "docs: record how much of the agent sdk's loop coa can actually control"
```

---

## Done when

- Nine ledger rows carry a verdict or an explicit pending marker, each citing a probe by name.
- Every cited probe has been run by the parent, not only by the agent that wrote it.
- The nine assumptions are each marked HOLDS, FALSE, or UNSETTLED.
- The fork verdict is recorded with its price.
- The offline suite passes from a clean checkout with no credentials.
- `pnpm typecheck && pnpm test` green.

---

_Last reviewed: 2026-08-02_
