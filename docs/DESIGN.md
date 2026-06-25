# Design — Project Facts & Pointers

> **The authoritative product source of truth is the three handoff docs**, not this file:
>
> - [design/handoff/SPEC.md](design/handoff/SPEC.md) — the WHAT, by module (M0–M10): responsibility, public
>   interface, dependencies, and every owned decision in final form.
> - [design/handoff/IMPL-SPEC-BRIEF.md](design/handoff/IMPL-SPEC-BRIEF.md) — the build order + the v0 calibration
>   gate.
> - [design/handoff/OPEN.md](design/handoff/OPEN.md) — deferred scope, tuning knobs, open risks.
>
> This doc holds only **project facts not owned by a framework doc** (stack rationale, the module map at a glance,
> project-level open questions). It does **not** restate the SPEC — that would violate single-source-of-truth.
> When this doc and a handoff doc disagree, the handoff doc wins.

---

## What coa is

coa is a local-first, single-user **governance/audit layer** over a rented Claude Agent SDK loop. It does not
contain its own model loop; it **rents** a Claude Agent SDK agent loop and governs it — supplying the agent's
context, constraining its tools, grounding its reads against project truth, capping cost, and keeping an honest
record of what it cost and changed. It is a long-lived **daemon** plus thin clients (a CLI and an Electron
inspector).

Its value is **WITH-MODEL**: it appreciates as the model improves — the better the agent's judgment, the more you
want a record, guardrails, and sound context rather than raw capability. v1 is **attended** (a human is present)
and **Claude-locked** (one backend, behind a swappable port).

## Stack & rationale

| Layer            | Choice                                  | Why                                                                                          |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Language         | TypeScript (`strict`)                   | One language across daemon, CLI, and Electron GUI; structural types fit the schema-first M0  |
| Monorepo / pkg   | pnpm workspaces                         | Content-addressed store, strict hoisting, first-class workspace protocol; SPEC §A.4 is multi-package |
| Bundler          | `tsdown` (Rolldown+Oxc), **pinned exact** | `tsup` is unmaintained; tsdown is tsup-compatible. **Fallback:** `tsc`+esbuild if the 0.x cadence churns (IMPL §3) |
| Parsing          | `tree-sitter` (TS host, child process)  | Tiered code-intel across 40+ languages; runs as a separate process so a hostile file can't crash the daemon (M2) |
| Storage          | `better-sqlite3` + an append-only WAL   | SQLite projections are reconstructible-not-durable; the change-event WAL is the durable source of truth (M1) |
| Validation       | Zod                                     | Runtime-validate every external boundary; M0 owns the schemas (wire, flag, piece, RPC)       |
| Tests            | Vitest                                  | Fast TS-native runner; pure core logic is the priority test surface (ENGINEERING)            |
| Agent backend    | Claude Agent SDK, behind the M9 port    | The one backend seam. Secondary path (`ai`/`@ai-sdk/anthropic`) stays behind the same port (IMPL §3) |
| GUI              | Electron (M10)                          | Local pull/inspector app; concrete UI stack decided at M10 (see [UI.md](UI.md))              |

## The module map at a glance

Eleven modules, M0–M10. Full definitions in [the SPEC](design/handoff/SPEC.md) §A; physical package homes in
[REPO_LAYOUT.md](REPO_LAYOUT.md). One line each:

- **M0 Shared Schema** — the canonical wire/record types every module agrees on.
- **M1 Change Kernel** — the single source of truth for "what changed": the durable WAL + live typed graph + symbol index. _The only shared mutable substrate._
- **M2 Code Lens** — the one pure, graph-free byte→structure function (parse / canonicalize / extract / tier).
- **M3 Constraint & Flag System** — one pluggable check pipeline; tags, dedups, surfaces flags; owns the one close-gate block.
- **M4 Context Engine** — keep the agent working against project truth (generate SSOTs, assemble capped context, ground in-flight, detect drift). _Gated on the v0 spike._
- **M5 Config Compiler** — compile composed Pieces into one backend-neutral config, cache-stably.
- **M6 Workbench** — the governed tool surface; routes every precise write into the kernel (producer ①).
- **M7 Governance & Audit** — the cost cap, the secret-clean ledger, the visibility floor, the Decision log.
- **M8 Daemon Orchestration** — the always-on process shell: transport, session lifecycle, worktree binding, subagent orchestration.
- **M9 Runtime Adapter** — the one place backend-specific behavior lives: the capability ports + neutral→native render.
- **M10 Console** — the human surface: CLI verbs, the pull/inspector GUI, and the honest `coa raw` escape.

## Project-level open questions

Running list; product-level open risks live in [OPEN.md](design/handoff/OPEN.md) §3 (not restated here).

- **Copyright holder** for the Apache-2.0 NOTICE / source headers — currently unset (LICENSE carries the standard
  appendix template). Confirm the legal name/entity before the first published release.
- **CI provider details** — GitHub Actions assumed (the repo is on GitHub); the concrete workflow + the
  `pnpm audit` / `osv-scanner` gates are scaffolded when CI is added (see [REPO_LAYOUT.md](REPO_LAYOUT.md)).

---

_Last reviewed: 2026-06-24_
