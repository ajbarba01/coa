# @coa/adapter-openai-compat

M9 — the thin pure-API backends over one OpenAI-compatible code path: `complete()` over HTTP (fetch only, no
backend SDK) driven by the shared `@coa/loop-driver`, parameterized by a `ProviderSpec`. DeepSeek, LongCat,
OpenAI (chat completions; the Responses API is deferred), and OpenRouter ship as spec objects.

- **Module:** M9 Runtime Adapter — see [`spec/M9.md`](../../docs/design/handoff/spec/M9.md).
- **Public interface:** `src/index.ts`.
- **Rationale:** [`0002`](../../docs/adr/0002-multi-backend-architecture.md).
