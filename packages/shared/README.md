# @coa/shared

M0 — the cross-module type and Zod schema set. Types and schemas only; no runtime behavior.

- **Module:** M0 Shared Schema — see [`spec/M0.md`](../../docs/design/handoff/spec/M0.md).
- **Public interface:** `src/index.ts`.

Imported by every other package; imports nothing itself. External data is validated against these schemas at
every module boundary.
