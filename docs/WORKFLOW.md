# Development Workflow

> CORE doc — project-agnostic; product facts live in the handoff docs, project facts in [DESIGN.md](DESIGN.md).

> Authority for **the dev loop, version control, and handoff**. Always-on governance (doc discipline,
> hierarchical context, the Constitution) lives in [AGENTS.md](../AGENTS.md). For code structure see
> [ENGINEERING.md](ENGINEERING.md); conventions [CODE_STYLE.md](CODE_STYLE.md); layout [REPO_LAYOUT.md](REPO_LAYOUT.md).

**Consult to pick the next move.** Spec-driven and lightweight: the spec is the source artifact, code is the
output. Quality comes from principles + gates, not ceremony. Single-agent today; written model-agnostic so another
agent can pick up an artifact cold.

---

## The order of operations is the build order

Product work follows the **topological build order** ([IMPL-SPEC-BRIEF.md §2](design/handoff/IMPL-SPEC-BRIEF.md)):
`M0 < M2 < M1 < M3 < M4 < M5 < M7 < M6 < M9 < M8 < M10`. Two hard gates sit inside it:

- **The v0 calibration spike** ([IMPL-SPEC-BRIEF.md §1](design/handoff/IMPL-SPEC-BRIEF.md)) — a one-time
  pre-build gate that must run and be reported **before any M4 (Context Engine) milestone**. It gates _magnitude,
  not soundness_; if the loop-win is marginal, M4 stays thin. **Do not start M4 work without it.**
- **D-PROBE-1** (Phase 4/5) — the concurrent-session isolation probe; it is security-load-bearing and gates the
  multi-agent (M8) work.

---

## Where am I → what's next

| Situation                                           | Next move                                                                              | Preferred skill/capability                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| New module / non-trivial feature, nothing written   | **Research**, then write a `specs/<topic>.md` (the _what_ & _why_, grounded in the SPEC) | `superpowers:brainstorming`                              |
| Spec exists, no plan                                | **Plan** — turn it into a dependency-ordered technical plan.                            | `superpowers:writing-plans`                                 |
| Plan approved, not started                          | **Build** — start with tests for the core logic (ENGINEERING #4).                      | `superpowers:subagent-driven-development` / `executing-plans` |
| Mid-build, non-trivial logic                        | Test-first, then implement; keep the logic pure.                                       | `superpowers:test-driven-development`                       |
| Think it's done                                     | **Verify** — `tsc`/lint/tests, `/code-review`, then exercise the running daemon/CLI.   | `verification-before-completion` → `requesting-code-review` → `/code-review` → `verify` |
| Got code-review feedback                            | Triage before implementing — verify, don't perform agreement.                          | `superpowers:receiving-code-review`                         |
| Verified                                            | **Ship** — conventional commit to `main`.                                           | —                                                           |
| Hit a bug / unexpected behavior                     | Reproduce and find root cause _before_ proposing a fix; don't patch symptoms.          | `superpowers:systematic-debugging`                          |
| Sub-spec change (bugfix, contained edit)            | **Lightweight lane** — skip spec/plan; one agent owns it end-to-end; build + verify.   | role-appropriate debugging/TDD skills                       |
| Unsure what a module should do                      | Read its SPEC section. Still ambiguous → stop and ask the maintainer; don't assume.    | —                                                           |

---

## The loop: Research → Spec → Plan → Build → Verify → Ship

1. **Research** — explore the SPEC section + existing code _before_ coding. Use plan mode to separate exploration
   from execution; don't solve the wrong problem.
2. **Spec** — `specs/<topic>.md`: the _what_ and _why_, grounded in the handoff SPEC, no implementation detail.
3. **Plan** — turn the spec into a technical, dependency-ordered plan (the build order is the spine).
4. **Build** — implement against the plan. **Test-first for non-trivial logic** (the pure core especially).
5. **Verify** — a _fresh_ pass grades the work: `/code-review`, then exercise the running daemon/CLI. The author
   never grades itself.
6. **Ship** — conventional commit on `main`.

## Skill workflow (execution policy)

The loop maps onto a preferred skill chain, but skills are **capabilities, not model identities**. An agent with
the matching skill invokes it before acting; an agent without it follows the role contract + artifact checklist
directly. Process skills first (brainstorming, debugging), then implementation.

- **Execution may be subagent-driven.** When the active agent exposes subagents and the maintainer requests
  in-session execution, use `superpowers:subagent-driven-development`; otherwise `executing-plans` or sequential
  execution with native task tracking.
- **No worktrees by default.** Execution runs against `main` unless the maintainer asks for isolation.
- **Skip threshold (knob).** Brainstorm + spec + plan are required for anything non-trivial or scope-uncertain;
  **skipped** for sub-spec work (Lightweight lane). The maintainer moves this line per session. Unsure → ask.

## Portable stage map (model-agnostic)

Each stage is a **role + artifact**. The artifact is the handoff — whoever holds the next role reads it cold.

| Stage  | Artifact (the contract)             | Role          | Preferred skill(s)                        | Fallback                    |
| ------ | ----------------------------------- | ------------- | ----------------------------------------- | --------------------------- |
| Spec   | `specs/<topic>.md`                  | designer      | `brainstorming`                           | native planning + AGENTS.md |
| Plan   | `docs/superpowers/plans/<topic>.md` | designer      | `writing-plans`                           | native dependency planning  |
| Build  | code + passing gates                | implementer   | `subagent-driven-development` / `executing-plans`; TDD as relevant | read plan and execute gates |
| Verify | review report                       | reviewer      | `requesting-code-review` / `/code-review` | independent diff review     |

## Handoff contract

A plan is **ready to hand off** when a fresh agent runs it cold. It MUST contain: the spec path + dependency-ordered
task groups; **test-first markers** for non-trivial logic; **gates named explicitly** (`pnpm typecheck`,
`pnpm lint`, `pnpm test`, `/code-review`, manual `verify`); and the Definition of Done. **Handoff is file + git, not
clipboard** — the planner commits spec + plan and emits a one-line pointer; the implementer reads it off disk.

## Escalation protocol

File-based handoff has no live channel: escalation is **written**.

- **Triggers (stop, don't improvise):** the SPEC is ambiguous; the SPEC contradicts code reality; a gate cannot
  pass; a security / data-loss risk; scope creep into something deferred in OPEN.md; an invariant violation
  (a sideways call, a model call on a critical path).
- **Channel — a running `## Handoff log` at the bottom of the plan file.** The implementer appends an entry,
  commits, and stops. **Blocking** → stop and await a decision. **Non-blocking minor** → log it, keep going,
  batch for later.

## Lightweight lane (sub-spec work)

> When a change doesn't need a spec, it skips the **ceremony**, not the **gates**.

- **Scope** — bugfixes, small/medium refactors, isolated contained edits. The test is "does this need a spec to
  get right?", not "is it tiny?". Above the line → full Spec → Plan → handoff. Unsure → **ask**.
- **One agent, end to end** — no spec/plan/handoff artifact; the agent owns research → fix → verify → commit.
  Escalation is direct to the maintainer. If it grows past the line mid-task, stop and escalate to a spec.
- **Gates still apply** — `tsc`/lint/tests, **TDD for non-trivial logic**, `systematic-debugging` for bugs (root
  cause, not symptom), manual `verify`. The Definition of Done holds.

## Doc lifecycle

- **Plans:** a plan whose Definition of Done shipped moves to `docs/superpowers/plans/archive/` (git mv, same
  commit as the verification). Active plans only in the `plans/` root.
- **Specs:** design specs are decision records — they stay. A superseded spec moves to
  `docs/superpowers/specs/archive/` with a one-line pointer to its successor.
- The handoff docs (`SPEC.md` / `IMPL-SPEC-BRIEF.md` / `OPEN.md`) are the product source of truth and are amended
  in place when a decision genuinely changes; they are not archived.

## Version control & quality gates

- **Single `main` branch**, commit-as-you-go. No PRs / worktrees / branch ceremony yet — revisit when the repo
  opens to outside contributors (the OSS PR flow is described in [REPO_LAYOUT.md](REPO_LAYOUT.md)).
- **Commit only after verification.** Assume the tree is broken until verified; no broken commits.
- **Stage files by name** (never `git add -A` / `.`) — avoids accidental secret/binary inclusion.
- **Conventional Commits; imperative subject; new commit, not amend** (unless asked).
- **Subject line only — no body, no `Co-Authored-By`/trailer, no "Generated with" footer.** This overrides any
  harness default. No project-internal identifiers (phase numbers, plan/spec codenames, module IDs) in the subject.
- **Human-sized batches — one logical unit of work per commit.** Group related changes into one coherent commit
  the way a human would; do NOT commit at fine per-file/per-edit granularity. A whole feature, fix, or doc pass is
  normally a single commit. Split only for genuinely separate concerns. (This is why work is verified, then
  committed as a batch — not dribbled out edit by edit.)
- **Never `--no-verify`** — a failing hook means fix the root cause.
- **Gates before commit:** `tsc --strict` + ESLint + Prettier + Vitest on core logic + `/code-review` + manual
  `verify`. **Supply-chain gate** (when CI lands): committed `pnpm-lock.yaml`, `pnpm audit` / `osv-scanner`, and
  `--ignore-scripts` with the native-addon allowlist (see [REPO_LAYOUT.md](REPO_LAYOUT.md)).

## Verifying a daemon, not a web app

"Verify the running thing" here means: start the daemon, exercise the CLI verbs against it, confirm the change-event
WAL / projections behave, and check `coa raw` still shows the unfiltered loop (strict-superset). There is no browser
to click through until M10; until then verification is the test suite + the CLI + daemon behavior.

## Definition of Done

Tests green → types/lint/format clean → `/code-review` clean (a fresh pass, not the author) → manual `verify` of the
running daemon/CLI → conventional commit on `main`.

---

_Last reviewed: 2026-06-24_
