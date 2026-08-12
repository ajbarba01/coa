# @coa/shared

The cross-package type and Zod schema set, plus the handful of pure helpers that belong to a shared shape
rather than to any one consumer — a capability predicate over model metadata, the content-atom render, the
shared error type. No IO, no state, no dependency on another workspace package.

- **Public interface:** `src/index.ts`.

Imported by every other package; imports nothing itself — a rule the dependency ruleset enforces. External
data is validated against these schemas at every boundary it crosses (the wire, config files, IPC), so
nothing downstream re-derives a shape.

---

_Last reviewed: 2026-08-08_
