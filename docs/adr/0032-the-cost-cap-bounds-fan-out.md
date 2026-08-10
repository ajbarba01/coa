# 0032 — The cost cap bounds fan-out, not a depth counter

- Status: superseded by [0035](0035-the-close-gate-is-the-only-block.md)
- Date: 2026-08-06

## Context and problem

M8's spec locks D122: "harness-orchestrated subagents, depth-1" — a subagent tree is bounded to
one layer by **withholding the spawn capability from the subagents themselves**, so a child cannot
spawn its own children. That was written before `spawn_agent` existed. When this arc actually
shipped it, a live run found the tool registered but unreachable — `spawn_agent` was in
`TOOL_CATALOGUE` but in no package's `toolRefs`, so it never entered any session's compiled
capability frame (`assemble-agent.ts`). The maintainer's fix was to add `'spawn_agent'` to the
**Core** package's `toolRefs`, the default-inclusion package every role gets. That fix makes
`spawn_agent` available to a spawned child exactly the same way it is available to a top-level
session — nothing in the shipped code withholds it from a child, so D122's depth-1 bound does not
hold as written: a child can call `spawn_agent` too.

Restoring the depth-1 bound literally would mean threading a new "is this session a child"
capability-availability rule into frame assembly — the same seam the reachability defect just
came from, gated in a second, different way. The question this decision settles is what actually
bounds an unsupervised fan-out now that a depth counter is not it.

## Decision drivers

- **SC-1 — exactly two blocks** (`docs/adr/0009`). A depth check that denies past N children would
  be a third block, and the whole point of that invariant is that auditing "can coa ever stop me"
  is a two-line answer. Anything that fails the model's call for a reason M3's close-gate/M7's
  cost-cap didn't decide is a violation, not a variant.
- **Registration and availability are two separate gates** — the exact lesson this arc's live run
  already paid for once. Re-solving "should a child have this tool" as a second, differently-shaped
  gate on top of the one that just got fixed is the same mistake in a new spot.
- **A depth counter only bounds one axis.** It stops a chain (A spawns B spawns C …) but does
  nothing about a wide fan-out (one session spawning fifty children at once) — the actual risk
  ("an agent loop runs away and spends real money") is shaped by total spend, not by how deeply
  nested the sessions that spent it were.
- **The cost cap is already daemon-global, not per-session.** `CostCap.capState`/`charge`
  (`packages/core/src/governance/cost-cap.ts`) track one running total for the whole daemon process
  — "one session's settled spend correctly reduces every other session's `remaining`", per the
  class's own comment. It was already binding every concurrently-running session before this arc;
  a spawned child's tool calls run through the exact same `canUseTool` predicate as anything else,
  so nothing new has to be built for the wallet to bind a tree.

## Considered options

1. **Keep D122's depth-1 bound, implemented by withholding `spawn_agent` from a child's frame**
   (rejected). Requires new per-session state ("am I a child") threaded into
   `assemble-agent.ts`/frame construction that does not exist today. The maintainer's ruling on the
   reachability defect explicitly rejected the adjacent idea of letting a tool's package membership
   answer a broader availability question ("making kernel membership imply frame availability" —
   too broad a semantic change) — narrowing availability by lineage runs into the same objection
   from the other direction.
2. **A depth counter on `SessionMeta`, checked at spawn time, denying past some N** (rejected). A
   third block, so it fails SC-1's "exactly two" invariant outright. It also only defends against a
   chain, not a wide fan-out, so it would not even fully solve the problem it was added for.
3. **Rely on the existing daemon-global `CostCap` as the sole bound; add nothing new** (chosen). It
   is already correctly scoped (per-daemon, not per-session or per-tree), already wired through the
   one deny channel (`buildCanUseTool`), and a spawned child's calls are ordinary calls to it.

## Decision

**The cost cap is the only fan-out bound. No depth limit exists, and none is added.** A session
tree of any width or depth draws down the same single daemon-global wallet every ordinary session
already draws down; `spawn_agent` is an ordinary governed tool, gated by the same `canUseTool`
predicate as every other call, not a special case.

- **The root id is a record key, not a second ceiling.** `SessionMeta.root`/`LiveSession.root` and
  `LedgerRecord.root` exist to **attribute** spend and lineage to a tree — for the (deferred,
  no-producer-yet — see ROADMAP.md) cost roll-up, and for the abort cascade (`docs/adr/0034`) —
  never to compute a per-tree limit distinct from the daemon's one wallet. A tree's members share a
  `root` for bookkeeping; they do not share a separate budget.
- **A cyclic or self-referential `parent` chain is defended structurally, not by a limit.**
  `descendantsOf` (`packages/core/src/session/lineage.ts`) tracks a `visited` set precisely because
  "the depth cap was deliberately dropped and the cost cap is the only fan-out bound", per its own
  header comment — a walk has to terminate on its own, since nothing upstream guarantees the graph
  it walks is acyclic.

## Consequences (good / bad)

**Good**

- No third block: SC-1 still names exactly two (`docs/adr/0009`), unchanged by this arc.
- The reachability fix (`spawn_agent` in Core's `toolRefs`) needs no companion restriction — a
  spawned child is exactly as capable, and exactly as governed, as the session that spawned it.
- A tree's shape is irrelevant to how it is bounded: a hundred siblings and a hundred-deep chain
  both hit the same ceiling, unlike a depth counter, which only ever caught the chain.

**Bad**

- The cap is checked pre-call and charged at settlement (`M9`'s settlement step calls
  `M7.charge` once per settled result) — a burst of spawns issued back-to-back, before any of their
  own turns have settled, can be admitted before the ceiling reflects their cost. This is the same
  lag an ordinary sequential session already has; fan-out just makes several sessions able to be
  mid-flight at once instead of one, so the lag is more visible, not new.
- Nothing stops a pathological agent definition (a task that always tells its agent to spawn
  itself) from minting sessions rapidly for the short window before the wallet's settlement lag
  catches up. Accepted, not mitigated: v1 trusts the loop until there's real evidence of harm
  (SC-1's "help, never cage" default), and the daemon-wide cap still ends it — just not instantly.

---

_Last reviewed: 2026-08-06_
