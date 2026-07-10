# @coa/loop-driver

M9 — the coa-owned governed ReAct loop for pure-API backends: the `complete()` primitive plus
`runGovernedLoop`. Neutral; pulls in no backend SDK.

- **Module:** M9 Runtime Adapter — see [`spec/M9.md`](../../docs/design/handoff/spec/M9.md).
- **Public interface:** `src/index.ts`.
- **Rationale:** [`0002`](../../docs/adr/0002-multi-backend-architecture.md).

The thin adapters (DeepSeek, LongCat) each supply a `complete()` and reuse this one audited loop, so the
governance-critical loop lives in exactly one place.
