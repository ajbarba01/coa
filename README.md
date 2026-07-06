# coa

A local-first, single-user **governance / audit layer** over a rented Claude Agent SDK loop.
coa does not replace the coding agent — it **governs** it: deterministic checks, keeping the
agent working against the project's real symbols/specs/tests, a hard cost cap, and an honest
record. v1 is **attended** (a human is present) and **Claude-locked** (one backend, behind a
swappable port).

## Status

Under active development — see [`ROADMAP.md`](ROADMAP.md) for current module state and what's left.
The authoritative module specs are the three self-contained handoff docs under
[`docs/design/handoff/`](docs/design/handoff/):

- [`SPEC.md`](docs/design/handoff/SPEC.md) — the module specs, organized by module M0–M10 (WHAT to build).
- [`IMPL-SPEC-BRIEF.md`](docs/design/handoff/IMPL-SPEC-BRIEF.md) — the build order and the one pre-build gate (HOW).
- [`OPEN.md`](docs/design/handoff/OPEN.md) — deferred scope, tuning knobs, open risks (what NOT to build for v1).

## Build order

Topological: `M0 < M2 < M1 < M3 < M4 < M5 < M7 < M6 < M9 < M8 < M10`.
The v0 calibration spike gates the Context Engine (M4) — it must run and report before any M4 work begins.
