# 0011. The daemon is the authoritative owner of a live session across turns

- Status: accepted
- Date: 2026-07-07

## Context and problem

Before this decision, `createSession` (M8) ran a conversation's ENTIRE per-connection lifetime as one RPC call:
the handler bound a worktree, ran the backend loop to completion, and tore down its bookkeeping (`live`/`control`
maps) once that call settled. A second send against the same `conversationId` started a brand-new,
independent `createSession` invocation with no shared in-memory state — continuity across sends existed only
because each invocation re-read the R-7 conversation store from disk. That store-mediated continuity works for
"send, wait, send again," but it has no notion of a session that is *live between sends*: nothing tracks
whether a conversation is currently running a turn, nothing lets a second connection observe that a turn is
in flight, and a reconnecting client (the console reloading, or a second window) has no way to learn a
session's current status short of guessing from its own stale memory. This is the industry-standard gap the
console needs closed before multi-turn, mid-turn steering, and reconnect-safe UI are possible (see
`docs/superpowers/specs/2026-07-07-long-lived-session-multiturn-design.md`, referred to there as **G4 — session
independence**).

## Decision drivers

- **G4 session independence.** A viewer (a connection) must never be the thing that makes a session "exist" —
  reloading the console, or opening a second window, must show the true current state, not a stale guess.
- **D85 strict-superset.** A conversation that takes exactly one turn must behave byte-identically to the
  pre-existing single-turn `createSession` path; the live-session machinery is additive, never a rewrite of the
  per-turn body.
- **SC-1.** No new block class — interrupt/steer remain user actions, never governance denials, on a live
  session exactly as they were on a per-call one.
- **Neutral seam (ADR 0002/0004).** The daemon-owned turn loop must run the SAME per-turn `createSession` for
  both the Claude SDK and the pure-API backends; composition must not branch on backend to get there.
- **P1 determinism.** Session lifecycle/routing is deterministic control flow — no model call decides whether a
  session is live, queued, or idle.

## Considered options

1. **A daemon-singleton `LiveSessionRegistry`, keyed by conversation id, holding one `LiveSession` per
   conversation for as long as it exists** (chosen). `createSession` becomes send-or-create: it resolves the
   conversation id, enqueues the send as a `TurnRequest`, and — only the first time — starts a daemon-owned
   turn loop (`runLiveSession`) that drains the queue one turn at a time, running each through the existing
   per-turn `createSession` unchanged in substance. A connection becomes a stateless, reattachable subscriber:
   `subscribeSession(id)` joins the stream and immediately hydrates the caller with the session's current
   run-status.
2. **Keep per-call sessions; have the console poll or re-derive liveness from its own tracking.** Rejected: this
   is exactly the failure mode G4 exists to close — a client's own tracking of "is this running" is never
   trustworthy after a reload, a dropped connection, or a second window; only the daemon (the thing that
   actually holds the running turn) can answer that question.
3. **Convert the Claude SDK adapter to genuinely bidirectional streaming (a persistent `query()` session) as
   part of this change.** Rejected for now: the SDK's streaming-input mode is a larger, separable piece of work
   (cascades into streamed-turn transcript capture, preamble-under-streaming, and a live-SDK termination
   assumption). This ADR's facade — resume-per-turn through the daemon-owned loop — gets both backends real
   multi-turn + reattach + interrupt today without waiting on that follow-up; true mid-turn SDK steering is
   deferred alongside it.

## Decision

The daemon is the **authoritative owner of a session's lifecycle AND liveness**, not any one connection:

- A `LiveSessionRegistry` (`packages/core/src/session/live-registry.ts`), keyed by conversation id, holds one
  `LiveSession` (`live-session.ts`) per conversation: an input turn-channel, an `idle`/`running` run-state, and a
  set of subscriber sinks fanned out to on every push.
- `createSession` is **send-or-create**: it resolves (or mints) the conversation id via `registry.getOrCreate`,
  enqueues the send, and — only the first time a session is created — starts `runLiveSession`
  (`run-live-session.ts`), a daemon-owned loop that awaits the next queued turn and runs it through the
  **same, unmodified per-turn `createSession`** (`session.ts`, D121) both backends already ran through. Only the
  turn's emit targets change — `session.emit`/`session.setState` fan out to every subscriber instead of one
  connection's push channel.
- A connection is a **stateless, reattachable subscriber**: `subscribe`/the new `subscribeSession` verb joins a
  session's push stream and is immediately hydrated with its current run-status. Nothing about a session's
  lifecycle depends on any one connection being open — a live session runs headless with zero subscribers, and
  a reconnecting client reads the daemon's true state rather than reconstructing it from memory.
- `interruptSession`/`steerSession`/`closeSession` resolve the `LiveSession` from the registry and act on the
  CURRENTLY in-flight turn's control state (an `AbortController` + steer queue, unchanged from CHAT-10); SC-1 is
  preserved exactly — an interrupt still never renders as an error.
- Both backends run through this facade identically: the daemon-owned loop is backend-blind, and the per-turn
  body it drives is the same `createSession` call site regardless of `ModelSelection.provider`. The Claude SDK
  path stays resume-per-turn (not yet a persistent bidirectional stream) until that separate conversion lands.

## Consequences (good / bad)

**Good**
- A conversation that takes exactly one turn is byte-identical to the pre-D149 single-turn path (D85) — the
  live-session core is additive machinery, not a rewrite.
- Multi-turn, reconnect (G4), and same-turn interrupt/steer are now real for BOTH backends without waiting on
  SDK streaming-input mode.
- A second connection (or a console reload) can always ask the daemon "what is this session doing right now"
  and get a true answer — no client-side liveness bookkeeping to keep in sync or get wrong.

**Bad**
- A second send against an already-live session no longer blocks the RPC reply on that turn's completion (it
  returns once the send is queued, not once it runs) — call sites and tests that assumed synchronous-ish
  completion of a second send must explicitly wait for it (e.g. via `subscribeSession`'s hydration or a
  settled push), rather than assuming the RPC response implies the turn has finished.
- The Claude SDK adapter is still resume-per-turn under this facade, not truly bidirectional-streaming — a
  known, tracked gap (see ROADMAP.md's M8 row), not a regression this ADR introduces.
- The daemon-singleton registry (constructed once per daemon process, with idle-timeout eviction, threaded
  through `apps/cli`'s composition, and torn down via `closeAll()` on shutdown) landed at the same time as this
  ADR — see ROADMAP.md item I for what remains around it (interactive multi-turn, the worktree manager,
  subagents, DACL/peer-cred hardening). Idle-eviction is running-aware (it re-arms rather than evicting a
  session still mid-turn) and its single teardown path (`registry.close`) is where the M1 checkpoint + worktree
  release now happen — on eviction, the `closeSession` verb, or shutdown alike.

---

_Last reviewed: 2026-07-08_
