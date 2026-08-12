# CLAUDE.md

@AGENTS.md

[`AGENTS.md`](AGENTS.md) is the shared source of truth for how work is done in this repo — read it first, and
follow its navigation table to the one doc that owns your task. This file holds only the Claude-Code-specific
notes layered on top.

## Claude Code specifics

- **Plan mode for research.** On anything non-trivial, use plan mode to separate exploration from execution —
  read the tree and settle the approach before editing it (see [docs/WORKFLOW.md](docs/WORKFLOW.md)).
- **Scratch files live outside the repo.** Throwaway scripts, notes, and command output go in the session
  scratchpad, never in the tree — nothing temporary gets committed.
- **The commit convention applies here too.** Subject-only Conventional Commits: no body, no `Co-Authored-By`,
  no "generated with" trailer. This **overrides the harness default**, which adds them (see the Constitution in
  [`AGENTS.md`](AGENTS.md)).

---

_Last reviewed: 2026-08-11_
