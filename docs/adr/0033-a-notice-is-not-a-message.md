# 0033 — A notice is not a message

- Status: accepted
- Date: 2026-08-06
- **Superseded in part by [ADR-0038](0038-a-completion-notice-may-quote-the-childs-own-result.md)
  (2026-08-09):** the Content contract's "never the child's output" clause is replaced — a
  `completed` notice may now quote a bounded, sanitized, read-time-folded excerpt of the child's
  own final answer. Every other clause here — the unforgeable `system` origin, the
  reachability-constrained producer, the enumerated three-outcome vocabulary, the parent's own
  full-transcript read as the fallback for anything past the excerpt — **stands unchanged**; read
  0038 for why quoting an excerpt does not reopen the forgeability question this ADR was written to
  close.

## Context and problem

A child session that runs concurrently with its parent needs a way to tell the parent when it is
done — the parent cannot poll a child it is not otherwise talking to. `docs/adr/0030` had already
built a generic `Delivery` port (`{origin: 'user' | 'system'; text}`) for getting text into a
running loop mid-turn, with `system` reserved but never produced: "today only coa's own steer
handler writes `user`; the child-completion producer that will write `system` is the next plan's
work, not this one's." This decision is that work. The question it has to settle is what a
completion notice IS, not just how it's delivered — specifically, whether it is the child
"speaking" to its parent (the first piece of agent-to-agent messaging) or something categorically
different.

## Decision drivers

- **Forgeability.** If a completion notice were agent-shaped — the child's own last words, echoed
  to the parent — then a hostile or merely broken child's text becomes indistinguishable from a
  daemon-observed fact the moment it lands in the parent's context. A child mid-task could claim
  completion to get the parent to treat unfinished or adversarial work as done, and nothing about
  the parent's context would tell the two apart.
- **Category.** A lifecycle fact ("session X ended, for reason Y") is not open-ended content a
  model wants to say to another model. It has three enumerated outcomes
  (`SessionEndReason: 'completed' | 'errored' | 'stopped'`, `packages/core/src/session/notify.ts`)
  — "deliberately no inferred or advisory reason (no 'went quiet'), because a signal that cannot be
  detected must not be reported as one" — is daemon-authored at one seam every drive strategy's
  terminal status funnels through (`emitStatus` in `session-handlers.ts`), and is unrepliable: the
  session it describes has, by definition, already ended, so there is no "reply" slot to route
  anything into even if one were wanted.
- **Scope discipline.** Agent-to-agent messaging (`send_message`, threads, an inbox, a durable
  message log, and the advisory liveness reasons a full presence system would need) is explicitly
  out of this arc's build list — its own later plan, becoming "another producer on the delivery
  queue." This decision has to give that plan a channel to extend without deciding its trust model
  now.
- **Compose, don't reinvent (P8).** `docs/adr/0030` already generalized "text waiting to reach a
  running loop" and built the one drain point every backend realizes it through. A lifecycle fact
  is exactly that kind of text; giving it a second, parallel pipe would duplicate the per-backend
  wiring (`PostToolUse`/`Stop` on Claude, the per-round-trip drain on pure-API) ADR-0030 already
  built once.

## Considered options

1. **The child authors its own completion report** (e.g., a final tool call whose free text the
   daemon forwards verbatim) (rejected). This is the forgeability problem by construction: the
   notice would carry whatever the child — or a task the child was adversarially given — chose to
   say, with nothing to distinguish it from an actual observed outcome.
2. **Build general agent-to-agent messaging now, and let the completion notice be its first
   message** (rejected). Out of this arc's scope, and it conflates two different trust levels in
   one channel: a `system` fact must be unforgeable by construction, while an inter-agent message
   is, definitionally, agent-authored content a receiving model should treat with exactly the same
   skepticism as any other tool output. Building both as one thing forecloses that distinction
   before it's been designed.
3. **A second, dedicated notification port on `RuntimeAdapter`, separate from `Delivery`**
   (rejected — P8). Would re-derive a per-backend realization ADR-0030 already solved once for the
   general case; a lifecycle fact needs nothing a delivery doesn't already provide.
4. **Extend `Delivery` with the already-reserved `system` origin, produced only from a
   reachability-constrained seam** (chosen). `renderChildEnded` hardcodes `origin: 'system'`; the
   only call site, `notifyParentIfChild` inside `emitStatus`, is unreachable from any tool handler
   — a `RegisteredTool.invoke` receives only its validated args, never a session handle capable of
   authoring a delivery, so nothing a model runs can reach this producer.

## Decision

**A completion notice is a system-authored fact about a session's lifecycle, not a message from
the child — a different category of thing, riding the same delivery mechanism ADR-0030 built, with
an origin no tool handler can ever produce.**

- **Content contract.** The notice carries the fact of completion — `child` (a daemon id),
  `agentRef` (constrained upstream by `SAFE_REF`), `reason`, and a bounded, sanitized `detail` for
  the `errored` case only — and never the child's output. `sanitizeDetail` flattens C0/DEL/the
  Unicode line-and-paragraph separators and caps the length, because `detail` is the one field with
  no upstream format guarantee (provider/SDK exception text) — everything else in the sentence is
  either a hardcoded template or a value already constrained elsewhere.
- **The parent retrieves the child's actual work itself.** Nothing about this channel hands the
  parent the child's transcript — it reads the child's own append-only `events.ndjson` directly,
  with the ordinary file tools it already has. The live run that validated this arc did exactly
  that: the notice arrived ("subagent untitled-agent-6 (…) finished. Read its transcript for the
  result."), and the parent read that log itself to get the result. A read-time fold that would
  project a whole tree as one transcript (`foldTreeToTranscript`) is built and unit-tested but has
  no caller; nothing in this decision rests on it.
- **Unforgeable by reachability, not by convention.** Nothing marks a `system` delivery as
  special-cased data to sanitize against forgery — it is unreachable from anywhere a model's output
  can influence, so there is nothing to audit for a model trying to fake one.

## Consequences (good / bad)

**Good**

- A model cannot manufacture a false completion for itself or any other session — the one producer
  that can write `origin: 'system'` sits behind a seam no tool handler ever touches.
- Zero new per-backend plumbing: the same drain point, queue, and cancel-guard ADR-0030 built for
  steering now also carries lifecycle notices, with nothing backend-specific added.
- Leaves agent-to-agent messaging fully undesigned rather than half-designed — its own later plan
  gets to choose a trust model for agent-authored content from a clean slate, instead of inheriting
  assumptions baked in to solve this narrower problem.

**Bad**

- The parent gets no structured payload from the notice itself — only THAT something happened, not
  WHAT. It has to go read the child's transcript to learn the result, which is an extra step
  compared to a hypothetical channel that handed the answer over directly.
- There is no back-channel. A child cannot ask its parent anything, and an orphaned or
  indefinitely-blocked child has no way to signal it needs input. Fine for this arc's fire-and-forget
  dispatch contract, but a future stage where a child genuinely depends on parent input would need
  to build that from nothing — this decision deliberately does not start it.

---

_Last reviewed: 2026-08-06_
