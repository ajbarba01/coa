# 0034 — A subagent is a session with a parent link

- Status: accepted
- Date: 2026-08-06

## Context and problem

Once `spawn_agent` exists, the daemon needs a representation for "the thing that got spawned" that
every other part of the system — the stop cascade, the transcript read path, cost settlement, idle
eviction — can treat consistently. The obvious alternative to reusing the existing session
machinery is a dedicated child-session subsystem, closer to what M8's original depth-1 framing
(D122, see `docs/adr/0032`) implied: subagents as a distinct, harness-orchestrated concept with
their own lifecycle. This decision is about which of those two shapes a spawned child actually is.

## Decision drivers

- **D85 (strict superset).** The ordinary, non-child path has to stay byte-identical. Reusing the
  exact session machinery, with lineage as two new OPTIONAL fields, makes that provable by
  construction: a conditional-spread writes no key at all when there's no parent, so an ordinary
  session's on-disk shape is unchanged. A parallel "child session" type would need its own D85
  argument built from nothing, and risks its own bugs (its own eviction policy, its own teardown
  path) diverging from an ordinary session for no functional reason.
- **Nothing about being a child changes what a session needs.** Idle-timeout eviction, the single
  checkpoint/worktree-release teardown path, cost settlement via `onSettle` → `M7.charge`, and the
  append-only conversation log are all things a spawned child needs exactly as much as a top-level
  session does. Only two things differ: who gets notified when it ends (`docs/adr/0033`), and
  whether a stop cascades to it.
- **Abort has to derive from the session, not the in-flight turn.** A stop cascade
  (`live-registry.ts`'s `#closeOne`) must be able to end a child regardless of whether it's mid-turn,
  between turns, or hasn't started one yet. A per-turn interrupt handle (`TurnInterrupt`) only
  exists while a turn is running, and only on the held-open Claude path — it cannot be the
  mechanism. Sealing the session's `DeliveryQueue` and calling `LiveSession.close()` (which itself
  seals the queue before finalizers run) works uniformly across every backend and every turn phase.
- **Cycle-safety without a depth field.** `docs/adr/0032` dropped the depth cap, so `parent` can
  legitimately point anywhere a hand-edited or adversarial chain sends it — including back up its
  own ancestry. `lineage.ts`'s own header names this directly: the walk tracks a `visited` set
  "since the depth cap was deliberately dropped and the cost cap is the only fan-out bound." Storing
  lineage as a single pointer per session, reconstructed into a tree only on demand, means there is
  exactly one place lineage can ever be wrong — the pointer itself — rather than a second structure
  that has to be kept in sync with it.

## Considered options

1. **A dedicated child-session subsystem**, parallel to `LiveSessionRegistry`, scoped to
   harness-orchestrated depth-1 subagents (closer to D122's original framing) (rejected). Once the
   depth-1 restriction itself is gone (`docs/adr/0032`), there is no remaining reason for a child to
   be a different kind of thing — every property it needs, a session already has.
2. **Lineage as a maintained two-way structure** (a `children: string[]` array kept in sync on each
   parent, alongside each child's own `parent` pointer) (rejected). Two-way bookkeeping means every
   mutation site has to keep both directions consistent; a one-way `parent` pointer, walked on
   demand, has nothing to keep in sync.
3. **Depth-counted lineage** (a `depth` field, incremented per hop, sized both to bound fan-out and
   to bound a cascade walk) (rejected, together with `docs/adr/0032`'s rejection of a depth bound).
   Even used only to size a walk rather than to deny anything, it would be redundant: the walk
   already needs a cycle guard for correctness regardless of depth, and that guard bounds the walk
   for free.
4. **`parent`/`root` as two optional fields on the existing session/record types; `descendantsOf`
   as a pure function over live sessions' own `.parent`; abort and notify wired at the
   session-lifecycle seam (`close()`/`emitStatus`), not the turn seam** (chosen).

## Decision

**A subagent is created through the exact same path as any session — `registry.getOrCreate` +
`store.create` (`startChild` in `session-handlers.ts`) — carrying two new fields, `parent` and
`root`, and nothing else distinguishes it.**

- **Lineage is stored, not walked from a maintained structure.** `SessionMeta.parent?`/`.root?`
  (on-disk) and `LiveSession.parent`/`.root` (in-memory, non-optional — `root` defaults to the
  session's own id when omitted) are the only representation. `descendantsOf` reconstructs a
  children-map from every live session's own `.parent` field, on demand, per call — there is no
  separate tree object that could drift from what the sessions actually record.
- **The cancel-guard exists because a torn-down session must not be revivable.** `DeliveryQueue`
  is sealed in `close()`, before finalizers run. A cascade abort (`#closeOne`) seals every
  descendant's queue as part of the same synchronous walk that ends them, so a completion notice
  arriving after the fact (`notifyParentIfChild` pushing onto an already-sealed parent queue) is
  silently dropped — never an error, never something that wakes a session a person deliberately
  stopped. This is the same SC-1 shape ADR-0030's cancel-guard already established for deliveries
  in general; this decision is its first real exercise under an actual multi-session cascade.
- **A spawn against an already-closed (or closing) parent orphans the child rather than refusing
  it.** Refusing would need either a throw (forbidden — SC-1) or a bogus id the caller would
  wrongly read as success, which is worse: the work the model asked for would silently never
  happen. The orphaned child still runs its one assigned turn to completion, has no live ancestor
  to ever cascade a stop through it, and self-cleans via the ordinary idle-eviction timer — a
  deliberate, SC-1-consistent behavioral commitment, not an oversight left unhandled.
- **A child shares its root's worktree.** No worktree manager exists to give it its own, so two
  agents can write the same tree concurrently. Accepted and named rather than deferred silently:
  v1 is attended, and every write — from either agent — still passes the same `PreToolUse` gate a
  human is present to observe.

## Consequences (good / bad)

**Good**

- Every mechanism an ordinary session has — eviction, one teardown path, cost settlement, the
  append-only log — is free for a child, with zero new state to keep synchronized.
- The cascade is provably terminating for any shape of parent-link graph, cyclic or not: it is a
  bounded visited-set walk over a finite session set, not a trust that the data is well-formed.
- D85 holds by construction: a conditional-spread means no lineage fields ⇒ no new keys ⇒ an
  ordinary session's persisted shape is byte-identical to before this arc.

**Bad**

- `descendantsOf` builds a full children-map from every live session before walking — an
  O(live-sessions) scan per cascade. Fine at today's scale (a human-attended daemon with a handful
  of concurrent sessions); not a shape that would survive a much larger live-session count
  unchanged.
- An orphaned spawn gives the caller no signal that the child it just started has no live ancestor
  — the model reads back an ordinary success (`{applied: true, sessionId}`) whether the parent is
  still alive or not. Nothing leaks (the child still self-cleans), but nothing tells the model
  its spawn landed in an orphaned state either.

---

_Last reviewed: 2026-08-06_
