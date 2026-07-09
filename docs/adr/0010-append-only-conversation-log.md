# 0010. Converge conversation persistence onto a single append-only log

- Status: accepted (executed 2026-07-09 — see Delivered)
- Date: 2026-07-06

## Context and problem

A session's conversation is persisted in **two** stores (R-7, `conversation-store.ts`):

- `turns.ndjson` — the lossy UI view, **appended incrementally** per frame as the loop streams (tool-result
  pointers, not full output).
- `messages.json` — the canonical, lossless cross-turn transcript, **rewritten in full only on a clean turn
  settle** (via `onBackendMessages`).

Because the canonical store is written only on clean settle, a mid-turn model/fetch error discarded every
completed block from canonical memory while its on-disk effects (and the `turns.ndjson` UI view) persisted — the
next turn replayed from the last user turn and diverged from disk. ADR follows the fix for that bug
(`da9d8a2`..`1a43aa7`): flush the canonical transcript on **every** exit path, trimmed to the last round-trip-
consistent boundary.

That fix is correct and shipped, but it makes transcript integrity a **discipline** — every present and future
early-return, interrupt, or error path must remember to flush, and to flush only a round-trip-consistent prefix —
rather than a **structural property** of the store. The whole-branch review that caught the round-trip case is
evidence the discipline is easy to get subtly wrong.

A prior-art survey of mature OSS harnesses
([`docs/design/research/2026-07-06-agent-hardening-prior-art.md`](../design/research/2026-07-06-agent-hardening-prior-art.md))
found every surveyed project that had moved past a two-store shape uses a **single append-only event log as the
sole source of truth** ("replaying it reconstructs the entire conversation"; OpenHands v1, opencode). coa is the
outlier in keeping the split — and the split is exactly what produced the divergence bug.

## Decision drivers

- Make transcript integrity structural, not a per-call-site discipline.
- Kill the disk-vs-conversation divergence class at the root, not per-symptom.
- A single append-only log is also the cleanest substrate for **session independence** (any consumer replays the
  log; attach/detach and headless operation fall out for free — see the G4 workstream).
- Compose, don't reinvent (P8): coa already runs an append-only substrate — the **M1 change-event spine** — so
  the pattern is native to the codebase, not a new invention.

## Considered options

1. **Keep the two-store split + flush-on-exit discipline** (the shipped interim). Lowest cost now; leaves
   integrity as a discipline and keeps two representations of one truth in sync by hand.
2. **Converge to a single append-only event log** as the source of truth; derive the lossy UI view (and any
   provider-shaped transcript) as projections of it. Structural integrity; larger refactor of R-7.
3. **Event-source only the canonical transcript**, keep `turns.ndjson` as an independent UI cache. Middle ground;
   still two writers, still a sync surface.

## Decision

Adopt **option 2**: converge conversation persistence onto a single append-only log as the source of truth, with
the UI view and any backend-shaped transcript as derived projections — reusing the M1 change-event spine pattern.

**Execution is deferred.** The shipped flush-on-exit fix is the interim and is sufficient for correctness today.
This ADR records the direction so it is not lost; the actual convergence is scheduled to land with the
session-independence / persistence workstream (G4), which most benefits from it, and gets its own implementation
plan. Until then, new persistence-touching code follows the flush-on-exit discipline.

## Consequences

**Good**

- Transcript integrity becomes structural — a mid-turn error/interrupt cannot persist an inconsistent state,
  because the log only ever grows and is replayed, never rewritten.
- Removes the two-store sync surface and the "remember to flush a consistent prefix" footgun.
- Directly enables G4 (daemon-authoritative liveness, stateless reattachable console) and headless operation.
- Reuses an existing coa pattern (M1) rather than adding parallel machinery.

**Bad / costs**

- A non-trivial refactor of R-7 (`conversation-store.ts`) and its consumers (memory plan, prompt-freeze, the
  console reload path); deferred precisely to bound that cost to when G4 needs it.
- Until it lands, correctness still rests on the flush-on-exit discipline — a known, documented interim risk.

## Delivered (2026-07-09)

Executed as designed (`docs/superpowers/specs/2026-07-09-coa-append-only-sot-design.md`), informed by an OSS
mechanics survey (`docs/design/research/2026-07-09-append-only-persistence-oss.md`):

- **One append-only `events.ndjson` per session** (`PersistedEvent = {seq, frame, full?}`) is the sole writer.
  `reload` projects the `frame` stream (the UI view, unchanged, `full` dropped); `loadBackendMessages`
  **folds** the log into the provider transcript at read time (`foldEventsToTranscript`). `messages.json` and
  `turns.ndjson` are gone; the transcript is computed on demand, never a second durable store.
- **The adapter emits ONE enriched stream** (`onTurn(frame, full?)`, `full` = the complete tool-result body,
  persistence-only — never on the R-12 wire, D57). The second writer (`onBackendMessages` +
  `messageToBackendMessages`/`tapStreamedUserTurns` + the driver's `onMessages` flush) is retired, so the
  transcript integrity is now **structural**, not a flush-on-exit discipline.
- **`dropTrailingDanglingToolCall` (write-time drop) became `repairUnpairedToolCalls` (read-time synthesize)** —
  the convergent OSS practice: an unmatched tool call gets a synthesized paired result
  (`[Tool execution was interrupted]`), keyed by call-id **set membership** (not list position, so a stranded
  non-last parallel call is repaired too), so the assistant turn survives and cross-provider replay stays valid.
  The fold also drops an orphaned `tool_result` (a result answering no call) — the integrity boundary in both
  directions.
- **The P-β M2 divergence vanishes** (a steer is appended once → both projections see it; the pure-API driver
  now emits a user frame per injected steer too) and **A1 is structural** (the log only grows; a mid-turn crash
  is handled by the read-time repair). Streaming token-deltas stay OUT of the log (settled frames only — a
  constraint the incremental-streaming work must honor).
- **Fresh start:** old two-store sessions are not read by the new path (the local store is disposable scratch).
- Verified: the full-fidelity real-tool capture and the folded transcript are proven against the live Claude
  backend (`sot-smoke.live.test.ts`, `COA_LIVE`-gated); the fold is exhaustively unit-tested.

_Last reviewed: 2026-07-09_
