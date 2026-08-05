# 0030 — Delivery is one intent, realized per backend

- Status: accepted
- Date: 2026-08-05

## Context and problem

ADR-0012 measured the Claude Agent SDK's streaming-input ceiling: a message pushed into the open
input iterable while a turn is running is **queued** — it runs as the next turn at the current
turn's boundary, never injected into the turn already in flight. That finding is about the
**input stream** specifically. It says nothing about whether any position *inside* a running turn
can receive text sooner than a turn boundary, and two consumers need exactly that: a barge-in
steer that lands faster than "wait for the whole turn," and — the reason this plan exists — the
child-completion producer the next arc needs, which must tell a parent agent its child finished
without waiting out the parent's entire in-flight turn.

The Messages API narrows the search on its own: it forbids inserting a bare user message between
a `tool_use` block and its paired `tool_result`. Whatever channel exists mid-turn is not "send
another message" — it has to ride something the API already permits inside that window.

## Decision drivers

- ADR-0012's ceiling is real and does not move; nothing here reopens the input-stream question.
- Two backend families exist — the Claude SDK's held-open loop, and the pure-API
  `runGovernedLoop` shared by DeepSeek/LongCat — and core must not branch on which one is active
  (ADR-0002/0004).
- A `system`-origin delivery (a platform notice) must be impossible for a model to forge: nothing
  running inside a tool call may be able to write to a human's channel.
- SC-1: delivery is not a block. A pending delivery that never reaches a legal mid-turn boundary
  must degrade to the ordinary turn boundary, never hang or error.
- Types cannot settle whether the SDK's hook output is honoured — `governed-gate.live.test.ts`
  (lines 86-90) already established that norm for `PreToolUse`; this decision inherits it for
  `PostToolUse` and `Stop` too, and does not get to ship on types alone either.

## Considered options

1. **A neutral `DeliveryQueue`/`Delivery` port on M9, drained once per backend at its own soonest
   legal boundary** (chosen). Core fills the queue; each adapter drains it wherever its own turn
   model allows.
2. **Extend the input-stream channel to carry delivery text too.** Rejected — ADR-0012 already
   measured that channel: anything pushed there queues to the NEXT turn boundary regardless of
   framing, so it cannot beat a turn boundary and buys nothing over the status quo.
3. **A dedicated mid-turn side-channel call into the SDK.** Rejected — no such primitive exists
   (the same gap ADR-0012's barge-in follow-up hit; upstream issue #50246 is still pending), and
   building one is not coa's to do (P8 — compose, don't reinvent).

## Decision

**One abstract intent — "text waiting to reach a running loop" — realized once per backend, never
branched on by core.**

- **The port.** `Delivery = { origin: 'user' | 'system'; text: string }` and
  `DrainDeliveries = () => readonly Delivery[]`, declared once in
  `packages/spi/src/runtime-adapter.ts`. `packages/core/src/session/delivery.ts`'s
  `DeliveryQueue` is the neutral pending-delivery queue: `drain()` is at-most-once, and `seal()`
  is a one-way cancel-guard — a delivery arriving after a session has torn down can never wake a
  subtree a person deliberately stopped. `LiveSession` owns one queue per session and seals it in
  `close()`, before finalizers run.
- **Why the tool-result slot.** The Messages API forbids a bare user message between a `tool_use`
  and its `tool_result` — that constraint is why the tool-result slot is the only legal mid-loop
  position on the Claude side, and it is why the design below looks the way it does.
- **The per-backend realization table:**
  - **Claude.** `PostToolUse`'s hook returns pending text as
    `hookSpecificOutput.additionalContext`, landing it beside the tool result — the loop's next
    round trip, not the turn boundary. When the model answers in plain text and calls no tool,
    `PostToolUse` never fires; the `Stop` hook is the floor, merging the same
    `additionalContext` onto its own hook output so a pending delivery is never silently dropped.
  - **Pure-API (DeepSeek, LongCat).** `runGovernedLoop` drains the queue at the top of each round
    trip. No hook seam exists there — the loop's own boundary is the equivalent point.
  - One intent, two realizations; `packages/core/src/session/*` never asks which backend it is
    talking to.
- **The floor under the held-open driver: a stranded delivery degrades to the turn boundary.**
  Every backend's last mid-turn drain point sits *before* the turn's terminal frame — on Claude
  the `Stop` hook has already fired and returned by the time the `turn-boundary` frame lands, and
  only that frame decrements the core's in-flight count. Text arriving in that window still reads
  as "a turn is running", so it is queued with no drain point left to take it: the person would
  see their own message in the transcript, get no reply, and get no error. So when the held-open
  driver's last outstanding turn boundaries with the queue non-empty, `establishHeldQuery`'s
  `record()` feeds what is left into the input channel as one plain next turn, in queue order. It
  is a real turn and is counted as one. A `user` entry is fed **bare** — the steer handler already
  wrote it to the append-only log when it was queued, and re-appending would put the same turn in
  canonical memory twice (one writer per record — ADR-0010) — while a `system` entry is framed as
  a notice exactly as a backend frames it mid-loop, so nothing automated can be read as the person
  speaking. A sealed queue yields nothing, so this path can never revive a subtree a person
  stopped. This is the SC-1 degradation promised above. The per-turn path wires the same
  `drainDeliveries` but has no equivalent flush; it needs none today, since nothing routes a
  delivery onto a per-turn session's queue — a queue-mode steer there lands on `control.queueSteer`
  instead (a future producer that fills that queue would need the same floor).
- **Unforgeable `system` origin.** No producer is reachable from inside a tool handler — a
  `RegisteredTool`'s `invoke` receives only its validated args, never a session handle — so a
  `system`-origin delivery cannot be manufactured by anything the model runs. Today only coa's own
  steer handler writes `user`; the child-completion producer that will write `system` is the next
  plan's work, not this one's.
- **The steer rides the same queue.** A queue-mode steer arriving while a turn is in flight is
  pushed onto `DeliveryQueue` instead of the input feed (which ADR-0012 already showed queues to
  the next turn); an idle steer still rides the input feed as a plain next turn, unchanged.
- **A fold-time correction the plan did not anticipate.** Widening the wire frame's role union to
  admit `'system'` required updating `foldEventsToTranscript`
  (`packages/core/src/session/transcript-projection.ts`), the read-time fold of the append-only
  log back into the model-facing `BackendMessage[]` for replay. Left unhandled, a `system` frame
  would have merged into whatever assistant message was still open at fold time, corrupting what
  the model is told it previously said. The fold now produces its own `{ role: 'user', content }`
  for a `system` frame — matching what the driver actually sends live, since the Messages API has
  no `system`-role turn mid-conversation.

## Consequences (good / bad)

**Good**

- A parent agent — and, sooner, a barge-in steer — can now reach a running loop within one round
  trip instead of one whole turn, on every backend, without core ever knowing which backend it is
  talking to.
- The cancel-guard (`seal()`) means a late delivery from a torn-down subtree can never revive or
  corrupt a session a person already stopped.
- The `system`/`user` origin split is enforced by reachability, not convention — there is nothing
  to audit for a model trying to forge a notice.

**Bad**

- The Claude realization rests on a hook-output field verified live, not by type — the same class
  of fact ADR-0028/0029 had to measure rather than assume for `PreToolUse`, and this decision
  inherits that dependency on the live gate rather than closing it structurally.
- The Claude delivery point is bounded by whichever legal boundary comes first: a long tool-free
  stretch of plain-text generation still waits for `Stop`, not a true mid-generation inject — the
  same ceiling ADR-0012 already named. No primitive exists to write into an in-flight turn's own
  output stream.
- The child-completion producer, lineage, `spawn_agent`, abort cascade, root cost attribution, and
  console nesting are **not** built here. This ADR gives that plan a delivery substrate and a
  cancel-guard to build on, nothing more (see ROADMAP.md).

**Measured live, 2026-08-05.** Against the real CLI (SDK 0.3.196 / CLI 2.1.196), a `COA_LIVE` gate
(`post-tool-delivery.live.test.ts`) confirmed both facts this decision rests on: a `PostToolUse`
hook's `additionalContext` **does** reach the model within the same turn — an injected token was
echoed back with no second user turn — and `PostToolUse` **does** fire for `Bash`. Two probes,
both passed.

**Still unmeasured.** The same file carries two more probes, written but pending the controller's
live run: whether a steer pushed while a `Bash` call is genuinely still executing reaches the
model before that turn's terminal result, through the real adapter wiring
(`assembleSessionOptions`/`buildHooks`) rather than a bare `query()`; and whether the `Stop`-hook
floor's `additionalContext` is honoured when the model answers in plain text and calls no tool at
all — the case `PostToolUse` never covers. Both rest on the same hook-output field the two proven
probes above already showed is honoured, but neither is proven itself until that run happens.

---

_Last reviewed: 2026-08-05_
