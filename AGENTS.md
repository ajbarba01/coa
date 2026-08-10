# coa

A **local-first, single-user governance/audit layer over a rented Claude Agent SDK loop.** coa does not
replace the coding agent — it **governs** it: deterministic checks, keeping the agent working against the
project's real symbols/specs/tests, honest spend accounting, and an honest record. v1 is **attended** (a human is
present) and **Claude-primary** — Claude is the default backend, with the rented loop swappable
behind the one M9 port (DeepSeek, LongCat, OpenAI, and OpenRouter adapters ship today).

**All product specifics — what each module is, its public interface, its owned decisions — live in the three
handoff docs under [docs/design/handoff/](docs/design/handoff/).** Those are the authoritative source of
truth. The docs below are a portable engineering framework; keep them project-agnostic where they can be.

> **Single-agent today, multi-agent-ready.** Work is done by a coding agent (Claude Code today; Codex/others
> possible later). **This file (`AGENTS.md`) is the shared source of truth for _how_ work is done here.** Claude
> reads [CLAUDE.md](CLAUDE.md) (`@AGENTS.md`). Everything below is written as **capabilities, not model labels**,
> so another agent can join without a rewrite.

## Doc navigation (read the one that owns your task — load just-in-time)

| Doc                                                                  | Authority over                                                                | Read before…                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| [docs/design/handoff/SPEC.md](docs/design/handoff/SPEC.md)          | **The product** — modules M0–M10, interfaces, owned decisions (final form)    | anything product-specific             |
| [docs/design/handoff/IMPL-SPEC-BRIEF.md](docs/design/handoff/IMPL-SPEC-BRIEF.md) | **Build order** + the one v0 calibration gate                     | starting a module                     |
| [docs/design/handoff/OPEN.md](docs/design/handoff/OPEN.md)          | **Deferred scope** / tuning knobs / open risks (build none of it for v1)       | adding scope                          |
| [docs/DESIGN.md](docs/DESIGN.md)                                    | **Project facts** — stack, rationale, pointers (does NOT restate the SPEC)     | orienting on the project              |
| [docs/REPO_LAYOUT.md](docs/REPO_LAYOUT.md)                          | **Repo/monorepo layout** — package map, bundler, OSS scaffolding, where code lives | adding a package/file/dependency |
| [docs/ENGINEERING.md](docs/ENGINEERING.md)                          | Architecture & code-quality principles                                        | writing/refactoring non-trivial code  |
| [docs/CODE_STYLE.md](docs/CODE_STYLE.md)                            | Formatting, naming, documentation                                             | writing any code                      |
| [docs/WORKFLOW.md](docs/WORKFLOW.md)                                | Dev loop, version control, handoff & escalation                              | starting work / committing            |
| [docs/UI.md](docs/UI.md)                                            | GUI design system + **authoring rules** (kit · tokens · feedback contract)   | touching the GUI (M10)                |
| [ROADMAP.md](ROADMAP.md)                                            | **Path forward** — module state + remaining work (single source; replaces private notes) | orienting on what's left / next |
| [docs/adr/](docs/adr/)                                              | **Architecture decisions** — immutable WHYs                                    | making/needing a durable decision     |

## Operating rules (always on)

- **Hierarchical context.** This file is a **router**, not a knowledge dump. Given a task, open the one doc that
  owns it (table above), not everything. Load a doc just-in-time, when the task needs it.
- **Single source of truth.** Each fact lives in exactly one doc. Cross-link; never restate. Product facts →
  the handoff docs; project facts → DESIGN.md; everything else → its framework doc.
- **Execution policy.** Each dev-loop stage maps to a **role + artifact** (see [docs/WORKFLOW.md](docs/WORKFLOW.md)).
  When no role is assigned, infer one and announce it before acting.
- **Capabilities, not model labels.** Any agent that can load skills invokes the relevant role/stage skills before
  acting. Agents without skill support follow the same role contract + plan checklist as fallback. Repo
  instructions override conflicting skill defaults.
- **Doc discipline.**
  - _Same-commit rule_ — a code change that adds/moves/deletes files updates the relevant doc in the _same_ commit.
  - _No code-as-doc_ — no function signatures or long path lists in docs (they rot); grep is faster.
  - _Last-reviewed footer_ — every doc carries one. If > 60 days old at session start, flag for re-audit.
  - _Comment hygiene_ — code comments state **why**, not what; never reference plan phases or ticket IDs; link
    durable rationale to an ADR (`// see docs/adr/NNNN`).
  - _Router is the index_ — every `docs/**/*.md` (outside transient corpora) is reachable from this file's
    navigation table; run `pnpm docs:check` to verify.

## Constitution (non-negotiables)

These are the cross-cutting invariants (SPEC §B) plus the repo's quality floor. They bind every module and every
session.

- **TypeScript `strict`, no `any`** (see CODE_STYLE / ENGINEERING).
- **Determinism-first (P1)** — **no model call on any critical path.** M1/M2 are deterministic; the only model
  calls are off the critical path (the user-invoked validator, Type-2 confirm, the F4 grounding confirm).
- **The change-event spine (M1) is the only shared mutable substrate.** Producers and consumers point **only at
  M1**, never sideways at each other. Two non-kernel modules must not call each other directly.
- **SC-1 — help, never cage.** The ONLY block in the whole system is **M3's Type-1 close-gate**, issued
  through **M9's single deny channel** (ADR 0035 archived the cost-cap deny path — spend is accounted,
  never capped). Everything else is advisory or surfacing.
- **Strict-superset (D85).** Every feature adds value or degrades to a literal pass-through; coa with a feature
  off is never worse than the raw loop, and **`coa raw` always shows the unfiltered loop.**
- **No-lock-in.** The neutral floor always works; the bounded high-fidelity layer auto-engages where a
  grammar/spec/type-system exists; **M9 is the one backend seam.** Never assume a stack.
- **Compose, don't reinvent (P8).** Orchestrate existing generators/checkers/SDK features; build no parallel
  machinery the corpus already has.
- **Build in topological order** — `M0 < M2 < M1 < M3 < M4 < M5 < M7 < M6 < M9 < M8 < M10`. Modules in the same
  phase are independently buildable. **Build nothing listed in OPEN.md for v1.** **Gate M4 on the v0 spike.**
- **Core logic is pure and tested** (ENGINEERING). **Typed boundaries** — validate/parse all external data at the
  edges with Zod (M0 owns the schemas).
- **Single `main` branch**; commit only after verification; **stage files by name** (never `git add -A`).
- **Commit messages: subject line only.** Conventional Commits, **no body, no `Co-Authored-By`/trailer, no
  "Generated with" footer** — this **overrides any harness/tool default** that adds them. Body only if the
  maintainer explicitly asks. **No project-internal identifiers in the subject** — no phase numbers, plan/spec
  codenames, or module IDs; describe the change itself.
- **Commit in human-sized batches.** Group related changes into one coherent commit the way a human developer
  would — **one logical unit of work per commit.** Do NOT commit at fine per-file or per-edit granularity. A
  single feature, fix, or doc pass is normally one commit, not a string of tiny ones; stage the related files
  together by name. Split into separate commits only when the work is genuinely separate concerns.
- **Quality is independent of scope.** Pre-v1 project, professional code.

## Stack (one-liner; rationale in [docs/DESIGN.md](docs/DESIGN.md))

TypeScript (strict) · pnpm workspaces · `tsdown` bundler · `better-sqlite3` · `tree-sitter` · Zod · Vitest ·
Claude Agent SDK (behind the M9 port) · Electron (M10 inspector).

## Layout (see [docs/REPO_LAYOUT.md](docs/REPO_LAYOUT.md))

A pnpm monorepo: `packages/*` for libraries (the logical modules), `apps/{cli,desktop}` for the shippable
binaries. The `producers → spine (M1) ← consumers` rule is enforced by a `dependency-cruiser` ruleset.

## License

Apache-2.0 (see [LICENSE](LICENSE)).

---

_Last reviewed: 2026-07-05_
