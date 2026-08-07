# 0035 — The close gate is the only block; the cost ceiling is archived

- Status: accepted
- Date: 2026-08-07
- Supersedes [0032](0032-the-cost-cap-bounds-fan-out.md); narrows
  [0009](0009-single-deny-channel.md)'s "exactly two blocks" to one.

## Context and problem

0009 fixed the system's block count at exactly two — M3's Type-1 close-gate and M7's cost-cap —
through one deny channel, and 0032 then leaned on the cap as the only bound on `spawn_agent`
fan-out after the depth-1 rule was dropped. But at head the cap's deny path is dead configuration:
no production caller ever sets `ceilingUsd` or a per-session ceiling (the only setters are test
fixtures), so under the shipped subscription default `capState` is a constant
`{ remaining: null, capHit: false }` and the `COST_CAP_DENY` branch in `buildCanUseTool` is wired
but can never fire. The system carried the full plumbing of a block — options, budget math, an SDK
budget forwarding, a deny frame, its renderer copy — for a stop that could not happen.

The alternative to archiving was to make the ceiling real: wire a configured dollar cap through
the CLI/console and let the deny path fire. The maintainer ruled against it (2026-08-07),
accepting the consequence 0032 warned about: with the ceiling gone, **nothing bounds subagent
fan-out** — not depth, not width, not spend.

## Decision drivers

- **Dead machinery is a falsehood the code tells.** Every reader of the deny path — the predicate,
  the SDK error match, the deny-frame renderer — described a behavior the shipped product did not
  have.
- **Accounting was never the problem.** The spend counter, the settled charge per result, and the
  secret-clean ledger (with root attribution for spawned trees) carry all the value the cap
  surface actually delivered; the ceiling carried none.
- **v1 is attended.** A human is present at every run; the operator's stop and the provider plan's
  own usage limit are the real spend backstops today, exactly as the pass-through floor intends.

## Decision

**The hard-cap/deny path is archived** (deleted in place; git history is the archive): the ceiling
options, the cap consult in the `canUseTool` predicate, the per-session budget math, the SDK
budget forwarding, and the cost-cap deny frame. **The accounting surface stays**: `CostCap.charge`
still accumulates the daemon-global spend total on every settled result, `Governance`
charge/record and the ledger are untouched, and every read surface (the `capState` console verb,
the CLI cap command, the governed inspect read) keeps working. `capState` now reads a constant
`{ remaining: null, capHit: false }` — accepted; exposing real spend through it is future work,
not this decision.

- **This supersedes 0032.** "The cost cap is the only fan-out bound" is no longer true: there is
  no fan-out bound. A `spawn_agent` tree of any width or depth runs until its work ends, the
  operator stops it, or the provider's own plan limit does.
- **This narrows 0009.** "Exactly two blocks" becomes exactly one: the close gate, still issued
  through the single deny channel. Everything else 0009 decided stands — the per-tool
  advisory→deny rule stays demotable pipeline policy, the fail-closed refusal on a throwing
  predicate stays a safety floor, and no other module may deny.
- **The live smoke suites keep a real-money guard.** They ran with a real budget as protection
  against a runaway paid loop; that guard now rides a raw backend session-option passthrough on
  the Claude adapter (the SDK's own budget stop), a test harness concern rather than a governance
  surface.

## Consequences (good / bad)

**Good** — the audit answer to "can coa ever stop me" shrinks to one seam; the settlement →
charge → ledger path is the single cost story, with no unreachable branch beside it; the backend
adapters lose a vendor-error string match that existed only to dress the SDK's budget throw as a
governed stop.

**Bad** — a runaway fan-out (a task that keeps spawning agents) has no in-system bound; the
operator and the provider's plan limit are the only stops. Accepted deliberately, with eyes open,
consistent with "help, never cage": the risk 0032 documented as mitigated-by-the-cap is now simply
accepted. If real harm shows up, the remedy is a new decision — likely a real, user-set ceiling
over the kept spend counter — not a quiet revival of the dead path.

---

_Last reviewed: 2026-08-07_
