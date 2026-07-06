# 0002. Multi-backend architecture: one backend-blind core, one M9 seam

- Status: accepted
- Date: 2026-07-06

## Context and problem

coa started "Claude-locked" — one backend, behind a swappable port, per the original SPEC. That premise no longer matches the code: three backends now run through the loop (Claude Agent SDK, DeepSeek, LongCat), with the shared loop-driver package built specifically so a bare API model gets a governed loop identical in shape to the SDK's native one. The multi-backend design — why the core never names a backend, why there's exactly one seam, why adapters differ in shape but not interface — lived only in `docs/superpowers/` plan prose, invisible to any agent not holding that context. This ADR gives that decision a permanent, indexed home before the source plans are deleted.

## Decision drivers

- **No-lock-in (SPEC invariant):** the neutral floor must always work, and M9 must remain the *only* backend seam — never assume a stack.
- Governance must hold with equal strength regardless of which model executes the loop; a thin backend should not mean thinner oversight.
- Adding a new backend should not require touching the core (M0–M8) or the console/CLI consumers.
- Two of the three shipped backends (DeepSeek, LongCat) are bare chat-completion APIs with no native agent loop, tools, or hooks — the architecture has to accommodate "nothing native" as a first-class case, not a degraded one.

## Considered options

1. **One adapter per backend, sharing a driver package for backends with no native loop** (chosen). The Claude Agent SDK gets a "fat" adapter that hands the SDK its own loop/tools/cache/hooks and coa configures + governs around it. DeepSeek and LongCat get "thin" adapters that implement only a `complete()` primitive; the shared `@coa/loop-driver`'s `runGovernedLoop` supplies the loop, tool dispatch, and turn framing coa would otherwise have to duplicate per backend.
2. **A compat-endpoint swap** (e.g. pointing `ANTHROPIC_BASE_URL` at a non-Anthropic model so it looks like Claude to the SDK). Rejected: it launders a foreign backend through Claude-shaped assumptions instead of owning the integration, and silently inherits whatever the SDK assumes only Claude does.
3. **A minimal loop duplicated inside each thin adapter.** Rejected: the governed loop is the one place tool calls are dispatched and observed: duplicating it per adapter means duplicating the governance-critical path, with drift between copies as the failure mode.

## Decision

Adopt a **backend-blind core with exactly one backend seam**:

- M0–M8 produce and consume only neutral artifacts — `NeutralConfig`, `ContextPackage`, the governed tool catalogue, governance decisions — and drive sessions without ever naming a backend.
- The **only** seam is the M9 `RuntimeAdapter` port (D109) at compile time, plus the **D121 neutral-construction seam** (`SessionAdapterInit`, carrying only neutral types) at runtime. No SDK type crosses into the core.
- The **one wire vocabulary** everything downstream consumes is `TurnFrame`/`Push` out (`packages/shared/src/push.ts`) and `string | AsyncIterable<string>` in. The console and CLI consume frames identically no matter which backend produced them — that identical consumption is the entire payoff of the seam.
- Adapters differ in **shape, not interface**: fat (Claude SDK owns the loop; coa configures and governs it) vs. thin (coa supplies the loop itself via `complete()` + `@coa/loop-driver`'s `runGovernedLoop`, plus tools, prompt, and context the SDK would otherwise have supplied natively).
- The core asks capability questions ("does this backend support X?") and takes a defined null-fallback, never `if (backend === …)` branching.
- Shipped as **five packages**: `spi` (the port), `loop-driver` (the shared thin-path loop), `adapter-claude-sdk`, `adapter-deepseek`, `adapter-longcat`. `apps/cli`'s `createAdapter` is the one place that constructs a concrete backend, routing on `provider` (`claude` / `deepseek` / `longcat`); an unwired provider throws rather than silently misrouting.

## Consequences (good / bad)

**Good**
- Adding a pure chat-completion API is one adapter class implementing `complete()` — no M8 change, no core change.
- On the thin path, coa executes every tool call itself, so governance is *tighter* than on the fat path, not looser — the thing that could have been a liability (no native loop) is instead the more auditable case.
- Console and CLI code paths are backend-agnostic by construction; there is no per-backend branch to keep in sync.

**Bad**
- The fat adapter (Claude SDK) is the architectural outlier — it owns its own loop/tools/hooks natively, so it needs an ongoing parity/delta package to keep its behavior legible against the neutral model the rest of the system assumes.
- Three backends now means three adapters' worth of drift risk (rate limits, model-ID churn, effort-level semantics) instead of one; `docs/adr` and `ROADMAP.md`, not this file, track that per-backend maintenance state.

---

_Last reviewed: 2026-07-06_
