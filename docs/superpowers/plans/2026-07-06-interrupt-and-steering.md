# Interrupt + Steering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Grounding note:** Tasks 3, 4, and 6 touch external/less-read surfaces (the Claude Agent SDK `abortController`/`interrupt` API; the DeepSeek/LongCat `complete()` fetch calls; the console composer). Each of those tasks OPENS with a named grounding step — read the exact API/file first, then implement per the shape given. Tasks 1, 2, 5 are grounded against code already read (driver.ts, complete.ts, session.ts, session-handlers.ts, session-input.ts, router.ts) and carry concrete code.

**Goal:** A running governed session can be interrupted (stop the in-flight model call, keep completed blocks) and steered (inject a user turn mid-run, applied at the next safe boundary) — across both backends — through one AbortController seam and a live per-session input channel.

**Architecture:** M8 owns a per-session `AbortController` and a live input channel (an async queue that yields the first user turn plus any steered turns). The signal threads through `SessionAdapterInit` → the adapter → the model call (pure-API `complete()`/fetch; the SDK's native `abortController`). Two new RPC verbs — `interruptSession` (aborts the controller) and `steerSession` (pushes a turn onto the input channel) — drive them. The interrupt lands the *stop* in-flight but the *persistence* at the safe boundary (between round-trips), reusing Plan A1's flush-on-exit so completed blocks always survive. This is the G1 conversation-control workstream's second half (design: `docs/superpowers/specs/2026-07-06-coa-agent-hardening-design.md` §4-G1); the prior-art reference is Codex CLI's `turn/interrupt` + `turn/steer` verbs (`docs/design/research/2026-07-06-agent-hardening-prior-art.md`).

**Tech Stack:** TypeScript (strict), pnpm workspaces, Vitest, `@anthropic-ai/claude-agent-sdk`, `AbortController`/`AbortSignal` (WHATWG standard).

## Global Constraints

- **TypeScript `strict`, no `any`.**
- **SC-1 — surface, don't cage.** Interrupt is a user-initiated *stop*, not a governance block; it does NOT go through the deny channel and adds no new block class. The two blocks stay M3 close-gate + M7 cost-cap.
- **Block-preserving (Plan A1, do not regress).** Interrupt/steer exit through A1's `try/finally` flush trimmed to the last round-trip-consistent boundary. Only the in-progress block is dropped. **Pre-streaming, an aborted model call yields no partial assistant text, so the in-flight block is cleanly dropped; the "keep + mark partial text" behavior arrives with streaming (Plan E) — do NOT build partial-text retention here.**
- **D85 strict-superset.** A session that is never interrupted/steered behaves byte-identically to today. `signal`/steer are optional inputs; absent ⇒ current behavior.
- **Neutral seam (ADR 0002/0004).** No backend type crosses M8's seam: M8 passes a neutral `AbortSignal` + neutral `AsyncIterable<string>` input; each adapter maps to its own mechanism. Composition never branches on backend.
- **Determinism-first.** No model call on any critical path; interrupt/steer are deterministic control-flow.
- **Commit convention:** subject-line-only Conventional Commits — no body, no trailer, no phase/plan/module IDs in the subject.
- **Stage files by name; never `git add -A`. Never stage or edit `DEV-NOTES.md`.**
- **Same-commit doc rule:** the SPI/verb changes update the SPEC M8/M9 module files + ROADMAP in the same commit; keep `pnpm docs:check` green. Interrupt/steer add no new ADR (the AbortController seam is an implementation choice, not a new durable decision) — but note the seam in the SPEC.

---

### Task 1: AbortSignal through `complete()` + pure-API driver interrupt

**Files:**
- Modify: `packages/loop-driver/src/complete.ts` (add `signal` to `CompleteFn`)
- Modify: `packages/loop-driver/src/driver.ts` (thread `signal`; check at the safe boundary; pass to `complete`)
- Test: `packages/loop-driver/src/driver.test.ts`

**Interfaces:**
- Produces: `CompleteFn` gains an optional third arg `signal?: AbortSignal`. `GovernedLoopDeps` gains `signal?: AbortSignal`. On `signal.aborted` at the loop top, the loop breaks and flushes (A1's `finally`, trimmed to `lastConsistent`).

- [ ] **Step 1: Write the failing test** (add to `driver.test.ts`):

```ts
  it('stops at the next safe boundary when the signal aborts, flushing completed blocks', async () => {
    const onMessages = vi.fn();
    const controller = new AbortController();
    let n = 0;
    const complete: GovernedLoopDeps['complete'] = vi.fn(async () => {
      n += 1;
      if (n === 1) return { text: 'first answer', toolCalls: [], usage: USAGE };
      throw new Error('should not reach a second round-trip after abort');
    });
    // A gate that never allows the turn to end, so only the abort stops the loop.
    const gate = vi.fn(async () => {
      controller.abort(); // abort after the first round-trip settles
      return { allow: false, message: 'keep going' } as const;
    });
    await runGovernedLoop(
      deps({ complete, gate, signal: controller.signal, onMessages, input: 'do it' }),
    );
    expect(n).toBe(1); // never called complete() again after abort
    expect(onMessages).toHaveBeenCalledExactlyOnceWith([
      { role: 'user', content: 'do it' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'keep going' },
    ]);
  });
```

- [ ] **Step 2: Run it — FAIL** (`pnpm vitest run packages/loop-driver -t "safe boundary"`): the loop ignores the signal and calls `complete()` again → throws the guard error.

- [ ] **Step 3: Implement.** In `complete.ts`, extend `CompleteFn`:

```ts
export type CompleteFn = (
  messages: readonly DriverMessage[],
  tools: readonly ToolDef[],
  signal?: AbortSignal,
) => Promise<CompletionResult>;
```

In `driver.ts`: add `signal?: AbortSignal;` to `GovernedLoopDeps`. At the very top of the `for` loop body (the safe boundary — after `lastConsistent` reflects the last completed round-trip), add:

```ts
    if (deps.signal?.aborted) break;
```

and pass the signal into the model call: `const result = await deps.complete(messages, tools, deps.signal);`. The existing A1 `finally` flushes `messages.slice(1, lastConsistent)` on the break — completed blocks preserved, no partial.

- [ ] **Step 4: Run it — PASS**, then the full `@coa/loop-driver` suite. **Step 5: Commit** `feat: stop the pure-API loop at a safe boundary on an abort signal` (stage the 3 files by name).

---

### Task 2: Steering — inject a user turn at the safe boundary (pure-API)

**Files:**
- Modify: `packages/loop-driver/src/driver.ts`
- Test: `packages/loop-driver/src/driver.test.ts`

**Interfaces:**
- Produces: `GovernedLoopDeps` gains `drainSteer?: () => readonly string[]` — a synchronous drain of any queued steer turns. The driver calls it at the safe boundary (loop top, after the abort check) and pushes each as a `{ role: 'user' }` message, advancing `lastConsistent` (a user turn is round-trip-consistent).

- [ ] **Step 1: Write the failing test:**

```ts
  it('injects a queued steer turn at the next safe boundary before the next round-trip', async () => {
    const seen: DriverMessage[][] = [];
    let n = 0;
    const complete: GovernedLoopDeps['complete'] = vi.fn(async (messages) => {
      seen.push(structuredClone(messages) as DriverMessage[]);
      n += 1;
      if (n === 1) return { text: 'ok', toolCalls: [], usage: USAGE };
      return { text: 'done', toolCalls: [], usage: USAGE };
    });
    // Allow the turn to end only on the SECOND round-trip, so the steer lands between them.
    const gate = vi.fn(async () => (n >= 2 ? { allow: true } : { allow: false, message: 'more?' }) as const);
    const steer = ['actually, also do X'];
    const drainSteer = vi.fn(() => steer.splice(0, steer.length));
    await runGovernedLoop(deps({ complete, gate, drainSteer, input: 'do it' }));
    // The second round-trip's messages include the injected user turn.
    expect(seen[1]).toContainEqual({ role: 'user', content: 'actually, also do X' });
  });
```

- [ ] **Step 2: Run — FAIL** (no injection yet). **Step 3: Implement** at the loop top, after the abort check:

```ts
    for (const steer of deps.drainSteer?.() ?? []) {
      messages.push({ role: 'user', content: steer });
    }
    lastConsistent = messages.length; // a user turn is a consistent boundary
```

- [ ] **Step 4: Run — PASS** + full suite. **Step 5: Commit** `feat: inject steered user turns at the pure-API loop boundary`.

---

### Task 3: SDK adapter interrupt (native abortController) + streaming input

**Files:**
- Modify: `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts`
- Test: `packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts`

- [ ] **Step 0 (grounding):** Confirm the Claude Agent SDK API: `query(options)` accepts `options.abortController?: AbortController`, and the returned `Query` object exposes `interrupt(): Promise<void>` in streaming-input mode. Read the SDK types (`node_modules/@anthropic-ai/claude-agent-sdk`) to confirm the exact option name and whether aborting the `AbortController` alone suffices (it should — the SDK wires it into the underlying request). Implement per whichever is canonical; prefer passing `abortController` (neutral) over calling `interrupt()` if both work.

**Interfaces:**
- Consumes: `ClaudeSdkAdapterInit` gains `signal?: AbortSignal` (M8 supplies it). The adapter constructs/forwards an `AbortController` bound to that signal into the SDK `options.abortController`. Streaming input already flows via `toSdkPrompt` (an `AsyncIterable<string>` input, session-input.ts) — no change needed for steering here.

- [ ] **Step 1: Write the failing test** — inject a fake `query` (the Task-2/A1 seam) that yields one assistant message, then on the next iteration checks the passed `abortController.signal.aborted` and, if aborted, returns (ends the stream). Abort the signal after the first message; assert the stream ended early and the A1 `finally` flushed the received transcript. **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Add `signal?: AbortSignal` to `ClaudeSdkAdapterInit`. In `run`, build the SDK options with `abortController` derived from `this.#init.signal` (e.g. forward the signal into a fresh `AbortController` the SDK owns, or pass through if the SDK accepts a signal). The `finally` from A1 already flushes on the abort-driven stream end.
- [ ] **Step 4: Run — PASS** + full `@coa/adapter-claude-sdk` suite. **Step 5: Commit** `feat: honor an abort signal in the Claude SDK loop`.

---

### Task 4: Thread the signal to fetch in the pure-API adapters

**Files:**
- Modify: `packages/adapter-deepseek/src/*` (the `complete()`/fetch call) + its init
- Modify: `packages/adapter-longcat/src/*` (same)
- Test: each adapter's test

- [ ] **Step 0 (grounding):** Read each adapter's `complete()` implementation and how it calls `fetch`. Confirm where the `AbortSignal` should be passed (`fetch(url, { ..., signal })`) and how the adapter receives it (add `signal?: AbortSignal` to the adapter init, forwarded from `SessionAdapterInit.signal`, and pass it into the `complete()` the adapter builds for `runGovernedLoop`).

**Interfaces:**
- Consumes: `SessionAdapterInit.signal` (added in Task 5). Produces: each pure-API adapter's `complete()` passes `signal` to `fetch`, so an interrupt aborts the in-flight HTTP request.

- [ ] **Step 1–2:** For each adapter, write a failing test: an aborted signal makes `complete()` reject/abort the fetch (mock `fetch` to observe the `signal`). **Step 3:** pass `signal` into the `fetch` options and into the `runGovernedLoop({ signal })` deps. **Step 4:** PASS + suites. **Step 5: Commit** `feat: abort the in-flight request on interrupt in the pure-API adapters` (one commit for both adapters, or split if cleaner).

---

### Task 5: M8 per-session AbortController + input channel + `interruptSession`/`steerSession` verbs + status

**Files:**
- Modify: `packages/shared/src/push.ts` (add `'interrupted'` to the `status` state enum)
- Modify: `packages/core/src/session/session.ts` (thread `signal` + accept `AsyncIterable<string>` input already supported; pass `signal` into `createAdapter`)
- Modify: `packages/core/src/session/session-handlers.ts` (per-session `AbortController` + input channel; the two verbs; emit `'interrupted'` status; wire `drainSteer`/`signal`)
- Test: `packages/core/src/session/session-handlers.test.ts`

**Interfaces:**
- `SessionAdapterInit` gains `signal?: AbortSignal` (session.ts) and forwards it to `createAdapter`. `createSession` req already accepts `input: string | AsyncIterable<string>`.
- New verbs: `interruptSession({ id })` → `controller.abort()` for that session, emit `{ kind: 'status', state: 'interrupted' }`. `steerSession({ id, text })` → push `text` onto the session's input channel (SDK path) and/or its `drainSteer` buffer (pure-API path).
- M8 holds, per live session: `{ controller: AbortController, steer: string[], pushInput: (t: string) => void }`.

- [ ] **Step 0 (grounding):** Re-read `session-handlers.ts` `createSession` handler (the `live` map, the `record`/`status` emitters) and decide where the per-session control state lives (a `Map<string, SessionControl>` alongside `live`). Confirm how the input channel is built: an async generator that yields `params.input` first, then awaits pushed steer turns until the session ends — passed as `createSession({ input: <that async iterable> })`.

- [ ] **Step 1: Add `'interrupted'` to the status enum** (`push.ts`): `state: z.enum(['running','idle','blocked-approval','blocked-tool','done','error','interrupted'])`. Update any exhaustive switch on the state (grep for the enum). Test the schema parse.
- [ ] **Step 2: Write the failing tests** (session-handlers.test.ts): (a) `interruptSession` aborts the session's controller → the `FrameAdapter` fake (extended to observe `init.signal`) sees the abort and the handler emits an `interrupted` status; (b) `steerSession` pushes a turn that reaches the fake via the input channel. Extend `FrameAdapter` to record `init.signal` and consume `init.input` when it's an async iterable.
- [ ] **Step 3: Implement** the control map, the input-channel async generator, the two `rpcMethod` verbs, and the `signal`/input wiring into `createSession`. Emit `interrupted` status from `interruptSession`.
- [ ] **Step 4: PASS** + full `@coa/core` suite + `pnpm docs:check`. **Step 5: Commit** `feat: add interrupt and steer session verbs over an abort signal and input channel` (stage the source files + the SPEC M8/M9 doc updates + ROADMAP by name).

---

### Task 6: Console Stop/Esc + steer wiring + docs

**Files:**
- Modify: `apps/desktop/src/renderer/console.ts` + `panels/ChatPanel.tsx` (Stop button + Esc → `interruptSession`; typing while running → `steerSession`)
- Modify: the preload/main IPC bridge for the two new verbs
- Modify: `ROADMAP.md`, SPEC M8/M9 module files, `docs/REPO_LAYOUT.md` if files added
- Test: renderer unit tests where they exist

- [ ] **Step 0 (grounding):** Read the composer in `ChatPanel.tsx` (the overhaul shaped it with a Stop/Esc affordance and a running-status floor) and `console.ts`'s action wiring + the IPC bridge pattern used by `startSession`/`sendMessage`. Implement the two new actions on the same pattern.
- [ ] **Step 1–4:** Wire `interruptSession` to the composer Stop button + Esc key (live while a turn is running), and `steerSession` to a mid-run send (a send while status is `running` becomes a steer rather than a new turn). Add unit coverage for the action → IPC mapping. Update ROADMAP (interrupt + steering now done; note streaming still remaining) and the SPEC M8/M9 verbs. **Step 5: Commit** `feat: wire console stop and steer to the session verbs`.

---

## Self-Review

**Spec coverage (§4-G1 interrupt/steer):** interrupt at a safe boundary preserving completed blocks (Tasks 1,3,5); abort in-flight (Tasks 1,3,4 — signal to complete/fetch and SDK abortController); steering queued to the boundary (Tasks 2,5); surfaced via status + composer Stop/Esc (Tasks 5,6). Block-preserving reused from A1, no partial-text retention (deferred to Plan E) — stated in Global Constraints. ✅

**Deferred (not this plan):** partial-streamed-text keep+mark (Plan E streaming); the append-only log convergence (ADR 0010, deferred).

**Placeholder scan:** Tasks 1, 2, 5 carry concrete code. Tasks 3, 4, 6 carry a named Step-0 grounding step + the exact shape/interfaces to implement — intentional for the external-API surfaces, not vague placeholders.

**Type consistency:** `signal?: AbortSignal` is added consistently to `CompleteFn`, `GovernedLoopDeps`, `SessionAdapterInit`, `ClaudeSdkAdapterInit`, and each pure-API adapter init; `drainSteer?: () => readonly string[]` on `GovernedLoopDeps`; the `status` enum gains `'interrupted'` in the single M0 schema.
