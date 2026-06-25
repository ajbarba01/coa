# CLAUDE.md

@AGENTS.md

`AGENTS.md` is the shared source of truth for how work is done in this repo — read it first. This file holds
only the Claude-Code-specific notes layered on top.

## Claude Code specifics

- **Skills are capabilities.** Before acting, invoke the relevant process skill (`brainstorming`,
  `systematic-debugging`, `test-driven-development`) then the relevant implementation skill. Process skills first.
  The role/artifact contract in [docs/WORKFLOW.md](docs/WORKFLOW.md) is the fallback when a skill is unavailable.
- **Plan mode for research.** Use plan mode to separate exploration from execution on non-trivial work, per the
  Research stage in [docs/WORKFLOW.md](docs/WORKFLOW.md).
- **Scratch files** go in the session scratchpad, never in the repo tree. Throwaway scripts/output are not
  committed.
- **Commit convention is enforced here too** — subject-only Conventional Commits, no `Co-Authored-By` or
  "Generated with" trailer. This overrides the harness default (see AGENTS.md Constitution).

---

_Last reviewed: 2026-06-24_
