# @coa/spi

M9 — the runtime-adapter capability port *types* and their null-fallback contracts. The one compile-time
backend seam: the core asks whether a capability exists and takes a defined fallback, never branching on
which backend is in use.

- **Module:** M9 Runtime Adapter (ports) — see [`spec/M9.md`](../../docs/design/handoff/spec/M9.md).
- **Public interface:** `src/index.ts`.
- **Rationale:** [`0002`](../../docs/adr/0002-multi-backend-architecture.md).
