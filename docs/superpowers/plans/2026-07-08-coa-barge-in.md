# Barge-in (mid-turn redirect) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a neutral queue-vs-barge-in steer seam to both backends — Claude via the SDK's turn-level `query.interrupt()` (keeping the held query alive), pure-API via its per-turn loop — and fix the ADR 0012 I3 boundary-latch limitation.

**Architecture:** The steer RPC gains a `mode: 'queue' | 'barge-in'`. The Claude adapter reports a neutral turn-interrupt handle UP (mirroring `onBackendSession`); M8's held-open driver installs a mode-aware steer sink that either pushes (queue) or `interrupt()`+framed-pushes (barge-in) into the same `InputChannel`. The pure-API driver gains a second steer buffer drained at the turn-end boundary (queue) alongside its existing top-of-loop drain (barge-in). The single-slot boundary latch becomes a `pendingTurns` count so an injected steer turn resolves the correct awaited turn. Composition never branches on backend — M8 branches only on the abstract `control.mode` strategy verdict.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`) · pnpm workspaces · Vitest · `@anthropic-ai/claude-agent-sdk` (`Query.interrupt(): Promise<void>`, streaming-input only).

## Global Constraints

- **TypeScript `strict`, no `any`.** Run `pnpm --filter <pkg> typecheck` for every touched package — vitest transpiles WITHOUT full typechecking (an `exactOptionalPropertyTypes` error has slipped past eslint+vitest this arc). Optional fields are set with guarded spreads (`...(x !== undefined ? { x } : {})`), never `x: undefined`.
- **SC-1** — steer and interrupt are user actions, NEVER a block or an error. The only two blocks are the M3 close-gate and the M7 cost-cap. An interrupted turn must never surface as an error frame.
- **D85 strict-superset** — a one-turn conversation stays byte-identical; `coa raw` sacred; an omitted `mode` reproduces today's behavior for the code path it lands on.
- **A1 block-preserving flush** — barge-in changes only WHICH in-flight work is discarded, never WHAT the per-boundary flush preserves.
- **Neutral seam (ADR 0002/0004)** — no backend type crosses M8; composition never writes `if (provider === 'claude')`; M8 branches only on `control.mode`.
- **Verify against current code, not reports.** The SDK's real interrupt frame sequence is established by the live smoke (Task 5), which is authoritative.
- Commit messages: subject-line-only Conventional Commits, no body/trailer, no module/plan IDs in the subject. Stage files BY NAME. NEVER stage `DEV-NOTES.md`, `TEMP.txt`, or `project.md`.
- Some packages lack a `test` script — use `pnpm vitest run <path>` (from repo root or the package dir).
- `pnpm docs:check` currently fails ONLY on the maintainer's untracked `project.md` — that failure is external; never touch that file.

---

## File Structure

- `packages/spi/src/runtime-adapter.ts` — add the neutral `TurnInterrupt` type.
- `packages/spi/src/index.ts` — export `TurnInterrupt` if the barrel enumerates types (check).
- `packages/core/src/session/live-session.ts` — `SteerMode` type; `TurnControl.queueSteer`; mode-aware steer sink (`#steerSink` signature, `setSteerSink`, `pushSteer`).
- `packages/core/src/session/session.ts` — `SessionAdapterInit.onTurnInterrupt`; `createSession` req `onTurnInterrupt` + forward.
- `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts` — `ClaudeSdkAdapterInit.onTurnInterrupt`; bind the `query` object; report the interrupt handle (streaming-input only).
- `packages/core/src/session/session-handlers.ts` — `steerParams.mode`; `FRAME_BARGE_IN`; `HeldQuery.pendingTurns` + interrupt handle + `barging`; boundary accounting in `record`; mode-aware sink in `establishHeldQuery`; `pendingTurns` increments in `continueHeldQuery`; `steerSession` mode routing; `runPerTurn` wires `queueSteer` + `drainQueuedSteer`.
- `packages/loop-driver/src/driver.ts` — `GovernedLoopDeps.drainQueuedSteer`; the close-gate-time queue inject.
- Tests: the `.test.ts` beside each, plus `packages/adapter-claude-sdk/src/barge-in-smoke.live.test.ts` (new, `COA_LIVE`-gated).

---

## Task 1: Neutral seam — `SteerMode`, `TurnInterrupt`, mode-aware steer sink, `queueSteer`

**Files:**
- Modify: `packages/spi/src/runtime-adapter.ts`
- Modify: `packages/core/src/session/live-session.ts`
- Modify: `packages/core/src/session/session.ts`
- Test: `packages/core/src/session/live-session.test.ts` (create if absent — check first)
- Modify (compile fix): `packages/core/src/session/live-registry.test.ts:105`

**Interfaces:**
- Produces: `type SteerMode = 'queue' | 'barge-in'` (exported from `live-session.ts`); `type TurnInterrupt = () => Promise<void>` (exported from `@coa/spi`); `TurnControl.queueSteer: string[]`; `LiveSession.setSteerSink(sink: ((text: string, mode: SteerMode) => void) | undefined)`, `LiveSession.pushSteer(text: string, mode: SteerMode): boolean`; `SessionAdapterInit.onTurnInterrupt?: (interrupt: TurnInterrupt) => void`; `createSession` req field `onTurnInterrupt?`.
- Consumes: nothing new.

- [ ] **Step 1: Add `TurnInterrupt` to the SPI.** In `packages/spi/src/runtime-adapter.ts`, near `StopPredicate`, add:

```ts
/**
 * A neutral turn-level interrupt handle a backend reports UP (see docs/adr/0012
 * barge-in follow-up). Calling it stops the CURRENTLY-running turn while keeping the
 * backend session ALIVE — distinct from the whole-session user-stop `signal`
 * (`AbortController`) that terminates the loop. Only a streaming/held-open backend
 * (the Claude SDK's `Query.interrupt`) provides one; a per-turn backend never reports it.
 */
export type TurnInterrupt = () => Promise<void>;
```

Check `packages/spi/src/index.ts`: if it re-exports named types from `runtime-adapter.ts`, add `TurnInterrupt` to that list (`export type { ..., TurnInterrupt } from './runtime-adapter.js'`).

- [ ] **Step 2: Write the failing test for the mode-aware steer sink + queueSteer.** In `packages/core/src/session/live-session.test.ts` add (create the file with the standard imports if it does not exist — mirror another `core/src/session` test's import style):

```ts
import { describe, it, expect } from 'vitest';
import { LiveSession } from './live-session.js';

describe('LiveSession — mode-aware steer routing', () => {
  it('passes the steer mode through to the installed sink', () => {
    const s = new LiveSession('c1');
    const seen: Array<{ text: string; mode: string }> = [];
    s.setSteerSink((text, mode) => seen.push({ text, mode }));
    expect(s.pushSteer('a', 'queue')).toBe(true);
    expect(s.pushSteer('b', 'barge-in')).toBe(true);
    expect(seen).toEqual([
      { text: 'a', mode: 'queue' },
      { text: 'b', mode: 'barge-in' },
    ]);
  });

  it('pushSteer returns false when no sink is installed (per-turn fallback)', () => {
    const s = new LiveSession('c1');
    expect(s.pushSteer('a', 'barge-in')).toBe(false);
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (`pushSteer` takes one arg today).

Run: `pnpm vitest run packages/core/src/session/live-session.test.ts`
Expected: FAIL (type error / wrong arity).

- [ ] **Step 4: Implement in `live-session.ts`.** Add the type and widen the sink:

```ts
/** Which steer semantics the caller intends (docs/adr/0012 barge-in follow-up):
 *  `queue` runs strictly after the current turn; `barge-in` stops the current turn
 *  and runs now. Each strategy realizes both within its own turn model. */
export type SteerMode = 'queue' | 'barge-in';
```

In `TurnControl`, add `queueSteer: string[];` next to `steer` (doc: "the `queue`-mode buffer; `steer` is the `barge-in`/next-safe-boundary buffer — pure-API only"). Change the field `#steerSink: ((text: string) => void) | undefined` to `((text: string, mode: SteerMode) => void) | undefined`; update `setSteerSink`'s parameter type to match; change `pushSteer(text: string)` to `pushSteer(text: string, mode: SteerMode): boolean` and call `this.#steerSink(text, mode)`.

- [ ] **Step 5: Run the test — expect PASS.**

Run: `pnpm vitest run packages/core/src/session/live-session.test.ts`
Expected: PASS.

- [ ] **Step 6: Add `onTurnInterrupt` to the M8 seam.** In `session.ts`: import `TurnInterrupt` from `@coa/spi`; add to `SessionAdapterInit`:

```ts
  /**
   * A backend that can stop its current turn while keeping the session alive reports
   * its turn-interrupt handle here (the Claude SDK's held-open `query.interrupt`). M8
   * routes a `barge-in` steer through it. Absent ⇒ the backend has no mid-turn
   * interrupt (per-turn backends); byte-identical to today (D85). See docs/adr/0012.
   */
  onTurnInterrupt?: (interrupt: TurnInterrupt) => void;
```

Add the same field to the `createSession` `req` object type, and forward it in the `deps.createAdapter({ ... })` call with a guarded spread: `...(req.onTurnInterrupt !== undefined ? { onTurnInterrupt: req.onTurnInterrupt } : {})`.

- [ ] **Step 7: Fix the compile break in `live-registry.test.ts:105`.** Change `session.control = { controller, steer: [], interrupted: false };` to `session.control = { controller, steer: [], queueSteer: [], interrupted: false };`.

- [ ] **Step 8: Typecheck both packages.**

Run: `pnpm --filter @coa/spi typecheck && pnpm --filter @coa/core typecheck`
Expected: 0 errors.

- [ ] **Step 9: Run the core + spi suites.**

Run: `pnpm vitest run packages/core/src/session packages/spi`
Expected: PASS (existing tests unaffected; the two new live-session tests pass).

- [ ] **Step 10: Commit.**

```bash
git add packages/spi/src/runtime-adapter.ts packages/spi/src/index.ts \
  packages/core/src/session/live-session.ts packages/core/src/session/live-session.test.ts \
  packages/core/src/session/session.ts packages/core/src/session/live-registry.test.ts
git commit -m "feat: add a neutral steer-mode seam and turn-interrupt handle"
```

(Omit `packages/spi/src/index.ts` from the `git add` if Step 1 found no barrel change was needed.)

---

## Task 2: Claude adapter reports the turn-interrupt handle up

**Files:**
- Modify: `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts`
- Test: `packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts`

**Interfaces:**
- Consumes: `TurnInterrupt` (`@coa/spi`), `SessionAdapterInit.onTurnInterrupt` (via `createAdapter` mapping in Task 6 wiring — but the adapter's own init field is added here).
- Produces: `ClaudeSdkAdapterInit.onTurnInterrupt?: (interrupt: TurnInterrupt) => void`; the adapter calls it once, streaming-input only, with `() => q.interrupt()`.

- [ ] **Step 1: Write the failing test.** In `claude-sdk-adapter.test.ts`, mirror the existing streaming test setup (see the test at ~L169 for how a scripted async-iterable `query` double is injected via `init.query`). Add a test that the adapter reports an interrupt handle wired to the query double's `interrupt`, and only under streaming input:

```ts
it('reports a turn-interrupt handle bound to the SDK query (streaming input only)', async () => {
  const interrupt = vi.fn(async () => {});
  // A query double: an async generator function carrying an `interrupt` method,
  // matching the SDK `Query` shape (AsyncGenerator<SDKMessage> & { interrupt }).
  const makeQuery = () => {
    const gen = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 's1' } as never;
      yield { type: 'result', subtype: 'success', stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0, session_id: 's1' } as never;
    })();
    return Object.assign(gen, { interrupt, setPermissionMode: vi.fn() });
  };
  let reported: (() => Promise<void>) | undefined;
  const channel = (async function* () { yield 'hi'; })(); // streaming input
  const adapter = makeAdapter({           // use this file's existing helper/ctor pattern
    input: channel,
    query: makeQuery as never,
    onTurnInterrupt: (fn) => { reported = fn; },
  });
  adapter.renderNative(EMPTY_NEUTRAL);     // reuse this file's existing fixtures
  adapter.denyBuiltins();
  adapter.interceptTool(() => ({ behavior: 'allow' }));
  adapter.interceptStop(() => ({ allow: true }));
  await adapter.runLoop({ role: '', scope: '', worktree: '.', capabilityFrame: EMPTY_FRAME });
  expect(reported).toBeTypeOf('function');
  await reported!();
  expect(interrupt).toHaveBeenCalledTimes(1);
});
```

Adapt fixture names (`makeAdapter`, `EMPTY_NEUTRAL`, `EMPTY_FRAME`) to whatever this test file already defines — read the top of the file first.

- [ ] **Step 2: Run it — expect FAIL** (`onTurnInterrupt` not in init; handle never reported).

Run: `pnpm vitest run packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the init field.** In `ClaudeSdkAdapterInit`, add (import `TurnInterrupt` from `@coa/spi`):

```ts
  /**
   * Report this backend's turn-level interrupt UP to M8 (docs/adr/0012 barge-in
   * follow-up): a held-open streaming-input `query` can stop its current turn while
   * staying alive. Called once, streaming-input only (the SDK `interrupt` control
   * request is streaming-input only). Absent input-string path ⇒ never called (D85).
   */
  onTurnInterrupt?: (interrupt: TurnInterrupt) => void;
```

- [ ] **Step 4: Bind the query object and report the handle.** In `runLoop`, change the loop so the query is bound to a variable and the handle is reported for the streaming-input path only:

```ts
    const runQuery = this.#init.query ?? query;
    const sdkQuery = runQuery({
      prompt: toSdkPrompt(modelPrompt),
      options: { ...options, cwd: sessionConfig.worktree },
    });
    // Streaming-input only: the SDK's turn-level interrupt is a streaming-input control
    // request. A one-shot string turn has no held-open query to interrupt (D85).
    if (typeof this.#init.input !== 'string' && this.#init.onTurnInterrupt !== undefined) {
      this.#init.onTurnInterrupt(() => sdkQuery.interrupt());
    }
    let dirty = false;
    try {
      for await (const message of sdkQuery) {
        // ...unchanged loop body...
```

(`sdkQuery` has type `Query`, which is `AsyncGenerator<SDKMessage> & { interrupt(): Promise<void> }` — `.interrupt()` typechecks. The injected test double must carry `interrupt`, as in Step 1.)

- [ ] **Step 5: Run the test — expect PASS.**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck.**

Run: `pnpm --filter @coa/adapter-claude-sdk typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit.**

```bash
git add packages/adapter-claude-sdk/src/claude-sdk-adapter.ts packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts
git commit -m "feat: report the sdk turn-interrupt handle up from the claude backend"
```

---

## Task 3: M8 held-open barge-in + the I3 boundary-accounting fix

**Files:**
- Modify: `packages/core/src/session/session-handlers.ts`
- Test: `packages/core/src/session/session-handlers.test.ts`

**Interfaces:**
- Consumes: `SteerMode` (`live-session.ts`), `LiveSession.pushSteer(text, mode)`, `createSession` `onTurnInterrupt` (Task 1), the reported handle (Task 2 — surfaced here via `req.onTurnInterrupt`).
- Produces: `steerSession` accepts `mode`; `HeldQuery.pendingTurns`/`turnInterrupt`/`barging`; boundary accounting in `record`. `FRAME_BARGE_IN` const.

Background the implementer must read first: `establishHeldQuery`, `continueHeldQuery`, `record`, `settleHeldQuery`, `steerSession`, and the held-open test harness at `session-handlers.test.ts` (~L934 onward — the fake adapter that consumes an `AsyncIterable` input and emits scripted frames incl. `turn-boundary`).

- [ ] **Step 1: Add the `mode` param to the RPC.** In `session-handlers.ts`, change `steerParams` to:

```ts
const steerParams = z.object({
  id: z.string(),
  text: z.string(),
  mode: z.enum(['queue', 'barge-in']).default('queue'),
});
```

Add the framing const near the top of `buildSessionHandlers` (or module scope):

```ts
/** Prefix wrapping a Claude barge-in steer so the model reads a deliberate redirect,
 *  not a bare interruption (docs/adr/0012). Claude-specific: pure-API injects at a
 *  clean boundary with no bare-interrupt signal to counteract. */
const FRAME_BARGE_IN = '[The user interrupted to steer you] ';
```

- [ ] **Step 2: Write the failing test — barge-in routes interrupt + framed push, and the injected steer resolves the right turn.** In the held-open `describe` block of `session-handlers.test.ts`, add a test using the existing streaming fake adapter, extended so its fake `query`/adapter records `interrupt()` calls and so a barge-in steer emits its own `turn-boundary`. Assert: (a) `steerSession` with `mode:'barge-in'` calls the turn-interrupt handle once; (b) the framed text (`FRAME_BARGE_IN + 'redirect'`) is what lands in the input feed; (c) the driver's turn promise resolves only after the STEER turn's boundary, not the interrupted turn's. Model the frame sequence the fake emits as: `[turn A partial, turn-boundary(A), turn B(steer), turn-boundary(B)]`, with the barge-in issued during turn A.

```ts
it('barge-in interrupts the running turn and runs the framed steer next (I3: resolves the steer turn)', async () => {
  // Harness: a fake held-open adapter whose input feed is consumed turn-by-turn; it
  // exposes `interrupt` (records the call) and lets the test drive frame emission.
  // See the streaming harness already in this file (~L934) — extend it with `interrupt`
  // + an onTurnInterrupt report, and a scripted two-turn boundary sequence.
  // Assertions:
  //   expect(interruptCalls).toBe(1);
  //   expect(fedTurns).toContain('[The user interrupted to steer you] redirect');
  //   expect(turnResolvedAfter).toBe('B');   // not 'A'
});
```

The implementer builds the concrete fake by extending this file's existing held-open harness; the three assertions above are the contract. Keep it deterministic (drive boundary emission from the test, as the existing harness does).

- [ ] **Step 3: Run it — expect FAIL.**

Run: `pnpm vitest run packages/core/src/session/session-handlers.test.ts`
Expected: FAIL.

- [ ] **Step 4: Extend `HeldQuery` and thread the interrupt handle.** In the `HeldQuery` interface add:

```ts
  /** How many pushed-but-not-yet-boundaried turns are outstanding on this query
   *  (initial + continue + any barge-in-injected steer). The driver's `boundary`
   *  latch resolves only when this returns to 0, so a barge-in's injected steer turn
   *  resolves the correct awaited turn rather than the interrupted one (docs/adr/0012
   *  I3). */
  pendingTurns: number;
  /** This backend's turn-level interrupt (reported up via `onTurnInterrupt`), used by a
   *  `barge-in` steer to stop the current turn while keeping the query alive. */
  turnInterrupt: TurnInterrupt | undefined;
  /** Count of in-flight barge-ins whose interrupted-turn terminal result should be
   *  suppressed from surfacing as an error frame (SC-1). Decremented as those results
   *  arrive. Finalized against the live smoke (Task 5). */
  barging: number;
```

Import `TurnInterrupt` from `@coa/spi` and `SteerMode` from `./live-session.js`.

- [ ] **Step 5: Boundary accounting + SC-1 suppression in `establishHeldQuery`'s `record`.** Initialize the new fields when building `query` (`pendingTurns: 0`, `turnInterrupt: undefined`, `barging: 0`). Pass `onTurnInterrupt: (fn) => { query.turnInterrupt = fn; }` into the `createSession` call (guarded spread not needed — always provide it for held-open). Rewrite the boundary handling inside `record`:

```ts
    const record = (frame: TurnFrame): void => {
      const started = startedRef.current;
      if (started === undefined) return;
      // SC-1: an interrupted turn's terminal result (from a barge-in `interrupt()`) must
      // not surface as an error frame. Swallow one error frame per outstanding barge-in.
      if (frame.t === 'error' && query.barging > 0) {
        query.barging -= 1;
        return;
      }
      const s = seqBox.value++;
      session.emit({ kind: 'turn', sessionId: started.id, worktree: started.worktree, seq: s, frame });
      if (prep.persistIn !== undefined) prep.persistIn.store.append(prep.persistIn.convId, [{ seq: s, frame }]);
      if (frame.t === 'turn-boundary') {
        query.pendingTurns -= 1;
        // Resolve the driver only when every outstanding turn (incl. a barge-in-injected
        // steer) has boundaried — otherwise the redirect is still running (docs/adr/0012 I3).
        if (query.pendingTurns <= 0) {
          query.pendingTurns = 0;
          emitStatus(session, started.worktree, 'done');
          query.boundary?.resolve();
          query.boundary = undefined;
        }
      }
    };
```

Install the mode-aware steer sink in the `onStart` hook (replacing the current `setSteerSink((text) => channel.push(text))`):

```ts
          session.setSteerSink((text, mode) => {
            if (mode === 'barge-in') {
              query.pendingTurns += 1;
              query.barging += 1;
              void (async () => {
                await query.turnInterrupt?.();
                channel.push(FRAME_BARGE_IN + text);
              })();
            } else {
              channel.push(text); // queue: runs after the current turn (SDK ceiling)
            }
          });
```

Set `pendingTurns` when the initial turn is pushed: right before `channel.push(turn.input)` at the end of `establishHeldQuery`, add `query.pendingTurns += 1;`.

> **Live-smoke tunable (Task 5):** the `pendingTurns += 1` on barge-in assumes the interrupted turn still emits ONE terminal boundary frame. If Task 5's live run shows `interrupt()` emits NO boundary for the truncated turn, drop that increment (the steer's own boundary then resolves the driver). Likewise `barging` suppression is a no-op if the interrupted turn's result is `subtype:'success'` (no error frame). Leave both in; Task 5 confirms the constants.

- [ ] **Step 6: Count the continue turn.** In `continueHeldQuery`, before `query.channel.push(turn.input)`, add `query.pendingTurns += 1;` (a normal continue expects one boundary). Keep the `query.boundary = boundary` reassignment.

- [ ] **Step 7: Route `steerSession` by mode.** Replace the `steerSession` handler body's steer dispatch:

```ts
    steerSession: rpcMethod(steerParams, (params) => {
      const session = registry.get(params.id);
      if (session?.control === undefined) return { steered: false };
      if (params.text === '') return { steered: false };
      if (session.control.mode === 'held-open') {
        session.pushSteer(params.text, params.mode);
      } else if (params.mode === 'barge-in') {
        session.control.steer.push(params.text);          // next-safe-boundary inject
      } else {
        session.control.queueSteer.push(params.text);      // run after the current turn
      }
      return { steered: true };
    }),
```

- [ ] **Step 8: Run the new test + the whole file — expect PASS.**

Run: `pnpm vitest run packages/core/src/session/session-handlers.test.ts`
Expected: PASS. If the pre-existing held-open queue test (~L1050) passed `steerSession({id,text})` with no mode, it now defaults to `'queue'` → still `channel.push` → unchanged. If the pre-existing per-turn steer test (~L681) expected `drainSteer`, update it to pass `mode: 'barge-in'` (that test's intent is next-safe-boundary inject); do that update in Task 4 where the per-turn drains are built, or here if it fails now — update it to `{ id, text, mode: 'barge-in' }`.

- [ ] **Step 9: Typecheck.**

Run: `pnpm --filter @coa/core typecheck`
Expected: 0 errors.

- [ ] **Step 10: Commit.**

```bash
git add packages/core/src/session/session-handlers.ts packages/core/src/session/session-handlers.test.ts
git commit -m "feat: barge-in redirect on the held-open backend with per-turn boundary accounting"
```

---

## Task 4: Pure-API symmetric two modes

**Files:**
- Modify: `packages/loop-driver/src/driver.ts`
- Test: `packages/loop-driver/src/driver.test.ts`
- Modify: `packages/core/src/session/session-handlers.ts` (`runPerTurn` wiring)
- Test: `packages/core/src/session/session-handlers.test.ts` (per-turn mode routing)

**Interfaces:**
- Consumes: `TurnControl.queueSteer` (Task 1), `steerParams.mode` (Task 3).
- Produces: `GovernedLoopDeps.drainQueuedSteer?: () => readonly string[]`; the close-gate-time queue inject; `runPerTurn` wires both drains onto `control`.

- [ ] **Step 1: Write the failing driver test.** In `driver.test.ts`, beside the existing queued-steer test (~L484), add one proving a `queue`-mode steer injects only when the turn would otherwise END (at the close-gate), not at the top-of-loop boundary:

```ts
it('injects a drainQueuedSteer turn at the close-gate boundary (queue mode: after the turn would end)', async () => {
  // A one-round-trip complete() that returns a plain answer (no tool calls) so the
  // close-gate is consulted immediately. The queued steer must be injected there and
  // the loop must continue for one more round-trip rather than ending.
  const answers = ['done for now', 'ok, did X too'];
  let i = 0;
  const complete = vi.fn(async () => ({
    text: answers[i++]!, reasoning: '', toolCalls: [], usage: ZERO_USAGE,
  }));
  const gate = vi.fn(() => ({ allow: true }));       // model wants to stop each time
  const queued = ['also do X'];
  const drainQueuedSteer = vi.fn(() => queued.splice(0, queued.length));
  const onMessages = vi.fn();
  await runGovernedLoop(deps({ complete, gate, drainQueuedSteer, input: 'do it', onMessages }));
  // Two round-trips: the queued steer forced a continue after the first close-gate.
  expect(complete).toHaveBeenCalledTimes(2);
  // The steer landed as a user message between the two assistant answers.
  const msgs = onMessages.mock.calls.at(-1)![0] as Array<{ role: string; content: string }>;
  expect(msgs.some((m) => m.role === 'user' && m.content === 'also do X')).toBe(true);
});
```

Reuse this file's `deps(...)`/`ZERO_USAGE` helpers (read the top of the file).

- [ ] **Step 2: Run it — expect FAIL** (`drainQueuedSteer` unknown; loop ends after one round-trip).

Run: `pnpm vitest run packages/loop-driver/src/driver.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `driver.ts`.** Add to `GovernedLoopDeps`:

```ts
  /**
   * A synchronous drain of `queue`-mode steers — user turns that should run AFTER the
   * current turn's work, not at the next round-trip boundary. Consulted at the point the
   * close-gate would let the turn end: a drained steer is injected and the loop continues
   * instead of ending ("run after the current turn"). Distinct from `drainSteer`
   * (`barge-in`, drained at the loop top). Absent ⇒ byte-identical to today (D85).
   */
  drainQueuedSteer?: () => readonly string[];
```

In the close-gate branch (where `result.toolCalls.length === 0`), after `decision.allow` is true and BEFORE `break`, inject any queued steers:

```ts
        const decision = await deps.gate();
        if (decision.allow) {
          const queued = deps.drainQueuedSteer?.() ?? [];
          if (queued.length > 0) {
            for (const q of queued) messages.push({ role: 'user', content: q });
            lastConsistent = messages.length; // a user turn is a consistent boundary
            continue;                          // run after the current turn's work
          }
          break;
        }
        messages.push({ role: 'user', content: decision.message });
        lastConsistent = messages.length;
        continue;
```

- [ ] **Step 4: Run the driver test — expect PASS.**

Run: `pnpm vitest run packages/loop-driver/src/driver.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire both drains in `runPerTurn`.** In `session-handlers.ts` `runPerTurn`, add `const queueSteer: string[] = [];` beside `const steer`, set `session.control = { controller, steer, queueSteer, interrupted: false, mode: 'per-turn' }` in `onStart`, and pass `drainQueuedSteer: () => queueSteer.splice(0, queueSteer.length)` into the `createSession(...)` call next to `drainSteer`. Add the matching field to `createSession`'s req type and `SessionAdapterInit`, and forward it in `session.ts`'s `createAdapter` call (guarded spread), then map it in the pure-API adapters.

> `drainQueuedSteer` must reach the pure-API adapters. Add it to `SessionAdapterInit` (session.ts) and `GovernedLoop`-driving init of each pure-API adapter, mirroring exactly how `drainSteer` is already threaded (grep `drainSteer` across `packages/adapter-deepseek`, `packages/adapter-longcat`, `apps/cli/src/adapter-factory.ts` and add a sibling line at each hit). The Claude adapter ignores it (held-open path).

- [ ] **Step 6: Write/adjust the per-turn routing test.** In `session-handlers.test.ts`, ensure a per-turn `mode:'queue'` steer lands in `queueSteer` (drained via `drainQueuedSteer`) and `mode:'barge-in'` lands in `steer` (drained via `drainSteer`). Update the existing ~L681 test to pass `mode:'barge-in'` if not already done in Task 3. Add a `mode:'queue'` counterpart asserting the fake adapter's `drainQueuedSteer` observation point receives it.

- [ ] **Step 7: Run the affected suites — expect PASS.**

Run: `pnpm vitest run packages/loop-driver packages/core/src/session packages/adapter-deepseek packages/adapter-longcat`
Expected: PASS.

- [ ] **Step 8: Typecheck the touched packages.**

Run: `pnpm --filter @coa/loop-driver typecheck && pnpm --filter @coa/core typecheck && pnpm --filter @coa/adapter-deepseek typecheck && pnpm --filter @coa/adapter-longcat typecheck`
Expected: 0 errors. Also `pnpm --filter cli typecheck` (adapter-factory change).

- [ ] **Step 9: Commit.**

```bash
git add packages/loop-driver/src/driver.ts packages/loop-driver/src/driver.test.ts \
  packages/core/src/session/session-handlers.ts packages/core/src/session/session-handlers.test.ts \
  packages/core/src/session/session.ts packages/adapter-deepseek/src apps/cli/src/adapter-factory.ts \
  packages/adapter-longcat/src
git commit -m "feat: symmetric queue and barge-in steer modes on the pure-api backends"
```

(Stage only the files actually changed — check `git status` and drop any that were not touched.)

---

## Task 5: `COA_LIVE` live smoke — finalize the accounting against the real SDK

**Files:**
- Create: `packages/adapter-claude-sdk/src/barge-in-smoke.live.test.ts`
- Possibly modify: `packages/core/src/session/session-handlers.ts` (finalize the Task 3 tunables)

**Interfaces:** none new — this proves the real-SDK contract the fakes cannot.

- [ ] **Step 1: Confirm a usable account.** Run `pnpm --filter cli exec coa auth list` (or the documented invocation) and confirm `personal` is active. If rate-limited/unusable, STOP and report BLOCKED (do not fabricate a pass).

- [ ] **Step 2: Write the gated smoke.** Mirror `packages/adapter-claude-sdk/src/streaming-smoke.live.test.ts` exactly for setup (`describe.skipIf(!process.env.COA_LIVE)`, resolve the `personal` account from `~/.coa/accounts.yaml` via the same test-only `yaml` devDep, real `@anthropic-ai/claude-agent-sdk` `query`). Drive a held-open query with a first turn that WILL use a tool or run long enough to interrupt, then call the reported turn-interrupt handle mid-turn and push a framed steer, and assert:
  - the query stays alive (the run promise is still pending after the interrupt);
  - the framed steer runs as the next turn and produces output;
  - completed blocks from the interrupted turn are in the reported `onBackendMessages` (A1);
  - RECORD the observed frame sequence around the interrupt (does a terminal `result` arrive for the truncated turn? what `subtype`?) — this is the datum that finalizes Task 3's `pendingTurns`/`barging` constants.

- [ ] **Step 3: Run it live.**

Run: `COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/barge-in-smoke.live.test.ts`
Expected: PASS. (On PowerShell: `$env:COA_LIVE=1; pnpm vitest run ...`.)

- [ ] **Step 4: Reconcile Task 3.** If the observed sequence differs from the assumption (interrupted turn emits no boundary, or a `success` vs `error` subtype), adjust the `pendingTurns += 1` / `barging` handling in `session-handlers.ts` and re-run BOTH the fake suite and this smoke. Record the finding in the progress ledger.

- [ ] **Step 5: Confirm the default (skipped) suite stays green.**

Run: `pnpm vitest run packages/adapter-claude-sdk`
Expected: PASS with the live test skipped.

- [ ] **Step 6: Commit.**

```bash
git add packages/adapter-claude-sdk/src/barge-in-smoke.live.test.ts packages/core/src/session/session-handlers.ts
git commit -m "test: verify mid-turn barge-in against the live claude backend"
```

(Include `session-handlers.ts` only if Step 4 changed it.)

---

## Task 6: Docs (same-commit rule) + whole-branch review

**Files:**
- Modify: `docs/adr/0012-sdk-streaming-input-steering.md` (mark the barge-in follow-up delivered + the I3 fix)
- Modify: `docs/design/handoff/spec/M8.md` and `docs/design/handoff/spec/M9.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Update ADR 0012.** In the "Follow-up: mid-turn redirect (barge-in)" section, record that barge-in is now delivered: the neutral `mode: 'queue' | 'barge-in'` seam, Claude via `query.interrupt()` + `FRAME_BARGE_IN`, pure-API's two-buffer realization, and the I3 latch fix (single slot → `pendingTurns` accounting). Fold in whatever the live smoke (Task 5) established about the interrupt frame sequence. Keep the `_Last reviewed:_` footer current (2026-07-08). Decide with the maintainer's standing guidance whether this warrants a NEW ADR (0013) — a follow-up delivered within an accepted ADR's scope is fine to fold into 0012; if a new durable decision emerged from the live smoke, add ADR 0013 and index it in `docs/adr/README.md`.

- [ ] **Step 2: Update the spec modules.** `M8.md`: the steer seam now exposes queue + barge-in; the held-open driver does per-turn boundary accounting; `steerSession` carries `mode`. `M9.md`: the Claude adapter reports a turn-interrupt handle up (`onTurnInterrupt`, streaming-input only). One or two lines each — no signatures (they rot).

- [ ] **Step 3: Update ROADMAP.** In the M8 row and the "Session hardening" / "Coa-agent hardening (H1)" narrative, move barge-in from "remaining" to done: mid-turn redirect via `query.interrupt()`+push is delivered with the neutral queue-vs-barge-in seam for both backends and the I3 fix; the console steer affordance remains the open item. Bump `_Last reviewed:_` to 2026-07-08.

- [ ] **Step 4: Verify docs + full check.**

Run: `pnpm docs:check`
Expected: PASS except the known external `project.md` failure (do not touch it).

Run: `pnpm --filter @coa/core typecheck && pnpm --filter @coa/adapter-claude-sdk typecheck && pnpm --filter @coa/loop-driver typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit.**

```bash
git add docs/adr/0012-sdk-streaming-input-steering.md docs/design/handoff/spec/M8.md docs/design/handoff/spec/M9.md ROADMAP.md
git commit -m "docs: record mid-turn barge-in and the queue-vs-barge-in steer seam"
```

(Add `docs/adr/README.md` + a new `docs/adr/0013-*.md` instead only if Step 1 chose a new ADR.)

- [ ] **Step 6: Whole-branch review (opus).** Per the arc's practice, run the final whole-branch review on opus against `b76487b..HEAD` — the opus integration/final reviews have repeatedly caught Criticals the per-task sonnet reviews missed. Verify: SC-1 (barge-in/interrupt never an error frame — incl. the suppressed interrupted-turn result), D85 (omitted mode + one-turn conversation unchanged; `coa raw`), A1 (per-boundary flush intact), neutral seam (no backend literal in core; M8 branches only on `control.mode`), and the I3 accounting (an injected steer resolves the right awaited turn). Fix findings before declaring the piece complete.

---

## Self-Review (author)

- **Spec coverage:** §1 seam → Task 1; §1 turn-interrupt handle → Task 2; §2 Claude barge-in → Task 3; §4 I3 fix → Task 3; §3 pure-API two modes → Task 4; §5 live smoke → Task 5; SC-1 interrupted-turn suppression → Task 3 Step 5 (+ Task 5 finalize); docs same-commit → Task 6. Covered.
- **Type consistency:** `SteerMode` (live-session.ts), `TurnInterrupt = () => Promise<void>` (@coa/spi, matches the installed SDK `Query.interrupt(): Promise<void>`), `onTurnInterrupt` (spi-typed, on both inits + createSession req), `queueSteer`/`drainQueuedSteer`, `pendingTurns`/`barging` — names consistent across tasks.
- **Placeholder scan:** the two test bodies in Task 3 Step 2 and Task 2 Step 1 intentionally defer the concrete fake to "extend this file's existing harness" because the harness shape is file-local; the assertion contracts are explicit. Every non-test code step shows complete code.
- **Live-SDK risk isolated:** the one real-SDK unknown (interrupt frame sequence) is confined to Task 3's marked tunables and finalized in Task 5 — the fake tasks build the mechanism, the live smoke is authoritative (the P-β pattern).
