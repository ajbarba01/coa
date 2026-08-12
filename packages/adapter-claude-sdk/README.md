# @coa/adapter-claude-sdk

The fat Claude backend: a neutral→native prompt render layered on the harness's own preset, and the SDK-owned
loop with its two hooks. The only package permitted to import a backend SDK.

- **Public interface:** `src/index.ts`.

Two constraints shape this package. Backends stay swappable, so everything provider-specific is confined
behind one seam rather than leaking into the daemon — which is why this is the sole package allowed to
depend on a vendor SDK, a rule the dependency ruleset enforces. And composition never branches on which
backend is in use: coa layers its own material on top of whatever the native harness already provides
instead of forking or reimplementing it, so a capability the SDK ships is borrowed, not rebuilt. What
that costs and what it buys is in [ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

---

_Last reviewed: 2026-08-08_
