# 0009. Exactly two blocks through a single deny channel

- Status: accepted
- Date: 2026-07-06

## Context and problem

A governance layer is naturally tempted to add a block wherever a check fails — it is the easiest way to make a
policy "stick." coa's founding stance is "help, never cage" (SC-1): the agent should stay uncaged everywhere it
is not explicitly and deliberately blocked, and every block that does exist must be auditable at one seam rather
than scattered across the system.

## Decision

In the context of "help, never cage," facing the temptation to add blocks throughout the system, we decided the
**only two blocks are M3's Type-1 close-gate and M7's cost-cap, both issued through a single deny channel** —
everything else is advisory or surfacing — to keep the agent uncaged and make every block auditable at one seam,
accepting that no other module may deny.

Shipped as `buildCanUseTool`/`buildStopGate` in `packages/core/src/session/permission.ts`, whose header states
the invariant directly: "These are the ONLY two blocks in the whole system (SC-1): the cost cap ... ride[s] the
`canUseTool` hook, and the close-gate rides the `Stop` hook. M9 holds no policy — it only runs the predicate M8
assembles." The cost-cap check runs first and is fail-expensive (`COST_CAP_DENY`); any predicate exception is
fail-closed (`FAIL_CLOSED_DENY`) rather than silently admitting an unchecked call. M6's per-tool advisory→deny
rule (`FlagPipeline.perToolDeny`) also rides the `canUseTool` hook but is explicitly demotable — the pipeline's
own comment marks it "NOT one of the two system blocks," a policy M3 holds and M9 only runs, not a third standing
block.

## Consequences (good / bad)

**Good** — every deny in the system traces to one of two named seams, so auditing "can coa ever block me" is a
two-line answer instead of a system-wide search; M9 (and any future backend adapter) stays policy-free, only
executing predicates M8 assembles.

**Bad** — a module that wants to hard-block a bad state has no shortcut — it must either route through the
close-gate/cost-cap or settle for advisory, which is by design but adds friction for a hypothetical future need.

---

_Last reviewed: 2026-07-06_
