# 0001. Consolidate project truth into router + ADRs + ROADMAP

- Status: accepted
- Date: 2026-07-05

## Context and problem

coa's docs, comments, and status had drifted to the point of actively misleading agents. The root cause was not "old files" — it was that durable project truth lived in three homes that each failed differently:

- **Claude-private memory** (`~/.claude/.../memory/`) — the de-facto roadmap, but invisible to the non-Claude agents (longcat, deepseek) that do future work, and already days stale (missing shipped adapters and workstreams, treating merged branches as pending).
- **The `docs/superpowers/` graveyard** — tens of thousands of lines of shipped, write-once, never-pruned play-by-play. Yet it was also the *only* home for load-bearing architecture: the multi-backend design, the core-context/role decisions, owned web tools, multi-account auth, and the console design system.
- **The curated framework docs** — internally contradicted by the code (e.g. the authoritative `SPEC.md` still claimed "Claude-locked, one backend" while three backends shipped).

Every finished plan stranded its durable decisions in a large file nobody re-read; "current state" existed only in one agent's memory. That was the engine of drift. Proof the tax was real: research agents inheriting stale truth from these sources reported already-fixed things as broken, corrupting the de-drift research itself.

`docs/WORKFLOW.md` also carried an implicit rule that specs stay in place as decision records — which contradicts extracting their durable content and deleting the rest.

## Decision drivers

- Agent understanding per token: one fact, one home; docs small enough to be cheap to load.
- Anti-drift by convention + a strong index, not heavy automation (solo pre-v1 repo; two cheap scripts are enough).
- A clear, in-repo path forward that every agent — not just Claude — can see.
- Set up a clean baseline before the next architecture/refactor phase.

## Considered options

1. **Keep the status quo** — private memory as roadmap, `docs/superpowers/` as permanent architecture archive, one flat `SPEC.md`. Rejected: this is the structure that produced the drift being fixed.
2. **Heavy automation** (CI gates, CHANGELOG, `llms.txt`) to enforce freshness. Rejected as YAGNI for a solo pre-v1 repo; two runnable scripts (router/orphan check, dead-link check) are enough leverage without process overhead.
3. **Consolidate durable truth into three structural homes, indexed from one router** (the option adopted): immutable ADRs for *why*, `ROADMAP.md` for current *what*, `AGENTS.md` as the single router every doc is reachable from, plus a per-module SPEC split so no module's truth requires reading an 11-module flat file.

## Decision

Adopt a three-part doc-system, all indexed from the `AGENTS.md` router:

- **Durable *why* → immutable ADRs** (`docs/adr/`, this directory). Each ADR captures one architecturally-significant decision in MADR-lite form. Once `accepted`, an ADR is immutable except for typo/link fixes; a changed decision becomes a *new* ADR that supersedes the old one.
- **Current *what* → `ROADMAP.md`.** A single in-repo roadmap/status document replaces Claude-private memory as the roadmap authority, so every agent (Claude, longcat, deepseek) sees the same current state.
- **Everything indexed from the `AGENTS.md` router.** Every doc under `docs/**` must be reachable by following links from `AGENTS.md`; an orphan-check script makes this mechanical rather than aspirational.
- **The `docs/superpowers/` graveyard is graduated, then deleted.** Every durable decision trapped in that corpus (multi-backend architecture, core-context/role decisions, owned web tools, multi-account auth, the console design system, etc.) is extracted into its permanent home — an ADR, the per-module SPEC, or `ROADMAP.md` — before the source plan file is deleted. Deletion is gated on graduation being verified.
- **`SPEC.md` is split per-module.** The single flat multi-thousand-line file is reduced to a short index (module map, dependency graph, cross-cutting invariants) plus one file per module (`docs/design/handoff/spec/M0..M10.md`), so a module's truth is a bounded read instead of a full-document scan.

## Consequences (good / bad)

**Good**
- One fact has one home; other docs cross-link instead of restating, cutting the ~30-copy-paragraph class of drift.
- Any agent — not just Claude — can find current status and durable rationale from the same router, closing the private-memory blind spot.
- A module's truth (SPEC) and a decision's rationale (ADR) are each a small, targeted read instead of a multi-thousand-line scan.
- The `docs/superpowers/` graveyard's write-once accumulation pattern stops: plans are deleted after their durable content graduates.

**Bad**
- More small files to navigate than one big one; the router and the orphan-check script become load-bearing rather than optional.
- This is a convention agents must actively follow (correct ADR filenames, updating the index, not restating facts) — there is no compiler enforcing it, only the router/orphan and dead-link scripts plus review.
- This decision **supersedes the implicit rule in `docs/WORKFLOW.md`** that specs stay in place as permanent decision records. `WORKFLOW.md` is updated to reflect the ADR/ROADMAP convention in a follow-on change.

---

_Last reviewed: 2026-07-05_
