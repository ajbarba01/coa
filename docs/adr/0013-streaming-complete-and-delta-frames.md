# 13. Streaming complete() contract and delivery-only delta frames

Date: 2026-07-09

## Status

Accepted

## Context

coa was the only surveyed harness rendering one text block per model round-trip. G7
(Piece B) adds incremental token streaming for all backends. The append-only log
(ADR 0010) stores only settled frames; the OSS survey
(docs/design/research/2026-07-09-append-only-persistence-oss.md §6) found every peer
keeps streaming deltas out of its durable store, and opencode filed a regression
(#11329) from persisting every delta.

## Decision

- The pure-API `complete()` primitive is an `AsyncGenerator<CompletionDelta,
  CompletionResult>`: it yields text/reasoning deltas and RETURNS the settled result.
  A non-streaming backend yields nothing and returns the whole result (D85 degrade).
- A streaming chunk reaches the UI as a distinct TurnFrame kind (`text-delta` /
  `thinking-delta`), never a flag on `text`.
- Delta frames are DELIVERY-ONLY: pushed over R-12, never `store.append`-ed. The
  settled `text`/`thinking` frame remains the sole durable record, so the read-time
  fold and cross-turn memory are unchanged.
- Interrupt mid-stream keeps the accumulated partial and marks it (`\n\n[interrupted]`),
  emitting it as ONE settled `text` frame (A1).

## Consequences

- The E substrate stays correct by construction: the durable store sees zero appends
  during a stream and exactly one at settle.
- The Claude SDK backend surfaces `includePartialMessages`, mapping partial messages to
  the same neutral delta frames — no backend streaming type crosses the M8 seam.
- Reconciliation is positional in v1 (no per-block delta ids); a settled block replaces
  the live-streamed block of its channel.
