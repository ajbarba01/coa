# 0038 — A completion notice may quote the child's own result

- Status: accepted
- Date: 2026-08-09
- Superseded in part by this decision: [0033](0033-a-notice-is-not-a-message.md)'s content
  contract ("never the child's output").

## Context and problem

0033 decided a child's completion notice carries only the LIFECYCLE FACT of completion
(`completed`/`errored`/`stopped`) and never the child's output — the parent was left to read the
child's own `events.ndjson` itself. That was a deliberate, accepted "Bad" consequence at the time:
"The parent gets no structured payload from the notice itself... It has to go read the child's
transcript to learn the result, which is an extra step." 0033 also left `foldTreeToTranscript`
built and unit-tested with zero production callers, noting a fold "that would project a whole tree
as one transcript" existed but "nothing in this decision rests on it."

Living with that gap turned out to cost more than 0033 anticipated: a parent that spawns several
children has no way to learn a specific child finished without either polling its store directly
(work the daemon already did once, being re-derived per caller) or waiting for the next turn to
stumble across the child's log. This decision asks a narrower question than 0033's: does handing
the parent a BOUNDED, SANITIZED EXCERPT of the child's own final answer reopen the forgeability
problem 0033's Option 1 ("the child authors its own completion report") was rejected for?

## Decision drivers

- **Forgeability, re-examined.** 0033 rejected Option 1 because a child-authored report would be
  "indistinguishable from a daemon-observed fact." The distinction that survives here: WHO composes
  the sentence, not whether the sentence quotes the child. `renderChildEnded` still composes the
  entire notice; the child's text enters only as an interpolated, sanitized, length-capped
  substring — exactly the same treatment `detail` (provider/SDK exception text, also
  no-format-guarantee free text) already gets. A model reading a tool result already treats tool
  output as data, not instruction; a quoted excerpt inside a fixed system sentence is the same
  trust shape, not a new one.
- **Where the text comes from matters.** The excerpted text is never asserted by the child through
  any tool-reachable seam — `spawnAgent`/`findAgent` never accept or forward a "my result is X"
  argument. It is read AFTER the child has already ended, by the daemon, straight off the same
  append-only `events.ndjson` 0033's "the parent reads it themselves" path already trusted. Nothing
  about the read path changed; only who performs the read did.
- **Compose, don't reinvent (P8).** `foldTreeToTranscript` was already built and tested for exactly
  this join — folding a session's own event log (and, if it has any, its descendants') into one
  ordered transcript. This decision gives it its first production caller rather than writing a
  second, narrower join.
- **Bounded, not a floodgate.** An unbounded result would trade one 0033 risk (forgeability) for
  another (a subagent flooding the parent's context). The cap (2000 chars, `notify.ts`'s
  `MAX_RESULT_LENGTH`) and an explicit truncation note — naming the child's own transcript as where
  to read the rest — keep the full-fidelity path 0033 built (`store.getEvents`/`reload`) as the
  honest fallback for anything past the excerpt, never silently presenting a fragment as complete.

## Considered options

1. **Leave 0033 as built — no result in the notice** (rejected). Correct, but the cost of the gap
   (every parent re-deriving its own child-transcript read) outweighed the caution once a bounded,
   sanitized excerpt was designed to close it without reopening the forgeability question.
2. **Let the child supply its own "final report" via a new tool argument, forwarded verbatim**
   (rejected — this IS 0033's Option 1, unchanged). Still indistinguishable from an observed fact
   the moment it lands in the parent's context under `origin: 'system'`.
3. **Quote a read-time fold of the child's own event log, sanitized and capped the same way
   `detail` already is** (chosen). The daemon — never the child — decides what the notice says;
   the child's words ride inside it only as inert, bounded, quoted data.

## Decision

**`ChildEndedNotice` gains an optional `result` field, populated only for a `completed` outcome, by
folding the child's own event log (`session-service.ts`'s `#childResultText`, built on
`foldTreeToTranscript` + `transcript-projection.ts`'s new `latestAssistantText`) — never by
anything the child asserts through a reachable tool argument.** `renderChildEnded` sanitizes it
through the same flatten-control-chars treatment `detail` already gets (`notify.ts`'s
`flattenControlChars`, factored out of the old `sanitizeDetail`), caps it at 2000 characters (wider
than `detail`'s 300, since a result is the point of the notice rather than an incidental
diagnostic), and appends an explicit truncation note when the cap bites. `origin: 'system'` stays
hardcoded, unreachable from any tool handler, unchanged from 0033 — this decision only widens WHAT
the unforgeable envelope is permitted to carry, not WHO may write into it.

0033's Content contract line "never the child's output" is superseded by this paragraph. Every
other clause of 0033 — the enumerated three-outcome vocabulary, the unforgeable-by-reachability
argument, the reachability-constrained seam, the "parent can still read the full transcript itself"
fallback — stands unchanged.

## Consequences (good / bad)

**Good**

- A parent learns what a child actually produced without a second read, closing 0033's own named
  "Bad" consequence, while keeping every safety property 0033 established (unforgeable origin,
  reachability-constrained producer, no back-channel).
- `foldTreeToTranscript` gets its first production caller — a build-it-and-someone-will-need-it
  seam finally earning its keep, rather than a second bespoke join being written beside it.
- The full-fidelity path is never removed: a truncated or absent excerpt always names the child's
  own transcript as the place to read the rest, so the "Bad" consequence 0033 accepted (an extra
  read for the full record) survives only for the tail past 2000 characters, not the common case.

**Bad**

- The notice's `result` text is still model-generated content, sanitized the same way `detail` is
  but not otherwise verified for accuracy — a child that hallucinated its own success still reports
  that hallucination in the excerpt (exactly as it would if the parent read the transcript itself;
  this decision changes WHO reads it, not what a misbehaving child can say). This is a fidelity
  gap, not a forgeability one, and 0033's mitigations are what actually keep the latter closed.
- A future consumer skimming only the notice's `result`, never the fallback transcript,
  reintroduces a smaller version of the risk 0033 was written to avoid — a documented tradeoff of
  giving the notice a bounded payload at all, mitigated (not eliminated) by the truncation note and
  the fact the field is still explicitly presented as quoted excerpt text, not as a status field a
  caller could mistake for structured, verified data.

---

_Last reviewed: 2026-08-09_
