# P1a Foundation Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix eight live defects in `packages/adapter-claude-sdk` and its consumers so that coa's per-tool governance actually runs, a deliberate stop reads as a stop, and the built-in tool list stops rotting — the preconditions the orchestration slice (P1b) assumes.

**Architecture:** Five independent seams, each fixed in place. The permission gate stops routing coa's allow-intent onto the SDK's auto-approve list and starts echoing tool input back; the SDK hook wiring generalises from one hardcoded event to an assembly, gaining `PreToolUse` for the one call `canUseTool` cannot see; M0's turn-frame vocabulary gains a `deny` member the console already renders; a dead standing-authority file path is deleted; and session isolation gains the one leak it can actually close.

**Tech Stack:** TypeScript (strict, no `any`) · pnpm workspaces · Vitest · Zod · `@anthropic-ai/claude-agent-sdk` 0.3.196 (bundled CLI 2.1.196, commit `a4ca500badcac68511fb5f04303e32e4360f3dfb`).

**Spec:** [2026-08-02-p1a-foundation-fixes-design.md](../specs/2026-08-02-p1a-foundation-fixes-design.md)
**Evidence:** [the control ledger](../../design/research/2026-08-02-claude-sdk-control-ledger.md)

## Global Constraints

- **TypeScript `strict`, no `any`.** `pnpm typecheck` is clean on `main` and must stay clean.
- **Known pre-existing failures on `main` — not caused by this work and not yours to fix.** `pnpm test`: 10 failures (5 in `adapter-deepseek`, "streaming response had no body"). `pnpm lint`: 9 errors. `pnpm format`: 38 files flagged. `pnpm docs:check`: fails only on the untracked `TEMP.md`. **None of these counts may grow.** Record the count before you start and compare after.
- **The control probe suite is green: 197 offline probes pass with no credentials and no network.** It must stay green.
- **Commit messages: subject line only.** Conventional Commits. **No body, no scope, no `Co-Authored-By`, no "Generated with" trailer.** This overrides any harness default. No project-internal identifiers in the subject — no phase numbers, plan codenames, or module IDs.
- **Stage files by name.** Never `git add -A`.
- **Single `main` branch.** Commit only after verification.
- **Code comments state *why*, not *what*.** Never reference plan phases or task numbers in a comment. Link durable rationale to an ADR (`// see docs/adr/0028`).
- **Run tests with:** `pnpm vitest run <path>` from the repo root.
- **Do not touch** `AGENTS.md` or SPEC §B. Their opening thesis is stale; rewriting it belongs to the arc, not this plan.

## Deviation from the spec, deliberate

The spec says the gate repair is "one commit, because any split ships a broken intermediate state." That rationale is wrong for one specific ordering. Splitting *empty-the-list first, echo-later* does ship a broken state — every tool call would fail. Splitting *echo-first* does not: echoing `updatedInput` is correct today and strictly improves the rarely-taken path, and only then does emptying the list make that path hot.

This plan therefore uses four safe commits (Tasks 1–4) where the spec assumed one. Every intermediate state is shippable.

## File Structure

**Modified:**
- `packages/adapter-claude-sdk/src/sdk-options.ts` — `toSdkPermission` gains the tool input; `skills: []`; two comment corrections.
- `packages/adapter-claude-sdk/src/session-options.ts` — hook assembly generalised; `PreToolUse` registered; input threaded to the permission mapper.
- `packages/adapter-claude-sdk/src/tool-frame.ts` — `allowedTools` → `autoApprove` (always empty); `KNOWN_BUILTINS` expanded.
- `packages/adapter-claude-sdk/src/turn-frames.ts` — `terminal_reason` read; `stop_hook_prevented` → deny.
- `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts` — budget-throw catch; transport field rename.
- `packages/adapter-claude-sdk/src/render-native.ts` — re-anchor file removed; stale comment rewritten.
- `packages/adapter-claude-sdk/src/live-smoke-helpers.ts` — `allowAllTools` echoes input.
- `packages/spi/src/runtime-adapter.ts` — `BackendFile` and `BackendConfig.files` removed.
- `packages/adapter-deepseek/src/adapter.ts`, `packages/adapter-longcat/src/adapter.ts` — `files: []` stubs removed.
- `packages/shared/src/push.ts` — `deny` frame; `terminal` on `turn-boundary`.
- `packages/console-viewmodel/src/turn-map.ts` — `deny` case.

**Created:**
- `packages/adapter-claude-sdk/src/control/tool-catalogue-drift.test.ts` — the SDK tool-schema drift test.
- `packages/adapter-claude-sdk/src/governed-gate.live.test.ts` — the one live smoke that gates this plan.
- `docs/adr/0028-per-tool-governance-rides-two-seams.md`

---

### Task 1: Echo the tool input on allow

The SDK's `PermissionResult` allow branch carries an optional `updatedInput`. Omitting it is type-valid, and against the real CLI it produces a permission error for every tool — nothing executes. This lands first so that Task 2, which makes this path hot, cannot ship a broken system.

**Files:**
- Modify: `packages/adapter-claude-sdk/src/sdk-options.ts:38-42`
- Modify: `packages/adapter-claude-sdk/src/session-options.ts:61-64`
- Modify: `packages/adapter-claude-sdk/src/live-smoke-helpers.ts:35`
- Test: `packages/adapter-claude-sdk/src/sdk-options.test.ts`, `packages/adapter-claude-sdk/src/session-options.test.ts`

**Interfaces:**
- Consumes: `ToolPermissionDecision` from `@coa/spi` — `{ behavior: 'allow' } | { behavior: 'deny'; message: string }`.
- Produces: `toSdkPermission(decision: ToolPermissionDecision, input: Record<string, unknown>): PermissionResult`. Task 4 calls it with the `PreToolUse` hook's `tool_input`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/adapter-claude-sdk/src/sdk-options.test.ts` (add `toSdkPermission` to the existing import from `./sdk-options.js`):

```ts
describe('toSdkPermission — the allow result must echo the input back', () => {
  it('carries updatedInput on allow', () => {
    // A bare `{behavior:'allow'}` is type-valid but the real CLI treats it as a
    // permission error for every tool, so nothing executes.
    const input = { file_path: 'a.ts' };
    expect(toSdkPermission({ behavior: 'allow' }, input)).toEqual({
      behavior: 'allow',
      updatedInput: input,
    });
  });

  it('echoes an empty input as an empty object, never omitted', () => {
    expect(toSdkPermission({ behavior: 'allow' }, {})).toEqual({
      behavior: 'allow',
      updatedInput: {},
    });
  });

  it('leaves a deny unchanged — no input echo on the deny branch', () => {
    expect(toSdkPermission({ behavior: 'deny', message: 'capped' }, { a: 1 })).toEqual({
      behavior: 'deny',
      message: 'capped',
    });
  });
});
```

Replace the existing assertion in `packages/adapter-claude-sdk/src/session-options.test.ts:44-55` with:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/sdk-options.test.ts packages/adapter-claude-sdk/src/session-options.test.ts
```

Expected: FAIL — `toSdkPermission` takes one argument; the allow results lack `updatedInput`.

- [ ] **Step 3: Add the input parameter to the mapper**

In `packages/adapter-claude-sdk/src/sdk-options.ts`, replace `toSdkPermission`:

```ts
/**
 * Map M3/M7's per-tool decision (assembled by M8) onto the SDK `canUseTool` result.
 *
 * The allow branch MUST echo `input` back as `updatedInput`. It is optional on
 * `PermissionResult`, so a bare `{behavior:'allow'}` typechecks — but the real CLI
 * reads the absence as a permission error and refuses the call, so every tool fails
 * while the types stay green. Verified live against CLI 2.1.196.
 */
export function toSdkPermission(
  decision: ToolPermissionDecision,
  input: Record<string, unknown>,
): PermissionResult {
  return decision.behavior === 'allow'
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: decision.message };
}
```

- [ ] **Step 4: Pass the input through at the call site**

In `packages/adapter-claude-sdk/src/session-options.ts`, replace the `sdkCanUseTool` body:

```ts
  const sdkCanUseTool: SdkCanUseTool = async (toolName, input) => {
    const call: ToolCall = { tool: toolName, args: input, sessionId };
    return toSdkPermission(await canUseTool(call), input);
  };
```

- [ ] **Step 5: Record why the shared live-test helper needed no code change**

The ledger reports `allowAllTools` as a defect. It is not one **on this path**, and the
distinction matters enough to write down rather than "fix" something that is already correct.

`CanUseTool` is coa's neutral port, returning `ToolPermissionDecision` — a type with no
`updatedInput` field at all. The echo cannot happen there. The four shipped smokes call
`adapter.interceptTool(allowAllTools)`, so their result flows through `toSdkPermission`,
which Step 3 just fixed. The control probes looked defective because they bypass the adapter
and hand a raw callback straight to `query()`, where the bare allow *is* the final result.

**Verify before writing anything:** confirm the smokes route through the adapter.

```bash
grep -n "interceptTool" packages/adapter-claude-sdk/src/*.live.test.ts
```

Expected: `turn-interrupt-smoke` (renamed from `barge-in-smoke`), `sot-smoke`, `streaming-output-smoke` and `streaming-smoke` all
call `adapter.interceptTool(allowAllTools)`. If any hands `allowAllTools` to `query()`
directly, that one **is** broken and needs its own local echoing callback — report it.

Then add the comment above line 35 of `packages/adapter-claude-sdk/src/live-smoke-helpers.ts`:

```ts
/**
 * Allow every tool. Deliberately does NOT echo the tool input: `ToolPermissionDecision` has
 * no field for it, and the echo the real CLI requires is applied once, centrally, in
 * `toSdkPermission`. A raw callback handed straight to `query()` must echo for itself — the
 * control probes do, because they bypass the adapter.
 */
export const allowAllTools: CanUseTool = () => ({ behavior: 'allow' });
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm vitest run packages/adapter-claude-sdk/src
```

Expected: PASS, no new failures.

- [ ] **Step 7: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-claude-sdk/src/sdk-options.ts packages/adapter-claude-sdk/src/sdk-options.test.ts packages/adapter-claude-sdk/src/session-options.ts packages/adapter-claude-sdk/src/session-options.test.ts packages/adapter-claude-sdk/src/live-smoke-helpers.ts
git commit -m "fix: echo the tool input back when permitting a call"
```

---

### Task 2: Stop auto-approving the tools coa governs

`resolveToolTransport` maps coa's allow-intent onto the SDK's `allowedTools`, which means *auto-approve*, not *availability*. An auto-approved tool never reaches `canUseTool`, so M3/M7 decisions do not run for exactly the tools coa granted — and in the D85 pass-through (empty `allow`), that is every coa tool. Availability is already carried by `tools` for built-ins and by MCP registration for coa tools, so nothing is lost by emptying it.

**Files:**
- Modify: `packages/adapter-claude-sdk/src/tool-frame.ts:38-71`
- Modify: `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts:241-259`
- Test: `packages/adapter-claude-sdk/src/tool-frame.test.ts`

**Interfaces:**
- Consumes: `resolveToolTransport({ allow, deny, coaToolNames })` from Task 0 state (unchanged signature).
- Produces: `ToolTransport` with the field `autoApprove: string[]` replacing `allowedTools`. Nothing else in the repo reads `ToolTransport.allowedTools`; verify with `grep -rn "transport.allowedTools" packages apps`.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `packages/adapter-claude-sdk/src/tool-frame.test.ts` body assertions that mention `allowedTools`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveToolTransport } from './tool-frame.js';

const COA = ['get_symbol', 'edit_symbol', 'why'];
const mcp = (n: string) => `mcp__coa__${n}`;

describe('resolveToolTransport', () => {
  it('never auto-approves: an auto-approved tool never reaches canUseTool', () => {
    // `allowedTools` means AUTO-APPROVE, not availability. Routing coa's allow-intent
    // onto it silently disabled coa's own per-tool gate for exactly the tools coa
    // granted. Availability lives on `tools` + MCP registration instead.
    expect(resolveToolTransport({ allow: [], deny: [], coaToolNames: COA }).autoApprove).toEqual([]);
    expect(
      resolveToolTransport({ allow: ['Read', 'get_symbol'], deny: [], coaToolNames: COA })
        .autoApprove,
    ).toEqual([]);
  });

  it('empty allow is the D85 pass-through: no tools restriction, every coa tool registered', () => {
    const t = resolveToolTransport({ allow: [], deny: [], coaToolNames: COA });
    expect(t.tools).toBeUndefined();
    expect(t.registerCoaTools).toEqual(COA);
    expect(t.disallowedTools).toEqual([]);
  });

  it('a granted set restricts built-ins via tools and registers only the granted coa tools', () => {
    const t = resolveToolTransport({
      allow: ['Read', 'Bash', 'get_symbol', 'edit_symbol'],
      deny: [],
      coaToolNames: COA,
    });
    expect(t.tools).toEqual(['Read', 'Bash']);
    expect(t.registerCoaTools).toEqual(['get_symbol', 'edit_symbol']);
  });

  it('drops an unresolved ref (a not-yet-built coa-control tool) from the transport', () => {
    const t = resolveToolTransport({ allow: ['Read', 'create_agent'], deny: [], coaToolNames: COA });
    expect(t.tools).toEqual(['Read']);
    expect(t.registerCoaTools).toEqual([]);
  });

  it('a role granting zero built-ins yields tools:[] (all built-ins disabled)', () => {
    const t = resolveToolTransport({ allow: ['get_symbol'], deny: [], coaToolNames: COA });
    expect(t.tools).toEqual([]);
    expect(t.registerCoaTools).toEqual(['get_symbol']);
  });

  it('routes deny: coa tools → mcp names, built-ins/rules → bare', () => {
    const t = resolveToolTransport({
      allow: [],
      deny: ['Edit', 'edit_symbol', 'Bash(rm *)'],
      coaToolNames: COA,
    });
    expect(t.disallowedTools).toEqual(['Edit', 'Bash(rm *)', mcp('edit_symbol')]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/tool-frame.test.ts
```

Expected: FAIL — `autoApprove` does not exist on `ToolTransport`.

- [ ] **Step 3: Rename the field and empty it**

In `packages/adapter-claude-sdk/src/tool-frame.ts`, replace the `ToolTransport` interface and the return block of `resolveToolTransport`:

```ts
export interface ToolTransport {
  /** Restrict the SDK built-in set (undefined ⇒ leave the default — no restriction). */
  tools?: string[];
  /**
   * The SDK `allowedTools` list — an AUTO-APPROVE set, not an availability gate.
   * **Always empty.** A tool listed here never reaches `canUseTool`, so anything put
   * here is a tool coa has chosen not to govern. Availability is `tools` (built-ins)
   * and MCP registration (coa tools); routing allow-intent here instead is the defect
   * this field's name now makes unmissable. Kept on the type so a future deliberate
   * bypass has somewhere honest to live. See docs/adr/0028.
   */
  autoApprove: string[];
  /** Removal list — denied built-ins/rules + denied coa tools (mcp names). */
  disallowedTools: string[];
  /** The coa catalogue tool names to actually register (all when unrestricted). */
  registerCoaTools: string[];
}
```

and the return:

```ts
  return {
    ...(restrict ? { tools: allowBuiltin } : {}),
    autoApprove: [],
    disallowedTools: [...denyOther, ...denyCoa],
    registerCoaTools,
  };
```

`allowBuiltin` is still used by the `tools` line, so leave its declaration alone.

Update the module docstring at the top of the file: replace the sentence beginning
"here they become the SDK's `tools` (availability), `allowedTools` (auto-approve)…" with:

```
 * here they become the SDK's `tools` (availability), `disallowedTools` (removal), and
 * the subset of the coa MCP catalogue to register. The SDK's `allowedTools` is an
 * auto-approve list and is deliberately left EMPTY: governance rides `canUseTool`, and
 * an auto-approved tool never reaches it.
```

- [ ] **Step 4: Update the adapter call site**

In `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts`, in the `assembleSessionOptions` call, replace the `backend` spread:

```ts
      backend: {
        ...backend,
        allowedTools: transport.autoApprove,
        disallowedTools: [...transport.disallowedTools, ...this.#disallowedBuiltins],
      },
```

`BackendConfig.allowedTools` is the SDK-facing field consumed by `buildBaseOptions`; feeding it the (empty) `autoApprove` set is what actually stops the auto-approval.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm vitest run packages/adapter-claude-sdk/src && pnpm typecheck
```

Expected: PASS, typecheck clean. If `claude-sdk-adapter.test.ts` asserts on `allowedTools` reaching the options, update it to expect `[]` — that is the fix, not a regression.

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-claude-sdk/src/tool-frame.ts packages/adapter-claude-sdk/src/tool-frame.test.ts packages/adapter-claude-sdk/src/claude-sdk-adapter.ts
git commit -m "fix: stop auto-approving the tools coa governs"
```

If `claude-sdk-adapter.test.ts` changed, add it to the same `git add`.

---

### Task 3: Generalise the hook assembly

`assembleSessionOptions` hardcodes a single `Stop` entry. The SDK exposes 30 hook events and Task 4 needs a second. This is a pure refactor with no behaviour change — a green suite before and after is the whole acceptance.

**Files:**
- Modify: `packages/adapter-claude-sdk/src/session-options.ts:66-87`
- Test: `packages/adapter-claude-sdk/src/session-options.test.ts`

**Interfaces:**
- Produces: `buildHooks(args: { stopPredicate: StopPredicate }): NonNullable<Options['hooks']>`. Task 4 extends its argument object with `canUseTool` and its return with a `PreToolUse` entry.

- [ ] **Step 1: Write the failing test**

Append to `packages/adapter-claude-sdk/src/session-options.test.ts` (add `buildHooks` to the import from `./session-options.js`):

```ts
describe('buildHooks — the multi-event hook assembly', () => {
  it('registers the close-gate on Stop', () => {
    const hooks = buildHooks({ stopPredicate: () => ({ allow: true }) });
    expect(hooks.Stop).toHaveLength(1);
  });

  it('blocks the close and feeds the gate message back when the gate denies', async () => {
    const hooks = buildHooks({ stopPredicate: () => ({ allow: false, message: 'open invariant' }) });
    const out = await hooks.Stop?.[0]?.hooks[0]?.({ hook_event_name: 'Stop' } as never, undefined, {
      signal: new AbortController().signal,
    });
    expect(out).toEqual({ decision: 'block', reason: 'open invariant' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/session-options.test.ts
```

Expected: FAIL — `buildHooks` is not exported.

- [ ] **Step 3: Extract the assembly**

In `packages/adapter-claude-sdk/src/session-options.ts`, add above `assembleSessionOptions`:

```ts
/**
 * Assemble the SDK hook registrations for one session. Kept separate from the
 * option spread because the SDK exposes 30 hook events and coa registers a growing
 * subset of them; a hardcoded literal made adding the second one a rewrite.
 */
export function buildHooks(args: { stopPredicate: StopPredicate }): NonNullable<Options['hooks']> {
  const { stopPredicate } = args;
  return {
    Stop: [{ hooks: [async () => toStopHookOutput(await stopPredicate())] }],
  };
}
```

and replace the inline `hooks:` literal in the returned object with:

```ts
    hooks: buildHooks({ stopPredicate }),
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/adapter-claude-sdk/src && pnpm typecheck
```

Expected: PASS, clean. The pre-existing `Stop`-hook test at `session-options.test.ts:68-79` must still pass unchanged — that is the proof this refactor changed no behaviour.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/session-options.ts packages/adapter-claude-sdk/src/session-options.test.ts
git commit -m "refactor: assemble sdk hooks instead of hardcoding one event"
```

---

### Task 4: Gate the delegation call at PreToolUse

`canUseTool` is never consulted for a native spawn — live-verified in a run that set no `allowedTools`, so Task 2 does not fix it. `PreToolUse` is the only seam that sees it. It judges **only** the two delegation spellings so no call is ever judged by both seams.

Both spellings are required: inside one live run, `system:init.tools` advertised `Task` while the model emitted `Agent`.

**Files:**
- Modify: `packages/adapter-claude-sdk/src/tool-frame.ts` (the constant only)
- Modify: `packages/adapter-claude-sdk/src/session-options.ts`
- Test: `packages/adapter-claude-sdk/src/session-options.test.ts`

**Interfaces:**
- Consumes: `toSdkPermission(decision, input)` from Task 1; `buildHooks(args)` from Task 3.
- Produces: `DELEGATION_TOOL_NAMES: readonly string[]` exported from **`tool-frame.ts`** — `['Task', 'Agent']`. It lives there because that is the tool-names module; `session-options.ts` imports it, and Task 5 spreads it into `KNOWN_BUILTINS` in the same file, so the gate and the grant list cannot drift apart. Dependency runs `session-options.ts → tool-frame.ts`, one way, no cycle.

- [ ] **Step 1: Write the failing tests**

Replace the `buildHooks` describe block from Task 3 with:

```ts
describe('buildHooks — the multi-event hook assembly', () => {
  const ctx = { signal: new AbortController().signal };
  const preToolUse = (hooks: ReturnType<typeof buildHooks>, name: string, input: unknown) =>
    hooks.PreToolUse?.[0]?.hooks[0]?.(
      { hook_event_name: 'PreToolUse', tool_name: name, tool_input: input } as never,
      undefined,
      ctx,
    );

  it('registers the close-gate on Stop', () => {
    const hooks = buildHooks({ stopPredicate: () => ({ allow: true }), canUseTool: () => ({ behavior: 'allow' }), sessionId: 's' });
    expect(hooks.Stop).toHaveLength(1);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/session-options.test.ts
```

Expected: FAIL — `buildHooks` takes only `stopPredicate`; no `PreToolUse` entry exists.

- [ ] **Step 3: Implement the PreToolUse gate**

In `packages/adapter-claude-sdk/src/tool-frame.ts`, add the exported constant above `KNOWN_BUILTINS`:

```ts
/**
 * Both spellings of the native delegation tool. It was renamed `Task` → `Agent`, and
 * the pinned CLI still disagrees with itself inside one run: `system:init.tools`
 * advertises `Task` while the model emits `Agent`. Matching one spelling misses the
 * other, so every list that names this tool carries both.
 */
export const DELEGATION_TOOL_NAMES: readonly string[] = ['Task', 'Agent'];
```

In `packages/adapter-claude-sdk/src/session-options.ts`, import it —
`import { DELEGATION_TOOL_NAMES } from './tool-frame.js';` — and replace `buildHooks` with:

```ts
export function buildHooks(args: {
  stopPredicate: StopPredicate;
  canUseTool: CanUseTool;
  sessionId: string;
}): NonNullable<Options['hooks']> {
  const { stopPredicate, canUseTool, sessionId } = args;

  // `canUseTool` is never consulted for a native spawn — verified live in a run that
  // set no `allowedTools`, so this is intrinsic to the delegation tool rather than a
  // consequence of auto-approval. `PreToolUse` is the only seam that sees it, and it
  // judges ONLY delegation so no other call is judged by both seams. See docs/adr/0028.
  const gateDelegation: HookCallback = async (input) => {
    if (!('tool_name' in input) || !DELEGATION_TOOL_NAMES.includes(input.tool_name)) return {};
    const args_ = 'tool_input' in input ? input.tool_input : {};
    const call: ToolCall = {
      tool: input.tool_name,
      args: (args_ ?? {}) as Record<string, unknown>,
      sessionId,
    };
    const decision = await canUseTool(call);
    return decision.behavior === 'allow'
      ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }
      : {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: decision.message,
          },
        };
  };

  return {
    Stop: [{ hooks: [async () => toStopHookOutput(await stopPredicate())] }],
    PreToolUse: [{ hooks: [gateDelegation] }],
  };
}
```

Add `HookCallback` to the type import from `@anthropic-ai/claude-agent-sdk` at the top of the file.

- [ ] **Step 4: Update the call site**

In the returned object of `assembleSessionOptions`, replace the `hooks:` line:

```ts
    hooks: buildHooks({ stopPredicate, canUseTool, sessionId }),
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm vitest run packages/adapter-claude-sdk/src && pnpm typecheck
```

Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-claude-sdk/src/tool-frame.ts packages/adapter-claude-sdk/src/session-options.ts packages/adapter-claude-sdk/src/session-options.test.ts
git commit -m "fix: gate the native spawn call at the only hook that sees it"
```

---

### Task 5: Recognise the delegation tool under both spellings

`KNOWN_BUILTINS` knows `Task` and not `Agent`, so granting `Agent` is silently dropped and granting `Task` names a tool the CLI no longer dispatches. It is also missing most of the pinned SDK's tool surface.

**Files:**
- Modify: `packages/adapter-claude-sdk/src/tool-frame.ts:24-36`
- Test: `packages/adapter-claude-sdk/src/tool-frame.test.ts`

**Interfaces:**
- Consumes: `DELEGATION_TOOL_NAMES`, already in this file from Task 4.
- Produces: `KNOWN_BUILTINS: ReadonlySet<string>` and `NOT_MODEL_VISIBLE: ReadonlySet<string>`, both exported from `tool-frame.ts`. Task 6's drift test imports both.

- [ ] **Step 1: Write the failing tests**

Append to `packages/adapter-claude-sdk/src/tool-frame.test.ts`:

```ts
describe('KNOWN_BUILTINS', () => {
  it('carries BOTH delegation spellings', () => {
    // The tool was renamed Task → Agent and the pinned CLI still emits both in one run.
    expect(KNOWN_BUILTINS.has('Task')).toBe(true);
    expect(KNOWN_BUILTINS.has('Agent')).toBe(true);
  });

  it('no longer drops a granted Agent from the transport', () => {
    const t = resolveToolTransport({ allow: ['Read', 'Agent'], deny: [], coaToolNames: [] });
    expect(t.tools).toEqual(['Read', 'Agent']);
  });

  it('knows the tools the previous list was missing', () => {
    for (const name of ['TaskStop', 'ExitPlanMode', 'AskUserQuestion', 'EnterWorktree']) {
      expect(KNOWN_BUILTINS.has(name), name).toBe(true);
    }
  });

  it('keeps the two classifications disjoint', () => {
    for (const name of NOT_MODEL_VISIBLE) expect(KNOWN_BUILTINS.has(name), name).toBe(false);
  });
});
```

Add `KNOWN_BUILTINS` and `NOT_MODEL_VISIBLE` to the import from `./tool-frame.js`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/tool-frame.test.ts
```

Expected: FAIL — `NOT_MODEL_VISIBLE` is not exported; `Agent` is absent.

- [ ] **Step 3: Replace the set**

In `packages/adapter-claude-sdk/src/tool-frame.ts`, replace `KNOWN_BUILTINS` and add the sibling set. `DELEGATION_TOOL_NAMES` is already declared in this file (Task 4), directly above.

```ts
/**
 * The SDK built-in tool names coa may grant/deny, derived from the tool schemas the
 * pinned package generates (`sdk-tools.d.ts`, SDK 0.3.196 / CLI 2.1.196). A name absent
 * from this set is dropped from the transport, so an omission silently discards a valid
 * grant — which is how `Agent` was lost. `tool-catalogue-drift.test.ts` fails when the
 * SDK's schema list moves, naming what expired instead of letting this rot.
 */
export const KNOWN_BUILTINS: ReadonlySet<string> = new Set([
  ...DELEGATION_TOOL_NAMES,
  'Artifact',
  'AskUserQuestion',
  'Bash',
  'CronCreate',
  'CronDelete',
  'CronList',
  'Edit',
  'EnterPlanMode',
  'EnterWorktree',
  'ExitPlanMode',
  'ExitWorktree',
  'Glob',
  'Grep',
  'ListMcpResources',
  'Monitor',
  'NotebookEdit',
  'PushNotification',
  'Read',
  'ReadMcpResource',
  'RemoteTrigger',
  'ReportFindings',
  'ScheduleWakeup',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Workflow',
  'Write',
]);

/**
 * Schema names in the pinned SDK that are NOT tool names a model can be granted —
 * internal plumbing and onboarding surfaces. Listed rather than ignored so the drift
 * test can require every schema to be classified one way or the other; a
 * misclassification here is a judgement call the next SDK bump forces back into view.
 */
export const NOT_MODEL_VISIBLE: ReadonlySet<string> = new Set([
  'Mcp',
  'Projects',
  'REPL',
  'ReadMcpResourceDir',
  'ShowOnboardingRolePicker',
]);
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/adapter-claude-sdk/src && pnpm typecheck
```

Expected: PASS, clean. `tool-frame.ts` must not import from `session-options.ts` — the dependency runs one way only. Confirm with `grep -n "session-options" packages/adapter-claude-sdk/src/tool-frame.ts` (expect no output).

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/tool-frame.ts packages/adapter-claude-sdk/src/tool-frame.test.ts
git commit -m "fix: recognise the delegation tool under both spellings"
```

---

### Task 6: Fail loudly when the SDK's tool catalogue moves

Upstream ships ~27 releases a month. The list in Task 5 is correct today and has no mechanism to stay correct. This test reads the pinned SDK's own generated schemas and requires every one to be classified.

**Files:**
- Create: `packages/adapter-claude-sdk/src/control/tool-catalogue-drift.test.ts`

**Interfaces:**
- Consumes: `KNOWN_BUILTINS`, `NOT_MODEL_VISIBLE` from `../tool-frame.js`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the test**

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_BUILTINS, NOT_MODEL_VISIBLE } from '../tool-frame.js';

/**
 * Tool-catalogue drift guard. SDK 0.3.196 / CLI 2.1.196 (a4ca500).
 *
 * `KNOWN_BUILTINS` decides which tool names survive into the transport; a name missing
 * from it is silently dropped, which is how a granted `Agent` disappeared. Upstream ships
 * ~27 releases a month, so the list needs a tripwire rather than good intentions: every
 * `<Name>Input` schema the SDK generates must be classified as either a grantable tool or
 * explicitly not model-visible. A new or renamed tool fails here and names itself.
 *
 * Only `Input` is scanned: `TaskOutput` has an input schema and no output schema, so
 * matching on both would miss it.
 */

/** Schema type names that do not equal the model-visible tool name. */
const SCHEMA_ALIASES: Readonly<Record<string, string>> = {
  FileRead: 'Read',
  FileWrite: 'Write',
  FileEdit: 'Edit',
};

function sdkToolSchemaNames(): string[] {
  const require_ = createRequire(import.meta.url);
  const pkg = require_.resolve('@anthropic-ai/claude-agent-sdk/package.json');
  const raw = readFileSync(join(dirname(pkg), 'sdk-tools.d.ts'), 'utf8');
  const names = new Set<string>();
  for (const m of raw.matchAll(/^export (?:interface|declare type) ([A-Za-z]+)Input\b/gm)) {
    const schema = m[1]!;
    names.add(SCHEMA_ALIASES[schema] ?? schema);
  }
  return [...names].sort();
}

describe('the pinned SDK tool catalogue', () => {
  it('generates the schema count this classification was built against', () => {
    // A bare count change is the cheapest possible drift signal and localises the failure
    // before the per-name assertion below produces a longer diff.
    expect(sdkToolSchemaNames()).toHaveLength(39);
  });

  it('classifies every generated tool schema as grantable or not model-visible', () => {
    const unclassified = sdkToolSchemaNames().filter(
      (name) => !KNOWN_BUILTINS.has(name) && !NOT_MODEL_VISIBLE.has(name),
    );
    expect(
      unclassified,
      `The SDK generates tool schemas coa has not classified: ${unclassified.join(', ')}. ` +
        'Add each to KNOWN_BUILTINS (a name coa may grant) or NOT_MODEL_VISIBLE (internal ' +
        'plumbing) in tool-frame.ts, then re-stamp the version in this file.',
    ).toEqual([]);
  });

  it('grants no name the pinned SDK does not ship, except the legacy delegation spelling', () => {
    // `Task` has no generated schema — it survives only as the name `system:init` still
    // advertises. Every other grantable name must correspond to a real schema.
    const shipped = new Set(sdkToolSchemaNames());
    const orphans = [...KNOWN_BUILTINS].filter((name) => !shipped.has(name) && name !== 'Task');
    expect(
      orphans,
      `coa grants names the pinned SDK no longer ships: ${orphans.join(', ')}`,
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/control/tool-catalogue-drift.test.ts
```

Expected: PASS, 3 tests. If the count assertion fails, the SDK in `node_modules` is not the pinned 0.3.196 — stop and report rather than adjusting the number.

- [ ] **Step 3: Prove the tripwire actually trips**

Temporarily remove `'Bash'` from `KNOWN_BUILTINS` in `tool-frame.ts`, re-run the drift test, and confirm the classification test FAILS naming `Bash`. Then restore it. A guard that cannot fail is not a guard.

```bash
pnpm vitest run packages/adapter-claude-sdk/src/control/tool-catalogue-drift.test.ts
```

Expected on the tampered run: FAIL with `Bash` in the message. Expected after restoring: PASS.

- [ ] **Step 4: Confirm the whole suite is still green**

```bash
pnpm vitest run packages/adapter-claude-sdk/src && pnpm typecheck
```

Expected: PASS, clean. The control suite total rises from 197 by 3.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/control/tool-catalogue-drift.test.ts
git commit -m "test: fail loudly when the sdk tool catalogue moves"
```

---

### Task 7: Give M0 a vocabulary for a deliberate stop

The console already renders a `DenyNotice` for `close-gate` and `cost-cap`, and `console-viewmodel/reads.ts` schematises it — but M0's wire union has no such member, so that renderer is fed only by mocks. Adding it is what lets Tasks 8–10 report a block as a block.

**Files:**
- Modify: `packages/shared/src/push.ts:11-65`
- Test: `packages/shared/src/push.test.ts` (create the describe block if the file lacks one)

**Interfaces:**
- Produces: two additions to `turnFrameSchema` —
  `{ t: 'deny'; denyKind: 'close-gate' | 'cost-cap'; reason: string }` and an optional
  `terminal?: string` on the `turn-boundary` member. Tasks 8, 9 and 10 all depend on these
  exact field names, which match `console-viewmodel/src/reads.ts:84-89` so no UI schema changes.

- [ ] **Step 1: Write the failing tests**

Add to `packages/shared/src/push.test.ts` (create the file with `import { describe, expect, it } from 'vitest'; import { turnFrameSchema } from './push.js';` if it does not exist):

```ts
describe('turnFrameSchema — the deliberate-stop vocabulary', () => {
  it('accepts a cost-cap deny', () => {
    const frame = { t: 'deny', denyKind: 'cost-cap', reason: 'cost cap reached' };
    expect(turnFrameSchema.parse(frame)).toEqual(frame);
  });

  it('accepts a close-gate deny', () => {
    const frame = { t: 'deny', denyKind: 'close-gate', reason: 'open invariant' };
    expect(turnFrameSchema.parse(frame)).toEqual(frame);
  });

  it('rejects a denyKind the console cannot render', () => {
    // The enum matches console-viewmodel's `reads.ts` exactly; widening it here without
    // widening the renderer would ship a frame nothing can draw.
    expect(() => turnFrameSchema.parse({ t: 'deny', denyKind: 'max-turns', reason: 'x' })).toThrow();
  });

  it('carries an optional terminal reason on a turn boundary', () => {
    expect(
      turnFrameSchema.parse({ t: 'turn-boundary', role: 'assistant', terminal: 'max_turns' }),
    ).toEqual({ t: 'turn-boundary', role: 'assistant', terminal: 'max_turns' });
    expect(turnFrameSchema.parse({ t: 'turn-boundary', role: 'assistant' })).toEqual({
      t: 'turn-boundary',
      role: 'assistant',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/shared/src/push.test.ts
```

Expected: FAIL — no `deny` member in the union; `terminal` is stripped.

- [ ] **Step 3: Extend the schema**

In `packages/shared/src/push.ts`, add to `turnFrameSchema` immediately after the `error` member:

```ts
  // A DELIBERATE stop, not a fault — one of the system's only two blocks (SC-1): M3's
  // close-gate and M7's cost cap. Distinct from `error` so a governed stop never renders
  // as a crash. `denyKind` matches the console's renderer enum exactly. A vendor bound
  // like `maxTurns` is NOT a coa block and rides `turn-boundary.terminal` instead.
  // See docs/adr/0028.
  z.object({
    t: z.literal('deny'),
    denyKind: z.enum(['close-gate', 'cost-cap']),
    reason: z.string(),
  }),
```

and replace the `turn-boundary` member with:

```ts
  z.object({
    t: z.literal('turn-boundary'),
    role: z.enum(['user', 'assistant']),
    stop: z.string().optional(),
    // The backend's own terminal reason (the SDK's `TerminalReason`), reported verbatim.
    // Without it a close-gate block, a turn-cap cutoff and a clean finish are
    // indistinguishable. Reported, never reinterpreted as governance.
    terminal: z.string().optional(),
  }),
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/shared/src && pnpm typecheck
```

Expected: PASS, clean. A `default:` branch elsewhere may now be reachable by a new frame kind — `console-viewmodel/src/turn-map.ts` handles that in Task 10; typecheck must still pass here.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/push.ts packages/shared/src/push.test.ts
git commit -m "feat: add a wire frame for a deliberate stop"
```

---

### Task 8: Report the backend's terminal reason

`turn-frames.ts` derives its error frame from `SDKResultMessage.subtype` alone. `terminal_reason` is optional on **both** result shapes and has 13 members, including `stop_hook_prevented` — the close-gate actually ending a run.

**Files:**
- Modify: `packages/adapter-claude-sdk/src/turn-frames.ts:121-130`
- Test: `packages/adapter-claude-sdk/src/turn-frames.test.ts`

**Interfaces:**
- Consumes: the `deny` and `turn-boundary.terminal` shapes from Task 7.
- Produces: no new exports; `messageToFrames` keeps its signature.

- [ ] **Step 1: Write the failing tests**

Append to `packages/adapter-claude-sdk/src/turn-frames.test.ts`:

```ts
describe('messageToFrames — terminal reasons', () => {
  it('carries terminal_reason onto a successful boundary', () => {
    expect(
      messageToFrames(
        sdk({
          type: 'result',
          subtype: 'success',
          stop_reason: 'end_turn',
          terminal_reason: 'completed',
          is_error: false,
        }),
      ),
    ).toEqual([{ t: 'turn-boundary', role: 'assistant', stop: 'end_turn', terminal: 'completed' }]);
  });

  it('renders a close-gate block as a deny, not an error', () => {
    // SC-1: M3's close-gate is one of the system's only two blocks. Reporting it as an
    // error frame shows a crash where a deliberate stop belongs.
    expect(
      messageToFrames(
        sdk({
          type: 'result',
          subtype: 'error_during_execution',
          terminal_reason: 'stop_hook_prevented',
          is_error: true,
        }),
      ),
    ).toEqual([
      { t: 'deny', denyKind: 'close-gate', reason: 'stop_hook_prevented' },
      { t: 'turn-boundary', role: 'assistant', terminal: 'stop_hook_prevented' },
    ]);
  });

  it('reports a turn-cap cutoff as a terminal reason, never as a coa denial', () => {
    // `maxTurns` is a harness bound coa does not even set, and it OUTRANKS the close-gate
    // — so calling it a coa block would misattribute which system stopped the work.
    expect(
      messageToFrames(
        sdk({
          type: 'result',
          subtype: 'error_max_turns',
          terminal_reason: 'max_turns',
          is_error: true,
        }),
      ),
    ).toEqual([
      { t: 'error', message: 'error_max_turns', origin: 'loop' },
      { t: 'turn-boundary', role: 'assistant', terminal: 'max_turns' },
    ]);
  });

  it('still handles a result with no terminal_reason at all', () => {
    expect(
      messageToFrames(sdk({ type: 'result', subtype: 'error_during_execution', is_error: true })),
    ).toEqual([
      { t: 'error', message: 'error_during_execution', origin: 'loop' },
      { t: 'turn-boundary', role: 'assistant' },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/turn-frames.test.ts
```

Expected: FAIL — no `terminal` on the boundary, no `deny` frame.

- [ ] **Step 3: Rewrite resultFrames**

In `packages/adapter-claude-sdk/src/turn-frames.ts`, replace `resultFrames`:

```ts
function resultFrames(message: Extract<SDKMessage, { type: 'result' }>): TurnFrame[] {
  // `terminal_reason` is optional on BOTH result shapes and distinguishes 13 endings.
  // Reading only `subtype` made a close-gate block, a turn-cap cutoff and a clean finish
  // indistinguishable. Reported verbatim on the boundary; only coa's own blocks are
  // reinterpreted as denials (SC-1). See docs/adr/0028.
  const terminal = message.terminal_reason;
  const boundary: TurnFrame = {
    t: 'turn-boundary',
    role: 'assistant',
    ...(message.subtype === 'success' && message.stop_reason !== null
      ? { stop: message.stop_reason }
      : {}),
    ...(terminal !== undefined ? { terminal } : {}),
  };
  if (message.subtype === 'success') return [boundary];
  if (terminal === 'stop_hook_prevented')
    return [{ t: 'deny', denyKind: 'close-gate', reason: terminal }, boundary];
  return [{ t: 'error', message: message.subtype, origin: 'loop' }, boundary];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/adapter-claude-sdk/src && pnpm typecheck
```

Expected: PASS, clean. The pre-existing boundary tests at `turn-frames.test.ts:72-87` must still pass — they supply no `terminal_reason`, so the field stays absent.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/turn-frames.ts packages/adapter-claude-sdk/src/turn-frames.test.ts
git commit -m "feat: report why the backend loop actually ended"
```

---

### Task 9: Render the cost cap as a stop, not a crash

`maxBudgetUsd` is enforced, but the SDK **raises** it out of the iteration ("Reached maximum budget ($0.02)") rather than returning an inspectable result. Today it lands in `run-live-session.ts`'s catch and becomes a generic loop error. It is one of the system's only two blocks, so it has to read as a deliberate stop.

**Files:**
- Modify: `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts:284-306`
- Test: `packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts`

**Interfaces:**
- Consumes: the `deny` frame from Task 7; `ClaudeSdkAdapterInit.onTurn` and `.maxBudgetUsd` (existing).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts`, reusing the file's existing `adapter(over)`, `neutral()`, `session`, `allow` and `stop` helpers (declared at the top of that file) rather than building a second harness:

```ts
describe('runLoop — the cost cap is a block, not a fault', () => {
  /** A `query` that yields nothing and throws out of iteration, like the SDK's cap does. */
  const throwingQuery = (message: string) =>
    (() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error(message);
        // eslint-disable-next-line no-unreachable
        yield undefined as never;
      },
      interrupt: () => Promise.resolve(),
    })) as unknown as ClaudeSdkAdapterInit['query'];

  const wired = (over: Partial<ClaudeSdkAdapterInit>) => {
    const a = adapter(over);
    a.renderNative(neutral());
    a.interceptTool(allow);
    a.interceptStop(stop);
    return a;
  };

  it('emits a cost-cap deny instead of propagating the budget throw', async () => {
    const frames: TurnFrame[] = [];
    const a = wired({
      maxBudgetUsd: 0.02,
      onTurn: (f) => frames.push(f),
      query: throwingQuery('Reached maximum budget ($0.02)'),
    });

    await expect(a.runLoop(session)).resolves.toBeUndefined();

    expect(frames).toEqual([
      { t: 'deny', denyKind: 'cost-cap', reason: 'Reached maximum budget ($0.02)' },
      { t: 'turn-boundary', role: 'assistant' },
    ]);
  });

  it('rethrows a transient network failure unchanged', async () => {
    // Recognition is narrow on purpose: a missed match must degrade to today's behaviour,
    // never to a swallowed error.
    const a = wired({ maxBudgetUsd: 0.02, query: throwingQuery('fetch failed') });
    await expect(a.runLoop(session)).rejects.toThrow('fetch failed');
  });

  it('rethrows a budget-shaped error when coa set no cap', async () => {
    const a = wired({ query: throwingQuery('Reached maximum budget ($0.02)') });
    await expect(a.runLoop(session)).rejects.toThrow('Reached maximum budget');
  });
});
```

Add `TurnFrame` to the `@coa/shared` type import at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts
```

Expected: FAIL — the first test rejects instead of resolving.

- [ ] **Step 3: Catch the budget throw**

In `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts`, add above the class:

```ts
/**
 * Whether a throw out of `query()` is the enforced cost cap.
 *
 * The SDK raises the cap as a plain `Error` ("Reached maximum budget ($X)") with no
 * inspectable subtype and no `result` frame, so a message match is the only signal
 * available. Matching a vendor string is fragile, which is why the guard is narrow —
 * coa must have set a cap for this run — and the fallback is to rethrow. A missed match
 * degrades to today's generic error frame; it never swallows a real failure.
 */
function isCostCapStop(err: unknown, maxBudgetUsd: number | undefined): err is Error {
  return (
    maxBudgetUsd !== undefined &&
    err instanceof Error &&
    /reached maximum budget/i.test(err.message)
  );
}
```

Then wrap the iteration in `runLoop`. Replace the `for await (const message of sdkQuery) { … }` block with:

```ts
    try {
      for await (const message of sdkQuery) {
        // …the existing loop body, unchanged…
      }
    } catch (err) {
      if (!isCostCapStop(err, this.#init.maxBudgetUsd)) throw err;
      // SC-1: the cap is a deliberate stop, so it settles the turn as a governed deny
      // rather than propagating a crash to the session's error path. See docs/adr/0028.
      // The boundary is REQUIRED, not decoration: M8 resolves its turn driver on a
      // boundary, so a cap that emits only the deny would leave the session pending
      // forever. It carries no `terminal` — the SDK threw instead of producing a result,
      // so there is no terminal_reason to report, and `max_budget` is not a member of the
      // SDK's TerminalReason union, so inventing it would be a fiction.
      this.#init.onTurn?.({ t: 'deny', denyKind: 'cost-cap', reason: err.message });
      this.#init.onTurn?.({ t: 'turn-boundary', role: 'assistant' });
    }
```

Keep the loop body byte-identical; only the surrounding `try`/`catch` is new.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/adapter-claude-sdk/src && pnpm typecheck
```

Expected: PASS, clean.

- [ ] **Step 5: Prove the frame survives M8's emission path**

The daemon's `stamp` passes every non-`thinking` frame through unchanged, and the barge-in suppression at `session-handlers.ts:774` only swallows `error` frames — so a `deny` should reach the console untouched and M8 needs no code change. Confirm rather than assume.

Add to `packages/core/src/session/session-handlers.test.ts`, inside the
`describe('buildSessionHandlers — createSession over RPC')` block, reusing that file's
existing `deps()`, `connection()` and `pushesOf()` helpers:

```ts
  it('emits a governed deny frame through the same path as any other frame', async () => {
    // A deny is NOT an error, so the barge-in error-suppression must not swallow it, and
    // `stamp` must pass it through unreshaped. If either is false, M8 needs a fix.
    const conn = connection();
    const handlers = buildSessionHandlers(
      deps([{ t: 'deny', denyKind: 'cost-cap', reason: 'capped' }]),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;

    const frames = pushesOf(conn.pushes).flatMap((p) => (p.kind === 'turn' ? [p.frame] : []));
    expect(frames).toContainEqual({ t: 'deny', denyKind: 'cost-cap', reason: 'capped' });
  });
```

If the frame is dropped or reshaped, fix `session-handlers.ts` to pass it through and say so in the commit message.

```bash
pnpm vitest run packages/core/src/session/session-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-claude-sdk/src/claude-sdk-adapter.ts packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts packages/core/src/session/session-handlers.test.ts
git commit -m "fix: render the cost cap as a deliberate stop"
```

---

### Task 10: Draw the deny frame in the console

`console-transcript` already renders `DenyNotice` and `console-viewmodel/reads.ts` already schematises the view frame. Only the push→view mapper is missing, so the renderer has never been fed by anything real.

**Files:**
- Modify: `packages/console-viewmodel/src/turn-map.ts:64-133`
- Test: `packages/console-viewmodel/src/turn-map.test.ts`

**Interfaces:**
- Consumes: the M0 `deny` frame from Task 7; the view frame `{ id, kind: 'deny', denyKind, reason }` already declared at `packages/console-viewmodel/src/reads.ts:84-89`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `packages/console-viewmodel/src/turn-map.test.ts`, matching the file's existing helper for building a `turn` push:

```ts
describe('mapping a governed deny', () => {
  it('maps a cost-cap deny to the view frame the transcript already renders', () => {
    expect(
      pushToViewFrames({
        kind: 'turn',
        sessionId: 's1',
        worktree: '/w',
        seq: 4,
        frame: { t: 'deny', denyKind: 'cost-cap', reason: 'cost cap reached' },
      }),
    ).toEqual([{ id: 's1:4', kind: 'deny', denyKind: 'cost-cap', reason: 'cost cap reached' }]);
  });

  it('maps a close-gate deny the same way', () => {
    expect(
      pushToViewFrames({
        kind: 'turn',
        sessionId: 's1',
        worktree: '/w',
        seq: 5,
        frame: { t: 'deny', denyKind: 'close-gate', reason: 'open invariant' },
      }),
    ).toEqual([{ id: 's1:5', kind: 'deny', denyKind: 'close-gate', reason: 'open invariant' }]);
  });

  it('reloads a persisted deny identically to the live push', () => {
    expect(
      reloadToViewFrames([
        { seq: 7, frame: { t: 'deny', denyKind: 'cost-cap', reason: 'capped' } },
      ]),
    ).toEqual([{ id: 't7', kind: 'deny', denyKind: 'cost-cap', reason: 'capped' }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run packages/console-viewmodel/src/turn-map.test.ts
```

Expected: FAIL — the mapper returns `[]`; `deny` falls through to `default`.

- [ ] **Step 3: Add the case**

In `packages/console-viewmodel/src/turn-map.ts`, add to the `switch` in `mapFrame`, immediately after the `error` case:

```ts
    case 'deny':
      // A governed stop, not a fault — the transcript draws it as a DenyNotice rather
      // than an error bubble (SC-1). Carries no `depth`: a block is the session's, not
      // a nested turn's.
      return { id, kind: 'deny', denyKind: frame.denyKind, reason: frame.reason };
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/console-viewmodel/src packages/console-transcript/src && pnpm typecheck
```

Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/console-viewmodel/src/turn-map.ts packages/console-viewmodel/src/turn-map.test.ts
git commit -m "feat: draw a governed stop in the transcript"
```

---

### Task 11: Remove the inert standing-authority file path

`renderNative` writes standing authority to `.claude/CLAUDE.md`. Loading a `CLAUDE.md` requires `settingSources` to include `'project'`, and coa sets `[]` — adding `'project'` would reopen exactly the leak the isolation exists to close. Separately, nothing ever writes the file: `BackendConfig.files` is produced by `renderNative` and consumed by nobody, and both thin adapters hardcode `files: []`.

**Files:**
- Modify: `packages/adapter-claude-sdk/src/render-native.ts:4-5,44-51,59-66`
- Modify: `packages/spi/src/runtime-adapter.ts:27-32,48`
- Modify: `packages/adapter-deepseek/src/adapter.ts:144`, `packages/adapter-longcat/src/adapter.ts:130`
- Test: `packages/adapter-claude-sdk/src/render-native.test.ts:97-113`

**Interfaces:**
- Produces: `BackendConfig` without `files`; `BackendFile` no longer exported from `@coa/spi`. Nothing downstream consumes either — confirm with `grep -rn "BackendFile\|\.files" --include=*.ts packages apps | grep -v node_modules`.

- [ ] **Step 1: Delete the tests that assert the dead behaviour**

Remove these two tests from `packages/adapter-claude-sdk/src/render-native.test.ts` entirely (lines 97-113): `'re-anchors standing authority into a worktree-relative, gitignorable .claude file (S-5)'` and `'emits no files when there is no standing authority to re-anchor'`.

Then add, in the same describe block:

```ts
  it('keeps standing authority in the systemPrompt, the only channel that loads', () => {
    // The `.claude/CLAUDE.md` re-anchor could never load: it needs settingSources to
    // include 'project', and coa sets [] precisely to keep the target repo's config out.
    const out = renderNative(config({ systemReminders: [reminder] }));
    expect(out.systemPrompt).toContain('no-raw-sql');
    expect(out).not.toHaveProperty('files');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/render-native.test.ts
```

Expected: FAIL — `files` is still a property.

- [ ] **Step 3: Remove the production**

In `packages/adapter-claude-sdk/src/render-native.ts`: delete the `REANCHOR_PATH` constant and its comment (lines 4-5), delete the `const files: BackendFile[] = …` statement, drop `files` from the returned object, and drop `BackendFile` from the `@coa/spi` type import.

Replace the standing-authority comment block with:

```ts
  // Standing authority (the salient systemReminders) lands in the systemPrompt (head/tail,
  // D108). A mid-session channel DOES exist — a `shouldQuery:false` user message lands its
  // content in context — but it costs its own turn, so using it is a policy decision and
  // waits for a caller that wants to pay. A streamed `role:system` message is transmitted
  // and NOT obeyed, so it is not that channel. Pull-only + scope-pushed content is deferred
  // (TAX-1) and never folded into the static prompt.
```

- [ ] **Step 4: Remove the port type**

In `packages/spi/src/runtime-adapter.ts`: delete the `BackendFile` interface and its comment, and delete the `files: BackendFile[];` line from `BackendConfig`. If `BackendFile` is re-exported from `packages/spi/src/index.ts`, remove that export too.

- [ ] **Step 5: Remove the stubs**

Delete the `files: [],` line from `packages/adapter-deepseek/src/adapter.ts:144` and `packages/adapter-longcat/src/adapter.ts:130`. Then remove the `files: [],` line from the `backend()` fixture in `packages/adapter-claude-sdk/src/session-options.test.ts:12` and from any other `BackendConfig` fixture typecheck flags.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm typecheck && pnpm vitest run packages/adapter-claude-sdk/src packages/spi packages/adapter-deepseek/src packages/adapter-longcat/src
```

Expected: typecheck clean (it will name every remaining fixture that still sets `files`), tests PASS. The `adapter-deepseek` "streaming response had no body" failures are pre-existing — confirm the count is still 5.

- [ ] **Step 7: Confirm the control probe still describes reality**

`packages/adapter-claude-sdk/src/control/assumptions.test.ts:311-333` asserts the bug this task fixes. Update it to assert the fixed state instead of deleting it — the probe's value is that it now guards against the path being reintroduced:

```ts
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
```

```bash
pnpm vitest run packages/adapter-claude-sdk/src/control
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-claude-sdk/src/render-native.ts packages/adapter-claude-sdk/src/render-native.test.ts packages/adapter-claude-sdk/src/control/assumptions.test.ts packages/adapter-claude-sdk/src/session-options.test.ts packages/spi/src/runtime-adapter.ts packages/adapter-deepseek/src/adapter.ts packages/adapter-longcat/src/adapter.ts
git commit -m "refactor: remove the standing-authority file that could never load"
```

Add `packages/spi/src/index.ts` to the staging list if you edited it.

---

### Task 12: Close the skills leak and correct the isolation comments

`settingSources: []` isolates user/project/local settings files and nothing else. Of its four documented leaks, exactly one is closable: omitting `skills` is **not** "skills off" — the CLI's own discovery defaults still apply, so a governed session sees skills from the target repo and the user's home directory that coa never authored.

**Files:**
- Modify: `packages/adapter-claude-sdk/src/sdk-options.ts:96-112`
- Test: `packages/adapter-claude-sdk/src/sdk-options.test.ts`

**Interfaces:**
- Produces: `buildBaseOptions` now returns `skills: []`. No signature change.

- [ ] **Step 1: Write the failing test**

Append to `packages/adapter-claude-sdk/src/sdk-options.test.ts`, reusing the file's existing `backend()`/`sandbox()` fixtures:

```ts
describe('buildBaseOptions — session isolation', () => {
  it('turns skills off explicitly, because omitting the option does not', () => {
    // The SDK is explicit that omitting `skills` is not "skills off" — the CLI's own
    // discovery defaults still apply, on a channel settingSources does not cover. So a
    // governed session could load instructions from the target repo that coa never wrote.
    expect(buildBaseOptions({ backend: backend(), sandbox: sandbox() }).skills).toEqual([]);
  });

  it('still blocks the settings files and the target repo mcp servers', () => {
    const opts = buildBaseOptions({ backend: backend(), sandbox: sandbox() });
    expect(opts.settingSources).toEqual([]);
    expect(opts.strictMcpConfig).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/sdk-options.test.ts
```

Expected: FAIL — `skills` is `undefined`.

- [ ] **Step 3: Set the option and correct the comment**

In `packages/adapter-claude-sdk/src/sdk-options.ts`, replace the comment block above `settingSources: []` and the two lines that follow with:

```ts
    // B1 — isolate the session from on-disk config (D108). Omitting `settingSources` lets
    // the SDK load ALL setting sources (the target repo's CLAUDE.md + .claude/settings +
    // ~/.claude) as authority coa did NOT author. This is a SEPARATE mechanism from the
    // preset above: the preset supplies Anthropic-authored baseline behavior, while this
    // blocks the TARGET REPO's own on-disk config from leaking in.
    //
    // Its reach is narrower than it looks, and the rest of this block is the honest
    // accounting (measured against SDK 0.3.196):
    //  - The MANAGED/POLICY tier is still read from disk by design. Not blockable. coa
    //    accepts it and says so rather than claiming an isolation it does not have.
    //  - Project `.mcp.json` is blocked by `strictMcpConfig` below — a DIFFERENT option.
    //    settingSources gets no credit for it.
    //  - `skills` unset is NOT "skills off"; the CLI's own discovery defaults still apply,
    //    so it is set explicitly. A later arc turns this from empty into coa's own list.
    //  - `AgentDefinition.memory: 'project'` auto-loads from the target repo on a channel
    //    settingSources does not appear on. coa declares no agents today; anything that
    //    starts declaring them inherits that leak.
    settingSources: [],
    strictMcpConfig: true,
    skills: [],
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/adapter-claude-sdk/src && pnpm typecheck
```

Expected: PASS, clean. The assumptions probe at `assumptions.test.ts:286-301` asserts `opts.skills` is `undefined` — update it to `toEqual([])` and rewrite its comment to record that coa now sets the option, keeping the SDK doc-line assertion that proves *why*.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/sdk-options.ts packages/adapter-claude-sdk/src/sdk-options.test.ts packages/adapter-claude-sdk/src/control/assumptions.test.ts
git commit -m "fix: close the skills leak in session isolation"
```

---

### Task 13: Record the two-seam ruling

The split between `canUseTool` and `PreToolUse` is the harness's behaviour, not coa's preference, so it is durable and belongs in an ADR rather than a comment that will be read once. The control ledger also carries a claim this work proved wrong.

**Files:**
- Create: `docs/adr/0028-per-tool-governance-rides-two-seams.md`
- Modify: `docs/adr/README.md` (index)
- Modify: `docs/design/research/2026-08-02-claude-sdk-control-ledger.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0028-per-tool-governance-rides-two-seams.md` following the MADR-lite template in `docs/adr/README.md`:

```markdown
# 0028 — Per-tool governance rides two seams

- Status: accepted
- Date: 2026-08-02

## Context and problem

coa routes every per-tool decision — M7's cost cap and M3's deny rules — through the SDK's
`canUseTool` callback. Two measurements broke that model.

`allowedTools` means **auto-approve**, not availability. A tool listed there never reaches
`canUseTool`, and coa mapped its allow-intent onto it — so per-tool governance did not run
for exactly the tools coa granted, and in the pass-through case that was every coa tool.

Separately and independently, `canUseTool` is **never** consulted for the native delegation
call. The model emitted `Agent` and the callback saw nothing. This was measured in a run
that set no `allowedTools` at all, so it is intrinsic to the delegation tool rather than a
consequence of auto-approval.

## Decision drivers

- The cost cap is one of only two blocks in the whole system (ADR-0009). A block that does
  not run is worse than no block, because the record claims it did.
- Delegation is the single call most worth governing: it spawns work coa did not authorise.
- `PreToolUse` sees every call including the spawn, but a `PreToolUse` deny produces no
  `permission_denied` record — so it is not a free replacement for `canUseTool`.

## Considered options

1. **Keep everything on `canUseTool`.** Leaves the spawn ungoverned, permanently.
2. **Move everything to `PreToolUse`.** One seam, at the cost of every denial record.
3. **Both seams, split by what each can see.**

## Decision

**`canUseTool` judges every tool call it is shown; `PreToolUse` judges only the delegation
call.** No call is judged by both. `PreToolUse` abstains on everything else, so the denial
record is preserved for every tool that produces one, and the one call that produces none
is still governed.

`allowedTools` is left permanently empty. Availability belongs to `tools` (built-ins) and to
MCP registration (coa tools); anything placed on the auto-approve list is a tool coa has
chosen not to govern, and nothing populates it today.

**A consequence, stated so it is not re-litigated:** coa's two SC-1 blocks — the close-gate
and the cost cap — surface as `deny` frames. A vendor bound like `maxTurns` is not a coa
block and surfaces as a reported terminal reason. `maxTurns` in fact **outranks** the
close-gate: with `maxTurns: 1` against a Stop hook that blocks every time, the run ends on
the turn cap and never reaches `stop_hook_prevented`. Dressing that up as a coa denial would
misattribute which system stopped the work.

## Consequences

**Good.** Governance runs on every tool call, including the spawn. The two seams are split
by a measurable property — what each can see — rather than by taste, so the rule survives
someone re-reading it later. The vocabulary keeps SC-1's "only two blocks" line honest.

**Bad.** Two seams is more surface than one, and the split has to be maintained: a future
tool that `canUseTool` also cannot see must be added to the `PreToolUse` set by hand, and
nothing detects that automatically. The delegation set is also version-sensitive — the tool
answers to `Task` and `Agent` in the same shipped release — so it carries both spellings and
inherits the same drift risk the tool catalogue has.

---

_Last reviewed: 2026-08-02_
```

- [ ] **Step 2: Add the index row**

Append to the Index list at the bottom of `docs/adr/README.md`, matching the existing row format:

```markdown
- [0028](0028-per-tool-governance-rides-two-seams.md) — Per-tool governance rides two seams
```

- [ ] **Step 3: Correct the ledger**

In `docs/design/research/2026-08-02-claude-sdk-control-ledger.md`, in the section
`### ★ \`allowedTools\` suppresses \`canUseTool\` — the most serious finding`, replace the
final sentence ("This also explains the delegation result above without needing delegation
to be a special case.") with:

```markdown
This does **not** explain the delegation result above. That probe's `liveOptions` sets no
`allowedTools` at all, so `canUseTool`'s blindness to a native spawn is independent and
intrinsic — delegation *is* a special case, and `PreToolUse` is the only seam that sees it
([ADR-0028](../../adr/0028-per-tool-governance-rides-two-seams.md)).
```

Then, in the **"Live bugs in shipped code, found incidentally"** section, prefix each of
items 1, 2, 5, 6 and 7 with `**FIXED 2026-08-02.**` — leaving items 3 and 4 unmarked, since
the native-delegation permission-mode hole and `appendSubagentSystemPrompt` are P1b's.

- [ ] **Step 4: Add the ROADMAP entry**

In `ROADMAP.md`, under `## Completed arcs`, add a subsection above the console rebuild entry:

```markdown
### The backend-independent agent arc — P1a foundation fixes — ✅ closed 2026-08-02

Eight defects the control spike found in shipped `adapter-claude-sdk` code. Per-tool
governance now actually runs (`allowedTools` no longer auto-approves coa's own tools, and
the allow result echoes the input the real CLI requires); the native spawn is gated at
`PreToolUse`, the only seam that sees it ([ADR-0028](docs/adr/0028-per-tool-governance-rides-two-seams.md));
the built-in tool list carries both delegation spellings and has a drift test; a governed
stop renders as a `deny` frame instead of a crash; the inert `.claude/CLAUDE.md` re-anchor
is gone; and `skills: []` closes the one isolation leak that was closable.

Next: **P1b — the orchestration slice.**
```

- [ ] **Step 5: Verify the docs**

```bash
pnpm docs:check
```

Expected: fails **only** on the untracked `TEMP.md`, exactly as it did before this task. Any
new dead link or orphan is yours.

- [ ] **Step 6: Commit**

```bash
git add docs/adr/0028-per-tool-governance-rides-two-seams.md docs/adr/README.md docs/design/research/2026-08-02-claude-sdk-control-ledger.md ROADMAP.md
git commit -m "docs: record that per-tool governance rides two seams"
```

---

### Task 14: Prove the gate repair against the real CLI

This is the task that closes the plan. Tasks 1 and 2 cancel each other's failure modes, and **the offline suite cannot tell you which one you built** — a bare `{behavior:'allow'}` is type-valid and passes every offline probe while breaking every tool call live. Both halves must be asserted in one run.

**Files:**
- Create: `packages/adapter-claude-sdk/src/governed-gate.live.test.ts`

**Interfaces:**
- Consumes: `resolveLiveLocator`, `barebonesSandbox`, `minimalNeutralConfig`, `neverStop` from `./live-smoke-helpers.js`.

- [ ] **Step 1: Write the live smoke**

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCall, TurnFrame } from '@coa/shared';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeSdkAdapter } from './claude-sdk-adapter.js';
import {
  barebonesSandbox,
  minimalNeutralConfig,
  neverStop,
  resolveLiveLocator,
} from './live-smoke-helpers.js';

/**
 * The one live gate on the foundation fixes. SDK 0.3.196 / CLI 2.1.196.
 *
 *   COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/governed-gate.live.test.ts
 *
 * Two shipped defects cancelled each other: coa's allow-intent auto-approved every tool
 * (so `canUseTool` never fired) while the allow result omitted `updatedInput` (so, when it
 * did fire, the real CLI refused the call). Both are type-valid and both pass offline.
 * This asserts BOTH halves in one run — the callback was consulted, AND the tool actually
 * executed — because either alone can pass while the system is broken.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const live = process.env['COA_LIVE'] === '1';

describe.skipIf(!live)('the governed gate, live', () => {
  it('consults canUseTool for a built-in call AND lets the call execute', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'coa-gate-'));
    const marker = 'COA_GATE_MARKER_4b21';
    writeFileSync(join(worktree, 'marker.txt'), marker, 'utf8');

    const seen: string[] = [];
    const frames: TurnFrame[] = [];
    const adapter = new ClaudeSdkAdapter({
      sessionId: 'live-gate',
      sandbox: barebonesSandbox(),
      input: 'Read the file marker.txt in the current directory and reply with its exact contents. Do nothing else.',
      locator: resolveLiveLocator(),
      maxBudgetUsd: 0.25,
      onTurn: (frame) => frames.push(frame),
    });
    adapter.renderNative(minimalNeutralConfig());
    adapter.registerTools([]);
    adapter.interceptTool((call: ToolCall) => {
      seen.push(call.tool);
      return { behavior: 'allow' };
    });
    adapter.interceptStop(neverStop);

    await adapter.runLoop({
      role: 'probe',
      scope: '.',
      worktree,
      capabilityFrame: { allow: [], deny: [] },
    });

    const text = frames
      .filter((f): f is Extract<TurnFrame, { t: 'text' }> => f.t === 'text')
      .map((f) => f.text)
      .join(' ');
    const diagnostic = `canUseTool saw ${JSON.stringify(seen)}; text = ${JSON.stringify(text)}`;

    // HALF 1 — the gate runs. Before the fix, `allowedTools` auto-approved the call and
    // this array was empty while the model used tools freely.
    expect(seen, diagnostic).toContain('Read');

    // HALF 2 — and the call still worked. Before the fix, an allow without `updatedInput`
    // produced a permission error, so half 1 could pass with nothing executing.
    expect(text, diagnostic).toContain(marker);
  });
});
```

- [ ] **Step 2: Confirm it skips cleanly with no account**

```bash
pnpm vitest run packages/adapter-claude-sdk/src/governed-gate.live.test.ts
```

Expected: 1 skipped, 0 failed. It must not attempt to resolve a locator when `COA_LIVE` is unset.

- [ ] **Step 3: Run it live**

Requires an active `claude` account (`coa auth use <label>`) or `COA_LIVE_CONFIG_DIR`. Costs a few cents.

```bash
COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/governed-gate.live.test.ts
```

Expected: PASS. If **half 1** fails, `allowedTools` is still being populated — re-check Task 2 Step 4. If **half 2** fails, the allow result is not reaching the CLI with `updatedInput` — re-check Task 1 Step 3. Report which half failed; the two have different causes and different fixes.

- [ ] **Step 4: Full verification sweep**

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm format && pnpm docs:check
```

Compare against the baseline recorded in Global Constraints: 10 test failures, 9 lint errors,
38 format-flagged files, `docs:check` failing only on `TEMP.md`. **No count may have grown.**
If `pnpm format` now flags a file you touched, run `pnpm format:write` on that file only and
include it in the commit.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/governed-gate.live.test.ts
git commit -m "test: prove the per-tool gate runs against the real cli"
```

---

## Done when

- All 14 tasks committed.
- `pnpm typecheck` clean; no pre-existing failure count grown.
- The control probe suite green (197 + 3 new).
- `COA_LIVE=1` run of `governed-gate.live.test.ts` **passed**, both halves.

## Explicitly not in this plan

P1b in every form — the governed `spawn_agent`, cross-backend children, the child session
and its parent link, depth guarding, root-budget attribution. The ADR-0027 tool-surface
demotion, including aliasing `Agent` onto a coa tool. The `AGENTS.md` and SPEC §B rewrite.
Anything in `OPEN.md`. The skills arc.

---

_Last reviewed: 2026-08-02_
