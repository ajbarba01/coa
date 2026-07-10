# @coa/adapter-claude-sdk

M9 — the fat Claude backend: neutral→native prompt render layered on the `claude_code` preset, the TS-LSP
capability backend, and the SDK-owned loop. The only package permitted to import a backend SDK.

- **Module:** M9 Runtime Adapter — see [`spec/M9.md`](../../docs/design/handoff/spec/M9.md).
- **Public interface:** `src/index.ts`.
- **Rationale:** [`0002`](../../docs/adr/0002-multi-backend-architecture.md),
  [`0004`](../../docs/adr/0004-layer-on-native-never-branch-on-backend.md).
