# Long-lived session + interactive multi-turn — Design

> **Status:** approved design, pre-plan. This is the foundational pillar pulled forward from the
> agent-hardening arc (`2026-07-06-coa-agent-hardening-design.md`): the maintainer chose to build the
> industry-standard long-lived session model **before** the remaining agent-hardening plans, because it is the
> substrate three of those workstreams sit on. Authority for product behavior stays with
> [SPEC.md](../../design/handoff/SPEC.md) (M8/M9) and the ADRs; this doc is the build-facing design.
>
> **Verify every seam against current code before acting** — this arc has hit multiple stale-report failures.

---

## 1. North-star

The industry-standard interactive-agent architecture: a **long-lived, bidirectional-streaming session** the
daemon owns and holds open across turns, the way Claude Code, Codex CLI (our prior-art reference), and every
serious harness work. Today coa is **per-send**: each message is its own `createSession` that runs the loop to
completion, emits `done`, and vanishes; the next message starts a fresh session that "remembers" via the resume
token + a replayed transcript. That per-send model is what blocked SDK-path steering and what makes
session-independence and streaming output bolt-ons instead of natural consequences.

The long-lived model is a **strict superset** (D85): a conversation that only ever takes one turn behaves as it
does today. It adds no user-facing loss; it adds multitasking and makes the following fall out of one coherent
foundation instead of three independent efforts:

- **SDK-path steering** — native (push another user turn into the live input stream).
- **G4 session independence** — the daemon owning a live session *is* session independence; "reload shows idle
  mid-run" cannot exist.
- **G7 streaming output** — token deltas over the same live output stream.

## 2. The industry-standard model (target shape)

1. **One live session per conversation, held open across turns** — daemon-owned, not request/response per
   message. Runs regardless of whether a viewer is attached (the headless-agent precondition for Phase 3).
2. **Two streams over that session.** *Input* (user → agent): an open channel; the first turn and every later
   turn — including a steer typed mid-work — go into the same channel. *Output* (agent → user): incremental
   events (tool calls/results, thinking, turn boundaries, status; token deltas arrive in P-γ).
3. **Turn lifecycle inside the persistent session:** each user turn drives an agent turn ending in a
   result/boundary; the session then idles awaiting the next input. No teardown/rebuild between turns, so the
   transcript/memory is **authoritative in memory** — disk (R-7) becomes a restart/audit mirror, not a
   per-turn replay source.
4. **Control ops** (only available in streaming mode): interrupt, steer, permission-mode change.
5. **Stateless viewers:** the daemon owns liveness; UIs attach, hydrate current state (run-status + transcript),
   and stream live events. Reconnect re-hydrates; multiple viewers can attach.

## 3. Scope — decomposition

The pillar is too large for one plan. It is decomposed into a sub-project sequence targeting the end-state,
each its own spec-detail → plan → build unit (the arc's cadence). **This document fully specifies P-α**; β/γ/δ
are sketched here and get their own plans as reached.

- **P-α — Long-lived session core + interactive multi-turn** (this plan). The daemon-owned live-session
  abstraction, the input channel + output fan-out decoupled from connections, the pure-API long-lived loop, and
  the SDK behind the facade via resume-per-turn. Delivers real multi-turn + inherently most of **G4**.
- **P-β — SDK streaming-input steering.** Convert the Claude backend to a held-open streaming-input query so a
  steer reaches a running Claude turn; includes streamed-turn transcript capture and the preamble-under-streaming
  seam. Delivers the SDK-path steering deferred from the agent-hardening arc. Carries a real-SDK
  streaming-termination assumption → requires a **live smoke test**.
- **P-γ — Streaming output (G7).** Token deltas over the live output stream, both backend families
  (`includePartialMessages` on the SDK; SSE on the pure-API backends). Models the delta as a distinct
  `TurnFrame` kind.
- **P-δ — Session-independence/reattach polish (G4 remainder).** Whatever of G4 does not already fall out of
  P-α (e.g. multi-viewer edge cases). Expected to be small.

This pillar **supersedes the standalone Plan C (G4)** from the agent-hardening design (G4 is absorbed into α+δ)
and **retires the SDK-steering deferral** (it becomes β). The other agent-hardening plans (B capabilities/roles,
D packaging/skills) are unaffected and sequence after this pillar.

### Out (scope discipline)

- **Same-file concurrent-edit coordination.** Two live agents editing the *same files in the same repo at the
  same time* need the worktree/merge manager (ROADMAP item I) — still deferred. Multitasking across different
  conversations/files/repos is isolated by the per-session git worktree and works immediately; only same-file
  coordination waits for item I. Choosing the multi-live model does not create this gap (serializing would only
  hide it); P-α exposes real parallelism and leaves same-file coordination to item I.
- **Multi-pane console UX** for several live sessions at once. The daemon supports many concurrent live sessions;
  the console stays **one-active-conversation-at-a-time** for v1 UX. The multi-session data model is built now so
  a later console pass needs no daemon rework.
- **Streaming token output** (P-γ) and **SDK mid-turn steering** (P-β) — later sub-projects; P-α's Claude backend
  gets multi-turn + reattach + interrupt but not mid-turn steering.
- **Auto-resume of live sessions at daemon start.** Live sessions rebuild lazily on the next send, not eagerly on
  boot.

## 4. Binding principles

- **Session independence (SPEC / G4).** The daemon is the authoritative owner of session lifecycle *and*
  liveness. A viewer is a stateless, reattachable subscriber that hydrates full current state (including
  run-status) on connect; it never reconstructs liveness from its own in-flight tracking. A live session runs
  with no viewer attached.
- **D85 strict-superset.** A conversation that takes exactly one turn behaves byte-identically to today; the
  live-session machinery is the superset. `coa raw` stays sacred (ADR 0008).
- **SC-1 preserved.** No new block class. The only two blocks stay M3 close-gate + M7 cost-cap through M9's deny
  channel (ADR 0009). Interrupt/steer remain user actions, never blocks.
- **P1 determinism.** No model call on any critical path; session routing/lifecycle is deterministic control
  flow.
- **Neutral seam (ADR 0002/0004).** No backend type crosses M8's seam. The live-session facade is backend-neutral;
  each backend implements "consume the input channel, produce the output stream over the conversation's life" its
  own way. Composition never branches on backend.
- **Block-preserving (A1, do not regress).** Every turn still flushes the canonical transcript block-consistently
  on each exit path (the A1 `try/finally` trimmed to the last round-trip-consistent boundary). The long-lived
  wrapper runs the same per-turn loop; it does not change the flush.
- **The change-event spine (M1) is the only shared mutable substrate.** Concurrent sessions' events interleave on
  the spine, each session-tagged; producers/consumers point only at M1.

## 5. P-α design

### 5.1 The `LiveSession` registry (the core change)

Today `buildSessionHandlers(deps, connection, store?)` binds a session's pushes to the **one originating
connection**, and the session runs to completion then disappears. P-α introduces a daemon singleton
`LiveSessionRegistry` keyed by `conversationId`, decoupling liveness from RPC connections.

Each `LiveSession` owns, in memory:
- the **input channel** — an async turn queue (the same channel shape A2's steer buffer feeds);
- **run-state** — `idle | running` (plus `interrupted` transient), the authoritative source the console's run
  pill reflects;
- an **output fan-out** — a set of subscriber sinks; every frame/status/cost push is delivered to *all* current
  sinks;
- running **cost**, the bound **worktree**, the **conversation id**, and a handle to the **backend execution**.

Connections become subscribers. A `subscribe(conversationId, sink)` call registers a sink and immediately
**re-emits current state** — run-status + the R-7 transcript tail — so a fresh/reconnecting viewer hydrates. An
`unsubscribe` drops the sink; a session with zero sinks keeps running (headless).

### 5.2 Backends behind one facade

- **Pure-API — genuinely long-lived.** A `runLiveSession` wrapper: `await` the next turn from the input channel,
  run the existing tested per-turn `runGovernedLoop` for that turn (reused unchanged — it already owns the two
  SC-1 blocks, `canUseTool`, the close-gate, and the A1 block-preserving flush), fan out its frames, mark
  `idle`, loop. The transcript accumulates in memory across turns and is mirrored to R-7 per turn. A2's `signal`
  (interrupt) and `drainSteer` (steer) now operate on the live session.
- **SDK (during α) — resume-per-turn behind the facade.** Each turn runs today's proven resume-`createSession`
  path (the server session holds memory; the frozen prompt keeps cache warm), but *driven by the facade* — the
  `LiveSession` holds run-state and fans out, the SDK turn is the execution for one turn. No change to the SDK
  adapter's internal loop in α. Result: the Claude backend gets real multi-turn + reattach + interrupt now;
  mid-turn steering waits for P-β (the streaming conversion). This keeps α free of any real-SDK
  streaming-termination assumption.

The facade exposes one neutral operation per turn — "run this turn's execution, emitting frames" — that both
strategies implement, so composition never branches on backend (only the injected factory knows the backend).

### 5.3 Multi-turn, send, and reattach (G4)

- **`send(conversationId, turn)`** — look up the live session; if none exists, create one (bind worktree,
  compile/freeze prompt, wire the SC-1 predicates) and start its live loop with this turn; if it exists and is
  idle, enqueue the turn (the loop picks it up); if it exists and is running, the turn is **queued as the next
  turn** (processed when the current turn ends). Mid-turn redirection stays the explicit `steerSession` verb
  (pure-API in α), not an implicit consequence of `send`.
- **Reattach** — the console re-subscribes on connect; the daemon re-emits run-status + transcript tail, so the
  run pill reads correctly after a renderer reload. This is G4's proof: reload mid-run ⇒ the session still reads
  `running`. `state.ui.runStatus` in the console becomes a cache seeded by the daemon snapshot, never the source
  of truth.

### 5.4 Lifecycle, concurrency, and errors

- **Multiple live sessions concurrently**, keyed by conversation id, all daemon-owned.
- **Idle-timeout** auto-closes a live session after a configurable quiet interval (default TBD in the plan, e.g.
  a few minutes); plus an explicit `closeSession` and close-all on daemon shutdown — no subprocess/stream leak.
- **Cost-cap (M7) under concurrency.** The cap/charge/`capState` are a daemon singleton; Node's single thread
  serializes them, so concurrent sessions charge the one cap without torn reads. Each session's spend is
  session-tagged in the ledger (already the case). The cap remains the single hard M7 block.
- **Crash/restart.** Completed turns persist (the A1 flush + R-7 store). Live sessions are **not** auto-resumed
  at boot; they rebuild lazily on the next send via resume/replay (the current mechanism). A turn genuinely
  in-flight at a crash is lost — the same exposure as today, per session.
- **Block-preserving / SC-1 / D85** unchanged per turn (§4).

## 6. Verification

- **P-α** — TDD against the registry + fan-out + the pure-API long-lived loop:
  - registry: create/lookup/close/idle-timeout; a closed session is removed and its backend torn down.
  - fan-out: multiple sinks each receive every push; **re-emit-on-subscribe** delivers run-status + transcript
    tail to a late subscriber (the G4 hydration unit).
  - pure-API long-lived loop: two turns over one live session share memory; an interrupt/steer mid-live turn
    behaves as A2 proved, and the session returns to `idle` (not `done`/torn-down) after a turn.
  - concurrency: two live sessions do not cross-talk (frames/cost/status stay session-scoped).
  - **G4 integration proof:** reload the renderer mid-run ⇒ the session still reads `running` after
    re-subscribe. Drive the real flow end-to-end with the `verify` skill.
- **Same-commit doc rule** — each unit updates ROADMAP status + the owning SPEC M8 module (+ M9/REPO_LAYOUT if
  files move); a new durable decision gets an ADR. Candidate ADRs: the **daemon-authoritative live-session /
  stateless-viewer contract** (the G4 durable contract, previously flagged for an ADR in the agent-hardening
  design). Keep `pnpm docs:check` green.

## 7. Open questions for the plan

- **Idle-timeout default** and whether it is configurable per session vs daemon-global (a plan-time constant +
  config seam).
- **`send`-while-running semantics** — confirm "queue as next turn" vs "reject with a hint"; the design picks
  queue-as-next-turn (steering stays explicit).
- **Registry ↔ existing `buildSessionHandlers`** — how much of the current per-connection handler is refactored
  vs wrapped: pin the minimal seam against current code (the handler's `live` map, the `record`/`status`
  emitters, the A2 control map all move behind the registry).
- **The `LiveSession` ↔ conversation-store (R-7) boundary** — the in-memory transcript is authoritative during a
  live session; confirm the write-through cadence to R-7 stays per-frame (as today) so a crash loses only the
  in-flight turn.
- **ADR scope** — one ADR for the daemon-authoritative/stateless-viewer contract; confirm whether the multi-live
  concurrency model warrants its own ADR or is captured in the SPEC M8 module.

---

_Last reviewed: 2026-07-07_
