# coa

A **local-first workbench for harness-independent agentic development.** coa owns the work, not the model: a
long-lived daemon holds live sessions and their append-only record; backend adapters rent whatever loop you
point them at; auth manages the accounts the work is charged to; an agent registry defines who is doing it; a
CLI and an Electron console are thin clients over the same daemon. Model-agnostic and agent-agnostic by
construction — every backend sits behind one seam, and no provider assumption is allowed past it.

[`README.md`](README.md) is the outside view — what works today and how to run it. **This file is the inside
view: how work is done here.** It is a **router**, not a knowledge dump.

> **Capabilities, not model labels.** Work is done by a coding agent (Claude Code today; others possible).
> Claude reads [`CLAUDE.md`](CLAUDE.md), which loads this file. Everything below is phrased so another agent
> can join without a rewrite.

## Doc navigation (read the one that owns your task — load just-in-time)

| Doc                                            | Authority over                                                                       | Read before…                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)   | **The system** — what the pieces are, how a turn flows, the seams and their invariants | anything about how coa actually works   |
| [ROADMAP.md](ROADMAP.md)                       | **Where the project stands** — what is real, what is missing, what is open next        | orienting, or picking up work            |
| [docs/REPO_LAYOUT.md](docs/REPO_LAYOUT.md)     | **Where code lives** — package map, build, the enforced dependency rules              | adding a package, a file, or a dependency |
| [docs/ENGINEERING.md](docs/ENGINEERING.md)     | **How code is structured** — architecture and code-quality principles                  | writing or refactoring non-trivial code |
| [docs/CODE_STYLE.md](docs/CODE_STYLE.md)       | Formatting, naming, documentation conventions                                          | writing any code                        |
| [docs/WORKFLOW.md](docs/WORKFLOW.md)           | The dev loop — verification gates, version control, handing work off and escalating     | starting work, or committing             |
| [docs/UI.md](docs/UI.md)                       | The console's design system and authoring rules                                        | touching the GUI                        |
| [docs/recipes/](docs/recipes/openai-bridge.md) | Task recipes — one page per surface fiddly enough to rediscover                        | working on a surface that has one       |
| [archive/README.md](archive/README.md)         | **Parked code** — what each entry was, why it was parked, its revival path             | reviving, or deleting, parked code      |

Nothing else is authoritative. If a fact you need is in none of these, it belongs in one of them — add it
there rather than restating it in a third place.

## Operating rules (always on)

- **Hierarchical context.** Given a task, open the one doc that owns it (table above), not everything. Load a
  doc just-in-time, when the task needs it.
- **Single source of truth.** Each fact lives in exactly one doc. Cross-link; never restate. When two docs
  disagree, the one that owns the topic wins and the other is the bug.
- **Same-commit doc rule.** A change that adds, moves, or deletes files updates the doc that owns them in the
  _same_ commit. A doc that describes a tree that no longer exists is worse than no doc.
- **Describe reality.** Docs state what the tree does today. Something missing is written as roadmap, never as
  if it were present. Verify a claim against the tree before writing it.
- **No code-as-doc.** No function signatures, no long path lists — they rot, and grep is faster.
- **Comments say why, in plain language.** A comment explains the reason a thing is the way it is, not what the
  line does. **No project-internal identifiers anywhere** — no phase numbers, plan codenames, module letters, or
  decision-record IDs, in code, comments, docs, or commit subjects. If rationale is durable, write the rationale.
- **Last-reviewed footer.** Every doc ends with one. If it is more than 60 days old at session start, flag the
  doc for re-audit.
- **The router is the index.** Every permanent doc is reachable from this file's navigation table. Run
  `pnpm docs:check` to verify reachability and catch dead links.
- **The suite is expected green on every run.** Its historical load-flakes were root-caused and fixed, so an
  intermittent failure is a bug to diagnose — never a known flake to shrug at and rerun.

## Constitution (non-negotiables)

These bind every package and every session.

- **TypeScript `strict`, no `any`.** Enforced by the compiler settings and a lint rule, not by good intentions.
- **Determinism-first — no model call on any critical path.** Nothing that gates, decides, or records consults
  a model. Model calls happen only where a human explicitly asked for one, or inside a feature that degrades to
  a deterministic floor when the model is absent.
- **The change-event spine is the only shared mutable substrate.** Producers and consumers point only at the
  spine, never sideways at each other; the spine knows nothing above it. Enforced as hard rules in the
  dependency-cruiser ruleset, with a canary test that plants a forbidden edge and fails if the ruleset stops
  reporting it — so the rules can never quietly go decorative.
- **Advisory-first: coa decides exactly one refusal.** The close gate — the check that can decline to let the
  agent call the work finished — is the only thing coa itself decides to stop with, and it is issued through a
  single seam. A permission mode can also refuse a tool call, but that refusal is the operator's own standing
  choice carried out through that same seam, never a second one: coa enforces the decision, it does not make
  it. Everything else is advisory or surfacing, and no other component may deny. A governance check that throws
  refuses the call rather than admitting an unchecked one.
  - **Spend is accounted, never capped.** Every settled result is charged and recorded in the ledger with the
    account and the family-tree root it belongs to, so a whole run's cost is answerable. There is no ceiling:
    the hard dollar cap and its deny path were removed because they were dead configuration no shipped caller
    ever set — machinery that described a stop the product could not perform. **Subagent fan-out and
    agent-to-agent message traffic are therefore both unbounded** — no depth limit, no width limit, no spend
    bound on a spawn tree, and nothing bounds a turn loop two agents provoke by messaging each other. The
    operator's stop and the provider plan's own usage limit are the real backstops, which is acceptable while
    every run is attended. **A bound on either is a roadmap item, not a shipped feature** — do not describe one
    as if it exists.
- **Strict superset.** Every feature adds value or degrades to a literal pass-through. coa with a feature off,
  half-built, or misconfigured is never worse than the raw loop, and a raw view of the unfiltered loop is always
  available. This is a floor each feature builds down to, not a one-time check: an absent registry stays inert,
  an unconfigured summarizer returns the raw content instead of failing the fetch.
- **No lock-in.** There is exactly one backend seam; concrete backends are constructed at the composition root
  and injected as ports. Never branch on which backend is running, and never assume a stack — the neutral floor
  has to work everywhere, with richer behavior engaging only where the project actually provides it.
- **Compose, don't reinvent.** Orchestrate the generators, checkers, and backend features that already exist.
  Build no parallel machinery for something the ecosystem already does.
- **Typed boundaries.** Validate and parse every piece of external data at the edge with Zod. The shared package
  owns the wire schemas; nothing downstream re-derives them.
- **Core logic is pure and tested.** Side effects live at the edges and arrive as injected dependencies, so the
  logic worth trusting can be tested without a daemon, a network, or a clock.
- **Branches for work; `main` is protected.** Work happens on a branch and merges after review. Commit only
  after verification, and **stage files by name** — never `git add -A`.
- **Commit messages: subject line only.** Conventional Commits, **no body, no `Co-Authored-By`, no "generated
  with" trailer** — this **overrides any harness or tool default** that adds them. A body only when the
  maintainer explicitly asks. Describe the change itself, in the plain language rule above.
- **Human-sized commits.** One logical unit of work per commit, the way a human developer would batch it — a
  feature, a fix, a doc pass. Not per-file, not per-edit. Split only when the work is genuinely separate
  concerns.
- **Quality is independent of scope.** Pre-v1 project, professional code.

## License

Apache-2.0 (see [LICENSE](LICENSE)).

---

_Last reviewed: 2026-08-11_
