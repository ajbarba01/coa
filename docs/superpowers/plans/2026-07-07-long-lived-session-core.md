# Long-lived Session Core (P-α) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daemon the authoritative owner of a **live session per conversation** — an idle/running lifecycle held across turns with a fan-out output stream — so a conversation is multi-turn, reattachable (G4), and multitask-capable, without rewriting either backend loop.

**Architecture:** A daemon-singleton `LiveSessionRegistry` (keyed by `conversationId`) replaces today's per-connection, per-send session state. Each `LiveSession` owns an input turn-channel, `idle|running` state, and a set of subscriber sinks. A daemon-owned loop awaits turns and runs the **existing per-turn `createSession`** for each (keyed by the conversation, so resume + frozen-prompt + R-7 transcript continuity work exactly as multi-send does today) — for BOTH backends. Connections become stateless subscribers that hydrate run-status on (re)subscribe. This is the design in `docs/superpowers/specs/2026-07-07-long-lived-session-multiturn-design.md` §5 (P-α).

**Tech Stack:** TypeScript (strict), pnpm workspaces, Vitest, `better-sqlite3`-backed R-7 store, the M0 `Push`/JSON-RPC transport.

## Global Constraints

- **TypeScript `strict`, no `any`.**
- **Session independence.** The daemon owns lifecycle AND liveness; a viewer is a stateless subscriber that hydrates current state (incl. run-status) on connect and never reconstructs liveness from its own tracking. A live session runs with zero subscribers (headless).
- **D85 strict-superset.** A conversation that takes exactly one turn behaves byte-identically to today; the live-session machinery is the superset. `coa raw` stays sacred.
- **SC-1.** No new block class — the only two blocks stay M3 close-gate + M7 cost-cap. Interrupt/steer stay user actions.
- **P1 determinism.** No model call on any critical path; lifecycle/routing is deterministic control flow.
- **Neutral seam (ADR 0002/0004).** No backend type crosses M8's seam; the facade runs one neutral per-turn execution both backends implement; composition never branches on backend.
- **Block-preserving (A1, do not regress).** Each turn still runs the per-turn `createSession`/`runGovernedLoop` with the A1 `try/finally` flush trimmed to the last round-trip-consistent boundary; the loop does not change the flush.
- **Commit convention:** subject-line-only Conventional Commits — no body, no trailer, no phase/plan/module IDs in the subject.
- **Stage files by name; never `git add -A`. Never stage or edit `DEV-NOTES.md`.**
- **Same-commit doc rule:** the M8 SPEC module + ROADMAP update in the same commit as the code that changes them; a new durable decision gets an ADR; keep `pnpm docs:check` green.

---

### Task 1: The `LiveSession` — turn channel + fan-out state container

**Files:**
- Create: `packages/core/src/session/live-session.ts`
- Test: `packages/core/src/session/live-session.test.ts`

**Interfaces:**
- Produces:
  - `type RunState = 'idle' | 'running'`.
  - `interface TurnRequest { input: string; model?: ModelSelection; roles?: string[]; scope?: string; packageIds?: string[]; exclude?: string[] }` (the per-turn request fields, mirroring `createParams` in `session-handlers.ts`).
  - `type Sink = (push: Push) => void`.
  - `class LiveSession` with: `readonly id: string`, `worktree: string | undefined`, `state: RunState`, and methods `subscribe(sink: Sink): () => void` (adds the sink, immediately emits the current status push to it, returns an unsubscribe), `emit(push: Push): void` (fan out to all sinks), `enqueue(turn: TurnRequest): void`, `nextTurn(): Promise<TurnRequest | undefined>` (resolves with the next queued turn, or `undefined` once `close()` is called and the queue is drained), `close(): void`, and `setState(state: RunState, worktree?: string): void` (updates state and emits a `status` push).
- The status push shape is `{ kind: 'status', sessionId: this.id, worktree: this.worktree ?? '', state: <'running'|'idle'|...> }` — reuse the existing `Push` `status` variant (`packages/shared/src/push.ts`). Map `RunState` → the push `state` enum directly (`'idle'`/`'running'` are already members).

- [ ] **Step 1: Write the failing test** (`live-session.test.ts`):

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Push } from '@coa/shared';
import { LiveSession } from './live-session.js';

describe('LiveSession', () => {
  it('fans out an emitted push to every subscriber', () => {
    const s = new LiveSession('c1');
    const a: Push[] = []; const b: Push[] = [];
    s.subscribe((p) => a.push(p));
    s.subscribe((p) => b.push(p));
    const turn: Push = { kind: 'turn', sessionId: 'c1', worktree: '', seq: 0, frame: { t: 'text', text: 'hi' } };
    s.emit(turn);
    expect(a).toContainEqual(turn);
    expect(b).toContainEqual(turn);
  });

  it('emits the current run-status to a late subscriber (hydration)', () => {
    const s = new LiveSession('c1');
    s.setState('running', '/wt');
    const got: Push[] = [];
    s.subscribe((p) => got.push(p));
    expect(got).toContainEqual({ kind: 'status', sessionId: 'c1', worktree: '/wt', state: 'running' });
  });

  it('nextTurn resolves with an enqueued turn, then undefined after close+drain', async () => {
    const s = new LiveSession('c1');
    s.enqueue({ input: 'first' });
    await expect(s.nextTurn()).resolves.toEqual({ input: 'first' });
    const pending = s.nextTurn();
    s.close();
    await expect(pending).resolves.toBeUndefined();
  });

  it('unsubscribe stops delivery', () => {
    const s = new LiveSession('c1');
    const got: Push[] = [];
    const off = s.subscribe((p) => got.push(p));
    off();
    s.emit({ kind: 'turn', sessionId: 'c1', worktree: '', seq: 1, frame: { t: 'text', text: 'x' } });
    expect(got.filter((p) => p.kind === 'turn')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it — FAIL** (`pnpm vitest run packages/core/src/session/live-session.test.ts`): module not found.

- [ ] **Step 3: Implement** `live-session.ts`. The turn channel is an async queue with a waiter: `enqueue` pushes to an array and resolves any pending `nextTurn` waiter; `nextTurn` returns a queued turn immediately, else awaits a promise stored as the waiter; `close` sets a `closed` flag and resolves any waiter with `undefined`. `subscribe` adds the sink to a `Set`, calls `sink(this.#statusPush())` once, returns `() => this.#sinks.delete(sink)`. `emit` iterates the sink set. `setState` sets `this.state` (+ `worktree` if given) then `this.emit(this.#statusPush())`.

- [ ] **Step 4: Run it — PASS** + the focused file. **Step 5: Commit** `feat: add the live-session turn channel and fan-out container` (stage `live-session.ts` + its test by name).

---

### Task 2: The `LiveSessionRegistry` — lookup, lifecycle, idle-timeout

**Files:**
- Create: `packages/core/src/session/live-registry.ts`
- Test: `packages/core/src/session/live-registry.test.ts`

**Interfaces:**
- Consumes: `LiveSession` (Task 1).
- Produces:
  - `interface LiveRegistryOptions { idleMs?: number; now?: () => number; setTimer?: (fn: () => void, ms: number) => { clear: () => void } }` (injectable clock/timer for tests; default `setTimer` wraps `setTimeout`/`clearTimeout` with `.unref()`).
  - `class LiveSessionRegistry` with `getOrCreate(id: string): { session: LiveSession; created: boolean }`, `get(id: string): LiveSession | undefined`, `close(id: string): void` (calls `session.close()`, clears its idle timer, deletes it), `closeAll(): void`, and `touch(id: string): void` (resets the session's idle timer — called on any turn activity). On idle-timeout fire, the registry calls `close(id)`. Creating or touching a session (re)arms its idle timer when `idleMs` is set.

- [ ] **Step 1: Write the failing test** (`live-registry.test.ts`):

```ts
import { describe, it, expect, vi } from 'vitest';
import { LiveSessionRegistry } from './live-registry.js';

function fakeTimers() {
  const timers = new Map<number, () => void>();
  let id = 0;
  const setTimer = (fn: () => void) => { const t = ++id; timers.set(t, fn); return { clear: () => timers.delete(t) }; };
  const fireAll = () => { for (const fn of [...timers.values()]) fn(); };
  return { setTimer, fireAll, size: () => timers.size };
}

describe('LiveSessionRegistry', () => {
  it('getOrCreate returns the same session and flags creation only once', () => {
    const r = new LiveSessionRegistry();
    const a = r.getOrCreate('c1');
    const b = r.getOrCreate('c1');
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(a.session).toBe(b.session);
  });

  it('closes a session on idle-timeout and removes it', () => {
    const t = fakeTimers();
    const r = new LiveSessionRegistry({ idleMs: 1000, setTimer: t.setTimer });
    const { session } = r.getOrCreate('c1');
    const closed = vi.spyOn(session, 'close');
    t.fireAll();
    expect(closed).toHaveBeenCalled();
    expect(r.get('c1')).toBeUndefined();
  });

  it('touch re-arms the idle timer (old timer cleared)', () => {
    const t = fakeTimers();
    const r = new LiveSessionRegistry({ idleMs: 1000, setTimer: t.setTimer });
    r.getOrCreate('c1');
    r.touch('c1');
    expect(t.size()).toBe(1); // the prior timer was cleared, not stacked
  });

  it('closeAll tears down every session', () => {
    const r = new LiveSessionRegistry();
    r.getOrCreate('c1'); r.getOrCreate('c2');
    r.closeAll();
    expect(r.get('c1')).toBeUndefined();
    expect(r.get('c2')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — FAIL** (module not found). **Step 3: Implement** `live-registry.ts`: a `Map<string, { session: LiveSession; timer?: { clear: () => void } }>`. `getOrCreate` creates a `LiveSession`, arms the idle timer if `idleMs` set. `touch` clears the existing timer and re-arms. `close` clears the timer, calls `session.close()`, deletes the entry. Default `setTimer` = `const h = setTimeout(fn, ms); if (typeof h.unref === 'function') h.unref(); return { clear: () => clearTimeout(h) }`.

- [ ] **Step 4: Run — PASS** + focused file. **Step 5: Commit** `feat: add the live-session registry with idle-timeout lifecycle`.

---

### Task 3: The daemon-owned turn loop (drives per-turn execution over a live session)

**Files:**
- Create: `packages/core/src/session/run-live-session.ts`
- Test: `packages/core/src/session/run-live-session.test.ts`

**Interfaces:**
- Consumes: `LiveSession` (Task 1), `TurnRequest` (Task 1).
- Produces: `runLiveSession(session: LiveSession, runTurn: RunTurn): Promise<void>` where `type RunTurn = (turn: TurnRequest, session: LiveSession) => Promise<void>`. It loops: `session.setState('running')` is set by `runTurn` at turn start (via the existing `onStart`); the loop body is `while ((turn = await session.nextTurn()) !== undefined) { await runTurn(turn, session); session.setState('idle'); }`. `runTurn` encapsulates the existing per-turn `createSession` call (wired in Task 4) — the loop itself is backend-neutral and only sequences turns + toggles idle. A `runTurn` that throws is caught, surfaced as an error frame via `session.emit`, and the loop continues to the next turn (SC-1 — a failed turn never kills the live session).

- [ ] **Step 1: Write the failing test** (`run-live-session.test.ts`):

```ts
import { describe, it, expect, vi } from 'vitest';
import { LiveSession } from './live-session.js';
import { runLiveSession } from './run-live-session.js';

describe('runLiveSession', () => {
  it('runs each queued turn in order then idles, and ends when the session closes', async () => {
    const s = new LiveSession('c1');
    const seen: string[] = [];
    const runTurn = vi.fn(async (t) => { seen.push(t.input); });
    s.enqueue({ input: 'one' });
    s.enqueue({ input: 'two' });
    const done = runLiveSession(s, runTurn);
    // let the two turns drain, then close
    await vi.waitFor(() => expect(seen).toEqual(['one', 'two']));
    expect(s.state).toBe('idle');
    s.close();
    await done;
  });

  it('a throwing turn is surfaced as an error frame and the loop continues', async () => {
    const s = new LiveSession('c1');
    const pushes: unknown[] = [];
    s.subscribe((p) => pushes.push(p));
    let n = 0;
    const runTurn = vi.fn(async () => { n += 1; if (n === 1) throw new Error('boom'); });
    s.enqueue({ input: 'bad' });
    s.enqueue({ input: 'good' });
    const done = runLiveSession(s, runTurn);
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    s.close();
    await done;
    expect(pushes).toContainEqual(expect.objectContaining({ kind: 'turn', frame: expect.objectContaining({ t: 'error' }) }));
  });
});
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement** `run-live-session.ts` per the interface: the `while` loop over `nextTurn()`, `try { await runTurn(turn, session) } catch (e) { session.emit({ kind: 'turn', sessionId: session.id, worktree: session.worktree ?? '', seq: <next>, frame: { t: 'error', message: describeLoopFailure(e), origin: 'loop' } }) }`, then `session.setState('idle')`. Reuse `describeLoopFailure` from `./loop-failure.js`. (Seq numbering: keep a local counter on the session or pass through — read `session-handlers.ts`'s `seq` handling in Task 4 and align; for this unit a monotonically increasing local counter is fine.)

- [ ] **Step 4: Run — PASS** + focused file. **Step 5: Commit** `feat: add the daemon-owned live-session turn loop`.

---

### Task 4: Wire the registry into the session RPC surface (create/send/subscribe/interrupt/steer/close)

**Files:**
- Modify: `packages/core/src/session/session-handlers.ts`
- Modify: `packages/core/src/session/session.ts` (only if the per-turn `createSession` needs a small seam to be callable from `runTurn`; prefer no change)
- Test: `packages/core/src/session/session-handlers.test.ts`
- Docs (same commit): `docs/design/handoff/spec/M8.md`, `ROADMAP.md`, and a new ADR `docs/adr/00NN-daemon-authoritative-live-session.md`

- [ ] **Step 0 (grounding):** Re-read `session-handlers.ts` in full (the `createSession` handler, the `record`/`status` emitters, the A2 control map, `interruptSession`/`steerSession`/`closeSession`, `recompilePrompt`). Re-read the `createParams`/`closeParams` Zod schemas. Decide the minimal refactor: `buildSessionHandlers` gains a **required** `registry: LiveSessionRegistry` parameter (a daemon singleton passed in from Task 5); the per-connection handler no longer owns a `live` map or the control map — those move onto the `LiveSession` (the A2 `{ controller, steer, interrupted }` control state becomes fields the `runTurn` closure reads/writes per turn). Confirm how `record`/`status`/persistence currently thread the originating `connection.push`; that push becomes `session.subscribe(connection.push)` at connect (Task 6) and `session.emit(...)` inside `runTurn`.

**Interfaces:**
- `buildSessionHandlers(deps, connection, store, registry)` — `registry` is the shared `LiveSessionRegistry`.
- `createSession` becomes **send-or-create**: resolve the `conversationId` (or an ephemeral generated id), `const { session, created } = registry.getOrCreate(id)`; `session.enqueue(turnRequestFromParams(params))`; `registry.touch(id)`; if `created`, start `void runLiveSession(session, makeRunTurn(deps, store, session, registry))` (the `runTurn` closure runs today's per-turn `createSession` for one turn — reuse the existing body, keyed by `id`, with `onTurn`/`onStart`/`onBackendMessages`/`onSettle` wired to `session.emit`/`session.setState` instead of the raw `connection`). Return `{ sessionId: id, worktree: session.worktree ?? '' }` (resolve worktree from `onStart`; for an already-live session it is already known).
- New verb `subscribeSession({ id })` — `const s = registry.get(id); if (s) s.subscribe(connection.push)` (hydrates status to this connection). Returns `{ subscribed: s !== undefined }`. (Console calls this on connect; Task 6.)
- `interruptSession`/`steerSession`/`closeSession` now resolve the `LiveSession` from the registry and act on its per-turn control state / channel: `steerSession` enqueues into the running turn's steer buffer (pure-API, as A2) AND remains a same-turn redirect (unchanged semantics); `closeSession` calls `registry.close(id)`.

- [ ] **Step 1: Write failing tests** in `session-handlers.test.ts`: (a) two `createSession` calls with the same `conversationId` run as **two turns on one live session** (the fake adapter sees two sequential turns; the session ends `idle` between them, not torn down); (b) `subscribeSession` on a running session pushes a `running` status to the subscribing connection (hydration); (c) an interrupt on the live session still emits `'interrupted'` and never an error (A2 invariant preserved); (d) `closeSession` removes the session from the registry. Extend the existing fake-adapter/deps harness (it already models `createSession`/frames). **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the refactor. Keep the per-turn body (compile/freeze reuse, resume, `onBackendMessages`, cost) intact — it moves into `makeRunTurn` unchanged in substance, only its emit targets change from `connection`/`record` to `session.emit`/`session.setState`. Author ADR `00NN-daemon-authoritative-live-session.md` (the daemon-owns-liveness / stateless-reattachable-viewer contract; reconcile with any G4 note in the agent-hardening design) and link it from the M8 SPEC module and this code (`// see docs/adr/00NN`). Update `docs/design/handoff/spec/M8.md` (the session lifecycle + the new `subscribeSession` verb) and `ROADMAP.md` (M8 row + the session-hardening/G4 line: live-session core + multi-turn + reattach now real).
- [ ] **Step 4: Run — PASS** + full `@coa/core` suite + `pnpm docs:check` (35→36 docs with the new ADR; confirm it is reachable per the router — add it to the `docs/adr/` index the router reads). **Step 5: Commit** `feat: make the daemon own live sessions across turns` (stage the source + ADR + M8 + ROADMAP by name).

---

### Task 5: Build the registry as a daemon singleton and thread it into the handlers

**Files:**
- Modify: `apps/cli/src/cli.ts` (the `bindDaemon(path, (connection) => ({ ... buildSessionHandlers(deps, connection, store) }))` wiring, ~line 209-220)
- Modify: `apps/cli/src/run.test.ts` (the `listen(path, (connection) => buildSessionHandlers(deps, connection))` fixture, ~line 76)
- Test: `apps/cli/src/run.test.ts` (extend) or a focused daemon test

- [ ] **Step 0 (grounding):** Re-read `apps/cli/src/cli.ts` around the daemon `bindDaemon` call and `apps/cli/src/run.test.ts`'s server fixture. Confirm the `store` is already a daemon singleton constructed once before the per-connection factory — the registry is constructed the same way, once, and closed on daemon shutdown (wire `registry.closeAll()` into the existing `onShutdown`/`shutdown` handler path).

**Interfaces:**
- Construct `const registry = new LiveSessionRegistry({ idleMs: <default> })` once (the default idle-timeout constant — pick a value, e.g. `10 * 60_000`, and expose it as a named `const DEFAULT_LIVE_IDLE_MS`; a config seam can override later). Pass `registry` as the new 4th arg to `buildSessionHandlers(deps, connection, store, registry)`. Call `registry.closeAll()` in the shutdown teardown so no live session/subprocess leaks on daemon stop.

- [ ] **Step 1: Write/adjust the failing test:** an integration test that sends **two `createSession` calls with the same conversationId over two different client connections** to one daemon and asserts both turns run on the one live session and both connections (if subscribed) see the stream. **Step 2: Run — FAIL** (registry not wired). **Step 3: Implement** the singleton construction + threading + shutdown teardown. **Step 4: Run — PASS** + `pnpm vitest run apps/cli`. **Step 5: Commit** `feat: own one live-session registry per daemon`.

---

### Task 6: Console reattach — subscribe on connect and hydrate run-status (G4 proof)

**Files:**
- Modify: `apps/desktop/src/shared/methods.ts` (add `subscribeSession`), `apps/desktop/src/main/index.ts` (proxy it), `apps/desktop/src/renderer/console.ts` (call it on connect; seed `state.ui.runStatus` from the hydrated status push rather than local send-tracking)
- Modify: `ROADMAP.md` (G4 done)
- Test: `apps/desktop/src/renderer/console.test.tsx`

- [ ] **Step 0 (grounding):** Read `console.ts`'s push-subscription setup (the `coa:push` channel handler and where `state.ui.runStatus` is currently set from a local in-flight send). Read how `startSession`/`recompilePrompt` proxy to the daemon (the `methods.ts` + `main/index.ts` + bridge pattern used in the A2 Task-6 work). Confirm the reconnect path (where the renderer (re)subscribes to the push stream on mount/daemon-restart).

**Interfaces:**
- Add `subscribeSession({ id })` to `METHODS`/the bridge/`main` proxy (mirrors the A2 `interruptSession` plumbing). On connect / when an active conversation is selected, the renderer calls `subscribeSession({ id })`; the daemon's hydration status push seeds `state.ui.runStatus`. The run pill now derives from the daemon snapshot, not local send-tracking — so a renderer reload mid-run reads `running`.

- [ ] **Step 1: Write the failing test** (`console.test.tsx`): mount the console for an active conversation whose daemon-side session is `running`; simulate connect → `subscribeSession` → a `running` status push arrives → assert the run pill reads running **without** a local send having been issued in this renderer instance (i.e. hydrated, not self-tracked). **Step 2: Run — FAIL.** **Step 3: Implement** the verb plumbing + the on-connect subscribe + the runStatus-from-hydration seeding. Update `ROADMAP.md` (G4 session independence: done — reload mid-run reads running). **Step 4: Run — PASS** + `pnpm vitest run apps/desktop` + `pnpm docs:check`. **Step 5: Commit** `feat: hydrate console run-status from the daemon on connect`.

---

## Self-Review

**Spec coverage (§5 P-α):** the `LiveSession` registry decoupled from connections (Tasks 1,2,4,5); input turn-channel + fan-out + run-state (Task 1); the daemon-owned turn loop reusing per-turn `createSession` for both backends (Tasks 3,4); multi-turn send-or-create (Task 4); reattach/hydrate = G4 (Tasks 4,6); lifecycle/idle-timeout + close-all on shutdown (Tasks 2,5); concurrency (multiple keyed live sessions — Tasks 2,5, integration-proven in Task 5). Cost-cap concurrency + crash/restart are unchanged singletons/mechanisms (no new task; verified by the existing charge/store paths staying intact — called out in Task 4's "keep the per-turn body intact"). ✅

**Out of scope (correctly absent):** SDK streaming/mid-turn steering (P-β), streaming token output (P-γ), same-file concurrent-edit coordination (item I), multi-pane console UX. ✅

**Placeholder scan:** Tasks 1–3 carry complete code. Tasks 4–6 carry a named Step-0 grounding step + exact interfaces/verbs to implement — intentional for the integration/transport surfaces (the pattern the A2 plan validated), not vague placeholders. The one deferred constant (idle-timeout default) is named `DEFAULT_LIVE_IDLE_MS` with a concrete value in Task 5. The ADR number `00NN` is resolved at authoring time against `docs/adr/`.

**Type consistency:** `LiveSession`/`Sink`/`TurnRequest`/`RunState` (Task 1) are consumed unchanged by the registry (Task 2), the loop (Task 3), and the handlers (Task 4); `runLiveSession(session, runTurn)` and `RunTurn` (Task 3) match the `makeRunTurn` producer (Task 4); `LiveSessionRegistry` methods (`getOrCreate`/`get`/`close`/`closeAll`/`touch`) are used with those exact names in Tasks 4 and 5; `subscribeSession` is defined in Task 4 and consumed in Task 6.

---

_Last reviewed: 2026-07-07_
