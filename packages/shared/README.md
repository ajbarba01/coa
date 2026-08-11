# @coa/shared

The cross-package type and Zod schema set. Types and schemas only; no runtime behavior.

- **Public interface:** `src/index.ts`.

Imported by every other package; imports nothing itself — a rule the dependency ruleset enforces. External
data is validated against these schemas at every boundary it crosses (the wire, config files, IPC), so
nothing downstream re-derives a shape.

---

_Last reviewed: 2026-08-08_
