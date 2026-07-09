# Append-only single source of truth (ADR 0010 execution)

- Date: 2026-07-09
- Status: design approved (maintainer), ready for implementation plan
- Basis: `docs/adr/0010-append-only-conversation-log.md` (accepted, execution-deferred), the P-β section of
  `.superpowers/sdd/progress.md`, and `docs/design/research/2026-07-09-append-only-persistence-oss.md`
  (OSS mechanics survey — OpenHands v1, opencode, Codex `codex-rs`)
- Baseline commit: `682bd6c` (piece C / barge-in complete)

## Problem

A session's conversation persists in **two** stores (`conversation-store.ts`), built from **two different
adapter outputs**:

- `turns.ndjson` ← the `onTurn` **frame** stream: append-only, but **lossy** (a `tool_result` frame carries a
  short `pointer`, not the full output the model saw). The UI view.
- `messages.json` ← the adapter's `onBackendMessages` **full-content** `BackendMessage[]`, whole-array-rewritten
  each turn. The memory source of truth; the adapter builds it from its native stream and owns tool-call pairing.

Because the two are written from different sources on different schedules, they diverge on any non-clean path
(the ADR 0010 bug class; the P-β **M2 finding**: a held-open steer reaches `messages.json` but not
`turns.ndjson`). Transcript integrity is currently a **flush-on-exit discipline** — every early-return /
interrupt / error path must remember to flush a round-trip-consistent prefix. ADR 0010 records the decision to
make it **structural** instead.

## Goal

Converge onto **ONE append-only event log** as the sole source of truth, deriving BOTH the lossy UI view AND the
provider-shaped transcript as **read-time projections**. This kills the divergence class structurally (the log
only grows and is replayed, never rewritten).

## What the OSS survey established (and changed)

`docs/design/research/2026-07-09-append-only-persistence-oss.md` read OpenHands v1, opencode, and Codex `codex-rs`
at source level. Convergent practice, and its effect on this design:

1. **Fold to the provider transcript at READ time, fresh per call; never persist the provider array**
   (`events_to_messages` / `toModelMessagesEffect` / `for_prompt`). → Validates the core plan. `messages.json` is
   **deleted**, not relocated — computing it on read is the whole point (a materialized cache reintroduces the
   two-store problem).
2. **Unpaired tool calls are REPAIRED, not dropped.** All three synthesize a paired synthetic tool-result at fold
   time (Codex `ensure_call_outputs_present` → a synthetic "aborted" output; opencode inlines
   `"[Tool execution was interrupted]"`; OpenHands a synthetic error observation). Drop appears only as a rare
   logged fallback. → **The plan's `dropTrailingDanglingToolCall` becomes `repairUnpairedToolCalls`.**
3. **Repair keys off `call_id` SET MEMBERSHIP, not list position** — a parallel tool-call batch can strand a
   non-last call, so "trailing" is too narrow.
4. **Projections are computed on demand** (at most an in-memory incremental cache), never a second durable store.
   → `loadBackendMessages` computes; no cache in v1 (YAGNI).
5. **Streaming token-deltas never enter the durable log** (opencode filed regression #11329 from persisting
   deltas). → The log stores settled frames only. Directly constrains piece B (streaming) next; for E it
   confirms we persist the settled frames we already emit.

## Non-goals

- Migration / back-compat for existing on-disk sessions. **Fresh start** (maintainer decision): the local
  conversation store is disposable gitignored scratch; old-format sessions are simply not read by the new path.
  No legacy read-compat, no in-place migration.
- Incremental token streaming (piece B) — separate; this piece only makes its substrate correct.
- An in-memory projection cache — deferred (compute on demand; add a cache only if a real perf need appears).

## Invariants that must not regress

- **D85 strict-superset.** A clean one-turn conversation's folded transcript is byte-identical to today's
  `messages.json` for that turn; the console UI view (`reload`) is unchanged; `coa raw` untouched.
- **SC-1.** No new block/error path; steer/interrupt stay user actions.
- **Neutral seam (ADR 0002/0004).** The fold is backend-neutral (over M0 frames); no backend type crosses M8.
  Each adapter emits the same enriched frame stream; composition never branches on backend.
- **Memory correctness.** The folded transcript must contain every user/steer turn verbatim and every
  assistant/tool round-trip, with valid tool_use↔tool_result pairing for cross-provider replay (an
  OpenAI-compatible endpoint 400s on an assistant `tool_calls` turn with an unmatched call — which the repair now
  prevents by synthesis rather than truncation).

## Design

### 1. The one log — `events.ndjson`

A new append-only `events.ndjson` per session, one JSON line per **event**:

```ts
interface PersistedEvent {
  seq: number;          // the monotonic seq M8 already assigns
  frame: TurnFrame;     // the existing, UNCHANGED M0 wire frame (lossy: tool_result carries `pointer`)
  full?: string;        // the tool_result's FULL body — the only thing the UI frame drops. Present only on
                        // a tool_result frame (absent everywhere else).
}
```

`full` is a **persistence-only** field on the log line — it is NOT added to the M0 wire `TurnFrame` schema, so
the R-12 push stays lean (D57: the byte-faithful body stays in the daemon, never streamed). Old sessions lack
`events.ndjson`, so the new load path reads them as empty (fresh start). `turns.ndjson` and `messages.json` are
no longer written or read.

### 2. Two read-time projections (the ONLY readers)

- **UI view** — `reload(id, toSeq?) → PersistedTurn[]` (`{seq, frame}`), the log's `frame` stream with `full`
  dropped. Byte-identical to what the console reads today; the console is unchanged.
- **Transcript** — `loadBackendMessages(id) → BackendMessage[]`, a **fold** of the log:

  `foldEventsToTranscript(events): BackendMessage[]` (pure, in a new `transcript-projection.ts`):
  - `text` with `role:'user'` → `{ role:'user', content: text }`.
  - `text` without role (assistant) → opens/extends the current assistant message's `content`.
  - `tool_use {tool,input,handle}` → appends `{ id: handle, name: tool, arguments: input }` to the current
    assistant message's `toolCalls` (creating an assistant message with `content:''` if none is open).
  - `tool_result {handle}` + `full` (fallback `pointer`) → `{ role:'tool', toolCallId: handle, content: full }`,
    and closes the current assistant message (the next assistant `text`/`tool_use` starts a new one).
  - `thinking` / `error` / `reconcile` / `permission` / `subagent` → **dropped** (not part of the provider
    transcript — matches today's `messages.json`, which omits them).
  - `turn-boundary` → a message delimiter (closes any open assistant message).
  - **`repairUnpairedToolCalls`** (applied as the final step): for EVERY `toolCall.id` across all assistant
    messages that has no matching `tool` message, synthesize `{ role:'tool', toolCallId: id, content:
    '[Tool execution was interrupted]' }` inserted immediately after its assistant message. Keyed by `id` set
    membership (not position), so a stranded non-last call in a parallel batch is repaired too. This replaces
    the write-time `dropTrailingDanglingToolCall` — the assistant turn survives and the transcript stays valid.
  - System is omitted (the driver/adapter prepends the system prompt at runLoop time, as today).

  Computed fresh each call (no materialization). `memory-plan`/`prompt-freeze`/resume-replay consume the same
  `BackendMessage[]` shape, now projected.

### 3. The adapter seam — one enriched stream (the real work)

Each adapter stops being a **second** writer. `onBackendMessages` / `SessionAdapterInit.onBackendMessages` /
`createSession`'s `onBackendMessages` / the store's `saveBackendMessages` are **retired**. Instead:

- `onTurn` gains the full body: `onTurn?: (frame: TurnFrame, full?: string) => void`. The adapter passes the
  complete tool-result body as `full` on each `tool_result` frame (all other frames pass no `full`). This is the
  ONLY M9-seam change; it is additive (existing `(frame) => …` callers still satisfy it structurally).
- **Claude adapter:** delete the `transcript` accumulation, the per-`result`/`finally`
  `onBackendMessages(dropTrailingDanglingToolCall(...))` flushes, `tapStreamedUserTurns`, and
  `messageToBackendMessages` usage for persistence. Emit `tool_result` frames with `full` = the full mapped SDK
  tool-result body (today's `pointerOf` gives the lossy pointer; `full` carries the complete content). Everything
  else in `runLoop` (streaming, interrupt, onSettle, onBackendSession) is unchanged.
- **Pure-API driver (`loop-driver`):** delete the `onMessages` flush + the `lastConsistent` trim (repair moves to
  read-time). Keep the in-memory `messages` array (still needed to resend history within a turn's round-trips).
  Emit `tool_result` frames with `full` = the (capped) `display` it already computes. **Also emit a
  `{ t:'text', role:'user' }` frame for each injected steer** (`drainSteer`/`drainQueuedSteer`) so the steer
  lands in the single log — this closes the pure-API analog of the M2 divergence (today a steer reaches the
  in-memory `messages` but no frame). The `deepseek`/`longcat` adapters map `onBackendMessages` away and forward
  the enriched `onTurn`.
- **Within-turn governance injections stay ephemeral.** The close-gate reason the driver pushes as an in-memory
  user message is NOT framed (not persisted): it is within-turn scaffolding the model re-derives, and carrying a
  stale "you can't stop yet" nudge into the next turn is noise. (A **denied tool** already emits a `tool_result`
  frame, so denials persist correctly.) This is a deliberate, minor change from today's incidental persistence of
  the gate reason in `messages.json`; the integration test asserts cross-turn memory stays coherent.

### 4. Wiring in M8 (`session-handlers.ts`)

`record(frame, full?)` appends `{ seq, frame, full }` to `events.ndjson` (via `store.append`) and pushes the
lossy `frame` over the wire (`session.emit`, `full` never attached). The user-turn append in
`prepareTurnPersistence` writes a `{t:'text', role:'user'}` event as today. The persistence prelude no longer
reads/writes `messages.json`; `loadBackendMessages` (the fold) supplies `history`/resume-replay. Delete the
`onBackendMessages` hooks from `buildPersistenceHooks` and both drive paths (`runPerTurn`,
`establishHeldQuery`/`continueHeldQuery`). The A1 "flush a consistent prefix" discipline is **deleted** — the log
only grows; the fold's `repairUnpairedToolCalls` handles a mid-turn crash structurally.

### 5. What falls out for free

- **The P-β M2 finding vanishes** — a held-open steer is appended once to the log; both projections see it.
- **A1 becomes structural** — no per-exit-path flush; a mid-turn crash leaves the log with its appended events,
  and the read-time repair yields a valid transcript.
- The `ConversationStore` public interface shrinks (`saveBackendMessages` gone; `loadBackendMessages`/`reload`
  now projections) but its consumers see the same shapes.

## Risks

- **Fold fidelity across backends** — the folded transcript must equal what `messageToBackendMessages` /the driver
  produced. Pure-API is lossless by construction (`full` = `display` = the tool message content it already
  pushed). Claude requires `full` to carry the complete tool-result body faithfully. **Verified by a `COA_LIVE`
  re-run** (§ tasks): a held-open multi-turn + a mid-turn barge-in must yield a correct folded transcript
  (valid pairing, the interrupted call repaired).
- **Multi-tool-call / interleaved turns** — the fold's assistant-message grouping must handle an assistant turn
  with several `tool_use` frames before their `tool_result`s. Unit-tested with both backends' real frame
  orderings.

## Task shape (for the implementation plan)

1. **The fold** — `foldEventsToTranscript` + `repairUnpairedToolCalls` (pure; unit-tested against captured
   pure-API and Claude frame sequences, incl. a parallel-batch strand and an interrupted trailing call).
2. **Store** — `events.ndjson` append of `PersistedEvent`; `loadBackendMessages` = fold; `reload` = frame
   projection; retire `saveBackendMessages`; drop the legacy files from the read path.
3. **M9 seam** — `onTurn(frame, full?)`; retire `onBackendMessages` across `SessionAdapterInit`/`createSession`;
   Claude adapter emits `full` + drops its transcript accumulation; deepseek/longcat map the seam.
4. **Pure-API driver** — drop `onMessages`/`lastConsistent`; emit `full` on `tool_result`; emit a user frame per
   injected steer; keep the in-memory round-trip array.
5. **M8 wiring** — `record(frame, full)` → single append + lossy push; delete `onBackendMessages` from
   `buildPersistenceHooks` + both drive paths; `history`/resume via the fold.
6. **`COA_LIVE` re-verify** — held-open multi-turn + a mid-turn barge-in produce a correct folded transcript
   (extends the barge-in smoke or a sibling; gated, skipped by default).
7. **Docs same-commit** — ADR 0010 → accepted + **executed** (record the repair-not-drop refinement + the
   research citation); `docs/design/handoff/spec/M8.md` (the store is one append-only log; projections) +
   `M9.md` (the adapter emits one enriched stream; `onBackendMessages` retired); ROADMAP.

## Verification per unit

- `pnpm --filter <pkg> typecheck` (NOT just eslint+vitest — `exactOptionalPropertyTypes`).
- The fold is a pure function — exhaustively unit-tested (both backends' frame shapes, repair by set membership,
  system-omitted, thinking/error dropped).
- The `COA_LIVE` re-verify is the authority that the real Claude frame stream folds to a faithful transcript.
- Subject-only Conventional Commits, staged by name; never stage `DEV-NOTES.md`/`TEMP.txt`/`project.md`.
