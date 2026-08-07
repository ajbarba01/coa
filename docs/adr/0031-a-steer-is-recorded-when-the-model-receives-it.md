# 0031 — A steer is recorded when the model receives it

- Status: accepted
- Date: 2026-08-05

## Context and problem

ADR-0030 shipped the delivery path: text reaches a running loop at its next legal mid-turn
boundary instead of waiting for the whole turn. It said nothing about when that text is written to
the append-only log. Today it is written at **send** — the instant the person hits the key —
minutes before the model has read it.

A send-time record claims a position in the transcript that never happened, and on the Claude path
it can claim an illegal one: a steer sent while a tool call is in flight is written between that
`tool_use` and its `tool_result`, the exact interleaving ADR-0030 itself names as forbidden by the
Messages API. A transcript with that shape corrupts `loadBackendMessages` on a cross-provider
switch or an ineligible resume token. This is the third of the three pre-existing bugs the delivery
arc found and left; this decision closes it rather than documenting around it.

## Decision drivers

- One writer for the append-only log, in core, for every backend (ADR-0010) — the record-timing
  rule cannot live per-adapter or it stops being one rule.
- The rule must be provable against a mock frame stream with no live run in the critical path —
  whether the Claude SDK's `PostToolUse` hook fires before or after the `tool_result` frame reaches
  core has never been measured, and the design cannot depend on an unmeasured fact.
- SC-1: an undelivered steer must degrade, never hang or error — a session stopped or torn down
  before pickup must not leave a floating record of something the model never saw.
- Match Claude Code's own transcript behaviour: it records user input only when it is actually sent
  to the model, not when the person typed it.

## Considered options

1. **Write on drain, held while a `tool_use` is open** (chosen). `record()` maintains a count of
   unmatched `tool_use` frames — incremented on `tool_use`, decremented (floored at zero) on
   `tool_result` — and writes any held delivery lines the instant the count reaches zero.
2. **Write after the next `tool_result`.** Rejected — this is the same rule in different words, but
   it depends on an unmeasured fact: whether `PostToolUse`'s hook output (which is what actually
   carries the delivery to the model) fires before or after the `tool_result` frame reaches core.
   Phrasing the rule as the legality constraint instead removes that dependency entirely: if the
   hook fires first, a `tool_use` is open, so the line is held and lands after the `tool_result`; if
   it fires second, the `tool_use` is already closed, so the line is written immediately. Both land
   in the legal position — the rule is correct under either ordering, and needs no live run to prove
   it.
3. **Key the hold on the delivery's matching handle rather than a bare count.** Rejected —
   `blockToFrame` falls back to `block.id ?? ''` when a block carries no handle, so two concurrent
   tool calls can both map to an empty handle; a set keyed on handle would collide. A count is
   handle-agnostic and needs no correlation between a `tool_use` and its `tool_result`.
4. **Reconcile the console's pending-steer pin by transcript position** (an echoed delivery id or a
   stored frame index). Rejected — `openSession` replaces the frame array wholesale on an ordinary
   tab switch, so a stored index goes stale the moment the user switches tabs and back. An id would
   also put a field on the **persisted** frame that exists only to serve a transient console
   concern, and the append-only log is not the place to carry console state. Chosen instead: a
   **count baseline** — each pin records how many `role: 'you'` frames already carry its exact text,
   and clears when that count grows. Position-independent, survives a full frame-array swap, and two
   identical pending steers clear FIFO, which is the correct answer for indistinguishable messages.

## Decision

**Write a delivery's log line when it is drained — unless a `tool_use` is open (recorded with no
matching `tool_result`), in which case hold it and write it the instant the last open tool closes.**
One rule, one writer, in core, for every backend.

- **Where it lives.** `record()` in `establishHeldQuery` (and its per-turn twin) already sees every
  frame; a module-level `createDeliveryRecorder`
  (`packages/core/src/session/session-handlers.ts`) owns the rule once, and both closures use it.
  Core's drain closure becomes the writer: `drainDeliveries` iterates what `session.deliveries.drain()`
  returns and calls the recorder for each — written now, or held. `seq` is taken at write time, so
  the persisted order is the delivered order by construction.
- **One writer for every backend (ADR-0010).** The pure-API driver (`runGovernedLoop`) stopped
  emitting its own delivery frames — it still pushes drained text into `messages` so the model sees
  it, but core writes the log line. That keeps the append-only log to a single writer regardless of
  which backend is running.
- **The floors.**
  - A turn that ends with a `tool_use` still open (interrupt, error, a `tool_result` that never
    arrives) flushes any held lines at the turn boundary — nothing can be stranded by an unbalanced
    pair. A turn that ends by a genuine mid-turn throw (a dropped provider connection) reaches
    neither a `turn-boundary` frame nor the interrupt closure, so `settleHeldQuery` and
    `runPerTurn`'s `catch` block each flush directly, ordered before the error frame they record —
    the delivery was handed to the model before the throw, so its line belongs above the failure,
    not lost with it.
  - A sealed queue yields nothing: a stopped or torn-down session's pending text is never drained
    and therefore never written. An undelivered steer is never recorded — matching Claude Code,
    whose own transcript records user input only when it is actually sent to the model. No
    teardown-time salvage path exists or is wanted.
- **Barge-in is removed altogether**, and the three steer seams it needed collapse to one.
  `SteerMode`, `FRAME_BARGE_IN`, `query.barging`, `query.awaitingRedirect`, the redirect branch in
  the held-open steer sink, and `steerSession`'s `mode` parameter are gone; `control.steer` and
  `control.queueSteer` are gone with the seams that fed them (`drainSteer`/`drainQueuedSteer` across
  `@coa/spi`, `@coa/loop-driver`, both pure-API adapters, and `apps/cli`). A steer now always
  delivers at the next possible boundary; it never abandons work in flight. `drainDeliveries` took
  the close-gate slot `drainQueuedSteer` vacated in `runGovernedLoop` — the per-turn boundary floor
  ADR-0030 said did not exist yet — via a single `absorbDeliveries()` helper used at both drain
  sites, because the drain is destructive and the two paths cannot be allowed to diverge.
  `query.turnInterrupt` (`onTurnInterrupt`) stays: it is what the user-Stop path
  (`setInterruptClosure`) calls, and `query.stopped` was verified to be a strict superset of what
  `query.barging`'s suppression covered, rather than assumed to be. With barge-in gone,
  `onTurnInterrupt` now exists **solely** for that Stop path — it has no other caller.
- **Console reconciliation is exact-text, count-baseline, not position-based** — see option 4 above.
  A pin is gated out of raw mode (`coa raw` is the verbatim loop projection; a pin is not part of
  the loop, it is a console-only holding state), and any pin still present when the session goes
  `idle` or `interrupted` clears, so a pin can never wedge.

## Consequences (good / bad)

**Good**

- The transcript now shows a steer where it was actually read, never inside a `tool_use`/
  `tool_result` pair — the shape that corrupted cross-provider resume is structurally impossible.
- One rule, proven against a mock frame stream, correct regardless of which side of the
  `tool_result` frame `PostToolUse`'s hook output actually lands on — no live run gates it.
- Barge-in's removal collapses three steer seams into one; there is exactly one way text reaches a
  running loop mid-turn, on every backend, and core still never asks which backend it is talking to.

**Bad**

- A steer no longer abandons work in flight — discarding a turn now takes an extra step
  (Stop-then-send) where a barge-in used to do it in one.
- The console now holds state — the pending-steer pin — that the persisted log does not carry. This
  is a deliberate trade: the alternative was recording something the model was never handed, which
  is the exact defect this decision closes.

## What this does not fix

Two pre-existing bugs found by the delivery arc are unchanged by this decision, named here so they
stay greppable:

- `createClaudeAdapter` still drops `observeChanges` — the M1 reconciler trigger never fires from
  the real composition root, only from test wiring.
- `createClaudeAdapter` still drops `onTurnInterrupt` — every live Claude user-Stop degrades to a
  whole-query abort instead of the SDK's turn-level `query.interrupt()`. This is more pointed now
  than when ADR-0030 was written: with barge-in gone, `onTurnInterrupt` exists for exactly one
  caller, the user-Stop path, and that caller still cannot reach it through the real adapter.

---

_Last reviewed: 2026-08-05_
