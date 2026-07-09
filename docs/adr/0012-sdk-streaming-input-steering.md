# 0012. Hold the Claude SDK query open for streaming-input steering

- Status: accepted
- Date: 2026-07-08

## Context and problem

ADR 0011 made the daemon the authoritative owner of a live session across turns, but drove every turn — for
both backends — through the same per-turn `createSession`: a fresh backend loop each send, continuity carried
only by the R-7 store (resume-per-turn for Claude, replayed `history` for the pure-API backends). ADR 0011
option 3 explicitly deferred converting the Claude Agent SDK to its bidirectional **streaming-input** mode,
because that cascades into three separable pieces: capturing streamed user turns in the canonical transcript
(landed as `tapStreamedUserTurns`), delivering prior memory as a first-turn preamble under streaming (landed as
`withHistoryPreambleStreaming`), and — this ADR — actually holding ONE SDK `query()` open across a session's
turns so a steer reaches the model mid-conversation.

The problem this closes: with resume-per-turn, a steer issued while the Claude backend is mid-turn has nowhere
to go — there is no live query to feed it. Real mid-turn SDK steering requires one long-lived query fed the
session's successive user turns as an async iterable. The constraint is that M8 must gain this WITHOUT the
composition branching on which backend is active (ADR 0002/0004), and without regressing the one-turn path
(D85), the block-preserving transcript flush (A1), or the two-blocks-only rule (SC-1, ADR 0009).

**What the live smoke (Task 4) established about the SDK's ceiling.** A message pushed into the open iterable
while a turn is running is **queued** and runs as the NEXT turn at the current turn's boundary — the Claude
Agent SDK exposes **no primitive to inject into a running turn** (verified live; a pending upstream feature,
issue #50246, not coa's to build). So this ADR delivers held-open multi-turn continuity + **queued** steering
(a warm follow-up with no resume replay); true mid-turn *redirect* (barge-in, `interrupt()`+push, which
discards in-flight work) is a separate capability tracked as a follow-up. The earlier framing of this ADR — "a
steer reaches an in-flight turn" — was the design hypothesis the live gate corrected.

## Decision drivers

- **Held-open cross-turn continuity + a steer seam.** The Claude backend needs ONE query that stays alive across
  turns (a warm session, no resume replay) and reads the session's successive user turns — including a pushed
  steer — as a stream. (A pushed steer is *queued* to the next turn boundary; the SDK has no mid-turn inject, so
  true redirect is the barge-in follow-up.)
- **Neutral seam (ADR 0002/0004).** No backend type crosses M8, and composition must never write
  `if (provider === 'claude')`. Which strategy a session uses is an ABSTRACT verdict the composition root
  supplies; core consumes only the verdict.
- **D85 strict-superset (ADR 0008).** A one-turn SDK conversation stays observably identical to today; the
  string-input path is untouched; `coa raw` is sacred.
- **A1 block-preserving flush.** The held-open query changes only WHEN the canonical transcript is flushed (now
  at each turn boundary), never WHAT it preserves — a mid-turn crash still leaves `messages.json`
  round-trip-consistent (the `dropTrailingDanglingToolCall` trim).
- **SC-1 (ADR 0009).** Steer and interrupt stay user actions, never a block or an error. The only two blocks
  remain the M3 close-gate and the M7 cost-cap.
- **Keep the two-store persistence model.** ADR 0010 (converge onto a single append-only log) stays deferred and
  out of scope; this decision keeps `turns.ndjson` (append) + `messages.json` (whole-array rewrite at each turn
  boundary) exactly as they are.

## Considered options

1. **Two live-session strategies selected by an injected, abstract verdict — `held-open` for the SDK,
   `per-turn` for the pure-API backends** (chosen). M8's dispatcher reads
   `deps.sessionStrategy(provider) → 'held-open' | 'per-turn'` and drives the turn accordingly; the
   provider→strategy map lives beside the provider→backend `createAdapter` map in the composition root
   (`apps/cli/src/adapter-factory.ts`), so the two are a single source of truth and core never sees a provider
   literal. The held-open path keeps ONE `createSession` open, feeding it a derived `InputChannel`
   (`AsyncIterable<string>`) into which each turn AND each steer is pushed.
2. **Branch the M8 facade on backend directly.** Rejected — a naked `if (provider === 'claude')` in composition
   is exactly what ADR 0004 forbids; it also duplicates the provider knowledge the adapter factory already owns.
3. **Make streaming-input the ONE path for every backend.** Rejected — the pure-API backends have their own,
   already-shipped per-turn driver (`runGovernedLoop` + `drainSteer`); forcing them onto a held-open query buys
   nothing and risks their working steering. Strategy stays per-backend.

## Decision

M8 drives a live session by an **abstract strategy verdict**, never by the backend:

- **The seam.** `SessionDeps.sessionStrategy(provider) → SessionStrategy` (`'held-open' | 'per-turn'`), injected
  from the composition root next to `createAdapter` (see the `// see docs/adr/0012` marker there). Absent, or
  `per-turn`, is today's per-turn drive — byte-identical (D85). Only a backend the root maps to `held-open` (the
  Claude SDK) gets the streaming-input drive.
- **Held-open drive.** For a `held-open` turn, M8 runs the full per-turn persistence prelude once to ESTABLISH
  the query — a single `createSession` whose `input` is a derived `InputChannel`, NOT awaited to completion (it
  spans every later turn) — then pushes the turn's text and awaits THAT turn's boundary. A later turn with the
  same prompt-shaping config + model is a LIGHT continue: append the user turn (the shared `seq` continues),
  push the text, await the boundary. No new `createSession`.
- **The turn boundary** is observed from the SDK's own `turn-boundary` frame (emitted from each terminal
  `result`), not from cost settlement — sequencing is decoupled from charging.
- **Steering (queued).** A steer on a held-open session is another streamed user turn pushed into the SAME
  derived `InputChannel` (via `LiveSession.pushSteer`). The live smoke (Task 4) confirmed the SDK **queues** it —
  it runs as the next turn at the current turn's boundary, NOT injected into the running turn (no mid-turn inject
  primitive exists; issue #50246 is the pending upstream feature). It still lands in canonical memory via
  `tapStreamedUserTurns`. A steer on a per-turn session queues on `control.steer` for `drainSteer` — which,
  because coa owns that loop, DOES inject at the driver's next safe boundary (the pure-API path is actually ahead
  of the SDK here). An empty steer is dropped (it would otherwise write a blank user turn into canonical memory).
  True mid-turn *redirect* on the SDK path (`interrupt()`+push, discarding in-flight work) is a separate barge-in
  capability, deferred to its own decision.
- **Per-turn-boundary persistence.** The adapter flushes the canonical transcript (`onBackendMessages`, trimmed)
  and settles cost at EACH `result`, not only in `finally`. A crash therefore loses only the in-flight turn —
  the same durability the one-shot path has. The `finally` flush remains the A1 net for a pre-`result` exit and
  is skipped when a terminal `result` already flushed (so a clean run flushes exactly once — D85).
- **Termination contract.** Closing the coa-owned input iterable ⇒ the query ends after the last turn's
  `result`. `LiveSession.close()` runs a finalizer that closes the held query's `InputChannel`; the SDK query
  then drains its final result and returns. Each held-open query owns its derived iterable (created at
  establishment); the LiveSession's long-lived turn channel is separate and is not what closes.
- **Config-change safety.** The light continue-path is valid ONLY while the open query still matches THIS turn's
  prompt-shaping config + model (role/roles/packages/scope + provider/model/reasoning). A divergence (a
  mid-conversation model or role switch, reachable from the console selector) RE-ESTABLISHES: the current
  iterable closes (that query terminates), and the turn runs through the establishment path with the new config
  — never silently on the prior query's pinned prompt/model.
- **Interrupt.** `interruptSession` aborts the held query's neutral signal; the query throws, and M8's held
  settlement suppresses it as a user stop (SC-1) exactly as the per-turn path does — never an error. A settled
  query (interrupt OR a mid-turn error) is marked terminated: its input feed has no consumer, so the NEXT turn
  RE-ESTABLISHES a fresh query (the same close-and-reopen path as a config change) rather than continuing the
  dead one — the interrupt leaves the session usable, not hung. (A future barge-in steer would instead use the
  SDK's turn-level `query.interrupt()` — which stops the current turn but keeps the query ALIVE — to redirect
  without this whole-query abort + re-establishment; see the follow-up below.)

## Consequences (good / bad)

**Good**
- The Claude backend is now genuinely long-lived: ONE warm query spans a session's turns (verified live —
  cross-turn memory on the same server session, no resume replay), closing ADR 0011's deferred option 3 for the
  streaming-input half. Steering on this path is queued-follow-up (the SDK's ceiling); the real win is a warm
  continuous conversation, with barge-in redirect as a tracked follow-up.
- Composition still never branches on backend — the one place that knows "Claude ⇒ held-open" is the adapter
  factory, co-located with the backend map it already owns.
- One-turn SDK conversations, the string-input path, and `coa raw` are unchanged (D85); the A1 flush preserves
  the same trimmed transcript, now at each turn boundary.

**Bad**
- The held-open query pins its prompt + model at establishment, so a mid-conversation config change costs a
  re-establishment (close + reopen) rather than being free — the safe behavior, but not zero-cost.
- Real SDK termination + the queued-steer semantics are proven against the live `@anthropic-ai/claude-agent-sdk`
  `query()` (Task 4, `streaming-smoke.live.test.ts`, gated behind `COA_LIVE`, skipped by default): closing the
  iterable drains queued turns then ends gracefully, and a pushed message queues to the next turn boundary. The
  gate also established the SDK's steering ceiling (no mid-turn inject), which reframed "steering" here from
  mid-turn redirect to queued follow-up.
- The two-store persistence model (ADR 0010 deferred) is retained; the per-turn-boundary flush is a
  whole-array rewrite of `messages.json` per turn, accepted until 0010 lands.

## Follow-up: mid-turn redirect (barge-in) — DELIVERED (2026-07-09)

True mid-turn steering — redirect the agent *while it works* — was out of scope in the decision above because a
pushed message cannot inject into a running turn. It is now delivered on top of this ADR, within its scope (no
new decision was needed; the live gate confirmed the design):

- A **neutral queue-vs-barge-in steer seam** for EVERY backend. `steerSession` carries `mode`
  (`queue | barge-in`, default `queue`), realized per strategy — M8 never branches on the backend. Held-open
  (Claude): `queue` = push into the input feed; `barge-in` = the SDK's turn-level `query.interrupt()` (stops the
  current turn, keeps the query ALIVE) + a framed push. Pure-API: `barge-in` = the existing `drainSteer` inject at
  the loop's next round-trip boundary; `queue` = a new `drainQueuedSteer` inject at the point the close-gate would
  end the turn (run after the current turn's work).
- Claude barge-in wraps the injected turn with framing (`[The user interrupted to steer you] <message>`) so the
  model reads a deliberate redirect, not a bare interruption. Pure-API does not frame — it injects at a clean
  boundary with no bare-interrupt signal to counteract.
- In-flight generation is discarded on a Claude barge-in (partial output still preserved by the A1 flush) — the
  Cline/Goose pattern. Pure-API completes the in-flight round-trip (its earliest safe point), so nothing is wasted.
- **The I3 limitation is fixed:** the single-slot `query.boundary` latch became a **`pendingTurns` count** —
  incremented on every push into the feed that yields a boundary (the initial turn, a continue turn, AND any
  steer — queue OR barge-in — pushed while a turn is running) and decremented on each `turn-boundary` frame; the
  driver's latch resolves only at 0, so an injected steer turn resolves the correct awaited turn rather than a
  later turn's latch resolving early.
- **SC-1:** interrupting a running turn surfaces a NON-success result; M8 suppresses its `error` frame (a bounded
  `barging` counter, cleared when the redirect completes so it can never swallow a later unrelated error) so a
  barge-in never renders as an error.
- **Live-verified** (`packages/adapter-claude-sdk/src/barge-in-smoke.live.test.ts`, `COA_LIVE`-gated): interrupting
  a genuinely-running turn emits the turn's partial `text` blocks (A1-preserved), then a terminal result of subtype
  `error_during_execution` carrying BOTH an `error` frame and its own `turn-boundary`, after which the framed steer
  runs as the next turn on the still-open query. This makes the `pendingTurns` accounting exact (the interrupted
  turn emits its boundary, so no hang) and confirms the `barging` suppression is necessary and sufficient.

---

_Last reviewed: 2026-07-09_
