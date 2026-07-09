# Barge-in: true mid-turn redirect + a neutral queue-vs-barge-in steer seam

- Date: 2026-07-08
- Status: design approved (maintainer), ready for implementation plan
- Basis: docs/adr/0012 ("Follow-up: mid-turn redirect (barge-in)"), the P-β section of
  `.superpowers/sdd/progress.md`, the agent-hardening arc
- Baseline commit: `b76487b` (P-β complete + merge-ready)

## Problem

P-β established the Claude Agent SDK's steering ceiling: a message pushed into a held-open
streaming-input `query()` is **queued** and runs as the next turn — the SDK has **no primitive to
inject into a running turn** (live-verified; upstream feature #50246 pending). So the steer coa ships
today is a warm follow-up, never a mid-turn redirect.

The SDK does expose a **turn-level** `query.interrupt()` (streaming-input mode only): it stops the
CURRENT turn but keeps the query **alive**, returning `InterruptReceipt{ still_queued }`. This is
distinct from the whole-query `AbortController` coa uses for `interruptSession` today (which
terminates the query, forcing a re-establish). True barge-in = `interrupt()` + inject the redirect,
keeping the warm session.

This piece delivers a **neutral queue-vs-barge-in steer seam for BOTH backends** and fixes the I3
boundary-latch limitation ADR 0012 recorded.

## Goals

1. A neutral steer seam exposing two modes on every backend:
   - **queue** — the steer runs strictly AFTER the current turn.
   - **barge-in** — the current turn is stopped ASAP and the steer runs now.
2. Claude barge-in via the SDK's turn-level `query.interrupt()` + a framed push, keeping the
   held-open query alive (never the whole-query abort).
3. Pure-API symmetric two modes, realized within its per-turn loop's turn model.
4. Fix I3: the single-slot `query.boundary` latch must not let an injected steer turn resolve the
   wrong awaited turn.
5. A `COA_LIVE`-gated live smoke that proves the real-SDK interrupt + re-inject behavior (the fake
   models only the shape, not the SDK's true termination/interleaving).

## Non-goals

- The console steer affordance (typing a redirect mid-turn) — still deferred (ROADMAP M10).
- Changing `interruptSession` (whole-query stop / user "Stop") — it stays as-is and coexists with
  barge-in as a distinct user action.
- ADR 0010 append-only convergence — deferred; this piece keeps the two-store model.

## Invariants that must not regress

- **SC-1** — steer and interrupt are user actions, NEVER a block or an error. The only two blocks
  remain the M3 close-gate and the M7 cost-cap.
- **D85** — a one-turn conversation stays byte-identical; `coa raw` is sacred; an omitted `mode`
  reproduces today's behavior exactly.
- **A1 block-preserving flush** — barge-in changes only WHICH in-flight work is discarded (the
  interrupted generation), never WHAT the flush preserves: completed blocks still reach canonical
  memory, trimmed round-trip-consistent (`dropTrailingDanglingToolCall`).
- **Neutral seam (ADR 0002/0004)** — no backend type crosses M8; composition never branches on the
  backend. M8 branches only on the abstract strategy verdict (`control.mode`, already present), and
  the adapter/factory decides the realization.

## Design

### 1. The neutral steer-mode seam

- **RPC / param**: `steerParams` in `session-handlers.ts` gains
  `mode: z.enum(['queue', 'barge-in']).default('queue')`. A `SteerMode = 'queue' | 'barge-in'` type
  lives beside `TurnControl` in `live-session.ts`. Default `queue` preserves today's held-open
  route; the only current callers are tests and the deferred console.

- **Turn-interrupt handle reported UP** (mirrors `onBackendSession`): `SessionAdapterInit`
  (`session.ts`) and `ClaudeSdkAdapterInit` (`claude-sdk-adapter.ts`) gain
  `onTurnInterrupt?: (interrupt: TurnInterrupt) => void`, where
  `TurnInterrupt = () => Promise<InterruptReceipt>` and `InterruptReceipt = { stillQueued?: boolean }`
  — a coa-neutral mirror of the SDK's shape, defined in `@coa/spi`. The Claude adapter captures its
  streaming-input `query` object (today it is iterated inline, never bound to a variable) and calls
  `onTurnInterrupt(() => q.interrupt())` once the query exists. Pure-API adapters never call it. No
  SDK type crosses the seam.

- **LiveSession routing**: `setSteerSink`/`pushSteer` gain the mode:
  `Sink signature (text: string, mode: SteerMode) => void`; `pushSteer(text, mode)`. The LiveSession
  stays a dumb router — all backend specifics live in the sink the held-open driver installs.

- **`createSession` req** gains `onTurnInterrupt?` and forwards it into `SessionAdapterInit`
  (guarded-spread, exactOptionalPropertyTypes-safe).

### 2. Claude held-open barge-in

`establishHeldQuery`'s session-scoped closure already owns the `InputChannel`. It now also captures
the reported-up interrupt handle (via `onTurnInterrupt`, stored on the `HeldQuery`) and installs a
mode-aware steer sink:

```
setSteerSink((text, mode) => {
  if (mode === 'barge-in') {
    void (async () => { await turnInterrupt?.(); channel.push(FRAME_BARGE_IN + text); })();
  } else {
    channel.push(text);            // queue = today's behavior, unchanged
  }
});
```

where `FRAME_BARGE_IN = '[The user interrupted to steer you] '` (a coa-local const in
`session-handlers.ts`). Barge-in stops the current turn (query stays alive), and the framed steer
runs as the next turn. The framing is Claude-specific — it counteracts the SDK's bare "interrupted"
signal so the model reads a deliberate redirect. In-flight generation is discarded; the A1
per-boundary flush preserves completed blocks.

Ordering: `interrupt()` stops turn A; the SDK then pulls the next queued input, which is the framed
steer B just pushed into the `InputChannel`. `await turnInterrupt()` before the push keeps the order
deterministic. The exact post-interrupt frame sequence is finalized against the live smoke (§4).

### 3. Pure-API symmetric two modes

`TurnControl` gains a second buffer `queueSteer: string[]`. `runPerTurn` wires both drains onto the
per-turn `createSession` call:

- `drainSteer: () => steer.splice(...)` — **barge-in** (existing).
- `drainQueuedSteer: () => queueSteer.splice(...)` — **queue** (new).

`GovernedLoopDeps` (loop-driver) gains `drainQueuedSteer?: () => readonly string[]`. In
`runGovernedLoop`:

- **barge-in** stays the existing top-of-loop `drainSteer` inject (next round-trip boundary —
  pure-API's earliest safe point; the current round-trip completes, so no work is wasted). This is a
  documented, coherent per-backend difference from the SDK (which discards in-flight generation
  because interrupt is its only stop).
- **queue** drains at the point the close-gate WOULD let the turn end
  (`result.toolCalls.length === 0 && decision.allow`): if a queued steer exists, inject it as a user
  message, advance `lastConsistent`, and `continue` instead of `break` — "run after the current
  turn's work." If none, `break` as today (D85 no-op when both buffers are empty).

`steerSession` routing:

- `control.mode === 'held-open'` → `session.pushSteer(text, mode)`.
- else (`per-turn`) → `mode === 'barge-in' ? control.steer.push(text) : control.queueSteer.push(text)`.

An empty steer is dropped (unchanged) — it would otherwise write a blank user turn into canonical
memory.

### 4. The I3 latch fix — boundary accounting

Replace the single `HeldQuery.boundary` Deferred slot with **boundary accounting** so an injected
steer turn resolves the correct awaited turn:

- `HeldQuery` holds `pendingTurns: number` and a single driver-facing latch `boundary`.
- Each push of a turn into the channel increments `pendingTurns`: the initial turn (establish), a
  continue turn, AND a barge-in-injected steer.
- `record()` on each `turn-boundary` frame decrements `pendingTurns`. It resolves the driver's
  `boundary` latch (and emits the per-turn `'done'`) ONLY when `pendingTurns` reaches 0; while
  outstanding injected turns remain (`> 0`) it does not resolve the driver — the redirect is still
  running.
- `settleHeldQuery` resolves any parked latch on termination (unchanged safety net), so an interrupt
  or error never hangs the driver.

**Load-bearing SDK assumption**: this accounting assumes `query.interrupt()` emits exactly one
terminal `result`/`turn-boundary` frame for the truncated turn (so the interrupted turn's boundary
decrements, and the injected steer's boundary decrements to 0). This is the P-β-style real-SDK
unknown — the fake models the shape, but the true termination/interleaving is **finalized against
the live smoke (§5)**. The `claude-code-guide` agent's recorded July-2026 answer
(`interrupt()` stops the current turn, keeps the query alive, returns `InterruptReceipt{still_queued}`)
is re-confirmed at build; if the live smoke shows interrupt does NOT yield a boundary frame, the
increment on barge-in is adjusted to match (the mechanism is the same; only the bookkeeping constant
changes).

### 5. Live smoke

A `COA_LIVE`-gated smoke (mirroring `packages/adapter-claude-sdk/src/streaming-smoke.live.test.ts`,
`describe.skipIf(!COA_LIVE)`, resolving the active `personal` account) proves against the real
`@anthropic-ai/claude-agent-sdk`:

1. A running tool-using turn is interrupted by a barge-in; the framed steer runs as the next turn.
2. The held-open query stays ALIVE across the interrupt (no re-establish).
3. Completed blocks survive (A1) — the truncated turn's finished work is in canonical memory.
4. The boundary accounting (§4) matches the real frame sequence (this is what finalizes the latch
   bookkeeping).

The maintainer confirmed `coa auth list` shows `personal` active / `school` backup; confirm usable
before relying on the gate, report BLOCKED if rate-limited. Treat the live gate as authoritative
(P-β's live smoke overturned a plan assumption).

## Coexistence with `interruptSession`

`interruptSession` (user "Stop") and barge-in are distinct user actions with distinct mechanisms and
both remain SC-1:

- `interruptSession` → whole-query `AbortController.abort()` → the SDK query throws →
  `settleHeldQuery` marks it `terminated` → the next turn re-establishes a fresh query. "I'm done for
  now."
- barge-in → turn-level `query.interrupt()` → the query stays alive → the framed steer runs next.
  "Stop that, do this instead."

## Task shape (for the implementation plan)

1. Neutral seam types + `SteerMode` + `onTurnInterrupt` hook + mode-aware `pushSteer`/`setSteerSink`
   (fake-tested; typecheck).
2. Claude adapter: capture the `query` object, report the turn-interrupt handle up via
   `onTurnInterrupt` (fake-tested).
3. M8 held-open barge-in wiring (mode-aware sink + `FRAME_BARGE_IN`) + the I3 boundary-accounting
   fix (fake-tested; regression test for the injected-steer-resolves-right-turn case).
4. Pure-API symmetric two modes: `queueSteer` buffer, `drainQueuedSteer`, the close-gate-time queue
   inject in `runGovernedLoop`, `runPerTurn` wiring, `steerSession` routing (fake-tested).
5. `COA_LIVE` live smoke; finalize the §4 latch accounting against the observed real frame sequence.
6. Docs, same-commit: ADR 0012 follow-up state (mark the barge-in follow-up delivered + the I3 fix)
   or a new ADR if the seam warrants one; `docs/design/handoff/spec/M8.md` + `M9.md`; ROADMAP. Keep
   `pnpm docs:check` green (the maintainer's untracked `project.md` failure is external — never
   touch it).

## Verification per unit

- `pnpm --filter <pkg> typecheck` (NOT just eslint+vitest — vitest transpiles without full strict
  typechecking; exactOptionalPropertyTypes has bitten this arc).
- `pnpm vitest run <path>` for packages whose `test` script is absent.
- Fake suites prove shape; the live smoke is the authority for real-SDK behavior.
- Subject-only Conventional Commits, staged by name; never stage DEV-NOTES.md / TEMP.txt /
  project.md.
