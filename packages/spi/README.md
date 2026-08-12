# @coa/spi

The runtime-adapter capability port _types_ and their null-fallback contracts. Types only — no
implementations, no runtime behavior.

- **Public interface:** `src/index.ts`.

This is the one compile-time backend seam. The core asks whether a capability exists and takes a defined
fallback when it does not; it never branches on which backend is in use. Concrete backends are constructed
at the composition root and injected through these ports, which is what keeps a backend a swappable leaf —
see [ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

---

_Last reviewed: 2026-08-08_
