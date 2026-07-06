# 0008. Strict-superset (feature-off ≤ raw loop)

- Status: accepted
- Date: 2026-07-06

## Context and problem

coa sits between the user and a rented coding-agent loop it does not own. Every governance feature it adds —
flags, health checks, context assembly, tool enrichment — is an extra thing that can go wrong: a missing
dependency, an unbuilt half, a misconfigured producer. Without a standing rule, "not yet built" or "misconfigured"
could silently make the governed loop worse than just running the agent raw, which would defeat the reason coa
exists.

## Decision

In the context of a governance layer that must never be worse than the raw loop, facing the risk that added
features degrade the agent, we decided on **strict-superset (D85)** — every feature adds value or degrades to a
literal pass-through, and `coa raw` always shows the unfiltered loop — to guarantee coa-with-a-feature-off is
always ≤ the raw loop, accepting that every feature must carry a pass-through/off path rather than a hard
dependency on being fully wired.

This is not a one-time check but a floor every module builds down to: an absent producer registry stays inert
(`packages/core/src/context/producers.ts`), an unconfigured web summarizer degrades to raw markdown instead of
failing the fetch (`packages/core/src/workbench/web-tools.ts`), and the desktop console's `coa raw` toggle
(`ui.rawMode`) reprojects to verbatim frames on demand — the same invariant enforced at three different layers
(context, tools, UI).

## Consequences (good / bad)

**Good** — a partially-built or misconfigured coa degrades gracefully instead of blocking or corrupting the
agent's work; every module gets a clear, checkable floor to build toward.

**Bad** — every feature carries the extra cost of an explicit off/degrade path, which is more code than assuming
happy-path configuration.

---

_Last reviewed: 2026-07-06_
