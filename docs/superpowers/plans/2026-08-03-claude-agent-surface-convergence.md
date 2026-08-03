# Claude Agent Surface Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Claude-backed agent and a pure-API agent converge on capability, governance and record — by trimming the Claude built-in surface to eight tools, moving the per-tool gate onto `PreToolUse`, and wiring the already-built reconciler so file changes reach M1 on both backends.

**Architecture:** The neutral declaration ("this agent reads, searches, writes, edits, execs and fetches; every call is gated and every change is recorded") is realized per backend. Claude realizes it with native tools plus two hooks; the pure-API backends realize it with coa's own tools inside `runGovernedLoop`. Nothing above M9 branches. coa never owns a native tool implementation, so Anthropic's trained tool contract — output shape included — stays intact.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Vitest, `@anthropic-ai/claude-agent-sdk` 0.3.196 / CLI 2.1.196.

## Global Constraints

- TypeScript `strict`, no `any`.
- Commit messages: **subject line only**, Conventional Commits, no body, no trailers, no scopes. No project-internal identifiers (no "P1b", no module IDs) in the subject.
- Stage files **by name**. Never `git add -A`.
- Baseline known-failure state on `main` — **none of these may grow**: `pnpm test` 10 failures (5 in `adapter-deepseek`, "streaming response had no body"); `pnpm lint` 9 errors; `pnpm format` flags 38 files; `pnpm docs:check` fails only on the gitignored local `TEMP.md`. `pnpm typecheck` is clean and must stay clean.
- SC-1: coa's only blocks are M3's close-gate and M7's cost cap. A hook may **deny or abstain**; it never asserts `allow`.
- D85: with a feature off, coa is never worse than the raw loop.

---

### Task 1: Trim the Claude built-in surface to eight

Today `resolveToolTransport` only sets `tools` when the capability frame carries a non-empty allow list; an empty frame is a D85 pass-through that hands the model all ~37 built-ins. This makes the eight-tool floor unconditional.

**Files:**
- Modify: `packages/adapter-claude-sdk/src/tool-frame.ts:89-129`
- Test: `packages/adapter-claude-sdk/src/tool-frame.test.ts`

**Interfaces:**
- Consumes: `KNOWN_BUILTINS`, `DELEGATION_TOOL_NAMES` (existing, same file).
- Produces: `CLAUDE_BUILTIN_FLOOR: readonly string[]`. `ToolTransport.tools` changes from `string[] | undefined` to always-present `string[]`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/adapter-claude-sdk/src/tool-frame.test.ts`:

```ts
import { CLAUDE_BUILTIN_FLOOR, resolveToolTransport } from './tool-frame.js';

it('advertises exactly the floor when the frame is an empty pass-through', () => {
  const transport = resolveToolTransport({ allow: [], deny: [], coaToolNames: ['get_symbol'] });
  expect(transport.tools).toEqual([...CLAUDE_BUILTIN_FLOOR]);
});

it('drops TodoWrite and both delegation spellings even when explicitly granted', () => {
  const transport = resolveToolTransport({
    allow: ['Read', 'TodoWrite', 'Task', 'Agent'],
    deny: [],
    coaToolNames: [],
  });
  expect(transport.tools).toEqual(['Read']);
});

it('keeps the floor as an intersection, never a widening', () => {
  const transport = resolveToolTransport({ allow: ['Read', 'Bash'], deny: [], coaToolNames: [] });
  expect(transport.tools).toEqual(['Read', 'Bash']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/tool-frame.test.ts`
Expected: FAIL — `CLAUDE_BUILTIN_FLOOR` is not exported, and `transport.tools` is `undefined` for an empty frame.

- [ ] **Step 3: Add the floor constant**

In `packages/adapter-claude-sdk/src/tool-frame.ts`, after `KNOWN_BUILTINS`:

```ts
/**
 * The built-in tools a governed session may use. Everything else the CLI ships is
 * removed: coa neither governs nor records it, and no other backend can match it.
 *
 * `Bash`, `WebSearch` and `WebFetch` keep Anthropic's implementations deliberately.
 * coa owns no native implementation anywhere — a trained tool prior covers the whole
 * contract, output shape included, and reimplementing the body while keeping the name
 * breaks the chains built on it (Read's numbered lines feed Edit's exact match).
 */
export const CLAUDE_BUILTIN_FLOOR: readonly string[] = [
  'Read',
  'Glob',
  'Grep',
  'Write',
  'Edit',
  'Bash',
  'WebSearch',
  'WebFetch',
];

const FLOOR_SET: ReadonlySet<string> = new Set(CLAUDE_BUILTIN_FLOOR);
```

- [ ] **Step 4: Make `tools` unconditional**

Replace the body of `resolveToolTransport` (`packages/adapter-claude-sdk/src/tool-frame.ts`):

```ts
export function resolveToolTransport(args: {
  allow: readonly string[];
  deny: readonly string[];
  coaToolNames: readonly string[];
}): ToolTransport {
  const coa = new Set(args.coaToolNames);
  const restrict = args.allow.length > 0;

  const allowCoa = args.allow.filter((name) => coa.has(name));
  const registerCoaTools = restrict ? allowCoa : [...args.coaToolNames];

  // The floor is a ceiling too: an allow list narrows it and never widens it, so a
  // frame cannot grant a built-in the session does not carry.
  const tools = restrict
    ? args.allow.filter((name) => !coa.has(name) && KNOWN_BUILTINS.has(name) && FLOOR_SET.has(name))
    : [...CLAUDE_BUILTIN_FLOOR];

  const denyCoa = args.deny.filter((name) => coa.has(name)).map(mcpToolName);
  const denyOther = args.deny.filter((name) => !coa.has(name));

  return {
    tools,
    autoApprove: [],
    disallowedTools: [...denyOther, ...denyCoa],
    registerCoaTools,
  };
}
```

Change the `tools` field on the `ToolTransport` interface from `tools?: string[];` to:

```ts
  /** The built-in set this session advertises — always the floor, or a narrowing of it. */
  tools: string[];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/tool-frame.test.ts`
Expected: PASS. Fix any existing test in that file that asserted `tools` was `undefined` for an empty frame — that assertion encoded the pass-through this task deliberately removes.

- [ ] **Step 6: Typecheck the spread site**

Run: `pnpm typecheck`
Expected: clean. `buildBaseOptions` spreads `...(tools !== undefined ? { tools } : {})` at `packages/adapter-claude-sdk/src/sdk-options.ts:126`; the conditional is now always true but still typechecks. Leave it — Task 2 does not touch it and it remains correct.

- [ ] **Step 7: Commit**

```bash
git add packages/adapter-claude-sdk/src/tool-frame.ts packages/adapter-claude-sdk/src/tool-frame.test.ts
git commit -m "fix: give a governed session one bounded built-in surface"
```

---

### Task 2: Widen the PreToolUse gate from delegation to every call

`gateDelegation` judges only `Task`/`Agent` and abstains on everything else, because ADR-0028 kept `canUseTool` as the primary seam. The gate run of 2026-08-03 measured `canUseTool` not firing for an ordinary in-cwd read, so the primary seam is unreliable. `PreToolUse` becomes the gate for every call — and only ever denies.

**Files:**
- Modify: `packages/adapter-claude-sdk/src/session-options.ts:17-52`
- Test: `packages/adapter-claude-sdk/src/session-options.test.ts`

**Interfaces:**
- Consumes: `CanUseTool` from `@coa/spi`; `ToolCall` from `@coa/shared` (both already imported).
- Produces: no signature change. `buildHooks(args)` keeps its shape; `DELEGATION_TOOL_NAMES` is no longer imported by this file.

- [ ] **Step 1: Write the failing tests**

Add to `packages/adapter-claude-sdk/src/session-options.test.ts`:

```ts
it('denies an ordinary built-in call at PreToolUse', async () => {
  const hooks = buildHooks({
    stopPredicate: () => ({ allow: true }),
    canUseTool: () => ({ behavior: 'deny', message: 'over cap' }),
    sessionId: 's1',
  });
  const result = await hooks.PreToolUse?.[0]?.hooks[0]?.(
    { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'a.ts' } } as never,
    undefined as never,
    { signal: new AbortController().signal },
  );
  expect(result).toEqual({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'over cap',
    },
  });
});

it('abstains rather than asserting allow, so coa only ever blocks', async () => {
  const hooks = buildHooks({
    stopPredicate: () => ({ allow: true }),
    canUseTool: () => ({ behavior: 'allow' }),
    sessionId: 's1',
  });
  const result = await hooks.PreToolUse?.[0]?.hooks[0]?.(
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } } as never,
    undefined as never,
    { signal: new AbortController().signal },
  );
  expect(result).toEqual({});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/session-options.test.ts`
Expected: FAIL — the first returns `{}` (the delegation filter abstains on `Read`), the second returns an explicit `allow`.

- [ ] **Step 3: Replace the gate**

In `packages/adapter-claude-sdk/src/session-options.ts`, replace `gateDelegation` with:

```ts
  // `PreToolUse` is the per-tool gate for the whole session, not just delegation.
  // `canUseTool` is not consulted for a native spawn, and the 2026-08-03 gate run
  // measured it not firing for an ordinary in-cwd read either; this seam sees both.
  //
  // It DENIES or ABSTAINS and never asserts `allow`: SC-1 gives coa two blocks and no
  // grants, and an explicit allow here would auto-approve a call the harness might
  // otherwise have prompted on.
  const gateToolCall: HookCallback = async (input) => {
    if (!('tool_name' in input)) return {};
    const args_ = 'tool_input' in input ? input.tool_input : {};
    const call: ToolCall = {
      tool: input.tool_name,
      args: (args_ ?? {}) as Record<string, unknown>,
      sessionId,
    };
    const decision = await canUseTool(call);
    if (decision.behavior === 'allow') return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: decision.message,
      },
    };
  };
```

Update the registration to `PreToolUse: [{ hooks: [gateToolCall] }],` and delete the now-unused `DELEGATION_TOOL_NAMES` import from this file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/session-options.test.ts`
Expected: PASS. The existing test "denies a spawn at PreToolUse under BOTH delegation spellings" still passes — delegation is a special case of "every call". Update the existing de-dup test that asserted abstention on non-delegation names; that behaviour is what this task removes.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/session-options.ts packages/adapter-claude-sdk/src/session-options.test.ts
git commit -m "fix: gate every tool call on the seam that sees them"
```

---

### Task 3: Construct the reconciler in the daemon

`Reconciler` is exported from `packages/core/src/index.ts:37`, has its own passing tests, and **nothing constructs it** — verified by grep across `packages/` and `apps/`. Producer ② has never run in a real session on either backend, which is why a `Bash`-mediated file change reaches M1 on neither.

**Files:**
- Modify: `packages/core/src/session/daemon.ts` (composition, near `emit: (draft) => kernel.emit(draft)` at line 296)
- Test: `packages/core/src/session/daemon.test.ts`

**Interfaces:**
- Consumes: `Reconciler`, `ReconcilerDeps` from `../reconcile/reconciler.js`; `kernel.emit(draft) => number`.
- Produces: `DaemonCore.observeChanges: () => void` — the neutral "record whatever changed on disk" port both backends call.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/session/daemon.test.ts`:

```ts
it('exposes an observeChanges port that drives producer 2', () => {
  const core = buildDaemonCore({ root: process.cwd() });
  expect(typeof core.observeChanges).toBe('function');
  // Calling it on a clean worktree is a no-op that must not throw.
  expect(() => core.observeChanges()).not.toThrow();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/src/session/daemon.test.ts`
Expected: FAIL — `core.observeChanges` is `undefined`.

- [ ] **Step 3: Construct the reconciler and expose the port**

In `packages/core/src/session/daemon.ts`, import at the top:

```ts
import { Reconciler } from '../reconcile/reconciler.js';
```

In the composition function, alongside the existing `checkpoint` wiring:

```ts
  // Producer ② (D123). The class shipped with tests but was never constructed, so a
  // change made by any tool coa does not execute itself — a native Edit, or anything
  // a Bash command touches — reached M1 on no backend. `reconcile()` scopes dirty
  // paths with git, dedups coa's own precise writes into a `confirm`, and respects
  // .gitignore, so triggering it is all a backend has to do.
  const reconciler = new Reconciler({
    worktree: 'main',
    root: options.root ?? '.',
    emit: (draft) => {
      kernel.emit(draft);
    },
  });
```

Add to the returned core object:

```ts
    observeChanges: () => reconciler.reconcile(),
```

Add the field to the core's type declaration (the same interface that declares `checkpoint: () => void`):

```ts
  /** Drive producer ② — record any on-disk change coa did not perform itself. */
  observeChanges: () => void;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/src/session/daemon.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify nothing else regressed**

Run: `pnpm vitest run packages/core` and `pnpm typecheck`
Expected: no new failures against the baseline.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session/daemon.ts packages/core/src/session/daemon.test.ts
git commit -m "feat: run the git reconciler the daemon never constructed"
```

---

### Task 4: Thread the port to the adapter seam and fire it from PostToolUse

**Files:**
- Modify: `packages/adapter-claude-sdk/src/session-options.ts` (register `PostToolUse`)
- Modify: `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts` (accept and forward the port)
- Modify: `packages/core/src/session/session.ts:285-300` (pass `deps.observeChanges` through)
- Test: `packages/adapter-claude-sdk/src/session-options.test.ts`

**Interfaces:**
- Consumes: `DaemonCore.observeChanges` from Task 3.
- Produces: `buildHooks` gains a required `observeChanges: () => void` argument; `ClaudeSdkAdapterInit` gains `observeChanges?: () => void`.

- [ ] **Step 1: Write the failing test**

Add to `packages/adapter-claude-sdk/src/session-options.test.ts`:

```ts
it('drives observeChanges after every tool call, whatever the tool was', async () => {
  let observed = 0;
  const hooks = buildHooks({
    stopPredicate: () => ({ allow: true }),
    canUseTool: () => ({ behavior: 'allow' }),
    sessionId: 's1',
    observeChanges: () => {
      observed += 1;
    },
  });
  const fire = async (tool: string): Promise<void> => {
    await hooks.PostToolUse?.[0]?.hooks[0]?.(
      {
        hook_event_name: 'PostToolUse',
        tool_name: tool,
        tool_input: {},
        tool_response: {},
        tool_use_id: 'tu_1',
      } as never,
      undefined as never,
      { signal: new AbortController().signal },
    );
  };
  await fire('Edit');
  await fire('Bash');
  expect(observed).toBe(2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/session-options.test.ts`
Expected: FAIL — `buildHooks` has no `observeChanges` parameter and registers no `PostToolUse`.

- [ ] **Step 3: Register the PostToolUse producer trigger**

Note: `observeChanges` is a **required** argument on `buildHooks`, so the two tests added in Task 2 stop compiling until they pass one. Add `observeChanges: () => {}` to both of those `buildHooks` calls as part of this step — a required argument makes it impossible to register the hooks while forgetting the producer, which is the failure this whole task exists to prevent.

In `packages/adapter-claude-sdk/src/session-options.ts`, extend the `buildHooks` argument type with `observeChanges: () => void`, destructure it, and add:

```ts
  // The producer trigger. coa does not parse `tool_input` per tool: the reconciler
  // scans the worktree itself, so one trigger covers a native Edit, a Write, and any
  // file a Bash command touched — which per-tool parsing would miss entirely.
  // Abstains always; observation is not governance.
  const observeAfterTool: HookCallback = async () => {
    observeChanges();
    return {};
  };
```

and register it:

```ts
  return {
    Stop: [{ hooks: [async () => toStopHookOutput(await stopPredicate())] }],
    PreToolUse: [{ hooks: [gateToolCall] }],
    PostToolUse: [{ hooks: [observeAfterTool] }],
  };
```

- [ ] **Step 4: Thread the port through the adapter and session**

In `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts`, add to `ClaudeSdkAdapterInit`:

```ts
  /**
   * Record on-disk changes coa did not perform itself (producer ②, M8-owned).
   * Absent ⇒ a no-op, so a backend or test that does not supply it behaves exactly
   * as today (D85).
   */
  observeChanges?: () => void;
```

At the `buildSessionOptions` call site inside the adapter, pass:

```ts
      observeChanges: this.#init.observeChanges ?? ((): void => {}),
```

In `packages/core/src/session/session.ts`, add `observeChanges: () => void;` to the deps interface beside `checkpoint`, and add it to the adapter init object built for the request:

```ts
    observeChanges: deps.observeChanges,
```

In `packages/core/src/session/composition.ts`, map `core.observeChanges` onto that dep the way `checkpoint` is already mapped.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/adapter-claude-sdk packages/core` and `pnpm typecheck`
Expected: PASS, typecheck clean, no new failures against the baseline.

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-claude-sdk/src/session-options.ts packages/adapter-claude-sdk/src/claude-sdk-adapter.ts packages/core/src/session/session.ts packages/core/src/session/composition.ts packages/adapter-claude-sdk/src/session-options.test.ts
git commit -m "feat: record file changes the agent made through native tools"
```

---

### Task 5: Fire the same port from the pure-API loop

The gap is not Claude-specific: `runGovernedLoop` emits change events only for tools it invokes itself, so a `Bash` command that writes a file is equally invisible on DeepSeek. Same port, second realization — this is what keeps the two backends converged.

**Files:**
- Modify: `packages/loop-driver/src/driver.ts:46-99` (deps) and `:201-247` (the tool-execution block)
- Modify: `packages/adapter-deepseek/src/adapter.ts` (forward the port)
- Modify: `packages/adapter-longcat/src/adapter.ts` (forward the port)
- Test: `packages/loop-driver/src/driver.test.ts`

**Interfaces:**
- Consumes: the same `observeChanges: () => void` contract as Task 4.
- Produces: `GovernedLoopDeps.observeChanges?: () => void`.

- [ ] **Step 1: Write the failing test**

Add to `packages/loop-driver/src/driver.test.ts`, following the existing mock-`complete` pattern in that file:

```ts
it('observes on-disk changes after each tool call', async () => {
  let observed = 0;
  await runGovernedLoop({
    sessionId: 's1',
    complete: mockComplete([
      { text: '', toolCalls: [{ id: 'c1', name: 'Bash', arguments: { command: 'touch x' } }] },
      { text: 'done', toolCalls: [] },
    ]),
    catalogue: [bashTool()],
    systemPrompt: 'sp',
    input: 'go',
    canUseTool: () => ({ behavior: 'allow' }),
    gate: () => ({ allow: true }),
    observeChanges: () => {
      observed += 1;
    },
  });
  expect(observed).toBe(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/loop-driver/src/driver.test.ts`
Expected: FAIL — `observeChanges` is not a recognised dep and is never called.

- [ ] **Step 3: Add the dep and call it**

In `packages/loop-driver/src/driver.ts`, add to `GovernedLoopDeps`:

```ts
  /**
   * Record on-disk changes the loop did not make through a catalogue tool — a file a
   * Bash command wrote, for instance. Driven at the same boundary the Claude backend
   * drives it from, so both backends record the same facts. Absent ⇒ byte-identical
   * to today (D85).
   */
  observeChanges?: () => void;
```

At the end of the per-call block, immediately after `messages.push({ role: 'tool', ... })`:

```ts
        // Producer ② at the same boundary the SDK backend uses (its PostToolUse hook).
        deps.observeChanges?.();
```

- [ ] **Step 4: Forward it from both thin adapters**

In `packages/adapter-deepseek/src/adapter.ts`, add `observeChanges?: () => void;` to `DeepSeekAdapterInit` with the same doc comment, and add to the `runGovernedLoop` call:

```ts
      ...(this.#init.observeChanges !== undefined
        ? { observeChanges: this.#init.observeChanges }
        : {}),
```

Repeat verbatim in `packages/adapter-longcat/src/adapter.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/loop-driver packages/adapter-deepseek packages/adapter-longcat` and `pnpm typecheck`
Expected: PASS, typecheck clean. The 5 pre-existing `adapter-deepseek` failures ("streaming response had no body") remain and must not grow.

- [ ] **Step 6: Commit**

```bash
git add packages/loop-driver/src/driver.ts packages/loop-driver/src/driver.test.ts packages/adapter-deepseek/src/adapter.ts packages/adapter-longcat/src/adapter.ts
git commit -m "feat: record file changes made outside a governed tool"
```

---

### Task 6: Record the decisions

**Files:**
- Create: `docs/adr/0029-one-bounded-tool-surface-governed-at-one-seam.md`
- Modify: `docs/adr/0028-per-tool-governance-rides-two-seams.md` (status → superseded)
- Modify: `ROADMAP.md` (M9/M1 rows, the P1a entry's follow-on, item K)
- Modify: `docs/design/research/2026-08-02-claude-sdk-control-ledger.md` (add the probes this plan needs to the item K batch)
- Modify: `packages/core/src/session/agent-registry.ts:60` (the standing-authority line)

- [ ] **Step 1: Write ADR-0029**

Cover, in the repo's ADR shape (Context / Decision drivers / Considered options / Decision / Consequences):
the eight-tool floor and why `Bash`/`WebSearch`/`WebFetch` keep native implementations; why coa owns **no** native implementation (the alias/own ruling of ADR-0027 resolved toward *own nothing*, because a trained prior covers the output contract and reimplementing the body breaks Read→Edit chains — cite claude-code issues #36654 and #28783); `PreToolUse` as the single per-tool gate that denies or abstains and never grants; `PostToolUse` and the driver boundary as two realizations of one `observeChanges` port; and the consequence that the console's plan checklist is gone with `TodoWrite`.

State explicitly that this **supersedes ADR-0028**, and why: 0028 kept `canUseTool` primary to preserve the SDK's `permission_denied` record, and the 2026-08-03 gate run measured `canUseTool` not firing for an ordinary in-cwd read — so the record it protected may not exist, while coa's own `deny` frame does.

- [ ] **Step 2: Mark ADR-0028 superseded**

Change its `Status: accepted` line to `Status: superseded by [0029](0029-one-bounded-tool-surface-governed-at-one-seam.md)` and leave the body untouched — an ADR is a record of what was decided, not a live document.

- [ ] **Step 3: Update ROADMAP**

Record: the eight-tool surface and the single gate under M9; producer ② now running under M1; the `TodoWrite`-driven plan checklist retired under M10; and extend item K's probe list with the three questions this plan raises — is a `PreToolUse` deny honoured, does `PostToolUse` fire for every tool including `Bash`, and does the `FileChanged` hook fire at all (a finer trigger than `PostToolUse`, present in `HOOK_EVENTS` and completely unmeasured).

- [ ] **Step 4: Correct the standing-authority line that this plan makes stale**

`packages/core/src/session/agent-registry.ts:60` tells every agent: *"Your file changes are recorded on a change spine and may be flagged for review, and a human can watch and steer. Prefer coa's governed tools (get_symbol, find_references, edit_symbol) where they are available."*

The first clause was false for native-tool edits until Task 3, and is now true. The second clause was written when coa's tools were the only recorded path — which they no longer are. Replace the preference sentence with one that states the reason coa's tools still earn a reach: they are symbol-precise and carry grounding, not merely recorded. Keep the recording claim, which the plan has now made honest.

- [ ] **Step 5: Verify the docs gate**

Run: `pnpm docs:check`
Expected: fails only on the gitignored local `TEMP.md`, exactly as the baseline.

- [ ] **Step 6: Commit**

```bash
git add docs/adr/0029-one-bounded-tool-surface-governed-at-one-seam.md docs/adr/0028-per-tool-governance-rides-two-seams.md ROADMAP.md docs/design/research/2026-08-02-claude-sdk-control-ledger.md packages/core/src/session/agent-registry.ts
git commit -m "docs: record one bounded tool surface governed at one seam"
```

---

## The live gate

This plan is **code-complete but not proven** until the item K batch runs. Its load-bearing dependency is that a `PreToolUse` deny is actually honoured by the CLI — verified against TypeScript types only, because `sdk.mjs` never reads `hookSpecificOutput` while the bundled binary does. The unrun second probe in `packages/adapter-claude-sdk/src/governed-gate.live.test.ts` answers exactly that.

**If the deny is not honoured, this design loses its governance leg** and the alternative — coa owning the tool implementations outright, accepting the prior loss — wins by default. Do not report the plan as closed on offline green alone; that is the failure mode this whole arc exists to avoid.

---

_Last reviewed: 2026-08-03_
