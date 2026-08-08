# Development Workflow

> Authority for **the dev loop, decisions, version control, and handoff**. Always-on governance (doc discipline,
> hierarchical context, the constitution) lives in [AGENTS.md](../AGENTS.md). For code structure see
> [ENGINEERING.md](ENGINEERING.md); conventions [CODE_STYLE.md](CODE_STYLE.md); layout
> [REPO_LAYOUT.md](REPO_LAYOUT.md); what the system is [ARCHITECTURE.md](ARCHITECTURE.md).

**Consult this to pick the next move.** Lightweight and spec-driven: the written intent is the source artifact,
code is the output. Quality comes from principles plus gates, not ceremony. Written model-agnostic so any agent
can pick up an artifact cold.

---

## Order of work

There is no separate build order to consult. Work is ordered by the **dependency graph**: a thing is buildable
once everything it points at exists, and the graph is acyclic by rule ([ENGINEERING.md](ENGINEERING.md) #1). Two
pieces with no edge between them are independently buildable and can run in parallel.

What is done, what is partial, and what is deliberately deferred all live in [ROADMAP.md](../ROADMAP.md) — read
it to find the next move, and update it in the same commit as the work that changes its state.

---

## Where am I → what's next

| Situation                                        | Next move                                                                        | Preferred skill/capability                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| New surface / non-trivial feature, nothing written | **Research**, then write the intent down — the _what_ and _why_, grounded in the code. | `superpowers:brainstorming`                                |
| Intent exists, no plan                           | **Plan** — turn it into a dependency-ordered technical plan.                       | `superpowers:writing-plans`                                   |
| Plan approved, not started                       | **Build** — start with tests for the core logic (ENGINEERING #4).                 | `superpowers:subagent-driven-development` / `executing-plans` |
| Mid-build, non-trivial logic                     | Test-first, then implement; keep the logic pure.                                  | `superpowers:test-driven-development`                         |
| Think it's done                                  | **Verify** — `pnpm check`, `/code-review`, then exercise the running thing.       | `verification-before-completion` → `requesting-code-review` → `/code-review` |
| Got code-review feedback                         | Triage before implementing — verify, don't perform agreement.                     | `superpowers:receiving-code-review`                           |
| Verified                                         | **Ship** — conventional commit to `main`.                                         | —                                                             |
| Hit a bug / unexpected behavior                  | Reproduce and find root cause _before_ proposing a fix; don't patch symptoms.     | `superpowers:systematic-debugging`                            |
| Small contained change                           | **Lightweight lane** — skip the written intent; one agent owns it end to end.     | role-appropriate debugging/TDD skills                         |
| Unsure what a part is supposed to do             | Read its section in ARCHITECTURE.md and the code. Still ambiguous → stop and ask. | —                                                             |

---

## The loop: Research → Intent → Plan → Build → Verify → Ship

1. **Research** — read the relevant architecture section and the existing code _before_ coding. Use plan mode to
   separate exploration from execution; don't solve the wrong problem.
2. **Intent** — the _what_ and _why_, grounded in the code as it actually is, with no implementation detail.
3. **Plan** — turn the intent into a technical, dependency-ordered plan.
4. **Build** — implement against the plan. **Test-first for non-trivial logic** (the pure core especially).
5. **Verify** — a _fresh_ pass grades the work: `pnpm check`, `/code-review`, then exercise the running daemon,
   CLI, or console. The author never grades itself.
6. **Ship** — conventional commit on `main`, with the docs the change touches updated in the same commit.

## Skill workflow (execution policy)

The loop maps onto a preferred skill chain, but skills are **capabilities, not model identities**. An agent with
the matching skill invokes it before acting; an agent without it follows the same role contract and checklist
directly. Process skills first (brainstorming, debugging), then implementation.

- **Execution may be subagent-driven.** When the active agent exposes subagents and the maintainer asks for
  in-session execution, use `superpowers:subagent-driven-development`; otherwise `executing-plans` or sequential
  execution with native task tracking.
- **No worktrees by default.** Execution runs against `main` unless the maintainer asks for isolation.
- **Skip threshold (a knob).** Written intent plus a plan is required for anything non-trivial or
  scope-uncertain, and **skipped** for contained work (the lightweight lane below). The maintainer moves this
  line per session. Unsure → ask.

## Portable stage map

Each stage is a **role + artifact**. The artifact is the handoff — whoever holds the next role reads it cold.

| Stage  | Artifact (the contract)      | Role        | Preferred skill(s)                                                 | Fallback                     |
| ------ | ---------------------------- | ----------- | ------------------------------------------------------------------ | ---------------------------- |
| Intent | a written brief              | designer    | `brainstorming`                                                    | native planning + AGENTS.md  |
| Plan   | a dependency-ordered plan    | designer    | `writing-plans`                                                    | native dependency planning   |
| Build  | code + passing gates         | implementer | `subagent-driven-development` / `executing-plans`; TDD as relevant | read the plan, run the gates |
| Verify | a review report              | reviewer    | `requesting-code-review` / `/code-review`                          | independent diff review      |

**These artifacts are working files, not repo content.** They live in the session scratchpad and are thrown away
when the work ships — the repo keeps the code, the decision, and the roadmap entry, not the paperwork that
produced them.

## Handoff contract

A plan is **ready to hand off** when a fresh agent can run it cold. It must contain: the intent it implements;
dependency-ordered task groups; **test-first markers** for non-trivial logic; **gates named explicitly**
(`pnpm check`, `/code-review`, and the manual exercise of the running thing); and the definition of done.
Handoff is **a file plus its path**, never a paste into a chat — the implementer reads it off disk.

## Escalation protocol

File-based handoff has no live channel, so escalation is **written**.

- **Triggers (stop, don't improvise):** the intent is ambiguous; the intent contradicts code reality; a gate
  cannot pass; a security or data-loss risk; scope creep into something the roadmap defers; an invariant
  violation (a sideways call, a model call on a critical path).
- **Channel — a running handoff log at the bottom of the plan file.** The implementer appends an entry and
  stops. **Blocking** → stop and await a decision. **Non-blocking minor** → log it, keep going, batch it for
  later.

## Lightweight lane (contained work)

> When a change doesn't need a written intent, it skips the **ceremony**, not the **gates**.

- **Scope** — bugfixes, small and medium refactors, isolated contained edits. The test is "does this need
  written intent to get right?", not "is it tiny?". Above the line → full intent → plan → handoff. Unsure →
  **ask**.
- **One agent, end to end** — no intent/plan/handoff artifact; the agent owns research → fix → verify → commit.
  Escalation goes straight to the maintainer. If it grows past the line mid-task, stop and escalate.
- **Gates still apply** — `pnpm check`, **TDD for non-trivial logic**, root-cause debugging for bugs, and the
  manual exercise of the running thing. The definition of done holds.

## Recording decisions

Decisions are recorded **where the constraint they explain lives**, not in a parallel corpus that drifts away
from the code.

- **A durable decision goes into [ARCHITECTURE.md](ARCHITECTURE.md)** — inline, in plain language, in the
  section describing the thing it binds. A reader who needs to know why a boundary is drawn that way finds the
  reason next to the boundary, in the same pass. Write the reason, not the meeting: what was chosen, what it
  rules out, and what would have to change to revisit it.
- **Deferred intent goes into [ROADMAP.md](../ROADMAP.md)** — what is not built, and whether that is "not yet"
  or "deliberately not". A deferral with no home is how scope creeps back in.
- **Everything else is transient.** Briefs, plans, and review reports exist to get a change built. When the
  change ships, the decision graduates, the status lands in the roadmap, and the working file is deleted — git
  history is the archive.
- **When code and a doc disagree, the code is the fact.** Fix the doc in the same commit, or file it as a
  critical finding ([ENGINEERING.md](ENGINEERING.md)) — never leave a doc asserting a feature the tree does not
  have. Something that is missing is described as roadmap, never in the present tense.

## Version control & quality gates

- **Single `main` branch**, commit as you go. No PRs, worktrees, or branch ceremony yet — revisit when the repo
  opens to outside contributors (the eventual PR flow is sketched in [REPO_LAYOUT.md](REPO_LAYOUT.md)).
- **Commit only after verification.** Assume the tree is broken until verified; no broken commits.
- **Stage files by name** (never `git add -A` or `.`) — it avoids accidental secret or binary inclusion.
- **Conventional Commits; imperative subject; a new commit, not an amend** (unless asked).
- **Subject line only — no body, no `Co-Authored-By` trailer, no "Generated with" footer.** This overrides any
  harness default. No internal identifiers in the subject (phase numbers, plan codenames, internal IDs).
- **Human-sized batches — one logical unit of work per commit.** Group related changes into one coherent commit
  the way a human would; do not commit at per-file or per-edit granularity. A whole feature, fix, or doc pass is
  normally a single commit. Split only for genuinely separate concerns.
- **Never bypass a gate** — no `--no-verify`, no skipping `pnpm check` "just this once". A failure means fix the
  root cause, not silence it.
- **Gates before commit:** `pnpm check` (typecheck, lint, format, tests, dependency rules) plus `pnpm docs:check`
  when docs moved, then `/code-review` and a manual exercise of the running thing. When CI lands it runs the same
  gates plus the supply-chain checks described in [REPO_LAYOUT.md](REPO_LAYOUT.md).

## Verifying a daemon, not a web app

"Verify the running thing" here means: start the daemon, exercise the CLI verbs against it, confirm the change
log and its projections behave, and — for anything the console touches — drive the Electron app and watch the
surface actually change. Raw mode is part of that check: the console must still be able to show the unfiltered
loop, because a governed view that cannot be turned off is not a superset of the raw one.

## Definition of done

Tests green → types, lint, and format clean → dependency rules clean → `/code-review` clean (a fresh pass, not
the author) → the running daemon, CLI, or console exercised by hand → docs touched by the change updated →
conventional commit on `main`.

---

_Last reviewed: 2026-08-08_
