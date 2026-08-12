# @coa/adapter-openai-compat

One thin backend over any OpenAI-compatible HTTP API: `complete()` over `fetch` (no backend SDK) driven by
the shared [`@coa/loop-driver`](../loop-driver), parameterized by a data-only provider spec. DeepSeek,
LongCat, OpenAI (chat completions — the Responses API is not built) and OpenRouter ship as spec objects
over the one code path.

- **Public interface:** `src/index.ts`.

Every per-provider difference that is real on the wire lives in the spec: endpoints, default model,
credential and pricing pointers, the reasoning-field mapping, and how to pull neutral token counts out of
that provider's usage shape. Adding another compatible provider is a new spec and a new row in the backend
factory's map — not a new package, and not a branch on which provider is running. See
[ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

---

_Last reviewed: 2026-08-08_
