# Block-Preserving Turn Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mid-turn model/fetch error no longer strands executed work — the canonical conversation transcript records every *completed* block on every exit path (clean settle, error, or future interrupt), so the next turn replays what really happened instead of the last user turn.

**Architecture:** Both governed loops (the coa-owned pure-API `runGovernedLoop` and the Claude SDK adapter's `run`) persist the canonical transcript (`onBackendMessages`) and settle usage (`onSettle`) **only after the loop finishes cleanly** today. This plan moves both into a `try/finally` so they fire on *every* exit path. The invariant holds by construction: each loop appends a block to its accumulated buffer only *after* the block is fully received, so at a throw the buffer already excludes the incomplete block. No partial-block surgery is needed.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Vitest, `better-sqlite3`/fs-backed conversation store, `@anthropic-ai/claude-agent-sdk`.

## Global Constraints

- **TypeScript `strict`, no `any`.** (docs/CODE_STYLE, docs/ENGINEERING)
- **SC-1 — surface, don't cage.** This change adds no block; it only changes *when* durable state is written. The two blocks (M3 close-gate, M7 cost-cap) are untouched.
- **D85 strict-superset.** Behavior with a clean turn is byte-identical to today; only the error/abort paths change.
- **Determinism-first.** No model call added to any path; persistence is deterministic.
- **Commit convention:** subject-line-only Conventional Commits — no body, no `Co-Authored-By`/trailer, no phase/plan/module IDs in the subject.
- **Stage files by name; never `git add -A`. Never stage or edit `DEV-NOTES.md`.**
- **Same-commit doc rule:** the capstone commit updates `ROADMAP.md`'s session-hardening line in the same commit as the behavior change. Keep `pnpm docs:check` green.
- **Scope note:** this plan is the block-preserving half of G1 (see `docs/superpowers/specs/2026-07-06-coa-agent-hardening-design.md` §4). Interrupt + steering are Plan A2; streaming is Plan E. Do **not** add an `AbortSignal`, interrupt verb, or streaming here — the `try/finally` this plan lands is the seam those build on.

---

### Task 1: Flush-on-exit in the pure-API driver

**Files:**
- Modify: `packages/loop-driver/src/driver.ts` (the `runGovernedLoop` body, ~L98-185, and the `onMessages` doc comment ~L58-63)
- Test: `packages/loop-driver/src/driver.test.ts` (add one test)

**Interfaces:**
- Consumes: `GovernedLoopDeps` (unchanged — `complete`, `catalogue`, `onMessages?`, `onSettle?`, `canUseTool`, `gate`), `CompleteFn`, `DriverMessage` (all from `./complete.js` / `./driver.js`).
- Produces: no signature change. `runGovernedLoop` now calls `onSettle` then `onMessages` from a `finally`, and **re-throws** the original error after flushing (the caller's `.catch` still records the error frame).

- [ ] **Step 1: Write the failing test**

Add to `packages/loop-driver/src/driver.test.ts` inside `describe('runGovernedLoop', …)`:

```ts
  it('flushes completed blocks and usage when a later round-trip throws (block-preserving)', async () => {
    const onMessages = vi.fn();
    const onSettle = vi.fn();
    let n = 0;
    const complete: GovernedLoopDeps['complete'] = vi.fn(async () => {
      n += 1;
      if (n === 1) {
        return {
          text: 'working',
          toolCalls: [{ id: 'c1', name: 'get_symbol', arguments: {} }],
          usage: USAGE,
        };
      }
      throw new Error('connection dropped');
    });

    await expect(
      runGovernedLoop(
        deps({ catalogue: [tool('get_symbol')], complete, input: 'do it', onMessages, onSettle }),
      ),
    ).rejects.toThrow('connection dropped');

    // The completed first round-trip survived in the canonical transcript (system omitted).
    expect(onMessages).toHaveBeenCalledTimes(1);
    expect(onMessages.mock.calls[0]![0]).toEqual([
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: 'working',
        toolCalls: [{ id: 'c1', name: 'get_symbol', arguments: {} }],
      },
      { role: 'tool', toolCallId: 'c1', content: '{"ok":true,"args":{}}' },
    ]);
    // Usage accrued for the completed round-trip is still charged.
    expect(onSettle).toHaveBeenCalledExactlyOnceWith('s1', USAGE);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/loop-driver test -- driver.test.ts -t "block-preserving"`
Expected: FAIL — `onMessages`/`onSettle` are called 0 times (they sit after the loop, which the throw skips).

- [ ] **Step 3: Wrap the loop body in try/finally**

In `packages/loop-driver/src/driver.ts`, change the end of `runGovernedLoop`. Wrap the existing `for` loop and move the two settle calls into a `finally`:

```ts
  try {
    for (let i = 0; i < maxIterations; i += 1) {
      // … existing loop body unchanged …
    }
  } finally {
    // Flush on EVERY exit — clean settle, model/fetch error, or (later) interrupt — so the
    // canonical transcript records every completed block and a partial turn is still charged.
    // Safe on a throw: a block is pushed to `messages` only after it is fully received, so the
    // buffer already excludes the incomplete one (block-preserving by construction).
    deps.onSettle?.(deps.sessionId, usage);
    deps.onMessages?.(messages.slice(1));
  }
```

Delete the old post-loop lines (the previous `deps.onSettle?.(…)` and `deps.onMessages?.(messages.slice(1))` that followed the loop). `finally` does not swallow the throw, so the error still propagates to the caller.

- [ ] **Step 4: Update the `onMessages` doc comment**

Replace the `onMessages` doc (~L58-63) so it no longer claims it is skipped on a throw:

```ts
  /**
   * Called once the turn settles — cleanly, OR on a model/fetch error (or, later, an
   * interrupt) — with the full conversation (system prompt omitted) so the caller can
   * persist it as the next turn's {@link history}. Every *completed* block is included;
   * the block in flight when a throw happened is excluded by construction, so the
   * persisted transcript is always block-consistent.
   */
```

- [ ] **Step 5: Run test to verify it passes (and the suite is green)**

Run: `pnpm --filter @coa/loop-driver test -- driver.test.ts`
Expected: PASS — the new test plus every existing `runGovernedLoop` test (the clean-settle tests still see exactly one `onMessages`/`onSettle` call).

- [ ] **Step 6: Commit**

```bash
git add packages/loop-driver/src/driver.ts packages/loop-driver/src/driver.test.ts
git commit -m "fix: preserve completed blocks when a governed turn errors mid-loop"
```

---

### Task 2: Flush-on-exit in the Claude SDK adapter

**Files:**
- Modify: `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts` (add an injectable `query` to `ClaudeSdkAdapterInit`; wrap the `for await` stream in `try/finally`)
- Test: `packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts` (add one test)

**Interfaces:**
- Consumes: `ClaudeSdkAdapterInit` (gains an optional `query`), `messageToBackendMessages`, `messageToFrames`, `onBackendMessages?`.
- Produces: `ClaudeSdkAdapterInit.query?: typeof query` — an injection seam for tests, defaulting to the real SDK import. `run` now flushes `transcript` via `onBackendMessages` from a `finally`.

- [ ] **Step 1: Add the injectable `query` seam**

In `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts`, add to `ClaudeSdkAdapterInit` (after `deliverHistoryAsPreamble`, ~L88):

```ts
  /**
   * The SDK `query` primitive. Injectable so the loop can be unit-tested with a
   * scripted stream; defaults to the real `@anthropic-ai/claude-agent-sdk` import.
   */
  query?: typeof query;
```

In `run`, just before the stream loop (~L251), resolve it:

```ts
    const runQuery = this.#init.query ?? query;
```

and change `for await (const message of query({` to `for await (const message of runQuery({`.

- [ ] **Step 2: Write the failing test**

Add to `packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts`:

```ts
  it('flushes the transcript received so far when the SDK stream throws mid-turn', async () => {
    const flushed: unknown[] = [];
    async function* boom(): AsyncGenerator<unknown> {
      yield {
        type: 'assistant',
        session_id: 'srv-1',
        message: { content: [{ type: 'text', text: 'partial work' }] },
      };
      throw new Error('stream dropped');
    }
    const a = adapter({
      query: (() => boom()) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query,
      onBackendMessages: (m) => flushed.push(...m),
    });
    a.renderNative(neutral());
    a.interceptTool(() => ({ behavior: 'allow' }));
    a.interceptStop(() => ({ allow: true }));

    await expect(a.runLoop(session)).rejects.toThrow('stream dropped');
    // The assistant text received before the throw survives in the canonical transcript.
    expect(flushed).toContainEqual({ role: 'assistant', content: 'partial work' });
  });
```

(If `runLoop` needs the rendered options set up first, mirror the existing `runLoop` tests in this file for the exact `renderNative`/`interceptTool`/`interceptStop` preamble and the `session` fixture already defined at the top of the file.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @coa/adapter-claude-sdk test -- claude-sdk-adapter.test.ts -t "flushes the transcript"`
Expected: FAIL — `onBackendMessages` is never reached (it sits after the `for await`, which the throw skips), so `flushed` is empty.

- [ ] **Step 4: Wrap the stream loop in try/finally**

In `run`, wrap the `for await` and move the flush into `finally`:

```ts
    try {
      for await (const message of runQuery({
        prompt: toSdkPrompt(modelPrompt),
        options: { ...options, cwd: sessionConfig.worktree },
      })) {
        // … existing loop body unchanged …
      }
    } finally {
      // Flush on every exit path (clean, error, interrupt) — the model may have produced
      // real blocks before the stream dropped; they must reach canonical memory.
      this.#init.onBackendMessages?.(transcript);
    }
```

Delete the old post-loop `this.#init.onBackendMessages?.(transcript);` line.

- [ ] **Step 5: Run test to verify it passes (and the suite is green)**

Run: `pnpm --filter @coa/adapter-claude-sdk test -- claude-sdk-adapter.test.ts`
Expected: PASS — the new test plus existing runLoop tests (a clean stream still flushes exactly once, now from `finally`).

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-claude-sdk/src/claude-sdk-adapter.ts packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts
git commit -m "fix: flush the Claude transcript to memory when the stream drops mid-turn"
```

---

### Task 3: Session-level reconciliation + ROADMAP update

**Files:**
- Modify: `packages/core/src/session/session-handlers.test.ts` (extend the `FrameAdapter` fake with a flush-then-fail mode; add one integration test)
- Modify: `ROADMAP.md` (session-hardening line: H1/H2 block-preserving persistence now done)
- Test: the same `session-handlers.test.ts`

**Interfaces:**
- Consumes: `buildSessionHandlers(deps, connection, store)`, `createConversationStore(dir)`, the `createSession` handler's `conversationId` param, `store.loadBackendMessages(id)`.
- Produces: proof that a mid-turn error persists the flushed transcript to `messages.json` (via the adapter's Task-1/2 flush) *and* still surfaces an `error` status — the two are correctly ordered (flush during unwind, then the `.catch` clears the resume token).

- [ ] **Step 1: Give the fake adapter a flush-then-fail mode**

In `packages/core/src/session/session-handlers.test.ts`, extend `FrameAdapter` to model a *fixed* adapter that flushes before throwing. Add a constructor flag and branch in `runLoop`:

```ts
  constructor(
    readonly init: SessionAdapterInit,
    readonly frames: TurnFrame[],
    readonly fail = false,
    readonly pureApi = false,
    /** Model the fixed adapter: flush the canonical transcript, then throw (a mid-turn drop). */
    readonly flushThenFail = false,
  ) {}
```

In `runLoop`, before the existing `if (this.fail) throw …`, add:

```ts
    if (this.flushThenFail) {
      const input = typeof this.init.input === 'string' ? this.init.input : '';
      this.init.onBackendMessages?.([
        ...(this.init.history ?? []),
        { role: 'user', content: input },
        { role: 'assistant', content: 'reply' },
      ]);
      throw new Error('stream dropped after partial work');
    }
```

Add a deps factory that turns the flag on:

```ts
function depsFlushThenFail(): SessionDeps {
  return { ...deps([]), createAdapter: (init) => new FrameAdapter(init, [], false, false, true) };
}
```

- [ ] **Step 2: Write the failing test**

Add a new `describe` block to `session-handlers.test.ts`:

```ts
describe('buildSessionHandlers — block-preserving persistence on error', () => {
  it('persists the flushed transcript and still surfaces an error status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-conv-'));
    try {
      const store = createConversationStore(dir);
      const conn = connection();
      const handlers = buildSessionHandlers(depsFlushThenFail(), conn, store);
      await handlers['createSession']!.handle({ input: 'edit the file', conversationId: 'c1' });
      await conn.settled;

      // The completed work reached canonical memory despite the mid-turn throw.
      expect(store.loadBackendMessages('c1')).toContainEqual({ role: 'assistant', content: 'reply' });
      // The failure is still surfaced (SC-1: surface, don't cage).
      expect(pushesOf(conn.pushes).at(-1)).toMatchObject({ kind: 'status', state: 'error' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails, then confirm it passes**

Run: `pnpm --filter @coa/core test -- session-handlers.test.ts -t "block-preserving persistence"`
Expected: PASS immediately — the fake's `flushThenFail` calls `onBackendMessages` (→ `store.saveBackendMessages`) *before* throwing, and the handler's `.catch` surfaces the error. (This test guards the session-handlers wiring — that persistence happens during unwind, before the resume token is cleared — so a future refactor can't reorder them. If it does *not* pass, the `.catch` is discarding persisted state; investigate before proceeding.)

- [ ] **Step 4: Update ROADMAP**

In `ROADMAP.md`, under **Session hardening** (the cross-cutting workstream) and the **Coa-agent hardening** section, move H1/H2 block-preserving *persistence* from "Remaining" to done, keeping interrupt/steer + streaming as remaining. Edit the session-hardening "Remaining:" clause to read:

```
Remaining: block-preserving interrupt (H1) and steering, streaming output, role/capability
enforcement, the system-prompt viewer, and the apply-as-update injection spike
```

and under **Coa-agent hardening**, adjust the H1/H2 bullet to note the persistence fix landed (completed blocks now survive a mid-turn error; interrupt + steering remain).

- [ ] **Step 5: Verify docs + full test suite**

Run: `pnpm docs:check`
Expected: `docs-check OK`.
Run: `pnpm --filter @coa/core test -- session-handlers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session/session-handlers.test.ts ROADMAP.md
git commit -m "test: prove a mid-turn error preserves the conversation transcript"
```

---

## Self-Review

**Spec coverage (§4 G1 block-preserving portion):**
- "Flush the accumulated canonical transcript on every exit path" → Task 1 (pure-API), Task 2 (SDK). ✅
- "Settle accumulated usage on the error path too" → Task 1 (`onSettle` in `finally`). The SDK settles per `result` message, so a pre-result throw has no usage to settle — acceptable and noted. ✅
- "Shared pattern, two sites" → Tasks 1 + 2 apply the identical `try/finally` shape to both loops. ✅
- "The incomplete block is excluded by construction" → asserted directly in Task 1 (the thrown 2nd round-trip contributes nothing) and Task 2 (the throw follows a fully-yielded assistant message). ✅
- Session-handlers reconciliation (persist-before-clear-token) → Task 3. ✅

**Explicitly deferred (not this plan):** `AbortSignal`/interrupt verb, steering queue, streaming `complete()` — Plans A2 and E.

**Placeholder scan:** none — every step carries real code or an exact command + expected result.

**Type consistency:** `onMessages`/`onBackendMessages` take `readonly DriverMessage[]` / `readonly BackendMessage[]` (same shape); `USAGE`, `deps`, `tool` are the existing `driver.test.ts` helpers; `query?: typeof query` matches the SDK import; `FrameAdapter`/`createConversationStore`/`pushesOf`/`connection` are the existing `session-handlers.test.ts` helpers.
