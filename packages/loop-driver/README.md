# @coa/loop-driver

The coa-owned governed agent loop the pure-API backends share: the single-round-trip `complete()` primitive
plus the loop that drives it. Neutral — it pulls in no backend SDK, and the dependency ruleset forbids it
importing an adapter back.

- **Public interface:** `src/index.ts`.

The thin adapter supplies a `complete()` and reuses this one audited loop, so the governance-critical
dispatch path — the per-tool check before execution, the close gate before the turn may end, neither of
which ever throws — exists in exactly one place. The loop also carries a hard iteration bound and a
defense-in-depth cap on any single tool result entering the resent transcript; both are explained in
[ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

---

_Last reviewed: 2026-08-08_
