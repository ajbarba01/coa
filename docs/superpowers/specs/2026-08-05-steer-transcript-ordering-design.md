# A steer is recorded when the model receives it

Design for the ordering half of the mid-loop delivery arc. The delivery path shipped
([ADR-0030](../../adr/0030-delivery-one-intent-realized-per-backend.md)) and text now reaches a
running loop at its next round trip. What did not ship is the record: a steer is still written to
the append-only log at the instant it is **sent**, minutes before the model reads it, so the
transcript shows it in a position that never happened.

This design moves that write to the moment of pickup, removes barge-in, and collapses three steer
seams into one. It is a prerequisite for
[the subagent orchestration plan](../plans/2026-08-05-subagent-orchestration.md), whose
child-completion notices ride the same queue.

## The problem, concretely

A steer sent while the agent is working produces this:

```
agent: I'll check the config…
agent: [tool_use  Bash: grep …]
you:   actually use the JSON one     ← written at send; nobody has read it yet
       [tool_result]
agent: ok, using the JSON one        ← where it was actually read
```

Two things are wrong. The line is in the wrong place chronologically, and it sits **between a
`tool_use` and its paired `tool_result`** — the exact shape ADR-0030 names as forbidden by the
Messages API, and the shape that corrupts `loadBackendMessages` on a cross-provider switch or an
ineligible resume token. It is the third of the three pre-existing bugs the delivery arc found and
left; this design closes it as a side effect rather than documenting around it.

## What the code already does right

`runGovernedLoop` (`packages/loop-driver/src/driver.ts`) drains steers and deliveries at the **top
of each iteration** — after the previous round trip's `tool_result` frames were emitted — and emits
the user frame there, at pickup. On DeepSeek and LongCat the position is already correct and already
written by the pickup point.

So this is not a new mechanism. It is making the Claude held-open path do what the pure-API driver
already does, which is ADR-0030's own shape: one intent, realized per backend, core never asking
which backend it is talking to.

## Decisions

Settled with the maintainer on 2026-08-05. Recorded so they are not re-litigated.

1. **Queue does not change.** It stays console-side: held per session, pinned above the composer,
   removable, released FIFO as an ordinary send when the turn ends.
2. **Steer is the thing that changes.** It renders as a pending block at the bottom of the
   transcript from send until the agent picks it up, then takes its real chronological position.
3. **The stored log matches the live view.** This is not a console-only rendering fix; the record
   itself moves from send-time to pickup-time.
4. **An undelivered steer is not recorded.** If the session is stopped or dies before pickup, the
   text never enters the log. This matches Claude Code, whose transcript records user input only
   when it is actually sent to the model. The console holds it visibly meanwhile.
5. **Barge-in is removed altogether.** A steer delivers at the next possible boundary; it never
   abandons work in flight. Stop-then-send remains the way to discard a turn.
6. **Both verbs work on every backend.**

## The rule

> Write a delivery's line when it is **drained** — unless a `tool_use` is open (recorded with no
> matching `tool_result`), in which case hold it and write it the instant the last open tool closes.

One rule, one writer, in core, for every backend.

### Why the rule is stated this way

The obvious phrasing — "write it after the next `tool_result`" — depends on an unmeasured fact:
whether the Claude SDK's `PostToolUse` hook fires before or after the `tool_result` frame reaches
core. The two paths are different execution paths and their order has never been observed.

Phrasing it as the **legality constraint itself** removes that dependency:

- Hook fires first ⇒ a `tool_use` is open ⇒ the line is held ⇒ it lands after the `tool_result`.
- Hook fires second ⇒ the `tool_use` is already closed ⇒ the line is written immediately.

Both land in the legal position. The design is therefore correct under either ordering and provable
against a mock frame stream, with no live run in the critical path.

### Where it lives

`record()` in `establishHeldQuery` (and its per-turn twin) already sees every frame. It maintains a
**count of unmatched `tool_use` frames**: incremented on `tool_use`, decremented (floored at zero)
on `tool_result`, and when it reaches zero any held delivery lines are written.

A count, not a set keyed on `handle`: `blockToFrame` falls back to `block.id ?? ''`, so two
concurrent calls can both carry an empty handle and a set would collide. The count is
handle-agnostic and needs no correlation.

Core's existing drain closure becomes the writer:

```
drainDeliveries: () => {
  const pending = session.deliveries.drain();
  for (const d of pending) recordDelivery(d);   // written now, or held
  return pending;
}
```

`seq` is taken at write time, so the persisted order is the delivered order by construction.

The pure-API driver stops emitting its own delivery frames — it still pushes them into `messages`,
but core writes the log line. That keeps the append-only log to a single writer
([ADR-0010](../../adr/0010-append-only-conversation-log.md)) and puts the rule in exactly one place.

### Floors

- **A turn that ends with tools still open** (interrupt, error, a `tool_result` that never arrives)
  flushes any held lines at the turn boundary. Nothing can be stranded by an unbalanced pair.
- **A sealed queue yields nothing**, so decision 4 is automatic: a stopped session's pending text
  is never drained and therefore never written. No teardown-time salvage path exists or is wanted.

### What is recorded

The bare text, exactly as sent, with `role: 'user'` for a `user` origin and `role: 'system'` for a
`system` origin. Each backend still frames the text its own way for the model — Claude's
`renderDelivery` prefixes `[The user sent this while you were working]`, the pure-API driver feeds
`user` text bare — and core never learns which. This is unchanged from today and is what makes the
console's exact-match reconciliation below sound.

## One steer seam instead of three

`steerSession` loses its `mode` parameter. A steer on **any** session pushes to
`session.deliveries`.

A steer sent while nothing is running is unchanged: on a held-open session it feeds the input
channel as a plain next turn and is recorded there, because send and pickup are the same moment. The
composer only offers Queue and Steer while a turn is in flight.

That leaves four things unfed, and they go with their tests:

- `control.steer` and `control.queueSteer` (core)
- `drainSteer` and `drainQueuedSteer` — `@coa/spi`, `@coa/loop-driver`, `adapter-deepseek`,
  `adapter-longcat`, `apps/cli/src/adapter-factory.ts`

The barge-in machinery goes with it: the redirect branch in the held-open steer sink,
`awaitingRedirect`, `barging`, the residual-boundary swallow, the barge-in error-frame swallow, and
the `FRAME_BARGE_IN` prefix.

`query.turnInterrupt` **stays** — the user Stop path (`setInterruptClosure`) uses it and is
unaffected. The plan must confirm that the Stop path's own suppression (`query.stopped`) still
covers everything `barging` was covering, rather than assuming it.

### The per-turn boundary floor

In `runGovernedLoop`, `drainDeliveries` takes the slot `drainQueuedSteer` vacates at the close-gate:
gate allows, drain, and if anything came back, push it into `messages` and `continue` instead of
breaking. The drain is destructive, so the gate cannot simply `continue` and leave the work to the
top-of-loop drain; both sites call one local helper that drains, frames a `system` origin, and
pushes — written once so the two paths cannot diverge.

ADR-0030 states the delivery floor exists only on the held-open driver, and that a future producer
filling a per-turn session's queue would need the equivalent. This design builds it, because that
producer is the very next plan's child-completion notice — the single most likely way the
orchestration arc would strand a message.

## The stranded-delivery floor now records

`flushStrandedDeliveries` keeps feeding what is left as one plain next turn, in queue order, but now
writes the lines too — nothing wrote them earlier. Its current rationale inverts: today a `user`
entry is fed bare *because it was already recorded*; under this design it is recorded *here*, and
fed bare for the same reason it always was (the log and the model agree on the text).

A consequence worth stating rather than inheriting by accident: a **`system`-origin notice flushed
at a turn boundary becomes durable**, where today it is fed to the model and never logged. That is
the orchestration plan's open question about post-last-turn child notices, answered.

## Console

### Composer

The running-state actions become **Queue** (⏎) and **Steer** (⌥⏎). The Barge In button, its
tooltip, and the `Queue a message… (⌥⏎ barges in · esc stops)` placeholder change with it.
`steerSession` sends no `mode`.

### The pin

Per session, a list of pending steers, rendered as a distinct pending block at the **bottom of the
transcript** (queue pins stay above the composer, untouched).

A pin clears when a `role: 'user'` text frame arrives whose text is **exactly** the pending text.
Core records the text verbatim and bare, so this is equality, not fuzzy matching. Two identical
pending steers clear FIFO, which is the correct answer for indistinguishable messages.

Chosen over an echoed delivery id deliberately: an id would put a field on the **persisted** frame
that exists only to serve a transient console concern, and the append-only log is not the place to
carry console state.

Belt-and-braces: any pin still present when the session goes `idle` or `interrupted` clears. A pin
can never wedge, whatever happens to the text on the way.

`console.ts`'s standing comment that the console does **not** render optimistically — written when
the daemon pushed the framed steer at send-time — inverts and must be rewritten, not left.

## Boundaries this design does not cross

- `TurnFrame`, the wire schemas, and the persisted frame shape are unchanged. No new frame kind, no
  new field, nothing added to the M9 port.
- `foldEventsToTranscript` is not changed. Its `'system'`-role fold — the integrity boundary the
  delivery arc added, which keeps a system frame from merging into an open assistant message — must
  be verified intact, not regressed. Recording at pickup makes the fold's input legal; it does not
  ask the fold to do anything new.
- The Claude adapter's `renderDelivery` framing, the `PostToolUse`/`Stop` drain points, and
  `DeliveryQueue` itself are untouched.
- Nothing in the orchestration plan is built here.

## Verification

Per the repo's first hazard — a test that passes before the fix proves nothing; the delivery arc hit
it five times — **every test states the one-line production revert that makes it fail, and that
revert is performed and confirmed.** Two specific traps this design must avoid:

- A fixture whose turn completes inside one microtask burst exercises an *idle* turn while claiming
  to test a *running* one. Delivery-ordering tests need a turn that is genuinely still in flight
  when the drain happens.
- Asserting only the end state. "The line is in the log" holds under both the correct and the
  incorrect implementation. The assertion has to be on **position** — the line's index relative to
  the `tool_use`/`tool_result` pair.

Test surface:

- Core: written immediately when no tool is open; held and written after the `tool_result` when one
  is; held across two concurrent tool calls until both close; flushed at the turn boundary when a
  `tool_result` never arrives; never written when the queue was sealed first.
- Core: the recorded `role` follows the delivery's origin.
- Driver: deliveries drained at the close-gate re-enter the loop instead of ending it.
- `adapter-factory.test.ts`: the whole-contract forwarding test loses the four removed fields.
  **If any init field is added, it is added there too** — that file exists because a feature has
  shipped dead behind a green suite three times.
- Console: the pin renders at the transcript bottom, clears on the exact-match frame, and clears on
  idle/interrupted.

**Optional live confirmation.** The third probe in `post-tool-delivery.live.test.ts` can capture the
frame count at drain time, which records once and for all which side of the `tool_result` the
`PostToolUse` hook falls on. It costs nothing beyond the run it already does. It **confirms**; it
does not gate, because the rule is correct either way. `COA_LIVE` spends real tokens, so it is asked
for before it is run.

## Docs

- **ADR-0031** — this decision. Supersedes ADR-0030's record-timing bullet and ADR-0012's barge-in
  decision. ADR-0012's measured input-stream ceiling is untouched and still stands.
- **ADR-0030** — amend the record-timing bullet, the `flushStrandedDeliveries` rationale, and the
  per-turn "needs none today" note. Its **"Still unmeasured" section is stale**: all four probes
  passed live on 2026-08-05 against SDK 0.3.196 / CLI 2.1.196.
- **ROADMAP.md** and any SPEC surface describing steer modes.

**This takes ADR number 0031, so the orchestration plan's three ADRs move to 0032+.**

---

_Last reviewed: 2026-08-05_
