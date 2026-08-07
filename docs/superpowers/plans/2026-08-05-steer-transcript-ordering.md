# Steer Transcript Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A steer is written to the append-only log at the moment the model receives it, in a
position the Messages API permits, and the console shows it pinned meanwhile.

**Architecture:** Core's delivery-drain closure becomes the single writer of a delivery's log line.
It writes on drain unless a `tool_use` is open, in which case it holds the line and writes it when
the last open tool closes — the legality rule stated directly, so it is correct whichever order the
Claude SDK fires its `PostToolUse` hook in. Barge-in is removed, collapsing three steer seams
(`drainSteer`, `drainQueuedSteer`, `drainDeliveries`) into one.

**Tech Stack:** TypeScript (strict, no `any`) · pnpm workspaces · Vitest · Zod · React (console).

**Spec:** [2026-08-05-steer-transcript-ordering-design.md](../specs/2026-08-05-steer-transcript-ordering-design.md)

## Global Constraints

- **Work directly on `main`.** No worktree, no feature branch, whatever any skill suggests.
- **Commit messages are subject-only Conventional Commits.** No body, no `Co-Authored-By`, no
  "Generated with" trailer, no phase numbers / plan names / module IDs in the subject.
- **Stage files by name. Never `git add -A`.** `DEV-NOTES.md`, `README.md`, and `.coa/` carry
  unrelated local edits — never stage them.
- **There is NO CI.** A skipped or platform-gated test runs nowhere at all. Never add `.skip` or a
  platform guard. The only permitted gate is `COA_LIVE` on `*.live.test.ts`.
- **TypeScript `strict`, no `any`.** `exactOptionalPropertyTypes` is on: build optional fields with
  the `...(x !== undefined ? { x } : {})` spread the surrounding code already uses.
- **Comments state why, not what.** Never reference a task number, plan name, or phase in a code
  comment. Durable rationale links an ADR (`docs/adr/0031`).
- **Scratch files go in the session scratchpad, never the repo tree.**
- **`COA_LIVE` spends real tokens — ask the maintainer before any live run.** No task here needs one.

### Baselines — verify against unmodified `main` before blaming your change, and never let them grow

**Measured on unmodified `main` at 2026-08-05, not copied from a handoff.** Two entries below
contradict what the handoff for this work claimed; the measurements are what count.

| Command | Baseline |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm test` | **11 failures** / ~2929 passing (5 deepseek + 5 longcat "streaming response had no body" + 1 live LongCat 402) |
| `pnpm lint` | 9 errors, 3 warnings |
| `pnpm format` (`prettier --check .`) | **53 files fail** — NOT clean, despite the handoff saying so |
| `pnpm depcruise` | **3 dependency violations** — not mentioned in the handoff at all |
| `pnpm docs:check` | fails **only** on the gitignored `TEMP.md` |

**Two traps in that table.**

`pnpm format` is dirty on `main` before you start. Do **not** "fix" it — that is 53 unrelated files
and a diff nobody asked for. The failures split two ways: some files are CRLF on disk (e.g.
`tsconfig.json`) against Prettier's default `endOfLine: "lf"`, and some are genuine drift (e.g.
`packages/shared/src/agent.ts`). **One file this plan touches is already dirty:
`apps/desktop/src/preload/api.d.ts` (Task 5).** Running `prettier --write` on it would bury your
change under an unrelated reformat. Edit it by hand, match the surrounding style, and leave its
pre-existing violations alone.

`.prettierignore` excludes `**/*.md` entirely, so **Prettier never checks documentation**. A
`prettier --check` on a Markdown path reports success vacuously — it matched nothing. Do not use that
as evidence a doc is formatted.

`packages/core/src/session/daemon.test.ts` intermittently times out under full-suite parallel load.
Pre-existing and load-related; re-run it in isolation before blaming yourself.

### Five hazards this repo has actually been bitten by

1. **A test that passes before the fix proves nothing.** For every test you write, state the one-line
   production revert that makes it fail, then **perform** that revert and confirm the failure before
   implementing. The immediately preceding arc hit this five times. Specific traps here: asserting
   only that a line exists (true under both implementations — assert its **index**), and a fixture
   whose turn completes in one microtask burst, so a test named for a *running* turn exercises an
   *idle* one.
2. **`rpcMethod` is a pure type cast.** All Zod validation happens inside `dispatch()`. A test
   calling `handlers['x'].handle(params)` directly bypasses validation entirely — so removing a
   field from a params schema will NOT make such a test fail.
3. **Single-item fixtures hide grouping bugs.** Use two deliveries, mixed origins, wherever order or
   grouping matters.
4. **`apps/cli/src/adapter-factory.ts` hand-maps every `SessionAdapterInit` field with no spread.**
   Add a field and forget this file and the feature ships **dead** with a green typecheck and green
   suite. It has happened three times. `apps/cli/src/adapter-factory.test.ts` holds a whole-contract
   forwarding test — **any change to the init type changes that file too.**
5. **`packages/core/src/session/agent-registry.ts` is NOT the agent registry.** It is the
   package/role starter registry. The agent registry is `agent-defs.ts`. Neither is touched here.

### Read before editing

`packages/core/src/session/session-handlers.ts` is ~1226 lines and was heavily modified by the
preceding arc. **Read it end to end before your first edit and trust the code over any line number
in this plan.**

---

## File Structure

**Core (`packages/core/src/session/`)**

- `session-handlers.ts` — both `record()` closures gain the open-tool count; both delivery-drain
  closures become the writer; barge-in is removed; `steerParams` loses `mode`.
- `live-session.ts` — `SteerMode`, `TurnControl.steer`, `TurnControl.queueSteer` removed.
- `session.ts` — `SessionAdapterInit.drainSteer` / `drainQueuedSteer` removed (both declaration and
  forwarding).
- `session-handlers.test.ts` — new fixtures and tests; barge-in tests deleted.

**SPI + driver + adapters**

- `packages/spi/src/runtime-adapter.ts` — no delivery change; only the `TurnInterrupt` doc comment's
  barge-in reference.
- `packages/loop-driver/src/driver.ts` — `drainSteer` / `drainQueuedSteer` removed; one
  `absorbDeliveries` helper used at the top of the loop and at the close-gate.
- `packages/adapter-deepseek/src/adapter.ts`, `packages/adapter-longcat/src/adapter.ts` — the two
  removed init fields and their forwarding.
- `apps/cli/src/adapter-factory.ts` + `.test.ts` — the two removed fields.

**Console**

- `packages/console-transcript/src/dense/frames.ts` — `pending?: boolean` on the `text` frame.
- `packages/console-transcript/src/dense/Transcript.tsx` — pending styling in `TranscriptRow`.
- `apps/desktop/src/renderer/panels/Composer.tsx` — Barge In → Steer.
- `apps/desktop/src/renderer/panels/ChatPanel.tsx` — the pending-steer list and its reconciliation.
- `apps/desktop/src/renderer/console.ts` — `steerSession` sends no `mode`.
- `apps/desktop/src/preload/api.d.ts` — the `steerSession` signature.

**Docs**

- `docs/adr/0031-a-steer-is-recorded-when-the-model-receives-it.md` (new)
- `docs/adr/0030-delivery-one-intent-realized-per-backend.md` (amended)
- `ROADMAP.md`

---

## Task 1: Core records a held-open delivery at pickup

**Files:**

- Modify: `packages/core/src/session/session-handlers.ts` — `establishHeldQuery` (the `record`
  closure, `flushStrandedDeliveries`, `recordSteerTurn`, the `createSession` call's
  `drainDeliveries`, and `setInterruptClosure`)
- Test: `packages/core/src/session/session-handlers.test.ts`

**Interfaces:**

- Consumes: `Delivery` from `@coa/spi` (`{ origin: 'user' | 'system'; text: string }`),
  `session.deliveries` (`DeliveryQueue` with `push` / `drain` / `size` / `seal` / `isSealed`).
- Produces: nothing exported. Internal to `establishHeldQuery`: `recordSteerTurn(text, role?)`,
  `takeDeliveries(): readonly Delivery[]`, `flushHeldDeliveries(): void`.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/session/session-handlers.test.ts`. Put the fixture immediately after
`HeldOpenAdapter` (around line 1536) and the `describe` after `depsHeldOpen`.

```ts
/**
 * A held-open adapter whose turn is GENUINELY still running when the test steers: it emits
 * `tool_use`, parks on `toolRunning` (the test resolves it), drains deliveries where the Claude
 * adapter's PostToolUse hook drains them — BEFORE the tool_result reaches core — and only then
 * emits `tool_result` and the boundary. Parking matters: a fixture that completes inside one
 * microtask burst exercises an idle turn while claiming to test a running one.
 */
class OpenToolHeldAdapter implements RuntimeAdapter {
  readonly consumed: string[] = [];
  /** Resolved by the test once its steer has been pushed onto the delivery queue. */
  release: () => void = () => {};
  readonly toolRunning: Promise<void>;
  /** The deliveries this adapter drained, in drain order (test observation point). */
  deliveryDrained: readonly Delivery[] = [];

  constructor(readonly init: SessionAdapterInit) {
    this.toolRunning = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
    const input = this.init.input;
    if (typeof input === 'string') return;
    for await (const text of input) {
      this.consumed.push(text);
      this.init.onTurn?.({ t: 'tool_use', tool: 'Bash', input: {}, handle: 'h1' });
      await this.toolRunning;
      this.deliveryDrained = this.init.drainDeliveries?.() ?? [];
      this.init.onTurn?.({ t: 'tool_result', handle: 'h1', ok: true, pointer: 'ok' });
      this.init.onTurn?.({ t: 'text', text: 'ok' });
      this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 2, costUsd: 0.25 });
      this.init.onTurn?.({ t: 'turn-boundary', role: 'assistant' });
    }
  }
  deliverReminder(): void {}
  render_context(): void {}
  inject_runtime(): void {}
  cache_control(): void {}
  usageTelemetry(): RuntimeUsage {
    return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  }
  capabilityProfile() {
    return barebonesProfile;
  }
  refs() {
    return null;
  }
  runEval() {
    return Promise.reject(new Error('no eval'));
  }
}

function depsOpenTool(adapters: OpenToolHeldAdapter[]): SessionDeps {
  return {
    ...deps([]),
    sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
    createAdapter: (init) => {
      const adapter = new OpenToolHeldAdapter(init);
      adapters.push(adapter);
      return adapter;
    },
  };
}

describe('buildSessionHandlers — a delivery is recorded where the model received it', () => {
  it('writes the line AFTER the tool_result, never between the tool_use and its result', async () => {
    const conn = connection();
    const adapters: OpenToolHeldAdapter[] = [];
    const registry = new LiveSessionRegistry();
    const handlers = buildSessionHandlers(depsOpenTool(adapters), conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    // The turn is parked mid-tool-call: the tool_use frame is out, the tool_result is not.
    await vi.waitFor(() => expect(adapters[0]).toBeDefined());
    await vi.waitFor(() =>
      expect(framesOf(conn.pushes).some((f) => f.t === 'tool_use')).toBe(true),
    );
    expect(framesOf(conn.pushes).some((f) => f.t === 'tool_result')).toBe(false);

    await handlers['steerSession']!.handle({ id: sessionId, text: 'use the JSON one' });
    // Not yet: the model has not been handed it, so nothing may claim it was said. Matched on
    // the steer's own text, not on "any user frame" — the turn's opening input is a user frame
    // too, and asserting against all of them would fail for a reason that is not the bug.
    expect(
      framesOf(conn.pushes).some((f) => f.t === 'text' && f.text === 'use the JSON one'),
    ).toBe(false);

    adapters[0]!.release();
    await conn.settled;
    await flush();

    const frames = framesOf(conn.pushes);
    const useAt = frames.findIndex((f) => f.t === 'tool_use');
    const resultAt = frames.findIndex((f) => f.t === 'tool_result');
    const steerAt = frames.findIndex(
      (f) => f.t === 'text' && f.role === 'user' && f.text === 'use the JSON one',
    );
    const diag = JSON.stringify(frames.map((f) => f.t));
    expect(steerAt, diag).toBeGreaterThan(-1);
    // THE ASSERTION THAT MATTERS: position, not existence. A line between the pair is the
    // interleaving the Messages API forbids, and it is what the old code produced.
    expect(steerAt, diag).toBeGreaterThan(resultAt);
    expect(useAt, diag).toBeLessThan(resultAt);
  });

  it('records a system-origin delivery in the system role, not the person\'s', async () => {
    const conn = connection();
    const adapters: OpenToolHeldAdapter[] = [];
    const registry = new LiveSessionRegistry();
    const handlers = buildSessionHandlers(depsOpenTool(adapters), conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    await vi.waitFor(() => expect(adapters[0]).toBeDefined());
    // Two entries, mixed origins: a single-item fixture cannot show the roles diverging.
    const session = registry.get(sessionId)!;
    session.deliveries.push({ origin: 'user', text: 'from the person' });
    session.deliveries.push({ origin: 'system', text: 'child agent finished' });
    adapters[0]!.release();
    await conn.settled;
    await flush();

    const texts = framesOf(conn.pushes).flatMap((f) =>
      f.t === 'text' && (f.role === 'user' || f.role === 'system') ? [[f.role, f.text]] : [],
    );
    expect(texts).toEqual([
      ['user', 'from the person'],
      ['system', 'child agent finished'],
    ]);
  });

  it('never records a delivery the model was never handed (sealed queue)', async () => {
    const conn = connection();
    const adapters: OpenToolHeldAdapter[] = [];
    const registry = new LiveSessionRegistry();
    const handlers = buildSessionHandlers(depsOpenTool(adapters), conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    await vi.waitFor(() => expect(adapters[0]).toBeDefined());
    const session = registry.get(sessionId)!;
    session.deliveries.seal();
    await handlers['steerSession']!.handle({ id: sessionId, text: 'never delivered' });
    adapters[0]!.release();
    await conn.settled;
    await flush();

    expect(framesOf(conn.pushes).some((f) => f.t === 'text' && f.text === 'never delivered')).toBe(
      false,
    );
  });
});
```

If `framesOf` does not already exist in this file, add it next to `pushesOf`:

```ts
/** Every turn frame pushed, in push order — the read-time view of the append-only log. */
function framesOf(pushes: RpcNotification[]): TurnFrame[] {
  return pushesOf(pushes).flatMap((p) => (p.kind === 'turn' ? [p.frame] : []));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/src/session/session-handlers.test.ts -t "recorded where the model received it"`

Expected: the first test FAILS on `expect(steerAt).toBeGreaterThan(resultAt)` — today
`recordSteerTurn` fires at send, so the line sits between `tool_use` and `tool_result`. The second
FAILS (no `system` line is written at all). The third may pass for the wrong reason; that is fine,
it is a guard.

- [ ] **Step 3: Implement**

In `establishHeldQuery`, give `recordSteerTurn` a role and add the deferral. Replace the
`recordSteerTurn` definition (currently around line 870) with:

```ts
    // A delivery's line is written when the model RECEIVES it, not when it was sent: a
    // line written at send-time claims a position in the conversation that never happened,
    // and lands between a `tool_use` and its `tool_result` — the one interleaving the
    // Messages API forbids (docs/adr/0031).
    //
    // A COUNT, not a set of handles: a mapped `tool_use` falls back to an empty handle, so
    // two concurrent calls would collide in a set.
    let openTools = 0;
    const heldDeliveries: Delivery[] = [];

    const recordSteerTurn = (steerText: string, role: 'user' | 'system' = 'user'): void => {
      const started = startedRef.current;
      if (started === undefined) return;
      const s = seqBox.value++;
      const frame: TurnFrame = { t: 'text', text: steerText, role };
      session.emit({
        kind: 'turn',
        sessionId: started.id,
        worktree: started.worktree,
        seq: s,
        frame,
      });
      if (prep.persistIn !== undefined)
        prep.persistIn.store.append(prep.persistIn.convId, [{ seq: s, frame }]);
    };

    const writeDelivery = (delivery: Delivery): void =>
      recordSteerTurn(delivery.text, delivery.origin === 'system' ? 'system' : 'user');

    /** Write everything parked behind an open tool call, in the order it was delivered. */
    function flushHeldDeliveries(): void {
      for (const held of heldDeliveries.splice(0, heldDeliveries.length)) writeDelivery(held);
    }

    /**
     * The single writer of a delivery's log line (docs/adr/0010 — one writer per record).
     * Every drain point on every backend goes through here, so the rule lives in one place
     * and core never learns which backend drained it.
     */
    const takeDeliveries = (): readonly Delivery[] => {
      const pending = session.deliveries.drain();
      for (const delivery of pending) {
        if (openTools > 0) heldDeliveries.push(delivery);
        else writeDelivery(delivery);
      }
      return pending;
    };
```

Keep the existing doc comment above `recordSteerTurn` but drop its "Records the text AS FED to the
model (framed, for barge-in)" sentence — nothing frames a recorded delivery any more.

In the `record` closure, immediately **after** the persist block and **before**
`if (frame.t === 'turn-boundary') {`, add:

```ts
      // The legality gate: a delivery drained while a tool call is open cannot be written
      // until that call's result lands, or the line falls between the pair (docs/adr/0031).
      if (frame.t === 'tool_use') openTools += 1;
      else if (frame.t === 'tool_result') {
        openTools = Math.max(0, openTools - 1);
        if (openTools === 0) flushHeldDeliveries();
      }
```

At the very top of the `if (frame.t === 'turn-boundary') {` block, before the `awaitingRedirect`
check, add the floor:

```ts
        // A turn can end with a tool still open (an interrupt, an error, a result that never
        // arrived). Nothing else will close it, so write what is parked rather than lose text
        // the model was already handed.
        openTools = 0;
        flushHeldDeliveries();
```

In `setInterruptClosure`, between `for (const partial of acc.drainPartials()) record(partial);` and
`record({ t: 'interrupted' });`, add the same two lines — the delivery reached the model before the
stop, so it belongs above the interrupt marker:

```ts
            openTools = 0;
            flushHeldDeliveries();
```

Change the `createSession` call's drain from `drainDeliveries: () => session.deliveries.drain(),` to:

```ts
        drainDeliveries: takeDeliveries,
```

In the steer sink's `else if (running)` branch, **delete** the `recordSteerTurn(text);` line, leaving
only `session.deliveries.push({ origin: 'user', text });`, and replace that branch's comment with:

```ts
              // Mid-loop delivery: the running turn's own loop picks this up at its next
              // round trip. It is NOT another SDK turn, so it must not be counted — the
              // in-flight turn still owns the single pending slot (docs/adr/0012 I3). The
              // log line is written when the backend DRAINS it, not here (docs/adr/0031).
```

In `flushStrandedDeliveries`, change `const pending = session.deliveries.drain();` to
`const pending = takeDeliveries();` and replace the "NOT re-recorded" paragraph of its doc comment
with:

```
     * Recorded HERE, by `takeDeliveries`, like every other drain point: nothing wrote these
     * lines earlier (docs/adr/0031). A `user` entry is then fed bare so the log and the model
     * agree on the text; a `system` entry is framed as a notice, so the model cannot read an
     * automated report as the person speaking (docs/adr/0030).
```

Add `Delivery` to the `@coa/spi` type import at the top of the file if it is not already imported.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core/src/session/session-handlers.test.ts`
Expected: PASS, including every pre-existing test in the file.

Then confirm the guard actually guards — temporarily change `if (openTools > 0)` to `if (false)` in
`takeDeliveries`, re-run, and confirm the position assertion fails. Restore it.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/session-handlers.ts packages/core/src/session/session-handlers.test.ts
git commit -m "fix: record a delivery where the model received it, not where it was sent"
```

---

## Task 2: The per-turn path records its own deliveries

**Files:**

- Modify: `packages/core/src/session/session-handlers.ts` — `runPerTurn`
- Modify: `packages/loop-driver/src/driver.ts` — the delivery block stops emitting frames
- Test: `packages/core/src/session/session-handlers.test.ts`, `packages/loop-driver/src/driver.test.ts`

**Interfaces:**

- Consumes: Task 1's rule, re-stated for the per-turn closure. Nothing is shared between the two
  closures — they are separate function scopes with separate `seqBox`es, and the repo's existing
  shape keeps them independent.
- Produces: nothing exported.

**Why one commit:** core starts writing the line and the driver stops writing it. Split across two
commits, one of them double-records.

- [ ] **Step 1: Write the failing test**

In `packages/loop-driver/src/driver.test.ts`, replace the assertions of the existing delivery test
(search for `drainDeliveries`) or add:

```ts
  it('feeds a delivery to the model without writing its log line (core owns the record)', async () => {
    const complete = completions([{ text: 'done', toolCalls: [] }]);
    const gate = vi.fn(async () => ({ allow: true }) as const);
    const frames: TurnFrame[] = [];
    const pending: Delivery[] = [
      { origin: 'user', text: 'from the person' },
      { origin: 'system', text: 'child agent finished' },
    ];
    const drainDeliveries = vi.fn(() => pending.splice(0, pending.length));
    await runGovernedLoop(
      deps({ complete, gate, drainDeliveries, input: 'do it', onTurn: (f) => frames.push(f) }),
    );
    expect(drainDeliveries).toHaveBeenCalled();
    // The driver hands the text to the model but writes nothing: core's drain closure is the
    // single writer, so an emit here would put the same line in the log twice.
    expect(frames.some((f) => f.t === 'text' && (f.role === 'user' || f.role === 'system'))).toBe(
      false,
    );
  });
```

In `packages/core/src/session/session-handlers.test.ts`, add to the existing per-turn steer
`describe`:

```ts
  it('writes a per-turn delivery line once, in the delivered order', async () => {
    const conn = connection();
    const adapters: FrameAdapter[] = [];
    const registry = new LiveSessionRegistry();
    const handlers = buildSessionHandlers(
      {
        ...deps([{ t: 'text', text: 'reply' }]),
        createAdapter: (init) => {
          const a = new FrameAdapter(
            init,
            [{ t: 'text', text: 'reply' }],
            false,
            true,
            false,
            false,
            true,
          );
          adapters.push(a);
          return a;
        },
      },
      conn,
      undefined,
      registry,
    );
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    const session = registry.get(sessionId)!;
    session.deliveries.push({ origin: 'user', text: 'check the schema first' });
    session.deliveries.push({ origin: 'system', text: 'child agent finished' });
    await conn.settled;
    await flush();

    const written = framesOf(conn.pushes).flatMap((f) =>
      f.t === 'text' && (f.role === 'user' || f.role === 'system') ? [[f.role, f.text]] : [],
    );
    expect(written).toEqual([
      ['user', 'check the schema first'],
      ['system', 'child agent finished'],
    ]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/loop-driver/src/driver.test.ts packages/core/src/session/session-handlers.test.ts -t delivery`
Expected: the driver test FAILS (it emits `role: 'user'` / `role: 'system'` frames today); the core
test FAILS (nothing writes the line on the per-turn path).

- [ ] **Step 3: Implement**

In `packages/loop-driver/src/driver.ts`, replace the delivery block (currently lines 164-172) with:

```ts
      // Mid-loop delivery. A `system` entry rides the user role because the Messages API
      // offers no other slot for mid-conversation input. No frame is emitted: core's drain
      // closure writes the log line for every backend, so emitting here would write it twice
      // (docs/adr/0010, docs/adr/0031).
      for (const delivery of deps.drainDeliveries?.() ?? []) {
        const text = delivery.origin === 'user' ? delivery.text : `[coa notice] ${delivery.text}`;
        messages.push({ role: 'user', content: text });
      }
```

In `packages/core/src/session/session-handlers.ts`'s `runPerTurn`, add the same machinery Task 1
added to `establishHeldQuery`. Immediately after the `record` closure's definition (around line 561):

```ts
    // Same rule as the held-open path: a delivery's line is written when the model receives
    // it, and never between a `tool_use` and its `tool_result` (docs/adr/0031). A count, not
    // a set of handles — a mapped `tool_use` can carry an empty handle.
    let openTools = 0;
    const heldDeliveries: Delivery[] = [];

    const writeDelivery = (delivery: Delivery): void => {
      if (started === undefined) return;
      const s = seqBox.value++;
      const frame: TurnFrame = {
        t: 'text',
        text: delivery.text,
        role: delivery.origin === 'system' ? 'system' : 'user',
      };
      session.emit({
        kind: 'turn',
        sessionId: started.id,
        worktree: started.worktree,
        seq: s,
        frame,
      });
      if (prep.persistIn !== undefined)
        prep.persistIn.store.append(prep.persistIn.convId, [{ seq: s, frame }]);
    };

    function flushHeldDeliveries(): void {
      for (const held of heldDeliveries.splice(0, heldDeliveries.length)) writeDelivery(held);
    }

    const takeDeliveries = (): readonly Delivery[] => {
      const pending = session.deliveries.drain();
      for (const delivery of pending) {
        if (openTools > 0) heldDeliveries.push(delivery);
        else writeDelivery(delivery);
      }
      return pending;
    };
```

Inside `runPerTurn`'s `record` closure, after the persist block (currently line 560), add:

```ts
      if (frame.t === 'tool_use') openTools += 1;
      else if (frame.t === 'tool_result') {
        openTools = Math.max(0, openTools - 1);
        if (openTools === 0) flushHeldDeliveries();
      }
```

`runPerTurn`'s `record` has no `turn-boundary` branch, so add the floor to its interrupt closure
instead — in `setInterruptClosure`, between the partial drain and `record({ t: 'interrupted' })`:

```ts
              openTools = 0;
              flushHeldDeliveries();
```

And after `await createSession(...)` returns (in the `try` block, before the existing post-loop
handling), add the end-of-loop floor:

```ts
      // The loop is over; anything still parked behind a tool that never returned its result
      // was still handed to the model, so it is written rather than lost.
      openTools = 0;
      flushHeldDeliveries();
```

Change `drainDeliveries: () => session.deliveries.drain(),` to `drainDeliveries: takeDeliveries,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/loop-driver packages/core/src/session/session-handlers.test.ts packages/core/src/session/transcript-projection.test.ts`
Expected: PASS.

`transcript-projection.test.ts` is in that list deliberately. `foldEventsToTranscript` folds a
`'system'`-role frame into its own `{ role: 'user', content }` message rather than merging it into
the open assistant message — an integrity boundary that, left unhandled, corrupted what the model is
told it previously said. Both tasks so far write `'system'` frames into the log for the first time on
paths that did not produce them before, so that fold is now genuinely exercised. **It must not
regress**, and this plan asks nothing new of it: recording at pickup makes the fold's input legal, it
does not change the fold.

Confirm the guard: temporarily restore the driver's `emit({ t: 'text', text, role: 'user' })` line,
re-run the core test, and confirm the delivery line now appears twice. Remove it again.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/session-handlers.ts packages/core/src/session/session-handlers.test.ts packages/loop-driver/src/driver.ts packages/loop-driver/src/driver.test.ts
git commit -m "fix: give the pure-API path the same delivery record timing"
```

---

## Task 3: Remove barge-in from core

**Files:**

- Modify: `packages/core/src/session/session-handlers.ts` — the steer sink, `HeldQuery`, `record`,
  `steerParams`, `FRAME_BARGE_IN`, `steerSession`
- Modify: `packages/core/src/session/live-session.ts` — `SteerMode`, `TurnControl`
- Test: `packages/core/src/session/session-handlers.test.ts`

**Interfaces:**

- Consumes: Task 1's `recordSteerTurn(text, role?)`.
- Produces: `LiveSession.setSteerSink(sink: ((text: string) => void) | undefined)` and
  `LiveSession.pushSteer(text: string): boolean` — both lose the `mode` parameter.
  `steerParams` becomes `z.object({ id: z.string(), text: z.string() })`.

- [ ] **Step 1: Write the failing test**

Delete the barge-in tests in `session-handlers.test.ts` (search for `'barge-in'`), including the
`InterruptingHeldAdapter` fixture and the `depsHeldOpen` variants that only serve them. Then add:

```ts
  it('routes a steer at a working held-open turn to the delivery queue, never an interrupt', async () => {
    const conn = connection();
    const adapters: OpenToolHeldAdapter[] = [];
    const registry = new LiveSessionRegistry();
    const handlers = buildSessionHandlers(depsOpenTool(adapters), conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    await vi.waitFor(() => expect(adapters[0]).toBeDefined());
    await handlers['steerSession']!.handle({ id: sessionId, text: 'use the JSON one' });

    // The running turn keeps its work: the steer rides the delivery queue, and the input
    // channel is untouched (a second consumed input would mean it ran as its own turn).
    expect(registry.get(sessionId)!.deliveries.size()).toBe(1);
    adapters[0]!.release();
    await conn.settled;
    await flush();
    expect(adapters[0]!.consumed).toEqual(['go']);
    expect(adapters[0]!.deliveryDrained).toEqual([
      { origin: 'user', text: 'use the JSON one' },
    ]);
  });

  it('rejects a steer carrying a mode, since there is only one steer', () => {
    const handlers = buildSessionHandlers(deps([]), connection(), undefined, new LiveSessionRegistry());
    // Asserted on the SCHEMA, not through `.handle()`: `rpcMethod` is a pure type cast and all
    // Zod validation happens in `dispatch()`, so a direct `.handle()` call proves nothing here.
    expect(
      handlers['steerSession']!.params?.safeParse({ id: 's', text: 't', mode: 'barge-in' }).success,
    ).toBe(false);
  });
```

Note the second test requires the schema to be `.strict()`. If `steerParams` is not strict, make it
so as part of Step 3 — otherwise the assertion is unprovable and should be deleted rather than
weakened to something that passes vacuously.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/src/session/session-handlers.test.ts -t steer`
Expected: the mode test FAILS (`mode` is currently a valid key). The routing test may pass already —
that is expected; it is the regression guard for what Step 3 deletes.

- [ ] **Step 3: Implement**

In `live-session.ts`:

- Delete `export type SteerMode = 'queue' | 'barge-in';`.
- Delete `steer: string[];` and `queueSteer: string[];` from `TurnControl`, and rewrite the
  interface doc comment so it no longer describes a steer queue.
- Change `#steerSink` to `((text: string) => void) | undefined`, `setSteerSink` to take that type,
  and `pushSteer(text: string): boolean` to call `this.#steerSink(text)`.
- Rewrite `TurnControl.mode`'s doc comment: `held-open` routes a steer through `pushSteer`;
  `per-turn` has no sink, so the caller pushes onto `session.deliveries` directly.

In `session-handlers.ts`:

- `steerParams` → `z.object({ id: z.string(), text: z.string() }).strict()`.
- Delete the `FRAME_BARGE_IN` constant.
- Delete `barging` and `awaitingRedirect` from the `HeldQuery` type and its initializer.
- In `record`, delete the `frame.t === 'error' && query.barging > 0` block and the
  `if (query.awaitingRedirect)` block inside the `turn-boundary` branch, plus `query.barging = 0;`
  inside the `pendingTurns <= 0` branch.
- Replace the whole `session.setSteerSink((text, mode) => { ... })` body with:

```ts
          // A steer never abandons work in flight: while a turn runs it rides the session's
          // delivery queue, which the backend drains from inside that turn — beside the next
          // tool result, one round trip away, discarding nothing (docs/adr/0031). Only an idle
          // steer enters the input feed, as a plain next turn, where send and pickup coincide.
          session.setSteerSink((text) => {
            if (query.pendingTurns > 0) {
              // NOT another SDK turn, so it must not be counted — the in-flight turn still
              // owns the single pending slot (docs/adr/0012 I3). Its log line is written when
              // the backend drains it, not here.
              session.deliveries.push({ origin: 'user', text });
            } else {
              recordSteerTurn(text);
              channel.push(text);
            }
          });
```

- In `steerSession`, replace the mode branch with:

```ts
      if (session.control.mode === 'held-open') {
        session.pushSteer(params.text);
      } else {
        // Per-turn backends have no held-open sink; the same one queue reaches their loop
        // at the top of its next round trip (docs/adr/0031).
        session.deliveries.push({ origin: 'user', text: params.text });
      }
```

and rewrite its doc comment to describe one steer with one destination.

- In `runPerTurn`, delete `const steer: string[] = [];` and `const queueSteer: string[] = [];`, the
  `drainSteer` / `drainQueuedSteer` entries on the `createSession` call, and `steer` / `queueSteer`
  from the `session.control` assignment. Do the same for the `steer` array in `establishHeldQuery`
  and its `drainSteer` entry.
- Update `runPerTurn`'s doc comment, which currently says "steers drain via `drainSteer`".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core && pnpm typecheck`
Expected: PASS and clean. `pnpm typecheck` will flag `drainSteer` / `drainQueuedSteer` still declared
in `session.ts` — that is Task 4; if it blocks, leave the declarations in place (unused optional
fields typecheck fine) and remove them in Task 4.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/session-handlers.ts packages/core/src/session/live-session.ts packages/core/src/session/session-handlers.test.ts
git commit -m "feat: make a steer deliver into the running turn instead of abandoning it"
```

---

## Task 4: Delete the two dead steer seams and add the per-turn delivery floor

**Files:**

- Modify: `packages/core/src/session/session.ts` (declaration + forwarding)
- Modify: `packages/loop-driver/src/driver.ts`
- Modify: `packages/adapter-deepseek/src/adapter.ts`, `packages/adapter-longcat/src/adapter.ts`
- Modify: `apps/cli/src/adapter-factory.ts`, `apps/cli/src/adapter-factory.test.ts`
- Modify: `packages/spi/src/runtime-adapter.ts` (the `TurnInterrupt` doc comment only)
- Test: `packages/loop-driver/src/driver.test.ts`, `packages/adapter-deepseek/src/adapter.test.ts`,
  `packages/adapter-longcat/src/adapter.test.ts`, `apps/cli/src/adapter-factory.test.ts`

**Interfaces:**

- Consumes: `DrainDeliveries = () => readonly Delivery[]` from `@coa/spi` (unchanged).
- Produces: `SessionAdapterInit` and `GovernedLoopDeps` lose `drainSteer` and `drainQueuedSteer`.
  `runGovernedLoop` gains a private `absorbDeliveries(): boolean` — drains, pushes onto `messages`,
  returns whether anything was absorbed.

- [ ] **Step 1: Write the failing test**

In `packages/loop-driver/src/driver.test.ts`, delete the four `drainSteer` / `drainQueuedSteer`
tests (lines ~341, ~362, ~616, ~622) and add:

```ts
  it('re-enters the loop for a delivery that arrived after the close-gate allowed a stop', async () => {
    // The pure-API floor: the model stopped and the gate allowed it, but text is pending.
    // Without this the delivery is stranded — fed to nobody, with no drain point left.
    const complete = completions([
      { text: 'first', toolCalls: [] },
      { text: 'second', toolCalls: [] },
    ]);
    const gate = vi.fn(async () => ({ allow: true }) as const);
    const pending: Delivery[] = [];
    let asked = 0;
    const drainDeliveries = vi.fn(() => {
      asked += 1;
      // Arrives only once the first round trip is over, so it cannot be picked up at the
      // top-of-loop drain — the close-gate is the sole remaining boundary.
      if (asked === 2) pending.push({ origin: 'system', text: 'child agent finished' });
      return pending.splice(0, pending.length);
    });
    await runGovernedLoop(deps({ complete, gate, drainDeliveries, input: 'do it' }));
    expect(complete).toHaveBeenCalledTimes(2);
    const second = complete.mock.calls[1]?.[0] ?? [];
    expect(second.some((m) => m.content === '[coa notice] child agent finished')).toBe(true);
  });
```

In `apps/cli/src/adapter-factory.test.ts`, remove `'drainSteer'` and `'drainQueuedSteer'` from the
sample init (lines ~151-152) and from all three expectation lists (lines ~192-193, ~206-207, ~224).
Leave `'observeChanges'` and `'onTurnInterrupt'` in the known-gaps list — **those two remain genuine
pre-existing bugs and are not fixed here.**

In both adapter test files, delete the `drainSteer` / `drainQueuedSteer` forwarding tests.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/loop-driver/src/driver.test.ts -t "close-gate allowed a stop"`
Expected: FAIL — `complete` is called once; the loop breaks at the gate and the delivery is never
fed.

- [ ] **Step 3: Implement**

In `packages/loop-driver/src/driver.ts`:

- Delete the `drainSteer` and `drainQueuedSteer` fields from `GovernedLoopDeps`.
- Delete the `for (const steer of deps.drainSteer?.() ?? [])` block.
- Replace the delivery block with a call to one helper, defined just above the `for` loop:

```ts
    /**
     * Take everything pending and hand it to the model. One helper, two call sites (the
     * top of each round trip and the close-gate floor) — draining is destructive, so the
     * gate cannot defer to the top-of-loop drain, and two copies could diverge.
     *
     * A `system` entry rides the user role because the Messages API offers no other slot
     * for mid-conversation input; the notice framing keeps the model from reading an
     * automated report as the person speaking. No frame is emitted — core's drain closure
     * is the single writer of the log line (docs/adr/0010, docs/adr/0031).
     */
    const absorbDeliveries = (): boolean => {
      const pending = deps.drainDeliveries?.() ?? [];
      for (const delivery of pending) {
        messages.push({
          role: 'user',
          content: delivery.origin === 'user' ? delivery.text : `[coa notice] ${delivery.text}`,
        });
      }
      return pending.length > 0;
    };
```

Call `absorbDeliveries();` at the top of each iteration where the old blocks were, and replace the
`drainQueuedSteer` block at the close-gate with:

```ts
        if (decision.allow) {
          // The floor: text that arrived with no drain point left would otherwise be fed to
          // nobody — the person or the parent agent would get silence (SC-1, docs/adr/0031).
          if (absorbDeliveries()) continue;
          break;
        }
```

In `packages/core/src/session/session.ts`, delete both `drainSteer` and `drainQueuedSteer` — the
declarations on `SessionAdapterInit`, the two on the `createSession` request type, and the two
forwarding spreads.

In both pure-API adapters, delete the two init fields and their forwarding spreads. In
`apps/cli/src/adapter-factory.ts`, delete the four forwarding lines (102-103, 120-121) and fix the
`sessionStrategy` doc comment's "a fresh loop + `drainSteer` each turn".

In `packages/spi/src/runtime-adapter.ts`, rewrite `TurnInterrupt`'s doc comment: it stops the running
turn for a **user stop**; nothing routes a barge-in through it any more.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/loop-driver packages/adapter-deepseek packages/adapter-longcat apps/cli && pnpm typecheck`
Expected: PASS (deepseek/longcat keep their 10 baseline failures) and clean.

Confirm the floor guards: temporarily change `if (absorbDeliveries()) continue;` to
`absorbDeliveries();`, re-run, confirm the new test fails. Restore.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/session.ts packages/loop-driver/src/driver.ts packages/loop-driver/src/driver.test.ts packages/adapter-deepseek/src/adapter.ts packages/adapter-deepseek/src/adapter.test.ts packages/adapter-longcat/src/adapter.ts packages/adapter-longcat/src/adapter.test.ts packages/spi/src/runtime-adapter.ts apps/cli/src/adapter-factory.ts apps/cli/src/adapter-factory.test.ts
git commit -m "refactor: collapse three steer seams into one delivery queue"
```

---

## Task 5: The composer offers Steer instead of Barge In

**Files:**

- Modify: `apps/desktop/src/renderer/panels/Composer.tsx`
- Modify: `apps/desktop/src/renderer/console.ts`
- Modify: `apps/desktop/src/preload/api.d.ts`
- Modify: `apps/desktop/src/main/index.ts` (only if it names the removed `mode`)
- Modify: `apps/desktop/src/shared/methods.ts` (only if it types `steerSession`'s params)
- Test: `apps/desktop/src/renderer/panels/ChatPanel.test.tsx`, `apps/desktop/src/renderer/console.test.tsx`

**Interfaces:**

- Consumes: `steerSession({ id, text })` — no `mode` (Task 3).
- Produces: `ComposerProps.onSteer?: (text: string) => void` replaces `onBarge`. `ChatVm.onSteer`
  replaces `ChatVm.onBargeIn`.

- [ ] **Step 1: Write the failing test**

In `apps/desktop/src/renderer/console.test.tsx`:

```ts
  it('sends a steer with no mode, since a steer never abandons the running turn', async () => {
    const calls: unknown[] = [];
    const state = await bootConsole({
      steerSession: (params: unknown) => {
        calls.push(params);
        return Promise.resolve({ steered: true });
      },
    });
    state.actions.steerSession('sess-1', 'use the JSON one');
    expect(calls).toEqual([{ id: 'sess-1', text: 'use the JSON one' }]);
  });
```

Adapt `bootConsole` to whatever helper `console.test.tsx` already uses to stub the bridge — read the
file first and follow its existing pattern rather than introducing a new one.

In `ChatPanel.test.tsx`:

```ts
  it('labels the running-turn action Steer and routes it to onSteer', async () => {
    const onSteer = vi.fn();
    renderChat({ sessionStatus: 'running', onSteer });
    await typeIntoComposer('use the JSON one');
    expect(screen.queryByRole('button', { name: /barge/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Steer' }));
    expect(onSteer).toHaveBeenCalledWith('use the JSON one');
  });
```

Again, follow the file's existing render/type helpers.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/renderer`
Expected: FAIL — the button is named "Barge In" and `steerSession` sends `mode: 'barge-in'`.

- [ ] **Step 3: Implement**

`Composer.tsx`:

- `onBarge` → `onSteer`; the local `barge` function → `steer`.
- The button label `Barge In` → `Steer`; its tooltip `Redirects the running turn now` →
  `Reaches the agent at its next step, without discarding its work`.
- The `running` placeholder → `'Queue a message… (⌥⏎ steers now · esc stops)'`.
- The `running: true` doc comment's "Queue / Barge-in steer split" → "Queue / Steer split", and the
  component doc's "Barge-in redirects it now" → "Steer reaches it at its next step".

`ChatPanel.tsx`: rename `onBargeIn` to `onSteer` on the vm and at its `state.actions.steerSession`
call site; update the `handleQueue` comment that says "barge-in skips the queue entirely".

`console.ts`: drop `mode: 'barge-in'` from the `bridge.steerSession` call and rewrite the
`steerSession` doc comment — it currently says the console does **not** render optimistically and
that the daemon pushes the framed steer at send-time. Both are now false:

```ts
  /** Steer: reach the running turn at its next step, discarding nothing (SC-1: a user
   *  redirect, never a block). The daemon writes the transcript line when the model actually
   *  RECEIVES the text (docs/adr/0031), which is seconds later — so `ChatPanel` shows the
   *  message pinned at the bottom of the transcript meanwhile and drops the pin when the real
   *  frame arrives. Queue-mode follow-ups stay held console-side until the turn ends. */
```

`api.d.ts`: `steerSession(params: { id: string; text: string }): Promise<{ steered: boolean }>` and
update its comment. Check `main/index.ts` and `shared/methods.ts` for a `mode` reference and remove
it if present.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop && pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/Composer.tsx apps/desktop/src/renderer/panels/ChatPanel.tsx apps/desktop/src/renderer/console.ts apps/desktop/src/preload/api.d.ts apps/desktop/src/renderer/panels/ChatPanel.test.tsx apps/desktop/src/renderer/console.test.tsx
git commit -m "feat: replace the composer's barge-in with a non-destructive steer"
```

(Add `apps/desktop/src/main/index.ts` and `apps/desktop/src/shared/methods.ts` to the `git add` only
if you changed them.)

---

## Task 6: The console pins a steer until the agent picks it up

**Files:**

- Modify: `packages/console-transcript/src/dense/frames.ts`
- Modify: `packages/console-transcript/src/dense/Transcript.tsx`
- Modify: `apps/desktop/src/renderer/panels/ChatPanel.tsx`
- Test: `packages/console-transcript/src/dense/Transcript.test.tsx`,
  `apps/desktop/src/renderer/panels/ChatPanel.test.tsx`

**Interfaces:**

- Consumes: `TranscriptFrame` (`kind: 'text'`, `role: 'you'`), `ChatVm.onSteer` (Task 5).
- Produces: `TranscriptFrame`'s `text` variant gains `pending?: boolean | undefined`.

- [ ] **Step 1: Write the failing test**

In `Transcript.test.tsx` (or `TranscriptRow`'s unit tests — follow whichever the file uses; the row
is exported and unit-tested per-kind so no Virtuoso dependency is needed):

```ts
  it('marks a pending row so an unsent steer never reads as part of the record', () => {
    const { container } = renderRow({
      id: 'pending:0',
      role: 'you',
      kind: 'text',
      text: 'use the JSON one',
      pending: true,
    });
    expect(container.textContent).toContain('use the JSON one');
    expect(container.querySelector('[data-pending="true"]')).not.toBeNull();
  });
```

In `ChatPanel.test.tsx`:

```ts
  it('pins a sent steer at the transcript bottom and drops the pin when the real frame lands', async () => {
    const onSteer = vi.fn();
    const view = renderChat({ sessionStatus: 'running', onSteer, frames: [agentTextFrame('working…')] });
    await typeIntoComposer('use the JSON one');
    await userEvent.click(screen.getByRole('button', { name: 'Steer' }));

    // Pinned, and LAST — it has not happened yet, so it cannot sit above what has.
    const pinned = screen.getByText('use the JSON one');
    expect(pinned.closest('[data-pending="true"]')).not.toBeNull();
    expect(lastRowText(view)).toBe('use the JSON one');

    // The daemon's real line arrives at pickup; the pin must go, or the message doubles.
    view.rerender({
      sessionStatus: 'running',
      onSteer,
      frames: [agentTextFrame('working…'), youTextFrame('use the JSON one')],
    });
    expect(screen.getAllByText('use the JSON one')).toHaveLength(1);
    expect(screen.queryByTestId('pending-steer')).toBeNull();
  });

  it('clears a pin when the session goes idle, so it can never wedge', async () => {
    const onSteer = vi.fn();
    const view = renderChat({ sessionStatus: 'running', onSteer });
    await typeIntoComposer('never delivered');
    await userEvent.click(screen.getByRole('button', { name: 'Steer' }));
    expect(screen.getByText('never delivered')).toBeDefined();

    view.rerender({ sessionStatus: 'idle', onSteer });
    expect(screen.queryByText('never delivered')).toBeNull();
  });
```

Follow the file's existing `renderChat` / rerender helper shapes; add `agentTextFrame` /
`youTextFrame` / `lastRowText` locally if they do not exist.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/console-transcript apps/desktop/src/renderer/panels/ChatPanel.test.tsx`
Expected: FAIL — `pending` is not on the type, and nothing pins.

- [ ] **Step 3: Implement**

`frames.ts` — add to the `text` variant, beside `streaming`:

```ts
      /** True while this is the viewer's own text that the agent has not picked up yet.
       *  It is not in the record and may never be (docs/adr/0031), so it renders as
       *  provisional rather than as something that happened. */
      pending?: boolean | undefined;
```

`Transcript.tsx` — in the `text` branch of `TranscriptRow`, put `data-pending="true"` and a muted
class on the row when `frame.pending === true`, following the `streaming` branch's existing pattern.

`ChatPanel.tsx` — in `ChatView`, beside `queuedBySession`:

```tsx
  // A sent steer reaches the agent at its next round trip, seconds later, and the daemon
  // writes its transcript line only THEN (docs/adr/0031). Held here so the sender sees their
  // own message immediately, rendered last because it has not happened yet.
  const [pendingSteerBySession, setPendingSteerBySession] = useState<Record<string, string[]>>({});
  const activePending = activeId !== undefined ? (pendingSteerBySession[activeId] ?? []) : [];

  const handleSteer = useCallback((text: string): void => {
    const cur = vmRef.current;
    if (cur.status !== 'ready' || cur.activeSessionId === undefined) return;
    const id = cur.activeSessionId;
    setPendingSteerBySession((m) => ({ ...m, [id]: [...(m[id] ?? []), text] }));
    cur.onSteer(text);
  }, []);
```

Reconcile against the real frames. Place this after `frames` is derived:

```tsx
  // Drop a pin when its own line arrives. Matched on EXACT text: the daemon records a
  // delivery verbatim and bare, so this is equality, not fuzzy matching, and two identical
  // pending steers clear FIFO — the right answer for indistinguishable messages. Carrying an
  // echoed id instead would put a field on the persisted frame purely to serve the console.
  useEffect(() => {
    if (activeId === undefined) return;
    const own = new Set(
      frames.flatMap((f) => (f.kind === 'text' && f.role === 'you' ? [f.text] : [])),
    );
    setPendingSteerBySession((m) => {
      const cur = m[activeId] ?? [];
      if (cur.length === 0) return m;
      const seen = new Set<string>();
      const kept = cur.filter((text) => {
        if (own.has(text) && !seen.has(text)) {
          seen.add(text);
          return false;
        }
        return true;
      });
      return kept.length === cur.length ? m : { ...m, [activeId]: kept };
    });
  }, [frames, activeId]);

  // Belt-and-braces: a turn that ended took every drain point with it, so nothing is still
  // coming. Without this a pin could wedge forever if the text were ever transformed on the
  // way (SC-1 — surfacing must never become a stuck state).
  useEffect(() => {
    if (activeId === undefined || running) return;
    setPendingSteerBySession((m) => (m[activeId]?.length ? { ...m, [activeId]: [] } : m));
  }, [running, activeId]);
```

Append the pins to what the transcript renders, after the existing `frames` derivation:

```tsx
  const framesWithPending: TranscriptFrame[] = [
    ...frames,
    ...activePending.map((text, i) => ({
      id: `pending:${activeId ?? ''}:${i}`,
      role: 'you' as const,
      kind: 'text' as const,
      text,
      pending: true,
    })),
  ];
```

Pass `framesWithPending` to `Transcript` in place of `frames`, and wire the composer's
`onSteer={handleSteer}`.

**Do not touch `interleaveNotes`, raw mode, or the approval lift.** Raw mode is the verbatim
projection of the loop (D85) and a pin is not part of the loop — append pins only on the governed
path, mirroring how `pendingApproval` is already excluded from raw.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/console-transcript apps/desktop && pnpm typecheck`
Expected: PASS and clean.

Confirm the guard: temporarily make the reconciliation effect a no-op (`return;` at its top), re-run,
and confirm the message doubles. Restore.

- [ ] **Step 5: Commit**

```bash
git add packages/console-transcript/src/dense/frames.ts packages/console-transcript/src/dense/Transcript.tsx packages/console-transcript/src/dense/Transcript.test.tsx apps/desktop/src/renderer/panels/ChatPanel.tsx apps/desktop/src/renderer/panels/ChatPanel.test.tsx
git commit -m "feat: pin a sent steer at the transcript bottom until the agent picks it up"
```

---

## Task 7: Record the decision

**Files:**

- Create: `docs/adr/0031-a-steer-is-recorded-when-the-model-receives-it.md`
- Modify: `docs/adr/0030-delivery-one-intent-realized-per-backend.md`
- Modify: `ROADMAP.md`
- Modify: `docs/adr/0012-sdk-streaming-input-steering.md` (a superseded-by note only)

**Interfaces:** none — documentation.

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0031-a-steer-is-recorded-when-the-model-receives-it.md`, matching the house shape
of ADR-0030 (`# NNNN — Title`, `- Status: accepted`, `- Date: 2026-08-05`, then **Context and
problem**, **Decision drivers**, **Considered options**, **Decision**, **Consequences (good / bad)**,
and a `_Last reviewed: 2026-08-05_` footer).

It must state, in its own words:

- The problem: a send-time record claims a position that never happened and lands between a
  `tool_use` and its `tool_result` — the interleaving ADR-0030 itself names as forbidden.
- The rule, phrased as the legality constraint rather than "after the next tool_result", and **why**:
  the phrasing removes a dependency on an unmeasured fact (whether `PostToolUse` fires before or
  after the `tool_result` frame reaches core), so the design is correct under either ordering.
- One writer, in core, for every backend (ADR-0010), which is why the pure-API driver stopped
  emitting its own delivery frames.
- The floors: a turn ending with a tool still open, and a sealed queue yielding nothing — so an
  undelivered steer is never recorded, matching Claude Code's own transcript behaviour.
- Barge-in removed, and the three steer seams collapsed to one. ADR-0012's **measured input-stream
  ceiling is untouched and still stands**; only its barge-in decision is superseded.
- Consequences, honestly: a steer no longer abandons work in flight, so discarding a turn is now
  Stop-then-send — one more step for that intent. And the console holds unrecorded state, which is
  a deliberate trade for never recording something the model was not handed.
- The two pre-existing bugs this does **not** fix: `createClaudeAdapter` still drops `observeChanges`
  and `onTurnInterrupt`. Naming them here keeps them greppable.

- [ ] **Step 2: Amend ADR-0030**

- The `flushStrandedDeliveries` bullet: a `user` entry is no longer "already written when queued";
  it is written at the flush, like every other drain point. A `system` notice flushed at a boundary
  is now durable.
- The per-turn note "it needs none today… a future producer that fills that queue would need the
  same floor": that floor now exists.
- Replace the **"Still unmeasured"** section — it is stale. All four probes passed live on
  2026-08-05 against SDK 0.3.196 / CLI 2.1.196.
- Add a line to the record-timing text pointing at ADR-0031.

- [ ] **Step 3: Update ROADMAP.md and ADR-0012**

Add ADR-0031 to whatever list ROADMAP keeps, and update any ROADMAP text describing steer modes or
barge-in. In ADR-0012, add one line under its status noting that its barge-in decision is superseded
by ADR-0031 while its measured streaming-input ceiling stands. **Do not rewrite ADR-0012's finding** —
ADRs are immutable WHYs.

- [ ] **Step 4: Verify**

Run: `pnpm docs:check`
Expected: fails **only** on `TEMP.md` (the baseline).

Run: `npx prettier --check docs ROADMAP.md`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0031-a-steer-is-recorded-when-the-model-receives-it.md docs/adr/0030-delivery-one-intent-realized-per-backend.md docs/adr/0012-sdk-streaming-input-steering.md ROADMAP.md
git commit -m "docs: record that a steer enters the log when the model receives it"
```

---

## Final verification

Run all four gates and compare against the baseline table at the top. Do not claim completion
without pasting the actual output.

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format
pnpm depcruise
pnpm docs:check
```

Expected, against the measured baseline table at the top — **equal or better, never worse**:
`typecheck` clean; `test` at **11 failures** (the same 11 — 5 deepseek, 5 longcat, 1 live LongCat
402) and a passing count no lower than baseline minus the tests this plan deliberately deleted;
`lint` at 9 errors / 3 warnings, no more; `format` at 53 files, no more (and none of them a file you
touched); `depcruise` at 3 violations, no more; `docs:check` failing only on `TEMP.md`.

To check your own files specifically rather than reading 53 lines of pre-existing noise:

```bash
npx prettier --check $(git diff --name-only HEAD~7 -- '*.ts' '*.tsx')
```

**Do not push.** `origin/main` has been stale since the 2026-08-04 history rewrite; pushing is the
maintainer's call.

**Hand-off note for the orchestration plan:** this takes ADR **0031**, so that plan's three ADRs move
to **0032+**. Its Task 6 open question — whether a child-completion notice arriving after the
parent's last turn should be durable — is answered here: it is. And its Task 9 (`system` role in the
console) still stands; `packages/console-viewmodel/src/turn-map.ts` still maps wire role `'system'`
to view role `'agent'` as a documented stand-in, and nothing in this plan changes that.

---

_Last reviewed: 2026-08-05_
